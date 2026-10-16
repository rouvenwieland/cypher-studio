//! Windows-Installer (`exeInstaller`): nur bekannte Installer-Typen mit festen Argumenten aus dem Code,
//! nie aus dem Katalog (ARCHITEKTUR.md 2.7). Aktuell nur für optionale Programme (z. B. GIMP, Inno Setup).

use std::ffi::OsString;
use std::path::Path;
use std::time::Duration;

use crate::catalog::InstallerType;
use crate::error::InstallError;
use crate::process::CommandRunner;

/// Argumente für eine stille Installation in einen Benutzerordner (ohne Administratorrechte).
pub fn installer_args(kind: InstallerType, target: &Path) -> Vec<OsString> {
    match kind {
        // NSIS: `/D=` muss das letzte Argument sein und darf nicht in Anführungszeichen stehen
        InstallerType::Nsis => {
            let mut dir = OsString::from("/D=");
            dir.push(target);
            vec!["/S".into(), dir]
        }
        InstallerType::Inno => {
            let mut dir = OsString::from("/DIR=");
            dir.push(target);
            vec!["/VERYSILENT".into(), "/SUPPRESSMSGBOXES".into(), "/NORESTART".into(), "/CURRENTUSER".into(), dir]
        }
    }
}

/// Führt den Installer aus; Zeitlimit 15 Minuten.
pub fn run_installer(
    runner: &dyn CommandRunner,
    installer: &Path,
    kind: InstallerType,
    target: &Path,
) -> Result<(), InstallError> {
    let args = installer_args(kind, target);
    let out = runner
        .run(installer, &args, Duration::from_secs(15 * 60))
        .map_err(|e| InstallError::Process(format!("Installer: {e}")))?;
    if out.success() { Ok(()) } else { Err(InstallError::Process(format!("Installer endete mit {:?}", out.code))) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::FakeRunner;

    #[test]
    fn installer_arguments_come_from_code_and_end_with_the_target() {
        let target = Path::new("C:\\Users\\a\\programs\\gimp\\3.2.6");
        let nsis = installer_args(InstallerType::Nsis, target);
        assert_eq!(nsis[0], "/S");
        assert_eq!(nsis.last().unwrap().to_string_lossy(), "/D=C:\\Users\\a\\programs\\gimp\\3.2.6");
        let inno = installer_args(InstallerType::Inno, target);
        assert!(inno.iter().any(|a| a == "/CURRENTUSER"), "Benutzerinstallation ohne Administratorrechte");
        assert!(inno.iter().any(|a| a == "/VERYSILENT"));
        assert!(inno.last().unwrap().to_string_lossy().starts_with("/DIR="));
    }

    #[test]
    fn exit_codes_decide_success() {
        let ok = FakeRunner::new().ok("setup.exe", "");
        run_installer(&ok, Path::new("setup.exe"), InstallerType::Inno, Path::new("/t")).unwrap();
        let bad = FakeRunner::new().fail("setup.exe", 5, "");
        assert!(run_installer(&bad, Path::new("setup.exe"), InstallerType::Nsis, Path::new("/t")).is_err());
    }
}
