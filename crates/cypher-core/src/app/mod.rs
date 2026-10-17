//! `app` – die Anwendungsschicht: ein Objekt, das alle Abläufe der Commands trägt (ARCHITEKTUR.md 2.17, 3).
//!
//! Die Tauri-Schicht und die Kommandozeile rufen nur diese Methoden auf. Alles, was ein nativer Dialog, ein Fenster oder
//! das Betriebssystem-Öffnen braucht, kommt von außen als Pfad oder Rückruf herein; hier steht keine Tauri-Abhängigkeit.

pub mod handles;
mod library_ops;
mod misc_ops;
mod print_ops;
mod programs_ops;
mod project_ops;
pub mod serve;
mod setup_ops;
mod shell_ops;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

use tokio_util::sync::CancellationToken;

use crate::api::{
    AppCloseRequested, BuildChannel, CatalogStatus, FilesDropped, Installation, JobsChanged, LibraryChanged,
    LibraryChangedReason, MockupTemplate, ProgramsChanged, ProgramsChangedReason, ProjectsChanged, SocialTemplate,
    UpdateCheck,
};
use crate::catalog::CatalogStore;
use crate::detect::DetectEnv;
use crate::download::{HostPolicy, HttpClient, NetLog};
use crate::error::CoreError;
use crate::install::InstallPlanData;
use crate::jobs::JobRegistry;
use crate::library::{Library, WatchHandle};
use crate::plans::PlanStore;
use crate::platform::{AppDirs, PlatformInfo};
use crate::process::CommandRunner;
use crate::settings::SettingsStore;
use crate::setup::fonts::FontInstaller;
use crate::setup::{LoadedPacks, RootsEnv, SetupPlanData, SetupStore};
use crate::state::StateStore;
use crate::verify::TrustedKeys;

pub use handles::HandleRegistry;

/// Ereignisse an das Frontend (Namen und Nutzlasten wie `EVENT_NAMES` im Vertrag).
#[derive(Debug, Clone)]
pub enum AppEvent {
    CatalogUpdated(CatalogStatus),
    ProgramsChanged(ProgramsChanged),
    LibraryChanged(LibraryChanged),
    ProjectsChanged(ProjectsChanged),
    FilesDropped(FilesDropped),
    UpdateAvailable(UpdateCheck),
    CloseRequested(AppCloseRequested),
    JobsChanged(JobsChanged),
}

impl AppEvent {
    /// Name des Ereignisses im Vertrag.
    pub fn name(&self) -> &'static str {
        match self {
            AppEvent::CatalogUpdated(_) => "catalog:updated",
            AppEvent::ProgramsChanged(_) => "programs:changed",
            AppEvent::LibraryChanged(_) => "library:changed",
            AppEvent::ProjectsChanged(_) => "projects:changed",
            AppEvent::FilesDropped(_) => "files:dropped",
            AppEvent::UpdateAvailable(_) => "update:available",
            AppEvent::CloseRequested(_) => "app:closeRequested",
            AppEvent::JobsChanged(_) => "jobs:changed",
        }
    }

    pub fn payload(&self) -> serde_json::Value {
        let v = match self {
            AppEvent::CatalogUpdated(p) => serde_json::to_value(p),
            AppEvent::ProgramsChanged(p) => serde_json::to_value(p),
            AppEvent::LibraryChanged(p) => serde_json::to_value(p),
            AppEvent::ProjectsChanged(p) => serde_json::to_value(p),
            AppEvent::FilesDropped(p) => serde_json::to_value(p),
            AppEvent::UpdateAvailable(p) => serde_json::to_value(p),
            AppEvent::CloseRequested(p) => serde_json::to_value(p),
            AppEvent::JobsChanged(p) => serde_json::to_value(p),
        };
        v.unwrap_or(serde_json::Value::Null)
    }
}

pub type EventSink = Arc<dyn Fn(AppEvent) + Send + Sync>;

/// Alles, was zum Start nötig ist. [`AppConfig::system`] liefert die echte Umgebung, Tests setzen eigene Teile.
pub struct AppConfig {
    pub dirs: AppDirs,
    pub app_version: String,
    pub build_channel: BuildChannel,
    pub platform: PlatformInfo,
    pub hosts: Arc<HostPolicy>,
    pub detect_env: Arc<DetectEnv>,
    pub runner: Arc<dyn CommandRunner>,
    pub fonts: Arc<dyn FontInstaller>,
    pub roots_env: RootsEnv,
    pub keys: TrustedKeys,
    /// Wurzel der mitgelieferten Pakete (`<resources>/packs`).
    pub packs_root: PathBuf,
}

impl AppConfig {
    /// Die echte Umgebung dieses Rechners.
    pub fn system(dirs: AppDirs, app_version: &str, build_channel: BuildChannel) -> Result<Self, CoreError> {
        let runner: Arc<dyn CommandRunner> = Arc::new(crate::process::SystemRunner);
        let packs_root = dirs.resources.join("packs");
        let roots_env = RootsEnv::from_system(dirs.data.clone());
        Ok(AppConfig {
            platform: crate::platform::current(),
            hosts: Arc::new(HostPolicy::embedded()),
            detect_env: Arc::new(DetectEnv::real()),
            fonts: crate::setup::fonts::system_installer(runner.clone()),
            runner,
            keys: TrustedKeys::embedded()?,
            app_version: app_version.to_owned(),
            build_channel,
            roots_env,
            packs_root,
            dirs,
        })
    }
}

/// Marke und Vorlagen der Module, einmal geladen.
pub(crate) struct BrandBundle {
    pub brand: crate::api::Brand,
    pub mockups: Vec<MockupTemplate>,
    pub socials: Vec<SocialTemplate>,
}

/// Bibliothek samt Überwachung.
pub(crate) struct LibraryHolder {
    pub library: Library,
    /// Hält die Überwachung am Leben (endet beim Löschen).
    pub _watch: Option<WatchHandle>,
}

pub struct App {
    pub dirs: AppDirs,
    pub app_version: String,
    pub build_channel: BuildChannel,
    pub platform: PlatformInfo,
    pub settings: SettingsStore,
    pub state: StateStore,
    pub catalog: CatalogStore,
    pub http: HttpClient,
    pub hosts: Arc<HostPolicy>,
    pub jobs: JobRegistry,
    pub runner: Arc<dyn CommandRunner>,
    pub fonts: Arc<dyn FontInstaller>,
    pub detect_env: Arc<DetectEnv>,
    pub roots_env: RootsEnv,
    pub handles: HandleRegistry,
    pub packs_root: PathBuf,
    pub(crate) setup_store: SetupStore,
    pub(crate) install_plans: PlanStore<InstallPlanData>,
    pub(crate) setup_plans: PlanStore<SetupPlanData>,
    pub(crate) detected: RwLock<Vec<Installation>>,
    pub(crate) packs: RwLock<Arc<LoadedPacks>>,
    pub(crate) brand: RwLock<Option<Arc<BrandBundle>>>,
    pub(crate) library: tokio::sync::RwLock<Option<LibraryHolder>>,
    pub(crate) root_candidates: Mutex<Vec<(String, PathBuf, Instant)>>,
    pub(crate) printcheck_cache: Mutex<Vec<(String, Arc<crate::printcheck::Prepared>)>>,
    pub(crate) emit: EventSink,
    pub(crate) closing: AtomicBool,
}

impl App {
    /// Baut die Anwendung. `emit` bekommt alle globalen Ereignisse (darf nicht blockieren).
    pub fn new(config: AppConfig, emit: EventSink) -> Result<Arc<App>, CoreError> {
        let AppConfig {
            dirs,
            app_version,
            build_channel,
            platform,
            hosts,
            detect_env,
            runner,
            fonts,
            roots_env,
            keys,
            packs_root,
        } = config;
        for d in [&dirs.data, &dirs.config, &dirs.cache, &dirs.logs] {
            std::fs::create_dir_all(d).map_err(|e| crate::error::IoError::new(crate::api::IoOp::CreateDir, d, e))?;
        }
        let settings = SettingsStore::load(&dirs);
        let state = StateStore::load(&dirs)?;
        let semver = semver::Version::parse(&app_version)
            .map_err(|e| CoreError::internal(format!("App-Version ungültig: {e}")))?;
        let catalog =
            CatalogStore::load_startup(&dirs, keys, &hosts, semver, state.read(|s| s.catalog_highest_sequence))?;
        let log = Arc::new(NetLog::new(Some(dirs.network_log_file())));
        let http = HttpClient::new(&app_version, hosts.clone(), log)?;
        let jobs_emit = emit.clone();
        let jobs = JobRegistry::new(Some(dirs.jobs_history_file()), move |c| jobs_emit(AppEvent::JobsChanged(c)));
        let packs = crate::setup::load_packs(&packs_root, true);
        for (name, problem) in &packs.problems {
            tracing::warn!("Paket {name} nicht geladen: {problem}");
        }
        let setup_store = SetupStore::new(dirs.setup_dir());
        Ok(Arc::new(App {
            settings,
            state,
            catalog,
            http,
            hosts,
            jobs,
            runner,
            fonts,
            detect_env,
            roots_env,
            handles: HandleRegistry::new(),
            packs_root,
            setup_store,
            install_plans: PlanStore::new(),
            setup_plans: PlanStore::new(),
            detected: RwLock::new(Vec::new()),
            packs: RwLock::new(Arc::new(packs)),
            brand: RwLock::new(None),
            library: tokio::sync::RwLock::new(None),
            root_candidates: Mutex::new(Vec::new()),
            printcheck_cache: Mutex::new(Vec::new()),
            emit,
            closing: AtomicBool::new(false),
            platform,
            app_version,
            build_channel,
            dirs,
        }))
    }

    pub(crate) fn emit(&self, event: AppEvent) {
        (self.emit)(event);
    }

    pub(crate) fn emit_programs(&self, reason: ProgramsChangedReason) {
        self.emit(AppEvent::ProgramsChanged(ProgramsChanged { reason }));
    }

    pub(crate) fn emit_library(&self, reason: LibraryChangedReason, count: u32) {
        self.emit(AppEvent::LibraryChanged(LibraryChanged { reason, changed_count: count }));
    }

    pub(crate) fn emit_projects(&self, project_id: Option<String>) {
        self.emit(AppEvent::ProjectsChanged(ProjectsChanged { project_id }));
    }

    /// Ruft einen blockierenden Teil in einem Arbeitsthread auf.
    pub(crate) async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, CoreError> {
        tokio::task::spawn_blocking(f).await.map_err(|e| CoreError::internal(format!("Arbeitsthread abgebrochen: {e}")))
    }

    /// Wird das Fenster gerade geschlossen? (Nach `app_close` bricht der Kern neue Arbeit ab.)
    pub fn is_closing(&self) -> bool {
        self.closing.load(Ordering::SeqCst)
    }

    pub(crate) fn set_closing(&self) {
        self.closing.store(true, Ordering::SeqCst);
    }

    /// Token, das beim Schließen der App abbricht (für lange Hintergrundarbeit ohne eigenen Auftrag).
    pub fn shutdown_token(&self) -> CancellationToken {
        CancellationToken::new()
    }

    /// Geteilte Markendaten (einmal geladen).
    pub(crate) fn brand_bundle(&self) -> Result<Arc<BrandBundle>, CoreError> {
        if let Some(b) = self.brand.read().ok().and_then(|g| g.clone()) {
            return Ok(b);
        }
        let brand = crate::brand::load_brand(&self.packs_root)?;
        let bundle = Arc::new(BrandBundle {
            brand,
            mockups: crate::brand::load_mockup_templates(&self.packs_root),
            socials: crate::brand::load_social_templates(&self.packs_root),
        });
        if let Ok(mut w) = self.brand.write() {
            *w = Some(bundle.clone());
        }
        Ok(bundle)
    }

    pub(crate) fn current_packs(&self) -> Arc<LoadedPacks> {
        match self.packs.read() {
            Ok(g) => g.clone(),
            Err(p) => p.into_inner().clone(),
        }
    }

    /// Alle bekannten Zuordnungen `Anzeige-ID -> Installation` als Beschreibung (für Kataloglogik).
    pub(crate) fn detected_snapshot(&self) -> Vec<Installation> {
        match self.detected.read() {
            Ok(g) => g.clone(),
            Err(p) => p.into_inner().clone(),
        }
    }
}
