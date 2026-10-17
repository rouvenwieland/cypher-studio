//! Katalog: eingebettete Daten, Schema, Signatur, Prüfregeln, Auswahl je Plattform, Aktualisierung mit Cache,
//! Rollback-Schutz und Quellenwechsel.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::io::Cursor;
use std::sync::Arc;

use common::*;
use cypher_core::api::{Arch, CatalogSourceKind, Os, ReleaseChannel};
use cypher_core::catalog::{self, Catalog, CatalogStore, CatalogWarning, RefreshOutcome};
use cypher_core::download::{HostPolicy, HostRule, HttpClient, NetLog, RedirectPolicy};
use cypher_core::error::CatalogError;
use cypher_core::platform::{AppDirs, PlatformInfo};
use cypher_core::verify::TrustedKeys;
use tokio_util::sync::CancellationToken;

fn repo_file(rel: &str) -> std::path::PathBuf {
    cypher_core::util::repo_root().join(rel)
}

fn app_version() -> semver::Version {
    semver::Version::new(0, 1, 0)
}

fn real_catalog() -> Catalog {
    serde_json::from_slice(catalog::EMBEDDED_CATALOG_JSON).unwrap()
}

fn embedded_policy() -> HostPolicy {
    HostPolicy::embedded()
}

// ---------------------------------------------------------------------------------------------
// Eingebettete Daten
// ---------------------------------------------------------------------------------------------

#[test]
fn embedded_catalog_is_signed_with_an_embedded_key_and_valid() {
    let keys = TrustedKeys::embedded().unwrap();
    assert!(!keys.is_empty(), "mindestens ein eingebetteter Katalogschlüssel");
    let loaded = catalog::embedded(&keys, &embedded_policy(), &app_version()).unwrap();
    assert_eq!(loaded.source, CatalogSourceKind::Embedded);
    assert!(loaded.catalog.sequence >= 1);
    let ids: Vec<_> = loaded.catalog.programs.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(ids, ["blender", "krita", "inkscape", "kdenlive"]);
    assert_eq!(loaded.catalog.print_profiles.len(), 10);
}

#[test]
fn embedded_catalog_matches_the_json_schema() {
    let schema: serde_json::Value =
        serde_json::from_slice(&std::fs::read(repo_file("catalog/schema/catalog.schema.json")).unwrap()).unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    let doc: serde_json::Value = serde_json::from_slice(catalog::EMBEDDED_CATALOG_JSON).unwrap();
    let errors: Vec<String> = validator.iter_errors(&doc).map(|e| format!("{} bei {}", e, e.instance_path)).collect();
    assert!(errors.is_empty(), "Schema-Verstöße: {errors:#?}");

    // Das Schema fängt echte Fehler: falsche Prüfsumme, unbekannter Schlüssel, fremdes Feld
    let mut bad = doc.clone();
    bad["programs"][0]["releases"][0]["artifacts"][0]["sha256"] = serde_json::json!("XYZ");
    assert!(!validator.is_valid(&bad));
    let mut bad = doc.clone();
    bad["programs"][0]["setup"]["roots"] = serde_json::json!(["homeDirectory"]);
    assert!(!validator.is_valid(&bad));
    let mut bad = doc.clone();
    bad["programs"][0]["releases"][0]["artifacts"][0]["launch"]["exe"] = serde_json::json!("../evil.exe");
    assert!(!validator.is_valid(&bad));
    let mut bad = doc;
    bad["unbekannt"] = serde_json::json!(true);
    assert!(!validator.is_valid(&bad));
}

#[test]
fn blender_checksums_are_the_official_values() {
    // Aus https://download.blender.org/release/Blender5.2/blender-5.2.2.sha256 bzw. Blender4.5/blender-4.5.14.sha256 (16.10.2026)
    let c = real_catalog();
    let blender = c.program("blender").unwrap();
    let find = |version: &str, os: Os| {
        blender
            .releases
            .iter()
            .find(|r| r.version == version)
            .unwrap()
            .artifacts
            .iter()
            .find(|a| a.os == os)
            .unwrap()
            .sha256
            .clone()
    };
    assert_eq!(find("5.2.2", Os::Windows), "3849d17a682cba006075aaa3f3597ecb5c9c30ec31035b2e092c53e40679b535");
    assert_eq!(find("5.2.2", Os::Linux), "84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168");
    assert_eq!(find("5.2.2", Os::Macos), "dc4125399b8bfefe283cc1624d6cfc7809d1cac20ace51072127eb371f31f210");
    assert_eq!(find("4.5.14", Os::Macos), "613e73339e97bd113adeeb28d9155beeacf2df7119ee4dbd6bdce234843645f6");
}

fn pick(c: &Catalog, program: &str, os: Os, arch: Arch) -> Result<(String, String), CatalogError> {
    c.release_for(program, None, None, &PlatformInfo::fixed(os, arch))
        .map(|s| (s.release.version.clone(), s.artifact.file_name.clone()))
}

#[test]
fn every_supported_platform_gets_every_program() {
    let c = real_catalog();
    for (os, arch) in
        [(Os::Windows, Arch::X86_64), (Os::Linux, Arch::X86_64), (Os::Macos, Arch::Aarch64), (Os::Macos, Arch::X86_64)]
    {
        for program in ["blender", "krita", "inkscape", "kdenlive"] {
            assert!(pick(&c, program, os, arch).is_ok(), "{program} fehlt für {os}/{arch}");
        }
    }
    // Intel-Mac: Blender 4.5 LTS; sonst 5.2.2
    assert_eq!(pick(&c, "blender", Os::Macos, Arch::X86_64).unwrap().0, "4.5.14");
    assert_eq!(pick(&c, "blender", Os::Macos, Arch::Aarch64).unwrap().0, "5.2.2");
    assert_eq!(pick(&c, "blender", Os::Windows, Arch::X86_64).unwrap().1, "blender-5.2.2-windows-x64.zip");
    assert_eq!(pick(&c, "blender", Os::Linux, Arch::X86_64).unwrap().1, "blender-5.2.2-linux-x64.tar.xz");
    // Krita-dmg ist universal und passt auf beide Architekturen
    assert_eq!(
        pick(&c, "krita", Os::Macos, Arch::X86_64).unwrap().1,
        pick(&c, "krita", Os::Macos, Arch::Aarch64).unwrap().1
    );
    // nicht unterstützt
    assert!(matches!(pick(&c, "blender", Os::Linux, Arch::Aarch64), Err(CatalogError::NoArtifact { .. })));
    assert!(matches!(pick(&c, "krita", Os::Windows, Arch::Aarch64), Err(CatalogError::NoArtifact { .. })));
    let p = PlatformInfo::fixed(Os::Windows, Arch::X86_64);
    assert!(c.release_for("blender", None, Some(ReleaseChannel::Preview), &p).is_err());
}

#[test]
fn the_pgp_signed_krita_appimage_carries_its_key() {
    let c = real_catalog();
    let sel = c.release_for("krita", None, None, &PlatformInfo::fixed(Os::Linux, Arch::X86_64)).unwrap();
    let sig = sel.artifact.signature.as_ref().unwrap();
    assert!(sig.enforce);
    assert_eq!(sig.fingerprints, ["E9FB29E74ADEACC5E3035B8AB69EB4CF7468332F"]);
    assert!(sig.public_keys[0].contains("BEGIN PGP PUBLIC KEY BLOCK"));
    // Inkscape: schwache Upstream-Signatur wird nur protokolliert, die Prüfsumme ist von der Pflege festgeschrieben
    let sel = c.release_for("inkscape", None, None, &PlatformInfo::fixed(Os::Linux, Arch::X86_64)).unwrap();
    assert!(!sel.artifact.signature.as_ref().unwrap().enforce);
    assert_eq!(sel.artifact.checksum_origin, catalog::ChecksumOrigin::CypherPinned);
}

// ---------------------------------------------------------------------------------------------
// Signatur und Prüfregeln
// ---------------------------------------------------------------------------------------------

fn test_keypair() -> (minisign::KeyPair, TrustedKeys) {
    let pair = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
    let keys = TrustedKeys::from_strs(&[&pair.pk.to_box().unwrap().to_string()]).unwrap();
    (pair, keys)
}

fn sign(json: &[u8], pair: &minisign::KeyPair, comment: &str) -> String {
    minisign::sign(Some(&pair.pk), &pair.sk, Cursor::new(json), Some(comment), None).unwrap().to_string()
}

#[test]
fn signature_rules_are_enforced() {
    let json = serde_json::to_vec_pretty(&real_catalog()).unwrap();
    let (pair, keys) = test_keypair();
    let sig = sign(&json, &pair, "seq=1");
    assert!(catalog::parse_and_verify(&json, &sig, &keys).is_ok());

    // verändert → Signatur ungültig
    let mut tampered = json.clone();
    tampered[10] ^= 1;
    assert!(matches!(catalog::parse_and_verify(&tampered, &sig, &keys), Err(CatalogError::Signature(_))));
    // fremder Schlüssel → unbekannt
    let (_, other_keys) = test_keypair();
    assert!(matches!(catalog::parse_and_verify(&json, &sig, &other_keys), Err(CatalogError::UnknownKey(_))));
    // Müll
    assert!(matches!(catalog::parse_and_verify(&json, "kein minisign", &keys), Err(CatalogError::Signature(_))));
    // zu groß
    let big = vec![b' '; (catalog::MAX_CATALOG_BYTES + 1) as usize];
    assert!(matches!(catalog::parse_and_verify(&big, &sig, &keys), Err(CatalogError::Parse(_))));
    // gültig signiert, aber kein Katalog
    let junk = b"{ \"x\": 1 }".to_vec();
    let junk_sig = sign(&junk, &pair, "seq=1");
    assert!(matches!(catalog::parse_and_verify(&junk, &junk_sig, &keys), Err(CatalogError::Parse(_))));
}

fn mutated(f: impl FnOnce(&mut Catalog)) -> Result<Vec<CatalogWarning>, CatalogError> {
    let mut c = real_catalog();
    f(&mut c);
    catalog::validate(&c, &embedded_policy(), &app_version())
}

fn first_artifact(c: &mut Catalog) -> &mut catalog::ArtifactSpec {
    &mut c.programs[0].releases[0].artifacts[0]
}

#[test]
fn validation_rejects_dangerous_or_broken_data() {
    assert!(mutated(|_| {}).unwrap().is_empty());

    // Host nicht in der Liste
    let err = mutated(|c| first_artifact(c).url = "https://evil.example/blender.zip".into()).unwrap_err();
    assert!(matches!(err, CatalogError::HostNotAllowed(ref h) if h == "evil.example"), "{err}");
    // kein https
    assert!(matches!(
        mutated(|c| first_artifact(c).url = "http://download.blender.org/x.zip".into()),
        Err(CatalogError::Schema { .. })
    ));
    // Prüfsumme/Größe
    assert!(mutated(|c| first_artifact(c).sha256 = "abc".into()).is_err());
    assert!(mutated(|c| first_artifact(c).sha256 = "A".repeat(64)).is_err(), "Großbuchstaben sind nicht kanonisch");
    assert!(mutated(|c| first_artifact(c).size = 0).is_err());
    assert!(mutated(|c| first_artifact(c).unpacked_size_max = 1).is_err());
    // Pfade
    assert!(mutated(|c| first_artifact(c).launch.exe = "../../evil.exe".into()).is_err());
    assert!(mutated(|c| first_artifact(c).launch.exe = "C:\\Windows\\x.exe".into()).is_err());
    assert!(mutated(|c| first_artifact(c).launch.portable_marker = Some("/etc".into())).is_err());
    assert!(mutated(|c| first_artifact(c).launch.args = vec!["; rm -rf /".into()]).is_err());
    assert!(mutated(|c| first_artifact(c).file_name = "a/b.zip".into()).is_err());
    assert!(mutated(|c| first_artifact(c).strip_components = 9).is_err());
    // Doppelte Artefakte je OS/Arch, IDs, Versionen
    assert!(
        mutated(|c| {
            let dup = c.programs[0].releases[0].artifacts[0].clone();
            c.programs[0].releases[0].artifacts.push(dup);
        })
        .is_err()
    );
    assert!(mutated(|c| c.programs[1].id = "blender".into()).is_err());
    assert!(mutated(|c| c.programs[0].id = "Blender 5".into()).is_err());
    assert!(mutated(|c| c.programs[0].releases[0].version = "5".into()).is_err());
    // Signatur ohne Schlüssel
    assert!(
        mutated(|c| c.programs[1].releases[0].artifacts[2].signature.as_mut().unwrap().public_keys.clear()).is_err()
    );
    // Zeiten
    assert!(mutated(|c| c.expires_at = c.generated_at.clone()).is_err());
    assert!(mutated(|c| c.generated_at = "gestern".into()).is_err());
    assert!(mutated(|c| c.sequence = 0).is_err());
}

#[test]
fn versions_and_expiry_are_handled_softly_or_strictly_as_documented() {
    // Zu neues Schema oder zu neue App-Anforderung → Incompatible
    assert!(matches!(mutated(|c| c.schema_version = 2), Err(CatalogError::Incompatible { schema: 2, .. })));
    assert!(matches!(mutated(|c| c.min_app_version = "9.0.0".into()), Err(CatalogError::Incompatible { .. })));
    // Abgelaufen: nur eine Warnung
    let warnings = mutated(|c| {
        c.generated_at = "2020-01-01T00:00:00Z".into();
        c.expires_at = "2020-06-01T00:00:00Z".into();
    })
    .unwrap();
    assert!(matches!(warnings.as_slice(), [CatalogWarning::Expired { .. }]));
}

// ---------------------------------------------------------------------------------------------
// Aktualisierung mit lokalem Server
// ---------------------------------------------------------------------------------------------

/// Der echte Katalog, aber mit Adressen auf den Test-Server (http gegen 127.0.0.1) und eigener Sequenz.
fn local_catalog_json(port: u16, sequence: u64) -> Vec<u8> {
    let mut c = real_catalog();
    c.sequence = sequence;
    for p in &mut c.programs {
        for r in &mut p.releases {
            for a in &mut r.artifacts {
                a.url = format!("http://127.0.0.1:{port}/art/{}", a.file_name);
                a.checksum_source = format!("http://127.0.0.1:{port}/art/{}.sha256", a.file_name);
                if let Some(s) = &mut a.signature {
                    s.url = format!("http://127.0.0.1:{port}/art/{}.sig", a.file_name);
                }
            }
        }
    }
    serde_json::to_vec_pretty(&c).unwrap()
}

struct Harness {
    server: TestServer,
    http: HttpClient,
    pair: minisign::KeyPair,
    keys: TrustedKeys,
    dirs: AppDirs,
    _tmp: tempfile::TempDir,
}

impl Harness {
    async fn new() -> Self {
        let server = TestServer::start(Behavior::new(vec![])).await;
        let http = HttpClient::new(
            "test",
            Arc::new(HostPolicy::for_test(&[HostRule {
                host: "127.0.0.1",
                redirects: RedirectPolicy::WithinAllowlist,
            }])),
            Arc::new(NetLog::new(None)),
        )
        .unwrap();
        let (pair, keys) = test_keypair();
        let tmp = tempfile::tempdir().unwrap();
        let dirs = AppDirs::for_test(tmp.path());
        Harness { server, http, pair, keys, dirs, _tmp: tmp }
    }

    /// Veröffentlicht einen Katalog unter `/files/<slot>/catalog.json`.
    fn publish(&self, slot: &str, sequence: u64) {
        let json = local_catalog_json(self.server.addr.port(), sequence);
        let sig = sign(&json, &self.pair, &format!("seq={sequence}"));
        self.server.put_file(&format!("{slot}/catalog.json"), json);
        self.server.put_file(&format!("{slot}/catalog.json.minisig"), sig);
    }

    fn url(&self, slot: &str) -> url::Url {
        self.server.url(&format!("/files/{slot}/catalog.json"))
    }

    /// Eingebetteten Katalog durch den signierten Test-Katalog ersetzen geht nicht (er ist eingebettet); der Store
    /// startet deshalb mit dem echten eingebetteten Katalog (Sequenz 1) und eigenen Schlüsseln: dafür braucht es
    /// beide Schlüssel.
    fn store(&self, highest_seen: u64) -> CatalogStore {
        let embedded_keys = TrustedKeys::embedded().unwrap();
        let mut texts: Vec<String> = catalog::EMBEDDED_KEYS.iter().map(|s| s.to_string()).collect();
        texts.push(self.pair.pk.to_box().unwrap().to_string());
        let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
        drop(embedded_keys);
        let keys = TrustedKeys::from_strs(&refs).unwrap();
        let _ = &self.keys;
        // Eingebettete Hosts plus der Test-Server (der zwischengespeicherte Test-Katalog zeigt auf 127.0.0.1)
        let mut rules = cypher_core::download::EMBEDDED_HOSTS.to_vec();
        rules.push(HostRule { host: "127.0.0.1", redirects: RedirectPolicy::WithinAllowlist });
        CatalogStore::load_startup(&self.dirs, keys, &HostPolicy::for_test(&rules), app_version(), highest_seen)
            .unwrap()
    }
}

#[tokio::test]
async fn refresh_takes_a_newer_signed_catalog_and_caches_it() {
    let h = Harness::new().await;
    h.publish("a", 5);
    let store = h.store(0);
    assert_eq!(store.current().catalog.sequence, 1, "Start mit dem eingebetteten Katalog");
    assert_eq!(store.current().source, CatalogSourceKind::Embedded);

    let outcome = store.refresh_from(&h.http, &[h.url("a")], &CancellationToken::new()).await.unwrap();
    assert_eq!(outcome, RefreshOutcome::Updated { sequence: 5 });
    assert_eq!(store.current().catalog.sequence, 5);
    assert_eq!(store.current().source, CatalogSourceKind::Remote);
    assert_eq!(store.highest_seen(), 5);
    let status = store.status();
    assert_eq!(status.sequence, 5);
    assert!(status.last_error.is_none() && status.last_check_at.is_some());
    assert_eq!(status.source_url.as_deref(), Some(h.url("a").as_str()));

    // zweiter Lauf: unverändert
    assert_eq!(
        store.refresh_from(&h.http, &[h.url("a")], &CancellationToken::new()).await.unwrap(),
        RefreshOutcome::Unchanged
    );

    // nächster Start: der Cache gewinnt gegen den eingebetteten Katalog
    let restarted = h.store(5);
    assert_eq!(restarted.current().catalog.sequence, 5);
    assert_eq!(restarted.current().source, CatalogSourceKind::Cache);
}

#[tokio::test]
async fn rollback_is_rejected_and_the_old_catalog_stays() {
    let h = Harness::new().await;
    h.publish("neu", 7);
    h.publish("alt", 3);
    let store = h.store(0);
    store.refresh_from(&h.http, &[h.url("neu")], &CancellationToken::new()).await.unwrap();
    let err = store.refresh_from(&h.http, &[h.url("alt")], &CancellationToken::new()).await.unwrap_err();
    assert!(matches!(err, CatalogError::Rollback { current: 7, offered: 3 }), "{err}");
    assert_eq!(store.current().catalog.sequence, 7);
    assert!(matches!(
        store.status().last_error,
        Some(cypher_core::api::AppError::CatalogRollback { current_sequence: 7, offered_sequence: 3 })
    ));

    // auch nach einem Neustart: die höchste gesehene Sequenz steht in state.json (hier als Parameter)
    let fresh = h.store(7);
    assert!(matches!(
        fresh.refresh_from(&h.http, &[h.url("alt")], &CancellationToken::new()).await,
        Err(CatalogError::Rollback { .. })
    ));
}

#[tokio::test]
async fn bad_signatures_and_unknown_keys_never_replace_the_catalog() {
    let h = Harness::new().await;
    // fremd signiert
    let stranger = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
    let json = local_catalog_json(h.server.addr.port(), 9);
    h.server.put_file("fremd/catalog.json", json.clone());
    h.server.put_file("fremd/catalog.json.minisig", sign(&json, &stranger, "seq=9"));
    // richtig signiert, danach verändert
    h.publish("kaputt", 9);
    let mut tampered = h.server.behavior.files.lock().unwrap().get("kaputt/catalog.json").cloned().unwrap();
    tampered[20] ^= 0x01;
    h.server.put_file("kaputt/catalog.json", tampered);

    let store = h.store(0);
    let cancel = CancellationToken::new();
    assert!(matches!(store.refresh_from(&h.http, &[h.url("fremd")], &cancel).await, Err(CatalogError::UnknownKey(_))));
    assert!(matches!(store.refresh_from(&h.http, &[h.url("kaputt")], &cancel).await, Err(CatalogError::Signature(_))));
    assert_eq!(store.current().catalog.sequence, 1);
    assert!(!h.dirs.catalog_cache().join("catalog.json").exists(), "nichts Ungeprüftes im Cache");
}

#[tokio::test]
async fn next_source_is_tried_when_the_first_fails() {
    let h = Harness::new().await;
    h.publish("zweite", 4);
    let store = h.store(0);
    let urls = [h.server.url("/files/gibt-es-nicht/catalog.json"), h.url("zweite")];
    assert_eq!(
        store.refresh_from(&h.http, &urls, &CancellationToken::new()).await.unwrap(),
        RefreshOutcome::Updated { sequence: 4 }
    );
    // Alle Quellen kaputt → Fehler der aussagekräftigsten Art, Katalog bleibt
    let err = store
        .refresh_from(&h.http, &[h.server.url("/files/x/catalog.json")], &CancellationToken::new())
        .await
        .unwrap_err();
    assert!(matches!(err, CatalogError::Download(_)), "{err}");
    assert_eq!(store.current().catalog.sequence, 4);
}

#[tokio::test]
async fn incompatible_catalogs_are_reported_as_such() {
    let h = Harness::new().await;
    let mut c = real_catalog();
    c.sequence = 10;
    c.min_app_version = "9.0.0".into();
    for p in &mut c.programs {
        for r in &mut p.releases {
            for a in &mut r.artifacts {
                a.url = format!("http://127.0.0.1:{}/art/{}", h.server.addr.port(), a.file_name);
                a.checksum_source = a.url.clone();
                a.signature = None;
            }
        }
    }
    let json = serde_json::to_vec(&c).unwrap();
    h.server.put_file("neu/catalog.json", json.clone());
    h.server.put_file("neu/catalog.json.minisig", sign(&json, &h.pair, "seq=10"));
    let store = h.store(0);
    let err = store.refresh_from(&h.http, &[h.url("neu")], &CancellationToken::new()).await.unwrap_err();
    assert!(matches!(err, CatalogError::Incompatible { .. }), "{err}");
}

#[test]
fn a_corrupt_cache_is_ignored() {
    let tmp = tempfile::tempdir().unwrap();
    let dirs = AppDirs::for_test(tmp.path());
    std::fs::create_dir_all(dirs.catalog_cache()).unwrap();
    std::fs::write(dirs.catalog_cache().join("catalog.json"), b"{ kaputt").unwrap();
    std::fs::write(dirs.catalog_cache().join("catalog.json.minisig"), b"x").unwrap();
    let store =
        CatalogStore::load_startup(&dirs, TrustedKeys::embedded().unwrap(), &embedded_policy(), app_version(), 0)
            .unwrap();
    assert_eq!(store.current().source, CatalogSourceKind::Embedded);
}
