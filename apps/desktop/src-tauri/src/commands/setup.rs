//! Commands: setup (Einrichtungspakete: Liste, Vorschau, Anwenden, Zurücknehmen, Verlauf).

use cypher_core::api::{
    SetupApplyReq, SetupEvent, SetupHistoryReq, SetupPlan, SetupPreviewReq, SetupRecord, SetupStatusReq, SetupSummary,
    SetupUndoReq, UndoReport,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};

use super::{R, blocking};
use crate::ctx::AppCtx;
use crate::events::shared;

#[tauri::command]
pub async fn setup_packs_list(ctx: State<'_, AppCtx>) -> R<Vec<SetupSummary>> {
    Ok(ctx.app.setup_packs_list())
}

#[tauri::command]
pub async fn setup_status(ctx: State<'_, AppCtx>, req: SetupStatusReq) -> R<SetupSummary> {
    Ok(ctx.app.setup_status(&req)?)
}

#[tauri::command]
pub async fn setup_preview(ctx: State<'_, AppCtx>, req: SetupPreviewReq) -> R<SetupPlan> {
    blocking(&ctx, move |core| core.setup_preview(&req)).await
}

#[tauri::command]
pub async fn setup_apply<Rt: Runtime>(
    _app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: SetupApplyReq,
    on_event: Channel<SetupEvent>,
) -> R<SetupRecord> {
    Ok(ctx.app.setup_apply(&req, shared(on_event)).await?)
}

#[tauri::command]
pub async fn setup_undo<Rt: Runtime>(_app: AppHandle<Rt>, ctx: State<'_, AppCtx>, req: SetupUndoReq) -> R<UndoReport> {
    Ok(ctx.app.setup_undo(&req).await?)
}

#[tauri::command]
pub async fn setup_history(ctx: State<'_, AppCtx>, req: SetupHistoryReq) -> R<Vec<SetupRecord>> {
    blocking(&ctx, move |core| core.setup_history(&req)).await
}
