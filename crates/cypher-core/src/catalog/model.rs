//! Datenmodell des Katalogs (`catalog/catalog.json`, ARCHITEKTUR.md 4.1). Reine Daten, keine Ausdrücke,
//! keine Schreibziele: der Katalog kann nichts außer auf Dateien mit festgenagelter Prüfsumme zeigen.

use serde::{Deserialize, Serialize};

use crate::api::{ArtifactKind, LicenseInfo, Os, PrintProfile, ProgramCategory, ReleaseChannel};

/// Architektur eines Artefakts. `universal` passt auf beide Architekturen (macOS Universal-Binary).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ArtifactArch {
    #[serde(rename = "x86_64")]
    X86_64,
    #[serde(rename = "aarch64")]
    Aarch64,
    #[serde(rename = "universal")]
    Universal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallerType {
    Nsis,
    Inno,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ChecksumOrigin {
    #[default]
    Upstream,
    CypherPinned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SignatureKind {
    Pgp,
    Minisign,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureSpec {
    #[serde(rename = "type")]
    pub kind: SignatureKind,
    /// `false` = nur protokollieren (schwache Upstream-Signatur, z. B. DSA-1024/SHA-1).
    #[serde(default = "default_true")]
    pub enforce: bool,
    pub url: String,
    pub public_keys: Vec<String>,
    pub fingerprints: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum FileArgs {
    #[default]
    Append,
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSpec {
    /// Relativ zum Installationsordner (nach `stripComponents`); macOS: relativ zu `Contents/MacOS` im `.app`.
    pub exe: String,
    /// Ersatzmuster mit `*`/`**`, falls das Archiv-Layout nicht sicher bekannt ist (Smoke-Test-Annahme).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exe_glob: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default)]
    pub file_args: FileArgs,
    /// Ordner, der den portablen Modus aktiviert (z. B. `portable` bei Blender).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub portable_marker: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSpec {
    pub os: Os,
    pub arch: ArtifactArch,
    pub kind: ArtifactKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installer_type: Option<InstallerType>,
    pub url: String,
    pub file_name: String,
    pub size: u64,
    pub sha256: String,
    pub checksum_source: String,
    #[serde(default)]
    pub checksum_origin: ChecksumOrigin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<SignatureSpec>,
    #[serde(default)]
    pub strip_components: u32,
    pub unpacked_size_max: u64,
    /// macOS: Name des `.app` im dmg.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mac_app_name: Option<String>,
    pub launch: LaunchSpec,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseSpec {
    pub version: String,
    pub channel: ReleaseChannel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub released_at: Option<String>,
    pub artifacts: Vec<ArtifactSpec>,
}

/// Konfigurationswurzeln, die ein Paket ansprechen darf. Die Pfade dazu stehen im Code (`setup::roots`).
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
    /// Name wie in `pack.json` und im Katalog.
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ConfigVersionDir {
    #[default]
    None,
    MajorMinor,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupSpec {
    pub pack_id: String,
    pub version_range: String,
    pub roots: Vec<RootId>,
    #[serde(default)]
    pub config_version_dir: ConfigVersionDir,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsDetect {
    #[serde(default)]
    pub uninstall_display_name_prefixes: Vec<String>,
    #[serde(default)]
    pub exe_names: Vec<String>,
    /// Mit `{ProgramFiles}`, `{LocalAppData}` und `*` als Platzhalter.
    #[serde(default)]
    pub known_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steam_app_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ms_store_package_family: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacDetect {
    #[serde(default)]
    pub bundle_ids: Vec<String>,
    /// Name des App-Bundles in `/Applications` (z. B. `Blender.app`).
    #[serde(default)]
    pub app_names: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxDetect {
    #[serde(default)]
    pub flatpak_ids: Vec<String>,
    #[serde(default)]
    pub snap_names: Vec<String>,
    #[serde(default)]
    pub bin_names: Vec<String>,
    #[serde(default)]
    pub app_image_globs: Vec<String>,
    #[serde(default)]
    pub version_probe: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub windows: Option<WindowsDetect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub macos: Option<MacDetect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linux: Option<LinuxDetect>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramSpec {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub category: ProgramCategory,
    pub description: String,
    pub homepage: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_notes_url: Option<String>,
    pub license: LicenseInfo,
    pub detect: DetectSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup: Option<SetupSpec>,
    pub releases: Vec<ReleaseSpec>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkSpec {
    pub id: String,
    pub name: String,
    pub url: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
    pub id: String,
    pub name: String,
    pub license: LicenseInfo,
    pub url: String,
    pub size: u64,
    pub sha256: String,
    pub purpose: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub schema_version: u32,
    pub sequence: u64,
    pub generated_at: String,
    pub expires_at: String,
    pub min_app_version: String,
    pub programs: Vec<ProgramSpec>,
    pub links: Vec<LinkSpec>,
    pub print_profiles: Vec<PrintProfile>,
    #[serde(default)]
    pub models: Vec<ModelSpec>,
}
