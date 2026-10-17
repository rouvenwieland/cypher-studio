//! Commands: catalog (Stand und Aktualisierung des signierten Katalogs).

use cypher_core::api::{CatalogRefreshResult, CatalogStatus};
use tauri::{AppHandle, Runtime, State};

use super::R;
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn catalog_status(ctx: State<'_, AppCtx>) -> R<CatalogStatus> {
    Ok(ctx.app.catalog_status())
}

/// Holt den Katalog neu; die Ereignisse `catalog:updated` und `programs:changed` sendet der Kern.
#[tauri::command]
pub async fn catalog_refresh<Rt: Runtime>(_app: AppHandle<Rt>, ctx: State<'_, AppCtx>) -> R<CatalogRefreshResult> {
    Ok(ctx.app.catalog_refresh().await?)
}
