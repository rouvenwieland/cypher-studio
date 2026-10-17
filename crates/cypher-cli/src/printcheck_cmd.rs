//! `cypher printcheck <datei>`: der Druckprüfer ohne Fenster. Prüft ein Motiv gegen ein Druckprofil und schreibt auf Wunsch
//! die druckfertige PNG-Datei (mit erneuter Prüfung).

use std::path::PathBuf;

use clap::{Args, ValueEnum};
use cypher_core::api::{
    ExportColorProfile, ExportFixes, ExportMode, ParamValue, PrintAnalyzeReq, PrintDestination, PrintExportOptions,
    PrintExportReq, PrintReport, PrintTechnique, SemiTransparencyFix, Severity, Verdict,
};
use cypher_core::progress::NoProgress;
use std::sync::Arc;

use crate::app_cmd::{self, Global};
use crate::{CliError, CliResult};

#[derive(ValueEnum, Clone, Copy, Debug)]
pub enum TechniqueArg {
    Dtg,
    Dtf,
}

#[derive(ValueEnum, Clone, Copy, Debug)]
pub enum ModeArg {
    /// auf die sichtbare Fläche zuschneiden
    Trimmed,
    /// auf der ganzen Druckfläche belassen
    FullArea,
}

#[derive(ValueEnum, Clone, Copy, Debug)]
pub enum ColorArg {
    AdobeRgb,
    Srgb,
}

#[derive(ValueEnum, Clone, Copy, Debug)]
pub enum SemiArg {
    Keep,
    Threshold,
    Blend,
    Halftone,
}

#[derive(ValueEnum, Clone, Copy, Debug)]
pub enum FailOn {
    /// Rückgabewert 1 bei einem Fehlerbefund
    Error,
    /// Rückgabewert 1 schon bei einer Warnung
    Warning,
    /// immer 0, wenn die Prüfung selbst lief
    Never,
}

#[derive(Args, Debug)]
pub struct PrintcheckArgs {
    /// Motivdatei (PNG, JPEG, TIFF, WebP)
    file: PathBuf,
    /// Druckprofil aus dem Katalog
    #[arg(long, default_value = "shirtigo-tee-front")]
    profile: String,
    /// Textilfarbe (`schwarz`, `weiss`, …); bestimmt, ob eine Unterlage gedruckt wird
    #[arg(long)]
    garment: Option<String>,
    #[arg(long, value_enum)]
    technique: Option<TechniqueArg>,
    /// geplante Breite in Millimetern
    #[arg(long)]
    width_mm: Option<f64>,
    /// Bericht als JSON
    #[arg(long)]
    json: bool,
    #[arg(long, value_enum, default_value = "error")]
    fail_on: FailOn,
    /// Druckfertige PNG-Datei hierhin schreiben (".png" wird ergänzt)
    #[arg(long)]
    export: Option<PathBuf>,
    #[arg(long, value_enum, default_value = "trimmed")]
    mode: ModeArg,
    #[arg(long, value_enum, default_value = "adobe-rgb")]
    color: ColorArg,
    /// Umgang mit Halbtransparenz beim Export
    #[arg(long, value_enum, default_value = "keep")]
    semi: SemiArg,
    /// Beim Export keine Geisterpixel entfernen
    #[arg(long)]
    keep_ghost_pixels: bool,
    /// Beim Export kleiner als die Vorlage skalieren erlauben (Hochskalieren)
    #[arg(long)]
    allow_upscale: bool,
    /// Begleitdatei `.shirtigo.json` schreiben
    #[arg(long)]
    placement_json: bool,
}

fn param(value: &ParamValue) -> String {
    match value {
        ParamValue::Number(n) => format!("{n}"),
        ParamValue::Bool(b) => (if *b { "ja" } else { "nein" }).to_owned(),
        ParamValue::Text(t) => t.clone(),
    }
}

/// Der Bericht in lesbarer Form.
pub fn render_report(report: &PrintReport) -> String {
    let f = &report.file;
    let mut out = format!(
        "{}: {} x {} px, {} Bit, {:?}, {} Bytes\n  Auflösung:  {} x {} dpi (Quelle: {:?}), effektiv {:.0} dpi bei {:.0} mm\n  Farbe:      {:?}, ICC: {}\n  Alpha:      {} (durchsichtig {:.1} %, deckend {:.1} %, halbtransparent {:.2} % der sichtbaren Fläche, Geisterpixel {})\n  Profil:     {} / {:?}{}\n  Ergebnis:   {:?}\n",
        f.name,
        f.width_px,
        f.height_px,
        f.bit_depth,
        f.format,
        f.file_bytes,
        report.dpi.x,
        report.dpi.y,
        report.dpi.source,
        report.placement.effective_dpi,
        report.placement.planned_width_mm,
        report.color.profile,
        report.color.icc_description.as_deref().unwrap_or("-"),
        if report.alpha.present { "ja" } else { "nein" },
        report.alpha.transparent_share * 100.0,
        report.alpha.opaque_share * 100.0,
        report.alpha.semi_area_share_of_visible * 100.0,
        report.alpha.ghost_pixel_count,
        report.profile_id,
        report.technique,
        report.garment.as_ref().map_or(String::new(), |g| format!(
            ", Textil {}{}",
            g.color_id,
            if g.underbase { " (mit Unterlage)" } else { "" }
        )),
        report.verdict,
    );
    for finding in &report.findings {
        let params: Vec<String> = finding.params.iter().map(|(k, v)| format!("{k}={}", param(v))).collect();
        out.push_str(&format!("  - {:?} {:?}  {}\n", finding.severity, finding.rule_id, params.join(", ")));
    }
    out
}

fn technique(arg: Option<TechniqueArg>) -> Option<PrintTechnique> {
    arg.map(|t| match t {
        TechniqueArg::Dtg => PrintTechnique::Dtg,
        TechniqueArg::Dtf => PrintTechnique::Dtf,
    })
}

fn verdict_fails(verdict: Verdict, fail_on: FailOn) -> bool {
    match fail_on {
        FailOn::Never => false,
        FailOn::Error => verdict == Verdict::Error,
        FailOn::Warning => verdict != Verdict::Ok,
    }
}

pub async fn run(global: &Global, args: PrintcheckArgs) -> CliResult {
    let app = app_cmd::build(global)?;
    let handle = app
        .register_picked(std::slice::from_ref(&args.file))?
        .into_iter()
        .next()
        .ok_or_else(|| CliError(format!("{}: keine Datei", args.file.display())))?;
    let profile = app
        .print_profiles_list()
        .into_iter()
        .find(|p| p.id == args.profile)
        .ok_or_else(|| CliError(format!("Druckprofil `{}` unbekannt", args.profile)))?;
    let report = app
        .printcheck_analyze(&PrintAnalyzeReq {
            handle_id: handle.id.clone(),
            profile_id: args.profile.clone(),
            garment_color_id: args.garment.clone(),
            technique: technique(args.technique),
            planned_width_mm: args.width_mm,
        })
        .await?;
    let mut shown = report.clone();
    let mut export_summary = None;
    if let Some(out) = &args.export {
        let options = PrintExportOptions {
            mode: match args.mode {
                ModeArg::Trimmed => ExportMode::Trimmed,
                ModeArg::FullArea => ExportMode::FullArea,
            },
            planned_width_mm: args.width_mm.unwrap_or(profile.default_width_mm),
            offset_top_mm: 0.0,
            offset_center_mm: 0.0,
            allow_upscale: args.allow_upscale,
            color_profile: match args.color {
                ColorArg::AdobeRgb => ExportColorProfile::AdobeRgb,
                ColorArg::Srgb => ExportColorProfile::Srgb,
            },
            fixes: ExportFixes {
                clean_ghost_pixels: !args.keep_ghost_pixels,
                semi_transparency: match args.semi {
                    SemiArg::Keep => SemiTransparencyFix::Keep,
                    SemiArg::Threshold => SemiTransparencyFix::Threshold,
                    SemiArg::Blend => SemiTransparencyFix::BlendWithGarment,
                    SemiArg::Halftone => SemiTransparencyFix::Halftone,
                },
                near_black_to_pure_black: false,
            },
            write_placement_json: args.placement_json,
            destination: PrintDestination::Dialog,
        };
        let request = PrintExportReq {
            handle_id: handle.id,
            profile_id: args.profile,
            garment_color_id: args.garment,
            technique: technique(args.technique),
            options,
        };
        let result = app.printcheck_export(&request, Some(out), Arc::new(NoProgress)).await?;
        export_summary = Some(format!(
            "Geschrieben: {} ({} x {} px, {} dpi, {:?})",
            result.output.display_path, result.width_px, result.height_px, result.dpi, result.color_profile
        ));
        shown = result.report;
    }
    if args.json {
        println!("{}", serde_json::to_string_pretty(&shown).map_err(|e| CliError(e.to_string()))?);
    } else {
        print!("{}", render_report(&shown));
        if let Some(summary) = &export_summary {
            println!("{summary}");
            println!("  Erneute Prüfung der Ausgabe: {:?}", shown.verdict);
        }
    }
    let blocking = shown.findings.iter().filter(|f| f.severity == Severity::Error).count();
    if verdict_fails(shown.verdict, args.fail_on) {
        return Err(CliError(format!("Befund {:?} ({blocking} Fehler)", shown.verdict)));
    }
    Ok(())
}
