//! Archive sicher entpacken (ARCHITEKTUR.md 2.7, 6.6): zip, tar.xz, tar.gz, 7z und selbstentpackendes 7z.
//!
//! Schutz gegen: absolute Pfade, `..`, Laufwerks-/UNC-Präfixe, Symlink-Ausbrüche, Hardlinks, Gerätedateien,
//! doppelte Einträge (auch nach Groß-/Kleinschreibung und Unicode-Normalisierung), Archivbomben (Gesamtgröße,
//! Eintragszahl, Verhältnis) und das Schreiben durch Symlinks. Das Ziel ist ein frischer Staging-Ordner.

use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio_util::sync::CancellationToken;

use crate::api::{ArtifactKind, IoOp, UnsafeEntryReason};
use crate::error::{ArchiveError, IoError, PathError};
use crate::platform::fsx;
use crate::progress::ProgressSink;

/// Grenzen gegen Archivbomben.
#[derive(Debug, Clone)]
pub struct ExtractLimits {
    /// Höchste Gesamtgröße der entpackten Daten.
    pub max_total_bytes: u64,
    /// Höchste Zahl an Einträgen.
    pub max_entries: u64,
    /// Größtes Verhältnis entpackt : gepackt (Standard 200). Gilt erst ab 64 MiB Ausgabe.
    pub max_ratio: u64,
}

impl Default for ExtractLimits {
    fn default() -> Self {
        ExtractLimits { max_total_bytes: 8 * 1024 * 1024 * 1024, max_entries: 200_000, max_ratio: 200 }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ExtractOptions {
    /// Führende Pfadkomponenten, die weggelassen werden (`blender-5.2.2-windows-x64/` → 1).
    pub strip_components: u32,
    /// Symlinks im Archiv anlegen (Linux/macOS-tar). Nur relative Ziele innerhalb des Zielordners.
    pub allow_symlinks: bool,
    /// Windows-Namensregeln (reservierte Namen, `:`, Punkt/Leerzeichen am Ende) und Duplikate ohne Beachtung der
    /// Groß-/Kleinschreibung. Standard: auf Windows und macOS an.
    pub strict_names: bool,
}

impl ExtractOptions {
    pub fn new(strip_components: u32, allow_symlinks: bool) -> Self {
        ExtractOptions { strip_components, allow_symlinks, strict_names: cfg!(any(windows, target_os = "macos")) }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ExtractStats {
    pub entries: u64,
    pub files: u64,
    pub dirs: u64,
    pub symlinks: u64,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractProgress {
    pub entries_done: u64,
    pub entries_total: Option<u64>,
    pub bytes_written: u64,
}

/// Prüft den Pfad eines Archiveintrags und liefert den bereinigten relativen Pfad (`/`-getrennt).
/// `Ok(None)`: der Eintrag entfällt durch `strip` (z. B. der Wurzelordner selbst).
pub fn sanitize_entry(raw: &str, strip: u32, strict_names: bool) -> Result<Option<String>, ArchiveError> {
    let unsafe_entry = |reason: UnsafeEntryReason| ArchiveError::UnsafeEntry { entry: display_entry(raw), reason };
    if raw.is_empty() {
        return Err(unsafe_entry(UnsafeEntryReason::InvalidCharacters));
    }
    if raw.chars().any(|c| c == '\0' || c.is_control()) {
        return Err(unsafe_entry(UnsafeEntryReason::InvalidCharacters));
    }
    let bytes = raw.as_bytes();
    if raw.starts_with('/') || raw.starts_with('\\') {
        return Err(unsafe_entry(UnsafeEntryReason::AbsolutePath));
    }
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err(unsafe_entry(UnsafeEntryReason::AbsolutePath));
    }
    let normalized = raw.replace('\\', "/");
    let comps: Vec<&str> = normalized.split('/').filter(|c| !c.is_empty() && *c != ".").collect();
    // `..` irgendwo im Pfad ist immer ein Angriff, auch wenn `strip` es später entfernen würde
    if comps.contains(&"..") {
        return Err(unsafe_entry(UnsafeEntryReason::ParentTraversal));
    }
    if comps.len() <= strip as usize {
        return Ok(None);
    }
    let kept = &comps[strip as usize..];
    for comp in kept {
        let checked = if strict_names {
            fsx::validate_component(comp)
        } else if comp.len() > fsx::MAX_COMPONENT_BYTES {
            Err(PathError::TooLong)
        } else {
            Ok(())
        };
        checked.map_err(|e| unsafe_entry(e.unsafe_reason()))?;
    }
    Ok(Some(kept.join("/")))
}

fn display_entry(raw: &str) -> String {
    raw.chars().take(200).collect()
}

/// Zähler, der mitzählt, wie viele gepackte Bytes bisher gelesen wurden (für das Verhältnis bei Strömen).
struct CountingReader<R> {
    inner: R,
    count: Arc<AtomicU64>,
}

impl<R: Read> Read for CountingReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.count.fetch_add(n as u64, Ordering::Relaxed);
        Ok(n)
    }
}

impl<R: Seek> Seek for CountingReader<R> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        self.inner.seek(pos)
    }
}

/// Gemeinsamer Zustand beim Entpacken.
struct Ctx<'a> {
    dest: &'a Path,
    limits: &'a ExtractLimits,
    opts: ExtractOptions,
    sink: &'a dyn ProgressSink<ExtractProgress>,
    cancel: &'a CancellationToken,
    stats: ExtractStats,
    seen: HashSet<String>,
    created_dirs: HashSet<PathBuf>,
    symlinks: HashSet<String>,
    entries_total: Option<u64>,
    /// gepackte Bytes bisher (Ströme); 0 = unbekannt
    packed: Option<Arc<AtomicU64>>,
    last_emit: std::time::Instant,
}

impl<'a> Ctx<'a> {
    fn new(
        dest: &'a Path,
        limits: &'a ExtractLimits,
        opts: ExtractOptions,
        sink: &'a dyn ProgressSink<ExtractProgress>,
        cancel: &'a CancellationToken,
    ) -> Self {
        Ctx {
            dest,
            limits,
            opts,
            sink,
            cancel,
            stats: ExtractStats::default(),
            seen: HashSet::new(),
            created_dirs: HashSet::new(),
            symlinks: HashSet::new(),
            entries_total: None,
            packed: None,
            last_emit: std::time::Instant::now() - std::time::Duration::from_secs(1),
        }
    }

    fn check_cancel(&self) -> Result<(), ArchiveError> {
        if self.cancel.is_cancelled() { Err(ArchiveError::Cancelled) } else { Ok(()) }
    }

    fn emit(&mut self, force: bool) {
        if force || self.last_emit.elapsed() >= std::time::Duration::from_millis(100) {
            self.last_emit = std::time::Instant::now();
            self.sink.emit(ExtractProgress {
                entries_done: self.stats.entries,
                entries_total: self.entries_total,
                bytes_written: self.stats.bytes,
            });
        }
    }

    /// Prüft Eintragszahl, Duplikate und liefert den Zielpfad (relativ + absolut).
    fn begin_entry(&mut self, raw: &str) -> Result<Option<(String, PathBuf)>, ArchiveError> {
        self.check_cancel()?;
        let Some(rel) = sanitize_entry(raw, self.opts.strip_components, self.opts.strict_names)? else {
            return Ok(None);
        };
        if self.stats.entries + 1 > self.limits.max_entries {
            return Err(ArchiveError::TooLarge { limit: self.limits.max_total_bytes });
        }
        let key = if self.opts.strict_names { fsx::duplicate_key(&rel) } else { rel.clone() };
        if !self.seen.insert(key) {
            return Err(ArchiveError::UnsafeEntry {
                entry: display_entry(raw),
                reason: UnsafeEntryReason::DuplicateEntry,
            });
        }
        // nie durch einen Symlink schreiben
        let mut prefix = String::new();
        for comp in rel.split('/') {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(comp);
            if self.symlinks.contains(&prefix) {
                return Err(ArchiveError::UnsafeEntry {
                    entry: display_entry(raw),
                    reason: UnsafeEntryReason::SymlinkEscape,
                });
            }
        }
        let mut full = self.dest.to_path_buf();
        for comp in rel.split('/') {
            full.push(comp);
        }
        Ok(Some((rel, full)))
    }

    fn make_dir(&mut self, path: &Path) -> Result<(), ArchiveError> {
        if self.created_dirs.contains(path) {
            return Ok(());
        }
        fs::create_dir_all(path).map_err(|e| IoError::new(IoOp::CreateDir, path, e))?;
        self.created_dirs.insert(path.to_path_buf());
        Ok(())
    }

    fn account(&mut self, written: u64) -> Result<(), ArchiveError> {
        self.stats.bytes += written;
        if self.stats.bytes > self.limits.max_total_bytes {
            return Err(ArchiveError::TooLarge { limit: self.limits.max_total_bytes });
        }
        if let Some(packed) = &self.packed {
            let packed = packed.load(Ordering::Relaxed);
            // Verhältnis erst ab 64 MiB Ausgabe prüfen, mit 64 KiB Spielraum für Kopfdaten
            if self.stats.bytes > 64 * 1024 * 1024
                && self.stats.bytes > self.limits.max_ratio.saturating_mul(packed + 64 * 1024)
            {
                return Err(ArchiveError::TooLarge { limit: self.limits.max_total_bytes });
            }
        }
        Ok(())
    }

    /// Schreibt einen Dateieintrag; `declared` ist die im Archiv angegebene Größe.
    fn write_file(
        &mut self,
        full: &Path,
        reader: &mut dyn Read,
        declared: Option<u64>,
        mode: Option<u32>,
    ) -> Result<(), ArchiveError> {
        if let Some(parent) = full.parent() {
            self.make_dir(parent)?;
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(full)
            .map_err(|e| IoError::new(IoOp::Write, full, e))?;
        let mut buf = vec![0u8; 64 * 1024];
        let mut entry_bytes: u64 = 0;
        loop {
            self.check_cancel()?;
            let n = reader.read(&mut buf).map_err(|e| ArchiveError::Invalid(format!("Lesefehler: {e}")))?;
            if n == 0 {
                break;
            }
            entry_bytes += n as u64;
            if declared.is_some_and(|d| entry_bytes > d) {
                return Err(ArchiveError::Invalid("Eintrag ist größer als im Archiv angegeben".into()));
            }
            file.write_all(&buf[..n]).map_err(|e| IoError::new(IoOp::Write, full, e))?;
            self.account(n as u64)?;
        }
        file.flush().map_err(|e| IoError::new(IoOp::Write, full, e))?;
        drop(file);
        set_mode(full, mode);
        self.stats.files += 1;
        self.stats.entries += 1;
        self.emit(false);
        Ok(())
    }

    fn write_dir(&mut self, full: &Path) -> Result<(), ArchiveError> {
        self.make_dir(full)?;
        self.stats.dirs += 1;
        self.stats.entries += 1;
        self.emit(false);
        Ok(())
    }

    /// Legt einen Symlink an, wenn erlaubt und das Ziel relativ innerhalb des Zielordners bleibt.
    fn write_symlink(&mut self, raw: &str, rel: &str, full: &Path, target: &str) -> Result<(), ArchiveError> {
        let bad = |reason| ArchiveError::UnsafeEntry { entry: display_entry(raw), reason };
        if !self.opts.allow_symlinks {
            return Err(bad(UnsafeEntryReason::SymlinkEscape));
        }
        if target.is_empty() || target.starts_with('/') || target.starts_with('\\') || target.contains('\0') {
            return Err(bad(UnsafeEntryReason::SymlinkEscape));
        }
        let tb = target.as_bytes();
        if tb.len() >= 2 && tb[0].is_ascii_alphabetic() && tb[1] == b':' {
            return Err(bad(UnsafeEntryReason::SymlinkEscape));
        }
        // Lexikalisch auflösen: Elternordner des Links + Ziel darf die Wurzel nie verlassen
        let mut depth: i64 = rel.split('/').count() as i64 - 1;
        for comp in target.replace('\\', "/").split('/') {
            match comp {
                "" | "." => {}
                ".." => {
                    depth -= 1;
                    if depth < 0 {
                        return Err(bad(UnsafeEntryReason::SymlinkEscape));
                    }
                }
                _ => depth += 1,
            }
        }
        if let Some(parent) = full.parent() {
            self.make_dir(parent)?;
        }
        make_symlink(target, full).map_err(|e| IoError::new(IoOp::Write, full, e))?;
        self.symlinks.insert(rel.to_owned());
        self.stats.symlinks += 1;
        self.stats.entries += 1;
        Ok(())
    }
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: Option<u32>) {
    use std::os::unix::fs::PermissionsExt;
    if let Some(mode) = mode {
        let exec = mode & 0o111 != 0;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(if exec { 0o755 } else { 0o644 }));
    }
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: Option<u32>) {}

#[cfg(unix)]
fn make_symlink(target: &str, link: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(not(unix))]
fn make_symlink(_target: &str, _link: &Path) -> io::Result<()> {
    Err(io::Error::other("Symlinks werden auf diesem System nicht angelegt"))
}

/// Entpackt `src` nach `dest` (Ordner muss existieren). Zusätzliche Nacharbeit: kein Symlink im Ergebnis zeigt aus
/// `dest` heraus.
pub fn extract(
    kind: ArtifactKind,
    src: &Path,
    dest: &Path,
    limits: &ExtractLimits,
    opts: &ExtractOptions,
    sink: &dyn ProgressSink<ExtractProgress>,
    cancel: &CancellationToken,
) -> Result<ExtractStats, ArchiveError> {
    let mut ctx = Ctx::new(dest, limits, *opts, sink, cancel);
    match kind {
        ArtifactKind::Zip => extract_zip(src, &mut ctx)?,
        ArtifactKind::TarXz => extract_tar(src, TarCompression::Xz, &mut ctx)?,
        ArtifactKind::TarGz => extract_tar(src, TarCompression::Gz, &mut ctx)?,
        ArtifactKind::SevenZ => extract_7z(src, false, &mut ctx)?,
        ArtifactKind::Sfx7z => extract_7z(src, true, &mut ctx)?,
        ArtifactKind::Dmg | ArtifactKind::AppImage | ArtifactKind::ExeInstaller => {
            return Err(ArchiveError::Unsupported(format!("{kind:?} ist kein Archiv für den Entpacker")));
        }
    }
    ctx.emit(true);
    verify_no_escaping_links(dest)?;
    Ok(ctx.stats)
}

/// Nacharbeit: kein Symlink im entpackten Baum darf aus dem Baum herauszeigen.
pub fn verify_no_escaping_links(root: &Path) -> Result<(), ArchiveError> {
    let root_canon = fs::canonicalize(root).map_err(|e| IoError::new(IoOp::Metadata, root, e))?;
    for entry in walkdir::WalkDir::new(root).follow_links(false).into_iter().filter_map(Result::ok) {
        if entry.path_is_symlink() {
            match fs::canonicalize(entry.path()) {
                Ok(target) if target.starts_with(&root_canon) => {}
                Ok(_) => {
                    return Err(ArchiveError::UnsafeEntry {
                        entry: entry.path().strip_prefix(root).unwrap_or(entry.path()).to_string_lossy().into_owned(),
                        reason: UnsafeEntryReason::SymlinkEscape,
                    });
                }
                // hängender Link (Ziel erst später oder nie vorhanden): Ziel lexikalisch wurde beim Anlegen geprüft
                Err(_) => {}
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// zip
// ---------------------------------------------------------------------------------------------

fn extract_zip(src: &Path, ctx: &mut Ctx<'_>) -> Result<(), ArchiveError> {
    let file = File::open(src).map_err(|e| IoError::read(src, e))?;
    let mut archive = zip::ZipArchive::new(BufReader::new(file)).map_err(|e| ArchiveError::Invalid(e.to_string()))?;
    ctx.entries_total = Some(archive.len() as u64);
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| ArchiveError::Invalid(e.to_string()))?;
        let raw = match entry.name() {
            Ok(name) => name.into_owned(),
            Err(_) => {
                return Err(ArchiveError::UnsafeEntry {
                    entry: "(kein UTF-8)".into(),
                    reason: UnsafeEntryReason::InvalidCharacters,
                });
            }
        };
        let Some((_rel, full)) = ctx.begin_entry(&raw)? else { continue };
        let is_symlink = entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000);
        if entry.is_dir() || raw.ends_with('/') {
            ctx.write_dir(&full)?;
            continue;
        }
        if is_symlink {
            return Err(ArchiveError::UnsafeEntry {
                entry: display_entry(&raw),
                reason: UnsafeEntryReason::SymlinkEscape,
            });
        }
        let size = entry.size();
        let packed = entry.compressed_size();
        if size > 64 * 1024 * 1024 && size > ctx.limits.max_ratio.saturating_mul(packed.max(1)) {
            return Err(ArchiveError::TooLarge { limit: ctx.limits.max_total_bytes });
        }
        let mode = entry.unix_mode();
        ctx.write_file(&full, &mut entry, Some(size), mode)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// tar.xz / tar.gz
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Copy)]
enum TarCompression {
    Xz,
    Gz,
}

fn extract_tar(src: &Path, compression: TarCompression, ctx: &mut Ctx<'_>) -> Result<(), ArchiveError> {
    let file = File::open(src).map_err(|e| IoError::read(src, e))?;
    let packed = Arc::new(AtomicU64::new(0));
    ctx.packed = Some(packed.clone());
    let counting = CountingReader { inner: BufReader::with_capacity(1024 * 1024, file), count: packed };
    let reader: Box<dyn Read> = match compression {
        TarCompression::Xz => Box::new(liblzma::read::XzDecoder::new(counting)),
        TarCompression::Gz => Box::new(flate2::read::GzDecoder::new(counting)),
    };
    let mut archive = tar::Archive::new(reader);
    let entries = archive.entries().map_err(|e| ArchiveError::Invalid(e.to_string()))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| ArchiveError::Invalid(e.to_string()))?;
        let raw = String::from_utf8(entry.path_bytes().into_owned()).map_err(|_| ArchiveError::UnsafeEntry {
            entry: "(kein UTF-8)".into(),
            reason: UnsafeEntryReason::InvalidCharacters,
        })?;
        let kind = entry.header().entry_type();
        let mode = entry.header().mode().ok();
        let size = entry.header().size().ok();
        match kind {
            tar::EntryType::XGlobalHeader | tar::EntryType::XHeader => continue,
            tar::EntryType::Directory => {
                if let Some((_rel, full)) = ctx.begin_entry(&raw)? {
                    ctx.write_dir(&full)?;
                }
            }
            tar::EntryType::Regular | tar::EntryType::Continuous => {
                if let Some((_rel, full)) = ctx.begin_entry(&raw)? {
                    ctx.write_file(&full, &mut entry, size, mode)?;
                }
            }
            tar::EntryType::Symlink => {
                if let Some((rel, full)) = ctx.begin_entry(&raw)? {
                    let target = entry
                        .link_name_bytes()
                        .and_then(|b| String::from_utf8(b.into_owned()).ok())
                        .ok_or_else(|| ArchiveError::Invalid("Symlink ohne lesbares Ziel".into()))?;
                    ctx.write_symlink(&raw, &rel, &full, &target)?;
                }
            }
            tar::EntryType::Link => {
                return Err(ArchiveError::UnsafeEntry {
                    entry: display_entry(&raw),
                    reason: UnsafeEntryReason::Hardlink,
                });
            }
            tar::EntryType::Char | tar::EntryType::Block | tar::EntryType::Fifo => {
                return Err(ArchiveError::UnsafeEntry {
                    entry: display_entry(&raw),
                    reason: UnsafeEntryReason::DeviceFile,
                });
            }
            other => {
                return Err(ArchiveError::Invalid(format!(
                    "Eintragsart {other:?} wird nicht unterstützt ({})",
                    display_entry(&raw)
                )));
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// 7z und selbstentpackendes 7z
// ---------------------------------------------------------------------------------------------

/// 7z-Signatur: `37 7A BC AF 27 1C`.
const SEVENZ_SIGNATURE: [u8; 6] = [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C];

/// Lesezugriff, der erst ab `offset` beginnt (selbstentpackende Archive haben ein Programm davor).
struct OffsetReader<R> {
    inner: R,
    offset: u64,
}

impl<R: Read + Seek> OffsetReader<R> {
    fn new(mut inner: R, offset: u64) -> io::Result<Self> {
        inner.seek(SeekFrom::Start(offset))?;
        Ok(OffsetReader { inner, offset })
    }
}

impl<R: Read> Read for OffsetReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.inner.read(buf)
    }
}

impl<R: Seek> Seek for OffsetReader<R> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let new = match pos {
            SeekFrom::Start(p) => self.inner.seek(SeekFrom::Start(p + self.offset))?,
            SeekFrom::Current(d) => self.inner.seek(SeekFrom::Current(d))?,
            SeekFrom::End(d) => self.inner.seek(SeekFrom::End(d))?,
        };
        new.checked_sub(self.offset).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "vor dem Archivanfang"))
    }
}

/// Alle Stellen in den ersten 16 MiB der Datei, an denen eine 7z-Signatur steht.
fn find_7z_offsets(path: &Path) -> Result<Vec<u64>, ArchiveError> {
    let mut file = File::open(path).map_err(|e| IoError::read(path, e))?;
    let mut buf = vec![0u8; 16 * 1024 * 1024];
    let mut filled = 0;
    while filled < buf.len() {
        let n = file.read(&mut buf[filled..]).map_err(|e| IoError::read(path, e))?;
        if n == 0 {
            break;
        }
        filled += n;
    }
    Ok(buf[..filled]
        .windows(SEVENZ_SIGNATURE.len())
        .enumerate()
        .filter(|(_, w)| *w == SEVENZ_SIGNATURE)
        .map(|(i, _)| i as u64)
        .collect())
}

fn extract_7z(src: &Path, sfx: bool, ctx: &mut Ctx<'_>) -> Result<(), ArchiveError> {
    let offsets = if sfx { find_7z_offsets(src)? } else { vec![0] };
    if offsets.is_empty() {
        return Err(ArchiveError::Invalid("keine 7z-Daten gefunden".into()));
    }
    let mut last_error = ArchiveError::Invalid("7z nicht lesbar".into());
    for offset in offsets {
        let file = File::open(src).map_err(|e| IoError::read(src, e))?;
        let packed = Arc::new(AtomicU64::new(0));
        let counting = CountingReader { inner: file, count: packed.clone() };
        let reader = OffsetReader::new(counting, offset).map_err(|e| IoError::read(src, e))?;
        // Die Signatur kann im Programmteil zufällig vorkommen: nur Treffer, die sich als Archiv öffnen lassen, zählen.
        let mut archive = match sevenz_rust2::ArchiveReader::new(reader, sevenz_rust2::Password::empty()) {
            Ok(a) => a,
            Err(e) => {
                last_error = ArchiveError::Invalid(format!("7z: {e}"));
                continue;
            }
        };
        ctx.packed = Some(packed);
        ctx.entries_total = Some(archive.archive().files.len() as u64);
        return run_7z(&mut archive, ctx);
    }
    Err(last_error)
}

fn run_7z<R: Read + Seek>(archive: &mut sevenz_rust2::ArchiveReader<R>, ctx: &mut Ctx<'_>) -> Result<(), ArchiveError> {
    let mut failure: Option<ArchiveError> = None;
    let result = archive.for_each_entries(|entry, reader| {
        let step = (|| -> Result<(), ArchiveError> {
            let raw = entry.name().to_owned();
            let Some((_rel, full)) = ctx.begin_entry(&raw)? else { return Ok(()) };
            if entry.is_anti_item() {
                return Ok(());
            }
            if entry.is_directory() {
                return ctx.write_dir(&full);
            }
            // Windows-Attribute: Reparse-Punkt (0x400) = Link
            if entry.windows_attributes() & 0x400 != 0 {
                return Err(ArchiveError::UnsafeEntry {
                    entry: display_entry(&raw),
                    reason: UnsafeEntryReason::SymlinkEscape,
                });
            }
            // Unix-Modus steckt in den oberen 16 Bit, wenn Bit 15 (0x8000) gesetzt ist
            let attrs = entry.windows_attributes();
            let mode = (attrs & 0x8000 != 0).then_some(attrs >> 16);
            if mode.is_some_and(|m| m & 0o170000 == 0o120000) {
                return Err(ArchiveError::UnsafeEntry {
                    entry: display_entry(&raw),
                    reason: UnsafeEntryReason::SymlinkEscape,
                });
            }
            ctx.write_file(&full, reader, Some(entry.size()), mode)
        })();
        match step {
            Ok(()) => Ok(true),
            Err(e) => {
                failure = Some(e);
                Err(sevenz_rust2::Error::Other("abgebrochen".into()))
            }
        }
    });
    if let Some(e) = failure {
        return Err(e);
    }
    result.map_err(|e| ArchiveError::Invalid(format!("7z: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(raw: &str) -> Result<Option<String>, UnsafeEntryReason> {
        sanitize_entry(raw, 0, true).map_err(|e| match e {
            ArchiveError::UnsafeEntry { reason, .. } => reason,
            other => panic!("unerwartet: {other}"),
        })
    }

    #[test]
    fn sanitize_accepts_normal_entries() {
        assert_eq!(s("a/b/c.txt").unwrap().as_deref(), Some("a/b/c.txt"));
        assert_eq!(s("./a/b").unwrap().as_deref(), Some("a/b"));
        assert_eq!(s("dir/").unwrap().as_deref(), Some("dir"));
        assert_eq!(s("a\\b").unwrap().as_deref(), Some("a/b"));
        assert_eq!(s("Ärger/größe.txt").unwrap().as_deref(), Some("Ärger/größe.txt"));
    }

    #[test]
    fn sanitize_rejects_the_attacks_of_the_security_model() {
        assert_eq!(s("../evil").unwrap_err(), UnsafeEntryReason::ParentTraversal);
        assert_eq!(s("a/../../evil").unwrap_err(), UnsafeEntryReason::ParentTraversal);
        assert_eq!(s("a\\..\\evil").unwrap_err(), UnsafeEntryReason::ParentTraversal);
        assert_eq!(s("/etc/passwd").unwrap_err(), UnsafeEntryReason::AbsolutePath);
        assert_eq!(s("\\\\server\\share\\x").unwrap_err(), UnsafeEntryReason::AbsolutePath);
        assert_eq!(s("C:\\Windows\\x").unwrap_err(), UnsafeEntryReason::AbsolutePath);
        assert_eq!(s("c:evil").unwrap_err(), UnsafeEntryReason::AbsolutePath);
        assert_eq!(s("a/CON").unwrap_err(), UnsafeEntryReason::ReservedName);
        assert_eq!(s("a/nul.txt").unwrap_err(), UnsafeEntryReason::ReservedName);
        assert_eq!(s("a/b:ads").unwrap_err(), UnsafeEntryReason::InvalidCharacters);
        assert_eq!(s("a/\u{7}bell").unwrap_err(), UnsafeEntryReason::InvalidCharacters);
        assert_eq!(s("").unwrap_err(), UnsafeEntryReason::InvalidCharacters);
        assert_eq!(s("trailing.").unwrap_err(), UnsafeEntryReason::InvalidCharacters);
    }

    #[test]
    fn dot_dot_is_rejected_even_when_strip_would_remove_it() {
        assert!(sanitize_entry("../x/y", 1, true).is_err());
        assert!(sanitize_entry("top/../../x", 1, false).is_err());
    }

    #[test]
    fn strip_drops_leading_components_and_the_root_entry() {
        assert_eq!(sanitize_entry("top/bin/tool", 1, true).unwrap().as_deref(), Some("bin/tool"));
        assert_eq!(sanitize_entry("top/", 1, true).unwrap(), None);
        assert_eq!(sanitize_entry("top", 1, true).unwrap(), None);
        assert_eq!(sanitize_entry("a/b/c", 3, true).unwrap(), None);
    }

    #[test]
    fn relaxed_names_allow_what_unix_allows() {
        // auf Linux ist `aux.h` ein gewöhnlicher Dateiname
        assert_eq!(sanitize_entry("src/aux.h", 0, false).unwrap().as_deref(), Some("src/aux.h"));
        assert!(sanitize_entry("src/aux.h", 0, true).is_err());
        assert!(sanitize_entry("../x", 0, false).is_err());
    }
}
