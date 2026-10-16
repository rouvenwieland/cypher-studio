//! AppImage: ausführbar machen, FUSE-Erkennung, Entpacken ohne FUSE (ARCHITEKTUR.md 2.7, 7.3).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

use crate::api::IoOp;
use crate::error::{InstallError, IoError};

/// Umgebungsvariablen, die ein von Cypher Studio gestartetes Programm nicht erben darf (wichtig, wenn Cypher
/// Studio selbst als AppImage läuft; ARCHITEKTUR.md 2.9).
pub const ENV_REMOVE: &[&str] = &[
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "OWD",
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_PIXBUF_MODULEDIR",
    "GIO_MODULE_DIR",
    "GSETTINGS_SCHEMA_DIR",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    "GTK_PATH",
    "GTK_EXE_PREFIX",
    "GTK_DATA_PREFIX",
    "GTK_IM_MODULE_FILE",
    "PYTHONHOME",
    "PYTHONPATH",
    "PERLLIB",
    "QT_PLUGIN_PATH",
];

/// Ordner, in denen `libfuse.so.2` liegen kann.
const FUSE_LIB_DIRS: &[&str] = &[
    "/usr/lib/x86_64-linux-gnu",
    "/lib/x86_64-linux-gnu",
    "/usr/lib/aarch64-linux-gnu",
    "/lib/aarch64-linux-gnu",
    "/usr/lib64",
    "/lib64",
    "/usr/lib",
    "/lib",
    "/usr/local/lib",
];

/// FUSE 2 nutzbar? Braucht `/dev/fuse` und `libfuse.so.2` (Ubuntu ≥ 24.04: Paket `libfuse2t64`).
pub fn fuse2_available() -> bool {
    fuse2_available_in(Path::new("/dev/fuse"), FUSE_LIB_DIRS)
}

pub fn fuse2_available_in(dev_fuse: &Path, lib_dirs: &[&str]) -> bool {
    cfg!(target_os = "linux")
        && dev_fuse.exists()
        && lib_dirs.iter().any(|d| Path::new(d).join("libfuse.so.2").exists())
}

/// Setzt das Ausführungsrecht (0o755).
pub fn make_executable(path: &Path) -> Result<(), IoError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| IoError::new(IoOp::Write, path, e))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

/// Entpackt ein AppImage ohne FUSE per `<appimage> --appimage-extract` in `dest` (Ergebnis: `dest/squashfs-root`).
/// Liefert den Pfad zu `AppRun`. Läuft in einem blockierenden Thread, bricht bei Abbruch und nach 10 Minuten ab.
pub fn extract(appimage: &Path, dest: &Path, cancel: &CancellationToken) -> Result<PathBuf, InstallError> {
    let mut command = Command::new(appimage);
    command
        .arg("--appimage-extract")
        .current_dir(dest)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    for var in ENV_REMOVE {
        command.env_remove(var);
    }
    let mut child = command.spawn().map_err(|e| IoError::new(IoOp::Spawn, appimage, e))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let mut err = String::new();
                    if let Some(mut stderr) = child.stderr.take() {
                        use std::io::Read;
                        let _ = stderr.read_to_string(&mut err);
                    }
                    return Err(InstallError::Process(format!(
                        "--appimage-extract endete mit {status}: {}",
                        err.trim()
                    )));
                }
                break;
            }
            Ok(None) => {}
            Err(e) => return Err(IoError::new(IoOp::Spawn, appimage, e).into()),
        }
        if cancel.is_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(InstallError::Cancelled);
        }
        if started.elapsed() > Duration::from_secs(600) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(InstallError::Process("--appimage-extract dauerte länger als 10 Minuten".into()));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let app_run = dest.join("squashfs-root").join("AppRun");
    if !app_run.exists() {
        return Err(InstallError::VerificationFailed("AppRun fehlt nach dem Entpacken".into()));
    }
    Ok(app_run)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fuse_detection_needs_device_and_library() {
        let tmp = tempfile::tempdir().unwrap();
        let dev = tmp.path().join("fuse");
        let lib_dir = tmp.path().join("lib");
        std::fs::create_dir_all(&lib_dir).unwrap();
        let dirs = [lib_dir.to_str().unwrap()];
        assert!(!fuse2_available_in(&dev, &dirs));
        std::fs::write(&dev, b"").unwrap();
        assert!(!fuse2_available_in(&dev, &dirs), "ohne libfuse.so.2");
        std::fs::write(lib_dir.join("libfuse.so.2"), b"").unwrap();
        assert_eq!(fuse2_available_in(&dev, &dirs), cfg!(target_os = "linux"));
    }

    #[cfg(unix)]
    #[test]
    fn extract_runs_the_appimage_with_the_extract_flag_and_finds_apprun() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        // Ein Shell-Skript, das sich wie ein AppImage verhält
        let app = tmp.path().join("Test.AppImage");
        std::fs::write(
            &app,
            "#!/bin/sh\nif [ \"$1\" = \"--appimage-extract\" ]; then mkdir -p squashfs-root && printf '#!/bin/sh\\necho hi\\n' > squashfs-root/AppRun && chmod 755 squashfs-root/AppRun; exit 0; fi\nexit 3\n",
        )
        .unwrap();
        std::fs::set_permissions(&app, std::fs::Permissions::from_mode(0o755)).unwrap();
        let dest = tmp.path().join("out");
        std::fs::create_dir_all(&dest).unwrap();
        let app_run = extract(&app, &dest, &CancellationToken::new()).unwrap();
        assert_eq!(app_run, dest.join("squashfs-root/AppRun"));
    }

    #[cfg(unix)]
    #[test]
    fn extract_reports_failures_and_honours_cancel() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let bad = tmp.path().join("Bad.AppImage");
        std::fs::write(&bad, "#!/bin/sh\necho kaputt >&2\nexit 7\n").unwrap();
        std::fs::set_permissions(&bad, std::fs::Permissions::from_mode(0o755)).unwrap();
        let err = extract(&bad, tmp.path(), &CancellationToken::new()).unwrap_err();
        assert!(matches!(err, InstallError::Process(m) if m.contains("kaputt")));

        let slow = tmp.path().join("Slow.AppImage");
        std::fs::write(&slow, "#!/bin/sh\nsleep 30\n").unwrap();
        std::fs::set_permissions(&slow, std::fs::Permissions::from_mode(0o755)).unwrap();
        let cancel = CancellationToken::new();
        let c2 = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            c2.cancel();
        });
        let started = Instant::now();
        assert!(matches!(extract(&slow, tmp.path(), &cancel), Err(InstallError::Cancelled)));
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
