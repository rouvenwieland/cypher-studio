//! `printcheck` – Druckdateien prüfen und exportieren (ARCHITEKTUR.md 2.13, docs/research/vorgaben.md).
//!
//! Die Funktionen rechnen synchron und CPU-gebunden; die Tauri-Schicht ruft sie in `spawn_blocking` auf. Alle
//! Zahlen (Schwellen, Maße) stammen aus dem Druckprofil des Katalogs.
//!
//! Ablauf Analyse: [`Prepared::load`] liest Metadaten und dekodiert nach RGBA8, [`Prepared::analyze`] misst und
//! bewertet. Wer die geplante Breite verschiebt, ruft nur `analyze` erneut auf.
//!
//! Ablauf Export ([`export_file`]): dekodieren, messen, Korrekturen, erneut messen, zuschneiden und skalieren,
//! Farbe umrechnen, als PNG (300 dpi, Profil eingebettet) atomar schreiben, Begleitdatei schreiben, die geschriebene
//! Datei erneut lesen und prüfen.

pub mod analyze;
pub mod decode;
pub mod export;
pub mod icc;
pub mod meta;
pub mod overlay;
pub mod scan;
#[cfg(test)]
mod testing;

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

use crate::api::{
    ExportColorProfile, ExportMode, GarmentColor, OverlayKind, PrintExportOptions, PrintProfile, PrintReport,
    PrintStage, PrintTechnique, ProductKind,
};
use crate::error::{IoError, PrintError};
use crate::platform::fsx;
use crate::progress::ProgressSink;
use crate::util::now_iso;

pub use analyze::{Analysis, AnalyzeParams, ENGINE_VERSION, Measures, analyze as analyze_image, measure};
pub use decode::{DecodedImage, Limits};
pub use export::{EXPORT_DPI, Geometry, PlacementJson};
pub use meta::{ImageMeta, read_meta};

fn check_cancel(cancel: &CancellationToken) -> Result<(), PrintError> {
    if cancel.is_cancelled() { Err(PrintError::Cancelled) } else { Ok(()) }
}

/// Eine geladene Bilddatei: Metadaten und (außer bei CMYK) die dekodierten Pixel.
pub struct Prepared {
    pub name: String,
    pub meta: ImageMeta,
    pub image: Option<DecodedImage>,
}

impl Prepared {
    pub fn load(path: &Path, name: &str, limits: &Limits, cancel: &CancellationToken) -> Result<Self, PrintError> {
        // Eine präparierte Datei darf in `png`, `image`, `tiff` oder `moxcms` nur einen Fehler auslösen, nie die App beenden
        crate::util::catch_panic("Druckprüfung", || Self::load_unguarded(path, name, limits, cancel))
            .map_err(PrintError::Decode)?
    }

    fn load_unguarded(
        path: &Path,
        name: &str,
        limits: &Limits,
        cancel: &CancellationToken,
    ) -> Result<Self, PrintError> {
        let meta = read_meta(path, limits.max_pixels)?;
        check_cancel(cancel)?;
        let image =
            if meta.channels == meta::Channels::Cmyk { None } else { Some(decode::decode(path, &meta, limits)?) };
        check_cancel(cancel)?;
        Ok(Prepared { name: name.to_owned(), meta, image })
    }

    /// Misst und bewertet.
    pub fn analyze(&self, params: &AnalyzeParams<'_>) -> Analysis {
        analyze_image(self.image.as_ref(), &self.meta, &self.name, params)
    }
}

/// Prüft eine Datei und liefert den Bericht.
pub fn analyze_file(
    path: &Path,
    name: &str,
    params: &AnalyzeParams<'_>,
    limits: &Limits,
    cancel: &CancellationToken,
) -> Result<PrintReport, PrintError> {
    Ok(Prepared::load(path, name, limits, cancel)?.analyze(params).report)
}

/// Rendert eine Überlagerung als PNG-Bytes (RGBA, ohne Profil).
pub fn overlay_png(prepared: &Prepared, kind: OverlayKind, profile: &PrintProfile) -> Result<Vec<u8>, PrintError> {
    let Some(img) = &prepared.image else {
        return Err(PrintError::Decode("Für dieses Bild ist keine Überlagerung möglich".into()));
    };
    let m = measure(img, profile, None);
    let o = overlay::render(img, kind, profile, &m)?;
    let mut out = Vec::new();
    let enc_err = |e: png::EncodingError| PrintError::Encode(format!("PNG: {e}"));
    let mut enc = png::Encoder::new(&mut out, o.width, o.height);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_compression(png::Compression::Fast);
    let mut writer = enc.write_header().map_err(enc_err)?;
    writer.write_image_data(&o.rgba).map_err(enc_err)?;
    writer.finish().map_err(enc_err)?;
    Ok(out)
}

/// Auftrag für [`export_file`].
pub struct ExportRequest<'a> {
    pub source: &'a Path,
    /// Anzeigename der Quelle im Bericht.
    pub source_name: &'a str,
    /// Zieldatei (`.png`); der Ordner wird bei Bedarf angelegt.
    pub output: &'a Path,
    pub profile: &'a PrintProfile,
    pub garment: Option<&'a GarmentColor>,
    pub technique: PrintTechnique,
    pub options: &'a PrintExportOptions,
    pub limits: Limits,
}

#[derive(Debug, Clone)]
pub struct ExportOutcome {
    pub output: PathBuf,
    pub placement_json: Option<PathBuf>,
    pub width_px: u32,
    pub height_px: u32,
    pub dpi: u32,
    pub color_profile: ExportColorProfile,
    pub sha256: String,
    pub geometry: Geometry,
    /// Prüfung der Quelle vor den Korrekturen.
    pub source_report: PrintReport,
    /// Prüfung der geschriebenen Datei.
    pub report: PrintReport,
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

/// Pfad der Begleitdatei zu einer Ausgabedatei: `<name>.shirtigo.json` neben der PNG.
pub fn placement_path(output: &Path) -> PathBuf {
    let stem = output.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "export".into());
    output.with_file_name(format!("{stem}.shirtigo.json"))
}

/// Vorschlag für den Dateinamen: `<quelle>_<produkt>-<fläche>_<breite>mm_300dpi.png`.
pub fn suggested_file_name(source_stem: &str, profile: &PrintProfile, options: &PrintExportOptions) -> String {
    let product = match profile.product.id {
        ProductKind::Tee => "tee",
        ProductKind::Hoodie => "hoodie",
    };
    let stem = fsx::sanitize_file_name(source_stem);
    let area = profile.placement.slug();
    match options.mode {
        ExportMode::Trimmed => {
            let w = options.planned_width_mm;
            let width = if (w - w.round()).abs() < 0.05 { format!("{}", w.round() as i64) } else { format!("{w:.1}") };
            format!("{stem}_{product}-{area}_{width}mm_{EXPORT_DPI}dpi.png")
        }
        ExportMode::FullArea => format!("{stem}_{product}-{area}_flaeche_{EXPORT_DPI}dpi.png"),
    }
}

/// Führt den Export durch. Die Ausgabe wird erst nach dem vollständigen Schreiben sichtbar (atomar).
pub fn export_file(
    req: &ExportRequest<'_>,
    sink: &dyn ProgressSink<PrintStage>,
    cancel: &CancellationToken,
) -> Result<ExportOutcome, PrintError> {
    let profile = req.profile;
    let options = req.options;

    export::validate_fixes(options, req.garment)?;

    sink.emit(PrintStage::Decode);
    let prepared = Prepared::load(req.source, req.source_name, &req.limits, cancel)?;
    let params = AnalyzeParams {
        profile,
        garment: req.garment,
        technique: req.technique,
        planned_width_mm: Some(options.planned_width_mm),
        check_edges: true,
    };

    sink.emit(PrintStage::Analyze);
    let analysis = prepared.analyze(&params);
    check_cancel(cancel)?;
    let Prepared { meta, image, .. } = prepared;
    let image = image.ok_or_else(|| PrintError::Decode("Dieses Bild kann nicht exportiert werden".into()))?;
    let bounds = analysis.measures.bounds.ok_or_else(|| PrintError::InvalidInput {
        field: "handleId".into(),
        reason: "Das Bild enthält kein sichtbares Motiv".into(),
    })?;
    let geometry = export::plan(bounds, profile, options)?;

    // Die Korrekturen laufen auf dem skalierten Motiv (Auflösung des Druckers); die Ereignisse bleiben in der Reihenfolge
    // des Vertrags, damit ein Fortschrittsbalken nie rückwärts läuft
    sink.emit(PrintStage::Fix);
    sink.emit(PrintStage::Resample);
    let mut motif = export::crop_and_scale(&image, geometry.crop, geometry.motif_w, geometry.motif_h, cancel)?;
    drop(image);
    if geometry.is_scaled() {
        export::clean_resampled_alpha(&mut motif, profile.alpha.semi_min);
    }
    export::apply_output_fixes(
        &mut motif,
        geometry.motif_w,
        geometry.motif_h,
        options,
        req.garment,
        analyze::thresholds(profile),
    )?;
    check_cancel(cancel)?;

    sink.emit(PrintStage::ColorConvert);
    let source_kind = icc::classify(&meta).kind;
    export::convert_colors(&mut motif, &meta, source_kind, options.color_profile)?;
    let canvas = export::place_on_canvas(&motif, &geometry)?;
    drop(motif);
    check_cancel(cancel)?;

    sink.emit(PrintStage::Encode);
    let icc_bytes = icc::export_profile_bytes(options.color_profile)?;
    let png_bytes = export::encode_png(&canvas, geometry.canvas_w, geometry.canvas_h, &icc_bytes)?;
    drop(canvas);
    let sha256 = hex(&Sha256::digest(&png_bytes));
    fsx::write_atomic(req.output, &png_bytes)?;
    let file_name =
        req.output.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "export.png".into());
    let placement_json = if options.write_placement_json {
        let path = placement_path(req.output);
        let json = export::placement_json(&export::PlacementInput {
            profile,
            technique: req.technique,
            geometry: &geometry,
            file_name: &file_name,
            sha256: &sha256,
            color_profile: options.color_profile,
            width_px: geometry.canvas_w,
            height_px: geometry.canvas_h,
            created_at: &now_iso(),
        });
        fsx::write_json_atomic(&path, &json)?;
        Some(path)
    } else {
        None
    };
    check_cancel(cancel)?;

    sink.emit(PrintStage::Verify);
    let recheck = Prepared::load(req.output, &file_name, &req.limits, cancel)?;
    let recheck_params = AnalyzeParams {
        profile,
        garment: req.garment,
        technique: req.technique,
        planned_width_mm: Some(geometry.width_mm),
        check_edges: false,
    };
    let report = recheck.analyze(&recheck_params).report;
    Ok(ExportOutcome {
        output: req.output.to_path_buf(),
        placement_json,
        width_px: geometry.canvas_w,
        height_px: geometry.canvas_h,
        dpi: EXPORT_DPI,
        color_profile: options.color_profile,
        sha256,
        geometry,
        source_report: analysis.report,
        report,
    })
}

/// Liest eine geschriebene Datei zurück (für Prüfungen in Tests und im CLI).
pub fn file_sha256(path: &Path) -> Result<String, PrintError> {
    let bytes = std::fs::read(path).map_err(|e| IoError::read(path, e))?;
    Ok(hex(&Sha256::digest(&bytes)))
}
