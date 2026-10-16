//! Commands: catalog (Phase 0: antworten mit sauberem Fehler, bis das Modul gebaut ist).

#![allow(unused_variables)]

use cypher_core::api::{CatalogRefreshResult, CatalogStatus};
use tauri::{AppHandle, Runtime, State};

use super::{R, not_built};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn catalog_status(ctx: State<'_, AppCtx>) -> R<CatalogStatus> {
    not_built("catalog_status")
}

#[tauri::command]
pub async fn catalog_refresh<Rt: Runtime>(app: AppHandle<Rt>, ctx: State<'_, AppCtx>) -> R<CatalogRefreshResult> {
    not_built("catalog_refresh")
}
