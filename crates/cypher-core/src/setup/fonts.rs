//! Schriften im Benutzerprofil anmelden (nur Benutzerebene, keine Administratorrechte).
//!
//! Die Dateien selbst kopiert die Einrichtung in den Benutzer-Schriftordner (Wurzel `userFonts`); hier geschieht nur,
//! was das Betriebssystem zusätzlich braucht:
//! - Windows: Registrywert unter `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts`, `AddFontResourceW` und eine
//!   `WM_FONTCHANGE`-Meldung, damit laufende Programme die Schrift sehen
//! - macOS: nichts (`~/Library/Fonts` wird beobachtet)
//! - Linux: `fc-cache -f <ordner>`, falls vorhanden

use std::ffi::OsString;
use std::io;
use std::path::Path;
use std::time::Duration;

use crate::process::CommandRunner;

/// Meldet Schriften beim Betriebssystem an und ab.
pub trait FontInstaller: Send + Sync {
    /// Meldet `file` (liegt bereits im Benutzer-Schriftordner) an. Gibt den Namen des Registrywerts zurück (Windows).
    fn register(&self, file: &Path, display_name: &str) -> io::Result<Option<String>>;
    /// Nimmt die Anmeldung zurück (die Datei löscht der Aufrufer).
    fn unregister(&self, file: &Path, registry_name: Option<&str>) -> io::Result<()>;
    /// Schließt einen Stapel von `register`/`unregister` ab. Teure Schritte (Schriftcache, Meldung an alle Fenster)
    /// laufen hier einmal statt für jede Datei.
    fn flush(&self) {}
}

/// Tut nichts außer Erfolg zu melden (macOS, Tests ohne Betriebssystemzugriff).
pub struct NoFontRegistration;

impl FontInstaller for NoFontRegistration {
    fn register(&self, _file: &Path, _display_name: &str) -> io::Result<Option<String>> {
        Ok(None)
    }

    fn unregister(&self, _file: &Path, _registry_name: Option<&str>) -> io::Result<()> {
        Ok(())
    }
}

/// Linux: Schriftcache des Ordners aktualisieren.
pub struct FcCacheFonts {
    pub runner: std::sync::Arc<dyn CommandRunner>,
    /// Pfad zu `fc-cache`, falls vorhanden.
    pub fc_cache: Option<std::path::PathBuf>,
    /// Ordner, deren Cache beim nächsten [`flush`](FontInstaller::flush) aufgefrischt wird.
    pub pending: std::sync::Mutex<std::collections::BTreeSet<std::path::PathBuf>>,
}

impl FcCacheFonts {
    pub fn new(runner: std::sync::Arc<dyn CommandRunner>, fc_cache: Option<std::path::PathBuf>) -> Self {
        FcCacheFonts { runner, fc_cache, pending: Default::default() }
    }

    fn note(&self, file: &Path) {
        if let (Some(dir), Ok(mut pending)) = (file.parent(), self.pending.lock()) {
            pending.insert(dir.to_path_buf());
        }
    }
}

impl FontInstaller for FcCacheFonts {
    fn register(&self, file: &Path, _display_name: &str) -> io::Result<Option<String>> {
        self.note(file);
        Ok(None)
    }

    fn unregister(&self, file: &Path, _registry_name: Option<&str>) -> io::Result<()> {
        // Die Datei ist beim Aufruf schon (oder gleich) weg; der Cache wird danach aufgefrischt
        self.note(file);
        Ok(())
    }

    fn flush(&self) {
        let dirs = self.pending.lock().map(|mut p| std::mem::take(&mut *p)).unwrap_or_default();
        let Some(tool) = &self.fc_cache else { return };
        for dir in dirs {
            let args: Vec<OsString> = vec!["-f".into(), dir.into_os_string()];
            // Ein fehlgeschlagener Cache-Lauf ist kein Fehler der Einrichtung: Programme finden die Schrift beim nächsten Start
            let _ = self.runner.run(tool, &args, Duration::from_secs(60));
        }
    }
}

/// Die Anmeldung für das laufende Betriebssystem.
pub fn system_installer(runner: std::sync::Arc<dyn CommandRunner>) -> std::sync::Arc<dyn FontInstaller> {
    #[cfg(windows)]
    {
        let _ = runner;
        std::sync::Arc::new(win::WindowsFonts::default())
    }
    #[cfg(target_os = "macos")]
    {
        let _ = runner;
        std::sync::Arc::new(NoFontRegistration)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let fc_cache = which::which("fc-cache").ok();
        std::sync::Arc::new(FcCacheFonts::new(runner, fc_cache))
    }
}

#[cfg(windows)]
pub mod win {
    //! Windows: Registry und GDI. Der einzige Ort mit `unsafe` im Kern (zwei FFI-Aufrufe).
    #![allow(unsafe_code)]

    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    use windows_sys::Win32::Graphics::Gdi::{AddFontResourceW, RemoveFontResourceW};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        HWND_BROADCAST, SMTO_ABORTIFHUNG, SendMessageTimeoutW, WM_FONTCHANGE,
    };
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};

    use super::FontInstaller;

    const FONTS_KEY: &str = "Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";

    #[derive(Default)]
    pub struct WindowsFonts {
        /// Seit dem letzten `flush` wurde etwas an- oder abgemeldet.
        changed: std::sync::atomic::AtomicBool,
    }

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
    }

    fn broadcast_font_change() {
        let mut result = 0usize;
        // SAFETY: Aufruf der Win32-Funktion mit gültigen Argumenten; `result` lebt über den Aufruf, Zeitlimit 1 s
        unsafe {
            SendMessageTimeoutW(HWND_BROADCAST, WM_FONTCHANGE, 0, 0, SMTO_ABORTIFHUNG, 1000, &mut result);
        }
    }

    impl FontInstaller for WindowsFonts {
        fn register(&self, file: &Path, display_name: &str) -> io::Result<Option<String>> {
            let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(FONTS_KEY, KEY_SET_VALUE | KEY_READ)?;
            key.set_value(display_name, &file.as_os_str().to_owned())?;
            let w = wide(file);
            // SAFETY: `w` ist ein nullterminierter UTF-16-Pfad, der den Aufruf überdauert
            let added = unsafe { AddFontResourceW(w.as_ptr()) };
            if added == 0 {
                // Die Registry-Anmeldung gilt ab der nächsten Anmeldung trotzdem; kein harter Fehler
                tracing::warn!("AddFontResourceW meldet 0 Schriften für {}", file.display());
            }
            self.changed.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok(Some(display_name.to_owned()))
        }

        fn unregister(&self, file: &Path, registry_name: Option<&str>) -> io::Result<()> {
            let w = wide(file);
            // SAFETY: wie oben
            unsafe {
                RemoveFontResourceW(w.as_ptr());
            }
            if let Some(name) = registry_name {
                let key =
                    RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(FONTS_KEY, KEY_SET_VALUE | KEY_READ)?;
                match key.delete_value(name) {
                    Ok(()) => {}
                    Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e),
                }
            }
            self.changed.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        }

        fn flush(&self) {
            // Eine Meldung für den ganzen Stapel: sie wartet auf jedes Fenster, je Datei wäre das spürbar langsam
            if self.changed.swap(false, std::sync::atomic::Ordering::SeqCst) {
                broadcast_font_change();
            }
        }
    }
}

/// Fälscher für Tests: merkt sich Aufrufe.
#[derive(Default)]
pub struct RecordingFonts {
    pub registered: std::sync::Mutex<Vec<(std::path::PathBuf, String)>>,
    pub unregistered: std::sync::Mutex<Vec<std::path::PathBuf>>,
    pub fail_register: std::sync::atomic::AtomicBool,
}

impl FontInstaller for RecordingFonts {
    fn register(&self, file: &Path, display_name: &str) -> io::Result<Option<String>> {
        if self.fail_register.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(io::Error::other("Anmeldung fehlgeschlagen"));
        }
        if let Ok(mut g) = self.registered.lock() {
            g.push((file.to_path_buf(), display_name.to_owned()));
        }
        Ok(Some(display_name.to_owned()))
    }

    fn unregister(&self, file: &Path, _registry_name: Option<&str>) -> io::Result<()> {
        if let Ok(mut g) = self.unregistered.lock() {
            g.push(file.to_path_buf());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::FakeRunner;

    #[test]
    fn fc_cache_runs_for_the_font_folder_and_ignores_failures() {
        let runner = FakeRunner::new().fail("fc-cache", 1, "kaputt");
        let runner = std::sync::Arc::new(runner);
        let fonts = FcCacheFonts::new(runner.clone(), Some("/usr/bin/fc-cache".into()));
        for name in ["A.ttf", "B.ttf", "C.ttf"] {
            let file = format!("/home/a/.local/share/fonts/cypher/{name}");
            assert_eq!(fonts.register(Path::new(&file), name).unwrap(), None);
        }
        assert!(runner.calls().is_empty(), "während des Stapels läuft nichts");
        fonts.flush();
        let calls = runner.calls();
        assert_eq!(calls.len(), 1, "ein Lauf für den ganzen Ordner, nicht je Datei");
        assert_eq!(calls[0].args, ["-f", "/home/a/.local/share/fonts/cypher"]);
        fonts.flush();
        assert_eq!(runner.calls().len(), 1, "ohne neue Schriften läuft nichts");
        fonts.unregister(Path::new("/home/a/.local/share/fonts/cypher/A.ttf"), None).unwrap();
        fonts.flush();
        assert_eq!(runner.calls().len(), 2);
    }

    #[test]
    fn without_fc_cache_nothing_is_run() {
        let runner = FakeRunner::new();
        let runner = std::sync::Arc::new(runner);
        let fonts = FcCacheFonts::new(runner.clone(), None);
        fonts.register(Path::new("/x/A.ttf"), "A").unwrap();
        fonts.flush();
        assert!(runner.calls().is_empty());
    }

    #[test]
    fn recording_fonts_remember_calls() {
        let r = RecordingFonts::default();
        assert_eq!(r.register(Path::new("/a.ttf"), "A (TrueType)").unwrap().as_deref(), Some("A (TrueType)"));
        r.unregister(Path::new("/a.ttf"), Some("A (TrueType)")).unwrap();
        assert_eq!(r.registered.lock().unwrap().len(), 1);
        assert_eq!(r.unregistered.lock().unwrap().len(), 1);
    }
}
