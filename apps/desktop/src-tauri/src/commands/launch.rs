//! Commands: launch (Programm starten).

use cypher_core::api::{LaunchReq, LaunchResult};
use tauri::State;

use super::{R, blocking};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn program_launch(ctx: State<'_, AppCtx>, req: LaunchReq) -> R<LaunchResult> {
    blocking(&ctx, move |core| core.program_launch(&req)).await
}
