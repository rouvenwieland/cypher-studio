//! App, Einstellungen, Netzwerk, Katalogstatus (Abschnitte 2 und 3 von docs/ipc-contract.ts).

use std::collections::BTreeMap;

use super::common::{Arch, DisplayPath, IsoDateTime, Os, PackId, Patch, ProgramId, ProjectId, SemVer, SpdxId};
use super::error::AppError;

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum BuildChannel {
        Stable,
        Beta,
        Dev,
    }
}

dto_struct! {
    pub struct AppInfo {
        pub app_version: SemVer,
        pub contract_version: String,
        pub os: Os,
        pub arch: Arch,
        pub os_version: String,
        pub data_dir: DisplayPath,
        pub logs_dir: DisplayPath,
        #[ts(inline)]
        pub build_channel: BuildChannel,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum ProgramPage {
        Homepage,
        License,
        ReleaseNotes,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum AppPage {
        Help,
        SourceCode,
        ThirdParty,
        ReleaseNotes,
        Downloads,
    }
}

dto_enum! {
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum ExternalTarget {
        ProgramPage {
            program_id: ProgramId,
            #[ts(inline)]
            page: ProgramPage,
        },
        CatalogLink { link_id: String },
        AppPage {
            #[ts(inline)]
            page: AppPage,
        },
    }
}

dto_enum! {
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum RevealTarget {
        Installation { installation_id: String },
        Project { project_id: ProjectId },
        ProjectFile { project_id: ProjectId, rel_path: String },
        LibraryEntry { entry_id: String },
        LibraryRoot,
        FileHandle { handle_id: String },
        Logs,
        PrintProfiles,
        SetupBackups { pack_id: PackId },
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum UpdateFrequency {
        Daily,
        Weekly,
        Never,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum ThemeChoice {
        System,
        Paper,
        Ink,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum DensityChoice {
        Compact,
        Normal,
        Large,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum MotionChoice {
        System,
        Reduced,
        Full,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum MeasureColor {
        Cyan,
        Magenta,
        Ink,
        Paper,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum SurroundTone {
        Light,
        Mid,
        Dark,
    }
}

inline_struct! {
    pub struct Surround {
        #[ts(inline)]
        pub paper: SurroundTone,
        #[ts(inline)]
        pub ink: SurroundTone,
    }
}

dto_struct! {
    pub struct UiPreferences {
        #[ts(inline)]
        pub theme: ThemeChoice,
        #[ts(inline)]
        pub density: DensityChoice,
        #[ts(inline)]
        pub motion: MotionChoice,
        pub zoom_percent: u32,
        #[ts(inline)]
        pub measure_color: MeasureColor,
        #[ts(inline)]
        pub surround: Surround,
        pub calibration_px_per_mm: Option<f64>,
        pub single_key_shortcuts: bool,
        pub shortcut_overrides: BTreeMap<String, String>,
    }
}

// `Partial<UiPreferences>` des Vertrags: jedes Feld darf fehlen.
inline_struct! {
    pub struct UiPreferencesPatch {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub theme: Option<ThemeChoice>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub density: Option<DensityChoice>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub motion: Option<MotionChoice>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub zoom_percent: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub measure_color: Option<MeasureColor>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub surround: Option<Surround>,
        #[serde(default, skip_serializing_if = "Patch::is_absent")]
        #[ts(optional, type = "number | null")]
        pub calibration_px_per_mm: Patch<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub single_key_shortcuts: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub shortcut_overrides: Option<BTreeMap<String, String>>,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum OnboardingStatus {
        NotStarted,
        InProgress,
        Done,
        Skipped,
    }
}

dto_struct! {
    pub struct OnboardingState {
        #[ts(inline)]
        pub status: OnboardingStatus,
        pub step: u32,
        pub selected_programs: Vec<ProgramId>,
        pub apply_setup: bool,
        pub updated_at: Option<IsoDateTime>,
    }
}

inline_struct! {
    pub struct OnboardingPatch {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub status: Option<OnboardingStatus>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub step: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub selected_programs: Option<Vec<ProgramId>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub apply_setup: Option<bool>,
        #[serde(default, skip_serializing_if = "Patch::is_absent")]
        #[ts(optional, type = "string | null")]
        pub updated_at: Patch<IsoDateTime>,
    }
}

inline_struct! {
    pub struct UpdatesSettings {
        #[ts(inline)]
        pub frequency: UpdateFrequency,
        pub last_check_at: Option<IsoDateTime>,
    }
}

inline_struct! {
    pub struct CatalogSettings {
        pub auto_refresh: bool,
    }
}

inline_struct! {
    pub struct DownloadSettings {
        pub keep_cache: bool,
        #[ts(type = "1 | 2 | 3")]
        pub max_parallel: u8,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum AppImageMode {
        Auto,
        Extract,
        Direct,
    }
}

inline_struct! {
    pub struct LinuxSettings {
        #[ts(inline)]
        pub app_image_mode: AppImageMode,
        pub graphics_compat: bool,
    }
}

inline_struct! {
    pub struct ProfileSettings {
        pub display_name: String,
    }
}

dto_struct! {
    pub struct Settings {
        #[ts(type = "1")]
        pub schema_version: u8,
        #[ts(inline)]
        pub updates: UpdatesSettings,
        #[ts(inline)]
        pub catalog: CatalogSettings,
        pub programs_dir: DisplayPath,
        pub projects_dir: DisplayPath,
        pub library_root: Option<DisplayPath>,
        #[ts(inline)]
        pub downloads: DownloadSettings,
        #[ts(inline)]
        pub linux: LinuxSettings,
        #[ts(inline)]
        pub profile: ProfileSettings,
        pub ui: UiPreferences,
        pub onboarding: OnboardingState,
    }
}

inline_struct! {
    pub struct UpdatesPatch {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub frequency: Option<UpdateFrequency>,
    }
}

inline_struct! {
    pub struct CatalogPatch {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub auto_refresh: Option<bool>,
    }
}

inline_struct! {
    pub struct DownloadsPatch {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub keep_cache: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "1 | 2 | 3")]
        pub max_parallel: Option<u8>,
    }
}

inline_struct! {
    pub struct LinuxPatch {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub app_image_mode: Option<AppImageMode>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub graphics_compat: Option<bool>,
    }
}

inline_struct! {
    pub struct ProfilePatch {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub display_name: Option<String>,
    }
}

dto_struct! {
    pub struct SettingsPatch {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub updates: Option<UpdatesPatch>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub catalog: Option<CatalogPatch>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub downloads: Option<DownloadsPatch>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub linux: Option<LinuxPatch>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub profile: Option<ProfilePatch>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub ui: Option<UiPreferencesPatch>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub onboarding: Option<OnboardingPatch>,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum DirSetting {
        ProgramsDir,
        ProjectsDir,
    }
}

dto_struct! {
    pub struct SettingsChooseDirReq {
        #[ts(inline)]
        pub which: DirSetting,
    }
}

dto_struct! {
    pub struct OpenExternalReq {
        pub target: ExternalTarget,
    }
}

dto_struct! {
    pub struct RevealReq {
        pub target: RevealTarget,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum NetworkPurpose {
        Catalog,
        AppUpdate,
        ProgramDownload,
        ModelDownload,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum NetworkWhen {
        OnStart,
        OnDemand,
        AfterConsent,
    }
}

dto_struct! {
    pub struct NetworkEndpoint {
        pub purpose: NetworkPurpose,
        pub host: String,
        pub url_pattern: String,
        #[ts(inline)]
        pub when: NetworkWhen,
        pub enabled: bool,
    }
}

dto_struct! {
    pub struct NetworkRequestLog {
        pub at: IsoDateTime,
        pub host: String,
        pub purpose: NetworkPurpose,
        pub status: Option<u16>,
        pub bytes: u64,
    }
}

dto_struct! {
    pub struct NetworkInfo {
        pub endpoints: Vec<NetworkEndpoint>,
        pub recent: Vec<NetworkRequestLog>,
        #[ts(type = "false")]
        pub telemetry: bool,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum CatalogSourceKind {
        Remote,
        Cache,
        Embedded,
    }
}

dto_struct! {
    pub struct CatalogStatus {
        pub source_url: Option<String>,
        pub schema_version: u32,
        pub sequence: u64,
        pub generated_at: IsoDateTime,
        pub expires_at: IsoDateTime,
        pub expired: bool,
        #[ts(inline)]
        pub source: CatalogSourceKind,
        pub last_check_at: Option<IsoDateTime>,
        pub last_error: Option<AppError>,
    }
}

dto_struct! {
    pub struct CatalogRefreshResult {
        pub status: CatalogStatus,
        pub changed: bool,
    }
}

dto_struct! {
    pub struct LicenseInfo {
        pub spdx: SpdxId,
        pub name: String,
        pub url: String,
    }
}

dto_struct! {
    pub struct CatalogLink {
        pub id: String,
        pub name: String,
        pub description: String,
        pub note: Option<String>,
    }
}
