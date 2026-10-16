//! App-Ordner (`AppDirs`) und bekannte Systemordner (`KnownDirs`).

use std::path::{Path, PathBuf};

use super::APP_DIR_NAME;
use crate::api::IoOp;
use crate::error::IoError;

/// Die Ordner der App (Pfade je OS: ARCHITEKTUR.md 7.1–7.3, per Snapshot-Test festgeschrieben).
#[derive(Debug, Clone)]
pub struct AppDirs {
    /// Zustand, Programme, Einrichtungsmanifeste, Logs. Windows: `%LOCALAPPDATA%\de.cypherxcypher.studio\data`.
    pub data: PathBuf,
    /// `settings.json`. Windows: `%APPDATA%\de.cypherxcypher.studio\config`.
    pub config: PathBuf,
    /// Vorschaubilder, Download-Cache.
    pub cache: PathBuf,
    pub logs: PathBuf,
    /// Dokumente-Ordner des Nutzers (oder Home).
    pub documents: PathBuf,
    pub home: PathBuf,
    /// Mitgelieferte Ressourcen (`packs/…`); Tauri setzt sie, die CLI übergibt `--resources`.
    pub resources: PathBuf,
}

impl AppDirs {
    /// Ordner des laufenden Nutzers. In Debug- und Testbuilds überschreibt die Umgebungsvariable
    /// `CYPHER_STUDIO_DATA_DIR` die Wurzel (alles landet dann darunter); in Release-Builds wirkt sie nicht.
    pub fn discover(resources: PathBuf) -> Result<Self, IoError> {
        #[cfg(any(debug_assertions, test, feature = "test-util"))]
        if let Some(root) = std::env::var_os("CYPHER_STUDIO_DATA_DIR").filter(|v| !v.is_empty()) {
            return Ok(Self::with_root(Path::new(&root), resources));
        }
        let project = directories::ProjectDirs::from_path(PathBuf::from(APP_DIR_NAME))
            .ok_or_else(|| IoError::other(IoOp::Metadata, None, "kein Heimatverzeichnis gefunden"))?;
        let base = directories::BaseDirs::new()
            .ok_or_else(|| IoError::other(IoOp::Metadata, None, "kein Heimatverzeichnis gefunden"))?;
        let home = base.home_dir().to_path_buf();
        let documents = directories::UserDirs::new()
            .and_then(|u| u.document_dir().map(Path::to_path_buf))
            .unwrap_or_else(|| home.clone());
        let data = project.data_local_dir().to_path_buf();
        Ok(AppDirs {
            logs: data.join("logs"),
            data,
            config: project.config_dir().to_path_buf(),
            cache: project.cache_dir().to_path_buf(),
            documents,
            home,
            resources,
        })
    }

    /// Alles unter einer Wurzel (Tests, CLI mit `--data-dir`, Linux-Probe).
    pub fn with_root(root: &Path, resources: PathBuf) -> Self {
        AppDirs {
            data: root.join("data"),
            config: root.join("config"),
            cache: root.join("cache"),
            logs: root.join("data").join("logs"),
            documents: root.join("documents"),
            home: root.join("home"),
            resources,
        }
    }

    pub fn for_test(root: &Path) -> Self {
        Self::with_root(root, root.join("resources"))
    }

    /// Standardziel für portable Installationen. macOS: sichtbar in Launchpad und Spotlight.
    pub fn programs_default(&self) -> PathBuf {
        if cfg!(target_os = "macos") {
            self.home.join("Applications").join("Cypher Studio")
        } else {
            self.data.join("programs")
        }
    }

    /// Standardordner für Projekte ohne Bibliothek (A-18).
    pub fn projects_default(&self) -> PathBuf {
        self.documents.join("Cypher Studio").join("Projekte")
    }

    pub fn downloads(&self) -> PathBuf {
        self.cache.join("downloads")
    }

    pub fn state_file(&self) -> PathBuf {
        self.data.join("state.json")
    }

    pub fn settings_file(&self) -> PathBuf {
        self.config.join("settings.json")
    }

    pub fn setup_dir(&self) -> PathBuf {
        self.data.join("setup")
    }

    pub fn catalog_cache(&self) -> PathBuf {
        self.data.join("catalog")
    }

    pub fn jobs_history_file(&self) -> PathBuf {
        self.data.join("jobs-history.json")
    }

    pub fn network_log_file(&self) -> PathBuf {
        self.data.join("network-log.json")
    }

    pub fn thumbs(&self) -> PathBuf {
        self.cache.join("thumbs")
    }

    pub fn lock_file(&self) -> PathBuf {
        self.data.join(".lock")
    }
}

/// Bekannte Ordner des Systems, aus Umgebungsvariablen gelesen. Alles `Option`, weil nicht jedes OS jede
/// Variable kennt; Tests setzen die Felder selbst.
#[derive(Debug, Clone, Default)]
pub struct KnownDirs {
    pub home: Option<PathBuf>,
    pub appdata: Option<PathBuf>,
    pub local_appdata: Option<PathBuf>,
    pub program_files: Vec<PathBuf>,
    pub xdg_config_home: Option<PathBuf>,
    pub xdg_data_home: Option<PathBuf>,
}

impl KnownDirs {
    pub fn from_env() -> Self {
        let var = |name: &str| std::env::var_os(name).filter(|v| !v.is_empty()).map(PathBuf::from);
        let mut program_files = Vec::new();
        for name in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            if let Some(p) = var(name)
                && !program_files.contains(&p)
            {
                program_files.push(p);
            }
        }
        KnownDirs {
            home: directories::BaseDirs::new().map(|d| d.home_dir().to_path_buf()),
            appdata: var("APPDATA"),
            local_appdata: var("LOCALAPPDATA"),
            program_files,
            xdg_config_home: var("XDG_CONFIG_HOME"),
            xdg_data_home: var("XDG_DATA_HOME"),
        }
    }

    /// `%APPDATA%`
    pub fn roaming_appdata(&self) -> Option<PathBuf> {
        self.appdata.clone()
    }

    /// `%LOCALAPPDATA%`
    pub fn local_appdata(&self) -> Option<PathBuf> {
        self.local_appdata.clone()
    }

    /// `%ProgramFiles%`, `%ProgramFiles(x86)%`
    pub fn program_files(&self) -> Vec<PathBuf> {
        self.program_files.clone()
    }

    /// `~/Library/Application Support`
    pub fn mac_app_support(&self) -> Option<PathBuf> {
        self.home.as_ref().map(|h| h.join("Library").join("Application Support"))
    }

    /// `/Applications`, `~/Applications`
    pub fn mac_applications(&self) -> Vec<PathBuf> {
        let mut dirs = vec![PathBuf::from("/Applications")];
        if let Some(h) = &self.home {
            dirs.push(h.join("Applications"));
        }
        dirs
    }

    /// `$XDG_CONFIG_HOME` oder `~/.config`
    pub fn xdg_config(&self) -> Option<PathBuf> {
        self.xdg_config_home.clone().or_else(|| self.home.as_ref().map(|h| h.join(".config")))
    }

    /// `$XDG_DATA_HOME` oder `~/.local/share`
    pub fn xdg_data(&self) -> Option<PathBuf> {
        self.xdg_data_home.clone().or_else(|| self.home.as_ref().map(|h| h.join(".local").join("share")))
    }

    /// `~/.var/app/<id>`
    pub fn flatpak_app_dir(&self, app_id: &str) -> Option<PathBuf> {
        self.home.as_ref().map(|h| h.join(".var").join("app").join(app_id))
    }

    /// `~/snap/<name>/current`
    pub fn snap_user_dir(&self, name: &str) -> Option<PathBuf> {
        self.home.as_ref().map(|h| h.join("snap").join(name).join("current"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_dirs_with_root_nest_everything() {
        let dirs = AppDirs::for_test(Path::new("/tmp/x"));
        assert_eq!(dirs.state_file(), Path::new("/tmp/x/data/state.json"));
        assert_eq!(dirs.settings_file(), Path::new("/tmp/x/config/settings.json"));
        assert_eq!(dirs.downloads(), Path::new("/tmp/x/cache/downloads"));
        assert_eq!(dirs.logs, Path::new("/tmp/x/data/logs"));
        assert_eq!(dirs.projects_default(), Path::new("/tmp/x/documents/Cypher Studio/Projekte"));
    }

    #[test]
    fn real_dirs_end_with_the_documented_suffixes() {
        // Der Test ruft `discover` ohne Umgebungsvariable auf; das Ergebnis hängt vom Host ab, die Endungen nicht.
        if std::env::var_os("CYPHER_STUDIO_DATA_DIR").is_some() {
            return;
        }
        let dirs = AppDirs::discover(PathBuf::from("res")).unwrap();
        let data = dirs.data.to_string_lossy().replace('\\', "/");
        let config = dirs.config.to_string_lossy().replace('\\', "/");
        let cache = dirs.cache.to_string_lossy().replace('\\', "/");
        if cfg!(windows) {
            assert!(data.ends_with("/de.cypherxcypher.studio/data"), "{data}");
            assert!(config.ends_with("/de.cypherxcypher.studio/config"), "{config}");
            assert!(cache.ends_with("/de.cypherxcypher.studio/cache"), "{cache}");
        } else if cfg!(target_os = "macos") {
            assert!(data.ends_with("/Library/Application Support/de.cypherxcypher.studio"), "{data}");
            assert!(cache.ends_with("/Library/Caches/de.cypherxcypher.studio"), "{cache}");
        } else {
            assert!(data.ends_with("/de.cypherxcypher.studio"), "{data}");
            assert!(config.ends_with("/.config/de.cypherxcypher.studio") || config.contains("de.cypherxcypher.studio"));
            assert!(cache.ends_with("/de.cypherxcypher.studio"), "{cache}");
        }
        assert_eq!(dirs.logs, dirs.data.join("logs"));
    }

    #[test]
    fn known_dirs_fall_back_to_home() {
        let k = KnownDirs { home: Some(PathBuf::from("/home/anna")), ..KnownDirs::default() };
        assert_eq!(k.xdg_config().unwrap(), Path::new("/home/anna/.config"));
        assert_eq!(k.xdg_data().unwrap(), Path::new("/home/anna/.local/share"));
        assert_eq!(k.flatpak_app_dir("org.kde.krita").unwrap(), Path::new("/home/anna/.var/app/org.kde.krita"));
        assert_eq!(k.snap_user_dir("blender").unwrap(), Path::new("/home/anna/snap/blender/current"));
        assert_eq!(k.mac_app_support().unwrap(), Path::new("/home/anna/Library/Application Support"));
        let k = KnownDirs { xdg_config_home: Some(PathBuf::from("/cfg")), ..k };
        assert_eq!(k.xdg_config().unwrap(), Path::new("/cfg"));
    }
}
