//! Commands: install (Phase 0: antworten mit sauberem Fehler, bis das Modul gebaut ist).

#![allow(unused_variables)]

use cypher_core::api::{
    InstallEvent, InstallPlan, InstallPreviewReq, InstallStartReq, Installation, InstallationRemoveReq,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};

use super::{R, not_built};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn install_preview(ctx: State<'_, AppCtx>, req: InstallPreviewReq) -> R<InstallPlan> {
    not_built("install_preview")
}

#[tauri::command]
pub async fn install_start<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: InstallStartReq,
    on_event: Channel<InstallEvent>,
) -> R<Installation> {
    not_built("install_start")
}

#[tauri::command]
pub async fn installation_remove<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: InstallationRemoveReq,
) -> R<()> {
    not_built("installation_remove")
}
