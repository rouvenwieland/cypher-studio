//! Prozesse starten, die der Kern nur kurz braucht (Hilfswerkzeuge wie `hdiutil`, `flatpak`, `blender --version`).
//!
//! Nie über eine Shell, immer absoluter Programmpfad und Argumentliste, Zeitlimit, bereinigte Umgebung
//! (ARCHITEKTUR.md 6.7). Das Trait macht die Aufrufer ohne echte Prozesse testbar.

use std::ffi::OsString;
use std::io::{self, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::install::appimage::ENV_REMOVE;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CommandOutput {
    /// Exit-Code (`None`, wenn vom Signal beendet).
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl CommandOutput {
    pub fn success(&self) -> bool {
        self.code == Some(0)
    }

    pub fn stdout_text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    pub fn stderr_text(&self) -> String {
        String::from_utf8_lossy(&self.stderr).into_owned()
    }
}

pub trait CommandRunner: Send + Sync {
    /// Führt `exe args…` aus und wartet höchstens `timeout`. Zeitüberschreitung: `ErrorKind::TimedOut`.
    fn run(&self, exe: &Path, args: &[OsString], timeout: Duration) -> io::Result<CommandOutput>;
}

/// Startet echte Prozesse.
pub struct SystemRunner;

impl CommandRunner for SystemRunner {
    fn run(&self, exe: &Path, args: &[OsString], timeout: Duration) -> io::Result<CommandOutput> {
        let mut command = Command::new(exe);
        command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        for var in ENV_REMOVE {
            command.env_remove(var);
        }
        let mut child = command.spawn()?;
        let mut stdout = child.stdout.take();
        let mut stderr = child.stderr.take();
        let out_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(s) = stdout.as_mut() {
                let _ = s.read_to_end(&mut buf);
            }
            buf
        });
        let err_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(s) = stderr.as_mut() {
                let _ = s.read_to_end(&mut buf);
            }
            buf
        });
        let started = Instant::now();
        let status = loop {
            if let Some(status) = child.try_wait()? {
                break status;
            }
            if started.elapsed() >= timeout {
                let _ = child.kill();
                let _ = child.wait();
                return Err(io::Error::new(io::ErrorKind::TimedOut, "Zeitlimit überschritten"));
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        Ok(CommandOutput {
            code: status.code(),
            stdout: out_thread.join().unwrap_or_default(),
            stderr: err_thread.join().unwrap_or_default(),
        })
    }
}

/// Aufgezeichneter Aufruf des [`FakeRunner`].
#[cfg(any(test, feature = "test-util"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordedCall {
    pub exe: std::path::PathBuf,
    pub args: Vec<String>,
}

/// Tut so, als liefe ein Programm: antwortet nach Skript und merkt sich die Aufrufe.
#[cfg(any(test, feature = "test-util"))]
pub struct FakeRunner {
    calls: std::sync::Mutex<Vec<RecordedCall>>,
    /// (Teil des Programmnamens + erstes Argument oder leer) → Antwort; erster Treffer gewinnt.
    script: std::sync::Mutex<Vec<(String, io::Result<CommandOutput>)>>,
}

#[cfg(any(test, feature = "test-util"))]
impl FakeRunner {
    pub fn new() -> Self {
        FakeRunner { calls: Default::default(), script: Default::default() }
    }

    /// Antwort für Aufrufe, deren `programm argument…` den Text `pattern` enthält.
    pub fn on(self, pattern: &str, output: io::Result<CommandOutput>) -> Self {
        if let Ok(mut s) = self.script.lock() {
            s.push((pattern.to_owned(), output));
        }
        self
    }

    pub fn ok(self, pattern: &str, stdout: &str) -> Self {
        self.on(pattern, Ok(CommandOutput { code: Some(0), stdout: stdout.as_bytes().to_vec(), stderr: vec![] }))
    }

    pub fn fail(self, pattern: &str, code: i32, stderr: &str) -> Self {
        self.on(pattern, Ok(CommandOutput { code: Some(code), stdout: vec![], stderr: stderr.as_bytes().to_vec() }))
    }

    pub fn calls(&self) -> Vec<RecordedCall> {
        self.calls.lock().map(|c| c.clone()).unwrap_or_default()
    }
}

#[cfg(any(test, feature = "test-util"))]
impl Default for FakeRunner {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(any(test, feature = "test-util"))]
impl CommandRunner for FakeRunner {
    fn run(&self, exe: &Path, args: &[OsString], _timeout: Duration) -> io::Result<CommandOutput> {
        let args: Vec<String> = args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
        // Auf Windows setzt `Path::join` ein Rückwärtsschrägstrich; Muster und Aufruf werden ohne Trennzeichen-Unterschied verglichen
        let line = format!("{} {}", exe.display(), args.join(" "));
        if let Ok(mut calls) = self.calls.lock() {
            calls.push(RecordedCall { exe: exe.to_path_buf(), args });
        }
        let script = self.script.lock().map_err(|_| io::Error::other("Skript gesperrt"))?;
        for (pattern, output) in script.iter() {
            if line.replace('\\', "/").contains(pattern.replace('\\', "/").as_str()) {
                return match output {
                    Ok(o) => Ok(o.clone()),
                    Err(e) => Err(io::Error::new(e.kind(), e.to_string())),
                };
            }
        }
        Err(io::Error::new(io::ErrorKind::NotFound, format!("kein Skripteintrag für `{line}`")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn system_runner_captures_output_and_exit_codes() {
        let out = SystemRunner
            .run(
                Path::new("/bin/sh"),
                &["-c".into(), "echo hallo; echo fehler >&2; exit 3".into()],
                Duration::from_secs(5),
            )
            .unwrap();
        assert_eq!(out.code, Some(3));
        assert_eq!(out.stdout_text().trim(), "hallo");
        assert_eq!(out.stderr_text().trim(), "fehler");
        assert!(!out.success());
    }

    #[cfg(unix)]
    #[test]
    fn system_runner_enforces_the_timeout() {
        let started = Instant::now();
        let err = SystemRunner
            .run(Path::new("/bin/sh"), &["-c".into(), "sleep 30".into()], Duration::from_millis(200))
            .unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn missing_programs_are_errors_not_panics() {
        assert!(SystemRunner.run(Path::new("/gibt/es/nicht"), &[], Duration::from_secs(1)).is_err());
    }

    #[test]
    fn fake_runner_follows_the_script_and_records() {
        let fake = FakeRunner::new().ok("hdiutil attach", "plist").fail("detach", 1, "busy");
        assert_eq!(
            fake.run(Path::new("/usr/bin/hdiutil"), &["attach".into(), "x.dmg".into()], Duration::from_secs(1))
                .unwrap()
                .stdout_text(),
            "plist"
        );
        assert_eq!(
            fake.run(Path::new("/usr/bin/hdiutil"), &["detach".into()], Duration::from_secs(1)).unwrap().code,
            Some(1)
        );
        assert!(fake.run(Path::new("/usr/bin/unbekannt"), &[], Duration::from_secs(1)).is_err());
        assert_eq!(fake.calls().len(), 3);
        assert_eq!(fake.calls()[0].args, ["attach", "x.dmg"]);
    }
}
