//! Erkennungsstrategien je Betriebssystem (ARCHITEKTUR.md 2.8). Die Regeln stehen als Daten im Katalog
//! (`programs[].detect`), die Mechanik hier.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use globset::Glob;

use super::version::extract_version;
use super::{DetectEnv, Found, UninstallEntry};
use crate::api::{InstallKind, Os};
use crate::catalog::ProgramSpec;

/// Windows-Pfade auf Nicht-Windows-Systemen (Fixture-Tests) mit `/` statt `\` lesbar machen; auf Windows unverändert.
fn norm(text: &str) -> String {
    if cfg!(windows) { text.to_owned() } else { text.replace('\\', "/") }
}

const SHORT: Duration = Duration::from_secs(5);
const MDFIND: Duration = Duration::from_secs(3);

pub(super) fn detect_program(env: &DetectEnv, p: &ProgramSpec) -> Vec<Found> {
    match env.platform.os {
        Os::Windows => windows(env, p),
        Os::Macos => macos(env, p),
        Os::Linux => linux(env, p),
    }
}

pub(super) fn probe_manual(env: &DetectEnv, p: &ProgramSpec, picked: &Path) -> Option<Found> {
    let name = picked.file_name()?.to_string_lossy().into_owned();
    let lower = name.to_lowercase();
    let make = |location: &Path, version: Option<String>| Found {
        program_id: p.id.clone(),
        kind: InstallKind::Manual,
        location: location.to_string_lossy().into_owned(),
        is_path: true,
        version,
    };
    match env.platform.os {
        Os::Windows => {
            let spec = p.detect.windows.as_ref()?;
            if env.fs.exists(picked) && spec.exe_names.iter().any(|e| e.to_lowercase() == lower) {
                let version =
                    picked.parent().and_then(|d| d.file_name()).and_then(|n| extract_version(&n.to_string_lossy()));
                return Some(make(picked, version));
            }
            None
        }
        Os::Macos => {
            let spec = p.detect.macos.as_ref()?;
            if !env.fs.is_dir(picked) || !lower.ends_with(".app") {
                return None;
            }
            let plist = read_plist(env, &picked.join("Contents").join("Info.plist"));
            let id_matches = plist
                .as_ref()
                .is_some_and(|pl| spec.bundle_ids.iter().any(|b| Some(b.as_str()) == pl.bundle_id.as_deref()));
            let name_matches = spec.app_names.iter().any(|a| a.to_lowercase() == lower);
            (id_matches || name_matches).then(|| make(picked, plist.and_then(|pl| pl.version)))
        }
        Os::Linux => {
            let spec = p.detect.linux.as_ref()?;
            if !env.fs.exists(picked) {
                return None;
            }
            let app_image = spec
                .app_image_globs
                .iter()
                .filter_map(|g| Glob::new(g).ok())
                .any(|g| g.compile_matcher().is_match(&name));
            let bin = spec.bin_names.iter().any(|b| b.to_lowercase() == lower);
            (app_image || bin).then(|| make(picked, extract_version(&name)))
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Pfadmuster mit * (ohne Shell)
// ---------------------------------------------------------------------------------------------

/// Löst ein Muster mit `*`/`?` in einzelnen Pfadkomponenten über `FsProbe::read_dir` auf.
fn expand_glob(env: &DetectEnv, pattern: &Path) -> Vec<PathBuf> {
    let mut current: Vec<PathBuf> = vec![PathBuf::new()];
    for comp in pattern.components() {
        let text = comp.as_os_str().to_string_lossy().into_owned();
        let mut next = Vec::new();
        if text.contains('*') || text.contains('?') {
            let Ok(glob) = Glob::new(&text) else { return Vec::new() };
            let matcher = glob.compile_matcher();
            for base in &current {
                for entry in env.fs.read_dir(base) {
                    if entry.file_name().is_some_and(|n| matcher.is_match(n.to_string_lossy().as_ref())) {
                        next.push(entry);
                    }
                }
            }
        } else {
            for base in &current {
                next.push(base.join(comp.as_os_str()));
            }
        }
        current = next;
    }
    current.retain(|p| env.fs.exists(p));
    current.sort();
    current
}

// ---------------------------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------------------------

fn windows(env: &DetectEnv, p: &ProgramSpec) -> Vec<Found> {
    let Some(spec) = p.detect.windows.as_ref() else { return Vec::new() };
    let mut out = Vec::new();
    let found = |exe: &Path, version: Option<String>, kind: InstallKind| Found {
        program_id: p.id.clone(),
        kind,
        location: exe.to_string_lossy().into_owned(),
        is_path: true,
        version,
    };

    // 1. Programmliste der Registry
    for entry in env.registry.uninstall_entries() {
        if !spec
            .uninstall_display_name_prefixes
            .iter()
            .any(|pre| !pre.is_empty() && entry.display_name.starts_with(pre.as_str()))
        {
            continue;
        }
        for dir in entry_dirs(&entry) {
            if let Some(exe) = find_exe(env, &dir, &spec.exe_names) {
                let version = entry
                    .display_version
                    .clone()
                    .or_else(|| dir.file_name().and_then(|n| extract_version(&n.to_string_lossy())));
                out.push(found(&exe, version, InstallKind::System));
                break;
            }
        }
    }

    // 2. bekannte Pfade
    for pattern in &spec.known_paths {
        for expanded in substitute_windows(env, pattern) {
            for exe in expand_glob(env, &expanded) {
                let version =
                    exe.parent().and_then(|d| d.file_name()).and_then(|n| extract_version(&n.to_string_lossy()));
                out.push(found(&exe, version, InstallKind::System));
            }
        }
    }

    // 3. Steam
    if let Some(app_id) = spec.steam_app_id {
        for exe in steam_executables(env, app_id, &spec.exe_names) {
            out.push(found(&exe, None, InstallKind::Steam));
        }
    }
    out
}

/// Kandidaten-Ordner eines Registry-Eintrags: `InstallLocation`, Ordner von `DisplayIcon`.
fn entry_dirs(e: &UninstallEntry) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(loc) = &e.install_location {
        dirs.push(PathBuf::from(norm(loc.trim_matches('"'))));
    }
    if let Some(icon) = &e.display_icon {
        // "C:\Program Files\X\x.exe",0
        let path = norm(icon.trim().split(',').next().unwrap_or("").trim().trim_matches('"'));
        if let Some(parent) = Path::new(&path).parent().filter(|p| !p.as_os_str().is_empty()) {
            dirs.push(parent.to_path_buf());
        }
    }
    dirs
}

fn find_exe(env: &DetectEnv, dir: &Path, exe_names: &[String]) -> Option<PathBuf> {
    for sub in ["", "bin"] {
        for name in exe_names {
            let candidate = if sub.is_empty() { dir.join(name) } else { dir.join(sub).join(name) };
            if env.fs.exists(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn substitute_windows(env: &DetectEnv, pattern: &str) -> Vec<PathBuf> {
    if pattern.contains("{ProgramFiles}") {
        env.known
            .program_files
            .iter()
            .map(|pf| PathBuf::from(norm(&pattern.replace("{ProgramFiles}", &pf.to_string_lossy()))))
            .collect()
    } else if pattern.contains("{LocalAppData}") {
        env.known
            .local_appdata
            .iter()
            .map(|la| PathBuf::from(norm(&pattern.replace("{LocalAppData}", &la.to_string_lossy()))))
            .collect()
    } else {
        vec![PathBuf::from(norm(pattern))]
    }
}

/// `libraryfolders.vdf` auslesen: Zeilen der Form `"path"  "D:\\SteamLibrary"`.
fn vdf_values(text: &str, key: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split('"').filter(|s| !s.trim().is_empty());
            let k = parts.next()?;
            let v = parts.next()?;
            (k == key).then(|| v.replace("\\\\", "\\"))
        })
        .collect()
}

fn steam_executables(env: &DetectEnv, app_id: u64, exe_names: &[String]) -> Vec<PathBuf> {
    let mut libraries: Vec<PathBuf> = Vec::new();
    for pf in &env.known.program_files {
        let steam = pf.join("Steam");
        let vdf = steam.join("steamapps").join("libraryfolders.vdf");
        if let Some(text) = env.fs.read(&vdf).map(|b| String::from_utf8_lossy(&b).into_owned()) {
            libraries.extend(vdf_values(&text, "path").into_iter().map(|p| PathBuf::from(norm(&p))));
        }
        libraries.push(steam);
    }
    let mut out = Vec::new();
    for lib in libraries {
        let manifest = lib.join("steamapps").join(format!("appmanifest_{app_id}.acf"));
        let Some(text) = env.fs.read(&manifest).map(|b| String::from_utf8_lossy(&b).into_owned()) else { continue };
        let Some(dir) = vdf_values(&text, "installdir").into_iter().next() else { continue };
        let root = lib.join("steamapps").join("common").join(dir);
        if let Some(exe) = find_exe(env, &root, exe_names)
            && !out.contains(&exe)
        {
            out.push(exe);
        }
    }
    out
}

// ---------------------------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------------------------

struct PlistInfo {
    bundle_id: Option<String>,
    version: Option<String>,
}

fn read_plist(env: &DetectEnv, path: &Path) -> Option<PlistInfo> {
    let bytes = env.fs.read(path)?;
    let value = plist::Value::from_reader(std::io::Cursor::new(bytes)).ok()?;
    let dict = value.as_dictionary()?;
    let text = |key: &str| dict.get(key).and_then(plist::Value::as_string).map(str::to_owned);
    Some(PlistInfo {
        bundle_id: text("CFBundleIdentifier"),
        version: text("CFBundleShortVersionString").or_else(|| text("CFBundleVersion")),
    })
}

fn macos(env: &DetectEnv, p: &ProgramSpec) -> Vec<Found> {
    let Some(spec) = p.detect.macos.as_ref() else { return Vec::new() };
    let mut bundles: Vec<PathBuf> = Vec::new();
    for dir in env.known.mac_applications() {
        for name in &spec.app_names {
            let candidate = dir.join(name);
            if env.fs.is_dir(&candidate) {
                bundles.push(candidate);
            }
        }
    }
    // Spotlight: findet Apps an beliebigen Orten
    for bundle_id in &spec.bundle_ids {
        let args: Vec<OsString> = vec![format!("kMDItemCFBundleIdentifier == '{bundle_id}'").into()];
        if let Ok(out) = env.cmd.run(Path::new("/usr/bin/mdfind"), &args, MDFIND)
            && out.success()
        {
            for line in out.stdout_text().lines() {
                let path = PathBuf::from(line.trim());
                if line.trim().ends_with(".app") && env.fs.is_dir(&path) && !bundles.contains(&path) {
                    bundles.push(path);
                }
            }
        }
    }
    bundles
        .into_iter()
        .map(|bundle| {
            let info = read_plist(env, &bundle.join("Contents").join("Info.plist"));
            Found {
                program_id: p.id.clone(),
                kind: InstallKind::System,
                location: bundle.to_string_lossy().into_owned(),
                is_path: true,
                version: info.and_then(|i| i.version),
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------------------------

fn find_in_path(env: &DetectEnv, name: &str) -> Option<PathBuf> {
    env.path_dirs.iter().map(|d| d.join(name)).find(|c| env.fs.exists(c))
}

fn linux(env: &DetectEnv, p: &ProgramSpec) -> Vec<Found> {
    let Some(spec) = p.detect.linux.as_ref() else { return Vec::new() };
    let mut out = Vec::new();

    // 1. Flatpak
    if !spec.flatpak_ids.is_empty()
        && let Some(flatpak) = find_in_path(env, "flatpak")
    {
        let args: Vec<OsString> =
            ["list", "--app", "--columns=application,version,installation"].iter().map(Into::into).collect();
        if let Ok(res) = env.cmd.run(&flatpak, &args, SHORT)
            && res.success()
        {
            for line in res.stdout_text().lines() {
                let cols: Vec<&str> = line.split('\t').map(str::trim).collect();
                if let Some(id) = cols.first()
                    && spec.flatpak_ids.iter().any(|f| f == id)
                {
                    out.push(Found {
                        program_id: p.id.clone(),
                        kind: InstallKind::Flatpak,
                        location: (*id).to_owned(),
                        is_path: false,
                        version: cols.get(1).filter(|v| !v.is_empty()).map(|v| (*v).to_owned()),
                    });
                }
            }
        }
    }

    // 2. Snap
    if !spec.snap_names.is_empty()
        && let Some(snap) = find_in_path(env, "snap")
    {
        let args: Vec<OsString> = vec!["list".into()];
        if let Ok(res) = env.cmd.run(&snap, &args, SHORT)
            && res.success()
        {
            for line in res.stdout_text().lines().skip(1) {
                let cols: Vec<&str> = line.split_whitespace().collect();
                if let Some(name) = cols.first()
                    && spec.snap_names.iter().any(|s| s == name)
                {
                    out.push(Found {
                        program_id: p.id.clone(),
                        kind: InstallKind::Snap,
                        location: format!("/snap/bin/{name}"),
                        is_path: true,
                        version: cols.get(1).and_then(|v| extract_version(v)),
                    });
                }
            }
        }
    }

    // 3. PATH
    for bin in &spec.bin_names {
        if let Some(path) = find_in_path(env, bin) {
            let version = if spec.version_probe {
                let args: Vec<OsString> = vec!["--version".into()];
                env.cmd
                    .run(&path, &args, SHORT)
                    .ok()
                    .filter(|o| o.success())
                    .and_then(|o| extract_version(&o.stdout_text()))
            } else {
                None
            };
            out.push(Found {
                program_id: p.id.clone(),
                kind: InstallKind::System,
                location: path.to_string_lossy().into_owned(),
                is_path: true,
                version,
            });
        }
    }

    // 4. AppImages in ~/Applications
    if let Some(home) = &env.known.home {
        let dir = home.join("Applications");
        let matchers: Vec<_> =
            spec.app_image_globs.iter().filter_map(|g| Glob::new(g).ok()).map(|g| g.compile_matcher()).collect();
        for entry in env.fs.read_dir(&dir) {
            let Some(name) = entry.file_name().map(|n| n.to_string_lossy().into_owned()) else { continue };
            if matchers.iter().any(|m| m.is_match(&name)) {
                out.push(Found {
                    program_id: p.id.clone(),
                    kind: InstallKind::System,
                    location: entry.to_string_lossy().into_owned(),
                    is_path: true,
                    version: extract_version(&name),
                });
            }
        }
    }

    // 5. .desktop-Dateien (Exec-Zeile lesen, nichts ausführen)
    let mut apps_dirs: Vec<PathBuf> =
        vec![PathBuf::from("/usr/share/applications"), PathBuf::from("/usr/local/share/applications")];
    if let Some(data) = env.known.xdg_data() {
        apps_dirs.insert(0, data.join("applications"));
    }
    for dir in apps_dirs {
        for entry in env.fs.read_dir(&dir) {
            if entry.extension().is_none_or(|e| e != "desktop") {
                continue;
            }
            let Some(text) = env.fs.read(&entry).map(|b| String::from_utf8_lossy(&b).into_owned()) else { continue };
            if let Some(exec) = desktop_exec_binary(&text)
                && let Some(base) = Path::new(&exec).file_name().map(|n| n.to_string_lossy().into_owned())
                && spec.bin_names.contains(&base)
            {
                let path =
                    if Path::new(&exec).is_absolute() { Some(PathBuf::from(&exec)) } else { find_in_path(env, &exec) };
                if let Some(path) = path.filter(|p| env.fs.exists(p)) {
                    out.push(Found {
                        program_id: p.id.clone(),
                        kind: InstallKind::System,
                        location: path.to_string_lossy().into_owned(),
                        is_path: true,
                        version: None,
                    });
                }
            }
        }
    }
    out
}

/// Erstes Programm der `Exec=`-Zeile eines Desktop-Eintrags (`env VAR=x prog %U` → `prog`).
fn desktop_exec_binary(text: &str) -> Option<String> {
    let line = text.lines().map(str::trim).find(|l| l.starts_with("Exec="))?;
    let mut tokens = line["Exec=".len()..].split_whitespace().map(|t| t.trim_matches('"'));
    let mut first = tokens.next()?;
    if first == "env" {
        first = tokens.find(|t| !t.contains('='))?;
    }
    (!first.is_empty() && !first.starts_with('%')).then(|| first.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_exec_lines() {
        assert_eq!(desktop_exec_binary("[Desktop Entry]\nExec=blender %f\n").as_deref(), Some("blender"));
        assert_eq!(desktop_exec_binary("Exec=/usr/bin/krita %U").as_deref(), Some("/usr/bin/krita"));
        assert_eq!(desktop_exec_binary("Exec=env QT_X=1 inkscape %F").as_deref(), Some("inkscape"));
        assert_eq!(desktop_exec_binary("Name=x").as_deref(), None);
    }

    #[test]
    fn vdf_values_are_unescaped() {
        let text = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}\n";
        assert_eq!(vdf_values(text, "path"), ["D:\\SteamLibrary"]);
        assert_eq!(vdf_values("\"installdir\"\t\"Blender\"", "installdir"), ["Blender"]);
    }

    #[test]
    fn registry_icon_paths_are_cleaned() {
        let e = UninstallEntry {
            display_icon: Some("\"C:\\Program Files\\Krita (x64)\\bin\\krita.exe\",0".into()),
            ..Default::default()
        };
        let dirs = entry_dirs(&e);
        assert_eq!(dirs.len(), 1);
        assert!(
            dirs[0].to_string_lossy().ends_with("bin") || dirs[0].to_string_lossy().ends_with("krita.exe"),
            "{:?}",
            dirs[0]
        );
    }
}
