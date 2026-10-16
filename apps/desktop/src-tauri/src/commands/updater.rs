//! Commands: updater (Phase 0: antworten mit sauberem Fehler, bis das Modul gebaut ist).

#![allow(unused_variables)]

use cypher_core::api::{UpdateCheck, UpdateEvent};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};

use super::{R, not_built};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn app_update_check<Rt: Runtime>(app: AppHandle<Rt>, ctx: State<'_, AppCtx>) -> R<UpdateCheck> {
    not_built("app_update_check")
}

#[tauri::command]
pub async fn app_update_install<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    on_event: Channel<UpdateEvent>,
) -> R<()> {
    not_built("app_update_install")
}
