//! `platform` – Betriebssystem, Architektur, Pfade und sichere Dateioperationen.
//!
//! Einzige Stelle für OS-Unterschiede bei Pfaden und im Dateisystem (ARCHITEKTUR.md 2.3, 7.1–7.3).

mod dirs;
pub mod fsx;

use std::path::Path;

pub use dirs::{AppDirs, KnownDirs};

use crate::api::{Arch, Os};

/// Ordnername unter der Betriebssystem-Wurzel; gleich dem Tauri-Identifier, damit unsere Daten neben denen des
/// WebViews liegen und sich beim Deinstallieren gemeinsam entfernen lassen.
pub const APP_DIR_NAME: &str = "de.cypherxcypher.studio";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlatformInfo {
    pub os: Os,
    pub arch: Arch,
    pub os_version: String,
    /// macOS: Intel-Binary läuft auf Apple Silicon (Rosetta 2). `arch` ist dann trotzdem die echte Hardware.
    pub rosetta: bool,
}

impl PlatformInfo {
    /// Feste Plattform, z. B. für Tests anderer Betriebssysteme.
    pub fn fixed(os: Os, arch: Arch) -> Self {
        PlatformInfo { os, arch, os_version: String::new(), rosetta: false }
    }
}

/// Das laufende System. macOS: echte Hardware über `sysctl hw.optional.arm64`.
pub fn current() -> PlatformInfo {
    let compiled = if cfg!(target_arch = "aarch64") { Arch::Aarch64 } else { Arch::X86_64 };
    let (arch, rosetta) = hardware_arch(compiled);
    let os_version = sysinfo::System::long_os_version()
        .or_else(sysinfo::System::os_version)
        .unwrap_or_else(|| "unbekannt".to_owned());
    PlatformInfo { os: Os::current(), arch, os_version, rosetta }
}

#[cfg(target_os = "macos")]
fn hardware_arch(compiled: Arch) -> (Arch, bool) {
    let out = std::process::Command::new("/usr/sbin/sysctl").args(["-n", "hw.optional.arm64"]).output();
    let arm = out.ok().filter(|o| o.status.success()).is_some_and(|o| String::from_utf8_lossy(&o.stdout).trim() == "1");
    match (arm, compiled) {
        (true, Arch::X86_64) => (Arch::Aarch64, true),
        (true, Arch::Aarch64) => (Arch::Aarch64, false),
        (false, c) => (c, false),
    }
}

#[cfg(not(target_os = "macos"))]
fn hardware_arch(compiled: Arch) -> (Arch, bool) {
    (compiled, false)
}

/// Pfad zur Anzeige: Home-Verzeichnis wird zu `~`. Wird nie zurück an Rust geschickt.
pub fn display_path(path: &Path) -> String {
    display_path_with_home(path, directories::BaseDirs::new().as_ref().map(|d| d.home_dir()))
}

/// Wie [`display_path`], aber mit ausdrücklichem Home-Verzeichnis (testbar).
pub fn display_path_with_home(path: &Path, home: Option<&Path>) -> String {
    if let Some(home) = home
        && let Ok(rest) = path.strip_prefix(home)
    {
        let rest = rest.to_string_lossy();
        return if rest.is_empty() { "~".to_owned() } else { format!("~{}{rest}", std::path::MAIN_SEPARATOR) };
    }
    path.to_string_lossy().into_owned()
}

/// `true` für Systemordner, in denen die App nie schreiben soll (ARCHITEKTUR.md 6.6): Windows-Ordner, Programmordner,
/// Laufwerkswurzeln; Unix-Wurzel, `/usr`, `/etc`, `/System` usw.
pub fn is_system_dir(os: Os, known: &KnownDirs, path: &Path) -> bool {
    let text = path.to_string_lossy().replace('\\', "/");
    match os {
        Os::Windows => {
            let norm = text.trim_start_matches("//?/").trim_end_matches('/').to_lowercase();
            let bytes = norm.as_bytes();
            let is_drive_root = (norm.len() == 2 && bytes[1] == b':') || norm.is_empty();
            if is_drive_root {
                return true;
            }
            let mut blocked: Vec<String> = vec![
                "c:/windows".into(),
                "c:/program files".into(),
                "c:/program files (x86)".into(),
                "c:/programdata".into(),
            ];
            for pf in &known.program_files {
                blocked.push(pf.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_lowercase());
            }
            blocked.iter().any(|b| norm == *b || norm.starts_with(&format!("{b}/")))
        }
        Os::Macos | Os::Linux => {
            let norm = text.trim_end_matches('/');
            if norm.is_empty() {
                return true;
            }
            const BLOCKED: [&str; 12] = [
                "/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/sbin", "/sys", "/usr", "/System",
                "/Library",
            ];
            BLOCKED.iter().any(|b| norm == *b || norm.starts_with(&format!("{b}/")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn system_dirs_are_recognised_per_os() {
        let known = KnownDirs { program_files: vec![PathBuf::from("D:\\Programme")], ..KnownDirs::default() };
        for blocked in [
            "C:\\Windows",
            "c:\\windows\\System32",
            "C:\\Program Files\\Krita",
            "C:\\",
            "D:\\Programme\\X",
            "\\\\?\\C:\\Windows",
        ] {
            assert!(is_system_dir(Os::Windows, &known, Path::new(blocked)), "{blocked}");
        }
        for fine in ["C:\\Users\\anna\\Programme", "D:\\Tools", "E:\\Sync\\Cypher"] {
            assert!(!is_system_dir(Os::Windows, &known, Path::new(fine)), "{fine}");
        }
        for blocked in ["/", "/usr", "/usr/local/bin", "/etc", "/System/Library", "/Library/Foo", "/bin"] {
            assert!(is_system_dir(Os::Linux, &known, Path::new(blocked)), "{blocked}");
        }
        for fine in [
            "/home/anna/programme",
            "/opt/cypher",
            "/Users/anna/Applications",
            "/tmp/x",
            "/var/folders/ab/cd",
            "/mnt/data",
        ] {
            assert!(!is_system_dir(Os::Macos, &known, Path::new(fine)), "{fine}");
        }
    }

    #[test]
    fn current_platform_is_consistent() {
        let p = current();
        assert_eq!(p.os, Os::current());
        assert!(!p.os_version.is_empty());
    }

    #[test]
    fn display_path_abbreviates_home() {
        let home = PathBuf::from("/home/anna");
        assert_eq!(display_path_with_home(Path::new("/home/anna"), Some(&home)), "~");
        let shown = display_path_with_home(Path::new("/home/anna/Pictures/x.png"), Some(&home));
        assert!(shown.starts_with('~') && shown.ends_with("x.png"), "{shown}");
        assert_eq!(display_path_with_home(Path::new("/opt/x"), Some(&home)), "/opt/x");
        assert_eq!(display_path_with_home(Path::new("/opt/x"), None), "/opt/x");
    }
}
