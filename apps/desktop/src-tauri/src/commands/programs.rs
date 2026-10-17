//! Commands: programs (Liste, Neuerkennung, bevorzugte Installation, vorhandene Programme hinzufügen).

use cypher_core::api::{AddManualReq, Installation, ProgramOverview, ProgramsView, SetPreferredReq};
use tauri::{AppHandle, Runtime, State};

use super::{R, blocking};
use crate::ctx::AppCtx;
use crate::dialogs;

#[tauri::command]
pub async fn programs_list(ctx: State<'_, AppCtx>) -> R<ProgramsView> {
    Ok(ctx.app.programs_view())
}

#[tauri::command]
pub async fn programs_rescan<Rt: Runtime>(_app: AppHandle<Rt>, ctx: State<'_, AppCtx>) -> R<ProgramsView> {
    Ok(ctx.app.rescan().await?)
}

#[tauri::command]
pub async fn program_set_preferred<Rt: Runtime>(
    _app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: SetPreferredReq,
) -> R<ProgramOverview> {
    blocking(&ctx, move |core| core.program_set_preferred(&req)).await
}

/// Eine vorhandene Programmdatei im Dialog wählen und als Installation aufnehmen. Abbruch = `null`.
#[tauri::command]
pub async fn program_add_manual<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: AddManualReq,
) -> R<Option<Installation>> {
    let name = ctx
        .app
        .programs_view()
        .programs
        .iter()
        .find(|p| p.id == req.program_id)
        .map_or_else(|| req.program_id.clone(), |p| p.name.clone());
    let Some(picked) = dialogs::pick_program(&app, &name).await? else { return Ok(None) };
    Ok(Some(ctx.app.program_add_manual(&req, &picked).await?))
}
