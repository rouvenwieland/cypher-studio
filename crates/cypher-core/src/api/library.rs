//! Bibliothek (gemeinsamer Ordner, ohne Konten; Abschnitt 9 von docs/ipc-contract.ts).

use std::collections::BTreeMap;

use super::common::{
    AssetUrl, DisplayPath, FileHandleId, GarmentColorId, HexColor, IsoDateTime, JobId, LibraryEntryId, Patch,
    PrintProfileId, ProgramId, ProjectId, SemVer,
};

dto_enum! {
    #[derive(Copy, Eq, Hash, PartialOrd, Ord)]
    #[serde(rename_all = "camelCase")]
    pub enum LibraryKind {
        Image,
        Vector,
        Model3d,
        Video,
        Audio,
        Font,
        Palette,
        Document,
        Other,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum LibraryEntryStatus {
        Draft,
        Approved,
        Archived,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum SyncTool {
        Syncthing,
        Nextcloud,
        Dropbox,
        GoogleDrive,
        OneDrive,
        #[serde(rename = "iCloud")]
        ICloud,
        Unknown,
    }
}

dto_struct! {
    pub struct Collection {
        pub id: String,
        pub name: String,
        pub hex: HexColor,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum RootProblem {
        NotWritable,
        InsideAppData,
        SystemDirectory,
        VeryLarge,
    }
}

dto_struct! {
    pub struct LibraryRootCandidate {
        pub candidate_id: String,
        pub path: DisplayPath,
        pub file_count: u64,
        pub total_bytes: u64,
        pub project_count: u32,
        pub initialized: bool,
        pub sync_tool: Option<SyncTool>,
        #[ts(inline)]
        pub problems: Vec<RootProblem>,
    }
}

dto_struct! {
    pub struct LibraryUseRootReq {
        pub candidate_id: String,
        pub initialize: bool,
    }
}

dto_struct! {
    pub struct LibraryStatus {
        pub configured: bool,
        pub root: Option<DisplayPath>,
        pub initialized: bool,
        pub format_version: Option<u32>,
        pub entry_count: u32,
        pub total_bytes: u64,
        pub project_count: u32,
        pub conflict_count: u32,
        pub last_scan_at: Option<IsoDateTime>,
        pub sync_tool: Option<SyncTool>,
        pub watching: bool,
        pub collections: Vec<Collection>,
    }
}

dto_struct! {
    pub struct SidecarMeta {
        pub title: String,
        pub tags: Vec<String>,
        pub collection: Option<String>,
        pub author: String,
        pub status: LibraryEntryStatus,
        pub notes: String,
        pub colors: Vec<HexColor>,
        pub print_profile_id: Option<PrintProfileId>,
        pub garment_color_ids: Vec<GarmentColorId>,
        pub created_at: IsoDateTime,
        pub updated_at: IsoDateTime,
    }
}

inline_enum! {
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum LibraryConflict {
        SyncConflictCopy { original_rel_path: Option<String> },
    }
}

dto_struct! {
    pub struct LibraryEntry {
        pub id: LibraryEntryId,
        pub kind: LibraryKind,
        pub rel_path: String,
        pub file_name: String,
        pub mime: String,
        pub size: u64,
        pub modified_at: IsoDateTime,
        pub width_px: Option<u32>,
        pub height_px: Option<u32>,
        pub project_id: Option<ProjectId>,
        pub open_with: Option<ProgramId>,
        pub meta: SidecarMeta,
        pub thumbnail_url: Option<AssetUrl>,
        #[ts(inline)]
        pub conflict: Option<LibraryConflict>,
        pub sidecar_missing: bool,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum LibrarySort {
        ModifiedDesc,
        NameAsc,
        Kind,
        SizeDesc,
    }
}

dto_struct! {
    pub struct LibraryQuery {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub text: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub kinds: Option<Vec<LibraryKind>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub collections: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub tags: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub status: Option<Vec<LibraryEntryStatus>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub project_id: Option<ProjectId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub modified_after: Option<IsoDateTime>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub only_conflicts: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub sort: Option<LibrarySort>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub offset: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub limit: Option<u32>,
    }
}

dto_struct! {
    pub struct LibraryFacets {
        pub kinds: BTreeMap<LibraryKind, u32>,
        pub collections: BTreeMap<String, u32>,
        pub tags: BTreeMap<String, u32>,
    }
}

dto_struct! {
    pub struct LibraryPage {
        pub entries: Vec<LibraryEntry>,
        pub total: u32,
        pub offset: u32,
        pub facets: LibraryFacets,
    }
}

dto_struct! {
    pub struct LibraryGetReq {
        pub entry_id: LibraryEntryId,
    }
}

inline_struct! {
    pub struct MetaPatch {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub tags: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Patch::is_absent")]
        #[ts(optional, type = "string | null")]
        pub collection: Patch<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub author: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub status: Option<LibraryEntryStatus>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub notes: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub colors: Option<Vec<HexColor>>,
        #[serde(default, skip_serializing_if = "Patch::is_absent")]
        #[ts(optional, type = "string | null")]
        pub print_profile_id: Patch<PrintProfileId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub garment_color_ids: Option<Vec<GarmentColorId>>,
    }
}

dto_struct! {
    pub struct LibraryMetaPatchReq {
        pub entry_id: LibraryEntryId,
        #[ts(inline)]
        pub patch: MetaPatch,
    }
}

dto_struct! {
    pub struct LibraryBulkMetaReq {
        pub entry_ids: Vec<LibraryEntryId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub add_tags: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub remove_tags: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Patch::is_absent")]
        #[ts(optional, type = "string | null")]
        pub collection: Patch<String>,
    }
}

inline_struct! {
    pub struct ImportMeta {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub tags: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub author: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub collection: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub status: Option<LibraryEntryStatus>,
    }
}

dto_struct! {
    pub struct LibraryImportReq {
        pub handle_ids: Vec<FileHandleId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub subfolder: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, inline)]
        pub meta: Option<ImportMeta>,
    }
}

dto_struct! {
    pub struct LibrarySetCollectionsReq {
        pub collections: Vec<Collection>,
    }
}

dto_enum! {
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum ScanEvent {
        Started { job_id: JobId },
        Progress { scanned: u32, found: u32 },
        Finished { status: LibraryStatus },
    }
}

dto_struct! {
    pub struct PackExportReq {
        pub entry_ids: Vec<LibraryEntryId>,
        pub title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub include_sidecars: Option<bool>,
    }
}

dto_enum! {
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum PackEvent {
        Started { job_id: JobId, total: u32 },
        Progress { done: u32, total: u32 },
        Finished,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum PackEntryState {
        New,
        Identical,
        Conflict,
    }
}

dto_struct! {
    pub struct PackPreviewEntry {
        pub rel_path: String,
        pub kind: LibraryKind,
        pub size: u64,
        #[ts(inline)]
        pub state: PackEntryState,
    }
}

dto_struct! {
    pub struct PackPreview {
        pub handle_id: FileHandleId,
        pub format_version: u32,
        pub title: String,
        pub created_by: String,
        pub created_at: IsoDateTime,
        pub app_version: SemVer,
        pub entries: Vec<PackPreviewEntry>,
        pub total_bytes: u64,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum PackConflictPolicy {
        Skip,
        KeepBoth,
        Overwrite,
    }
}

dto_struct! {
    pub struct PackInspectReq {
        pub handle_id: FileHandleId,
    }
}

dto_struct! {
    pub struct PackImportReq {
        pub handle_id: FileHandleId,
        pub conflict_policy: PackConflictPolicy,
    }
}

dto_struct! {
    pub struct PackImportReport {
        pub imported: u32,
        pub skipped: u32,
        pub renamed: u32,
        pub overwritten: u32,
    }
}
