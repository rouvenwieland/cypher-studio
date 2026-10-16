//! Programme, Installationen, Installation, Starten (Abschnitte 4 und 5 von docs/ipc-contract.ts).

use super::app::LicenseInfo;
use super::common::{
    DisplayPath, FileHandleId, InstallationId, IsoDateTime, JobId, PlanId, ProgramId, ProgramVersion, SetupScopeId,
    Sha256Hex, SpdxId,
};
use super::error::SetupUnsupportedReason;
use super::setup::SetupRecord;

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum ProgramCategory {
        Raster,
        Vector,
        #[serde(rename = "3d")]
        ThreeD,
        Video,
        Audio,
        Upscale,
        Other,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum InstallKind {
        Cypher,
        System,
        Flatpak,
        Snap,
        Msstore,
        Steam,
        Manual,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum FuseFallback {
        ExtractAndRun,
        Extracted,
    }
}

dto_enum! {
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum InstallationProblem {
        ExecutableMissing,
        FuseMissing {
            #[ts(inline)]
            fallback: FuseFallback,
        },
        NotNotarized,
        VersionUnknown,
        SetupNotSupported { reason: SetupUnsupportedReason },
        StaleCatalogVersion { latest: ProgramVersion },
        EndOfSupportSoon { until: String },
    }
}

inline_struct! {
    pub struct VerifiedInfo {
        pub sha256: Sha256Hex,
        pub catalog_sequence: u64,
        pub signature_checked: bool,
    }
}

dto_struct! {
    pub struct Installation {
        pub id: InstallationId,
        pub program_id: ProgramId,
        pub version: Option<String>,
        pub kind: InstallKind,
        pub managed_by_cypher: bool,
        pub location: DisplayPath,
        pub launchable: bool,
        pub problems: Vec<InstallationProblem>,
        pub installed_at: Option<IsoDateTime>,
        pub detected_at: IsoDateTime,
        #[ts(inline)]
        pub verified: Option<VerifiedInfo>,
        pub setup_scope_id: Option<SetupScopeId>,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum ReleaseChannel {
        Stable,
        Lts,
        Preview,
    }
}

dto_struct! {
    pub struct ProgramRelease {
        pub version: ProgramVersion,
        pub channel: ReleaseChannel,
        pub released_at: Option<IsoDateTime>,
        pub download_size: u64,
        pub available_for_this_platform: bool,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum SetupStatus {
        NotApplied,
        Applied,
        Outdated,
        Partial,
        Unsupported,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum ScopeKind {
        UserProfile,
        PortableInstall,
        FlatpakProfile,
        SnapProfile,
        UserFonts,
    }
}

dto_struct! {
    pub struct SetupScope {
        pub scope_id: SetupScopeId,
        #[ts(inline)]
        pub scope_kind: ScopeKind,
        pub components_applied: Vec<String>,
        pub target_roots: Vec<DisplayPath>,
        pub installation_ids: Vec<InstallationId>,
        pub status: SetupStatus,
        pub record: Option<SetupRecord>,
    }
}

dto_struct! {
    pub struct SetupSummary {
        pub pack_id: String,
        pub program_id: Option<ProgramId>,
        pub title: String,
        pub pack_version: String,
        pub requires_packs: Vec<String>,
        pub scopes: Vec<SetupScope>,
    }
}

dto_struct! {
    pub struct ProgramOverview {
        pub id: ProgramId,
        pub name: String,
        pub vendor: String,
        pub category: ProgramCategory,
        pub description: String,
        pub license: LicenseInfo,
        pub supported_on_this_platform: bool,
        pub latest: Option<ProgramRelease>,
        pub installations: Vec<Installation>,
        pub preferred_installation_id: Option<InstallationId>,
        pub update_available: bool,
        pub setup: Option<SetupSummary>,
    }
}

dto_struct! {
    pub struct ProgramsView {
        pub programs: Vec<ProgramOverview>,
        pub links: Vec<super::app::CatalogLink>,
        pub catalog: super::app::CatalogStatus,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum ArtifactKind {
        Zip,
        #[serde(rename = "7z")]
        SevenZ,
        TarXz,
        TarGz,
        Dmg,
        AppImage,
        Sfx7z,
        ExeInstaller,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum SignatureType {
        Pgp,
        Minisign,
    }
}

dto_struct! {
    pub struct SignatureInfo {
        #[serde(rename = "type")]
        #[ts(inline)]
        pub signature_type: SignatureType,
        pub enforced: bool,
        pub url: String,
        pub signer_fingerprints: Vec<String>,
    }
}

dto_struct! {
    pub struct InstallPreviewReq {
        pub program_id: ProgramId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub version: Option<ProgramVersion>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub channel: Option<ReleaseChannel>,
    }
}

inline_struct! {
    pub struct PlanSource {
        pub label: String,
        pub host: String,
        pub url: String,
        pub mirror_redirects: bool,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum ChecksumOrigin {
        Upstream,
        CypherPinned,
    }
}

inline_struct! {
    pub struct PlanArtifact {
        #[ts(inline)]
        pub kind: ArtifactKind,
        pub file_name: String,
        pub size: u64,
        pub sha256: Sha256Hex,
        pub checksum_source: String,
        #[ts(inline)]
        pub checksum_origin: ChecksumOrigin,
        pub signature: Option<SignatureInfo>,
    }
}

inline_struct! {
    pub struct PlanTarget {
        pub dir: DisplayPath,
        pub required_bytes: u64,
        pub available_bytes: u64,
        #[ts(type = "true")]
        pub portable: bool,
        #[ts(type = "false")]
        pub needs_admin: bool,
    }
}

dto_struct! {
    pub struct InstallPlan {
        pub plan_id: PlanId,
        pub program_id: ProgramId,
        pub program_name: String,
        pub version: ProgramVersion,
        pub channel: ReleaseChannel,
        #[ts(inline)]
        pub source: PlanSource,
        #[ts(inline)]
        pub artifact: PlanArtifact,
        pub license: LicenseInfo,
        #[ts(inline)]
        pub target: PlanTarget,
        pub replaces: Option<Installation>,
        pub existing: Vec<Installation>,
        pub notes: Vec<InstallNote>,
        pub created_at: IsoDateTime,
        pub expires_at: IsoDateTime,
    }
}

dto_enum! {
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum InstallNote {
        MacosNotarizationCheck,
        MacosNotNotarized,
        IntelMacOldRelease { version: ProgramVersion },
        LinuxFuseMissing {
            #[ts(inline)]
            fallback: FuseFallback,
        },
        WindowsSmartScreenNotExpected,
        LargeDownload { bytes: u64 },
        CatalogExpired,
        ResumeAvailable { bytes_done: u64 },
    }
}

dto_struct! {
    pub struct InstallConsent {
        pub plan_id: PlanId,
        pub sha256: Sha256Hex,
        pub license_spdx: SpdxId,
        pub target_dir: DisplayPath,
        pub accepted_at: IsoDateTime,
    }
}

dto_struct! {
    pub struct InstallStartReq {
        pub plan_id: PlanId,
        pub consent: InstallConsent,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum InstallPhase {
        Download,
        VerifyChecksum,
        VerifySignature,
        Extract,
        CheckContent,
        Register,
    }
}

dto_enum! {
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum InstallEvent {
        Started { job_id: JobId, total_bytes: u64 },
        Phase { phase: InstallPhase },
        DownloadProgress { downloaded_bytes: u64, total_bytes: u64, bytes_per_second: u64 },
        Resumed { from_byte: u64 },
        Retrying { attempt: u32, max_attempts: u32, delay_ms: u64, reason: String },
        Verified { sha256: Sha256Hex, signature_checked: bool },
        ExtractProgress { entries_done: u64, entries_total: Option<u64>, bytes_written: u64 },
        Finished { installation: Installation },
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum RemoveMode {
        DeleteFiles,
        Forget,
    }
}

dto_struct! {
    pub struct InstallationRemoveReq {
        pub installation_id: InstallationId,
        #[ts(inline)]
        pub mode: RemoveMode,
    }
}

dto_struct! {
    pub struct SetPreferredReq {
        pub program_id: ProgramId,
        pub installation_id: InstallationId,
    }
}

dto_struct! {
    pub struct AddManualReq {
        pub program_id: ProgramId,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum LaunchMode {
        Normal,
        BlenderAppTemplate,
    }
}

dto_struct! {
    pub struct LaunchReq {
        pub program_id: ProgramId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub installation_id: Option<InstallationId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub files: Option<Vec<FileHandleId>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub mode: Option<LaunchMode>,
    }
}

dto_struct! {
    pub struct LaunchResult {
        pub program_id: ProgramId,
        pub installation_id: InstallationId,
        pub pid: Option<u32>,
        pub started_at: IsoDateTime,
    }
}
