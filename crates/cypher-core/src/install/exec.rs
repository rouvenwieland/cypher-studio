//! Installation ausführen: Download → Prüfung → Entpacken in Staging → Inhaltsprüfung → atomar registrieren
//! (ARCHITEKTUR.md 2.7, 5.1). Jeder Schritt ist abbrechbar und hinterlässt einen definierten Zustand.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use url::Url;

use super::archive::{ExtractLimits, ExtractOptions, ExtractProgress, extract};
use super::content::check_content;
use super::plan::{InstallPlanData, cache_extension};
use super::{appimage, dmg, exe, registry};
use crate::api::{
    ArtifactKind, InstallConsent, InstallEvent, InstallPhase, Installation, IoOp, NetworkPurpose, Settings,
};
use crate::catalog::SignatureKind;
use crate::download::{DownloadProgress, DownloadRequest, HttpClient, fetch_small, fetch_to_file};
use crate::error::{InstallError, IoError, VerifyError};
use crate::platform::{AppDirs, PlatformInfo, fsx};
use crate::process::CommandRunner;
use crate::progress::{NoProgress, ProgressSink};
use crate::state::{StateStore, StoredArtifact, StoredInstallation, StoredLauncher, StoredVerified};
use crate::util::now_iso;
use crate::verify::{PgpTrust, TrustedKeys, sha256_file, to_hex, verify_minisign_file, verify_pgp_detached};

/// Alles, was die Ausführung braucht.
pub struct InstallCtx<'a> {
    pub dirs: &'a AppDirs,
    pub http: &'a HttpClient,
    pub state: &'a StateStore,
    pub platform: &'a PlatformInfo,
    pub settings: &'a Settings,
    pub runner: Arc<dyn CommandRunner>,
    pub job_id: &'a str,
}

/// Name des Staging-Ordners im Programmordner (gleiches Laufwerk wie das Ziel, daher atomares Umbenennen).
pub const STAGING_DIR: &str = ".staging";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Journal {
    /// `extracting`: Staging läuft; `renamed`: Staging liegt am Ziel, Zustand noch nicht geschrieben.
    pub state: String,
    pub staging_dir: String,
    pub target_dir: String,
    pub old_dir: Option<String>,
    pub installation: StoredInstallation,
}

pub(crate) fn journal_path(programs_dir: &Path, job_id: &str) -> PathBuf {
    programs_dir.join(STAGING_DIR).join(format!("{job_id}.journal.json"))
}

fn check_cancel(cancel: &CancellationToken) -> Result<(), InstallError> {
    if cancel.is_cancelled() { Err(InstallError::Cancelled) } else { Ok(()) }
}

/// Führt blockierende Arbeit in einem Thread aus und wartet darauf.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, InstallError> + Send + 'static,
) -> Result<T, InstallError> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| InstallError::Process(format!("Hintergrundarbeit abgebrochen: {e}")))?
}

fn map_download_progress(sink: &dyn ProgressSink<InstallEvent>) -> impl Fn(DownloadProgress) + '_ {
    move |p| match p {
        DownloadProgress::Started { .. } => {}
        DownloadProgress::Progress { done, total, bytes_per_second } => {
            sink.emit(InstallEvent::DownloadProgress { downloaded_bytes: done, total_bytes: total, bytes_per_second });
        }
        DownloadProgress::Resumed { from } => sink.emit(InstallEvent::Resumed { from_byte: from }),
        DownloadProgress::Retrying { attempt, max, delay_ms, reason } => {
            sink.emit(InstallEvent::Retrying { attempt, max_attempts: max, delay_ms, reason });
        }
    }
}

fn parse_sha256(hex: &str) -> Result<[u8; 32], InstallError> {
    hex::decode(hex)
        .ok()
        .and_then(|b| <[u8; 32]>::try_from(b).ok())
        .ok_or_else(|| InstallError::InvalidInput { field: "sha256".into(), reason: "keine gültige SHA-256".into() })
}

/// Prüft die Upstream-Signatur, wenn der Katalog eine nennt. `Ok(true)` = gültig geprüft.
/// Bei `enforce = false` wird ein Fehlschlag nur protokolliert.
async fn verify_signature(
    ctx: &InstallCtx<'_>,
    plan: &InstallPlanData,
    file: &Path,
    cancel: &CancellationToken,
) -> Result<bool, InstallError> {
    let Some(spec) = &plan.artifact.signature else { return Ok(false) };
    let url = Url::parse(&spec.url)
        .map_err(|e| InstallError::InvalidInput { field: "signature.url".into(), reason: e.to_string() })?;
    let sig_bytes = match fetch_small(ctx.http, &url, 64 * 1024, NetworkPurpose::ProgramDownload, cancel).await {
        Ok(b) => b,
        Err(e) if !spec.enforce => {
            tracing::warn!("Signatur ({}) nicht ladbar, nicht durchgesetzt: {e}", spec.url);
            return Ok(false);
        }
        Err(e) => return Err(e.into()),
    };
    let file = file.to_path_buf();
    let spec = spec.clone();
    let token = cancel.clone();
    // Dokumentierte Ausnahme: nur wenn Cypher die SHA-256 selbst festgenagelt hat, darf eine SHA-1-Signatur zusätzlich gelten
    let weak_hash_ok = plan.artifact.checksum_origin == crate::catalog::ChecksumOrigin::CypherPinned;
    let checked = blocking(move || -> Result<Result<(), VerifyError>, InstallError> {
        let result = match spec.kind {
            SignatureKind::Pgp => verify_pgp_detached(
                &file,
                &sig_bytes,
                &PgpTrust {
                    public_keys_armored: &spec.public_keys,
                    allowed_fingerprints: &spec.fingerprints,
                    allow_weak_hash: weak_hash_ok,
                },
            )
            .map(|_| ()),
            SignatureKind::Minisign => {
                let keys = TrustedKeys::from_strs(&spec.public_keys.iter().map(String::as_str).collect::<Vec<_>>())
                    .map_err(|e| VerifyError::Signature(e.to_string()));
                let text = String::from_utf8_lossy(&sig_bytes).into_owned();
                keys.and_then(|k| verify_minisign_file(&file, &text, &k, &token).map(|_| ()))
            }
        };
        Ok(result)
    })
    .await?;
    match checked {
        Ok(()) => Ok(true),
        Err(VerifyError::Cancelled) => Err(InstallError::Cancelled),
        Err(e) if spec_enforced(plan) => Err(e.into()),
        Err(e) => {
            tracing::warn!("Upstream-Signatur nicht gültig, nicht durchgesetzt: {e}");
            Ok(false)
        }
    }
}

fn spec_enforced(plan: &InstallPlanData) -> bool {
    plan.artifact.signature.as_ref().is_some_and(|s| s.enforce)
}

/// Räumt Staging auf (beim Fehler oder Abbruch).
fn cleanup_staging(programs_dir: &Path, staging: &Path, job_id: &str) {
    let _ = fsx::remove_dir_all_forced(staging);
    let _ = std::fs::remove_file(journal_path(programs_dir, job_id));
    let mnt = programs_dir.join(STAGING_DIR).join(format!("{job_id}-mnt"));
    let _ = fsx::remove_dir_all_forced(&mnt);
}

/// Führt einen Plan aus. Die Zustimmung muss genau den gezeigten Plan wiederholen.
pub async fn execute(
    ctx: &InstallCtx<'_>,
    plan: InstallPlanData,
    consent: &InstallConsent,
    sink: &dyn ProgressSink<InstallEvent>,
    cancel: &CancellationToken,
) -> Result<Installation, InstallError> {
    // Zustimmung gehört zu genau diesem Plan
    if consent.plan_id != plan.dto.plan_id
        || !consent.sha256.eq_ignore_ascii_case(&plan.artifact.sha256)
        || consent.license_spdx != plan.dto.license.spdx
        || consent.target_dir != plan.dto.target.dir
    {
        return Err(InstallError::ConsentMismatch(plan.dto.plan_id.clone()));
    }
    check_cancel(cancel)?;

    let programs_dir = plan.programs_dir.clone();
    let staging = programs_dir.join(STAGING_DIR).join(ctx.job_id);
    let result = run(ctx, &plan, sink, cancel, &staging).await;
    if result.is_err() {
        cleanup_staging(&programs_dir, &staging, ctx.job_id);
    }
    result
}

async fn run(
    ctx: &InstallCtx<'_>,
    plan: &InstallPlanData,
    sink: &dyn ProgressSink<InstallEvent>,
    cancel: &CancellationToken,
    staging: &Path,
) -> Result<Installation, InstallError> {
    let artifact = &plan.artifact;
    sink.emit(InstallEvent::Started { job_id: ctx.job_id.to_owned(), total_bytes: artifact.size });

    // --- Download ---------------------------------------------------------------------------
    sink.emit(InstallEvent::Phase { phase: InstallPhase::Download });
    let sha = parse_sha256(&artifact.sha256)?;
    let url = Url::parse(&artifact.url)
        .map_err(|e| InstallError::InvalidInput { field: "url".into(), reason: e.to_string() })?;
    let cache_dir = ctx.dirs.downloads();
    let part = cache_dir.join(format!("{}.part", artifact.sha256));
    let cached = cache_dir.join(format!("{}.{}", artifact.sha256, cache_extension(artifact.kind)));
    let request = DownloadRequest::new(url, part, cached.clone(), &artifact.file_name, artifact.size, sha);
    let have_cached = {
        let (path, token) = (cached.clone(), cancel.clone());
        path.is_file() && blocking(move || Ok(sha256_file(&path, &token).ok() == Some(sha))).await?
    };
    let downloaded = if have_cached {
        sink.emit(InstallEvent::DownloadProgress {
            downloaded_bytes: artifact.size,
            total_bytes: artifact.size,
            bytes_per_second: 0,
        });
        cached.clone()
    } else {
        let mapper = map_download_progress(sink);
        fetch_to_file(ctx.http, &request, &mapper, cancel).await?.path
    };
    check_cancel(cancel)?;

    // --- Prüfsumme (im Download schon bewiesen) und Signatur -----------------------------------
    sink.emit(InstallEvent::Phase { phase: InstallPhase::VerifyChecksum });
    let signature_checked = if artifact.signature.is_some() {
        sink.emit(InstallEvent::Phase { phase: InstallPhase::VerifySignature });
        match verify_signature(ctx, plan, &downloaded, cancel).await {
            Ok(checked) => checked,
            Err(e) => {
                if matches!(e, InstallError::Verify(_)) {
                    // Datei ist nicht vertrauenswürdig: aus dem Cache entfernen
                    let _ = std::fs::remove_file(&downloaded);
                }
                return Err(e);
            }
        }
    } else {
        false
    };
    sink.emit(InstallEvent::Verified { sha256: artifact.sha256.clone(), signature_checked });
    check_cancel(cancel)?;

    // --- Entpacken in Staging --------------------------------------------------------------
    sink.emit(InstallEvent::Phase { phase: InstallPhase::Extract });
    std::fs::create_dir_all(staging).map_err(|e| IoError::new(IoOp::CreateDir, staging, e))?;
    let mut not_notarized = false;
    let launcher_hint = extract_into_staging(ctx, plan, &downloaded, staging, sink, cancel, &mut not_notarized).await?;
    check_cancel(cancel)?;

    // --- Inhalt prüfen ----------------------------------------------------------------------
    sink.emit(InstallEvent::Phase { phase: InstallPhase::CheckContent });
    let launcher = {
        let (staging, artifact) = (staging.to_path_buf(), artifact.clone());
        blocking(move || check_content(&staging, &artifact)).await?
    };
    let launcher = merge_launcher(launcher, launcher_hint);
    if let Some(marker) = &artifact.launch.portable_marker
        && artifact.kind != ArtifactKind::Dmg
    {
        let dir = fsx::safe_join(staging, marker).map_err(|e| InstallError::VerificationFailed(e.to_string()))?;
        std::fs::create_dir_all(&dir).map_err(|e| IoError::new(IoOp::CreateDir, dir, e))?;
    }
    check_cancel(cancel)?;

    // --- Registrieren -----------------------------------------------------------------------
    sink.emit(InstallEvent::Phase { phase: InstallPhase::Register });
    let stored = StoredInstallation {
        id: plan.installation_id.clone(),
        program_id: plan.program_id.clone(),
        version: plan.version.clone(),
        kind: "cypher".into(),
        path: plan.target_dir.to_string_lossy().into_owned(),
        launcher,
        programs_root: Some(plan.programs_dir.to_string_lossy().into_owned()),
        installed_at: now_iso(),
        verified: StoredVerified {
            sha256: artifact.sha256.clone(),
            catalog_sequence: plan.catalog_sequence,
            signature_checked,
        },
        artifact: StoredArtifact { url: artifact.url.clone(), kind: format!("{:?}", artifact.kind) },
        not_notarized,
    };
    register(ctx, plan, staging, &stored)?;

    // Cache aufräumen
    if !ctx.settings.downloads.keep_cache {
        let _ = std::fs::remove_file(&downloaded);
    }
    let installation = registry::installation_dto(&stored, ctx.platform, &*ctx.runner);
    sink.emit(InstallEvent::Finished { installation: installation.clone() });
    Ok(installation)
}

/// Bei entpacktem AppImage kennt der Entpacker den Launcher schon; sonst überschreibt die Inhaltsprüfung.
fn merge_launcher(checked: StoredLauncher, _hint: Option<StoredLauncher>) -> StoredLauncher {
    checked
}

async fn extract_into_staging(
    ctx: &InstallCtx<'_>,
    plan: &InstallPlanData,
    downloaded: &Path,
    staging: &Path,
    sink: &dyn ProgressSink<InstallEvent>,
    cancel: &CancellationToken,
    not_notarized: &mut bool,
) -> Result<Option<StoredLauncher>, InstallError> {
    let artifact = &plan.artifact;
    match artifact.kind {
        ArtifactKind::Zip | ArtifactKind::SevenZ | ArtifactKind::Sfx7z | ArtifactKind::TarXz | ArtifactKind::TarGz => {
            let limits = ExtractLimits { max_total_bytes: artifact.unpacked_size_max, ..ExtractLimits::default() };
            let allow_symlinks = matches!(artifact.kind, ArtifactKind::TarXz | ArtifactKind::TarGz) && cfg!(unix);
            let opts = ExtractOptions::new(artifact.strip_components, allow_symlinks);
            let (kind, src, dest, token) =
                (artifact.kind, downloaded.to_path_buf(), staging.to_path_buf(), cancel.clone());
            let (tx, rx) = std::sync::mpsc::channel::<ExtractProgress>();
            let mut handle = tokio::task::spawn_blocking(move || {
                let report = move |p: ExtractProgress| {
                    let _ = tx.send(p);
                };
                extract(kind, &src, &dest, &limits, &opts, &report, &token)
            });
            let outcome = loop {
                tokio::select! {
                    res = &mut handle => break res,
                    _ = tokio::time::sleep(Duration::from_millis(100)) => {
                        while let Ok(p) = rx.try_recv() {
                            sink.emit(InstallEvent::ExtractProgress { entries_done: p.entries_done, entries_total: p.entries_total, bytes_written: p.bytes_written });
                        }
                    }
                }
            };
            while let Ok(p) = rx.try_recv() {
                sink.emit(InstallEvent::ExtractProgress {
                    entries_done: p.entries_done,
                    entries_total: p.entries_total,
                    bytes_written: p.bytes_written,
                });
            }
            outcome.map_err(|e| InstallError::Process(format!("Entpacken abgebrochen: {e}")))??;
            Ok(None)
        }
        ArtifactKind::AppImage => {
            // Das AppImage wird bei der Installation nie ausgeführt (ARCHITEKTUR 6.4): nur kopieren und ausführbar machen.
            // Ohne FUSE (oder im Modus „Entpacken“) startet es später mit APPIMAGE_EXTRACT_AND_RUN, also erst durch die
            // Nutzerin, nach der SHA-256-Prüfung gegen den signierten Katalog.
            let target = fsx::safe_join(staging, &artifact.file_name)
                .map_err(|e| InstallError::VerificationFailed(e.to_string()))?;
            std::fs::copy(downloaded, &target).map_err(|e| IoError::new(IoOp::Copy, &target, e))?;
            appimage::make_executable(&target)?;
            Ok(None)
        }
        ArtifactKind::Dmg => {
            let bundle = artifact
                .mac_app_name
                .clone()
                .ok_or_else(|| InstallError::VerificationFailed("macAppName fehlt im Katalog".into()))?;
            let mnt_parent = plan.programs_dir.join(STAGING_DIR).join(format!("{}-mnt", ctx.job_id));
            std::fs::create_dir_all(&mnt_parent).map_err(|e| IoError::new(IoOp::CreateDir, &mnt_parent, e))?;
            let (runner, dmg_path, dest) = (ctx.runner.clone(), downloaded.to_path_buf(), staging.join(&bundle));
            let mnt = mnt_parent.clone();
            let assessment = blocking(move || {
                let guard = dmg::attach(&*runner, &dmg_path, &mnt)?;
                dmg::copy_bundle(&*runner, &guard.mount_point.join(&bundle), &dest)?;
                drop(guard);
                dmg::assess(&*runner, &dest)
            })
            .await?;
            let _ = fsx::remove_dir_all_forced(&mnt_parent);
            if !assessment.signature_valid {
                return Err(InstallError::VerificationFailed("Signatur der App ist ungültig (codesign)".into()));
            }
            *not_notarized = !assessment.accepted_by_gatekeeper;
            Ok(None)
        }
        ArtifactKind::ExeInstaller => {
            // Installer schreiben direkt ins Ziel (kein Staging-Umbenennen): sonst zeigen ihre Einträge ins Leere.
            let installer_type = artifact
                .installer_type
                .ok_or_else(|| InstallError::VerificationFailed("installerType fehlt im Katalog".into()))?;
            let (runner, file, target) = (ctx.runner.clone(), downloaded.to_path_buf(), staging.to_path_buf());
            blocking(move || exe::run_installer(&*runner, &file, installer_type, &target)).await?;
            Ok(None)
        }
    }
}

/// Setzt das Ergebnis atomar an den Zielort und schreibt den Zustand. Absturzsicher über ein Journal.
fn register(
    ctx: &InstallCtx<'_>,
    plan: &InstallPlanData,
    staging: &Path,
    stored: &StoredInstallation,
) -> Result<(), InstallError> {
    let target = &plan.target_dir;
    let programs_dir = &plan.programs_dir;
    let journal = journal_path(programs_dir, ctx.job_id);

    // Ersetzen: vorhandenes Ziel beiseite stellen (nie löschen, bevor das Neue steht)
    let old = if target.exists() {
        if registry::running_in(target) {
            return Err(InstallError::ProgramRunning);
        }
        let stamp =
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let mut name = target.file_name().map(|n| n.to_os_string()).unwrap_or_default();
        name.push(format!(".old-{stamp}"));
        Some(target.with_file_name(name))
    } else {
        None
    };
    let mut entry = Journal {
        state: "extracting".into(),
        staging_dir: staging.to_string_lossy().into_owned(),
        target_dir: target.to_string_lossy().into_owned(),
        old_dir: old.as_ref().map(|o| o.to_string_lossy().into_owned()),
        installation: stored.clone(),
    };
    fsx::write_json_atomic(&journal, &entry)?;

    if let Some(old) = &old {
        fsx::retry_transient(|| std::fs::rename(target, old)).map_err(|e| IoError::new(IoOp::Rename, target, e))?;
    }
    if let Err(e) = fsx::rename_dir_atomic(staging, target) {
        if let Some(old) = &old {
            let _ = std::fs::rename(old, target);
        }
        return Err(e.into());
    }
    entry.state = "renamed".into();
    fsx::write_json_atomic(&journal, &entry)?;

    ctx.state.update(|s| {
        s.installations.retain(|i| i.id != stored.id);
        s.installations.push(stored.clone());
        s.preferred.entry(stored.program_id.clone()).or_insert_with(|| stored.id.clone());
    })?;

    if let Some(old) = &old {
        let _ = fsx::remove_dir_all_forced(old);
    }
    let _ = std::fs::remove_file(&journal);
    Ok(())
}

/// Hilfsfunktion für Aufrufer ohne Fortschrittsanzeige.
pub async fn execute_silently(
    ctx: &InstallCtx<'_>,
    plan: InstallPlanData,
    consent: &InstallConsent,
    cancel: &CancellationToken,
) -> Result<Installation, InstallError> {
    execute(ctx, plan, consent, &NoProgress, cancel).await
}

/// Gibt den SHA-256-Hexwert einer Datei zurück (für Fehlermeldungen und Tests).
pub fn file_sha256_hex(path: &Path) -> Result<String, VerifyError> {
    Ok(to_hex(&sha256_file(path, &CancellationToken::new())?))
}
