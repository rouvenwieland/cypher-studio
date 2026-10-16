//! Commands: settings (Phase 0: antworten mit sauberem Fehler, bis das Modul gebaut ist).

#![allow(unused_variables)]

use cypher_core::api::{NetworkInfo, Settings, SettingsChooseDirReq, SettingsPatch};
use tauri::{AppHandle, Runtime, State};

use super::{R, not_built};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn settings_get(ctx: State<'_, AppCtx>) -> R<Settings> {
    not_built("settings_get")
}

#[tauri::command]
pub async fn settings_update(ctx: State<'_, AppCtx>, req: SettingsPatch) -> R<Settings> {
    not_built("settings_update")
}

#[tauri::command]
pub async fn settings_choose_dir<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: SettingsChooseDirReq,
) -> R<Option<Settings>> {
    not_built("settings_choose_dir")
}

#[tauri::command]
pub async fn network_info(ctx: State<'_, AppCtx>) -> R<NetworkInfo> {
    not_built("network_info")
}
