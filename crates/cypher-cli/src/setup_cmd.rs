//! `cypher setup list | apply <paket> | undo <id>`: Einrichtungspakete wie in der App (Vorschau, Anwenden, Zurücknehmen).

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use clap::{Args, Subcommand};
use cypher_core::api::{
    ConflictResolution, SetupApplyReq, SetupEvent, SetupPlan, SetupPreviewReq, SetupSummary, SetupUndoReq,
};
use cypher_core::progress::ProgressSink;

use crate::app_cmd::{self, Global};
use crate::{CliError, CliResult};

#[derive(Subcommand, Debug)]
pub enum SetupCommand {
    /// Pakete und ihren Stand je Installation zeigen
    List,
    /// Ein Paket auf eine Installation anwenden
    Apply(ApplyArgs),
    /// Eine Einrichtung zurücknehmen (Sicherungen zurückspielen, eigene Änderungen bleiben)
    Undo {
        /// Kennung aus der Ausgabe von `apply`
        setup_id: String,
    },
}

#[derive(Args, Debug)]
pub struct ApplyArgs {
    /// Kennung des Pakets, z. B. `krita`
    pack: String,
    /// Bereich (Installation); nötig, wenn es mehrere gibt
    #[arg(long)]
    scope: Option<String>,
    /// Nur diese Bausteine (Kennungen aus der Vorschau); Vorgabe: alle vorgewählten
    #[arg(long = "component")]
    components: Vec<String>,
    /// Bei Konflikten (veränderte oder fremde Dateien) überschreiben statt überspringen
    #[arg(long)]
    overwrite: bool,
    /// Vorschau bestätigen und anwenden
    #[arg(long)]
    yes: bool,
}

pub fn render_summaries(packs: &[SetupSummary]) -> String {
    let mut out = String::new();
    for pack in packs {
        out.push_str(&format!("{} ({}) Version {}\n", pack.title, pack.pack_id, pack.pack_version));
        if pack.scopes.is_empty() {
            out.push_str("    kein passender Bereich (Programm nicht gefunden)\n");
        }
        for scope in &pack.scopes {
            out.push_str(&format!(
                "    Bereich {}  Stand {:?}  Wurzeln: {}\n",
                scope.scope_id,
                scope.status,
                scope.target_roots.join(", ")
            ));
        }
    }
    out
}

pub fn render_plan(plan: &SetupPlan) -> String {
    let mut out = format!("{} Version {} im Bereich {}\n", plan.pack_label, plan.pack_version, plan.scope_id);
    for component in &plan.components {
        out.push_str(&format!(
            "  [{}] {} ({:?}, {} Schritte){}\n",
            if component.default_selected { "x" } else { " " },
            component.id,
            component.status,
            component.operations.len(),
            if component.optional { ", optional" } else { "" }
        ));
    }
    for conflict in &plan.conflicts {
        out.push_str(&format!("  Konflikt: {} ({:?})\n", conflict.target, conflict.reason));
    }
    if plan.program_running {
        out.push_str("  Hinweis: Das Programm läuft; nach dem Anwenden neu starten.\n");
    }
    out
}

struct Printer {
    last: Mutex<u32>,
}

impl ProgressSink<SetupEvent> for Printer {
    fn emit(&self, event: SetupEvent) {
        match event {
            SetupEvent::Started { total, .. } => eprintln!("Einrichten: {total} Schritte"),
            SetupEvent::Step { index, total, component_id, .. } => {
                if let Ok(mut last) = self.last.lock()
                    && (index == total || index >= *last + total.div_ceil(10).max(1))
                {
                    *last = index;
                    eprintln!("  Schritt {index} von {total} ({component_id})");
                }
            }
            SetupEvent::Finished { .. } => {}
        }
    }
}

pub async fn run(global: &Global, command: SetupCommand) -> CliResult {
    let app = app_cmd::build(global)?;
    app.rescan().await?;
    match command {
        SetupCommand::List => {
            print!("{}", render_summaries(&app.setup_packs_list()));
            Ok(())
        }
        SetupCommand::Undo { setup_id } => {
            let report = app.setup_undo(&SetupUndoReq { setup_id }).await?;
            println!(
                "Zurückgenommen: {} wiederhergestellt, {} entfernt, {} Schriften entfernt",
                report.restored, report.removed, report.fonts_removed
            );
            for path in &report.kept_modified {
                println!("  Geändert und deshalb behalten: {path}");
            }
            Ok(())
        }
        SetupCommand::Apply(args) => apply(&app, args).await,
    }
}

async fn apply(app: &Arc<cypher_core::app::App>, args: ApplyArgs) -> CliResult {
    let summary = app
        .setup_packs_list()
        .into_iter()
        .find(|p| p.pack_id == args.pack)
        .ok_or_else(|| CliError(format!("Paket `{}` unbekannt", args.pack)))?;
    let scope = match (&args.scope, summary.scopes.as_slice()) {
        (Some(id), scopes) => scopes.iter().find(|s| &s.scope_id == id),
        (None, [only]) => Some(only),
        (None, []) => return Err(CliError("Für dieses Paket wurde kein Programm gefunden".into())),
        (None, many) => {
            let ids: Vec<&str> = many.iter().map(|s| s.scope_id.as_str()).collect();
            return Err(CliError(format!("Mehrere Bereiche, bitte --scope angeben: {}", ids.join(", "))));
        }
    }
    .ok_or_else(|| CliError("Bereich unbekannt".into()))?;
    let plan = app.setup_preview(&SetupPreviewReq { pack_id: args.pack, scope_id: scope.scope_id.clone() })?;
    print!("{}", render_plan(&plan));
    if !args.yes {
        return Err(CliError("Nichts verändert. Stimmt die Vorschau, mit --yes anwenden.".into()));
    }
    let resolutions: BTreeMap<String, ConflictResolution> = plan
        .conflicts
        .iter()
        .map(|c| {
            let how = if args.overwrite { ConflictResolution::Overwrite } else { ConflictResolution::Skip };
            (c.conflict_id.clone(), how)
        })
        .collect();
    let printer: Arc<dyn ProgressSink<SetupEvent>> = Arc::new(Printer { last: Mutex::new(0) });
    let record = app
        .setup_apply(&SetupApplyReq { plan_id: plan.plan_id, components: args.components, resolutions }, printer)
        .await?;
    println!(
        "Eingerichtet ({:?}): {} Dateien geschrieben, {} gesichert; zum Zurücknehmen: cypher setup undo {}",
        record.status, record.files_written, record.backups_taken, record.setup_id
    );
    for failure in &record.failures {
        println!("  Nicht geschrieben: {} ({})", failure.target, failure.error);
    }
    Ok(())
}
