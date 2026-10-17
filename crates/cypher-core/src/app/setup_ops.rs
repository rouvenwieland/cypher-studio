//! Einrichtung: Pakete, Vorschau, Anwenden, Zurücknehmen, Verlauf (ARCHITEKTUR.md 2.10, 5.2).

use std::path::PathBuf;
use std::sync::Arc;

use crate::api::{
    EntityKind, Installation, JobKind, JobResult, ProgramsChangedReason, SetupApplyReq, SetupEvent, SetupHistoryReq,
    SetupPlan, SetupPreviewReq, SetupRecord, SetupStatusReq, SetupSummary, SetupUndoReq, UndoReport,
};
use crate::error::{BusyInfo, CoreError};
use crate::progress::ProgressSink;
use crate::setup::{
    ApplyEnv, ApplySelection, PackManifest, PlanInput, ResolvedScope, SetupInstall, plan, resolve_scopes,
};
use crate::state::StoredSetup;

use super::App;

pub type SharedSink<E> = Arc<dyn ProgressSink<E>>;

fn not_found(id: &str) -> CoreError {
    CoreError::NotFound { entity: EntityKind::SetupScope, id: id.to_owned() }
}

impl App {
    /// Bereiche eines Pakets für die aktuellen Installationen.
    fn scopes_for(&self, pack: &PackManifest) -> (Vec<ResolvedScope>, Vec<Installation>) {
        let installs = self.all_installations();
        let mine: Vec<Installation> =
            installs.into_iter().filter(|i| pack.program_id.as_deref().is_none_or(|p| p == i.program_id)).collect();
        let setup_installs: Vec<SetupInstall> = self.setup_installs(&mine);
        (resolve_scopes(pack, &setup_installs, &self.roots_env), mine)
    }

    fn find_pack(&self, pack_id: &str) -> Result<(Arc<crate::setup::LoadedPacks>, usize), CoreError> {
        let packs = self.current_packs();
        let idx = packs.packs.iter().position(|p| p.id == pack_id).ok_or_else(|| not_found(pack_id))?;
        Ok((packs, idx))
    }

    pub fn setup_packs_list(&self) -> Vec<SetupSummary> {
        let packs = self.current_packs();
        packs
            .packs
            .iter()
            .map(|pack| {
                let (scopes, _) = self.scopes_for(pack);
                crate::setup::summary(pack, &scopes, &self.setup_store)
            })
            .collect()
    }

    pub fn setup_status(&self, req: &SetupStatusReq) -> Result<SetupSummary, CoreError> {
        let (packs, idx) = self.find_pack(&req.pack_id)?;
        let pack = &packs.packs[idx];
        let (scopes, _) = self.scopes_for(pack);
        Ok(crate::setup::summary(pack, &scopes, &self.setup_store))
    }

    pub fn setup_preview(&self, req: &SetupPreviewReq) -> Result<SetupPlan, CoreError> {
        let (packs, idx) = self.find_pack(&req.pack_id)?;
        let pack = &packs.packs[idx];
        let (scopes, installs) = self.scopes_for(pack);
        let scope = scopes.iter().find(|s| s.scope_id == req.scope_id).ok_or_else(|| not_found(&req.scope_id))?;
        let in_scope: Vec<&Installation> = installs.iter().filter(|i| scope.installation_ids.contains(&i.id)).collect();
        let running = in_scope.iter().any(|i| self.installation_running(i));
        let program_version = in_scope.iter().find_map(|i| i.version.clone());
        let library_root = self.settings.get().library_root.map(PathBuf::from);
        let data = plan(&PlanInput {
            pack,
            scope,
            store: &self.setup_store,
            os: self.platform.os,
            program_version: program_version.as_deref(),
            library_root: library_root.as_deref(),
            program_running: running,
        })?;
        let dto = data.dto.clone();
        self.setup_plans.insert(dto.plan_id.clone(), data);
        Ok(dto)
    }

    fn remember_setup(&self, record: &SetupRecord) {
        let stored = StoredSetup {
            setup_id: record.setup_id.clone(),
            pack_id: record.pack_id.clone(),
            program_id: record.program_id.clone(),
            scope_id: record.scope_id.clone(),
            pack_version: record.pack_version.clone(),
            applied_at: record.applied_at.clone(),
            status: format!("{:?}", record.status).to_lowercase(),
            files_written: record.files_written,
            backups_taken: record.backups_taken,
        };
        let _ = self.state.update(|s| {
            s.setups.retain(|x| x.setup_id != stored.setup_id);
            s.setups.push(stored);
        });
    }

    pub async fn setup_apply(
        self: &Arc<Self>,
        req: &SetupApplyReq,
        sink: SharedSink<SetupEvent>,
    ) -> Result<SetupRecord, CoreError> {
        let plan_data = self.setup_plans.take(&req.plan_id).map_err(|e| CoreError::PlanExpired(e.0))?;
        // Läuft das Programm und verlangt das Paket, dass es geschlossen ist?
        if plan_data.pack.requires_program_closed && plan_data.dto.program_running {
            return Err(CoreError::Busy(BusyInfo { reason: crate::api::BusyReason::ProgramRunning, job_id: None }));
        }
        let key = format!("setup:{}:{}", plan_data.pack.id, plan_data.scope.scope_id);
        let job = self.jobs.start(JobKind::SetupApply, &plan_data.pack.title, &key, true)?;
        let selection = ApplySelection { components: req.components.clone(), resolutions: req.resolutions.clone() };
        let this = self.clone();
        let job_id = job.id.clone();
        let cancel = job.token.clone();
        let progress = sink.clone();
        let outcome = Self::blocking(move || {
            let fonts = this.fonts.clone();
            crate::setup::apply::apply(
                plan_data,
                &selection,
                &ApplyEnv { store: &this.setup_store, runner: &*this.runner, fonts: &*fonts, job_id: &job_id },
                &*progress,
                &cancel,
            )
        })
        .await?;
        match outcome {
            Ok(record) => {
                self.remember_setup(&record);
                job.finish_ok(JobResult::Setup { setup_id: record.setup_id.clone() });
                self.emit_programs(ProgramsChangedReason::SetupChanged);
                Ok(record)
            }
            Err(e) => {
                let err = CoreError::from(e);
                job.finish_err(crate::api::AppError::from(&err));
                Err(err)
            }
        }
    }

    pub async fn setup_undo(self: &Arc<Self>, req: &SetupUndoReq) -> Result<UndoReport, CoreError> {
        let manifest = self
            .setup_store
            .load_manifest(&req.setup_id)?
            .ok_or_else(|| CoreError::NotFound { entity: EntityKind::SetupRecord, id: req.setup_id.clone() })?;
        let key = format!("setup:{}:{}", manifest.pack_id, manifest.scope_id);
        let job = self.jobs.start(JobKind::SetupUndo, &manifest.pack_id, &key, false)?;
        let this = self.clone();
        let setup_id = req.setup_id.clone();
        let outcome = Self::blocking(move || {
            crate::setup::undo_with_runner(&setup_id, &this.setup_store, &*this.fonts, &*this.runner)
        })
        .await?;
        match outcome {
            Ok(report) => {
                let _ = self.state.update(|s| {
                    for x in s.setups.iter_mut().filter(|x| x.setup_id == req.setup_id) {
                        x.status = "undone".into();
                    }
                });
                job.finish_ok(JobResult::Setup { setup_id: req.setup_id.clone() });
                self.emit_programs(ProgramsChangedReason::SetupChanged);
                Ok(report)
            }
            Err(e) => {
                let err = CoreError::from(e);
                job.finish_err(crate::api::AppError::from(&err));
                Err(err)
            }
        }
    }

    pub fn setup_history(&self, req: &SetupHistoryReq) -> Result<Vec<SetupRecord>, CoreError> {
        self.find_pack(&req.pack_id)?;
        Ok(crate::setup::history(&req.pack_id, &req.scope_id, &self.setup_store))
    }
}
