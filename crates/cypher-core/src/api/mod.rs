//! DTOs des IPC-Vertrags (`docs/ipc-contract.ts`, Version 0.3.0).
//!
//! Alle Typen sind Serde-camelCase und werden von ts-rs nach `apps/desktop/src/ipc/generated/` exportiert.
//! Der Vertrag ist kanonisch: Abweichungen findet der Test `contract::contract_matches_generated_types`.

#[macro_use]
mod macros;

mod app;
mod brand;
mod common;
mod error;
mod files;
mod jobs;
mod library;
pub mod names;
mod print;
mod programs;
mod projects;
mod setup;

pub use app::*;
pub use brand::*;
pub use common::*;
pub use error::*;
pub use files::*;
pub use jobs::*;
pub use library::*;
pub use print::*;
pub use programs::*;
pub use projects::*;
pub use setup::*;
