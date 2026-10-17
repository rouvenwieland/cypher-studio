//! Cypher Studio – Rust-Kern ohne Tauri-Abhängigkeit.
//!
//! Die Tauri-Schicht (`apps/desktop/src-tauri`) und die Kommandozeile (`cypher-cli`) rufen nur die
//! öffentliche API dieses Crates auf. Alle IPC-Typen stehen in [`api`].

// Das Feature `test-util` erlaubt `http` gegen 127.0.0.1 und einen anderen Datenordner (`CYPHER_STUDIO_DATA_DIR`). Es gehört
// nie in ein Release: ein `cargo build --release --workspace` würde es über `cypher-cli` in die App ziehen (Befund N16).
#[cfg(all(feature = "test-util", not(debug_assertions), not(test)))]
compile_error!("Das Feature `test-util` gehört nur in Debug- und Testbuilds, nie in ein Release.");

pub mod api;
pub mod app;
pub mod bgremove;
pub mod brand;
pub mod catalog;
pub mod detect;
pub mod download;
pub mod error;
pub mod install;
pub mod jobs;
pub mod launch;
pub mod library;
pub mod plans;
pub mod platform;
pub mod printcheck;
pub mod process;
pub mod progress;
pub mod projects;
pub mod settings;
pub mod setup;
pub mod sites;
pub mod state;
pub mod urls;
pub mod util;
pub mod verify;
