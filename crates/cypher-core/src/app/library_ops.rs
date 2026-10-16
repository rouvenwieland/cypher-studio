//! Bibliothek: Einrichten, Scan, Abfragen, Metadaten, Import, Austauschpakete (ARCHITEKTUR.md 2.12, 5.9).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::api::{
    EntityKind, FileHandleInfo, HandleSource, JobKind, JobResult, LibraryBulkMetaReq, LibraryChangedReason,
    LibraryEntry, LibraryGetReq, LibraryImportReq, LibraryMetaPatchReq, LibraryPage, LibraryQuery,
    LibraryRootCandidate, LibrarySetCollectionsReq, LibraryStatus, LibraryUseRootReq, PackEvent, PackExportReq,
    PackImportReport, PackImportReq, PackInspectReq, PackPreview, ScanEvent,
};
use crate::error::{CoreError, LibraryError};
use crate::library::exchange::{self, PackProgress};
use crate::library::{Library, ScanProgress, ThumbConfig};
use crate::util::new_id;

use super::setup_ops::SharedSink;
use super::{App, LibraryHolder};

/// So lange bleibt ein gewählter Ordner (Kandidat) gültig.
const CANDIDATE_TTL: Duration = Duration::from_secs(10 * 60);

fn not_configured() -> CoreError {
    CoreError::Library(LibraryError::NotConfigured)
}

impl App {
    fn brand_font_files(&self) -> Vec<PathBuf> {
        let dir = self.packs_root.join("shared").join("fonts");
        walkdir::WalkDir::new(dir)
            .max_depth(4)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .map(|e| e.into_path())
            .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("ttf") || x.eq_ignore_ascii_case("otf")))
            .filter(|p| !p.to_string_lossy().contains("Variable"))
            .take(64)
            .collect()
    }

    fn open_library_at(self: &Arc<Self>, root: &Path) -> Result<LibraryHolder, CoreError> {
        let cache = self.dirs.cache.join("library-index");
        let mut library = Library::open(root, &cache, &self.dirs.thumbs())?;
        library.set_thumb_config(ThumbConfig { fonts: self.brand_font_files() });
        let weak = Arc::downgrade(self);
        let runtime = tokio::runtime::Handle::try_current().ok();
        let watch = library
            .watch(move |count| {
                let (Some(app), Some(rt)) = (weak.upgrade(), runtime.clone()) else { return };
                rt.spawn(async move {
                    app.library_rescan_quiet().await;
                    app.emit_library(LibraryChangedReason::Watcher, count as u32);
                });
            })
            .ok();
        library.set_watching(watch.is_some());
        Ok(LibraryHolder { library, _watch: watch })
    }

    /// Öffnet die in den Einstellungen gespeicherte Bibliothek (App-Start). Fehler sind nicht schlimm: die App läuft ohne.
    pub(crate) async fn open_library_from_settings(self: &Arc<Self>) {
        let Some(root) = self.settings.get().library_root.map(PathBuf::from) else { return };
        match self.open_library_at(&root) {
            Ok(holder) => {
                *self.library.write().await = Some(holder);
                self.library_rescan_quiet().await;
            }
            Err(e) => tracing::warn!("Bibliothek {} nicht geöffnet: {e}", root.display()),
        }
    }

    /// Liest die Bibliothek ohne Auftrag und ohne Ereignisse ein (Überwachung, Start).
    pub(crate) async fn library_rescan_quiet(self: &Arc<Self>) {
        let snapshot = {
            let guard = self.library.read().await;
            guard.as_ref().map(|h| (h.library.root().to_path_buf(), h.library.snapshot()))
        };
        let Some((root, snapshot)) = snapshot else { return };
        let quiet = crate::progress::NoProgress;
        let cancel = tokio_util::sync::CancellationToken::new();
        let result = Self::blocking(move || crate::library::scan::scan_tree(&root, &snapshot, &quiet, &cancel)).await;
        if let Ok(Ok(r)) = result
            && let Some(h) = self.library.write().await.as_mut()
        {
            h.library.apply_scan(r);
        }
    }

    pub async fn library_status(&self) -> LibraryStatus {
        match self.library.read().await.as_ref() {
            Some(h) => h.library.status(),
            None => Library::unconfigured_status(),
        }
    }

    /// Fasst einen vom Nutzer gewählten Ordner zusammen, noch ohne Umstellung.
    pub async fn library_choose_root(self: &Arc<Self>, picked: &Path) -> Result<LibraryRootCandidate, CoreError> {
        let this = self.clone();
        let picked = picked.to_path_buf();
        let (candidate, path) = Self::blocking(move || -> Result<_, CoreError> {
            let known = crate::platform::KnownDirs::from_env();
            let c = crate::library::inspect_root(&picked, &this.dirs, this.platform.os, &known)?;
            Ok((c, picked))
        })
        .await??;
        if let Ok(mut list) = self.root_candidates.lock() {
            list.retain(|(_, _, at)| at.elapsed() < CANDIDATE_TTL);
            list.push((candidate.candidate_id.clone(), path, Instant::now()));
        }
        Ok(candidate)
    }

    pub async fn library_use_root(self: &Arc<Self>, req: &LibraryUseRootReq) -> Result<LibraryStatus, CoreError> {
        let path = {
            let mut list = self.root_candidates.lock().map_err(|_| CoreError::internal("Kandidatenliste gesperrt"))?;
            list.retain(|(_, _, at)| at.elapsed() < CANDIDATE_TTL);
            list.iter().find(|(id, _, _)| id == &req.candidate_id).map(|(_, p, _)| p.clone())
        }
        .ok_or_else(|| CoreError::NotFound { entity: EntityKind::Plan, id: req.candidate_id.clone() })?;
        let this = self.clone();
        let initialize = req.initialize;
        let holder = Self::blocking(move || -> Result<LibraryHolder, CoreError> {
            let known = crate::platform::KnownDirs::from_env();
            crate::library::validate_root(&path, &this.dirs, this.platform.os, &known)?;
            if initialize {
                let name = crate::library::root::library_name_of(&path);
                crate::library::init(&path, &name, &[])?;
            }
            this.settings.set_library_root(Some(&path))?;
            this.state.update(|s| s.library_root = Some(path.to_string_lossy().into_owned()))?;
            this.open_library_at(&path)
        })
        .await??;
        let status = holder.library.status();
        *self.library.write().await = Some(holder);
        self.emit_library(LibraryChangedReason::RootChanged, 0);
        self.emit_projects(None);
        let app = self.clone();
        tokio::spawn(async move {
            app.library_rescan_quiet().await;
            app.emit_library(LibraryChangedReason::Scan, 0);
        });
        Ok(status)
    }

    pub async fn library_scan(self: &Arc<Self>, sink: SharedSink<ScanEvent>) -> Result<LibraryStatus, CoreError> {
        let (root, snapshot) = {
            let guard = self.library.read().await;
            let holder = guard.as_ref().ok_or_else(not_configured)?;
            (holder.library.root().to_path_buf(), holder.library.snapshot())
        };
        let job = self.jobs.start(JobKind::LibraryScan, &crate::platform::display_path(&root), "library:scan", true)?;
        sink.emit(ScanEvent::Started { job_id: job.id.clone() });
        let cancel = job.token.clone();
        let progress = sink.clone();
        let result = Self::blocking(move || {
            let adapter =
                move |p: ScanProgress| progress.emit(ScanEvent::Progress { scanned: p.scanned, found: p.found });
            crate::library::scan::scan_tree(&root, &snapshot, &adapter, &cancel)
        })
        .await?;
        match result {
            Ok(scan) => {
                let status = {
                    let mut guard = self.library.write().await;
                    let holder = guard.as_mut().ok_or_else(not_configured)?;
                    holder.library.apply_scan(scan)
                };
                sink.emit(ScanEvent::Finished { status: status.clone() });
                job.finish_ok(JobResult::None);
                self.emit_library(LibraryChangedReason::Scan, status.entry_count);
                Ok(status)
            }
            Err(e) => {
                let err = CoreError::from(e);
                job.finish_err(crate::api::AppError::from(&err));
                Err(err)
            }
        }
    }

    pub async fn library_query(&self, q: &LibraryQuery) -> Result<LibraryPage, CoreError> {
        let guard = self.library.read().await;
        Ok(guard.as_ref().ok_or_else(not_configured)?.library.query(q))
    }

    pub async fn library_get(&self, req: &LibraryGetReq) -> Result<LibraryEntry, CoreError> {
        let guard = self.library.read().await;
        Ok(guard.as_ref().ok_or_else(not_configured)?.library.get_dto(&req.entry_id)?)
    }

    pub async fn library_update_meta(&self, req: &LibraryMetaPatchReq) -> Result<LibraryEntry, CoreError> {
        let mut guard = self.library.write().await;
        let entry = guard.as_mut().ok_or_else(not_configured)?.library.update_meta(&req.entry_id, &req.patch)?;
        drop(guard);
        self.emit_library(LibraryChangedReason::Meta, 1);
        Ok(entry)
    }

    pub async fn library_bulk_meta(&self, req: &LibraryBulkMetaReq) -> Result<u32, CoreError> {
        let mut guard = self.library.write().await;
        let n = guard.as_mut().ok_or_else(not_configured)?.library.bulk_meta(
            &req.entry_ids,
            req.add_tags.as_deref().unwrap_or(&[]),
            req.remove_tags.as_deref().unwrap_or(&[]),
            &req.collection,
        )?;
        drop(guard);
        if n > 0 {
            self.emit_library(LibraryChangedReason::Meta, n as u32);
        }
        Ok(n as u32)
    }

    pub async fn library_import(&self, req: &LibraryImportReq) -> Result<Vec<LibraryEntry>, CoreError> {
        let mut files = Vec::new();
        for id in &req.handle_ids {
            files.push(
                self.handles
                    .resolve(id)
                    .ok_or(CoreError::NotFound { entity: EntityKind::FileHandle, id: id.clone() })?,
            );
        }
        let author = self.settings.get().profile.display_name;
        let meta = req.meta.clone().unwrap_or(crate::api::ImportMeta {
            tags: None,
            author: None,
            collection: None,
            status: None,
        });
        let mut guard = self.library.write().await;
        let holder = guard.as_mut().ok_or_else(not_configured)?;
        let library = &mut holder.library;
        let entries = tokio::task::block_in_place(|| library.import(&files, req.subfolder.as_deref(), &meta, &author))?;
        drop(guard);
        self.emit_library(LibraryChangedReason::Import, entries.len() as u32);
        Ok(entries)
    }

    pub async fn library_entry_handle(&self, req: &LibraryGetReq) -> Result<FileHandleInfo, CoreError> {
        let path = {
            let guard = self.library.read().await;
            guard.as_ref().ok_or_else(not_configured)?.library.path_of(&req.entry_id)?
        };
        Ok(self.handles.register(&path, HandleSource::Library)?)
    }

    pub async fn library_set_collections(&self, req: &LibrarySetCollectionsReq) -> Result<LibraryStatus, CoreError> {
        let mut guard = self.library.write().await;
        let status = guard.as_mut().ok_or_else(not_configured)?.library.set_collections(&req.collections)?;
        drop(guard);
        self.emit_library(LibraryChangedReason::Meta, 0);
        Ok(status)
    }

    pub async fn library_thumbnails_clear(&self) -> Result<(), CoreError> {
        match self.library.read().await.as_ref() {
            Some(h) => h.library.clear_thumbnails()?,
            None => {
                let _ = std::fs::remove_dir_all(self.dirs.thumbs());
            }
        }
        Ok(())
    }

    /// Pfad eines Vorschaubilds (für das Protokoll `cythumb`); erzeugt es bei Bedarf.
    pub async fn library_thumbnail_path(self: &Arc<Self>, entry_id: &str) -> Result<PathBuf, CoreError> {
        let this = self.clone();
        let id = entry_id.to_owned();
        Self::blocking(move || -> Result<PathBuf, CoreError> {
            let guard = this.library.blocking_read();
            let holder = guard.as_ref().ok_or_else(not_configured)?;
            Ok(holder.library.thumbnail(&id)?)
        })
        .await?
    }

    // --- Austauschpakete ----------------------------------------------------------------------------

    /// Schreibt ein Austauschpaket nach `dest` (vom Nutzer im Dialog gewählt).
    pub async fn library_pack_export(
        self: &Arc<Self>,
        req: &PackExportReq,
        dest: &Path,
        sink: SharedSink<PackEvent>,
    ) -> Result<FileHandleInfo, CoreError> {
        let (root, rels) = {
            let guard = self.library.read().await;
            let lib = &guard.as_ref().ok_or_else(not_configured)?.library;
            let rels: Vec<String> = lib.entries_by_ids(&req.entry_ids)?.iter().map(|e| e.rel_path.clone()).collect();
            (lib.root().to_path_buf(), rels)
        };
        let job = self.jobs.start(JobKind::PackExport, &req.title, "library:pack", true)?;
        sink.emit(PackEvent::Started { job_id: job.id.clone(), total: rels.len() as u32 });
        let (cancel, progress) = (job.token.clone(), sink.clone());
        let author = self.settings.get().profile.display_name;
        let (title, include, version) =
            (req.title.clone(), req.include_sidecars.unwrap_or(true), self.app_version.clone());
        let dest = dest.to_path_buf();
        let dest_for_thread = dest.clone();
        let result = Self::blocking(move || {
            let adapter = move |p: PackProgress| progress.emit(PackEvent::Progress { done: p.done, total: p.total });
            exchange::export(&root, &rels, &dest_for_thread, &title, &author, include, &version, &adapter, &cancel)
        })
        .await?;
        match result {
            Ok(_) => {
                sink.emit(PackEvent::Finished);
                let handle = self.handles.register(&dest, HandleSource::Export)?;
                job.finish_ok(JobResult::File { handle: handle.clone() });
                Ok(handle)
            }
            Err(e) => {
                let err = CoreError::from(e);
                job.finish_err(crate::api::AppError::from(&err));
                Err(err)
            }
        }
    }

    pub async fn library_pack_inspect(self: &Arc<Self>, req: &PackInspectReq) -> Result<PackPreview, CoreError> {
        let src = self
            .handles
            .resolve(&req.handle_id)
            .ok_or(CoreError::NotFound { entity: EntityKind::FileHandle, id: req.handle_id.clone() })?;
        let root = {
            let guard = self.library.read().await;
            guard.as_ref().ok_or_else(not_configured)?.library.root().to_path_buf()
        };
        let mut preview = Self::blocking(move || exchange::inspect(&src, &root)).await??;
        preview.handle_id = req.handle_id.clone();
        Ok(preview)
    }

    pub async fn library_pack_import(
        self: &Arc<Self>,
        req: &PackImportReq,
        sink: SharedSink<PackEvent>,
    ) -> Result<PackImportReport, CoreError> {
        let src = self
            .handles
            .resolve(&req.handle_id)
            .ok_or(CoreError::NotFound { entity: EntityKind::FileHandle, id: req.handle_id.clone() })?;
        let root = {
            let guard = self.library.read().await;
            guard.as_ref().ok_or_else(not_configured)?.library.root().to_path_buf()
        };
        let job = self.jobs.start(JobKind::PackImport, &req.handle_id, "library:pack", true)?;
        let (cancel, progress, policy) = (job.token.clone(), sink.clone(), req.conflict_policy);
        sink.emit(PackEvent::Started { job_id: job.id.clone(), total: 0 });
        let result = Self::blocking(move || {
            let adapter = move |p: PackProgress| progress.emit(PackEvent::Progress { done: p.done, total: p.total });
            exchange::import(&root, &src, policy, &adapter, &cancel)
        })
        .await?;
        match result {
            Ok(report) => {
                sink.emit(PackEvent::Finished);
                job.finish_ok(JobResult::None);
                self.library_rescan_quiet().await;
                self.emit_library(
                    LibraryChangedReason::PackImport,
                    report.imported + report.renamed + report.overwritten,
                );
                Ok(report)
            }
            Err(e) => {
                let err = CoreError::from(e);
                job.finish_err(crate::api::AppError::from(&err));
                Err(err)
            }
        }
    }

    /// Neue ID für Aufrufer, die Dateinamen brauchen (Tests).
    pub fn fresh_id() -> String {
        new_id()
    }
}
