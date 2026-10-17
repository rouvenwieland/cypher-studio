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

/// Von Windows reservierte Gerätenamen (auch mit Endung, zum Beispiel `CON.txt`). `COM0`/`LPT0` und die hochgestellten
/// Ziffern (`COM¹`, `LPT²`) zählt Microsoft ebenfalls dazu; sie werden vor dem Vergleich per NFKC zu `COM1`.
/// `CONIN$`, `CONOUT$` und `CLOCK$` sind Konsolen- und alte Systemgeräte.
const RESERVED: [&str; 27] = [
    "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$", "CLOCK$", "COM0", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6",
    "COM7", "COM8", "COM9", "LPT0", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Ist der Name (ohne Endung; Groß/Klein und Kompatibilitätsformen egal) ein reservierter Windows-Gerätename?
fn is_reserved_stem(stem: &str) -> bool {
    let folded: String = stem.trim_end().nfkc().collect::<String>().to_uppercase();
    RESERVED.contains(&folded.as_str())
}

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
    if is_reserved_stem(comp.split('.').next().unwrap_or(comp)) {
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

/// Pfade ab dieser Länge behalten unter Windows das Präfix `\\?\` (ohne es wären sie für ältere Programme unbrauchbar).
#[cfg(windows)]
const VERBATIM_KEEP_FROM: usize = 250;

/// Windows liefert `canonicalize` mit dem Präfix `\\?\`. Das gehört weder in Anzeigen noch in Programmargumente (Krita,
/// Blender) oder den Dateimanager; kurze Pfade werden zurückverwandelt (`\\?\C:\x` zu `C:\x`, `\\?\UNC\s\f` zu `\\s\f`).
/// Auf anderen Systemen unverändert.
pub fn simplify_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy().into_owned();
        if text.len() < VERBATIM_KEEP_FROM {
            if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
                return PathBuf::from(format!(r"\\{rest}"));
            }
            if let Some(rest) = text.strip_prefix(r"\\?\") {
                let bytes = rest.as_bytes();
                if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
                    return PathBuf::from(rest);
                }
            }
        }
    }
    path
}

fn canonicalize_existing_prefix(path: &Path) -> Result<PathBuf, IoError> {
    let mut existing = path.to_path_buf();
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    loop {
        match fs::canonicalize(&existing) {
            Ok(canon) => {
                let mut out = simplify_path(canon);
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
    let base_canon = simplify_path(
        fs::canonicalize(base).map_err(|e| EnsureWithinError::Io(IoError::new(IoOp::Metadata, base, e)))?,
    );
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

/// Ist `path` selbst ein Symlink oder eine Junction (ohne ihn aufzulösen)? Unter Windows zählen alle Reparse-Punkte, die
/// auf einen anderen Namen zeigen (Symlink, Junction/Mount-Point); Cloud-Platzhalter (OneDrive) sind keine Links.
pub fn is_link(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink())
}

/// Prüft jedes **bestehende** Glied von `root` (ausschließlich) bis `path` (einschließlich): keines darf ein Symlink oder
/// eine Junction sein. Ab dem ersten fehlenden Glied ist der Rest in Ordnung. `path` muss unter `root` liegen.
///
/// Schreibwege in geteilten Ordnern (Bibliothek, Projekte, Pakete) brauchen das: ein Sync-Werkzeug kann Links mitbringen,
/// durch die ein Schreiben außerhalb der Wurzel landen würde. `safe_join` prüft nur den Text des Pfads.
pub fn ensure_no_links_below(root: &Path, path: &Path) -> Result<(), EnsureWithinError> {
    let rel = path.strip_prefix(root).map_err(|_| PathError::Escapes)?;
    let mut current = root.to_path_buf();
    for comp in rel.components() {
        match comp {
            Component::Normal(name) => current.push(name),
            _ => return Err(PathError::Escapes.into()),
        }
        match fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => return Err(PathError::LinkInPath.into()),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(IoError::new(IoOp::Metadata, &current, e).into()),
        }
    }
    Ok(())
}

/// Legt den relativen Ordnerpfad `rel_dir` unterhalb von `root` an, **Komponente für Komponente**: bestehende Glieder
/// dürfen keine Links sein, neu angelegte werden gleich nachgeprüft (Wettlauf mit einem Sync-Werkzeug), am Ende muss der
/// aufgelöste Pfad unter der aufgelösten Wurzel liegen. Leerer `rel_dir` liefert `root`. Gibt den Ordner zurück.
pub fn create_dir_all_within(root: &Path, rel_dir: &str) -> Result<PathBuf, EnsureWithinError> {
    if rel_dir.is_empty() {
        return Ok(root.to_path_buf());
    }
    let mut current = root.to_path_buf();
    for comp in split_rel(rel_dir)? {
        current.push(comp);
        match fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => return Err(PathError::LinkInPath.into()),
            Ok(meta) if meta.is_dir() => {}
            Ok(_) => {
                let e = std::io::Error::new(std::io::ErrorKind::AlreadyExists, "an dieser Stelle liegt eine Datei");
                return Err(IoError::new(IoOp::CreateDir, &current, e).into());
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                match fs::create_dir(&current) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(e) => return Err(IoError::new(IoOp::CreateDir, &current, e).into()),
                }
                if is_link(&current) {
                    return Err(PathError::LinkInPath.into());
                }
            }
            Err(e) => return Err(IoError::new(IoOp::Metadata, &current, e).into()),
        }
    }
    ensure_within(root, &current)?;
    Ok(current)
}

/// Bereitet das Schreiben von `rel` unterhalb von `root` vor: prüft den Pfad (6.6), legt die Ordner sicher an
/// ([`create_dir_all_within`]) und liefert den Zielpfad. Auch das Ziel selbst darf kein Link sein.
pub fn prepare_write_target(root: &Path, rel: &str) -> Result<PathBuf, EnsureWithinError> {
    let comps = split_rel(rel)?;
    let Some((name, dirs)) = comps.split_last() else { return Err(PathError::Empty.into()) };
    let parent = create_dir_all_within(root, &dirs.join("/"))?;
    let target = parent.join(name);
    ensure_no_links_below(root, &target)?;
    Ok(target)
}

/// Letzte Prüfung unmittelbar vor dem Schreiben oder Umbenennen: kein Glied zwischen `root` und `target` ist inzwischen
/// ein Link geworden, und der aufgelöste Elternordner liegt noch unter der Wurzel.
pub fn verify_write_target(root: &Path, target: &Path) -> Result<(), EnsureWithinError> {
    ensure_no_links_below(root, target)?;
    if let Some(parent) = target.parent() {
        ensure_within(root, parent)?;
    }
    Ok(())
}

/// Schreibt `bytes` atomar nach `root/rel` (Ordner sicher angelegt, keine Links im Weg).
pub fn write_atomic_within(root: &Path, rel: &str, bytes: &[u8]) -> Result<PathBuf, EnsureWithinError> {
    let target = prepare_write_target(root, rel)?;
    verify_write_target(root, &target)?;
    write_atomic(&target, bytes)?;
    Ok(target)
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

/// So lange wird bei einer kurzen Sperre höchstens wiederholt.
pub const TRANSIENT_LOCK_PATIENCE: std::time::Duration = std::time::Duration::from_secs(10);

/// Windows: Virenscanner, Indexdienst und Explorer halten frisch geschriebene Dateien kurz offen; Umbenennen scheitert dann
/// mit „Zugriff verweigert“ (5) oder einer Freigabeverletzung (32, 33). Auf anderen Systemen gibt es das nicht.
pub fn is_transient_lock(error: &std::io::Error) -> bool {
    cfg!(windows)
        && (error.kind() == std::io::ErrorKind::PermissionDenied || matches!(error.raw_os_error(), Some(5 | 32 | 33)))
}

/// Führt `op` aus und wiederholt es bei einer kurzen Sperre (Wartezeit wächst von 40 auf 400 ms), höchstens `patience` lang.
pub fn retry_while<T>(
    patience: std::time::Duration,
    transient: impl Fn(&std::io::Error) -> bool,
    mut op: impl FnMut() -> std::io::Result<T>,
) -> std::io::Result<T> {
    let deadline = std::time::Instant::now() + patience;
    let mut delay = std::time::Duration::from_millis(40);
    loop {
        match op() {
            Err(e) if transient(&e) && std::time::Instant::now() < deadline => {
                std::thread::sleep(delay);
                delay = (delay * 2).min(std::time::Duration::from_millis(400));
            }
            other => return other,
        }
    }
}

/// [`retry_while`] mit der Sperrenprüfung des Betriebssystems.
pub fn retry_transient<T>(op: impl FnMut() -> std::io::Result<T>) -> std::io::Result<T> {
    retry_while(TRANSIENT_LOCK_PATIENCE, is_transient_lock, op)
}

/// `persist` mit Wiederholung bei kurzen Sperren des Ziels (siehe [`is_transient_lock`]).
pub fn persist_with_retry(tmp: tempfile::NamedTempFile, path: &Path) -> std::io::Result<()> {
    let deadline = std::time::Instant::now() + TRANSIENT_LOCK_PATIENCE;
    let mut delay = std::time::Duration::from_millis(40);
    let mut tmp = tmp;
    loop {
        match tmp.persist(path) {
            Ok(_) => return Ok(()),
            Err(e) if is_transient_lock(&e.error) && std::time::Instant::now() < deadline => {
                std::thread::sleep(delay);
                delay = (delay * 2).min(std::time::Duration::from_millis(400));
                tmp = e.file;
            }
            Err(e) => return Err(e.error),
        }
    }
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
    persist_with_retry(tmp, path).map_err(|e| IoError::new(IoOp::Rename, path, e))?;
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
    retry_transient(|| fs::rename(from, to)).map_err(|e| IoError::new(IoOp::Rename, from, e))
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
    let root =
        simplify_path(fs::canonicalize(managed_root).map_err(|e| IoError::new(IoOp::Metadata, managed_root, e))?);
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

/// Hilfen für Tests mit Verknüpfungen (auch von den Tests anderer Module benutzt).
#[cfg(test)]
pub(crate) mod test_links {
    use std::path::Path;

    /// Legt `link` als Verknüpfung auf den Ordner `target` an: Symlink (Unix) oder Junction (Windows, braucht keine Rechte).
    pub(crate) fn make_dir_link(target: &Path, link: &Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        {
            let out = std::process::Command::new("cmd")
                .arg("/C")
                .arg("mklink")
                .arg("/J")
                .arg(link)
                .arg(target)
                .output()
                .unwrap();
            assert!(out.status.success(), "mklink: {}", String::from_utf8_lossy(&out.stdout));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_links::make_dir_link;
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

    #[test]
    fn retry_while_repeats_only_transient_errors_and_only_for_the_patience_given() {
        use std::time::Duration;
        let mut calls = 0;
        let ok = retry_while(
            Duration::from_secs(5),
            |_| true,
            || {
                calls += 1;
                if calls < 3 { Err(std::io::Error::other("gesperrt")) } else { Ok(calls) }
            },
        );
        assert_eq!(ok.unwrap(), 3);

        let mut calls = 0;
        let failed: std::io::Result<()> = retry_while(
            Duration::from_secs(5),
            |_| false,
            || {
                calls += 1;
                Err(std::io::Error::other("endgültig"))
            },
        );
        assert!(failed.is_err());
        assert_eq!(calls, 1, "nicht kurzzeitige Fehler werden nicht wiederholt");

        let started = std::time::Instant::now();
        let gave_up: std::io::Result<()> =
            retry_while(Duration::from_millis(150), |_| true, || Err(std::io::Error::other("immer gesperrt")));
        assert!(gave_up.is_err());
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn only_windows_treats_access_denied_as_a_short_lock() {
        let denied = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert_eq!(is_transient_lock(&denied), cfg!(windows));
        assert!(!is_transient_lock(&std::io::Error::from(std::io::ErrorKind::NotFound)));
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

    #[test]
    fn reserved_windows_names_are_complete() {
        // Befund N8: COM0/LPT0, hochgestellte Ziffern, Konsolengeräte, mit und ohne Endung, Groß/Klein egal
        for name in [
            "COM0",
            "LPT0",
            "com0.txt",
            "COM\u{b9}",
            "LPT\u{b2}",
            "COM\u{b3}.txt",
            "lpt\u{b9}.tar.gz",
            "CONIN$",
            "CONOUT$",
            "conout$.log",
            "CLOCK$",
            "Lpt9",
            "con .txt",
            "AUX.x",
            "nul",
        ] {
            assert_eq!(validate_component(name), Err(PathError::ReservedName), "{name:?}");
            assert_eq!(safe_join(Path::new("/b"), &format!("dir/{name}")).unwrap_err(), PathError::ReservedName);
        }
        for name in ["COM10", "COMX", "CONSOLE", "LPT", "Comfort.txt", "con-x", "CONIN", "Programm", "x.COM1"] {
            assert_eq!(validate_component(name), Ok(()), "{name:?} ist ein erlaubter Name");
        }
        // abschließende Punkte und Leerzeichen bleiben abgelehnt
        assert_eq!(validate_component("CON."), Err(PathError::TrailingDotOrSpace));
        assert_eq!(validate_component("name "), Err(PathError::TrailingDotOrSpace));
    }

    fn base_and_outside() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("base");
        let outside = dir.path().join("outside");
        fs::create_dir_all(&base).unwrap();
        fs::create_dir_all(&outside).unwrap();
        (dir, base, outside)
    }

    #[test]
    fn is_link_sees_symlinks_and_junctions_but_not_plain_folders() {
        let (_dir, base, outside) = base_and_outside();
        make_dir_link(&outside, &base.join("verweis"));
        fs::create_dir_all(base.join("echt")).unwrap();
        assert!(is_link(&base.join("verweis")));
        assert!(!is_link(&base.join("echt")));
        assert!(!is_link(&base.join("fehlt")));
    }

    #[test]
    fn create_dir_all_within_never_writes_through_a_link() {
        // Befund M1: ein Ordner `Motive`, der auf ein Ziel außerhalb zeigt, darf keinen Schreibzugriff dorthin erlauben
        let (_dir, base, outside) = base_and_outside();
        make_dir_link(&outside, &base.join("Motive"));
        let err = create_dir_all_within(&base, "Motive/Unter/Ordner").unwrap_err();
        assert!(matches!(err, EnsureWithinError::Path(PathError::LinkInPath)), "{err:?}");
        assert!(fs::read_dir(&outside).unwrap().next().is_none(), "außerhalb wurde nichts angelegt");

        // ein Link tiefer in der Kette
        fs::create_dir_all(base.join("a")).unwrap();
        make_dir_link(&outside, &base.join("a/b"));
        assert!(matches!(create_dir_all_within(&base, "a/b/c"), Err(EnsureWithinError::Path(PathError::LinkInPath))));
        assert!(fs::read_dir(&outside).unwrap().next().is_none());

        // normale Ordner entstehen, auch mehrfach; eine Datei im Weg ist ein Fehler, kein Überschreiben
        let made = create_dir_all_within(&base, "x/y/z").unwrap();
        assert!(made.is_dir() && made.ends_with("x/y/z"));
        create_dir_all_within(&base, "x/y/z").unwrap();
        fs::write(base.join("datei"), b"1").unwrap();
        assert!(matches!(create_dir_all_within(&base, "datei/unter"), Err(EnsureWithinError::Io(_))));
        // die Textregeln gelten weiter
        assert!(matches!(
            create_dir_all_within(&base, "../draussen"),
            Err(EnsureWithinError::Path(PathError::ParentTraversal))
        ));
        assert_eq!(create_dir_all_within(&base, "").unwrap(), base);
    }

    #[test]
    fn prepare_write_target_refuses_links_in_the_chain_and_at_the_end() {
        let (_dir, base, outside) = base_and_outside();
        make_dir_link(&outside, &base.join("Motive"));
        assert!(matches!(
            prepare_write_target(&base, "Motive/evil.txt"),
            Err(EnsureWithinError::Path(PathError::LinkInPath))
        ));
        assert!(!outside.join("evil.txt").exists());

        // das Ziel selbst ist ein Link (hier ein Ordner-Link an der Stelle der Datei)
        make_dir_link(&outside, &base.join("datei.txt"));
        assert!(matches!(
            prepare_write_target(&base, "datei.txt"),
            Err(EnsureWithinError::Path(PathError::LinkInPath))
        ));

        let ok = prepare_write_target(&base, "Neu/Unter/x.png").unwrap();
        assert!(ok.parent().unwrap().is_dir() && !ok.exists());
        assert!(matches!(
            prepare_write_target(&base, "Neu/COM\u{b9}.txt"),
            Err(EnsureWithinError::Path(PathError::ReservedName))
        ));

        // kurz vor dem Schreiben wird erneut geprüft: wurde der Ordner inzwischen durch einen Link ersetzt, scheitert es
        fs::remove_dir_all(base.join("Neu")).unwrap();
        make_dir_link(&outside, &base.join("Neu"));
        assert!(matches!(verify_write_target(&base, &ok), Err(EnsureWithinError::Path(PathError::LinkInPath))));
    }

    #[test]
    fn ensure_no_links_below_accepts_missing_tails_and_rejects_foreign_paths() {
        let (dir, base, outside) = base_and_outside();
        fs::create_dir_all(base.join("echt")).unwrap();
        assert!(ensure_no_links_below(&base, &base.join("echt/noch/nicht/da.txt")).is_ok());
        assert!(matches!(
            ensure_no_links_below(&base, &outside.join("x")),
            Err(EnsureWithinError::Path(PathError::Escapes))
        ));
        assert!(matches!(
            ensure_no_links_below(&base, &dir.path().join("base/../outside")),
            Err(EnsureWithinError::Path(PathError::Escapes))
        ));
    }

    #[test]
    fn write_atomic_within_writes_inside_and_refuses_links() {
        let (_dir, base, outside) = base_and_outside();
        let written = write_atomic_within(&base, ".cypher/meta/Motive/a.png.json", b"{}").unwrap();
        assert_eq!(fs::read(written).unwrap(), b"{}");
        fs::remove_dir_all(base.join(".cypher")).unwrap();
        make_dir_link(&outside, &base.join(".cypher"));
        assert!(write_atomic_within(&base, ".cypher/meta/x.json", b"{}").is_err());
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
    }
}
