//! `library` – gemeinsamer Ordner (ARCHITEKTUR.md 2.12, 4.6): Index, Begleitdateien, Vorschaubilder, Überwachung,
//! Austauschpakete. Ein normaler Ordner ohne Konten; geteilt wird er von einem Sync-Werkzeug nach Wahl.
//!
//! Index und Vorschaubilder liegen im lokalen Cache (nicht im geteilten Ordner), damit es keine Sync-Konflikte gibt.
//! Geteilt werden nur die Dateien und die Begleitdateien unter `.cypher/meta/<relPath>.json` – eine je Datei, damit zwei
//! Personen gleichzeitig verschiedene Dateien beschreiben können.

pub mod exchange;
pub mod model;
pub mod root;
pub mod scan;
pub mod thumbs;
pub mod watch;

use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

use crate::api::{
    Collection, ImportMeta, LibraryEntry, LibraryEntryStatus, LibraryFacets, LibraryKind, LibraryPage, LibraryQuery,
    LibrarySort, LibraryStatus, MetaPatch, Patch, SidecarMeta, SyncTool,
};
use crate::error::{IoError, LibraryError};
use crate::platform::{display_path, fsx};
use crate::progress::ProgressSink;
use crate::util::{now_iso, parse_iso, short_hash};

pub use model::{IndexEntry, SidecarFile};
pub use root::{LibraryFile, init, inspect_root, validate_root};
pub use scan::{ScanProgress, ScanResult};
pub use thumbs::ThumbConfig;
pub use watch::WatchHandle;

use model::{LIBRARY_FORMAT_VERSION, classify, default_meta, extension_of};
use scan::{content_hash, scan_tree, sidecar_path, write_sidecar};

const DEFAULT_PAGE: u32 = 100;
const MAX_PAGE: u32 = 500;
const INDEX_FORMAT: u32 = 1;

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexFile {
    format: u32,
    root: String,
    last_scan_at: Option<String>,
    project_count: u32,
    entries: Vec<IndexEntry>,
}

pub struct Library {
    root: PathBuf,
    index_path: PathBuf,
    thumbs_dir: PathBuf,
    thumb_config: ThumbConfig,
    file: Option<LibraryFile>,
    entries: BTreeMap<String, IndexEntry>,
    by_path: BTreeMap<String, String>,
    search: HashMap<String, String>,
    project_count: u32,
    total_bytes: u64,
    last_scan_at: Option<String>,
    sync_tool: Option<SyncTool>,
    watching: bool,
}

fn invalid(field: &str, reason: impl Into<String>) -> LibraryError {
    LibraryError::InvalidInput { field: field.to_owned(), reason: reason.into() }
}

fn search_text(e: &IndexEntry) -> String {
    format!("{} {} {} {} {}", e.meta.title, e.file_name(), e.meta.tags.join(" "), e.meta.notes, e.rel_path)
        .to_lowercase()
}

/// Etiketten bereinigen: gekürzt, ohne Doppelte (ohne Rücksicht auf Groß-/Kleinschreibung), höchstens 50.
fn normalize_tags(tags: &[String]) -> Result<Vec<String>, LibraryError> {
    let mut out: Vec<String> = Vec::new();
    for t in tags {
        let t = t.trim();
        if t.is_empty() {
            continue;
        }
        if t.chars().count() > 40 {
            return Err(invalid("tags", format!("Stichwort `{t}` ist länger als 40 Zeichen")));
        }
        if !out.iter().any(|o| o.eq_ignore_ascii_case(t) || o.to_lowercase() == t.to_lowercase()) {
            out.push(t.to_owned());
        }
    }
    if out.len() > 50 {
        return Err(invalid("tags", "Höchstens 50 Stichworte je Datei"));
    }
    Ok(out)
}

fn is_hex_color(s: &str) -> bool {
    s.strip_prefix('#').is_some_and(|h| (h.len() == 6 || h.len() == 3) && h.chars().all(|c| c.is_ascii_hexdigit()))
}

impl Library {
    /// Öffnet die Bibliothek und lädt den zwischengespeicherten Index (falls vorhanden).
    pub fn open(root: &Path, cache_dir: &Path, thumbs_dir: &Path) -> Result<Self, LibraryError> {
        if !root.is_dir() {
            return Err(LibraryError::RootInvalid(crate::api::LibraryRootInvalidReason::NotADirectory));
        }
        let file = root::read_library_file(root)?;
        let index_path = cache_dir.join(format!("{}.json", short_hash(&root.to_string_lossy())));
        let mut lib = Library {
            root: root.to_path_buf(),
            index_path,
            thumbs_dir: thumbs_dir.to_path_buf(),
            thumb_config: ThumbConfig::default(),
            file,
            entries: BTreeMap::new(),
            by_path: BTreeMap::new(),
            search: HashMap::new(),
            project_count: 0,
            total_bytes: 0,
            last_scan_at: None,
            sync_tool: model::detect_sync_tool(root),
            watching: false,
        };
        if let Ok(Some(cached)) = fsx::read_json::<IndexFile>(&lib.index_path)
            && cached.format == INDEX_FORMAT
            && cached.root == root.to_string_lossy()
        {
            lib.project_count = cached.project_count;
            lib.last_scan_at = cached.last_scan_at;
            lib.set_entries(cached.entries);
        }
        Ok(lib)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn is_initialized(&self) -> bool {
        self.file.is_some()
    }

    pub fn set_thumb_config(&mut self, config: ThumbConfig) {
        self.thumb_config = config;
    }

    pub fn set_watching(&mut self, watching: bool) {
        self.watching = watching;
    }

    pub fn collections(&self) -> Vec<Collection> {
        self.file.as_ref().map(|f| f.collections.clone()).unwrap_or_default()
    }

    fn set_entries(&mut self, entries: Vec<IndexEntry>) {
        self.entries.clear();
        self.by_path.clear();
        self.search.clear();
        self.total_bytes = 0;
        for e in entries {
            self.total_bytes += e.size;
            self.by_path.insert(e.rel_path.clone(), e.id.clone());
            self.search.insert(e.id.clone(), search_text(&e));
            self.entries.insert(e.id.clone(), e);
        }
    }

    fn put(&mut self, e: IndexEntry) {
        if let Some(old) = self.entries.get(&e.id) {
            self.total_bytes = self.total_bytes.saturating_sub(old.size);
            self.by_path.remove(&old.rel_path);
        }
        self.total_bytes += e.size;
        self.by_path.insert(e.rel_path.clone(), e.id.clone());
        self.search.insert(e.id.clone(), search_text(&e));
        self.entries.insert(e.id.clone(), e);
    }

    /// Schreibt den Index in den lokalen Cache (Fehler sind nicht schlimm: der nächste Scan baut ihn neu).
    pub fn save_index(&self) {
        let file = IndexFile {
            format: INDEX_FORMAT,
            root: self.root.to_string_lossy().into_owned(),
            last_scan_at: self.last_scan_at.clone(),
            project_count: self.project_count,
            entries: self.entries.values().cloned().collect(),
        };
        if let Err(e) = fsx::write_json_atomic(&self.index_path, &file) {
            tracing::warn!("Bibliotheksindex nicht gespeichert: {e}");
        }
    }

    // --- Scan --------------------------------------------------------------------------------------

    /// Alter Index nach `relPath`, für [`scan_tree`] außerhalb der Sperre.
    pub fn snapshot(&self) -> BTreeMap<String, IndexEntry> {
        self.entries.values().map(|e| (e.rel_path.clone(), e.clone())).collect()
    }

    /// Setzt ein Scan-Ergebnis ein.
    pub fn apply_scan(&mut self, result: ScanResult) -> LibraryStatus {
        self.project_count = result.project_count;
        self.last_scan_at = Some(result.scanned_at);
        self.file = root::read_library_file(&self.root).ok().flatten();
        self.sync_tool = model::detect_sync_tool(&self.root);
        self.set_entries(result.entries);
        self.save_index();
        self.status()
    }

    /// Liest den Ordner ein und setzt das Ergebnis ein (blockierend; die App ruft stattdessen `snapshot`/`scan_tree`/`apply_scan`).
    pub fn scan(
        &mut self,
        sink: &dyn ProgressSink<ScanProgress>,
        cancel: &CancellationToken,
    ) -> Result<LibraryStatus, LibraryError> {
        let result = scan_tree(&self.root, &self.snapshot(), sink, cancel)?;
        Ok(self.apply_scan(result))
    }

    pub fn status(&self) -> LibraryStatus {
        LibraryStatus {
            configured: true,
            root: Some(display_path(&self.root)),
            initialized: self.file.is_some(),
            format_version: self.file.as_ref().map(|f| f.format_version),
            entry_count: self.entries.len() as u32,
            total_bytes: self.total_bytes,
            project_count: self.project_count,
            conflict_count: self.entries.values().filter(|e| e.conflict.is_some()).count() as u32,
            last_scan_at: self.last_scan_at.clone(),
            sync_tool: self.sync_tool,
            watching: self.watching,
            collections: self.collections(),
        }
    }

    /// Status einer nicht eingerichteten Bibliothek.
    pub fn unconfigured_status() -> LibraryStatus {
        LibraryStatus {
            configured: false,
            root: None,
            initialized: false,
            format_version: None,
            entry_count: 0,
            total_bytes: 0,
            project_count: 0,
            conflict_count: 0,
            last_scan_at: None,
            sync_tool: None,
            watching: false,
            collections: vec![],
        }
    }

    // --- Abfragen ----------------------------------------------------------------------------------

    pub fn query(&self, q: &LibraryQuery) -> LibraryPage {
        let terms: Vec<String> =
            q.text.as_deref().unwrap_or("").to_lowercase().split_whitespace().map(str::to_owned).collect();
        let tags: Vec<String> = q.tags.iter().flatten().map(|t| t.to_lowercase()).collect();
        let after_ms =
            q.modified_after.as_deref().and_then(parse_iso).map(|t| (t.unix_timestamp_nanos() / 1_000_000) as i64);
        let mut hits: Vec<&IndexEntry> = self
            .entries
            .values()
            .filter(|e| {
                if let Some(kinds) = &q.kinds
                    && !kinds.is_empty()
                    && !kinds.contains(&e.kind)
                {
                    return false;
                }
                if let Some(cols) = &q.collections
                    && !cols.is_empty()
                    && !e.meta.collection.as_ref().is_some_and(|c| cols.contains(c))
                {
                    return false;
                }
                if !tags.is_empty() && !tags.iter().all(|t| e.meta.tags.iter().any(|x| x.to_lowercase() == *t)) {
                    return false;
                }
                if let Some(status) = &q.status
                    && !status.is_empty()
                    && !status.contains(&e.meta.status)
                {
                    return false;
                }
                if let Some(pid) = &q.project_id
                    && e.project_id.as_ref() != Some(pid)
                {
                    return false;
                }
                if let Some(ms) = after_ms
                    && e.modified_ms <= ms
                {
                    return false;
                }
                if q.only_conflicts == Some(true) && e.conflict.is_none() {
                    return false;
                }
                if !terms.is_empty() {
                    let hay = self.search.get(&e.id).map_or("", String::as_str);
                    if !terms.iter().all(|t| hay.contains(t.as_str())) {
                        return false;
                    }
                }
                true
            })
            .collect();

        let mut facets = LibraryFacets { kinds: BTreeMap::new(), collections: BTreeMap::new(), tags: BTreeMap::new() };
        for e in &hits {
            *facets.kinds.entry(e.kind).or_insert(0) += 1;
            if let Some(c) = &e.meta.collection {
                *facets.collections.entry(c.clone()).or_insert(0) += 1;
            }
            for t in &e.meta.tags {
                *facets.tags.entry(t.clone()).or_insert(0) += 1;
            }
        }

        match q.sort.unwrap_or(LibrarySort::ModifiedDesc) {
            LibrarySort::ModifiedDesc => {
                hits.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then_with(|| a.rel_path.cmp(&b.rel_path)))
            }
            LibrarySort::NameAsc => hits.sort_by(|a, b| {
                a.file_name()
                    .to_lowercase()
                    .cmp(&b.file_name().to_lowercase())
                    .then_with(|| a.rel_path.cmp(&b.rel_path))
            }),
            LibrarySort::Kind => hits.sort_by(|a, b| {
                a.kind.cmp(&b.kind).then_with(|| a.file_name().to_lowercase().cmp(&b.file_name().to_lowercase()))
            }),
            LibrarySort::SizeDesc => hits.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.rel_path.cmp(&b.rel_path))),
        }
        let total = hits.len() as u32;
        let offset = q.offset.unwrap_or(0).min(total);
        let limit = q.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
        let entries = hits.into_iter().skip(offset as usize).take(limit as usize).map(IndexEntry::to_dto).collect();
        LibraryPage { entries, total, offset, facets }
    }

    pub fn get(&self, id: &str) -> Result<&IndexEntry, LibraryError> {
        self.entries.get(id).ok_or_else(|| LibraryError::NotFound(id.to_owned()))
    }

    pub fn get_dto(&self, id: &str) -> Result<LibraryEntry, LibraryError> {
        self.get(id).map(IndexEntry::to_dto)
    }

    pub fn path_of(&self, id: &str) -> Result<PathBuf, LibraryError> {
        let e = self.get(id)?;
        let path = fsx::safe_join(&self.root, &e.rel_path)?;
        if !path.is_file() {
            return Err(LibraryError::NotFound(id.to_owned()));
        }
        Ok(path)
    }

    /// Eintrag zu einem Pfad relativ zur Wurzel.
    pub fn id_of_path(&self, rel: &str) -> Option<&str> {
        self.by_path.get(rel).map(String::as_str)
    }

    pub fn entries_by_ids(&self, ids: &[String]) -> Result<Vec<&IndexEntry>, LibraryError> {
        ids.iter().map(|id| self.get(id)).collect()
    }

    // --- Metadaten ---------------------------------------------------------------------------------

    fn apply_patch(&self, meta: &mut SidecarMeta, patch: &MetaPatch) -> Result<(), LibraryError> {
        if let Some(title) = &patch.title {
            let t = title.trim();
            if t.is_empty() || t.chars().count() > 200 {
                return Err(invalid("title", "Der Titel darf nicht leer und höchstens 200 Zeichen lang sein"));
            }
            meta.title = t.to_owned();
        }
        if let Some(tags) = &patch.tags {
            meta.tags = normalize_tags(tags)?;
        }
        match &patch.collection {
            Patch::Absent => {}
            Patch::Null => meta.collection = None,
            Patch::Value(c) => {
                if !self.collections().iter().any(|x| &x.id == c) {
                    return Err(invalid("collection", format!("Kollektion `{c}` gibt es nicht")));
                }
                meta.collection = Some(c.clone());
            }
        }
        if let Some(author) = &patch.author {
            if author.chars().count() > 80 {
                return Err(invalid("author", "Höchstens 80 Zeichen"));
            }
            meta.author = author.trim().to_owned();
        }
        if let Some(status) = patch.status {
            meta.status = status;
        }
        if let Some(notes) = &patch.notes {
            if notes.chars().count() > 5000 {
                return Err(invalid("notes", "Höchstens 5000 Zeichen"));
            }
            meta.notes = notes.clone();
        }
        if let Some(colors) = &patch.colors {
            if colors.len() > 20 || !colors.iter().all(|c| is_hex_color(c)) {
                return Err(invalid("colors", "Höchstens 20 Farben im Format #rrggbb"));
            }
            meta.colors = colors.iter().map(|c| c.to_lowercase()).collect();
        }
        match &patch.print_profile_id {
            Patch::Absent => {}
            Patch::Null => meta.print_profile_id = None,
            Patch::Value(p) => meta.print_profile_id = Some(p.clone()),
        }
        if let Some(g) = &patch.garment_color_ids {
            if g.len() > 20 {
                return Err(invalid("garmentColorIds", "Höchstens 20 Textilfarben"));
            }
            meta.garment_color_ids = g.clone();
        }
        Ok(())
    }

    /// Schreibt die Begleitdatei für einen Eintrag und aktualisiert den Index.
    fn persist_meta(&mut self, id: &str, meta: SidecarMeta) -> Result<(), LibraryError> {
        let entry = self.get(id)?.clone();
        let path = fsx::safe_join(&self.root, &entry.rel_path)?;
        let content_sha256 = if entry.sidecar_missing && entry.size <= 256 * 1024 * 1024 {
            content_hash(&path)
        } else {
            entry.content_sha256.clone()
        };
        let sidecar = SidecarFile::from_meta(&entry.id, &meta, content_sha256.clone());
        write_sidecar(&self.root, &entry.rel_path, &sidecar)?;
        let mut updated = entry;
        updated.meta = meta;
        updated.sidecar_missing = false;
        updated.content_sha256 = content_sha256;
        self.put(updated);
        Ok(())
    }

    pub fn update_meta(&mut self, id: &str, patch: &MetaPatch) -> Result<LibraryEntry, LibraryError> {
        let mut meta = self.get(id)?.meta.clone();
        self.apply_patch(&mut meta, patch)?;
        meta.updated_at = now_iso();
        self.persist_meta(id, meta)?;
        self.get_dto(id)
    }

    /// Stichworte hinzufügen/entfernen und Kollektion setzen für mehrere Dateien. Gibt die Zahl geänderter Einträge zurück.
    pub fn bulk_meta(
        &mut self,
        ids: &[String],
        add_tags: &[String],
        remove_tags: &[String],
        collection: &Patch<String>,
    ) -> Result<usize, LibraryError> {
        if ids.len() > 5000 {
            return Err(invalid("entryIds", "Höchstens 5000 Dateien auf einmal"));
        }
        let mut changed = 0;
        for id in ids {
            let mut meta = self.get(id)?.meta.clone();
            let before = meta.clone();
            let mut tags = meta.tags.clone();
            tags.retain(|t| !remove_tags.iter().any(|r| r.trim().to_lowercase() == t.to_lowercase()));
            tags.extend(add_tags.iter().cloned());
            meta.tags = normalize_tags(&tags)?;
            let patch = MetaPatch { collection: collection.clone(), ..empty_patch() };
            self.apply_patch(&mut meta, &patch)?;
            if meta != before {
                meta.updated_at = now_iso();
                self.persist_meta(id, meta)?;
                changed += 1;
            }
        }
        Ok(changed)
    }

    pub fn set_collections(&mut self, collections: &[Collection]) -> Result<LibraryStatus, LibraryError> {
        root::validate_collections(collections)?;
        let mut file = match &self.file {
            Some(f) => f.clone(),
            None => LibraryFile {
                format_version: LIBRARY_FORMAT_VERSION,
                name: root::library_name_of(&self.root),
                collections: vec![],
                created_at: now_iso(),
            },
        };
        file.collections = collections.to_vec();
        fsx::write_json_atomic(&root::library_file_path(&self.root), &file)?;
        self.file = Some(file);
        Ok(self.status())
    }

    // --- Import ------------------------------------------------------------------------------------

    fn default_folder(kind: LibraryKind) -> &'static str {
        match kind {
            LibraryKind::Model3d => "3D",
            LibraryKind::Font => "Schriften",
            LibraryKind::Palette => "Paletten",
            _ => "Motive",
        }
    }

    /// Kopiert Dateien in die Bibliothek und legt Begleitdateien an. `sub` = Unterordner (relativ), sonst je nach Art.
    pub fn import(
        &mut self,
        files: &[PathBuf],
        sub: Option<&str>,
        meta: &ImportMeta,
        default_author: &str,
    ) -> Result<Vec<LibraryEntry>, LibraryError> {
        if let Some(c) = &meta.collection
            && !self.collections().iter().any(|x| &x.id == c)
        {
            return Err(invalid("meta.collection", format!("Kollektion `{c}` gibt es nicht")));
        }
        let tags = normalize_tags(meta.tags.as_deref().unwrap_or(&[]))?;
        let mut out = Vec::new();
        for src in files {
            let name = src
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .ok_or_else(|| invalid("handleIds", "Datei ohne Namen"))?;
            let name = fsx::sanitize_file_name(&name);
            let ext = extension_of(&name);
            let kind = classify(&ext);
            let folder = match sub {
                Some(s) if !s.trim().is_empty() => s.trim().trim_matches('/').to_owned(),
                _ => Self::default_folder(kind).to_owned(),
            };
            // `.cypher` ist tabu
            if folder.replace('\\', "/").split('/').next() == Some(model::META_DIR) {
                return Err(invalid("subfolder", "In den Ordner .cypher kann nicht importiert werden"));
            }
            let dir = fsx::safe_join(&self.root, &folder)?;
            std::fs::create_dir_all(&dir).map_err(|e| IoError::new(crate::api::IoOp::CreateDir, &dir, e))?;
            let (stem, dot_ext) = match name.rfind('.') {
                Some(i) if i > 0 => (name[..i].to_owned(), name[i..].to_owned()),
                _ => (name.clone(), String::new()),
            };
            let mut n = 1;
            let (rel, target, sha) = loop {
                let candidate = if n == 1 { format!("{stem}{dot_ext}") } else { format!("{stem}-{n}{dot_ext}") };
                let rel = format!("{folder}/{candidate}");
                let target = fsx::safe_join(&self.root, &rel)?;
                match copy_new(src, &target) {
                    Ok(sha) => break (rel, target, sha),
                    Err(CopyError::Exists) => {
                        n += 1;
                        if n > 1000 {
                            return Err(invalid("handleIds", "Zu viele gleichnamige Dateien"));
                        }
                    }
                    Err(CopyError::Io(e)) => return Err(e.into()),
                }
            };
            let md = std::fs::metadata(&target).map_err(|e| IoError::read(&target, e))?;
            let modified_ms = md.modified().map(model::ms_of).unwrap_or(0);
            let now = now_iso();
            let mut m = default_meta(&rel, &now);
            m.tags = tags.clone();
            m.author = meta.author.clone().unwrap_or_else(|| default_author.to_owned());
            m.collection = meta.collection.clone();
            m.status = meta.status.unwrap_or(LibraryEntryStatus::Draft);
            let id = new_entry_id();
            write_sidecar(&self.root, &rel, &SidecarFile::from_meta(&id, &m, Some(sha.clone())))?;
            let (width_px, height_px) =
                if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "tif" | "tiff" | "gif" | "bmp") {
                    match image::ImageReader::open(&target)
                        .and_then(|r| r.with_guessed_format())
                        .map(image::ImageReader::into_dimensions)
                    {
                        Ok(Ok((w, h))) => (Some(w), Some(h)),
                        _ => (None, None),
                    }
                } else {
                    (None, None)
                };
            let entry = IndexEntry {
                id: id.clone(),
                kind,
                conflict: model::conflict_of(&rel),
                project_id: None,
                rel_path: rel,
                size: md.len(),
                modified_ms,
                width_px,
                height_px,
                meta: m,
                sidecar_missing: false,
                content_sha256: Some(sha),
            };
            self.put(entry);
            out.push(self.get_dto(&id)?);
        }
        self.save_index();
        Ok(out)
    }

    // --- Vorschaubilder ----------------------------------------------------------------------------

    pub fn thumbnail(&self, id: &str) -> Result<PathBuf, LibraryError> {
        let e = self.get(id)?;
        let source = fsx::safe_join(&self.root, &e.rel_path)?;
        thumbs::ensure(&self.thumbs_dir, &source, &e.rel_path, e.size, e.modified_ms, &self.thumb_config)
    }

    pub fn clear_thumbnails(&self) -> Result<(), LibraryError> {
        match std::fs::remove_dir_all(&self.thumbs_dir) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(IoError::new(crate::api::IoOp::Remove, &self.thumbs_dir, e).into()),
        }
    }

    // --- Überwachung -------------------------------------------------------------------------------

    pub fn watch(&self, on_change: impl Fn(usize) + Send + 'static) -> Result<WatchHandle, LibraryError> {
        watch::watch(self.root.clone(), on_change)
    }

    /// Pfad der Begleitdatei (für Tests und die Diagnose).
    pub fn sidecar_path_of(&self, rel: &str) -> PathBuf {
        sidecar_path(&self.root, rel)
    }
}

fn empty_patch() -> MetaPatch {
    MetaPatch {
        title: None,
        tags: None,
        collection: Patch::Absent,
        author: None,
        status: None,
        notes: None,
        colors: None,
        print_profile_id: Patch::Absent,
        garment_color_ids: None,
    }
}

fn new_entry_id() -> String {
    crate::util::new_id()
}

enum CopyError {
    Exists,
    Io(IoError),
}

/// Kopiert `src` nach `target`, ohne vorhandene Dateien zu überschreiben; gibt die SHA-256 zurück.
fn copy_new(src: &Path, target: &Path) -> Result<String, CopyError> {
    use std::io::Write as _;
    let mut input = std::fs::File::open(src).map_err(|e| CopyError::Io(IoError::read(src, e)))?;
    let tmp_dir = target.parent().unwrap_or(Path::new("."));
    let mut tmp = tempfile::Builder::new()
        .prefix(".cypher-import-")
        .tempfile_in(tmp_dir)
        .map_err(|e| CopyError::Io(IoError::write(target, e)))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = input.read(&mut buf).map_err(|e| CopyError::Io(IoError::read(src, e)))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        tmp.write_all(&buf[..n]).map_err(|e| CopyError::Io(IoError::write(target, e)))?;
    }
    tmp.as_file().sync_all().map_err(|e| CopyError::Io(IoError::write(target, e)))?;
    crate::platform::fsx::set_shareable_mode(tmp.as_file());
    // `persist_noclobber` überschreibt nie, auch nicht bei einem Wettlauf mit einem Sync-Werkzeug
    match tmp.persist_noclobber(target) {
        Ok(_) => Ok(hasher.finalize().iter().fold(String::new(), |mut s, b| {
            use std::fmt::Write as _;
            let _ = write!(s, "{b:02x}");
            s
        })),
        Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => Err(CopyError::Exists),
        Err(e) => Err(CopyError::Io(IoError::new(crate::api::IoOp::Rename, target, e.error))),
    }
}
