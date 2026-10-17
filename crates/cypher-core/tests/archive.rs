//! Entpacken: zip, tar.xz, tar.gz, 7z, selbstentpackendes 7z. Angriffe (Zip-Slip, Symlinks, Hardlinks, Geräte,
//! Duplikate, Bomben) müssen scheitern, ohne dass etwas außerhalb des Zielordners entsteht.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

use cypher_core::api::{ArtifactKind, UnsafeEntryReason};
use cypher_core::error::ArchiveError;
#[cfg(unix)]
use cypher_core::install::archive::verify_no_escaping_links;
use cypher_core::install::archive::{ExtractLimits, ExtractOptions, ExtractProgress, extract};
use cypher_core::progress::{Collect, NoProgress};
use tokio_util::sync::CancellationToken;

// ---------------------------------------------------------------------------------------------
// Archive bauen
// ---------------------------------------------------------------------------------------------

fn zip_with(entries: &[(&str, &[u8], Option<u32>)]) -> Vec<u8> {
    let mut buf = Cursor::new(Vec::new());
    {
        let mut w = zip::ZipWriter::new(&mut buf);
        for (name, data, mode) in entries {
            let mut opts =
                zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            if let Some(m) = mode {
                opts = opts.unix_permissions(*m);
            }
            if *mode == Some(0o120777) {
                // Symlink-Eintrag: `data` ist das Ziel
                w.add_symlink(*name, std::str::from_utf8(data).unwrap(), opts).unwrap();
            } else if name.ends_with('/') {
                w.add_directory(*name, opts).unwrap();
            } else {
                w.start_file(*name, opts).unwrap();
                w.write_all(data).unwrap();
            }
        }
        w.finish().unwrap();
    }
    buf.into_inner()
}

/// Ein tar-Eintrag mit rohen Kopfdaten (die Bibliothek würde gefährliche Pfade beim Schreiben ablehnen).
struct TarEntry<'a> {
    name: &'a str,
    kind: tar::EntryType,
    data: &'a [u8],
    link: Option<&'a str>,
    mode: u32,
}

fn file<'a>(name: &'a str, data: &'a [u8]) -> TarEntry<'a> {
    TarEntry { name, kind: tar::EntryType::Regular, data, link: None, mode: 0o644 }
}

fn dir(name: &str) -> TarEntry<'_> {
    TarEntry { name, kind: tar::EntryType::Directory, data: &[], link: None, mode: 0o755 }
}

fn symlink<'a>(name: &'a str, target: &'a str) -> TarEntry<'a> {
    TarEntry { name, kind: tar::EntryType::Symlink, data: &[], link: Some(target), mode: 0o777 }
}

fn tar_bytes(entries: &[TarEntry<'_>]) -> Vec<u8> {
    let mut builder = tar::Builder::new(Vec::new());
    for e in entries {
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(e.kind);
        header.set_size(e.data.len() as u64);
        header.set_mode(e.mode);
        header.set_mtime(0);
        {
            let gnu = header.as_gnu_mut().unwrap();
            gnu.name = [0; 100];
            gnu.name[..e.name.len()].copy_from_slice(e.name.as_bytes());
            if let Some(link) = e.link {
                gnu.linkname = [0; 100];
                gnu.linkname[..link.len()].copy_from_slice(link.as_bytes());
            }
        }
        header.set_cksum();
        builder.append(&header, e.data).unwrap();
    }
    builder.into_inner().unwrap()
}

fn xz(data: &[u8]) -> Vec<u8> {
    let mut enc = liblzma::write::XzEncoder::new(Vec::new(), 1);
    enc.write_all(data).unwrap();
    enc.finish().unwrap()
}

fn gz(data: &[u8]) -> Vec<u8> {
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    enc.write_all(data).unwrap();
    enc.finish().unwrap()
}

fn sevenz_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a.7z");
    {
        let mut w = sevenz_rust2::ArchiveWriter::create(&path).unwrap();
        for (name, data) in entries {
            let entry = sevenz_rust2::ArchiveEntry::new_file(name);
            w.push_archive_entry(entry, Some(Cursor::new(data.to_vec()))).unwrap();
        }
        w.finish().unwrap();
    }
    std::fs::read(path).unwrap()
}

// ---------------------------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------------------------

struct Sandbox {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    dest: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let dest = root.join("dest");
        std::fs::create_dir_all(&dest).unwrap();
        Sandbox { _tmp: tmp, root, dest }
    }

    fn archive(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let p = self.root.join(name);
        std::fs::write(&p, bytes).unwrap();
        p
    }

    /// Nichts außer `dest` und den abgelegten Archiven darf im Wurzelordner stehen.
    fn assert_nothing_escaped(&self) {
        let names: Vec<String> = std::fs::read_dir(&self.root)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        for n in &names {
            assert!(n == "dest" || n.starts_with("archiv"), "unerwartete Datei außerhalb des Ziels: {n} ({names:?})");
        }
    }
}

fn relaxed(strip: u32, symlinks: bool) -> ExtractOptions {
    ExtractOptions { strip_components: strip, allow_symlinks: symlinks, strict_names: false }
}

fn strict(strip: u32) -> ExtractOptions {
    ExtractOptions { strip_components: strip, allow_symlinks: false, strict_names: true }
}

fn run(
    kind: ArtifactKind,
    sb: &Sandbox,
    archive: &Path,
    opts: ExtractOptions,
) -> Result<cypher_core::install::archive::ExtractStats, ArchiveError> {
    extract(kind, archive, &sb.dest, &ExtractLimits::default(), &opts, &NoProgress, &CancellationToken::new())
}

fn unsafe_reason(e: ArchiveError) -> UnsafeEntryReason {
    match e {
        ArchiveError::UnsafeEntry { reason, .. } => reason,
        other => panic!("erwartet UnsafeEntry, erhalten {other}"),
    }
}

// ---------------------------------------------------------------------------------------------
// zip
// ---------------------------------------------------------------------------------------------

#[test]
fn zip_extracts_with_strip_components_and_modes() {
    let sb = Sandbox::new();
    let bytes = zip_with(&[
        ("blender-5.2.2-windows-x64/", b"", None),
        ("blender-5.2.2-windows-x64/blender.exe", b"MZ", Some(0o755)),
        ("blender-5.2.2-windows-x64/5.2/scripts/startup.py", b"print(1)", Some(0o644)),
        ("blender-5.2.2-windows-x64/license.txt", b"GPL", None),
    ]);
    let archive = sb.archive("archiv.zip", &bytes);
    let sink = Collect::<ExtractProgress>::new();
    let stats = extract(
        ArtifactKind::Zip,
        &archive,
        &sb.dest,
        &ExtractLimits::default(),
        &relaxed(1, false),
        &sink,
        &CancellationToken::new(),
    )
    .unwrap();
    assert_eq!((stats.files, stats.bytes), (3, 2 + 8 + 3));
    assert_eq!(std::fs::read(sb.dest.join("blender.exe")).unwrap(), b"MZ");
    assert!(sb.dest.join("5.2/scripts/startup.py").is_file());
    assert!(!sb.dest.join("blender-5.2.2-windows-x64").exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_ne!(
            std::fs::metadata(sb.dest.join("blender.exe")).unwrap().permissions().mode() & 0o111,
            0,
            "Ausführungsrecht bleibt"
        );
    }
    let last = sink.take().pop().unwrap();
    assert_eq!(last.entries_done, 3); // Wurzelordner entfällt durch strip
    assert_eq!(last.entries_total, Some(4));
}

#[test]
fn zip_slip_and_friends_are_rejected_and_nothing_escapes() {
    let cases: &[(&str, UnsafeEntryReason)] = &[
        ("../evil.txt", UnsafeEntryReason::ParentTraversal),
        ("a/../../evil.txt", UnsafeEntryReason::ParentTraversal),
        ("a\\..\\..\\evil.txt", UnsafeEntryReason::ParentTraversal),
        ("/etc/evil.txt", UnsafeEntryReason::AbsolutePath),
        ("C:\\evil.txt", UnsafeEntryReason::AbsolutePath),
        ("\\\\server\\share\\evil.txt", UnsafeEntryReason::AbsolutePath),
    ];
    for (name, expected) in cases {
        let sb = Sandbox::new();
        let archive = sb.archive("archiv.zip", &zip_with(&[("ok.txt", b"x", None), (name, b"boese", None)]));
        let err = run(ArtifactKind::Zip, &sb, &archive, strict(0)).unwrap_err();
        assert_eq!(unsafe_reason(err), *expected, "Eintrag {name:?}");
        sb.assert_nothing_escaped();
    }
}

#[test]
fn zip_rejects_reserved_names_duplicates_and_symlinks() {
    let sb = Sandbox::new();
    let archive = sb.archive("archiv.zip", &zip_with(&[("bin/CON.txt", b"x", None)]));
    assert_eq!(
        unsafe_reason(run(ArtifactKind::Zip, &sb, &archive, strict(0)).unwrap_err()),
        UnsafeEntryReason::ReservedName
    );

    let sb = Sandbox::new();
    let archive = sb.archive("archiv.zip", &zip_with(&[("Readme.txt", b"a", None), ("README.TXT", b"b", None)]));
    assert_eq!(
        unsafe_reason(run(ArtifactKind::Zip, &sb, &archive, strict(0)).unwrap_err()),
        UnsafeEntryReason::DuplicateEntry
    );
    // ohne strenge Namen (Linux) sind das zwei verschiedene Dateien; auf Windows ist es dieselbe Datei
    #[cfg(not(windows))]
    {
        let sb = Sandbox::new();
        let archive = sb.archive("archiv.zip", &zip_with(&[("Readme.txt", b"a", None), ("README.TXT", b"b", None)]));
        assert_eq!(run(ArtifactKind::Zip, &sb, &archive, relaxed(0, false)).unwrap().files, 2);
    }

    // Symlink-Eintrag (Unix-Modus 120000) wird nie angelegt
    let sb = Sandbox::new();
    let archive = sb.archive("archiv.zip", &zip_with(&[("link", b"../../etc/passwd", Some(0o120777))]));
    assert_eq!(
        unsafe_reason(run(ArtifactKind::Zip, &sb, &archive, relaxed(0, true)).unwrap_err()),
        UnsafeEntryReason::SymlinkEscape
    );
    sb.assert_nothing_escaped();
}

#[test]
fn zip_bomb_and_size_limits_are_enforced() {
    // 70 MiB Nullen → winzig gepackt, Verhältnis weit über 200
    let zeros = vec![0u8; 70 * 1024 * 1024];
    let sb = Sandbox::new();
    let archive = sb.archive("archiv.zip", &zip_with(&[("bombe.bin", &zeros, None)]));
    let err = run(ArtifactKind::Zip, &sb, &archive, relaxed(0, false)).unwrap_err();
    assert!(matches!(err, ArchiveError::TooLarge { .. }), "{err}");

    // Gesamtgröße
    let sb = Sandbox::new();
    let archive =
        sb.archive("archiv.zip", &zip_with(&[("a.bin", &vec![1u8; 4000], None), ("b.bin", &vec![2u8; 4000], None)]));
    let limits = ExtractLimits { max_total_bytes: 5000, ..ExtractLimits::default() };
    let err = extract(
        ArtifactKind::Zip,
        &archive,
        &sb.dest,
        &limits,
        &relaxed(0, false),
        &NoProgress,
        &CancellationToken::new(),
    )
    .unwrap_err();
    assert!(matches!(err, ArchiveError::TooLarge { limit: 5000 }), "{err}");

    // Eintragszahl
    let sb = Sandbox::new();
    let many: Vec<(String, Vec<u8>)> = (0..20).map(|i| (format!("f{i}.txt"), vec![b'x'])).collect();
    let refs: Vec<(&str, &[u8], Option<u32>)> = many.iter().map(|(n, d)| (n.as_str(), d.as_slice(), None)).collect();
    let archive = sb.archive("archiv.zip", &zip_with(&refs));
    let limits = ExtractLimits { max_entries: 10, ..ExtractLimits::default() };
    let err = extract(
        ArtifactKind::Zip,
        &archive,
        &sb.dest,
        &limits,
        &relaxed(0, false),
        &NoProgress,
        &CancellationToken::new(),
    )
    .unwrap_err();
    assert!(matches!(err, ArchiveError::TooLarge { .. }), "{err}");
}

#[test]
fn broken_and_cancelled_extractions_report_cleanly() {
    let sb = Sandbox::new();
    let archive = sb.archive("archiv.zip", b"das ist kein zip");
    assert!(matches!(run(ArtifactKind::Zip, &sb, &archive, relaxed(0, false)), Err(ArchiveError::Invalid(_))));
    let archive = sb.archive("archiv2.zip", &zip_with(&[("a.txt", b"x", None)]));
    let cancel = CancellationToken::new();
    cancel.cancel();
    let err = extract(
        ArtifactKind::Zip,
        &archive,
        &sb.dest,
        &ExtractLimits::default(),
        &relaxed(0, false),
        &NoProgress,
        &cancel,
    )
    .unwrap_err();
    assert!(matches!(err, ArchiveError::Cancelled));
    assert!(!sb.dest.join("a.txt").exists());
    // kein Archivformat
    assert!(matches!(run(ArtifactKind::Dmg, &sb, &archive, relaxed(0, false)), Err(ArchiveError::Unsupported(_))));
}

// ---------------------------------------------------------------------------------------------
// tar.xz / tar.gz
// ---------------------------------------------------------------------------------------------

#[cfg(unix)]
#[test]
fn tar_xz_extracts_symlinks_inside_the_tree_and_keeps_exec_bits() {
    use std::os::unix::fs::PermissionsExt;
    let sb = Sandbox::new();
    let mut blender = file("blender-5.2.2-linux-x64/blender", b"\x7fELF");
    blender.mode = 0o755;
    let bytes = xz(&tar_bytes(&[
        dir("blender-5.2.2-linux-x64/"),
        blender,
        dir("blender-5.2.2-linux-x64/lib/"),
        file("blender-5.2.2-linux-x64/lib/libfoo.so.1.2", b"lib"),
        symlink("blender-5.2.2-linux-x64/lib/libfoo.so.1", "libfoo.so.1.2"),
        symlink("blender-5.2.2-linux-x64/lib/libfoo.so", "libfoo.so.1"),
        symlink("blender-5.2.2-linux-x64/lib/zurueck", "../blender"),
    ]));
    let archive = sb.archive("archiv.tar.xz", &bytes);
    let stats = run(ArtifactKind::TarXz, &sb, &archive, relaxed(1, true)).unwrap();
    assert_eq!((stats.files, stats.symlinks), (2, 3));
    assert_eq!(std::fs::read(sb.dest.join("lib/libfoo.so")).unwrap(), b"lib");
    assert_eq!(std::fs::read_link(sb.dest.join("lib/libfoo.so.1")).unwrap(), Path::new("libfoo.so.1.2"));
    assert_ne!(std::fs::metadata(sb.dest.join("blender")).unwrap().permissions().mode() & 0o111, 0);
    assert_eq!(std::fs::read(sb.dest.join("lib/zurueck")).unwrap(), b"\x7fELF");
}

#[test]
fn tar_rejects_path_attacks_hardlinks_devices_and_duplicates() {
    let attacks: Vec<(&str, Vec<u8>, UnsafeEntryReason)> = vec![
        ("zip-slip", tar_bytes(&[file("../evil.txt", b"x")]), UnsafeEntryReason::ParentTraversal),
        ("absolut", tar_bytes(&[file("/etc/evil.txt", b"x")]), UnsafeEntryReason::AbsolutePath),
        (
            "hardlink",
            tar_bytes(&[TarEntry {
                name: "h",
                kind: tar::EntryType::Link,
                data: &[],
                link: Some("/etc/passwd"),
                mode: 0o644,
            }]),
            UnsafeEntryReason::Hardlink,
        ),
        (
            "gerät",
            tar_bytes(&[TarEntry { name: "dev", kind: tar::EntryType::Char, data: &[], link: None, mode: 0o644 }]),
            UnsafeEntryReason::DeviceFile,
        ),
        (
            "fifo",
            tar_bytes(&[TarEntry { name: "pipe", kind: tar::EntryType::Fifo, data: &[], link: None, mode: 0o644 }]),
            UnsafeEntryReason::DeviceFile,
        ),
        ("duplikat", tar_bytes(&[file("a.txt", b"1"), file("a.txt", b"2")]), UnsafeEntryReason::DuplicateEntry),
        ("symlink-absolut", tar_bytes(&[symlink("l", "/etc/passwd")]), UnsafeEntryReason::SymlinkEscape),
        ("symlink-hoch", tar_bytes(&[symlink("l", "../../etc")]), UnsafeEntryReason::SymlinkEscape),
        ("symlink-tief-hoch", tar_bytes(&[symlink("a/b/l", "../../../x")]), UnsafeEntryReason::SymlinkEscape),
        (
            "durch-symlink-schreiben",
            tar_bytes(&[dir("sub/"), symlink("link", "sub"), file("link/geheim.txt", b"x")]),
            UnsafeEntryReason::SymlinkEscape,
        ),
    ];
    for (label, tar, expected) in attacks {
        // Auf Windows legt die App nie Symlinks an (das Archiv kommt dort aus zip); der Schreibversuch durch einen
        // harmlosen Link scheitert dort schon beim Anlegen des Links
        if cfg!(windows) && label == "durch-symlink-schreiben" {
            continue;
        }
        for (kind, bytes) in [(ArtifactKind::TarXz, xz(&tar)), (ArtifactKind::TarGz, gz(&tar))] {
            let sb = Sandbox::new();
            let archive = sb.archive("archiv.bin", &bytes);
            let err = run(kind, &sb, &archive, relaxed(0, true)).unwrap_err();
            assert_eq!(unsafe_reason(err), expected, "{label} ({kind:?})");
            sb.assert_nothing_escaped();
        }
    }
}

#[test]
fn tar_symlinks_are_refused_when_not_allowed() {
    let sb = Sandbox::new();
    let archive = sb.archive("archiv.tar.xz", &xz(&tar_bytes(&[file("a", b"x"), symlink("l", "a")])));
    assert_eq!(
        unsafe_reason(run(ArtifactKind::TarXz, &sb, &archive, relaxed(0, false)).unwrap_err()),
        UnsafeEntryReason::SymlinkEscape
    );
}

#[test]
fn tar_bomb_is_stopped_by_the_ratio_check() {
    // 80 MiB Nullen als Datei: xz packt das auf wenige Kilobyte
    let zeros = vec![0u8; 80 * 1024 * 1024];
    let sb = Sandbox::new();
    let archive = sb.archive("archiv.tar.xz", &xz(&tar_bytes(&[file("bombe.bin", &zeros)])));
    let err = run(ArtifactKind::TarXz, &sb, &archive, relaxed(0, false)).unwrap_err();
    assert!(matches!(err, ArchiveError::TooLarge { .. }), "{err}");
}

#[test]
fn tar_gz_round_trip() {
    let sb = Sandbox::new();
    let archive = sb.archive("archiv.tar.gz", &gz(&tar_bytes(&[dir("top/"), file("top/a.txt", b"hallo")])));
    let stats = run(ArtifactKind::TarGz, &sb, &archive, relaxed(1, false)).unwrap();
    assert_eq!(stats.files, 1);
    assert_eq!(std::fs::read_to_string(sb.dest.join("a.txt")).unwrap(), "hallo");
}

// ---------------------------------------------------------------------------------------------
// 7z
// ---------------------------------------------------------------------------------------------

#[test]
fn sevenz_extracts_with_strip_components() {
    let sb = Sandbox::new();
    let archive =
        sb.archive("archiv.7z", &sevenz_with(&[("inkscape/bin/inkscape.exe", b"MZ"), ("inkscape/share/x.txt", b"x")]));
    let stats = run(ArtifactKind::SevenZ, &sb, &archive, relaxed(1, false)).unwrap();
    assert_eq!(stats.files, 2);
    assert_eq!(std::fs::read(sb.dest.join("bin/inkscape.exe")).unwrap(), b"MZ");
}

#[test]
fn sevenz_rejects_path_attacks() {
    for name in ["../evil.txt", "/abs/evil.txt", "C:\\evil.txt", "a/../../evil.txt"] {
        let sb = Sandbox::new();
        let archive = sb.archive("archiv.7z", &sevenz_with(&[("ok.txt", b"x"), (name, b"boese")]));
        let err = run(ArtifactKind::SevenZ, &sb, &archive, strict(0)).unwrap_err();
        assert!(matches!(err, ArchiveError::UnsafeEntry { .. }), "{name}: {err}");
        sb.assert_nothing_escaped();
    }
}

#[test]
fn self_extracting_7z_is_found_behind_a_stub_with_a_decoy_signature() {
    let sb = Sandbox::new();
    let sevenz = sevenz_with(&[("kdenlive_standalone/bin/kdenlive.exe", b"MZ"), ("kdenlive_standalone/x.dll", b"dll")]);
    // Programmteil mit täuschender Signatur mittendrin (kein gültiges Archiv)
    let mut sfx = vec![b'M', b'Z'];
    sfx.extend(std::iter::repeat_n(0x90u8, 4000));
    sfx.extend_from_slice(&[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C, 0x00, 0x04, 0xFF, 0xFF]);
    sfx.extend(std::iter::repeat_n(0x90u8, 3000));
    sfx.extend_from_slice(&sevenz);
    let archive = sb.archive("archiv.exe", &sfx);
    let stats = run(ArtifactKind::Sfx7z, &sb, &archive, relaxed(1, false)).unwrap();
    assert_eq!(stats.files, 2);
    assert!(sb.dest.join("bin/kdenlive.exe").is_file());
    // als normales 7z gelesen scheitert dieselbe Datei
    let sb2 = Sandbox::new();
    let archive2 = sb2.archive("archiv.exe", &sfx);
    assert!(run(ArtifactKind::SevenZ, &sb2, &archive2, relaxed(1, false)).is_err());
    // eine Datei ohne jede Signatur
    let archive3 = sb2.archive("archiv3.exe", b"MZ nur ein Programm");
    assert!(matches!(run(ArtifactKind::Sfx7z, &sb2, &archive3, relaxed(0, false)), Err(ArchiveError::Invalid(_))));
}

// ---------------------------------------------------------------------------------------------
// Nacharbeit
// ---------------------------------------------------------------------------------------------

#[cfg(unix)]
#[test]
fn verify_no_escaping_links_catches_links_that_point_out() {
    let sb = Sandbox::new();
    let outside = sb.root.join("draussen");
    std::fs::create_dir_all(&outside).unwrap();
    std::os::unix::fs::symlink("a.txt", sb.dest.join("gut")).unwrap();
    std::fs::write(sb.dest.join("a.txt"), b"x").unwrap();
    verify_no_escaping_links(&sb.dest).unwrap();
    std::os::unix::fs::symlink(&outside, sb.dest.join("boese")).unwrap();
    assert!(matches!(
        verify_no_escaping_links(&sb.dest),
        Err(ArchiveError::UnsafeEntry { reason: UnsafeEntryReason::SymlinkEscape, .. })
    ));
}

// ---------------------------------------------------------------------------------------------
// Echte Archive (Smoke-Tests aus programme.md 9.4); nur mit `CYPHER_REAL_ARCHIVES=<ordner>` und `--ignored`
// ---------------------------------------------------------------------------------------------

fn real_dir() -> Option<PathBuf> {
    std::env::var_os("CYPHER_REAL_ARCHIVES").map(PathBuf::from)
}

#[test]
#[ignore = "braucht die echten Archive (CYPHER_REAL_ARCHIVES)"]
fn real_inkscape_7z_with_bcj2_extracts() {
    let Some(dir) = real_dir() else { return };
    let sb = Sandbox::new();
    let limits = ExtractLimits { max_total_bytes: 900_000_000, ..ExtractLimits::default() };
    let stats = extract(
        ArtifactKind::SevenZ,
        &dir.join("inkscape-1.4.4-x64.7z"),
        &sb.dest,
        &limits,
        &ExtractOptions::new(1, false),
        &NoProgress,
        &CancellationToken::new(),
    )
    .unwrap();
    assert!(stats.files > 10_000, "{stats:?}");
    assert!(sb.dest.join("bin/inkscape.exe").is_file());
}

#[test]
#[ignore = "braucht die echten Archive (CYPHER_REAL_ARCHIVES)"]
fn real_kdenlive_standalone_sfx_extracts() {
    let Some(dir) = real_dir() else { return };
    let sb = Sandbox::new();
    let limits = ExtractLimits { max_total_bytes: 1_000_000_000, ..ExtractLimits::default() };
    let stats = extract(
        ArtifactKind::Sfx7z,
        &dir.join("kdenlive-26.08.2_standalone.exe"),
        &sb.dest,
        &limits,
        &ExtractOptions::new(1, false),
        &NoProgress,
        &CancellationToken::new(),
    )
    .unwrap();
    assert!(stats.files > 5_000, "{stats:?}");
    assert!(sb.dest.join("bin/kdenlive.exe").is_file());
}
