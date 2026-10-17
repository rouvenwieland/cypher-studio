//! Brücke zwischen dem Kern und dem Frontend: globale Ereignisse und Fortschrittskanäle.

use std::sync::Arc;

use cypher_core::app::{AppEvent, EventSink};
use cypher_core::progress::ProgressSink;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Runtime};

/// Sendet ein Ereignis des Kerns an alle Fenster. Namen und Nutzlasten stammen aus dem Kern (`EVENT_NAMES` im Vertrag).
pub fn emit_app_event<R: Runtime>(app: &AppHandle<R>, event: &AppEvent) {
    if let Err(e) = app.emit(event.name(), event.payload()) {
        tracing::warn!("Ereignis {} nicht gesendet: {e}", event.name());
    }
}

/// Der Empfänger, den der Kern für seine Ereignisse bekommt.
pub fn event_sink<R: Runtime>(app: AppHandle<R>) -> EventSink {
    Arc::new(move |event| emit_app_event(&app, &event))
}

/// Ein Fortschrittskanal (`Channel<E>`) als `ProgressSink`. Sendefehler (Fenster weg) werden nur protokolliert.
pub struct ChannelSink<E: Serialize + Send + Sync + 'static>(Channel<E>);

impl<E: Serialize + Send + Sync + 'static> ProgressSink<E> for ChannelSink<E> {
    fn emit(&self, event: E) {
        if let Err(e) = self.0.send(event) {
            tracing::debug!("Fortschritt nicht gesendet: {e}");
        }
    }
}

/// Kanal als geteilter Empfänger (für Abläufe, die den Empfänger in Hintergrundaufgaben weitergeben).
pub fn shared<E: Serialize + Send + Sync + 'static>(channel: Channel<E>) -> Arc<dyn ProgressSink<E>> {
    Arc::new(ChannelSink(channel))
}

/// Kanal als einfacher Empfänger (für Abläufe, die nur eine Referenz brauchen).
pub fn borrowed<E: Serialize + Send + Sync + 'static>(channel: Channel<E>) -> ChannelSink<E> {
    ChannelSink(channel)
}
