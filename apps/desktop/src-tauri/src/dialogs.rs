//! Native Dialoge (`tauri-plugin-dialog`), nur aus Rust benutzt: das Frontend bekommt keine Dialog-Rechte und sieht nur
//! Handles. Alle Aufrufe blockieren und laufen deshalb in `spawn_blocking`.

use std::path::PathBuf;

use cypher_core::api::{AppError, FilePurpose};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};

/// Dateiendungen und Titel je Verwendungszweck.
struct Filter {
    title: &'static str,
    name: &'static str,
    extensions: &'static [&'static str],
}

fn filter_for(purpose: FilePurpose) -> Filter {
    match purpose {
        FilePurpose::Printcheck => Filter {
            title: "Motiv zum Prüfen wählen",
            name: "Bilder",
            extensions: &["png", "jpg", "jpeg", "tif", "tiff", "webp"],
        },
        FilePurpose::MockupDesign => Filter {
            title: "Motiv für das Mockup wählen",
            name: "Bilder",
            extensions: &["png", "jpg", "jpeg", "tif", "tiff", "webp"],
        },
        FilePurpose::SocialImage => {
            Filter { title: "Bild wählen", name: "Bilder", extensions: &["png", "jpg", "jpeg", "webp"] }
        }
        FilePurpose::Bgremove => Filter {
            title: "Bild zum Freistellen wählen",
            name: "Bilder",
            extensions: &["png", "jpg", "jpeg", "tif", "tiff", "webp"],
        },
        FilePurpose::LibraryImport => {
            Filter { title: "Dateien für die Bibliothek wählen", name: "", extensions: &[] }
        }
        FilePurpose::PackImport => {
            Filter { title: "Austauschpaket wählen", name: "Austauschpaket", extensions: &["cypherpack"] }
        }
        FilePurpose::OpenAny => Filter { title: "Datei wählen", name: "", extensions: &[] },
    }
}

fn internal(e: impl std::fmt::Display) -> AppError {
    AppError::internal(format!("Dialog: {e}"))
}

/// Hängt den Dialog an das Hauptfenster (modal), wenn es eines gibt.
fn with_parent<R: Runtime>(app: &AppHandle<R>, builder: FileDialogBuilder<R>) -> FileDialogBuilder<R> {
    match app.get_webview_window("main") {
        Some(window) => builder.set_parent(&window),
        None => builder,
    }
}

async fn run<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(internal)
}

/// Dateiauswahl. Abbruch = leere Liste.
pub async fn pick_files<R: Runtime>(
    app: &AppHandle<R>,
    purpose: FilePurpose,
    multiple: bool,
) -> Result<Vec<PathBuf>, AppError> {
    let app = app.clone();
    run(move || {
        let filter = filter_for(purpose);
        let mut builder = with_parent(&app, app.dialog().file().set_title(filter.title));
        if !filter.extensions.is_empty() {
            builder = builder.add_filter(filter.name, filter.extensions);
        }
        let picked = if multiple {
            builder.blocking_pick_files().unwrap_or_default()
        } else {
            builder.blocking_pick_file().into_iter().collect()
        };
        picked.into_iter().filter_map(|p| p.into_path().ok()).collect()
    })
    .await
}

/// Eine Programmdatei wählen (Windows `.exe`, macOS `.app`, Linux jede Datei).
pub async fn pick_program<R: Runtime>(app: &AppHandle<R>, program_name: &str) -> Result<Option<PathBuf>, AppError> {
    let app = app.clone();
    let title = format!("{program_name} auswählen");
    run(move || {
        let mut builder = with_parent(&app, app.dialog().file().set_title(title));
        if cfg!(windows) {
            builder = builder.add_filter("Programm", &["exe"]);
        } else if cfg!(target_os = "macos") {
            builder = builder.add_filter("Programm", &["app"]);
        }
        builder.blocking_pick_file().and_then(|p| p.into_path().ok())
    })
    .await
}

/// Ordnerauswahl. Abbruch = `None`.
pub async fn pick_folder<R: Runtime>(app: &AppHandle<R>, title: &str) -> Result<Option<PathBuf>, AppError> {
    let app = app.clone();
    let title = title.to_owned();
    run(move || {
        with_parent(&app, app.dialog().file().set_title(title)).blocking_pick_folder().and_then(|p| p.into_path().ok())
    })
    .await
}

/// Speichern-Dialog mit Vorschlag für den Dateinamen. Abbruch = `None`.
pub async fn save_file<R: Runtime>(
    app: &AppHandle<R>,
    title: &str,
    file_name: &str,
    filter: Option<(&'static str, &'static [&'static str])>,
) -> Result<Option<PathBuf>, AppError> {
    let app = app.clone();
    let (title, file_name) = (title.to_owned(), file_name.to_owned());
    run(move || {
        let mut builder = with_parent(&app, app.dialog().file().set_title(title).set_file_name(file_name));
        if let Some((name, extensions)) = filter {
            builder = builder.add_filter(name, extensions);
        }
        builder.blocking_save_file().and_then(|p| p.into_path().ok())
    })
    .await
}
