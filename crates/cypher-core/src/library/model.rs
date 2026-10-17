//! Bibliothek: Dateiarten, Begleitdateien, Indexeintrag, Konfliktkopien der Sync-Werkzeuge.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::api::{LibraryConflict, LibraryEntry, LibraryEntryStatus, LibraryKind, SidecarMeta, SyncTool};
use crate::urls;
use crate::util::{short_hash, to_iso};

pub const SIDECAR_FORMAT_VERSION: u32 = 1;
pub const LIBRARY_FORMAT_VERSION: u32 = 1;
/// Ordner der Bibliothek, den nur die App verwaltet.
pub const META_DIR: &str = ".cypher";

/// Dateiart nach Endung (klein geschrieben, ohne Punkt).
pub fn classify(ext: &str) -> LibraryKind {
    match ext {
        "png" | "jpg" | "jpeg" | "webp" | "tif" | "tiff" | "gif" | "bmp" | "avif" | "kra" | "ora" | "psd" | "xcf" => {
            LibraryKind::Image
        }
        "svg" => LibraryKind::Vector,
        "blend" | "glb" | "gltf" | "obj" | "fbx" | "stl" | "usd" | "usdz" => LibraryKind::Model3d,
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "kdenlive" => LibraryKind::Video,
        "mp3" | "wav" | "ogg" | "flac" | "m4a" | "opus" => LibraryKind::Audio,
        "ttf" | "otf" | "woff" | "woff2" => LibraryKind::Font,
        "kpl" | "gpl" | "aco" | "ase" | "soc" => LibraryKind::Palette,
        "pdf" | "txt" | "md" | "json" | "docx" | "odt" | "csv" => LibraryKind::Document,
        _ => LibraryKind::Other,
    }
}

pub fn mime_of(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "tif" | "tiff" => "image/tiff",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "kra" => "application/x-krita",
        "ora" => "image/openraster",
        "psd" => "image/vnd.adobe.photoshop",
        "xcf" => "image/x-xcf",
        "blend" => "application/x-blender",
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        "obj" => "model/obj",
        "stl" => "model/stl",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "kdenlive" => "application/x-kdenlive",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "pdf" => "application/pdf",
        "txt" | "md" | "csv" => "text/plain",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

/// Dateiendung klein und ohne Punkt; Doppelendungen wie `.social.json` zählen als `json`.
pub fn extension_of(rel: &str) -> String {
    Path::new(rel).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// Endungen, die ein Austauschpaket in die Bibliothek bringen darf (Positivliste, klein geschrieben, ohne Punkt): Bilder,
/// Vektoren, Arbeitsdateien der Programme (Krita, Blender, Kdenlive, Inkscape), 3D-Modelle samt Zubehör, Medien,
/// Schriften, Paletten, Dokumente und Text. Alles andere (Programme, Skripte, Verknüpfungen, Dateien ohne Endung)
/// lehnt der Import ab. Gegen Skripte in `.blend` hilft zusätzlich der Start mit `--disable-autoexec`.
pub const PACK_ALLOWED_EXTENSIONS: &[&str] = &[
    // Bilder
    "png", "jpg", "jpeg", "webp", "tif", "tiff", "gif", "bmp", "avif", "heic", "heif", "jxl", "ico", "tga", "exr",
    "hdr", "kra", "ora", "psd", "xcf", // Vektor
    "svg", // 3D samt Zubehör (`.bin` und `.mtl` gehören zu glTF und OBJ)
    "blend", "glb", "gltf", "bin", "obj", "mtl", "fbx", "stl", "usd", "usdz", // Video, Audio, Untertitel
    "mp4", "mov", "mkv", "webm", "avi", "kdenlive", "mp3", "wav", "ogg", "flac", "m4a", "opus", "srt", "vtt",
    // Schriften
    "ttf", "otf", "ttc", "woff", "woff2", // Paletten
    "kpl", "gpl", "aco", "ase", "soc", // Dokumente und Text
    "pdf", "txt", "md", "json", "docx", "odt", "csv",
];

/// Darf ein Austauschpaket diese Datei mitbringen? Prüft die letzte Endung der letzten Pfadkomponente ohne Rücksicht auf
/// Groß/Klein (`Logo.PNG` ja, `Logo.png.exe`, `setup.bat`, `readme` ohne Endung nein).
pub fn is_pack_file_allowed(rel: &str) -> bool {
    let name = rel.rsplit(['/', '\\']).next().unwrap_or(rel);
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => {
            let ext = ext.to_ascii_lowercase();
            PACK_ALLOWED_EXTENSIONS.contains(&ext.as_str())
        }
        _ => false,
    }
}

/// Liegt `rel` im Verwaltungsordner `.cypher` der Bibliothek? Auf Windows und macOS ist `.CYPHER` derselbe Ordner, Windows
/// ignoriert abschließende Punkte und Leerzeichen und kennt den Kurznamen `CYPHER~1`; `\` gilt als Trenner. Die Prüfung ist
/// absichtlich großzügig: lieber einen harmlosen Namen ablehnen als den Ordner der App öffnen.
pub fn is_meta_path(rel: &str) -> bool {
    use unicode_normalization::UnicodeNormalization as _;
    let normalized: String = rel.nfc().collect();
    let first = normalized.split(['/', '\\']).find(|c| !c.is_empty()).unwrap_or("");
    let first = first.trim_end_matches([' ', '.']).to_ascii_lowercase();
    if first == META_DIR {
        return true;
    }
    // 8.3-Kurzname von `.cypher`: `CYPHER~1`, `CYPHER~2` …
    first.strip_prefix("cypher~").is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// Hat die Art ein Vorschaubild?
pub fn has_thumbnail(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "webp" | "tif" | "tiff" | "gif" | "bmp" | "svg" | "kra" | "ora" | "blend")
}

/// Dateien, die nie in die Bibliothek gehören (Systemmüll, halbe Downloads, Sync-Zwischendateien).
pub fn is_ignored_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    name.starts_with('.')
        || name.starts_with("~$")
        || lower == "thumbs.db"
        || lower == "desktop.ini"
        || lower == "liesmich.txt"
        || lower.ends_with(".tmp")
        || lower.ends_with(".part")
        || lower.ends_with(".crdownload")
        || lower.ends_with(".syncthing.tmp")
        || lower.contains(".syncthing.")
}

/// Begleitdatei (`.cypher/meta/<relPath>.json`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarFile {
    pub format_version: u32,
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub collection: Option<String>,
    #[serde(default)]
    pub author: String,
    #[serde(default = "default_status")]
    pub status: LibraryEntryStatus,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub colors: Vec<String>,
    #[serde(default)]
    pub print_profile_id: Option<String>,
    #[serde(default)]
    pub garment_color_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub content_sha256: Option<String>,
}

fn default_status() -> LibraryEntryStatus {
    LibraryEntryStatus::Draft
}

impl SidecarFile {
    pub fn meta(&self) -> SidecarMeta {
        SidecarMeta {
            title: self.title.clone(),
            tags: self.tags.clone(),
            collection: self.collection.clone(),
            author: self.author.clone(),
            status: self.status,
            notes: self.notes.clone(),
            colors: self.colors.clone(),
            print_profile_id: self.print_profile_id.clone(),
            garment_color_ids: self.garment_color_ids.clone(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }

    pub fn from_meta(id: &str, meta: &SidecarMeta, content_sha256: Option<String>) -> Self {
        SidecarFile {
            format_version: SIDECAR_FORMAT_VERSION,
            id: id.to_owned(),
            title: meta.title.clone(),
            tags: meta.tags.clone(),
            collection: meta.collection.clone(),
            author: meta.author.clone(),
            status: meta.status,
            notes: meta.notes.clone(),
            colors: meta.colors.clone(),
            print_profile_id: meta.print_profile_id.clone(),
            garment_color_ids: meta.garment_color_ids.clone(),
            created_at: meta.created_at.clone(),
            updated_at: meta.updated_at.clone(),
            content_sha256,
        }
    }
}

/// Standard-Metadaten für eine Datei ohne Begleitdatei.
pub fn default_meta(rel: &str, modified_iso: &str) -> SidecarMeta {
    let stem = Path::new(rel).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| rel.to_owned());
    SidecarMeta {
        title: stem,
        tags: vec![],
        collection: None,
        author: String::new(),
        status: LibraryEntryStatus::Draft,
        notes: String::new(),
        colors: vec![],
        print_profile_id: None,
        garment_color_ids: vec![],
        created_at: modified_iso.to_owned(),
        updated_at: modified_iso.to_owned(),
    }
}

/// Ein Eintrag im Index (im Cache gespeichert, nicht im geteilten Ordner).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexEntry {
    pub id: String,
    pub kind: LibraryKind,
    pub rel_path: String,
    pub size: u64,
    pub modified_ms: i64,
    pub width_px: Option<u32>,
    pub height_px: Option<u32>,
    pub project_id: Option<String>,
    pub meta: SidecarMeta,
    pub sidecar_missing: bool,
    pub conflict: Option<LibraryConflict>,
    pub content_sha256: Option<String>,
}

impl IndexEntry {
    /// Stabile ID für Dateien ohne Begleitdatei.
    pub fn derived_id(rel: &str) -> String {
        format!("f-{}", short_hash(rel))
    }

    pub fn file_name(&self) -> &str {
        self.rel_path.rsplit('/').next().unwrap_or(&self.rel_path)
    }

    pub fn modified_iso(&self) -> String {
        iso_from_ms(self.modified_ms)
    }

    /// Für die Oberfläche.
    pub fn to_dto(&self) -> LibraryEntry {
        let ext = extension_of(&self.rel_path);
        LibraryEntry {
            id: self.id.clone(),
            kind: self.kind,
            rel_path: self.rel_path.clone(),
            file_name: self.file_name().to_owned(),
            mime: mime_of(&ext).to_owned(),
            size: self.size,
            modified_at: self.modified_iso(),
            width_px: self.width_px,
            height_px: self.height_px,
            project_id: self.project_id.clone(),
            open_with: crate::projects::program_for(Path::new(&self.rel_path)).map(str::to_owned),
            meta: self.meta.clone(),
            thumbnail_url: has_thumbnail(&ext).then(|| urls::url("cythumb", &self.id)),
            conflict: self.conflict.clone(),
            sidecar_missing: self.sidecar_missing,
        }
    }
}

pub fn iso_from_ms(ms: i64) -> String {
    let t = time::OffsetDateTime::from_unix_timestamp_nanos(i128::from(ms) * 1_000_000)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    to_iso(t)
}

pub fn ms_of(t: std::time::SystemTime) -> i64 {
    match t.duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_millis() as i64,
        Err(e) => -(e.duration().as_millis() as i64),
    }
}

/// Erkennt Konfliktkopien der Sync-Werkzeuge am Dateinamen und rät die Originaldatei.
///
/// - Syncthing: `name.sync-conflict-20260101-123456-ABCDEFG.ext`
/// - Dropbox: `name (conflicted copy 2026-01-01).ext`, `name (Max Mustermanns conflicted copy 2026-01-01).ext`
/// - Nextcloud/ownCloud: `name_conflict-20260101-123456.ext`
pub fn conflict_of(rel: &str) -> Option<LibraryConflict> {
    let (dir, name) = match rel.rfind('/') {
        Some(i) => (&rel[..=i], &rel[i + 1..]),
        None => ("", rel),
    };
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let original_stem = if let Some(i) = stem.find(".sync-conflict-") {
        Some(&stem[..i])
    } else if let Some(i) = stem.find("_conflict-") {
        Some(&stem[..i])
    } else if let Some(i) = stem.rfind(" (") {
        let tail = &stem[i + 2..];
        (stem.ends_with(')') && tail.contains("conflicted copy")).then_some(&stem[..i])
    } else {
        None
    }?;
    Some(LibraryConflict::SyncConflictCopy { original_rel_path: Some(format!("{dir}{original_stem}{ext}")) })
}

/// Sync-Werkzeug an Markierungsdateien im Ordner und am Pfad erkennen.
pub fn detect_sync_tool(root: &Path) -> Option<SyncTool> {
    let has = |n: &str| root.join(n).exists();
    if has(".stfolder") || has(".stignore") {
        return Some(SyncTool::Syncthing);
    }
    if has(".dropbox") || has(".dropbox.cache") {
        return Some(SyncTool::Dropbox);
    }
    let has_prefix = |prefix: &str| {
        std::fs::read_dir(root)
            .ok()
            .is_some_and(|rd| rd.filter_map(Result::ok).any(|e| e.file_name().to_string_lossy().starts_with(prefix)))
    };
    if has(".owncloudsync.log") || has_prefix(".sync_") || has_prefix("._sync_") || has_prefix(".csync_journal") {
        return Some(SyncTool::Nextcloud);
    }
    if has(".tmp.drivedownload") || has(".tmp.driveupload") {
        return Some(SyncTool::GoogleDrive);
    }
    let path = root.to_string_lossy().to_lowercase();
    if path.contains("/onedrive") || path.contains("\\onedrive") {
        return Some(SyncTool::OneDrive);
    }
    if path.contains("mobile documents") || path.contains("icloud drive") || path.contains("iclouddrive") {
        return Some(SyncTool::ICloud);
    }
    if path.contains("/google drive") || path.contains("\\google drive") || path.contains("googledrive") {
        return Some(SyncTool::GoogleDrive);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pack_allow_list_accepts_work_files_and_rejects_programs_and_scripts() {
        for ok in [
            "Motive/Logo.png",
            "Motive/LOGO.PNG",
            "3D/modell.glb",
            "3D/modell.GLTF",
            "3D/modell.bin",
            "Projekte/x/Film.kdenlive",
            "Projekte/x/Malerei.kra",
            "Szene.blend",
            "Vektor.svg",
            "Schriften/Demo.TTF",
            "Doku/Anleitung.pdf",
            "a/b.social.json",
            "Notizen.txt",
            "Motive\\Unterordner\\x.webp",
        ] {
            assert!(is_pack_file_allowed(ok), "{ok}");
        }
        for bad in [
            "Motive/Logo.png.exe",
            "Motive/Logo.png.EXE",
            "setup.bat",
            "x.cmd",
            "x.lnk",
            "x.url",
            "x.js",
            "x.jse",
            "x.vbs",
            "x.ps1",
            "x.psm1",
            "x.hta",
            "x.scr",
            "x.dll",
            "x.msi",
            "x.com",
            "x.reg",
            "x.sh",
            "x.py",
            "x.jar",
            "x.desktop",
            "x.appimage",
            "x.app",
            "x.html",
            "x.xml",
            "x.zip",
            "Makefile",
            "ohne-endung",
            ".png",
            "ordner.png/datei",
            "Logo.png.",
        ] {
            assert!(!is_pack_file_allowed(bad), "{bad}");
        }
    }

    #[test]
    fn every_known_library_kind_is_allowed_in_packs() {
        // Die Positivliste darf nichts auslassen, was die Bibliothek sonst als eigene Art kennt (außer „other“)
        let known = [
            "png", "jpg", "jpeg", "webp", "tif", "tiff", "gif", "bmp", "avif", "kra", "ora", "psd", "xcf", "svg",
            "blend", "glb", "gltf", "obj", "fbx", "stl", "usd", "usdz", "mp4", "mov", "mkv", "webm", "avi", "kdenlive",
            "mp3", "wav", "ogg", "flac", "m4a", "opus", "ttf", "otf", "woff", "woff2", "kpl", "gpl", "aco", "ase",
            "soc", "pdf", "txt", "md", "json", "docx", "odt", "csv",
        ];
        for ext in known {
            assert_ne!(classify(ext), LibraryKind::Other, "{ext}");
            assert!(PACK_ALLOWED_EXTENSIONS.contains(&ext), "{ext} fehlt in der Positivliste");
        }
        assert!(PACK_ALLOWED_EXTENSIONS.iter().all(|e| *e == e.to_ascii_lowercase()));
    }

    #[test]
    fn meta_folder_is_recognised_in_every_spelling() {
        // Befund M2: `.CYPHER` ist unter Windows und macOS derselbe Ordner wie `.cypher`
        for yes in [
            ".cypher",
            ".cypher/x.json",
            ".CYPHER/x.json",
            ".Cypher/trash/a",
            ".cypher\\tmp\\x",
            "/.cypher/x",
            "\\.cypher\\x",
            ".cypher./x",
            ".cypher /x",
            "CYPHER~1/x",
            "cypher~2/x.txt",
        ] {
            assert!(is_meta_path(yes), "{yes}");
        }
        for no in [
            "Motive/.cypher/x",
            "Motive/x.png",
            ".cypherx/a",
            "cypher/a",
            "cypher~/a",
            "cypher~a/x",
            "xcypher~1/a",
            "",
            "a/.cypher",
        ] {
            assert!(!is_meta_path(no), "{no}");
        }
    }

    #[test]
    fn kinds_and_mime() {
        assert_eq!(classify("png"), LibraryKind::Image);
        assert_eq!(classify("svg"), LibraryKind::Vector);
        assert_eq!(classify("blend"), LibraryKind::Model3d);
        assert_eq!(classify("kdenlive"), LibraryKind::Video);
        assert_eq!(classify("ttf"), LibraryKind::Font);
        assert_eq!(classify("kpl"), LibraryKind::Palette);
        assert_eq!(classify("xyz"), LibraryKind::Other);
        assert_eq!(mime_of("glb"), "model/gltf-binary");
        assert_eq!(extension_of("a/b/Foto.JPG"), "jpg");
        assert_eq!(extension_of("a/b/x.social.json"), "json");
        assert!(has_thumbnail("kra") && !has_thumbnail("mp4"));
    }

    #[test]
    fn sync_conflict_copies_are_recognised() {
        let o = |name: &str| match conflict_of(name) {
            Some(LibraryConflict::SyncConflictCopy { original_rel_path }) => original_rel_path,
            None => None,
        };
        assert_eq!(o("Motive/ratte.sync-conflict-20260101-123456-ABCDEFG.png").as_deref(), Some("Motive/ratte.png"));
        assert_eq!(o("Motive/ratte (conflicted copy 2026-01-01).png").as_deref(), Some("Motive/ratte.png"));
        assert_eq!(
            o("Motive/ratte (Max Muster's conflicted copy 2026-01-01).png").as_deref(),
            Some("Motive/ratte.png")
        );
        assert_eq!(o("ratte_conflict-20260101-123456.png").as_deref(), Some("ratte.png"));
        assert!(conflict_of("Motive/ratte (2).png").is_none());
        assert!(conflict_of("Motive/ratte.png").is_none());
        assert!(conflict_of("Motive/conflict.png").is_none());
    }

    #[test]
    fn ignored_files() {
        for n in [
            ".DS_Store",
            "Thumbs.db",
            "desktop.ini",
            "~$bericht.docx",
            "a.tmp",
            "b.part",
            ".stfolder",
            "c.syncthing.d.tmp",
            "LIESMICH.txt",
        ] {
            assert!(is_ignored_file(n), "{n}");
        }
        for n in ["ratte.png", "Neon Ratte.kra", "notizen.txt"] {
            assert!(!is_ignored_file(n), "{n}");
        }
    }

    #[test]
    fn sidecar_round_trip_keeps_all_fields() {
        let meta = SidecarMeta {
            title: "Neon Ratte".into(),
            tags: vec!["ratte".into(), "neon".into()],
            collection: Some("rauschen".into()),
            author: "Mo".into(),
            status: LibraryEntryStatus::Approved,
            notes: "n".into(),
            colors: vec!["#ff2bd6".into()],
            print_profile_id: Some("shirtigo-tee-front".into()),
            garment_color_ids: vec!["schwarz".into()],
            created_at: "2026-10-01T00:00:00Z".into(),
            updated_at: "2026-10-02T00:00:00Z".into(),
        };
        let file = SidecarFile::from_meta("abc", &meta, Some("ff".into()));
        let json = serde_json::to_string(&file).unwrap();
        let back: SidecarFile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.meta(), meta);
        assert_eq!(back.id, "abc");
        assert!(json.contains("\"formatVersion\":1") && json.contains("\"contentSha256\""));
        // Begleitdateien mit fehlenden optionalen Feldern bleiben lesbar
        let minimal: SidecarFile =
            serde_json::from_str(r#"{"formatVersion":1,"id":"x","createdAt":"a","updatedAt":"b"}"#).unwrap();
        assert_eq!(minimal.status, LibraryEntryStatus::Draft);
    }

    #[test]
    fn index_entry_dto() {
        let e = IndexEntry {
            id: "f-1".into(),
            kind: LibraryKind::Image,
            rel_path: "Projekte/P/Motive/a.kra".into(),
            size: 5,
            modified_ms: 1_700_000_000_000,
            width_px: None,
            height_px: None,
            project_id: Some("p1".into()),
            meta: default_meta("Projekte/P/Motive/a.kra", "2026-01-01T00:00:00Z"),
            sidecar_missing: true,
            conflict: None,
            content_sha256: None,
        };
        let dto = e.to_dto();
        assert_eq!(dto.file_name, "a.kra");
        assert_eq!(dto.open_with.as_deref(), Some("krita"));
        assert_eq!(dto.meta.title, "a");
        assert!(dto.thumbnail_url.as_deref().is_some_and(|u| u.contains("cythumb") && u.ends_with("f-1")));
        assert_eq!(dto.modified_at, "2023-11-14T22:13:20Z");
    }

    #[test]
    fn sync_tool_markers() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(detect_sync_tool(tmp.path()), None);
        std::fs::create_dir(tmp.path().join(".stfolder")).unwrap();
        assert_eq!(detect_sync_tool(tmp.path()), Some(SyncTool::Syncthing));
        let t2 = tempfile::tempdir().unwrap();
        std::fs::write(t2.path().join(".sync_abc123.db"), b"").unwrap();
        assert_eq!(detect_sync_tool(t2.path()), Some(SyncTool::Nextcloud));
        let t3 = tempfile::tempdir().unwrap();
        let od = t3.path().join("OneDrive").join("Cypher");
        std::fs::create_dir_all(&od).unwrap();
        assert_eq!(detect_sync_tool(&od), Some(SyncTool::OneDrive));
    }
}
