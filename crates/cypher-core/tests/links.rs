//! Regressionstests zum Sicherheitsbefund M1/M2: Schreibwege in Bibliothek und Projekten folgen keinem Symlink und keiner
//! Junction, `.cypher` ist in jeder Schreibweise gesperrt. Läuft auf Unix mit Symlinks, auf Windows mit Junctions.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use cypher_core::api::{
    ImportMeta, ModuleKind, ProjectDocument, ProjectDocumentData, ProjectFolder, SocialDocument, SocialExportFormat,
    SocialFormat,
};
use cypher_core::error::{LibraryError, PathError, ProjectError};
use cypher_core::library::{Library, init};
use cypher_core::projects::{self, NewFileContent};

/// Legt `link` als Verknüpfung auf den Ordner `target` an (Symlink oder Junction).
fn make_dir_link(target: &Path, link: &Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    {
        let out =
            std::process::Command::new("cmd").arg("/C").arg("mklink").arg("/J").arg(link).arg(target).output().unwrap();
        assert!(out.status.success(), "mklink: {}", String::from_utf8_lossy(&out.stdout));
    }
}

fn files_in(dir: &Path) -> Vec<PathBuf> {
    walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .map(walkdir::DirEntry::into_path)
        .collect()
}

struct Env {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    outside: PathBuf,
    cache: PathBuf,
    thumbs: PathBuf,
}

impl Env {
    fn new() -> Env {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Cypher");
        let outside = tmp.path().join("ausserhalb");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let cache = tmp.path().join("cache/library-index");
        let thumbs = tmp.path().join("cache/thumbs");
        Env { _tmp: tmp, root, outside, cache, thumbs }
    }

    /// Eine eingerichtete Bibliothek; `folder` wird danach durch einen Link nach außen ersetzt.
    fn library_with_link(&self, folder: &str) -> Library {
        init(&self.root, "Test", &[]).unwrap();
        let path = self.root.join(folder);
        if path.exists() {
            std::fs::remove_dir_all(&path).unwrap();
        }
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        make_dir_link(&self.outside, &path);
        Library::open(&self.root, &self.cache, &self.thumbs).unwrap()
    }
}

fn no_meta() -> ImportMeta {
    ImportMeta { tags: None, author: None, collection: None, status: None }
}

fn source_file(env: &Env, name: &str) -> PathBuf {
    let p = env._tmp.path().join("quelle").join(name);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(&p, b"inhalt").unwrap();
    p
}

#[test]
fn library_import_into_the_default_folder_refuses_a_link() {
    // Befund M1: `Motive` ist ein Link nach draußen; der Import in den Standardordner schrieb dorthin
    let env = Env::new();
    let mut lib = env.library_with_link("Motive");
    let src = source_file(&env, "Bild.png");
    let r = lib.import(&[src], None, &no_meta(), "x");
    assert!(matches!(r, Err(LibraryError::Path(PathError::LinkInPath))), "{r:?}");
    assert!(files_in(&env.outside).is_empty(), "außerhalb liegt {:?}", files_in(&env.outside));
}

#[test]
fn library_import_into_a_linked_subfolder_refuses_it() {
    let env = Env::new();
    let mut lib = env.library_with_link("Archiv");
    let src = source_file(&env, "Bild.png");
    for sub in ["Archiv", "Archiv/2026"] {
        let r = lib.import(std::slice::from_ref(&src), Some(sub), &no_meta(), "x");
        assert!(matches!(r, Err(LibraryError::Path(PathError::LinkInPath))), "{sub}: {r:?}");
    }
    assert!(files_in(&env.outside).is_empty());
    // ein normaler Unterordner geht weiterhin
    let ok = lib.import(&[src], Some("Neu/Unter"), &no_meta(), "x").unwrap();
    assert_eq!(ok[0].rel_path, "Neu/Unter/Bild.png");
}

#[test]
fn library_import_into_the_meta_folder_is_refused_in_every_spelling() {
    let env = Env::new();
    init(&env.root, "Test", &[]).unwrap();
    let mut lib = Library::open(&env.root, &env.cache, &env.thumbs).unwrap();
    let src = source_file(&env, "Bild.png");
    for sub in [".cypher", ".CYPHER", ".Cypher/tmp", ".cypher\\tmp", "CYPHER~1", "/.cypher/", "\\.CYPHER"] {
        let r = lib.import(std::slice::from_ref(&src), Some(sub), &no_meta(), "x");
        assert!(r.is_err(), "{sub:?} wurde angenommen");
    }
    assert!(!files_in(&env.root).iter().any(|p| p.file_name().is_some_and(|n| n == "Bild.png")));
}

#[test]
fn library_import_writes_the_sidecar_inside_not_through_a_linked_meta_folder() {
    // Das Anlegen der Begleitdatei (`.cypher/meta/...`) ist ein eigener Schreibweg
    let env = Env::new();
    init(&env.root, "Test", &[]).unwrap();
    let mut lib = Library::open(&env.root, &env.cache, &env.thumbs).unwrap();
    std::fs::remove_dir_all(env.root.join(".cypher")).unwrap();
    make_dir_link(&env.outside, &env.root.join(".cypher"));
    let src = source_file(&env, "Bild.png");
    let r = lib.import(&[src], None, &no_meta(), "x");
    assert!(r.is_err(), "{r:?}");
    assert!(files_in(&env.outside).is_empty(), "außerhalb liegt {:?}", files_in(&env.outside));
}

#[test]
fn library_init_refuses_linked_standard_folders() {
    let env = Env::new();
    make_dir_link(&env.outside, &env.root.join("Motive"));
    assert!(init(&env.root, "Test", &[]).is_err());
    assert!(files_in(&env.outside).is_empty());
}

fn new_project(env: &Env, name: &str) -> PathBuf {
    let (project, dir) = projects::create(&env.root, false, name, None, "tester").unwrap();
    assert_eq!(project.name, name);
    dir
}

#[test]
fn project_writes_refuse_links_inside_the_project_folder() {
    let env = Env::new();
    let dir = new_project(&env, "Drop");
    let replace_with_link = |name: &str| {
        let path = dir.join(name);
        std::fs::remove_dir_all(&path).unwrap();
        make_dir_link(&env.outside, &path);
    };

    // neue Datei
    replace_with_link("Motive");
    let r = projects::new_file(&dir, ProjectFolder::Motive, "kra", "bild", &NewFileContent::Bytes(b"x".to_vec()));
    assert!(matches!(r, Err(ProjectError::Path(PathError::LinkInPath))), "{r:?}");

    // Datei hinzufügen
    replace_with_link("3D");
    let src = source_file(&env, "modell.glb");
    let r = projects::add_asset(&dir, &src, ProjectFolder::ThreeD);
    assert!(matches!(r, Err(ProjectError::Path(PathError::LinkInPath))), "{r:?}");

    // Dokument schreiben und lesen
    replace_with_link("Social");
    let doc = ProjectDocument {
        schema_version: 1,
        module: ModuleKind::Social,
        data: ProjectDocumentData::Social(SocialDocument {
            template_id: "post".into(),
            format: SocialFormat::Post,
            texts: BTreeMap::new(),
            images: BTreeMap::new(),
            color_overrides: BTreeMap::new(),
            export_format: SocialExportFormat::Png,
        }),
    };
    let r = projects::write_document(&dir, "Social/x.social.json", &doc);
    assert!(matches!(r, Err(ProjectError::Path(PathError::LinkInPath))), "{r:?}");
    std::fs::write(env.outside.join("fremd.social.json"), serde_json::to_vec(&doc).unwrap()).unwrap();
    let r = projects::read_document(&dir, "Social/fremd.social.json");
    assert!(matches!(r, Err(ProjectError::Path(PathError::LinkInPath))), "{r:?}");

    assert_eq!(files_in(&env.outside).len(), 1, "nur die vom Test selbst angelegte Datei liegt draußen");
}

#[test]
fn project_writes_work_in_a_clean_project() {
    let env = Env::new();
    let dir = new_project(&env, "Sauber");
    let (file, path) =
        projects::new_file(&dir, ProjectFolder::Motive, "kra", "bild", &NewFileContent::Bytes(b"x".to_vec())).unwrap();
    assert_eq!(file.rel_path, "Motive/bild.kra");
    assert!(path.is_file());
    let src = source_file(&env, "modell.glb");
    let (asset, target) = projects::add_asset(&dir, &src, ProjectFolder::ThreeD).unwrap();
    assert_eq!(asset.rel_path, "3D/modell.glb");
    assert!(target.is_file());
}

#[test]
fn a_linked_project_folder_inside_the_library_is_not_listed_as_a_project() {
    let env = Env::new();
    let projects_root = env.root.join("Projekte");
    std::fs::create_dir_all(&projects_root).unwrap();
    let real = {
        let (_, dir) = projects::create(&projects_root, true, "Echt", None, "t").unwrap();
        dir
    };
    // ein Projekt „draußen“, auf das ein Link in der Bibliothek zeigt
    let (_, foreign) = projects::create(&env.outside, false, "Fremd", None, "t").unwrap();
    make_dir_link(&foreign, &projects_root.join("Verlinkt"));
    let listed = projects::list(&projects_root, true, &[]);
    let dirs: Vec<PathBuf> = listed.into_iter().map(|(_, d)| d).collect();
    assert_eq!(dirs, vec![real]);
    // Ein eigener Projektordner (nicht in der Bibliothek) darf ein Link sein: die Nutzerin hat ihn selbst gewählt
    let own_root = env._tmp.path().join("EigeneProjekte");
    std::fs::create_dir_all(&own_root).unwrap();
    make_dir_link(&foreign, &own_root.join("Verlinkt"));
    assert_eq!(projects::list(&own_root, false, &[]).len(), 1);
}

#[test]
fn creating_a_project_does_not_reuse_a_dangling_link_name() {
    let env = Env::new();
    // `Drop` ist belegt (hier ein Link auf einen Ordner), das Projekt bekommt den nächsten freien Namen
    make_dir_link(&env.outside, &env.root.join("Drop"));
    let (project, dir) = projects::create(&env.root, false, "Drop", None, "t").unwrap();
    assert_eq!(dir.file_name().unwrap(), "Drop (2)");
    assert_eq!(project.name, "Drop");
    assert!(files_in(&env.outside).is_empty());
}
