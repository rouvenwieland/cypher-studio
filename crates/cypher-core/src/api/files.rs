//! Dateien (Handles statt Pfade), Beispieldateien (Abschnitt 7 von docs/ipc-contract.ts).

use super::common::{AssetUrl, DisplayPath, FileHandleId, ProjectId};
use super::projects::ProjectFolder;

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum FilePurpose {
        Printcheck,
        MockupDesign,
        SocialImage,
        Bgremove,
        LibraryImport,
        PackImport,
        OpenAny,
    }
}

dto_struct! {
    pub struct FilePickReq {
        pub purpose: FilePurpose,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub multiple: Option<bool>,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum HandleSource {
        Dialog,
        Drop,
        Library,
        Project,
        Export,
        Sample,
    }
}

dto_struct! {
    pub struct FileHandleInfo {
        pub id: FileHandleId,
        pub name: String,
        pub display_path: DisplayPath,
        pub size: u64,
        pub mime: String,
        pub url: Option<AssetUrl>,
        #[ts(inline)]
        pub source: HandleSource,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum ExportImageFormat {
        Png,
        Jpeg,
    }
}

inline_enum! {
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum ExportDestination {
        Dialog,
        Project { project_id: ProjectId, folder: ProjectFolder },
        Library { subfolder: String },
    }
}

dto_struct! {
    pub struct ExportImageMeta {
        pub file_name: String,
        #[ts(inline)]
        pub format: ExportImageFormat,
        #[ts(inline)]
        pub destination: ExportDestination,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub dpi: Option<u32>,
    }
}

/// Kopfzeile des RAW-Commands `export_save_image` (JSON von `ExportImageMeta`, `encodeURIComponent`).
pub const EXPORT_IMAGE_META_HEADER: &str = "x-cypher-export-meta";
/// Größtes erlaubtes Bild für `export_save_image`.
pub const EXPORT_IMAGE_MAX_BYTES: u64 = 64 * 1024 * 1024;

dto_struct! {
    pub struct SampleInfo {
        pub id: String,
        pub title: String,
        pub description: String,
        pub handle: FileHandleInfo,
    }
}
