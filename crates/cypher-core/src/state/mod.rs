//! `state` – persistierter App-Zustand (`<data>/state.json`, ARCHITEKTUR.md 4.3).
//!
//! Erkannte Systeminstallationen werden nicht gespeichert; nur verwaltete (Cypher), manuell hinzugefügte Pfade,
//! die bevorzugte Installation je Programm, Einrichtungsverlauf, Projektindex und die höchste gesehene Katalog-
//! Sequenz (Rollback-Schutz).

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, IoError};
use crate::platform::{AppDirs, fsx};

pub const STATE_SCHEMA_VERSION: u32 = 1;

/// Wie eine verwaltete Installation gestartet wird (Pfade relativ zum Installationsordner).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum StoredLauncher {
    /// Ausführbare Datei (Windows `.exe`, Linux-Binary).
    Exe { rel_exe: String },
    /// macOS-App-Bundle.
    MacApp { rel_bundle: String },
    /// AppImage; `rel_app_run` gesetzt, wenn es entpackt wurde (kein FUSE nötig).
    AppImage { rel_file: String, rel_app_run: Option<String> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredVerified {
    pub sha256: String,
    pub catalog_sequence: u64,
    pub signature_checked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredArtifact {
    pub url: String,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredInstallation {
    pub id: String,
    pub program_id: String,
    pub version: String,
    /// Immer `cypher`; das Feld bleibt für spätere Arten erhalten.
    pub kind: String,
    /// Absoluter Installationsordner.
    pub path: String,
    pub launcher: StoredLauncher,
    /// Installationsordner der Programme, unter dem `path` liegt (beim Entfernen darf nur dort gelöscht werden).
    #[serde(default)]
    pub programs_root: Option<String>,
    pub installed_at: String,
    pub verified: StoredVerified,
    pub artifact: StoredArtifact,
    /// macOS: Gatekeeper hat die App nicht akzeptiert (nicht beglaubigt); Start nur nach Bestätigung.
    #[serde(default)]
    pub not_notarized: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredManual {
    pub id: String,
    pub program_id: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSetup {
    pub setup_id: String,
    pub pack_id: String,
    pub program_id: Option<String>,
    pub scope_id: String,
    pub pack_version: String,
    pub applied_at: String,
    pub status: String,
    pub files_written: u32,
    pub backups_taken: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIndexEntry {
    pub id: String,
    pub dir: String,
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PersistedState {
    pub schema_version: u32,
    pub catalog_highest_sequence: u64,
    pub installations: Vec<StoredInstallation>,
    pub manual_installations: Vec<StoredManual>,
    pub preferred: BTreeMap<String, String>,
    pub setups: Vec<StoredSetup>,
    pub project_index: Vec<ProjectIndexEntry>,
    pub library_root: Option<String>,
}

impl Default for PersistedState {
    fn default() -> Self {
        PersistedState {
            schema_version: STATE_SCHEMA_VERSION,
            catalog_highest_sequence: 0,
            installations: Vec::new(),
            manual_installations: Vec::new(),
            preferred: BTreeMap::new(),
            setups: Vec::new(),
            project_index: Vec::new(),
            library_root: None,
        }
    }
}

/// Hebt einen gelesenen Zustand auf die aktuelle Schema-Version. Neuere Versionen werden nicht angefasst.
pub fn migrate(mut value: serde_json::Value) -> Result<PersistedState, CoreError> {
    let version = value.get("schemaVersion").and_then(serde_json::Value::as_u64).unwrap_or(0) as u32;
    if version > STATE_SCHEMA_VERSION {
        return Err(CoreError::internal(format!(
            "state.json stammt von einer neueren App-Version (Schema {version}); bitte die App aktualisieren"
        )));
    }
    // Version 0 (Entwurfsstände ohne `schemaVersion`) hat dieselbe Form wie Version 1.
    if let Some(obj) = value.as_object_mut() {
        obj.insert("schemaVersion".to_owned(), serde_json::json!(STATE_SCHEMA_VERSION));
    }
    serde_json::from_value(value).map_err(|e| CoreError::internal(format!("state.json nicht lesbar: {e}")))
}

/// Zustand im Speicher mit atomarem Schreiben nach jeder Änderung.
pub struct StateStore {
    path: std::path::PathBuf,
    state: RwLock<PersistedState>,
}

impl StateStore {
    /// Lädt `<data>/state.json`. Fehlt sie, startet der Zustand leer; ist sie kaputt, wird sie beiseite
    /// gelegt (`.corrupt-<zeit>`) und der Zustand startet leer. Eine neuere Schema-Version ist ein Fehler.
    pub fn load(dirs: &AppDirs) -> Result<Self, CoreError> {
        Self::load_from(dirs.state_file())
    }

    pub fn load_from(path: std::path::PathBuf) -> Result<Self, CoreError> {
        let state = match fsx::read_json::<serde_json::Value>(&path) {
            Ok(None) => PersistedState::default(),
            Ok(Some(value)) => migrate(value)?,
            Err(e) if e.source.kind() == std::io::ErrorKind::InvalidData => {
                let moved = fsx::quarantine_corrupt(&path)?;
                tracing::warn!("state.json war beschädigt und liegt jetzt in {}", moved.display());
                PersistedState::default()
            }
            Err(e) => return Err(e.into()),
        };
        Ok(StateStore { path, state: RwLock::new(state) })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn read<R>(&self, f: impl FnOnce(&PersistedState) -> R) -> R {
        match self.state.read() {
            Ok(g) => f(&g),
            Err(p) => f(&p.into_inner()),
        }
    }

    /// Ändert den Zustand und schreibt ihn atomar. Schlägt das Schreiben fehl, bleibt der alte Zustand erhalten.
    pub fn update<R>(&self, f: impl FnOnce(&mut PersistedState) -> R) -> Result<R, IoError> {
        let mut guard = match self.state.write() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let mut next = guard.clone();
        let result = f(&mut next);
        fsx::write_json_atomic(&self.path, &next)?;
        *guard = next;
        Ok(result)
    }

    pub fn snapshot(&self) -> PersistedState {
        self.read(PersistedState::clone)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn installation(id: &str) -> StoredInstallation {
        StoredInstallation {
            id: id.into(),
            program_id: "blender".into(),
            version: "5.2.2".into(),
            kind: "cypher".into(),
            path: "/data/programs/blender/5.2.2".into(),
            launcher: StoredLauncher::Exe { rel_exe: "blender.exe".into() },
            programs_root: Some("/data/programs".into()),
            installed_at: "2026-10-20T10:00:00Z".into(),
            verified: StoredVerified { sha256: "ab".repeat(32), catalog_sequence: 1, signature_checked: false },
            artifact: StoredArtifact { url: "https://download.blender.org/x.zip".into(), kind: "zip".into() },
            not_notarized: false,
        }
    }

    #[test]
    fn missing_file_starts_empty_and_updates_persist() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data/state.json");
        let store = StateStore::load_from(path.clone()).unwrap();
        assert_eq!(store.snapshot(), PersistedState::default());
        store
            .update(|s| {
                s.installations.push(installation("cypher:blender:5.2.2"));
                s.catalog_highest_sequence = 7;
                s.preferred.insert("blender".into(), "cypher:blender:5.2.2".into());
            })
            .unwrap();
        let reloaded = StateStore::load_from(path).unwrap();
        assert_eq!(reloaded.read(|s| s.installations.len()), 1);
        assert_eq!(reloaded.read(|s| s.catalog_highest_sequence), 7);
    }

    #[test]
    fn corrupt_state_is_quarantined() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        std::fs::write(&path, b"{ nicht json").unwrap();
        let store = StateStore::load_from(path.clone()).unwrap();
        assert_eq!(store.snapshot(), PersistedState::default());
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(leftovers.iter().any(|n| n.starts_with("state.json.corrupt-")), "{leftovers:?}");
    }

    #[test]
    fn newer_schema_is_refused_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        std::fs::write(&path, br#"{"schemaVersion": 99}"#).unwrap();
        assert!(StateStore::load_from(path.clone()).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), br#"{"schemaVersion": 99}"#);
    }

    #[test]
    fn old_files_without_version_migrate() {
        let state = migrate(serde_json::json!({ "catalogHighestSequence": 3, "installations": [] })).unwrap();
        assert_eq!(state.schema_version, STATE_SCHEMA_VERSION);
        assert_eq!(state.catalog_highest_sequence, 3);
    }

    #[test]
    fn doc_example_shape_is_readable() {
        // Form aus ARCHITEKTUR.md 4.3
        let json = serde_json::json!({
            "schemaVersion": 1,
            "catalogHighestSequence": 7,
            "installations": [{
                "id": "cypher:blender:5.2.2", "programId": "blender", "version": "5.2.2", "kind": "cypher",
                "path": "C:\\Users\\x\\AppData\\Local\\de.cypherxcypher.studio\\data\\programs\\blender\\5.2.2",
                "launcher": { "type": "exe", "relExe": "blender.exe" },
                "programsRoot": null,
                "installedAt": "2026-10-20T10:00:00Z",
                "verified": { "sha256": "00", "catalogSequence": 7, "signatureChecked": false },
                "artifact": { "url": "https://download.blender.org/x.zip", "kind": "zip" },
                "notNotarized": false
            }],
            "manualInstallations": [{ "id": "manual:krita:ab12", "programId": "krita", "path": "D:\\Tools\\krita\\bin\\krita.exe" }],
            "preferred": { "blender": "cypher:blender:5.2.2" },
            "setups": [],
            "projectIndex": [{ "id": "1f0c", "dir": "D:\\Sync\\Cypher\\Projekte\\Herbst-Drop 26", "lastOpenedAt": "2026-10-20T11:00:00Z" }],
            "libraryRoot": "D:\\Sync\\Cypher"
        });
        let state = migrate(json.clone()).unwrap();
        assert_eq!(state.installations[0].launcher, StoredLauncher::Exe { rel_exe: "blender.exe".into() });
        assert_eq!(serde_json::to_value(&state).unwrap(), json);
    }

    #[test]
    fn failed_write_keeps_old_state() {
        let dir = tempfile::tempdir().unwrap();
        // Das Ziel ist ein Ordner: Umbenennen der Temp-Datei darauf scheitert.
        let path = dir.path().join("state.json");
        std::fs::create_dir_all(path.join("blockiert")).unwrap();
        let store = StateStore { path, state: RwLock::new(PersistedState::default()) };
        assert!(store.update(|s| s.catalog_highest_sequence = 9).is_err());
        assert_eq!(store.read(|s| s.catalog_highest_sequence), 0);
    }
}
