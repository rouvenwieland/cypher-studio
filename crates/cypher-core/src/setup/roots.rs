//! Zielwurzeln der Einrichtung je Programm, Betriebssystem und Installationsart (ARCHITEKTUR.md 7.4, ANNAHME A-06).
//!
//! Die Wurzeln sind Code, nicht Katalogdaten: Ein manipulierter Katalog oder ein Paket kann Schreibziele nicht umlenken.
//! Ein *Geltungsbereich* (`ResolvedScope`) fasst alle Installationen zusammen, die dasselbe Profil benutzen.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::api::{InstallKind, Os, ScopeKind, SetupUnsupportedReason};
use crate::catalog::ProgVer;
use crate::platform::KnownDirs;
use crate::util::short_hash;

use super::pack::PackManifest;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RootId {
    KritaResources,
    InkscapeProfile,
    BlenderConfig,
    BlenderScripts,
    BlenderExtensions,
    BlenderExtensionConfig,
    KdenliveData,
    KdenliveLocalData,
    UserFonts,
    ProjectTemplates,
}

impl RootId {
    pub const fn as_str(self) -> &'static str {
        match self {
            RootId::KritaResources => "kritaResources",
            RootId::InkscapeProfile => "inkscapeProfile",
            RootId::BlenderConfig => "blenderConfig",
            RootId::BlenderScripts => "blenderScripts",
            RootId::BlenderExtensions => "blenderExtensions",
            RootId::BlenderExtensionConfig => "blenderExtensionConfig",
            RootId::KdenliveData => "kdenliveData",
            RootId::KdenliveLocalData => "kdenliveLocalData",
            RootId::UserFonts => "userFonts",
            RootId::ProjectTemplates => "projectTemplates",
        }
    }
}

/// Umgebung, aus der die Wurzeln berechnet werden (testbar mit festen Ordnern).
#[derive(Debug, Clone)]
pub struct RootsEnv {
    pub os: Os,
    pub known: KnownDirs,
    /// Datenordner der App (`<data>`), z. B. für eigene Vorlagen.
    pub data_dir: PathBuf,
    /// `INKSCAPE_PROFILE_DIR`, falls gesetzt.
    pub inkscape_profile_dir: Option<PathBuf>,
}

impl RootsEnv {
    pub fn from_system(data_dir: PathBuf) -> Self {
        RootsEnv {
            os: Os::current(),
            known: KnownDirs::from_env(),
            data_dir,
            inkscape_profile_dir: std::env::var_os("INKSCAPE_PROFILE_DIR")
                .map(PathBuf::from)
                .filter(|p| !p.as_os_str().is_empty()),
        }
    }
}

/// Eine für die Einrichtung relevante Installation (echte Pfade, nicht die Anzeigeform).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetupInstall {
    pub id: String,
    pub program_id: String,
    pub kind: InstallKind,
    pub version: Option<String>,
    /// Installationsordner (Cypher) bzw. Startdatei/`.app`/AppImage (System).
    pub path: PathBuf,
    /// Startdatei für Hilfsaufrufe (Blender-Kommandozeile).
    pub exe: Option<PathBuf>,
}

/// Wo und wie eingerichtet wird.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedScope {
    pub scope_id: String,
    pub program_id: Option<String>,
    pub kind: ScopeKind,
    pub roots: BTreeMap<RootId, PathBuf>,
    pub installation_ids: Vec<String>,
    /// Gesetzt, wenn hier nicht eingerichtet werden kann.
    pub unsupported: Option<SetupUnsupportedReason>,
    /// Startdatei der (ersten) Installation, für `blenderExtensionInstall`.
    pub exe: Option<PathBuf>,
    pub install_kind: Option<InstallKind>,
}

fn join_all(base: PathBuf, parts: &[&str]) -> PathBuf {
    parts.iter().fold(base, |p, c| p.join(c))
}

/// `5.2.2` -> `5.2`.
fn blender_series(version: &str) -> Option<String> {
    ProgVer::parse(version).ok().map(|v| v.major_minor())
}

type RootMap = BTreeMap<RootId, PathBuf>;

fn krita_roots(env: &RootsEnv, i: &SetupInstall) -> Option<(ScopeKind, RootMap)> {
    let (kind, dir) = match (i.kind, env.os) {
        (InstallKind::Flatpak, _) => {
            (ScopeKind::FlatpakProfile, join_all(env.known.flatpak_app_dir("org.kde.krita")?, &["data", "krita"]))
        }
        (_, Os::Windows) => (ScopeKind::UserProfile, env.known.roaming_appdata()?.join("krita")),
        (_, Os::Macos) => (ScopeKind::UserProfile, env.known.mac_app_support()?.join("Krita")),
        (_, Os::Linux) => (ScopeKind::UserProfile, env.known.xdg_data()?.join("krita")),
    };
    Some((kind, RootMap::from([(RootId::KritaResources, dir)])))
}

fn inkscape_roots(env: &RootsEnv, i: &SetupInstall) -> Option<(ScopeKind, RootMap)> {
    let (kind, dir) = match (i.kind, env.os) {
        (InstallKind::Flatpak, _) => (
            ScopeKind::FlatpakProfile,
            join_all(env.known.flatpak_app_dir("org.inkscape.Inkscape")?, &["config", "inkscape"]),
        ),
        (_, Os::Windows) => (
            ScopeKind::UserProfile,
            env.inkscape_profile_dir.clone().or_else(|| env.known.roaming_appdata().map(|a| a.join("inkscape")))?,
        ),
        (_, Os::Macos) => (
            ScopeKind::UserProfile,
            join_all(env.known.mac_app_support()?, &["org.inkscape.Inkscape", "config", "inkscape"]),
        ),
        (_, Os::Linux) => (ScopeKind::UserProfile, env.known.xdg_config()?.join("inkscape")),
    };
    Some((kind, RootMap::from([(RootId::InkscapeProfile, dir)])))
}

fn blender_roots(env: &RootsEnv, i: &SetupInstall) -> Option<(ScopeKind, RootMap)> {
    let series = blender_series(i.version.as_deref()?)?;
    let (kind, config) = match (i.kind, env.os) {
        (InstallKind::Flatpak, _) => (
            ScopeKind::FlatpakProfile,
            join_all(env.known.flatpak_app_dir("org.blender.Blender")?, &["config", "blender", &series]),
        ),
        // Von Cypher installiert (Windows, Linux): eigenes Profil im Ordner `portable` neben dem Programm
        (InstallKind::Cypher, Os::Windows | Os::Linux) => (ScopeKind::PortableInstall, i.path.join("portable")),
        (_, Os::Windows) => (
            ScopeKind::UserProfile,
            join_all(env.known.roaming_appdata()?, &["Blender Foundation", "Blender", &series]),
        ),
        (_, Os::Macos) => (ScopeKind::UserProfile, join_all(env.known.mac_app_support()?, &["Blender", &series])),
        (_, Os::Linux) => (ScopeKind::UserProfile, join_all(env.known.xdg_config()?, &["blender", &series])),
    };
    let scripts = config.join("scripts");
    let extensions = config.join("extensions");
    // `bpy.utils.extension_path_user("bl_ext.user_default.cypher_export")`
    let extension_config = join_all(extensions.clone(), &[".user", "user_default", "cypher_export"]);
    Some((
        kind,
        RootMap::from([
            (RootId::BlenderConfig, config),
            (RootId::BlenderScripts, scripts),
            (RootId::BlenderExtensions, extensions),
            (RootId::BlenderExtensionConfig, extension_config),
        ]),
    ))
}

fn kdenlive_roots(env: &RootsEnv, i: &SetupInstall) -> Option<(ScopeKind, RootMap)> {
    let (kind, data, local) = match (i.kind, env.os) {
        (InstallKind::Flatpak, _) => {
            let d = join_all(env.known.flatpak_app_dir("org.kde.kdenlive")?, &["data", "kdenlive"]);
            (ScopeKind::FlatpakProfile, d.clone(), d)
        }
        (_, Os::Windows) => (
            ScopeKind::UserProfile,
            env.known.roaming_appdata()?.join("kdenlive"),
            env.known.local_appdata()?.join("kdenlive"),
        ),
        (_, Os::Macos) => {
            let d = env.known.mac_app_support()?.join("kdenlive");
            (ScopeKind::UserProfile, d.clone(), d)
        }
        (_, Os::Linux) => {
            let d = env.known.xdg_data()?.join("kdenlive");
            (ScopeKind::UserProfile, d.clone(), d)
        }
    };
    Some((kind, RootMap::from([(RootId::KdenliveData, data), (RootId::KdenliveLocalData, local)])))
}

/// Benutzer-Schriftordner des Betriebssystems.
pub fn user_fonts_dir(env: &RootsEnv) -> Option<PathBuf> {
    match env.os {
        Os::Windows => Some(join_all(env.known.local_appdata()?, &["Microsoft", "Windows", "Fonts"])),
        Os::Macos => Some(env.known.home.clone()?.join("Library").join("Fonts")),
        Os::Linux => Some(join_all(env.known.xdg_data()?, &["fonts", "cypher"])),
    }
}

fn scope_id(program: Option<&str>, kind: ScopeKind, roots: &RootMap) -> String {
    let mut text = format!("{}|{kind:?}", program.unwrap_or("-"));
    for (id, path) in roots {
        text.push('|');
        text.push_str(id.as_str());
        text.push('=');
        text.push_str(&path.to_string_lossy());
    }
    short_hash(&text)
}

/// Geltungsbereiche für ein Paket. Pakete ohne Programm (`fonts`) haben genau einen Bereich `UserFonts`.
/// Installationen, die sich nicht einrichten lassen, erscheinen mit `unsupported`.
pub fn resolve_scopes(pack: &PackManifest, installs: &[SetupInstall], env: &RootsEnv) -> Vec<ResolvedScope> {
    let mut roots = RootMap::new();
    let Some(program_id) = pack.program_id.as_deref() else {
        let Some(dir) = user_fonts_dir(env) else { return Vec::new() };
        roots.insert(RootId::UserFonts, dir);
        roots.insert(RootId::ProjectTemplates, env.data_dir.join("templates"));
        return vec![ResolvedScope {
            scope_id: scope_id(None, ScopeKind::UserFonts, &roots),
            program_id: None,
            kind: ScopeKind::UserFonts,
            roots,
            installation_ids: Vec::new(),
            unsupported: None,
            exe: None,
            install_kind: None,
        }];
    };

    let mut scopes: Vec<ResolvedScope> = Vec::new();
    for i in installs.iter().filter(|i| i.program_id == program_id) {
        let unsupported = unsupported_reason(pack, i);
        let derived = match program_id {
            "krita" => krita_roots(env, i),
            "inkscape" => inkscape_roots(env, i),
            "blender" => blender_roots(env, i),
            "kdenlive" => kdenlive_roots(env, i),
            _ => None,
        };
        let (kind, mut map, unsupported) = match (derived, unsupported) {
            (Some((kind, map)), u) => (kind, map, u),
            (None, u) => (ScopeKind::UserProfile, RootMap::new(), u.or(Some(SetupUnsupportedReason::NoPack))),
        };
        let kind = if matches!(i.kind, InstallKind::Snap) { ScopeKind::SnapProfile } else { kind };
        map.insert(RootId::ProjectTemplates, env.data_dir.join("templates"));
        let id = scope_id(Some(program_id), kind, &map);
        match scopes.iter_mut().find(|s| s.scope_id == id) {
            Some(existing) => {
                existing.installation_ids.push(i.id.clone());
                if existing.exe.is_none() {
                    existing.exe = i.exe.clone();
                }
            }
            None => scopes.push(ResolvedScope {
                scope_id: id,
                program_id: Some(program_id.to_owned()),
                kind,
                roots: map,
                installation_ids: vec![i.id.clone()],
                unsupported,
                exe: i.exe.clone(),
                install_kind: Some(i.kind),
            }),
        }
    }
    scopes
}

/// Warum für diese Installation keine Einrichtung möglich ist (ohne Wurzeln zu berechnen).
fn unsupported_reason(pack: &PackManifest, i: &SetupInstall) -> Option<SetupUnsupportedReason> {
    if matches!(i.kind, InstallKind::Snap | InstallKind::Msstore) {
        return Some(SetupUnsupportedReason::InstallKind);
    }
    if let (Some(range), Some(version)) = (&pack.program_versions, &i.version)
        && let Ok(v) = ProgVer::parse(version)
        && !range.matches(&v)
    {
        return Some(SetupUnsupportedReason::ProgramVersion);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known(os: Os) -> KnownDirs {
        match os {
            Os::Windows => KnownDirs {
                home: Some("C:\\Users\\anna".into()),
                appdata: Some("C:\\Users\\anna\\AppData\\Roaming".into()),
                local_appdata: Some("C:\\Users\\anna\\AppData\\Local".into()),
                program_files: vec![],
                xdg_config_home: None,
                xdg_data_home: None,
            },
            Os::Macos => KnownDirs { home: Some("/Users/anna".into()), ..KnownDirs::default() },
            Os::Linux => KnownDirs { home: Some("/home/anna".into()), ..KnownDirs::default() },
        }
    }

    fn env(os: Os) -> RootsEnv {
        RootsEnv { os, known: known(os), data_dir: PathBuf::from("/data"), inkscape_profile_dir: None }
    }

    fn install(program: &str, kind: InstallKind, version: &str, path: &str) -> SetupInstall {
        SetupInstall {
            id: format!("{program}-{kind:?}-{version}"),
            program_id: program.into(),
            kind,
            version: Some(version.into()),
            path: path.into(),
            exe: Some(PathBuf::from(path).join("bin")),
        }
    }

    fn pack(program: &str, versions: Option<&str>) -> PackManifest {
        PackManifest {
            id: program.into(),
            program_id: Some(program.into()),
            version: "1.0.0".into(),
            title: "t".into(),
            description: String::new(),
            program_versions: versions.map(|v| crate::catalog::VersionRange::parse(v).unwrap()),
            requires_packs: vec![],
            requires_program_closed: false,
            components: vec![],
            files: vec![],
            actions: vec![],
            sha256: Default::default(),
            dir: PathBuf::new(),
            packs_root: PathBuf::new(),
        }
    }

    fn only(scopes: Vec<ResolvedScope>) -> ResolvedScope {
        assert_eq!(scopes.len(), 1, "{scopes:?}");
        scopes.into_iter().next().unwrap()
    }

    #[test]
    fn krita_roots_per_os_and_flatpak() {
        let p = pack("krita", Some(">=5.2, <6"));
        let w =
            only(resolve_scopes(&p, &[install("krita", InstallKind::System, "5.3.4", "C:\\Krita")], &env(Os::Windows)));
        assert_eq!(w.roots[&RootId::KritaResources], PathBuf::from("C:\\Users\\anna\\AppData\\Roaming").join("krita"));
        assert_eq!(w.kind, ScopeKind::UserProfile);
        let m = only(resolve_scopes(
            &p,
            &[install("krita", InstallKind::System, "5.3.4", "/Applications/krita.app")],
            &env(Os::Macos),
        ));
        assert_eq!(m.roots[&RootId::KritaResources], PathBuf::from("/Users/anna/Library/Application Support/Krita"));
        let l = only(resolve_scopes(
            &p,
            &[install("krita", InstallKind::System, "5.3.4", "/usr/bin/krita")],
            &env(Os::Linux),
        ));
        assert_eq!(l.roots[&RootId::KritaResources], PathBuf::from("/home/anna/.local/share/krita"));
        let f = only(resolve_scopes(
            &p,
            &[install("krita", InstallKind::Flatpak, "5.3.4", "org.kde.krita")],
            &env(Os::Linux),
        ));
        assert_eq!(f.kind, ScopeKind::FlatpakProfile);
        assert_eq!(f.roots[&RootId::KritaResources], PathBuf::from("/home/anna/.var/app/org.kde.krita/data/krita"));
    }

    #[test]
    fn installations_with_the_same_profile_share_one_scope() {
        let p = pack("krita", None);
        let a = install("krita", InstallKind::System, "5.3.4", "/usr/bin/krita");
        let mut b = install("krita", InstallKind::Cypher, "5.3.4.1", "/data/programs/krita/5.3.4.1");
        b.id = "cypher:krita:5.3.4.1".into();
        let s = only(resolve_scopes(&p, &[a, b], &env(Os::Linux)));
        assert_eq!(s.installation_ids.len(), 2);
    }

    #[test]
    fn blender_cypher_install_uses_the_portable_folder_system_uses_the_series_folder() {
        let p = pack("blender", Some(">=4.5, <6"));
        let c = only(resolve_scopes(
            &p,
            &[install("blender", InstallKind::Cypher, "5.2.2", "/data/programs/blender/5.2.2")],
            &env(Os::Linux),
        ));
        assert_eq!(c.kind, ScopeKind::PortableInstall);
        assert_eq!(c.roots[&RootId::BlenderConfig], PathBuf::from("/data/programs/blender/5.2.2/portable"));
        assert_eq!(c.roots[&RootId::BlenderScripts], PathBuf::from("/data/programs/blender/5.2.2/portable/scripts"));
        assert!(c.roots[&RootId::BlenderExtensionConfig].ends_with("extensions/.user/user_default/cypher_export"));
        let s = only(resolve_scopes(
            &p,
            &[install("blender", InstallKind::System, "5.2.2", "/usr/bin/blender")],
            &env(Os::Linux),
        ));
        assert_eq!(s.roots[&RootId::BlenderConfig], PathBuf::from("/home/anna/.config/blender/5.2"));
        let w = only(resolve_scopes(
            &p,
            &[install("blender", InstallKind::System, "5.2.2", "C:\\Blender")],
            &env(Os::Windows),
        ));
        assert_eq!(
            w.roots[&RootId::BlenderConfig],
            PathBuf::from("C:\\Users\\anna\\AppData\\Roaming").join("Blender Foundation").join("Blender").join("5.2")
        );
        // macOS: auch die von Cypher installierte App nutzt das Benutzerprofil (Signatur!)
        let m = only(resolve_scopes(
            &p,
            &[install("blender", InstallKind::Cypher, "5.2.2", "/Users/anna/Applications/Blender.app")],
            &env(Os::Macos),
        ));
        assert_eq!(m.kind, ScopeKind::UserProfile);
        assert_eq!(
            m.roots[&RootId::BlenderConfig],
            PathBuf::from("/Users/anna/Library/Application Support/Blender/5.2")
        );
    }

    #[test]
    fn two_blender_series_are_two_scopes() {
        let p = pack("blender", None);
        let scopes = resolve_scopes(
            &p,
            &[
                install("blender", InstallKind::System, "5.2.2", "/usr/bin/blender"),
                install("blender", InstallKind::Flatpak, "4.5.9", "org.blender.Blender"),
            ],
            &env(Os::Linux),
        );
        assert_eq!(scopes.len(), 2);
    }

    #[test]
    fn unsupported_kinds_and_versions_are_reported_not_hidden() {
        let p = pack("krita", Some(">=5.2, <6"));
        let snap = only(resolve_scopes(
            &p,
            &[install("krita", InstallKind::Snap, "5.3.4", "/snap/bin/krita")],
            &env(Os::Linux),
        ));
        assert_eq!(snap.unsupported, Some(SetupUnsupportedReason::InstallKind));
        let old = only(resolve_scopes(
            &p,
            &[install("krita", InstallKind::System, "4.4.8", "/usr/bin/krita")],
            &env(Os::Linux),
        ));
        assert_eq!(old.unsupported, Some(SetupUnsupportedReason::ProgramVersion));
        let new = only(resolve_scopes(
            &p,
            &[install("krita", InstallKind::System, "6.0.1", "/usr/bin/krita")],
            &env(Os::Linux),
        ));
        assert_eq!(new.unsupported, Some(SetupUnsupportedReason::ProgramVersion));
    }

    #[test]
    fn fonts_pack_has_one_user_fonts_scope_per_os() {
        let mut p = pack("x", None);
        p.program_id = None;
        let win = only(resolve_scopes(&p, &[], &env(Os::Windows)));
        assert_eq!(win.kind, ScopeKind::UserFonts);
        assert_eq!(
            win.roots[&RootId::UserFonts],
            PathBuf::from("C:\\Users\\anna\\AppData\\Local").join("Microsoft").join("Windows").join("Fonts")
        );
        assert_eq!(
            only(resolve_scopes(&p, &[], &env(Os::Macos))).roots[&RootId::UserFonts],
            PathBuf::from("/Users/anna/Library/Fonts")
        );
        assert_eq!(
            only(resolve_scopes(&p, &[], &env(Os::Linux))).roots[&RootId::UserFonts],
            PathBuf::from("/home/anna/.local/share/fonts/cypher")
        );
    }

    #[test]
    fn scope_id_is_stable_and_changes_with_the_profile() {
        let p = pack("krita", None);
        let a =
            only(resolve_scopes(&p, &[install("krita", InstallKind::System, "5.3.4", "/x")], &env(Os::Linux))).scope_id;
        let b =
            only(resolve_scopes(&p, &[install("krita", InstallKind::System, "5.3.4", "/y")], &env(Os::Linux))).scope_id;
        assert_eq!(a, b, "gleiches Profil, gleicher Bereich");
        let c = only(resolve_scopes(&p, &[install("krita", InstallKind::System, "5.3.4", "/x")], &env(Os::Windows)))
            .scope_id;
        assert_ne!(a, c);
        assert_eq!(a.len(), 12);
    }

    #[test]
    fn inkscape_profile_dir_override_wins_on_windows() {
        let p = pack("inkscape", None);
        let mut e = env(Os::Windows);
        e.inkscape_profile_dir = Some(PathBuf::from("D:\\Profile\\ink"));
        let s = only(resolve_scopes(&p, &[install("inkscape", InstallKind::System, "1.4.3", "C:\\ink")], &e));
        assert_eq!(s.roots[&RootId::InkscapeProfile], PathBuf::from("D:\\Profile\\ink"));
    }

    #[test]
    fn kdenlive_uses_roaming_and_local_on_windows() {
        let p = pack("kdenlive", None);
        let s = only(resolve_scopes(
            &p,
            &[install("kdenlive", InstallKind::System, "26.8.2", "C:\\kd")],
            &env(Os::Windows),
        ));
        assert_eq!(s.roots[&RootId::KdenliveData], PathBuf::from("C:\\Users\\anna\\AppData\\Roaming").join("kdenlive"));
        assert_eq!(
            s.roots[&RootId::KdenliveLocalData],
            PathBuf::from("C:\\Users\\anna\\AppData\\Local").join("kdenlive")
        );
    }
}
