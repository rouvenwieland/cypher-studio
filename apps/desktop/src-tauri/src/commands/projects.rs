//! Commands: projects (Vorlagen, Projekte, Dateien, Dokumente der Module).

use cypher_core::api::{
    FileHandleInfo, Project, ProjectAddAssetReq, ProjectAsset, ProjectCreateReq, ProjectDocument, ProjectFile,
    ProjectFileRef, ProjectFileReq, ProjectNewFileReq, ProjectOpenResult, ProjectReadDocumentReq, ProjectRef,
    ProjectSetCollectionReq, ProjectWriteDocumentReq, TemplateInfo,
};
use tauri::{AppHandle, Runtime, State};

use super::{R, blocking};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn templates_list(ctx: State<'_, AppCtx>) -> R<Vec<TemplateInfo>> {
    blocking(&ctx, |core| Ok(core.templates_list())).await
}

#[tauri::command]
pub async fn projects_list(ctx: State<'_, AppCtx>) -> R<Vec<Project>> {
    blocking(&ctx, |core| Ok(core.projects_list())).await
}

#[tauri::command]
pub async fn project_create<Rt: Runtime>(
    _app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: ProjectCreateReq,
) -> R<Project> {
    blocking(&ctx, move |core| core.project_create(&req)).await
}

#[tauri::command]
pub async fn project_new_file<Rt: Runtime>(
    _app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: ProjectNewFileReq,
) -> R<ProjectFile> {
    blocking(&ctx, move |core| core.project_new_file(&req)).await
}

#[tauri::command]
pub async fn project_open_file(ctx: State<'_, AppCtx>, req: ProjectFileReq) -> R<ProjectOpenResult> {
    blocking(&ctx, move |core| core.project_open_file(&req)).await
}

#[tauri::command]
pub async fn project_open_last(ctx: State<'_, AppCtx>, req: ProjectRef) -> R<ProjectOpenResult> {
    blocking(&ctx, move |core| core.project_open_last(&req)).await
}

#[tauri::command]
pub async fn project_file_handle(ctx: State<'_, AppCtx>, req: ProjectFileReq) -> R<FileHandleInfo> {
    blocking(&ctx, move |core| core.project_file_handle(&req)).await
}

#[tauri::command]
pub async fn project_set_collection<Rt: Runtime>(
    _app: AppHandle<Rt>,
    ctx: State<'_, AppCtx>,
    req: ProjectSetCollectionReq,
) -> R<Project> {
    blocking(&ctx, move |core| core.project_set_collection(&req)).await
}

/// Nimmt ein Projekt nur aus der Liste; die Dateien bleiben.
#[tauri::command]
pub async fn project_forget<Rt: Runtime>(_app: AppHandle<Rt>, ctx: State<'_, AppCtx>, req: ProjectRef) -> R<()> {
    blocking(&ctx, move |core| core.project_forget(&req)).await
}

#[tauri::command]
pub async fn project_read_document(ctx: State<'_, AppCtx>, req: ProjectReadDocumentReq) -> R<Option<ProjectDocument>> {
    blocking(&ctx, move |core| core.project_read_document(&req)).await
}

#[tauri::command]
pub async fn project_write_document(ctx: State<'_, AppCtx>, req: ProjectWriteDocumentReq) -> R<ProjectFileRef> {
    blocking(&ctx, move |core| core.project_write_document(&req)).await
}

#[tauri::command]
pub async fn project_add_asset(ctx: State<'_, AppCtx>, req: ProjectAddAssetReq) -> R<ProjectAsset> {
    blocking(&ctx, move |core| core.project_add_asset(&req)).await
}
