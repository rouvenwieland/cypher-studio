//! macOS-dmg: einhängen, `.app` kopieren, aushängen, prüfen (ARCHITEKTUR.md 2.7, 7.2).
//!
//! Alle Systemwerkzeuge laufen über den [`CommandRunner`] mit absolutem Pfad; die Logik ist daher auf jedem
//! System mit einem Skript-Runner testbar. Auf macOS-CI laufen die echten Werkzeuge.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::error::InstallError;
use crate::process::CommandRunner;

pub const HDIUTIL: &str = "/usr/bin/hdiutil";
pub const DITTO: &str = "/usr/bin/ditto";
pub const CODESIGN: &str = "/usr/bin/codesign";
pub const SPCTL: &str = "/usr/sbin/spctl";

const ATTACH_TIMEOUT: Duration = Duration::from_secs(120);
const COPY_TIMEOUT: Duration = Duration::from_secs(600);
const CHECK_TIMEOUT: Duration = Duration::from_secs(120);

/// Ein eingehängtes dmg. Beim Verwerfen wird es wieder ausgehängt (auch bei Abbruch oder Fehler).
pub struct MountGuard<'a> {
    runner: &'a dyn CommandRunner,
    pub mount_point: PathBuf,
}

impl Drop for MountGuard<'_> {
    fn drop(&mut self) {
        let args: Vec<OsString> = vec!["detach".into(), self.mount_point.as_os_str().to_owned(), "-force".into()];
        if let Err(e) = self.runner.run(Path::new(HDIUTIL), &args, ATTACH_TIMEOUT) {
            tracing::warn!("dmg konnte nicht ausgehängt werden ({}): {e}", self.mount_point.display());
        }
    }
}

/// Liest den Einhängepunkt aus der Plist-Ausgabe von `hdiutil attach -plist`.
pub fn parse_mount_point(plist_xml: &[u8]) -> Option<PathBuf> {
    let value = plist::Value::from_reader_xml(plist_xml).ok()?;
    let entities = value.as_dictionary()?.get("system-entities")?.as_array()?;
    entities
        .iter()
        .filter_map(|e| e.as_dictionary())
        .find_map(|d| d.get("mount-point").and_then(plist::Value::as_string))
        .map(PathBuf::from)
}

/// Hängt ein dmg schreibgeschützt ein: `hdiutil attach -nobrowse -readonly -noautoopen -mountrandom <tmp> -plist <dmg>`.
pub fn attach<'a>(
    runner: &'a dyn CommandRunner,
    dmg: &Path,
    mount_parent: &Path,
) -> Result<MountGuard<'a>, InstallError> {
    let args: Vec<OsString> = vec![
        "attach".into(),
        "-nobrowse".into(),
        "-readonly".into(),
        "-noautoopen".into(),
        "-mountrandom".into(),
        mount_parent.as_os_str().to_owned(),
        "-plist".into(),
        dmg.as_os_str().to_owned(),
    ];
    let out = runner
        .run(Path::new(HDIUTIL), &args, ATTACH_TIMEOUT)
        .map_err(|e| InstallError::Process(format!("hdiutil attach: {e}")))?;
    if !out.success() {
        return Err(InstallError::Process(format!(
            "hdiutil attach endete mit {:?}: {}",
            out.code,
            out.stderr_text().trim()
        )));
    }
    let mount_point = parse_mount_point(&out.stdout)
        .ok_or_else(|| InstallError::Process("hdiutil lieferte keinen Einhängepunkt".into()))?;
    Ok(MountGuard { runner, mount_point })
}

/// Kopiert das `.app` samt Metadaten per `ditto` (erhält Signaturen und Ressourcengabeln).
pub fn copy_bundle(runner: &dyn CommandRunner, src_app: &Path, dest: &Path) -> Result<(), InstallError> {
    let args: Vec<OsString> = vec![src_app.as_os_str().to_owned(), dest.as_os_str().to_owned()];
    let out =
        runner.run(Path::new(DITTO), &args, COPY_TIMEOUT).map_err(|e| InstallError::Process(format!("ditto: {e}")))?;
    if out.success() {
        Ok(())
    } else {
        Err(InstallError::Process(format!("ditto endete mit {:?}: {}", out.code, out.stderr_text().trim())))
    }
}

/// Ergebnis der Prüfung eines kopierten `.app`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Assessment {
    /// `codesign --verify --deep --strict` war erfolgreich (Signatur gültig, auch ad hoc).
    pub signature_valid: bool,
    /// `spctl --assess --type execute` akzeptiert die App (beglaubigt bzw. vertrauenswürdig).
    pub accepted_by_gatekeeper: bool,
}

/// Prüft das `.app`: gültige Signatur ist Pflicht, „nicht beglaubigt“ wird nur gemeldet.
pub fn assess(runner: &dyn CommandRunner, app: &Path) -> Result<Assessment, InstallError> {
    let verify: Vec<OsString> = vec!["--verify".into(), "--deep".into(), "--strict".into(), app.as_os_str().to_owned()];
    let signature_valid = runner
        .run(Path::new(CODESIGN), &verify, CHECK_TIMEOUT)
        .map(|o| o.success())
        .map_err(|e| InstallError::Process(format!("codesign: {e}")))?;
    let assess: Vec<OsString> = vec!["--assess".into(), "--type".into(), "execute".into(), app.as_os_str().to_owned()];
    let accepted_by_gatekeeper =
        runner.run(Path::new(SPCTL), &assess, CHECK_TIMEOUT).map(|o| o.success()).unwrap_or(false);
    Ok(Assessment { signature_valid, accepted_by_gatekeeper })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::FakeRunner;

    const ATTACH_PLIST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>system-entities</key>
  <array>
    <dict><key>content-hint</key><string>GUID_partition_scheme</string><key>dev-entry</key><string>/dev/disk4</string></dict>
    <dict>
      <key>content-hint</key><string>Apple_HFS</string>
      <key>dev-entry</key><string>/dev/disk4s1</string>
      <key>mount-point</key><string>/private/tmp/cy-mount/dmg.AbCdEf</string>
    </dict>
  </array>
</dict>
</plist>"#;

    #[test]
    fn mount_point_is_read_from_the_plist() {
        assert_eq!(parse_mount_point(ATTACH_PLIST.as_bytes()), Some(PathBuf::from("/private/tmp/cy-mount/dmg.AbCdEf")));
        assert_eq!(parse_mount_point(b"kein plist"), None);
        assert_eq!(parse_mount_point(b"<plist version=\"1.0\"><dict></dict></plist>"), None);
    }

    #[test]
    fn attach_copy_detach_use_the_documented_commands() {
        let fake = FakeRunner::new().ok("hdiutil attach", ATTACH_PLIST).ok("hdiutil detach", "").ok("ditto", "");
        {
            let guard = attach(&fake, Path::new("/cache/blender.dmg"), Path::new("/private/tmp/cy-mount")).unwrap();
            assert_eq!(guard.mount_point, Path::new("/private/tmp/cy-mount/dmg.AbCdEf"));
            copy_bundle(
                &fake,
                &guard.mount_point.join("Blender.app"),
                Path::new("/Users/a/Applications/Cypher Studio/.staging/j1/Blender.app"),
            )
            .unwrap();
        } // Drop hängt aus
        let calls = fake.calls();
        assert_eq!(calls[0].exe, Path::new("/usr/bin/hdiutil"));
        assert_eq!(
            calls[0].args,
            [
                "attach",
                "-nobrowse",
                "-readonly",
                "-noautoopen",
                "-mountrandom",
                "/private/tmp/cy-mount",
                "-plist",
                "/cache/blender.dmg"
            ]
        );
        assert_eq!(calls[1].exe, Path::new("/usr/bin/ditto"));
        // Das Einhängen gibt es nur auf macOS; der Vergleich ist unabhängig vom Trennzeichen des Testsystems
        assert_eq!(calls[1].args[0].replace('\\', "/"), "/private/tmp/cy-mount/dmg.AbCdEf/Blender.app");
        assert_eq!(calls[2].exe, Path::new("/usr/bin/hdiutil"));
        assert_eq!(calls[2].args, ["detach", "/private/tmp/cy-mount/dmg.AbCdEf", "-force"]);
    }

    #[test]
    fn the_image_is_detached_even_when_copying_fails() {
        let fake = FakeRunner::new().ok("hdiutil attach", ATTACH_PLIST).ok("hdiutil detach", "").fail(
            "ditto",
            1,
            "kein Platz",
        );
        let result = (|| {
            let guard = attach(&fake, Path::new("/c/x.dmg"), Path::new("/t"))?;
            copy_bundle(&fake, &guard.mount_point.join("X.app"), Path::new("/d/X.app"))
        })();
        assert!(matches!(result, Err(InstallError::Process(m)) if m.contains("kein Platz")));
        assert!(fake.calls().iter().any(|c| c.args.first().map(String::as_str) == Some("detach")));
    }

    #[test]
    fn attach_failures_are_reported() {
        let fake = FakeRunner::new().fail("hdiutil attach", 1, "beschädigt");
        assert!(
            matches!(attach(&fake, Path::new("/c/x.dmg"), Path::new("/t")), Err(InstallError::Process(m)) if m.contains("beschädigt"))
        );
        let fake = FakeRunner::new().ok("hdiutil attach", "<plist version=\"1.0\"><dict/></plist>");
        assert!(attach(&fake, Path::new("/c/x.dmg"), Path::new("/t")).is_err());
    }

    #[test]
    fn assessment_separates_signature_from_notarization() {
        let signed_only = FakeRunner::new().ok("codesign", "").fail("spctl", 3, "rejected");
        assert_eq!(
            assess(&signed_only, Path::new("/a/K.app")).unwrap(),
            Assessment { signature_valid: true, accepted_by_gatekeeper: false }
        );
        let full = FakeRunner::new().ok("codesign", "").ok("spctl", "");
        assert_eq!(
            assess(&full, Path::new("/a/B.app")).unwrap(),
            Assessment { signature_valid: true, accepted_by_gatekeeper: true }
        );
        let broken = FakeRunner::new().fail("codesign", 1, "invalid").ok("spctl", "");
        assert!(!assess(&broken, Path::new("/a/B.app")).unwrap().signature_valid);
        let calls = signed_only.calls();
        assert_eq!(calls[0].args, ["--verify", "--deep", "--strict", "/a/K.app"]);
        assert_eq!(calls[1].args, ["--assess", "--type", "execute", "/a/K.app"]);
    }
}
