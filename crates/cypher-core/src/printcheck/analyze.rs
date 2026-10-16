//! Analyse: Messwerte und Regeln. Rein und deterministisch; die Reihenfolge der Befunde ist fest
//! (ARCHITEKTUR.md 2.13, Regeltabelle). Alle Schwellen stammen aus dem Druckprofil des Katalogs.

use std::collections::BTreeMap;

use crate::api::{
    ChannelLayout, ColorProfileKind, DpiSource, ExportColorProfile, Finding, FixKind, GarmentColor, Margins,
    ParamValue, PrintProfile, PrintReport, PrintRuleId, PrintTechnique, Rect, ReportAlpha, ReportColor, ReportDpi,
    ReportFile, ReportFileFormat, ReportGarment, ReportPlacement, Severity, Size, UploadFormat, Verdict,
};
use crate::util::now_iso;

use super::decode::DecodedImage;
use super::icc;
use super::meta::{Channels, ImageMeta, ImgFormat};
use super::scan::{self, PxRect, RectAcc, SemiClass, Thresholds};

/// Version der Prüfregeln; steht im Bericht und in der Begleitdatei.
pub const ENGINE_VERSION: &str = "1.0.0";

const MM_PER_INCH: f64 = 25.4;
/// Toleranz beim Vergleich von Maßen in mm: ein Pixel bei 300 dpi.
const MM_EPS: f64 = MM_PER_INCH / 300.0;
/// Anteil sichtbarer Pixel nahe Schwarz, ab dem „Reinschwarz“ angeboten wird.
const NEAR_BLACK_SHARE: f64 = 0.05;
/// Anteil sichtbarer Pixel mit zu geringem Kontrast zum Textil, ab dem gewarnt wird.
const LOW_CONTRAST_SHARE: f64 = 0.40;
const MIN_CONTRAST_RATIO: f64 = 1.3;
/// Anteil deckender Randpixel, ab dem ein vergessener Hintergrund vermutet wird.
const OPAQUE_BORDER_SHARE: f64 = 0.98;
/// pHYs-Sollwert: 300 dpi in Pixeln je Meter.
pub const PHYS_300_DPI: u32 = 11811;

/// Eingaben der Analyse jenseits des Bildes.
#[derive(Debug, Clone, Copy)]
pub struct AnalyzeParams<'a> {
    pub profile: &'a PrintProfile,
    pub garment: Option<&'a GarmentColor>,
    pub technique: PrintTechnique,
    /// Geplante Druckbreite in mm; `None` = Standardbreite des Profils.
    pub planned_width_mm: Option<f64>,
    /// `false` für die Prüfung einer zugeschnittenen Ausgabe: dass das Motiv den Bildrand berührt, ist dort gewollt.
    pub check_edges: bool,
}

/// Messwerte, die Export und Überlagerung wiederverwenden.
#[derive(Debug, Clone, Default)]
pub struct Measures {
    pub visible: u64,
    pub transparent: u64,
    pub opaque: u64,
    pub semi_raw: u64,
    pub semi_area: u64,
    pub ghost: u64,
    pub near_black: u64,
    pub color_visible: u64,
    pub low_contrast: u64,
    pub bounds: Option<PxRect>,
    pub ghost_rect: Option<PxRect>,
    pub semi_rect: Option<PxRect>,
    pub border_opaque_share: f64,
}

#[derive(Debug, Clone)]
pub struct Analysis {
    pub report: PrintReport,
    pub measures: Measures,
}

pub fn thresholds(profile: &PrintProfile) -> Thresholds {
    Thresholds {
        semi_min: profile.alpha.semi_min,
        semi_max: profile.alpha.semi_max,
        ghost_max: profile.alpha.ghost_max,
        edge_radius: profile.alpha.edge_radius_px,
    }
}

/// `#rrggbb` oder `#rgb`.
pub fn parse_hex(hex: &str) -> Option<[u8; 3]> {
    let h = hex.trim().trim_start_matches('#');
    let nibble = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
    match h.as_bytes() {
        [r1, r2, g1, g2, b1, b2] => {
            Some([nibble(*r1)? * 16 + nibble(*r2)?, nibble(*g1)? * 16 + nibble(*g2)?, nibble(*b1)? * 16 + nibble(*b2)?])
        }
        [r, g, b] => Some([nibble(*r)? * 17, nibble(*g)? * 17, nibble(*b)? * 17]),
        _ => None,
    }
}

/// Helligkeit nach Rec. 709 aus den codierten Werten, Tausendstel (0..=255_000).
pub fn luma_milli(r: u8, g: u8, b: u8) -> u32 {
    (2126 * u32::from(r) + 7152 * u32::from(g) + 722 * u32::from(b)) / 10
}

/// Obergrenze der „Beinahe-Schwarz“-Helligkeit: 5 % von 255.
pub const NEAR_BLACK_LUMA_MILLI: u32 = 12_750;

fn srgb_to_linear_lut() -> [f32; 256] {
    let mut lut = [0f32; 256];
    for (i, v) in lut.iter_mut().enumerate() {
        let c = i as f32 / 255.0;
        *v = if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) };
    }
    lut
}

fn relative_luminance(rgb: [u8; 3], lut: &[f32; 256]) -> f32 {
    0.2126 * lut[rgb[0] as usize] + 0.7152 * lut[rgb[1] as usize] + 0.0722 * lut[rgb[2] as usize]
}

#[derive(Debug, Default, Clone, Copy)]
struct Pass2 {
    ghost: u64,
    ghost_rect: RectAcc,
    semi_area: u64,
    semi_rect: RectAcc,
    near_black: u64,
    color_visible: u64,
    low_contrast: u64,
}

/// Misst alle Größen des Bildes.
pub fn measure(img: &DecodedImage, profile: &PrintProfile, garment: Option<&GarmentColor>) -> Measures {
    let th = thresholds(profile);
    let (w, h) = (img.width, img.height);
    let p1 = scan::pass1(&img.rgba, w, h, th);
    let bounds = p1.bounds;
    // Bereich, in dem Kontrast als zu gering gilt (Luminanz des Bildpixels neben der Textilluminanz)
    let contrast_band = garment.and_then(|g| parse_hex(&g.textile_hex)).map(|rgb| {
        let lut = srgb_to_linear_lut();
        let lg = f64::from(relative_luminance(rgb, &lut));
        let lo = (lg + 0.05) / MIN_CONTRAST_RATIO - 0.05;
        let hi = (lg + 0.05) * MIN_CONTRAST_RATIO - 0.05;
        (lut, lo as f32, hi as f32)
    });
    let parts = scan::par_blocks(h, |y0, y1| {
        let mut out = Pass2::default();
        scan::scan_block(&img.rgba, w, h, th, y0, y1, |x, y, px, class| {
            let a = px[3];
            if a == 0 {
                return;
            }
            if a <= th.ghost_max && !bounds.is_some_and(|b| b.contains(x, y)) {
                out.ghost += 1;
                out.ghost_rect.add(x, y);
            }
            if class == SemiClass::Area {
                out.semi_area += 1;
                out.semi_rect.add(x, y);
            }
            if a >= th.semi_min {
                out.color_visible += 1;
                if luma_milli(px[0], px[1], px[2]) < NEAR_BLACK_LUMA_MILLI && (px[0] | px[1] | px[2]) != 0 {
                    out.near_black += 1;
                }
                if let Some((lut, lo, hi)) = &contrast_band {
                    let l = relative_luminance([px[0], px[1], px[2]], lut);
                    if l > *lo && l < *hi {
                        out.low_contrast += 1;
                    }
                }
            }
        });
        out
    });
    let mut m = Measures {
        visible: p1.visible,
        transparent: p1.transparent,
        opaque: p1.opaque,
        semi_raw: p1.semi_raw,
        bounds,
        border_opaque_share: scan::border_opaque_share(&img.rgba, w, h, th),
        ..Measures::default()
    };
    let (mut ghost_rect, mut semi_rect) = (RectAcc::default(), RectAcc::default());
    for p in parts {
        m.ghost += p.ghost;
        m.semi_area += p.semi_area;
        m.near_black += p.near_black;
        m.color_visible += p.color_visible;
        m.low_contrast += p.low_contrast;
        ghost_rect.merge(p.ghost_rect);
        semi_rect.merge(p.semi_rect);
    }
    m.ghost_rect = ghost_rect.0;
    m.semi_rect = semi_rect.0;
    m
}

fn to_rect(r: PxRect) -> Rect {
    Rect { x: f64::from(r.x0), y: f64::from(r.y0), width: f64::from(r.width()), height: f64::from(r.height()) }
}

fn round(v: f64, digits: i32) -> f64 {
    let f = 10f64.powi(digits);
    (v * f).round() / f
}

fn num(v: f64) -> ParamValue {
    ParamValue::Number(v)
}

fn text(v: impl Into<String>) -> ParamValue {
    ParamValue::Text(v.into())
}

fn params<const N: usize>(pairs: [(&str, ParamValue); N]) -> BTreeMap<String, ParamValue> {
    pairs.into_iter().map(|(k, v)| (k.to_owned(), v)).collect()
}

fn finding(
    rule: PrintRuleId,
    severity: Severity,
    p: BTreeMap<String, ParamValue>,
    region: Option<Rect>,
    fix: Option<FixKind>,
) -> Finding {
    Finding { rule_id: rule, severity, params: p, region, fix }
}

fn kind_name(kind: ColorProfileKind) -> &'static str {
    match kind {
        ColorProfileKind::Srgb => "srgb",
        ColorProfileKind::AdobeRgb => "adobeRgb",
        ColorProfileKind::DisplayP3 => "displayP3",
        ColorProfileKind::Gray => "gray",
        ColorProfileKind::Cmyk => "cmyk",
        ColorProfileKind::Other => "other",
        ColorProfileKind::None => "none",
    }
}

fn export_name(p: ExportColorProfile) -> &'static str {
    match p {
        ExportColorProfile::AdobeRgb => "adobeRgb",
        ExportColorProfile::Srgb => "srgb",
    }
}

fn report_format(f: ImgFormat) -> ReportFileFormat {
    match f {
        ImgFormat::Png => ReportFileFormat::Png,
        ImgFormat::Jpeg => ReportFileFormat::Jpeg,
        ImgFormat::Tiff => ReportFileFormat::Tiff,
        ImgFormat::Webp => ReportFileFormat::Webp,
    }
}

fn report_channels(c: Channels) -> ChannelLayout {
    match c {
        Channels::Gray => ChannelLayout::Gray,
        Channels::GrayAlpha => ChannelLayout::GrayAlpha,
        Channels::Rgb => ChannelLayout::Rgb,
        Channels::Rgba => ChannelLayout::Rgba,
        Channels::Cmyk => ChannelLayout::Cmyk,
        Channels::Indexed => ChannelLayout::Indexed,
    }
}

fn upload_format(f: ImgFormat) -> Option<UploadFormat> {
    match f {
        ImgFormat::Png => Some(UploadFormat::Png),
        ImgFormat::Jpeg => Some(UploadFormat::Jpeg),
        _ => None,
    }
}

fn severity_rank(s: Severity) -> u8 {
    match s {
        Severity::Info => 0,
        Severity::Warning => 1,
        Severity::Error => 2,
    }
}

fn min_severity(a: Severity, b: Severity) -> Severity {
    if severity_rank(a) <= severity_rank(b) { a } else { b }
}

/// Erzeugt den Prüfbericht. `img` ist `None` für Dateien, die nicht dekodiert werden (CMYK): dann entfallen
/// alle pixelbasierten Regeln.
pub fn analyze(img: Option<&DecodedImage>, meta: &ImageMeta, name: &str, params_in: &AnalyzeParams<'_>) -> Analysis {
    let profile = params_in.profile;
    let garment = params_in.garment;
    let measures = img.map(|i| measure(i, profile, garment)).unwrap_or_default();
    let (w, h) = (meta.width, meta.height);
    let n = (u64::from(w) * u64::from(h)).max(1) as f64;

    let color = icc::classify(meta);
    let dpi = match meta.dpi {
        Some((x, y, source)) => ReportDpi { x: round(x, 2), y: round(y, 2), source },
        None => ReportDpi { x: 0.0, y: 0.0, source: DpiSource::None },
    };

    // --- Platzierung -----------------------------------------------------------------------------
    let trimmed = if img.is_some() { measures.bounds.map(|b| (b.width(), b.height())) } else { None };
    let (basis_w, basis_h) = trimmed.unwrap_or((w, h));
    let planned_w =
        params_in.planned_width_mm.filter(|v| v.is_finite() && *v > 0.0).unwrap_or(profile.default_width_mm);
    let planned_h = planned_w * f64::from(basis_h) / f64::from(basis_w.max(1));
    let target_dpi = f64::from(profile.target_dpi);
    let effective_dpi = f64::from(basis_w) / (planned_w / MM_PER_INCH);
    let max_width_mm = f64::from(basis_w) / target_dpi * MM_PER_INCH;
    let target_w = (planned_w / MM_PER_INCH * target_dpi).round();
    let target_h = (planned_h / MM_PER_INCH * target_dpi).round();
    let area = profile.print_area_mm;
    let fits_print = planned_w <= area.width + MM_EPS && planned_h <= area.height + MM_EPS;
    let fits_safe = profile.safe_area_mm.map(|s| planned_w <= s.width + MM_EPS && planned_h <= s.height + MM_EPS);

    let margins =
        img.and_then(|_| measures.bounds.map(|b| Margins { top: b.y0, right: w - b.x1, bottom: h - b.y1, left: b.x0 }));

    // --- Regeln in fester Reihenfolge --------------------------------------------------------------
    let mut f: Vec<Finding> = Vec::new();
    let region_none = None;

    if upload_format(meta.format).is_none_or(|u| !profile.accepted_upload_formats.contains(&u)) {
        f.push(finding(
            PrintRuleId::FormatNotUploadable,
            Severity::Info,
            params([("format", text(meta.format.name()))]),
            region_none,
            None,
        ));
    }
    if meta.format == ImgFormat::Jpeg {
        f.push(finding(PrintRuleId::FormatJpegNoAlpha, Severity::Warning, params([]), region_none, None));
    }
    if meta.animated {
        f.push(finding(PrintRuleId::FormatAnimated, Severity::Error, params([]), region_none, None));
    }
    if meta.format == ImgFormat::Png && meta.interlaced {
        f.push(finding(PrintRuleId::FormatInterlaced, Severity::Warning, params([]), region_none, None));
    }
    if meta.bit_depth == 16 {
        f.push(finding(
            PrintRuleId::FormatBitDepth16,
            Severity::Warning,
            params([("bitDepth", num(16.0))]),
            region_none,
            None,
        ));
    }
    if meta.channels == Channels::Indexed {
        f.push(finding(PrintRuleId::FormatIndexed, Severity::Info, params([]), region_none, None));
    }

    // Größe: bei erkanntem Motiv zählt der Zuschnitt (so misst der Druckanbieter), sonst die Datei
    let (size_w, size_h) = (basis_w, basis_h);
    if img.is_some() || meta.channels != Channels::Cmyk {
        let below_w = size_w < profile.min_px_per_side;
        let below_h = size_h < profile.min_px_per_side;
        if below_w || below_h {
            let severity = if below_w && below_h { Severity::Error } else { Severity::Warning };
            f.push(finding(
                PrintRuleId::SizeBelowMinPixels,
                severity,
                params([
                    ("widthPx", num(f64::from(size_w))),
                    ("heightPx", num(f64::from(size_h))),
                    ("minPx", num(f64::from(profile.min_px_per_side))),
                ]),
                region_none,
                None,
            ));
        }
    }
    if w.max(h) > profile.max_px_per_side {
        f.push(finding(
            PrintRuleId::SizeAboveMaxPixels,
            Severity::Error,
            params([
                ("widthPx", num(f64::from(w))),
                ("heightPx", num(f64::from(h))),
                ("maxPx", num(f64::from(profile.max_px_per_side))),
            ]),
            region_none,
            None,
        ));
    }
    if meta.file_bytes > profile.max_file_bytes {
        f.push(finding(
            PrintRuleId::FileTooLarge,
            Severity::Error,
            params([("fileBytes", num(meta.file_bytes as f64)), ("limitBytes", num(profile.max_file_bytes as f64))]),
            region_none,
            None,
        ));
    } else if meta.file_bytes > profile.warn_file_bytes {
        f.push(finding(
            PrintRuleId::FileTooLarge,
            Severity::Warning,
            params([("fileBytes", num(meta.file_bytes as f64)), ("limitBytes", num(profile.warn_file_bytes as f64))]),
            region_none,
            None,
        ));
    }

    let pixel_rules = img.is_some() && trimmed.is_some();
    if pixel_rules {
        let res_params = params([
            ("effectiveDpi", num(effective_dpi.round())),
            ("targetDpi", num(target_dpi)),
            ("maxWidthMm", num(max_width_mm.round())),
        ]);
        if effective_dpi < f64::from(profile.error_below_dpi) {
            f.push(finding(PrintRuleId::ResolutionTooLow, Severity::Error, res_params, region_none, None));
        } else if effective_dpi < target_dpi - 0.5 {
            f.push(finding(PrintRuleId::ResolutionBelowTarget, Severity::Warning, res_params, region_none, None));
        }
    }
    // Auflösungsangabe der Datei: nur für Dateien mit Pixelinhalt von Belang
    let metadata_ok = match (meta.format, meta.png_ppm) {
        (ImgFormat::Png, Some((x, y))) => x == PHYS_300_DPI && y == PHYS_300_DPI,
        _ => meta.dpi.is_some_and(|(x, y, _)| (x - target_dpi).abs() < 0.5 && (y - target_dpi).abs() < 0.5),
    };
    if !metadata_ok {
        f.push(finding(
            PrintRuleId::ResolutionMetadataMismatch,
            Severity::Info,
            params([("dpi", num(dpi.x))]),
            region_none,
            None,
        ));
    }
    if pixel_rules && effective_dpi > 0.0 && effective_dpi < target_dpi - 0.5 {
        f.push(finding(
            PrintRuleId::ResolutionUpscaleNeeded,
            Severity::Warning,
            params([
                ("effectiveDpi", num(effective_dpi.round())),
                ("targetDpi", num(target_dpi)),
                ("scale", num(round(target_dpi / effective_dpi, 2))),
            ]),
            region_none,
            None,
        ));
    }

    if img.is_some() {
        match trimmed {
            None => f.push(finding(PrintRuleId::LayoutEmpty, Severity::Error, params([]), region_none, None)),
            Some(_) => {
                if !fits_print {
                    f.push(finding(
                        PrintRuleId::LayoutExceedsPrintArea,
                        Severity::Error,
                        params([
                            ("widthMm", num(round(planned_w, 1))),
                            ("heightMm", num(round(planned_h, 1))),
                            ("areaWidthMm", num(area.width)),
                            ("areaHeightMm", num(area.height)),
                        ]),
                        region_none,
                        None,
                    ));
                } else if let (Some(false), Some(safe)) = (fits_safe, profile.safe_area_mm) {
                    f.push(finding(
                        PrintRuleId::LayoutExceedsSafeArea,
                        Severity::Warning,
                        params([
                            ("widthMm", num(round(planned_w, 1))),
                            ("heightMm", num(round(planned_h, 1))),
                            ("safeWidthMm", num(safe.width)),
                            ("safeHeightMm", num(safe.height)),
                        ]),
                        region_none,
                        None,
                    ));
                }
                if params_in.check_edges
                    && let Some(m) = &margins
                    && (m.top == 0 || m.right == 0 || m.bottom == 0 || m.left == 0)
                {
                    f.push(finding(PrintRuleId::LayoutTouchesEdge, Severity::Info, params([]), region_none, None));
                }
            }
        }
    }

    // Farbe
    match color.kind {
        ColorProfileKind::Cmyk => {
            f.push(finding(PrintRuleId::ColorCmyk, Severity::Error, params([]), region_none, None))
        }
        ColorProfileKind::None => {
            f.push(finding(PrintRuleId::ColorNoProfile, Severity::Warning, params([]), region_none, None));
        }
        ColorProfileKind::DisplayP3 | ColorProfileKind::Other => f.push(finding(
            PrintRuleId::ColorUnsupportedProfile,
            Severity::Warning,
            params([("profile", text(color.description.clone().unwrap_or_else(|| kind_name(color.kind).to_owned())))]),
            region_none,
            Some(FixKind::ColorProfile),
        )),
        ColorProfileKind::Srgb | ColorProfileKind::AdobeRgb => {
            if !icc::same_space(color.kind, profile.color.export_profile) {
                f.push(finding(
                    PrintRuleId::ColorProfileDiffers,
                    Severity::Info,
                    params([
                        ("from", text(kind_name(color.kind))),
                        ("to", text(export_name(profile.color.export_profile))),
                    ]),
                    region_none,
                    Some(FixKind::ColorProfile),
                ));
            }
        }
        ColorProfileKind::Gray => {}
    }
    if matches!(meta.channels, Channels::Gray | Channels::GrayAlpha) {
        f.push(finding(PrintRuleId::ColorGrayscale, Severity::Info, params([]), region_none, None));
    }
    if img.is_some() && measures.color_visible > 0 {
        let share = measures.near_black as f64 / measures.color_visible as f64;
        if share > NEAR_BLACK_SHARE {
            f.push(finding(
                PrintRuleId::ColorNearBlack,
                Severity::Info,
                params([("share", num(round(share, 4))), ("sharePercent", num(round(share * 100.0, 1)))]),
                region_none,
                Some(FixKind::NearBlackToPureBlack),
            ));
        }
    }

    // Alpha
    if img.is_some() {
        if !meta.has_alpha {
            let severity = if garment.is_some_and(|g| g.underbase) { Severity::Error } else { Severity::Warning };
            f.push(finding(PrintRuleId::AlphaMissing, severity, params([]), region_none, None));
        } else if measures.border_opaque_share > OPAQUE_BORDER_SHARE {
            f.push(finding(
                PrintRuleId::AlphaOpaqueBackground,
                Severity::Warning,
                params([("borderOpaquePercent", num(round(measures.border_opaque_share * 100.0, 1)))]),
                region_none,
                None,
            ));
        }
        let semi_share = if measures.visible > 0 { measures.semi_area as f64 / measures.visible as f64 } else { 0.0 };
        if semi_share >= profile.alpha.warn_share && measures.semi_area > 0 {
            let mut severity =
                if semi_share >= profile.alpha.error_share { Severity::Error } else { Severity::Warning };
            if garment.is_some_and(|g| !g.underbase) {
                severity = min_severity(severity, profile.alpha.severity_on_light_garment);
            }
            if params_in.technique == PrintTechnique::Dtf {
                severity = profile.alpha.severity_for_dtf;
            }
            f.push(finding(
                PrintRuleId::AlphaSemiTransparent,
                severity,
                params([
                    ("share", num(round(semi_share, 4))),
                    ("sharePercent", num(round(semi_share * 100.0, 2))),
                    ("warnShare", num(profile.alpha.warn_share)),
                    ("errorShare", num(profile.alpha.error_share)),
                ]),
                measures.semi_rect.map(to_rect),
                Some(FixKind::SemiTransparency),
            ));
        }
        if measures.ghost > 0 {
            f.push(finding(
                PrintRuleId::AlphaGhostPixels,
                Severity::Warning,
                params([("count", num(measures.ghost as f64))]),
                measures.ghost_rect.map(to_rect),
                Some(FixKind::CleanGhostPixels),
            ));
        }
    }

    // Kontrast zum Textil
    if let (Some(g), true) = (garment, img.is_some() && measures.color_visible > 0) {
        let share = measures.low_contrast as f64 / measures.color_visible as f64;
        if share > LOW_CONTRAST_SHARE {
            f.push(finding(
                PrintRuleId::ContrastLowOnGarment,
                Severity::Warning,
                params([("garment", text(g.name.clone())), ("sharePercent", num(round(share * 100.0, 1)))]),
                region_none,
                None,
            ));
        }
    }

    let verdict = f.iter().fold(Verdict::Ok, |v, x| match (v, x.severity) {
        (_, Severity::Error) => Verdict::Error,
        (Verdict::Ok, Severity::Warning) => Verdict::Warning,
        (v, _) => v,
    });

    let report = PrintReport {
        engine_version: ENGINE_VERSION.to_owned(),
        analyzed_at: now_iso(),
        file: ReportFile {
            name: name.to_owned(),
            format: report_format(meta.format),
            width_px: w,
            height_px: h,
            bit_depth: match meta.bit_depth {
                16 => 16,
                32 => 32,
                _ => 8,
            },
            channels: report_channels(meta.channels),
            interlaced: meta.interlaced,
            animated: meta.animated,
            file_bytes: meta.file_bytes,
        },
        dpi,
        color: ReportColor { profile: color.kind, icc_description: color.description, srgb_chunk: meta.srgb_chunk },
        alpha: ReportAlpha {
            present: meta.has_alpha,
            transparent_share: round(measures.transparent as f64 / n, 4),
            opaque_share: round(measures.opaque as f64 / n, 4),
            semi_share_of_visible: if measures.visible > 0 {
                round(measures.semi_raw as f64 / measures.visible as f64, 4)
            } else {
                0.0
            },
            semi_area_share_of_visible: if measures.visible > 0 {
                round(measures.semi_area as f64 / measures.visible as f64, 6)
            } else {
                0.0
            },
            ghost_pixel_count: measures.ghost,
        },
        bounds: if img.is_some() { measures.bounds.map(to_rect) } else { None },
        margins_px: margins,
        trimmed_px: trimmed.map(|(tw, th)| Size { width: f64::from(tw), height: f64::from(th) }),
        profile_id: profile.id.clone(),
        technique: params_in.technique,
        garment: garment.map(|g| ReportGarment { color_id: g.id.clone(), underbase: g.underbase }),
        placement: ReportPlacement {
            planned_width_mm: round(planned_w, 2),
            planned_height_mm: round(planned_h, 2),
            effective_dpi: round(effective_dpi, 1),
            max_width_mm_at_target_dpi: round(max_width_mm, 1),
            target_px: Size { width: target_w, height: target_h },
            fits_print_area: fits_print,
            fits_safe_area: fits_safe,
        },
        min_stroke_px: None,
        findings: f,
        verdict,
    };
    Analysis { report, measures }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_parsing() {
        assert_eq!(parse_hex("#201e1f"), Some([0x20, 0x1e, 0x1f]));
        assert_eq!(parse_hex("fff"), Some([255, 255, 255]));
        assert_eq!(parse_hex("#12"), None);
        assert_eq!(parse_hex("#gggggg"), None);
    }

    #[test]
    fn near_black_limit_is_five_percent() {
        assert!(luma_milli(12, 12, 12) < NEAR_BLACK_LUMA_MILLI);
        assert!(luma_milli(13, 13, 13) >= NEAR_BLACK_LUMA_MILLI);
        assert_eq!(luma_milli(0, 0, 0), 0);
    }

    #[test]
    fn contrast_band_matches_the_wcag_ratio() {
        let lut = srgb_to_linear_lut();
        let black = relative_luminance([0x20, 0x1e, 0x1f], &lut);
        let white = relative_luminance([255, 255, 255], &lut);
        assert!(black < 0.02);
        assert!((white - 1.0).abs() < 1e-3);
        // Kontrast Schwarz zu Weiß ist 21, deutlich über 1,3
        assert!((white + 0.05) / (black + 0.05) > 10.0);
    }

    #[test]
    fn severity_helpers() {
        assert_eq!(min_severity(Severity::Error, Severity::Info), Severity::Info);
        assert_eq!(min_severity(Severity::Warning, Severity::Error), Severity::Warning);
    }
}
