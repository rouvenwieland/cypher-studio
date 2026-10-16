//! `install` – Plan, Entpacken, atomare Registrierung (ARCHITEKTUR.md 2.7, 5.1).
//!
//! Ablauf: `plan` (ohne Netzwerk) → Zustimmung → `execute`: Download (fortsetzbar) → Prüfsumme/Signatur → Entpacken
//! nach `<programs>/.staging/<job>` → Inhaltsprüfung → atomar umbenennen → Zustand schreiben.

pub mod appimage;
pub mod archive;
mod content;
pub mod dmg;
pub mod exe;
mod exec;
mod plan;
mod registry;

pub use content::check_content;
pub use exec::{InstallCtx, STAGING_DIR, execute, execute_silently, file_sha256_hex};
pub use plan::{InstallPlanData, LARGE_DOWNLOAD_BYTES, PlanInput, cache_extension, plan, target_dir_for};
pub use registry::{RecoveryReport, installation_dto, launch_path, recover_on_startup, remove_managed, running_in};
