//! Echte Implementierungen der Erkennungs-Traits.

use std::path::{Path, PathBuf};

use super::{FsProbe, RegistryProbe, UninstallEntry};

/// Liest das echte Dateisystem.
pub struct RealFs;

impl FsProbe for RealFs {
    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }

    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn read(&self, path: &Path) -> Option<Vec<u8>> {
        // Erkennungsdateien (Info.plist, .acf, .desktop) sind klein; große Dateien werden nicht gelesen.
        let meta = std::fs::metadata(path).ok()?;
        if meta.len() > 4 * 1024 * 1024 {
            return None;
        }
        std::fs::read(path).ok()
    }

    fn read_dir(&self, path: &Path) -> Vec<PathBuf> {
        std::fs::read_dir(path).map(|rd| rd.flatten().map(|e| e.path()).collect()).unwrap_or_default()
    }
}

/// Keine Registry (macOS, Linux).
pub struct NoRegistry;

impl RegistryProbe for NoRegistry {
    fn uninstall_entries(&self) -> Vec<UninstallEntry> {
        Vec::new()
    }
}

/// Liest die Windows-Programmliste (`HKLM`, `HKLM\WOW6432Node`, `HKCU`; nur lesend).
#[cfg(windows)]
pub struct RealRegistry;

#[cfg(windows)]
impl RegistryProbe for RealRegistry {
    fn uninstall_entries(&self) -> Vec<UninstallEntry> {
        use winreg::RegKey;
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
        const PATHS: [(&str, bool); 3] = [
            (r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", true),
            (r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall", true),
            (r"Software\Microsoft\Windows\CurrentVersion\Uninstall", false),
        ];
        let mut out = Vec::new();
        for (path, machine) in PATHS {
            let root = RegKey::predef(if machine { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER });
            let Ok(key) = root.open_subkey_with_flags(path, KEY_READ) else { continue };
            for name in key.enum_keys().flatten() {
                let Ok(sub) = key.open_subkey_with_flags(&name, KEY_READ) else { continue };
                let Ok(display_name) = sub.get_value::<String, _>("DisplayName") else { continue };
                out.push(UninstallEntry {
                    display_name,
                    display_version: sub.get_value::<String, _>("DisplayVersion").ok(),
                    install_location: sub.get_value::<String, _>("InstallLocation").ok().filter(|s| !s.is_empty()),
                    display_icon: sub.get_value::<String, _>("DisplayIcon").ok().filter(|s| !s.is_empty()),
                });
            }
        }
        out
    }
}
