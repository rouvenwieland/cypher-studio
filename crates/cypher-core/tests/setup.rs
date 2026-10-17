//! Tests der Cypher-Einrichtung: Idempotenz, Konflikte, Sicherung, Zurücknehmen, Schriften, Blender-Erweiterung,
//! Abbruch, Wiederherstellung nach Absturz. Alles in Temp-Ordnern, keine echten Programme, keine Systemschriften.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use cypher_core::api::{
    ConflictReason, ConflictResolution, InstallKind, Os, ScopeKind, SetupComponentStatus, SetupEvent,
    SetupOperationKind, SetupRecordStatus, SetupStatus,
};
use cypher_core::error::SetupError;
use cypher_core::process::{CommandOutput, FakeRunner};
use cypher_core::progress::{Collect, NoProgress};
use cypher_core::setup::fonts::{FontInstaller, RecordingFonts};
use cypher_core::setup::{
    ApplyEnv, ApplySelection, PackManifest, PlanInput, ResolvedScope, RootId, RootsEnv, SetupInstall, SetupStore,
    history, load_packs, plan, recover, resolve_scopes, summary, undo,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

// ---------------------------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------------------------

fn sha(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

struct Fixture {
    _tmp: tempfile::TempDir,
    packs_root: PathBuf,
    profile: PathBuf,
    store: SetupStore,
}

impl Fixture {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let packs_root = tmp.path().join("packs");
        let profile = tmp.path().join("profile");
        std::fs::create_dir_all(&packs_root).unwrap();
        std::fs::create_dir_all(&profile).unwrap();
        let store = SetupStore::new(tmp.path().join("data").join("setup"));
        Fixture { _tmp: tmp, packs_root, profile, store }
    }

    /// Schreibt ein Paket `demo` (Krita) mit `files` = (Datei-ID, Quellpfad, Ziel, Inhalt, Baustein).
    fn write_pack(&self, version: &str, files: &[(&str, &str, &str, &[u8], &str)], extra: serde_json::Value) {
        let dir = self.packs_root.join("demo");
        std::fs::create_dir_all(&dir).unwrap();
        let mut hashes = serde_json::Map::new();
        let mut pack_files = Vec::new();
        let mut comps: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for (id, src, rel, content, comp) in files {
            let p = dir.join(src);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, content).unwrap();
            hashes.insert((*src).to_owned(), json!(sha(content)));
            pack_files.push(json!({ "id": id, "src": src, "root": "kritaResources", "rel": rel }));
            comps.entry((*comp).to_owned()).or_default().push((*id).to_owned());
        }
        let mut components: Vec<serde_json::Value> = comps
            .iter()
            .map(|(c, f)| json!({ "id": c, "kind": "bundle", "label": format!("Baustein {c}"), "optional": c != "main", "files": f }))
            .collect();
        let mut pack = json!({
            "id": "demo", "programId": "krita", "version": version, "title": "Demo-Einrichtung",
            "programVersions": ">=5.2, <6", "components": components, "files": pack_files, "actions": [], "sha256": hashes
        });
        if let Some(obj) = extra.as_object() {
            for (k, v) in obj {
                if k == "components" {
                    components = serde_json::from_value(v.clone()).unwrap();
                    pack["components"] = json!(components);
                } else {
                    pack[k] = v.clone();
                }
            }
        }
        std::fs::write(dir.join("pack.json"), serde_json::to_vec_pretty(&pack).unwrap()).unwrap();
    }

    fn pack(&self) -> PackManifest {
        PackManifest::load(&self.packs_root.join("demo"), &self.packs_root, true).unwrap()
    }

    fn scope(&self) -> ResolvedScope {
        ResolvedScope {
            scope_id: "scope-1".into(),
            program_id: Some("krita".into()),
            kind: ScopeKind::UserProfile,
            roots: BTreeMap::from([(RootId::KritaResources, self.profile.clone())]),
            installation_ids: vec!["system:krita:ab".into()],
            unsupported: None,
            exe: Some(PathBuf::from("/usr/bin/krita")),
            install_kind: Some(InstallKind::System),
        }
    }

    fn plan(&self, pack: &PackManifest, scope: &ResolvedScope) -> cypher_core::setup::SetupPlanData {
        plan(&PlanInput {
            pack,
            scope,
            store: &self.store,
            os: Os::Linux,
            program_version: Some("5.3.4"),
            library_root: None,
            program_running: false,
        })
        .unwrap()
    }

    fn apply(
        &self,
        plan: cypher_core::setup::SetupPlanData,
        sel: &ApplySelection,
    ) -> Result<cypher_core::api::SetupRecord, SetupError> {
        let fonts = RecordingFonts::default();
        let runner = FakeRunner::new();
        cypher_core::setup::apply::apply(
            plan,
            sel,
            &ApplyEnv { store: &self.store, runner: &runner, fonts: &fonts, job_id: "job-1" },
            &NoProgress,
            &CancellationToken::new(),
        )
    }

    fn file(&self, rel: &str) -> PathBuf {
        self.profile.join(rel)
    }
}

fn tree(dir: &Path) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    fn walk(base: &Path, dir: &Path, out: &mut BTreeMap<String, String>) {
        let Ok(read) = std::fs::read_dir(dir) else { return };
        for e in read.filter_map(Result::ok) {
            let p = e.path();
            if p.is_dir() {
                walk(base, &p, out);
            } else {
                out.insert(
                    p.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/"),
                    sha(&std::fs::read(&p).unwrap()),
                );
            }
        }
    }
    walk(dir, dir, &mut out);
    out
}

const FILES: [(&str, &str, &str, &[u8], &str); 3] = [
    ("a", "src/a.txt", "bundles/a.txt", b"inhalt a", "main"),
    ("b", "src/b.txt", "templates/Cypher/b.txt", b"inhalt b", "main"),
    ("c", "src/c.txt", "extra/c.txt", b"inhalt c", "extra"),
];

fn select_all() -> ApplySelection {
    ApplySelection { components: vec!["main".into(), "extra".into()], resolutions: BTreeMap::new() }
}

// ---------------------------------------------------------------------------------------------
// Anwenden und Plan
// ---------------------------------------------------------------------------------------------

#[test]
fn fresh_apply_creates_files_records_a_manifest_and_emits_events() {
    let fx = Fixture::new();
    fx.write_pack("1.0.0", &FILES, json!({}));
    let pack = fx.pack();
    let scope = fx.scope();
    let p = fx.plan(&pack, &scope);

    // Plan: Pflichtbaustein angehakt, optionaler nicht; alles „neu“, keine Konflikte
    let main = p.dto.components.iter().find(|c| c.id == "main").unwrap();
    let extra = p.dto.components.iter().find(|c| c.id == "extra").unwrap();
    assert!(main.default_selected && !extra.default_selected);
    assert_eq!(main.status, SetupComponentStatus::New);
    assert!(main.operations.iter().all(|o| o.kind == SetupOperationKind::Create));
    assert!(p.dto.conflicts.is_empty());
    assert!(p.dto.previous.is_none());
    assert_eq!(p.dto.pack_label, "Demo-Einrichtung");
    // Der Plan schreibt nichts
    assert!(tree(&fx.profile).is_empty());

    let sink = Collect::new();
    let fonts = RecordingFonts::default();
    let runner = FakeRunner::new();
    let record = cypher_core::setup::apply::apply(
        p,
        &select_all(),
        &ApplyEnv { store: &fx.store, runner: &runner, fonts: &fonts, job_id: "job-1" },
        &sink,
        &CancellationToken::new(),
    )
    .unwrap();
    assert_eq!(record.status, SetupRecordStatus::Applied);
    assert_eq!(record.files_written, 3);
    assert_eq!(record.backups_taken, 0);
    assert!(record.undo_available && record.failures.is_empty());
    assert_eq!(std::fs::read(fx.file("bundles/a.txt")).unwrap(), b"inhalt a");
    assert_eq!(std::fs::read(fx.file("templates/Cypher/b.txt")).unwrap(), b"inhalt b");
    assert_eq!(std::fs::read(fx.file("extra/c.txt")).unwrap(), b"inhalt c");

    let events = sink.take();
    assert!(matches!(events.first(), Some(SetupEvent::Started { job_id, total: 3 }) if job_id == "job-1"));
    assert_eq!(events.iter().filter(|e| matches!(e, SetupEvent::Step { .. })).count(), 3);
    assert!(matches!(events.last(), Some(SetupEvent::Finished { record: r }) if r.setup_id == record.setup_id));
    // Journal ist weg, Manifest da
    assert!(fx.store.list_journals().is_empty());
    assert_eq!(fx.store.list_manifests().len(), 1);
}

#[test]
fn applying_twice_is_a_no_op_and_keeps_the_first_setup_undoable() {
    let fx = Fixture::new();
    fx.write_pack("1.0.0", &FILES, json!({}));
    let pack = fx.pack();
    let scope = fx.scope();
    let first = fx.apply(fx.plan(&pack, &scope), &select_all()).unwrap();
    let before = tree(&fx.profile);

    let p2 = fx.plan(&pack, &scope);
    assert!(p2.dto.components.iter().all(|c| c.status == SetupComponentStatus::Current), "{:?}", p2.dto.components);
    assert!(p2.dto.components.iter().flat_map(|c| &c.operations).all(|o| o.kind == SetupOperationKind::Skip));
    let second = fx.apply(p2, &select_all()).unwrap();

    assert_eq!(second.setup_id, first.setup_id, "kein neuer Eintrag ohne Änderung");
    assert_eq!(tree(&fx.profile), before);
    assert_eq!(fx.store.list_manifests().len(), 1);
    assert!(second.undo_available);
    // und das Zurücknehmen funktioniert danach noch
    let report = undo(&first.setup_id, &fx.store, &RecordingFonts::default()).unwrap();
    assert_eq!(report.removed, 3);
    assert!(tree(&fx.profile).is_empty());
}

#[test]
fn optional_components_are_only_applied_when_chosen() {
    let fx = Fixture::new();
    fx.write_pack("1.0.0", &FILES, json!({}));
    let (pack, scope) = (fx.pack(), fx.scope());
    let record = fx.apply(fx.plan(&pack, &scope), &ApplySelection::default()).unwrap();
    assert_eq!(record.components, vec!["main"]);
    assert!(fx.file("bundles/a.txt").exists() && !fx.file("extra/c.txt").exists());
}

#[test]
fn unknown_component_and_scope_problems_are_input_errors() {
    let fx = Fixture::new();
    fx.write_pack("1.0.0", &FILES, json!({}));
    let (pack, scope) = (fx.pack(), fx.scope());
    let e = fx
        .apply(fx.plan(&pack, &scope), &ApplySelection { components: vec!["gibtsnicht".into()], ..Default::default() })
        .unwrap_err();
    assert!(matches!(e, SetupError::InvalidInput { ref field, .. } if field == "components"), "{e}");
    assert!(tree(&fx.profile).is_empty());

    let mut unsupported = scope.clone();
    unsupported.unsupported = Some(cypher_core::api::SetupUnsupportedReason::InstallKind);
    let e = plan(&PlanInput {
        pack: &pack,
        scope: &unsupported,
        store: &fx.store,
        os: Os::Linux,
        program_version: None,
        library_root: None,
        program_running: false,
    })
    .map(|_| ())
    .unwrap_err();
    assert!(matches!(e, SetupError::Unsupported { .. }), "{e}");
}

#[test]
fn platform_filter_leaves_files_out() {
    let fx = Fixture::new();
    fx.write_pack("1.0.0", &FILES[..1], json!({}));
    // Datei nur für Windows
    let dir = fx.packs_root.join("demo");
    let mut v: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("pack.json")).unwrap()).unwrap();
    v["files"][0]["platforms"] = json!(["windows"]);
    std::fs::write(dir.join("pack.json"), serde_json::to_vec(&v).unwrap()).unwrap();
    let (pack, scope) = (fx.pack(), fx.scope());
    let p = fx.plan(&pack, &scope);
    assert!(p.dto.components.is_empty(), "auf Linux gibt es nichts anzuwenden");
}

// ---------------------------------------------------------------------------------------------
// Konflikte, Sicherung, Aktualisierung
// ---------------------------------------------------------------------------------------------

#[test]
fn foreign_file_is_a_conflict_skipped_by_default_and_never_overwritten_silently() {
    let fx = Fixture::new();
    fx.write_pack("1.0.0", &FILES, json!({}));
    std::fs::create_dir_all(fx.file("bundles")).unwrap();
    std::fs::write(fx.file("bundles/a.txt"), b"mein eigener Inhalt").unwrap();
    let (pack, scope) = (fx.pack(), fx.scope());
    let p = fx.plan(&pack, &scope);
    assert_eq!(p.dto.conflicts.len(), 1);
    let c = &p.dto.conflicts[0];
    assert_eq!(c.reason, ConflictReason::ForeignFile);
    assert_eq!(c.keep_both_name, "a (Cypher 1.0.0).txt");
    assert_eq!(p.dto.components.iter().find(|c| c.id == "main").unwrap().status, SetupComponentStatus::UserModified);

    let record = fx.apply(p, &select_all()).unwrap();
    assert_eq!(std::fs::read(fx.file("bundles/a.txt")).unwrap(), b"mein eigener Inhalt", "Standard = überspringen");
    assert!(!fx.file("bundles/a (Cypher 1.0.0).txt").exists());
    assert_eq!(record.files_written, 2);
}

#[test]
fn overwrite_makes_a_backup_and_undo_restores_the_original() {
    let fx = Fixture::new();
    fx.write_pack("1.0.0", &FILES, json!({}));
    std::fs::create_dir_all(fx.file("bundles")).unwrap();
    std::fs::write(fx.file("bundles/a.txt"), b"mein eigener Inhalt").unwrap();
    let (pack, scope) = (fx.pack(), fx.scope());
    let p = fx.plan(&pack, &scope);
    let id = p.dto.conflicts[0].conflict_id.clone();
    let record = fx
        .apply(
            p,
            &ApplySelection {
                components: vec!["main".into()],
                resolutions: BTreeMap::from([(id, ConflictResolution::Overwrite)]),
            },
        )
        .unwrap();
    assert_eq!(std::fs::read(fx.file("bundles/a.txt")).unwrap(), b"inhalt a");
    assert_eq!(record.backups_taken, 1);
    // die Sicherung liegt im Speicher der Einrichtung
    let backups = tree(&fx.store.root().join("backups"));
    assert_eq!(backups.len(), 1);
    assert!(backups.keys().next().unwrap().ends_with("kritaResources/bundles/a.txt"), "{backups:?}");

    let report = undo(&record.setup_id, &fx.store, &RecordingFonts::default()).unwrap();
    assert_eq!(report.restored, 1);
    assert_eq!(report.removed, 1, "b.txt war neu");
    assert_eq!(std::fs::read(fx.file("bundles/a.txt")).unwrap(), b"mein eigener Inhalt");
    assert!(!fx.file("templates").exists(), "leere Ordner werden aufgeräumt");
    assert!(tree(&fx.store.root().join("backups")).is_empty());
}

#[test]
fn keep_both_places_the_new_file_next_to_the_users_file() {
    let fx = Fixture::new();
    fx.write_pack("1.0.0", &FILES[..1], json!({}));
    std::fs::create_dir_all(fx.file("bundles")).unwrap();
    std::fs::write(fx.file("bundles/a.txt"), b"anders").unwrap();
    let (pack, scope) = (fx.pack(), fx.scope());
    let p = fx.plan(&pack, &scope);
    let id = p.dto.conflicts[0].conflict_id.clone();
    let record = fx
        .apply(
            p,
            &ApplySelection {
                components: vec!["main".into()],
                resolutions: BTreeMap::from([(id, ConflictResolution::KeepBoth)]),
            },
        )
        .unwrap();
    assert_eq!(std::fs::read(fx.file("bundles/a.txt")).unwrap(), b"anders");
    assert_eq!(std::fs::read(fx.file("bundles/a (Cypher 1.0.0).txt")).unwrap(), b"inhalt a");
    undo(&record.setup_id, &fx.store, &RecordingFonts::default()).unwrap();
    assert!(!fx.file("bundles/a (Cypher 1.0.0).txt").exists());
    assert_eq!(std::fs::read(fx.file("bundles/a.txt")).unwrap(), b"anders");
}

#[test]
fn new_pack_version_updates_own_unchanged_files_with_backup_and_flags_user_changes() {
    let fx = Fixture::new();
    fx.write_pack("1.0.0", &FILES, json!({}));
    let scope = fx.scope();
    let v1 = fx.apply(fx.plan(&fx.pack(), &scope), &select_all()).unwrap();

    // Version 1.1.0: a.txt geändert, b.txt unverändert; der Nutzer hat c.txt verändert, aber c.txt ändert sich im Paket auch
    let files2: [(&str, &str, &str, &[u8], &str); 3] = [
        ("a", "src/a.txt", "bundles/a.txt", b"inhalt a neu", "main"),
        ("b", "src/b.txt", "templates/Cypher/b.txt", b"inhalt b", "main"),
        ("c", "src/c.txt", "extra/c.txt", b"inhalt c neu", "extra"),
    ];
    fx.write_pack("1.1.0", &files2, json!({}));
    std::fs::write(fx.file("extra/c.txt"), b"vom Nutzer geaendert").unwrap();
    let pack2 = fx.pack();
    let p = fx.plan(&pack2, &scope);
    let main = p.dto.components.iter().find(|c| c.id == "main").unwrap();
    assert_eq!(main.status, SetupComponentStatus::Outdated);
    assert!(main.operations.iter().any(|o| o.kind == SetupOperationKind::Update));
    assert!(main.operations.iter().any(|o| o.kind == SetupOperationKind::Skip));
    assert_eq!(p.dto.conflicts.len(), 1);
    assert_eq!(p.dto.conflicts[0].reason, ConflictReason::UserModified);
    assert_eq!(p.dto.previous.as_ref().map(|r| r.setup_id.clone()), Some(v1.setup_id.clone()));

    let v2 = fx.apply(p, &select_all()).unwrap();
    assert_ne!(v2.setup_id, v1.setup_id);
    assert_eq!(v2.backups_taken, 1, "nur a.txt wird ersetzt");
    assert_eq!(std::fs::read(fx.file("bundles/a.txt")).unwrap(), b"inhalt a neu");
    assert_eq!(std::fs::read(fx.file("extra/c.txt")).unwrap(), b"vom Nutzer geaendert");

    // Verlauf: neueste zuerst, nur die jüngste ist zurücknehmbar
    let h = history("demo", "scope-1", &fx.store);
    assert_eq!(h.len(), 2);
    assert_eq!(h[0].setup_id, v2.setup_id);
    assert!(h[0].undo_available && !h[1].undo_available);
    let e = undo(&v1.setup_id, &fx.store, &RecordingFonts::default()).unwrap_err();
    assert!(matches!(e, SetupError::InvalidInput { .. }), "{e}");

    // Zurücknehmen von v2 bringt a.txt auf Fassung 1 zurück; danach ist v1 wieder zurücknehmbar
    let report = undo(&v2.setup_id, &fx.store, &RecordingFonts::default()).unwrap();
    assert_eq!(report.restored, 1);
    assert_eq!(std::fs::read(fx.file("bundles/a.txt")).unwrap(), b"inhalt a");
    let h = history("demo", "scope-1", &fx.store);
    assert!(h.iter().find(|r| r.setup_id == v1.setup_id).unwrap().undo_available);
    assert_eq!(h.iter().find(|r| r.setup_id == v2.setup_id).unwrap().status, SetupRecordStatus::Undone);
}

#[test]
fn undo_keeps_files_the_user_changed_afterwards_and_reports_them() {
    let fx = Fixture::new();
    fx.write_pack("1.0.0", &FILES, json!({}));
    let (pack, scope) = (fx.pack(), fx.scope());
    let record = fx.apply(fx.plan(&pack, &scope), &select_all()).unwrap();
    std::fs::write(fx.file("bundles/a.txt"), b"nachtraeglich bearbeitet").unwrap();
    let report = undo(&record.setup_id, &fx.store, &RecordingFonts::default()).unwrap();
    assert_eq!(report.removed, 2);
    assert_eq!(report.kept_modified.len(), 1);
    assert!(report.kept_modified[0].ends_with("a.txt"), "{:?}", report.kept_modified);
    assert_eq!(std::fs::read(fx.file("bundles/a.txt")).unwrap(), b"nachtraeglich bearbeitet");
    // zweites Zurücknehmen ist ein Fehler, kein stilles Nichts
    let e = undo(&record.setup_id, &fx.store, &RecordingFonts::default()).unwrap_err();
    assert!(matches!(e, SetupError::InvalidInput { .. }));
    assert!(matches!(undo("unbekannt", &fx.store, &RecordingFonts::default()), Err(SetupError::NotFound(_))));
}

#[test]
fn fallback_component_replaces_the_component_it_stands_in_for() {
    let fx = Fixture::new();
    let comps = json!([
        { "id": "main", "kind": "bundle", "label": "Bundle", "optional": false, "files": ["a"] },
        { "id": "lose", "kind": "palette", "label": "lose Dateien", "optional": true, "defaultSelected": false, "fallbackFor": "main", "files": ["c"] }
    ]);
    fx.write_pack("1.0.0", &[FILES[0], FILES[2]], json!({ "components": comps }));
    let (pack, scope) = (fx.pack(), fx.scope());
    let record = fx
        .apply(fx.plan(&pack, &scope), &ApplySelection { components: vec!["lose".into()], ..Default::default() })
        .unwrap();
    assert_eq!(record.components, vec!["lose"]);
    assert!(fx.file("extra/c.txt").exists());
    assert!(!fx.file("bundles/a.txt").exists(), "der ersetzte Baustein wird nicht zusätzlich angewendet");
}

// ---------------------------------------------------------------------------------------------
// Fehler, Abbruch, Wiederherstellung
// ---------------------------------------------------------------------------------------------

#[test]
fn corrupt_source_aborts_before_anything_is_written() {
    let fx = Fixture::new();
    fx.write_pack("1.0.0", &FILES, json!({}));
    let (pack, scope) = (fx.pack(), fx.scope());
    let p = fx.plan(&pack, &scope);
    std::fs::write(fx.packs_root.join("demo/src/b.txt"), b"beschaedigt").unwrap();
    let e = fx.apply(p, &select_all()).unwrap_err();
    assert!(matches!(e, SetupError::InvalidPack(ref m) if m.contains("beschädigt")), "{e}");
    assert!(tree(&fx.profile).is_empty());
    assert!(fx.store.list_manifests().is_empty());
}

#[test]
fn an_unwritable_target_is_a_per_file_failure_and_the_rest_is_applied() {
    let fx = Fixture::new();
    fx.write_pack("1.0.0", &FILES, json!({}));
    // `templates` ist eine Datei -> templates/Cypher/b.txt kann nicht angelegt werden
    std::fs::write(fx.file("templates"), b"ich bin eine Datei").unwrap();
    let (pack, scope) = (fx.pack(), fx.scope());
    let p = fx.plan(&pack, &scope);
    let record = fx.apply(p, &select_all()).unwrap();
    assert_eq!(record.status, SetupRecordStatus::Partial);
    assert_eq!(record.failures.len(), 1);
    assert!(record.failures[0].target.ends_with("b.txt"), "{:?}", record.failures[0].target);
    assert!(fx.file("bundles/a.txt").exists() && fx.file("extra/c.txt").exists());
    let s = summary(&pack, &[scope], &fx.store);
    assert_eq!(s.scopes[0].status, SetupStatus::Partial);
}

#[test]
fn cancelling_rolls_everything_back() {
    let fx = Fixture::new();
    fx.write_pack("1.0.0", &FILES, json!({}));
    let (pack, scope) = (fx.pack(), fx.scope());
    let p = fx.plan(&pack, &scope);
    let token = CancellationToken::new();
    let t2 = token.clone();
    let sink = move |e: SetupEvent| {
        if let SetupEvent::Step { index: 2, .. } = e {
            t2.cancel();
        }
    };
    let fonts = RecordingFonts::default();
    let runner = FakeRunner::new();
    // Der Abbruch wird vor dem nächsten Schritt bemerkt; vorher geschriebene Dateien werden zurückgerollt
    let r = cypher_core::setup::apply::apply(
        p,
        &select_all(),
        &ApplyEnv { store: &fx.store, runner: &runner, fonts: &fonts, job_id: "j" },
        &sink,
        &token,
    );
    assert!(matches!(r, Err(SetupError::Cancelled)), "{r:?}");
    assert!(tree(&fx.profile).is_empty(), "{:?}", tree(&fx.profile));
    assert!(fx.store.list_manifests().is_empty() && fx.store.list_journals().is_empty());
}

#[test]
fn recover_rolls_back_an_interrupted_setup_from_its_journal() {
    use cypher_core::setup::store::{EntryOp, Journal, JournalState, ManifestEntry};
    let fx = Fixture::new();
    std::fs::create_dir_all(fx.file("bundles")).unwrap();
    std::fs::write(fx.file("bundles/a.txt"), b"inhalt a").unwrap();
    std::fs::write(fx.file("bundles/fremd.txt"), b"nicht meins").unwrap();
    let journal = Journal {
        state: JournalState::Applying,
        setup_id: "abgebrochen".into(),
        entries: vec![ManifestEntry {
            component: "main".into(),
            root: RootId::KritaResources,
            rel: "bundles/a.txt".into(),
            op: EntryOp::Create,
            sha256: sha(b"inhalt a"),
            bytes: 8,
            backup: None,
        }],
        fonts: vec![],
        roots: BTreeMap::from([(RootId::KritaResources, fx.profile.to_string_lossy().into_owned())]),
    };
    fx.store.save_journal(&journal).unwrap();
    assert_eq!(recover(&fx.store, &RecordingFonts::default()), 1);
    assert!(!fx.file("bundles/a.txt").exists());
    assert!(fx.file("bundles/fremd.txt").exists(), "nur eigene Dateien werden entfernt");
    assert!(fx.store.list_journals().is_empty());
    assert_eq!(recover(&fx.store, &RecordingFonts::default()), 0);
}

// ---------------------------------------------------------------------------------------------
// Schriften und Blender
// ---------------------------------------------------------------------------------------------

fn font_pack(fx: &Fixture) {
    font_pack_in(fx, "");
}

/// Wie [`font_pack`], die Schriften landen aber in einem Unterordner des Schriftordners (`sub` mit Schrägstrich am Ende).
fn font_pack_in(fx: &Fixture, sub: &str) {
    let dir = fx.packs_root.join("demo");
    std::fs::create_dir_all(dir.join("f")).unwrap();
    std::fs::write(dir.join("f/A.ttf"), b"font A").unwrap();
    std::fs::write(dir.join("f/B.ttf"), b"font B").unwrap();
    let pack = json!({
        "id": "demo", "programId": null, "version": "1.0.0", "title": "Schriften",
        "components": [{ "id": "fonts", "kind": "fonts", "label": "Schriften", "optional": false, "files": ["fa", "fb"] }],
        "files": [
            { "id": "fa", "src": "f/A.ttf", "root": "userFonts", "rel": format!("{sub}A.ttf") },
            { "id": "fb", "src": "f/B.ttf", "root": "userFonts", "rel": format!("{sub}B.ttf") }
        ],
        "actions": [
            { "type": "installFont", "file": "fa", "displayName": "A (TrueType)" },
            { "type": "installFont", "file": "fb", "displayName": "B (TrueType)" }
        ],
        "sha256": { "f/A.ttf": sha(b"font A"), "f/B.ttf": sha(b"font B") }
    });
    std::fs::write(dir.join("pack.json"), serde_json::to_vec_pretty(&pack).unwrap()).unwrap();
}

fn font_scope(fx: &Fixture) -> ResolvedScope {
    let fonts_dir = fx.profile.join("fonts");
    ResolvedScope {
        scope_id: "fonts-scope".into(),
        program_id: None,
        kind: ScopeKind::UserFonts,
        roots: BTreeMap::from([(RootId::UserFonts, fonts_dir)]),
        installation_ids: vec![],
        unsupported: None,
        exe: None,
        install_kind: None,
    }
}

#[test]
fn fonts_are_copied_registered_once_and_unregistered_on_undo() {
    let fx = Fixture::new();
    font_pack(&fx);
    let (pack, scope) = (fx.pack(), font_scope(&fx));
    let fonts = RecordingFonts::default();
    let runner = FakeRunner::new();
    let env = ApplyEnv { store: &fx.store, runner: &runner, fonts: &fonts, job_id: "j" };
    let p = plan(&PlanInput {
        pack: &pack,
        scope: &scope,
        store: &fx.store,
        os: Os::Linux,
        program_version: None,
        library_root: None,
        program_running: false,
    })
    .unwrap();
    assert!(p.dto.components[0].operations.iter().any(|o| o.kind == SetupOperationKind::InstallFont));
    let record =
        cypher_core::setup::apply::apply(p, &ApplySelection::default(), &env, &NoProgress, &CancellationToken::new())
            .unwrap();
    assert_eq!(fonts.registered.lock().unwrap().len(), 2);
    assert!(fx.profile.join("fonts/A.ttf").exists());

    // zweites Anwenden: nichts mehr zu tun, keine erneute Anmeldung
    let p2 = plan(&PlanInput {
        pack: &pack,
        scope: &scope,
        store: &fx.store,
        os: Os::Linux,
        program_version: None,
        library_root: None,
        program_running: false,
    })
    .unwrap();
    let again =
        cypher_core::setup::apply::apply(p2, &ApplySelection::default(), &env, &NoProgress, &CancellationToken::new())
            .unwrap();
    assert_eq!(again.setup_id, record.setup_id);
    assert_eq!(fonts.registered.lock().unwrap().len(), 2);

    let report = undo(&record.setup_id, &fx.store, &fonts).unwrap();
    assert_eq!(report.fonts_removed, 2);
    assert_eq!(report.removed, 2);
    assert_eq!(fonts.unregistered.lock().unwrap().len(), 2);
    assert!(!fx.profile.join("fonts/A.ttf").exists());
}

/// Ersatz für `fc-cache` älterer fontconfig-Versionen (z. B. 2.13.1 unter Ubuntu 22.04): Beim Auffrischen des Caches legen
/// sie in jeden vorhandenen Schriftordner eine Datei `.uuid`.
#[derive(Default)]
struct UuidWritingFonts {
    recording: RecordingFonts,
    dirs: std::sync::Mutex<std::collections::BTreeSet<PathBuf>>,
}

impl FontInstaller for UuidWritingFonts {
    fn register(&self, file: &Path, display_name: &str) -> std::io::Result<Option<String>> {
        self.dirs.lock().unwrap().insert(file.parent().unwrap().to_path_buf());
        self.recording.register(file, display_name)
    }

    fn unregister(&self, file: &Path, registry_name: Option<&str>) -> std::io::Result<()> {
        self.dirs.lock().unwrap().insert(file.parent().unwrap().to_path_buf());
        self.recording.unregister(file, registry_name)
    }

    fn flush(&self) {
        for dir in std::mem::take(&mut *self.dirs.lock().unwrap()) {
            if dir.is_dir() {
                std::fs::write(dir.join(".uuid"), b"0000").unwrap();
            }
        }
    }
}

#[test]
fn undoing_fonts_leaves_no_folder_or_fontconfig_marker_behind() {
    let fx = Fixture::new();
    font_pack_in(&fx, "cypher/");
    let (pack, scope) = (fx.pack(), font_scope(&fx));
    let fonts = UuidWritingFonts::default();
    let runner = FakeRunner::new();
    let p = plan(&PlanInput {
        pack: &pack,
        scope: &scope,
        store: &fx.store,
        os: Os::Linux,
        program_version: None,
        library_root: None,
        program_running: false,
    })
    .unwrap();
    let record = cypher_core::setup::apply::apply(
        p,
        &ApplySelection::default(),
        &ApplyEnv { store: &fx.store, runner: &runner, fonts: &fonts, job_id: "j" },
        &NoProgress,
        &CancellationToken::new(),
    )
    .unwrap();
    let folder = fx.profile.join("fonts/cypher");
    assert!(folder.join("A.ttf").is_file());
    assert!(folder.join(".uuid").is_file(), "der Cache-Lauf beim Anwenden hat die Markierung angelegt");

    let report = undo(&record.setup_id, &fx.store, &fonts).unwrap();
    assert_eq!(report.removed, 2);
    let left: Vec<_> = std::fs::read_dir(fx.profile.join("fonts")).unwrap().map(|e| e.unwrap().path()).collect();
    assert!(left.is_empty(), "nach dem Zurücknehmen liegt nichts mehr da: {left:?}");
}

#[test]
fn a_foreign_file_next_to_the_fonts_keeps_the_folder_and_the_marker() {
    let fx = Fixture::new();
    font_pack_in(&fx, "cypher/");
    let (pack, scope) = (fx.pack(), font_scope(&fx));
    let fonts = UuidWritingFonts::default();
    let runner = FakeRunner::new();
    let p = plan(&PlanInput {
        pack: &pack,
        scope: &scope,
        store: &fx.store,
        os: Os::Linux,
        program_version: None,
        library_root: None,
        program_running: false,
    })
    .unwrap();
    let record = cypher_core::setup::apply::apply(
        p,
        &ApplySelection::default(),
        &ApplyEnv { store: &fx.store, runner: &runner, fonts: &fonts, job_id: "j" },
        &NoProgress,
        &CancellationToken::new(),
    )
    .unwrap();
    let folder = fx.profile.join("fonts/cypher");
    std::fs::write(folder.join("Eigene.ttf"), b"vom Nutzer").unwrap();
    undo(&record.setup_id, &fx.store, &fonts).unwrap();
    assert!(folder.join("Eigene.ttf").is_file(), "fremde Dateien bleiben");
    assert!(folder.join(".uuid").is_file(), "und mit ihnen die Markierung");
}

#[test]
fn a_failing_font_registration_makes_the_setup_partial() {
    let fx = Fixture::new();
    font_pack(&fx);
    let (pack, scope) = (fx.pack(), font_scope(&fx));
    let fonts = RecordingFonts::default();
    fonts.fail_register.store(true, Ordering::SeqCst);
    let runner = FakeRunner::new();
    let p = plan(&PlanInput {
        pack: &pack,
        scope: &scope,
        store: &fx.store,
        os: Os::Linux,
        program_version: None,
        library_root: None,
        program_running: false,
    })
    .unwrap();
    let record = cypher_core::setup::apply::apply(
        p,
        &ApplySelection::default(),
        &ApplyEnv { store: &fx.store, runner: &runner, fonts: &fonts, job_id: "j" },
        &NoProgress,
        &CancellationToken::new(),
    )
    .unwrap();
    assert_eq!(record.status, SetupRecordStatus::Partial);
    assert_eq!(record.failures.len(), 2);
    assert!(fx.profile.join("fonts/A.ttf").exists(), "die Dateien liegen trotzdem da");
}

/// Eine Erweiterung wie `blender --command extension build` sie packt: `blender_manifest.toml` mit der Kennung im ZIP.
fn extension_zip() -> Vec<u8> {
    use std::io::Write as _;
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buf);
        zip.start_file("blender_manifest.toml", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(
            b"schema_version = \"1.0.0\"
id = \"cypher_export\"
version = \"1.0.0\"
",
        )
        .unwrap();
        zip.start_file("__init__.py", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(
            b"pass
",
        )
        .unwrap();
        zip.finish().unwrap();
    }
    buf.into_inner()
}

fn blender_pack(fx: &Fixture) {
    let dir = fx.packs_root.join("demo");
    std::fs::create_dir_all(dir.join("dist")).unwrap();
    let ext_zip = extension_zip();
    std::fs::write(dir.join("dist/ext.zip"), &ext_zip).unwrap();
    std::fs::create_dir_all(dir.join("t")).unwrap();
    std::fs::write(dir.join("t/init.py"), b"print(1)").unwrap();
    let pack = json!({
        "id": "demo", "programId": "krita", "version": "1.0.0", "title": "Blender-Test",
        "components": [
            { "id": "template", "kind": "appTemplate", "label": "Vorlage", "optional": false, "files": ["init"] },
            { "id": "extension", "kind": "extension", "label": "Erweiterung", "optional": false, "files": ["lic"] }
        ],
        "files": [
            { "id": "init", "src": "t/init.py", "root": "kritaResources", "rel": "scripts/init.py" },
            { "id": "lic", "src": "t/init.py", "root": "kritaResources", "rel": "scripts/LICENSE.txt" }
        ],
        "actions": [
            { "type": "blenderExtensionInstall", "zip": "dist/ext.zip" },
            { "type": "writeConfig", "root": "kritaResources", "rel": "cfg/cypher_studio.json", "fields": { "assetLibraryPath": "{libraryRoot}/3D" } }
        ],
        "sha256": { "t/init.py": sha(b"print(1)"), "dist/ext.zip": sha(&ext_zip) }
    });
    std::fs::write(dir.join("pack.json"), serde_json::to_vec_pretty(&pack).unwrap()).unwrap();
}

#[test]
fn blender_extension_is_installed_through_the_cli_once_and_config_uses_the_library_root() {
    let fx = Fixture::new();
    blender_pack(&fx);
    let (pack, scope) = (fx.pack(), fx.scope());
    let library = PathBuf::from("/data/Sync/Cypher");
    let mk_plan = |lib: Option<&Path>| {
        plan(&PlanInput {
            pack: &pack,
            scope: &scope,
            store: &fx.store,
            os: Os::Linux,
            program_version: Some("5.3.4"),
            library_root: lib,
            program_running: false,
        })
        .unwrap()
    };
    let fonts = RecordingFonts::default();
    let runner = FakeRunner::new().ok("--command extension install-file", "Extension installed");
    let env = ApplyEnv { store: &fx.store, runner: &runner, fonts: &fonts, job_id: "j" };

    // ohne Bibliothek: keine Konfigurationsdatei im Plan
    let p0 = mk_plan(None);
    assert!(!p0.dto.components.iter().flat_map(|c| &c.operations).any(|o| o.kind == SetupOperationKind::WriteConfig));

    let p = mk_plan(Some(&library));
    assert!(
        p.dto.components.iter().flat_map(|c| &c.operations).any(|o| o.kind == SetupOperationKind::BlenderExtension)
    );
    let record =
        cypher_core::setup::apply::apply(p, &ApplySelection::default(), &env, &NoProgress, &CancellationToken::new())
            .unwrap();
    assert_eq!(record.status, SetupRecordStatus::Applied);
    let calls = runner.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].exe, PathBuf::from("/usr/bin/krita"));
    assert_eq!(calls[0].args[..6], ["--command", "extension", "install-file", "--repo", "user_default", "--enable"]);
    assert!(calls[0].args[6].ends_with("ext.zip"));
    let cfg: serde_json::Value =
        serde_json::from_slice(&std::fs::read(fx.file("cfg/cypher_studio.json")).unwrap()).unwrap();
    assert_eq!(cfg["assetLibraryPath"], "/data/Sync/Cypher/3D");

    // erneut anwenden: Erweiterung gilt als installiert, kein zweiter Aufruf
    let again = cypher_core::setup::apply::apply(
        mk_plan(Some(&library)),
        &ApplySelection::default(),
        &env,
        &NoProgress,
        &CancellationToken::new(),
    )
    .unwrap();
    assert_eq!(again.setup_id, record.setup_id);
    assert_eq!(runner.calls().len(), 1);

    // Zurücknehmen mit Blender-Kommandozeile entfernt auch die Erweiterung (nach Kennung aus dem ZIP)
    let runner = FakeRunner::new().ok("extension remove", "removed");
    let report = cypher_core::setup::undo_with_runner(&record.setup_id, &fx.store, &fonts, &runner).unwrap();
    assert!(report.removed >= 1);
    let calls = runner.calls();
    assert_eq!(calls.len(), 1, "{calls:?}");
    assert_eq!(calls[0].exe, PathBuf::from("/usr/bin/krita"));
    assert_eq!(calls[0].args, ["--command", "extension", "remove", "cypher_export"]);
}

#[test]
fn undo_without_a_runner_leaves_the_extension_and_failed_installs_are_never_removed() {
    let fx = Fixture::new();
    blender_pack(&fx);
    let (pack, scope) = (fx.pack(), fx.scope());
    let mk_plan = || {
        plan(&PlanInput {
            pack: &pack,
            scope: &scope,
            store: &fx.store,
            os: Os::Linux,
            program_version: Some("5.3.4"),
            library_root: None,
            program_running: false,
        })
        .unwrap()
    };
    let fonts = RecordingFonts::default();
    // Installation schlug fehl (Exit-Code 1): beim Zurücknehmen wird nichts entfernt
    let failing = FakeRunner::new()
        .on("install-file", Ok(CommandOutput { code: Some(1), stdout: vec![], stderr: b"Fehler".to_vec() }));
    let env = ApplyEnv { store: &fx.store, runner: &failing, fonts: &fonts, job_id: "j" };
    let record = cypher_core::setup::apply::apply(
        mk_plan(),
        &ApplySelection::default(),
        &env,
        &NoProgress,
        &CancellationToken::new(),
    )
    .unwrap();
    let remover = FakeRunner::new().ok("extension remove", "removed");
    cypher_core::setup::undo_with_runner(&record.setup_id, &fx.store, &fonts, &remover).unwrap();
    assert!(remover.calls().is_empty(), "{:?}", remover.calls());
}

#[test]
fn blender_cli_failure_is_reported_per_action() {
    let fx = Fixture::new();
    blender_pack(&fx);
    let (pack, scope) = (fx.pack(), fx.scope());
    let p = plan(&PlanInput {
        pack: &pack,
        scope: &scope,
        store: &fx.store,
        os: Os::Linux,
        program_version: Some("5.3.4"),
        library_root: None,
        program_running: false,
    })
    .unwrap();
    let fonts = RecordingFonts::default();
    let runner = FakeRunner::new()
        .on("install-file", Ok(CommandOutput { code: Some(1), stdout: vec![], stderr: b"Fehler".to_vec() }));
    let record = cypher_core::setup::apply::apply(
        p,
        &ApplySelection::default(),
        &ApplyEnv { store: &fx.store, runner: &runner, fonts: &fonts, job_id: "j" },
        &NoProgress,
        &CancellationToken::new(),
    )
    .unwrap();
    assert_eq!(record.status, SetupRecordStatus::Partial);
    assert_eq!(record.failures.len(), 1);
    // beim nächsten Anwenden wird der Aufruf wiederholt (Exit-Code war nicht 0)
    let p2 = plan(&PlanInput {
        pack: &pack,
        scope: &scope,
        store: &fx.store,
        os: Os::Linux,
        program_version: Some("5.3.4"),
        library_root: None,
        program_running: false,
    })
    .unwrap();
    let runner2 = FakeRunner::new().ok("install-file", "ok");
    let r2 = cypher_core::setup::apply::apply(
        p2,
        &ApplySelection::default(),
        &ApplyEnv { store: &fx.store, runner: &runner2, fonts: &fonts, job_id: "j" },
        &NoProgress,
        &CancellationToken::new(),
    )
    .unwrap();
    assert_eq!(runner2.calls().len(), 1);
    assert_eq!(r2.status, SetupRecordStatus::Applied);
}

// ---------------------------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------------------------

#[test]
fn summary_reports_not_applied_applied_outdated_and_unsupported() {
    let fx = Fixture::new();
    fx.write_pack("1.0.0", &FILES, json!({}));
    let scope = fx.scope();
    let s = summary(&fx.pack(), std::slice::from_ref(&scope), &fx.store);
    assert_eq!(s.scopes[0].status, SetupStatus::NotApplied);
    assert_eq!(s.pack_id, "demo");

    fx.apply(fx.plan(&fx.pack(), &scope), &select_all()).unwrap();
    let s = summary(&fx.pack(), std::slice::from_ref(&scope), &fx.store);
    assert_eq!(s.scopes[0].status, SetupStatus::Applied);
    let mut applied = s.scopes[0].components_applied.clone();
    applied.sort();
    assert_eq!(applied, vec!["extra", "main"]);
    assert!(s.scopes[0].record.as_ref().unwrap().undo_available);

    fx.write_pack("1.2.0", &FILES, json!({}));
    let s = summary(&fx.pack(), std::slice::from_ref(&scope), &fx.store);
    assert_eq!(s.scopes[0].status, SetupStatus::Outdated);

    let mut snap = scope.clone();
    snap.unsupported = Some(cypher_core::api::SetupUnsupportedReason::InstallKind);
    let s = summary(&fx.pack(), &[snap], &fx.store);
    assert_eq!(s.scopes[0].status, SetupStatus::Unsupported);
}

// ---------------------------------------------------------------------------------------------
// Die echten Pakete von Team C (packs/dist)
// ---------------------------------------------------------------------------------------------

fn dist_root() -> Option<PathBuf> {
    let p = cypher_core::util::repo_root().join("packs/dist");
    p.join("manifest.json").is_file().then_some(p)
}

#[test]
fn real_dist_packs_load_apply_idempotently_and_undo_cleanly() {
    let Some(dist) = dist_root() else {
        eprintln!("packs/dist fehlt: Test übersprungen");
        return;
    };
    let loaded = load_packs(&dist, true);
    assert!(loaded.problems.is_empty(), "Pakete mit Problemen: {:?}", loaded.problems);
    assert!(loaded.packs.len() >= 3, "{:?}", loaded.packs.iter().map(|p| &p.id).collect::<Vec<_>>());

    for pack in &loaded.packs {
        let tmp = tempfile::tempdir().unwrap();
        let store = SetupStore::new(tmp.path().join("setup"));
        // Alle Wurzeln des Pakets zeigen in einen Temp-Ordner
        let mut roots = BTreeMap::new();
        for f in &pack.files {
            roots.entry(f.root).or_insert_with(|| tmp.path().join("profile").join(f.root.as_str()));
        }
        let scope = ResolvedScope {
            scope_id: format!("test-{}", pack.id),
            program_id: pack.program_id.clone(),
            kind: if pack.program_id.is_some() { ScopeKind::UserProfile } else { ScopeKind::UserFonts },
            roots,
            installation_ids: vec![],
            unsupported: None,
            exe: Some(PathBuf::from("/usr/bin/blender")),
            install_kind: Some(InstallKind::System),
        };
        let mk = || {
            plan(&PlanInput {
                pack,
                scope: &scope,
                store: &store,
                os: Os::Linux,
                program_version: Some("5.3.4"),
                library_root: None,
                program_running: false,
            })
            .unwrap()
        };
        let fonts = RecordingFonts::default();
        let runner = FakeRunner::new().ok("extension install-file", "ok");
        let env = ApplyEnv { store: &store, runner: &runner, fonts: &fonts, job_id: "j" };
        let first = cypher_core::setup::apply::apply(
            mk(),
            &ApplySelection::default(),
            &env,
            &NoProgress,
            &CancellationToken::new(),
        )
        .unwrap();
        assert_eq!(first.status, SetupRecordStatus::Applied, "{}: {:?}", pack.id, first.failures);
        assert!(first.files_written > 0, "{} schrieb nichts", pack.id);
        let snapshot = tree(&tmp.path().join("profile"));
        // zweimal anwenden ändert nichts
        let again = cypher_core::setup::apply::apply(
            mk(),
            &ApplySelection::default(),
            &env,
            &NoProgress,
            &CancellationToken::new(),
        )
        .unwrap();
        assert_eq!(again.setup_id, first.setup_id, "{}", pack.id);
        assert_eq!(tree(&tmp.path().join("profile")), snapshot, "{}", pack.id);
        // Zurücknehmen räumt auf
        let report = undo(&first.setup_id, &store, &fonts).unwrap();
        assert!(report.kept_modified.is_empty(), "{}: {:?}", pack.id, report.kept_modified);
        assert!(
            tree(&tmp.path().join("profile")).is_empty(),
            "{}: {:?}",
            pack.id,
            tree(&tmp.path().join("profile")).keys().collect::<Vec<_>>()
        );
    }
}

#[test]
fn real_dist_packs_resolve_scopes_for_every_program_on_every_os() {
    let Some(dist) = dist_root() else { return };
    let loaded = load_packs(&dist, true);
    for os in [Os::Windows, Os::Macos, Os::Linux] {
        let known = match os {
            Os::Windows => cypher_core::platform::KnownDirs {
                home: Some("C:\\Users\\a".into()),
                appdata: Some("C:\\Users\\a\\AppData\\Roaming".into()),
                local_appdata: Some("C:\\Users\\a\\AppData\\Local".into()),
                ..Default::default()
            },
            _ => cypher_core::platform::KnownDirs { home: Some("/home/a".into()), ..Default::default() },
        };
        let env = RootsEnv { os, known, data_dir: "/data".into(), inkscape_profile_dir: None };
        for pack in &loaded.packs {
            let installs: Vec<SetupInstall> = pack
                .program_id
                .iter()
                .map(|p| SetupInstall {
                    id: format!("{p}-1"),
                    program_id: p.clone(),
                    kind: InstallKind::System,
                    version: Some(if p == "kdenlive" {
                        "26.8.2".into()
                    } else if p == "inkscape" {
                        "1.4.3".into()
                    } else {
                        "5.3.4".into()
                    }),
                    path: "/x".into(),
                    exe: None,
                })
                .collect();
            let scopes = resolve_scopes(pack, &installs, &env);
            assert_eq!(scopes.len(), 1, "{} auf {os}", pack.id);
            // jede Wurzel, die das Paket braucht, ist belegt
            for f in &pack.files {
                assert!(
                    scopes[0].roots.contains_key(&f.root),
                    "{}: Wurzel {} fehlt auf {os}",
                    pack.id,
                    f.root.as_str()
                );
            }
        }
    }
}
