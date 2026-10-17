//! Geteilter Zustand der App (`tauri::State`).

use std::sync::{Arc, Mutex};

use cypher_core::app::App;

/// Alles, was Commands brauchen. Wird beim Start einmal erzeugt und per `manage` bereitgestellt.
pub struct AppCtx {
    /// Die Anwendungsschicht: alle Abläufe stehen in `cypher-core`.
    pub app: Arc<App>,
    /// Das zuletzt gefundene App-Update, das `app_update_install` einspielt.
    pub pending_update: Mutex<Option<tauri_plugin_updater::Update>>,
}

impl AppCtx {
    pub fn new(app: Arc<App>) -> Self {
        AppCtx { app, pending_update: Mutex::new(None) }
    }
}
