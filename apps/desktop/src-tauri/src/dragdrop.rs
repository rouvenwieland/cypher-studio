//! Dateien, die auf das Fenster gezogen werden: als Handles anmelden und `files:dropped` melden (ARCHITEKTUR.md 2.17).

use cypher_core::api::Point;
use tauri::{DragDropEvent, Manager, Runtime, Window, WindowEvent};

use crate::ctx::AppCtx;

/// Verarbeitet nur das Ablegen (`Drop`); Überfliegen und Abbruch brauchen keine Reaktion in Rust.
pub fn on_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let WindowEvent::DragDrop(DragDropEvent::Drop { paths, position }) = event else { return };
    if window.label() != "main" || paths.is_empty() {
        return;
    }
    let Some(ctx) = window.try_state::<AppCtx>() else { return };
    // Das Frontend rechnet in CSS-Pixeln, das Fenster meldet physische
    let scale = window.scale_factor().unwrap_or(1.0);
    let logical = position.to_logical::<f64>(scale);
    ctx.app.register_dropped(paths, Point { x: logical.x, y: logical.y });
}
