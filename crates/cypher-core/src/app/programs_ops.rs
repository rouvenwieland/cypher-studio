//! Programme: Ansicht, Erkennung, Installation, Entfernen, Start (ARCHITEKTUR.md 3.2, 3.3, 5.0, 5.1).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::api::{
    AddManualReq, AppInfo, EntityKind, InstallEvent, InstallKind, InstallPlan, InstallPreviewReq, InstallStartReq,
    Installation, InstallationProblem, InstallationRemoveReq, JobKind, JobResult, LaunchMode, LaunchReq, LaunchResult,
    ProgramOverview, ProgramRelease, ProgramsChangedReason, ProgramsView, RemoveMode, SetPreferredReq,
};
use crate::catalog::{ProgVer, ProgramSpec};
use crate::error::CoreError;
use crate::install::{
    InstallCtx, PlanInput, installation_dto, launch_path, plan as install_plan, remove_managed, running_in,
};
use crate::launch::{self, Launcher, expand_home};
use crate::platform::display_path;
use crate::progress::ProgressSink;
use crate::setup::{SetupInstall, resolve_scopes};
use crate::state::StoredManual;
use crate::util::now_iso;

use super::App;

fn not_found(entity: EntityKind, id: &str) -> CoreError {
    CoreError::NotFound { entity, id: id.to_owned() }
}

impl App {
    pub fn app_info(&self) -> AppInfo {
        AppInfo {
            app_version: self.app_version.clone(),
            contract_version: crate::api::names::IPC_CONTRACT_VERSION.to_owned(),
            os: self.platform.os,
            arch: self.platform.arch,
            os_version: self.platform.os_version.clone(),
            data_dir: display_path(&self.dirs.data),
            logs_dir: display_path(&self.dirs.logs),
            build_channel: self.build_channel,
        }
    }

    // --- Erkennung ---------------------------------------------------------------------------------

    /// Erkennt Installationen (blockierend; nur lesend).
    pub(crate) fn detect_now(&self) -> Vec<Installation> {
        let current = self.catalog.current();
        let managed = self.state.read(|s| s.installations.clone());
        let mut found = crate::detect::detect_all(&self.detect_env, &current.catalog, &managed);
        for m in self.state.read(|s| s.manual_installations.clone()) {
            let Some(spec) = current.catalog.program(&m.program_id) else { continue };
            match crate::detect::probe_manual(&self.detect_env, spec, Path::new(&m.path)) {
                Ok(mut inst) => {
                    inst.id = m.id.clone();
                    inst.kind = InstallKind::Manual;
                    found.push(inst);
                }
                Err(_) => found.push(Installation {
                    id: m.id.clone(),
                    program_id: m.program_id.clone(),
                    version: None,
                    kind: InstallKind::Manual,
                    managed_by_cypher: false,
                    location: display_path(Path::new(&m.path)),
                    launchable: false,
                    problems: vec![InstallationProblem::ExecutableMissing],
                    installed_at: None,
                    detected_at: now_iso(),
                    verified: None,
                    setup_scope_id: None,
                }),
            }
        }
        found
    }

    /// Räumt nach Abstürzen auf und erkennt Installationen einmal (App-Start, Ablauf 5.0).
    pub async fn startup(self: &Arc<Self>) -> Result<(), CoreError> {
        let this = self.clone();
        Self::blocking(move || {
            let programs_dir = PathBuf::from(this.settings.get().programs_dir);
            if programs_dir.is_dir()
                && let Err(e) = crate::install::recover_on_startup(&programs_dir, &this.state)
            {
                tracing::warn!("Aufräumen der Installationen nach Absturz: {e}");
            }
            let rolled_back = crate::setup::recover(&this.setup_store, &*this.fonts);
            if rolled_back > 0 {
                tracing::warn!("{rolled_back} unterbrochene Einrichtung(en) zurückgerollt");
            }
        })
        .await?;
        self.open_library_from_settings().await;
        self.rescan().await?;
        Ok(())
    }

    pub async fn rescan(self: &Arc<Self>) -> Result<ProgramsView, CoreError> {
        let this = self.clone();
        let found = Self::blocking(move || this.detect_now()).await?;
        if let Ok(mut w) = self.detected.write() {
            *w = found;
        }
        self.emit_programs(ProgramsChangedReason::Rescanned);
        Ok(self.programs_view())
    }

    // --- Ansicht -----------------------------------------------------------------------------------

    /// Verwaltete Installationen (Zustand) und erkannte, zusammen.
    pub(crate) fn all_installations(&self) -> Vec<Installation> {
        let stored = self.state.read(|s| s.installations.clone());
        let latest = |program: &str| -> Option<String> {
            let current = self.catalog.current();
            current.catalog.release_for(program, None, None, &self.platform).ok().map(|s| s.release.version.clone())
        };
        let mut out: Vec<Installation> = stored
            .iter()
            .map(|s| {
                let mut dto = installation_dto(s, &self.platform, &*self.runner);
                if let (Some(latest), Ok(have)) = (latest(&s.program_id), ProgVer::parse(&s.version))
                    && ProgVer::parse(&latest).is_ok_and(|l| have < l)
                {
                    dto.problems.push(InstallationProblem::StaleCatalogVersion { latest });
                }
                dto
            })
            .collect();
        let seen: std::collections::BTreeSet<String> = out.iter().map(|o| o.id.clone()).collect();
        out.extend(self.detected_snapshot().into_iter().filter(|d| !seen.contains(&d.id)));
        out
    }

    /// Echte Pfade der Installationen für die Einrichtung.
    pub(crate) fn setup_installs(&self, installs: &[Installation]) -> Vec<SetupInstall> {
        let stored = self.state.read(|s| s.installations.clone());
        installs
            .iter()
            .map(|i| {
                if let Some(s) = stored.iter().find(|s| s.id == i.id) {
                    SetupInstall {
                        id: i.id.clone(),
                        program_id: i.program_id.clone(),
                        kind: i.kind,
                        version: i.version.clone(),
                        path: PathBuf::from(&s.path),
                        exe: Some(launch_path(s)),
                    }
                } else {
                    let path = if matches!(i.kind, InstallKind::Flatpak | InstallKind::Snap | InstallKind::Msstore) {
                        PathBuf::from(&i.location)
                    } else {
                        expand_home(&i.location)
                    };
                    let exe = matches!(i.kind, InstallKind::System | InstallKind::Manual | InstallKind::Steam)
                        .then(|| path.clone());
                    SetupInstall {
                        id: i.id.clone(),
                        program_id: i.program_id.clone(),
                        kind: i.kind,
                        version: i.version.clone(),
                        path,
                        exe,
                    }
                }
            })
            .collect()
    }

    fn release_view(&self, program: &ProgramSpec) -> Option<ProgramRelease> {
        let current = self.catalog.current();
        if let Ok(sel) = current.catalog.release_for(&program.id, None, None, &self.platform) {
            return Some(ProgramRelease {
                version: sel.release.version.clone(),
                channel: sel.release.channel,
                released_at: sel.release.released_at.clone(),
                download_size: sel.artifact.size,
                available_for_this_platform: true,
            });
        }
        // Kein Artefakt für dieses System: trotzdem die neueste stabile/LTS-Version anzeigen
        let mut best: Option<(ProgVer, &crate::catalog::ReleaseSpec)> = None;
        for r in &program.releases {
            if r.channel == crate::api::ReleaseChannel::Preview {
                continue;
            }
            if let Ok(v) = ProgVer::parse(&r.version)
                && best.as_ref().is_none_or(|(b, _)| v > *b)
            {
                best = Some((v, r));
            }
        }
        best.map(|(_, r)| ProgramRelease {
            version: r.version.clone(),
            channel: r.channel,
            released_at: r.released_at.clone(),
            download_size: 0,
            available_for_this_platform: false,
        })
    }

    pub fn programs_view(&self) -> ProgramsView {
        let current = self.catalog.current();
        let catalog = &current.catalog;
        let installs = self.all_installations();
        let setup_installs = self.setup_installs(&installs);
        let packs = self.current_packs();
        let preferred = self.state.read(|s| s.preferred.clone());
        let mut programs = Vec::new();
        for spec in &catalog.programs {
            let latest = self.release_view(spec);
            let mut mine: Vec<Installation> = installs.iter().filter(|i| i.program_id == spec.id).cloned().collect();
            mine.sort_by_key(|i| (!i.managed_by_cypher, i.kind as u8));
            let update_available = latest.as_ref().is_some_and(|l| {
                l.available_for_this_platform
                    && mine.iter().filter(|i| i.managed_by_cypher).any(|i| {
                        i.version
                            .as_deref()
                            .and_then(|v| ProgVer::parse(v).ok())
                            .zip(ProgVer::parse(&l.version).ok())
                            .is_some_and(|(have, new)| have < new)
                    })
            });
            let preferred_id = preferred
                .get(&spec.id)
                .filter(|id| mine.iter().any(|i| &i.id == *id))
                .cloned()
                .or_else(|| mine.iter().find(|i| i.launchable).map(|i| i.id.clone()));
            // Einrichtung
            let mut setup = None;
            if let Some(setup_spec) = &spec.setup
                && let Some(pack) = packs.packs.iter().find(|p| p.id == setup_spec.pack_id)
            {
                let mine_setup: Vec<SetupInstall> =
                    setup_installs.iter().filter(|i| i.program_id == spec.id).cloned().collect();
                let scopes = resolve_scopes(pack, &mine_setup, &self.roots_env);
                for scope in &scopes {
                    for i in mine.iter_mut().filter(|i| scope.installation_ids.contains(&i.id)) {
                        i.setup_scope_id = Some(scope.scope_id.clone());
                        if let Some(reason) = scope.unsupported
                            && !i.problems.iter().any(|p| matches!(p, InstallationProblem::SetupNotSupported { .. }))
                        {
                            i.problems.push(InstallationProblem::SetupNotSupported { reason });
                        }
                    }
                }
                setup = Some(crate::setup::summary(pack, &scopes, &self.setup_store));
            }
            programs.push(ProgramOverview {
                id: spec.id.clone(),
                name: spec.name.clone(),
                vendor: spec.vendor.clone(),
                category: spec.category,
                description: spec.description.clone(),
                license: spec.license.clone(),
                supported_on_this_platform: latest.as_ref().is_some_and(|l| l.available_for_this_platform),
                latest,
                installations: mine,
                preferred_installation_id: preferred_id,
                update_available,
                setup,
            });
        }
        let links = catalog
            .links
            .iter()
            .map(|l| crate::api::CatalogLink {
                id: l.id.clone(),
                name: l.name.clone(),
                description: l.description.clone(),
                note: l.note.clone(),
            })
            .collect();
        ProgramsView { programs, links, catalog: self.catalog.status() }
    }

    pub fn program_set_preferred(&self, req: &SetPreferredReq) -> Result<ProgramOverview, CoreError> {
        let view = self.programs_view();
        let program = view
            .programs
            .iter()
            .find(|p| p.id == req.program_id)
            .ok_or_else(|| not_found(EntityKind::Program, &req.program_id))?;
        if !program.installations.iter().any(|i| i.id == req.installation_id) {
            return Err(not_found(EntityKind::Installation, &req.installation_id));
        }
        self.state.update(|s| {
            s.preferred.insert(req.program_id.clone(), req.installation_id.clone());
        })?;
        self.emit_programs(ProgramsChangedReason::PreferredChanged);
        self.programs_view()
            .programs
            .into_iter()
            .find(|p| p.id == req.program_id)
            .ok_or_else(|| not_found(EntityKind::Program, &req.program_id))
    }

    /// Fügt eine vom Nutzer gewählte Datei als Installation hinzu (`picked` stammt aus dem nativen Dialog).
    pub async fn program_add_manual(
        self: &Arc<Self>,
        req: &AddManualReq,
        picked: &Path,
    ) -> Result<Installation, CoreError> {
        let this = self.clone();
        let (program_id, picked) = (req.program_id.clone(), picked.to_path_buf());
        let inst = Self::blocking(move || -> Result<Installation, CoreError> {
            let current = this.catalog.current();
            let spec =
                current.catalog.program(&program_id).ok_or_else(|| not_found(EntityKind::Program, &program_id))?;
            let inst = crate::detect::probe_manual(&this.detect_env, spec, &picked)?;
            let stored = StoredManual {
                id: inst.id.clone(),
                program_id: program_id.clone(),
                path: picked.to_string_lossy().into_owned(),
            };
            this.state.update(|s| {
                s.manual_installations.retain(|m| m.id != stored.id);
                s.manual_installations.push(stored);
            })?;
            Ok(inst)
        })
        .await??;
        self.rescan().await?;
        Ok(inst)
    }

    // --- Installation ------------------------------------------------------------------------------

    pub fn install_preview(&self, req: &InstallPreviewReq) -> Result<InstallPlan, CoreError> {
        let current = self.catalog.current();
        if current.catalog.program(&req.program_id).is_none() {
            return Err(not_found(EntityKind::Program, &req.program_id));
        }
        let settings = self.settings.get();
        let known = self.all_installations();
        let expired = current.warnings.iter().any(|w| matches!(w, crate::catalog::CatalogWarning::Expired { .. }));
        let data = install_plan(
            &PlanInput {
                catalog: &current.catalog,
                catalog_sequence: current.catalog.sequence,
                catalog_expired: expired,
                platform: &self.platform,
                dirs: &self.dirs,
                settings: &settings,
                hosts: &self.hosts,
                known: &known,
                fuse_available: crate::install::appimage::fuse2_available(),
            },
            &req.program_id,
            req.version.as_deref(),
            req.channel,
        )?;
        let dto = data.dto.clone();
        self.install_plans.insert(dto.plan_id.clone(), data);
        Ok(dto)
    }

    /// Führt einen Plan aus. `sink` bekommt die Ereignisse (zusätzlich wird der Auftrag fortgeschrieben).
    pub async fn install_start(
        self: &Arc<Self>,
        req: &InstallStartReq,
        sink: &dyn ProgressSink<InstallEvent>,
    ) -> Result<Installation, CoreError> {
        let plan = self.install_plans.take(&req.plan_id).map_err(|e| CoreError::PlanExpired(e.0))?;
        let job =
            self.jobs.start(JobKind::Install, &plan.dto.program_name, &format!("install:{}", plan.program_id), true)?;
        let settings = self.settings.get();
        let ctx = InstallCtx {
            dirs: &self.dirs,
            http: &self.http,
            state: &self.state,
            platform: &self.platform,
            settings: &settings,
            runner: self.runner.clone(),
            job_id: &job.id,
        };
        let progress = JobProgress { job: &job, inner: sink };
        let cancel = job.token.clone();
        let result = crate::install::execute(&ctx, plan, &req.consent, &progress, &cancel).await;
        match result {
            Ok(installation) => {
                job.finish_ok(JobResult::Installation { installation_id: installation.id.clone() });
                self.emit_programs(ProgramsChangedReason::Installed);
                Ok(installation)
            }
            Err(e) => {
                let err = CoreError::from(e);
                job.finish_err(crate::api::AppError::from(&err));
                Err(err)
            }
        }
    }

    pub fn installation_remove(&self, req: &InstallationRemoveReq) -> Result<(), CoreError> {
        let stored = self.state.read(|s| s.installations.iter().find(|i| i.id == req.installation_id).cloned());
        match (stored, req.mode) {
            (Some(s), RemoveMode::DeleteFiles) => {
                let dir = PathBuf::from(&s.path);
                // Einrichtungen im portablen Bereich verschwinden mit dem Ordner; ihre Manifeste werden mit entfernt
                self.forget_setups_under(&dir);
                remove_managed(&self.state, &req.installation_id)?;
                self.emit_programs(ProgramsChangedReason::Removed);
                Ok(())
            }
            (Some(_), RemoveMode::Forget) => {
                self.state.update(|st| {
                    st.installations.retain(|i| i.id != req.installation_id);
                    st.preferred.retain(|_, v| v != &req.installation_id);
                })?;
                self.emit_programs(ProgramsChangedReason::Removed);
                Ok(())
            }
            (None, RemoveMode::Forget) => {
                let had = self.state.update(|st| {
                    let before = st.manual_installations.len();
                    st.manual_installations.retain(|m| m.id != req.installation_id);
                    st.preferred.retain(|_, v| v != &req.installation_id);
                    before != st.manual_installations.len()
                })?;
                if !had {
                    return Err(CoreError::invalid_input(
                        "installationId",
                        "Nur Cypher-Installationen und manuell hinzugefügte lassen sich vergessen",
                    ));
                }
                self.emit_programs(ProgramsChangedReason::Removed);
                Ok(())
            }
            (None, RemoveMode::DeleteFiles) => {
                if self.detected_snapshot().iter().any(|i| i.id == req.installation_id) {
                    Err(CoreError::invalid_input(
                        "installationId",
                        "Von Cypher Studio nicht installierte Programme werden nie gelöscht",
                    ))
                } else {
                    Err(not_found(EntityKind::Installation, &req.installation_id))
                }
            }
        }
    }

    /// Markiert Einrichtungen, deren Wurzeln unter `dir` liegen, als zurückgenommen (die Dateien verschwinden mit dem Ordner).
    fn forget_setups_under(&self, dir: &Path) {
        for mut m in self.setup_store.list_manifests() {
            let under = m.roots.values().any(|r| Path::new(r).starts_with(dir));
            if under && m.status != crate::setup::store::ManifestStatus::Undone {
                m.status = crate::setup::store::ManifestStatus::Undone;
                m.undone_at = Some(now_iso());
                let _ = self.setup_store.save_manifest(&m);
            }
        }
    }

    // --- Start -------------------------------------------------------------------------------------

    pub(crate) fn launcher_for(&self, inst: &Installation) -> Result<Launcher, CoreError> {
        // Modus „Entpacken“: nie über FUSE starten, das AppImage entpackt sich beim Start selbst
        let fuse = crate::install::appimage::fuse2_available()
            && self.settings.get().linux.app_image_mode != crate::api::AppImageMode::Extract;
        if let Some(stored) = self.state.read(|s| s.installations.iter().find(|i| i.id == inst.id).cloned()) {
            return Ok(Launcher::from_stored(&stored, fuse));
        }
        Ok(Launcher::from_detected(inst, fuse)?)
    }

    pub fn program_launch(&self, req: &LaunchReq) -> Result<LaunchResult, CoreError> {
        let view = self.programs_view();
        let program = view
            .programs
            .iter()
            .find(|p| p.id == req.program_id)
            .ok_or_else(|| not_found(EntityKind::Program, &req.program_id))?;
        let inst = match &req.installation_id {
            Some(id) => program
                .installations
                .iter()
                .find(|i| &i.id == id)
                .ok_or_else(|| not_found(EntityKind::Installation, id))?,
            None => program
                .preferred_installation_id
                .as_ref()
                .and_then(|id| program.installations.iter().find(|i| &i.id == id))
                .or_else(|| program.installations.iter().find(|i| i.launchable))
                .ok_or_else(|| not_found(EntityKind::Installation, &req.program_id))?,
        };
        let mut files = Vec::new();
        for h in req.files.iter().flatten() {
            files.push(self.handles.resolve(h).ok_or_else(|| not_found(EntityKind::FileHandle, h))?);
        }
        self.launch_installation(inst, &files, req.mode.unwrap_or(LaunchMode::Normal))
    }

    pub(crate) fn launch_installation(
        &self,
        inst: &Installation,
        files: &[PathBuf],
        mode: LaunchMode,
    ) -> Result<LaunchResult, CoreError> {
        if !inst.launchable {
            return Err(crate::error::LaunchError::NotLaunchable("Die Startdatei fehlt".into()).into());
        }
        let launcher = self.launcher_for(inst)?;
        let spec = launch::build(&launcher, &inst.program_id, files, mode, &self.platform)?;
        let pid = launch::spawn(&spec)?;
        Ok(LaunchResult {
            program_id: inst.program_id.clone(),
            installation_id: inst.id.clone(),
            pid,
            started_at: now_iso(),
        })
    }

    /// Läuft das Programm der Installation gerade?
    pub(crate) fn installation_running(&self, inst: &Installation) -> bool {
        match self.state.read(|s| s.installations.iter().find(|i| i.id == inst.id).cloned()) {
            Some(s) => running_in(Path::new(&s.path)),
            None if matches!(inst.kind, InstallKind::System | InstallKind::Manual | InstallKind::Steam) => {
                launch::running_instances(&expand_home(&inst.location)) > 0
            }
            None => false,
        }
    }

    /// Ein bevorzugtes, startbares Programm für `program_id` (für Projektdateien).
    pub(crate) fn launchable_installation(&self, program_id: &str) -> Option<Installation> {
        let view = self.programs_view();
        let program = view.programs.into_iter().find(|p| p.id == program_id)?;
        let preferred = program.preferred_installation_id.clone();
        program
            .installations
            .iter()
            .find(|i| Some(&i.id) == preferred.as_ref() && i.launchable)
            .cloned()
            .or_else(|| program.installations.iter().find(|i| i.launchable).cloned())
    }

    /// Beobachtet, ob ein Plan (nur für Tests) noch im Speicher liegt.
    pub fn install_plan_pending(&self, plan_id: &str) -> bool {
        self.install_plans.peek(plan_id, |_| ()).is_some()
    }
}

/// Reicht Installationsereignisse an den Aufrufer weiter und schreibt den Fortschritt in den Auftrag.
struct JobProgress<'a> {
    job: &'a crate::jobs::JobGuard,
    inner: &'a dyn ProgressSink<InstallEvent>,
}

impl ProgressSink<InstallEvent> for JobProgress<'_> {
    fn emit(&self, event: InstallEvent) {
        match &event {
            InstallEvent::Phase { phase } => {
                let name = match phase {
                    crate::api::InstallPhase::Download => "download",
                    crate::api::InstallPhase::VerifyChecksum => "verifyChecksum",
                    crate::api::InstallPhase::VerifySignature => "verifySignature",
                    crate::api::InstallPhase::Extract => "extract",
                    crate::api::InstallPhase::CheckContent => "checkContent",
                    crate::api::InstallPhase::Register => "register",
                };
                self.job.progress(None, name);
            }
            InstallEvent::DownloadProgress { downloaded_bytes, total_bytes, .. } if *total_bytes > 0 => {
                // Download = 0..0,6 des Gesamtfortschritts, Entpacken der Rest
                self.job.progress(Some(*downloaded_bytes as f64 / *total_bytes as f64 * 0.6), "download");
            }
            InstallEvent::ExtractProgress { entries_done, entries_total: Some(total), .. } if *total > 0 => {
                self.job.progress(Some(0.6 + *entries_done as f64 / *total as f64 * 0.4), "extract");
            }
            _ => {}
        }
        self.inner.emit(event);
    }
}
