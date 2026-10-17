//! `projects` und Vorlagen – ein Projekt ist ein Ordner mit `projekt.json` (ARCHITEKTUR.md 2.11, 4.5).
//!
//! Dateizahl, letzte Datei und Änderungszeit werden beim Auflisten berechnet und stehen nicht in `projekt.json`: So gibt
//! es bei paralleler Arbeit mehrerer Personen im geteilten Ordner keine Konflikte in dieser Datei.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use walkdir::WalkDir;

use crate::api::{
    MockupDocument, MockupPlacement, MockupTemplate, ModuleKind, Project, ProjectAsset, ProjectDocument,
    ProjectDocumentData, ProjectFileRef, ProjectFolder, SocialDocument, SocialExportFormat, SocialLayer,
    SocialTemplate, TemplateFormat, TemplateInfo, TemplateSource, TemplateTarget,
};
use crate::error::{IoError, ProjectError};
use crate::platform::{display_path, fsx};
use crate::state::ProjectIndexEntry;
use crate::urls;
use crate::util::{new_id, now_iso, to_iso};

pub const PROJECT_FILE: &str = "projekt.json";
pub const PROJECT_FORMAT_VERSION: u32 = 1;
/// Modul-Dokumente (`*.mockup.json`, `*.social.json`) dürfen höchstens so groß sein.
pub const DOCUMENT_MAX_BYTES: u64 = 1024 * 1024;
const MAX_SCAN_DEPTH: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFileData {
    format_version: u32,
    id: String,
    name: String,
    #[serde(default)]
    collection: Option<String>,
    #[serde(default)]
    formats: Vec<String>,
    created_at: String,
    #[serde(default)]
    created_by: String,
}

fn invalid(field: &str, reason: impl Into<String>) -> ProjectError {
    ProjectError::InvalidInput { field: field.to_owned(), reason: reason.into() }
}

fn iso_of(t: SystemTime) -> String {
    to_iso(OffsetDateTime::from(t))
}

/// Ordner der Projekte: in der Bibliothek `<Bibliothek>/Projekte`, sonst der eingestellte Projektordner.
pub fn projects_root(library_root: Option<&Path>, projects_dir: &Path) -> (PathBuf, bool) {
    match library_root {
        Some(lib) => (lib.join("Projekte"), true),
        None => (projects_dir.to_path_buf(), false),
    }
}

/// Programm zu einer Dateiendung.
pub fn program_for(path: &Path) -> Option<&'static str> {
    let name = path.file_name()?.to_string_lossy().to_lowercase();
    if name.ends_with(".mockup.json") || name.ends_with(".social.json") {
        return None;
    }
    match name.rsplit('.').next()? {
        "kra" => Some("krita"),
        "svg" => Some("inkscape"),
        "blend" => Some("blender"),
        "kdenlive" => Some("kdenlive"),
        _ => None,
    }
}

/// Modul zu einem Dokumentnamen.
pub fn module_for(path: &Path) -> Option<ModuleKind> {
    let name = path.file_name()?.to_string_lossy().to_lowercase();
    if name.ends_with(".mockup.json") {
        Some(ModuleKind::Mockup)
    } else if name.ends_with(".social.json") {
        Some(ModuleKind::Social)
    } else {
        None
    }
}

fn file_ref(rel: &str, modified: SystemTime) -> ProjectFileRef {
    let path = Path::new(rel);
    ProjectFileRef {
        rel_path: rel.replace('\\', "/"),
        modified_at: iso_of(modified),
        program_id: program_for(path).map(str::to_owned),
        module: module_for(path),
    }
}

/// Zählt Dateien (ohne `Export/`, ohne Versteckte) und findet die jüngste.
fn scan_files(dir: &Path) -> (u32, Option<(String, SystemTime)>) {
    let mut count = 0u32;
    let mut latest: Option<(String, SystemTime)> = None;
    let walker = WalkDir::new(dir).max_depth(MAX_SCAN_DEPTH).follow_links(false).into_iter().filter_entry(|e| {
        let name = e.file_name().to_string_lossy();
        e.depth() == 0 || (!name.starts_with('.') && !(e.depth() == 1 && name == "Export"))
    });
    for entry in walker.filter_map(Result::ok) {
        if !entry.file_type().is_file() || entry.depth() == 1 && entry.file_name() == PROJECT_FILE {
            continue;
        }
        count += 1;
        let Some(modified) = entry.metadata().ok().and_then(|m| m.modified().ok()) else { continue };
        let Ok(rel) = entry.path().strip_prefix(dir) else { continue };
        let rel = rel.to_string_lossy().replace('\\', "/");
        if latest.as_ref().is_none_or(|(_, t)| modified > *t) {
            latest = Some((rel, modified));
        }
    }
    (count, latest)
}

/// Liest ein Projekt aus seinem Ordner.
pub fn read_project(dir: &Path, in_library: bool) -> Result<Project, ProjectError> {
    let meta_path = dir.join(PROJECT_FILE);
    let data: ProjectFileData =
        fsx::read_json(&meta_path)?.ok_or_else(|| ProjectError::NotFound(dir.display().to_string()))?;
    if data.format_version > PROJECT_FORMAT_VERSION {
        return Err(invalid("projekt.json", "stammt von einer neueren App-Version"));
    }
    let (file_count, latest) = scan_files(dir);
    let json_modified = std::fs::metadata(&meta_path).and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
    let updated = latest.as_ref().map_or(json_modified, |(_, t)| (*t).max(json_modified));
    Ok(Project {
        id: data.id,
        name: data.name,
        collection: data.collection,
        dir: display_path(dir),
        in_library,
        file_count,
        last_file: latest.map(|(rel, t)| file_ref(&rel, t)),
        created_at: data.created_at,
        updated_at: iso_of(updated),
        missing: false,
    })
}

/// Projekt, dessen Ordner fehlt (nur noch im Index).
fn missing_project(entry: &ProjectIndexEntry) -> Project {
    let name =
        Path::new(&entry.dir).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| entry.id.clone());
    let at = entry.last_opened_at.clone().unwrap_or_else(now_iso);
    Project {
        id: entry.id.clone(),
        name,
        collection: None,
        dir: display_path(Path::new(&entry.dir)),
        in_library: false,
        file_count: 0,
        last_file: None,
        created_at: at.clone(),
        updated_at: at,
        missing: true,
    }
}

/// Alle Projekte: die im Projektordner und die aus dem Index (geöffnete Projekte anderswo, fehlende als `missing`).
/// Rückgabe: Projekt und sein Ordner. Neueste Änderung zuerst.
pub fn list(root: &Path, in_library: bool, index: &[ProjectIndexEntry]) -> Vec<(Project, PathBuf)> {
    let mut out: Vec<(Project, PathBuf)> = Vec::new();
    if let Ok(read) = std::fs::read_dir(root) {
        for e in read.filter_map(Result::ok) {
            let path = e.path();
            if path.is_dir()
                && !e.file_name().to_string_lossy().starts_with('.')
                && let Ok(p) = read_project(&path, in_library)
            {
                out.push((p, path));
            }
        }
    }
    for entry in index {
        if out.iter().any(|(p, _)| p.id == entry.id) {
            continue;
        }
        let dir = PathBuf::from(&entry.dir);
        match read_project(&dir, false) {
            Ok(p) => out.push((p, dir)),
            Err(_) => out.push((missing_project(entry), dir)),
        }
    }
    out.sort_by(|a, b| b.0.updated_at.cmp(&a.0.updated_at).then_with(|| a.0.name.cmp(&b.0.name)));
    out
}

/// Legt ein Projekt an: Ordner, Unterordner, `projekt.json`. Kollision im Namen: " (2)", " (3)" …
pub fn create(
    root: &Path,
    in_library: bool,
    name: &str,
    collection: Option<&str>,
    created_by: &str,
) -> Result<(Project, PathBuf), ProjectError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(invalid("name", "Der Name darf nicht leer sein"));
    }
    if trimmed.chars().count() > 80 {
        return Err(invalid("name", "Der Name ist zu lang (höchstens 80 Zeichen)"));
    }
    let base = fsx::sanitize_file_name(trimmed);
    let mut dir = root.join(&base);
    let mut n = 2;
    while dir.exists() {
        dir = root.join(format!("{base} ({n})"));
        n += 1;
    }
    std::fs::create_dir_all(&dir).map_err(|e| IoError::new(crate::api::IoOp::CreateDir, &dir, e))?;
    for folder in ProjectFolder::ALL {
        let sub = fsx::safe_join(&dir, folder.dir_name())?;
        std::fs::create_dir_all(&sub).map_err(|e| IoError::new(crate::api::IoOp::CreateDir, &sub, e))?;
    }
    let data = ProjectFileData {
        format_version: PROJECT_FORMAT_VERSION,
        id: new_id(),
        name: trimmed.to_owned(),
        collection: collection.filter(|c| !c.is_empty()).map(str::to_owned),
        formats: Vec::new(),
        created_at: now_iso(),
        created_by: created_by.to_owned(),
    };
    fsx::write_json_atomic(&dir.join(PROJECT_FILE), &data)?;
    let project = read_project(&dir, in_library)?;
    Ok((project, dir))
}

/// Ändert die Kollektion eines Projekts.
pub fn set_collection(dir: &Path, in_library: bool, collection: Option<&str>) -> Result<Project, ProjectError> {
    let path = dir.join(PROJECT_FILE);
    let mut data: ProjectFileData =
        fsx::read_json(&path)?.ok_or_else(|| ProjectError::NotFound(dir.display().to_string()))?;
    data.collection = collection.filter(|c| !c.is_empty()).map(str::to_owned);
    fsx::write_json_atomic(&path, &data)?;
    read_project(dir, in_library)
}

/// Jüngste Datei außer `Export/`.
pub fn last_file(dir: &Path) -> Option<ProjectFileRef> {
    scan_files(dir).1.map(|(rel, t)| file_ref(&rel, t))
}

/// Löst einen relativen Pfad im Projekt auf: sicher, innerhalb des Projekts, Datei muss existieren.
pub fn resolve_file(dir: &Path, rel: &str) -> Result<PathBuf, ProjectError> {
    let path = fsx::safe_join(dir, rel)?;
    if rel.replace('\\', "/").split('/').next().is_some_and(|c| c.starts_with('.') && c != ".") {
        return Err(invalid("relPath", "Versteckte Ordner sind nicht erreichbar"));
    }
    let resolved = fsx::ensure_within(dir, &path).map_err(|e| match e {
        fsx::EnsureWithinError::Path(p) => ProjectError::Path(p),
        fsx::EnsureWithinError::Io(io) => ProjectError::Io(io),
    })?;
    if !resolved.is_file() {
        return Err(ProjectError::NotFound(rel.to_owned()));
    }
    Ok(resolved)
}

// ---------------------------------------------------------------------------------------------
// Vorlagen
// ---------------------------------------------------------------------------------------------

/// Eine geladene Vorlage mit dem, was Rust zum Anlegen einer Datei braucht.
#[derive(Debug, Clone)]
pub struct TemplateRecord {
    pub info: TemplateInfo,
    pub dir: PathBuf,
    /// Vorlagendatei relativ zu `dir` (nur Ziel `program`).
    pub file: Option<String>,
    pub social_template_id: Option<String>,
    pub mockup_template_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawTemplate {
    id: String,
    title: String,
    description: String,
    target: TemplateTarget,
    program_id: Option<String>,
    format: TemplateFormat,
    folder: ProjectFolder,
    file_extension: String,
    #[serde(default)]
    file: Option<String>,
    #[serde(default)]
    social_template_id: Option<String>,
    #[serde(default)]
    mockup_template_id: Option<String>,
    #[serde(default)]
    print_profile_id: Option<String>,
    #[serde(default)]
    preview: Option<String>,
    #[serde(default)]
    requires_setup: bool,
    #[serde(default)]
    tags: Vec<String>,
}

fn load_template(dir: &Path, dir_name: &str, source: TemplateSource) -> Result<TemplateRecord, String> {
    let bytes = std::fs::read(dir.join("template.json")).map_err(|e| e.to_string())?;
    let raw: RawTemplate = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if raw.id != dir_name {
        return Err(format!("id `{}` passt nicht zum Ordner", raw.id));
    }
    if let Some(file) = &raw.file {
        let path = fsx::safe_join(dir, file).map_err(|e| e.to_string())?;
        if !path.is_file() {
            return Err(format!("Vorlagendatei `{file}` fehlt"));
        }
    }
    match raw.target {
        TemplateTarget::Program if raw.file.is_none() => return Err("Ziel program braucht `file`".into()),
        TemplateTarget::Social if raw.social_template_id.is_none() => {
            return Err("Ziel social braucht `socialTemplateId`".into());
        }
        TemplateTarget::Mockup if raw.mockup_template_id.is_none() => {
            return Err("Ziel mockup braucht `mockupTemplateId`".into());
        }
        _ => {}
    }
    let (prefix, preview_url) = match source {
        TemplateSource::Builtin => (
            "builtin",
            raw.preview
                .as_deref()
                .filter(|p| dir.join(p).is_file())
                .map(|p| urls::url("cyasset", &format!("projects/{dir_name}/{p}"))),
        ),
        TemplateSource::Library => ("library", None),
    };
    let aspect = f64::from(raw.format.width_px) / f64::from(raw.format.height_px.max(1));
    Ok(TemplateRecord {
        info: TemplateInfo {
            id: format!("{prefix}:{}", raw.id),
            title: raw.title,
            description: raw.description,
            target: raw.target,
            program_id: raw.program_id,
            format: raw.format,
            aspect,
            folder: raw.folder,
            file_extension: raw.file_extension,
            print_profile_id: raw.print_profile_id,
            preview_url,
            source,
            requires_setup: raw.requires_setup,
            tags: raw.tags,
        },
        dir: dir.to_path_buf(),
        file: raw.file,
        social_template_id: raw.social_template_id,
        mockup_template_id: raw.mockup_template_id,
    })
}

fn scan_templates(base: &Path, source: TemplateSource, out: &mut Vec<TemplateRecord>) {
    let Ok(read) = std::fs::read_dir(base) else { return };
    let mut dirs: Vec<(String, PathBuf)> = read
        .filter_map(Result::ok)
        .filter(|e| e.path().join("template.json").is_file())
        .map(|e| (e.file_name().to_string_lossy().into_owned(), e.path()))
        .collect();
    dirs.sort();
    for (name, dir) in dirs {
        match load_template(&dir, &name, source) {
            Ok(t) => out.push(t),
            Err(e) => tracing::warn!("Vorlage {name} übersprungen: {e}"),
        }
    }
}

/// Mitgelieferte Vorlagen (`<packs>/projects/*`) und eigene der Bibliothek (`<Bibliothek>/Vorlagen/*`).
pub fn list_templates(packs_root: &Path, library_root: Option<&Path>) -> Vec<TemplateRecord> {
    let mut out = Vec::new();
    scan_templates(&packs_root.join("projects"), TemplateSource::Builtin, &mut out);
    if let Some(lib) = library_root {
        scan_templates(&lib.join("Vorlagen"), TemplateSource::Library, &mut out);
    }
    out
}

// ---------------------------------------------------------------------------------------------
// Dateien aus Vorlagen
// ---------------------------------------------------------------------------------------------

/// Womit eine neue Datei gefüllt wird.
#[derive(Debug, Clone)]
pub enum NewFileContent {
    CopyFrom(PathBuf),
    Bytes(Vec<u8>),
}

/// Legt `<projekt>/<ordner>/<name><endung>` an. Überschreibt nie; Kollision ist ein Eingabefehler (`fileName`).
pub fn new_file(
    project_dir: &Path,
    folder: ProjectFolder,
    extension: &str,
    file_name: &str,
    content: &NewFileContent,
) -> Result<(ProjectFileRef, PathBuf), ProjectError> {
    let ext = extension.trim_start_matches('.').to_lowercase();
    let mut stem = file_name.trim().to_owned();
    let suffix = format!(".{ext}");
    if stem.to_lowercase().ends_with(&suffix) {
        stem.truncate(stem.len() - suffix.len());
    }
    let stem = fsx::sanitize_file_name(&stem);
    if file_name.trim().is_empty() {
        return Err(invalid("fileName", "Der Dateiname darf nicht leer sein"));
    }
    let rel = format!("{}/{stem}.{ext}", folder.dir_name());
    let target = fsx::safe_join(project_dir, &rel)?;
    if target.exists() {
        return Err(invalid("fileName", format!("Die Datei {stem}.{ext} gibt es in diesem Projekt schon")));
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| IoError::new(crate::api::IoOp::CreateDir, parent, e))?;
    }
    match content {
        NewFileContent::CopyFrom(src) => {
            let bytes = std::fs::read(src).map_err(|e| IoError::read(src, e))?;
            write_new(&target, &bytes)?;
        }
        NewFileContent::Bytes(bytes) => write_new(&target, bytes)?,
    }
    let modified = std::fs::metadata(&target).and_then(|m| m.modified()).unwrap_or_else(|_| SystemTime::now());
    Ok((file_ref(&rel, modified), target))
}

/// Schreibt eine neue Datei; scheitert, wenn sie inzwischen existiert (`create_new`).
fn write_new(target: &Path, bytes: &[u8]) -> Result<(), ProjectError> {
    use std::io::Write as _;
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(target).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            return ProjectError::InvalidInput { field: "fileName".into(), reason: "Die Datei gibt es schon".into() };
        }
        ProjectError::Io(IoError::write(target, e))
    })?;
    f.write_all(bytes).map_err(|e| IoError::write(target, e))?;
    f.sync_all().map_err(|e| IoError::write(target, e))?;
    Ok(())
}

/// Anfangsdokument für eine Social-Vorlage.
pub fn social_document(t: &SocialTemplate) -> ProjectDocument {
    let mut texts = BTreeMap::new();
    let mut images = BTreeMap::new();
    for layer in &t.layers {
        match layer {
            SocialLayer::Text { slot, default_text, .. } => {
                texts.insert(slot.clone(), default_text.clone());
            }
            SocialLayer::Image { slot, .. } => {
                images.insert(slot.clone(), None);
            }
            _ => {}
        }
    }
    ProjectDocument {
        schema_version: 1,
        module: ModuleKind::Social,
        data: ProjectDocumentData::Social(SocialDocument {
            template_id: t.id.clone(),
            format: t.format,
            texts,
            images,
            color_overrides: BTreeMap::new(),
            export_format: SocialExportFormat::Png,
        }),
    }
}

/// Anfangsdokument für eine Mockup-Vorlage. `default_width_mm` kommt aus dem Druckprofil der Vorlage.
pub fn mockup_document(t: &MockupTemplate, default_width_mm: f64) -> ProjectDocument {
    let color_id = t.variants.iter().flat_map(|v| v.color_ids.first()).next().cloned().unwrap_or_default();
    ProjectDocument {
        schema_version: 1,
        module: ModuleKind::Mockup,
        data: ProjectDocumentData::Mockup(MockupDocument {
            template_id: t.id.clone(),
            color_id,
            design: None,
            placement: MockupPlacement { width_mm: default_width_mm, offset_top_mm: 0.0, offset_center_mm: 0.0 },
            background: crate::api::MockupBackground::Template,
            export_size_px: t.canvas,
        }),
    }
}

// ---------------------------------------------------------------------------------------------
// Modul-Dokumente
// ---------------------------------------------------------------------------------------------

fn check_document_path(rel: &str) -> Result<ModuleKind, ProjectError> {
    let module = module_for(Path::new(rel)).ok_or_else(|| invalid("relPath", "Kein Mockup- oder Social-Dokument"))?;
    let expected = match module {
        ModuleKind::Mockup => ProjectFolder::Mockups,
        ModuleKind::Social => ProjectFolder::Social,
    };
    let top = rel.replace('\\', "/");
    if top.split('/').next() != Some(expected.dir_name()) || top.matches('/').count() != 1 {
        return Err(invalid(
            "relPath",
            format!("Dokumente dieser Art liegen direkt im Ordner {}", expected.dir_name()),
        ));
    }
    Ok(module)
}

fn document_module(doc: &ProjectDocument) -> ModuleKind {
    match doc.data {
        ProjectDocumentData::Mockup(_) => ModuleKind::Mockup,
        ProjectDocumentData::Social(_) => ModuleKind::Social,
    }
}

/// Liest ein Dokument; `None`, wenn die Datei fehlt.
pub fn read_document(dir: &Path, rel: &str) -> Result<Option<ProjectDocument>, ProjectError> {
    let module = check_document_path(rel)?;
    let path = fsx::safe_join(dir, rel)?;
    let meta = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(IoError::read(&path, e).into()),
    };
    if meta.len() > DOCUMENT_MAX_BYTES {
        return Err(invalid("relPath", "Das Dokument ist größer als 1 MB"));
    }
    let bytes = std::fs::read(&path).map_err(|e| IoError::read(&path, e))?;
    let doc: ProjectDocument =
        serde_json::from_slice(&bytes).map_err(|e| invalid("relPath", format!("Dokument nicht lesbar: {e}")))?;
    if doc.schema_version != 1 {
        return Err(invalid("relPath", "Dokumentversion wird nicht unterstützt"));
    }
    if doc.module != module || document_module(&doc) != module {
        return Err(invalid("relPath", "Das Dokument gehört zu einem anderen Modul"));
    }
    Ok(Some(doc))
}

/// Schreibt ein Dokument atomar. Größe höchstens 1 MB, Modul passend zur Endung.
pub fn write_document(dir: &Path, rel: &str, doc: &ProjectDocument) -> Result<ProjectFileRef, ProjectError> {
    let module = check_document_path(rel)?;
    if doc.schema_version != 1 {
        return Err(invalid("document", "Nur schemaVersion 1 wird unterstützt"));
    }
    if doc.module != module || document_module(doc) != module {
        return Err(invalid("document", "Das Modul passt nicht zur Dateiendung"));
    }
    let bytes = serde_json::to_vec_pretty(doc).map_err(|e| invalid("document", e.to_string()))?;
    if bytes.len() as u64 > DOCUMENT_MAX_BYTES {
        return Err(invalid("document", "Das Dokument ist größer als 1 MB"));
    }
    let path = fsx::safe_join(dir, rel)?;
    fsx::write_atomic(&path, &bytes)?;
    let modified = std::fs::metadata(&path).and_then(|m| m.modified()).unwrap_or_else(|_| SystemTime::now());
    Ok(file_ref(rel, modified))
}

/// Kopiert eine Datei in einen Projektordner; Namenskollision: `-2`, `-3` …. Gibt relativen und absoluten Pfad zurück.
pub fn add_asset(dir: &Path, src: &Path, folder: ProjectFolder) -> Result<(ProjectAsset, PathBuf), ProjectError> {
    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| invalid("handleId", "Datei ohne Namen"))?;
    let name = fsx::sanitize_file_name(&name);
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (name[..i].to_owned(), name[i..].to_owned()),
        _ => (name.clone(), String::new()),
    };
    let sub = fsx::safe_join(dir, folder.dir_name())?;
    std::fs::create_dir_all(&sub).map_err(|e| IoError::new(crate::api::IoOp::CreateDir, &sub, e))?;
    let bytes = std::fs::read(src).map_err(|e| IoError::read(src, e))?;
    let mut n = 1;
    loop {
        let candidate = if n == 1 { format!("{stem}{ext}") } else { format!("{stem}-{n}{ext}") };
        let rel = format!("{}/{candidate}", folder.dir_name());
        let target = fsx::safe_join(dir, &rel)?;
        match write_new(&target, &bytes) {
            Ok(()) => {
                return Ok((
                    ProjectAsset {
                        rel_path: rel,
                        // Der Aufrufer ersetzt das Handle durch ein registriertes
                        handle: crate::api::FileHandleInfo {
                            id: String::new(),
                            name: candidate,
                            display_path: display_path(&target),
                            size: bytes.len() as u64,
                            mime: String::new(),
                            url: None,
                            source: crate::api::HandleSource::Project,
                        },
                    },
                    target,
                ));
            }
            Err(ProjectError::InvalidInput { .. }) => n += 1,
            Err(e) => return Err(e),
        }
        if n > 1000 {
            return Err(invalid("handleId", "Zu viele gleichnamige Dateien"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_builds_the_folder_structure_and_a_readable_project() {
        let tmp = tempfile::tempdir().unwrap();
        let (p, dir) = create(tmp.path(), true, "Herbst-Drop 26", Some("rauschen"), "Mo").unwrap();
        assert_eq!(p.name, "Herbst-Drop 26");
        assert_eq!(p.collection.as_deref(), Some("rauschen"));
        assert!(p.in_library && !p.missing);
        assert_eq!(p.file_count, 0);
        assert!(p.last_file.is_none());
        for f in ["Motive", "Mockups", "Social", "Video", "3D", "Export/Druck", "Export/Social"] {
            assert!(dir.join(f).is_dir(), "{f}");
        }
        assert!(dir.join(PROJECT_FILE).is_file());
        let again = read_project(&dir, true).unwrap();
        assert_eq!(again.id, p.id);
    }

    #[test]
    fn name_collisions_get_a_counter_and_bad_names_are_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let (a, da) = create(tmp.path(), false, "Drop", None, "x").unwrap();
        let (b, db) = create(tmp.path(), false, "Drop", None, "x").unwrap();
        let (_, dc) = create(tmp.path(), false, "Drop", None, "x").unwrap();
        assert_ne!(a.id, b.id);
        assert!(da.ends_with("Drop") && db.ends_with("Drop (2)") && dc.ends_with("Drop (3)"));
        assert!(matches!(create(tmp.path(), false, "   ", None, "x"), Err(ProjectError::InvalidInput { .. })));
        assert!(matches!(
            create(tmp.path(), false, &"a".repeat(81), None, "x"),
            Err(ProjectError::InvalidInput { .. })
        ));
        // Zeichen, die im Dateisystem nicht gehen, werden ersetzt
        let (weird, dw) = create(tmp.path(), false, "a/b:c*d", None, "x").unwrap();
        assert_eq!(weird.name, "a/b:c*d");
        assert!(dw.starts_with(tmp.path()) && dw.file_name().unwrap().to_string_lossy() == "a-b-c-d");
    }

    #[test]
    fn counts_files_finds_the_latest_and_ignores_exports() {
        let tmp = tempfile::tempdir().unwrap();
        let (_, dir) = create(tmp.path(), false, "P", None, "x").unwrap();
        std::fs::write(dir.join("Motive/a.kra"), b"1").unwrap();
        std::fs::write(dir.join("Export/Druck/x.png"), b"2").unwrap();
        let later = dir.join("Video/b.kdenlive");
        std::fs::write(&later, b"3").unwrap();
        let f = std::fs::File::options().write(true).open(&later).unwrap();
        f.set_modified(SystemTime::now() + std::time::Duration::from_secs(60)).unwrap();
        let p = read_project(&dir, false).unwrap();
        assert_eq!(p.file_count, 2, "Export zählt nicht");
        let last = p.last_file.unwrap();
        assert_eq!(last.rel_path, "Video/b.kdenlive");
        assert_eq!(last.program_id.as_deref(), Some("kdenlive"));
    }

    #[test]
    fn list_includes_index_entries_and_marks_missing_ones() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Projekte");
        let (a, _) = create(&root, true, "A", None, "x").unwrap();
        let other = tmp.path().join("woanders");
        let (b, bdir) = create(&other, false, "B", None, "x").unwrap();
        let index = vec![
            ProjectIndexEntry { id: b.id.clone(), dir: bdir.to_string_lossy().into_owned(), last_opened_at: None },
            ProjectIndexEntry {
                id: "weg".into(),
                dir: tmp.path().join("gibtsnicht").to_string_lossy().into_owned(),
                last_opened_at: None,
            },
        ];
        let all = list(&root, true, &index);
        assert_eq!(all.len(), 3);
        assert!(all.iter().any(|(p, _)| p.id == a.id && p.in_library));
        assert!(all.iter().any(|(p, _)| p.id == b.id && !p.in_library));
        let missing = all.iter().find(|(p, _)| p.id == "weg").unwrap();
        assert!(missing.0.missing && missing.0.name == "gibtsnicht");
        // ein Ordner ohne projekt.json ist kein Projekt
        std::fs::create_dir_all(root.join("irgendwas")).unwrap();
        assert_eq!(list(&root, true, &[]).len(), 1);
    }

    #[test]
    fn set_collection_updates_the_file() {
        let tmp = tempfile::tempdir().unwrap();
        let (p, dir) = create(tmp.path(), false, "P", None, "x").unwrap();
        assert!(p.collection.is_none());
        let p = set_collection(&dir, false, Some("gold")).unwrap();
        assert_eq!(p.collection.as_deref(), Some("gold"));
        assert!(set_collection(&dir, false, None).unwrap().collection.is_none());
    }

    #[test]
    fn new_file_copies_templates_and_never_overwrites() {
        let tmp = tempfile::tempdir().unwrap();
        let (_, dir) = create(tmp.path(), false, "P", None, "x").unwrap();
        let src = tmp.path().join("vorlage.kra");
        std::fs::write(&src, b"vorlage").unwrap();
        let (r, path) =
            new_file(&dir, ProjectFolder::Motive, ".kra", "Neon Ratte", &NewFileContent::CopyFrom(src.clone()))
                .unwrap();
        assert_eq!(r.rel_path, "Motive/Neon Ratte.kra");
        assert_eq!(r.program_id.as_deref(), Some("krita"));
        assert_eq!(std::fs::read(path).unwrap(), b"vorlage");
        // eigene Endung im Namen wird nicht verdoppelt
        let (r2, _) =
            new_file(&dir, ProjectFolder::Motive, ".kra", "Zwei.KRA", &NewFileContent::CopyFrom(src.clone())).unwrap();
        assert_eq!(r2.rel_path, "Motive/Zwei.kra");
        // Kollision ist ein Eingabefehler am Feld fileName
        let e =
            new_file(&dir, ProjectFolder::Motive, ".kra", "Neon Ratte", &NewFileContent::CopyFrom(src)).unwrap_err();
        assert!(matches!(e, ProjectError::InvalidInput { ref field, .. } if field == "fileName"), "{e}");
        assert!(matches!(
            new_file(&dir, ProjectFolder::Motive, ".kra", " ", &NewFileContent::Bytes(vec![])),
            Err(ProjectError::InvalidInput { .. })
        ));
        assert_eq!(std::fs::read(dir.join("Motive/Neon Ratte.kra")).unwrap(), b"vorlage");
    }

    #[test]
    fn resolve_file_is_confined_to_the_project() {
        let tmp = tempfile::tempdir().unwrap();
        let (_, dir) = create(tmp.path(), false, "P", None, "x").unwrap();
        std::fs::write(dir.join("Motive/a.png"), b"x").unwrap();
        std::fs::write(tmp.path().join("geheim.txt"), b"x").unwrap();
        assert!(resolve_file(&dir, "Motive/a.png").is_ok());
        for bad in
            ["../geheim.txt", "Motive/../../geheim.txt", "/etc/passwd", "Motive/fehlt.png", "Motive", ".cypher/x"]
        {
            assert!(resolve_file(&dir, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn documents_round_trip_and_reject_wrong_places() {
        let tmp = tempfile::tempdir().unwrap();
        let (_, dir) = create(tmp.path(), false, "P", None, "x").unwrap();
        let social = SocialTemplate {
            id: "zitat".into(),
            title: "Zitat".into(),
            format: crate::api::SocialFormat::Post,
            size: crate::api::Size { width: 1080.0, height: 1350.0 },
            background: crate::api::Fill::Solid { color: "#fff".into() },
            layers: vec![SocialLayer::Text {
                id: "t".into(),
                slot: "zitat".into(),
                rect: crate::api::Rect { x: 0.0, y: 0.0, width: 1.0, height: 1.0 },
                font_family: "Anybody".into(),
                font_weight: 800,
                size_px: 100.0,
                min_size_px: 50.0,
                line_height: 1.0,
                letter_spacing_em: 0.0,
                color: "#000".into(),
                align: crate::api::TextAlign::Left,
                valign: crate::api::TextVAlign::Top,
                transform: crate::api::TextTransform::None,
                max_lines: 3,
                default_text: "Hallo".into(),
            }],
            safe_zones: vec![],
            grid_crop: None,
            preview_url: None,
        };
        let doc = social_document(&social);
        let r = write_document(&dir, "Social/post.social.json", &doc).unwrap();
        assert_eq!(r.module, Some(ModuleKind::Social));
        assert_eq!(r.program_id, None);
        assert_eq!(read_document(&dir, "Social/post.social.json").unwrap(), Some(doc.clone()));
        assert_eq!(read_document(&dir, "Social/fehlt.social.json").unwrap(), None);
        // falscher Ordner, falsche Endung, falsches Modul
        assert!(write_document(&dir, "Motive/post.social.json", &doc).is_err());
        assert!(write_document(&dir, "Social/post.json", &doc).is_err());
        assert!(write_document(&dir, "Mockups/post.mockup.json", &doc).is_err());
        assert!(write_document(&dir, "Social/unter/post.social.json", &doc).is_err());
        let mut wrong = doc.clone();
        wrong.schema_version = 2;
        assert!(write_document(&dir, "Social/v2.social.json", &wrong).is_err());
        // zu groß
        let mut big = doc;
        if let ProjectDocumentData::Social(s) = &mut big.data {
            s.texts.insert("lang".into(), "x".repeat(2 * 1024 * 1024));
        }
        assert!(write_document(&dir, "Social/gross.social.json", &big).is_err());
        // kaputte Datei lesen
        std::fs::write(dir.join("Social/kaputt.social.json"), b"{ nein").unwrap();
        assert!(read_document(&dir, "Social/kaputt.social.json").is_err());
    }

    #[test]
    fn assets_get_counters_instead_of_overwriting() {
        let tmp = tempfile::tempdir().unwrap();
        let (_, dir) = create(tmp.path(), false, "P", None, "x").unwrap();
        let src = tmp.path().join("bild.png");
        std::fs::write(&src, b"1").unwrap();
        let (a, _) = add_asset(&dir, &src, ProjectFolder::Motive).unwrap();
        let (b, pb) = add_asset(&dir, &src, ProjectFolder::Motive).unwrap();
        let (c, _) = add_asset(&dir, &src, ProjectFolder::Motive).unwrap();
        assert_eq!(a.rel_path, "Motive/bild.png");
        assert_eq!(b.rel_path, "Motive/bild-2.png");
        assert_eq!(c.rel_path, "Motive/bild-3.png");
        assert_eq!(std::fs::read(pb).unwrap(), b"1");
    }

    #[test]
    fn program_and_module_by_extension() {
        assert_eq!(program_for(Path::new("a.KRA")), Some("krita"));
        assert_eq!(program_for(Path::new("a.svg")), Some("inkscape"));
        assert_eq!(program_for(Path::new("a.blend")), Some("blender"));
        assert_eq!(program_for(Path::new("a.kdenlive")), Some("kdenlive"));
        assert_eq!(program_for(Path::new("a.png")), None);
        assert_eq!(program_for(Path::new("a.social.json")), None);
        assert_eq!(module_for(Path::new("x.mockup.json")), Some(ModuleKind::Mockup));
        assert_eq!(module_for(Path::new("x.json")), None);
    }

    #[test]
    fn real_templates_load() {
        let root = crate::util::repo_root().join("packs/dist");
        if !root.join("projects").is_dir() {
            return;
        }
        let all = list_templates(&root, None);
        assert!(all.len() >= 20, "{}", all.len());
        let shirt = all.iter().find(|t| t.info.id == "builtin:shirt-front-krita").unwrap();
        assert_eq!(shirt.info.program_id.as_deref(), Some("krita"));
        assert_eq!(shirt.info.format.width_px, 3898);
        assert_eq!(shirt.info.folder, ProjectFolder::Motive);
        assert!((shirt.info.aspect - 3898.0 / 5315.0).abs() < 1e-9);
        assert!(
            shirt.info.preview_url.as_deref().is_some_and(|u| u.contains("projects/shirt-front-krita/preview.png"))
        );
        assert!(shirt.file.is_some());
        let social = all.iter().find(|t| t.info.id == "builtin:social-zitat").unwrap();
        assert_eq!(social.social_template_id.as_deref(), Some("zitat"));
        assert_eq!(social.info.target, TemplateTarget::Social);
    }

    #[test]
    fn library_templates_are_listed_with_their_own_prefix() {
        let tmp = tempfile::tempdir().unwrap();
        let lib = tmp.path().join("lib");
        let t = lib.join("Vorlagen/meins");
        std::fs::create_dir_all(t.join("files")).unwrap();
        std::fs::write(t.join("files/x.kra"), b"x").unwrap();
        std::fs::write(
            t.join("template.json"),
            serde_json::json!({
                "id": "meins", "title": "Meins", "description": "d", "target": "program", "programId": "krita",
                "format": { "label": "10 × 10", "widthPx": 10, "heightPx": 20, "dpi": null, "widthMm": null, "heightMm": null },
                "folder": "Motive", "fileExtension": ".kra", "file": "files/x.kra"
            })
            .to_string(),
        )
        .unwrap();
        let all = list_templates(&tmp.path().join("packs"), Some(&lib));
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].info.id, "library:meins");
        assert_eq!(all[0].info.source, TemplateSource::Library);
        assert!((all[0].info.aspect - 0.5).abs() < 1e-9);
    }
}
