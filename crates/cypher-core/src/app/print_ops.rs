//! Druckprüfer: Profile, Analyse, Export, Überlagerung (ARCHITEKTUR.md 2.13, 5.3).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio_util::sync::CancellationToken;

use crate::api::{
    EntityKind, FileHandleInfo, GarmentColor, HandleSource, JobKind, JobResult, PrintAnalyzeReq, PrintDestination,
    PrintExportEvent, PrintExportReq, PrintExportResult, PrintOverlayReq, PrintProfile, PrintReport, PrintStage,
};
use crate::error::{CoreError, PrintError};
use crate::printcheck::{
    AnalyzeParams, ExportRequest, Limits, Prepared, export_file, overlay_png, suggested_file_name,
};
use crate::util::short_hash;

use super::App;
use super::setup_ops::SharedSink;

fn not_found(entity: EntityKind, id: &str) -> CoreError {
    CoreError::NotFound { entity, id: id.to_owned() }
}

/// Freier Dateiname im Ordner: `name.png`, `name (2).png`, …
fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let first = dir.join(file_name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match file_name.rfind('.') {
        Some(i) if i > 0 => (&file_name[..i], &file_name[i..]),
        _ => (file_name, ""),
    };
    (2..).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

impl App {
    pub fn print_profiles_list(&self) -> Vec<PrintProfile> {
        self.catalog.current().catalog.print_profiles.clone()
    }

    fn profile_by_id(&self, id: &str) -> Result<PrintProfile, CoreError> {
        self.catalog.current().catalog.print_profile(id).cloned().ok_or_else(|| not_found(EntityKind::PrintProfile, id))
    }

    fn garment_by_id(&self, id: Option<&str>) -> Result<Option<GarmentColor>, CoreError> {
        let Some(id) = id else { return Ok(None) };
        let bundle = self.brand_bundle()?;
        bundle
            .brand
            .garment_colors
            .iter()
            .find(|g| g.id == id)
            .cloned()
            .map(Some)
            .ok_or_else(|| not_found(EntityKind::GarmentColor, id))
    }

    /// Geladenes Bild zu einem Handle (die letzten beiden bleiben im Speicher, damit die Breite verschoben werden kann,
    /// ohne neu zu dekodieren).
    async fn prepared_for(self: &Arc<Self>, handle_id: &str) -> Result<Arc<Prepared>, CoreError> {
        let path = self.handles.resolve(handle_id).ok_or_else(|| not_found(EntityKind::FileHandle, handle_id))?;
        let stamp = std::fs::metadata(&path)
            .map(|m| format!("{handle_id}|{}|{:?}", m.len(), m.modified().ok()))
            .map_err(|e| crate::error::IoError::read(&path, e))?;
        if let Ok(cache) = self.printcheck_cache.lock()
            && let Some((_, p)) = cache.iter().find(|(k, _)| k == &stamp)
        {
            return Ok(p.clone());
        }
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let loaded =
            Self::blocking(move || Prepared::load(&path, &name, &Limits::default(), &CancellationToken::new()))
                .await??;
        let prepared = Arc::new(loaded);
        if let Ok(mut cache) = self.printcheck_cache.lock() {
            cache.retain(|(k, _)| k != &stamp);
            cache.push((stamp, prepared.clone()));
            while cache.len() > 2 {
                cache.remove(0);
            }
        }
        Ok(prepared)
    }

    pub async fn printcheck_analyze(self: &Arc<Self>, req: &PrintAnalyzeReq) -> Result<PrintReport, CoreError> {
        let profile = self.profile_by_id(&req.profile_id)?;
        let garment = self.garment_by_id(req.garment_color_id.as_deref())?;
        let technique = req
            .technique
            .unwrap_or_else(|| profile.techniques.first().copied().unwrap_or(crate::api::PrintTechnique::Dtg));
        if !profile.techniques.contains(&technique) {
            return Err(CoreError::invalid_input("technique", "Dieses Verfahren gibt es für die Fläche nicht"));
        }
        let planned = req.planned_width_mm;
        let prepared = self.prepared_for(&req.handle_id).await?;
        Self::blocking(move || {
            prepared
                .analyze(&AnalyzeParams {
                    profile: &profile,
                    garment: garment.as_ref(),
                    technique,
                    planned_width_mm: planned,
                    check_edges: true,
                })
                .report
        })
        .await
    }

    /// Vorgeschlagener Dateiname des Exports (für den Speichern-Dialog).
    pub fn printcheck_suggested_name(&self, req: &PrintExportReq) -> Result<String, CoreError> {
        let profile = self.profile_by_id(&req.profile_id)?;
        let source =
            self.handles.resolve(&req.handle_id).ok_or_else(|| not_found(EntityKind::FileHandle, &req.handle_id))?;
        let stem = source.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "motiv".into());
        Ok(suggested_file_name(&stem, &profile, &req.options))
    }

    /// Zieldatei des Exports. `dialog_path` stammt aus dem Speichern-Dialog (nur bei `Dialog`).
    fn export_target(
        &self,
        req: &PrintExportReq,
        profile: &PrintProfile,
        source: &Path,
        dialog_path: Option<&Path>,
    ) -> Result<PathBuf, CoreError> {
        let stem = source.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "motiv".into());
        let name = suggested_file_name(&stem, profile, &req.options);
        let dir = match &req.options.destination {
            PrintDestination::Dialog => {
                let p = dialog_path.ok_or_else(|| {
                    CoreError::invalid_input("destination", "Für den Speichern-Dialog fehlt der gewählte Pfad")
                })?;
                let mut p = p.to_path_buf();
                if p.extension().is_none_or(|e| !e.eq_ignore_ascii_case("png")) {
                    p.set_extension("png");
                }
                return Ok(p);
            }
            PrintDestination::BesideSource => source
                .parent()
                .map(Path::to_path_buf)
                .ok_or_else(|| CoreError::invalid_input("handleId", "Quelle ohne Ordner"))?,
            PrintDestination::Library => {
                let root = self
                    .settings
                    .get()
                    .library_root
                    .ok_or(CoreError::Library(crate::error::LibraryError::NotConfigured))?;
                PathBuf::from(root).join("Motive")
            }
            PrintDestination::Project { project_id } => {
                let (_, dir) = self.find_project_dir(project_id)?;
                dir.join("Export").join("Druck")
            }
        };
        std::fs::create_dir_all(&dir).map_err(|e| crate::error::IoError::new(crate::api::IoOp::CreateDir, &dir, e))?;
        Ok(unique_path(&dir, &crate::platform::fsx::sanitize_file_name(&name)))
    }

    pub(crate) fn find_project_dir(&self, id: &str) -> Result<(crate::api::Project, PathBuf), CoreError> {
        let (root, in_library) = self.projects_root();
        let index = self.state.read(|s| s.project_index.clone());
        crate::projects::list(&root, in_library, &index)
            .into_iter()
            .find(|(p, _)| p.id == id)
            .ok_or_else(|| not_found(EntityKind::Project, id))
    }

    pub async fn printcheck_export(
        self: &Arc<Self>,
        req: &PrintExportReq,
        dialog_path: Option<&Path>,
        sink: SharedSink<PrintExportEvent>,
    ) -> Result<PrintExportResult, CoreError> {
        let profile = self.profile_by_id(&req.profile_id)?;
        let garment = self.garment_by_id(req.garment_color_id.as_deref())?;
        let technique = req
            .technique
            .unwrap_or_else(|| profile.techniques.first().copied().unwrap_or(crate::api::PrintTechnique::Dtg));
        let source =
            self.handles.resolve(&req.handle_id).ok_or_else(|| not_found(EntityKind::FileHandle, &req.handle_id))?;
        let output = self.export_target(req, &profile, &source, dialog_path)?;
        let source_name = source.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let job = self.jobs.start(JobKind::PrintExport, &source_name, &format!("print:{}", req.handle_id), true)?;
        sink.emit(PrintExportEvent::Started { job_id: job.id.clone() });
        let cancel = job.token.clone();
        let options = req.options.clone();
        let stage_sink = sink.clone();
        let (out_path, src_path, prof) = (output.clone(), source.clone(), profile.clone());
        let outcome = Self::blocking(move || {
            let adapter = move |stage: PrintStage| stage_sink.emit(PrintExportEvent::Stage { stage });
            export_file(
                &ExportRequest {
                    source: &src_path,
                    source_name: &source_name,
                    output: &out_path,
                    profile: &prof,
                    garment: garment.as_ref(),
                    technique,
                    options: &options,
                    limits: Limits::default(),
                },
                &adapter,
                &cancel,
            )
        })
        .await?;
        match outcome {
            Ok(done) => {
                sink.emit(PrintExportEvent::Finished);
                let handle = self.handles.register(&done.output, HandleSource::Export)?;
                let placement = match &done.placement_json {
                    Some(p) => Some(self.handles.register(p, HandleSource::Export)?),
                    None => None,
                };
                job.finish_ok(JobResult::File { handle: handle.clone() });
                match &req.options.destination {
                    PrintDestination::Project { project_id } => self.emit_projects(Some(project_id.clone())),
                    PrintDestination::Library => {
                        let app = self.clone();
                        tokio::spawn(async move { app.library_rescan_quiet().await });
                        self.emit_library(crate::api::LibraryChangedReason::Import, 1);
                    }
                    _ => {}
                }
                Ok(PrintExportResult {
                    output: handle,
                    placement_json: placement,
                    width_px: done.width_px,
                    height_px: done.height_px,
                    dpi: done.dpi,
                    color_profile: done.color_profile,
                    report: done.report,
                })
            }
            Err(e) => {
                let err = CoreError::from(e);
                job.finish_err(crate::api::AppError::from(&err));
                Err(err)
            }
        }
    }

    pub async fn printcheck_overlay(self: &Arc<Self>, req: &PrintOverlayReq) -> Result<FileHandleInfo, CoreError> {
        let profile = self.profile_by_id(&req.profile_id)?;
        let prepared = self.prepared_for(&req.handle_id).await?;
        let dir = self.dirs.cache.join("overlays");
        let key = short_hash(&format!("{}|{:?}|{}", req.handle_id, req.overlay, req.profile_id));
        let target = dir.join(format!("{key}.png"));
        let (kind, out) = (req.overlay, target.clone());
        Self::blocking(move || -> Result<(), PrintError> {
            let bytes = overlay_png(&prepared, kind, &profile)?;
            crate::platform::fsx::write_atomic(&out, &bytes)?;
            Ok(())
        })
        .await??;
        Ok(self.handles.register(&target, HandleSource::Export)?)
    }
}
