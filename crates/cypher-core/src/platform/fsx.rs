//! Sichere Dateioperationen: atomares Schreiben, Pfadprüfung (ARCHITEKTUR.md 6.6), Ordner verschieben/löschen.

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use serde::de::DeserializeOwned;
use unicode_normalization::UnicodeNormalization;

use crate::api::IoOp;
use crate::error::{IoError, PathError};

/// Komponenten länger als so viele Bytes werden abgelehnt.
pub const MAX_COMPONENT_BYTES: usize = 240;

const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
    "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Prüft eine einzelne Pfadkomponente nach 6.6 (ohne Trennzeichen).
pub fn validate_component(comp: &str) -> Result<(), PathError> {
    if comp.is_empty() || comp == "." {
        return Err(PathError::CurrentDirOrEmpty);
    }
    if comp == ".." {
        return Err(PathError::ParentTraversal);
    }
    if comp.chars().any(|c| c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|' | '/' | '\\')) {
        return Err(PathError::InvalidChars);
    }
    if comp.len() > MAX_COMPONENT_BYTES {
        return Err(PathError::TooLong);
    }
    if comp.ends_with('.') || comp.ends_with(' ') {
        return Err(PathError::TrailingDotOrSpace);
    }
    let stem = comp.split('.').next().unwrap_or(comp).trim_end().to_ascii_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        return Err(PathError::ReservedName);
    }
    Ok(())
}

/// Zerlegt einen relativen Pfad (`/` oder `\` als Trenner) in geprüfte Komponenten.
pub fn split_rel(rel: &str) -> Result<Vec<String>, PathError> {
    if rel.is_empty() {
        return Err(PathError::Empty);
    }
    if rel.chars().any(|c| c.is_control()) {
        return Err(PathError::InvalidChars);
    }
    let bytes = rel.as_bytes();
    if rel.starts_with('/') || rel.starts_with('\\') {
        return Err(PathError::Absolute);
    }
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err(PathError::DriveOrUnc);
    }
    let normalized = rel.replace('\\', "/");
    let mut parts = Vec::new();
    for comp in normalized.split('/') {
        validate_component(comp)?;
        parts.push(comp.to_owned());
    }
    Ok(parts)
}

/// Hängt einen relativen Pfad an `base`, ohne dass er `base` verlassen kann.
pub fn safe_join(base: &Path, rel: &str) -> Result<PathBuf, PathError> {
    let mut out = base.to_path_buf();
    for comp in split_rel(rel)? {
        out.push(comp);
    }
    Ok(out)
}

/// Schlüssel für Duplikaterkennung: Unicode-NFC, kleingeschrieben (Windows und macOS unterscheiden Groß/Klein nicht).
pub fn duplicate_key(rel: &str) -> String {
    rel.replace('\\', "/").nfc().collect::<String>().to_lowercase()
}

fn canonicalize_existing_prefix(path: &Path) -> Result<PathBuf, IoError> {
    let mut existing = path.to_path_buf();
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    loop {
        match fs::canonicalize(&existing) {
            Ok(canon) => {
                let mut out = canon;
                for comp in rest.iter().rev() {
                    out.push(comp);
                }
                return Ok(out);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => match (existing.file_name(), existing.parent()) {
                (Some(name), Some(parent)) => {
                    rest.push(name.to_os_string());
                    existing = parent.to_path_buf();
                }
                _ => return Err(IoError::new(IoOp::Metadata, path, e)),
            },
            Err(e) => return Err(IoError::new(IoOp::Metadata, existing, e)),
        }
    }
}

/// Löst Symlinks auf (soweit der Pfad existiert) und prüft, dass `candidate` unterhalb von `base` liegt.
/// Liefert den aufgelösten Pfad.
pub fn ensure_within(base: &Path, candidate: &Path) -> Result<PathBuf, EnsureWithinError> {
    let base_canon =
        fs::canonicalize(base).map_err(|e| EnsureWithinError::Io(IoError::new(IoOp::Metadata, base, e)))?;
    let cand_canon = canonicalize_existing_prefix(candidate).map_err(EnsureWithinError::Io)?;
    if cand_canon.starts_with(&base_canon) { Ok(cand_canon) } else { Err(EnsureWithinError::Path(PathError::Escapes)) }
}

#[derive(Debug, thiserror::Error)]
pub enum EnsureWithinError {
    #[error(transparent)]
    Path(#[from] PathError),
    #[error(transparent)]
    Io(#[from] IoError),
}

/// Bereinigt Eingaben des Nutzers für einen einzelnen Datei- oder Ordnernamen.
pub fn sanitize_file_name(name: &str) -> String {
    let mut out: String =
        name.chars()
            .map(|c| {
                if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                    '-'
                } else {
                    c
                }
            })
            .collect();
    out = out.trim().trim_end_matches(['.', ' ']).to_owned();
    out = out.trim_start_matches('.').to_owned();
    while out.len() > 120 {
        out.pop();
    }
    let out = out.trim().trim_end_matches(['.', ' ']).to_owned();
    if out.is_empty() {
        return "Unbenannt".to_owned();
    }
    if validate_component(&out).is_err() {
        return format!("_{out}");
    }
    out
}

/// Temp-Dateien entstehen mit den Rechten `0600`. Was die Nutzerin weitergibt oder wovon andere Programme lesen
/// (Exporte, Pakete, Diagnose, Einstellungen), soll die üblichen Rechte `0644` haben. Unter Windows ohne Wirkung.
pub fn set_shareable_mode(file: &std::fs::File) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = file.set_permissions(std::fs::Permissions::from_mode(0o644));
    }
    #[cfg(not(unix))]
    {
        let _ = file;
    }
}

/// Schreibt atomar: Temp-Datei im Zielordner, `fsync`, dann umbenennen. Das Ziel ist nie halb geschrieben.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), IoError> {
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|e| IoError::new(IoOp::CreateDir, parent, e))?;
    let mut tmp = tempfile::Builder::new()
        .prefix(".cypher-tmp-")
        .tempfile_in(parent)
        .map_err(|e| IoError::new(IoOp::Write, parent, e))?;
    tmp.write_all(bytes).map_err(|e| IoError::write(path, e))?;
    tmp.as_file().sync_all().map_err(|e| IoError::write(path, e))?;
    set_shareable_mode(tmp.as_file());
    tmp.persist(path).map_err(|e| IoError::new(IoOp::Rename, path, e.error))?;
    Ok(())
}

pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), IoError> {
    let mut json =
        serde_json::to_vec_pretty(value).map_err(|e| IoError::other(IoOp::Write, Some(path), e.to_string()))?;
    json.push(b'\n');
    write_atomic(path, &json)
}

/// Liest JSON; `None`, wenn die Datei fehlt. Ein Parse-Fehler ist ein `IoError` (Art `InvalidData`).
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, IoError> {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(IoError::read(path, e)),
    };
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| IoError::read(path, std::io::Error::new(std::io::ErrorKind::InvalidData, e)))
}

/// Benennt eine beschädigte Datei in `<datei>.corrupt-<unix-zeit>` um, damit sie nicht überschrieben wird.
pub fn quarantine_corrupt(path: &Path) -> Result<PathBuf, IoError> {
    let stamp =
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or_default();
    let mut name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(format!(".corrupt-{stamp}"));
    let target = path.with_file_name(name);
    fs::rename(path, &target).map_err(|e| IoError::new(IoOp::Rename, path, e))?;
    Ok(target)
}

/// Freier Platz auf dem Datenträger, der `path` enthält (auch wenn `path` selbst noch fehlt).
pub fn free_space(path: &Path) -> Result<u64, IoError> {
    let mut probe = path.to_path_buf();
    while !probe.exists() {
        if !probe.pop() {
            break;
        }
    }
    if probe.as_os_str().is_empty() {
        probe = PathBuf::from(".");
    }
    fs4::available_space(&probe).map_err(|e| IoError::new(IoOp::Metadata, probe, e))
}

/// Benennt einen Ordner um. Gibt es das Ziel schon, ist das ein Fehler; über Laufwerksgrenzen scheitert es.
pub fn rename_dir_atomic(from: &Path, to: &Path) -> Result<(), IoError> {
    if to.exists() {
        return Err(IoError::other(IoOp::Rename, Some(to), "Ziel existiert schon"));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| IoError::new(IoOp::CreateDir, parent, e))?;
    }
    fs::rename(from, to).map_err(|e| IoError::new(IoOp::Rename, from, e))
}

/// Löscht einen Ordner samt Inhalt, aber nur unterhalb von `managed_root` und nie `managed_root` selbst.
pub fn remove_dir_managed(dir: &Path, managed_root: &Path) -> Result<(), IoError> {
    let resolved = match ensure_within(managed_root, dir) {
        Ok(p) => p,
        Err(EnsureWithinError::Io(e)) if e.source.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(EnsureWithinError::Io(e)) => return Err(e),
        Err(EnsureWithinError::Path(p)) => {
            return Err(IoError::other(IoOp::Remove, Some(dir), format!("außerhalb des verwalteten Ordners: {p}")));
        }
    };
    let root = fs::canonicalize(managed_root).map_err(|e| IoError::new(IoOp::Metadata, managed_root, e))?;
    if resolved == root {
        return Err(IoError::other(IoOp::Remove, Some(dir), "der verwaltete Ordner selbst wird nie gelöscht"));
    }
    remove_dir_all_forced(&resolved)
}

/// `remove_dir_all`, das schreibgeschützte Dateien (Windows) freigibt und es erneut versucht.
pub fn remove_dir_all_forced(dir: &Path) -> Result<(), IoError> {
    match fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(first) => {
            clear_readonly_recursive(dir);
            fs::remove_dir_all(dir).map_err(|e| {
                let _ = first;
                IoError::new(IoOp::Remove, dir, e)
            })
        }
    }
}

fn clear_readonly_recursive(dir: &Path) {
    for entry in walkdir::WalkDir::new(dir).into_iter().flatten() {
        if let Ok(meta) = entry.metadata() {
            let mut perms = meta.permissions();
            if perms.readonly() {
                #[allow(clippy::permissions_set_readonly_false)]
                perms.set_readonly(false);
                let _ = fs::set_permissions(entry.path(), perms);
            }
        }
    }
}

/// `true`, wenn der Pfad Komponenten wie `..` enthält (für Eingaben, die schon als `Path` vorliegen).
pub fn has_parent_components(path: &Path) -> bool {
    path.components().any(|c| matches!(c, Component::ParentDir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn safe_join_accepts_plain_relative_paths() {
        let base = Path::new("/base");
        assert_eq!(safe_join(base, "a/b/c.txt").unwrap(), Path::new("/base/a/b/c.txt"));
        assert_eq!(safe_join(base, "a\\b").unwrap(), Path::new("/base/a/b"));
        assert_eq!(safe_join(base, "Motive/ratte (2).png").unwrap(), Path::new("/base/Motive/ratte (2).png"));
    }

    #[test]
    fn safe_join_rejects_every_documented_attack() {
        let base = Path::new("/base");
        let cases: &[(&str, PathError)] = &[
            ("", PathError::Empty),
            ("/etc/passwd", PathError::Absolute),
            ("\\\\server\\share", PathError::Absolute),
            ("\\\\?\\C:\\x", PathError::Absolute),
            ("C:\\Windows", PathError::DriveOrUnc),
            ("c:foo", PathError::DriveOrUnc),
            ("../x", PathError::ParentTraversal),
            ("a/../../x", PathError::ParentTraversal),
            ("a\\..\\x", PathError::ParentTraversal),
            ("./x", PathError::CurrentDirOrEmpty),
            ("a//b", PathError::CurrentDirOrEmpty),
            ("a/", PathError::CurrentDirOrEmpty),
            ("a\0b", PathError::InvalidChars),
            ("a\nb", PathError::InvalidChars),
            ("file:stream", PathError::InvalidChars),
            ("a*b", PathError::InvalidChars),
            ("a|b", PathError::InvalidChars),
            ("CON", PathError::ReservedName),
            ("dir/nul.txt", PathError::ReservedName),
            ("Com3.log", PathError::ReservedName),
            ("trailing.", PathError::TrailingDotOrSpace),
            ("trailing ", PathError::TrailingDotOrSpace),
        ];
        for (input, expected) in cases {
            assert_eq!(safe_join(base, input).unwrap_err(), *expected, "Eingabe {input:?}");
        }
        let long = "x".repeat(MAX_COMPONENT_BYTES + 1);
        assert_eq!(safe_join(base, &long).unwrap_err(), PathError::TooLong);
    }

    proptest! {
        #[test]
        fn safe_join_never_escapes_the_base(rel in "[a-zA-Z0-9_./\\\\:*?<>|\"~ -]{0,40}") {
            let base = Path::new("/base/dir");
            if let Ok(joined) = safe_join(base, &rel) {
                prop_assert!(joined.starts_with(base));
                prop_assert!(!has_parent_components(&joined));
            }
        }

        #[test]
        fn any_dotdot_component_is_rejected(prefix in "[a-z]{0,5}", suffix in "[a-z]{0,5}", sep in prop::sample::select(vec!["/", "\\"])) {
            let rel = format!("{prefix}{sep}..{sep}{suffix}");
            prop_assert!(safe_join(Path::new("/b"), &rel).is_err());
        }
    }

    #[test]
    fn duplicate_key_ignores_case_and_normalization() {
        assert_eq!(duplicate_key("Ä/Datei.TXT"), duplicate_key("A\u{308}/datei.txt"));
        assert_ne!(duplicate_key("a/b"), duplicate_key("a/c"));
    }

    #[test]
    fn sanitize_file_name_makes_names_safe() {
        assert_eq!(sanitize_file_name("Herbst-Drop 26"), "Herbst-Drop 26");
        assert_eq!(sanitize_file_name("a/b:c*d"), "a-b-c-d");
        assert_eq!(sanitize_file_name("  .hidden.  "), "hidden");
        assert_eq!(sanitize_file_name(""), "Unbenannt");
        assert_eq!(sanitize_file_name("CON"), "_CON");
        assert!(sanitize_file_name(&"x".repeat(500)).len() <= 120);
        for n in ["../..", "\u{0}", "...", "NUL.txt"] {
            assert!(validate_component(&sanitize_file_name(n)).is_ok(), "{n}");
        }
    }

    #[test]
    fn write_atomic_replaces_content_and_leaves_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sub/state.json");
        write_atomic(&file, b"eins").unwrap();
        write_atomic(&file, b"zwei").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"zwei");
        let names: Vec<_> = fs::read_dir(file.parent().unwrap()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names.len(), 1, "{names:?}");
    }

    #[cfg(unix)]
    #[test]
    fn written_files_have_the_usual_permissions_not_the_temp_file_ones() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("export.png");
        write_atomic(&file, b"bild").unwrap();
        assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o644);
    }

    #[test]
    fn interrupted_write_keeps_the_target_unchanged() {
        // Simulierter Absturz: die Temp-Datei existiert, `persist` wurde nie aufgerufen.
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("state.json");
        write_atomic(&file, b"alt").unwrap();
        {
            let mut tmp = tempfile::Builder::new().prefix(".cypher-tmp-").tempfile_in(dir.path()).unwrap();
            tmp.write_all(b"halb gesch").unwrap();
            // tmp wird ohne persist verworfen
        }
        assert_eq!(fs::read(&file).unwrap(), b"alt");
    }

    #[test]
    fn read_json_distinguishes_missing_and_corrupt() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("x.json");
        assert!(read_json::<serde_json::Value>(&file).unwrap().is_none());
        write_json_atomic(&file, &serde_json::json!({"a": 1})).unwrap();
        assert_eq!(read_json::<serde_json::Value>(&file).unwrap().unwrap()["a"], 1);
        fs::write(&file, b"{kaputt").unwrap();
        let err = read_json::<serde_json::Value>(&file).unwrap_err();
        assert_eq!(err.source.kind(), std::io::ErrorKind::InvalidData);
        let moved = quarantine_corrupt(&file).unwrap();
        assert!(!file.exists() && moved.exists());
        assert!(moved.to_string_lossy().contains(".corrupt-"));
    }

    #[test]
    fn ensure_within_resolves_symlink_escapes() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("base");
        let outside = dir.path().join("outside");
        fs::create_dir_all(&base).unwrap();
        fs::create_dir_all(&outside).unwrap();
        assert!(ensure_within(&base, &base.join("neu/datei.txt")).is_ok());
        assert!(matches!(ensure_within(&base, &outside), Err(EnsureWithinError::Path(PathError::Escapes))));
        assert!(matches!(
            ensure_within(&base, &base.join("../outside/x")),
            Err(EnsureWithinError::Path(PathError::Escapes))
        ));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, base.join("link")).unwrap();
            assert!(matches!(
                ensure_within(&base, &base.join("link/geheim.txt")),
                Err(EnsureWithinError::Path(PathError::Escapes))
            ));
        }
    }

    #[test]
    fn remove_dir_managed_only_touches_the_managed_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("programs");
        let victim = root.join("blender/5.2.2");
        fs::create_dir_all(&victim).unwrap();
        fs::write(victim.join("blender.exe"), b"x").unwrap();
        let outside = dir.path().join("outside");
        fs::create_dir_all(&outside).unwrap();

        assert!(remove_dir_managed(&outside, &root).is_err(), "außerhalb darf nichts gelöscht werden");
        assert!(outside.exists());
        assert!(remove_dir_managed(&root, &root).is_err(), "die Wurzel selbst nie");
        remove_dir_managed(&victim, &root).unwrap();
        assert!(!victim.exists());
        remove_dir_managed(&victim, &root).unwrap(); // schon weg: kein Fehler
    }

    #[test]
    fn rename_dir_atomic_refuses_existing_targets() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (dir.path().join("a"), dir.path().join("b"));
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        assert!(rename_dir_atomic(&a, &b).is_err());
        fs::remove_dir_all(&b).unwrap();
        rename_dir_atomic(&a, &dir.path().join("neu/c")).unwrap();
        assert!(dir.path().join("neu/c").exists());
    }

    #[test]
    fn free_space_works_for_missing_paths() {
        let dir = tempfile::tempdir().unwrap();
        assert!(free_space(&dir.path().join("noch/nicht/da")).unwrap() > 0);
    }
}
