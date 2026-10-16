//! App-Update, Aufträge (Jobs), Hintergrundentfernung, globale Ereignisse
//! (Abschnitte 12, 13 und 15 von docs/ipc-contract.ts).

use super::app::LicenseInfo;
use super::common::{FileHandleId, Point};
use super::common::{InstallationId, IsoDateTime, JobId, ProjectId, SemVer, SetupId};
use super::error::AppError;
use super::files::FileHandleInfo;
use serde::{Deserialize, Serialize};

dto_struct! {
    pub struct UpdateCheck {
        pub available: bool,
        pub current_version: SemVer,
        pub version: Option<SemVer>,
        pub date: Option<IsoDateTime>,
        pub notes: Option<String>,
        pub checked_at: IsoDateTime,
    }
}

dto_enum! {
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum UpdateEvent {
        Started { job_id: JobId, content_length: Option<u64> },
        Progress { downloaded_bytes: u64, content_length: Option<u64> },
        Installing,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum JobKind {
        Install,
        SetupApply,
        SetupUndo,
        LibraryScan,
        PackExport,
        PackImport,
        PrintExport,
        AppUpdate,
        BgremoveModel,
        BgremoveRun,
    }
}

dto_struct! {
    pub struct JobInfo {
        pub id: JobId,
        pub kind: JobKind,
        pub subject: String,
        pub started_at: IsoDateTime,
        pub cancellable: bool,
        pub progress: Option<f64>,
        pub phase: Option<String>,
        pub needs_attention: bool,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum JobOutcome {
        Succeeded,
        Failed,
        Cancelled,
    }
}

inline_enum! {
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum JobResult {
        File { handle: FileHandleInfo },
        Installation { installation_id: InstallationId },
        Setup { setup_id: SetupId },
        None,
    }
}

dto_struct! {
    pub struct JobRecord {
        pub info: JobInfo,
        pub finished_at: IsoDateTime,
        #[ts(inline)]
        pub outcome: JobOutcome,
        pub error: Option<AppError>,
        #[ts(inline)]
        pub result: JobResult,
    }
}

dto_struct! {
    pub struct JobCancelReq {
        pub job_id: JobId,
    }
}

dto_struct! {
    pub struct AppCloseReq {
        pub force: bool,
    }
}

dto_struct! {
    pub struct BgRemoveModelInfo {
        pub id: String,
        pub name: String,
        pub license: LicenseInfo,
        pub size: u64,
        pub installed: bool,
        pub notice: Option<String>,
    }
}

dto_struct! {
    pub struct BgRemoveStatus {
        pub color_key_available: bool,
        pub model_feature: bool,
        pub runtime_installed: bool,
        pub models: Vec<BgRemoveModelInfo>,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum ColorKeySample {
        Corners,
        Border,
    }
}

dto_enum! {
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum BgRemoveMethod {
        ColorKey {
            tolerance: f64,
            #[ts(inline)]
            sample: ColorKeySample,
        },
        Model { model_id: String, refine_edges: bool },
    }
}

dto_struct! {
    pub struct BgRemoveModelReq {
        pub model_id: String,
    }
}

dto_struct! {
    pub struct BgRemoveRunReq {
        pub handle_id: FileHandleId,
        pub method: BgRemoveMethod,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum BgRemoveStage {
        Load,
        Infer,
        Compose,
        Encode,
    }
}

dto_enum! {
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum BgRemoveEvent {
        Started { job_id: JobId },
        Stage {
            #[ts(inline)]
            stage: BgRemoveStage,
        },
        Finished,
    }
}

// --- Nutzlasten der globalen Ereignisse (nur Serialisierung, kein TypeScript-Export: im Vertrag namenlos) ---

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProgramsChangedReason {
    Installed,
    Removed,
    Rescanned,
    SetupChanged,
    PreferredChanged,
    CatalogChanged,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramsChanged {
    pub reason: ProgramsChangedReason,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LibraryChangedReason {
    Watcher,
    Import,
    Scan,
    Meta,
    PackImport,
    RootChanged,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryChanged {
    pub reason: LibraryChangedReason,
    pub changed_count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsChanged {
    pub project_id: Option<ProjectId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesDropped {
    pub handles: Vec<FileHandleInfo>,
    pub position: Point,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCloseRequested {
    pub active_jobs: Vec<JobInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobsChanged {
    pub active: Vec<JobInfo>,
    pub finished: Option<JobRecord>,
}
