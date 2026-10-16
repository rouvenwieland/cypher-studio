//! Commands: launch (Phase 0: antworten mit sauberem Fehler, bis das Modul gebaut ist).

#![allow(unused_variables)]

use cypher_core::api::{LaunchReq, LaunchResult};
use tauri::State;

use super::{R, not_built};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn program_launch(ctx: State<'_, AppCtx>, req: LaunchReq) -> R<LaunchResult> {
    not_built("program_launch")
}
