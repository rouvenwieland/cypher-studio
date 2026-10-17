//! `settings` – Einstellungen (`<config>/settings.json`, ARCHITEKTUR.md 2.15).
//!
//! Gespeichert werden echte Pfade; über IPC gehen sie als `DisplayPath` ([`Settings::for_display`]).

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use crate::api::{
    AppImageMode, DensityChoice, DirSetting, MeasureColor, MotionChoice, OnboardingState, OnboardingStatus, Settings,
    SettingsPatch, SurroundTone, ThemeChoice, UiPreferences, UpdateFrequency,
};
use crate::api::{CatalogSettings, DownloadSettings, LinuxSettings, ProfileSettings, Surround, UpdatesSettings};
use crate::error::{CoreError, IoError, PathError};
use crate::platform::{AppDirs, display_path, fsx, is_system_dir};

pub const SETTINGS_SCHEMA_VERSION: u8 = 1;
/// Größte erlaubte Länge der vom Frontend verwalteten Einstellungen (UI + Onboarding) als JSON.
pub const UI_MAX_BYTES: usize = 64 * 1024;

/// Standardwerte für einen neuen Nutzer.
pub fn defaults(dirs: &AppDirs) -> Settings {
    Settings {
        schema_version: SETTINGS_SCHEMA_VERSION,
        updates: UpdatesSettings { frequency: UpdateFrequency::Weekly, last_check_at: None },
        catalog: CatalogSettings { auto_refresh: true },
        programs_dir: dirs.programs_default().to_string_lossy().into_owned(),
        projects_dir: dirs.projects_default().to_string_lossy().into_owned(),
        library_root: None,
        downloads: DownloadSettings { keep_cache: false, max_parallel: 2 },
        linux: LinuxSettings { app_image_mode: AppImageMode::Auto, graphics_compat: false },
        profile: ProfileSettings { display_name: String::new() },
        ui: UiPreferences {
            theme: ThemeChoice::System,
            density: DensityChoice::Normal,
            motion: MotionChoice::System,
            zoom_percent: 100,
            measure_color: MeasureColor::Cyan,
            surround: Surround { paper: SurroundTone::Light, ink: SurroundTone::Dark },
            calibration_px_per_mm: None,
            // Einzeltasten (U, G, K …) wirken nur bei Fokus in der Vorschau (WCAG 2.1.4) und sind in den Einstellungen abschaltbar
            single_key_shortcuts: true,
            shortcut_overrides: Default::default(),
        },
        onboarding: OnboardingState {
            status: OnboardingStatus::NotStarted,
            step: 0,
            // Vorauswahl im Erststart (CONCEPT.md 6.10): Krita und Inkscape; die Nutzerin wählt ab oder dazu
            selected_programs: vec!["krita".to_owned(), "inkscape".to_owned()],
            apply_setup: true,
            updated_at: None,
        },
    }
}

impl Settings {
    /// Kopie für die Anzeige im Frontend: Pfade mit `~` für das Home-Verzeichnis.
    pub fn for_display(&self) -> Settings {
        let show = |p: &str| display_path(Path::new(p));
        let mut s = self.clone();
        s.programs_dir = show(&self.programs_dir);
        s.projects_dir = show(&self.projects_dir);
        s.library_root = self.library_root.as_deref().map(show);
        s
    }
}

/// Prüft Wertebereiche. Gibt den ersten Verstoß als `InvalidInput` zurück.
pub fn validate(s: &Settings) -> Result<(), CoreError> {
    if s.schema_version != SETTINGS_SCHEMA_VERSION {
        return Err(CoreError::invalid_input("schemaVersion", "unbekannte Version"));
    }
    if !(1..=3).contains(&s.downloads.max_parallel) {
        return Err(CoreError::invalid_input("downloads.maxParallel", "muss 1, 2 oder 3 sein"));
    }
    if !(50..=200).contains(&s.ui.zoom_percent) {
        return Err(CoreError::invalid_input("ui.zoomPercent", "muss zwischen 50 und 200 liegen"));
    }
    if let Some(px) = s.ui.calibration_px_per_mm
        && !(px.is_finite() && (1.0..=100.0).contains(&px))
    {
        return Err(CoreError::invalid_input("ui.calibrationPxPerMm", "muss zwischen 1 und 100 liegen"));
    }
    if s.profile.display_name.chars().count() > 80 {
        return Err(CoreError::invalid_input("profile.displayName", "höchstens 80 Zeichen"));
    }
    if s.onboarding.step > 6 {
        return Err(CoreError::invalid_input("onboarding.step", "muss zwischen 0 und 6 liegen"));
    }
    let ui_bytes = serde_json::to_vec(&(&s.ui, &s.onboarding)).map(|v| v.len()).unwrap_or(usize::MAX);
    if ui_bytes > UI_MAX_BYTES {
        return Err(CoreError::invalid_input("ui", "Einstellungen zu groß (höchstens 64 KB)"));
    }
    Ok(())
}

/// Wendet einen Patch an (ohne zu speichern).
pub fn apply_patch(s: &mut Settings, patch: &SettingsPatch) {
    if let Some(u) = &patch.updates
        && let Some(f) = u.frequency
    {
        s.updates.frequency = f;
    }
    if let Some(c) = &patch.catalog
        && let Some(v) = c.auto_refresh
    {
        s.catalog.auto_refresh = v;
    }
    if let Some(d) = &patch.downloads {
        if let Some(v) = d.keep_cache {
            s.downloads.keep_cache = v;
        }
        if let Some(v) = d.max_parallel {
            s.downloads.max_parallel = v;
        }
    }
    if let Some(l) = &patch.linux {
        if let Some(v) = l.app_image_mode {
            s.linux.app_image_mode = v;
        }
        if let Some(v) = l.graphics_compat {
            s.linux.graphics_compat = v;
        }
    }
    if let Some(p) = &patch.profile
        && let Some(v) = &p.display_name
    {
        s.profile.display_name = v.clone();
    }
    if let Some(u) = &patch.ui {
        if let Some(v) = u.theme {
            s.ui.theme = v;
        }
        if let Some(v) = u.density {
            s.ui.density = v;
        }
        if let Some(v) = u.motion {
            s.ui.motion = v;
        }
        if let Some(v) = u.zoom_percent {
            s.ui.zoom_percent = v;
        }
        if let Some(v) = u.measure_color {
            s.ui.measure_color = v;
        }
        if let Some(v) = &u.surround {
            s.ui.surround = v.clone();
        }
        u.calibration_px_per_mm.clone().apply_to(&mut s.ui.calibration_px_per_mm);
        if let Some(v) = u.single_key_shortcuts {
            s.ui.single_key_shortcuts = v;
        }
        if let Some(v) = &u.shortcut_overrides {
            s.ui.shortcut_overrides = v.clone();
        }
    }
    if let Some(o) = &patch.onboarding {
        if let Some(v) = o.status {
            s.onboarding.status = v;
        }
        if let Some(v) = o.step {
            s.onboarding.step = v;
        }
        if let Some(v) = &o.selected_programs {
            s.onboarding.selected_programs = v.clone();
        }
        if let Some(v) = o.apply_setup {
            s.onboarding.apply_setup = v;
        }
        o.updated_at.clone().apply_to(&mut s.onboarding.updated_at);
    }
}

pub struct SettingsStore {
    path: PathBuf,
    inner: RwLock<Settings>,
}

impl SettingsStore {
    /// Fehlende oder beschädigte Datei → Standardwerte; eine beschädigte Datei wird vorher beiseite gelegt.
    pub fn load(dirs: &AppDirs) -> Self {
        let path = dirs.settings_file();
        let mut settings = match fsx::read_json::<Settings>(&path) {
            Ok(Some(s)) if validate(&s).is_ok() => s,
            Ok(None) => defaults(dirs),
            Ok(Some(_)) | Err(_) => {
                if path.exists() {
                    match fsx::quarantine_corrupt(&path) {
                        Ok(moved) => {
                            tracing::warn!("settings.json war ungültig und liegt jetzt in {}", moved.display())
                        }
                        Err(e) => tracing::warn!("settings.json konnte nicht beiseite gelegt werden: {e}"),
                    }
                }
                defaults(dirs)
            }
        };
        // Beschädigte Zielpfade (leer) durch Standardwerte ersetzen.
        if settings.programs_dir.is_empty() {
            settings.programs_dir = dirs.programs_default().to_string_lossy().into_owned();
        }
        if settings.projects_dir.is_empty() {
            settings.projects_dir = dirs.projects_default().to_string_lossy().into_owned();
        }
        SettingsStore { path, inner: RwLock::new(settings) }
    }

    pub fn get(&self) -> Settings {
        match self.inner.read() {
            Ok(g) => g.clone(),
            Err(p) => p.into_inner().clone(),
        }
    }

    fn mutate(&self, f: impl FnOnce(&mut Settings)) -> Result<Settings, CoreError> {
        let mut guard = match self.inner.write() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let mut next = guard.clone();
        f(&mut next);
        validate(&next)?;
        fsx::write_json_atomic(&self.path, &next)?;
        *guard = next.clone();
        Ok(next)
    }

    pub fn update(&self, patch: &SettingsPatch) -> Result<Settings, CoreError> {
        self.mutate(|s| apply_patch(s, patch))
    }

    /// Setzt Ordner, die der Nutzer im nativen Dialog gewählt hat. Prüft: existiert, ist ein Ordner, beschreibbar,
    /// kein Systemordner.
    pub fn set_dir(&self, which: DirSetting, path: &Path) -> Result<Settings, CoreError> {
        validate_user_dir(path)?;
        let text = path.to_string_lossy().into_owned();
        self.mutate(|s| match which {
            DirSetting::ProgramsDir => s.programs_dir = text,
            DirSetting::ProjectsDir => s.projects_dir = text,
        })
    }

    /// Bibliotheksordner (nach `library_use_root`) und Zeit der letzten Update-Prüfung setzt der Kern selbst.
    pub fn set_library_root(&self, root: Option<&Path>) -> Result<Settings, CoreError> {
        let text = root.map(|p| p.to_string_lossy().into_owned());
        self.mutate(|s| s.library_root = text)
    }

    pub fn set_last_update_check(&self, at: &str) -> Result<Settings, CoreError> {
        self.mutate(|s| s.updates.last_check_at = Some(at.to_owned()))
    }

    pub fn set_projects_dir_internal(&self, dir: &Path) -> Result<Settings, CoreError> {
        let text = dir.to_string_lossy().into_owned();
        self.mutate(|s| s.projects_dir = text)
    }
}

/// Prüft einen vom Nutzer gewählten Ordner (6.6): Ordner, beschreibbar (Schreibprobe), kein Systemordner.
pub fn validate_user_dir(path: &Path) -> Result<(), CoreError> {
    if !path.is_dir() {
        return Err(CoreError::invalid_input("path", "kein Ordner"));
    }
    if fsx::has_parent_components(path) {
        return Err(PathError::ParentTraversal.into());
    }
    let known = crate::platform::KnownDirs::from_env();
    if is_system_dir(crate::api::Os::current(), &known, path) {
        return Err(CoreError::invalid_input("path", "Systemordner sind nicht erlaubt"));
    }
    let probe = tempfile::Builder::new().prefix(".cypher-write-test-").tempfile_in(path);
    match probe {
        Ok(f) => drop(f),
        Err(e) => return Err(IoError::new(crate::api::IoOp::Write, path, e).into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::{CatalogPatch, DownloadsPatch, OnboardingPatch, Patch, UiPreferencesPatch, UpdatesPatch};

    fn dirs() -> (tempfile::TempDir, AppDirs) {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = AppDirs::for_test(tmp.path());
        (tmp, dirs)
    }

    #[test]
    fn defaults_are_valid_and_use_the_app_dirs() {
        let (_t, dirs) = dirs();
        let s = defaults(&dirs);
        validate(&s).unwrap();
        assert_eq!(s.programs_dir, dirs.programs_default().to_string_lossy());
        assert_eq!(s.projects_dir, dirs.projects_default().to_string_lossy());
        assert_eq!(s.downloads.max_parallel, 2);
    }

    #[test]
    fn single_key_shortcuts_are_on_by_default_like_in_the_ui() {
        let (_t, dirs) = dirs();
        assert!(defaults(&dirs).ui.single_key_shortcuts);
    }

    #[test]
    fn first_start_preselects_krita_and_inkscape() {
        let (_t, dirs) = dirs();
        let s = defaults(&dirs);
        assert_eq!(s.onboarding.status, OnboardingStatus::NotStarted);
        assert_eq!(s.onboarding.selected_programs, ["krita", "inkscape"]);
        assert!(s.onboarding.apply_setup);
    }

    #[test]
    fn missing_file_gives_defaults_and_updates_persist() {
        let (_t, dirs) = dirs();
        let store = SettingsStore::load(&dirs);
        assert_eq!(store.get(), defaults(&dirs));
        let patch = SettingsPatch {
            updates: Some(UpdatesPatch { frequency: Some(UpdateFrequency::Never) }),
            downloads: Some(DownloadsPatch { keep_cache: Some(true), max_parallel: Some(3) }),
            catalog: Some(CatalogPatch { auto_refresh: Some(false) }),
            ui: Some(UiPreferencesPatch { zoom_percent: Some(125), theme: Some(ThemeChoice::Ink), ..empty_ui_patch() }),
            ..SettingsPatch::default()
        };
        let updated = store.update(&patch).unwrap();
        assert_eq!(updated.updates.frequency, UpdateFrequency::Never);
        assert_eq!(updated.ui.zoom_percent, 125);
        assert!(!updated.catalog.auto_refresh);
        let reloaded = SettingsStore::load(&dirs);
        assert_eq!(reloaded.get(), updated);
    }

    #[test]
    fn null_in_a_patch_clears_the_value_but_absence_keeps_it() {
        let (_t, dirs) = dirs();
        let store = SettingsStore::load(&dirs);
        store
            .update(&SettingsPatch {
                ui: Some(UiPreferencesPatch { calibration_px_per_mm: Patch::Value(3.78), ..empty_ui_patch() }),
                ..SettingsPatch::default()
            })
            .unwrap();
        assert_eq!(store.get().ui.calibration_px_per_mm, Some(3.78));
        // fehlt → bleibt
        store
            .update(&SettingsPatch {
                ui: Some(UiPreferencesPatch { zoom_percent: Some(90), ..empty_ui_patch() }),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(store.get().ui.calibration_px_per_mm, Some(3.78));
        // null → gelöscht
        store
            .update(&SettingsPatch {
                ui: Some(UiPreferencesPatch { calibration_px_per_mm: Patch::Null, ..empty_ui_patch() }),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(store.get().ui.calibration_px_per_mm, None);
        // aus JSON: `null` und fehlendes Feld
        let patch: SettingsPatch = serde_json::from_str(r#"{"ui":{"calibrationPxPerMm":null}}"#).unwrap();
        assert_eq!(patch.ui.unwrap().calibration_px_per_mm, Patch::Null);
        let patch: SettingsPatch = serde_json::from_str(r#"{"ui":{}}"#).unwrap();
        assert_eq!(patch.ui.unwrap().calibration_px_per_mm, Patch::Absent);
    }

    #[test]
    fn invalid_values_are_rejected_and_not_saved() {
        let (_t, dirs) = dirs();
        let store = SettingsStore::load(&dirs);
        let bad_zoom = SettingsPatch {
            ui: Some(UiPreferencesPatch { zoom_percent: Some(500), ..empty_ui_patch() }),
            ..Default::default()
        };
        assert!(matches!(store.update(&bad_zoom), Err(CoreError::InvalidInput { .. })));
        let bad_parallel = SettingsPatch {
            downloads: Some(DownloadsPatch { keep_cache: None, max_parallel: Some(9) }),
            ..Default::default()
        };
        assert!(store.update(&bad_parallel).is_err());
        let bad_step = SettingsPatch {
            onboarding: Some(OnboardingPatch { step: Some(7), ..empty_onboarding_patch() }),
            ..Default::default()
        };
        assert!(store.update(&bad_step).is_err());
        assert_eq!(store.get(), defaults(&dirs));
        assert!(!dirs.settings_file().exists(), "ungültige Werte dürfen nichts schreiben");
    }

    #[test]
    fn ui_size_limit_is_enforced() {
        let (_t, dirs) = dirs();
        let store = SettingsStore::load(&dirs);
        let mut huge = std::collections::BTreeMap::new();
        for i in 0..4000 {
            huge.insert(format!("befehl-{i}"), "x".repeat(30));
        }
        let patch = SettingsPatch {
            ui: Some(UiPreferencesPatch { shortcut_overrides: Some(huge), ..empty_ui_patch() }),
            ..Default::default()
        };
        assert!(store.update(&patch).is_err());
    }

    #[test]
    fn corrupt_file_is_quarantined_and_defaults_return() {
        let (_t, dirs) = dirs();
        std::fs::create_dir_all(&dirs.config).unwrap();
        std::fs::write(dirs.settings_file(), b"{kaputt").unwrap();
        let store = SettingsStore::load(&dirs);
        assert_eq!(store.get(), defaults(&dirs));
        let names: Vec<String> = std::fs::read_dir(&dirs.config)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().any(|n| n.contains(".corrupt-")), "{names:?}");
    }

    #[test]
    fn set_dir_checks_the_folder() {
        let (tmp, dirs) = dirs();
        let store = SettingsStore::load(&dirs);
        let good = tmp.path().join("meine-programme");
        std::fs::create_dir_all(&good).unwrap();
        let updated = store.set_dir(DirSetting::ProgramsDir, &good).unwrap();
        assert_eq!(updated.programs_dir, good.to_string_lossy());
        assert!(store.set_dir(DirSetting::ProjectsDir, &tmp.path().join("gibt-es-nicht")).is_err());
        let file = tmp.path().join("datei.txt");
        std::fs::write(&file, b"x").unwrap();
        assert!(store.set_dir(DirSetting::ProjectsDir, &file).is_err());
        let root = if cfg!(windows) { PathBuf::from("C:\\Windows") } else { PathBuf::from("/usr") };
        if root.is_dir() {
            assert!(store.set_dir(DirSetting::ProgramsDir, &root).is_err(), "Systemordner muss abgelehnt werden");
        }
    }

    #[test]
    fn display_copy_abbreviates_paths() {
        let (_t, dirs) = dirs();
        let mut s = defaults(&dirs);
        let home = directories::BaseDirs::new().unwrap().home_dir().to_path_buf();
        s.library_root = Some(home.join("Cypher").to_string_lossy().into_owned());
        let shown = s.for_display();
        assert!(shown.library_root.unwrap().starts_with('~'));
    }

    fn empty_ui_patch() -> UiPreferencesPatch {
        UiPreferencesPatch {
            theme: None,
            density: None,
            motion: None,
            zoom_percent: None,
            measure_color: None,
            surround: None,
            calibration_px_per_mm: Patch::Absent,
            single_key_shortcuts: None,
            shortcut_overrides: None,
        }
    }

    fn empty_onboarding_patch() -> OnboardingPatch {
        OnboardingPatch {
            status: None,
            step: None,
            selected_programs: None,
            apply_setup: None,
            updated_at: Patch::Absent,
        }
    }
}
