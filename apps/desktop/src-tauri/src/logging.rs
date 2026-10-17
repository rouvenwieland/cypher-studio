//! Protokoll in Dateien (`<data>/logs`), täglich neu, sieben Tage. Kein Netz, keine Telemetrie: die Dateien verlassen den
//! Rechner nur, wenn die Nutzerin die Diagnose exportiert.

use std::path::Path;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{Builder, Rotation};

/// Richtet das Protokoll ein. Der zurückgegebene Wächter muss bis zum Ende der App leben (sonst gehen Zeilen verloren).
/// `None`, wenn der Ordner nicht beschreibbar ist: die App läuft dann ohne Protokolldatei.
pub fn init(logs_dir: &Path) -> Option<WorkerGuard> {
    let appender = Builder::new()
        .rotation(Rotation::DAILY)
        .filename_prefix("cypher-studio")
        .filename_suffix("log")
        .max_log_files(7)
        .build(logs_dir)
        .ok()?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let level = if cfg!(debug_assertions) { tracing::Level::DEBUG } else { tracing::Level::INFO };
    let subscriber = tracing_subscriber::fmt().with_writer(writer).with_ansi(false).with_max_level(level).finish();
    tracing::subscriber::set_global_default(subscriber).ok()?;
    // Abstürze landen im Protokoll statt nur auf einer Konsole, die es unter Windows nicht gibt
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        tracing::error!("Absturz: {info}");
        previous(info);
    }));
    Some(guard)
}
