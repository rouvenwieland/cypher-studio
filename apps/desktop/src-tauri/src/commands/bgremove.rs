//! Commands: bgremove (Phase 0: antworten mit sauberem Fehler, bis das Modul gebaut ist).

#![allow(unused_variables)]

use cypher_core::api::{
    BgRemoveEvent, BgRemoveModelReq, BgRemoveRunReq, BgRemoveStatus, FileHandleInfo, InstallEvent, InstallPlan,
    InstallStartReq,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};

use super::{R, not_built};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn bgremove_status(ctx: State<'_, AppCtx>) -> R<BgRemoveStatus> {
    not_built("bgremove_status")
}

#[tauri::command]
pub async fn bgremove_model_preview(ctx: State<'_, AppCtx>, req: BgRemoveModelReq) -> R<InstallPlan> {
    not_built("bgremove_model_preview")
}

#[tauri::command]
pub async fn bgremove_model_install<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: InstallStartReq,
    on_event: Channel<InstallEvent>,
) -> R<BgRemoveStatus> {
    not_built("bgremove_model_install")
}

#[tauri::command]
pub async fn bgremove_run<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: BgRemoveRunReq,
    on_event: Channel<BgRemoveEvent>,
) -> R<FileHandleInfo> {
    not_built("bgremove_run")
}
