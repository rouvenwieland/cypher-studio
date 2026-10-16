//! Projekte und Vorlagen (Abschnitt 8 von docs/ipc-contract.ts).

use super::brand::{MockupDocument, SocialDocument};
use super::common::{AssetUrl, DisplayPath, FileHandleId, IsoDateTime, ProgramId, ProjectId, TemplateId};
use super::files::FileHandleInfo;
use super::programs::LaunchResult;

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    pub enum ProjectFolder {
        #[serde(rename = "Motive")]
        Motive,
        #[serde(rename = "Mockups")]
        Mockups,
        #[serde(rename = "Social")]
        Social,
        #[serde(rename = "Video")]
        Video,
        #[serde(rename = "3D")]
        ThreeD,
        #[serde(rename = "Export/Druck")]
        ExportDruck,
        #[serde(rename = "Export/Social")]
        ExportSocial,
    }
}

impl ProjectFolder {
    /// Relativer Ordnername im Projekt (mit „/“ als Trenner).
    pub const fn dir_name(self) -> &'static str {
        match self {
            ProjectFolder::Motive => "Motive",
            ProjectFolder::Mockups => "Mockups",
            ProjectFolder::Social => "Social",
            ProjectFolder::Video => "Video",
            ProjectFolder::ThreeD => "3D",
            ProjectFolder::ExportDruck => "Export/Druck",
            ProjectFolder::ExportSocial => "Export/Social",
        }
    }

    pub const ALL: [ProjectFolder; 7] = [
        ProjectFolder::Motive,
        ProjectFolder::Mockups,
        ProjectFolder::Social,
        ProjectFolder::Video,
        ProjectFolder::ThreeD,
        ProjectFolder::ExportDruck,
        ProjectFolder::ExportSocial,
    ];
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum TemplateTarget {
        Program,
        Mockup,
        Social,
    }
}

inline_struct! {
    pub struct TemplateFormat {
        pub label: String,
        pub width_px: u32,
        pub height_px: u32,
        pub dpi: Option<u32>,
        pub width_mm: Option<f64>,
        pub height_mm: Option<f64>,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum TemplateSource {
        Builtin,
        Library,
    }
}

dto_struct! {
    pub struct TemplateInfo {
        pub id: TemplateId,
        pub title: String,
        pub description: String,
        #[ts(inline)]
        pub target: TemplateTarget,
        pub program_id: Option<ProgramId>,
        #[ts(inline)]
        pub format: TemplateFormat,
        pub aspect: f64,
        pub folder: ProjectFolder,
        pub file_extension: String,
        pub print_profile_id: Option<String>,
        pub preview_url: Option<AssetUrl>,
        #[ts(inline)]
        pub source: TemplateSource,
        pub requires_setup: bool,
        pub tags: Vec<String>,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum ModuleKind {
        Mockup,
        Social,
    }
}

dto_struct! {
    pub struct ProjectFileRef {
        pub rel_path: String,
        pub modified_at: IsoDateTime,
        pub program_id: Option<ProgramId>,
        #[ts(inline)]
        pub module: Option<ModuleKind>,
    }
}

dto_struct! {
    pub struct Project {
        pub id: ProjectId,
        pub name: String,
        pub collection: Option<String>,
        pub dir: DisplayPath,
        pub in_library: bool,
        pub file_count: u32,
        pub last_file: Option<ProjectFileRef>,
        pub created_at: IsoDateTime,
        pub updated_at: IsoDateTime,
        pub missing: bool,
    }
}

dto_struct! {
    pub struct ProjectCreateReq {
        pub name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub collection: Option<String>,
    }
}

dto_struct! {
    pub struct ProjectRef {
        pub project_id: ProjectId,
    }
}

dto_struct! {
    pub struct ProjectFileReq {
        pub project_id: ProjectId,
        pub rel_path: String,
    }
}

dto_struct! {
    pub struct ProjectNewFileReq {
        pub project_id: ProjectId,
        pub template_id: TemplateId,
        pub file_name: String,
    }
}

dto_struct! {
    pub struct ProjectFile {
        pub project_id: ProjectId,
        #[serde(rename = "ref")]
        pub file_ref: ProjectFileRef,
        pub handle: FileHandleInfo,
    }
}

dto_struct! {
    pub struct ProjectSetCollectionReq {
        pub project_id: ProjectId,
        pub collection: Option<String>,
    }
}

inline_enum! {
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum ProjectOpenOutcome {
        Launched { launch: LaunchResult },
        Module {
            #[ts(inline)]
            module: ModuleKind,
            project_id: ProjectId,
            rel_path: String,
        },
        ProgramMissing { program_id: ProgramId },
    }
}

dto_struct! {
    pub struct ProjectOpenResult {
        #[ts(inline)]
        pub outcome: ProjectOpenOutcome,
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(untagged)]
pub enum ProjectDocumentData {
    Mockup(MockupDocument),
    Social(SocialDocument),
}

dto_struct! {
    pub struct ProjectDocument {
        #[ts(type = "1")]
        pub schema_version: u8,
        #[ts(inline)]
        pub module: ModuleKind,
        #[ts(inline)]
        pub data: ProjectDocumentData,
    }
}

dto_struct! {
    pub struct ProjectReadDocumentReq {
        pub project_id: ProjectId,
        pub rel_path: String,
    }
}

dto_struct! {
    pub struct ProjectWriteDocumentReq {
        pub project_id: ProjectId,
        pub rel_path: String,
        pub document: ProjectDocument,
    }
}

dto_struct! {
    pub struct ProjectAddAssetReq {
        pub project_id: ProjectId,
        pub handle_id: FileHandleId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub folder: Option<ProjectFolder>,
    }
}

dto_struct! {
    pub struct ProjectAsset {
        pub rel_path: String,
        pub handle: FileHandleInfo,
    }
}
