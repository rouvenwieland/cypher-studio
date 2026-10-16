//! Commands: app (Phase 0: antworten mit sauberem Fehler, bis das Modul gebaut ist).

#![allow(unused_variables)]

use cypher_core::api::{AppCloseReq, AppInfo, FileHandleInfo, OpenExternalReq, RevealReq};
use tauri::{AppHandle, Runtime, State};

use super::{R, not_built};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn app_info(ctx: State<'_, AppCtx>) -> R<AppInfo> {
    not_built("app_info")
}

#[tauri::command]
pub async fn app_open_external<Rt: Runtime>(app: AppHandle<Rt>, ctx: State<'_, AppCtx>, req: OpenExternalReq) -> R<()> {
    not_built("app_open_external")
}

#[tauri::command]
pub async fn app_reveal<Rt: Runtime>(app: AppHandle<Rt>, ctx: State<'_, AppCtx>, req: RevealReq) -> R<()> {
    not_built("app_reveal")
}

#[tauri::command]
pub async fn app_close<Rt: Runtime>(app: AppHandle<Rt>, ctx: State<'_, AppCtx>, req: AppCloseReq) -> R<()> {
    not_built("app_close")
}

#[tauri::command]
pub async fn diagnostics_export<Rt: Runtime>(app: AppHandle<Rt>, ctx: State<'_, AppCtx>) -> R<Option<FileHandleInfo>> {
    not_built("diagnostics_export")
}
