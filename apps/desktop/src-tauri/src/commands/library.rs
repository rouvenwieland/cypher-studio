//! Commands: library (Bibliothek: Wurzel, Scan, Abfragen, Metadaten, Import, Austauschpakete).

use cypher_core::api::{
    FileHandleInfo, LibraryBulkMetaReq, LibraryEntry, LibraryGetReq, LibraryImportReq, LibraryMetaPatchReq,
    LibraryPage, LibraryQuery, LibraryRootCandidate, LibrarySetCollectionsReq, LibraryStatus, LibraryUseRootReq,
    PackEvent, PackExportReq, PackImportReport, PackImportReq, PackInspectReq, PackPreview, ScanEvent,
};
use cypher_core::platform::fsx::sanitize_file_name;
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};

use super::R;
use crate::ctx::AppCtx;
use crate::dialogs;
use crate::events::shared;

#[tauri::command]
pub async fn library_status(ctx: State<'_, AppCtx>) -> R<LibraryStatus> {
    Ok(ctx.app.library_status().await)
}

/// Ordner wählen und zusammenfassen, noch ohne Umstellung. Abbruch = `null`.
#[tauri::command]
pub async fn library_choose_root<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
) -> R<Option<LibraryRootCandidate>> {
    let Some(path) = dialogs::pick_folder(&app, "Bibliotheksordner wählen").await? else { return Ok(None) };
    Ok(Some(ctx.app.library_choose_root(&path).await?))
}

#[tauri::command]
pub async fn library_use_root<Rt: Runtime>(
    _app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: LibraryUseRootReq,
) -> R<LibraryStatus> {
    Ok(ctx.app.library_use_root(&req).await?)
}

#[tauri::command]
pub async fn library_scan<Rt: Runtime>(
    _app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    on_event: Channel<ScanEvent>,
) -> R<LibraryStatus> {
    Ok(ctx.app.library_scan(shared(on_event)).await?)
}

#[tauri::command]
pub async fn library_query(ctx: State<'_, AppCtx>, req: LibraryQuery) -> R<LibraryPage> {
    Ok(ctx.app.library_query(&req).await?)
}

#[tauri::command]
pub async fn library_get(ctx: State<'_, AppCtx>, req: LibraryGetReq) -> R<LibraryEntry> {
    Ok(ctx.app.library_get(&req).await?)
}

#[tauri::command]
pub async fn library_update_meta<Rt: Runtime>(
    _app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: LibraryMetaPatchReq,
) -> R<LibraryEntry> {
    Ok(ctx.app.library_update_meta(&req).await?)
}

#[tauri::command]
pub async fn library_bulk_meta<Rt: Runtime>(
    _app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: LibraryBulkMetaReq,
) -> R<u32> {
    Ok(ctx.app.library_bulk_meta(&req).await?)
}

#[tauri::command]
pub async fn library_import<Rt: Runtime>(
    _app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: LibraryImportReq,
) -> R<Vec<LibraryEntry>> {
    Ok(ctx.app.library_import(&req).await?)
}

#[tauri::command]
pub async fn library_entry_handle(ctx: State<'_, AppCtx>, req: LibraryGetReq) -> R<FileHandleInfo> {
    Ok(ctx.app.library_entry_handle(&req).await?)
}

#[tauri::command]
pub async fn library_set_collections<Rt: Runtime>(
    _app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: LibrarySetCollectionsReq,
) -> R<LibraryStatus> {
    Ok(ctx.app.library_set_collections(&req).await?)
}

#[tauri::command]
pub async fn library_thumbnails_clear(ctx: State<'_, AppCtx>) -> R<()> {
    Ok(ctx.app.library_thumbnails_clear().await?)
}

/// Schreibt ein Austauschpaket dorthin, wo die Nutzerin es speichern will. Abbruch = `null`.
#[tauri::command]
pub async fn library_pack_export<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: PackExportReq,
    on_event: Channel<PackEvent>,
) -> R<Option<FileHandleInfo>> {
    let suggestion = format!("{}.cypherpack", sanitize_file_name(&req.title));
    let Some(mut dest) =
        dialogs::save_file(&app, "Austauschpaket speichern", &suggestion, Some(("Austauschpaket", &["cypherpack"])))
            .await?
    else {
        return Ok(None);
    };
    if dest.extension().is_none() {
        dest.set_extension("cypherpack");
    }
    Ok(Some(ctx.app.library_pack_export(&req, &dest, shared(on_event)).await?))
}

#[tauri::command]
pub async fn library_pack_inspect(ctx: State<'_, AppCtx>, req: PackInspectReq) -> R<PackPreview> {
    Ok(ctx.app.library_pack_inspect(&req).await?)
}

#[tauri::command]
pub async fn library_pack_import<Rt: Runtime>(
    _app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: PackImportReq,
    on_event: Channel<PackEvent>,
) -> R<PackImportReport> {
    Ok(ctx.app.library_pack_import(&req, shared(on_event)).await?)
}
