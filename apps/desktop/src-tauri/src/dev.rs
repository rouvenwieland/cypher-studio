//! Hilfen nur für die E2E-Suite gegen die echte App (`npm run e2e:real` in `apps/desktop`).
//!
//! Gebaut wird dieser Code nur mit dem Cargo-Feature `dev-tools` und nur im Debug-Build; die ausgelieferten Pakete
//! enthalten ihn nicht. Alles steuert die Suite über Umgebungsvariablen des gestarteten Prozesses:
//!
//! - `CYPHER_DEV_TRUST_KEY`: Pfad einer öffentlichen minisign-Datei, die zusätzlich dem Katalog vertraut (Testschlüssel)
//! - `CYPHER_DEV_ALLOW_LOOPBACK_HTTP=1`: `http` gegen `127.0.0.1` (lokaler Test-Server mit kleinen Fixtures)
//! - `CYPHER_DEV_ISOLATE=1`: Erkennung und Einrichtung sehen nur den Testordner, nichts vom echten Rechner
//! - `CYPHER_DEV_DIALOGS=<ordner>`: native Dialoge werden nicht gezeigt; die Antwort steht in `<ordner>/next.json`
//!   (Liste von Pfaden, leer oder fehlend = abgebrochen) und wird beim Lesen gelöscht

#[cfg(all(feature = "dev-tools", not(debug_assertions)))]
compile_error!("Das Feature `dev-tools` gehört nur in Debug-Builds (E2E-Suite), nie in ein Release.");

use std::path::PathBuf;
use std::sync::Arc;

use cypher_core::app::AppConfig;
use cypher_core::catalog::EMBEDDED_KEYS;
use cypher_core::download::{EMBEDDED_HOSTS, HostPolicy, HostRule, RedirectPolicy};
use cypher_core::verify::TrustedKeys;

fn flag(name: &str) -> bool {
    std::env::var_os(name).is_some_and(|v| v == "1")
}

/// Wendet die Entwicklungsoptionen aus der Umgebung auf die Konfiguration an.
pub fn apply(config: &mut AppConfig) -> Result<(), String> {
    if let Some(path) = std::env::var_os("CYPHER_DEV_TRUST_KEY").filter(|v| !v.is_empty()) {
        let extra = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", PathBuf::from(&path).display()))?;
        let mut all: Vec<&str> = EMBEDDED_KEYS.to_vec();
        all.push(&extra);
        config.keys = TrustedKeys::from_strs(&all).map_err(|e| e.to_string())?;
        tracing::warn!("Entwicklung: zusätzlicher Katalogschlüssel aus {}", PathBuf::from(&path).display());
    }
    if flag("CYPHER_DEV_ALLOW_LOOPBACK_HTTP") {
        let mut rules: Vec<HostRule> = EMBEDDED_HOSTS.to_vec();
        rules.push(HostRule { host: "127.0.0.1", redirects: RedirectPolicy::WithinAllowlist });
        config.hosts = Arc::new(HostPolicy::for_test(&rules));
        tracing::warn!("Entwicklung: http gegen 127.0.0.1 erlaubt");
    }
    if flag("CYPHER_DEV_ISOLATE") {
        config.isolate_from_system();
        tracing::warn!("Entwicklung: Erkennung und Einrichtung vom echten Rechner getrennt");
    }
    Ok(())
}

/// Antwort auf einen Dialog aus `CYPHER_DEV_DIALOGS/next.json`. `None`, wenn die Umgebungsvariable fehlt (dann öffnet
/// sich der echte Dialog); sonst die Pfade (leer = Abbruch).
pub fn scripted_dialog() -> Option<Vec<PathBuf>> {
    let dir = PathBuf::from(std::env::var_os("CYPHER_DEV_DIALOGS").filter(|v| !v.is_empty())?);
    let file = dir.join("next.json");
    let paths: Vec<PathBuf> = std::fs::read_to_string(&file)
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
        .map(|list| list.into_iter().map(PathBuf::from).collect())
        .unwrap_or_default();
    let _ = std::fs::remove_file(&file);
    tracing::warn!("Entwicklung: Dialog beantwortet mit {} Pfad(en)", paths.len());
    Some(paths)
}
