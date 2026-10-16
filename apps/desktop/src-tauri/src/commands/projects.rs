//! Commands: projects (Phase 0: antworten mit sauberem Fehler, bis das Modul gebaut ist).

#![allow(unused_variables)]

use cypher_core::api::{
    FileHandleInfo, Project, ProjectAddAssetReq, ProjectAsset, ProjectCreateReq, ProjectDocument, ProjectFile,
    ProjectFileRef, ProjectFileReq, ProjectNewFileReq, ProjectOpenResult, ProjectReadDocumentReq, ProjectRef,
    ProjectSetCollectionReq, ProjectWriteDocumentReq, TemplateInfo,
};
use tauri::{AppHandle, Runtime, State};

use super::{R, not_built};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn templates_list(ctx: State<'_, AppCtx>) -> R<Vec<TemplateInfo>> {
    not_built("templates_list")
}

#[tauri::command]
pub async fn projects_list(ctx: State<'_, AppCtx>) -> R<Vec<Project>> {
    not_built("projects_list")
}

#[tauri::command]
pub async fn project_create<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: ProjectCreateReq,
) -> R<Project> {
    not_built("project_create")
}

#[tauri::command]
pub async fn project_new_file<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: ProjectNewFileReq,
) -> R<ProjectFile> {
    not_built("project_new_file")
}

#[tauri::command]
pub async fn project_open_file(ctx: State<'_, AppCtx>, req: ProjectFileReq) -> R<ProjectOpenResult> {
    not_built("project_open_file")
}

#[tauri::command]
pub async fn project_open_last(ctx: State<'_, AppCtx>, req: ProjectRef) -> R<ProjectOpenResult> {
    not_built("project_open_last")
}

#[tauri::command]
pub async fn project_file_handle(ctx: State<'_, AppCtx>, req: ProjectFileReq) -> R<FileHandleInfo> {
    not_built("project_file_handle")
}

#[tauri::command]
pub async fn project_set_collection<Rt: Runtime>(
    app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: ProjectSetCollectionReq,
) -> R<Project> {
    not_built("project_set_collection")
}

#[tauri::command]
pub async fn project_forget<Rt: Runtime>(app: AppHandle<Rt>, ctx: State<'_, AppCtx>, req: ProjectRef) -> R<()> {
    not_built("project_forget")
}

#[tauri::command]
pub async fn project_read_document(ctx: State<'_, AppCtx>, req: ProjectReadDocumentReq) -> R<Option<ProjectDocument>> {
    not_built("project_read_document")
}

#[tauri::command]
pub async fn project_write_document(ctx: State<'_, AppCtx>, req: ProjectWriteDocumentReq) -> R<ProjectFileRef> {
    not_built("project_write_document")
}

#[tauri::command]
pub async fn project_add_asset(ctx: State<'_, AppCtx>, req: ProjectAddAssetReq) -> R<ProjectAsset> {
    not_built("project_add_asset")
}
