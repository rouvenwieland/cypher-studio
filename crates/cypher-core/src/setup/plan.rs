//! Einrichtung planen: Was würde an welcher Datei geschehen? (ARCHITEKTUR.md 2.10, Tabelle der Idempotenz- und
//! Sicherungsregeln.) Der Plan wird dem Nutzer gezeigt und genau so ausgeführt (siehe [`super::apply`]).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use super::{hash_bytes, hash_file};
use crate::api::{
    ConflictReason, Os, SetupComponent, SetupComponentPreview, SetupComponentStatus, SetupConflict, SetupOperation,
    SetupOperationKind, SetupPlan,
};
use crate::catalog::ProgVer;
use crate::error::{IoError, SetupError};
use crate::plans::PLAN_TTL;
use crate::platform::{display_path, fsx};
use crate::util::{iso_after, new_id, now_iso, short_hash};

use super::pack::{PackAction, PackComponent, PackManifest, expand_placeholders};
use super::roots::{ResolvedScope, RootId};
use super::store::{Manifest, ManifestStatus, SetupStore};

/// Was mit einer Datei geschehen soll.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Create,
    /// Eigene, unveränderte Datei durch die neue Fassung ersetzen.
    Update,
    /// Datei ist schon so, wie sie sein soll.
    Skip,
    Conflict {
        conflict_id: String,
        reason: ConflictReason,
        keep_both_rel: String,
    },
}

#[derive(Debug, Clone)]
pub enum ItemKind {
    /// Datei aus dem Paket.
    File { src: PathBuf, src_key: String },
    /// Erzeugte JSON-Konfiguration (`writeConfig`).
    Config { content: Vec<u8> },
    /// Schrift anmelden; `run` sagt, ob das nötig ist (Datei neu oder noch nicht angemeldet).
    Font { file_id: String, display_name: String, run: bool },
    /// Blender-Erweiterung installieren; `run` sagt, ob das nötig ist.
    BlenderExtension { zip: PathBuf, zip_key: String, run: bool },
}

#[derive(Debug, Clone)]
pub struct PlanItem {
    pub component: String,
    /// Datei-ID bzw. Aktionsname, für die Anzeige.
    pub source_id: String,
    pub root: RootId,
    pub rel: String,
    pub target: PathBuf,
    pub sha256: String,
    pub bytes: u64,
    pub decision: Decision,
    pub kind: ItemKind,
}

/// Ein berechneter Plan mit allem, was zum Ausführen nötig ist.
#[derive(Debug, Clone)]
pub struct SetupPlanData {
    pub dto: SetupPlan,
    pub pack: PackManifest,
    pub scope: ResolvedScope,
    pub items: Vec<PlanItem>,
    /// Fremde Pakete, die zuerst eingerichtet sein sollten (nur Hinweis).
    pub missing_requirements: Vec<String>,
}

/// Eingaben für [`plan`].
pub struct PlanInput<'a> {
    pub pack: &'a PackManifest,
    pub scope: &'a ResolvedScope,
    pub store: &'a SetupStore,
    pub os: Os,
    /// Version der Installation (für `programVersions` an einzelnen Dateien).
    pub program_version: Option<&'a str>,
    pub library_root: Option<&'a Path>,
    pub program_running: bool,
}

/// Neuester nicht zurückgenommener Eintrag für Paket und Bereich.
pub fn latest_manifest(store: &SetupStore, pack_id: &str, scope_id: &str) -> Option<Manifest> {
    store
        .list_manifests()
        .into_iter()
        .rev()
        .find(|m| m.pack_id == pack_id && m.scope_id == scope_id && m.status != ManifestStatus::Undone)
}

fn file_applies(input: &PlanInput<'_>, f: &super::pack::PackFile) -> bool {
    if let Some(platforms) = &f.platforms
        && !platforms.contains(&input.os)
    {
        return false;
    }
    if let Some(range) = &f.program_versions
        && let (Ok(range), Some(version)) = (crate::catalog::VersionRange::parse(range), input.program_version)
        && let Ok(v) = ProgVer::parse(version)
    {
        return range.matches(&v);
    }
    true
}

fn file_name_of(rel: &str) -> (String, String) {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    match name.rfind('.') {
        Some(i) if i > 0 => (name[..i].to_owned(), name[i..].to_owned()),
        _ => (name.to_owned(), String::new()),
    }
}

/// Name für „daneben ablegen“: `Name (Cypher 1.2.0).ext`, bei Kollision mit Zähler.
fn keep_both_rel(rel: &str, version: &str, target_root: &Path) -> String {
    let (dir, name) = match rel.rfind('/') {
        Some(i) => (&rel[..=i], &rel[i + 1..]),
        None => ("", rel),
    };
    let (stem, ext) = file_name_of(name);
    let mut n = 1;
    loop {
        let suffix = if n == 1 { format!(" (Cypher {version})") } else { format!(" (Cypher {version}, {n})") };
        let candidate = format!("{dir}{stem}{suffix}{ext}");
        if !target_root.join(&candidate).exists() {
            return candidate;
        }
        n += 1;
    }
}

/// Baut den Inhalt von `writeConfig`: feste Felder, sortiert, schön formatiert.
fn config_bytes(fields: &BTreeMap<String, String>, library_root: Option<&Path>) -> Option<Vec<u8>> {
    let mut map = serde_json::Map::new();
    for (k, v) in fields {
        map.insert(k.clone(), serde_json::Value::String(expand_placeholders(v, library_root)?));
    }
    let mut out = serde_json::to_vec_pretty(&serde_json::Value::Object(map)).ok()?;
    out.push(b'\n');
    Some(out)
}

/// Bausteine, zu denen Aktionen ohne Datei gehören: der Baustein der Art `extension`, sonst der erste.
fn action_component(pack: &PackManifest) -> Option<&PackComponent> {
    pack.components
        .iter()
        .find(|c| c.kind == crate::api::SetupComponentKind::Extension)
        .or_else(|| pack.components.first())
}

fn decide(
    prev: Option<&Manifest>,
    root: RootId,
    rel: &str,
    target: &Path,
    expected_sha: &str,
    pack_version: &str,
    root_dir: &Path,
) -> Result<Decision, SetupError> {
    if !target.exists() {
        return Ok(Decision::Create);
    }
    if target.is_dir() {
        return Ok(Decision::Conflict {
            conflict_id: short_hash(&format!("{}:{rel}", root.as_str())),
            reason: ConflictReason::ForeignFile,
            keep_both_rel: keep_both_rel(rel, pack_version, root_dir),
        });
    }
    let current = hash_file(target)?;
    if current == expected_sha {
        return Ok(Decision::Skip);
    }
    let ours = prev.and_then(|m| m.entries.iter().find(|e| e.root == root && e.rel == rel));
    match ours {
        Some(entry) if entry.sha256 == current => Ok(Decision::Update),
        Some(_) => Ok(Decision::Conflict {
            conflict_id: short_hash(&format!("{}:{rel}", root.as_str())),
            reason: ConflictReason::UserModified,
            keep_both_rel: keep_both_rel(rel, pack_version, root_dir),
        }),
        None => Ok(Decision::Conflict {
            conflict_id: short_hash(&format!("{}:{rel}", root.as_str())),
            reason: ConflictReason::ForeignFile,
            keep_both_rel: keep_both_rel(rel, pack_version, root_dir),
        }),
    }
}

/// Berechnet den Plan. Es wird nichts geschrieben.
pub fn plan(input: &PlanInput<'_>) -> Result<SetupPlanData, SetupError> {
    let pack = input.pack;
    let scope = input.scope;
    if let Some(reason) = scope.unsupported {
        return Err(SetupError::Unsupported { pack: pack.id.clone(), reason });
    }
    let prev = latest_manifest(input.store, &pack.id, &scope.scope_id);
    let mut items: Vec<PlanItem> = Vec::new();

    // Dateien
    for f in &pack.files {
        if !file_applies(input, f) {
            continue;
        }
        let Some(component) = pack.component_of_file(&f.id) else { continue };
        let Some(root_dir) = scope.roots.get(&f.root) else {
            return Err(SetupError::InvalidPack(format!(
                "{}: Wurzel {} gibt es für diese Installation nicht",
                pack.id,
                f.root.as_str()
            )));
        };
        let src = pack
            .src_path(&f.src)
            .ok_or_else(|| SetupError::InvalidPack(format!("{}: Quelle `{}` ungültig", pack.id, f.src)))?;
        let (sha256, bytes) = match pack.sha256.get(&f.src) {
            Some(sha) => (sha.clone(), std::fs::metadata(&src).map_err(|e| IoError::read(&src, e))?.len()),
            None => {
                let sha = hash_file(&src)?;
                (sha, std::fs::metadata(&src).map_err(|e| IoError::read(&src, e))?.len())
            }
        };
        let target = fsx::safe_join(root_dir, &f.rel)?;
        let rel = f.rel.replace('\\', "/");
        let decision = decide(prev.as_ref(), f.root, &rel, &target, &sha256, &pack.version, root_dir)?;
        items.push(PlanItem {
            component: component.id.clone(),
            source_id: f.id.clone(),
            root: f.root,
            rel,
            target,
            sha256,
            bytes,
            decision,
            kind: ItemKind::File { src, src_key: f.src.clone() },
        });
    }

    // Aktionen
    let fallback_component = action_component(pack).map(|c| c.id.clone());
    for action in &pack.actions {
        match action {
            PackAction::WriteConfig { root, rel, fields } => {
                let Some(root_dir) = scope.roots.get(root) else { continue };
                let Some(component) = fallback_component.clone() else { continue };
                // Ohne belegten Platzhalter (z. B. keine Bibliothek eingerichtet) gibt es noch nichts zu schreiben
                let Some(content) = config_bytes(fields, input.library_root) else { continue };
                let target = fsx::safe_join(root_dir, rel)?;
                let rel = rel.replace('\\', "/");
                let sha256 = hash_bytes(&content);
                let decision = decide(prev.as_ref(), *root, &rel, &target, &sha256, &pack.version, root_dir)?;
                items.push(PlanItem {
                    component,
                    source_id: format!("config:{rel}"),
                    root: *root,
                    rel,
                    target,
                    sha256,
                    bytes: content.len() as u64,
                    decision,
                    kind: ItemKind::Config { content },
                });
            }
            PackAction::InstallFont { file, display_name } => {
                let Some(file_item) = items.iter().find(|i| i.source_id == *file) else { continue };
                let already = prev
                    .as_ref()
                    .is_some_and(|m| m.fonts.iter().any(|f| f.root == file_item.root && f.rel == file_item.rel));
                let file_changes = !matches!(file_item.decision, Decision::Skip);
                items.push(PlanItem {
                    component: file_item.component.clone(),
                    source_id: format!("font:{file}"),
                    root: file_item.root,
                    rel: file_item.rel.clone(),
                    target: file_item.target.clone(),
                    sha256: file_item.sha256.clone(),
                    bytes: file_item.bytes,
                    decision: Decision::Skip,
                    kind: ItemKind::Font {
                        file_id: file.clone(),
                        display_name: display_name.clone(),
                        run: file_changes || !already,
                    },
                });
            }
            PackAction::BlenderExtensionInstall { zip } => {
                // Über Flatpak liest die Sandbox das ZIP nicht; dort wird die Erweiterung nicht installiert
                if scope.install_kind == Some(crate::api::InstallKind::Flatpak) {
                    continue;
                }
                let Some(component) = fallback_component.clone() else { continue };
                let Some(zip_path) = pack.src_path(zip) else { continue };
                let sha256 = match pack.sha256.get(zip) {
                    Some(s) => s.clone(),
                    None => hash_file(&zip_path)?,
                };
                let bytes = std::fs::metadata(&zip_path).map_err(|e| IoError::read(&zip_path, e))?.len();
                let already = prev.as_ref().is_some_and(|m| {
                    m.actions
                        .iter()
                        .any(|a| a.kind == "blenderExtensionInstall" && a.sha256 == sha256 && a.exit_code == Some(0))
                });
                items.push(PlanItem {
                    component,
                    source_id: format!("extension:{zip}"),
                    root: RootId::BlenderExtensions,
                    rel: zip.clone(),
                    target: scope.roots.get(&RootId::BlenderExtensions).cloned().unwrap_or_default(),
                    sha256,
                    bytes,
                    decision: Decision::Skip,
                    kind: ItemKind::BlenderExtension { zip: zip_path, zip_key: zip.clone(), run: !already },
                });
            }
        }
    }

    // Anzeige
    let mut components: Vec<SetupComponent> = Vec::new();
    let mut conflicts: Vec<SetupConflict> = Vec::new();
    for c in &pack.components {
        let own: Vec<&PlanItem> = items.iter().filter(|i| i.component == c.id).collect();
        if own.is_empty() {
            continue;
        }
        let mut operations = Vec::new();
        for item in &own {
            let (kind, conflict_id) = match (&item.kind, &item.decision) {
                (ItemKind::Font { run: true, .. }, _) => (SetupOperationKind::InstallFont, None),
                (ItemKind::Font { run: false, .. }, _) => continue,
                (ItemKind::BlenderExtension { run: true, .. }, _) => (SetupOperationKind::BlenderExtension, None),
                (ItemKind::BlenderExtension { run: false, .. }, _) => continue,
                (ItemKind::Config { .. }, Decision::Create | Decision::Update) => {
                    (SetupOperationKind::WriteConfig, None)
                }
                (_, Decision::Create) => (SetupOperationKind::Create, None),
                (_, Decision::Update) => (SetupOperationKind::Update, None),
                (_, Decision::Skip) => (SetupOperationKind::Skip, None),
                (_, Decision::Conflict { conflict_id, reason, keep_both_rel }) => {
                    conflicts.push(SetupConflict {
                        conflict_id: conflict_id.clone(),
                        component_id: c.id.clone(),
                        target: display_path(&item.target),
                        reason: *reason,
                        keep_both_name: keep_both_rel.rsplit('/').next().unwrap_or(keep_both_rel).to_owned(),
                    });
                    (SetupOperationKind::Conflict, Some(conflict_id.clone()))
                }
            };
            operations.push(SetupOperation {
                kind,
                target: display_path(&item.target),
                source_id: item.source_id.clone(),
                bytes: item.bytes,
                conflict_id,
            });
        }
        let status = component_status(&own, prev.as_ref().is_some());
        components.push(SetupComponent {
            id: c.id.clone(),
            kind: c.kind,
            label: c.label.clone(),
            optional: c.optional,
            default_selected: c.is_default_selected(),
            status,
            preview: c
                .preview
                .as_ref()
                .map(|p| SetupComponentPreview {
                    colors: p.colors.clone(),
                    formats: p.formats.clone(),
                    fonts: p.fonts.clone(),
                })
                .unwrap_or(SetupComponentPreview { colors: vec![], formats: vec![], fonts: vec![] }),
            operations,
        });
    }

    let previous = prev.as_ref().map(|m| super::apply::record_of(m, true));
    let dto = SetupPlan {
        plan_id: new_id(),
        pack_id: pack.id.clone(),
        program_id: scope.program_id.clone(),
        scope_id: scope.scope_id.clone(),
        pack_version: pack.version.clone(),
        pack_label: pack.title.clone(),
        previous,
        components,
        conflicts,
        program_running: input.program_running,
        restart_hint: input.program_running,
        created_at: now_iso(),
        expires_at: iso_after(PLAN_TTL),
    };
    Ok(SetupPlanData { dto, pack: pack.clone(), scope: scope.clone(), items, missing_requirements: Vec::new() })
}

/// Zustand eines Bausteins aus den Entscheidungen seiner Dateien.
fn component_status(items: &[&PlanItem], has_previous: bool) -> SetupComponentStatus {
    let mut create = 0;
    let mut update = 0;
    let mut skip = 0;
    let mut conflict = 0;
    for item in items {
        // Aktionen zählen mit: eine noch nötige Anmeldung/Installation heißt „noch nicht ganz fertig“
        match (&item.kind, &item.decision) {
            (ItemKind::Font { run: true, .. } | ItemKind::BlenderExtension { run: true, .. }, _) => {
                update += usize::from(has_previous)
            }
            (ItemKind::Font { .. } | ItemKind::BlenderExtension { .. }, _) => {}
            (_, Decision::Create) => create += 1,
            (_, Decision::Update) => update += 1,
            (_, Decision::Skip) => skip += 1,
            (_, Decision::Conflict { .. }) => conflict += 1,
        }
    }
    if conflict > 0 {
        SetupComponentStatus::UserModified
    } else if create > 0 && (skip > 0 || update > 0) {
        SetupComponentStatus::Partial
    } else if create > 0 {
        SetupComponentStatus::New
    } else if update > 0 {
        SetupComponentStatus::Outdated
    } else {
        SetupComponentStatus::Current
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keep_both_names_keep_directory_and_extension_and_avoid_collisions() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            keep_both_rel("templates/Cypher/Shirt.kra", "1.2.0", dir.path()),
            "templates/Cypher/Shirt (Cypher 1.2.0).kra"
        );
        std::fs::create_dir_all(dir.path().join("templates/Cypher")).unwrap();
        std::fs::write(dir.path().join("templates/Cypher/Shirt (Cypher 1.2.0).kra"), b"x").unwrap();
        assert_eq!(
            keep_both_rel("templates/Cypher/Shirt.kra", "1.2.0", dir.path()),
            "templates/Cypher/Shirt (Cypher 1.2.0, 2).kra"
        );
        assert_eq!(keep_both_rel("noext", "1.0.0", dir.path()), "noext (Cypher 1.0.0)");
        assert_eq!(keep_both_rel(".directory", "1.0.0", dir.path()), ".directory (Cypher 1.0.0)");
    }

    #[test]
    fn config_content_is_stable_and_needs_all_placeholders() {
        let mut fields = BTreeMap::new();
        fields.insert("b".to_owned(), "fest".to_owned());
        fields.insert("assetLibraryPath".to_owned(), "{libraryRoot}/3D".to_owned());
        let with = config_bytes(&fields, Some(Path::new("D:\\Sync\\Cypher"))).unwrap();
        assert_eq!(
            String::from_utf8(with.clone()).unwrap(),
            "{\n  \"assetLibraryPath\": \"D:/Sync/Cypher/3D\",\n  \"b\": \"fest\"\n}\n"
        );
        assert_eq!(config_bytes(&fields, Some(Path::new("D:\\Sync\\Cypher"))).unwrap(), with);
        assert!(config_bytes(&fields, None).is_none());
    }

    #[test]
    fn file_name_split() {
        assert_eq!(file_name_of("a/b.tar.gz"), ("b.tar".to_owned(), ".gz".to_owned()));
        assert_eq!(file_name_of(".directory"), (".directory".to_owned(), String::new()));
    }
}
