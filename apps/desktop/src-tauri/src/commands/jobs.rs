//! Commands: jobs (laufende und beendete Aufträge, Abbrechen).

use cypher_core::api::{JobCancelReq, JobInfo, JobRecord};
use tauri::State;

use super::R;
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn jobs_active(ctx: State<'_, AppCtx>) -> R<Vec<JobInfo>> {
    Ok(ctx.app.jobs_active())
}

#[tauri::command]
pub async fn jobs_recent(ctx: State<'_, AppCtx>) -> R<Vec<JobRecord>> {
    Ok(ctx.app.jobs_recent())
}

#[tauri::command]
pub async fn job_cancel(ctx: State<'_, AppCtx>, req: JobCancelReq) -> R<bool> {
    Ok(ctx.app.job_cancel(&req))
}
