//! Erkennung mit Fixtures für alle drei Betriebssysteme (läuft auf jedem Entwicklungsrechner, weil Dateisystem,
//! Registry und Hilfsprogramme nachgestellt werden).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use cypher_core::api::{Arch, InstallKind, InstallationProblem, Os};
use cypher_core::catalog::{self, Catalog};
use cypher_core::detect::{DetectEnv, FsProbe, RegistryProbe, UninstallEntry, detect_all, probe_manual};
use cypher_core::error::DetectError;
use cypher_core::platform::{KnownDirs, PlatformInfo};
use cypher_core::process::{CommandOutput, FakeRunner};
use cypher_core::state::{StoredArtifact, StoredInstallation, StoredLauncher, StoredVerified};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    name: String,
    os: Os,
    arch: Arch,
    home: String,
    #[serde(default)]
    program_files: Vec<String>,
    #[serde(default)]
    local_app_data: Option<String>,
    #[serde(default)]
    path_dirs: Vec<String>,
    #[serde(default)]
    files: BTreeMap<String, String>,
    #[serde(default)]
    dirs: Vec<String>,
    #[serde(default)]
    registry: Vec<RegistryEntry>,
    #[serde(default)]
    commands: Vec<CommandFixture>,
    #[serde(default)]
    managed: Vec<String>,
    expect: Vec<Expected>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryEntry {
    display_name: String,
    #[serde(default)]
    display_version: Option<String>,
    #[serde(default)]
    install_location: Option<String>,
    #[serde(default)]
    display_icon: Option<String>,
}

#[derive(Deserialize)]
struct CommandFixture {
    r#match: String,
    #[serde(default)]
    stdout: String,
    #[serde(default)]
    stderr: String,
    #[serde(default)]
    code: Option<i32>,
    #[serde(default)]
    timeout: bool,
}

#[derive(Deserialize, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
struct Expected {
    program_id: String,
    kind: String,
    version: Option<String>,
    location: String,
    #[serde(default)]
    problems: Vec<String>,
}

struct FakeFs {
    files: BTreeMap<PathBuf, Vec<u8>>,
    dirs: BTreeSet<PathBuf>,
}

impl FakeFs {
    fn new(files: &BTreeMap<String, String>, dirs: &[String]) -> Self {
        let mut all_dirs: BTreeSet<PathBuf> = dirs.iter().map(PathBuf::from).collect();
        let mut map = BTreeMap::new();
        for (path, content) in files {
            let p = PathBuf::from(path);
            for ancestor in p.ancestors().skip(1) {
                all_dirs.insert(ancestor.to_path_buf());
            }
            map.insert(p, content.clone().into_bytes());
        }
        for d in dirs {
            for ancestor in Path::new(d).ancestors().skip(1) {
                all_dirs.insert(ancestor.to_path_buf());
            }
        }
        FakeFs { files: map, dirs: all_dirs }
    }
}

impl FsProbe for FakeFs {
    fn exists(&self, path: &Path) -> bool {
        self.files.contains_key(path) || self.dirs.contains(path)
    }

    fn is_dir(&self, path: &Path) -> bool {
        self.dirs.contains(path)
    }

    fn read(&self, path: &Path) -> Option<Vec<u8>> {
        self.files.get(path).cloned()
    }

    fn read_dir(&self, path: &Path) -> Vec<PathBuf> {
        let mut out: BTreeSet<PathBuf> = BTreeSet::new();
        for p in self.files.keys().chain(self.dirs.iter()) {
            if p.parent() == Some(path) {
                out.insert(p.clone());
            }
        }
        out.into_iter().collect()
    }
}

struct FakeRegistry(Vec<UninstallEntry>);

impl RegistryProbe for FakeRegistry {
    fn uninstall_entries(&self) -> Vec<UninstallEntry> {
        self.0.clone()
    }
}

fn catalog() -> Catalog {
    serde_json::from_slice(catalog::EMBEDDED_CATALOG_JSON).unwrap()
}

fn env_from(f: &Fixture) -> DetectEnv {
    let mut runner = FakeRunner::new();
    for c in &f.commands {
        runner = if c.timeout {
            runner.on(&c.r#match, Err(io::Error::new(io::ErrorKind::TimedOut, "Zeitlimit")))
        } else {
            runner.on(
                &c.r#match,
                Ok(CommandOutput {
                    code: Some(c.code.unwrap_or(0)),
                    stdout: c.stdout.clone().into_bytes(),
                    stderr: c.stderr.clone().into_bytes(),
                }),
            )
        };
    }
    DetectEnv {
        platform: PlatformInfo::fixed(f.os, f.arch),
        known: KnownDirs {
            home: Some(PathBuf::from(&f.home)),
            appdata: None,
            local_appdata: f.local_app_data.as_ref().map(PathBuf::from),
            program_files: f.program_files.iter().map(PathBuf::from).collect(),
            xdg_config_home: None,
            xdg_data_home: None,
        },
        fs: Arc::new(FakeFs::new(&f.files, &f.dirs)),
        cmd: Arc::new(runner),
        registry: Arc::new(FakeRegistry(
            f.registry
                .iter()
                .map(|r| UninstallEntry {
                    display_name: r.display_name.clone(),
                    display_version: r.display_version.clone(),
                    install_location: r.install_location.clone(),
                    display_icon: r.display_icon.clone(),
                })
                .collect(),
        )),
        path_dirs: f.path_dirs.iter().map(PathBuf::from).collect(),
    }
}

fn managed(paths: &[String]) -> Vec<StoredInstallation> {
    paths
        .iter()
        .map(|p| StoredInstallation {
            id: format!("cypher:x:{p}"),
            program_id: "x".into(),
            version: "1".into(),
            kind: "cypher".into(),
            path: p.clone(),
            launcher: StoredLauncher::Exe { rel_exe: "x".into() },
            programs_root: None,
            installed_at: String::new(),
            verified: StoredVerified { sha256: String::new(), catalog_sequence: 1, signature_checked: false },
            artifact: StoredArtifact { url: String::new(), kind: String::new() },
            not_notarized: false,
        })
        .collect()
}

fn kind_name(k: InstallKind) -> String {
    serde_json::to_value(k).unwrap().as_str().unwrap().to_owned()
}

fn problem_name(p: &InstallationProblem) -> String {
    serde_json::to_value(p).unwrap()["kind"].as_str().unwrap().to_owned()
}

#[test]
fn all_fixtures_produce_exactly_the_expected_installations() {
    let dir = cypher_core::util::repo_root().join("crates/cypher-core/tests/fixtures/detect");
    let cat = catalog();
    let mut count = 0;
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|e| e != "json") {
            continue;
        }
        let fixture: Fixture = serde_json::from_slice(&std::fs::read(&path).unwrap())
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let env = env_from(&fixture);
        let found = detect_all(&env, &cat, &managed(&fixture.managed));
        let mut actual: Vec<Expected> = found
            .iter()
            .map(|i| Expected {
                program_id: i.program_id.clone(),
                kind: kind_name(i.kind),
                version: i.version.clone(),
                // Die Fixtures schreiben `/`; auf Windows setzt `Path::join` ein `\` dazwischen
                location: i.location.replace('\\', "/"),
                problems: {
                    let mut p: Vec<String> = i.problems.iter().map(problem_name).collect();
                    p.sort();
                    p
                },
            })
            .collect();
        actual.sort();
        let mut expected: Vec<Expected> = fixture.expect;
        for e in &mut expected {
            e.problems.sort();
            e.location = e.location.replace('\\', "/");
        }
        expected.sort();
        assert_eq!(actual, expected, "Fixture `{}` ({})", fixture.name, path.file_name().unwrap().to_string_lossy());
        // Erkannte Installationen gehören nie Cypher
        assert!(found.iter().all(|i| !i.managed_by_cypher && i.installed_at.is_none() && i.verified.is_none()));
        count += 1;
    }
    assert!(count >= 6, "es müssen Fixtures für alle drei Betriebssysteme da sein ({count})");
}

#[test]
fn installation_ids_are_stable_and_distinct() {
    let dir = cypher_core::util::repo_root().join("crates/cypher-core/tests/fixtures/detect");
    let fixture: Fixture =
        serde_json::from_slice(&std::fs::read(dir.join("windows-registry-and-paths.json")).unwrap()).unwrap();
    let env = env_from(&fixture);
    let cat = catalog();
    let first = detect_all(&env, &cat, &[]);
    let second = detect_all(&env, &cat, &[]);
    let ids = |v: &[cypher_core::api::Installation]| v.iter().map(|i| i.id.clone()).collect::<Vec<_>>();
    assert_eq!(ids(&first), ids(&second), "gleiche Eingabe, gleiche IDs");
    let unique: BTreeSet<_> = ids(&first).into_iter().collect();
    assert_eq!(unique.len(), first.len());
    assert!(first.iter().all(|i| i.id.starts_with("system:")));
}

#[test]
fn manual_probe_accepts_known_files_and_rejects_others() {
    let cat = catalog();
    let krita = cat.program("krita").unwrap();

    // Windows
    let mut f = Fixture {
        name: String::new(),
        os: Os::Windows,
        arch: Arch::X86_64,
        home: "C:/Users/anna".into(),
        program_files: vec![],
        local_app_data: None,
        path_dirs: vec![],
        files: BTreeMap::from([
            ("D:/Tools/krita-5.3.4.1/bin/krita.exe".to_owned(), String::new()),
            ("D:/Tools/x/notepad.exe".to_owned(), String::new()),
        ]),
        dirs: vec![],
        registry: vec![],
        commands: vec![],
        managed: vec![],
        expect: vec![],
    };
    let env = env_from(&f);
    let i = probe_manual(&env, krita, Path::new("D:/Tools/krita-5.3.4.1/bin/krita.exe")).unwrap();
    assert_eq!(i.kind, InstallKind::Manual);
    assert!(i.id.starts_with("manual:krita:"));
    assert!(matches!(
        probe_manual(&env, krita, Path::new("D:/Tools/x/notepad.exe")),
        Err(DetectError::NotRecognized { .. })
    ));
    assert!(probe_manual(&env, krita, Path::new("D:/gibt/es/nicht/krita.exe")).is_err());

    // Linux (AppImage)
    f.os = Os::Linux;
    f.files = BTreeMap::from([
        ("/home/anna/Downloads/krita-5.3.4.1-x86_64.AppImage".to_owned(), String::new()),
        ("/home/anna/Downloads/readme.txt".to_owned(), String::new()),
    ]);
    let env = env_from(&f);
    let i = probe_manual(&env, krita, Path::new("/home/anna/Downloads/krita-5.3.4.1-x86_64.AppImage")).unwrap();
    assert_eq!(i.version.as_deref(), Some("5.3.4.1"));
    assert!(probe_manual(&env, krita, Path::new("/home/anna/Downloads/readme.txt")).is_err());

    // macOS (.app mit passender Bundle-ID)
    f.os = Os::Macos;
    f.files = BTreeMap::from([(
        "/Users/anna/Tools/krita.app/Contents/Info.plist".to_owned(),
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict><key>CFBundleIdentifier</key><string>org.krita</string><key>CFBundleShortVersionString</key><string>5.3.4</string></dict></plist>".to_owned(),
    )]);
    f.dirs = vec!["/Users/anna/Tools/krita.app".into()];
    let env = env_from(&f);
    let i = probe_manual(&env, krita, Path::new("/Users/anna/Tools/krita.app")).unwrap();
    assert_eq!(i.version.as_deref(), Some("5.3.4"));
}

#[test]
fn real_detection_runs_on_this_machine_without_changing_anything() {
    // Lesender Rundlauf auf dem echten System: darf nicht abstürzen, liefert nur erkannte (nie verwaltete) Installationen.
    let env = DetectEnv::real();
    let found = detect_all(&env, &catalog(), &[]);
    for i in &found {
        assert!(!i.managed_by_cypher);
        assert!(!i.location.is_empty());
    }
    eprintln!("{} Installation(en) auf diesem Rechner erkannt", found.len());
    for i in found {
        eprintln!("  {} {:?} {} {}", i.program_id, i.kind, i.version.unwrap_or_default(), i.location);
    }
}
