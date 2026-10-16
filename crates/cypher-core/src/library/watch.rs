//! Ordnerüberwachung (`notify`), entprellt: gemeldet wird erst, wenn eine Sekunde Ruhe herrscht.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

use crate::error::LibraryError;

/// Ruhezeit, nach der eine Änderungsserie gemeldet wird.
pub const DEBOUNCE: Duration = Duration::from_secs(1);

/// Hält die Überwachung am Leben; beim Löschen endet sie.
pub struct WatchHandle {
    _watcher: RecommendedWatcher,
    stop: Arc<AtomicBool>,
}

impl Drop for WatchHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// Soll eine Änderung an `path` gemeldet werden? Nicht: Zwischendateien, versteckte Ordner außer `.cypher/meta`.
fn relevant(root: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(root) else { return false };
    let mut comps = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned());
    let first = comps.next().unwrap_or_default();
    if first == ".cypher" {
        // Begleitdateien anderer Personen sind relevant, der Papierkorb und Zwischendateien nicht
        return comps.next().as_deref() == Some("meta");
    }
    if first.starts_with('.') {
        return false;
    }
    let name = rel.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    !super::model::is_ignored_file(&name) || name == "projekt.json"
}

/// Startet die Überwachung von `root`. `on_change(anzahl)` läuft in einem eigenen Thread.
pub fn watch(root: PathBuf, on_change: impl Fn(usize) + Send + 'static) -> Result<WatchHandle, LibraryError> {
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })
    .map_err(|e| LibraryError::InvalidInput {
        field: "root".into(),
        reason: format!("Überwachung nicht möglich: {e}"),
    })?;
    watcher.watch(&root, RecursiveMode::Recursive).map_err(|e| LibraryError::InvalidInput {
        field: "root".into(),
        reason: format!("Überwachung nicht möglich: {e}"),
    })?;
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = Arc::clone(&stop);
    std::thread::spawn(move || {
        let mut pending = 0usize;
        loop {
            if stop_thread.load(Ordering::SeqCst) {
                break;
            }
            match rx.recv_timeout(DEBOUNCE) {
                Ok(Ok(event)) => {
                    if !matches!(event.kind, notify::EventKind::Access(_)) {
                        pending += event.paths.iter().filter(|p| relevant(&root, p)).count();
                    }
                }
                Ok(Err(_)) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if pending > 0 {
                        on_change(pending);
                        pending = 0;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });
    Ok(WatchHandle { _watcher: watcher, stop })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relevance_rules() {
        let root = Path::new("/lib");
        assert!(relevant(root, Path::new("/lib/Motive/a.png")));
        assert!(relevant(root, Path::new("/lib/Projekte/P/projekt.json")));
        assert!(relevant(root, Path::new("/lib/.cypher/meta/Motive/a.png.json")));
        assert!(!relevant(root, Path::new("/lib/.cypher/trash/x")));
        assert!(!relevant(root, Path::new("/lib/.cypher/tmp/x")));
        assert!(!relevant(root, Path::new("/lib/.stfolder/x")));
        assert!(!relevant(root, Path::new("/lib/Motive/.DS_Store")));
        assert!(!relevant(root, Path::new("/lib/Motive/a.png.tmp")));
        assert!(!relevant(root, Path::new("/anderswo/a.png")));
    }

    #[test]
    fn changes_are_reported_after_a_quiet_second() {
        let tmp = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel::<usize>();
        let handle = watch(tmp.path().to_path_buf(), move |n| {
            let _ = tx.send(n);
        });
        let Ok(handle) = handle else {
            // keine Überwachung in dieser Umgebung (z. B. zu wenig inotify-Watches): Test nicht aussagekräftig
            return;
        };
        std::thread::sleep(Duration::from_millis(300));
        for i in 0..5 {
            std::fs::write(tmp.path().join(format!("datei{i}.png")), b"x").unwrap();
        }
        let n = rx.recv_timeout(Duration::from_secs(10)).expect("Meldung nach Ruhe");
        assert!(n >= 5, "{n}");
        // danach ist Ruhe
        assert!(rx.recv_timeout(Duration::from_millis(1500)).is_err());
        drop(handle);
    }
}
