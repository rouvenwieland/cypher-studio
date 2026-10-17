//! `cypher install <programm>`: dieselbe Kette wie in der App (Plan, Zustimmung, Download, Prüfsumme, Entpacken,
//! atomare Registrierung), nur ohne Fenster. Ohne `--yes` wird der Plan gezeigt und nichts geladen.

use std::sync::Mutex;

use clap::{Args, ValueEnum};
use cypher_core::api::{
    DownloadsPatch, InstallConsent, InstallEvent, InstallPlan, InstallPreviewReq, InstallStartReq, Installation,
    ReleaseChannel, SettingsPatch,
};
use cypher_core::progress::ProgressSink;
use cypher_core::util::{human_bytes, now_iso};

use crate::app_cmd::{self, Global};
use crate::{CliError, CliResult};

#[derive(ValueEnum, Clone, Copy, Debug)]
pub enum ChannelArg {
    Stable,
    Lts,
    Preview,
}

#[derive(Args, Debug)]
pub struct InstallArgs {
    /// Kennung im Katalog, z. B. `blender`
    program: String,
    /// bestimmte Version statt der neuesten
    #[arg(long)]
    version: Option<String>,
    #[arg(long, value_enum)]
    channel: Option<ChannelArg>,
    /// Plan bestätigen (Quelle, Prüfsumme, Lizenz und Ziel stimmen) und installieren
    #[arg(long)]
    yes: bool,
    /// Die geladene Datei nach der Installation behalten (Probe: für den Negativtest mit veränderter Datei)
    #[arg(long)]
    keep_download: bool,
}

/// Der Plan in lesbarer Form, so wie ihn die App im Installationsdialog zeigt.
pub fn render_plan(plan: &InstallPlan) -> String {
    let signature = match &plan.artifact.signature {
        Some(sig) if sig.enforced => format!("{:?}, wird geprüft", sig.signature_type),
        Some(sig) => format!("{:?}, nur zur Information", sig.signature_type),
        None => "keine".to_owned(),
    };
    let mut out = format!(
        "{} {} ({:?})\n  Quelle:    {} ({})\n  Datei:     {} ({:?}, {})\n  SHA-256:   {} (Herkunft: {:?}, Prüfdatei: {})\n  Signatur:  {signature}\n  Lizenz:    {} ({})\n  Ziel:      {} (benötigt {}, frei {})\n",
        plan.program_name,
        plan.version,
        plan.channel,
        plan.source.host,
        plan.source.url,
        plan.artifact.file_name,
        plan.artifact.kind,
        human_bytes(plan.artifact.size),
        plan.artifact.sha256,
        plan.artifact.checksum_origin,
        plan.artifact.checksum_source,
        plan.license.name,
        plan.license.spdx,
        plan.target.dir,
        human_bytes(plan.target.required_bytes),
        human_bytes(plan.target.available_bytes),
    );
    for note in &plan.notes {
        out.push_str(&format!("  Hinweis:   {note:?}\n"));
    }
    out
}

/// Schreibt den Fortschritt auf die Fehlerausgabe: Phasen und den Download in Zehnerschritten.
struct Printer {
    last_percent: Mutex<u64>,
}

impl ProgressSink<InstallEvent> for Printer {
    fn emit(&self, event: InstallEvent) {
        match event {
            InstallEvent::Started { total_bytes, .. } => eprintln!("Start, Download {}", human_bytes(total_bytes)),
            InstallEvent::Phase { phase } => eprintln!("Schritt: {phase:?}"),
            InstallEvent::DownloadProgress { downloaded_bytes, total_bytes, .. } if total_bytes > 0 => {
                let percent = downloaded_bytes * 100 / total_bytes / 10 * 10;
                if let Ok(mut last) = self.last_percent.lock()
                    && percent > *last
                {
                    *last = percent;
                    eprintln!("  {percent} % ({} von {})", human_bytes(downloaded_bytes), human_bytes(total_bytes));
                }
            }
            InstallEvent::Resumed { from_byte } => eprintln!("  fortgesetzt ab Byte {from_byte}"),
            InstallEvent::Retrying { attempt, max_attempts, reason, .. } => {
                eprintln!("  Versuch {attempt} von {max_attempts} nach Fehler: {reason}");
            }
            InstallEvent::Verified { sha256, signature_checked } => {
                eprintln!(
                    "  Prüfsumme stimmt: {sha256}; Signatur geprüft: {}",
                    if signature_checked { "ja" } else { "nein" }
                );
            }
            _ => {}
        }
    }
}

fn render_result(installation: &Installation) -> String {
    format!(
        "Installiert: {} {} in {} (startbar: {})",
        installation.program_id,
        installation.version.as_deref().unwrap_or("?"),
        installation.location,
        if installation.launchable { "ja" } else { "nein" }
    )
}

pub async fn run(global: &Global, args: InstallArgs) -> CliResult {
    let app = app_cmd::build(global)?;
    app.rescan().await?;
    let channel = args.channel.map(|c| match c {
        ChannelArg::Stable => ReleaseChannel::Stable,
        ChannelArg::Lts => ReleaseChannel::Lts,
        ChannelArg::Preview => ReleaseChannel::Preview,
    });
    let plan = app.install_preview(&InstallPreviewReq { program_id: args.program, version: args.version, channel })?;
    print!("{}", render_plan(&plan));
    if !args.yes {
        return Err(CliError(
            "Nichts installiert. Stimmen Quelle, Prüfsumme, Lizenz und Ziel, mit --yes bestätigen.".into(),
        ));
    }
    let consent = InstallConsent {
        plan_id: plan.plan_id.clone(),
        sha256: plan.artifact.sha256.clone(),
        license_spdx: plan.license.spdx.clone(),
        target_dir: plan.target.dir.clone(),
        accepted_at: now_iso(),
    };
    if args.keep_download {
        app.settings_update(&SettingsPatch {
            downloads: Some(DownloadsPatch { keep_cache: Some(true), max_parallel: None }),
            ..SettingsPatch::default()
        })?;
    }
    let printer = Printer { last_percent: Mutex::new(0) };
    let installation = app.install_start(&InstallStartReq { plan_id: plan.plan_id, consent }, &printer).await?;
    println!("{}", render_result(&installation));
    Ok(())
}
