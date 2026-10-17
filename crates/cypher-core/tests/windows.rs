//! Nur Windows: was sich auf dem echten Dateisystem und der echten Registrierung anders verhält. Alle Tests lesen nur oder
//! arbeiten in Temp-Ordnern; nichts wird installiert, keine Schrift angemeldet, kein Programm außer `cmd /c exit` gestartet.
#![cfg(windows)]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

use cypher_core::api::{ArtifactKind, UnsafeEntryReason};
use cypher_core::catalog::{Catalog, EMBEDDED_CATALOG_JSON};
use cypher_core::detect::{DetectEnv, detect_all};
use cypher_core::error::ArchiveError;
use cypher_core::install::archive::{ExtractLimits, ExtractOptions, extract};
use cypher_core::launch::{self, LaunchSpec};
use cypher_core::platform::fsx;
use cypher_core::progress::NoProgress;
use tokio_util::sync::CancellationToken;

fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
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

fn extract_zip(bytes: &[u8], dest: &Path) -> Result<(), ArchiveError> {
    let archive = dest.parent().unwrap().join("archiv.zip");
    std::fs::write(&archive, bytes).unwrap();
    std::fs::create_dir_all(dest).unwrap();
    extract(
        ArtifactKind::Zip,
        &archive,
        dest,
        &ExtractLimits::default(),
        &ExtractOptions::new(0, false),
        &NoProgress,
        &CancellationToken::new(),
    )
    .map(|_| ())
}

#[test]
fn the_default_extraction_uses_the_windows_name_rules() {
    assert!(ExtractOptions::new(0, false).strict_names);
}

#[test]
fn long_paths_extract_and_can_be_removed_again() {
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("ziel");
    // Blender und Kdenlive liefern tief verschachtelte Ordner; über 260 Zeichen darf das nicht scheitern
    let deep = (0..14).map(|i| format!("ordner-mit-langem-namen-{i:02}")).collect::<Vec<_>>().join("/");
    let name = format!("{deep}/datei.txt");
    assert!(name.len() > 300);
    extract_zip(&zip_with(&[(&name, b"tief")]), &dest).unwrap();
    let on_disk = dest.join(name.replace('/', "\\"));
    assert!(on_disk.to_string_lossy().len() > 260);
    assert_eq!(std::fs::read(&on_disk).unwrap(), b"tief");
    std::fs::remove_dir_all(&dest).unwrap();
    assert!(!dest.exists());
}

#[test]
fn names_that_windows_treats_specially_never_reach_the_disk() {
    for hostile in [
        "CON",
        "con.txt",
        "NUL.txt",
        "COM1",
        "aux/datei.txt",
        "ende.mit.punkt.",
        "ende-mit-leerzeichen ",
        "strom:versteckt",
        "C:evil.txt",
        "\\\\server\\freigabe\\x.txt",
        "..\\ausbruch.txt",
        "..\\..\\ausbruch.txt",
        "ordner\\..\\..\\ausbruch.txt",
        "a<b.txt",
        "a|b.txt",
        "a?b.txt",
        "a*b.txt",
        "a\"b.txt",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("ziel");
        let result = extract_zip(&zip_with(&[("harmlos.txt", b"ok"), (hostile, b"boese")]), &dest);
        assert!(matches!(result, Err(ArchiveError::UnsafeEntry { .. })), "{hostile:?}: {result:?}");
        let outside: Vec<String> = std::fs::read_dir(tmp.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n != "ziel" && n != "archiv.zip")
            .collect();
        assert!(outside.is_empty(), "{hostile:?}: außerhalb entstand {outside:?}");
    }
}

#[test]
fn entries_that_differ_only_in_case_are_duplicates_on_windows() {
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("ziel");
    let result = extract_zip(&zip_with(&[("Daten/A.txt", b"eins"), ("daten/a.TXT", b"zwei")]), &dest);
    match result {
        Err(ArchiveError::UnsafeEntry { reason, .. }) => assert_eq!(reason, UnsafeEntryReason::DuplicateEntry),
        other => panic!("erwartet DuplicateEntry, erhalten {other:?}"),
    }
}

/// Hält `path` eine Weile offen, wie es ein Virenscanner oder der Explorer tut.
fn hold_open(path: &Path, how_long: std::time::Duration) -> std::thread::JoinHandle<()> {
    let handle = std::fs::File::open(path).unwrap();
    std::thread::spawn(move || {
        std::thread::sleep(how_long);
        drop(handle);
    })
}

#[test]
fn atomic_writes_wait_out_a_short_lock_on_the_target() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("state.json");
    fsx::write_atomic(&file, b"eins").unwrap();
    let scanner = hold_open(&file, std::time::Duration::from_millis(400));
    fsx::write_atomic(&file, b"zwei").unwrap();
    scanner.join().unwrap();
    assert_eq!(std::fs::read(&file).unwrap(), b"zwei");
    // keine Temp-Dateien übrig
    assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 1);
}

#[test]
fn a_freshly_extracted_folder_can_be_renamed_while_a_scanner_still_has_a_file_open() {
    let tmp = tempfile::tempdir().unwrap();
    let staging = tmp.path().join(".staging").join("blender");
    std::fs::create_dir_all(staging.join("5.2")).unwrap();
    std::fs::write(staging.join("5.2").join("blender.exe"), b"MZ").unwrap();
    let scanner = hold_open(&staging.join("5.2").join("blender.exe"), std::time::Duration::from_millis(400));
    let target = tmp.path().join("programs").join("blender").join("5.2.2");
    fsx::rename_dir_atomic(&staging, &target).unwrap();
    scanner.join().unwrap();
    assert!(target.join("5.2").join("blender.exe").is_file());
    assert!(!staging.exists());
}

#[test]
fn free_space_is_reported_for_a_drive_path_that_does_not_exist_yet() {
    let tmp = tempfile::tempdir().unwrap();
    let future = tmp.path().join("noch").join("nicht").join("da");
    assert!(fsx::free_space(&future).unwrap() > 0);
}

#[test]
fn real_detection_only_reads_registry_and_disk() {
    let catalog: Catalog = serde_json::from_slice(EMBEDDED_CATALOG_JSON).unwrap();
    let env = DetectEnv::real();
    let found = detect_all(&env, &catalog, &[]);
    // Was gefunden wird, hängt vom Rechner ab; es darf nur nichts abstürzen und jede Zeile braucht einen Ort
    for inst in &found {
        eprintln!("gefunden: {} {:?} {:?} {}", inst.program_id, inst.version, inst.kind, inst.location);
        assert!(!inst.location.is_empty());
        assert!(!inst.managed_by_cypher);
    }
}

#[test]
fn a_harmless_system_program_starts_detached() {
    let system_root = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let cmd = system_root.join("System32").join("cmd.exe");
    assert!(cmd.is_file(), "{}", cmd.display());
    let spec = LaunchSpec {
        program: cmd,
        args: vec!["/c".into(), "exit".into(), "0".into()],
        env_remove: vec![],
        env_set: vec![],
        cwd: None,
    };
    let pid = launch::spawn(&spec).unwrap();
    assert!(pid.is_some_and(|p| p > 0));
}
