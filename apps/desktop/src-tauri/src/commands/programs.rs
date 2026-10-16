//! Commands: programs (Phase 0: antworten mit sauberem Fehler, bis das Modul gebaut ist).

#![allow(unused_variables)]

use cypher_core::api::{AddManualReq, Installation, ProgramOverview, ProgramsView, SetPreferredReq};
use tauri::{AppHandle, Runtime, State};

use super::{R, not_built};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn programs_list(ctx: State<'_, AppCtx>) -> R<ProgramsView> {
    not_built("programs_list")
}

#[tauri::command]
pub async fn programs_rescan<Rt: Runtime>(app: AppHandle<Rt>, ctx: State<'_, AppCtx>) -> R<ProgramsView> {
    not_built("programs_rescan")
}

#[tauri::command]
pub async fn program_set_preferred<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: SetPreferredReq,
) -> R<ProgramOverview> {
    not_built("program_set_preferred")
}

#[tauri::command]
pub async fn program_add_manual<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: AddManualReq,
) -> R<Option<Installation>> {
    not_built("program_add_manual")
}
