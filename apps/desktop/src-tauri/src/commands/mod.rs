//! Tauri-Commands. Nur Parameter prüfen, Kern aufrufen, Fehler durchreichen: keine Fachlogik.

pub mod app;
pub mod bgremove;
pub mod brand;
pub mod catalog;
pub mod files;
pub mod install;
pub mod jobs;
pub mod launch;
pub mod library;
pub mod printcheck;
pub mod programs;
pub mod projects;
pub mod settings;
pub mod setup;
pub mod updater;

use cypher_core::api::AppError;
use cypher_core::app::App;
use cypher_core::error::CoreError;

use crate::ctx::AppCtx;

/// Ergebnistyp aller Commands.
pub type R<T> = Result<T, AppError>;

/// Führt Dateiarbeit des Kerns abseits der asynchronen Threads aus und bildet den Fehler auf den Vertrag ab.
pub(crate) async fn blocking<T: Send + 'static>(
    ctx: &AppCtx,
    work: impl FnOnce(&App) -> Result<T, CoreError> + Send + 'static,
) -> R<T> {
    let app = ctx.app.clone();
    tauri::async_runtime::spawn_blocking(move || work(&app))
        .await
        .map_err(|e| AppError::internal(format!("Aufgabe abgebrochen: {e}")))?
        .map_err(AppError::from)
}
