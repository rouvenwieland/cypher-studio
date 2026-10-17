//! Commands: files (Dateiauswahl, Beispiele, Bild speichern). Das Frontend sieht nur Handles, nie Pfade.

use cypher_core::api::{
    AppError, EXPORT_IMAGE_META_HEADER, ExportImageFormat, ExportImageMeta, FileHandleInfo, FilePickReq, FilePurpose,
    SampleInfo,
};
use cypher_core::app::App;
use cypher_core::urls::decode_request_path;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Runtime, State};

use super::R;
use crate::ctx::AppCtx;
use crate::dialogs;

/// Öffnet den Dateidialog passend zum Zweck. Abbruch = leere Liste.
#[tauri::command]
pub async fn file_pick<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: FilePickReq,
) -> R<Vec<FileHandleInfo>> {
    let multiple = req.multiple.unwrap_or(req.purpose == FilePurpose::LibraryImport);
    let paths = dialogs::pick_files(&app, req.purpose, multiple).await?;
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    Ok(ctx.app.register_picked(&paths)?)
}

#[tauri::command]
pub async fn samples_list(ctx: State<'_, AppCtx>) -> R<Vec<SampleInfo>> {
    Ok(ctx.app.samples_list())
}

/// Die Metadaten stehen als `encodeURIComponent`-kodiertes JSON im Header `x-cypher-export-meta`.
fn parse_meta(request: &Request<'_>) -> Result<ExportImageMeta, AppError> {
    let invalid = |reason: &str| AppError::invalid_input(EXPORT_IMAGE_META_HEADER, reason);
    let raw = request
        .headers()
        .get(EXPORT_IMAGE_META_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| invalid("Der Kopf mit den Bildangaben fehlt"))?;
    let json = decode_request_path(raw).ok_or_else(|| invalid("Die Bildangaben sind nicht lesbar kodiert"))?;
    serde_json::from_str(&json).map_err(|e| invalid(&format!("Die Bildangaben sind ungültig: {e}")))
}

/// RAW-Command: Körper = PNG oder JPEG, Kopf = Metadaten. Ziel per Dialog, Projekt oder Bibliothek. Abbruch = `null`.
#[tauri::command]
pub async fn export_save_image<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    request: Request<'_>,
) -> R<Option<FileHandleInfo>> {
    let meta = parse_meta(&request)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::invalid_input("body", "Das Bild muss als Rohdaten kommen"));
    };
    let dialog_path = if App::export_image_needs_dialog(&meta) {
        let filter = match meta.format {
            ExportImageFormat::Png => ("PNG-Bild", &["png"][..]),
            ExportImageFormat::Jpeg => ("JPEG-Bild", &["jpg", "jpeg"][..]),
        };
        match dialogs::save_file(&app, "Bild speichern", &meta.file_name, Some(filter)).await? {
            Some(path) => Some(path),
            None => return Ok(None),
        }
    } else {
        None
    };
    // Das Bild bis zu 64 MB wird nicht kopiert: die Arbeit läuft auf diesem Thread, der dafür aus der Planung genommen wird
    let saved = tokio::task::block_in_place(|| ctx.app.export_save_image(&meta, bytes, dialog_path.as_deref()))?;
    Ok(Some(saved))
}
