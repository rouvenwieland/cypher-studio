//! Installation gegen den lokalen Test-Server: Plan, Zustimmung, Download, Entpacken, atomare Registrierung,
//! Fehler- und Abbruchpfade, Wiederherstellung, Entfernen.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::io::{Cursor, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use common::*;
use cypher_core::api::{
    Arch, ArtifactKind, InstallConsent, InstallEvent, InstallNote, InstallPhase, LicenseInfo, Os, ProgramCategory,
    ReleaseChannel,
};
use cypher_core::catalog::{
    ArtifactArch, ArtifactSpec, Catalog, ChecksumOrigin, DetectSpec, FileArgs, LaunchSpec, ProgramSpec, ReleaseSpec,
};
use cypher_core::download::{HostPolicy, HostRule, HttpClient, NetLog, RedirectPolicy};
use cypher_core::error::{ArchiveError, DownloadError, InstallError, VerifyError};
use cypher_core::install::{self, InstallCtx, InstallPlanData, PlanInput};
use cypher_core::platform::{AppDirs, PlatformInfo};
use cypher_core::process::FakeRunner;
use cypher_core::progress::Collect;
use cypher_core::settings;
use cypher_core::state::StateStore;
use tokio_util::sync::CancellationToken;

fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut buf = Cursor::new(Vec::new());
    {
        let mut w = zip::ZipWriter::new(&mut buf);
        for (name, data) in entries {
            let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            w.start_file(*name, opts).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap();
    }
    buf.into_inner()
}

struct Env {
    _tmp: tempfile::TempDir,
    dirs: AppDirs,
    settings: cypher_core::api::Settings,
    state: StateStore,
    http: HttpClient,
    platform: PlatformInfo,
    server: TestServer,
}

impl Env {
    async fn new(archive: Vec<u8>) -> Env {
        let server = TestServer::start(Behavior::new(archive)).await;
        let tmp = tempfile::tempdir().unwrap();
        let dirs = AppDirs::for_test(tmp.path());
        let mut settings = settings::defaults(&dirs);
        settings.programs_dir = tmp.path().join("programs").to_string_lossy().into_owned();
        let state = StateStore::load(&dirs).unwrap();
        let http = HttpClient::new(
            "test",
            Arc::new(HostPolicy::for_test(&[HostRule {
                host: "127.0.0.1",
                redirects: RedirectPolicy::WithinAllowlist,
            }])),
            Arc::new(NetLog::new(None)),
        )
        .unwrap();
        Env { _tmp: tmp, dirs, settings, state, http, platform: PlatformInfo::fixed(Os::Windows, Arch::X86_64), server }
    }

    fn catalog(&self) -> Catalog {
        let data = self.server.behavior.data.clone();
        let artifact = ArtifactSpec {
            os: Os::Windows,
            arch: ArtifactArch::X86_64,
            kind: ArtifactKind::Zip,
            installer_type: None,
            url: self.server.url("/file").to_string(),
            file_name: "demo-1.0.0.zip".into(),
            size: data.len() as u64,
            sha256: hex::encode(sha256(&data)),
            checksum_source: self.server.url("/small").to_string(),
            checksum_origin: ChecksumOrigin::Upstream,
            signature: None,
            strip_components: 1,
            unpacked_size_max: 10_000_000,
            mac_app_name: None,
            launch: LaunchSpec {
                exe: "demo.exe".into(),
                exe_glob: None,
                args: vec![],
                file_args: FileArgs::Append,
                portable_marker: Some("portable".into()),
            },
        };
        Catalog {
            schema_version: 1,
            sequence: 3,
            generated_at: "2026-10-16T00:00:00Z".into(),
            expires_at: "2027-10-16T00:00:00Z".into(),
            min_app_version: "0.1.0".into(),
            programs: vec![ProgramSpec {
                id: "demo".into(),
                name: "Demo".into(),
                vendor: "Test".into(),
                category: ProgramCategory::Other,
                description: "Testprogramm".into(),
                homepage: "https://example.org".into(),
                release_notes_url: None,
                license: LicenseInfo {
                    spdx: "MIT".into(),
                    name: "MIT".into(),
                    url: "https://example.org/license".into(),
                },
                detect: DetectSpec::default(),
                setup: None,
                releases: vec![ReleaseSpec {
                    version: "1.0.0".into(),
                    channel: ReleaseChannel::Stable,
                    released_at: None,
                    artifacts: vec![artifact],
                }],
            }],
            links: vec![],
            print_profiles: vec![],
            models: vec![],
        }
    }

    fn plan(&self) -> Result<InstallPlanData, InstallError> {
        let catalog = self.catalog();
        let hosts = self.http.policy().clone();
        let input = PlanInput {
            catalog: &catalog,
            catalog_sequence: 3,
            catalog_expired: false,
            platform: &self.platform,
            dirs: &self.dirs,
            settings: &self.settings,
            hosts: &hosts,
            known: &[],
            fuse_available: true,
        };
        install::plan(&input, "demo", None, None)
    }

    fn consent(plan: &InstallPlanData) -> InstallConsent {
        InstallConsent {
            plan_id: plan.dto.plan_id.clone(),
            sha256: plan.dto.artifact.sha256.clone(),
            license_spdx: plan.dto.license.spdx.clone(),
            target_dir: plan.dto.target.dir.clone(),
            accepted_at: "2026-10-20T10:00:00Z".into(),
        }
    }

    async fn install(
        &self,
        plan: InstallPlanData,
        sink: &Collect<InstallEvent>,
        cancel: &CancellationToken,
    ) -> Result<cypher_core::api::Installation, InstallError> {
        let consent = Self::consent(&plan);
        let ctx = InstallCtx {
            dirs: &self.dirs,
            http: &self.http,
            state: &self.state,
            platform: &self.platform,
            settings: &self.settings,
            runner: Arc::new(FakeRunner::new()),
            job_id: "job-1",
        };
        install::execute(&ctx, plan, &consent, sink, cancel).await
    }

    fn programs_dir(&self) -> PathBuf {
        PathBuf::from(&self.settings.programs_dir)
    }
}

/// Nicht komprimierbare Bytes (einfacher Zufallsgenerator), damit das Archiv wirklich groß bleibt.
fn noise(len: usize) -> Vec<u8> {
    let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
    (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            (x >> 24) as u8
        })
        .collect()
}

fn good_zip() -> Vec<u8> {
    zip_bytes(&[
        ("demo-1.0.0/demo.exe", b"MZ-demo"),
        ("demo-1.0.0/data/readme.txt", b"hallo"),
        ("demo-1.0.0/lib/x.dll", &vec![7u8; 50_000]),
    ])
}

// ---------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn plan_shows_source_size_license_target_and_notes() {
    let env = Env::new(good_zip()).await;
    let plan = env.plan().unwrap();
    let dto = &plan.dto;
    assert_eq!(dto.program_name, "Demo");
    assert_eq!(dto.version, "1.0.0");
    assert_eq!(dto.source.host, "127.0.0.1");
    assert!(!dto.source.mirror_redirects);
    assert_eq!(dto.artifact.size, good_zip().len() as u64);
    assert_eq!(dto.artifact.sha256, hex::encode(sha256(&good_zip())));
    assert_eq!(dto.license.spdx, "MIT");
    assert!(dto.target.dir.ends_with("demo/1.0.0") || dto.target.dir.ends_with("demo\\1.0.0"), "{}", dto.target.dir);
    assert!(dto.target.portable && !dto.target.needs_admin);
    assert!(dto.notes.contains(&InstallNote::WindowsSmartScreenNotExpected));
    assert!(dto.target.available_bytes > 0);
    assert!(dto.expires_at > dto.created_at);
    // Plan macht keine Netzwerkzugriffe
    assert!(env.server.behavior.recorded().is_empty());
    assert!(!env.programs_dir().join("demo").exists(), "ein Plan legt nichts an");
}

#[tokio::test]
async fn plan_rejects_unlisted_hosts_and_missing_disk_space() {
    let env = Env::new(good_zip()).await;
    let mut catalog = env.catalog();
    catalog.programs[0].releases[0].artifacts[0].url = "https://evil.example/demo.zip".into();
    let hosts = env.http.policy().clone();
    let input = PlanInput {
        catalog: &catalog,
        catalog_sequence: 1,
        catalog_expired: true,
        platform: &env.platform,
        dirs: &env.dirs,
        settings: &env.settings,
        hosts: &hosts,
        known: &[],
        fuse_available: true,
    };
    assert!(matches!(
        install::plan(&input, "demo", None, None),
        Err(InstallError::Download(DownloadError::HostNotAllowed(_)))
    ));
    assert!(matches!(install::plan(&input, "gibt-es-nicht", None, None), Err(InstallError::NotFound(_))));

    let mut catalog = env.catalog();
    catalog.programs[0].releases[0].artifacts[0].unpacked_size_max = u64::MAX / 4;
    let input = PlanInput {
        catalog: &catalog,
        catalog_sequence: 1,
        catalog_expired: false,
        platform: &env.platform,
        dirs: &env.dirs,
        settings: &env.settings,
        hosts: &hosts,
        known: &[],
        fuse_available: true,
    };
    assert!(matches!(install::plan(&input, "demo", None, None), Err(InstallError::DiskFull { .. })));
}

// ---------------------------------------------------------------------------------------------
// Ausführung
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn full_install_registers_atomically_and_cleans_up() {
    let env = Env::new(good_zip()).await;
    let plan = env.plan().unwrap();
    let sink = Collect::new();
    let installation = env.install(plan, &sink, &CancellationToken::new()).await.unwrap();

    // Ergebnis
    assert_eq!(installation.id, "cypher:demo:1.0.0");
    assert!(installation.managed_by_cypher && installation.launchable);
    assert_eq!(installation.version.as_deref(), Some("1.0.0"));
    assert!(installation.verified.as_ref().is_some_and(|v| v.catalog_sequence == 3 && !v.signature_checked));
    let target = env.programs_dir().join("demo").join("1.0.0");
    assert_eq!(std::fs::read(target.join("demo.exe")).unwrap(), b"MZ-demo");
    assert!(target.join("data/readme.txt").is_file());
    assert!(target.join("portable").is_dir(), "portableMarker wurde angelegt");

    // Zustand
    let state = env.state.snapshot();
    assert_eq!(state.installations.len(), 1);
    assert_eq!(state.preferred.get("demo").map(String::as_str), Some("cypher:demo:1.0.0"));
    assert_eq!(state.installations[0].path, target.to_string_lossy());
    assert!(state.installations[0].programs_root.is_some());

    // Aufräumen: kein Staging, kein Journal, Download-Cache leer (keepCache = false)
    let staging = env.programs_dir().join(install::STAGING_DIR);
    assert!(std::fs::read_dir(&staging).map(|d| d.count() == 0).unwrap_or(true), "Staging muss leer sein");
    let cached: Vec<_> = std::fs::read_dir(env.dirs.downloads()).unwrap().collect();
    assert!(cached.is_empty(), "Download-Cache muss leer sein: {cached:?}");

    // Ereignisse in der dokumentierten Reihenfolge (ARCHITEKTUR.md 3.4)
    let events = sink.take();
    let phases: Vec<InstallPhase> =
        events.iter().filter_map(|e| if let InstallEvent::Phase { phase } = e { Some(*phase) } else { None }).collect();
    assert_eq!(
        phases,
        [
            InstallPhase::Download,
            InstallPhase::VerifyChecksum,
            InstallPhase::Extract,
            InstallPhase::CheckContent,
            InstallPhase::Register
        ]
    );
    assert!(matches!(events.first(), Some(InstallEvent::Started { job_id, .. }) if job_id == "job-1"));
    assert!(
        matches!(events.last(), Some(InstallEvent::Finished { installation }) if installation.id == "cypher:demo:1.0.0")
    );
    let pos = |pred: &dyn Fn(&InstallEvent) -> bool| events.iter().position(pred).unwrap();
    assert!(
        pos(&|e| matches!(e, InstallEvent::DownloadProgress { .. }))
            < pos(&|e| matches!(e, InstallEvent::Verified { .. }))
    );
    assert!(
        pos(&|e| matches!(e, InstallEvent::Verified { .. }))
            < pos(&|e| matches!(e, InstallEvent::ExtractProgress { .. }))
    );
}

#[tokio::test]
async fn consent_must_repeat_exactly_what_was_shown() {
    let env = Env::new(good_zip()).await;
    let plan = env.plan().unwrap();
    let ctx = InstallCtx {
        dirs: &env.dirs,
        http: &env.http,
        state: &env.state,
        platform: &env.platform,
        settings: &env.settings,
        runner: Arc::new(FakeRunner::new()),
        job_id: "j",
    };
    let good = Env::consent(&plan);
    let tampered: Vec<(&str, InstallConsent)> = vec![
        ("planId", InstallConsent { plan_id: "anderer".into(), ..good.clone() }),
        ("sha256", InstallConsent { sha256: "0".repeat(64), ..good.clone() }),
        ("licenseSpdx", InstallConsent { license_spdx: "GPL-3.0-only".into(), ..good.clone() }),
        ("targetDir", InstallConsent { target_dir: "~/woanders".into(), ..good.clone() }),
    ];
    for (field, consent) in tampered {
        let err = install::execute(&ctx, plan.clone(), &consent, &Collect::new(), &CancellationToken::new())
            .await
            .unwrap_err();
        assert!(matches!(err, InstallError::ConsentMismatch(_)), "{field}: {err}");
    }
    assert!(env.server.behavior.recorded().is_empty(), "ohne gültige Zustimmung wird nichts geladen");
    assert!(env.state.snapshot().installations.is_empty());
}

#[tokio::test]
async fn manipulated_download_installs_nothing_and_leaves_no_traces() {
    let good = good_zip();
    let env = Env::new(good.clone()).await;
    let plan = env.plan().unwrap();
    // Der Server liefert andere Daten gleicher Länge
    let mut bad = good;
    let n = bad.len();
    bad[n / 2] ^= 0xFF;
    // neuer Server mit den manipulierten Daten, Plan des alten (die Prüfsumme gehört zu `good`)
    let evil = TestServer::start(Behavior::new(bad)).await;
    let mut plan = plan;
    plan.artifact.url = evil.url("/file").to_string();
    let sink = Collect::new();
    let err = env.install(plan, &sink, &CancellationToken::new()).await.unwrap_err();
    assert!(
        matches!(err, InstallError::Download(DownloadError::Checksum(VerifyError::ChecksumMismatch { .. }))),
        "{err}"
    );
    assert!(!env.programs_dir().join("demo").exists());
    assert!(env.state.snapshot().installations.is_empty());
    let leftovers: Vec<_> = std::fs::read_dir(env.dirs.downloads()).map(|d| d.flatten().collect()).unwrap_or_default();
    assert!(leftovers.is_empty(), ".part und Metadaten müssen gelöscht sein: {leftovers:?}");
    let events = sink.take();
    assert!(!events.iter().any(|e| matches!(e, InstallEvent::Verified { .. } | InstallEvent::Finished { .. })));
}

#[tokio::test]
async fn unsafe_archive_entries_abort_and_clean_staging() {
    let env = Env::new(zip_bytes(&[("demo-1.0.0/demo.exe", b"MZ"), ("demo-1.0.0/../../evil.txt", b"boese")])).await;
    let plan = env.plan().unwrap();
    let err = env.install(plan, &Collect::new(), &CancellationToken::new()).await.unwrap_err();
    assert!(matches!(err, InstallError::Archive(ArchiveError::UnsafeEntry { .. })), "{err}");
    assert!(!env.programs_dir().join("demo").exists());
    assert!(!env.programs_dir().join("evil.txt").exists() && !env._tmp.path().join("evil.txt").exists());
    let staging = env.programs_dir().join(install::STAGING_DIR);
    assert!(std::fs::read_dir(&staging).map(|d| d.count() == 0).unwrap_or(true));
    assert!(env.state.snapshot().installations.is_empty());
}

#[tokio::test]
async fn missing_launch_file_fails_the_content_check() {
    let env = Env::new(zip_bytes(&[("demo-1.0.0/andere.exe", b"MZ")])).await;
    let plan = env.plan().unwrap();
    let err = env.install(plan, &Collect::new(), &CancellationToken::new()).await.unwrap_err();
    assert!(matches!(&err, InstallError::VerificationFailed(m) if m.contains("demo.exe")), "{err}");
    assert!(!env.programs_dir().join("demo").exists());
    assert!(env.state.snapshot().installations.is_empty());
}

#[tokio::test]
async fn cancelling_the_download_keeps_the_part_and_installs_nothing() {
    let big = zip_bytes(&[("demo-1.0.0/demo.exe", &noise(400_000))]);
    let env = Env::new(big).await;
    *env.server.behavior.trickle.lock().unwrap() = Some((8_000, Duration::from_millis(25)));
    let plan = env.plan().unwrap();
    let cancel = CancellationToken::new();
    let c2 = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(250)).await;
        c2.cancel();
    });
    let err = env.install(plan.clone(), &Collect::new(), &cancel).await.unwrap_err();
    assert!(matches!(err, InstallError::Download(DownloadError::Cancelled)), "{err}");
    let parts: Vec<_> = std::fs::read_dir(env.dirs.downloads())
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(parts.iter().any(|n| n.ends_with(".part")), "Fortsetzen muss möglich bleiben: {parts:?}");
    assert!(!env.programs_dir().join("demo").exists());

    // Der Plan zeigt jetzt „Fortsetzen möglich“
    let again = env.plan().unwrap();
    assert!(
        again.dto.notes.iter().any(|n| matches!(n, InstallNote::ResumeAvailable { bytes_done } if *bytes_done > 0))
    );

    // Erneut starten (ohne Tröpfeln) setzt fort und gelingt
    *env.server.behavior.trickle.lock().unwrap() = None;
    let sink = Collect::new();
    env.install(again, &sink, &CancellationToken::new()).await.unwrap();
    assert!(sink.take().iter().any(|e| matches!(e, InstallEvent::Resumed { .. })));
    assert!(env.programs_dir().join("demo/1.0.0/demo.exe").is_file());
}

#[tokio::test]
async fn reinstalling_replaces_the_old_version_without_leftovers() {
    let env = Env::new(good_zip()).await;
    env.install(env.plan().unwrap(), &Collect::new(), &CancellationToken::new()).await.unwrap();
    let target = env.programs_dir().join("demo/1.0.0");
    std::fs::write(target.join("von-nutzer.txt"), b"alt").unwrap();

    let ctx = InstallCtx {
        dirs: &env.dirs,
        http: &env.http,
        state: &env.state,
        platform: &env.platform,
        settings: &env.settings,
        runner: Arc::new(FakeRunner::new()),
        job_id: "job-2",
    };
    let plan = env.plan().unwrap();
    let consent = Env::consent(&plan);
    install::execute(&ctx, plan, &consent, &Collect::new(), &CancellationToken::new()).await.unwrap();
    assert!(target.join("demo.exe").is_file());
    assert!(!target.join("von-nutzer.txt").exists(), "die neue Installation ersetzt den Ordner");
    let siblings: Vec<_> = std::fs::read_dir(target.parent().unwrap())
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(siblings, ["1.0.0"], ".old-… darf nicht übrig bleiben");
    assert_eq!(env.state.snapshot().installations.len(), 1);
}

#[tokio::test]
async fn keep_cache_setting_keeps_the_verified_download_and_reuses_it() {
    let mut env = Env::new(good_zip()).await;
    env.settings.downloads.keep_cache = true;
    env.install(env.plan().unwrap(), &Collect::new(), &CancellationToken::new()).await.unwrap();
    let cached: Vec<String> = std::fs::read_dir(env.dirs.downloads())
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(cached.len(), 1, "{cached:?}");
    assert!(cached[0].ends_with(".zip"));
    let before = env.server.behavior.recorded().len();
    // Zweiter Lauf lädt nichts neu
    std::fs::remove_dir_all(env.programs_dir().join("demo")).unwrap();
    let plan = env.plan().unwrap();
    let ctx = InstallCtx {
        dirs: &env.dirs,
        http: &env.http,
        state: &env.state,
        platform: &env.platform,
        settings: &env.settings,
        runner: Arc::new(FakeRunner::new()),
        job_id: "job-3",
    };
    let consent = Env::consent(&plan);
    install::execute(&ctx, plan, &consent, &Collect::new(), &CancellationToken::new()).await.unwrap();
    assert_eq!(env.server.behavior.recorded().len(), before);
}

// ---------------------------------------------------------------------------------------------
// Wiederherstellung und Entfernen
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn recovery_completes_or_rolls_back_interrupted_installs() {
    let env = Env::new(good_zip()).await;
    env.install(env.plan().unwrap(), &Collect::new(), &CancellationToken::new()).await.unwrap();
    let programs = env.programs_dir();
    let stored = env.state.snapshot().installations[0].clone();
    let target = PathBuf::from(&stored.path);

    // Fall A: Absturz nach dem Umbenennen, aber vor dem Schreiben des Zustands → Zustand wird nachgetragen
    env.state.update(|s| s.installations.clear()).unwrap();
    let old_dir = target.with_file_name("1.0.0.old-1");
    std::fs::create_dir_all(&old_dir).unwrap();
    let journal = serde_json::json!({
        "state": "renamed",
        "stagingDir": programs.join(".staging/jobA").to_string_lossy(),
        "targetDir": target.to_string_lossy(),
        "oldDir": old_dir.to_string_lossy(),
        "installation": stored,
    });
    std::fs::create_dir_all(programs.join(".staging")).unwrap();
    std::fs::write(programs.join(".staging/jobA.journal.json"), journal.to_string()).unwrap();
    let report = install::recover_on_startup(&programs, &env.state).unwrap();
    assert_eq!(report.registered, 1);
    assert_eq!(env.state.snapshot().installations.len(), 1);
    assert!(!old_dir.exists(), "alte Version wird nach dem Nachtragen gelöscht");

    // Fall B: Absturz beim Entpacken, Ziel wurde schon beiseite gestellt → alte Version kommt zurück
    let moved = target.with_file_name("1.0.0.old-2");
    std::fs::rename(&target, &moved).unwrap();
    let staging = programs.join(".staging/jobB");
    std::fs::create_dir_all(&staging).unwrap();
    std::fs::write(staging.join("halb.bin"), b"x").unwrap();
    let journal = serde_json::json!({
        "state": "extracting",
        "stagingDir": staging.to_string_lossy(),
        "targetDir": target.to_string_lossy(),
        "oldDir": moved.to_string_lossy(),
        "installation": env.state.snapshot().installations[0],
    });
    std::fs::write(programs.join(".staging/jobB.journal.json"), journal.to_string()).unwrap();
    let report = install::recover_on_startup(&programs, &env.state).unwrap();
    assert_eq!(report.restored_old, 1);
    assert_eq!(report.removed_staging, 1);
    assert!(target.join("demo.exe").is_file());
    assert!(!staging.exists() && !moved.exists());
    assert!(std::fs::read_dir(programs.join(".staging")).unwrap().next().is_none());
}

#[tokio::test]
async fn removing_managed_installations_stays_inside_the_programs_folder() {
    let env = Env::new(good_zip()).await;
    env.install(env.plan().unwrap(), &Collect::new(), &CancellationToken::new()).await.unwrap();
    let target = env.programs_dir().join("demo/1.0.0");
    assert!(matches!(install::remove_managed(&env.state, "cypher:unbekannt:1"), Err(InstallError::NotFound(_))));

    // Manipulierter Zustand: Pfad außerhalb des Programmordners → wird nicht gelöscht
    let outside = env._tmp.path().join("meine-dateien");
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("wichtig.txt"), b"!").unwrap();
    env.state.update(|s| s.installations[0].path = outside.to_string_lossy().into_owned()).unwrap();
    assert!(install::remove_managed(&env.state, "cypher:demo:1.0.0").is_err());
    assert!(outside.join("wichtig.txt").exists());
    assert_eq!(env.state.snapshot().installations.len(), 1);

    // Ordentlicher Fall
    env.state.update(|s| s.installations[0].path = target.to_string_lossy().into_owned()).unwrap();
    install::remove_managed(&env.state, "cypher:demo:1.0.0").unwrap();
    assert!(!target.exists());
    assert!(!env.programs_dir().join("demo").exists(), "leerer Programmordner wird mit entfernt");
    let state = env.state.snapshot();
    assert!(state.installations.is_empty() && state.preferred.is_empty());
}
