//! Commands: settings (Einstellungen, Ordnerwahl, Netzwerkübersicht).

use cypher_core::api::{DirSetting, NetworkInfo, Settings, SettingsChooseDirReq, SettingsPatch};
use tauri::{AppHandle, Runtime, State};

use super::{R, blocking};
use crate::ctx::AppCtx;
use crate::dialogs;

#[tauri::command]
pub async fn settings_get(ctx: State<'_, AppCtx>) -> R<Settings> {
    Ok(ctx.app.settings_get())
}

#[tauri::command]
pub async fn settings_update(ctx: State<'_, AppCtx>, req: SettingsPatch) -> R<Settings> {
    Ok(ctx.app.settings_update(&req)?)
}

/// Ordner wählen und übernehmen (Programmordner, Projektordner). Abbruch = `null`.
#[tauri::command]
pub async fn settings_choose_dir<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: SettingsChooseDirReq,
) -> R<Option<Settings>> {
    let title = match req.which {
        DirSetting::ProgramsDir => "Ordner für Programme wählen",
        DirSetting::ProjectsDir => "Ordner für Projekte wählen",
    };
    let Some(path) = dialogs::pick_folder(&app, title).await? else { return Ok(None) };
    Ok(Some(blocking(&ctx, move |core| core.settings_set_dir(req.which, &path)).await?))
}

#[tauri::command]
pub async fn network_info(ctx: State<'_, AppCtx>) -> R<NetworkInfo> {
    Ok(ctx.app.network_info())
}
