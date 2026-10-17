//! Was „Im Browser öffnen“ und „Im Ordner zeigen“ meinen (ARCHITEKTUR.md 3.2): Ziele werden hier aufgelöst, das
//! eigentliche Öffnen übernimmt die Tauri-Schicht. Nie nimmt ein Command eine URL oder einen Pfad vom Frontend entgegen.

use std::path::PathBuf;

use crate::api::{AppPage, EntityKind, ExternalTarget, ProgramPage, RevealTarget};
use crate::error::CoreError;
use crate::launch::expand_home;
use crate::projects;

use super::App;

/// Die Seite der Anwendung (Downloader-Seite, Hilfe).
const SITE: &str = "https://studio.cypherxcypher.de";
/// Das Quellcode-Repository (aus `Cargo.toml`).
const REPOSITORY: &str = env!("CARGO_PKG_REPOSITORY");

fn not_found(entity: EntityKind, id: &str) -> CoreError {
    CoreError::NotFound { entity, id: id.to_owned() }
}

/// Nur `https` ist erlaubt; alles andere ist ein Fehler im Katalog.
fn checked(url: &str) -> Result<String, CoreError> {
    let parsed =
        url::Url::parse(url).map_err(|e| CoreError::invalid_input("target", format!("ungültige Adresse: {e}")))?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err(CoreError::invalid_input("target", "Nur https-Adressen werden geöffnet"));
    }
    Ok(parsed.to_string())
}

fn ensure_dir(dir: PathBuf) -> Result<PathBuf, CoreError> {
    std::fs::create_dir_all(&dir).map_err(|e| crate::error::IoError::new(crate::api::IoOp::CreateDir, &dir, e))?;
    Ok(dir)
}

impl App {
    /// Adresse für „Im Browser öffnen“: aus dem Katalog oder aus der festen Liste der App.
    pub fn external_url(&self, target: &ExternalTarget) -> Result<String, CoreError> {
        match target {
            ExternalTarget::ProgramPage { program_id, page } => {
                let current = self.catalog.current();
                let program =
                    current.catalog.program(program_id).ok_or_else(|| not_found(EntityKind::Program, program_id))?;
                let url = match page {
                    ProgramPage::Homepage => program.homepage.clone(),
                    ProgramPage::License => program.license.url.clone(),
                    ProgramPage::ReleaseNotes => {
                        program.release_notes_url.clone().unwrap_or_else(|| program.homepage.clone())
                    }
                };
                checked(&url)
            }
            ExternalTarget::CatalogLink { link_id } => {
                let current = self.catalog.current();
                let link = current
                    .catalog
                    .links
                    .iter()
                    .find(|l| &l.id == link_id)
                    .ok_or_else(|| CoreError::invalid_input("linkId", format!("Verweis `{link_id}` unbekannt")))?;
                checked(&link.url)
            }
            ExternalTarget::AppPage { page } => checked(&match page {
                AppPage::Help => format!("{SITE}/anleitung/"),
                AppPage::SourceCode => REPOSITORY.to_owned(),
                AppPage::ThirdParty => format!("{REPOSITORY}/tree/main/docs/third-party"),
                AppPage::ReleaseNotes => format!("{SITE}/releases/"),
                AppPage::Downloads => format!("{SITE}/"),
            }),
        }
    }

    /// Pfad für „Im Ordner zeigen“. Der Pfad bleibt in Rust; das Frontend sieht nur das Ziel.
    pub async fn reveal_path(&self, target: &RevealTarget) -> Result<PathBuf, CoreError> {
        match target {
            RevealTarget::Installation { installation_id } => {
                if let Some(stored) =
                    self.state.read(|s| s.installations.iter().find(|i| &i.id == installation_id).cloned())
                {
                    return Ok(PathBuf::from(stored.path));
                }
                self.all_installations()
                    .into_iter()
                    .find(|i| &i.id == installation_id)
                    .map(|i| expand_home(&i.location))
                    .ok_or_else(|| not_found(EntityKind::Installation, installation_id))
            }
            RevealTarget::Project { project_id } => Ok(self.find_project(project_id)?.1),
            RevealTarget::ProjectFile { project_id, rel_path } => {
                let (_, dir) = self.find_project(project_id)?;
                Ok(projects::resolve_file(&dir, rel_path)?)
            }
            RevealTarget::LibraryEntry { entry_id } => {
                let guard = self.library.read().await;
                let holder = guard.as_ref().ok_or(crate::error::LibraryError::NotConfigured)?;
                Ok(holder.library.path_of(entry_id)?)
            }
            RevealTarget::LibraryRoot => {
                let root = self.settings.get().library_root.ok_or(crate::error::LibraryError::NotConfigured)?;
                Ok(PathBuf::from(root))
            }
            RevealTarget::Logs => ensure_dir(self.dirs.logs.clone()),
            // Die Druckprofile stehen im Katalog; sein Ordner zeigt die Datei, aus der sie stammen
            RevealTarget::PrintProfiles => ensure_dir(self.dirs.catalog_cache()),
            RevealTarget::FileHandle { handle_id } => {
                self.handles.resolve(handle_id).ok_or_else(|| not_found(EntityKind::FileHandle, handle_id))
            }
            RevealTarget::SetupBackups { pack_id } => {
                if !self.current_packs().packs.iter().any(|p| &p.id == pack_id) {
                    return Err(not_found(EntityKind::SetupScope, pack_id));
                }
                ensure_dir(self.setup_store.root().join("backups"))
            }
        }
    }
}
