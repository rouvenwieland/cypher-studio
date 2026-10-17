//! Die Kommandozeile als Ganzes: das echte Programm gegen einen lokalen Server, mit eigenem Testschlüssel und eigenem Ordner.
//! Dieselben Wege nimmt die Linux-Probe (`scripts/probe-linux.sh`) gegen den echten Blender-Download.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use std::net::{SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::Arc;

use cypher_core::api::{Arch, ArtifactKind, LicenseInfo, ProgramCategory, ReleaseChannel};
use cypher_core::catalog::{
    ArtifactArch, ArtifactSpec, Catalog, ChecksumOrigin, DetectSpec, EMBEDDED_CATALOG_JSON, FileArgs, LaunchSpec,
    ProgramSpec, ReleaseSpec,
};
use sha2::{Digest, Sha256};

fn cypher() -> Command {
    Command::new(env!("CARGO_BIN_EXE_cypher"))
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn packs() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packs/dist")
}

/// Kleiner HTTP-Server (nur GET) in einem Thread: Pfad -> Antwortkörper.
fn serve(routes: HashMap<String, Vec<u8>>) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let routes = Arc::new(routes);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let routes = routes.clone();
            std::thread::spawn(move || {
                let mut stream = stream;
                let mut head = Vec::new();
                let mut byte = [0u8; 1];
                while !head.ends_with(b"\r\n\r\n") {
                    if stream.read(&mut byte).unwrap_or(0) == 0 {
                        return;
                    }
                    head.push(byte[0]);
                }
                let request = text(&head);
                let path = request.split_whitespace().nth(1).unwrap_or("/").to_owned();
                let (status, body) = match routes.get(&path) {
                    Some(body) => ("200 OK", body.clone()),
                    None => ("404 Not Found", Vec::new()),
                };
                let header = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(&body);
            });
        }
    });
    addr
}

fn demo_zip() -> Vec<u8> {
    let exe = if cfg!(windows) { "demo.exe" } else { "demo" };
    let mut buf = Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default().unix_permissions(0o755);
        zip.start_file(format!("demo-1.0.0/{exe}"), opts).unwrap();
        zip.write_all(b"#!/bin/sh\nexit 0\n").unwrap();
        zip.start_file("demo-1.0.0/readme.txt", opts).unwrap();
        zip.write_all(b"hallo").unwrap();
        zip.finish().unwrap();
    }
    buf.into_inner()
}

fn program(id: &str, url: String, archive: &[u8]) -> ProgramSpec {
    let platform = cypher_core::platform::current();
    let arch = match platform.arch {
        Arch::X86_64 => ArtifactArch::X86_64,
        Arch::Aarch64 => ArtifactArch::Aarch64,
    };
    ProgramSpec {
        id: id.into(),
        name: id.into(),
        vendor: "Test".into(),
        category: ProgramCategory::Other,
        description: "Testprogramm".into(),
        homepage: "https://example.org".into(),
        release_notes_url: None,
        license: LicenseInfo { spdx: "MIT".into(), name: "MIT".into(), url: "https://example.org/license".into() },
        detect: DetectSpec::default(),
        setup: None,
        releases: vec![ReleaseSpec {
            version: "1.0.0".into(),
            channel: ReleaseChannel::Stable,
            released_at: None,
            artifacts: vec![ArtifactSpec {
                os: platform.os,
                arch,
                kind: ArtifactKind::Zip,
                installer_type: None,
                url: url.clone(),
                file_name: "demo-1.0.0.zip".into(),
                size: archive.len() as u64,
                sha256: hex::encode(Sha256::digest(archive)),
                checksum_source: url.replace(".zip", ".sha256"),
                checksum_origin: ChecksumOrigin::Upstream,
                signature: None,
                strip_components: 1,
                unpacked_size_max: 10_000_000,
                mac_app_name: None,
                launch: LaunchSpec {
                    exe: if cfg!(windows) { "demo.exe" } else { "demo" }.into(),
                    exe_glob: None,
                    args: vec![],
                    file_args: FileArgs::Append,
                    portable_marker: None,
                },
            }],
        }],
    }
}

struct Env {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    keys: PathBuf,
}

impl Env {
    /// Eigener Ordner, Testschlüssel, signierter Katalog mit zwei Programmen: `demo` (echte Datei) und `demo-bad`
    /// (derselbe Katalogeintrag, aber der Server liefert eine veränderte Datei).
    fn new() -> Env {
        let good = demo_zip();
        let mut bad = good.clone();
        let middle = bad.len() / 2;
        bad[middle] ^= 0x55;
        let addr = serve(HashMap::from([("/good.zip".to_owned(), good.clone()), ("/bad.zip".to_owned(), bad)]));

        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let keys = tmp.path().join("keys");
        let made = cypher().args(["catalog", "keygen", "--out"]).arg(&keys).output().unwrap();
        assert!(made.status.success(), "{}", text(&made.stderr));

        let mut catalog: Catalog = serde_json::from_slice(EMBEDDED_CATALOG_JSON).unwrap();
        catalog.sequence += 1000;
        catalog.programs.push(program("demo", format!("http://{addr}/good.zip"), &good));
        catalog.programs.push(program("demo-bad", format!("http://{addr}/bad.zip"), &good));
        let file = root.join("data/catalog/catalog.json");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, serde_json::to_vec_pretty(&catalog).unwrap()).unwrap();
        let signed = cypher()
            .args(["catalog", "sign"])
            .arg(&file)
            .arg("--key")
            .arg(keys.join("catalog-dev.key"))
            .output()
            .unwrap();
        assert!(signed.status.success(), "{}", text(&signed.stderr));
        Env { _tmp: tmp, root, keys }
    }

    fn run(&self, args: &[&str]) -> Output {
        cypher()
            .arg("--data-dir")
            .arg(&self.root)
            .arg("--packs")
            .arg(packs())
            .arg("--trust-key")
            .arg(self.keys.join("catalog-dev.pub"))
            .arg("--allow-loopback-http")
            .args(args)
            .output()
            .unwrap()
    }
}

#[test]
fn the_embedded_catalog_verifies() {
    let out = cypher().args(["catalog", "verify"]).output().unwrap();
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert!(text(&out.stdout).starts_with("OK"));
}

#[test]
fn install_shows_the_plan_first_then_runs_the_whole_chain_and_refuses_tampered_files() {
    let env = Env::new();

    // ohne --yes: nur der Plan, nichts installiert
    let plan = env.run(&["install", "demo"]);
    assert!(!plan.status.success());
    let shown = text(&plan.stdout);
    assert!(
        shown.contains("SHA-256:") && shown.contains("MIT") && shown.contains("127.0.0.1"),
        "{shown}
{}",
        text(&plan.stderr)
    );
    assert!(text(&plan.stderr).contains("--yes"));
    assert!(!env.root.join("data/programs/demo").exists());

    // mit --yes: Download, Prüfsumme, Entpacken, Registrieren
    let done = env.run(&["install", "demo", "--yes"]);
    assert!(done.status.success(), "{}\n{}", text(&done.stdout), text(&done.stderr));
    assert!(text(&done.stdout).contains("Installiert: demo 1.0.0"), "{}", text(&done.stdout));
    assert!(text(&done.stderr).contains("Prüfsumme stimmt"), "{}", text(&done.stderr));
    let exe = if cfg!(windows) { "demo.exe" } else { "demo" };
    assert!(env.root.join("data/programs/demo/1.0.0").join(exe).is_file());

    // die Erkennung findet die Installation (als von Cypher Studio installiert)
    let detected = env.run(&["detect", "--json"]);
    assert!(detected.status.success());
    let view: serde_json::Value = serde_json::from_slice(&detected.stdout).unwrap();
    let demo = view["programs"].as_array().unwrap().iter().find(|p| p["id"] == "demo").unwrap();
    assert_eq!(demo["installations"][0]["managedByCypher"], true);
    assert_eq!(demo["installations"][0]["version"], "1.0.0");

    // veränderte Datei: Prüfsumme stimmt nicht, nichts bleibt zurück
    let bad = env.run(&["install", "demo-bad", "--yes"]);
    assert!(!bad.status.success());
    assert!(text(&bad.stderr).contains("checksumMismatch"), "{}", text(&bad.stderr));
    assert!(!env.root.join("data/programs/demo-bad").exists());
    let leftovers: Vec<_> = std::fs::read_dir(env.root.join("data/programs"))
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| !name.starts_with('.'))
        .collect();
    assert_eq!(leftovers, ["demo"], "keine Reste einer abgewiesenen Installation");
    let staging = env.root.join("data/programs/.staging");
    assert!(!staging.exists() || std::fs::read_dir(staging).unwrap().next().is_none(), "Zwischenordner ist leer");
}

#[test]
fn an_unknown_program_is_reported_not_guessed() {
    let env = Env::new();
    let out = env.run(&["install", "gibtsnicht", "--yes"]);
    assert!(!out.status.success());
    assert!(text(&out.stderr).contains("notFound"), "{}", text(&out.stderr));
}

fn write_png(path: &Path, w: u32, h: u32, semi: bool) {
    let mut image = image::RgbaImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let inside = x > w / 10 && x < w - w / 10 && y > h / 10 && y < h - h / 10;
            let alpha = if !inside {
                0
            } else if semi && x < w / 5 {
                128
            } else {
                255
            };
            image.put_pixel(x, y, image::Rgba([30, 80, 200, alpha]));
        }
    }
    image.save(path).unwrap();
}

#[test]
fn printcheck_reports_findings_exports_and_rechecks() {
    let env = Env::new();
    let dir = env.root.join("motive");
    std::fs::create_dir_all(&dir).unwrap();
    let motif = dir.join("klein.png");
    write_png(&motif, 40, 40, false);

    // viel zu klein: Fehlerbefund, Rückgabewert 1 (mit --fail-on never: 0)
    let small = env.run(&["printcheck", motif.to_str().unwrap()]);
    assert!(!small.status.success());
    assert!(text(&small.stdout).contains("Ergebnis:   Error"), "{}", text(&small.stdout));
    let lenient = env.run(&["printcheck", motif.to_str().unwrap(), "--fail-on", "never"]);
    assert!(lenient.status.success());

    // gut aufgelöst mit Halbtransparenz: Befund; mit --semi threshold im Export behoben
    let big = dir.join("gross.png");
    write_png(&big, 1800, 1800, true);
    let json = env.run(&["printcheck", big.to_str().unwrap(), "--json", "--fail-on", "never", "--garment", "schwarz"]);
    assert!(json.status.success(), "{}", text(&json.stderr));
    let report: serde_json::Value = serde_json::from_slice(&json.stdout).unwrap();
    assert!(
        report["findings"].as_array().unwrap().iter().any(|f| f["ruleId"]
            .as_str()
            .unwrap()
            .to_lowercase()
            .contains("semi")),
        "{:?}",
        report["findings"]
    );

    let out = dir.join("druck");
    let exported = env.run(&[
        "printcheck",
        big.to_str().unwrap(),
        "--garment",
        "schwarz",
        "--width-mm",
        "150",
        "--allow-upscale",
        "--semi",
        "threshold",
        "--placement-json",
        "--export",
        out.to_str().unwrap(),
    ]);
    assert!(exported.status.success(), "{}\n{}", text(&exported.stdout), text(&exported.stderr));
    // Das Motiv ist ein ausgefülltes Rechteck: nach dem Zuschnitt bleibt die Warnung „deckender Rand“, aber kein Fehler,
    // und die Halbtransparenz ist behoben
    let shown = text(&exported.stdout);
    assert!(shown.contains("Erneute Prüfung der Ausgabe: Warning"), "{shown}");
    assert!(!shown.to_lowercase().contains("semi"), "{shown}");
    let png = dir.join("druck.png");
    assert!(png.is_file());
    let decoder = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(&png).unwrap()));
    let reader = decoder.read_info().unwrap();
    let dims = reader.info().pixel_dims.unwrap();
    assert_eq!((dims.xppu, dims.yppu), (11811, 11811), "300 dpi");
    assert!(dir.join("druck.shirtigo.json").is_file());
}

#[test]
fn setup_lists_the_packs_and_refuses_when_no_program_is_installed() {
    let env = Env::new();
    let list = env.run(&["setup", "list"]);
    assert!(list.status.success(), "{}", text(&list.stderr));
    let shown = text(&list.stdout);
    for pack in ["krita", "inkscape", "blender", "kdenlive", "fonts"] {
        assert!(shown.contains(&format!("({pack})")), "{pack} fehlt:\n{shown}");
    }
    let apply = env.run(&["setup", "apply", "krita", "--yes"]);
    assert!(!apply.status.success());
    assert!(text(&apply.stderr).contains("kein Programm gefunden"), "{}", text(&apply.stderr));
    let unknown = env.run(&["setup", "apply", "gibtsnicht", "--yes"]);
    assert!(text(&unknown.stderr).contains("unbekannt"));
}

/// Schriften-Paket im eigenen Ordner: anwenden, zurücknehmen. Nur Linux, damit auf einem Entwicklungsrechner nie echte
/// Schriften angemeldet werden (Windows: Registrierung).
#[cfg(target_os = "linux")]
#[test]
fn setup_apply_and_undo_work_in_the_isolated_home() {
    let env = Env::new();
    let preview = env.run(&["setup", "apply", "fonts"]);
    assert!(!preview.status.success());
    assert!(text(&preview.stderr).contains("--yes"), "{}", text(&preview.stderr));

    let applied = env.run(&["setup", "apply", "fonts", "--yes"]);
    assert!(applied.status.success(), "{}\n{}", text(&applied.stdout), text(&applied.stderr));
    let shown = text(&applied.stdout);
    let id = shown.split("cypher setup undo ").nth(1).unwrap().trim().to_owned();
    let fonts = env.root.join("home/.local/share/fonts");
    assert!(fonts.is_dir() && walk_count(&fonts) > 10, "Schriften liegen im eigenen Heimatordner");

    let listed = env.run(&["setup", "list"]);
    assert!(text(&listed.stdout).contains("Applied"), "{}", text(&listed.stdout));

    let undone = env.run(&["setup", "undo", &id]);
    assert!(undone.status.success(), "{}", text(&undone.stderr));
    assert_eq!(walk_count(&fonts), 0, "nach dem Zurücknehmen liegt nichts mehr da");
}

#[cfg(target_os = "linux")]
fn walk_count(dir: &Path) -> usize {
    std::fs::read_dir(dir)
        .map(|rd| rd.filter_map(Result::ok).map(|e| if e.path().is_dir() { walk_count(&e.path()) } else { 1 }).sum())
        .unwrap_or(0)
}
