//! Druckprüfer (Abschnitt 10 von docs/ipc-contract.ts; Werte: docs/research/vorgaben.md).

use std::collections::BTreeMap;

use super::common::{FileHandleId, GarmentColorId, IsoDateTime, JobId, PrintProfileId, ProjectId, Rect, Size};
use super::files::FileHandleInfo;

dto_enum! {
    #[derive(Copy, Eq, Hash, PartialOrd, Ord)]
    #[serde(rename_all = "lowercase")]
    pub enum Severity {
        Info,
        Warning,
        Error,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum PrintPlacement {
        Front,
        Back,
        SleeveLeft,
        SleeveRight,
        BackInside,
    }
}

impl PrintPlacement {
    /// Kurzname für Dateinamen (`tee-front`).
    pub const fn slug(self) -> &'static str {
        match self {
            PrintPlacement::Front => "front",
            PrintPlacement::Back => "back",
            PrintPlacement::SleeveLeft => "sleeve-left",
            PrintPlacement::SleeveRight => "sleeve-right",
            PrintPlacement::BackInside => "back-inside",
        }
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum PrintTechnique {
        Dtg,
        Dtf,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum ColorProfileKind {
        Srgb,
        AdobeRgb,
        DisplayP3,
        Gray,
        Cmyk,
        Other,
        None,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum ExportColorProfile {
        AdobeRgb,
        Srgb,
    }
}

dto_struct! {
    pub struct PrintWidthPreset {
        pub id: String,
        pub label: String,
        pub width_mm: f64,
        pub max_width_mm: Option<f64>,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum PrintProvider {
        Shirtigo,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum ProductKind {
        Tee,
        Hoodie,
    }
}

inline_struct! {
    pub struct PrintProduct {
        #[ts(inline)]
        pub id: ProductKind,
        pub provider_product_id: String,
        pub label: String,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum UploadFormat {
        Png,
        Jpeg,
    }
}

inline_struct! {
    pub struct ProfileColorRules {
        pub export_profile: ExportColorProfile,
        pub accepted_profiles: Vec<ExportColorProfile>,
    }
}

inline_struct! {
    pub struct AlphaRules {
        pub semi_min: u8,
        pub semi_max: u8,
        pub ghost_max: u8,
        pub edge_radius_px: u32,
        pub warn_share: f64,
        pub error_share: f64,
        pub severity_on_light_garment: Severity,
        pub severity_for_dtf: Severity,
    }
}

inline_struct! {
    pub struct StrokeRules {
        pub warn_below_px: u32,
        pub critical_below_px: u32,
    }
}

inline_struct! {
    pub struct ProfileSource {
        pub urls: Vec<String>,
        pub checked_at: Option<IsoDateTime>,
    }
}

dto_struct! {
    pub struct PrintProfile {
        pub id: PrintProfileId,
        #[ts(inline)]
        pub provider: PrintProvider,
        #[ts(inline)]
        pub product: PrintProduct,
        pub placement: PrintPlacement,
        pub techniques: Vec<PrintTechnique>,
        pub title: String,
        #[ts(inline)]
        pub print_area_mm: SizeMm,
        #[ts(inline)]
        pub safe_area_mm: Option<SizeMm>,
        pub top_margin_hint_mm: Option<f64>,
        pub width_presets: Vec<PrintWidthPreset>,
        pub default_width_mm: f64,
        pub target_dpi: u32,
        pub error_below_dpi: u32,
        pub min_px_per_side: u32,
        pub max_px_per_side: u32,
        pub warn_file_bytes: u64,
        pub max_file_bytes: u64,
        #[ts(inline)]
        pub accepted_upload_formats: Vec<UploadFormat>,
        #[ts(inline)]
        pub color: ProfileColorRules,
        #[ts(inline)]
        pub alpha: AlphaRules,
        #[ts(inline)]
        pub strokes: StrokeRules,
        #[ts(inline)]
        pub source: ProfileSource,
        pub assumption: bool,
    }
}

inline_struct! {
    #[derive(Copy)]
    pub struct SizeMm {
        pub width: f64,
        pub height: f64,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    pub enum PrintRuleId {
        #[serde(rename = "format.unreadable")]
        FormatUnreadable,
        #[serde(rename = "format.notUploadable")]
        FormatNotUploadable,
        #[serde(rename = "format.jpegNoAlpha")]
        FormatJpegNoAlpha,
        #[serde(rename = "format.animated")]
        FormatAnimated,
        #[serde(rename = "format.interlaced")]
        FormatInterlaced,
        #[serde(rename = "format.bitDepth16")]
        FormatBitDepth16,
        #[serde(rename = "format.indexed")]
        FormatIndexed,
        #[serde(rename = "size.belowMinPixels")]
        SizeBelowMinPixels,
        #[serde(rename = "size.aboveMaxPixels")]
        SizeAboveMaxPixels,
        #[serde(rename = "file.tooLarge")]
        FileTooLarge,
        #[serde(rename = "resolution.tooLow")]
        ResolutionTooLow,
        #[serde(rename = "resolution.belowTarget")]
        ResolutionBelowTarget,
        #[serde(rename = "resolution.metadataMismatch")]
        ResolutionMetadataMismatch,
        #[serde(rename = "resolution.upscaleNeeded")]
        ResolutionUpscaleNeeded,
        #[serde(rename = "layout.empty")]
        LayoutEmpty,
        #[serde(rename = "layout.exceedsPrintArea")]
        LayoutExceedsPrintArea,
        #[serde(rename = "layout.exceedsSafeArea")]
        LayoutExceedsSafeArea,
        #[serde(rename = "layout.touchesEdge")]
        LayoutTouchesEdge,
        #[serde(rename = "color.cmyk")]
        ColorCmyk,
        #[serde(rename = "color.noProfile")]
        ColorNoProfile,
        #[serde(rename = "color.unsupportedProfile")]
        ColorUnsupportedProfile,
        #[serde(rename = "color.profileDiffers")]
        ColorProfileDiffers,
        #[serde(rename = "color.grayscale")]
        ColorGrayscale,
        #[serde(rename = "color.nearBlack")]
        ColorNearBlack,
        #[serde(rename = "alpha.missing")]
        AlphaMissing,
        #[serde(rename = "alpha.opaqueBackground")]
        AlphaOpaqueBackground,
        #[serde(rename = "alpha.semiTransparent")]
        AlphaSemiTransparent,
        #[serde(rename = "alpha.ghostPixels")]
        AlphaGhostPixels,
        #[serde(rename = "detail.thinLines")]
        DetailThinLines,
        #[serde(rename = "contrast.lowOnGarment")]
        ContrastLowOnGarment,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum FixKind {
        CleanGhostPixels,
        SemiTransparency,
        NearBlackToPureBlack,
        ColorProfile,
    }
}

inline_enum! {
    #[serde(untagged)]
    pub enum ParamValue {
        Number(f64),
        Bool(bool),
        Text(String),
    }
}

dto_struct! {
    pub struct Finding {
        pub rule_id: PrintRuleId,
        pub severity: Severity,
        #[ts(type = "Record<string, number | string | boolean>")]
        pub params: BTreeMap<String, ParamValue>,
        pub region: Option<Rect>,
        #[ts(inline)]
        pub fix: Option<FixKind>,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum ReportFileFormat {
        Png,
        Tiff,
        Jpeg,
        Webp,
        Other,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum ChannelLayout {
        Gray,
        GrayAlpha,
        Rgb,
        Rgba,
        Cmyk,
        Indexed,
    }
}

inline_struct! {
    pub struct ReportFile {
        pub name: String,
        #[ts(inline)]
        pub format: ReportFileFormat,
        pub width_px: u32,
        pub height_px: u32,
        #[ts(type = "8 | 16 | 32")]
        pub bit_depth: u8,
        #[ts(inline)]
        pub channels: ChannelLayout,
        pub interlaced: bool,
        pub animated: bool,
        pub file_bytes: u64,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    pub enum DpiSource {
        #[serde(rename = "pHYs")]
        PHYs,
        #[serde(rename = "tiffTags")]
        TiffTags,
        #[serde(rename = "jfif")]
        Jfif,
        #[serde(rename = "exif")]
        Exif,
        #[serde(rename = "none")]
        None,
    }
}

inline_struct! {
    pub struct ReportDpi {
        pub x: f64,
        pub y: f64,
        #[ts(inline)]
        pub source: DpiSource,
    }
}

inline_struct! {
    pub struct ReportColor {
        pub profile: ColorProfileKind,
        pub icc_description: Option<String>,
        pub srgb_chunk: bool,
    }
}

inline_struct! {
    pub struct ReportAlpha {
        pub present: bool,
        pub transparent_share: f64,
        pub opaque_share: f64,
        pub semi_share_of_visible: f64,
        pub semi_area_share_of_visible: f64,
        pub ghost_pixel_count: u64,
    }
}

inline_struct! {
    pub struct Margins {
        pub top: u32,
        pub right: u32,
        pub bottom: u32,
        pub left: u32,
    }
}

inline_struct! {
    pub struct ReportGarment {
        pub color_id: GarmentColorId,
        pub underbase: bool,
    }
}

inline_struct! {
    pub struct ReportPlacement {
        pub planned_width_mm: f64,
        pub planned_height_mm: f64,
        pub effective_dpi: f64,
        pub max_width_mm_at_target_dpi: f64,
        pub target_px: Size,
        pub fits_print_area: bool,
        pub fits_safe_area: Option<bool>,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum Verdict {
        Ok,
        Warning,
        Error,
    }
}

dto_struct! {
    pub struct PrintReport {
        pub engine_version: String,
        pub analyzed_at: IsoDateTime,
        #[ts(inline)]
        pub file: ReportFile,
        #[ts(inline)]
        pub dpi: ReportDpi,
        #[ts(inline)]
        pub color: ReportColor,
        #[ts(inline)]
        pub alpha: ReportAlpha,
        pub bounds: Option<Rect>,
        #[ts(inline)]
        pub margins_px: Option<Margins>,
        pub trimmed_px: Option<Size>,
        pub profile_id: PrintProfileId,
        pub technique: PrintTechnique,
        #[ts(inline)]
        pub garment: Option<ReportGarment>,
        #[ts(inline)]
        pub placement: ReportPlacement,
        pub min_stroke_px: Option<f64>,
        pub findings: Vec<Finding>,
        #[ts(inline)]
        pub verdict: Verdict,
    }
}

dto_struct! {
    pub struct PrintAnalyzeReq {
        pub handle_id: FileHandleId,
        pub profile_id: PrintProfileId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub garment_color_id: Option<GarmentColorId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub technique: Option<PrintTechnique>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub planned_width_mm: Option<f64>,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum SemiTransparencyFix {
        Keep,
        Threshold,
        BlendWithGarment,
        Halftone,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum ExportMode {
        Trimmed,
        FullArea,
    }
}

inline_struct! {
    pub struct ExportFixes {
        pub clean_ghost_pixels: bool,
        pub semi_transparency: SemiTransparencyFix,
        pub near_black_to_pure_black: bool,
    }
}

inline_enum! {
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum PrintDestination {
        Dialog,
        BesideSource,
        Library,
        Project { project_id: ProjectId },
    }
}

dto_struct! {
    pub struct PrintExportOptions {
        #[ts(inline)]
        pub mode: ExportMode,
        pub planned_width_mm: f64,
        pub offset_top_mm: f64,
        pub offset_center_mm: f64,
        pub allow_upscale: bool,
        pub color_profile: ExportColorProfile,
        #[ts(inline)]
        pub fixes: ExportFixes,
        pub write_placement_json: bool,
        #[ts(inline)]
        pub destination: PrintDestination,
    }
}

dto_struct! {
    pub struct PrintExportReq {
        pub handle_id: FileHandleId,
        pub profile_id: PrintProfileId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub garment_color_id: Option<GarmentColorId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub technique: Option<PrintTechnique>,
        pub options: PrintExportOptions,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum PrintStage {
        Decode,
        Analyze,
        Fix,
        Resample,
        ColorConvert,
        Encode,
        Verify,
    }
}

dto_enum! {
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum PrintExportEvent {
        Started { job_id: JobId },
        Stage {
            #[ts(inline)]
            stage: PrintStage,
        },
        Finished,
    }
}

dto_struct! {
    pub struct PrintExportResult {
        pub output: FileHandleInfo,
        pub placement_json: Option<FileHandleInfo>,
        pub width_px: u32,
        pub height_px: u32,
        pub dpi: u32,
        pub color_profile: ExportColorProfile,
        pub report: PrintReport,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum OverlayKind {
        SemiTransparent,
        GhostPixels,
        Bounds,
        ThinLines,
        AlphaOnly,
    }
}

dto_struct! {
    pub struct PrintOverlayReq {
        pub handle_id: FileHandleId,
        pub profile_id: PrintProfileId,
        #[ts(inline)]
        pub overlay: OverlayKind,
    }
}
