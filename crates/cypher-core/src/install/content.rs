//! Inhaltsprüfung nach dem Entpacken: gibt es das Startprogramm wirklich? (ARCHITEKTUR.md 5.1, Phase `checkContent`)

use std::path::Path;

use globset::Glob;

use crate::api::ArtifactKind;
use crate::catalog::ArtifactSpec;
use crate::error::InstallError;
use crate::platform::fsx;
use crate::state::StoredLauncher;

/// Startet ein `.app`-Bundle: `Contents/MacOS/<exe>`.
fn mac_exe_path(bundle: &str, exe: &str) -> String {
    format!("{bundle}/Contents/MacOS/{exe}")
}

/// Prüft den Inhalt von `staging` und liefert die Startangaben (Pfade relativ zum Installationsordner).
pub fn check_content(staging: &Path, artifact: &ArtifactSpec) -> Result<StoredLauncher, InstallError> {
    match artifact.kind {
        ArtifactKind::Dmg => {
            let bundle = artifact
                .mac_app_name
                .as_deref()
                .ok_or_else(|| InstallError::VerificationFailed("macAppName fehlt im Katalog".into()))?;
            let app = fsx::safe_join(staging, bundle).map_err(|e| InstallError::VerificationFailed(e.to_string()))?;
            if !app.is_dir() {
                return Err(InstallError::VerificationFailed(format!("{bundle} fehlt im dmg")));
            }
            let exe = mac_exe_path(bundle, &artifact.launch.exe);
            let exe_path =
                fsx::safe_join(staging, &exe).map_err(|e| InstallError::VerificationFailed(e.to_string()))?;
            if !exe_path.is_file() {
                return Err(InstallError::VerificationFailed(format!("{exe} fehlt in der App")));
            }
            Ok(StoredLauncher::MacApp { rel_bundle: bundle.to_owned() })
        }
        ArtifactKind::AppImage => {
            let name = &artifact.file_name;
            let file = fsx::safe_join(staging, name).map_err(|e| InstallError::VerificationFailed(e.to_string()))?;
            if !file.is_file() {
                return Err(InstallError::VerificationFailed(format!("{name} fehlt")));
            }
            let app_run = staging.join("squashfs-root").join("AppRun");
            Ok(StoredLauncher::AppImage {
                rel_file: name.clone(),
                rel_app_run: app_run.is_file().then(|| "squashfs-root/AppRun".to_owned()),
            })
        }
        _ => {
            let exact = fsx::safe_join(staging, &artifact.launch.exe)
                .map_err(|e| InstallError::VerificationFailed(e.to_string()))?;
            let rel = if exact.is_file() {
                artifact.launch.exe.clone()
            } else if let Some(pattern) = &artifact.launch.exe_glob {
                find_by_glob(staging, pattern)?.ok_or_else(|| missing(artifact))?
            } else {
                return Err(missing(artifact));
            };
            #[cfg(unix)]
            ensure_executable(&staging.join(&rel));
            Ok(StoredLauncher::Exe { rel_exe: rel })
        }
    }
}

fn missing(artifact: &ArtifactSpec) -> InstallError {
    InstallError::VerificationFailed(format!("{} fehlt im entpackten Ordner", artifact.launch.exe))
}

/// Erstes Ergebnis (alphabetisch) für ein Muster mit `*` und `**`.
fn find_by_glob(root: &Path, pattern: &str) -> Result<Option<String>, InstallError> {
    let matcher = Glob::new(pattern)
        .map_err(|e| InstallError::VerificationFailed(format!("ungültiges Muster `{pattern}`: {e}")))?
        .compile_matcher();
    let mut hits: Vec<String> = walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.path().strip_prefix(root).ok().map(|p| p.to_string_lossy().replace('\\', "/")))
        .filter(|rel| matcher.is_match(rel))
        .collect();
    hits.sort();
    Ok(hits.into_iter().next())
}

/// ZIP-Archive verlieren mitunter das Ausführungsrecht; für das Startprogramm stellen wir es sicher.
#[cfg(unix)]
fn ensure_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = std::fs::metadata(path)
        && meta.permissions().mode() & 0o111 == 0
    {
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::Os;
    use crate::catalog::{ChecksumOrigin, FileArgs, LaunchSpec};

    fn artifact(kind: ArtifactKind, exe: &str, glob: Option<&str>) -> ArtifactSpec {
        ArtifactSpec {
            os: Os::Windows,
            arch: crate::catalog::ArtifactArch::X86_64,
            kind,
            installer_type: None,
            url: "https://download.blender.org/x".into(),
            file_name: "Test.AppImage".into(),
            size: 1,
            sha256: "0".repeat(64),
            checksum_source: "https://download.blender.org/x.sha256".into(),
            checksum_origin: ChecksumOrigin::Upstream,
            signature: None,
            strip_components: 0,
            unpacked_size_max: 2,
            mac_app_name: Some("Blender.app".into()),
            launch: LaunchSpec {
                exe: exe.into(),
                exe_glob: glob.map(str::to_owned),
                args: vec![],
                file_args: FileArgs::Append,
                portable_marker: None,
            },
        }
    }

    fn touch(root: &Path, rel: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, b"x").unwrap();
    }

    #[test]
    fn exact_path_wins_and_missing_files_fail() {
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "bin/krita.exe");
        let a = artifact(ArtifactKind::Zip, "bin/krita.exe", None);
        assert_eq!(check_content(tmp.path(), &a).unwrap(), StoredLauncher::Exe { rel_exe: "bin/krita.exe".into() });
        let a = artifact(ArtifactKind::Zip, "bin/fehlt.exe", None);
        assert!(
            matches!(check_content(tmp.path(), &a), Err(InstallError::VerificationFailed(m)) if m.contains("fehlt.exe"))
        );
    }

    #[test]
    fn glob_is_the_fallback_for_unknown_layouts() {
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "krita-x64-5.3.4.1/bin/krita.exe");
        let a = artifact(ArtifactKind::Zip, "bin/krita.exe", Some("**/bin/krita.exe"));
        assert_eq!(
            check_content(tmp.path(), &a).unwrap(),
            StoredLauncher::Exe { rel_exe: "krita-x64-5.3.4.1/bin/krita.exe".into() }
        );
        let a = artifact(ArtifactKind::Zip, "bin/krita.exe", Some("**/nirgends.exe"));
        assert!(check_content(tmp.path(), &a).is_err());
    }

    #[test]
    fn mac_apps_need_the_bundle_and_its_executable() {
        let tmp = tempfile::tempdir().unwrap();
        let a = artifact(ArtifactKind::Dmg, "Blender", None);
        assert!(check_content(tmp.path(), &a).is_err());
        touch(tmp.path(), "Blender.app/Contents/MacOS/Blender");
        assert_eq!(check_content(tmp.path(), &a).unwrap(), StoredLauncher::MacApp { rel_bundle: "Blender.app".into() });
    }

    #[test]
    fn appimages_report_the_extracted_apprun() {
        let tmp = tempfile::tempdir().unwrap();
        let a = artifact(ArtifactKind::AppImage, "Test.AppImage", None);
        assert!(check_content(tmp.path(), &a).is_err());
        touch(tmp.path(), "Test.AppImage");
        assert_eq!(
            check_content(tmp.path(), &a).unwrap(),
            StoredLauncher::AppImage { rel_file: "Test.AppImage".into(), rel_app_run: None }
        );
        touch(tmp.path(), "squashfs-root/AppRun");
        assert_eq!(
            check_content(tmp.path(), &a).unwrap(),
            StoredLauncher::AppImage {
                rel_file: "Test.AppImage".into(),
                rel_app_run: Some("squashfs-root/AppRun".into())
            }
        );
    }
}
