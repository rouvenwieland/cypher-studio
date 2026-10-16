//! Cypher Studio – Rust-Kern ohne Tauri-Abhängigkeit.
//!
//! Die Tauri-Schicht (`apps/desktop/src-tauri`) und die Kommandozeile (`cypher-cli`) rufen nur die
//! öffentliche API dieses Crates auf. Alle IPC-Typen stehen in [`api`].

pub mod api;
