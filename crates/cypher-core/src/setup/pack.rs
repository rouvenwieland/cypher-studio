//! Einrichtungspakete laden und prüfen (`packs/<id>/pack.json`, ARCHITEKTUR.md 4.4).
//!
//! Ein Paket nennt nur `root` + `rel`; welcher Ordner dahintersteckt, entscheidet allein [`super::roots`]. Beim Laden
//! wird die Struktur geprüft (Verweise, Pfade, Versionsbereiche) und, dass jede Quelldatei existiert und eine Prüfsumme
//! hat. Die Prüfsumme des Inhalts wird erst beim Anwenden gegen die gelesenen Bytes geprüft (kein doppeltes Lesen).

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::api::{Os, SetupComponentKind};
use crate::catalog::VersionRange;
use crate::error::{IoError, SetupError};
use crate::platform::fsx;

use super::roots::RootId;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentPreview {
    #[serde(default)]
    pub colors: Vec<String>,
    #[serde(default)]
    pub formats: Vec<String>,
    #[serde(default)]
    pub fonts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackComponent {
    pub id: String,
    pub kind: SetupComponentKind,
    pub label: String,
    pub optional: bool,
    /// Standardmäßig angehakt? Fehlt die Angabe: Pflichtbausteine ja, optionale nein.
    #[serde(default)]
    pub default_selected: Option<bool>,
    /// Ausweichweg für einen anderen Baustein: wird nie zusammen mit ihm angewendet.
    #[serde(default)]
    pub fallback_for: Option<String>,
    pub files: Vec<String>,
    #[serde(default)]
    pub preview: Option<ComponentPreview>,
}

impl PackComponent {
    pub fn is_default_selected(&self) -> bool {
        self.default_selected.unwrap_or(!self.optional)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackFile {
    pub id: String,
    pub src: String,
    pub root: RootId,
    pub rel: String,
    #[serde(default)]
    pub platforms: Option<Vec<Os>>,
    #[serde(default)]
    pub program_versions: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PackAction {
    /// Schrift im Benutzer-Schriftordner anmelden (Datei steht unter `files`, Wurzel `userFonts`).
    InstallFont { file: String, display_name: String },
    /// Kleine JSON-Datei aus festen Feldern (Platzhalter nur `{libraryRoot}`).
    WriteConfig { root: RootId, rel: String, fields: BTreeMap<String, String> },
    /// Blender-Erweiterung über die Blender-Kommandozeile installieren.
    BlenderExtensionInstall { zip: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPack {
    id: String,
    program_id: Option<String>,
    version: String,
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    program_versions: Option<String>,
    #[serde(default)]
    requires_packs: Vec<String>,
    #[serde(default)]
    requires_program_closed: bool,
    components: Vec<PackComponent>,
    files: Vec<PackFile>,
    #[serde(default)]
    actions: Vec<PackAction>,
    #[serde(default)]
    sha256: BTreeMap<String, String>,
}

/// Ein geladenes, geprüftes Paket.
#[derive(Debug, Clone)]
pub struct PackManifest {
    pub id: String,
    pub program_id: Option<String>,
    pub version: String,
    pub title: String,
    pub description: String,
    pub program_versions: Option<VersionRange>,
    pub requires_packs: Vec<String>,
    pub requires_program_closed: bool,
    pub components: Vec<PackComponent>,
    pub files: Vec<PackFile>,
    pub actions: Vec<PackAction>,
    /// Prüfsumme je Quelldatei (Schlüssel = `src`).
    pub sha256: BTreeMap<String, String>,
    /// Ordner des Pakets.
    pub dir: PathBuf,
    /// Wurzel aller Pakete (Quelldateien dürfen nur hier liegen).
    pub packs_root: PathBuf,
}

/// Löst `.` und `..` rein textlich auf; `None`, wenn der Pfad über seine Wurzel hinausführt.
fn lexical_normalize(path: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::Prefix(_) | Component::RootDir => out.push(comp.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            Component::Normal(n) => out.push(n),
        }
    }
    Some(out)
}

fn invalid(pack: &str, reason: impl std::fmt::Display) -> SetupError {
    SetupError::InvalidPack(format!("{pack}: {reason}"))
}

fn check_range(pack: &str, what: &str, text: &str) -> Result<VersionRange, SetupError> {
    VersionRange::parse(text).map_err(|e| invalid(pack, format!("{what}: Versionsbereich `{text}` ungültig ({e})")))
}

impl PackManifest {
    /// Lädt `<dir>/pack.json`. `require_hashes`: jede Quelldatei braucht einen Eintrag in `sha256` (gebaute Pakete).
    pub fn load(dir: &Path, packs_root: &Path, require_hashes: bool) -> Result<Self, SetupError> {
        let json_path = dir.join("pack.json");
        let bytes = std::fs::read(&json_path).map_err(|e| IoError::read(&json_path, e))?;
        let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "?".into());
        let raw: RawPack =
            serde_json::from_slice(&bytes).map_err(|e| invalid(&name, format!("pack.json nicht lesbar: {e}")))?;
        Self::from_raw(raw, dir, packs_root, require_hashes)
    }

    fn from_raw(raw: RawPack, dir: &Path, packs_root: &Path, require_hashes: bool) -> Result<Self, SetupError> {
        let id = raw.id.clone();
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
            return Err(invalid(&id, "Paket-ID muss aus a-z, 0-9 und - bestehen"));
        }
        if semver::Version::parse(&raw.version).is_err() {
            return Err(invalid(&id, format!("Version `{}` ist keine SemVer-Version", raw.version)));
        }
        let program_versions =
            raw.program_versions.as_deref().map(|t| check_range(&id, "programVersions", t)).transpose()?;
        if raw.components.is_empty() {
            return Err(invalid(&id, "keine Bausteine"));
        }

        // Dateien: eindeutige IDs, sichere Zielpfade, Quelle innerhalb der Paketwurzel
        let mut file_ids = BTreeSet::new();
        let mut targets = BTreeSet::new();
        for f in &raw.files {
            if !file_ids.insert(f.id.clone()) {
                return Err(invalid(&id, format!("Datei-ID `{}` doppelt", f.id)));
            }
            fsx::split_rel(&f.rel)
                .map_err(|e| invalid(&id, format!("Datei `{}`: Zielpfad `{}` ist {e}", f.id, f.rel)))?;
            if !targets.insert((f.root, fsx::duplicate_key(&f.rel))) {
                return Err(invalid(&id, format!("Ziel `{}` kommt doppelt vor", f.rel)));
            }
            if let Some(v) = &f.program_versions {
                check_range(&id, &format!("Datei `{}`", f.id), v)?;
            }
            let src = Self::resolve_src_in(dir, packs_root, &f.src).ok_or_else(|| {
                invalid(&id, format!("Datei `{}`: Quelle `{}` liegt außerhalb der Pakete", f.id, f.src))
            })?;
            if !src.is_file() {
                return Err(invalid(&id, format!("Datei `{}`: Quelle `{}` fehlt", f.id, f.src)));
            }
            if require_hashes && !raw.sha256.contains_key(&f.src) {
                return Err(invalid(&id, format!("Datei `{}`: Prüfsumme für `{}` fehlt", f.id, f.src)));
            }
        }
        // Bausteine: eindeutige IDs, Verweise auf Dateien und Ausweichwege
        let mut component_ids = BTreeSet::new();
        for c in &raw.components {
            if !component_ids.insert(c.id.clone()) {
                return Err(invalid(&id, format!("Baustein-ID `{}` doppelt", c.id)));
            }
            for file in &c.files {
                if !file_ids.contains(file) {
                    return Err(invalid(&id, format!("Baustein `{}` verweist auf unbekannte Datei `{file}`", c.id)));
                }
            }
        }
        for c in &raw.components {
            if let Some(target) = &c.fallback_for
                && !component_ids.contains(target)
            {
                return Err(invalid(
                    &id,
                    format!("Baustein `{}`: Ausweichweg für unbekannten Baustein `{target}`", c.id),
                ));
            }
        }
        // Aktionen
        for action in &raw.actions {
            match action {
                PackAction::InstallFont { file, .. } => {
                    let f = raw
                        .files
                        .iter()
                        .find(|f| &f.id == file)
                        .ok_or_else(|| invalid(&id, format!("installFont: unbekannte Datei `{file}`")))?;
                    if f.root != RootId::UserFonts {
                        return Err(invalid(&id, format!("installFont `{file}`: nur für die Wurzel userFonts")));
                    }
                }
                PackAction::WriteConfig { rel, fields, .. } => {
                    fsx::split_rel(rel).map_err(|e| invalid(&id, format!("writeConfig `{rel}`: {e}")))?;
                    for value in fields.values() {
                        if let Some(bad) = unknown_placeholder(value) {
                            return Err(invalid(&id, format!("writeConfig: unbekannter Platzhalter `{bad}`")));
                        }
                    }
                }
                PackAction::BlenderExtensionInstall { zip } => {
                    let zip_path = Self::resolve_src_in(dir, packs_root, zip).ok_or_else(|| {
                        invalid(&id, format!("blenderExtensionInstall: `{zip}` liegt außerhalb der Pakete"))
                    })?;
                    if !zip_path.is_file() {
                        return Err(invalid(&id, format!("blenderExtensionInstall: `{zip}` fehlt")));
                    }
                    // Eine Prüfsumme für das ZIP ist erwünscht, aber nicht Pflicht: das Paket liegt im signierten App-Bündel,
                    // und ohne Eintrag berechnet der Plan die Summe aus der Datei (Team C trägt sie bisher nicht ein)
                }
            }
        }
        for dep in &raw.requires_packs {
            if dep == &id {
                return Err(invalid(&id, "requiresPacks verweist auf das Paket selbst"));
            }
        }
        Ok(PackManifest {
            id,
            program_id: raw.program_id,
            version: raw.version,
            title: raw.title,
            description: raw.description,
            program_versions,
            requires_packs: raw.requires_packs,
            requires_program_closed: raw.requires_program_closed,
            components: raw.components,
            files: raw.files,
            actions: raw.actions,
            sha256: raw.sha256,
            dir: dir.to_path_buf(),
            packs_root: packs_root.to_path_buf(),
        })
    }

    fn resolve_src_in(dir: &Path, packs_root: &Path, src: &str) -> Option<PathBuf> {
        if src.is_empty() || src.starts_with('/') || src.starts_with('\\') || src.contains(':') || src.contains('\\') {
            return None;
        }
        let joined = lexical_normalize(&dir.join(src))?;
        let root = lexical_normalize(packs_root)?;
        joined.starts_with(&root).then_some(joined)
    }

    /// Absoluter Pfad einer Quelldatei oder eines ZIPs (`src` bzw. `zip`).
    pub fn src_path(&self, src: &str) -> Option<PathBuf> {
        Self::resolve_src_in(&self.dir, &self.packs_root, src)
    }

    pub fn file(&self, id: &str) -> Option<&PackFile> {
        self.files.iter().find(|f| f.id == id)
    }

    pub fn component(&self, id: &str) -> Option<&PackComponent> {
        self.components.iter().find(|c| c.id == id)
    }

    /// Welche Datei gehört zu welchem Baustein (jede Datei höchstens einem).
    pub fn component_of_file(&self, file_id: &str) -> Option<&PackComponent> {
        self.components.iter().find(|c| c.files.iter().any(|f| f == file_id))
    }
}

/// Platzhalter in Konfigurationswerten: nur `{libraryRoot}` ist erlaubt.
fn unknown_placeholder(value: &str) -> Option<String> {
    let mut rest = value;
    while let Some(start) = rest.find('{') {
        let after = &rest[start + 1..];
        let end = after.find('}')?;
        let name = &after[..end];
        if name != "libraryRoot" {
            return Some(format!("{{{name}}}"));
        }
        rest = &after[end + 1..];
    }
    None
}

/// Setzt die erlaubten Platzhalter ein. `None`, wenn ein Platzhalter nicht belegt ist.
pub fn expand_placeholders(value: &str, library_root: Option<&Path>) -> Option<String> {
    if !value.contains("{libraryRoot}") {
        return Some(value.to_owned());
    }
    let root = library_root?.to_string_lossy().replace('\\', "/");
    Some(value.replace("{libraryRoot}", root.trim_end_matches('/')))
}

/// Ergebnis von [`load_packs`].
#[derive(Debug, Default)]
pub struct LoadedPacks {
    pub packs: Vec<PackManifest>,
    /// Pakete, die nicht geladen werden konnten (Ordner, Grund).
    pub problems: Vec<(String, String)>,
}

/// Lädt alle Pakete unterhalb von `packs_root` (`<id>/pack.json`).
pub fn load_packs(packs_root: &Path, require_hashes: bool) -> LoadedPacks {
    let mut out = LoadedPacks::default();
    let Ok(read) = std::fs::read_dir(packs_root) else { return out };
    let mut dirs: Vec<PathBuf> =
        read.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.join("pack.json").is_file()).collect();
    dirs.sort();
    for dir in dirs {
        let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        match PackManifest::load(&dir, packs_root, require_hashes) {
            Ok(p) => out.packs.push(p),
            Err(e) => out.problems.push((name, e.to_string())),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) fn write_pack(root: &Path, id: &str, value: &serde_json::Value, files: &[(&str, &[u8])]) -> PathBuf {
        let dir = root.join(id);
        std::fs::create_dir_all(&dir).unwrap();
        for (rel, bytes) in files {
            let p = dir.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, bytes).unwrap();
        }
        std::fs::write(dir.join("pack.json"), serde_json::to_vec_pretty(value).unwrap()).unwrap();
        dir
    }

    fn base(sha: bool) -> serde_json::Value {
        let mut v = json!({
            "id": "demo", "programId": "krita", "version": "1.2.0", "title": "Demo",
            "programVersions": ">=5.2, <6",
            "components": [
                { "id": "a", "kind": "bundle", "label": "A", "optional": false, "files": ["f1"] },
                { "id": "b", "kind": "palette", "label": "B", "optional": true, "fallbackFor": "a", "files": ["f2"] }
            ],
            "files": [
                { "id": "f1", "src": "x/one.txt", "root": "kritaResources", "rel": "bundles/one.txt" },
                { "id": "f2", "src": "x/two.txt", "root": "kritaResources", "rel": "paletten/two.txt", "platforms": ["windows", "linux"] }
            ],
            "actions": []
        });
        if sha {
            v["sha256"] = json!({ "x/one.txt": "00", "x/two.txt": "00" });
        }
        v
    }

    #[test]
    fn valid_pack_loads_with_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let pd = write_pack(dir.path(), "demo", &base(true), &[("x/one.txt", b"1"), ("x/two.txt", b"2")]);
        let p = PackManifest::load(&pd, dir.path(), true).unwrap();
        assert_eq!(p.id, "demo");
        assert_eq!(p.files.len(), 2);
        assert!(p.component("a").unwrap().is_default_selected());
        assert!(!p.component("b").unwrap().is_default_selected());
        assert_eq!(p.file("f2").unwrap().platforms, Some(vec![Os::Windows, Os::Linux]));
        assert_eq!(p.component_of_file("f2").unwrap().id, "b");
        assert!(p.src_path("x/one.txt").unwrap().is_file());
    }

    #[test]
    fn missing_hash_or_source_is_rejected_when_hashes_are_required() {
        let dir = tempfile::tempdir().unwrap();
        let pd = write_pack(dir.path(), "demo", &base(false), &[("x/one.txt", b"1"), ("x/two.txt", b"2")]);
        assert!(PackManifest::load(&pd, dir.path(), false).is_ok());
        let e = PackManifest::load(&pd, dir.path(), true).unwrap_err();
        assert!(e.to_string().contains("Prüfsumme"), "{e}");
        let dir2 = tempfile::tempdir().unwrap();
        let pd2 = write_pack(dir2.path(), "demo", &base(true), &[("x/one.txt", b"1")]);
        let e = PackManifest::load(&pd2, dir2.path(), true).unwrap_err();
        assert!(e.to_string().contains("fehlt"), "{e}");
    }

    #[test]
    fn unsafe_targets_sources_and_references_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let files: [(&str, &[u8]); 2] = [("x/one.txt", b"1"), ("x/two.txt", b"2")];
        type Mutation = Box<dyn Fn(&mut serde_json::Value)>;
        let cases: Vec<(&str, Mutation)> = vec![
            ("Zielpfad", Box::new(|v| v["files"][0]["rel"] = json!("../draussen.txt"))),
            ("Zielpfad", Box::new(|v| v["files"][0]["rel"] = json!("/etc/passwd"))),
            ("Zielpfad", Box::new(|v| v["files"][0]["rel"] = json!("C:\\x.txt"))),
            ("außerhalb", Box::new(|v| v["files"][0]["src"] = json!("../../../etc/passwd"))),
            ("außerhalb", Box::new(|v| v["files"][0]["src"] = json!("/etc/passwd"))),
            ("unbekannte Datei", Box::new(|v| v["components"][0]["files"] = json!(["gibtsnicht"]))),
            ("doppelt", Box::new(|v| v["files"][1]["rel"] = json!("bundles/one.txt"))),
            ("doppelt", Box::new(|v| v["files"][1]["id"] = json!("f1"))),
            ("SemVer", Box::new(|v| v["version"] = json!("eins"))),
            ("Versionsbereich", Box::new(|v| v["programVersions"] = json!("irgendwas"))),
            ("Ausweichweg", Box::new(|v| v["components"][1]["fallbackFor"] = json!("zz"))),
            ("Paket-ID", Box::new(|v| v["id"] = json!("Gross"))),
            (
                "Platzhalter",
                Box::new(|v| {
                    v["actions"] = json!([{ "type": "writeConfig", "root": "kritaResources", "rel": "c.json", "fields": { "a": "{home}/x" } }]);
                }),
            ),
            (
                "userFonts",
                Box::new(|v| {
                    v["actions"] = json!([{ "type": "installFont", "file": "f1", "displayName": "X" }]);
                }),
            ),
        ];
        for (expect, mutate) in cases {
            let mut v = base(true);
            mutate(&mut v);
            let pd = write_pack(dir.path(), "demo", &v, &files);
            let e = PackManifest::load(&pd, dir.path(), true).expect_err(expect);
            assert!(e.to_string().contains(expect), "{expect}: {e}");
        }
    }

    #[test]
    fn source_may_point_to_a_sibling_directory_inside_the_packs_root() {
        // `../shared/…` ist erlaubt (gemeinsame Schriften), solange es in der Paketwurzel bleibt
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("shared")).unwrap();
        std::fs::write(dir.path().join("shared/font.ttf"), b"f").unwrap();
        let mut v = base(true);
        v["files"][0]["src"] = json!("../shared/font.ttf");
        v["sha256"] = json!({ "../shared/font.ttf": "00", "x/two.txt": "00" });
        let pd = write_pack(dir.path(), "demo", &v, &[("x/two.txt", b"2")]);
        assert!(PackManifest::load(&pd, dir.path(), true).is_ok());
    }

    #[test]
    fn placeholders() {
        assert_eq!(unknown_placeholder("{libraryRoot}/3D"), None);
        assert_eq!(unknown_placeholder("a{x}b"), Some("{x}".into()));
        assert_eq!(
            expand_placeholders("{libraryRoot}/3D", Some(Path::new("D:\\Sync\\Cypher"))).as_deref(),
            Some("D:/Sync/Cypher/3D")
        );
        assert_eq!(expand_placeholders("{libraryRoot}/3D", None), None);
        assert_eq!(expand_placeholders("fest", None).as_deref(), Some("fest"));
    }

    #[test]
    fn load_packs_collects_good_and_bad() {
        let dir = tempfile::tempdir().unwrap();
        write_pack(dir.path(), "demo", &base(true), &[("x/one.txt", b"1"), ("x/two.txt", b"2")]);
        write_pack(dir.path(), "kaputt", &json!({ "id": "kaputt" }), &[]);
        std::fs::create_dir_all(dir.path().join("shared")).unwrap();
        let loaded = load_packs(dir.path(), true);
        assert_eq!(loaded.packs.len(), 1);
        assert_eq!(loaded.problems.len(), 1);
        assert_eq!(loaded.problems[0].0, "kaputt");
    }

    #[test]
    fn lexical_normalization() {
        assert_eq!(lexical_normalize(Path::new("/a/b/../c/./d")), Some(PathBuf::from("/a/c/d")));
        assert_eq!(lexical_normalize(Path::new("a/../..")), None);
    }
}
