//! Ordner einlesen: Index aus Dateien und Begleitdateien aufbauen (ARCHITEKTUR.md 2.12).
//!
//! Der Scan arbeitet auf einem Schnappschuss des alten Index und gibt ein Ergebnis zurück, das die Bibliothek anschließend
//! einsetzt – so blockiert ein langer Scan keine Abfragen.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;
use walkdir::WalkDir;

use crate::error::{IoError, LibraryError};
use crate::platform::fsx;
use crate::progress::ProgressSink;
use crate::util::now_iso;

use super::model::{
    IndexEntry, META_DIR, SidecarFile, classify, conflict_of, default_meta, extension_of, is_ignored_file, iso_from_ms,
    ms_of,
};

/// Fortschritt eines Scans.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScanProgress {
    pub scanned: u32,
    pub found: u32,
}

/// Ergebnis eines Scans.
#[derive(Debug, Clone)]
pub struct ScanResult {
    pub entries: Vec<IndexEntry>,
    pub project_count: u32,
    pub total_bytes: u64,
    pub scanned_at: String,
}

/// So viele Dateien ohne Begleitdatei werden höchstens gehasht, um umbenannte Dateien wiederzufinden.
const RENAME_HASH_LIMIT: usize = 300;
/// Dateien über dieser Größe werden dafür nicht gehasht.
const RENAME_HASH_MAX_BYTES: u64 = 64 * 1024 * 1024;

pub fn sidecar_path(root: &Path, rel: &str) -> std::path::PathBuf {
    let mut p = root.join(META_DIR).join("meta");
    for c in rel.split('/') {
        p.push(c);
    }
    let mut name = p.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".json");
    p.set_file_name(name);
    p
}

/// Liest eine Begleitdatei; `None`, wenn es sie nicht gibt oder sie unlesbar ist.
pub fn read_sidecar(root: &Path, rel: &str) -> Option<SidecarFile> {
    let path = sidecar_path(root, rel);
    match fsx::read_json::<SidecarFile>(&path) {
        Ok(Some(s)) if s.format_version <= super::model::SIDECAR_FORMAT_VERSION => Some(s),
        Ok(_) => None,
        Err(e) => {
            tracing::warn!("Begleitdatei {} unlesbar: {e}", path.display());
            None
        }
    }
}

pub fn write_sidecar(root: &Path, rel: &str, file: &SidecarFile) -> Result<(), IoError> {
    fsx::write_json_atomic(&sidecar_path(root, rel), file)
}

fn image_size(path: &Path) -> (Option<u32>, Option<u32>) {
    match image::ImageReader::open(path).and_then(|r| r.with_guessed_format()).map(image::ImageReader::into_dimensions)
    {
        Ok(Ok((w, h))) => (Some(w), Some(h)),
        _ => (None, None),
    }
}

fn wants_dimensions(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "webp" | "tif" | "tiff" | "gif" | "bmp")
}

/// Projekt-ID aus `Projekte/<Ordner>/projekt.json` (mit Zwischenspeicher je Ordner).
fn project_id_of(root: &Path, rel: &str, cache: &mut HashMap<String, Option<String>>) -> Option<String> {
    let mut parts = rel.split('/');
    if parts.next()? != "Projekte" {
        return None;
    }
    let folder = parts.next()?;
    parts.next()?; // Datei direkt in `Projekte/` hat kein Projekt
    cache
        .entry(folder.to_owned())
        .or_insert_with(|| {
            #[derive(serde::Deserialize)]
            struct P {
                id: String,
            }
            fsx::read_json::<P>(&root.join("Projekte").join(folder).join("projekt.json")).ok().flatten().map(|p| p.id)
        })
        .clone()
}

fn sha256_hex(path: &Path) -> Option<String> {
    crate::util::sha256_file_hex(path).ok()
}

/// Liest den Ordner ein. `previous`: alter Index nach `relPath` (für schnelle Wiederverwendung).
pub fn scan_tree(
    root: &Path,
    previous: &BTreeMap<String, IndexEntry>,
    sink: &dyn ProgressSink<ScanProgress>,
    cancel: &CancellationToken,
) -> Result<ScanResult, LibraryError> {
    if !root.is_dir() {
        return Err(LibraryError::RootInvalid(crate::api::LibraryRootInvalidReason::NotADirectory));
    }
    let mut entries: Vec<IndexEntry> = Vec::new();
    let mut project_cache: HashMap<String, Option<String>> = HashMap::new();
    let (mut scanned, mut total_bytes, mut project_count) = (0u32, 0u64, 0u32);
    let mut last_emit = Instant::now();
    let mut used_sidecars: BTreeSet<String> = BTreeSet::new();

    let walker = WalkDir::new(root).follow_links(false).into_iter().filter_entry(|e| {
        let n = e.file_name().to_string_lossy();
        e.depth() == 0 || !(e.file_type().is_dir() && n.starts_with('.'))
    });
    for entry in walker.filter_map(Result::ok) {
        if cancel.is_cancelled() {
            return Err(LibraryError::Cancelled);
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(rel_path) = entry.path().strip_prefix(root) else { continue };
        let rel = rel_path.to_string_lossy().replace('\\', "/");
        if name == "projekt.json" && rel.split('/').count() == 3 && rel.starts_with("Projekte/") {
            project_count += 1;
            continue;
        }
        if is_ignored_file(&name) {
            continue;
        }
        scanned += 1;
        let Ok(md) = entry.metadata() else { continue };
        let size = md.len();
        let modified_ms = md.modified().map(ms_of).unwrap_or(0);
        let ext = extension_of(&rel);
        let kind = classify(&ext);

        // Maße: aus dem alten Index übernehmen, wenn die Datei gleich geblieben ist
        let old = previous.get(&rel).filter(|o| o.size == size && o.modified_ms == modified_ms);
        let (width_px, height_px) = match old {
            Some(o) => (o.width_px, o.height_px),
            None if wants_dimensions(&ext) => image_size(entry.path()),
            None => (None, None),
        };

        let sidecar = read_sidecar(root, &rel);
        if sidecar.is_some() {
            used_sidecars.insert(rel.clone());
        }
        let (id, meta, sidecar_missing, content_sha256) = match sidecar {
            Some(s) => (s.id.clone(), s.meta(), false, s.content_sha256.clone()),
            None => {
                let id = old.map_or_else(|| IndexEntry::derived_id(&rel), |o| o.id.clone());
                (id, default_meta(&rel, &iso_from_ms(modified_ms)), true, old.and_then(|o| o.content_sha256.clone()))
            }
        };
        total_bytes += size;
        entries.push(IndexEntry {
            id,
            kind,
            project_id: project_id_of(root, &rel, &mut project_cache),
            conflict: conflict_of(&rel),
            rel_path: rel,
            size,
            modified_ms,
            width_px,
            height_px,
            meta,
            sidecar_missing,
            content_sha256,
        });
        if last_emit.elapsed() >= Duration::from_millis(100) {
            sink.emit(ScanProgress { scanned, found: entries.len() as u32 });
            last_emit = Instant::now();
        }
    }

    adopt_renamed_files(root, &mut entries, &used_sidecars, cancel)?;
    // Mehrdeutige IDs vermeiden (kopierte Begleitdatei): zweite Datei bekommt eine abgeleitete ID
    let mut seen = BTreeSet::new();
    for e in &mut entries {
        if !seen.insert(e.id.clone()) {
            e.id = IndexEntry::derived_id(&e.rel_path);
            e.sidecar_missing = true;
            seen.insert(e.id.clone());
        }
    }
    entries.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    sink.emit(ScanProgress { scanned, found: entries.len() as u32 });
    Ok(ScanResult { entries, project_count, total_bytes, scanned_at: now_iso() })
}

/// Findet verwaiste Begleitdateien (Datei wurde außerhalb der App umbenannt oder verschoben) über `contentSha256`.
fn adopt_renamed_files(
    root: &Path,
    entries: &mut [IndexEntry],
    used_sidecars: &BTreeSet<String>,
    cancel: &CancellationToken,
) -> Result<(), LibraryError> {
    let meta_root = root.join(META_DIR).join("meta");
    let mut orphans: HashMap<String, (String, SidecarFile)> = HashMap::new(); // sha256 -> (alter relPath, Begleitdatei)
    for e in WalkDir::new(&meta_root).follow_links(false).into_iter().filter_map(Result::ok) {
        if !e.file_type().is_file() || e.path().extension().is_none_or(|x| x != "json") {
            continue;
        }
        let Ok(rel_json) = e.path().strip_prefix(&meta_root) else { continue };
        let rel_json = rel_json.to_string_lossy().replace('\\', "/");
        let Some(original) = rel_json.strip_suffix(".json") else { continue };
        if used_sidecars.contains(original) || root.join(original).exists() {
            continue;
        }
        if let Ok(Some(s)) = fsx::read_json::<SidecarFile>(e.path())
            && let Some(sha) = s.content_sha256.clone()
        {
            orphans.insert(sha, (original.to_owned(), s));
        }
    }
    if orphans.is_empty() {
        return Ok(());
    }
    for entry in
        entries.iter_mut().filter(|e| e.sidecar_missing && e.size <= RENAME_HASH_MAX_BYTES).take(RENAME_HASH_LIMIT)
    {
        if cancel.is_cancelled() {
            return Err(LibraryError::Cancelled);
        }
        let Some(sha) = sha256_hex(&root.join(&entry.rel_path)) else { continue };
        if let Some((old_rel, sidecar)) = orphans.remove(&sha) {
            // Begleitdatei an den neuen Namen hängen: neue schreiben, alte entfernen
            let mut moved = sidecar.clone();
            moved.updated_at = now_iso();
            if write_sidecar(root, &entry.rel_path, &moved).is_ok() {
                let _ = std::fs::remove_file(sidecar_path(root, &old_rel));
                entry.id = moved.id.clone();
                entry.meta = moved.meta();
                entry.content_sha256 = moved.content_sha256.clone();
                entry.sidecar_missing = false;
            }
        }
    }
    Ok(())
}

/// Hash für Begleitdateien (nur für eigene Importe und Metadatenänderungen).
pub fn content_hash(path: &Path) -> Option<String> {
    sha256_hex(path)
}
