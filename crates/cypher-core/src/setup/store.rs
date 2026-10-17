//! Speicher der Einrichtung: Manifeste, Sicherungen, Journale (`<data>/setup/…`, ARCHITEKTUR.md 4.4).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::api::ScopeKind;
use crate::error::{IoError, SetupError};
use crate::platform::fsx;

use super::roots::RootId;

pub const MANIFEST_FORMAT_VERSION: u32 = 1;

/// Was mit einer Datei geschehen ist.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryOp {
    /// Datei war nicht da.
    Create,
    /// Eigene, unveränderte Datei durch die neue Fassung ersetzt (alte Fassung gesichert).
    Update,
    /// Fremde oder geänderte Datei überschrieben (gesichert).
    Overwrite,
    /// Neben die vorhandene Datei gelegt.
    KeepBoth,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRef {
    /// Relativ zu `<data>/setup/`.
    pub rel: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub component: String,
    pub root: RootId,
    /// Relativ zur Wurzel, mit `/`.
    pub rel: String,
    pub op: EntryOp,
    /// SHA-256 der geschriebenen Datei.
    pub sha256: String,
    pub bytes: u64,
    #[serde(default)]
    pub backup: Option<BackupRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontEntry {
    pub root: RootId,
    pub rel: String,
    pub display_name: String,
    /// Windows: Name des Registrywerts; sonst leer.
    #[serde(default)]
    pub registry_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionEntry {
    /// `blenderExtensionInstall`
    pub kind: String,
    /// SHA-256 des installierten ZIPs.
    pub sha256: String,
    pub exit_code: Option<i32>,
    /// Blender-Startdatei, mit der installiert wurde (zum Entfernen beim Zurücknehmen).
    #[serde(default)]
    pub exe: Option<String>,
    /// Kennung der Erweiterung (`id` aus `blender_manifest.toml`).
    #[serde(default)]
    pub package: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailureEntry {
    pub root: RootId,
    pub rel: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ManifestStatus {
    Applied,
    Partial,
    Undone,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format_version: u32,
    pub setup_id: String,
    pub pack_id: String,
    pub program_id: Option<String>,
    pub pack_version: String,
    pub scope_id: String,
    pub scope_kind: ScopeKind,
    pub roots: std::collections::BTreeMap<RootId, String>,
    pub applied_at: String,
    pub status: ManifestStatus,
    /// Angewendete Bausteine.
    pub components: Vec<String>,
    pub entries: Vec<ManifestEntry>,
    #[serde(default)]
    pub fonts: Vec<FontEntry>,
    #[serde(default)]
    pub actions: Vec<ActionEntry>,
    #[serde(default)]
    pub failures: Vec<FailureEntry>,
    #[serde(default)]
    pub undone_at: Option<String>,
    /// Laufende Nummer (Millisekunden, streng steigend): ordnet Einrichtungen auch innerhalb einer Sekunde.
    #[serde(default)]
    pub sequence: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JournalState {
    Applying,
    Undoing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Journal {
    pub state: JournalState,
    pub setup_id: String,
    /// Bereits ausgeführte Schritte (alles, was zum Zurückrollen nötig ist).
    pub entries: Vec<ManifestEntry>,
    #[serde(default)]
    pub fonts: Vec<FontEntry>,
    /// Aufgelöste Wurzeln, damit das Zurückrollen ohne neue Erkennung geht.
    pub roots: std::collections::BTreeMap<RootId, String>,
}

/// Dateisystem-Speicher der Einrichtung.
#[derive(Debug, Clone)]
pub struct SetupStore {
    root: PathBuf,
}

impl SetupStore {
    /// `root` = `<data>/setup`.
    pub fn new(root: PathBuf) -> Self {
        SetupStore { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn manifests_dir(&self) -> PathBuf {
        self.root.join("manifests")
    }

    fn journal_dir(&self) -> PathBuf {
        self.root.join("journal")
    }

    pub fn manifest_path(&self, setup_id: &str) -> PathBuf {
        self.manifests_dir().join(format!("{setup_id}.json"))
    }

    pub fn journal_path(&self, setup_id: &str) -> PathBuf {
        self.journal_dir().join(format!("{setup_id}.json"))
    }

    /// Pfad einer Sicherung (`backups/<setupId>/<root>/<rel>`), relativ zu `root`.
    pub fn backup_rel(setup_id: &str, root: RootId, rel: &str) -> String {
        format!("backups/{setup_id}/{}/{rel}", root.as_str())
    }

    pub fn resolve(&self, store_rel: &str) -> Result<PathBuf, SetupError> {
        Ok(fsx::safe_join(&self.root, store_rel)?)
    }

    pub fn save_manifest(&self, m: &Manifest) -> Result<(), IoError> {
        fsx::write_json_atomic(&self.manifest_path(&m.setup_id), m)
    }

    pub fn load_manifest(&self, setup_id: &str) -> Result<Option<Manifest>, IoError> {
        fsx::read_json(&self.manifest_path(setup_id))
    }

    /// Alle lesbaren Manifeste, älteste zuerst. Kaputte Dateien werden übersprungen.
    pub fn list_manifests(&self) -> Vec<Manifest> {
        let mut out: Vec<Manifest> = Vec::new();
        let Ok(read) = std::fs::read_dir(self.manifests_dir()) else { return out };
        for e in read.filter_map(Result::ok) {
            if e.path().extension().is_some_and(|x| x == "json")
                && let Ok(Some(m)) = fsx::read_json::<Manifest>(&e.path())
            {
                out.push(m);
            }
        }
        out.sort_by(|a, b| {
            a.sequence
                .cmp(&b.sequence)
                .then_with(|| a.applied_at.cmp(&b.applied_at))
                .then_with(|| a.setup_id.cmp(&b.setup_id))
        });
        out
    }

    pub fn save_journal(&self, j: &Journal) -> Result<(), IoError> {
        fsx::write_json_atomic(&self.journal_path(&j.setup_id), j)
    }

    pub fn remove_journal(&self, setup_id: &str) {
        let _ = std::fs::remove_file(self.journal_path(setup_id));
    }

    /// Alle offenen Journale.
    pub fn list_journals(&self) -> Vec<Journal> {
        let mut out = Vec::new();
        let Ok(read) = std::fs::read_dir(self.journal_dir()) else { return out };
        for e in read.filter_map(Result::ok) {
            if let Ok(Some(j)) = fsx::read_json::<Journal>(&e.path()) {
                out.push(j);
            }
        }
        out
    }

    /// Nächste laufende Nummer: Millisekunden seit 1970, aber immer größer als alle vorhandenen.
    pub fn next_sequence(&self) -> u64 {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let highest = self.list_manifests().iter().map(|m| m.sequence).max().unwrap_or(0);
        now.max(highest + 1)
    }

    pub fn remove_backups(&self, setup_id: &str) {
        let _ = std::fs::remove_dir_all(self.root.join("backups").join(setup_id));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(id: &str, at: &str) -> Manifest {
        Manifest {
            format_version: MANIFEST_FORMAT_VERSION,
            setup_id: id.into(),
            pack_id: "krita".into(),
            program_id: Some("krita".into()),
            pack_version: "1.0.0".into(),
            scope_id: "s1".into(),
            scope_kind: ScopeKind::UserProfile,
            roots: [(RootId::KritaResources, "/x".to_owned())].into(),
            applied_at: at.into(),
            status: ManifestStatus::Applied,
            components: vec!["bundle".into()],
            entries: vec![ManifestEntry {
                component: "bundle".into(),
                root: RootId::KritaResources,
                rel: "a/b.txt".into(),
                op: EntryOp::Create,
                sha256: "ab".into(),
                bytes: 3,
                backup: None,
            }],
            fonts: vec![],
            actions: vec![],
            failures: vec![],
            undone_at: None,
            sequence: 0,
        }
    }

    #[test]
    fn manifests_round_trip_and_are_sorted_by_time() {
        let dir = tempfile::tempdir().unwrap();
        let store = SetupStore::new(dir.path().join("setup"));
        store.save_manifest(&manifest("b", "2026-10-02T00:00:00Z")).unwrap();
        store.save_manifest(&manifest("a", "2026-10-01T00:00:00Z")).unwrap();
        let all = store.list_manifests();
        assert_eq!(all.iter().map(|m| m.setup_id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(store.load_manifest("a").unwrap().unwrap(), manifest("a", "2026-10-01T00:00:00Z"));
        assert!(store.load_manifest("fehlt").unwrap().is_none());
    }

    #[test]
    fn broken_manifest_files_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let store = SetupStore::new(dir.path().join("setup"));
        store.save_manifest(&manifest("ok", "2026-10-01T00:00:00Z")).unwrap();
        std::fs::write(store.manifest_path("kaputt"), b"{ nicht json").unwrap();
        assert_eq!(store.list_manifests().len(), 1);
    }

    #[test]
    fn journal_lifecycle() {
        let dir = tempfile::tempdir().unwrap();
        let store = SetupStore::new(dir.path().join("setup"));
        let j = Journal {
            state: JournalState::Applying,
            setup_id: "x".into(),
            entries: vec![],
            fonts: vec![],
            roots: Default::default(),
        };
        store.save_journal(&j).unwrap();
        assert_eq!(store.list_journals(), vec![j]);
        store.remove_journal("x");
        assert!(store.list_journals().is_empty());
    }

    #[test]
    fn backup_paths_stay_inside_the_store() {
        let rel = SetupStore::backup_rel("abc", RootId::KritaResources, "templates/a.kpl");
        assert_eq!(rel, "backups/abc/kritaResources/templates/a.kpl");
        let dir = tempfile::tempdir().unwrap();
        let store = SetupStore::new(dir.path().to_path_buf());
        assert!(store.resolve(&rel).unwrap().starts_with(dir.path()));
        assert!(store.resolve("../../etc/passwd").is_err());
    }
}
