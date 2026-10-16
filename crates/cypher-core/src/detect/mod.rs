//! `detect` – vorhandene Installationen erkennen (ARCHITEKTUR.md 2.8). Nur lesend: erkannte Installationen
//! werden nie verändert.
//!
//! Alle Systemzugriffe laufen über kleine Traits (`FsProbe`, `CommandRunner`, `RegistryProbe`), sodass jede
//! Strategie mit Fixtures für Windows, macOS und Linux auf jedem Entwicklungsrechner testbar ist.

mod real;
mod strategies;
mod version;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::api::{InstallKind, Installation, InstallationProblem, SetupUnsupportedReason};
use crate::catalog::{Catalog, ProgramSpec};
use crate::error::DetectError;
use crate::platform::{KnownDirs, PlatformInfo, display_path};
use crate::process::CommandRunner;
use crate::state::StoredInstallation;
use crate::util::{now_iso, short_hash};

#[cfg(windows)]
pub use real::RealRegistry;
pub use real::{NoRegistry, RealFs};
pub use version::extract_version;

/// Lesezugriff auf das Dateisystem.
pub trait FsProbe: Send + Sync {
    fn exists(&self, path: &Path) -> bool;
    fn is_dir(&self, path: &Path) -> bool;
    fn read(&self, path: &Path) -> Option<Vec<u8>>;
    /// Einträge eines Ordners (volle Pfade); leer, wenn es ihn nicht gibt.
    fn read_dir(&self, path: &Path) -> Vec<PathBuf>;
}

/// Ein Eintrag der Windows-Programmliste (`…\Uninstall\*`).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct UninstallEntry {
    pub display_name: String,
    pub display_version: Option<String>,
    pub install_location: Option<String>,
    pub display_icon: Option<String>,
}

pub trait RegistryProbe: Send + Sync {
    fn uninstall_entries(&self) -> Vec<UninstallEntry>;
}

pub struct DetectEnv {
    pub platform: PlatformInfo,
    pub known: KnownDirs,
    pub fs: Arc<dyn FsProbe>,
    pub cmd: Arc<dyn CommandRunner>,
    pub registry: Arc<dyn RegistryProbe>,
    /// Ordner aus `PATH`.
    pub path_dirs: Vec<PathBuf>,
}

impl DetectEnv {
    /// Das echte System.
    pub fn real() -> Self {
        DetectEnv {
            platform: crate::platform::current(),
            known: KnownDirs::from_env(),
            fs: Arc::new(RealFs),
            cmd: Arc::new(crate::process::SystemRunner),
            #[cfg(windows)]
            registry: Arc::new(RealRegistry),
            #[cfg(not(windows))]
            registry: Arc::new(NoRegistry),
            path_dirs: std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default(),
        }
    }
}

/// Ein Fund vor der Umwandlung in `Installation`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Found {
    pub program_id: String,
    pub kind: InstallKind,
    /// Startdatei, `.app`, AppImage oder Flatpak-/Snap-Kennung.
    pub location: String,
    /// Wird die Datei wirklich gestartet (nicht bei Flatpak/Snap-Vermittlern)?
    pub is_path: bool,
    pub version: Option<String>,
}

pub(crate) fn installation_from(found: &Found) -> Installation {
    let mut problems = Vec::new();
    if found.version.is_none() {
        problems.push(InstallationProblem::VersionUnknown);
    }
    match found.kind {
        InstallKind::Snap | InstallKind::Msstore => {
            problems.push(InstallationProblem::SetupNotSupported { reason: SetupUnsupportedReason::InstallKind });
        }
        _ => {}
    }
    let id = match found.kind {
        InstallKind::Flatpak => format!("flatpak:{}", found.location),
        InstallKind::Manual => format!("manual:{}:{}", found.program_id, short_hash(&found.location)),
        _ => format!("system:{}:{}", found.program_id, short_hash(&found.location)),
    };
    let location = if found.is_path { display_path(Path::new(&found.location)) } else { found.location.clone() };
    Installation {
        id,
        program_id: found.program_id.clone(),
        version: found.version.clone(),
        kind: found.kind,
        managed_by_cypher: false,
        location,
        launchable: true,
        problems,
        installed_at: None,
        detected_at: now_iso(),
        verified: None,
        setup_scope_id: None,
    }
}

/// Erkennt alle Programme des Katalogs. Von Cypher verwaltete Installationen (`managed`) werden nicht noch einmal
/// als System-Installation gemeldet.
pub fn detect_all(env: &DetectEnv, catalog: &Catalog, managed: &[StoredInstallation]) -> Vec<Installation> {
    let managed_roots: Vec<PathBuf> = managed.iter().map(|m| PathBuf::from(&m.path)).collect();
    let mut out: Vec<Installation> = Vec::new();
    for program in &catalog.programs {
        let mut found = strategies::detect_program(env, program);
        found.retain(|f| !(f.is_path && managed_roots.iter().any(|r| Path::new(&f.location).starts_with(r))));
        // gleiche Datei nur einmal (z. B. PATH und .desktop-Datei)
        let mut seen = std::collections::BTreeSet::new();
        found.retain(|f| seen.insert((f.kind as u8, f.location.clone())));
        found.sort_by(|a, b| (a.kind as u8, &a.location).cmp(&(b.kind as u8, &b.location)));
        out.extend(found.iter().map(installation_from));
    }
    out
}

/// Prüft eine vom Nutzer gewählte Datei (`program_add_manual`): Startdatei, `.app` oder AppImage.
pub fn probe_manual(env: &DetectEnv, spec: &ProgramSpec, picked: &Path) -> Result<Installation, DetectError> {
    let found = strategies::probe_manual(env, spec, picked)
        .ok_or_else(|| DetectError::NotRecognized { program: spec.name.clone(), path: picked.to_path_buf() })?;
    Ok(installation_from(&found))
}
