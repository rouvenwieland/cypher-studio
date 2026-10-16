//! Geteilter Zustand der App (`tauri::State`).

/// Alles, was Commands brauchen. Wird in `lib.rs` einmal erzeugt und per `manage` bereitgestellt.
pub struct AppCtx {}

impl AppCtx {
    pub fn new() -> Self {
        AppCtx {}
    }
}

impl Default for AppCtx {
    fn default() -> Self {
        Self::new()
    }
}
