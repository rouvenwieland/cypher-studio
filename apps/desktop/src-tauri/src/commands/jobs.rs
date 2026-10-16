//! Commands: jobs (Phase 0: antworten mit sauberem Fehler, bis das Modul gebaut ist).

#![allow(unused_variables)]

use cypher_core::api::{JobCancelReq, JobInfo, JobRecord};
use tauri::State;

use super::{R, not_built};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn jobs_active(ctx: State<'_, AppCtx>) -> R<Vec<JobInfo>> {
    not_built("jobs_active")
}

#[tauri::command]
pub async fn jobs_recent(ctx: State<'_, AppCtx>) -> R<Vec<JobRecord>> {
    not_built("jobs_recent")
}

#[tauri::command]
pub async fn job_cancel(ctx: State<'_, AppCtx>, req: JobCancelReq) -> R<bool> {
    not_built("job_cancel")
}
