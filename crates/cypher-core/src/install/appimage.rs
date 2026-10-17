//! AppImage: ausführbar machen, FUSE-Erkennung. Das AppImage wird bei der Installation nie ausgeführt (ARCHITEKTUR.md
//! 2.7, 6.4, 7.3); ohne FUSE entpackt es sich beim Start selbst (`APPIMAGE_EXTRACT_AND_RUN`).

use std::path::Path;

use crate::api::IoOp;
use crate::error::IoError;

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
}
