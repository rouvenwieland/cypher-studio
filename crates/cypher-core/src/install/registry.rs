//! Verwaltete Installationen: Darstellung für das Frontend, Prozessprüfung, Entfernen und Wiederherstellung nach
//! einem Absturz (ARCHITEKTUR.md 2.7, 5.1).

use std::path::{Path, PathBuf};

use super::appimage;
use super::exec::{Journal, STAGING_DIR};
use crate::api::{FuseFallback, InstallKind, Installation, InstallationProblem};
use crate::error::{InstallError, IoError};
use crate::platform::{PlatformInfo, display_path, fsx};
use crate::process::CommandRunner;
use crate::state::{StateStore, StoredInstallation, StoredLauncher};
use crate::util::now_iso;

/// Absoluter Pfad des Startprogramms einer verwalteten Installation.
pub fn launch_path(stored: &StoredInstallation) -> PathBuf {
    let root = Path::new(&stored.path);
    match &stored.launcher {
        StoredLauncher::Exe { rel_exe } => join_rel(root, rel_exe),
        StoredLauncher::MacApp { rel_bundle } => join_rel(root, rel_bundle),
        StoredLauncher::AppImage { rel_file, rel_app_run } => match rel_app_run {
            Some(run) => join_rel(root, run),
            None => join_rel(root, rel_file),
        },
    }
}

fn join_rel(root: &Path, rel: &str) -> PathBuf {
    let mut out = root.to_path_buf();
    for comp in rel.split('/').filter(|c| !c.is_empty()) {
        out.push(comp);
    }
    out
}

/// Darstellung einer verwalteten Installation.
pub fn installation_dto(
    stored: &StoredInstallation,
    _platform: &PlatformInfo,
    _runner: &dyn CommandRunner,
) -> Installation {
    let exe = launch_path(stored);
    let mut problems = Vec::new();
    // macOS-App liegt direkt im Zielordner; der Pfad des Bundles genügt
    let launchable = match &stored.launcher {
        StoredLauncher::MacApp { .. } => exe.is_dir(),
        _ => exe.is_file(),
    };
    if !launchable {
        problems.push(InstallationProblem::ExecutableMissing);
    }
    if let StoredLauncher::AppImage { rel_app_run, .. } = &stored.launcher
        && cfg!(target_os = "linux")
        && !appimage::fuse2_available()
    {
        problems.push(InstallationProblem::FuseMissing {
            fallback: if rel_app_run.is_some() { FuseFallback::Extracted } else { FuseFallback::ExtractAndRun },
        });
    }
    if stored.not_notarized {
        problems.push(InstallationProblem::NotNotarized);
    }
    Installation {
        id: stored.id.clone(),
        program_id: stored.program_id.clone(),
        version: Some(stored.version.clone()),
        kind: InstallKind::Cypher,
        managed_by_cypher: true,
        location: display_path(&exe),
        launchable,
        problems,
        installed_at: Some(stored.installed_at.clone()),
        detected_at: now_iso(),
        verified: Some(crate::api::VerifiedInfo {
            sha256: stored.verified.sha256.clone(),
            catalog_sequence: stored.verified.catalog_sequence,
            signature_checked: stored.verified.signature_checked,
        }),
        setup_scope_id: None,
    }
}

/// `true`, wenn irgendein Prozess eine Programmdatei unterhalb von `dir` ausführt.
pub fn running_in(dir: &Path) -> bool {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(sysinfo::UpdateKind::Always),
    );
    sys.processes().values().any(|p| p.exe().is_some_and(|exe| exe.starts_with(dir)))
}

/// Entfernt eine verwaltete Installation: nur unterhalb ihres Programmordners, nie bei laufendem Programm.
pub fn remove_managed(state: &StateStore, installation_id: &str) -> Result<(), InstallError> {
    let stored = state
        .read(|s| s.installations.iter().find(|i| i.id == installation_id).cloned())
        .ok_or_else(|| InstallError::NotFound(installation_id.to_owned()))?;
    let dir = PathBuf::from(&stored.path);
    let root = stored.programs_root.as_deref().map(PathBuf::from).ok_or_else(|| InstallError::InvalidInput {
        field: "installationId".into(),
        reason: "Programmordner der Installation unbekannt".into(),
    })?;
    if running_in(&dir) {
        return Err(InstallError::ProgramRunning);
    }
    fsx::remove_dir_managed(&dir, &root)?;
    state.update(|s| {
        s.installations.retain(|i| i.id != installation_id);
        s.preferred.retain(|_, v| v != installation_id);
    })?;
    // Programmordner `<root>/<programId>` räumen, wenn leer
    if let Some(parent) = dir.parent()
        && parent != root
    {
        let _ = std::fs::remove_dir(parent);
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RecoveryReport {
    /// Unvollständige Staging-Ordner, die entfernt wurden.
    pub removed_staging: u32,
    /// Alte Versionen (`.old-…`), die zurückgestellt wurden, weil das Ziel fehlte.
    pub restored_old: u32,
    /// Installationen, die aus dem Journal nachträglich registriert wurden.
    pub registered: u32,
}

/// Räumt nach einem Absturz auf (beim App-Start): unfertiges Staging löschen, `.old-…` zurückstellen oder löschen,
/// halb registrierte Installationen vollenden.
pub fn recover_on_startup(programs_dir: &Path, state: &StateStore) -> Result<RecoveryReport, InstallError> {
    let mut report = RecoveryReport::default();
    let staging_root = programs_dir.join(STAGING_DIR);
    if staging_root.is_dir() {
        let entries = std::fs::read_dir(&staging_root).map_err(|e| IoError::read(&staging_root, e))?;
        let mut journals = Vec::new();
        let mut others = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") && path.to_string_lossy().ends_with(".journal.json") {
                journals.push(path);
            } else {
                others.push(path);
            }
        }
        for journal_path in journals {
            let journal: Option<Journal> = fsx::read_json(&journal_path).ok().flatten();
            if let Some(j) = journal {
                let target = PathBuf::from(&j.target_dir);
                let old = j.old_dir.as_deref().map(PathBuf::from);
                if j.state == "renamed" && target.exists() {
                    // Ziel steht, Zustand fehlt womöglich: nachtragen
                    let id = j.installation.id.clone();
                    if state.read(|s| s.installations.iter().all(|i| i.id != id)) {
                        let stored = j.installation.clone();
                        state.update(|s| {
                            s.installations.push(stored.clone());
                            s.preferred.entry(stored.program_id.clone()).or_insert_with(|| stored.id.clone());
                        })?;
                        report.registered += 1;
                    }
                    if let Some(old) = &old {
                        let _ = fsx::remove_dir_all_forced(old);
                    }
                } else {
                    // Staging war nicht fertig: alte Version zurückstellen, wenn das Ziel fehlt
                    if let Some(old) = &old
                        && old.exists()
                    {
                        if target.exists() {
                            let _ = fsx::remove_dir_all_forced(old);
                        } else if std::fs::rename(old, &target).is_ok() {
                            report.restored_old += 1;
                        }
                    }
                    let staging = PathBuf::from(&j.staging_dir);
                    if staging.exists() {
                        let _ = fsx::remove_dir_all_forced(&staging);
                        report.removed_staging += 1;
                    }
                }
            }
            let _ = std::fs::remove_file(&journal_path);
        }
        // Reste ohne Journal (z. B. Einhängeordner)
        for path in others {
            if path.is_dir() {
                let _ = fsx::remove_dir_all_forced(&path);
                report.removed_staging += 1;
            } else {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    // verwaiste `.old-…`-Ordner neben bekannten Zielen
    let installs = state.read(|s| s.installations.clone());
    for stored in installs {
        let target = PathBuf::from(&stored.path);
        if let (Some(parent), Some(name)) = (target.parent(), target.file_name()) {
            let prefix = format!("{}.old-", name.to_string_lossy());
            if let Ok(rd) = std::fs::read_dir(parent) {
                for e in rd.flatten() {
                    if e.file_name().to_string_lossy().starts_with(&prefix) {
                        if target.exists() {
                            let _ = fsx::remove_dir_all_forced(&e.path());
                        } else if std::fs::rename(e.path(), &target).is_ok() {
                            report.restored_old += 1;
                        }
                    }
                }
            }
        }
    }
    Ok(report)
}
