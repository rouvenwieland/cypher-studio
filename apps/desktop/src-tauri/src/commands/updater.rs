//! Commands: updater (App-Update prüfen und einspielen). Die Arbeit steht in `crate::updater`.

use cypher_core::api::{UpdateCheck, UpdateEvent};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};

use super::R;
use crate::ctx::AppCtx;
use crate::events::borrowed;

#[tauri::command]
pub async fn app_update_check<Rt: Runtime>(app: AppHandle<Rt>, ctx: State<'_, AppCtx>) -> R<UpdateCheck> {
    crate::updater::check(&app, &ctx).await
}

/// Lädt das gefundene Update, prüft die Signatur und startet neu. Nur wenn keine Aufträge laufen.
#[tauri::command]
pub async fn app_update_install<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    on_event: Channel<UpdateEvent>,
) -> R<()> {
    crate::updater::install(&app, &ctx, &borrowed(on_event)).await
}
