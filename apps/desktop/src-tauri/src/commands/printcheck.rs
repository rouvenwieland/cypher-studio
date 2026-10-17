//! Commands: printcheck (Druckprofile, Analyse, Export, Überlagerungen).

use cypher_core::api::{
    AppError, FileHandleInfo, PrintAnalyzeReq, PrintDestination, PrintExportEvent, PrintExportReq, PrintExportResult,
    PrintOverlayReq, PrintProfile, PrintReport,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};

use super::R;
use crate::ctx::AppCtx;
use crate::dialogs;
use crate::events::shared;

#[tauri::command]
pub async fn print_profiles_list(ctx: State<'_, AppCtx>) -> R<Vec<PrintProfile>> {
    Ok(ctx.app.print_profiles_list())
}

#[tauri::command]
pub async fn printcheck_analyze(ctx: State<'_, AppCtx>, req: PrintAnalyzeReq) -> R<PrintReport> {
    Ok(ctx.app.printcheck_analyze(&req).await?)
}

/// Exportiert das geprüfte Motiv. Bei Ziel „Dialog“ fragt ein Speichern-Dialog; Abbruch dort ist ein `cancelled`.
#[tauri::command]
pub async fn printcheck_export<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: PrintExportReq,
    on_event: Channel<PrintExportEvent>,
) -> R<PrintExportResult> {
    let dialog_path = if matches!(req.options.destination, PrintDestination::Dialog) {
        let suggestion = ctx.app.printcheck_suggested_name(&req)?;
        match dialogs::save_file(&app, "Druckdatei speichern", &suggestion, Some(("PNG-Bild", &["png"]))).await? {
            Some(path) => Some(path),
            None => return Err(AppError::Cancelled),
        }
    } else {
        None
    };
    Ok(ctx.app.printcheck_export(&req, dialog_path.as_deref(), shared(on_event)).await?)
}

#[tauri::command]
pub async fn printcheck_overlay(ctx: State<'_, AppCtx>, req: PrintOverlayReq) -> R<FileHandleInfo> {
    Ok(ctx.app.printcheck_overlay(&req).await?)
}
