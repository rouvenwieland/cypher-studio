//! `setup` – Cypher-Einrichtung: Pakete (Paletten, Vorlagen, Schriften, Erweiterungen) in die Profile der Programme
//! einrichten, nie still überschreiben, alles sichern und zurücknehmen können (ARCHITEKTUR.md 2.10, 4.4, 5.2).
//!
//! Aufbau:
//! - [`pack`]: `pack.json` laden und prüfen
//! - [`roots`]: Zielwurzeln je Programm, Betriebssystem und Installationsart (Code, nicht Paketdaten)
//! - [`plan`]: berechnet, was an welcher Datei geschähe (anlegen, aktualisieren, überspringen, Konflikt)
//! - [`apply`]: führt einen Plan aus, nimmt zurück, räumt nach Abbrüchen auf, liefert Verlauf und Zustand
//! - [`store`]: Manifeste, Sicherungen, Journale unter `<data>/setup`
//! - [`fonts`]: Schriften beim Betriebssystem anmelden

pub mod apply;
pub mod fonts;
pub mod pack;
pub mod plan;
pub mod roots;
pub mod store;

use std::path::Path;

use tokio_util::sync::CancellationToken;

use crate::error::{SetupError, VerifyError};
use crate::verify::{sha256_bytes, sha256_file, to_hex};

pub use apply::{ApplyEnv, ApplySelection, history, record_of, recover, summary, undo, undo_with_runner};
pub use pack::{LoadedPacks, PackManifest, load_packs};
pub use plan::{PlanInput, SetupPlanData, plan};
pub use roots::{ResolvedScope, RootId, RootsEnv, SetupInstall, resolve_scopes};
pub use store::SetupStore;

/// SHA-256 einer Datei als Hex.
pub(crate) fn hash_file(path: &Path) -> Result<String, SetupError> {
    match sha256_file(path, &CancellationToken::new()) {
        Ok(d) => Ok(to_hex(&d)),
        Err(VerifyError::Io(io)) => Err(SetupError::Io(io)),
        Err(other) => Err(SetupError::Process(other.to_string())),
    }
}

pub(crate) fn hash_bytes(bytes: &[u8]) -> String {
    to_hex(&sha256_bytes(bytes))
}
