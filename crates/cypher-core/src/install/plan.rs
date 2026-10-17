//! Installationsplan: was, woher, wie groß, Lizenz, wohin (ARCHITEKTUR.md 2.7, 5.1). Keine Netzwerkzugriffe.

use std::path::PathBuf;

use url::Url;

use crate::api::{
    ArtifactKind, ChecksumOrigin as DtoOrigin, FuseFallback, InstallNote, InstallPlan, Installation, LicenseInfo,
    PlanArtifact, PlanSource, PlanTarget, ReleaseChannel, Settings, SignatureInfo, SignatureType,
};
use crate::catalog::{ArtifactSpec, Catalog, ChecksumOrigin, ProgVer, SignatureKind};
use crate::download::{HostPolicy, RedirectPolicy, resumable_bytes};
use crate::error::InstallError;
use crate::platform::{AppDirs, PlatformInfo, display_path, fsx};
use crate::util::{iso_after, new_id, now_iso};

/// Ab dieser Größe zeigt die Vorschau den Hinweis „großer Download“.
pub const LARGE_DOWNLOAD_BYTES: u64 = 100 * 1024 * 1024;

/// Alles, was `plan` braucht.
pub struct PlanInput<'a> {
    pub catalog: &'a Catalog,
    pub catalog_sequence: u64,
    pub catalog_expired: bool,
    pub platform: &'a PlatformInfo,
    pub dirs: &'a AppDirs,
    pub settings: &'a Settings,
    pub hosts: &'a HostPolicy,
    /// Bereits bekannte Installationen (verwaltete und erkannte).
    pub known: &'a [Installation],
    pub fuse_available: bool,
}

/// Plan samt interner Felder (Artefakt, Zielordner) für `execute`.
#[derive(Debug, Clone)]
pub struct InstallPlanData {
    pub dto: InstallPlan,
    pub program_id: String,
    pub version: String,
    pub installation_id: String,
    pub artifact: ArtifactSpec,
    pub catalog_sequence: u64,
    pub target_dir: PathBuf,
    pub programs_dir: PathBuf,
    pub app_image_mode: crate::api::AppImageMode,
}

/// Dateiendung des zwischengespeicherten Downloads.
pub fn cache_extension(kind: ArtifactKind) -> &'static str {
    match kind {
        ArtifactKind::Zip => "zip",
        ArtifactKind::SevenZ => "7z",
        ArtifactKind::TarXz => "tar.xz",
        ArtifactKind::TarGz => "tar.gz",
        ArtifactKind::Dmg => "dmg",
        ArtifactKind::AppImage => "AppImage",
        ArtifactKind::Sfx7z | ArtifactKind::ExeInstaller => "exe",
    }
}

/// Zielordner einer Installation: `<programs>/<id>/<version>`; macOS: `<programs>/<Name>.app`.
pub fn target_dir_for(
    programs_dir: &std::path::Path,
    program_id: &str,
    version: &str,
    artifact: &ArtifactSpec,
) -> PathBuf {
    match (artifact.kind, artifact.mac_app_name.as_deref()) {
        (ArtifactKind::Dmg, Some(app)) => programs_dir.join(app),
        _ => programs_dir.join(program_id).join(version),
    }
}

pub fn plan(
    input: &PlanInput<'_>,
    program_id: &str,
    version: Option<&str>,
    channel: Option<ReleaseChannel>,
) -> Result<InstallPlanData, InstallError> {
    let program = input.catalog.program(program_id).ok_or_else(|| InstallError::NotFound(program_id.to_owned()))?;
    let selection = input.catalog.release_for(program_id, version, channel, input.platform)?;
    let (release, artifact) = (selection.release, selection.artifact);

    let url = Url::parse(&artifact.url)
        .map_err(|e| InstallError::InvalidInput { field: "url".into(), reason: e.to_string() })?;
    let rule = *input.hosts.check(&url).map_err(InstallError::Download)?;

    let programs_dir = PathBuf::from(&input.settings.programs_dir);
    let target_dir = target_dir_for(&programs_dir, program_id, &release.version, artifact);
    let installation_id = format!("cypher:{program_id}:{}", release.version);

    // Platz: der Download liegt im Cache, das Entpackte im Programmordner
    let cache_dir = input.dirs.downloads();
    let programs_free = fsx::free_space(&programs_dir)?;
    let cache_free = fsx::free_space(&cache_dir)?;
    let required = artifact.size.saturating_add(artifact.unpacked_size_max);
    if programs_free < artifact.unpacked_size_max {
        return Err(InstallError::DiskFull {
            path: programs_dir,
            needed: artifact.unpacked_size_max,
            available: programs_free,
        });
    }
    if cache_free < artifact.size {
        return Err(InstallError::DiskFull { path: cache_dir, needed: artifact.size, available: cache_free });
    }

    let part = cache_dir.join(format!("{}.part", artifact.sha256));
    let resume = resumable_bytes(&part, &url, artifact.size);

    let mut notes = Vec::new();
    if artifact.size >= LARGE_DOWNLOAD_BYTES {
        notes.push(InstallNote::LargeDownload { bytes: artifact.size });
    }
    if input.catalog_expired {
        notes.push(InstallNote::CatalogExpired);
    }
    if resume > 0 {
        notes.push(InstallNote::ResumeAvailable { bytes_done: resume });
    }
    match input.platform.os {
        crate::api::Os::Windows => notes.push(InstallNote::WindowsSmartScreenNotExpected),
        crate::api::Os::Macos => {
            notes.push(InstallNote::MacosNotarizationCheck);
            if input.platform.arch == crate::api::Arch::X86_64 {
                // Intel-Mac bekommt eine ältere Serie als die neueste: Hinweis mit der gewählten Version
                let newest = program.releases.iter().filter_map(|r| ProgVer::parse(&r.version).ok()).max();
                if let (Some(newest), Ok(chosen)) = (newest, ProgVer::parse(&release.version))
                    && chosen < newest
                {
                    notes.push(InstallNote::IntelMacOldRelease { version: release.version.clone() });
                }
            }
        }
        crate::api::Os::Linux => {
            if artifact.kind == ArtifactKind::AppImage && !input.fuse_available {
                // Ohne FUSE entpackt das AppImage sich beim Start selbst; bei der Installation läuft nichts
                notes.push(InstallNote::LinuxFuseMissing { fallback: FuseFallback::ExtractAndRun });
            }
        }
    }

    let replaces = input.known.iter().find(|i| i.managed_by_cypher && i.program_id == program_id).cloned();
    let existing: Vec<Installation> = input.known.iter().filter(|i| i.program_id == program_id).cloned().collect();

    let signature = artifact.signature.as_ref().map(|s| SignatureInfo {
        signature_type: match s.kind {
            SignatureKind::Pgp => SignatureType::Pgp,
            SignatureKind::Minisign => SignatureType::Minisign,
        },
        enforced: s.enforce,
        url: s.url.clone(),
        signer_fingerprints: s.fingerprints.clone(),
    });

    let host = url.host_str().unwrap_or_default().to_owned();
    let mirror_redirects = rule.redirects == RedirectPolicy::AnyHttpsPinned;
    let label = if mirror_redirects {
        format!("{host} (offizielle Quelle, Spiegelserver möglich)")
    } else {
        format!("{host} (offizielle Quelle)")
    };

    let dto = InstallPlan {
        plan_id: new_id(),
        program_id: program_id.to_owned(),
        program_name: program.name.clone(),
        version: release.version.clone(),
        channel: release.channel,
        source: PlanSource { label, host, url: artifact.url.clone(), mirror_redirects },
        artifact: PlanArtifact {
            kind: artifact.kind,
            file_name: artifact.file_name.clone(),
            size: artifact.size,
            sha256: artifact.sha256.clone(),
            checksum_source: artifact.checksum_source.clone(),
            checksum_origin: match artifact.checksum_origin {
                ChecksumOrigin::Upstream => DtoOrigin::Upstream,
                ChecksumOrigin::CypherPinned => DtoOrigin::CypherPinned,
            },
            signature,
        },
        license: LicenseInfo {
            spdx: program.license.spdx.clone(),
            name: program.license.name.clone(),
            url: program.license.url.clone(),
        },
        target: PlanTarget {
            dir: display_path(&target_dir),
            required_bytes: required,
            available_bytes: programs_free,
            portable: true,
            needs_admin: false,
        },
        replaces,
        existing,
        notes,
        created_at: now_iso(),
        expires_at: iso_after(crate::plans::PLAN_TTL),
    };
    Ok(InstallPlanData {
        program_id: program_id.to_owned(),
        version: release.version.clone(),
        installation_id,
        artifact: artifact.clone(),
        catalog_sequence: input.catalog_sequence,
        target_dir,
        programs_dir,
        app_image_mode: input.settings.linux.app_image_mode,
        dto,
    })
}
