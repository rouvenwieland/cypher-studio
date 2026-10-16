//! Export: Korrekturen, Zuschnitt, Skalierung (Lanczos3, vormultipliziertes Alpha), Farbumrechnung und
//! PNG-Ausgabe mit 300 dpi (`pHYs` 11811), eingebettetem Profil und Begleitdatei (`.shirtigo.json`).

use std::borrow::Cow;

use fast_image_resize as fr;
use serde::Serialize;
use tokio_util::sync::CancellationToken;

use crate::api::{
    ColorProfileKind, ExportColorProfile, ExportMode, GarmentColor, PrintExportOptions, PrintPlacement, PrintProfile,
    PrintTechnique, SemiTransparencyFix,
};
use crate::error::PrintError;

use super::analyze::{self, PHYS_300_DPI};
use super::decode::DecodedImage;
use super::icc;
use super::meta::ImageMeta;
use super::scan::{self, PxRect, Thresholds};

const MM_PER_INCH: f64 = 25.4;
/// Ausgabeauflösung des Exports.
pub const EXPORT_DPI: u32 = 300;

fn check_cancel(cancel: &CancellationToken) -> Result<(), PrintError> {
    if cancel.is_cancelled() { Err(PrintError::Cancelled) } else { Ok(()) }
}

fn mm_to_px(mm: f64) -> f64 {
    mm / MM_PER_INCH * f64::from(EXPORT_DPI)
}

fn px_to_mm(px: f64) -> f64 {
    px / f64::from(EXPORT_DPI) * MM_PER_INCH
}

fn invalid(field: &str, reason: impl Into<String>) -> PrintError {
    PrintError::InvalidInput { field: field.to_owned(), reason: reason.into() }
}

/// Lage des Motivs in der Ausgabe.
#[derive(Debug, Clone, PartialEq)]
pub struct Geometry {
    /// Ausschnitt der Quelle (Hüllrechteck des Motivs).
    pub crop: PxRect,
    pub motif_w: u32,
    pub motif_h: u32,
    pub canvas_w: u32,
    pub canvas_h: u32,
    pub place_x: u32,
    pub place_y: u32,
    /// Tatsächliche Motivbreite in mm (nach Rundung auf ganze Pixel bei 300 dpi).
    pub width_mm: f64,
    pub offset_top_mm: f64,
    pub offset_center_mm: f64,
    /// `true`, wenn die Quelle für die geplante Breite vergrößert werden muss.
    pub upscaled: bool,
    /// `true`, wenn die Breite verkleinert wurde, weil Vergrößern nicht erlaubt ist.
    pub width_clamped: bool,
}

impl Geometry {
    /// `true`, wenn das Motiv neu berechnet werden muss (andere Größe als der Ausschnitt).
    pub fn is_scaled(&self) -> bool {
        self.motif_w != self.crop.width() || self.motif_h != self.crop.height()
    }
}

/// Plant die Ausgabegröße. Fehler, wenn das Motiv nicht in die Druckfläche passt.
pub fn plan(bounds: PxRect, profile: &PrintProfile, options: &PrintExportOptions) -> Result<Geometry, PrintError> {
    let planned = options.planned_width_mm;
    if !planned.is_finite() || planned <= 0.0 {
        return Err(invalid("plannedWidthMm", "muss größer als 0 sein"));
    }
    if !options.offset_top_mm.is_finite() || options.offset_top_mm < 0.0 {
        return Err(invalid("offsetTopMm", "darf nicht negativ sein"));
    }
    if !options.offset_center_mm.is_finite() {
        return Err(invalid("offsetCenterMm", "ungültiger Wert"));
    }
    let (src_w, src_h) = (bounds.width(), bounds.height());
    let wanted_w = mm_to_px(planned).round().max(1.0);
    let mut scale = wanted_w / f64::from(src_w);
    let mut width_clamped = false;
    let upscaled = scale > 1.0 + 1e-9;
    if upscaled && !options.allow_upscale {
        scale = 1.0;
        width_clamped = true;
    }
    let motif_w = ((f64::from(src_w) * scale).round() as u32).max(1);
    let motif_h = ((f64::from(src_h) * scale).round() as u32).max(1);
    let width_mm = if width_clamped { px_to_mm(f64::from(motif_w)) } else { planned };
    let height_mm = px_to_mm(f64::from(motif_h));
    let area = profile.print_area_mm;
    let eps = px_to_mm(1.0);
    if width_mm > area.width + eps || height_mm > area.height + eps {
        return Err(invalid(
            "plannedWidthMm",
            format!(
                "Motiv ({width_mm:.0} x {height_mm:.0} mm) ist größer als die Druckfläche ({} x {} mm)",
                area.width, area.height
            ),
        ));
    }
    if width_mm + 2.0 * options.offset_center_mm.abs() > area.width + eps {
        return Err(invalid("offsetCenterMm", "Motiv ragt seitlich aus der Druckfläche"));
    }
    if height_mm + options.offset_top_mm > area.height + eps {
        return Err(invalid("offsetTopMm", "Motiv ragt unten aus der Druckfläche"));
    }
    let (canvas_w, canvas_h, place_x, place_y) = match options.mode {
        ExportMode::Trimmed => (motif_w, motif_h, 0, 0),
        ExportMode::FullArea => {
            let cw = mm_to_px(area.width).round() as u32;
            let ch = mm_to_px(area.height).round() as u32;
            let centered = (i64::from(cw) - i64::from(motif_w)) / 2 + mm_to_px(options.offset_center_mm).round() as i64;
            let top = mm_to_px(options.offset_top_mm).round() as i64;
            if centered < 0 || centered + i64::from(motif_w) > i64::from(cw) {
                return Err(invalid("offsetCenterMm", "Motiv ragt seitlich aus der Druckfläche"));
            }
            if top + i64::from(motif_h) > i64::from(ch) {
                return Err(invalid("offsetTopMm", "Motiv ragt unten aus der Druckfläche"));
            }
            (cw, ch, centered as u32, top as u32)
        }
    };
    Ok(Geometry {
        crop: bounds,
        motif_w,
        motif_h,
        canvas_w,
        canvas_h,
        place_x,
        place_y,
        width_mm,
        offset_top_mm: options.offset_top_mm,
        offset_center_mm: options.offset_center_mm,
        upscaled,
        width_clamped,
    })
}

// ---------------------------------------------------------------------------------------------
// Korrekturen
// ---------------------------------------------------------------------------------------------

/// Bayer-Matrix 8 x 8 (Schwellen 0..=63) für das einfache Raster.
const BAYER8: [[u8; 8]; 8] = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
];

/// Prüft die Angaben zu den Korrekturen, bevor Rechenarbeit anfällt.
pub fn validate_fixes(options: &PrintExportOptions, garment: Option<&GarmentColor>) -> Result<(), PrintError> {
    if options.fixes.semi_transparency == SemiTransparencyFix::BlendWithGarment {
        let g = garment.ok_or_else(|| {
            invalid("garmentColorId", "Für „mit Textilfarbe verrechnen“ wird eine Textilfarbe benötigt")
        })?;
        if analyze::parse_hex(&g.textile_hex).is_none() {
            return Err(invalid("garmentColorId", "Textilfarbe ist kein gültiger Hex-Wert"));
        }
    }
    Ok(())
}

/// Wendet die Korrekturen auf dem skalierten Motiv an, also in der Auflösung, die der Drucker sieht (ein Raster oder eine
/// Schwelle, die vor dem Skalieren gesetzt würde, würde beim Skalieren wieder verwischt). Reihenfolge: Halbtransparenz,
/// dann Reinschwarz.
///
/// `cleanGhostPixels` braucht hier keinen Eingriff: Geisterpixel liegen per Definition außerhalb des Zuschnitts und
/// fallen beim Ausschneiden weg.
pub fn apply_output_fixes(
    rgba: &mut [u8],
    width: u32,
    height: u32,
    options: &PrintExportOptions,
    garment: Option<&GarmentColor>,
    th: Thresholds,
) -> Result<(), PrintError> {
    validate_fixes(options, garment)?;
    let w = width as usize;
    let fixes = &options.fixes;

    if fixes.semi_transparency != SemiTransparencyFix::Keep {
        let mask = scan::semi_area_mask(rgba, width, height, th);
        let blend_target = garment.and_then(|g| analyze::parse_hex(&g.textile_hex));
        for (i, px) in rgba.chunks_exact_mut(4).enumerate() {
            if mask[i] == 0 {
                continue;
            }
            let a = px[3];
            match fixes.semi_transparency {
                SemiTransparencyFix::Threshold => px[3] = if a >= 128 { 255 } else { 0 },
                SemiTransparencyFix::Halftone => {
                    let (x, y) = (i % w, i / w);
                    // Schwellen 2, 6, ..., 254 (64 Stufen): ein Punkt wird gesetzt, wenn Alpha die Schwelle übersteigt
                    let threshold = u16::from(BAYER8[y % 8][x % 8]) * 4 + 2;
                    px[3] = if u16::from(a) > threshold { 255 } else { 0 };
                }
                SemiTransparencyFix::BlendWithGarment => {
                    if let Some(g) = blend_target {
                        let af = u32::from(a);
                        for c in 0..3 {
                            let v = (u32::from(px[c]) * af + u32::from(g[c]) * (255 - af) + 127) / 255;
                            px[c] = v as u8;
                        }
                        px[3] = 255;
                    }
                }
                SemiTransparencyFix::Keep => {}
            }
        }
    }

    if fixes.near_black_to_pure_black {
        for px in rgba.chunks_exact_mut(4) {
            if px[3] >= th.semi_min
                && (px[0] | px[1] | px[2]) != 0
                && analyze::luma_milli(px[0], px[1], px[2]) < analyze::NEAR_BLACK_LUMA_MILLI
            {
                px[0] = 0;
                px[1] = 0;
                px[2] = 0;
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Skalieren
// ---------------------------------------------------------------------------------------------

/// Schneidet `crop` aus und skaliert auf `out_w` x `out_h`. Bei gleicher Größe wird nur kopiert.
pub fn crop_and_scale(
    img: &DecodedImage,
    crop: PxRect,
    out_w: u32,
    out_h: u32,
    cancel: &CancellationToken,
) -> Result<Vec<u8>, PrintError> {
    check_cancel(cancel)?;
    let stride = img.width as usize * 4;
    if crop.width() == out_w && crop.height() == out_h {
        let mut out = Vec::with_capacity(out_w as usize * out_h as usize * 4);
        for y in crop.y0..crop.y1 {
            let start = y as usize * stride + crop.x0 as usize * 4;
            out.extend_from_slice(&img.rgba[start..start + out_w as usize * 4]);
        }
        return Ok(out);
    }
    // Erst ausschneiden und kopieren: der Zuschnittsparameter von `fast_image_resize` liest für die Filterfenster auch
    // Pixel außerhalb des Ausschnitts, wodurch die Motivkante halbtransparent würde
    let crop_stride = crop.width() as usize * 4;
    let mut cropped = Vec::with_capacity(crop_stride * crop.height() as usize);
    for y in crop.y0..crop.y1 {
        let start = y as usize * stride + crop.x0 as usize * 4;
        cropped.extend_from_slice(&img.rgba[start..start + crop_stride]);
    }
    check_cancel(cancel)?;
    let src = fr::images::ImageRef::new(crop.width(), crop.height(), &cropped, fr::PixelType::U8x4)
        .map_err(|e| PrintError::Encode(format!("Skalierung: {e}")))?;
    let mut dst = fr::images::Image::new(out_w, out_h, fr::PixelType::U8x4);
    // Alpha wird vor dem Filtern vormultipliziert (Standard), damit unter transparenten Pixeln versteckte Farben nicht
    // in die Kanten bluten (kein dunkler Saum)
    let options = fr::ResizeOptions::new().resize_alg(fr::ResizeAlg::Convolution(fr::FilterType::Lanczos3));
    let mut resizer = fr::Resizer::new();
    resizer.resize(&src, &mut dst, &options).map_err(|e| PrintError::Encode(format!("Skalierung: {e}")))?;
    check_cancel(cancel)?;
    Ok(dst.into_vec())
}

/// Ab diesem Alpha gilt ein Pixel nach dem Skalieren als deckend.
pub const SNAP_OPAQUE_FROM: u8 = 240;

/// Räumt das Alpha nach dem Skalieren auf. Lanczos schwingt an harten Kanten nach: auf der transparenten Seite
/// entstehen Alphawerte von 1 bis 8 (sie wären „Geisterpixel“ und verhindern den automatischen Zuschnitt), auf der
/// deckenden Seite Werte um 247 bis 253 (sie wären „Halbtransparenz“). Beides ist ein Rechenartefakt, kein Inhalt:
/// Alpha unter `semi_min` wird zu 0 (so zählt es der Druckanbieter ohnehin), Alpha ab [`SNAP_OPAQUE_FROM`] zu 255.
pub fn clean_resampled_alpha(rgba: &mut [u8], semi_min: u8) {
    for px in rgba.chunks_exact_mut(4) {
        let a = px[3];
        if a < semi_min {
            px.copy_from_slice(&[0, 0, 0, 0]);
        } else if a >= SNAP_OPAQUE_FROM {
            px[3] = 255;
        }
    }
}

/// Legt das Motiv auf eine transparente Leinwand.
pub fn place_on_canvas(motif: &[u8], geo: &Geometry) -> Result<Vec<u8>, PrintError> {
    if geo.canvas_w == geo.motif_w && geo.canvas_h == geo.motif_h {
        return Ok(motif.to_vec());
    }
    let len = (geo.canvas_w as usize)
        .checked_mul(geo.canvas_h as usize)
        .and_then(|n| n.checked_mul(4))
        .ok_or_else(|| PrintError::Encode("Leinwand zu groß".into()))?;
    let mut canvas = vec![0u8; len];
    let src_stride = geo.motif_w as usize * 4;
    let dst_stride = geo.canvas_w as usize * 4;
    for row in 0..geo.motif_h as usize {
        let dst_start = (geo.place_y as usize + row) * dst_stride + geo.place_x as usize * 4;
        canvas[dst_start..dst_start + src_stride].copy_from_slice(&motif[row * src_stride..(row + 1) * src_stride]);
    }
    Ok(canvas)
}

// ---------------------------------------------------------------------------------------------
// Farbe und PNG
// ---------------------------------------------------------------------------------------------

/// Rechnet vom Quell- ins Zielprofil um, falls nötig. Gibt zurück, ob umgerechnet wurde.
pub fn convert_colors(
    rgba: &mut [u8],
    meta: &ImageMeta,
    source_kind: ColorProfileKind,
    target: ExportColorProfile,
) -> Result<bool, PrintError> {
    if icc::same_space(source_kind, target) {
        return Ok(false);
    }
    let from = icc::source_profile(meta);
    let to = icc::export_profile(target);
    icc::convert_rgba8(rgba, &from, &to)?;
    Ok(true)
}

/// Kodiert RGBA8 als PNG: nicht interlaced, `pHYs` = 11811 px/m (300 dpi), `iCCP` mit dem Profil, kein `sRGB`-Chunk.
pub fn encode_png(rgba: &[u8], width: u32, height: u32, icc_profile: &[u8]) -> Result<Vec<u8>, PrintError> {
    let enc_err = |e: png::EncodingError| PrintError::Encode(format!("PNG: {e}"));
    let mut info = png::Info::with_size(width, height);
    info.color_type = png::ColorType::Rgba;
    info.bit_depth = png::BitDepth::Eight;
    info.pixel_dims = Some(png::PixelDimensions { xppu: PHYS_300_DPI, yppu: PHYS_300_DPI, unit: png::Unit::Meter });
    info.icc_profile = Some(Cow::Borrowed(icc_profile));
    let mut out = Vec::with_capacity(rgba.len() / 3 + 4096);
    let mut encoder = png::Encoder::with_info(&mut out, info).map_err(enc_err)?;
    encoder.set_compression(png::Compression::Balanced);
    encoder.set_filter(png::Filter::Adaptive);
    let mut writer = encoder.write_header().map_err(enc_err)?;
    writer.write_image_data(rgba).map_err(enc_err)?;
    writer.finish().map_err(enc_err)?;
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// Begleitdatei
// ---------------------------------------------------------------------------------------------

/// Inhalt von `<name>.shirtigo.json` (ARCHITEKTUR.md 4.7); die Feldnamen folgen der Shirtigo-API.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PlacementJson {
    #[serde(rename = "formatVersion")]
    pub format_version: u32,
    pub provider: String,
    pub product: String,
    pub processingarea_type: String,
    pub processingmethod: String,
    pub width_mm: f64,
    pub offset_top_mm: f64,
    pub offset_center_mm: f64,
    pub force_position: bool,
    pub file: String,
    pub sha256: String,
    #[serde(rename = "widthPx")]
    pub width_px: u32,
    #[serde(rename = "heightPx")]
    pub height_px: u32,
    #[serde(rename = "colorProfile")]
    pub color_profile: String,
    #[serde(rename = "createdBy")]
    pub created_by: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

fn area_type(p: PrintPlacement) -> &'static str {
    match p {
        PrintPlacement::Front => "front",
        PrintPlacement::Back => "back",
        PrintPlacement::SleeveLeft => "sleeve_left",
        PrintPlacement::SleeveRight => "sleeve_right",
        PrintPlacement::BackInside => "back_inside",
    }
}

fn technique_name(t: PrintTechnique) -> &'static str {
    match t {
        PrintTechnique::Dtg => "dtg",
        PrintTechnique::Dtf => "dtf",
    }
}

pub struct PlacementInput<'a> {
    pub profile: &'a PrintProfile,
    pub technique: PrintTechnique,
    pub geometry: &'a Geometry,
    pub file_name: &'a str,
    pub sha256: &'a str,
    pub color_profile: ExportColorProfile,
    pub width_px: u32,
    pub height_px: u32,
    pub created_at: &'a str,
}

pub fn placement_json(i: &PlacementInput<'_>) -> PlacementJson {
    PlacementJson {
        format_version: 1,
        provider: "shirtigo".to_owned(),
        product: i.profile.product.provider_product_id.clone(),
        processingarea_type: area_type(i.profile.placement).to_owned(),
        processingmethod: technique_name(i.technique).to_owned(),
        width_mm: (i.geometry.width_mm * 100.0).round() / 100.0,
        offset_top_mm: i.geometry.offset_top_mm,
        offset_center_mm: i.geometry.offset_center_mm,
        force_position: false,
        file: i.file_name.to_owned(),
        sha256: i.sha256.to_owned(),
        width_px: i.width_px,
        height_px: i.height_px,
        color_profile: match i.color_profile {
            ExportColorProfile::AdobeRgb => "adobeRgb".to_owned(),
            ExportColorProfile::Srgb => "srgb".to_owned(),
        },
        created_by: format!("Cypher Studio {}", env!("CARGO_PKG_VERSION")),
        created_at: i.created_at.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ExportFixes;

    fn options(mode: ExportMode, width: f64) -> PrintExportOptions {
        PrintExportOptions {
            mode,
            planned_width_mm: width,
            offset_top_mm: 0.0,
            offset_center_mm: 0.0,
            allow_upscale: false,
            color_profile: ExportColorProfile::AdobeRgb,
            fixes: ExportFixes {
                clean_ghost_pixels: false,
                semi_transparency: SemiTransparencyFix::Keep,
                near_black_to_pure_black: false,
            },
            write_placement_json: true,
            destination: crate::api::PrintDestination::Dialog,
        }
    }

    fn tee_front() -> PrintProfile {
        super::super::testing::tee_front_profile()
    }

    #[test]
    fn width_280_mm_is_3307_px() {
        let bounds = PxRect { x0: 0, y0: 0, x1: 4000, y1: 6000 };
        let geo = plan(bounds, &tee_front(), &options(ExportMode::Trimmed, 280.0)).unwrap();
        assert_eq!(geo.motif_w, 3307);
        assert_eq!(geo.motif_h, 4961);
        assert!(!geo.upscaled && !geo.width_clamped);
        assert!((geo.width_mm - 280.0).abs() < 1e-9);
    }

    #[test]
    fn upscaling_needs_permission_and_otherwise_shrinks_the_width() {
        let bounds = PxRect { x0: 10, y0: 10, x1: 1010, y1: 2010 }; // 1000 x 2000
        let blocked = plan(bounds, &tee_front(), &options(ExportMode::Trimmed, 280.0)).unwrap();
        assert!(blocked.upscaled && blocked.width_clamped);
        assert_eq!((blocked.motif_w, blocked.motif_h), (1000, 2000));
        assert!((blocked.width_mm - 84.67).abs() < 0.01, "{}", blocked.width_mm);
        let mut allowed_opts = options(ExportMode::Trimmed, 280.0);
        allowed_opts.allow_upscale = true;
        let allowed = plan(PxRect { x0: 10, y0: 10, x1: 1010, y1: 1210 }, &tee_front(), &allowed_opts).unwrap();
        assert!(allowed.upscaled && !allowed.width_clamped);
        assert_eq!(allowed.motif_w, 3307);
    }

    #[test]
    fn full_area_canvas_has_the_print_area_size_and_centres_the_motif() {
        let bounds = PxRect { x0: 0, y0: 0, x1: 2000, y1: 1000 };
        let mut o = options(ExportMode::FullArea, 100.0);
        o.offset_top_mm = 26.0;
        o.allow_upscale = true;
        let geo = plan(bounds, &tee_front(), &o).unwrap();
        assert_eq!((geo.canvas_w, geo.canvas_h), (3898, 5315));
        assert_eq!(geo.motif_w, 1181);
        assert_eq!(geo.place_x, (3898 - 1181) / 2);
        assert_eq!(geo.place_y, 307);
    }

    #[test]
    fn motif_larger_than_the_area_is_refused() {
        let bounds = PxRect { x0: 0, y0: 0, x1: 4000, y1: 6000 };
        let e = plan(bounds, &tee_front(), &options(ExportMode::Trimmed, 330.0)).unwrap_err();
        assert!(matches!(e, PrintError::InvalidInput { ref field, .. } if field == "plannedWidthMm"), "{e}");
        let e = plan(bounds, &tee_front(), &options(ExportMode::Trimmed, 0.0)).unwrap_err();
        assert!(matches!(e, PrintError::InvalidInput { .. }));
        let mut o = options(ExportMode::Trimmed, 200.0);
        o.offset_center_mm = 80.0;
        assert!(plan(bounds, &tee_front(), &o).is_err());
    }

    #[test]
    fn png_has_300_dpi_and_the_profile() {
        let rgba = vec![10u8, 20, 30, 255, 40, 50, 60, 128];
        let icc = icc::export_profile_bytes(ExportColorProfile::AdobeRgb).unwrap();
        let bytes = encode_png(&rgba, 2, 1, &icc).unwrap();
        let decoder = png::Decoder::new(std::io::Cursor::new(&bytes));
        let reader = decoder.read_info().unwrap();
        let info = reader.info();
        let dims = info.pixel_dims.unwrap();
        assert_eq!((dims.xppu, dims.yppu, dims.unit), (11811, 11811, png::Unit::Meter));
        assert_eq!(info.icc_profile.as_deref(), Some(&icc[..]));
        assert!(info.srgb.is_none());
        assert!(!info.interlaced);
        assert_eq!(info.color_type, png::ColorType::Rgba);
        assert_eq!(info.bit_depth, png::BitDepth::Eight);
    }

    #[test]
    fn crop_without_scaling_copies_exactly() {
        let img = DecodedImage { width: 3, height: 2, rgba: (0..24).collect() };
        let out = crop_and_scale(&img, PxRect { x0: 1, y0: 0, x1: 3, y1: 2 }, 2, 2, &CancellationToken::new()).unwrap();
        assert_eq!(out, vec![4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23]);
    }

    #[test]
    fn cancel_stops_the_scaling() {
        let img = DecodedImage { width: 2, height: 2, rgba: vec![0; 16] };
        let token = CancellationToken::new();
        token.cancel();
        let r = crop_and_scale(&img, PxRect { x0: 0, y0: 0, x1: 2, y1: 2 }, 1, 1, &token);
        assert!(matches!(r, Err(PrintError::Cancelled)));
    }

    #[test]
    fn placement_json_uses_the_shirtigo_field_names() {
        let geo = plan(PxRect { x0: 0, y0: 0, x1: 4000, y1: 6000 }, &tee_front(), &options(ExportMode::Trimmed, 280.0))
            .unwrap();
        let profile = tee_front();
        let j = placement_json(&PlacementInput {
            profile: &profile,
            technique: PrintTechnique::Dtg,
            geometry: &geo,
            file_name: "ratte_tee-front_280mm_300dpi.png",
            sha256: "abc",
            color_profile: ExportColorProfile::AdobeRgb,
            width_px: 3307,
            height_px: 4961,
            created_at: "2026-10-20T12:01:00Z",
        });
        let v = serde_json::to_value(&j).unwrap();
        for key in [
            "formatVersion",
            "provider",
            "product",
            "processingarea_type",
            "processingmethod",
            "width_mm",
            "offset_top_mm",
            "offset_center_mm",
            "force_position",
            "file",
            "sha256",
            "widthPx",
            "heightPx",
            "colorProfile",
            "createdBy",
            "createdAt",
        ] {
            assert!(v.get(key).is_some(), "Feld {key} fehlt");
        }
        assert_eq!(v["processingarea_type"], "front");
        assert_eq!(v["product"], "organic-shirt");
        assert_eq!(v["force_position"], false);
    }
}
