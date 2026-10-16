//! Cypher Studio – Rust-Kern ohne Tauri-Abhängigkeit.
//!
//! Die Tauri-Schicht (`apps/desktop/src-tauri`) und die Kommandozeile (`cypher-cli`) rufen nur die
//! öffentliche API dieses Crates auf. Alle IPC-Typen stehen in [`api`].

pub mod api;
pub mod catalog;
pub mod detect;
pub mod download;
pub mod error;
pub mod install;
pub mod jobs;
pub mod launch;
pub mod plans;
pub mod platform;
pub mod printcheck;
pub mod process;
pub mod progress;
pub mod settings;
pub mod setup;
pub mod state;
pub mod util;
pub mod verify;
