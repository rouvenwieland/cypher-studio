//! Commands: printcheck (Phase 0: antworten mit sauberem Fehler, bis das Modul gebaut ist).

#![allow(unused_variables)]

use cypher_core::api::{
    FileHandleInfo, PrintAnalyzeReq, PrintExportEvent, PrintExportReq, PrintExportResult, PrintOverlayReq,
    PrintProfile, PrintReport,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};

use super::{R, not_built};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn print_profiles_list(ctx: State<'_, AppCtx>) -> R<Vec<PrintProfile>> {
    not_built("print_profiles_list")
}

#[tauri::command]
pub async fn printcheck_analyze(ctx: State<'_, AppCtx>, req: PrintAnalyzeReq) -> R<PrintReport> {
    not_built("printcheck_analyze")
}

#[tauri::command]
pub async fn printcheck_export<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: PrintExportReq,
    on_event: Channel<PrintExportEvent>,
) -> R<PrintExportResult> {
    not_built("printcheck_export")
}

#[tauri::command]
pub async fn printcheck_overlay(ctx: State<'_, AppCtx>, req: PrintOverlayReq) -> R<FileHandleInfo> {
    not_built("printcheck_overlay")
}
