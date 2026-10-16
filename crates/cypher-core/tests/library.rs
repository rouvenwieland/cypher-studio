//! Tests der Bibliothek: Einrichten, Scan, Abfragen, Begleitdateien, umbenannte Dateien, Konfliktkopien, Import,
//! Vorschaubilder, Austauschpakete, Überwachung. Alles in Temp-Ordnern.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::path::PathBuf;
use std::time::Instant;

use cypher_core::api::{
    Collection, ImportMeta, LibraryConflict, LibraryEntryStatus, LibraryKind, LibraryQuery, LibrarySort, MetaPatch,
    PackConflictPolicy, Patch,
};
use cypher_core::error::LibraryError;
use cypher_core::library::{Library, exchange, init};
use cypher_core::progress::NoProgress;
use tokio_util::sync::CancellationToken;

struct Env {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    cache: PathBuf,
    thumbs: PathBuf,
}

impl Env {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Cypher");
        std::fs::create_dir_all(&root).unwrap();
        let cache = tmp.path().join("cache/library-index");
        let thumbs = tmp.path().join("cache/thumbs");
        Env { _tmp: tmp, root, cache, thumbs }
    }

    fn file(&self, rel: &str, bytes: &[u8]) {
        let p = self.root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, bytes).unwrap();
    }

    fn open(&self) -> Library {
        Library::open(&self.root, &self.cache, &self.thumbs).unwrap()
    }

    fn scan(&self, lib: &mut Library) -> cypher_core::api::LibraryStatus {
        lib.scan(&NoProgress, &CancellationToken::new()).unwrap()
    }
}

fn png(w: u32, h: u32, rgba: [u8; 4]) -> Vec<u8> {
    let mut out = Vec::new();
    image::RgbaImage::from_pixel(w, h, image::Rgba(rgba))
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .unwrap();
    out
}

fn q() -> LibraryQuery {
    LibraryQuery {
        text: None,
        kinds: None,
        collections: None,
        tags: None,
        status: None,
        project_id: None,
        modified_after: None,
        only_conflicts: None,
        sort: None,
        offset: None,
        limit: None,
    }
}

fn patch() -> MetaPatch {
    MetaPatch {
        title: None,
        tags: None,
        collection: Patch::Absent,
        author: None,
        status: None,
        notes: None,
        colors: None,
        print_profile_id: Patch::Absent,
        garment_color_ids: None,
    }
}

#[test]
fn init_scan_and_status() {
    let env = Env::new();
    env.file("Motive/ratte.png", &png(40, 20, [1, 2, 3, 255]));
    env.file("Motive/logo.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>");
    env.file("3D/modell.glb", b"glb");
    env.file(
        "Projekte/Herbst/projekt.json",
        br#"{"formatVersion":1,"id":"proj-1","name":"Herbst","createdAt":"2026-01-01T00:00:00Z"}"#,
    );
    env.file("Projekte/Herbst/Motive/neon.png", &png(10, 10, [9, 9, 9, 255]));
    env.file("Motive/.DS_Store", b"x");
    env.file("Motive/halb.png.part", b"x");
    init(&env.root, "Cypher Kollektiv", &[]).unwrap();
    let mut lib = env.open();
    let st = env.scan(&mut lib);
    assert!(st.configured && st.initialized);
    assert_eq!(st.entry_count, 4, "Müll und projekt.json zählen nicht");
    assert_eq!(st.project_count, 1);
    assert_eq!(st.collections.len(), 3);
    assert!(st.last_scan_at.is_some());
    assert_eq!(st.conflict_count, 0);

    let page = lib.query(&q());
    assert_eq!(page.total, 4);
    let ratte = page.entries.iter().find(|e| e.file_name == "ratte.png").unwrap();
    assert_eq!((ratte.kind, ratte.width_px, ratte.height_px), (LibraryKind::Image, Some(40), Some(20)));
    assert!(ratte.sidecar_missing);
    assert_eq!(ratte.meta.title, "ratte");
    assert!(ratte.thumbnail_url.is_some());
    let neon = page.entries.iter().find(|e| e.file_name == "neon.png").unwrap();
    assert_eq!(neon.project_id.as_deref(), Some("proj-1"));
    assert_eq!(page.facets.kinds[&LibraryKind::Image], 2);
    assert_eq!(page.facets.kinds[&LibraryKind::Model3d], 1);
    assert_eq!(page.facets.kinds[&LibraryKind::Vector], 1);
}

#[test]
fn metadata_is_stored_in_sidecars_and_survives_a_new_scan_and_a_reopen() {
    let env = Env::new();
    env.file("Motive/ratte.png", &png(8, 8, [1, 2, 3, 255]));
    init(&env.root, "C", &[]).unwrap();
    let mut lib = env.open();
    env.scan(&mut lib);
    let id = lib.query(&q()).entries[0].id.clone();

    let updated = lib
        .update_meta(
            &id,
            &MetaPatch {
                title: Some("Neon Ratte".into()),
                tags: Some(vec!["Ratte".into(), "neon".into(), "ratte".into(), "  ".into()]),
                collection: Patch::Value("rauschen".into()),
                author: Some("Mo".into()),
                status: Some(LibraryEntryStatus::Approved),
                notes: Some("final".into()),
                colors: Some(vec!["#FF2BD6".into()]),
                print_profile_id: Patch::Value("shirtigo-tee-front".into()),
                garment_color_ids: Some(vec!["schwarz".into()]),
            },
        )
        .unwrap();
    assert_eq!(updated.meta.title, "Neon Ratte");
    assert_eq!(
        updated.meta.tags,
        vec!["Ratte", "neon"],
        "Doppelte (ohne Rücksicht auf Groß-/Kleinschreibung) und Leeres entfallen"
    );
    assert_eq!(updated.meta.colors, vec!["#ff2bd6"]);
    assert!(!updated.sidecar_missing);
    assert_eq!(updated.id, id, "die ID bleibt beim Anlegen der Begleitdatei stabil");

    // die Begleitdatei ist eine eigene Datei je Datei
    let sidecar = env.root.join(".cypher/meta/Motive/ratte.png.json");
    let json: serde_json::Value = serde_json::from_slice(&std::fs::read(&sidecar).unwrap()).unwrap();
    assert_eq!(json["id"], id.as_str());
    assert_eq!(json["title"], "Neon Ratte");
    assert_eq!(json["status"], "approved");
    assert_eq!(json["contentSha256"].as_str().unwrap().len(), 64);

    // neuer Scan und neues Öffnen sehen dieselben Daten
    env.scan(&mut lib);
    assert_eq!(lib.get_dto(&id).unwrap().meta.title, "Neon Ratte");
    let reopened = env.open();
    assert_eq!(reopened.status().entry_count, 1, "Index kommt aus dem Cache");
    assert_eq!(reopened.get_dto(&id).unwrap().meta.author, "Mo");

    // Patch mit null löscht Felder
    let cleared =
        lib.update_meta(&id, &MetaPatch { collection: Patch::Null, print_profile_id: Patch::Null, ..patch() }).unwrap();
    assert!(cleared.meta.collection.is_none() && cleared.meta.print_profile_id.is_none());
    assert_eq!(cleared.meta.title, "Neon Ratte", "nicht genannte Felder bleiben");
}

#[test]
fn invalid_patches_are_rejected() {
    let env = Env::new();
    env.file("a.png", &png(2, 2, [0, 0, 0, 255]));
    init(&env.root, "C", &[]).unwrap();
    let mut lib = env.open();
    env.scan(&mut lib);
    let id = lib.query(&q()).entries[0].id.clone();
    for bad in [
        MetaPatch { title: Some("  ".into()), ..patch() },
        MetaPatch { collection: Patch::Value("gibtsnicht".into()), ..patch() },
        MetaPatch { colors: Some(vec!["rot".into()]), ..patch() },
        MetaPatch { tags: Some(vec!["x".repeat(41)]), ..patch() },
        MetaPatch { notes: Some("x".repeat(5001)), ..patch() },
    ] {
        assert!(matches!(lib.update_meta(&id, &bad), Err(LibraryError::InvalidInput { .. })), "{bad:?}");
    }
    assert!(matches!(lib.update_meta("gibtsnicht", &patch()), Err(LibraryError::NotFound(_))));
    assert!(!env.root.join(".cypher/meta/a.png.json").exists(), "nichts geschrieben");
}

#[test]
fn query_filters_sorting_and_paging() {
    let env = Env::new();
    for (i, name) in ["alpha", "beta", "gamma", "delta"].iter().enumerate() {
        env.file(&format!("Motive/{name}.png"), &png(4 + i as u32, 4, [0, 0, 0, 255]));
    }
    env.file("3D/zeta.glb", b"glbglbglb");
    init(&env.root, "C", &[]).unwrap();
    let mut lib = env.open();
    env.scan(&mut lib);
    let ids: std::collections::BTreeMap<String, String> =
        lib.query(&q()).entries.iter().map(|e| (e.file_name.clone(), e.id.clone())).collect();
    lib.update_meta(
        &ids["alpha.png"],
        &MetaPatch {
            tags: Some(vec!["ratte".into(), "neon".into()]),
            collection: Patch::Value("rauschen".into()),
            status: Some(LibraryEntryStatus::Approved),
            ..patch()
        },
    )
    .unwrap();
    lib.update_meta(
        &ids["beta.png"],
        &MetaPatch {
            tags: Some(vec!["ratte".into()]),
            collection: Patch::Value("gold".into()),
            notes: Some("Sonderanfertigung".into()),
            ..patch()
        },
    )
    .unwrap();

    let by = |f: &dyn Fn(&mut LibraryQuery)| {
        let mut query = q();
        f(&mut query);
        lib.query(&query).entries.iter().map(|e| e.file_name.clone()).collect::<Vec<_>>()
    };
    assert_eq!(by(&|x| x.tags = Some(vec!["ratte".into()])).len(), 2);
    assert_eq!(
        by(&|x| x.tags = Some(vec!["RATTE".into(), "neon".into()])),
        ["alpha.png"],
        "alle Stichworte, ohne Groß-/Kleinschreibung"
    );
    assert_eq!(by(&|x| x.collections = Some(vec!["gold".into()])), ["beta.png"]);
    assert_eq!(by(&|x| x.status = Some(vec![LibraryEntryStatus::Approved])), ["alpha.png"]);
    assert_eq!(by(&|x| x.kinds = Some(vec![LibraryKind::Model3d])), ["zeta.glb"]);
    assert_eq!(by(&|x| x.text = Some("sonder".into())), ["beta.png"], "Suche in Notizen");
    assert_eq!(by(&|x| x.text = Some("MOTIVE gamma".into())), ["gamma.png"], "alle Wörter, Pfad zählt mit");
    assert!(by(&|x| x.text = Some("nirgends".into())).is_empty());
    assert_eq!(by(&|x| x.modified_after = Some("2999-01-01T00:00:00Z".into())).len(), 0);
    assert_eq!(by(&|x| x.modified_after = Some("2000-01-01T00:00:00Z".into())).len(), 5);

    assert_eq!(
        by(&|x| x.sort = Some(LibrarySort::NameAsc)),
        ["alpha.png", "beta.png", "delta.png", "gamma.png", "zeta.glb"]
    );
    let mut size_sorted = q();
    size_sorted.sort = Some(LibrarySort::SizeDesc);
    let sizes: Vec<u64> = lib.query(&size_sorted).entries.iter().map(|e| e.size).collect();
    assert!(sizes.windows(2).all(|w| w[0] >= w[1]), "{sizes:?}");
    let kind_sorted = by(&|x| x.sort = Some(LibrarySort::Kind));
    assert_eq!(kind_sorted.last().map(String::as_str), Some("zeta.glb"), "Bilder vor 3D");

    // Seiten
    let mut page = q();
    page.sort = Some(LibrarySort::NameAsc);
    page.limit = Some(2);
    page.offset = Some(1);
    let p = lib.query(&page);
    assert_eq!(p.total, 5);
    assert_eq!(p.offset, 1);
    assert_eq!(p.entries.iter().map(|e| e.file_name.as_str()).collect::<Vec<_>>(), ["beta.png", "delta.png"]);
    // Facetten zählen über alle Treffer, nicht nur die Seite
    assert_eq!(p.facets.kinds[&LibraryKind::Image], 4);
    assert_eq!(p.facets.tags["ratte"], 2);
    page.offset = Some(99);
    assert!(lib.query(&page).entries.is_empty());
}

#[test]
fn bulk_meta_adds_and_removes_tags_and_sets_the_collection() {
    let env = Env::new();
    env.file("a.png", &png(2, 2, [0, 0, 0, 255]));
    env.file("b.png", &png(2, 2, [1, 1, 1, 255]));
    init(&env.root, "C", &[]).unwrap();
    let mut lib = env.open();
    env.scan(&mut lib);
    let ids: Vec<String> = lib.query(&q()).entries.iter().map(|e| e.id.clone()).collect();
    lib.update_meta(&ids[0], &MetaPatch { tags: Some(vec!["alt".into(), "bleibt".into()]), ..patch() }).unwrap();
    let n = lib.bulk_meta(&ids, &["Neu".into()], &["ALT".into()], &Patch::Value("gold".into())).unwrap();
    assert_eq!(n, 2);
    for id in &ids {
        let e = lib.get_dto(id).unwrap();
        assert!(e.meta.tags.contains(&"Neu".to_owned()) && !e.meta.tags.iter().any(|t| t.eq_ignore_ascii_case("alt")));
        assert_eq!(e.meta.collection.as_deref(), Some("gold"));
    }
    // nichts zu ändern -> 0
    assert_eq!(lib.bulk_meta(&ids, &["neu".into()], &[], &Patch::Absent).unwrap(), 0);
    assert!(lib.bulk_meta(&["gibtsnicht".into()], &[], &[], &Patch::Absent).is_err());
}

#[test]
fn renamed_files_keep_their_metadata_through_the_content_hash() {
    let env = Env::new();
    env.file("Motive/alt.png", &png(6, 6, [5, 5, 5, 255]));
    init(&env.root, "C", &[]).unwrap();
    let mut lib = env.open();
    env.scan(&mut lib);
    let id = lib.query(&q()).entries[0].id.clone();
    lib.update_meta(&id, &MetaPatch { title: Some("Wichtig".into()), tags: Some(vec!["x".into()]), ..patch() })
        .unwrap();
    // außerhalb der App umbenannt (Sync-Werkzeug, Dateimanager)
    std::fs::create_dir_all(env.root.join("Archiv")).unwrap();
    std::fs::rename(env.root.join("Motive/alt.png"), env.root.join("Archiv/neu.png")).unwrap();
    env.scan(&mut lib);
    let page = lib.query(&q());
    assert_eq!(page.total, 1);
    let e = &page.entries[0];
    assert_eq!(e.rel_path, "Archiv/neu.png");
    assert_eq!(e.id, id, "dieselbe ID");
    assert_eq!(e.meta.title, "Wichtig");
    assert!(!e.sidecar_missing);
    assert!(env.root.join(".cypher/meta/Archiv/neu.png.json").exists());
    assert!(!env.root.join(".cypher/meta/Motive/alt.png.json").exists(), "alte Begleitdatei wurde mitgenommen");
}

#[test]
fn sync_conflict_copies_are_marked_and_counted_but_never_deleted() {
    let env = Env::new();
    env.file("Motive/ratte.png", &png(2, 2, [1, 1, 1, 255]));
    env.file("Motive/ratte.sync-conflict-20260101-120000-ABCDEFG.png", &png(2, 2, [2, 2, 2, 255]));
    env.file("Motive/katze (conflicted copy 2026-01-01).png", &png(2, 2, [3, 3, 3, 255]));
    init(&env.root, "C", &[]).unwrap();
    let mut lib = env.open();
    let st = env.scan(&mut lib);
    assert_eq!(st.conflict_count, 2);
    let mut only = q();
    only.only_conflicts = Some(true);
    let page = lib.query(&only);
    assert_eq!(page.total, 2);
    let copy = page.entries.iter().find(|e| e.file_name.contains("sync-conflict")).unwrap();
    assert_eq!(
        copy.conflict,
        Some(LibraryConflict::SyncConflictCopy { original_rel_path: Some("Motive/ratte.png".into()) })
    );
    assert!(env.root.join("Motive/ratte.sync-conflict-20260101-120000-ABCDEFG.png").exists());
}

#[test]
fn import_copies_files_creates_sidecars_and_never_overwrites() {
    let env = Env::new();
    init(&env.root, "C", &[]).unwrap();
    let outside = tempfile::tempdir().unwrap();
    let src = outside.path().join("Bild.png");
    std::fs::write(&src, png(12, 6, [7, 7, 7, 255])).unwrap();
    let glb = outside.path().join("m.glb");
    std::fs::write(&glb, b"glb").unwrap();
    let mut lib = env.open();
    let meta = ImportMeta {
        tags: Some(vec!["import".into()]),
        author: Some("Anna".into()),
        collection: Some("gold".into()),
        status: Some(LibraryEntryStatus::Approved),
    };
    let a = lib.import(&[src.clone(), glb], None, &meta, "Standard").unwrap();
    assert_eq!(a[0].rel_path, "Motive/Bild.png");
    assert_eq!(a[1].rel_path, "3D/m.glb", "Art bestimmt den Ordner");
    assert_eq!((a[0].width_px, a[0].height_px), (Some(12), Some(6)));
    assert_eq!(a[0].meta.author, "Anna");
    assert_eq!(a[0].meta.collection.as_deref(), Some("gold"));
    assert!(!a[0].sidecar_missing);
    assert!(env.root.join(".cypher/meta/Motive/Bild.png.json").is_file());
    // zweites Mal: Zähler statt Überschreiben
    let b = lib
        .import(
            std::slice::from_ref(&src),
            None,
            &ImportMeta { tags: None, author: None, collection: None, status: None },
            "Standard",
        )
        .unwrap();
    assert_eq!(b[0].rel_path, "Motive/Bild-2.png");
    assert_eq!(b[0].meta.author, "Standard");
    assert_eq!(b[0].meta.status, LibraryEntryStatus::Draft);
    // Unterordner
    let c = lib
        .import(
            std::slice::from_ref(&src),
            Some("Archiv/2026"),
            &ImportMeta { tags: None, author: None, collection: None, status: None },
            "x",
        )
        .unwrap();
    assert_eq!(c[0].rel_path, "Archiv/2026/Bild.png");
    // Unzulässige Ziele und Kollektionen
    assert!(
        lib.import(
            std::slice::from_ref(&src),
            Some(".cypher"),
            &ImportMeta { tags: None, author: None, collection: None, status: None },
            "x"
        )
        .is_err()
    );
    assert!(
        lib.import(
            std::slice::from_ref(&src),
            Some("../draussen"),
            &ImportMeta { tags: None, author: None, collection: None, status: None },
            "x"
        )
        .is_err()
    );
    assert!(
        lib.import(
            &[src],
            None,
            &ImportMeta { tags: None, author: None, collection: Some("nope".into()), status: None },
            "x"
        )
        .is_err()
    );
    assert_eq!(lib.status().entry_count, 4);
    // nach einem Scan sind es dieselben Einträge mit denselben IDs
    let ids_before: std::collections::BTreeSet<String> = lib.query(&q()).entries.iter().map(|e| e.id.clone()).collect();
    env.scan(&mut lib);
    let ids_after: std::collections::BTreeSet<String> = lib.query(&q()).entries.iter().map(|e| e.id.clone()).collect();
    assert_eq!(ids_before, ids_after);
}

#[test]
fn collections_can_be_replaced_and_are_validated() {
    let env = Env::new();
    init(&env.root, "C", &[]).unwrap();
    let mut lib = env.open();
    let st =
        lib.set_collections(&[Collection { id: "neu".into(), name: "Neu".into(), hex: "#123456".into() }]).unwrap();
    assert_eq!(st.collections.len(), 1);
    assert_eq!(env.open().status().collections[0].id, "neu", "steht in .cypher/library.json");
    assert!(lib.set_collections(&[Collection { id: "BAD".into(), name: "x".into(), hex: "#123456".into() }]).is_err());
    assert_eq!(lib.status().collections.len(), 1);
}

#[test]
fn thumbnails_are_made_on_demand_and_cleared() {
    let env = Env::new();
    env.file("Motive/gross.png", &png(1200, 600, [10, 20, 30, 255]));
    env.file("Motive/vektor.svg", br##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="#00ff00"/></svg>"##);
    env.file("3D/m.glb", b"glb");
    init(&env.root, "C", &[]).unwrap();
    let mut lib = env.open();
    env.scan(&mut lib);
    let by_name = |n: &str| lib.query(&q()).entries.into_iter().find(|e| e.file_name == n).unwrap();
    let png_entry = by_name("gross.png");
    let thumb = lib.thumbnail(&png_entry.id).unwrap();
    let img = image::open(&thumb).unwrap();
    assert_eq!((img.width(), img.height()), (512, 256));
    let svg = lib.thumbnail(&by_name("vektor.svg").id).unwrap();
    assert!(image::open(svg).is_ok());
    assert!(by_name("m.glb").thumbnail_url.is_none());
    assert!(lib.thumbnail(&by_name("m.glb").id).is_err());
    assert!(matches!(lib.thumbnail("gibtsnicht"), Err(LibraryError::NotFound(_))));
    lib.clear_thumbnails().unwrap();
    assert!(!thumb.exists());
    lib.clear_thumbnails().unwrap();
    assert!(lib.thumbnail(&png_entry.id).unwrap().exists(), "wird bei Bedarf neu erzeugt");
}

#[test]
fn path_of_is_confined_to_the_library() {
    let env = Env::new();
    env.file("Motive/a.png", &png(2, 2, [0, 0, 0, 255]));
    init(&env.root, "C", &[]).unwrap();
    let mut lib = env.open();
    env.scan(&mut lib);
    let id = lib.query(&q()).entries[0].id.clone();
    assert_eq!(lib.path_of(&id).unwrap(), env.root.join("Motive/a.png"));
    std::fs::remove_file(env.root.join("Motive/a.png")).unwrap();
    assert!(matches!(lib.path_of(&id), Err(LibraryError::NotFound(_))));
}

#[test]
fn cancelled_scan_changes_nothing() {
    let env = Env::new();
    env.file("a.png", &png(2, 2, [0, 0, 0, 255]));
    init(&env.root, "C", &[]).unwrap();
    let mut lib = env.open();
    let token = CancellationToken::new();
    token.cancel();
    assert!(matches!(lib.scan(&NoProgress, &token), Err(LibraryError::Cancelled)));
    assert_eq!(lib.status().entry_count, 0);
}

#[test]
fn exchange_packs_through_the_library_api() {
    let env = Env::new();
    env.file("Motive/a.png", &png(3, 3, [1, 2, 3, 255]));
    env.file("Motive/b.png", &png(4, 4, [4, 5, 6, 255]));
    init(&env.root, "Quelle", &[]).unwrap();
    let mut lib = env.open();
    env.scan(&mut lib);
    let a_id = lib.id_of_path("Motive/a.png").unwrap().to_owned();
    lib.update_meta(&a_id, &MetaPatch { title: Some("Titel A".into()), ..patch() }).unwrap();
    let rels = vec!["Motive/a.png".to_owned(), "Motive/b.png".to_owned()];
    let out = tempfile::tempdir().unwrap();
    let pack = out.path().join("t.cypherpack");
    exchange::export(&env.root, &rels, &pack, "Drop", "Mo", true, "0.1.0", &NoProgress, &CancellationToken::new())
        .unwrap();

    let target = Env::new();
    init(&target.root, "Ziel", &[]).unwrap();
    let preview = exchange::inspect(&pack, &target.root).unwrap();
    assert_eq!(preview.entries.len(), 2);
    let report =
        exchange::import(&target.root, &pack, PackConflictPolicy::Skip, &NoProgress, &CancellationToken::new())
            .unwrap();
    assert_eq!(report.imported, 2);
    let mut tlib = target.open();
    target.scan(&mut tlib);
    let imported = tlib.query(&q()).entries.into_iter().find(|e| e.file_name == "a.png").unwrap();
    assert_eq!(imported.meta.title, "Titel A", "Begleitdatei kam mit");
    assert_eq!(tlib.status().entry_count, 2);
}

#[test]
fn watcher_reports_changes_after_a_quiet_second() {
    let env = Env::new();
    init(&env.root, "C", &[]).unwrap();
    let lib = env.open();
    let (tx, rx) = std::sync::mpsc::channel::<usize>();
    let Ok(handle) = lib.watch(move |n| {
        let _ = tx.send(n);
    }) else {
        return;
    };
    std::thread::sleep(std::time::Duration::from_millis(300));
    env.file("Motive/neu.png", &png(2, 2, [0, 0, 0, 255]));
    let n = rx.recv_timeout(std::time::Duration::from_secs(10)).expect("Meldung");
    assert!(n >= 1);
    drop(handle);
}

#[test]
#[cfg_attr(debug_assertions, ignore = "Leistungsprobe nur im Release-Build aussagekräftig (cargo test --release)")]
fn query_over_5000_entries_is_fast() {
    let env = Env::new();
    for i in 0..5000 {
        env.file(&format!("Motive/Serie {}/bild-{i:05}.png", i % 50), b"x");
    }
    init(&env.root, "C", &[]).unwrap();
    let mut lib = env.open();
    let started = Instant::now();
    env.scan(&mut lib);
    eprintln!("Scan von 5000 Dateien: {:?}", started.elapsed());
    let mut query = q();
    query.text = Some("serie 7 bild".into());
    query.sort = Some(LibrarySort::NameAsc);
    let started = Instant::now();
    let mut total = 0;
    for _ in 0..20 {
        total = lib.query(&query).total;
    }
    let per_query = started.elapsed() / 20;
    eprintln!("Abfrage: {per_query:?} ({total} Treffer)");
    assert!(per_query.as_millis() < 30, "zu langsam: {per_query:?}");
}
