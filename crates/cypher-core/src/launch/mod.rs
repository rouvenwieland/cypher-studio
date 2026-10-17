//! `launch` – Programme starten (ARCHITEKTUR.md 2.9). Keine Shell, absolute Programmpfade, Argumente als Liste,
//! Ein-/Ausgabe auf null, vom Cypher-Studio-Prozess entkoppelt, Umgebung bereinigt.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::api::{InstallKind, Installation, LaunchMode, Os};
use crate::error::LaunchError;
use crate::install::appimage::ENV_REMOVE;
use crate::platform::PlatformInfo;
use crate::state::{StoredInstallation, StoredLauncher};

/// Name des Blender-App-Templates (Paket `blender`, ARCHITEKTUR.md 4.9).
pub const BLENDER_APP_TEMPLATE: &str = "cypher_ps2";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Launcher {
    Exe {
        path: PathBuf,
    },
    MacApp {
        bundle: PathBuf,
    },
    AppImage {
        path: PathBuf,
        extract_and_run: bool,
    },
    /// Entpacktes AppImage (`squashfs-root/AppRun`), kein FUSE nötig.
    Extracted {
        app_run: PathBuf,
    },
    Flatpak {
        app_id: String,
    },
    Snap {
        name: String,
    },
    MsStore {
        aumid: String,
    },
}

impl Launcher {
    /// Aus einer verwalteten Installation (Zustand).
    pub fn from_stored(stored: &StoredInstallation, fuse_available: bool) -> Launcher {
        let root = Path::new(&stored.path);
        let join = |rel: &str| rel.split('/').filter(|c| !c.is_empty()).fold(root.to_path_buf(), |p, c| p.join(c));
        match &stored.launcher {
            StoredLauncher::Exe { rel_exe } => Launcher::Exe { path: join(rel_exe) },
            StoredLauncher::MacApp { rel_bundle } => Launcher::MacApp { bundle: join(rel_bundle) },
            StoredLauncher::AppImage { rel_file, rel_app_run } => match rel_app_run {
                Some(run) => Launcher::Extracted { app_run: join(run) },
                None => Launcher::AppImage { path: join(rel_file), extract_and_run: !fuse_available },
            },
        }
    }

    /// Aus einer erkannten Installation.
    pub fn from_detected(installation: &Installation, fuse_available: bool) -> Result<Launcher, LaunchError> {
        let location = installation.location.clone();
        // `location` ist eine Anzeige mit `~`; für Start brauchen wir den echten Pfad. Erkannte Installationen
        // tragen ihn deshalb unverändert, wenn er außerhalb des Home-Ordners liegt; sonst löst der Aufrufer ihn auf.
        let expanded = expand_home(&location);
        Ok(match installation.kind {
            InstallKind::Flatpak => Launcher::Flatpak { app_id: location },
            InstallKind::Snap => {
                let name =
                    Path::new(&location).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(location);
                Launcher::Snap { name }
            }
            InstallKind::Msstore => Launcher::MsStore { aumid: location },
            _ => {
                if expanded.to_string_lossy().ends_with(".app") {
                    Launcher::MacApp { bundle: expanded }
                } else if expanded.to_string_lossy().to_lowercase().ends_with(".appimage") {
                    Launcher::AppImage { path: expanded, extract_and_run: !fuse_available }
                } else {
                    Launcher::Exe { path: expanded }
                }
            }
        })
    }
}

/// `~` am Anfang durch das Home-Verzeichnis ersetzen.
pub fn expand_home(text: &str) -> PathBuf {
    if let Some(rest) = text.strip_prefix('~')
        && let Some(base) = directories::BaseDirs::new()
    {
        let rest = rest.trim_start_matches(['/', '\\']);
        return if rest.is_empty() { base.home_dir().to_path_buf() } else { base.home_dir().join(rest) };
    }
    PathBuf::from(text)
}

/// Fertiger Startbefehl.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub env_remove: Vec<&'static str>,
    pub env_set: Vec<(OsString, OsString)>,
    pub cwd: Option<PathBuf>,
}

fn os_args(items: &[&str]) -> Vec<OsString> {
    items.iter().map(OsString::from).collect()
}

/// Baut den Startbefehl. `program_id` entscheidet, ob das Blender-App-Template angewendet werden darf.
pub fn build(
    launcher: &Launcher,
    program_id: &str,
    files: &[PathBuf],
    mode: LaunchMode,
    platform: &PlatformInfo,
) -> Result<LaunchSpec, LaunchError> {
    let app_template: Vec<OsString> = match mode {
        LaunchMode::Normal => Vec::new(),
        LaunchMode::BlenderAppTemplate if program_id == "blender" => os_args(&["--app-template", BLENDER_APP_TEMPLATE]),
        LaunchMode::BlenderAppTemplate => {
            return Err(LaunchError::NotLaunchable("das App-Template gibt es nur für Blender".into()));
        }
    };
    // Dateien aus Bibliothek, Projekten oder Austauschpaketen können fremd sein: Blender führt die Skripte darin
    // (Treiber, registrierte Textblöcke) nur nach ausdrücklicher Erlaubnis aus. Betrifft nicht die eigenen Add-ons.
    let safety: Vec<OsString> =
        if program_id == "blender" && !files.is_empty() { os_args(&["--disable-autoexec"]) } else { Vec::new() };
    let template: Vec<OsString> = safety.into_iter().chain(app_template).collect();
    let file_args = || files.iter().map(|f| f.as_os_str().to_owned());
    let base = |program: PathBuf, args: Vec<OsString>, cwd: Option<PathBuf>, env_set: Vec<(OsString, OsString)>| {
        LaunchSpec { program, args, env_remove: ENV_REMOVE.to_vec(), env_set, cwd }
    };
    Ok(match launcher {
        Launcher::Exe { path } => {
            let args: Vec<OsString> = template.iter().cloned().chain(file_args()).collect();
            base(path.clone(), args, path.parent().map(Path::to_path_buf), vec![])
        }
        Launcher::MacApp { bundle } => {
            if platform.os != Os::Macos {
                return Err(LaunchError::NotLaunchable(".app läuft nur auf macOS".into()));
            }
            let mut args = os_args(&["-n", "-a"]);
            args.push(bundle.as_os_str().to_owned());
            args.extend(file_args());
            if !template.is_empty() {
                args.push("--args".into());
                args.extend(template.iter().cloned());
            }
            base(PathBuf::from("/usr/bin/open"), args, None, vec![])
        }
        Launcher::AppImage { path, extract_and_run } => {
            let args: Vec<OsString> = template.iter().cloned().chain(file_args()).collect();
            let env = if *extract_and_run { vec![("APPIMAGE_EXTRACT_AND_RUN".into(), "1".into())] } else { vec![] };
            base(path.clone(), args, path.parent().map(Path::to_path_buf), env)
        }
        Launcher::Extracted { app_run } => {
            let args: Vec<OsString> = template.iter().cloned().chain(file_args()).collect();
            base(app_run.clone(), args, app_run.parent().map(Path::to_path_buf), vec![])
        }
        Launcher::Flatpak { app_id } => {
            let flatpak =
                which::which("flatpak").map_err(|_| LaunchError::NotLaunchable("flatpak nicht gefunden".into()))?;
            let mut args = os_args(&["run"]);
            args.push(app_id.into());
            args.extend(template.iter().cloned());
            args.extend(file_args());
            base(flatpak, args, None, vec![])
        }
        Launcher::Snap { name } => {
            let args: Vec<OsString> = template.iter().cloned().chain(file_args()).collect();
            base(PathBuf::from("/snap/bin").join(name), args, None, vec![])
        }
        Launcher::MsStore { aumid } => {
            let mut args = Vec::new();
            args.push(OsString::from(format!("shell:AppsFolder\\{aumid}")));
            base(PathBuf::from("explorer.exe"), args, None, vec![])
        }
    })
}

/// Entfernt Einträge, die mit dem Ordner `appdir` beginnen, aus einer Pfadliste (`PATH`, `XDG_DATA_DIRS`).
pub fn strip_appdir(value: &str, appdir: &str, sep: char) -> String {
    value.split(sep).filter(|e| !e.starts_with(appdir)).collect::<Vec<_>>().join(&sep.to_string())
}

/// Startet entkoppelt. Gibt die Prozess-ID zurück (außer bei Vermittlern wie `open`, Flatpak, Store: dort ist sie
/// die des Vermittlers).
pub fn spawn(spec: &LaunchSpec) -> Result<Option<u32>, LaunchError> {
    use std::process::{Command, Stdio};
    if !spec.program.is_absolute() && spec.program.components().count() > 1 {
        return Err(LaunchError::NotLaunchable("Programmpfad ist nicht absolut".into()));
    }
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if let Some(cwd) = &spec.cwd
        && cwd.is_dir()
    {
        cmd.current_dir(cwd);
    }
    for var in &spec.env_remove {
        cmd.env_remove(var);
    }
    for (key, _) in std::env::vars_os().filter(|(k, _)| k.to_string_lossy().starts_with("WEBKIT_")) {
        cmd.env_remove(key);
    }
    // Läuft Cypher Studio selbst als AppImage, zeigen PATH und XDG_DATA_DIRS in dessen Bundle
    if let Some(appdir) = std::env::var_os("APPDIR").map(|v| v.to_string_lossy().into_owned()).filter(|a| !a.is_empty())
    {
        for var in ["PATH", "XDG_DATA_DIRS"] {
            if let Ok(value) = std::env::var(var) {
                cmd.env(var, strip_appdir(&value, &appdir, ':'));
            }
        }
    }
    for (key, value) in &spec.env_set {
        cmd.env(key, value);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let child = cmd
        .spawn()
        .map_err(|e| LaunchError::Spawn { program: spec.program.display().to_string(), reason: e.to_string() })?;
    let pid = child.id();
    // Der Prozess läuft weiter, auch wenn Cypher Studio endet; die Kennung wird nicht eingesammelt.
    drop(child);
    Ok(Some(pid))
}

/// Anzahl laufender Prozesse, die genau diese Datei ausführen.
pub fn running_instances(exe: &Path) -> usize {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(sysinfo::UpdateKind::Always),
    );
    sys.processes().values().filter(|p| p.exe().is_some_and(|e| e == exe)).count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::Arch;

    fn plat(os: Os) -> PlatformInfo {
        PlatformInfo::fixed(os, Arch::X86_64)
    }

    fn strings(spec: &LaunchSpec) -> Vec<String> {
        spec.args.iter().map(|a| a.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn exe_gets_files_as_arguments_and_its_folder_as_cwd() {
        let l = Launcher::Exe { path: PathBuf::from("/data/programs/krita/5.3.4.1/bin/krita.exe") };
        let spec = build(
            &l,
            "krita",
            &[PathBuf::from("/p/a.kra"), PathBuf::from("/p/b with space.kra")],
            LaunchMode::Normal,
            &plat(Os::Windows),
        )
        .unwrap();
        assert_eq!(spec.program, Path::new("/data/programs/krita/5.3.4.1/bin/krita.exe"));
        assert_eq!(strings(&spec), ["/p/a.kra", "/p/b with space.kra"]);
        assert_eq!(spec.cwd.as_deref(), Some(Path::new("/data/programs/krita/5.3.4.1/bin")));
        assert!(spec.env_remove.contains(&"LD_LIBRARY_PATH") && spec.env_remove.contains(&"APPDIR"));
    }

    #[test]
    fn blender_app_template_comes_before_the_file() {
        let l = Launcher::Exe { path: PathBuf::from("/b/blender") };
        let spec =
            build(&l, "blender", &[PathBuf::from("/p/m.blend")], LaunchMode::BlenderAppTemplate, &plat(Os::Linux))
                .unwrap();
        assert_eq!(strings(&spec), ["--disable-autoexec", "--app-template", "cypher_ps2", "/p/m.blend"]);
        assert!(
            build(&l, "krita", &[], LaunchMode::BlenderAppTemplate, &plat(Os::Linux)).is_err(),
            "Template nur für Blender"
        );
    }

    #[test]
    fn blender_runs_no_scripts_from_foreign_files_but_other_programs_get_no_extra_flag() {
        let blender = Launcher::Exe { path: PathBuf::from("/b/blender") };
        let files = [PathBuf::from("/lib/fremd.blend")];
        let normal = build(&blender, "blender", &files, LaunchMode::Normal, &plat(Os::Linux)).unwrap();
        assert_eq!(strings(&normal), ["--disable-autoexec", "/lib/fremd.blend"]);
        let empty = build(&blender, "blender", &[], LaunchMode::Normal, &plat(Os::Linux)).unwrap();
        assert!(strings(&empty).is_empty(), "ohne Datei nichts Besonderes");
        let krita = Launcher::Exe { path: PathBuf::from("/k/krita") };
        let spec =
            build(&krita, "krita", &[PathBuf::from("/lib/a.kra")], LaunchMode::Normal, &plat(Os::Linux)).unwrap();
        assert_eq!(strings(&spec), ["/lib/a.kra"]);
    }

    #[test]
    fn mac_apps_start_through_open_with_args_after_the_files() {
        let l = Launcher::MacApp { bundle: PathBuf::from("/Users/a/Applications/Cypher Studio/Blender.app") };
        let spec =
            build(&l, "blender", &[PathBuf::from("/p/m.blend")], LaunchMode::BlenderAppTemplate, &plat(Os::Macos))
                .unwrap();
        assert_eq!(spec.program, Path::new("/usr/bin/open"));
        assert_eq!(
            strings(&spec),
            [
                "-n",
                "-a",
                "/Users/a/Applications/Cypher Studio/Blender.app",
                "/p/m.blend",
                "--args",
                "--disable-autoexec",
                "--app-template",
                "cypher_ps2"
            ]
        );
        assert!(build(&l, "blender", &[], LaunchMode::Normal, &plat(Os::Linux)).is_err());
    }

    #[test]
    fn appimages_without_fuse_run_with_extract_and_run() {
        let direct = Launcher::AppImage { path: PathBuf::from("/d/Krita.AppImage"), extract_and_run: false };
        assert!(build(&direct, "krita", &[], LaunchMode::Normal, &plat(Os::Linux)).unwrap().env_set.is_empty());
        let fallback = Launcher::AppImage { path: PathBuf::from("/d/Krita.AppImage"), extract_and_run: true };
        let spec = build(&fallback, "krita", &[], LaunchMode::Normal, &plat(Os::Linux)).unwrap();
        assert_eq!(spec.env_set, vec![(OsString::from("APPIMAGE_EXTRACT_AND_RUN"), OsString::from("1"))]);
        let extracted = Launcher::Extracted { app_run: PathBuf::from("/d/squashfs-root/AppRun") };
        let spec =
            build(&extracted, "krita", &[PathBuf::from("/p/a.kra")], LaunchMode::Normal, &plat(Os::Linux)).unwrap();
        assert_eq!(spec.program, Path::new("/d/squashfs-root/AppRun"));
        assert_eq!(spec.cwd.as_deref(), Some(Path::new("/d/squashfs-root")));
    }

    #[test]
    fn snap_store_and_flatpak_commands() {
        let snap =
            build(&Launcher::Snap { name: "blender".into() }, "blender", &[], LaunchMode::Normal, &plat(Os::Linux))
                .unwrap();
        assert_eq!(snap.program, Path::new("/snap/bin/blender"));
        let store = build(
            &Launcher::MsStore { aumid: "49800Krita_x!Krita".into() },
            "krita",
            &[],
            LaunchMode::Normal,
            &plat(Os::Windows),
        )
        .unwrap();
        assert_eq!(store.program, Path::new("explorer.exe"));
        assert_eq!(strings(&store), ["shell:AppsFolder\\49800Krita_x!Krita"]);
        if which::which("flatpak").is_ok() {
            let fp = build(
                &Launcher::Flatpak { app_id: "org.kde.krita".into() },
                "krita",
                &[PathBuf::from("/p/a.kra")],
                LaunchMode::Normal,
                &plat(Os::Linux),
            )
            .unwrap();
            assert_eq!(strings(&fp), ["run", "org.kde.krita", "/p/a.kra"]);
        }
    }

    #[test]
    fn launchers_are_derived_from_state_and_detection() {
        let stored = StoredInstallation {
            id: "cypher:krita:5.3.4.1".into(),
            program_id: "krita".into(),
            version: "5.3.4.1".into(),
            kind: "cypher".into(),
            path: "/data/programs/krita/5.3.4.1".into(),
            launcher: StoredLauncher::AppImage { rel_file: "k.AppImage".into(), rel_app_run: None },
            programs_root: None,
            installed_at: String::new(),
            verified: crate::state::StoredVerified {
                sha256: String::new(),
                catalog_sequence: 1,
                signature_checked: false,
            },
            artifact: crate::state::StoredArtifact { url: String::new(), kind: String::new() },
            not_notarized: false,
        };
        assert_eq!(
            Launcher::from_stored(&stored, true),
            Launcher::AppImage {
                path: PathBuf::from("/data/programs/krita/5.3.4.1/k.AppImage"),
                extract_and_run: false
            }
        );
        assert_eq!(
            Launcher::from_stored(&stored, false),
            Launcher::AppImage {
                path: PathBuf::from("/data/programs/krita/5.3.4.1/k.AppImage"),
                extract_and_run: true
            }
        );
        let mut extracted = stored.clone();
        extracted.launcher = StoredLauncher::AppImage {
            rel_file: "k.AppImage".into(),
            rel_app_run: Some("squashfs-root/AppRun".into()),
        };
        assert_eq!(
            Launcher::from_stored(&extracted, false),
            Launcher::Extracted { app_run: PathBuf::from("/data/programs/krita/5.3.4.1/squashfs-root/AppRun") }
        );
    }

    #[test]
    fn appdir_entries_are_stripped_from_path_lists() {
        assert_eq!(strip_appdir("/tmp/.mount_x/usr/bin:/usr/bin:/bin", "/tmp/.mount_x", ':'), "/usr/bin:/bin");
        assert_eq!(strip_appdir("/usr/bin", "/tmp/.mount_x", ':'), "/usr/bin");
    }

    #[cfg(unix)]
    #[test]
    fn spawn_detaches_cleans_the_environment_and_applies_settings() {
        let tmp = tempfile::tempdir().unwrap();
        let out = tmp.path().join("out.txt");
        // Variablen aus dem Entfernen-Katalog werden nicht vererbt, eigene werden gesetzt
        // SAFETY-Hinweis: Das Testprogramm setzt die Variable nur für das Kind (env_set), nicht im Testprozess.
        let spec = LaunchSpec {
            program: PathBuf::from("/bin/sh"),
            args: vec![
                "-c".into(),
                format!("echo \"[$EXTRA][${{PYTHONHOME-fehlt}}][$1]\" > '{}'", out.display()).into(),
                "x".into(),
                "datei mit leerzeichen".into(),
            ],
            env_remove: ENV_REMOVE.to_vec(),
            env_set: vec![("EXTRA".into(), "ja".into())],
            cwd: Some(tmp.path().to_path_buf()),
        };
        let pid = spawn(&spec).unwrap();
        assert!(pid.is_some());
        for _ in 0..100 {
            if out.exists() && std::fs::metadata(&out).map(|m| m.len() > 0).unwrap_or(false) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let text = std::fs::read_to_string(&out).unwrap();
        assert_eq!(text.trim(), "[ja][fehlt][datei mit leerzeichen]");
    }

    #[test]
    fn spawn_reports_missing_programs() {
        let spec = LaunchSpec {
            program: std::env::temp_dir().join("gibt-es-nicht").join("programm"),
            args: vec![],
            env_remove: vec![],
            env_set: vec![],
            cwd: None,
        };
        assert!(matches!(spawn(&spec), Err(LaunchError::Spawn { .. })));
        let relative = LaunchSpec { program: PathBuf::from("etwas/relatives"), ..spec };
        assert!(matches!(spawn(&relative), Err(LaunchError::NotLaunchable(_))));
    }
}
