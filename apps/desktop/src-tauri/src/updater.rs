//! Kleber für `tauri-plugin-updater` (ARCHITEKTUR.md 5.7): Prüfen, Einspielen, automatische Prüfung nach dem Start.
//!
//! Das Plugin prüft die Minisign-Signatur des Pakets gegen den eingebauten Schlüssel (`plugins.updater.pubkey`) und
//! verlangt sie auch für die Version (`requireSignedVersion`). Fehler werden nie still verschluckt, nur die automatische
//! Prüfung beim Start bleibt leise.

use std::time::Duration;

use cypher_core::api::{
    AppError, BusyReason, JobKind, JobResult, SignatureSubject, UpdateCheck, UpdateEvent, UpdateFrequency,
    UpdatesSettings,
};
use cypher_core::app::AppEvent;
use cypher_core::progress::{ProgressSink, Throttled};
use cypher_core::util::{now_iso, parse_iso, to_iso};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_updater::UpdaterExt;

use crate::ctx::AppCtx;
use crate::events::emit_app_event;

/// Wartezeit nach dem Start, bevor die automatische Prüfung läuft.
const STARTUP_DELAY: Duration = Duration::from_secs(10);

fn map_error(error: tauri_plugin_updater::Error) -> AppError {
    use tauri_plugin_updater::Error as E;
    let reason = error.to_string();
    match error {
        E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) => {
            AppError::SignatureInvalid { subject: SignatureSubject::AppUpdate, reason }
        }
        _ => AppError::UpdateFailed { reason },
    }
}

fn lock<T>(m: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match m.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Fragt die Update-Endpunkte und merkt sich ein gefundenes Update für [`install`].
pub async fn check<R: Runtime>(app: &AppHandle<R>, ctx: &AppCtx) -> Result<UpdateCheck, AppError> {
    let updater = app.updater().map_err(map_error)?;
    let found = updater.check().await.map_err(map_error)?;
    let checked_at = now_iso();
    // Ob die Zeit gespeichert werden konnte, ändert am Ergebnis nichts
    let _ = ctx.app.settings.set_last_update_check(&checked_at);
    let current_version = ctx.app.app_version.clone();
    let result = match &found {
        Some(update) => UpdateCheck {
            available: true,
            current_version,
            version: Some(update.version.clone()),
            date: update.date.map(to_iso),
            notes: update.body.clone(),
            checked_at,
        },
        None => UpdateCheck { available: false, current_version, version: None, date: None, notes: None, checked_at },
    };
    *lock(&ctx.pending_update) = found;
    Ok(result)
}

fn is_progress(event: &UpdateEvent) -> bool {
    !matches!(event, UpdateEvent::Progress { .. })
}

/// Lädt und installiert das gemerkte Update (sonst wird neu geprüft). Windows beendet die App selbst, sonst startet sie neu.
pub async fn install<R: Runtime>(
    app: &AppHandle<R>,
    ctx: &AppCtx,
    sink: &dyn ProgressSink<UpdateEvent>,
) -> Result<(), AppError> {
    if let Some(job) = ctx.app.jobs_active().first() {
        return Err(AppError::Busy { reason: BusyReason::JobRunning, job_id: Some(job.id.clone()) });
    }
    let pending = lock(&ctx.pending_update).take();
    let update = match pending {
        Some(update) => update,
        None => {
            check(app, ctx).await?;
            lock(&ctx.pending_update)
                .take()
                .ok_or_else(|| AppError::UpdateFailed { reason: "Es gibt kein Update".into() })?
        }
    };
    let job = ctx.app.jobs.start(JobKind::AppUpdate, "Cypher Studio", "appUpdate", false).map_err(AppError::from)?;
    sink.emit(UpdateEvent::Started { job_id: job.id.clone(), content_length: None });
    let throttled = Throttled::new(sink, is_progress);
    let mut downloaded = 0u64;
    let result = update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                throttled.emit(UpdateEvent::Progress { downloaded_bytes: downloaded, content_length: total });
            },
            || throttled.emit(UpdateEvent::Installing),
        )
        .await;
    match result {
        Ok(()) => {
            job.finish_ok(JobResult::None);
            app.restart()
        }
        Err(e) => {
            let error = map_error(e);
            job.finish_err(error.clone());
            Err(error)
        }
    }
}

/// Ist nach der eingestellten Häufigkeit wieder eine Prüfung fällig?
pub fn due(settings: &UpdatesSettings, now: time::OffsetDateTime) -> bool {
    let limit = match settings.frequency {
        UpdateFrequency::Never => return false,
        UpdateFrequency::Daily => time::Duration::hours(20),
        UpdateFrequency::Weekly => time::Duration::days(6) + time::Duration::hours(12),
    };
    match settings.last_check_at.as_deref().and_then(parse_iso) {
        Some(last) => now - last >= limit,
        None => true,
    }
}

/// Prüft zehn Sekunden nach dem Start, wenn die Einstellung es verlangt. Fehler bleiben im Protokoll.
pub fn spawn_background_check<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;
        let Some(ctx) = app.try_state::<AppCtx>() else { return };
        if !due(&ctx.app.settings.get().updates, time::OffsetDateTime::now_utc()) {
            return;
        }
        match check(&app, &ctx).await {
            Ok(found) if found.available => emit_app_event(&app, &AppEvent::UpdateAvailable(found)),
            Ok(_) => {}
            Err(e) => tracing::info!("Automatische Update-Prüfung ohne Ergebnis: {e}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(frequency: UpdateFrequency, last: Option<&str>) -> UpdatesSettings {
        UpdatesSettings { frequency, last_check_at: last.map(str::to_owned) }
    }

    fn at(text: &str) -> time::OffsetDateTime {
        parse_iso(text).unwrap()
    }

    #[test]
    fn checks_are_due_by_frequency() {
        let now = at("2026-10-20T12:00:00Z");
        assert!(!due(&settings(UpdateFrequency::Never, None), now));
        assert!(due(&settings(UpdateFrequency::Daily, None), now));
        assert!(due(&settings(UpdateFrequency::Weekly, None), now));
        assert!(!due(&settings(UpdateFrequency::Daily, Some("2026-10-20T03:00:00Z")), now));
        assert!(due(&settings(UpdateFrequency::Daily, Some("2026-10-19T12:00:00Z")), now));
        assert!(!due(&settings(UpdateFrequency::Weekly, Some("2026-10-16T12:00:00Z")), now));
        assert!(due(&settings(UpdateFrequency::Weekly, Some("2026-10-10T12:00:00Z")), now));
        assert!(due(&settings(UpdateFrequency::Weekly, Some("kein Datum")), now), "unlesbar = fällig");
    }

    #[test]
    fn signature_problems_are_reported_as_such() {
        let err = map_error(tauri_plugin_updater::Error::SignatureUtf8("kaputt".into()));
        assert!(matches!(err, AppError::SignatureInvalid { subject: SignatureSubject::AppUpdate, .. }), "{err}");
        let err = map_error(tauri_plugin_updater::Error::ReleaseNotFound);
        assert!(matches!(err, AppError::UpdateFailed { .. }), "{err}");
    }
}
