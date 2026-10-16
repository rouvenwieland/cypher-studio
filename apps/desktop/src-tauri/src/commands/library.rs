//! Commands: library (Phase 0: antworten mit sauberem Fehler, bis das Modul gebaut ist).

#![allow(unused_variables)]

use cypher_core::api::{
    FileHandleInfo, LibraryBulkMetaReq, LibraryEntry, LibraryGetReq, LibraryImportReq, LibraryMetaPatchReq,
    LibraryPage, LibraryQuery, LibraryRootCandidate, LibrarySetCollectionsReq, LibraryStatus, LibraryUseRootReq,
    PackEvent, PackExportReq, PackImportReport, PackImportReq, PackInspectReq, PackPreview, ScanEvent,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};

use super::{R, not_built};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn library_status(ctx: State<'_, AppCtx>) -> R<LibraryStatus> {
    not_built("library_status")
}

#[tauri::command]
pub async fn library_choose_root<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
) -> R<Option<LibraryRootCandidate>> {
    not_built("library_choose_root")
}

#[tauri::command]
pub async fn library_use_root<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: LibraryUseRootReq,
) -> R<LibraryStatus> {
    not_built("library_use_root")
}

#[tauri::command]
pub async fn library_scan<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    on_event: Channel<ScanEvent>,
) -> R<LibraryStatus> {
    not_built("library_scan")
}

#[tauri::command]
pub async fn library_query(ctx: State<'_, AppCtx>, req: LibraryQuery) -> R<LibraryPage> {
    not_built("library_query")
}

#[tauri::command]
pub async fn library_get(ctx: State<'_, AppCtx>, req: LibraryGetReq) -> R<LibraryEntry> {
    not_built("library_get")
}

#[tauri::command]
pub async fn library_update_meta<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: LibraryMetaPatchReq,
) -> R<LibraryEntry> {
    not_built("library_update_meta")
}

#[tauri::command]
pub async fn library_bulk_meta<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: LibraryBulkMetaReq,
) -> R<u32> {
    not_built("library_bulk_meta")
}

#[tauri::command]
pub async fn library_import<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: LibraryImportReq,
) -> R<Vec<LibraryEntry>> {
    not_built("library_import")
}

#[tauri::command]
pub async fn library_entry_handle(ctx: State<'_, AppCtx>, req: LibraryGetReq) -> R<FileHandleInfo> {
    not_built("library_entry_handle")
}

#[tauri::command]
pub async fn library_set_collections<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: LibrarySetCollectionsReq,
) -> R<LibraryStatus> {
    not_built("library_set_collections")
}

#[tauri::command]
pub async fn library_thumbnails_clear(ctx: State<'_, AppCtx>) -> R<()> {
    not_built("library_thumbnails_clear")
}

#[tauri::command]
pub async fn library_pack_export<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: PackExportReq,
    on_event: Channel<PackEvent>,
) -> R<Option<FileHandleInfo>> {
    not_built("library_pack_export")
}

#[tauri::command]
pub async fn library_pack_inspect(ctx: State<'_, AppCtx>, req: PackInspectReq) -> R<PackPreview> {
    not_built("library_pack_inspect")
}

#[tauri::command]
pub async fn library_pack_import<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: PackImportReq,
    on_event: Channel<PackEvent>,
) -> R<PackImportReport> {
    not_built("library_pack_import")
}
