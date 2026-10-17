//! Gemeinsamer Aufbau des Kerns für die Befehle `detect`, `install`, `printcheck` und `setup`.
//!
//! Mit `--data-dir` liegt alles unter diesem Ordner (Daten, Einstellungen, Zwischenspeicher und ein eigener
//! „Heimatordner“): die Befehle berühren dann nichts außerhalb, auch nicht beim Einrichten von Programmprofilen.

use std::path::PathBuf;
use std::sync::Arc;

use clap::Args;
use cypher_core::api::BuildChannel;
use cypher_core::app::{App, AppConfig};
use cypher_core::detect::DetectEnv;
use cypher_core::platform::{AppDirs, KnownDirs};
use cypher_core::setup::RootsEnv;

use crate::{CliError, CliResult};

/// Wahlschalter, die für alle Befehle gelten.
#[derive(Args, Debug, Clone, Default)]
pub struct Global {
    /// Alle Daten unter diesem Ordner anlegen (Probe, Tests); ohne die Angabe gelten die Ordner des Nutzers
    #[arg(long, global = true)]
    pub data_dir: Option<PathBuf>,
    /// Wurzel der Einrichtungspakete (`packs/dist`); Vorgabe: `./packs/dist`, falls vorhanden
    #[arg(long, global = true)]
    pub packs: Option<PathBuf>,
    /// Zusätzlicher öffentlicher Katalogschlüssel (.pub); nur Entwicklung und Probe
    #[cfg(feature = "dev-tools")]
    #[arg(long = "trust-key", global = true)]
    pub trust_keys: Vec<PathBuf>,
    /// Erlaubt http gegen 127.0.0.1 (lokaler Test-Server); nur Entwicklung und Probe
    #[cfg(feature = "dev-tools")]
    #[arg(long, global = true)]
    pub allow_loopback_http: bool,
}

fn default_packs() -> Option<PathBuf> {
    let local = PathBuf::from("packs/dist");
    local.join("manifest.json").is_file().then_some(local)
}

/// Baut den Kern mit den echten Systemteilen (Erkennung, Prozesse, Schriften), auf Wunsch in einem eigenen Ordner.
pub fn build(global: &Global) -> CliResult<Arc<App>> {
    let packs = global.packs.clone().or_else(default_packs);
    let resources = packs.as_deref().and_then(|p| p.parent()).map(PathBuf::from).unwrap_or_default();
    let dirs = match &global.data_dir {
        Some(root) => AppDirs::with_root(root, resources),
        None => AppDirs::discover(resources).map_err(|e| CliError(e.to_string()))?,
    };
    let isolated_home = global.data_dir.is_some().then(|| dirs.home.clone());
    let mut config = AppConfig::system(dirs, env!("CARGO_PKG_VERSION"), BuildChannel::Dev)?;
    if let Some(packs) = packs {
        config.packs_root = packs;
    }
    if let Some(home) = isolated_home {
        // Im eigenen Ordner sieht die Erkennung nur, was dort installiert wurde, und Profile landen unter `home`
        let known = KnownDirs { home: Some(home), ..KnownDirs::default() };
        let mut detect = DetectEnv::real();
        detect.known = known.clone();
        detect.path_dirs.clear();
        config.detect_env = Arc::new(detect);
        config.roots_env = RootsEnv { known, ..config.roots_env };
    }
    #[cfg(feature = "dev-tools")]
    apply_dev_options(&mut config, global)?;
    App::new(config, Arc::new(|_| {})).map_err(CliError::from)
}

#[cfg(feature = "dev-tools")]
fn apply_dev_options(config: &mut AppConfig, global: &Global) -> CliResult {
    use cypher_core::catalog::EMBEDDED_KEYS;
    use cypher_core::download::{EMBEDDED_HOSTS, HostPolicy, HostRule, RedirectPolicy};
    use cypher_core::verify::TrustedKeys;

    if !global.trust_keys.is_empty() {
        let extra: Vec<String> = global
            .trust_keys
            .iter()
            .map(|p| std::fs::read_to_string(p).map_err(|e| CliError(format!("{}: {e}", p.display()))))
            .collect::<Result<_, _>>()?;
        let mut all: Vec<&str> = EMBEDDED_KEYS.to_vec();
        all.extend(extra.iter().map(String::as_str));
        config.keys = TrustedKeys::from_strs(&all).map_err(|e| CliError(e.to_string()))?;
    }
    if global.allow_loopback_http {
        let mut rules: Vec<HostRule> = EMBEDDED_HOSTS.to_vec();
        rules.push(HostRule { host: "127.0.0.1", redirects: RedirectPolicy::WithinAllowlist });
        config.hosts = Arc::new(HostPolicy::for_test(&rules));
    }
    Ok(())
}
