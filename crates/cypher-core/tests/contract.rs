//! Vertragsprüfung: `docs/ipc-contract.ts` (kanonisch) gegen die von ts-rs erzeugten Typen,
//! Namenslisten und Beispieldateien (`docs/contract-fixtures`).
//!
//! Die TypeScript-Prüfung läuft mit dem `tsc` aus `apps/desktop/node_modules` (Node im PATH). Fehlt beides,
//! meldet der Test das laut und überspringt nur die tsc-Teile – außer die Umgebungsvariable
//! `CYPHER_REQUIRE_TSC=1` ist gesetzt (CI), dann schlägt er fehl.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use cypher_core::api::names::{COMMAND_NAMES, EVENT_NAMES, IPC_CONTRACT_VERSION, RAW_COMMAND_NAMES};
use cypher_core::api::{EXPORT_IMAGE_MAX_BYTES, EXPORT_IMAGE_META_HEADER, SocialFormat};

fn root() -> PathBuf {
    cypher_core::util::repo_root().canonicalize().unwrap()
}

fn contract_text() -> String {
    fs::read_to_string(root().join("docs/ipc-contract.ts")).unwrap()
}

fn generated_dir() -> PathBuf {
    root().join("apps/desktop/src/ipc/generated")
}

/// Namen, die im Vertrag stehen, aber keine DTOs sind (Hilfstypen der Command-Tabelle).
const NOT_DTOS: &[&str] = &[
    "IpcChannel",
    "Commands",
    "RawCommands",
    "CommandName",
    "RawCommandName",
    "CommandArgs",
    "CommandResult",
    "TypedInvoke",
    "EventMap",
    "EventName",
    "AppErrorKind",
    // Rust-Alias auf [Point; 4]: ts-rs faltet ihn an der Verwendung ein
    "Quad",
];

/// Alle benannten Typen des Vertrags, die als DTO erzeugt werden müssen.
fn contract_dto_names(text: &str) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    for line in text.lines() {
        let Some(rest) = line.strip_prefix("export ") else { continue };
        let (kind, rest) = if let Some(r) = rest.strip_prefix("interface ") {
            ("interface", r)
        } else if let Some(r) = rest.strip_prefix("type ") {
            ("type", r)
        } else {
            continue;
        };
        let name: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
        if name.is_empty() || NOT_DTOS.contains(&name.as_str()) {
            continue;
        }
        // Aliase auf String (`export type PlanId = string;`) sind in Rust `type`-Aliase und erzeugen keine Datei.
        if kind == "type" && line.contains("= string;") {
            continue;
        }
        names.insert(name);
    }
    names
}

fn array_const(text: &str, name: &str) -> Vec<String> {
    let start = text.find(&format!("export const {name} = [")).unwrap_or_else(|| panic!("{name} fehlt im Vertrag"));
    let rest = &text[start..];
    let end = rest.find("] as const").unwrap();
    rest[..end].split('"').skip(1).step_by(2).map(str::to_owned).collect()
}

#[test]
fn version_and_name_lists_match_the_contract() {
    let text = contract_text();
    assert!(text.contains(&format!("IPC_CONTRACT_VERSION = \"{IPC_CONTRACT_VERSION}\"")), "Vertragsversion weicht ab");
    let commands: Vec<String> = array_const(&text, "COMMAND_NAMES");
    assert_eq!(commands, COMMAND_NAMES.iter().map(|s| s.to_string()).collect::<Vec<_>>(), "COMMAND_NAMES weichen ab");
    assert_eq!(array_const(&text, "RAW_COMMAND_NAMES"), RAW_COMMAND_NAMES.to_vec());
    assert_eq!(array_const(&text, "EVENT_NAMES"), EVENT_NAMES.to_vec());
}

#[test]
fn constants_match_the_contract() {
    let text = contract_text();
    assert!(text.contains("EXPORT_IMAGE_MAX_BYTES = 64 * 1024 * 1024"));
    assert_eq!(EXPORT_IMAGE_MAX_BYTES, 64 * 1024 * 1024);
    assert!(text.contains(&format!("meta: \"{EXPORT_IMAGE_META_HEADER}\"")));
    for (key, format) in [
        ("post", SocialFormat::Post),
        ("postTall", SocialFormat::PostTall),
        ("story", SocialFormat::Story),
        ("reelCover", SocialFormat::ReelCover),
    ] {
        let size = format.size();
        let expected = format!("{key}: {{ width: {}, height: {} }}", size.width, size.height);
        assert!(text.contains(&expected), "SOCIAL_FORMAT_SIZES.{key} weicht ab: erwartet `{expected}`");
    }
}

/// Schreibt `generated/index.ts` (Sammelexport für `contract-check.ts` des Frontends) und liefert die Typnamen.
fn write_generated_index() -> BTreeSet<String> {
    let dir = generated_dir();
    let mut names = BTreeSet::new();
    for entry in fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "ts") {
            let stem = path.file_stem().unwrap().to_string_lossy().into_owned();
            if stem != "index" {
                names.insert(stem);
            }
        }
    }
    let mut index = String::from(
        "// Sammelexport der von ts-rs erzeugten Typen. Erzeugt von crates/cypher-core/tests/contract.rs, nicht von Hand ändern.\n",
    );
    for n in &names {
        index.push_str(&format!("export type {{ {n} }} from \"./{n}\";\n"));
    }
    if fs::read_to_string(dir.join("index.ts")).ok().as_deref() != Some(index.as_str()) {
        fs::write(dir.join("index.ts"), index).unwrap();
    }
    names
}

#[test]
fn generated_types_cover_the_contract() {
    let text = contract_text();
    let wanted = contract_dto_names(&text);
    let generated = write_generated_index();
    let missing: Vec<_> = wanted.difference(&generated).collect();
    assert!(missing.is_empty(), "im Vertrag benannte Typen ohne Rust-Gegenstück: {missing:?}");
    let extra: Vec<_> = generated.difference(&wanted).collect();
    assert!(
        extra.is_empty(),
        "erzeugte Typen, die der Vertrag nicht kennt (Rust-Typ inline machen oder Vertrag ergänzen): {extra:?}"
    );
}

fn find_tsc() -> Option<(String, PathBuf)> {
    let tsc = root().join("apps/desktop/node_modules/typescript/bin/tsc");
    if !tsc.exists() {
        return None;
    }
    let node = std::env::var("CYPHER_NODE").unwrap_or_else(|_| "node".to_owned());
    Command::new(&node).arg("--version").output().ok().filter(|o| o.status.success())?;
    Some((node, tsc))
}

/// Führt `tsc` über eine erzeugte Prüfdatei aus; liefert die Ausgabe bei Fehlern.
fn run_tsc(label: &str, check_ts: &str) -> Result<(), String> {
    let Some((node, tsc)) = find_tsc() else {
        let msg = "node oder apps/desktop/node_modules/typescript fehlt – TypeScript-Prüfung übersprungen";
        assert!(std::env::var("CYPHER_REQUIRE_TSC").is_err(), "{msg}, CYPHER_REQUIRE_TSC ist aber gesetzt");
        eprintln!("WARNUNG ({label}): {msg}");
        return Ok(());
    };
    let tmp = std::env::temp_dir().join(format!("cypher-contract-{label}-{}", std::process::id()));
    fs::create_dir_all(&tmp).unwrap();
    let contract = root().join("docs/ipc-contract.ts");
    let generated = generated_dir().join("index.ts");
    let tsconfig = serde_json::json!({
        "compilerOptions": {
            "strict": true,
            "exactOptionalPropertyTypes": true,
            "noEmit": true,
            "skipLibCheck": true,
            "target": "ES2022",
            "module": "ESNext",
            "moduleResolution": "bundler",
            "paths": {
                "@contract": [contract.to_string_lossy()],
                "@generated": [generated.to_string_lossy()]
            },
            "types": []
        },
        "files": ["check.ts"]
    });
    fs::write(tmp.join("tsconfig.json"), serde_json::to_string_pretty(&tsconfig).unwrap()).unwrap();
    fs::write(tmp.join("check.ts"), check_ts).unwrap();
    let out = Command::new(node).arg(tsc).arg("-p").arg(tmp.join("tsconfig.json")).output().unwrap();
    let _ = fs::remove_dir_all(&tmp);
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
    }
}

#[test]
fn rust_and_contract_types_are_mutually_assignable() {
    let text = contract_text();
    let names = contract_dto_names(&text);
    write_generated_index();
    let mut ts = String::from(
        "import type * as C from \"@contract\";\nimport type * as G from \"@generated\";\n\
         type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;\n\
         type Assert<T extends true> = T;\n",
    );
    for n in &names {
        ts.push_str(&format!("export type _{n} = Assert<Mutual<C.{n}, G.{n}>>;\n"));
    }
    if let Err(out) = run_tsc("types", &ts) {
        panic!("Rust-Typen und docs/ipc-contract.ts weichen ab:\n{out}");
    }
}

/// Selbsttest der Prüfung: ein absichtlich abweichender Typ muss auffallen.
#[test]
fn the_check_detects_deviations() {
    if find_tsc().is_none() {
        eprintln!("WARNUNG: tsc nicht verfügbar, Selbsttest übersprungen");
        return;
    }
    write_generated_index();
    let ts = "import type * as C from \"@contract\";\nimport type * as G from \"@generated\";\n\
              type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;\n\
              type Assert<T extends true> = T;\n\
              // Absichtlich falsch: Settings gegen LibraryStatus\n\
              export type _Bad = Assert<Mutual<C.Settings, G.LibraryStatus>>;\n";
    let err = run_tsc("selftest", ts).expect_err("eine echte Abweichung wurde nicht erkannt");
    assert!(
        err.contains("_Bad") || err.contains("does not satisfy"),
        "unerwarteter tsc-Fehler (Konfiguration kaputt?):
{err}"
    );
}

#[test]
fn fixtures_round_trip_and_match_the_contract() {
    let dir = root().join("docs/contract-fixtures");
    let mut ts = String::from("import type * as C from \"@contract\";\n");
    let mut count = 0;
    if dir.exists() {
        for type_dir in fs::read_dir(&dir).unwrap() {
            let type_dir = type_dir.unwrap().path();
            if !type_dir.is_dir() {
                continue;
            }
            let type_name = type_dir.file_name().unwrap().to_string_lossy().into_owned();
            for file in fs::read_dir(&type_dir).unwrap() {
                let path = file.unwrap().path();
                if path.extension().is_none_or(|e| e != "json") {
                    continue;
                }
                let raw = fs::read_to_string(&path).unwrap();
                round_trip(&type_name, &raw).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
                count += 1;
                ts.push_str(&format!(
                    "export const _f{count}: C.{type_name} = ({}) satisfies C.{type_name};\n",
                    raw.trim()
                ));
            }
        }
    }
    eprintln!("{count} Beispieldateien geprüft");
    if let Err(out) = run_tsc("fixtures", &ts) {
        panic!("Beispieldateien passen nicht zum Vertrag:\n{out}");
    }
}

/// Zahlen gleichen Werts sind gleich (`120` und `120.0`), alles andere strikt.
fn normalize(v: serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match v {
        Value::Number(n) => match n.as_f64() {
            Some(f) if f.fract() == 0.0 && f.abs() < 9.0e15 => Value::from(f as i64),
            _ => Value::Number(n),
        },
        Value::Array(a) => Value::Array(a.into_iter().map(normalize).collect()),
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, normalize(v))).collect()),
        other => other,
    }
}

macro_rules! fixture_types {
    ($name:expr, $raw:expr, [$($ty:ident),* $(,)?]) => {{
        match $name {
            $(stringify!($ty) => {
                let value: cypher_core::api::$ty = serde_json::from_str($raw).map_err(|e| format!("{e}"))?;
                let back = serde_json::to_value(&value).map_err(|e| format!("{e}"))?;
                let orig: serde_json::Value = serde_json::from_str($raw).map_err(|e| format!("{e}"))?;
                if normalize(back.clone()) != normalize(orig.clone()) {
                    return Err(format!("nicht verlustfrei:\nerwartet {orig}\nerhalten {back}"));
                }
                Ok(())
            })*
            other => Err(format!("unbekannter Typ `{other}` – in fixture_types! eintragen")),
        }
    }};
}

fn round_trip(type_name: &str, raw: &str) -> Result<(), String> {
    fixture_types!(
        type_name,
        raw,
        [
            AppError,
            AppInfo,
            Settings,
            SettingsPatch,
            NetworkInfo,
            CatalogStatus,
            CatalogRefreshResult,
            ProgramsView,
            ProgramOverview,
            Installation,
            InstallPlan,
            InstallEvent,
            InstallStartReq,
            InstallPreviewReq,
            LaunchResult,
            SetupSummary,
            SetupPlan,
            SetupRecord,
            SetupEvent,
            UndoReport,
            FileHandleInfo,
            SampleInfo,
            TemplateInfo,
            Project,
            ProjectFile,
            ProjectOpenResult,
            ProjectDocument,
            LibraryStatus,
            LibraryRootCandidate,
            LibraryEntry,
            LibraryPage,
            LibraryQuery,
            ScanEvent,
            PackPreview,
            PackImportReport,
            PrintProfile,
            PrintReport,
            PrintExportOptions,
            PrintExportResult,
            PrintExportEvent,
            Brand,
            MockupTemplate,
            SocialTemplate,
            UpdateCheck,
            UpdateEvent,
            JobInfo,
            JobRecord,
            BgRemoveStatus,
            ExternalTarget,
            RevealTarget,
        ]
    )
}
