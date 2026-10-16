//! Cypher-Einrichtung (Abschnitt 6 von docs/ipc-contract.ts).

use std::collections::BTreeMap;

use super::common::{
    DisplayPath, HexColor, IsoDateTime, JobId, PackId, PlanId, ProgramId, SemVer, SetupId, SetupScopeId,
};
use super::error::AppError;

dto_struct! {
    pub struct SetupPreviewReq {
        pub pack_id: PackId,
        pub scope_id: SetupScopeId,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum SetupComponentKind {
        Palette,
        Fonts,
        Templates,
        Workspace,
        Bundle,
        AppTemplate,
        Extension,
        AssetLibrary,
        Titles,
        VideoProfiles,
        RenderPreset,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum SetupComponentStatus {
        Current,
        New,
        Outdated,
        UserModified,
        Partial,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum SetupOperationKind {
        Create,
        Update,
        Skip,
        Conflict,
        InstallFont,
        BlenderExtension,
        WriteConfig,
    }
}

dto_struct! {
    pub struct SetupOperation {
        pub kind: SetupOperationKind,
        pub target: DisplayPath,
        pub source_id: String,
        pub bytes: u64,
        pub conflict_id: Option<String>,
    }
}

inline_struct! {
    pub struct SetupComponentPreview {
        pub colors: Vec<HexColor>,
        pub formats: Vec<String>,
        pub fonts: Vec<String>,
    }
}

dto_struct! {
    pub struct SetupComponent {
        pub id: String,
        pub kind: SetupComponentKind,
        pub label: String,
        pub optional: bool,
        pub default_selected: bool,
        pub status: SetupComponentStatus,
        #[ts(inline)]
        pub preview: SetupComponentPreview,
        pub operations: Vec<SetupOperation>,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum ConflictReason {
        UserModified,
        ForeignFile,
    }
}

dto_struct! {
    pub struct SetupConflict {
        pub conflict_id: String,
        pub component_id: String,
        pub target: DisplayPath,
        #[ts(inline)]
        pub reason: ConflictReason,
        pub keep_both_name: String,
    }
}

dto_struct! {
    pub struct SetupPlan {
        pub plan_id: PlanId,
        pub pack_id: PackId,
        pub program_id: Option<ProgramId>,
        pub scope_id: SetupScopeId,
        pub pack_version: SemVer,
        pub pack_label: String,
        pub previous: Option<SetupRecord>,
        pub components: Vec<SetupComponent>,
        pub conflicts: Vec<SetupConflict>,
        pub program_running: bool,
        pub restart_hint: bool,
        pub created_at: IsoDateTime,
        pub expires_at: IsoDateTime,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum ConflictResolution {
        Overwrite,
        KeepBoth,
        Skip,
    }
}

dto_struct! {
    pub struct SetupApplyReq {
        pub plan_id: PlanId,
        pub components: Vec<String>,
        pub resolutions: BTreeMap<String, ConflictResolution>,
    }
}

dto_enum! {
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum SetupEvent {
        Started { job_id: JobId, total: u32 },
        Step { index: u32, total: u32, component_id: String, operation: SetupOperation },
        Finished { record: SetupRecord },
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum SetupRecordStatus {
        Applied,
        Partial,
        Undone,
    }
}

inline_struct! {
    pub struct SetupFailure {
        pub target: DisplayPath,
        pub error: AppError,
    }
}

dto_struct! {
    pub struct SetupRecord {
        pub setup_id: SetupId,
        pub pack_id: PackId,
        pub program_id: Option<ProgramId>,
        pub scope_id: SetupScopeId,
        pub pack_version: SemVer,
        pub components: Vec<String>,
        pub applied_at: IsoDateTime,
        #[ts(inline)]
        pub status: SetupRecordStatus,
        pub files_written: u32,
        pub backups_taken: u32,
        pub undo_available: bool,
        #[ts(inline)]
        pub failures: Vec<SetupFailure>,
    }
}

dto_struct! {
    pub struct SetupUndoReq {
        pub setup_id: SetupId,
    }
}

dto_struct! {
    pub struct UndoReport {
        pub setup_id: SetupId,
        pub restored: u32,
        pub removed: u32,
        pub kept_modified: Vec<DisplayPath>,
        pub fonts_removed: u32,
    }
}

dto_struct! {
    pub struct SetupStatusReq {
        pub pack_id: PackId,
    }
}

dto_struct! {
    pub struct SetupHistoryReq {
        pub pack_id: PackId,
        pub scope_id: SetupScopeId,
    }
}
