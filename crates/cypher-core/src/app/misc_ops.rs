//! Einstellungen, Katalog, Dateien, Marke, Aufträge, Diagnose, Hintergrundentfernung (ARCHITEKTUR.md 3.2, 2.14–2.16).

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio_util::sync::CancellationToken;

use crate::api::{
    AppCloseRequested, BgRemoveEvent, BgRemoveMethod, BgRemoveModelInfo, BgRemoveModelReq, BgRemoveRunReq,
    BgRemoveStage, BgRemoveStatus, Brand, CatalogRefreshResult, CatalogStatus, DirSetting, EXPORT_IMAGE_MAX_BYTES,
    ExportDestination, ExportImageFormat, ExportImageMeta, FileHandleInfo, FilesDropped, HandleSource, InstallPlan,
    JobCancelReq, JobInfo, JobKind, JobRecord, JobResult, MockupTemplate, NetworkEndpoint, NetworkInfo, NetworkPurpose,
    NetworkWhen, Point, ProgramsChangedReason, SampleInfo, Settings, SettingsPatch, SocialTemplate, UpdateFrequency,
};
use crate::catalog::{CATALOG_URLS, RefreshOutcome};
use crate::download::EMBEDDED_HOSTS;
use crate::error::{CoreError, IoError};
use crate::platform::{display_path, fsx};
use crate::util::now_iso;

use super::setup_ops::SharedSink;
use super::{App, AppEvent};

impl App {
    // --- Einstellungen und Netzwerk -------------------------------------------------------------------

    pub fn settings_get(&self) -> Settings {
        self.settings.get().for_display()
    }

    pub fn settings_update(&self, patch: &SettingsPatch) -> Result<Settings, CoreError> {
        Ok(self.settings.update(patch)?.for_display())
    }

    /// Setzt einen im Dialog gewählten Ordner.
    pub fn settings_set_dir(&self, which: DirSetting, path: &Path) -> Result<Settings, CoreError> {
        Ok(self.settings.set_dir(which, path)?.for_display())
    }

    pub fn network_info(&self) -> NetworkInfo {
        let settings = self.settings.get();
        let catalog_host =
            url::Url::parse(CATALOG_URLS[0]).ok().and_then(|u| u.host_str().map(str::to_owned)).unwrap_or_default();
        let mut endpoints = vec![
            NetworkEndpoint {
                purpose: NetworkPurpose::Catalog,
                host: catalog_host.clone(),
                url_pattern: CATALOG_URLS[0].to_owned(),
                when: if settings.catalog.auto_refresh { NetworkWhen::OnStart } else { NetworkWhen::OnDemand },
                enabled: settings.catalog.auto_refresh,
            },
            NetworkEndpoint {
                purpose: NetworkPurpose::AppUpdate,
                host: catalog_host,
                url_pattern: "https://studio.cypherxcypher.de/releases/latest.json".to_owned(),
                when: if settings.updates.frequency == UpdateFrequency::Never {
                    NetworkWhen::OnDemand
                } else {
                    NetworkWhen::OnStart
                },
                enabled: settings.updates.frequency != UpdateFrequency::Never,
            },
        ];
        for rule in
            EMBEDDED_HOSTS.iter().filter(|r| !matches!(r.host, "studio.cypherxcypher.de" | "raw.githubusercontent.com"))
        {
            endpoints.push(NetworkEndpoint {
                purpose: NetworkPurpose::ProgramDownload,
                host: rule.host.to_owned(),
                url_pattern: format!("https://{}/…", rule.host),
                when: NetworkWhen::AfterConsent,
                enabled: true,
            });
        }
        NetworkInfo { endpoints, recent: self.http.log().recent(), telemetry: false }
    }

    // --- Katalog --------------------------------------------------------------------------------------

    pub fn catalog_status(&self) -> CatalogStatus {
        self.catalog.status()
    }

    pub async fn catalog_refresh(self: &Arc<Self>) -> Result<CatalogRefreshResult, CoreError> {
        let cancel = CancellationToken::new();
        let outcome = self.catalog.refresh(&self.http, &cancel).await;
        // Auch bei Fehlern gilt: gesehene Sequenz festhalten (Rollback-Schutz)
        let highest = self.catalog.highest_seen();
        let _ = self.state.update(|s| s.catalog_highest_sequence = s.catalog_highest_sequence.max(highest));
        match outcome {
            Ok(RefreshOutcome::Updated { .. }) => {
                let status = self.catalog.status();
                self.emit(AppEvent::CatalogUpdated(status.clone()));
                self.emit_programs(ProgramsChangedReason::CatalogChanged);
                Ok(CatalogRefreshResult { status, changed: true })
            }
            Ok(RefreshOutcome::Unchanged) => Ok(CatalogRefreshResult { status: self.catalog.status(), changed: false }),
            Err(e) => Err(e.into()),
        }
    }

    /// Katalog beim Start aktualisieren, wenn eingestellt (Fehler werden nur protokolliert).
    pub async fn refresh_catalog_if_enabled(self: &Arc<Self>) {
        if self.settings.get().catalog.auto_refresh
            && let Err(e) = self.catalog_refresh().await
        {
            tracing::info!("Katalog-Aktualisierung beim Start: {e}");
        }
    }

    // --- Dateien --------------------------------------------------------------------------------------

    /// Meldet Dateien aus dem Öffnen-Dialog an.
    pub fn register_picked(&self, paths: &[PathBuf]) -> Result<Vec<FileHandleInfo>, CoreError> {
        paths.iter().map(|p| self.handles.register(p, HandleSource::Dialog).map_err(CoreError::from)).collect()
    }

    /// Dateien, die auf das Fenster gezogen wurden: Handles anlegen und `files:dropped` melden.
    pub fn register_dropped(&self, paths: &[PathBuf], position: Point) {
        let handles: Vec<FileHandleInfo> =
            paths.iter().filter_map(|p| self.handles.register(p, HandleSource::Drop).ok()).collect();
        if !handles.is_empty() {
            self.emit(AppEvent::FilesDropped(FilesDropped { handles, position }));
        }
    }

    pub fn samples_list(&self) -> Vec<SampleInfo> {
        let dir = self.packs_root.join("samples");
        let Ok(read) = std::fs::read_dir(&dir) else { return Vec::new() };
        let mut files: Vec<PathBuf> = read.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.is_file()).collect();
        files.sort();
        files
            .into_iter()
            .filter_map(|p| {
                let handle = self.handles.register(&p, HandleSource::Sample).ok()?;
                let stem = p.file_stem()?.to_string_lossy().into_owned();
                let mut title = stem.replace(['-', '_'], " ");
                if let Some(first) = title.get(..1) {
                    title = first.to_uppercase() + &title[1..];
                }
                Some(SampleInfo {
                    id: stem,
                    title,
                    description: "Beispieldatei zum Ausprobieren der Druckprüfung.".to_owned(),
                    handle,
                })
            })
            .collect()
    }

    /// Wohin `export_save_image` schreibt; `None` heißt: der Speichern-Dialog muss fragen.
    pub fn export_image_needs_dialog(meta: &ExportImageMeta) -> bool {
        matches!(meta.destination, ExportDestination::Dialog)
    }

    /// Speichert ein vom Frontend gerendertes Bild. Prüft Größe und Magic Bytes, setzt bei PNG die Auflösung.
    pub fn export_save_image(
        &self,
        meta: &ExportImageMeta,
        bytes: &[u8],
        dialog_path: Option<&Path>,
    ) -> Result<FileHandleInfo, CoreError> {
        if bytes.is_empty() || bytes.len() as u64 > EXPORT_IMAGE_MAX_BYTES {
            return Err(CoreError::invalid_input("body", "Das Bild ist leer oder größer als 64 MB"));
        }
        let is_png = bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        let is_jpeg = bytes.starts_with(&[0xFF, 0xD8, 0xFF]);
        let ext = match (meta.format, is_png, is_jpeg) {
            (ExportImageFormat::Png, true, _) => "png",
            (ExportImageFormat::Jpeg, _, true) => "jpg",
            (ExportImageFormat::Png | ExportImageFormat::Jpeg, false, false) => {
                return Err(CoreError::Print(crate::error::PrintError::UnsupportedFormat {
                    format: "unbekannt".into(),
                }));
            }
            _ => return Err(CoreError::invalid_input("format", "Der Inhalt passt nicht zum angegebenen Format")),
        };
        let data: std::borrow::Cow<'_, [u8]> = match (is_png, meta.dpi) {
            (true, Some(dpi)) if dpi > 0 => std::borrow::Cow::Owned(png_with_dpi(bytes, dpi)?),
            _ => std::borrow::Cow::Borrowed(bytes),
        };
        let stem = fsx::sanitize_file_name(
            Path::new(&meta.file_name)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default()
                .as_str(),
        );
        let file_name = format!("{stem}.{ext}");
        let target = match &meta.destination {
            ExportDestination::Dialog => {
                let p = dialog_path.ok_or_else(|| {
                    CoreError::invalid_input("destination", "Für den Speichern-Dialog fehlt der gewählte Pfad")
                })?;
                p.to_path_buf()
            }
            ExportDestination::Project { project_id, folder } => {
                let (_, dir) = self.find_project_dir(project_id)?;
                unique_in(&fsx::safe_join(&dir, folder.dir_name())?, &file_name)?
            }
            ExportDestination::Library { subfolder } => {
                let root = self
                    .settings
                    .get()
                    .library_root
                    .ok_or(CoreError::Library(crate::error::LibraryError::NotConfigured))?;
                let rel = subfolder.trim_matches('/');
                if rel.split('/').next() == Some(crate::library::model::META_DIR) {
                    return Err(CoreError::invalid_input(
                        "destination",
                        "In den Ordner .cypher kann nicht gespeichert werden",
                    ));
                }
                let dir = if rel.is_empty() { PathBuf::from(&root) } else { fsx::safe_join(Path::new(&root), rel)? };
                unique_in(&dir, &file_name)?
            }
        };
        fsx::write_atomic(&target, &data)?;
        let handle = self.handles.register(&target, HandleSource::Export)?;
        match &meta.destination {
            ExportDestination::Project { project_id, .. } => self.emit_projects(Some(project_id.clone())),
            ExportDestination::Library { .. } => self.emit_library(crate::api::LibraryChangedReason::Import, 1),
            ExportDestination::Dialog => {}
        }
        Ok(handle)
    }

    // --- Marke -----------------------------------------------------------------------------------------

    pub fn brand_get(&self) -> Result<Brand, CoreError> {
        Ok(self.brand_bundle()?.brand.clone())
    }

    pub fn mockup_templates_list(&self) -> Result<Vec<MockupTemplate>, CoreError> {
        Ok(self.brand_bundle()?.mockups.clone())
    }

    pub fn social_templates_list(&self) -> Result<Vec<SocialTemplate>, CoreError> {
        Ok(self.brand_bundle()?.socials.clone())
    }

    // --- Aufträge ---------------------------------------------------------------------------------------

    pub fn jobs_active(&self) -> Vec<JobInfo> {
        self.jobs.active()
    }

    pub fn jobs_recent(&self) -> Vec<JobRecord> {
        self.jobs.recent()
    }

    pub fn job_cancel(&self, req: &JobCancelReq) -> bool {
        self.jobs.cancel(&req.job_id)
    }

    /// Fenster soll schließen: laufende Aufträge (leer = sofort beenden erlaubt).
    pub fn close_requested(&self) -> AppCloseRequested {
        AppCloseRequested { active_jobs: self.jobs.active() }
    }

    /// „Trotzdem beenden“: alle abbrechbaren Aufträge abbrechen.
    pub fn prepare_close(&self) -> usize {
        self.set_closing();
        self.jobs.cancel_all()
    }

    // --- Diagnose ---------------------------------------------------------------------------------------

    /// Schreibt eine ZIP-Datei mit Protokollen und Einstellungen, damit die Nutzerin sie selbst weitergeben kann. Enthält keine
    /// Dateiinhalte; der Heimatordner ist durch `~` ersetzt.
    pub fn diagnostics_export(&self, dest: &Path) -> Result<FileHandleInfo, CoreError> {
        let home = self.dirs.home.to_string_lossy().into_owned();
        let scrub = |text: String| if home.is_empty() { text } else { text.replace(&home, "~") };
        let tmp = tempfile::Builder::new()
            .prefix(".cypher-diag-")
            .tempfile_in(dest.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| Path::new(".")))
            .map_err(|e| IoError::write(dest, e))?;
        {
            let mut zip = zip::ZipWriter::new(tmp.as_file());
            let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            let mut add = |name: &str, text: String| -> Result<(), CoreError> {
                zip.start_file(name, opts).map_err(|e| CoreError::internal(e.to_string()))?;
                zip.write_all(scrub(text).as_bytes()).map_err(|e| IoError::write(dest, e))?;
                Ok(())
            };
            add("app-info.json", serde_json::to_string_pretty(&self.app_info()).unwrap_or_default())?;
            add("settings.json", serde_json::to_string_pretty(&self.settings_get()).unwrap_or_default())?;
            add("state.json", serde_json::to_string_pretty(&self.state.snapshot()).unwrap_or_default())?;
            add("catalog-status.json", serde_json::to_string_pretty(&self.catalog.status()).unwrap_or_default())?;
            add("network.json", serde_json::to_string_pretty(&self.network_info()).unwrap_or_default())?;
            add("jobs.json", serde_json::to_string_pretty(&self.jobs.recent()).unwrap_or_default())?;
            let packs = self.current_packs();
            add(
                "packs.txt",
                packs
                    .packs
                    .iter()
                    .map(|p| format!("{} {}", p.id, p.version))
                    .chain(packs.problems.iter().map(|(n, e)| format!("PROBLEM {n}: {e}")))
                    .collect::<Vec<_>>()
                    .join("\n"),
            )?;
            // Die jüngsten Protokolldateien (je höchstens 2 MB vom Ende)
            let mut logs: Vec<PathBuf> = std::fs::read_dir(&self.dirs.logs)
                .map(|rd| rd.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.is_file()).collect())
                .unwrap_or_default();
            logs.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
            for path in logs.iter().rev().take(3) {
                if let Ok(bytes) = std::fs::read(path) {
                    let start = bytes.len().saturating_sub(2 * 1024 * 1024);
                    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    add(&format!("logs/{name}"), String::from_utf8_lossy(&bytes[start..]).into_owned())?;
                }
            }
            zip.finish().map_err(|e| CoreError::internal(e.to_string()))?;
        }
        tmp.as_file().sync_all().map_err(|e| IoError::write(dest, e))?;
        fsx::set_shareable_mode(tmp.as_file());
        tmp.persist(dest).map_err(|e| IoError::write(dest, e.error))?;
        Ok(self.handles.register(dest, HandleSource::Export)?)
    }

    // --- Hintergrund entfernen ---------------------------------------------------------------------------

    pub fn bgremove_status(&self) -> BgRemoveStatus {
        BgRemoveStatus {
            color_key_available: true,
            model_feature: false,
            runtime_installed: false,
            models: Vec::<BgRemoveModelInfo>::new(),
        }
    }

    pub fn bgremove_model_preview(&self, req: &BgRemoveModelReq) -> Result<InstallPlan, CoreError> {
        Err(CoreError::NotFound { entity: crate::api::EntityKind::Artifact, id: req.model_id.clone() })
    }

    pub async fn bgremove_run(
        self: &Arc<Self>,
        req: &BgRemoveRunReq,
        sink: SharedSink<BgRemoveEvent>,
    ) -> Result<FileHandleInfo, CoreError> {
        let BgRemoveMethod::ColorKey { tolerance, sample } = &req.method else {
            return Err(CoreError::NotFound { entity: crate::api::EntityKind::Artifact, id: "model".into() });
        };
        let (tolerance, sample) = (*tolerance, *sample);
        let src = self
            .handles
            .resolve(&req.handle_id)
            .ok_or(CoreError::NotFound { entity: crate::api::EntityKind::FileHandle, id: req.handle_id.clone() })?;
        let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let job = self.jobs.start(JobKind::BgremoveRun, &name, &format!("bgremove:{}", req.handle_id), true)?;
        sink.emit(BgRemoveEvent::Started { job_id: job.id.clone() });
        let dir = self.dirs.cache.join("bgremove");
        let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "bild".into());
        let target = dir.join(format!(
            "{}-freigestellt-{}.png",
            fsx::sanitize_file_name(&stem),
            crate::util::short_hash(&format!("{}|{tolerance}|{sample:?}", req.handle_id))
        ));
        let (cancel, stage_sink, out) = (job.token.clone(), sink.clone(), target.clone());
        let result = Self::blocking(move || -> Result<(), CoreError> {
            stage_sink.emit(BgRemoveEvent::Stage { stage: BgRemoveStage::Load });
            let prepared =
                crate::printcheck::Prepared::load(&src, &name, &crate::printcheck::Limits::default(), &cancel)?;
            let image = prepared
                .image
                .as_ref()
                .ok_or_else(|| CoreError::invalid_input("handleId", "Dieses Bild lässt sich nicht freistellen"))?;
            stage_sink.emit(BgRemoveEvent::Stage { stage: BgRemoveStage::Compose });
            let keyed = crate::bgremove::color_key(image, tolerance, sample, &cancel)?;
            stage_sink.emit(BgRemoveEvent::Stage { stage: BgRemoveStage::Encode });
            let bytes = crate::bgremove::encode_png(&keyed)?;
            fsx::write_atomic(&out, &bytes)?;
            Ok(())
        })
        .await?;
        match result {
            Ok(()) => {
                sink.emit(BgRemoveEvent::Finished);
                let handle = self.handles.register(&target, HandleSource::Export)?;
                job.finish_ok(JobResult::File { handle: handle.clone() });
                Ok(handle)
            }
            Err(err) => {
                job.finish_err(crate::api::AppError::from(&err));
                Err(err)
            }
        }
    }

    /// Jetzt als Zeitstempel (für Aufrufer).
    pub fn now(&self) -> String {
        now_iso()
    }

    pub fn display(&self, p: &Path) -> String {
        display_path(p)
    }
}

/// Freier Name im Ordner (`name.png`, `name (2).png`, …); legt den Ordner an.
fn unique_in(dir: &Path, file_name: &str) -> Result<PathBuf, CoreError> {
    std::fs::create_dir_all(dir).map_err(|e| IoError::new(crate::api::IoOp::CreateDir, dir, e))?;
    let first = dir.join(file_name);
    if !first.exists() {
        return Ok(first);
    }
    let (stem, ext) = match file_name.rfind('.') {
        Some(i) if i > 0 => (&file_name[..i], &file_name[i..]),
        _ => (file_name, ""),
    };
    (2..1000)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .ok_or_else(|| CoreError::invalid_input("fileName", "Kein freier Dateiname"))
}

/// Fügt `pHYs` (Pixel je Meter aus dpi) in ein PNG ein, ersetzt ein vorhandenes. Der Bildinhalt bleibt byte-gleich.
pub fn png_with_dpi(png: &[u8], dpi: u32) -> Result<Vec<u8>, CoreError> {
    let bad = || CoreError::invalid_input("body", "PNG-Aufbau ungültig");
    if png.len() < 33 || !png.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Err(bad());
    }
    let ppm = (f64::from(dpi) / 0.0254).round() as u32;
    let mut phys = Vec::with_capacity(21);
    phys.extend(9u32.to_be_bytes());
    let mut body = b"pHYs".to_vec();
    body.extend(ppm.to_be_bytes());
    body.extend(ppm.to_be_bytes());
    body.push(1);
    let mut crc = flate2::Crc::new();
    crc.update(&body);
    phys.extend(&body);
    phys.extend(crc.sum().to_be_bytes());

    let mut out = Vec::with_capacity(png.len() + phys.len());
    out.extend(&png[..8]);
    let mut pos = 8;
    let mut inserted = false;
    while pos + 8 <= png.len() {
        let len = u32::from_be_bytes([png[pos], png[pos + 1], png[pos + 2], png[pos + 3]]) as usize;
        let kind = &png[pos + 4..pos + 8];
        let end = pos.checked_add(12 + len).filter(|e| *e <= png.len()).ok_or_else(bad)?;
        if kind == b"pHYs" {
            pos = end;
            continue;
        }
        out.extend(&png[pos..end]);
        if kind == b"IHDR" && !inserted {
            out.extend(&phys);
            inserted = true;
        }
        pos = end;
    }
    if !inserted {
        return Err(bad());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_png() -> Vec<u8> {
        let mut out = Vec::new();
        image::RgbaImage::from_pixel(3, 2, image::Rgba([9, 9, 9, 255]))
            .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }

    #[test]
    fn phys_is_inserted_after_ihdr_and_replaces_an_old_one() {
        let png = tiny_png();
        let with = png_with_dpi(&png, 300).unwrap();
        let again = png_with_dpi(&with, 72).unwrap();
        for (bytes, ppm) in [(&with, 11811u32), (&again, 2835u32)] {
            let reader = png::Decoder::new(std::io::Cursor::new(bytes)).read_info().unwrap();
            let dims = reader.info().pixel_dims.unwrap();
            assert_eq!((dims.xppu, dims.yppu, dims.unit), (ppm, ppm, png::Unit::Meter));
        }
        assert_eq!(again.windows(4).filter(|w| w == b"pHYs").count(), 1);
        // Pixel bleiben gleich
        let a = image::load_from_memory(&png).unwrap().to_rgba8();
        let b = image::load_from_memory(&with).unwrap().to_rgba8();
        assert_eq!(a, b);
        assert!(png_with_dpi(b"kein png", 300).is_err());
        assert!(png_with_dpi(&png[..20], 300).is_err());
    }

    #[test]
    fn unique_names() {
        let tmp = tempfile::tempdir().unwrap();
        let a = unique_in(tmp.path(), "x.png").unwrap();
        std::fs::write(&a, b"1").unwrap();
        let b = unique_in(tmp.path(), "x.png").unwrap();
        assert_eq!(b.file_name().unwrap(), "x (2).png");
    }
}
