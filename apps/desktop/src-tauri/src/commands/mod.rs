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

/// Ergebnistyp aller Commands.
pub type R<T> = Result<T, AppError>;

/// Antwort für Commands, deren Modul noch nicht gebaut ist.
pub(crate) fn not_built<T>(command: &str) -> R<T> {
    Err(AppError::internal(format!("noch nicht gebaut: {command}")))
}
