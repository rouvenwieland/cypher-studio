//! Die Anwendungsschicht im Zusammenspiel: Programme, Installation gegen den lokalen Test-Server, Einrichtung mit den echten
//! Paketen, Projekte, Bibliothek, Druckprüfer, Dateien, Diagnose. Alles in Temp-Ordnern, ohne Internet.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
// Einige Abläufe (AppImage, Schriften im Linux-Profil) laufen nur unter Unix; auf Windows bleiben deren Hilfen ungenutzt
#![cfg_attr(windows, allow(unused_imports, dead_code))]

mod common;

use std::io::{Cursor, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use common::*;
use cypher_core::api::{
    AddManualReq, Arch, ArtifactKind, BuildChannel, DirSetting, ExportDestination, ExportImageFormat, ExportImageMeta,
    HandleSource, InstallConsent, InstallEvent, InstallKind, InstallPreviewReq, InstallStartReq, InstallationRemoveReq,
    JobKind, JobOutcome, LibraryGetReq, LibraryQuery, LibraryUseRootReq, LicenseInfo, Os, PrintAnalyzeReq,
    PrintDestination, PrintExportEvent, PrintExportOptions, PrintExportReq, PrintOverlayReq, ProgramCategory,
    ProjectCreateReq, ProjectFileReq, ProjectFolder, ProjectNewFileReq, ProjectOpenOutcome, ProjectRef,
    ProjectWriteDocumentReq, ReleaseChannel, RemoveMode, ScanEvent, SettingsPatch, SetupApplyReq, SetupEvent,
    SetupHistoryReq, SetupPreviewReq, SetupStatus,
};
use cypher_core::app::{App, AppConfig, AppEvent};
use cypher_core::catalog::{
    ArtifactArch, ArtifactSpec, Catalog, ChecksumOrigin, DetectSpec, EMBEDDED_CATALOG_JSON, EMBEDDED_KEYS, FileArgs,
    LaunchSpec, ProgramSpec, ReleaseSpec,
};
use cypher_core::detect::{DetectEnv, NoRegistry, RealFs};
use cypher_core::download::{EMBEDDED_HOSTS, HostPolicy, HostRule, RedirectPolicy};
use cypher_core::error::CoreError;
use cypher_core::platform::{AppDirs, KnownDirs, PlatformInfo};
use cypher_core::process::FakeRunner;
use cypher_core::progress::{Collect, ProgressSink};
use cypher_core::setup::RootsEnv;
use cypher_core::setup::fonts::RecordingFonts;
use cypher_core::verify::TrustedKeys;

/// Die Betriebssystem-Seite der Prüfstände: auf Windows läuft derselbe Test mit Windows-Artefakt und `.exe`.
const TEST_OS: Os = if cfg!(windows) { Os::Windows } else { Os::Linux };
const EXE: &str = if cfg!(windows) { "demo.exe" } else { "demo" };

fn zip_bytes(entries: &[(&str, &[u8], u32)]) -> Vec<u8> {
    let mut buf = Cursor::new(Vec::new());
    {
        let mut w = zip::ZipWriter::new(&mut buf);
        for (name, data, mode) in entries {
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated)
                .unix_permissions(*mode);
            w.start_file(*name, opts).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap();
    }
    buf.into_inner()
}

fn packs_root() -> Option<PathBuf> {
    let p = cypher_core::util::repo_root().join("packs/dist");
    p.join("manifest.json").is_file().then_some(p)
}

fn png(w: u32, h: u32, rgba: [u8; 4]) -> Vec<u8> {
    let mut out = Vec::new();
    image::RgbaImage::from_pixel(w, h, image::Rgba(rgba))
        .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .unwrap();
    out
}

struct Fx {
    tmp: tempfile::TempDir,
    app: Arc<App>,
    events: Arc<Mutex<Vec<AppEvent>>>,
    server: TestServer,
    runner: Arc<FakeRunner>,
    fonts: Arc<RecordingFonts>,
}

impl Fx {
    async fn new() -> Fx {
        let packs = packs_root().expect("packs/dist fehlt");
        let archive = zip_bytes(&[
            (&format!("demo-1.0.0/{EXE}"), b"#!/bin/sh\nexit 0\n", 0o755),
            ("demo-1.0.0/data/readme.txt", b"hallo", 0o644),
        ]);
        let server = TestServer::start(Behavior::new(archive.clone())).await;
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let dirs = AppDirs::with_root(&root, tmp.path().join("res"));
        std::fs::create_dir_all(&dirs.home).unwrap();
        std::fs::create_dir_all(&dirs.documents).unwrap();

        // Katalog: der eingebettete plus ein Testprogramm, mit einem Testschlüssel signiert und höher nummeriert
        let mut catalog: Catalog = serde_json::from_slice(EMBEDDED_CATALOG_JSON).unwrap();
        catalog.sequence += 1000;
        catalog.programs.push(ProgramSpec {
            id: "demo".into(),
            name: "Demo".into(),
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
                    os: TEST_OS,
                    arch: ArtifactArch::X86_64,
                    kind: ArtifactKind::Zip,
                    installer_type: None,
                    url: server.url("/file").to_string(),
                    file_name: "demo-1.0.0.zip".into(),
                    size: archive.len() as u64,
                    sha256: hex::encode(sha256(&archive)),
                    checksum_source: server.url("/small").to_string(),
                    checksum_origin: ChecksumOrigin::Upstream,
                    signature: None,
                    strip_components: 1,
                    unpacked_size_max: 10_000_000,
                    mac_app_name: None,
                    launch: LaunchSpec {
                        exe: EXE.into(),
                        exe_glob: None,
                        args: vec![],
                        file_args: FileArgs::Append,
                        portable_marker: None,
                    },
                }],
            }],
        });
        let json = serde_json::to_vec_pretty(&catalog).unwrap();
        let pair = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
        let sig = minisign::sign(Some(&pair.pk), &pair.sk, Cursor::new(&json), Some("seq"), None).unwrap().to_string();
        std::fs::create_dir_all(dirs.catalog_cache()).unwrap();
        std::fs::write(dirs.catalog_cache().join("catalog.json"), &json).unwrap();
        std::fs::write(dirs.catalog_cache().join("catalog.json.minisig"), sig).unwrap();
        let mut key_texts: Vec<String> = EMBEDDED_KEYS.iter().map(|k| (*k).to_owned()).collect();
        key_texts.push(pair.pk.to_box().unwrap().to_string());
        let key_refs: Vec<&str> = key_texts.iter().map(String::as_str).collect();

        let mut rules: Vec<HostRule> = EMBEDDED_HOSTS.to_vec();
        rules.push(HostRule { host: "127.0.0.1", redirects: RedirectPolicy::WithinAllowlist });
        let platform = PlatformInfo::fixed(TEST_OS, Arch::X86_64);
        let known = KnownDirs { home: Some(dirs.home.clone()), ..KnownDirs::default() };
        let runner = Arc::new(FakeRunner::new().ok("--version", "Krita 5.3.4.1\n"));
        let fonts = Arc::new(RecordingFonts::default());
        let detect_env = DetectEnv {
            platform: platform.clone(),
            known: known.clone(),
            fs: Arc::new(RealFs),
            cmd: runner.clone(),
            registry: Arc::new(NoRegistry),
            path_dirs: vec![],
        };
        let config = AppConfig {
            roots_env: RootsEnv { os: TEST_OS, known, data_dir: dirs.data.clone(), inkscape_profile_dir: None },
            dirs,
            app_version: "0.3.0".into(),
            build_channel: BuildChannel::Dev,
            platform,
            hosts: Arc::new(HostPolicy::for_test(&rules)),
            detect_env: Arc::new(detect_env),
            runner: runner.clone(),
            fonts: fonts.clone(),
            keys: TrustedKeys::from_strs(&key_refs).unwrap(),
            packs_root: packs,
        };
        let events: Arc<Mutex<Vec<AppEvent>>> = Arc::default();
        let sink = events.clone();
        let app = App::new(config, Arc::new(move |e| sink.lock().unwrap().push(e))).unwrap();
        Fx { tmp, app, events, server, runner, fonts }
    }

    fn event_names(&self) -> Vec<&'static str> {
        self.events.lock().unwrap().iter().map(AppEvent::name).collect()
    }

    fn has_event(&self, name: &str) -> bool {
        self.event_names().contains(&name)
    }

    fn write(&self, rel: &str, bytes: &[u8]) -> PathBuf {
        let p = self.tmp.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, bytes).unwrap();
        p
    }
}

fn sink<E: Send + 'static>() -> (Arc<Collect<E>>, Arc<dyn ProgressSink<E>>) {
    let c = Arc::new(Collect::new());
    let s: Arc<dyn ProgressSink<E>> = c.clone();
    (c, s)
}

/// Anfrage aus dem Vertrags-JSON bauen: so wird zugleich die Drahtform geprüft.
fn req<T: serde::de::DeserializeOwned>(v: serde_json::Value) -> T {
    serde_json::from_value(v).unwrap()
}

fn query() -> LibraryQuery {
    req(serde_json::json!({}))
}

// ---------------------------------------------------------------------------------------------
// App-Start, Programme, Installation
// ---------------------------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn startup_detects_and_programs_view_combines_catalog_and_installations() {
    let fx = Fx::new().await;
    fx.app.startup().await.unwrap();
    assert!(fx.has_event("programs:changed"));
    let view = fx.app.programs_view();
    for id in ["blender", "krita", "inkscape", "kdenlive", "demo"] {
        assert!(view.programs.iter().any(|p| p.id == id), "{id} fehlt");
    }
    let demo = view.programs.iter().find(|p| p.id == "demo").unwrap();
    assert_eq!(demo.latest.as_ref().unwrap().version, "1.0.0");
    assert!(demo.supported_on_this_platform && demo.installations.is_empty() && !demo.update_available);
    let blender = view.programs.iter().find(|p| p.id == "blender").unwrap();
    assert!(blender.latest.as_ref().is_some_and(|l| l.available_for_this_platform), "Linux x86_64 hat Blender");
    assert_eq!(
        view.catalog.sequence,
        serde_json::from_slice::<Catalog>(EMBEDDED_CATALOG_JSON).unwrap().sequence + 1000
    );
    assert_eq!(fx.app.app_info().contract_version, cypher_core::api::names::IPC_CONTRACT_VERSION);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn install_round_trip_against_the_local_server_into_the_test_folder() {
    let fx = Fx::new().await;
    let programs_dir = fx.tmp.path().join("programs");
    std::fs::create_dir_all(&programs_dir).unwrap();
    fx.app.settings_set_dir(DirSetting::ProgramsDir, &programs_dir).unwrap();

    let plan =
        fx.app.install_preview(&InstallPreviewReq { program_id: "demo".into(), version: None, channel: None }).unwrap();
    assert_eq!(plan.version, "1.0.0");
    assert!(plan.target.dir.contains("demo"));

    // falsche Zustimmung wird abgelehnt, der Plan bleibt dabei verbraucht
    let (events, s) = sink::<InstallEvent>();
    let mut bad = InstallConsent {
        plan_id: plan.plan_id.clone(),
        sha256: plan.artifact.sha256.clone(),
        license_spdx: plan.license.spdx.clone(),
        target_dir: plan.target.dir.clone(),
        accepted_at: "2026-10-20T10:00:00Z".into(),
    };
    bad.sha256 = "0".repeat(64);
    let e =
        fx.app.install_start(&InstallStartReq { plan_id: plan.plan_id.clone(), consent: bad }, &*s).await.unwrap_err();
    assert!(matches!(e, CoreError::Install(cypher_core::error::InstallError::ConsentMismatch(_))), "{e}");
    assert!(matches!(
        fx.app
            .install_start(
                &InstallStartReq {
                    plan_id: plan.plan_id.clone(),
                    consent: InstallConsent {
                        plan_id: plan.plan_id.clone(),
                        sha256: plan.artifact.sha256.clone(),
                        license_spdx: plan.license.spdx.clone(),
                        target_dir: plan.target.dir.clone(),
                        accepted_at: "x".into()
                    }
                },
                &*s
            )
            .await,
        Err(CoreError::PlanExpired(_))
    ));

    let plan =
        fx.app.install_preview(&InstallPreviewReq { program_id: "demo".into(), version: None, channel: None }).unwrap();
    let consent = InstallConsent {
        plan_id: plan.plan_id.clone(),
        sha256: plan.artifact.sha256.clone(),
        license_spdx: plan.license.spdx.clone(),
        target_dir: plan.target.dir.clone(),
        accepted_at: "2026-10-20T10:00:00Z".into(),
    };
    let installation =
        fx.app.install_start(&InstallStartReq { plan_id: plan.plan_id.clone(), consent }, &*s).await.unwrap();
    assert_eq!(installation.program_id, "demo");
    assert!(installation.managed_by_cypher && installation.launchable);
    let evs = events.take();
    assert!(matches!(evs.first(), Some(InstallEvent::Started { .. })));
    assert!(matches!(evs.last(), Some(InstallEvent::Finished { .. })));
    assert!(programs_dir.join("demo/1.0.0").join(EXE).is_file());
    assert!(fx.has_event("jobs:changed") && fx.has_event("programs:changed"));

    // Ansicht: verwaltete Installation, bevorzugt, Auftrag im Verlauf
    let view = fx.app.programs_view();
    let demo = view.programs.iter().find(|p| p.id == "demo").unwrap();
    assert_eq!(demo.installations.len(), 1);
    assert_eq!(demo.preferred_installation_id.as_deref(), Some(installation.id.as_str()));
    assert!(!demo.update_available);
    let jobs = fx.app.jobs_recent();
    assert_eq!(jobs[0].info.kind, JobKind::Install);
    assert_eq!(jobs[0].outcome, JobOutcome::Succeeded);

    #[cfg(unix)]
    {
        use cypher_core::api::{LaunchReq, SetPreferredReq};
        let r = fx
            .app
            .program_launch(&LaunchReq { program_id: "demo".into(), installation_id: None, files: None, mode: None })
            .unwrap();
        assert_eq!(r.installation_id, installation.id);
        assert!(r.pid.is_some());
        // bevorzugt setzen und unbekannte Installation ablehnen
        fx.app
            .program_set_preferred(&SetPreferredReq {
                program_id: "demo".into(),
                installation_id: installation.id.clone(),
            })
            .unwrap();
        assert!(matches!(
            fx.app
                .program_set_preferred(&SetPreferredReq { program_id: "demo".into(), installation_id: "nope".into() }),
            Err(CoreError::NotFound { .. })
        ));
    }

    // Entfernen: löscht nur unter dem Programmordner
    fx.app
        .installation_remove(&InstallationRemoveReq {
            installation_id: installation.id.clone(),
            mode: RemoveMode::DeleteFiles,
        })
        .unwrap();
    assert!(!programs_dir.join("demo/1.0.0").exists());
    assert!(fx.app.programs_view().programs.iter().find(|p| p.id == "demo").unwrap().installations.is_empty());
    assert!(
        fx.app
            .installation_remove(&InstallationRemoveReq {
                installation_id: installation.id,
                mode: RemoveMode::DeleteFiles
            })
            .is_err()
    );
    let _ = &fx.server;
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn manual_installation_enables_setup_with_the_real_packs_and_undo() {
    let fx = Fx::new().await;
    // eine „vorhandene“ Krita-Datei, die der Nutzer im Dialog wählt
    let exe = fx.write("tools/krita-5.3.4.1-x86_64.AppImage", b"#!/bin/sh\n");
    let inst = fx.app.program_add_manual(&AddManualReq { program_id: "krita".into() }, &exe).await.unwrap();
    assert_eq!(inst.kind, InstallKind::Manual);
    assert_eq!(inst.version.as_deref(), Some("5.3.4.1"));

    let packs = fx.app.setup_packs_list();
    let krita = packs.iter().find(|p| p.pack_id == "krita").expect("Krita-Paket");
    assert_eq!(krita.scopes.len(), 1);
    let scope = &krita.scopes[0];
    assert_eq!(scope.status, SetupStatus::NotApplied);
    assert!(scope.installation_ids.contains(&inst.id));
    let view = fx.app.programs_view();
    let krita_view = view.programs.iter().find(|p| p.id == "krita").unwrap();
    assert_eq!(krita_view.installations[0].setup_scope_id.as_deref(), Some(scope.scope_id.as_str()));

    let plan =
        fx.app.setup_preview(&SetupPreviewReq { pack_id: "krita".into(), scope_id: scope.scope_id.clone() }).unwrap();
    assert!(!plan.components.is_empty() && plan.conflicts.is_empty());
    let (events, s) = sink::<SetupEvent>();
    let record = fx
        .app
        .setup_apply(
            &SetupApplyReq { plan_id: plan.plan_id.clone(), components: vec![], resolutions: Default::default() },
            s.clone(),
        )
        .await
        .unwrap();
    assert!(record.files_written > 5 && record.undo_available);
    let evs = events.take();
    assert!(
        matches!(evs.first(), Some(SetupEvent::Started { .. }))
            && matches!(evs.last(), Some(SetupEvent::Finished { .. }))
    );
    let profile = fx.tmp.path().join("root/home/.local/share/krita");
    assert!(profile.join("bundles").is_dir() || profile.join("pykrita").is_dir() || profile.is_dir());
    assert_eq!(
        fx.app.setup_status(&cypher_core::api::SetupStatusReq { pack_id: "krita".into() }).unwrap().scopes[0].status,
        SetupStatus::Applied
    );
    assert!(fx.has_event("programs:changed"));
    // Plan ist verbraucht
    assert!(matches!(
        fx.app
            .setup_apply(
                &SetupApplyReq { plan_id: plan.plan_id, components: vec![], resolutions: Default::default() },
                s.clone()
            )
            .await,
        Err(CoreError::PlanExpired(_))
    ));
    // Verlauf und Zurücknehmen
    let history =
        fx.app.setup_history(&SetupHistoryReq { pack_id: "krita".into(), scope_id: scope.scope_id.clone() }).unwrap();
    assert_eq!(history.len(), 1);
    let report =
        fx.app.setup_undo(&cypher_core::api::SetupUndoReq { setup_id: record.setup_id.clone() }).await.unwrap();
    assert_eq!(report.removed, record.files_written);
    assert!(report.kept_modified.is_empty());
    assert_eq!(
        fx.app.setup_status(&cypher_core::api::SetupStatusReq { pack_id: "krita".into() }).unwrap().scopes[0].status,
        SetupStatus::NotApplied
    );
    let _ = &fx.runner;
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fonts_pack_has_a_user_fonts_scope_and_registers_through_the_font_installer() {
    let fx = Fx::new().await;
    let packs = fx.app.setup_packs_list();
    let fonts = packs.iter().find(|p| p.pack_id == "fonts").expect("Schriftenpaket");
    let scope = &fonts.scopes[0];
    let plan =
        fx.app.setup_preview(&SetupPreviewReq { pack_id: "fonts".into(), scope_id: scope.scope_id.clone() }).unwrap();
    let (_, s) = sink::<SetupEvent>();
    let record = fx
        .app
        .setup_apply(&SetupApplyReq { plan_id: plan.plan_id, components: vec![], resolutions: Default::default() }, s)
        .await
        .unwrap();
    assert!(record.files_written > 10);
    assert!(fx.fonts.registered.lock().unwrap().len() > 10);
    assert!(matches!(
        fx.app.setup_preview(&SetupPreviewReq { pack_id: "gibtsnicht".into(), scope_id: "x".into() }),
        Err(CoreError::NotFound { .. })
    ));
}

// ---------------------------------------------------------------------------------------------
// Einstellungen, Netzwerk, Katalog, Dateien, Marke, Diagnose
// ---------------------------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn settings_network_brand_samples_and_jobs() {
    let fx = Fx::new().await;
    let s = fx
        .app
        .settings_update(&SettingsPatch {
            catalog: Some(cypher_core::api::CatalogPatch { auto_refresh: Some(false) }),
            ..Default::default()
        })
        .unwrap();
    assert!(!s.catalog.auto_refresh);
    let net = fx.app.network_info();
    assert!(!net.telemetry);
    let catalog_ep = net.endpoints.iter().find(|e| e.purpose == cypher_core::api::NetworkPurpose::Catalog).unwrap();
    assert!(!catalog_ep.enabled);
    assert!(net.endpoints.iter().any(|e| e.host == "download.blender.org"));

    let brand = fx.app.brand_get().unwrap();
    assert!(brand.garment_colors.iter().any(|g| g.id == "schwarz"));
    assert!(fx.app.mockup_templates_list().unwrap().len() >= 4);
    assert!(fx.app.social_templates_list().unwrap().len() >= 5);
    let samples = fx.app.samples_list();
    assert!(!samples.is_empty() && samples[0].handle.url.is_some());
    assert!(fx.app.jobs_active().is_empty());
    assert!(!fx.app.job_cancel(&cypher_core::api::JobCancelReq { job_id: "gibtsnicht".into() }));
    assert_eq!(fx.app.print_profiles_list().len(), 10);
    assert!(fx.app.close_requested().active_jobs.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn export_save_image_validates_content_and_stamps_the_resolution() {
    let fx = Fx::new().await;
    let project = fx.app.project_create(&ProjectCreateReq { name: "Bildtest".into(), collection: None }).unwrap();
    let meta = |format: ExportImageFormat, dpi: Option<u32>| ExportImageMeta {
        file_name: "Mockup final.png".into(),
        format,
        destination: ExportDestination::Project { project_id: project.id.clone(), folder: ProjectFolder::ExportSocial },
        dpi,
    };
    let bytes = png(20, 10, [1, 2, 3, 255]);
    let h = fx.app.export_save_image(&meta(ExportImageFormat::Png, Some(300)), &bytes, None).unwrap();
    assert!(h.display_path.contains("Export") && h.name == "Mockup final.png");
    let saved = fx.app.handles.resolve(&h.id).unwrap();
    let reader = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(&saved).unwrap())).read_info().unwrap();
    assert_eq!(reader.info().pixel_dims.unwrap().xppu, 11811);
    // zweites Mal: Zähler, kein Überschreiben
    let h2 = fx.app.export_save_image(&meta(ExportImageFormat::Png, None), &bytes, None).unwrap();
    assert_eq!(h2.name, "Mockup final (2).png");
    // Inhalt passt nicht zum Format / kein Bild / zu groß / Dialog ohne Pfad
    assert!(fx.app.export_save_image(&meta(ExportImageFormat::Jpeg, None), &bytes, None).is_err());
    assert!(fx.app.export_save_image(&meta(ExportImageFormat::Png, None), b"kein Bild", None).is_err());
    assert!(fx.app.export_save_image(&meta(ExportImageFormat::Png, None), &[], None).is_err());
    let dialog = ExportImageMeta { destination: ExportDestination::Dialog, ..meta(ExportImageFormat::Png, None) };
    assert!(App::export_image_needs_dialog(&dialog));
    assert!(fx.app.export_save_image(&dialog, &bytes, None).is_err());
    let target = fx.tmp.path().join("gewaehlt.png");
    fx.app.export_save_image(&dialog, &bytes, Some(&target)).unwrap();
    assert!(target.is_file());
}

/// Legt `link` als Verknüpfung auf den Ordner `target` an (Symlink oder Junction).
fn make_dir_link(target: &std::path::Path, link: &std::path::Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    {
        let out = std::process::Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(link.to_string_lossy().replace('/', "\\"))
            .arg(target.to_string_lossy().replace('/', "\\"))
            .output()
            .unwrap();
        assert!(out.status.success(), "mklink: {}", String::from_utf8_lossy(&out.stdout));
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn image_export_never_writes_into_the_meta_folder_or_through_links() {
    // Befunde M1 und M2: Export in die Bibliothek und in Projekte
    let fx = Fx::new().await;
    let root = fx.tmp.path().join("Bibliothek");
    std::fs::create_dir_all(&root).unwrap();
    let candidate = fx.app.library_choose_root(&root).await.unwrap();
    fx.app
        .library_use_root(&LibraryUseRootReq { candidate_id: candidate.candidate_id, initialize: true })
        .await
        .unwrap();
    let outside = fx.tmp.path().join("ausserhalb");
    std::fs::create_dir_all(&outside).unwrap();
    let bytes = png(8, 8, [9, 9, 9, 255]);
    let to_library = |sub: &str| ExportImageMeta {
        file_name: "bild.png".into(),
        format: ExportImageFormat::Png,
        destination: ExportDestination::Library { subfolder: sub.into() },
        dpi: None,
    };
    for sub in [".cypher", ".CYPHER", ".Cypher/tmp", ".cypher@@tmp", "CYPHER~1/x", "/.cypher/"] {
        let sub = sub.replace("@@", "\\");
        assert!(fx.app.export_save_image(&to_library(&sub), &bytes, None).is_err(), "{sub}");
    }
    assert!(!root.join(".cypher/bild.png").exists() && !root.join(".cypher/tmp").exists());

    // ein Link als Zielordner und in der Kette
    std::fs::remove_dir_all(root.join("Motive")).unwrap();
    make_dir_link(&outside, &root.join("Motive"));
    for sub in ["Motive", "Motive/Neu"] {
        assert!(fx.app.export_save_image(&to_library(sub), &bytes, None).is_err(), "{sub}");
    }
    assert!(std::fs::read_dir(&outside).unwrap().next().is_none(), "außerhalb wurde geschrieben");
    let ok = fx.app.export_save_image(&to_library("Export/Neu"), &bytes, None).unwrap();
    assert!(ok.display_path.contains("Neu"));

    // Projekt: `Export` ist ein Link nach draußen
    let project = fx.app.project_create(&ProjectCreateReq { name: "Linktest".into(), collection: None }).unwrap();
    let project_dir = root.join("Projekte/Linktest");
    assert!(project_dir.join("Export/Social").is_dir());
    std::fs::remove_dir_all(project_dir.join("Export")).unwrap();
    make_dir_link(&outside, &project_dir.join("Export"));
    let meta = ExportImageMeta {
        file_name: "bild.png".into(),
        format: ExportImageFormat::Png,
        destination: ExportDestination::Project { project_id: project.id, folder: ProjectFolder::ExportSocial },
        dpi: None,
    };
    assert!(fx.app.export_save_image(&meta, &bytes, None).is_err());
    assert!(std::fs::read_dir(&outside).unwrap().next().is_none(), "außerhalb wurde geschrieben");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn diagnostics_zip_has_the_expected_files_and_no_home_path() {
    let fx = Fx::new().await;
    let dest = fx.tmp.path().join("diagnose.zip");
    let h = fx.app.diagnostics_export(&dest).unwrap();
    assert_eq!(h.name, "diagnose.zip");
    let mut zip = zip::ZipArchive::new(std::fs::File::open(&dest).unwrap()).unwrap();
    let mut names: Vec<String> =
        (0..zip.len()).map(|i| zip.by_index(i).unwrap().name().unwrap().into_owned()).collect();
    names.sort();
    for expected in [
        "app-info.json",
        "settings.json",
        "state.json",
        "catalog-status.json",
        "network.json",
        "jobs.json",
        "packs.txt",
    ] {
        assert!(names.iter().any(|n| n == expected), "{expected} fehlt: {names:?}");
    }
    // Der Heimatordner darf in keiner Schreibweise vorkommen: roh, in JSON verdoppelt (Windows: `C:\Users\Name`),
    // mit Schrägstrichen, kleingeschrieben (Befund M3)
    let home = fx.tmp.path().join("root/home").to_string_lossy().into_owned();
    let spellings = [
        home.clone(),
        home.replace('\\', "\\\\"),
        home.replace('\\', "/"),
        home.to_lowercase(),
        home.replace('\\', "/").to_lowercase(),
    ];
    for i in 0..zip.len() {
        let mut text = String::new();
        std::io::Read::read_to_string(&mut zip.by_index(i).unwrap(), &mut text).unwrap();
        for spelling in &spellings {
            assert!(!text.contains(spelling), "Heimatordner `{spelling}` im Bericht");
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bgremove_color_key_writes_a_new_file_and_the_model_is_not_built_in() {
    let fx = Fx::new().await;
    let st = fx.app.bgremove_status();
    assert!(st.color_key_available && !st.model_feature && st.models.is_empty());
    let img = fx.write("bilder/scheibe.png", &{
        let mut im = image::RgbaImage::from_pixel(40, 40, image::Rgba([255, 255, 255, 255]));
        for y in 10..30 {
            for x in 10..30 {
                im.put_pixel(x, y, image::Rgba([200, 0, 0, 255]));
            }
        }
        let mut out = Vec::new();
        im.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png).unwrap();
        out
    });
    let handle = fx.app.handles.register(&img, HandleSource::Dialog).unwrap();
    let (events, s) = sink::<cypher_core::api::BgRemoveEvent>();
    let out = fx
        .app
        .bgremove_run(
            &cypher_core::api::BgRemoveRunReq {
                handle_id: handle.id.clone(),
                method: cypher_core::api::BgRemoveMethod::ColorKey {
                    tolerance: 0.1,
                    sample: cypher_core::api::ColorKeySample::Corners,
                },
            },
            s.clone(),
        )
        .await
        .unwrap();
    let result = image::open(fx.app.handles.resolve(&out.id).unwrap()).unwrap().to_rgba8();
    assert_eq!(result.get_pixel(1, 1)[3], 0);
    assert_eq!(result.get_pixel(20, 20)[3], 255);
    assert!(matches!(events.take().last(), Some(cypher_core::api::BgRemoveEvent::Finished)));
    assert!(img.is_file(), "das Original bleibt");
    let model = fx
        .app
        .bgremove_run(
            &cypher_core::api::BgRemoveRunReq {
                handle_id: handle.id,
                method: cypher_core::api::BgRemoveMethod::Model { model_id: "x".into(), refine_edges: false },
            },
            s,
        )
        .await;
    assert!(matches!(model, Err(CoreError::NotFound { .. })));
}

// ---------------------------------------------------------------------------------------------
// Projekte
// ---------------------------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn projects_templates_files_and_documents() {
    let fx = Fx::new().await;
    let templates = fx.app.templates_list();
    assert!(templates.len() >= 20);
    let project = fx
        .app
        .project_create(&ProjectCreateReq { name: "Herbst-Drop 26".into(), collection: Some("rauschen".into()) })
        .unwrap();
    assert!(fx.has_event("projects:changed"));
    assert_eq!(fx.app.projects_list().len(), 1);
    assert!(project.dir.contains("Herbst-Drop 26"));

    // Datei aus Programmvorlage
    let tpl = templates.iter().find(|t| t.id == "builtin:shirt-front-krita").unwrap();
    let file = fx
        .app
        .project_new_file(&ProjectNewFileReq {
            project_id: project.id.clone(),
            template_id: tpl.id.clone(),
            file_name: "Neon Ratte".into(),
        })
        .unwrap();
    assert_eq!(file.file_ref.rel_path, "Motive/Neon Ratte.kra");
    assert_eq!(file.file_ref.program_id.as_deref(), Some("krita"));
    assert!(fx.app.handles.resolve(&file.handle.id).unwrap().is_file());
    // Kollision ist ein Eingabefehler am Feld fileName
    let again = fx.app.project_new_file(&ProjectNewFileReq {
        project_id: project.id.clone(),
        template_id: tpl.id.clone(),
        file_name: "Neon Ratte".into(),
    });
    assert!(
        matches!(again, Err(CoreError::Project(cypher_core::error::ProjectError::InvalidInput { ref field, .. })) if field == "fileName")
    );
    // ohne Krita-Installation: Programm fehlt
    let open = fx
        .app
        .project_open_file(&ProjectFileReq { project_id: project.id.clone(), rel_path: "Motive/Neon Ratte.kra".into() })
        .unwrap();
    assert!(matches!(open.outcome, ProjectOpenOutcome::ProgramMissing { ref program_id } if program_id == "krita"));
    assert!(matches!(
        fx.app.project_open_last(&ProjectRef { project_id: project.id.clone() }).unwrap().outcome,
        ProjectOpenOutcome::ProgramMissing { .. }
    ));

    // Modul-Vorlage -> Dokument
    let social = templates.iter().find(|t| t.id == "builtin:social-zitat").unwrap();
    let doc_file = fx
        .app
        .project_new_file(&ProjectNewFileReq {
            project_id: project.id.clone(),
            template_id: social.id.clone(),
            file_name: "Zitat 1".into(),
        })
        .unwrap();
    assert_eq!(doc_file.file_ref.rel_path, "Social/Zitat 1.social.json");
    let open = fx
        .app
        .project_open_file(&ProjectFileReq {
            project_id: project.id.clone(),
            rel_path: doc_file.file_ref.rel_path.clone(),
        })
        .unwrap();
    assert!(matches!(open.outcome, ProjectOpenOutcome::Module { module: cypher_core::api::ModuleKind::Social, .. }));
    let doc = fx
        .app
        .project_read_document(&cypher_core::api::ProjectReadDocumentReq {
            project_id: project.id.clone(),
            rel_path: doc_file.file_ref.rel_path.clone(),
        })
        .unwrap()
        .expect("Dokument");
    let written = fx
        .app
        .project_write_document(&ProjectWriteDocumentReq {
            project_id: project.id.clone(),
            rel_path: doc_file.file_ref.rel_path.clone(),
            document: doc,
        })
        .unwrap();
    assert_eq!(written.module, Some(cypher_core::api::ModuleKind::Social));

    // Datei aus der Außenwelt hinzufügen, Sammlung ändern, aus der Liste nehmen
    let src = fx.write("extern/bild.png", &png(4, 4, [9, 9, 9, 255]));
    let h = fx.app.handles.register(&src, HandleSource::Drop).unwrap();
    let asset = fx
        .app
        .project_add_asset(&cypher_core::api::ProjectAddAssetReq {
            project_id: project.id.clone(),
            handle_id: h.id,
            folder: None,
        })
        .unwrap();
    assert_eq!(asset.rel_path, "Motive/bild.png");
    assert!(fx.app.handles.resolve(&asset.handle.id).is_some());
    let moved = fx
        .app
        .project_set_collection(&cypher_core::api::ProjectSetCollectionReq {
            project_id: project.id.clone(),
            collection: None,
        })
        .unwrap();
    assert!(moved.collection.is_none());
    assert!(
        fx.app
            .project_file_handle(&ProjectFileReq { project_id: project.id.clone(), rel_path: "Motive/bild.png".into() })
            .is_ok()
    );
    assert!(
        fx.app
            .project_file_handle(&ProjectFileReq { project_id: project.id.clone(), rel_path: "../x".into() })
            .is_err()
    );
    assert!(
        matches!(fx.app.project_forget(&ProjectRef { project_id: project.id }), Err(CoreError::InvalidInput { .. })),
        "Projekte im Projektordner kann man nicht vergessen"
    );
    assert!(matches!(
        fx.app.project_forget(&ProjectRef { project_id: "gibtsnicht".into() }),
        Err(CoreError::NotFound { .. })
    ));
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn opening_a_project_file_starts_the_preferred_program() {
    use std::os::unix::fs::PermissionsExt;
    let fx = Fx::new().await;
    let exe = fx.write("tools/krita-5.3.4.1-x86_64.AppImage", b"#!/bin/sh\nexit 0\n");
    std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
    fx.app.program_add_manual(&AddManualReq { program_id: "krita".into() }, &exe).await.unwrap();
    let project = fx.app.project_create(&ProjectCreateReq { name: "P".into(), collection: None }).unwrap();
    let tpl = fx.app.templates_list().into_iter().find(|t| t.id == "builtin:shirt-front-krita").unwrap();
    fx.app
        .project_new_file(&ProjectNewFileReq {
            project_id: project.id.clone(),
            template_id: tpl.id,
            file_name: "a".into(),
        })
        .unwrap();
    let r = fx.app.project_open_last(&ProjectRef { project_id: project.id }).unwrap();
    match r.outcome {
        ProjectOpenOutcome::Launched { launch } => assert_eq!(launch.program_id, "krita"),
        other => panic!("{other:?}"),
    }
}

// ---------------------------------------------------------------------------------------------
// Bibliothek
// ---------------------------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn library_flow_choose_use_scan_query_meta_import_pack() {
    let fx = Fx::new().await;
    assert!(!fx.app.library_status().await.configured);
    assert!(matches!(
        fx.app.library_query(&query()).await,
        Err(CoreError::Library(cypher_core::error::LibraryError::NotConfigured))
    ));

    let root = fx.tmp.path().join("Cypher");
    std::fs::create_dir_all(root.join("Motive")).unwrap();
    std::fs::write(root.join("Motive/ratte.png"), png(8, 8, [1, 2, 3, 255])).unwrap();
    let candidate = fx.app.library_choose_root(&root).await.unwrap();
    assert_eq!(candidate.file_count, 1);
    assert!(!candidate.initialized);
    let status = fx
        .app
        .library_use_root(&LibraryUseRootReq { candidate_id: candidate.candidate_id.clone(), initialize: true })
        .await
        .unwrap();
    assert!(status.configured && status.initialized);
    assert_eq!(fx.app.settings.get().library_root.as_deref(), Some(root.to_string_lossy().as_ref()));
    assert!(fx.has_event("library:changed"));
    // Kandidat ist einmal verwendbar? (bleibt bis zum Ablauf) – ein unbekannter ist ein Fehler
    assert!(
        fx.app.library_use_root(&LibraryUseRootReq { candidate_id: "nope".into(), initialize: false }).await.is_err()
    );

    let (scan_events, s) = sink::<ScanEvent>();
    let status = fx.app.library_scan(s).await.unwrap();
    assert_eq!(status.entry_count, 1);
    let evs = scan_events.take();
    assert!(
        matches!(evs.first(), Some(ScanEvent::Started { .. }))
            && matches!(evs.last(), Some(ScanEvent::Finished { .. }))
    );

    let page = fx.app.library_query(&query()).await.unwrap();
    let id = page.entries[0].id.clone();
    let updated = fx
        .app
        .library_update_meta(&cypher_core::api::LibraryMetaPatchReq {
            entry_id: id.clone(),
            patch: req(serde_json::json!({ "title": "Neon Ratte" })),
        })
        .await
        .unwrap();
    assert_eq!(updated.meta.title, "Neon Ratte");
    let handle = fx.app.library_entry_handle(&LibraryGetReq { entry_id: id.clone() }).await.unwrap();
    assert_eq!(handle.source, HandleSource::Library);
    let thumb = fx.app.library_thumbnail_path(&id).await.unwrap();
    assert!(thumb.is_file());

    // Import aus einem Handle
    let outside = fx.write("extern/neu.png", &png(6, 6, [7, 7, 7, 255]));
    let h = fx.app.handles.register(&outside, HandleSource::Dialog).unwrap();
    let imported = fx
        .app
        .library_import(&cypher_core::api::LibraryImportReq { handle_ids: vec![h.id], subfolder: None, meta: None })
        .await
        .unwrap();
    assert_eq!(imported[0].rel_path, "Motive/neu.png");
    assert_eq!(fx.app.library_status().await.entry_count, 2);

    // Austauschpaket: exportieren, prüfen (alles identisch), importieren (alles übersprungen)
    let pack_path = fx.tmp.path().join("drop.cypherpack");
    let (pack_events, ps) = sink::<cypher_core::api::PackEvent>();
    let ids: Vec<String> = fx.app.library_query(&query()).await.unwrap().entries.iter().map(|e| e.id.clone()).collect();
    let pack_handle = fx
        .app
        .library_pack_export(
            &cypher_core::api::PackExportReq { entry_ids: ids, title: "Drop".into(), include_sidecars: None },
            &pack_path,
            ps.clone(),
        )
        .await
        .unwrap();
    assert!(pack_path.is_file());
    assert!(matches!(pack_events.take().last(), Some(cypher_core::api::PackEvent::Finished)));
    let preview = fx
        .app
        .library_pack_inspect(&cypher_core::api::PackInspectReq { handle_id: pack_handle.id.clone() })
        .await
        .unwrap();
    assert_eq!(preview.entries.len(), 2);
    assert!(preview.entries.iter().all(|e| e.state == cypher_core::api::PackEntryState::Identical));
    let report = fx
        .app
        .library_pack_import(
            &cypher_core::api::PackImportReq {
                handle_id: pack_handle.id,
                conflict_policy: cypher_core::api::PackConflictPolicy::Skip,
            },
            ps,
        )
        .await
        .unwrap();
    assert_eq!((report.imported, report.skipped), (0, 2));
    fx.app.library_thumbnails_clear().await.unwrap();
    assert!(!thumb.exists());

    // Kollektionen
    let st = fx
        .app
        .library_set_collections(&cypher_core::api::LibrarySetCollectionsReq {
            collections: vec![cypher_core::api::Collection {
                id: "neu".into(),
                name: "Neu".into(),
                hex: "#123456".into(),
            }],
        })
        .await
        .unwrap();
    assert_eq!(st.collections.len(), 1);

    // Projekte liegen jetzt in der Bibliothek
    let project =
        fx.app.project_create(&ProjectCreateReq { name: "In der Bibliothek".into(), collection: None }).unwrap();
    assert!(project.in_library && project.dir.contains("Projekte"));
}

// ---------------------------------------------------------------------------------------------
// Druckprüfer
// ---------------------------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn printcheck_analyze_export_and_overlay() {
    let fx = Fx::new().await;
    // Motiv 1800 x 1800 px mit 20 Halbtransparenzpixeln (Fade)
    let mut im = image::RgbaImage::new(1800, 1800);
    for y in 100..1700 {
        for x in 100..1700 {
            im.put_pixel(x, y, image::Rgba([40, 90, 200, 255]));
        }
    }
    for y in 1700..1740 {
        for x in 100..1700 {
            im.put_pixel(x, y, image::Rgba([40, 90, 200, (255 - (y - 1700) * 6) as u8]));
        }
    }
    let path = fx.write("motive/ratte.png", &{
        let mut out = Vec::new();
        im.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png).unwrap();
        out
    });
    let handle = fx.app.handles.register(&path, HandleSource::Dialog).unwrap();
    assert!(handle.url.is_some());

    let report = fx
        .app
        .printcheck_analyze(&PrintAnalyzeReq {
            handle_id: handle.id.clone(),
            profile_id: "shirtigo-tee-front".into(),
            garment_color_id: Some("schwarz".into()),
            technique: None,
            planned_width_mm: Some(150.0),
        })
        .await
        .unwrap();
    assert_eq!(report.profile_id, "shirtigo-tee-front");
    assert!(report.garment.as_ref().is_some_and(|g| g.underbase));
    assert!(
        report.findings.iter().any(|f| f.rule_id == cypher_core::api::PrintRuleId::AlphaSemiTransparent),
        "{:?}",
        report.findings
    );
    // unbekanntes Profil / Textilfarbe / Handle
    for req in [
        PrintAnalyzeReq {
            handle_id: handle.id.clone(),
            profile_id: "nope".into(),
            garment_color_id: None,
            technique: None,
            planned_width_mm: None,
        },
        PrintAnalyzeReq {
            handle_id: handle.id.clone(),
            profile_id: "shirtigo-tee-front".into(),
            garment_color_id: Some("lila".into()),
            technique: None,
            planned_width_mm: None,
        },
        PrintAnalyzeReq {
            handle_id: "nope".into(),
            profile_id: "shirtigo-tee-front".into(),
            garment_color_id: None,
            technique: None,
            planned_width_mm: None,
        },
    ] {
        assert!(matches!(fx.app.printcheck_analyze(&req).await, Err(CoreError::NotFound { .. })));
    }
    // Verfahren, das die Fläche nicht kennt
    let sleeve = PrintAnalyzeReq {
        handle_id: handle.id.clone(),
        profile_id: "shirtigo-tee-sleeve-left".into(),
        garment_color_id: None,
        technique: Some(cypher_core::api::PrintTechnique::Dtg),
        planned_width_mm: None,
    };
    assert!(matches!(fx.app.printcheck_analyze(&sleeve).await, Err(CoreError::InvalidInput { .. })));

    // Export in ein Projekt
    let project = fx.app.project_create(&ProjectCreateReq { name: "Druck".into(), collection: None }).unwrap();
    let options = PrintExportOptions {
        mode: cypher_core::api::ExportMode::Trimmed,
        planned_width_mm: 200.0,
        offset_top_mm: 0.0,
        offset_center_mm: 0.0,
        allow_upscale: true,
        color_profile: cypher_core::api::ExportColorProfile::AdobeRgb,
        fixes: cypher_core::api::ExportFixes {
            clean_ghost_pixels: true,
            semi_transparency: cypher_core::api::SemiTransparencyFix::Threshold,
            near_black_to_pure_black: false,
        },
        write_placement_json: true,
        destination: PrintDestination::Project { project_id: project.id.clone() },
    };
    let (events, s) = sink::<PrintExportEvent>();
    let result = fx
        .app
        .printcheck_export(
            &PrintExportReq {
                handle_id: handle.id.clone(),
                profile_id: "shirtigo-tee-front".into(),
                garment_color_id: Some("schwarz".into()),
                technique: None,
                options: options.clone(),
            },
            None,
            s.clone(),
        )
        .await
        .unwrap();
    assert_eq!(result.dpi, 300);
    assert_eq!(result.width_px, 2362);
    assert!(result.output.name.ends_with("_tee-front_200mm_300dpi.png"), "{}", result.output.name);
    assert!(result.output.display_path.contains("Export"));
    assert!(result.placement_json.as_ref().is_some_and(|p| p.name.ends_with(".shirtigo.json")));
    assert!(
        !result.report.findings.iter().any(|f| f.rule_id == cypher_core::api::PrintRuleId::AlphaSemiTransparent),
        "korrigiert"
    );
    let evs = events.take();
    assert!(
        matches!(evs.first(), Some(PrintExportEvent::Started { .. }))
            && matches!(evs.last(), Some(PrintExportEvent::Finished))
    );
    assert!(evs.iter().any(|e| matches!(e, PrintExportEvent::Stage { stage: cypher_core::api::PrintStage::Resample })));
    assert!(fx.has_event("projects:changed"));
    assert_eq!(fx.app.jobs_recent()[0].info.kind, JobKind::PrintExport);

    // Dialog verlangt einen Pfad, mit Pfad klappt es und erzwingt .png
    let mut dialog = options.clone();
    dialog.destination = PrintDestination::Dialog;
    let dialog_req = PrintExportReq {
        handle_id: handle.id.clone(),
        profile_id: "shirtigo-tee-front".into(),
        garment_color_id: None,
        technique: None,
        options: dialog,
    };
    assert!(fx.app.printcheck_export(&dialog_req, None, s.clone()).await.is_err());
    let chosen = fx.tmp.path().join("ausgabe");
    let out = fx.app.printcheck_export(&dialog_req, Some(&chosen), s.clone()).await.unwrap();
    assert!(fx.tmp.path().join("ausgabe.png").is_file(), "{}", out.output.display_path);
    // Zu große Breite für die Druckfläche
    let mut too_wide = options;
    too_wide.planned_width_mm = 400.0;
    too_wide.destination = PrintDestination::BesideSource;
    let e = fx
        .app
        .printcheck_export(
            &PrintExportReq {
                handle_id: handle.id.clone(),
                profile_id: "shirtigo-tee-front".into(),
                garment_color_id: None,
                technique: None,
                options: too_wide,
            },
            None,
            s,
        )
        .await
        .unwrap_err();
    assert!(matches!(e, CoreError::Print(cypher_core::error::PrintError::InvalidInput { .. })), "{e}");

    // Überlagerung
    let overlay = fx
        .app
        .printcheck_overlay(&PrintOverlayReq {
            handle_id: handle.id,
            profile_id: "shirtigo-tee-front".into(),
            overlay: cypher_core::api::OverlayKind::SemiTransparent,
        })
        .await
        .unwrap();
    assert!(overlay.url.is_some() && overlay.mime == "image/png");
}

// ---------------------------------------------------------------------------------------------
// Ziele für „Im Browser öffnen“ / „Im Ordner zeigen“ und die Protokolle
// ---------------------------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn external_urls_and_reveal_targets_are_resolved_in_rust() {
    use cypher_core::api::{AppPage, ExternalTarget, ProgramPage, RevealTarget};
    let fx = Fx::new().await;
    for page in [ProgramPage::Homepage, ProgramPage::License, ProgramPage::ReleaseNotes] {
        let url = fx.app.external_url(&ExternalTarget::ProgramPage { program_id: "blender".into(), page }).unwrap();
        assert!(url.starts_with("https://"), "{url}");
    }
    for page in [AppPage::Help, AppPage::SourceCode, AppPage::ThirdParty, AppPage::ReleaseNotes, AppPage::Downloads] {
        assert!(fx.app.external_url(&ExternalTarget::AppPage { page }).unwrap().starts_with("https://"));
    }
    // Festlegung: das Repository ist github.com/rouvenwieland/cypher-studio, die App-Seiten liegen auf studio.cypherxcypher.de
    let url = |page| fx.app.external_url(&ExternalTarget::AppPage { page }).unwrap();
    assert_eq!(url(AppPage::SourceCode), "https://github.com/rouvenwieland/cypher-studio");
    assert_eq!(url(AppPage::ThirdParty), "https://github.com/rouvenwieland/cypher-studio/tree/main/docs/third-party");
    assert_eq!(url(AppPage::Help), "https://studio.cypherxcypher.de/anleitung/");
    assert_eq!(url(AppPage::ReleaseNotes), "https://studio.cypherxcypher.de/releases/");
    let link = fx.app.programs_view().links.first().cloned().expect("der Katalog hat Verweise");
    assert!(fx.app.external_url(&ExternalTarget::CatalogLink { link_id: link.id }).unwrap().starts_with("https://"));
    assert!(fx.app.external_url(&ExternalTarget::CatalogLink { link_id: "gibtsnicht".into() }).is_err());
    assert!(matches!(
        fx.app.external_url(&ExternalTarget::ProgramPage {
            program_id: "gibtsnicht".into(),
            page: ProgramPage::Homepage
        }),
        Err(CoreError::NotFound { .. })
    ));

    let project = fx.app.project_create(&ProjectCreateReq { name: "Zeigen".into(), collection: None }).unwrap();
    let dir = fx.app.reveal_path(&RevealTarget::Project { project_id: project.id.clone() }).await.unwrap();
    assert!(dir.is_dir() && dir.ends_with("Zeigen"));
    let tpl = fx.app.templates_list().into_iter().find(|t| t.id == "builtin:social-zitat").unwrap();
    let file = fx
        .app
        .project_new_file(&ProjectNewFileReq {
            project_id: project.id.clone(),
            template_id: tpl.id,
            file_name: "Z".into(),
        })
        .unwrap();
    let path = fx
        .app
        .reveal_path(&RevealTarget::ProjectFile {
            project_id: project.id.clone(),
            rel_path: file.file_ref.rel_path.clone(),
        })
        .await
        .unwrap();
    assert!(path.is_file());
    let by_handle = fx.app.reveal_path(&RevealTarget::FileHandle { handle_id: file.handle.id.clone() }).await.unwrap();
    assert_eq!(by_handle, path);
    assert!(
        fx.app
            .reveal_path(&RevealTarget::ProjectFile { project_id: project.id, rel_path: "../x".into() })
            .await
            .is_err()
    );
    assert!(fx.app.reveal_path(&RevealTarget::FileHandle { handle_id: "nope".into() }).await.is_err());
    assert!(matches!(
        fx.app.reveal_path(&RevealTarget::LibraryEntry { entry_id: "x".into() }).await,
        Err(CoreError::Library(cypher_core::error::LibraryError::NotConfigured))
    ));
    let backups = fx.app.reveal_path(&RevealTarget::SetupBackups { pack_id: "krita".into() }).await.unwrap();
    assert!(backups.is_dir());
    assert!(fx.app.reveal_path(&RevealTarget::SetupBackups { pack_id: "nope".into() }).await.is_err());
}

fn png16(w: u32, h: u32) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Sixteen);
        let mut writer = enc.write_header().unwrap();
        writer.write_image_data(&vec![0x80u8; (w * h * 8) as usize]).unwrap();
    }
    out
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cyfile_serves_only_registered_raster_images_and_previews_what_browsers_cannot_show() {
    let fx = Fx::new().await;
    let register = |rel: &str, bytes: &[u8]| {
        let path = fx.write(rel, bytes);
        fx.app.handles.register(&path, HandleSource::Dialog).unwrap().id
    };

    // kleines PNG: unverändert
    let small = png(8, 8, [1, 2, 3, 255]);
    let served = fx.app.serve_file(&register("b/klein.png", &small)).await.unwrap();
    assert_eq!((served.mime.as_str(), served.body.as_slice()), ("image/png", small.as_slice()));
    assert_eq!(served.cache, cypher_core::app::serve::CachePolicy::NoStore);

    // zu breit: verkleinert auf höchstens 4096, Seitenverhältnis bleibt
    let wide = fx.app.serve_file(&register("b/breit.png", &png(5000, 20, [9, 9, 9, 255]))).await.unwrap();
    let decoded = image::load_from_memory(&wide.body).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (4096, 16));

    // 16 Bit: als 8-Bit-PNG
    let sixteen = fx.app.serve_file(&register("b/sechzehn.png", &png16(10, 10))).await.unwrap();
    let reader = png::Decoder::new(std::io::BufReader::new(Cursor::new(&sixteen.body))).read_info().unwrap();
    assert_eq!(reader.info().bit_depth, png::BitDepth::Eight);

    // TIFF: als PNG-Vorschau
    let mut tiff = Vec::new();
    image::RgbaImage::from_pixel(12, 12, image::Rgba([5, 6, 7, 255]))
        .write_to(&mut Cursor::new(&mut tiff), image::ImageFormat::Tiff)
        .unwrap();
    let served = fx.app.serve_file(&register("b/scan.tif", &tiff)).await.unwrap();
    assert_eq!(served.mime, "image/png");
    assert_eq!(image::load_from_memory(&served.body).unwrap().width(), 12);
    assert!(
        fx.tmp.path().join("root/cache/previews").read_dir().unwrap().count() >= 3,
        "Vorschauen liegen im Zwischenspeicher"
    );

    // SVG, Text und unbekannte Handles: nie
    assert!(fx.app.serve_file(&register("b/bild.svg", b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>")).await.is_none());
    assert!(fx.app.serve_file(&register("b/notiz.txt", b"hallo")).await.is_none());
    assert!(fx.app.serve_file("gibtsnicht").await.is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cyasset_serves_package_files_but_nothing_outside_the_whitelist() {
    let fx = Fx::new().await;
    let mask = fx.app.serve_asset("mockups/tee-front/mask.png").await.unwrap();
    assert_eq!(mask.mime, "image/png");
    assert_eq!(mask.cache, cypher_core::app::serve::CachePolicy::MaxAge(86_400));
    // eine Schrift der Marke, mit der URL, die das Frontend bekommt
    let brand = fx.app.brand_get().unwrap();
    let url = &brand.fonts[0].files[0].url;
    let rel = cypher_core::urls::decode_request_path(url.split_once("localhost/").unwrap().1).unwrap();
    let font = fx.app.serve_asset(&rel).await.unwrap();
    assert!(font.mime.starts_with("font/"), "{}", font.mime);
    for hostile in [
        "../Cargo.toml",
        "mockups/../../Cargo.toml",
        "mockups/tee-front/../../manifest.json",
        "manifest.json",
        "krita/pack.json",
        "mockups/tee-front/gibtsnicht.png",
        "mockups",
        "",
        "/etc/passwd",
    ] {
        assert!(fx.app.serve_asset(hostile).await.is_none(), "{hostile}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cythumb_serves_library_thumbnails() {
    let fx = Fx::new().await;
    assert!(fx.app.serve_thumbnail("x").await.is_none(), "ohne Bibliothek gibt es nichts");
    let root = fx.tmp.path().join("Cypher");
    std::fs::create_dir_all(root.join("Motive")).unwrap();
    std::fs::write(root.join("Motive/ratte.png"), png(64, 32, [1, 2, 3, 255])).unwrap();
    let candidate = fx.app.library_choose_root(&root).await.unwrap();
    fx.app
        .library_use_root(&LibraryUseRootReq { candidate_id: candidate.candidate_id, initialize: true })
        .await
        .unwrap();
    let (_, s) = sink::<ScanEvent>();
    fx.app.library_scan(s).await.unwrap();
    let id = fx.app.library_query(&query()).await.unwrap().entries[0].id.clone();
    let thumb = fx.app.serve_thumbnail(&id).await.unwrap();
    assert!(thumb.mime.starts_with("image/"));
    assert!(image::load_from_memory(&thumb.body).is_ok());
    assert!(fx.app.serve_thumbnail("gibtsnicht").await.is_none());
}
