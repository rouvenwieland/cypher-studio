//! Austauschpaket `.cypherpack` (ARCHITEKTUR.md 2.12, 4.6): ZIP mit `cypherpack.json`, `files/<relPath>` und optional
//! `meta/<relPath>.json`.
//!
//! Importregeln: Das Manifest muss jede Datei mit Größe und SHA-256 nennen (keine unbekannten Einträge im ZIP), höchstens
//! 5000 Einträge und 4 GB, Pfade nach 6.6 geprüft, Ziel nur unterhalb der Bibliothekswurzel, nie in `.cypher`.

use std::collections::BTreeSet;
use std::fs::File;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;
use zip::CompressionMethod;
use zip::write::SimpleFileOptions;

use crate::api::{PackConflictPolicy, PackEntryState, PackImportReport, PackPreview, PackPreviewEntry};
use crate::error::{IoError, LibraryError};
use crate::platform::fsx;
use crate::progress::ProgressSink;
use crate::util::{new_id, now_iso};

use super::model::{META_DIR, SidecarFile, classify, extension_of};
use super::scan::{read_sidecar, sidecar_path, write_sidecar};

pub const PACK_FORMAT_VERSION: u32 = 1;
pub const MAX_ENTRIES: usize = 5000;
pub const MAX_TOTAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 8 * 1024 * 1024;
const MAX_SIDECAR_BYTES: u64 = 256 * 1024;
const MANIFEST_NAME: &str = "cypherpack.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PackProgress {
    pub done: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackEntry {
    rel_path: String,
    size: u64,
    sha256: String,
    kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackManifest {
    format_version: u32,
    title: String,
    created_by: String,
    created_at: String,
    app_version: String,
    entries: Vec<PackEntry>,
}

fn invalid(reason: impl Into<String>) -> LibraryError {
    LibraryError::PackInvalid(reason.into())
}

fn check_cancel(c: &CancellationToken) -> Result<(), LibraryError> {
    if c.is_cancelled() { Err(LibraryError::Cancelled) } else { Ok(()) }
}

fn kind_name(rel: &str) -> String {
    serde_json::to_value(classify(&extension_of(rel)))
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| "other".into())
}

fn store_only(ext: &str) -> bool {
    matches!(
        ext,
        "png"
            | "jpg"
            | "jpeg"
            | "webp"
            | "mp4"
            | "mov"
            | "mkv"
            | "webm"
            | "kra"
            | "ora"
            | "glb"
            | "woff2"
            | "mp3"
            | "flac"
            | "ogg"
            | "zip"
    )
}

fn to_hex(d: &[u8]) -> String {
    use std::fmt::Write as _;
    d.iter().fold(String::with_capacity(d.len() * 2), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

/// Schreibt die ausgewählten Dateien (relative Pfade) mit Begleitdateien in `dest`. Gibt die Zahl der Einträge zurück.
#[allow(clippy::too_many_arguments)]
pub fn export(
    root: &Path,
    rel_paths: &[String],
    dest: &Path,
    title: &str,
    author: &str,
    include_sidecars: bool,
    app_version: &str,
    sink: &dyn ProgressSink<PackProgress>,
    cancel: &CancellationToken,
) -> Result<usize, LibraryError> {
    if rel_paths.is_empty() {
        return Err(LibraryError::InvalidInput {
            field: "entryIds".into(),
            reason: "Nichts zum Exportieren ausgewählt".into(),
        });
    }
    if rel_paths.len() > MAX_ENTRIES {
        return Err(LibraryError::InvalidInput {
            field: "entryIds".into(),
            reason: format!("Höchstens {MAX_ENTRIES} Dateien je Paket"),
        });
    }
    let tmp = tempfile::Builder::new()
        .prefix(".cypher-pack-")
        .tempfile_in(dest.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| Path::new(".")))
        .map_err(|e| IoError::write(dest, e))?;
    let mut zip = zip::ZipWriter::new(tmp.as_file());
    let mut entries: Vec<PackEntry> = Vec::new();
    let mut sidecars: Vec<(String, Vec<u8>)> = Vec::new();
    let total = rel_paths.len() as u32;
    let mut total_bytes = 0u64;
    sink.emit(PackProgress { done: 0, total });
    for (i, rel) in rel_paths.iter().enumerate() {
        check_cancel(cancel)?;
        let source = fsx::safe_join(root, rel)?;
        let mut file = File::open(&source).map_err(|e| IoError::read(&source, e))?;
        let size = file.metadata().map_err(|e| IoError::read(&source, e))?.len();
        total_bytes += size;
        if total_bytes > MAX_TOTAL_BYTES {
            return Err(LibraryError::InvalidInput {
                field: "entryIds".into(),
                reason: "Die Dateien sind zusammen größer als 4 GB".into(),
            });
        }
        let method =
            if store_only(&extension_of(rel)) { CompressionMethod::Stored } else { CompressionMethod::Deflated };
        let options = SimpleFileOptions::default().compression_method(method).large_file(size >= 3_900_000_000);
        zip.start_file(format!("files/{rel}"), options).map_err(|e| invalid(e.to_string()))?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 1 << 20];
        let mut written = 0u64;
        loop {
            check_cancel(cancel)?;
            let n = file.read(&mut buf).map_err(|e| IoError::read(&source, e))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            zip.write_all(&buf[..n]).map_err(|e| IoError::write(dest, e))?;
            written += n as u64;
        }
        entries.push(PackEntry {
            rel_path: rel.clone(),
            size: written,
            sha256: to_hex(&hasher.finalize()),
            kind: kind_name(rel),
        });
        if include_sidecars
            && let Ok(bytes) = std::fs::read(sidecar_path(root, rel))
            && bytes.len() as u64 <= MAX_SIDECAR_BYTES
        {
            sidecars.push((rel.clone(), bytes));
        }
        sink.emit(PackProgress { done: i as u32 + 1, total });
    }
    for (rel, bytes) in sidecars {
        zip.start_file(format!("meta/{rel}.json"), SimpleFileOptions::default()).map_err(|e| invalid(e.to_string()))?;
        zip.write_all(&bytes).map_err(|e| IoError::write(dest, e))?;
    }
    let manifest = PackManifest {
        format_version: PACK_FORMAT_VERSION,
        title: title.to_owned(),
        created_by: author.to_owned(),
        created_at: now_iso(),
        app_version: app_version.to_owned(),
        entries: entries.clone(),
    };
    zip.start_file(MANIFEST_NAME, SimpleFileOptions::default()).map_err(|e| invalid(e.to_string()))?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest).map_err(|e| invalid(e.to_string()))?)
        .map_err(|e| IoError::write(dest, e))?;
    zip.finish().map_err(|e| invalid(e.to_string()))?;
    tmp.as_file().sync_all().map_err(|e| IoError::write(dest, e))?;
    crate::platform::fsx::set_shareable_mode(tmp.as_file());
    crate::platform::fsx::persist_with_retry(tmp, dest).map_err(|e| IoError::write(dest, e))?;
    Ok(entries.len())
}

struct OpenPack {
    zip: zip::ZipArchive<BufReader<File>>,
    manifest: PackManifest,
    sidecars: BTreeSet<String>,
}

fn open_pack(src: &Path) -> Result<OpenPack, LibraryError> {
    let file = File::open(src).map_err(|e| IoError::read(src, e))?;
    let mut zip =
        zip::ZipArchive::new(BufReader::new(file)).map_err(|e| invalid(format!("Kein gültiges Paket: {e}")))?;
    if zip.len() > 2 * MAX_ENTRIES + 16 {
        return Err(invalid("Das Paket enthält zu viele Einträge"));
    }
    let manifest: PackManifest = {
        let mut entry = zip.by_name(MANIFEST_NAME).map_err(|_| invalid("cypherpack.json fehlt"))?;
        if entry.size() > MAX_MANIFEST_BYTES {
            return Err(invalid("cypherpack.json ist zu groß"));
        }
        let mut buf = Vec::new();
        entry.by_ref().take(MAX_MANIFEST_BYTES).read_to_end(&mut buf).map_err(|e| invalid(e.to_string()))?;
        serde_json::from_slice(&buf).map_err(|e| invalid(format!("cypherpack.json nicht lesbar: {e}")))?
    };
    if manifest.format_version != PACK_FORMAT_VERSION {
        return Err(invalid(format!("Paketformat {} wird nicht unterstützt", manifest.format_version)));
    }
    if manifest.entries.len() > MAX_ENTRIES {
        return Err(invalid(format!("Mehr als {MAX_ENTRIES} Einträge")));
    }
    // Manifest prüfen
    let mut seen = BTreeSet::new();
    let mut total = 0u64;
    for e in &manifest.entries {
        fsx::split_rel(&e.rel_path).map_err(|err| invalid(format!("Pfad `{}` ist unsicher: {err}", e.rel_path)))?;
        if e.rel_path.replace('\\', "/").split('/').next() == Some(META_DIR) {
            return Err(invalid("Das Paket darf nichts in den Ordner .cypher schreiben"));
        }
        if !seen.insert(fsx::duplicate_key(&e.rel_path)) {
            return Err(invalid(format!("Pfad `{}` kommt doppelt vor", e.rel_path)));
        }
        if e.sha256.len() != 64 || !e.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(invalid(format!("Prüfsumme von `{}` ist ungültig", e.rel_path)));
        }
        total = total.saturating_add(e.size);
    }
    if total > MAX_TOTAL_BYTES {
        return Err(invalid("Das Paket ist entpackt größer als 4 GB"));
    }
    // ZIP prüfen: nur bekannte Einträge, Größen passen zum Manifest
    let mut sizes = std::collections::BTreeMap::new();
    let mut sidecars = BTreeSet::new();
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|e| invalid(e.to_string()))?;
        let name = entry.name().map_err(|_| invalid("Eintragsname ist kein UTF-8"))?.into_owned();
        if entry.is_dir() {
            continue;
        }
        if name == MANIFEST_NAME {
            continue;
        }
        if let Some(rel) = name.strip_prefix("files/") {
            if !seen.contains(&fsx::duplicate_key(rel)) {
                return Err(invalid(format!("`{name}` steht nicht im Manifest")));
            }
            sizes.insert(rel.to_owned(), entry.size());
        } else if let Some(rel) = name.strip_prefix("meta/").and_then(|r| r.strip_suffix(".json")) {
            if !seen.contains(&fsx::duplicate_key(rel)) {
                return Err(invalid(format!("`{name}` gehört zu keiner Datei im Manifest")));
            }
            sidecars.insert(rel.to_owned());
        } else {
            return Err(invalid(format!("Unbekannter Eintrag `{name}`")));
        }
    }
    for e in &manifest.entries {
        match sizes.get(&e.rel_path) {
            Some(s) if *s == e.size => {}
            Some(_) => return Err(invalid(format!("Größe von `{}` passt nicht zum Manifest", e.rel_path))),
            None => return Err(invalid(format!("`{}` fehlt im Paket", e.rel_path))),
        }
    }
    Ok(OpenPack { zip, manifest, sidecars })
}

fn hash_existing(path: &Path) -> Option<String> {
    crate::util::sha256_file_hex(path).ok()
}

/// Vergleicht den Paketeintrag mit der Bibliothek.
fn state_of(root: &Path, e: &PackEntry) -> PackEntryState {
    let Ok(target) = fsx::safe_join(root, &e.rel_path) else { return PackEntryState::Conflict };
    match std::fs::metadata(&target) {
        Err(_) => PackEntryState::New,
        Ok(m) if m.is_file() && m.len() == e.size && hash_existing(&target).as_deref() == Some(e.sha256.as_str()) => {
            PackEntryState::Identical
        }
        Ok(_) => PackEntryState::Conflict,
    }
}

/// Zeigt, was ein Import täte. `handle_id` setzt der Aufrufer ein.
pub fn inspect(src: &Path, root: &Path) -> Result<PackPreview, LibraryError> {
    let pack = open_pack(src)?;
    let entries: Vec<PackPreviewEntry> = pack
        .manifest
        .entries
        .iter()
        .map(|e| PackPreviewEntry {
            rel_path: e.rel_path.clone(),
            kind: classify(&extension_of(&e.rel_path)),
            size: e.size,
            state: state_of(root, e),
        })
        .collect();
    let total_bytes = entries.iter().map(|e| e.size).sum();
    Ok(PackPreview {
        handle_id: String::new(),
        format_version: pack.manifest.format_version,
        title: pack.manifest.title.clone(),
        created_by: pack.manifest.created_by.clone(),
        created_at: pack.manifest.created_at.clone(),
        app_version: pack.manifest.app_version.clone(),
        entries,
        total_bytes,
    })
}

/// Freier Name neben `target`: `name (Import).ext`, `name (Import 2).ext` …
fn keep_both_target(root: &Path, rel: &str) -> Result<(String, PathBuf), LibraryError> {
    let (dir, name) = match rel.rfind('/') {
        Some(i) => (&rel[..=i], &rel[i + 1..]),
        None => ("", rel),
    };
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 1..1000 {
        let suffix = if n == 1 { " (Import)".to_owned() } else { format!(" (Import {n})") };
        let candidate = format!("{dir}{stem}{suffix}{ext}");
        let path = fsx::safe_join(root, &candidate)?;
        if !path.exists() {
            return Ok((candidate, path));
        }
    }
    Err(invalid("Kein freier Dateiname gefunden"))
}

/// Entpackt einen Eintrag in eine Temp-Datei neben dem Ziel, prüft Größe und SHA-256.
fn extract_verified(
    pack: &mut OpenPack,
    entry: &PackEntry,
    tmp_dir: &Path,
    cancel: &CancellationToken,
) -> Result<tempfile::NamedTempFile, LibraryError> {
    std::fs::create_dir_all(tmp_dir).map_err(|e| IoError::new(crate::api::IoOp::CreateDir, tmp_dir, e))?;
    let mut tmp =
        tempfile::Builder::new().prefix("pack-").tempfile_in(tmp_dir).map_err(|e| IoError::write(tmp_dir, e))?;
    let mut zip_entry = pack
        .zip
        .by_name(&format!("files/{}", entry.rel_path))
        .map_err(|_| invalid(format!("`{}` fehlt im Paket", entry.rel_path)))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut total = 0u64;
    let mut limited = zip_entry.by_ref().take(entry.size + 1);
    loop {
        check_cancel(cancel)?;
        let n = limited.read(&mut buf).map_err(|e| invalid(e.to_string()))?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > entry.size {
            return Err(invalid(format!("`{}` ist größer als im Manifest angegeben", entry.rel_path)));
        }
        hasher.update(&buf[..n]);
        tmp.write_all(&buf[..n]).map_err(|e| IoError::write(tmp.path(), e))?;
    }
    if total != entry.size || to_hex(&hasher.finalize()) != entry.sha256 {
        return Err(invalid(format!("Prüfsumme von `{}` stimmt nicht", entry.rel_path)));
    }
    tmp.as_file().sync_all().map_err(|e| IoError::write(tmp.path(), e))?;
    Ok(tmp)
}

fn read_pack_sidecar(pack: &mut OpenPack, rel: &str) -> Option<SidecarFile> {
    if !pack.sidecars.contains(rel) {
        return None;
    }
    let mut e = pack.zip.by_name(&format!("meta/{rel}.json")).ok()?;
    if e.size() > MAX_SIDECAR_BYTES {
        return None;
    }
    let mut buf = Vec::new();
    e.by_ref().take(MAX_SIDECAR_BYTES).read_to_end(&mut buf).ok()?;
    let s: SidecarFile = serde_json::from_slice(&buf).ok()?;
    (s.format_version <= super::model::SIDECAR_FORMAT_VERSION).then_some(s)
}

/// Importiert ein Paket. Teilweise Importe bleiben bestehen (jede Datei ist für sich geprüft und vollständig).
pub fn import(
    root: &Path,
    src: &Path,
    policy: PackConflictPolicy,
    sink: &dyn ProgressSink<PackProgress>,
    cancel: &CancellationToken,
) -> Result<PackImportReport, LibraryError> {
    let mut pack = open_pack(src)?;
    let entries = pack.manifest.entries.clone();
    let total = entries.len() as u32;
    let mut report = PackImportReport { imported: 0, skipped: 0, renamed: 0, overwritten: 0 };
    let tmp_dir = root.join(META_DIR).join("tmp");
    let trash = root.join(META_DIR).join("trash").join(now_iso().replace(':', "-"));
    sink.emit(PackProgress { done: 0, total });
    for (i, entry) in entries.iter().enumerate() {
        check_cancel(cancel)?;
        let state = state_of(root, entry);
        let rel_sidecar = read_pack_sidecar(&mut pack, &entry.rel_path);
        // Zielpfad und Verhalten
        let (final_rel, action): (String, Option<PackEntryState>) = match (state, policy) {
            (PackEntryState::Identical, _) => (entry.rel_path.clone(), None),
            (PackEntryState::New, _) => (entry.rel_path.clone(), Some(PackEntryState::New)),
            (PackEntryState::Conflict, PackConflictPolicy::Skip) => (entry.rel_path.clone(), None),
            (PackEntryState::Conflict, PackConflictPolicy::KeepBoth) => {
                (keep_both_target(root, &entry.rel_path)?.0, Some(PackEntryState::New))
            }
            (PackEntryState::Conflict, PackConflictPolicy::Overwrite) => {
                (entry.rel_path.clone(), Some(PackEntryState::Conflict))
            }
        };
        match action {
            None => {
                report.skipped += 1;
                // Fehlende Begleitdatei bei identischer Datei nachtragen
                if state == PackEntryState::Identical
                    && let Some(s) = rel_sidecar
                    && read_sidecar(root, &entry.rel_path).is_none()
                {
                    write_sidecar(root, &entry.rel_path, &s)?;
                }
            }
            Some(kind) => {
                let target = fsx::safe_join(root, &final_rel)?;
                let tmp = extract_verified(&mut pack, entry, &tmp_dir, cancel)?;
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| IoError::new(crate::api::IoOp::CreateDir, parent, e))?;
                }
                if kind == PackEntryState::Conflict {
                    // Vorversion in den Papierkorb der Bibliothek legen, nicht löschen
                    let kept = fsx::safe_join(&trash, &entry.rel_path)?;
                    if let Some(p) = kept.parent() {
                        std::fs::create_dir_all(p).map_err(|e| IoError::new(crate::api::IoOp::CreateDir, p, e))?;
                    }
                    std::fs::rename(&target, &kept).map_err(|e| IoError::new(crate::api::IoOp::Rename, &target, e))?;
                    report.overwritten += 1;
                } else if final_rel != entry.rel_path {
                    report.renamed += 1;
                } else {
                    report.imported += 1;
                }
                crate::platform::fsx::set_shareable_mode(tmp.as_file());
                crate::platform::fsx::persist_with_retry(tmp, &target)
                    .map_err(|e| IoError::new(crate::api::IoOp::Rename, &target, e))?;
                if let Some(mut s) = rel_sidecar {
                    if final_rel != entry.rel_path || read_sidecar(root, &final_rel).is_some() {
                        s.id = new_id();
                    }
                    s.content_sha256 = Some(entry.sha256.clone());
                    write_sidecar(root, &final_rel, &s)?;
                }
            }
        }
        sink.emit(PackProgress { done: i as u32 + 1, total });
    }
    let _ = std::fs::remove_dir(&tmp_dir);
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::progress::{Collect, NoProgress};

    fn lib(files: &[(&str, &[u8])]) -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        for (rel, bytes) in files {
            let p = tmp.path().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, bytes).unwrap();
        }
        tmp
    }

    fn sidecar(id: &str) -> SidecarFile {
        SidecarFile {
            format_version: 1,
            id: id.into(),
            title: "Titel".into(),
            tags: vec!["a".into()],
            collection: None,
            author: "Mo".into(),
            status: crate::api::LibraryEntryStatus::Approved,
            notes: String::new(),
            colors: vec![],
            print_profile_id: None,
            garment_color_ids: vec![],
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            content_sha256: None,
        }
    }

    #[test]
    fn export_inspect_import_round_trip_with_sidecars() {
        let src = lib(&[
            ("Motive/ratte.png", b"png-bytes"),
            ("3D/modell.glb", b"glb-bytes"),
            ("Motive/notiz.txt", &b"text ".repeat(1000)),
        ]);
        write_sidecar(src.path(), "Motive/ratte.png", &sidecar("id-1")).unwrap();
        let out = tempfile::tempdir().unwrap();
        let pack = out.path().join("drop.cypherpack");
        let rels: Vec<String> = ["Motive/ratte.png", "3D/modell.glb", "Motive/notiz.txt"].map(String::from).to_vec();
        let sink = Collect::new();
        let n = export(src.path(), &rels, &pack, "Drop Oktober", "Mo", true, "0.3.0", &sink, &CancellationToken::new())
            .unwrap();
        assert_eq!(n, 3);
        let events = sink.take();
        assert_eq!(events.first(), Some(&PackProgress { done: 0, total: 3 }));
        assert_eq!(events.last(), Some(&PackProgress { done: 3, total: 3 }));

        let dst = lib(&[]);
        let preview = inspect(&pack, dst.path()).unwrap();
        assert_eq!(preview.title, "Drop Oktober");
        assert_eq!(preview.created_by, "Mo");
        assert_eq!(preview.entries.len(), 3);
        assert!(preview.entries.iter().all(|e| e.state == PackEntryState::New));
        assert_eq!(preview.total_bytes, 9 + 9 + 5000);

        let report =
            import(dst.path(), &pack, PackConflictPolicy::Skip, &NoProgress, &CancellationToken::new()).unwrap();
        assert_eq!((report.imported, report.skipped, report.renamed, report.overwritten), (3, 0, 0, 0));
        assert_eq!(std::fs::read(dst.path().join("Motive/ratte.png")).unwrap(), b"png-bytes");
        assert_eq!(read_sidecar(dst.path(), "Motive/ratte.png").unwrap().title, "Titel");
        assert!(!dst.path().join(".cypher/tmp").exists(), "Zwischenordner aufgeräumt");

        // erneut: alles identisch
        let again = inspect(&pack, dst.path()).unwrap();
        assert!(again.entries.iter().all(|e| e.state == PackEntryState::Identical));
        let r2 =
            import(dst.path(), &pack, PackConflictPolicy::Overwrite, &NoProgress, &CancellationToken::new()).unwrap();
        assert_eq!((r2.imported, r2.skipped, r2.renamed, r2.overwritten), (0, 3, 0, 0));
    }

    #[test]
    fn conflict_policies() {
        let src = lib(&[("Motive/a.png", b"neu")]);
        let out = tempfile::tempdir().unwrap();
        let pack = out.path().join("p.cypherpack");
        export(
            src.path(),
            &["Motive/a.png".to_owned()],
            &pack,
            "T",
            "x",
            false,
            "0.1.0",
            &NoProgress,
            &CancellationToken::new(),
        )
        .unwrap();

        for (policy, check) in
            [(PackConflictPolicy::Skip, 0), (PackConflictPolicy::KeepBoth, 1), (PackConflictPolicy::Overwrite, 2)]
        {
            let dst = lib(&[("Motive/a.png", b"alt")]);
            let preview = inspect(&pack, dst.path()).unwrap();
            assert_eq!(preview.entries[0].state, PackEntryState::Conflict);
            let r = import(dst.path(), &pack, policy, &NoProgress, &CancellationToken::new()).unwrap();
            match check {
                0 => {
                    assert_eq!(r.skipped, 1);
                    assert_eq!(std::fs::read(dst.path().join("Motive/a.png")).unwrap(), b"alt");
                }
                1 => {
                    assert_eq!(r.renamed, 1);
                    assert_eq!(std::fs::read(dst.path().join("Motive/a.png")).unwrap(), b"alt");
                    assert_eq!(std::fs::read(dst.path().join("Motive/a (Import).png")).unwrap(), b"neu");
                }
                _ => {
                    assert_eq!(r.overwritten, 1);
                    assert_eq!(std::fs::read(dst.path().join("Motive/a.png")).unwrap(), b"neu");
                    // die Vorversion liegt im Papierkorb der Bibliothek
                    let trash: Vec<_> = walkdir::WalkDir::new(dst.path().join(".cypher/trash"))
                        .into_iter()
                        .filter_map(Result::ok)
                        .filter(|e| e.file_type().is_file())
                        .collect();
                    assert_eq!(trash.len(), 1);
                    assert_eq!(std::fs::read(trash[0].path()).unwrap(), b"alt");
                }
            }
        }
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let mut zw = zip::ZipWriter::new(File::create(path).unwrap());
        for (name, bytes) in entries {
            zw.start_file(*name, SimpleFileOptions::default()).unwrap();
            zw.write_all(bytes).unwrap();
        }
        zw.finish().unwrap();
    }

    fn manifest(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let e: Vec<PackEntry> = entries
            .iter()
            .map(|(rel, b)| PackEntry {
                rel_path: (*rel).into(),
                size: b.len() as u64,
                sha256: to_hex(&Sha256::digest(b)),
                kind: "other".into(),
            })
            .collect();
        serde_json::to_vec(&PackManifest {
            format_version: 1,
            title: "T".into(),
            created_by: "x".into(),
            created_at: "a".into(),
            app_version: "0".into(),
            entries: e,
        })
        .unwrap()
    }

    #[test]
    fn hostile_packs_are_rejected_before_anything_is_written() {
        let tmp = tempfile::tempdir().unwrap();
        let dst = lib(&[]);
        let ok_file: &[u8] = b"inhalt";
        type Case = (&'static str, Vec<(String, Vec<u8>)>);
        let cases: Vec<Case> = vec![
            (
                "Zip-Slip im Manifest",
                vec![
                    ("cypherpack.json".into(), manifest(&[("../draussen.txt", ok_file)])),
                    ("files/../draussen.txt".into(), ok_file.to_vec()),
                ],
            ),
            (
                "absoluter Pfad",
                vec![
                    ("cypherpack.json".into(), manifest(&[("/etc/passwd", ok_file)])),
                    ("files//etc/passwd".into(), ok_file.to_vec()),
                ],
            ),
            (
                ".cypher",
                vec![
                    ("cypherpack.json".into(), manifest(&[(".cypher/library.json", ok_file)])),
                    ("files/.cypher/library.json".into(), ok_file.to_vec()),
                ],
            ),
            (
                "unbekannter Eintrag",
                vec![
                    ("cypherpack.json".into(), manifest(&[("a.txt", ok_file)])),
                    ("files/a.txt".into(), ok_file.to_vec()),
                    ("files/b.txt".into(), b"x".to_vec()),
                ],
            ),
            (
                "fremder Eintrag",
                vec![
                    ("cypherpack.json".into(), manifest(&[("a.txt", ok_file)])),
                    ("files/a.txt".into(), ok_file.to_vec()),
                    ("irgendwas.sh".into(), b"x".to_vec()),
                ],
            ),
            ("Datei fehlt", vec![("cypherpack.json".into(), manifest(&[("a.txt", ok_file)]))]),
            (
                "falsche Größe",
                vec![
                    ("cypherpack.json".into(), manifest(&[("a.txt", ok_file)])),
                    ("files/a.txt".into(), b"viel zu lang fuer das Manifest".to_vec()),
                ],
            ),
            (
                "doppelt",
                vec![
                    ("cypherpack.json".into(), {
                        let mut m: PackManifest = serde_json::from_slice(&manifest(&[("a.txt", ok_file)])).unwrap();
                        m.entries.push(PackEntry { rel_path: "A.TXT".into(), ..m.entries[0].clone() });
                        serde_json::to_vec(&m).unwrap()
                    }),
                    ("files/a.txt".into(), ok_file.to_vec()),
                ],
            ),
            ("kein Manifest", vec![("files/a.txt".into(), ok_file.to_vec())]),
            ("Manifest kaputt", vec![("cypherpack.json".into(), b"{ nein".to_vec())]),
        ];
        for (name, entries) in cases {
            let pack = tmp.path().join("hostile.cypherpack");
            let refs: Vec<(&str, &[u8])> = entries.iter().map(|(n, b)| (n.as_str(), b.as_slice())).collect();
            write_zip(&pack, &refs);
            let r = import(dst.path(), &pack, PackConflictPolicy::Overwrite, &NoProgress, &CancellationToken::new());
            assert!(matches!(r, Err(LibraryError::PackInvalid(_)) | Err(LibraryError::Path(_))), "{name}: {r:?}");
        }
        assert!(
            walkdir::WalkDir::new(dst.path()).into_iter().filter_map(Result::ok).all(|e| !e.file_type().is_file()),
            "nichts geschrieben"
        );
        assert!(!tmp.path().join("draussen.txt").exists());
        // kein ZIP
        let junk = tmp.path().join("junk.cypherpack");
        std::fs::write(&junk, b"das ist kein zip").unwrap();
        assert!(matches!(inspect(&junk, dst.path()), Err(LibraryError::PackInvalid(_))));
    }

    #[test]
    fn manipulated_content_fails_the_checksum_and_leaves_no_partial_file() {
        let tmp = tempfile::tempdir().unwrap();
        let dst = lib(&[]);
        let good: &[u8] = b"originalinhalt";
        let mut m: PackManifest = serde_json::from_slice(&manifest(&[("a.txt", good)])).unwrap();
        m.entries[0].sha256 = to_hex(&Sha256::digest(b"etwas anderes!"));
        let pack = tmp.path().join("p.cypherpack");
        write_zip(&pack, &[("cypherpack.json", &serde_json::to_vec(&m).unwrap()), ("files/a.txt", good)]);
        let r = import(dst.path(), &pack, PackConflictPolicy::Skip, &NoProgress, &CancellationToken::new());
        assert!(matches!(r, Err(LibraryError::PackInvalid(ref m)) if m.contains("Prüfsumme")), "{r:?}");
        assert!(!dst.path().join("a.txt").exists());
    }

    #[test]
    fn cancel_stops_the_import() {
        let src = lib(&[("a.txt", b"1"), ("b.txt", b"2")]);
        let out = tempfile::tempdir().unwrap();
        let pack = out.path().join("p.cypherpack");
        export(
            src.path(),
            &["a.txt".to_owned(), "b.txt".to_owned()],
            &pack,
            "T",
            "x",
            false,
            "0.1.0",
            &NoProgress,
            &CancellationToken::new(),
        )
        .unwrap();
        let dst = lib(&[]);
        let token = CancellationToken::new();
        token.cancel();
        let r = import(dst.path(), &pack, PackConflictPolicy::Skip, &NoProgress, &token);
        assert!(matches!(r, Err(LibraryError::Cancelled)));
        assert!(!dst.path().join("a.txt").exists());
    }

    #[test]
    fn export_rejects_empty_selection_and_unsafe_paths() {
        let src = lib(&[("a.txt", b"1")]);
        let out = tempfile::tempdir().unwrap();
        let pack = out.path().join("p.cypherpack");
        assert!(
            export(src.path(), &[], &pack, "T", "x", false, "0.1.0", &NoProgress, &CancellationToken::new()).is_err()
        );
        assert!(
            export(
                src.path(),
                &["../x.txt".to_owned()],
                &pack,
                "T",
                "x",
                false,
                "0.1.0",
                &NoProgress,
                &CancellationToken::new()
            )
            .is_err()
        );
        assert!(!pack.exists());
        assert!(std::fs::read_dir(out.path()).unwrap().next().is_none(), "keine halbe Temp-Datei");
    }
}
