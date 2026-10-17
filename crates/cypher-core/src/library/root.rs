//! Bibliothekswurzel: prüfen, zusammenfassen, einrichten (ARCHITEKTUR.md 2.12, 4.6, 6.6).

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::api::{Collection, LibraryRootCandidate, LibraryRootInvalidReason, Os, RootProblem};
use crate::error::LibraryError;
use crate::platform::{AppDirs, KnownDirs, display_path, fsx, is_system_dir};
use crate::util::{new_id, now_iso};

use super::model::{LIBRARY_FORMAT_VERSION, META_DIR, detect_sync_tool};

/// Höchstdauer der Zählung beim Prüfen eines Ordners.
pub const INSPECT_BUDGET: Duration = Duration::from_secs(3);
/// Ab so vielen Dateien gilt der Ordner als sehr groß.
pub const VERY_LARGE_FILES: u64 = 200_000;

/// `.cypher/library.json`
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFile {
    pub format_version: u32,
    pub name: String,
    pub collections: Vec<Collection>,
    pub created_at: String,
}

/// Standard-Kollektionen einer neuen Bibliothek.
pub fn default_collections() -> Vec<Collection> {
    vec![
        Collection { id: "rauschen".into(), name: "Rauschen".into(), hex: "#0b0b0a".into() },
        Collection { id: "mittelwelle".into(), name: "Mittelwelle".into(), hex: "#1f2bd0".into() },
        Collection { id: "gold".into(), name: "Gold-Lounge".into(), hex: "#c9a03f".into() },
    ]
}

/// Standardordner einer neuen Bibliothek (4.6).
pub const STANDARD_FOLDERS: [&str; 6] = ["Projekte", "Vorlagen", "3D", "Motive", "Schriften", "Paletten"];

const README: &str = "Dies ist ein Cypher-Studio-Ordner.\n\n\
Er ist ein ganz normaler Ordner: Alles darin sind gewöhnliche Dateien, die du auch ohne die App öffnen kannst.\n\
Der Ordner `.cypher` enthält nur Beschreibungen (Stichworte, Kollektion, Status) zu den Dateien; bitte nicht löschen.\n\
Zum Teilen reicht ein Sync-Werkzeug deiner Wahl (zum Beispiel Syncthing, Nextcloud, Dropbox oder OneDrive).\n";

/// Ordnername, wie ihn Cypher Studio selbst anzeigt.
pub fn library_name_of(root: &Path) -> String {
    root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Cypher".into())
}

/// Prüft, ob `path` als Bibliothekswurzel taugt (Ordner, beschreibbar, kein Systemordner, nicht im App-Datenordner).
pub fn validate_root(path: &Path, dirs: &AppDirs, os: Os, known: &KnownDirs) -> Result<(), LibraryError> {
    if !path.is_dir() {
        return Err(LibraryError::RootInvalid(LibraryRootInvalidReason::NotADirectory));
    }
    if is_system_dir(os, known, path) {
        return Err(LibraryError::RootInvalid(LibraryRootInvalidReason::SystemDirectory));
    }
    let canon = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    for inside in [&dirs.data, &dirs.cache, &dirs.config, &dirs.logs] {
        let inside = std::fs::canonicalize(inside).unwrap_or_else(|_| inside.clone());
        if canon.starts_with(&inside) {
            return Err(LibraryError::RootInvalid(LibraryRootInvalidReason::InsideAppData));
        }
    }
    if !is_writable(path) {
        return Err(LibraryError::RootInvalid(LibraryRootInvalidReason::NotWritable));
    }
    Ok(())
}

/// Schreibprobe mit einer Temp-Datei.
pub fn is_writable(dir: &Path) -> bool {
    tempfile::Builder::new().prefix(".cypher-probe-").tempfile_in(dir).is_ok()
}

/// Zusammenfassung eines gewählten Ordners, noch ohne Umstellung.
pub fn inspect_root(
    path: &Path,
    dirs: &AppDirs,
    os: Os,
    known: &KnownDirs,
) -> Result<LibraryRootCandidate, LibraryError> {
    let mut problems: Vec<RootProblem> = Vec::new();
    match validate_root(path, dirs, os, known) {
        Ok(()) => {}
        Err(LibraryError::RootInvalid(LibraryRootInvalidReason::NotADirectory)) => {
            return Err(LibraryError::RootInvalid(LibraryRootInvalidReason::NotADirectory));
        }
        Err(LibraryError::RootInvalid(LibraryRootInvalidReason::NotWritable)) => {
            problems.push(RootProblem::NotWritable)
        }
        Err(LibraryError::RootInvalid(LibraryRootInvalidReason::InsideAppData)) => {
            problems.push(RootProblem::InsideAppData)
        }
        Err(LibraryError::RootInvalid(LibraryRootInvalidReason::SystemDirectory)) => {
            problems.push(RootProblem::SystemDirectory)
        }
        Err(e) => return Err(e),
    }
    let started = Instant::now();
    let (mut files, mut bytes, mut projects) = (0u64, 0u64, 0u32);
    let mut truncated = false;
    // Zählen nur, wenn der Ordner kein Systemordner ist (dort nichts durchlaufen)
    if !problems.contains(&RootProblem::SystemDirectory) {
        let walker = WalkDir::new(path).follow_links(false).into_iter().filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            e.depth() == 0 || !(n.starts_with('.') && e.file_type().is_dir())
        });
        for entry in walker.filter_map(Result::ok) {
            if entry.file_type().is_file() {
                if entry.file_name() == "projekt.json"
                    && entry.depth() == 3
                    && entry.path().components().rev().nth(2).is_some_and(|c| c.as_os_str() == "Projekte")
                {
                    projects += 1;
                }
                if !super::model::is_ignored_file(&entry.file_name().to_string_lossy()) {
                    files += 1;
                    bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
            if files % 256 == 0 && started.elapsed() > INSPECT_BUDGET {
                truncated = true;
                break;
            }
        }
    }
    if truncated || files >= VERY_LARGE_FILES {
        problems.push(RootProblem::VeryLarge);
    }
    Ok(LibraryRootCandidate {
        candidate_id: new_id(),
        path: display_path(path),
        file_count: files,
        total_bytes: bytes,
        project_count: projects,
        initialized: library_file_path(path).is_file(),
        sync_tool: detect_sync_tool(path),
        problems,
    })
}

pub fn library_file_path(root: &Path) -> PathBuf {
    root.join(META_DIR).join("library.json")
}

/// Legt die Struktur an (ohne vorhandene Dateien anzufassen) und schreibt `.cypher/library.json`.
pub fn init(root: &Path, display_name: &str, collections: &[Collection]) -> Result<LibraryFile, LibraryError> {
    // Glied für Glied und ohne Links: ein geteilter Ordner kann Links mitbringen, durch die nichts nach außen laufen darf
    fsx::create_dir_all_within(root, &format!("{META_DIR}/meta"))?;
    for folder in STANDARD_FOLDERS {
        fsx::create_dir_all_within(root, folder)?;
    }
    let readme = root.join("LIESMICH.txt");
    if !readme.exists() {
        fsx::write_atomic(&readme, README.as_bytes())?;
    }
    let path = library_file_path(root);
    if let Some(existing) = read_library_file(root)? {
        return Ok(existing);
    }
    let file = LibraryFile {
        format_version: LIBRARY_FORMAT_VERSION,
        name: display_name.to_owned(),
        collections: if collections.is_empty() { default_collections() } else { collections.to_vec() },
        created_at: now_iso(),
    };
    fsx::write_json_atomic(&path, &file)?;
    Ok(file)
}

/// Liest `.cypher/library.json`; `None`, wenn es fehlt.
pub fn read_library_file(root: &Path) -> Result<Option<LibraryFile>, LibraryError> {
    let file: Option<LibraryFile> = fsx::read_json(&library_file_path(root))?;
    if let Some(f) = &file
        && f.format_version > LIBRARY_FORMAT_VERSION
    {
        return Err(LibraryError::InvalidInput {
            field: "library.json".into(),
            reason: "Die Bibliothek stammt von einer neueren App-Version".into(),
        });
    }
    Ok(file)
}

/// Prüft eine Kollektionsliste (eindeutige, einfache IDs; Farbe `#rrggbb`).
pub fn validate_collections(collections: &[Collection]) -> Result<(), LibraryError> {
    let mut seen = std::collections::BTreeSet::new();
    for c in collections {
        let id_ok = !c.id.is_empty()
            && c.id.len() <= 40
            && c.id.chars().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-');
        if !id_ok {
            return Err(LibraryError::InvalidInput {
                field: "collections".into(),
                reason: format!("ID `{}` ist ungültig (a-z, 0-9, -)", c.id),
            });
        }
        if !seen.insert(c.id.clone()) {
            return Err(LibraryError::InvalidInput {
                field: "collections".into(),
                reason: format!("ID `{}` kommt doppelt vor", c.id),
            });
        }
        if c.name.trim().is_empty() || c.name.chars().count() > 60 {
            return Err(LibraryError::InvalidInput {
                field: "collections".into(),
                reason: "Name leer oder zu lang".into(),
            });
        }
        let hex = c.hex.strip_prefix('#').unwrap_or("");
        if !(hex.len() == 6 && hex.chars().all(|ch| ch.is_ascii_hexdigit())) {
            return Err(LibraryError::InvalidInput {
                field: "collections".into(),
                reason: format!("Farbe `{}` ist ungültig", c.hex),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env() -> (tempfile::TempDir, AppDirs, KnownDirs) {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = AppDirs::for_test(tmp.path());
        for d in [&dirs.data, &dirs.cache, &dirs.config, &dirs.logs] {
            std::fs::create_dir_all(d).unwrap();
        }
        let known = KnownDirs { home: Some(tmp.path().to_path_buf()), ..KnownDirs::default() };
        (tmp, dirs, known)
    }

    #[test]
    fn init_creates_the_structure_once_and_keeps_existing_settings() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Cypher");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("vorhanden.png"), b"x").unwrap();
        let file = init(&root, "Cypher Kollektiv", &[]).unwrap();
        assert_eq!(file.collections.len(), 3);
        for f in STANDARD_FOLDERS {
            assert!(root.join(f).is_dir(), "{f}");
        }
        assert!(root.join("LIESMICH.txt").is_file() && root.join(".cypher/meta").is_dir());
        assert_eq!(std::fs::read(root.join("vorhanden.png")).unwrap(), b"x");
        // erneut: nichts ändert sich
        let custom = vec![Collection { id: "x".into(), name: "X".into(), hex: "#000000".into() }];
        let again = init(&root, "Anderer Name", &custom).unwrap();
        assert_eq!(again, file);
    }

    #[test]
    fn root_validation_reasons() {
        let (tmp, dirs, known) = env();
        let ok = tmp.path().join("Sync");
        std::fs::create_dir_all(&ok).unwrap();
        assert!(validate_root(&ok, &dirs, Os::Linux, &known).is_ok());
        let file = tmp.path().join("datei.txt");
        std::fs::write(&file, b"x").unwrap();
        assert!(matches!(
            validate_root(&file, &dirs, Os::Linux, &known),
            Err(LibraryError::RootInvalid(LibraryRootInvalidReason::NotADirectory))
        ));
        assert!(matches!(
            validate_root(&tmp.path().join("fehlt"), &dirs, Os::Linux, &known),
            Err(LibraryError::RootInvalid(LibraryRootInvalidReason::NotADirectory))
        ));
        assert!(matches!(
            validate_root(&dirs.data, &dirs, Os::Linux, &known),
            Err(LibraryError::RootInvalid(LibraryRootInvalidReason::InsideAppData))
        ));
        let inside = dirs.cache.join("x");
        std::fs::create_dir_all(&inside).unwrap();
        assert!(matches!(
            validate_root(&inside, &dirs, Os::Linux, &known),
            Err(LibraryError::RootInvalid(LibraryRootInvalidReason::InsideAppData))
        ));
        #[cfg(unix)]
        assert!(matches!(
            validate_root(Path::new("/usr"), &dirs, Os::Linux, &known),
            Err(LibraryError::RootInvalid(LibraryRootInvalidReason::SystemDirectory))
        ));
        #[cfg(windows)]
        assert!(matches!(
            validate_root(Path::new("C:\\Windows"), &dirs, Os::Windows, &known),
            Err(LibraryError::RootInvalid(LibraryRootInvalidReason::SystemDirectory))
        ));
    }

    #[test]
    fn inspect_counts_files_projects_and_detects_state() {
        let (tmp, dirs, known) = env();
        let root = tmp.path().join("Sync");
        std::fs::create_dir_all(root.join("Projekte/A")).unwrap();
        std::fs::create_dir_all(root.join("Motive")).unwrap();
        std::fs::create_dir_all(root.join(".stfolder")).unwrap();
        std::fs::write(root.join("Projekte/A/projekt.json"), b"{}").unwrap();
        std::fs::write(root.join("Motive/a.png"), vec![0u8; 100]).unwrap();
        std::fs::write(root.join("Motive/b.png"), vec![0u8; 50]).unwrap();
        std::fs::write(root.join("Motive/.DS_Store"), b"x").unwrap();
        let c = inspect_root(&root, &dirs, Os::Linux, &known).unwrap();
        assert_eq!(c.file_count, 3, "projekt.json zählt mit, Müll nicht");
        assert_eq!(c.total_bytes, 152);
        assert_eq!(c.project_count, 1);
        assert!(!c.initialized);
        assert_eq!(c.sync_tool, Some(crate::api::SyncTool::Syncthing));
        assert!(c.problems.is_empty(), "{:?}", c.problems);
        init(&root, "S", &[]).unwrap();
        assert!(inspect_root(&root, &dirs, Os::Linux, &known).unwrap().initialized);
        // Anwendungsdaten: Problem wird gemeldet, nicht verschluckt
        let c = inspect_root(&dirs.data, &dirs, Os::Linux, &known).unwrap();
        assert!(c.problems.contains(&RootProblem::InsideAppData));
    }

    #[test]
    fn collections_validation() {
        let ok = vec![Collection { id: "rauschen".into(), name: "Rauschen".into(), hex: "#0b0b0a".into() }];
        assert!(validate_collections(&ok).is_ok());
        let bad_id = vec![Collection { id: "Gross".into(), name: "x".into(), hex: "#000000".into() }];
        assert!(validate_collections(&bad_id).is_err());
        let bad_hex = vec![Collection { id: "a".into(), name: "x".into(), hex: "rot".into() }];
        assert!(validate_collections(&bad_hex).is_err());
        let dup = vec![ok[0].clone(), ok[0].clone()];
        assert!(validate_collections(&dup).is_err());
        let empty_name = vec![Collection { id: "a".into(), name: " ".into(), hex: "#000000".into() }];
        assert!(validate_collections(&empty_name).is_err());
    }
}
