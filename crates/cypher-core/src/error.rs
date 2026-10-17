//! Fehlertypen des Kerns: ein Enum je Modul (thiserror), alle nach [`CoreError`] und weiter nach
//! [`AppError`](crate::api::AppError) umwandelbar. Pfade werden dabei zu `DisplayPath` (`~` für das Home-Verzeichnis).

use std::path::{Path, PathBuf};

use crate::api::{AppError, BusyReason, EntityKind, IoOp, SetupUnsupportedReason, SignatureSubject, UnsafeEntryReason};
use crate::platform::display_path;

pub type CoreResult<T> = Result<T, CoreError>;

/// Fehler eines Dateisystemzugriffs mit Operation und Pfad.
#[derive(Debug, thiserror::Error)]
#[error("{op:?} {}: {source}", .path.as_deref().map(|p| p.display().to_string()).unwrap_or_default())]
pub struct IoError {
    pub op: IoOp,
    pub path: Option<PathBuf>,
    #[source]
    pub source: std::io::Error,
}

impl IoError {
    pub fn new(op: IoOp, path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        IoError { op, path: Some(path.into()), source }
    }

    pub fn without_path(op: IoOp, source: std::io::Error) -> Self {
        IoError { op, path: None, source }
    }

    pub fn read(path: &Path, source: std::io::Error) -> Self {
        Self::new(IoOp::Read, path, source)
    }

    pub fn write(path: &Path, source: std::io::Error) -> Self {
        Self::new(IoOp::Write, path, source)
    }

    /// Ein Fehler, der keine echte E/A-Ursache hat (z. B. „Quelle fehlt“), aber als E/A gemeldet wird.
    pub fn other(op: IoOp, path: Option<&Path>, message: impl Into<String>) -> Self {
        IoError { op, path: path.map(Path::to_path_buf), source: std::io::Error::other(message.into()) }
    }
}

/// Eine Pfadangabe, die nicht sicher ist (ARCHITEKTUR.md 6.6).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PathError {
    #[error("leerer Pfad")]
    Empty,
    #[error("absoluter Pfad")]
    Absolute,
    #[error("Laufwerks- oder UNC-Präfix")]
    DriveOrUnc,
    #[error("`..` im Pfad")]
    ParentTraversal,
    #[error("`.` oder leere Komponente im Pfad")]
    CurrentDirOrEmpty,
    #[error("unzulässige Zeichen")]
    InvalidChars,
    #[error("reservierter Name")]
    ReservedName,
    #[error("Komponente endet mit Punkt oder Leerzeichen")]
    TrailingDotOrSpace,
    #[error("Komponente zu lang")]
    TooLong,
    #[error("Pfad verlässt den erlaubten Ordner")]
    Escapes,
    #[error("Verknüpfung (Symlink oder Junction) im Pfad: Cypher Studio schreibt nicht durch Verknüpfungen")]
    LinkInPath,
}

impl PathError {
    /// Zuordnung zu den Gründen des Vertrags (`archiveUnsafeEntry`).
    pub fn unsafe_reason(&self) -> UnsafeEntryReason {
        match self {
            PathError::Absolute | PathError::DriveOrUnc => UnsafeEntryReason::AbsolutePath,
            PathError::ParentTraversal | PathError::Escapes | PathError::LinkInPath => {
                UnsafeEntryReason::ParentTraversal
            }
            PathError::ReservedName => UnsafeEntryReason::ReservedName,
            PathError::Empty
            | PathError::CurrentDirOrEmpty
            | PathError::InvalidChars
            | PathError::TrailingDotOrSpace
            | PathError::TooLong => UnsafeEntryReason::InvalidCharacters,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum VerifyError {
    #[error("Prüfsumme von {file} stimmt nicht (erwartet {expected}, erhalten {actual})")]
    ChecksumMismatch { file: String, expected: String, actual: String },
    #[error("Signatur ungültig: {0}")]
    Signature(String),
    #[error("Schlüssel nicht erlaubt: {0}")]
    KeyNotAllowed(String),
    #[error("Schlüssel abgelaufen: {0}")]
    KeyExpired(String),
    #[error(transparent)]
    Io(#[from] IoError),
    #[error("abgebrochen")]
    Cancelled,
}

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("Host nicht erlaubt: {0}")]
    HostNotAllowed(String),
    #[error("unsichere Adresse: {0}")]
    InsecureUrl(String),
    #[error("HTTP-Status {status} von {host}")]
    Http { host: String, status: u16 },
    #[error("Netzwerkfehler bei {host}: {message}")]
    Network { host: String, message: String, retryable: bool },
    #[error("Größe von {file} stimmt nicht (erwartet {expected}, erhalten {actual})")]
    SizeMismatch { file: String, expected: u64, actual: u64 },
    #[error("Antwort größer als erlaubt ({limit} Bytes)")]
    TooLarge { limit: u64 },
    #[error(transparent)]
    Checksum(#[from] VerifyError),
    #[error(transparent)]
    Io(#[from] IoError),
    #[error("abgebrochen")]
    Cancelled,
}

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("Katalog nicht lesbar: {0}")]
    Parse(String),
    #[error("Katalog verletzt das Schema bei {path}: {reason}")]
    Schema { path: String, reason: String },
    #[error("Katalogsignatur ungültig: {0}")]
    Signature(String),
    #[error("unbekannter Schlüssel: {0}")]
    UnknownKey(String),
    #[error("Katalog zurückgesetzt (aktuell {current}, angeboten {offered})")]
    Rollback { current: u64, offered: u64 },
    #[error("Katalog braucht eine neuere App (Schema {schema}, mindestens {min_app})")]
    Incompatible { schema: u32, min_app: String },
    #[error("Host nicht erlaubt: {0}")]
    HostNotAllowed(String),
    #[error("kein Paket für {program} auf {os}/{arch}")]
    NoArtifact { program: String, os: crate::api::Os, arch: crate::api::Arch },
    #[error("nicht im Katalog: {0}")]
    NotFound(String),
    #[error(transparent)]
    Io(#[from] IoError),
    #[error(transparent)]
    Download(#[from] DownloadError),
}

#[derive(Debug, thiserror::Error)]
pub enum ArchiveError {
    #[error("Archiv ungültig: {0}")]
    Invalid(String),
    #[error("unsicherer Eintrag `{entry}`: {reason:?}")]
    UnsafeEntry { entry: String, reason: UnsafeEntryReason },
    #[error("Archiv zu groß (Grenze {limit} Bytes)")]
    TooLarge { limit: u64 },
    #[error("Archivart nicht unterstützt: {0}")]
    Unsupported(String),
    #[error(transparent)]
    Io(#[from] IoError),
    #[error("abgebrochen")]
    Cancelled,
}

#[derive(Debug, thiserror::Error)]
pub enum InstallError {
    #[error(transparent)]
    Catalog(#[from] CatalogError),
    #[error(transparent)]
    Download(#[from] DownloadError),
    #[error(transparent)]
    Verify(#[from] VerifyError),
    #[error(transparent)]
    Archive(#[from] ArchiveError),
    #[error(transparent)]
    Io(#[from] IoError),
    #[error("Installation `{0}` unbekannt")]
    NotFound(String),
    #[error("Plan `{0}` abgelaufen oder unbekannt")]
    PlanExpired(String),
    #[error("Zustimmung passt nicht zum Plan `{0}`")]
    ConsentMismatch(String),
    #[error("Inhalt unerwartet: {0}")]
    VerificationFailed(String),
    #[error("nicht genug Platz in {path}: {needed} Bytes nötig, {available} frei")]
    DiskFull { path: PathBuf, needed: u64, available: u64 },
    #[error("ungültige Eingabe `{field}`: {reason}")]
    InvalidInput { field: String, reason: String },
    #[error("Programm läuft noch")]
    ProgramRunning,
    #[error("Hilfsprogramm fehlgeschlagen: {0}")]
    Process(String),
    #[error("abgebrochen")]
    Cancelled,
}

#[derive(Debug, thiserror::Error)]
pub enum DetectError {
    #[error(transparent)]
    Io(#[from] IoError),
    #[error("keine {program}-Installation erkannt in {path}")]
    NotRecognized { program: String, path: PathBuf },
    #[error("unbekanntes Programm `{0}`")]
    UnknownProgram(String),
}

#[derive(Debug, thiserror::Error)]
pub enum LaunchError {
    #[error("Programm `{0}` unbekannt")]
    UnknownProgram(String),
    #[error("Installation nicht startbar: {0}")]
    NotLaunchable(String),
    #[error("Start von {program} fehlgeschlagen: {reason}")]
    Spawn { program: String, reason: String },
}

#[derive(Debug, thiserror::Error)]
pub enum PrintError {
    #[error("Bild nicht lesbar: {0}")]
    Decode(String),
    #[error("Bild zu groß: {width} x {height} (höchstens {max_pixels} Pixel)")]
    TooLarge { width: u32, height: u32, max_pixels: u64 },
    #[error("Format `{format}` nicht unterstützt")]
    UnsupportedFormat { format: String },
    #[error("Profil unbekannt: {0}")]
    UnknownProfile(String),
    #[error("Kodierung fehlgeschlagen: {0}")]
    Encode(String),
    #[error("ungültige Eingabe `{field}`: {reason}")]
    InvalidInput { field: String, reason: String },
    #[error(transparent)]
    Io(#[from] IoError),
    #[error("abgebrochen")]
    Cancelled,
}

#[derive(Debug, thiserror::Error)]
pub enum SetupError {
    #[error("Paket ungültig: {0}")]
    InvalidPack(String),
    #[error("Paket `{0}` unbekannt")]
    NotFound(String),
    #[error("Einrichtung nicht möglich ({pack}): {reason:?}")]
    Unsupported { pack: String, reason: SetupUnsupportedReason },
    #[error("Plan `{0}` abgelaufen oder unbekannt")]
    PlanExpired(String),
    #[error("Konflikt bei {0:?}")]
    Conflict(Vec<PathBuf>),
    #[error("ungültige Eingabe `{field}`: {reason}")]
    InvalidInput { field: String, reason: String },
    #[error("Hilfsprogramm fehlgeschlagen: {0}")]
    Process(String),
    #[error(transparent)]
    Path(#[from] PathError),
    #[error(transparent)]
    Io(#[from] IoError),
    #[error("abgebrochen")]
    Cancelled,
}

#[derive(Debug, thiserror::Error)]
pub enum LibraryError {
    #[error("Bibliothek nicht eingerichtet")]
    NotConfigured,
    #[error("Wurzelordner ungültig: {0:?}")]
    RootInvalid(crate::api::LibraryRootInvalidReason),
    #[error("Eintrag `{0}` unbekannt")]
    NotFound(String),
    #[error("Austauschpaket ungültig: {0}")]
    PackInvalid(String),
    #[error("ungültige Eingabe `{field}`: {reason}")]
    InvalidInput { field: String, reason: String },
    #[error(transparent)]
    Archive(#[from] ArchiveError),
    #[error(transparent)]
    Path(#[from] PathError),
    #[error(transparent)]
    Io(#[from] IoError),
    #[error("abgebrochen")]
    Cancelled,
}

#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    #[error("Projekt `{0}` unbekannt")]
    NotFound(String),
    #[error("Vorlage `{0}` unbekannt")]
    TemplateNotFound(String),
    #[error("ungültige Eingabe `{field}`: {reason}")]
    InvalidInput { field: String, reason: String },
    #[error(transparent)]
    Path(#[from] PathError),
    #[error(transparent)]
    Io(#[from] IoError),
}

/// Beschreibung einer Belegung (für `Busy`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BusyInfo {
    pub reason: BusyReason,
    pub job_id: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error(transparent)]
    Catalog(#[from] CatalogError),
    #[error(transparent)]
    Download(#[from] DownloadError),
    #[error(transparent)]
    Verify(#[from] VerifyError),
    #[error(transparent)]
    Install(#[from] InstallError),
    #[error(transparent)]
    Archive(#[from] ArchiveError),
    #[error(transparent)]
    Detect(#[from] DetectError),
    #[error(transparent)]
    Launch(#[from] LaunchError),
    #[error(transparent)]
    Setup(#[from] SetupError),
    #[error(transparent)]
    Library(#[from] LibraryError),
    #[error(transparent)]
    Print(#[from] PrintError),
    #[error(transparent)]
    Project(#[from] ProjectError),
    #[error(transparent)]
    Path(#[from] PathError),
    #[error(transparent)]
    Io(#[from] IoError),
    #[error("ungültige Eingabe `{field}`: {reason}")]
    InvalidInput { field: String, reason: String },
    #[error("{entity:?} `{id}` unbekannt")]
    NotFound { entity: EntityKind, id: String },
    #[error("abgebrochen")]
    Cancelled,
    #[error("beschäftigt: {0:?}")]
    Busy(BusyInfo),
    #[error("Plan `{0}` abgelaufen oder unbekannt")]
    PlanExpired(String),
    #[error("{0}")]
    Internal(String),
}

/// Ergebnis von `fsx::ensure_within` und den Schreibhelfern (Pfad- oder E/A-Fehler) in die Modulfehler übernehmen.
impl From<crate::platform::fsx::EnsureWithinError> for LibraryError {
    fn from(e: crate::platform::fsx::EnsureWithinError) -> Self {
        match e {
            crate::platform::fsx::EnsureWithinError::Path(p) => LibraryError::Path(p),
            crate::platform::fsx::EnsureWithinError::Io(io) => LibraryError::Io(io),
        }
    }
}

impl From<crate::platform::fsx::EnsureWithinError> for ProjectError {
    fn from(e: crate::platform::fsx::EnsureWithinError) -> Self {
        match e {
            crate::platform::fsx::EnsureWithinError::Path(p) => ProjectError::Path(p),
            crate::platform::fsx::EnsureWithinError::Io(io) => ProjectError::Io(io),
        }
    }
}

impl From<crate::platform::fsx::EnsureWithinError> for CoreError {
    fn from(e: crate::platform::fsx::EnsureWithinError) -> Self {
        match e {
            crate::platform::fsx::EnsureWithinError::Path(p) => CoreError::Path(p),
            crate::platform::fsx::EnsureWithinError::Io(io) => CoreError::Io(io),
        }
    }
}

impl CoreError {
    pub fn invalid_input(field: impl Into<String>, reason: impl Into<String>) -> Self {
        CoreError::InvalidInput { field: field.into(), reason: reason.into() }
    }

    pub fn not_found(entity: EntityKind, id: impl Into<String>) -> Self {
        CoreError::NotFound { entity, id: id.into() }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        CoreError::Internal(message.into())
    }
}

// ---------------------------------------------------------------------------------------------
// Umwandlung in den Fehler des Vertrags
// ---------------------------------------------------------------------------------------------

fn io_to_app(e: &IoError) -> AppError {
    let path = e.path.as_deref().map(display_path);
    match e.source.kind() {
        std::io::ErrorKind::PermissionDenied => {
            AppError::PermissionDenied { path: path.unwrap_or_else(|| "(unbekannt)".to_owned()) }
        }
        std::io::ErrorKind::StorageFull => AppError::DiskFull {
            path: path.unwrap_or_else(|| "(unbekannt)".to_owned()),
            needed_bytes: 0,
            available_bytes: 0,
        },
        _ => AppError::Io { op: e.op, path, message: e.source.to_string() },
    }
}

fn verify_to_app(e: &VerifyError, subject: SignatureSubject) -> AppError {
    match e {
        VerifyError::ChecksumMismatch { file, expected, actual } => {
            AppError::ChecksumMismatch { file: file.clone(), expected: expected.clone(), actual: actual.clone() }
        }
        VerifyError::Signature(reason) => AppError::SignatureInvalid { subject, reason: reason.clone() },
        VerifyError::KeyNotAllowed(reason) => {
            AppError::SignatureInvalid { subject, reason: format!("Schlüssel nicht erlaubt: {reason}") }
        }
        VerifyError::KeyExpired(reason) => {
            AppError::SignatureInvalid { subject, reason: format!("Schlüssel abgelaufen: {reason}") }
        }
        VerifyError::Io(io) => io_to_app(io),
        VerifyError::Cancelled => AppError::Cancelled,
    }
}

fn download_to_app(e: &DownloadError) -> AppError {
    match e {
        DownloadError::HostNotAllowed(host) => AppError::HostNotAllowed { host: host.clone() },
        DownloadError::InsecureUrl(url) => AppError::InsecureUrl { url: url.clone() },
        DownloadError::Http { host, status } => AppError::HttpStatus { host: host.clone(), status: *status },
        DownloadError::Network { host, message, retryable } => {
            AppError::Network { host: host.clone(), message: message.clone(), retryable: *retryable }
        }
        DownloadError::SizeMismatch { file, expected, actual } => {
            AppError::SizeMismatch { file: file.clone(), expected: *expected, actual: *actual }
        }
        DownloadError::TooLarge { limit } => AppError::ArchiveTooLarge { limit_bytes: *limit },
        DownloadError::Checksum(v) => verify_to_app(v, SignatureSubject::Artifact),
        DownloadError::Io(io) => io_to_app(io),
        DownloadError::Cancelled => AppError::Cancelled,
    }
}

pub(crate) fn catalog_to_app(e: &CatalogError) -> AppError {
    match e {
        CatalogError::Parse(reason) => AppError::invalid_input("catalog", reason.clone()),
        CatalogError::Schema { path, reason } => AppError::invalid_input("catalog", format!("{path}: {reason}")),
        CatalogError::Signature(reason) => {
            AppError::SignatureInvalid { subject: SignatureSubject::Catalog, reason: reason.clone() }
        }
        CatalogError::UnknownKey(key) => AppError::SignatureInvalid {
            subject: SignatureSubject::Catalog,
            reason: format!("unbekannter Schlüssel {key}"),
        },
        CatalogError::Rollback { current, offered } => {
            AppError::CatalogRollback { current_sequence: *current, offered_sequence: *offered }
        }
        CatalogError::Incompatible { schema, min_app } => {
            AppError::CatalogIncompatible { schema_version: *schema, min_app_version: min_app.clone() }
        }
        CatalogError::HostNotAllowed(host) => AppError::HostNotAllowed { host: host.clone() },
        CatalogError::NoArtifact { program, os, arch } => {
            AppError::UnsupportedPlatform { program_id: program.clone(), os: *os, arch: *arch }
        }
        CatalogError::NotFound(id) => AppError::not_found(EntityKind::Program, id.clone()),
        CatalogError::Io(io) => io_to_app(io),
        CatalogError::Download(d) => download_to_app(d),
    }
}

fn archive_to_app(e: &ArchiveError) -> AppError {
    match e {
        ArchiveError::Invalid(reason) | ArchiveError::Unsupported(reason) => {
            AppError::ArchiveInvalid { reason: reason.clone() }
        }
        ArchiveError::UnsafeEntry { entry, reason } => {
            AppError::ArchiveUnsafeEntry { entry: entry.clone(), reason: *reason }
        }
        ArchiveError::TooLarge { limit } => AppError::ArchiveTooLarge { limit_bytes: *limit },
        ArchiveError::Io(io) => io_to_app(io),
        ArchiveError::Cancelled => AppError::Cancelled,
    }
}

fn install_to_app(e: &InstallError) -> AppError {
    match e {
        InstallError::Catalog(c) => catalog_to_app(c),
        InstallError::Download(d) => download_to_app(d),
        InstallError::Verify(v) => verify_to_app(v, SignatureSubject::Artifact),
        InstallError::Archive(a) => archive_to_app(a),
        InstallError::Io(io) => io_to_app(io),
        InstallError::NotFound(id) => AppError::not_found(EntityKind::Installation, id.clone()),
        InstallError::PlanExpired(id) => AppError::PlanExpired { plan_id: id.clone() },
        InstallError::ConsentMismatch(id) => AppError::ConsentMismatch { plan_id: id.clone() },
        InstallError::VerificationFailed(reason) => AppError::InstallVerificationFailed { reason: reason.clone() },
        InstallError::DiskFull { path, needed, available } => {
            AppError::DiskFull { path: display_path(path), needed_bytes: *needed, available_bytes: *available }
        }
        InstallError::InvalidInput { field, reason } => AppError::invalid_input(field.clone(), reason.clone()),
        InstallError::ProgramRunning => AppError::Busy { reason: BusyReason::ProgramRunning, job_id: None },
        InstallError::Process(reason) => AppError::InstallVerificationFailed { reason: reason.clone() },
        InstallError::Cancelled => AppError::Cancelled,
    }
}

impl From<&CoreError> for AppError {
    fn from(e: &CoreError) -> Self {
        match e {
            CoreError::Catalog(c) => catalog_to_app(c),
            CoreError::Download(d) => download_to_app(d),
            CoreError::Verify(v) => verify_to_app(v, SignatureSubject::Artifact),
            CoreError::Install(i) => install_to_app(i),
            CoreError::Archive(a) => archive_to_app(a),
            CoreError::Detect(DetectError::Io(io)) => io_to_app(io),
            CoreError::Detect(other) => AppError::invalid_input("detect", other.to_string()),
            CoreError::Launch(LaunchError::UnknownProgram(id)) => AppError::not_found(EntityKind::Program, id.clone()),
            CoreError::Launch(LaunchError::NotLaunchable(reason)) => {
                AppError::LaunchFailed { program_id: String::new(), reason: reason.clone() }
            }
            CoreError::Launch(LaunchError::Spawn { program, reason }) => {
                AppError::LaunchFailed { program_id: program.clone(), reason: reason.clone() }
            }
            CoreError::Setup(s) => match s {
                SetupError::InvalidPack(reason) => AppError::PackInvalid { reason: reason.clone() },
                SetupError::NotFound(id) => AppError::not_found(EntityKind::SetupScope, id.clone()),
                SetupError::Unsupported { pack, reason } => {
                    AppError::SetupUnsupported { pack_id: pack.clone(), reason: *reason }
                }
                SetupError::PlanExpired(id) => AppError::PlanExpired { plan_id: id.clone() },
                SetupError::Conflict(files) => {
                    AppError::SetupConflict { files: files.iter().map(|p| display_path(p)).collect() }
                }
                SetupError::InvalidInput { field, reason } => AppError::invalid_input(field.clone(), reason.clone()),
                SetupError::Process(reason) => AppError::InstallVerificationFailed { reason: reason.clone() },
                SetupError::Path(p) => AppError::invalid_input("path", p.to_string()),
                SetupError::Io(io) => io_to_app(io),
                SetupError::Cancelled => AppError::Cancelled,
            },
            CoreError::Library(l) => match l {
                LibraryError::NotConfigured => AppError::LibraryNotConfigured,
                LibraryError::RootInvalid(reason) => AppError::LibraryRootInvalid { reason: *reason },
                LibraryError::NotFound(id) => AppError::not_found(EntityKind::LibraryEntry, id.clone()),
                LibraryError::PackInvalid(reason) => AppError::PackInvalid { reason: reason.clone() },
                LibraryError::InvalidInput { field, reason } => AppError::invalid_input(field.clone(), reason.clone()),
                LibraryError::Archive(a) => archive_to_app(a),
                LibraryError::Path(p) => AppError::invalid_input("path", p.to_string()),
                LibraryError::Io(io) => io_to_app(io),
                LibraryError::Cancelled => AppError::Cancelled,
            },
            CoreError::Print(p) => match p {
                PrintError::Decode(reason) => AppError::ImageDecode { reason: reason.clone() },
                PrintError::TooLarge { width, height, max_pixels } => {
                    AppError::ImageTooLarge { width_px: *width, height_px: *height, max_pixels: *max_pixels }
                }
                PrintError::UnsupportedFormat { format } => AppError::UnsupportedFormat {
                    format: format.clone(),
                    supported: ["png", "jpeg", "tiff", "webp"].map(str::to_owned).to_vec(),
                },
                PrintError::UnknownProfile(id) => AppError::not_found(EntityKind::PrintProfile, id.clone()),
                PrintError::Encode(reason) => AppError::internal(format!("Kodierung fehlgeschlagen: {reason}")),
                PrintError::InvalidInput { field, reason } => AppError::invalid_input(field.clone(), reason.clone()),
                PrintError::Io(io) => io_to_app(io),
                PrintError::Cancelled => AppError::Cancelled,
            },
            CoreError::Project(p) => match p {
                ProjectError::NotFound(id) => AppError::not_found(EntityKind::Project, id.clone()),
                ProjectError::TemplateNotFound(id) => AppError::not_found(EntityKind::Template, id.clone()),
                ProjectError::InvalidInput { field, reason } => AppError::invalid_input(field.clone(), reason.clone()),
                ProjectError::Path(p) => AppError::invalid_input("path", p.to_string()),
                ProjectError::Io(io) => io_to_app(io),
            },
            CoreError::Path(p) => AppError::invalid_input("path", p.to_string()),
            CoreError::Io(io) => io_to_app(io),
            CoreError::InvalidInput { field, reason } => AppError::invalid_input(field.clone(), reason.clone()),
            CoreError::NotFound { entity, id } => AppError::not_found(*entity, id.clone()),
            CoreError::Cancelled => AppError::Cancelled,
            CoreError::Busy(info) => AppError::Busy { reason: info.reason, job_id: info.job_id.clone() },
            CoreError::PlanExpired(id) => AppError::PlanExpired { plan_id: id.clone() },
            CoreError::Internal(message) => {
                let correlation_id = crate::api::new_correlation_id();
                tracing::error!(%correlation_id, "interner Fehler: {message}");
                AppError::Internal { message: message.clone(), correlation_id }
            }
        }
    }
}

impl From<CoreError> for AppError {
    fn from(e: CoreError) -> Self {
        AppError::from(&e)
    }
}

macro_rules! app_from {
    ($($ty:ty),* $(,)?) => {$(
        impl From<$ty> for AppError {
            fn from(e: $ty) -> Self {
                AppError::from(CoreError::from(e))
            }
        }
    )*};
}

app_from!(
    CatalogError,
    DownloadError,
    VerifyError,
    InstallError,
    ArchiveError,
    DetectError,
    LaunchError,
    SetupError,
    LibraryError,
    PrintError,
    ProjectError,
    PathError,
    IoError,
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn io_errors_map_by_kind() {
        let denied = IoError::write(Path::new("/etc/x"), std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        assert!(matches!(AppError::from(denied), AppError::PermissionDenied { .. }));
        let other = IoError::read(Path::new("/x"), std::io::Error::other("kaputt"));
        match AppError::from(other) {
            AppError::Io { op, message, .. } => {
                assert_eq!(op, IoOp::Read);
                assert!(message.contains("kaputt"));
            }
            e => panic!("unerwartet: {e}"),
        }
    }

    #[test]
    fn security_relevant_errors_keep_their_kind() {
        let mismatch = DownloadError::Checksum(VerifyError::ChecksumMismatch {
            file: "a.zip".into(),
            expected: "00".into(),
            actual: "ff".into(),
        });
        assert_eq!(AppError::from(mismatch).kind_name(), "checksumMismatch");
        assert_eq!(
            AppError::from(ArchiveError::UnsafeEntry {
                entry: "../x".into(),
                reason: UnsafeEntryReason::ParentTraversal
            })
            .kind_name(),
            "archiveUnsafeEntry"
        );
        assert_eq!(AppError::from(DownloadError::HostNotAllowed("evil.example".into())).kind_name(), "hostNotAllowed");
        assert_eq!(AppError::from(CatalogError::Rollback { current: 7, offered: 5 }).kind_name(), "catalogRollback");
        assert_eq!(AppError::from(CoreError::Cancelled).kind_name(), "cancelled");
    }

    #[test]
    fn internal_errors_get_a_correlation_id() {
        match AppError::from(CoreError::internal("boom")) {
            AppError::Internal { message, correlation_id } => {
                assert_eq!(message, "boom");
                assert!(!correlation_id.is_empty());
            }
            e => panic!("unerwartet: {e}"),
        }
    }
}
