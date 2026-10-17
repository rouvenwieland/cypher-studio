//! Commands: install (Plan, Ausführung mit Fortschritt, Entfernen).

use cypher_core::api::{
    InstallEvent, InstallPlan, InstallPreviewReq, InstallStartReq, Installation, InstallationRemoveReq,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};

use super::{R, blocking};
use crate::ctx::AppCtx;
use crate::events::borrowed;

#[tauri::command]
pub async fn install_preview(ctx: State<'_, AppCtx>, req: InstallPreviewReq) -> R<InstallPlan> {
    blocking(&ctx, move |core| core.install_preview(&req)).await
}

#[tauri::command]
pub async fn install_start<Rt: Runtime>(
    _app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: InstallStartReq,
    on_event: Channel<InstallEvent>,
) -> R<Installation> {
    Ok(ctx.app.install_start(&req, &borrowed(on_event)).await?)
}

#[tauri::command]
pub async fn installation_remove<Rt: Runtime>(
    _app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: InstallationRemoveReq,
) -> R<()> {
    blocking(&ctx, move |core| core.installation_remove(&req)).await
}
