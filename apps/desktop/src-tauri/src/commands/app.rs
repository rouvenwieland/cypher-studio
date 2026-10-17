//! Commands: app (Info, Öffnen, Zeigen, Beenden, Diagnose).

use cypher_core::api::{AppCloseReq, AppError, AppInfo, BusyReason, FileHandleInfo, OpenExternalReq, RevealReq};
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_opener::OpenerExt;

use super::{R, blocking};
use crate::ctx::AppCtx;
use crate::dialogs;

#[tauri::command]
pub async fn app_info(ctx: State<'_, AppCtx>) -> R<AppInfo> {
    Ok(ctx.app.app_info())
}

/// Öffnet eine Adresse aus dem Katalog oder der festen Liste der App im Standardbrowser.
#[tauri::command]
pub async fn app_open_external<Rt: Runtime>(app: AppHandle<Rt>, ctx: State<'_, AppCtx>, req: OpenExternalReq) -> R<()> {
    let url = ctx.app.external_url(&req.target)?;
    app.opener().open_url(url, None::<&str>).map_err(|e| AppError::internal(format!("Adresse nicht geöffnet: {e}")))
}

/// Zeigt eine Datei im Dateimanager, einen Ordner öffnet sie direkt.
#[tauri::command]
pub async fn app_reveal<Rt: Runtime>(app: AppHandle<Rt>, ctx: State<'_, AppCtx>, req: RevealReq) -> R<()> {
    let path = ctx.app.reveal_path(&req.target).await?;
    let result = if path.is_dir() {
        app.opener().open_path(path.to_string_lossy(), None::<&str>)
    } else {
        app.opener().reveal_item_in_dir(&path)
    };
    result.map_err(|e| AppError::internal(format!("Im Dateimanager nicht gezeigt: {e}")))
}

/// Beendet die App. Ohne `force` nur, wenn nichts mehr läuft; mit `force` werden Aufträge abgebrochen (sie räumen auf).
#[tauri::command]
pub async fn app_close<Rt: Runtime>(app: AppHandle<Rt>, ctx: State<'_, AppCtx>, req: AppCloseReq) -> R<()> {
    let active = ctx.app.close_requested().active_jobs;
    if !req.force {
        if let Some(job) = active.first() {
            return Err(AppError::Busy { reason: BusyReason::JobRunning, job_id: Some(job.id.clone()) });
        }
    } else if ctx.app.prepare_close() > 0 {
        // Abgebrochene Aufträge rollen zurück; dafür bis zu zehn Sekunden Zeit
        for _ in 0..100 {
            if ctx.app.jobs_active().is_empty() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }
    app.exit(0);
    Ok(())
}

/// Schreibt die Diagnose-ZIP dorthin, wo die Nutzerin sie speichern will.
#[tauri::command]
pub async fn diagnostics_export<Rt: Runtime>(app: AppHandle<Rt>, ctx: State<'_, AppCtx>) -> R<Option<FileHandleInfo>> {
    let Some(dest) =
        dialogs::save_file(&app, "Diagnose speichern", "cypher-studio-diagnose.zip", Some(("ZIP-Datei", &["zip"])))
            .await?
    else {
        return Ok(None);
    };
    Ok(Some(blocking(&ctx, move |core| core.diagnostics_export(&dest)).await?))
}
