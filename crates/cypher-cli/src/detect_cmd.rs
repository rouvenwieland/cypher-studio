//! `cypher detect`: welche Programme gibt es, welche Installationen wurden gefunden (nur lesend).

use clap::Args;
use cypher_core::api::ProgramsView;

use crate::CliResult;
use crate::app_cmd::{self, Global};

#[derive(Args, Debug)]
pub struct DetectArgs {
    /// Ausgabe als JSON
    #[arg(long)]
    json: bool,
}

pub fn render(view: &ProgramsView) -> String {
    let mut out = String::new();
    for program in &view.programs {
        let latest = program.latest.as_ref().map_or("-".to_owned(), |l| {
            let hint = if l.available_for_this_platform { "" } else { " (nicht für dieses System)" };
            format!("{}{hint}", l.version)
        });
        out.push_str(&format!("{} ({}), neueste Version im Katalog: {latest}\n", program.name, program.id));
        if program.installations.is_empty() {
            out.push_str("    keine Installation gefunden\n");
        }
        for inst in &program.installations {
            let managed = if inst.managed_by_cypher { "von Cypher Studio installiert" } else { "vorhanden" };
            out.push_str(&format!(
                "    {} {} [{managed}, {:?}]  {}\n",
                inst.version.as_deref().unwrap_or("?"),
                if inst.launchable { "startbar" } else { "nicht startbar" },
                inst.kind,
                inst.location
            ));
        }
    }
    out
}

pub async fn run(global: &Global, args: DetectArgs) -> CliResult {
    let app = app_cmd::build(global)?;
    let view = app.rescan().await?;
    if args.json {
        println!("{}", serde_json::to_string_pretty(&view).map_err(|e| crate::CliError(e.to_string()))?);
    } else {
        print!("{}", render(&view));
    }
    Ok(())
}
