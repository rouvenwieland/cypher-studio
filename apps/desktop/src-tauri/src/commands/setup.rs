//! Commands: setup (Phase 0: antworten mit sauberem Fehler, bis das Modul gebaut ist).

#![allow(unused_variables)]

use cypher_core::api::{
    SetupApplyReq, SetupEvent, SetupHistoryReq, SetupPlan, SetupPreviewReq, SetupRecord, SetupStatusReq, SetupSummary,
    SetupUndoReq, UndoReport,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};

use super::{R, not_built};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn setup_packs_list(ctx: State<'_, AppCtx>) -> R<Vec<SetupSummary>> {
    not_built("setup_packs_list")
}

#[tauri::command]
pub async fn setup_status(ctx: State<'_, AppCtx>, req: SetupStatusReq) -> R<SetupSummary> {
    not_built("setup_status")
}

#[tauri::command]
pub async fn setup_preview(ctx: State<'_, AppCtx>, req: SetupPreviewReq) -> R<SetupPlan> {
    not_built("setup_preview")
}

#[tauri::command]
pub async fn setup_apply<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: SetupApplyReq,
    on_event: Channel<SetupEvent>,
) -> R<SetupRecord> {
    not_built("setup_apply")
}

#[tauri::command]
pub async fn setup_undo<Rt: Runtime>(app: AppHandle<Rt>, ctx: State<'_, AppCtx>, req: SetupUndoReq) -> R<UndoReport> {
    not_built("setup_undo")
}

#[tauri::command]
pub async fn setup_history(ctx: State<'_, AppCtx>, req: SetupHistoryReq) -> R<Vec<SetupRecord>> {
    not_built("setup_history")
}
