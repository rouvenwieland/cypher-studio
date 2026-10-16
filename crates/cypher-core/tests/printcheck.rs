//! Tests des Druckprüfers mit deterministisch erzeugten Bildern (keine Binärdateien im Repository).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::path::{Path, PathBuf};
use std::time::Instant;

use cypher_core::api::{
    ColorProfileKind, DpiSource, ExportColorProfile, ExportFixes, ExportMode, Finding, GarmentColor, PrintDestination,
    PrintExportOptions, PrintProfile, PrintReport, PrintRuleId, PrintStage, PrintTechnique, ReportFileFormat,
    SemiTransparencyFix, Severity, Verdict,
};
use cypher_core::catalog::{Catalog, EMBEDDED_CATALOG_JSON};
use cypher_core::error::PrintError;
use cypher_core::printcheck::{
    self, AnalyzeParams, ExportRequest, Limits, Prepared, analyze_file, export_file, icc, suggested_file_name,
};
use cypher_core::progress::{Collect, NoProgress};
use tokio_util::sync::CancellationToken;

// ---------------------------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------------------------

fn catalog() -> Catalog {
    serde_json::from_slice(EMBEDDED_CATALOG_JSON).unwrap()
}

fn profile(id: &str) -> PrintProfile {
    catalog().print_profiles.into_iter().find(|p| p.id == id).unwrap()
}

fn tee_front() -> PrintProfile {
    profile("shirtigo-tee-front")
}

fn garment(id: &str, textile_hex: &str, underbase: bool) -> GarmentColor {
    GarmentColor {
        id: id.to_owned(),
        name: id.to_owned(),
        hex: textile_hex.to_owned(),
        textile_hex: textile_hex.to_owned(),
        provider_color_name: None,
        heather: false,
        underbase,
        text_on_garment: "#ffffff".to_owned(),
    }
}

struct Img {
    w: u32,
    h: u32,
    rgba: Vec<u8>,
}

fn img(w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> Img {
    let mut rgba = Vec::with_capacity(w as usize * h as usize * 4);
    for y in 0..h {
        for x in 0..w {
            rgba.extend(f(x, y));
        }
    }
    Img { w, h, rgba }
}

#[derive(Default, Clone)]
struct PngOpts {
    ppm: Option<u32>,
    icc: Option<Vec<u8>>,
    srgb: bool,
}

fn write_png(path: &Path, image: &Img, opts: &PngOpts) {
    let mut info = png::Info::with_size(image.w, image.h);
    info.color_type = png::ColorType::Rgba;
    info.bit_depth = png::BitDepth::Eight;
    if let Some(ppm) = opts.ppm {
        info.pixel_dims = Some(png::PixelDimensions { xppu: ppm, yppu: ppm, unit: png::Unit::Meter });
    }
    if let Some(icc) = &opts.icc {
        info.icc_profile = Some(std::borrow::Cow::Borrowed(icc));
    }
    if opts.srgb {
        info.srgb = Some(png::SrgbRenderingIntent::Perceptual);
    }
    let file = std::fs::File::create(path).unwrap();
    let mut enc = png::Encoder::with_info(std::io::BufWriter::new(file), info).unwrap();
    enc.set_compression(png::Compression::Fast);
    let mut w = enc.write_header().unwrap();
    w.write_image_data(&image.rgba).unwrap();
    w.finish().unwrap();
}

fn crc(bytes: &[u8]) -> u32 {
    let mut c = flate2::Crc::new();
    c.update(bytes);
    c.sum()
}

fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut out = (data.len() as u32).to_be_bytes().to_vec();
    out.extend(kind);
    out.extend(data);
    let mut crc_input = kind.to_vec();
    crc_input.extend(data);
    out.extend(crc(&crc_input).to_be_bytes());
    out
}

fn zlib(bytes: &[u8]) -> Vec<u8> {
    use std::io::Write as _;
    let mut e = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::fast());
    e.write_all(bytes).unwrap();
    e.finish().unwrap()
}

/// 1 x 1 Pixel RGBA, optional Adam7-Interlace und APNG-Steuerung.
fn raw_png_1x1(interlaced: bool, animated: bool) -> Vec<u8> {
    let mut out = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    let mut ihdr = 1u32.to_be_bytes().to_vec();
    ihdr.extend(1u32.to_be_bytes());
    ihdr.extend([8, 6, 0, 0, u8::from(interlaced)]);
    out.extend(chunk(b"IHDR", &ihdr));
    if animated {
        let mut actl = 1u32.to_be_bytes().to_vec();
        actl.extend(0u32.to_be_bytes());
        out.extend(chunk(b"acTL", &actl));
        let mut fctl = 0u32.to_be_bytes().to_vec();
        fctl.extend(1u32.to_be_bytes());
        fctl.extend(1u32.to_be_bytes());
        fctl.extend(0u32.to_be_bytes());
        fctl.extend(0u32.to_be_bytes());
        fctl.extend(1u16.to_be_bytes());
        fctl.extend(10u16.to_be_bytes());
        fctl.extend([0, 0]);
        out.extend(chunk(b"fcTL", &fctl));
    }
    out.extend(chunk(b"IDAT", &zlib(&[0, 200, 100, 50, 255])));
    out.extend(chunk(b"IEND", &[]));
    out
}

fn params<'a>(profile: &'a PrintProfile, width: f64) -> AnalyzeParams<'a> {
    AnalyzeParams {
        profile,
        garment: None,
        technique: PrintTechnique::Dtg,
        planned_width_mm: Some(width),
        check_edges: true,
    }
}

fn analyze(path: &Path, p: &AnalyzeParams<'_>) -> PrintReport {
    analyze_file(path, "test.png", p, &Limits::default(), &CancellationToken::new()).unwrap()
}

fn find(report: &PrintReport, id: PrintRuleId) -> Option<&Finding> {
    report.findings.iter().find(|f| f.rule_id == id)
}

fn has(report: &PrintReport, id: PrintRuleId) -> bool {
    find(report, id).is_some()
}

/// Deckende Scheibe mit weicher Kante der Breite `feather` Pixel; Pixel mit Alpha 0 haben die Farbe `outside`.
fn disc(size: u32, radius: f64, feather: f64, inside: [u8; 3], outside: [u8; 3]) -> Img {
    let c = f64::from(size) / 2.0;
    img(size, size, |x, y| {
        let d = ((f64::from(x) + 0.5 - c).powi(2) + (f64::from(y) + 0.5 - c).powi(2)).sqrt();
        let a = (((radius - d) / feather) + 0.5).clamp(0.0, 1.0);
        let alpha = (a * 255.0).round() as u8;
        if alpha == 0 { [outside[0], outside[1], outside[2], 0] } else { [inside[0], inside[1], inside[2], alpha] }
    })
}

fn rect_img(w: u32, h: u32, x0: u32, y0: u32, x1: u32, y1: u32, rgb: [u8; 3]) -> Img {
    img(w, h, |x, y| if x >= x0 && x < x1 && y >= y0 && y < y1 { [rgb[0], rgb[1], rgb[2], 255] } else { [0, 0, 0, 0] })
}

fn opts(mode: ExportMode, width: f64) -> PrintExportOptions {
    PrintExportOptions {
        mode,
        planned_width_mm: width,
        offset_top_mm: 0.0,
        offset_center_mm: 0.0,
        allow_upscale: true,
        color_profile: ExportColorProfile::AdobeRgb,
        fixes: ExportFixes {
            clean_ghost_pixels: false,
            semi_transparency: SemiTransparencyFix::Keep,
            near_black_to_pure_black: false,
        },
        write_placement_json: true,
        destination: PrintDestination::Dialog,
    }
}

struct Exported {
    outcome: printcheck::ExportOutcome,
    _dir: tempfile::TempDir,
}

fn run_export(
    source: &Img,
    src_opts: &PngOpts,
    garment: Option<&GarmentColor>,
    options: &PrintExportOptions,
) -> Result<Exported, PrintError> {
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("quelle.png");
    write_png(&src, source, src_opts);
    let out = dir.path().join("ratte_tee-front.png");
    let profile = tee_front();
    let outcome = export_file(
        &ExportRequest {
            source: &src,
            source_name: "quelle.png",
            output: &out,
            profile: &profile,
            garment,
            technique: PrintTechnique::Dtg,
            options,
            limits: Limits::default(),
        },
        &NoProgress,
        &CancellationToken::new(),
    )?;
    Ok(Exported { outcome, _dir: dir })
}

fn pixel(image: &printcheck::DecodedImage, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * image.width + x) * 4) as usize;
    [image.rgba[i], image.rgba[i + 1], image.rgba[i + 2], image.rgba[i + 3]]
}

fn load(path: &Path) -> Prepared {
    Prepared::load(path, "x.png", &Limits::default(), &CancellationToken::new()).unwrap()
}

fn tmp_png(image: &Img, opts: &PngOpts) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("bild.png");
    write_png(&path, image, opts);
    (dir, path)
}

// ---------------------------------------------------------------------------------------------
// Metadaten und Formate
// ---------------------------------------------------------------------------------------------

#[test]
fn png_resolution_72_300_and_missing() {
    let p = tee_front();
    let motif = rect_img(1200, 1200, 100, 100, 1100, 1100, [20, 40, 200]);
    for (ppm, expect_dpi, expect_source, mismatch) in [
        (Some(2835u32), 72.0, DpiSource::PHYs, true),
        (Some(11811), 300.0, DpiSource::PHYs, false),
        (None, 0.0, DpiSource::None, true),
    ] {
        let (_d, path) = tmp_png(&motif, &PngOpts { ppm, srgb: true, ..PngOpts::default() });
        let r = analyze(&path, &params(&p, 100.0));
        assert_eq!(r.dpi.source, expect_source, "{ppm:?}");
        assert!((r.dpi.x - expect_dpi).abs() < 0.2, "{ppm:?}: {}", r.dpi.x);
        assert_eq!(has(&r, PrintRuleId::ResolutionMetadataMismatch), mismatch, "{ppm:?}");
        assert_eq!(r.file.format, ReportFileFormat::Png);
        assert_eq!((r.file.width_px, r.file.height_px), (1200, 1200));
    }
}

#[test]
fn icc_profiles_are_recognised_and_rated() {
    let p = tee_front();
    let motif = rect_img(1200, 1200, 100, 100, 1100, 1100, [20, 40, 200]);
    let srgb = moxcms::ColorProfile::new_srgb().encode().unwrap();
    let adobe = moxcms::ColorProfile::new_adobe_rgb().encode().unwrap();
    let p3 = moxcms::ColorProfile::new_display_p3().encode().unwrap();

    let (_d, path) = tmp_png(&motif, &PngOpts { icc: Some(srgb), ..PngOpts::default() });
    let r = analyze(&path, &params(&p, 100.0));
    assert_eq!(r.color.profile, ColorProfileKind::Srgb);
    let diff = find(&r, PrintRuleId::ColorProfileDiffers).expect("sRGB weicht vom Exportprofil ab");
    assert_eq!(diff.severity, Severity::Info);
    assert!(diff.fix.is_some());

    let (_d, path) = tmp_png(&motif, &PngOpts { icc: Some(adobe), ..PngOpts::default() });
    let r = analyze(&path, &params(&p, 100.0));
    assert_eq!(r.color.profile, ColorProfileKind::AdobeRgb);
    assert!(!has(&r, PrintRuleId::ColorProfileDiffers) && !has(&r, PrintRuleId::ColorNoProfile));
    assert_eq!(r.color.icc_description.as_deref(), Some("Adobe RGB 1998"));

    let (_d, path) = tmp_png(&motif, &PngOpts { icc: Some(p3), ..PngOpts::default() });
    let r = analyze(&path, &params(&p, 100.0));
    assert_eq!(r.color.profile, ColorProfileKind::DisplayP3);
    assert_eq!(find(&r, PrintRuleId::ColorUnsupportedProfile).map(|f| f.severity), Some(Severity::Warning));

    let (_d, path) = tmp_png(&motif, &PngOpts::default());
    let r = analyze(&path, &params(&p, 100.0));
    assert_eq!(r.color.profile, ColorProfileKind::None);
    assert_eq!(find(&r, PrintRuleId::ColorNoProfile).map(|f| f.severity), Some(Severity::Warning));

    let (_d, path) = tmp_png(&motif, &PngOpts { srgb: true, ..PngOpts::default() });
    let r = analyze(&path, &params(&p, 100.0));
    assert_eq!(r.color.profile, ColorProfileKind::Srgb);
    assert!(r.color.srgb_chunk);
}

#[test]
fn sixteen_bit_png_is_flagged_and_still_analysed() {
    let p = tee_front();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sechzehn.png");
    let (w, h) = (300u32, 300u32);
    let mut data = Vec::new();
    for y in 0..h {
        for x in 0..w {
            let inside = (50..250).contains(&x) && (50..250).contains(&y);
            data.extend([0x80, 0x00, 0x40, 0x00, 0xC0, 0x00]);
            data.extend(if inside { [0xFF, 0xFF] } else { [0, 0] });
        }
    }
    let file = std::fs::File::create(&path).unwrap();
    let mut enc = png::Encoder::new(file, w, h);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Sixteen);
    let mut wr = enc.write_header().unwrap();
    wr.write_image_data(&data).unwrap();
    wr.finish().unwrap();
    let r = analyze(&path, &params(&p, 100.0));
    assert_eq!(r.file.bit_depth, 16);
    assert!(has(&r, PrintRuleId::FormatBitDepth16));
    assert_eq!(r.bounds.map(|b| (b.x, b.y, b.width, b.height)), Some((50.0, 50.0, 200.0, 200.0)));
    let prepared = load(&path);
    let img = prepared.image.unwrap();
    assert_eq!(pixel(&img, 100, 100), [0x80, 0x40, 0xC0, 255]);
}

#[test]
fn palette_png_with_transparency_and_grayscale() {
    let p = tee_front();
    let dir = tempfile::tempdir().unwrap();
    // Palette: 0 = rot (undurchsichtig), 1 = grün mit tRNS-Alpha 0
    let path = dir.path().join("palette.png");
    let (w, h) = (200u32, 200u32);
    let indices: Vec<u8> = (0..h)
        .flat_map(|y| (0..w).map(move |x| u8::from(!((50..150).contains(&x) && (50..150).contains(&y)))))
        .collect();
    let file = std::fs::File::create(&path).unwrap();
    let mut enc = png::Encoder::new(file, w, h);
    enc.set_color(png::ColorType::Indexed);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_palette(vec![255, 0, 0, 0, 255, 0]);
    enc.set_trns(vec![255u8, 0u8]);
    let mut wr = enc.write_header().unwrap();
    wr.write_image_data(&indices).unwrap();
    wr.finish().unwrap();
    let r = analyze(&path, &params(&p, 50.0));
    assert!(has(&r, PrintRuleId::FormatIndexed));
    assert!(r.alpha.present, "tRNS zählt als Alphakanal");
    assert_eq!(r.bounds.map(|b| (b.x, b.y, b.width, b.height)), Some((50.0, 50.0, 100.0, 100.0)));
    assert_eq!(pixel(&load(&path).image.unwrap(), 60, 60), [255, 0, 0, 255]);

    // Graustufen ohne Alpha
    let gpath = dir.path().join("grau.png");
    let file = std::fs::File::create(&gpath).unwrap();
    let mut enc = png::Encoder::new(file, 64, 64);
    enc.set_color(png::ColorType::Grayscale);
    enc.set_depth(png::BitDepth::Eight);
    let mut wr = enc.write_header().unwrap();
    wr.write_image_data(&vec![100u8; 64 * 64]).unwrap();
    wr.finish().unwrap();
    let r = analyze(&gpath, &params(&p, 50.0));
    assert!(has(&r, PrintRuleId::ColorGrayscale));
    assert!(has(&r, PrintRuleId::AlphaMissing));
    assert_eq!(pixel(&load(&gpath).image.unwrap(), 3, 3), [100, 100, 100, 255]);
}

#[test]
fn interlaced_and_animated_png_are_detected() {
    let p = tee_front();
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("adam7.png");
    std::fs::write(&a, raw_png_1x1(true, false)).unwrap();
    let r = analyze(&a, &params(&p, 50.0));
    assert!(r.file.interlaced);
    assert_eq!(find(&r, PrintRuleId::FormatInterlaced).map(|f| f.severity), Some(Severity::Warning));

    let b = dir.path().join("apng.png");
    std::fs::write(&b, raw_png_1x1(false, true)).unwrap();
    let r = analyze(&b, &params(&p, 50.0));
    assert!(r.file.animated);
    assert_eq!(find(&r, PrintRuleId::FormatAnimated).map(|f| f.severity), Some(Severity::Error));
    assert_eq!(r.verdict, Verdict::Error);
}

#[test]
fn jpeg_tiff_and_webp_are_read_by_content() {
    let p = tee_front();
    let dir = tempfile::tempdir().unwrap();
    let source = disc(600, 250.0, 1.0, [30, 120, 220], [0, 0, 0]);
    let rgb = image::RgbImage::from_fn(source.w, source.h, |x, y| {
        let i = ((y * source.w + x) * 4) as usize;
        image::Rgb([source.rgba[i], source.rgba[i + 1], source.rgba[i + 2]])
    });
    let rgba = image::RgbaImage::from_raw(source.w, source.h, source.rgba.clone()).unwrap();

    // JPEG mit falscher Endung
    let jpg = dir.path().join("foto.png");
    rgb.save_with_format(&jpg, image::ImageFormat::Jpeg).unwrap();
    let r = analyze(&jpg, &params(&p, 50.0));
    assert_eq!(r.file.format, ReportFileFormat::Jpeg);
    assert!(has(&r, PrintRuleId::FormatJpegNoAlpha));
    assert!(has(&r, PrintRuleId::AlphaMissing));
    assert!(!r.alpha.present);

    // TIFF mit Alpha
    let tif = dir.path().join("scan.tif");
    rgba.save_with_format(&tif, image::ImageFormat::Tiff).unwrap();
    let r = analyze(&tif, &params(&p, 50.0));
    assert_eq!(r.file.format, ReportFileFormat::Tiff);
    assert!(r.alpha.present);
    assert_eq!(find(&r, PrintRuleId::FormatNotUploadable).map(|f| f.severity), Some(Severity::Info));
    assert!(r.bounds.is_some());

    // WebP (verlustfrei) mit Alpha
    let webp = dir.path().join("bild.webp");
    rgba.save_with_format(&webp, image::ImageFormat::WebP).unwrap();
    let r = analyze(&webp, &params(&p, 50.0));
    assert_eq!(r.file.format, ReportFileFormat::Webp);
    assert!(has(&r, PrintRuleId::FormatNotUploadable));
    assert!(r.alpha.present);
}

#[test]
fn unsupported_and_corrupt_files_are_errors_not_panics() {
    let p = tee_front();
    let dir = tempfile::tempdir().unwrap();
    let txt = dir.path().join("text.png");
    std::fs::write(&txt, b"das ist kein Bild").unwrap();
    let e =
        analyze_file(&txt, "text.png", &params(&p, 50.0), &Limits::default(), &CancellationToken::new()).unwrap_err();
    assert!(matches!(e, PrintError::UnsupportedFormat { .. }), "{e}");

    // abgeschnittene PNG-Datei
    let (_d, ok) = tmp_png(&rect_img(200, 200, 10, 10, 190, 190, [1, 2, 3]), &PngOpts::default());
    let bytes = std::fs::read(&ok).unwrap();
    let cut = dir.path().join("abgeschnitten.png");
    std::fs::write(&cut, &bytes[..bytes.len() / 2]).unwrap();
    let e = analyze_file(&cut, "abgeschnitten.png", &params(&p, 50.0), &Limits::default(), &CancellationToken::new())
        .unwrap_err();
    assert!(matches!(e, PrintError::Decode(_)), "{e}");

    // zu viele Pixel
    let small = Limits { max_pixels: 100, ..Limits::default() };
    let e = analyze_file(&ok, "x.png", &params(&p, 50.0), &small, &CancellationToken::new()).unwrap_err();
    assert!(matches!(e, PrintError::TooLarge { .. }), "{e}");

    // fehlende Datei
    let e = analyze_file(
        &dir.path().join("fehlt.png"),
        "fehlt.png",
        &params(&p, 50.0),
        &Limits::default(),
        &CancellationToken::new(),
    );
    assert!(matches!(e, Err(PrintError::Io(_))));
}

// ---------------------------------------------------------------------------------------------
// Alpha
// ---------------------------------------------------------------------------------------------

#[test]
fn hard_edge_with_only_antialiasing_is_not_semi_transparent() {
    let p = tee_front();
    let (_d, path) =
        tmp_png(&disc(800, 350.0, 1.0, [200, 30, 30], [0, 0, 0]), &PngOpts { srgb: true, ..PngOpts::default() });
    let r = analyze(&path, &params(&p, 100.0));
    assert_eq!(r.alpha.semi_area_share_of_visible, 0.0);
    assert!(r.alpha.semi_share_of_visible > 0.0, "der Rand hat halbtransparente Pixel");
    assert!(!has(&r, PrintRuleId::AlphaSemiTransparent));
    assert!(!has(&r, PrintRuleId::AlphaGhostPixels));
}

#[test]
fn fade_out_band_is_reported_as_error_with_region() {
    let p = tee_front();
    // Rechteck 200 x 200 mit 8 Zeilen langem Auslauf darunter
    let image = img(400, 400, |x, y| {
        if !(100..300).contains(&x) {
            return [10, 10, 10, 0];
        }
        match y {
            100..=299 => [10, 10, 10, 255],
            300..=307 => [10, 10, 10, 255 - ((y - 299) * 28) as u8],
            _ => [10, 10, 10, 0],
        }
    });
    let (_d, path) = tmp_png(&image, &PngOpts { srgb: true, ..PngOpts::default() });
    let r = analyze(&path, &params(&p, 100.0));
    let share = r.alpha.semi_area_share_of_visible;
    assert!((0.03..0.05).contains(&share), "{share}");
    let f = find(&r, PrintRuleId::AlphaSemiTransparent).expect("Befund");
    assert_eq!(f.severity, Severity::Error, "über 1 %");
    let region = f.region.expect("Bereich");
    assert!(region.y >= 299.0 && region.y + region.height <= 309.0, "{region:?}");
    assert!(f.fix.is_some());
    assert_eq!(r.verdict, Verdict::Error);
}

#[test]
fn small_semi_transparent_patch_is_only_a_warning_and_light_garments_and_dtf_change_it() {
    let p = tee_front();
    // 3 Zeilen Halbtransparenz (davon 2 Zeilen Fläche) auf nur 60 Pixel Breite unter einem großen Rechteck
    let image = img(400, 400, |x, y| match (x, y) {
        (100..=299, 100..=299) => [10, 10, 10, 255],
        (100..=159, 300..=302) => [10, 10, 10, 128],
        _ => [10, 10, 10, 0],
    });
    let (_d, path) = tmp_png(&image, &PngOpts { srgb: true, ..PngOpts::default() });
    let share = analyze(&path, &params(&p, 100.0)).alpha.semi_area_share_of_visible;
    assert!((0.001..0.01).contains(&share), "{share}");
    let sev = |g: Option<&GarmentColor>, technique| {
        let r = analyze(
            &path,
            &AnalyzeParams { profile: &p, garment: g, technique, planned_width_mm: Some(100.0), check_edges: true },
        );
        find(&r, PrintRuleId::AlphaSemiTransparent).map(|f| f.severity)
    };
    assert_eq!(sev(None, PrintTechnique::Dtg), Some(Severity::Warning));
    let dark = garment("schwarz", "#201e1f", true);
    let light = garment("weiss", "#ffffff", false);
    assert_eq!(sev(Some(&dark), PrintTechnique::Dtg), Some(Severity::Warning));
    assert_eq!(sev(Some(&light), PrintTechnique::Dtg), Some(Severity::Info), "helles Textil: nur Hinweis");
    assert_eq!(sev(Some(&dark), PrintTechnique::Dtf), Some(Severity::Error), "DTF kennt keine Halbtransparenz");
}

#[test]
fn ghost_pixels_outside_the_motif_are_counted_with_region() {
    let p = tee_front();
    let mut count = 0u32;
    let image = img(500, 500, |x, y| {
        if (150..350).contains(&x) && (150..350).contains(&y) {
            // Geisterpixel innerhalb der Hülle zählen nicht
            if x == 200 && y == 200 {
                return [5, 5, 5, 0];
            }
            return [200, 100, 50, 255];
        }
        // 37 Geisterpixel auf einem Raster außerhalb
        if x % 40 == 5 && y % 40 == 5 && x < 150 && y < 450 {
            return [1, 1, 1, 7];
        }
        [0, 0, 0, 0]
    });
    for y in 0..500u32 {
        for x in 0..500u32 {
            if x % 40 == 5 && y % 40 == 5 && x < 150 && y < 450 && !((150..350).contains(&x) && (150..350).contains(&y))
            {
                count += 1;
            }
        }
    }
    let (_d, path) = tmp_png(&image, &PngOpts { srgb: true, ..PngOpts::default() });
    let r = analyze(&path, &params(&p, 100.0));
    assert_eq!(r.alpha.ghost_pixel_count, u64::from(count));
    let f = find(&r, PrintRuleId::AlphaGhostPixels).unwrap();
    assert_eq!(f.severity, Severity::Warning);
    assert!(f.region.is_some());
    // die Geisterpixel ändern den Zuschnitt nicht
    assert_eq!(r.trimmed_px.map(|s| (s.width, s.height)), Some((200.0, 200.0)));
}

#[test]
fn opaque_background_and_missing_alpha() {
    let p = tee_front();
    // Alpha vorhanden, aber überall deckend
    let (_d, path) =
        tmp_png(&img(300, 300, |_, _| [250, 250, 250, 255]), &PngOpts { srgb: true, ..PngOpts::default() });
    let r = analyze(&path, &params(&p, 100.0));
    assert!(has(&r, PrintRuleId::AlphaOpaqueBackground));
    assert!(!has(&r, PrintRuleId::AlphaMissing));
    assert!(has(&r, PrintRuleId::LayoutTouchesEdge));
    // transparenter Rand: kein Befund
    let (_d2, path2) =
        tmp_png(&rect_img(300, 300, 50, 50, 250, 250, [250, 250, 250]), &PngOpts { srgb: true, ..PngOpts::default() });
    assert!(!has(&analyze(&path2, &params(&p, 100.0)), PrintRuleId::AlphaOpaqueBackground));

    // ohne Alpha: Fehler bei Unterlage (dunkles Textil), sonst Warnung
    let dir = tempfile::tempdir().unwrap();
    let rgb = dir.path().join("rgb.png");
    let file = std::fs::File::create(&rgb).unwrap();
    let mut enc = png::Encoder::new(file, 64, 64);
    enc.set_color(png::ColorType::Rgb);
    enc.set_depth(png::BitDepth::Eight);
    let mut wr = enc.write_header().unwrap();
    wr.write_image_data(&vec![120u8; 64 * 64 * 3]).unwrap();
    wr.finish().unwrap();
    let dark = garment("schwarz", "#201e1f", true);
    let sev = |g: Option<&GarmentColor>| {
        let r = analyze(
            &rgb,
            &AnalyzeParams {
                profile: &p,
                garment: g,
                technique: PrintTechnique::Dtg,
                planned_width_mm: Some(50.0),
                check_edges: true,
            },
        );
        find(&r, PrintRuleId::AlphaMissing).map(|f| f.severity)
    };
    assert_eq!(sev(Some(&dark)), Some(Severity::Error));
    assert_eq!(sev(None), Some(Severity::Warning));
}

#[test]
fn empty_image_has_no_layout() {
    let p = tee_front();
    let (_d, path) = tmp_png(&img(200, 200, |_, _| [0, 0, 0, 0]), &PngOpts { srgb: true, ..PngOpts::default() });
    let r = analyze(&path, &params(&p, 100.0));
    assert!(r.bounds.is_none() && r.trimmed_px.is_none());
    assert_eq!(find(&r, PrintRuleId::LayoutEmpty).map(|f| f.severity), Some(Severity::Error));
    assert_eq!(r.verdict, Verdict::Error);
}

// ---------------------------------------------------------------------------------------------
// Größe, Auflösung, Farbe
// ---------------------------------------------------------------------------------------------

#[test]
fn resolution_and_area_rules_follow_the_profile() {
    let p = tee_front();
    // Motiv 3000 x 3000 px
    let (_d, path) = tmp_png(
        &rect_img(3200, 3200, 100, 100, 3100, 3100, [30, 30, 30]),
        &PngOpts { srgb: true, ..PngOpts::default() },
    );
    // 250 mm: 3000 px / 9,84 in = 305 dpi -> keine Auflösungsbefunde, passt in den sicheren Bereich
    let r = analyze(&path, &params(&p, 250.0));
    assert!(r.placement.effective_dpi > 300.0);
    assert!(!has(&r, PrintRuleId::ResolutionBelowTarget) && !has(&r, PrintRuleId::ResolutionTooLow));
    assert!(r.placement.fits_print_area && r.placement.fits_safe_area == Some(true));
    assert_eq!((r.placement.target_px.width, r.placement.target_px.height), (2953.0, 2953.0));
    // 300 mm quadratisch: 254 dpi (Warnung), außerhalb des sicheren, aber innerhalb des Druckbereichs? 300 x 300 passt
    let r = analyze(&path, &params(&p, 300.0));
    assert_eq!(find(&r, PrintRuleId::ResolutionBelowTarget).map(|f| f.severity), Some(Severity::Warning));
    assert!(has(&r, PrintRuleId::ResolutionUpscaleNeeded));
    assert!(has(&r, PrintRuleId::LayoutExceedsSafeArea));
    assert!(!has(&r, PrintRuleId::LayoutExceedsPrintArea));
    assert!((r.placement.max_width_mm_at_target_dpi - 254.0).abs() < 0.1);
    // 340 mm: größer als die Druckfläche
    let r = analyze(&path, &params(&p, 340.0));
    assert_eq!(find(&r, PrintRuleId::LayoutExceedsPrintArea).map(|f| f.severity), Some(Severity::Error));
    assert!(!r.placement.fits_print_area);
    // 600 mm gedehnt: unter 150 dpi
    let (_d2, small) =
        tmp_png(&rect_img(1000, 1000, 100, 100, 900, 900, [30, 30, 30]), &PngOpts { srgb: true, ..PngOpts::default() });
    let r = analyze(&small, &params(&p, 280.0));
    let low = find(&r, PrintRuleId::ResolutionTooLow).expect("unter 150 dpi");
    assert_eq!(low.severity, Severity::Error);
    assert!(r.placement.effective_dpi < 150.0);
}

#[test]
fn size_rules_use_the_trimmed_motif_and_the_file() {
    let p = tee_front();
    let (_d, path) =
        tmp_png(&rect_img(2000, 2000, 500, 500, 1300, 1300, [9, 9, 9]), &PngOpts { srgb: true, ..PngOpts::default() });
    let r = analyze(&path, &params(&p, 50.0));
    // Zuschnitt 800 x 800 liegt unter 1000 px auf beiden Seiten
    assert_eq!(find(&r, PrintRuleId::SizeBelowMinPixels).map(|f| f.severity), Some(Severity::Error));
    // sehr große Datei: Profil künstlich verschärfen
    let mut strict = tee_front();
    strict.max_px_per_side = 1500;
    strict.warn_file_bytes = 10;
    strict.max_file_bytes = 100_000_000;
    let r = analyze(&path, &params(&strict, 50.0));
    assert_eq!(find(&r, PrintRuleId::SizeAboveMaxPixels).map(|f| f.severity), Some(Severity::Error));
    assert_eq!(find(&r, PrintRuleId::FileTooLarge).map(|f| f.severity), Some(Severity::Warning));
    strict.max_file_bytes = 10;
    assert_eq!(
        find(&analyze(&path, &params(&strict, 50.0)), PrintRuleId::FileTooLarge).map(|f| f.severity),
        Some(Severity::Error)
    );
}

#[test]
fn near_black_and_low_contrast_rules() {
    let p = tee_front();
    // dunkelgraues Motiv (RGB 8): nahe Schwarz, aber nicht #000000 – und kaum Kontrast zu schwarzem Textil
    let (_d, path) =
        tmp_png(&rect_img(600, 600, 50, 50, 550, 550, [8, 8, 8]), &PngOpts { srgb: true, ..PngOpts::default() });
    let black = garment("schwarz", "#201e1f", true);
    let r = analyze(
        &path,
        &AnalyzeParams {
            profile: &p,
            garment: Some(&black),
            technique: PrintTechnique::Dtg,
            planned_width_mm: Some(100.0),
            check_edges: true,
        },
    );
    let nb = find(&r, PrintRuleId::ColorNearBlack).expect("fast Schwarz");
    assert_eq!(nb.severity, Severity::Info);
    assert!(nb.fix.is_some());
    assert_eq!(find(&r, PrintRuleId::ContrastLowOnGarment).map(|f| f.severity), Some(Severity::Warning));
    // auf weißem Textil guter Kontrast
    let white = garment("weiss", "#ffffff", false);
    let r = analyze(
        &path,
        &AnalyzeParams {
            profile: &p,
            garment: Some(&white),
            technique: PrintTechnique::Dtg,
            planned_width_mm: Some(100.0),
            check_edges: true,
        },
    );
    assert!(!has(&r, PrintRuleId::ContrastLowOnGarment));
    // echtes Schwarz ist kein „fast Schwarz“
    let (_d2, pure) =
        tmp_png(&rect_img(600, 600, 50, 50, 550, 550, [0, 0, 0]), &PngOpts { srgb: true, ..PngOpts::default() });
    assert!(!has(&analyze(&pure, &params(&p, 100.0)), PrintRuleId::ColorNearBlack));
}

// ---------------------------------------------------------------------------------------------
// Überlagerung
// ---------------------------------------------------------------------------------------------

#[test]
fn overlay_png_is_a_png_of_the_same_size() {
    let p = tee_front();
    let (_d, path) =
        tmp_png(&disc(300, 100.0, 1.0, [1, 2, 3], [0, 0, 0]), &PngOpts { srgb: true, ..PngOpts::default() });
    let prepared = load(&path);
    for kind in [
        cypher_core::api::OverlayKind::SemiTransparent,
        cypher_core::api::OverlayKind::GhostPixels,
        cypher_core::api::OverlayKind::Bounds,
        cypher_core::api::OverlayKind::ThinLines,
        cypher_core::api::OverlayKind::AlphaOnly,
    ] {
        let bytes = printcheck::overlay_png(&prepared, kind, &p).unwrap();
        let reader = png::Decoder::new(std::io::Cursor::new(&bytes)).read_info().unwrap();
        assert_eq!((reader.info().width, reader.info().height), (300, 300), "{kind:?}");
    }
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

#[test]
fn trimmed_export_is_3307_px_300_dpi_adobe_rgb_and_passes_the_recheck() {
    // 2400 x 3200 Quelle mit Motiv 1800 x 2400 px (72 dpi, sRGB-Marke)
    let source = img(2400, 3200, |x, y| {
        let inside = (300..2100).contains(&x) && (400..2800).contains(&y);
        if inside { [180, 40, 60, 255] } else { [0, 0, 0, 0] }
    });
    let mut o = opts(ExportMode::Trimmed, 280.0);
    o.allow_upscale = true;
    let sink = Collect::new();
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("ratte.png");
    write_png(&src, &source, &PngOpts { ppm: Some(2835), srgb: true, ..PngOpts::default() });
    let out = dir.path().join("ratte_tee-front_280mm_300dpi.png");
    let profile = tee_front();
    let outcome = export_file(
        &ExportRequest {
            source: &src,
            source_name: "ratte.png",
            output: &out,
            profile: &profile,
            garment: None,
            technique: PrintTechnique::Dtg,
            options: &o,
            limits: Limits::default(),
        },
        &sink,
        &CancellationToken::new(),
    )
    .unwrap();
    assert_eq!(
        sink.take(),
        vec![
            PrintStage::Decode,
            PrintStage::Analyze,
            PrintStage::Fix,
            PrintStage::Resample,
            PrintStage::ColorConvert,
            PrintStage::Encode,
            PrintStage::Verify
        ]
    );
    assert_eq!((outcome.width_px, outcome.height_px), (3307, 4409));
    assert_eq!(outcome.dpi, 300);

    // Datei: pHYs 11811, iCCP Adobe RGB, kein sRGB-Chunk, 8 Bit RGBA, nicht interlaced
    let reader = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(&out).unwrap())).read_info().unwrap();
    let info = reader.info();
    let dims = info.pixel_dims.unwrap();
    assert_eq!((dims.xppu, dims.yppu, dims.unit), (11811, 11811, png::Unit::Meter));
    assert!(info.srgb.is_none() && !info.interlaced);
    assert_eq!((info.color_type, info.bit_depth), (png::ColorType::Rgba, png::BitDepth::Eight));
    let embedded = info.icc_profile.as_deref().unwrap();
    assert_eq!(icc::describe_icc(embedded).kind, ColorProfileKind::AdobeRgb);

    // erneute Prüfung: bestanden, 300 dpi, Profil stimmt, Auflösungsangabe stimmt
    let r = &outcome.report;
    assert_ne!(r.verdict, Verdict::Error, "{:?}", r.findings);
    assert_eq!(r.color.profile, ColorProfileKind::AdobeRgb);
    assert_eq!(r.dpi.source, DpiSource::PHYs);
    assert!((r.placement.effective_dpi - 300.0).abs() < 0.5, "{}", r.placement.effective_dpi);
    assert!(!has(r, PrintRuleId::ResolutionMetadataMismatch) && !has(r, PrintRuleId::ColorProfileDiffers));
    assert!(!has(r, PrintRuleId::AlphaGhostPixels) && !has(r, PrintRuleId::AlphaSemiTransparent));
    // die Quelle hatte 72 dpi und sRGB -> der Quellbericht meldet das
    assert!(has(&outcome.source_report, PrintRuleId::ResolutionMetadataMismatch));
    assert!(has(&outcome.source_report, PrintRuleId::ColorProfileDiffers));

    // Begleitdatei
    let json_path = outcome.placement_json.clone().unwrap();
    assert_eq!(json_path.file_name().unwrap().to_string_lossy(), "ratte_tee-front_280mm_300dpi.shirtigo.json");
    let json: serde_json::Value = serde_json::from_slice(&std::fs::read(&json_path).unwrap()).unwrap();
    assert_eq!(json["processingarea_type"], "front");
    assert_eq!(json["processingmethod"], "dtg");
    assert_eq!(json["width_mm"], 280.0);
    assert_eq!(json["file"], "ratte_tee-front_280mm_300dpi.png");
    assert_eq!(json["widthPx"], 3307);
    assert_eq!(json["colorProfile"], "adobeRgb");
    assert_eq!(json["sha256"].as_str().unwrap(), printcheck::file_sha256(&out).unwrap());
    assert_eq!(json["sha256"].as_str().unwrap(), outcome.sha256);
    assert!(json["createdBy"].as_str().unwrap().starts_with("Cypher Studio "));
}

#[test]
fn downscaling_does_not_create_dark_fringes() {
    // rote Scheibe, unter dem transparenten Bereich liegt Schwarz (üblich bei Programmen, die RGB nicht aufräumen)
    let source = disc(1200, 560.0, 1.0, [255, 0, 0], [0, 0, 0]);
    let mut o = opts(ExportMode::Trimmed, 40.0);
    o.color_profile = ExportColorProfile::Srgb;
    o.allow_upscale = false;
    let res = run_export(&source, &PngOpts { srgb: true, ..PngOpts::default() }, None, &o).unwrap();
    let out = load(&res.outcome.output).image.unwrap();
    assert!(out.width < 560, "es wurde verkleinert: {}", out.width);
    let mut checked = 0;
    for px in out.rgba.chunks_exact(4) {
        if px[3] >= 64 {
            checked += 1;
            assert!(px[0] >= 240 && px[1] <= 12 && px[2] <= 12, "dunkler oder verfärbter Rand: {px:?}");
        }
    }
    assert!(checked > 1000);
}

#[test]
fn scaled_hard_edges_stay_free_of_ringing_artefacts() {
    use cypher_core::printcheck::export::{clean_resampled_alpha, crop_and_scale};
    use cypher_core::printcheck::scan::PxRect;
    let p = tee_front();
    for (src_w, dst_w) in [(1800u32, 3307u32), (1200, 472), (1000, 1500), (1000, 3000), (3000, 1000), (1000, 900)] {
        let src_h = src_w / 2;
        let source = rect_img(src_w, src_h, src_w / 5, src_h / 5, src_w - src_w / 5, src_h - src_h / 5, [255, 0, 0]);
        let decoded = printcheck::DecodedImage { width: src_w, height: src_h, rgba: source.rgba };
        let dst_h = (f64::from(src_h) * f64::from(dst_w) / f64::from(src_w)).round() as u32;
        let rect = PxRect { x0: 0, y0: 0, x1: src_w, y1: src_h };
        let mut out = crop_and_scale(&decoded, rect, dst_w, dst_h, &CancellationToken::new()).unwrap();
        // ohne Aufräumen: Schwingungen sind messbar
        let raw = printcheck::DecodedImage { width: dst_w, height: dst_h, rgba: out.clone() };
        let raw_m = printcheck::measure(&raw, &p, None);
        assert!(raw_m.ghost > 0 || raw_m.semi_area > 0, "{src_w}->{dst_w}: Lanczos schwingt an der Kante");
        // mit Aufräumen: sauber
        clean_resampled_alpha(&mut out, p.alpha.semi_min);
        let clean = printcheck::DecodedImage { width: dst_w, height: dst_h, rgba: out };
        let m = printcheck::measure(&clean, &p, None);
        assert_eq!(m.ghost, 0, "{src_w}->{dst_w}");
        // bei starker Vergrößerung bleiben an den vier Ecken einzelne Pixel; weit unter der Warnschwelle von 0,1 %
        assert!(
            m.semi_area <= 16 && (m.semi_area as f64) < m.visible as f64 * 0.0001,
            "{src_w}->{dst_w}: {}",
            m.semi_area
        );
    }
}

#[test]
fn full_area_export_has_the_print_area_size_with_offset() {
    let source = rect_img(1500, 1500, 100, 100, 1400, 1400, [30, 90, 200]);
    let mut o = opts(ExportMode::FullArea, 100.0);
    o.offset_top_mm = 26.0;
    o.offset_center_mm = 0.0;
    let res = run_export(&source, &PngOpts { srgb: true, ..PngOpts::default() }, None, &o).unwrap();
    assert_eq!((res.outcome.width_px, res.outcome.height_px), (3898, 5315));
    let r = &res.outcome.report;
    let b = r.bounds.unwrap();
    assert_eq!(b.y as u32, 307);
    assert_eq!(b.width as u32, 1181);
    assert!(((b.x + b.width / 2.0) - 3898.0 / 2.0).abs() <= 1.0);
    let margins = r.margins_px.as_ref().unwrap();
    assert_eq!(margins.top, 307);
    assert!(r.placement.fits_print_area);
    assert!(!has(r, PrintRuleId::AlphaOpaqueBackground));
}

#[test]
fn upscaling_needs_permission() {
    let source = rect_img(1500, 1500, 100, 100, 1100, 1100, [30, 90, 200]);
    let mut o = opts(ExportMode::Trimmed, 280.0);
    o.allow_upscale = false;
    let res = run_export(&source, &PngOpts { srgb: true, ..PngOpts::default() }, None, &o).unwrap();
    assert_eq!(res.outcome.width_px, 1000);
    assert!(res.outcome.geometry.width_clamped);
    let json: serde_json::Value =
        serde_json::from_slice(&std::fs::read(res.outcome.placement_json.unwrap()).unwrap()).unwrap();
    assert!((json["width_mm"].as_f64().unwrap() - 84.67).abs() < 0.01);
    o.allow_upscale = true;
    let res = run_export(&source, &PngOpts { srgb: true, ..PngOpts::default() }, None, &o).unwrap();
    assert_eq!(res.outcome.width_px, 3307);
}

#[test]
fn fixes_clean_up_ghosts_semi_transparency_and_near_black() {
    // Motiv mit Auslaufband, Geisterpixeln und fast schwarzer Farbe
    let source = img(1200, 1200, |x, y| {
        if (200..1000).contains(&x) {
            match y {
                200..=799 => return [6, 6, 6, 255],
                800..=815 => return [6, 6, 6, 255 - ((y - 799) * 15) as u8],
                _ => {}
            }
        }
        if x % 50 == 7 && y % 50 == 7 && !(150..=1050).contains(&x) { [0, 0, 0, 6] } else { [0, 0, 0, 0] }
    });
    let src_opts = PngOpts { srgb: true, ..PngOpts::default() };
    let white_shirt = garment("weiss", "#ffffff", false);

    // ohne Korrekturen bleiben die Befunde stehen
    let mut plain_opts = opts(ExportMode::Trimmed, 100.0);
    plain_opts.color_profile = ExportColorProfile::Srgb;
    let plain = run_export(&source, &src_opts, None, &plain_opts).unwrap();
    assert!(has(&plain.outcome.report, PrintRuleId::AlphaSemiTransparent));
    assert!(has(&plain.outcome.source_report, PrintRuleId::AlphaGhostPixels));
    // Geisterpixel liegen außerhalb des Zuschnitts und fallen beim Export immer weg
    assert!(!has(&plain.outcome.report, PrintRuleId::AlphaGhostPixels));
    assert!(has(&plain.outcome.report, PrintRuleId::ColorNearBlack));

    for fix in [SemiTransparencyFix::Threshold, SemiTransparencyFix::Halftone, SemiTransparencyFix::BlendWithGarment] {
        let mut o = opts(ExportMode::Trimmed, 100.0);
        o.color_profile = ExportColorProfile::Srgb;
        o.fixes = ExportFixes { clean_ghost_pixels: true, semi_transparency: fix, near_black_to_pure_black: true };
        let res = run_export(&source, &src_opts, Some(&white_shirt), &o).unwrap();
        let r = &res.outcome.report;
        assert!(!has(r, PrintRuleId::AlphaSemiTransparent), "{fix:?}: {:?}", r.findings);
        assert!(!has(r, PrintRuleId::AlphaGhostPixels), "{fix:?}");
        assert!(!has(r, PrintRuleId::ColorNearBlack), "{fix:?}");
        assert_eq!(r.alpha.ghost_pixel_count, 0);
        // nach „Reinschwarz“ ist die Fläche echtes Schwarz
        let out = load(&res.outcome.output).image.unwrap();
        let (cx, cy) = (out.width / 2, out.height / 4);
        let px = pixel(&out, cx, cy);
        assert_eq!(&px[..3], &[0, 0, 0], "{fix:?}");
        assert_eq!(px[3], 255);
    }

    // „mit Textilfarbe verrechnen“ braucht eine Textilfarbe
    let mut o = opts(ExportMode::Trimmed, 100.0);
    o.fixes.semi_transparency = SemiTransparencyFix::BlendWithGarment;
    let e = run_export(&source, &src_opts, None, &o).err().expect("Fehler");
    assert!(matches!(e, PrintError::InvalidInput { ref field, .. } if field == "garmentColorId"), "{e}");
}

#[test]
fn export_from_jpeg_works_and_converts_to_srgb_when_asked() {
    let dir = tempfile::tempdir().unwrap();
    let rgb = image::RgbImage::from_fn(800, 600, |x, y| {
        if (100..700).contains(&x) && (100..500).contains(&y) {
            image::Rgb([200, 60, 40])
        } else {
            image::Rgb([255, 255, 255])
        }
    });
    let src = dir.path().join("foto.jpg");
    rgb.save_with_format(&src, image::ImageFormat::Jpeg).unwrap();
    let out = dir.path().join("out.png");
    let profile = tee_front();
    let mut o = opts(ExportMode::Trimmed, 100.0);
    o.color_profile = ExportColorProfile::Srgb;
    let outcome = export_file(
        &ExportRequest {
            source: &src,
            source_name: "foto.jpg",
            output: &out,
            profile: &profile,
            garment: None,
            technique: PrintTechnique::Dtf,
            options: &o,
            limits: Limits::default(),
        },
        &NoProgress,
        &CancellationToken::new(),
    )
    .unwrap();
    // ohne Alphakanal ist das ganze Bild das Motiv
    assert_eq!(outcome.width_px, 1181);
    assert_eq!(outcome.report.color.profile, ColorProfileKind::Srgb);
    assert!(!outcome.report.alpha.present || outcome.report.alpha.present);
}

#[test]
fn export_refuses_impossible_requests() {
    let source = rect_img(800, 800, 100, 100, 700, 700, [9, 9, 9]);
    let src_opts = PngOpts { srgb: true, ..PngOpts::default() };
    // größer als die Druckfläche
    let e = run_export(&source, &src_opts, None, &opts(ExportMode::Trimmed, 400.0)).err().unwrap();
    assert!(matches!(e, PrintError::InvalidInput { .. }), "{e}");
    // leeres Bild
    let empty = img(300, 300, |_, _| [0, 0, 0, 0]);
    let e = run_export(&empty, &src_opts, None, &opts(ExportMode::Trimmed, 100.0)).err().unwrap();
    assert!(matches!(e, PrintError::InvalidInput { .. }), "{e}");
    // Versatz aus der Fläche
    let mut o = opts(ExportMode::FullArea, 200.0);
    o.offset_center_mm = 100.0;
    assert!(run_export(&source, &src_opts, None, &o).is_err());
}

#[test]
fn cancelled_export_leaves_no_file_behind() {
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("quelle.png");
    write_png(&src, &rect_img(800, 800, 100, 100, 700, 700, [9, 9, 9]), &PngOpts { srgb: true, ..PngOpts::default() });
    let out = dir.path().join("out.png");
    let profile = tee_front();
    let o = opts(ExportMode::Trimmed, 100.0);
    let token = CancellationToken::new();
    let t2 = token.clone();
    // Abbruch, sobald die Skalierung beginnt
    let sink = move |stage: PrintStage| {
        if stage == PrintStage::Resample {
            t2.cancel();
        }
    };
    let r = export_file(
        &ExportRequest {
            source: &src,
            source_name: "quelle.png",
            output: &out,
            profile: &profile,
            garment: None,
            technique: PrintTechnique::Dtg,
            options: &o,
            limits: Limits::default(),
        },
        &sink,
        &token,
    );
    assert!(matches!(r, Err(PrintError::Cancelled)));
    assert!(!out.exists());
    assert!(!out.with_file_name("out.shirtigo.json").exists());
}

#[test]
fn suggested_file_names_are_clean() {
    let p = tee_front();
    assert_eq!(suggested_file_name("ratte", &p, &opts(ExportMode::Trimmed, 280.0)), "ratte_tee-front_280mm_300dpi.png");
    assert_eq!(
        suggested_file_name("a/b:c", &p, &opts(ExportMode::Trimmed, 100.5)),
        "a-b-c_tee-front_100.5mm_300dpi.png"
    );
    assert_eq!(
        suggested_file_name("x", &profile("shirtigo-hoodie-sleeve-left"), &opts(ExportMode::FullArea, 80.0)),
        "x_hoodie-sleeve-left_flaeche_300dpi.png"
    );
}

// ---------------------------------------------------------------------------------------------
// Leistung
// ---------------------------------------------------------------------------------------------

#[test]
#[cfg_attr(debug_assertions, ignore = "Leistungsprobe nur im Release-Build aussagekräftig (cargo test --release)")]
fn analysis_of_a_full_print_area_png_takes_under_one_and_a_half_seconds() {
    let p = tee_front();
    // 3898 x 5315 mit weichem Verlauf, Halbtransparenz und Rauschen (schwer komprimierbar genug, um realistisch zu sein)
    let image = img(3898, 5315, |x, y| {
        let inside = (400..3500).contains(&x) && (300..5000).contains(&y);
        if !inside {
            return [0, 0, 0, 0];
        }
        let noise = ((x * 31 + y * 17) % 29) as u8;
        let a = if y > 4800 { (255 - (y - 4800) * 255 / 200) as u8 } else { 255 };
        [(x / 16) as u8 ^ noise, (y / 22) as u8, noise * 8, a]
    });
    let (_d, path) = tmp_png(&image, &PngOpts { srgb: true, ppm: Some(11811), ..PngOpts::default() });
    let started = Instant::now();
    let r = analyze(&path, &params(&p, 280.0));
    let elapsed = started.elapsed();
    eprintln!("Analyse 3898 x 5315: {elapsed:?}");
    assert!(r.alpha.semi_area_share_of_visible > 0.0);
    assert!(elapsed.as_secs_f64() < 1.5, "zu langsam: {elapsed:?}");
}
