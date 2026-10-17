//! Commands: bgremove (Hintergrund entfernen). Der Farbschlüssel ist immer da; das Modellverfahren ist ein späterer Ausbau
//! (ARCHITEKTUR.md 2.16): bis dahin meldet `bgremove_status` `modelFeature = false`.

use cypher_core::api::{
    AppError, BgRemoveEvent, BgRemoveModelReq, BgRemoveRunReq, BgRemoveStatus, EntityKind, FileHandleInfo,
    InstallEvent, InstallPlan, InstallStartReq,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};

use super::R;
use crate::ctx::AppCtx;
use crate::events::shared;

#[tauri::command]
pub async fn bgremove_status(ctx: State<'_, AppCtx>) -> R<BgRemoveStatus> {
    Ok(ctx.app.bgremove_status())
}

#[tauri::command]
pub async fn bgremove_model_preview(ctx: State<'_, AppCtx>, req: BgRemoveModelReq) -> R<InstallPlan> {
    Ok(ctx.app.bgremove_model_preview(&req)?)
}

/// Ohne eingebautes Modellverfahren gibt es nichts zu installieren: der Plan ist unbekannt.
#[tauri::command]
pub async fn bgremove_model_install<Rt: Runtime>(
    _app: AppHandle<Rt>,
    _ctx: State<'_, AppCtx>,
    req: InstallStartReq,
    _on_event: Channel<InstallEvent>,
) -> R<BgRemoveStatus> {
    Err(AppError::not_found(EntityKind::Plan, req.plan_id))
}

#[tauri::command]
pub async fn bgremove_run<Rt: Runtime>(
    _app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: BgRemoveRunReq,
    on_event: Channel<BgRemoveEvent>,
) -> R<FileHandleInfo> {
    Ok(ctx.app.bgremove_run(&req, shared(on_event)).await?)
}
