//! `cypher` – Kommandozeile für CI, Linux-Probe und Katalogpflege (ARCHITEKTUR.md 1.1, 8.4).
//!
//! Die CLI ruft nur die öffentliche API von `cypher-core` auf; sie enthält keine Fachlogik.

mod catalog_cmd;

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

pub type CliResult<T = ()> = Result<T, CliError>;

#[derive(Parser)]
#[command(name = "cypher", version, about = "Cypher Studio Kommandozeile (CI, Linux-Probe, Katalogpflege)")]
struct Cli {
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
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    let result = match cli.command {
        Command::Catalog { command } => catalog_cmd::run(command).await,
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("Fehler: {e}");
            ExitCode::FAILURE
        }
    }
}
