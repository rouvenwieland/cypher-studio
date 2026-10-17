//! `cypher` – Kommandozeile für CI, Linux-Probe und Katalogpflege (ARCHITEKTUR.md 1.1, 8.4).
//!
//! Die CLI ruft nur die öffentliche API von `cypher-core` auf; sie enthält keine Fachlogik.

mod app_cmd;
mod catalog_cmd;
mod detect_cmd;
mod install_cmd;
mod printcheck_cmd;
mod setup_cmd;

use std::process::ExitCode;

use clap::{Parser, Subcommand};

/// Fehler der Kommandozeile: eine Meldung für den Menschen.
#[derive(Debug)]
pub struct CliError(pub String);

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for CliError {}

impl From<String> for CliError {
    fn from(s: String) -> Self {
        CliError(s)
    }
}

impl From<&str> for CliError {
    fn from(s: &str) -> Self {
        CliError(s.to_owned())
    }
}

impl From<std::io::Error> for CliError {
    fn from(e: std::io::Error) -> Self {
        CliError(e.to_string())
    }
}

impl From<cypher_core::api::AppError> for CliError {
    fn from(e: cypher_core::api::AppError) -> Self {
        CliError(format!("{} ({e})", e.kind_name()))
    }
}

impl From<cypher_core::error::CoreError> for CliError {
    fn from(e: cypher_core::error::CoreError) -> Self {
        CliError::from(cypher_core::api::AppError::from(e))
    }
}

pub type CliResult<T = ()> = Result<T, CliError>;

#[derive(Parser)]
#[command(name = "cypher", version, about = "Cypher Studio Kommandozeile (CI, Linux-Probe, Katalogpflege)")]
struct Cli {
    #[command(flatten)]
    global: app_cmd::Global,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Katalog prüfen, signieren, pflegen
    Catalog {
        #[command(subcommand)]
        command: catalog_cmd::CatalogCommand,
    },
    /// Programme und gefundene Installationen zeigen (nur lesend)
    Detect(detect_cmd::DetectArgs),
    /// Ein Programm aus dem Katalog installieren (Plan, Prüfsumme, Entpacken); ohne --yes nur der Plan
    Install(install_cmd::InstallArgs),
    /// Ein Motiv gegen ein Druckprofil prüfen und auf Wunsch druckfertig exportieren
    Printcheck(printcheck_cmd::PrintcheckArgs),
    /// Einrichtungspakete anwenden und zurücknehmen
    Setup {
        #[command(subcommand)]
        command: setup_cmd::SetupCommand,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    tracing_subscriber::fmt().with_writer(std::io::stderr).with_ansi(false).with_max_level(tracing::Level::WARN).init();
    let global = cli.global;
    let result = match cli.command {
        Command::Catalog { command } => catalog_cmd::run(command).await,
        Command::Detect(args) => detect_cmd::run(&global, args).await,
        Command::Install(args) => install_cmd::run(&global, args).await,
        Command::Printcheck(args) => printcheck_cmd::run(&global, args).await,
        Command::Setup { command } => setup_cmd::run(&global, command).await,
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("Fehler: {e}");
            ExitCode::FAILURE
        }
    }
}
