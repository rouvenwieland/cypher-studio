//! Fehlertyp des IPC-Vertrags (Abschnitt 1 von docs/ipc-contract.ts), getaggt über `kind`.

use super::common::{Arch, DisplayPath, JobId, Os, PackId, PlanId, ProgramId, SemVer, Sha256Hex};

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum EntityKind {
        Program,
        Installation,
        Plan,
        Job,
        FileHandle,
        LibraryEntry,
        Project,
        Template,
        PrintProfile,
        SetupScope,
        SetupRecord,
        MockupTemplate,
        SocialTemplate,
        GarmentColor,
        Artifact,
        CatalogLink,
        SetupPack,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum BusyReason {
        JobRunning,
        SetupRunning,
        UpdateRunning,
        ProgramRunning,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum IoOp {
        Read,
        Write,
        Rename,
        Remove,
        CreateDir,
        Copy,
        Metadata,
        Spawn,
        Mount,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum SignatureSubject {
        Catalog,
        Artifact,
        AppUpdate,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum UnsafeEntryReason {
        AbsolutePath,
        ParentTraversal,
        SymlinkEscape,
        Hardlink,
        DeviceFile,
        ReservedName,
        InvalidCharacters,
        DuplicateEntry,
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum SetupUnsupportedReason {
        NoPack,
        ProgramVersion,
        InstallKind,
        Platform,
    }
}

inline_enum! {
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub enum LibraryRootInvalidReason {
        NotADirectory,
        NotWritable,
        InsideAppData,
        SystemDirectory,
    }
}

dto_enum! {
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum AppError {
        NotFound { entity: EntityKind, id: String },
        InvalidInput { field: String, reason: String },
        PlanExpired { plan_id: PlanId },
        ConsentMismatch { plan_id: PlanId },
        Busy { reason: BusyReason, job_id: Option<JobId> },
        Cancelled,
        Io { op: IoOp, path: Option<DisplayPath>, message: String },
        PermissionDenied { path: DisplayPath },
        DiskFull { path: DisplayPath, needed_bytes: u64, available_bytes: u64 },
        Network { host: String, message: String, retryable: bool },
        HttpStatus { host: String, status: u16 },
        HostNotAllowed { host: String },
        InsecureUrl { url: String },
        ChecksumMismatch { file: String, expected: Sha256Hex, actual: Sha256Hex },
        SizeMismatch { file: String, expected: u64, actual: u64 },
        SignatureInvalid { subject: SignatureSubject, reason: String },
        CatalogRollback { current_sequence: u64, offered_sequence: u64 },
        CatalogIncompatible { schema_version: u32, min_app_version: SemVer },
        UnsupportedPlatform { program_id: ProgramId, os: Os, arch: Arch },
        ArchiveInvalid { reason: String },
        ArchiveUnsafeEntry { entry: String, reason: UnsafeEntryReason },
        ArchiveTooLarge { limit_bytes: u64 },
        InstallVerificationFailed { reason: String },
        LaunchFailed { program_id: ProgramId, reason: String },
        SetupConflict { files: Vec<DisplayPath> },
        SetupUnsupported { pack_id: PackId, reason: SetupUnsupportedReason },
        ImageDecode { reason: String },
        ImageTooLarge { width_px: u32, height_px: u32, max_pixels: u64 },
        UnsupportedFormat { format: String, supported: Vec<String> },
        LibraryNotConfigured,
        LibraryRootInvalid {
            #[ts(inline)]
            reason: LibraryRootInvalidReason,
        },
        PackInvalid { reason: String },
        UpdateFailed { reason: String },
        Internal { message: String, correlation_id: String },
    }
}

impl AppError {
    /// Interner Fehler mit frischer Korrelations-ID (die ID steht auch im Log).
    pub fn internal(message: impl Into<String>) -> Self {
        AppError::Internal { message: message.into(), correlation_id: new_correlation_id() }
    }

    pub fn invalid_input(field: impl Into<String>, reason: impl Into<String>) -> Self {
        AppError::InvalidInput { field: field.into(), reason: reason.into() }
    }

    pub fn not_found(entity: EntityKind, id: impl Into<String>) -> Self {
        AppError::NotFound { entity, id: id.into() }
    }

    /// Der Name der Fehlerart, so wie er im Vertrag (`kind`) steht.
    pub fn kind_name(&self) -> String {
        serde_json::to_value(self)
            .ok()
            .and_then(|v| v.get("kind").and_then(|k| k.as_str().map(str::to_owned)))
            .unwrap_or_else(|| "internal".to_owned())
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match serde_json::to_string(self) {
            Ok(s) => f.write_str(&s),
            Err(_) => f.write_str("AppError"),
        }
    }
}

impl std::error::Error for AppError {}

/// Kurze, zufällige Korrelations-ID für Log und Fehlermeldung.
pub fn new_correlation_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
