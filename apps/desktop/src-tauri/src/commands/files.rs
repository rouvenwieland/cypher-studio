//! Commands: files (Phase 0: antworten mit sauberem Fehler, bis das Modul gebaut ist).

#![allow(unused_variables)]

use cypher_core::api::{FileHandleInfo, FilePickReq, SampleInfo};
use tauri::{AppHandle, Runtime, State};

use super::{R, not_built};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn file_pick<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: FilePickReq,
) -> R<Vec<FileHandleInfo>> {
    not_built("file_pick")
}

#[tauri::command]
pub async fn samples_list(ctx: State<'_, AppCtx>) -> R<Vec<SampleInfo>> {
    not_built("samples_list")
}

/// RAW-Command: Körper = Bilddaten, Metadaten im Header `x-cypher-export-meta`.
#[tauri::command]
pub async fn export_save_image<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    request: tauri::ipc::Request<'_>,
) -> R<Option<FileHandleInfo>> {
    not_built("export_save_image")
}
