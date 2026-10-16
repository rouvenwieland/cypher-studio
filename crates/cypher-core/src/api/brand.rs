//! Marke, Mockup, Social (Abschnitt 11 von docs/ipc-contract.ts).

use std::collections::BTreeMap;

use super::common::{
    AssetUrl, GarmentColorId, HexColor, MockupTemplateId, Point, PrintProfileId, Rect, Size, SocialTemplateId,
};
use super::library::Collection;

dto_struct! {
    pub struct GarmentColor {
        pub id: GarmentColorId,
        pub name: String,
        pub hex: HexColor,
        pub textile_hex: HexColor,
        pub provider_color_name: Option<String>,
        pub heather: bool,
        pub underbase: bool,
        pub text_on_garment: HexColor,
    }
}

dto_struct! {
    pub struct PaletteColor {
        pub name: String,
        pub hex: HexColor,
    }
}

dto_struct! {
    pub struct Palette {
        pub id: String,
        pub name: String,
        pub colors: Vec<PaletteColor>,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum FontUsage {
        Display,
        Text,
        Pixel,
        Mono,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    pub enum FontLicense {
        #[serde(rename = "OFL-1.1")]
        Ofl11,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum FontStyle {
        Normal,
        Italic,
    }
}

inline_struct! {
    pub struct BrandFontFile {
        pub url: AssetUrl,
        pub weight: u32,
        #[ts(inline)]
        pub style: FontStyle,
    }
}

dto_struct! {
    pub struct BrandFont {
        pub family: String,
        #[ts(inline)]
        pub usage: FontUsage,
        #[ts(inline)]
        pub license: FontLicense,
        #[ts(inline)]
        pub files: Vec<BrandFontFile>,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum LogoVariant {
        Light,
        Dark,
    }
}

inline_struct! {
    pub struct BrandLogo {
        pub id: String,
        #[ts(inline)]
        pub variant: LogoVariant,
        pub url: AssetUrl,
    }
}

dto_struct! {
    pub struct Brand {
        pub collections: Vec<Collection>,
        pub garment_colors: Vec<GarmentColor>,
        pub palettes: Vec<Palette>,
        pub fonts: Vec<BrandFont>,
        #[ts(inline)]
        pub logos: Vec<BrandLogo>,
    }
}

/// Viereck der Druckfläche im Vorlagenbild: oben links, oben rechts, unten rechts, unten links.
pub type Quad = [Point; 4];

dto_struct! {
    pub struct MockupLayerSet {
        pub mask: AssetUrl,
        pub shade: AssetUrl,
        pub light: AssetUrl,
        pub displace: Option<AssetUrl>,
        pub texture: Option<AssetUrl>,
        pub heather: Option<AssetUrl>,
        pub background: Option<AssetUrl>,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum MockupProduct {
        Tee,
        Hoodie,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum MockupView {
        Front,
        Back,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum Exposure {
        Light,
        Dark,
    }
}

inline_struct! {
    pub struct MockupVariant {
        #[ts(inline)]
        pub exposure: Exposure,
        pub layers: MockupLayerSet,
        pub color_ids: Vec<GarmentColorId>,
    }
}

inline_struct! {
    pub struct MockupPrintArea {
        pub quad: Quad,
    }
}

dto_struct! {
    pub struct MockupTemplate {
        pub id: MockupTemplateId,
        pub title: String,
        #[ts(inline)]
        pub product: MockupProduct,
        #[ts(inline)]
        pub view: MockupView,
        pub canvas: Size,
        pub print_profile_id: PrintProfileId,
        #[ts(inline)]
        pub print_area: MockupPrintArea,
        pub displace_strength_px: f64,
        #[ts(inline)]
        pub variants: Vec<MockupVariant>,
    }
}

inline_struct! {
    pub struct MockupDesignRef {
        pub rel_path: String,
    }
}

inline_struct! {
    pub struct MockupPlacement {
        pub width_mm: f64,
        pub offset_top_mm: f64,
        pub offset_center_mm: f64,
    }
}

inline_enum! {
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum MockupBackground {
        Transparent,
        Color { hex: HexColor },
        Template,
    }
}

dto_struct! {
    pub struct MockupDocument {
        pub template_id: MockupTemplateId,
        pub color_id: GarmentColorId,
        #[ts(inline)]
        pub design: Option<MockupDesignRef>,
        #[ts(inline)]
        pub placement: MockupPlacement,
        #[ts(inline)]
        pub background: MockupBackground,
        pub export_size_px: Size,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum SocialFormat {
        Post,
        PostTall,
        Story,
        ReelCover,
    }
}

impl SocialFormat {
    /// Zielgröße in Pixeln (`SOCIAL_FORMAT_SIZES` im Vertrag).
    pub const fn size(self) -> Size {
        match self {
            SocialFormat::Post => Size { width: 1080.0, height: 1350.0 },
            SocialFormat::PostTall => Size { width: 1080.0, height: 1440.0 },
            SocialFormat::Story | SocialFormat::ReelCover => Size { width: 1080.0, height: 1920.0 },
        }
    }
}

inline_struct! {
    pub struct GradientStop {
        pub at: f64,
        pub color: HexColor,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum ImageFit {
        Cover,
        Contain,
    }
}

dto_enum! {
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum Fill {
        Solid { color: HexColor },
        LinearGradient {
            angle_deg: f64,
            #[ts(inline)]
            stops: Vec<GradientStop>,
        },
        Image {
            url: AssetUrl,
            #[ts(inline)]
            fit: ImageFit,
        },
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum TextAlign {
        Left,
        Center,
        Right,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum TextVAlign {
        Top,
        Middle,
        Bottom,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum TextTransform {
        None,
        Uppercase,
    }
}

dto_enum! {
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum SocialLayer {
        Image {
            id: String,
            slot: String,
            rect: Rect,
            #[ts(inline)]
            fit: ImageFit,
            radius_px: f64,
            required: bool,
        },
        Text {
            id: String,
            slot: String,
            rect: Rect,
            font_family: String,
            font_weight: u32,
            size_px: f64,
            min_size_px: f64,
            line_height: f64,
            letter_spacing_em: f64,
            color: HexColor,
            #[ts(inline)]
            align: TextAlign,
            #[ts(inline)]
            valign: TextVAlign,
            #[ts(inline)]
            transform: TextTransform,
            max_lines: u32,
            default_text: String,
        },
        Shape {
            id: String,
            rect: Rect,
            fill: Fill,
            radius_px: f64,
            opacity: f64,
        },
        Logo {
            id: String,
            rect: Rect,
            #[ts(inline)]
            variant: LogoVariant,
        },
        Grain { id: String, opacity: f64, seed: f64 },
        Scanlines { id: String, opacity: f64, spacing_px: f64 },
    }
}

dto_struct! {
    pub struct SocialTemplate {
        pub id: SocialTemplateId,
        pub title: String,
        pub format: SocialFormat,
        pub size: Size,
        pub background: Fill,
        pub layers: Vec<SocialLayer>,
        pub safe_zones: Vec<Rect>,
        pub grid_crop: Option<Rect>,
        pub preview_url: Option<AssetUrl>,
    }
}

inline_struct! {
    pub struct SocialImageRef {
        pub rel_path: String,
        pub focal: Point,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "lowercase")]
    pub enum SocialExportFormat {
        Png,
        Jpeg,
    }
}

dto_struct! {
    pub struct SocialDocument {
        pub template_id: SocialTemplateId,
        pub format: SocialFormat,
        pub texts: BTreeMap<String, String>,
        #[ts(inline)]
        pub images: BTreeMap<String, Option<SocialImageRef>>,
        pub color_overrides: BTreeMap<String, HexColor>,
        #[ts(inline)]
        pub export_format: SocialExportFormat,
    }
}
