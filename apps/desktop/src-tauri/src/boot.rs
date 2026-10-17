//! Start der App: Ordner, Protokoll, Kern, Hintergrundarbeit (ARCHITEKTUR.md 2.17 `setup`-Hook).

use std::error::Error;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use cypher_core::api::BuildChannel;
use cypher_core::app::{App, AppConfig};
use cypher_core::platform::AppDirs;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tracing_appender::non_blocking::WorkerGuard;

use crate::ctx::AppCtx;
use crate::{events, logging, updater};

/// Release-Kanal: im Entwicklungsbuild `dev`, sonst `stable`; die Pipeline kann `CYPHER_BUILD_CHANNEL=beta` setzen.
fn build_channel() -> BuildChannel {
    match option_env!("CYPHER_BUILD_CHANNEL") {
        Some("beta") => BuildChannel::Beta,
        Some("stable") => BuildChannel::Stable,
        Some("dev") => BuildChannel::Dev,
        _ if cfg!(debug_assertions) => BuildChannel::Dev,
        _ => BuildChannel::Stable,
    }
}

/// Wurzel der mitgelieferten Pakete. Im Entwicklungsbuild fällt sie auf `packs/dist` im Repository zurück, falls das
/// Werkzeug die Ressourcen noch nicht in den Zielordner kopiert hat.
fn packs_root(bundled: PathBuf) -> PathBuf {
    if bundled.join("manifest.json").is_file() || !cfg!(debug_assertions) {
        return bundled;
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../packs/dist");
    if dev.join("manifest.json").is_file() { dev } else { bundled }
}

/// Läuft die App als Testlauf im eigenen Datenordner? Nur im Debug-Build und nur mit `CYPHER_STUDIO_DATA_DIR`.
pub fn isolated_test_run() -> bool {
    cfg!(debug_assertions) && std::env::var_os("CYPHER_STUDIO_DATA_DIR").is_some_and(|v| !v.is_empty())
}

fn build_core<R: Runtime>(app: &AppHandle<R>) -> Result<(Arc<App>, Option<WorkerGuard>), Box<dyn Error>> {
    let resources = app.path().resource_dir().unwrap_or_default();
    let dirs = AppDirs::discover(resources)?;
    std::fs::create_dir_all(&dirs.logs)?;
    let guard = logging::init(&dirs.logs);
    let version = app.package_info().version.to_string();
    tracing::info!("Cypher Studio {version} startet");
    let mut config = AppConfig::system(dirs, &version, build_channel())?;
    config.packs_root = packs_root(config.packs_root);
    #[cfg(feature = "dev-tools")]
    crate::dev::apply(&mut config)?;
    let core = App::new(config, events::event_sink(app.clone()))?;
    Ok((core, guard))
}

/// Meldet einen Fehler beim Start, den die Nutzerin sehen muss (unter Windows gibt es keine Konsole). Nach dem Bestätigen
/// beendet sich die App.
fn show_fatal<R: Runtime>(app: &AppHandle<R>, error: &dyn Error) {
    tracing::error!("Start fehlgeschlagen: {error}");
    let text = format!("Cypher Studio konnte nicht starten.\n\n{error}");
    let handle = app.clone();
    app.dialog().message(text).title("Cypher Studio").kind(MessageDialogKind::Error).show(move |_| handle.exit(1));
}

/// `setup`-Hook: baut den Kern, stellt ihn den Commands bereit und startet Erkennung, Katalogaktualisierung und
/// Update-Prüfung im Hintergrund.
pub fn setup<R: Runtime>(app: &mut tauri::App<R>) -> Result<(), Box<dyn Error>> {
    let handle = app.handle().clone();
    match build_core(&handle) {
        Ok((core, guard)) => {
            app.manage(AppCtx::new(core.clone()));
            if let Some(guard) = guard {
                app.manage(guard);
            }
            tauri::async_runtime::spawn(async move {
                if let Err(e) = core.startup().await {
                    tracing::error!("Start im Hintergrund: {e}");
                }
                core.refresh_catalog_if_enabled().await;
            });
            updater::spawn_background_check(handle);
        }
        Err(e) => show_fatal(&handle, e.as_ref()),
    }
    Ok(())
}
