//! Schließen-Wächter: Läuft ein Auftrag, wird das Schließen angehalten und das Frontend gefragt (`app:closeRequested`).
//! Die Antwort kommt als `app_close { force }`.

use cypher_core::app::AppEvent;
use tauri::{Manager, Runtime, Window, WindowEvent};

use crate::ctx::AppCtx;
use crate::events::emit_app_event;

pub fn on_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else { return };
    if window.label() != "main" {
        return;
    }
    let Some(ctx) = window.try_state::<AppCtx>() else { return };
    if ctx.app.is_closing() {
        return;
    }
    let pending = ctx.app.close_requested();
    if pending.active_jobs.is_empty() {
        return;
    }
    api.prevent_close();
    emit_app_event(window.app_handle(), &AppEvent::CloseRequested(pending));
}
