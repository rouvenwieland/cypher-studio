//! Streaming-Download mit Fortsetzen, Wiederholen und Abbruch (ARCHITEKTUR.md 2.6).

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::StatusCode;
use reqwest::header::{
    CONTENT_LENGTH, CONTENT_RANGE, ETAG, HeaderMap, HeaderValue, IF_RANGE, LAST_MODIFIED, RANGE, RETRY_AFTER,
};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
use url::Url;

use super::client::{HttpClient, map_error};
use crate::api::{IoOp, NetworkPurpose};
use crate::error::{DownloadError, IoError, VerifyError};
use crate::progress::ProgressSink;
use crate::verify::{Sha256Stream, sha256_file, to_hex};

/// Ereignisse des Downloads (die Installation übersetzt sie in `InstallEvent`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DownloadProgress {
    Started { total: u64 },
    Progress { done: u64, total: u64, bytes_per_second: u64 },
    Resumed { from: u64 },
    Retrying { attempt: u32, max: u32, delay_ms: u64, reason: String },
}

/// Alles, was ein Download braucht. Größe und SHA-256 stammen aus dem signierten Katalog.
#[derive(Debug, Clone)]
pub struct DownloadRequest {
    pub url: Url,
    /// `<cache>/downloads/<sha256>.part`; daneben liegt `<part>.json` mit den Validatoren (ETag, Last-Modified).
    pub part_path: PathBuf,
    /// Zielpfad nach erfolgreicher Prüfung.
    pub final_path: PathBuf,
    /// Dateiname für Meldungen.
    pub file_name: String,
    pub expected_size: u64,
    pub expected_sha256: [u8; 32],
    /// Versuche insgesamt (Standard 4).
    pub max_attempts: u32,
    /// Wartezeit vor Versuch 2, 3, 4 (Standard 1 s, 4 s, 15 s).
    pub retry_delays: Vec<Duration>,
    pub purpose: NetworkPurpose,
}

impl DownloadRequest {
    pub fn new(
        url: Url,
        part_path: PathBuf,
        final_path: PathBuf,
        file_name: impl Into<String>,
        expected_size: u64,
        expected_sha256: [u8; 32],
    ) -> Self {
        DownloadRequest {
            url,
            part_path,
            final_path,
            file_name: file_name.into(),
            expected_size,
            expected_sha256,
            max_attempts: 4,
            retry_delays: vec![Duration::from_secs(1), Duration::from_secs(4), Duration::from_secs(15)],
            purpose: NetworkPurpose::ProgramDownload,
        }
    }
}

#[derive(Debug, Clone)]
pub struct DownloadedFile {
    pub path: PathBuf,
    pub size: u64,
    pub sha256: [u8; 32],
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartMeta {
    url: String,
    etag: Option<String>,
    last_modified: Option<String>,
    expected_size: u64,
}

fn meta_path(part: &Path) -> PathBuf {
    let mut name = part.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".json");
    part.with_file_name(name)
}

/// Größe einer vorhandenen `.part`-Datei, falls sie zu dieser Anfrage passt (für die Vorschau „Fortsetzen möglich“).
pub fn resumable_bytes(part: &Path, url: &Url, expected_size: u64) -> u64 {
    let meta: Option<PartMeta> = std::fs::read(meta_path(part)).ok().and_then(|b| serde_json::from_slice(&b).ok());
    match (meta, std::fs::metadata(part)) {
        (Some(m), Ok(md)) if m.url == url.as_str() && m.expected_size == expected_size && md.len() < expected_size => {
            md.len()
        }
        _ => 0,
    }
}

enum Attempt {
    Done(DownloadedFile),
    /// Dauerhafter Fehler.
    Fatal(DownloadError),
    /// Wiederholen nach `delay` (oder der Standardwartezeit); `error` ist der Fehler, falls die Versuche ausgehen.
    Retry {
        error: DownloadError,
        delay: Option<Duration>,
    },
}

async fn remove_part(part: &Path) {
    let _ = tokio::fs::remove_file(part).await;
    let _ = tokio::fs::remove_file(meta_path(part)).await;
}

/// Lädt `req.url` nach `req.final_path`, prüft Größe und SHA-256 und liefert die Datei.
///
/// - Setzt eine passende `.part`-Datei per `Range`/`If-Range` fort.
/// - Wiederholt bei Netzwerkfehlern, 408, 429 (mit `Retry-After`) und 5xx, nie bei anderen 4xx.
/// - Bei Abbruch bleibt die `.part`-Datei zum Fortsetzen liegen; bei falscher Größe oder Prüfsumme wird sie gelöscht.
pub async fn fetch_to_file(
    http: &HttpClient,
    req: &DownloadRequest,
    sink: &dyn ProgressSink<DownloadProgress>,
    cancel: &CancellationToken,
) -> Result<DownloadedFile, DownloadError> {
    http.policy.check(&req.url)?;
    if let Some(parent) = req.part_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| IoError::new(IoOp::CreateDir, parent, e))?;
    }
    if let Some(parent) = req.final_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| IoError::new(IoOp::CreateDir, parent, e))?;
    }
    sink.emit(DownloadProgress::Started { total: req.expected_size });
    let max_attempts = req.max_attempts.max(1);
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        if cancel.is_cancelled() {
            return Err(DownloadError::Cancelled);
        }
        match attempt_once(http, req, sink, cancel).await {
            Attempt::Done(file) => return Ok(file),
            Attempt::Fatal(e) => return Err(e),
            Attempt::Retry { error, delay } => {
                if attempt >= max_attempts {
                    return Err(error);
                }
                let delay = delay
                    .or_else(|| req.retry_delays.get(attempt as usize - 1).or(req.retry_delays.last()).copied())
                    .unwrap_or(Duration::from_secs(1));
                sink.emit(DownloadProgress::Retrying {
                    attempt: attempt + 1,
                    max: max_attempts,
                    delay_ms: delay.as_millis() as u64,
                    reason: error.to_string(),
                });
                tokio::select! {
                    _ = cancel.cancelled() => return Err(DownloadError::Cancelled),
                    _ = tokio::time::sleep(delay) => {}
                }
            }
        }
    }
}

fn header_str(headers: &HeaderMap, name: reqwest::header::HeaderName) -> Option<String> {
    headers.get(name).and_then(|v| v.to_str().ok()).map(str::to_owned)
}

/// `Content-Range: bytes 100-999/1000` → (Start, Gesamtgröße)
fn parse_content_range(value: &str) -> Option<(u64, Option<u64>)> {
    let rest = value.trim().strip_prefix("bytes")?.trim();
    let (range, total) = rest.split_once('/')?;
    let (start, _end) = range.split_once('-')?;
    let total = if total.trim() == "*" { None } else { total.trim().parse().ok() };
    Some((start.trim().parse().ok()?, total))
}

async fn hash_existing(
    part: &Path,
    hasher: &mut Sha256Stream,
    cancel: &CancellationToken,
) -> Result<(), DownloadError> {
    let mut file = tokio::fs::File::open(part).await.map_err(|e| IoError::read(part, e))?;
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        if cancel.is_cancelled() {
            return Err(DownloadError::Cancelled);
        }
        let n = file.read(&mut buf).await.map_err(|e| IoError::read(part, e))?;
        if n == 0 {
            return Ok(());
        }
        hasher.update(&buf[..n]);
    }
}

async fn verify_and_finish(req: &DownloadRequest, cancel: &CancellationToken) -> Attempt {
    let part = req.part_path.clone();
    let token = cancel.clone();
    let digest = match tokio::task::spawn_blocking(move || sha256_file(&part, &token)).await {
        Ok(Ok(d)) => d,
        Ok(Err(VerifyError::Cancelled)) => return Attempt::Fatal(DownloadError::Cancelled),
        Ok(Err(e)) => return Attempt::Fatal(e.into()),
        Err(e) => {
            return Attempt::Fatal(DownloadError::Io(IoError::other(IoOp::Read, Some(&req.part_path), e.to_string())));
        }
    };
    if digest != req.expected_sha256 {
        remove_part(&req.part_path).await;
        return Attempt::Fatal(DownloadError::Checksum(VerifyError::ChecksumMismatch {
            file: req.file_name.clone(),
            expected: to_hex(&req.expected_sha256),
            actual: to_hex(&digest),
        }));
    }
    if let Err(e) = tokio::fs::rename(&req.part_path, &req.final_path).await {
        return Attempt::Fatal(IoError::new(IoOp::Rename, &req.final_path, e).into());
    }
    let _ = tokio::fs::remove_file(meta_path(&req.part_path)).await;
    Attempt::Done(DownloadedFile { path: req.final_path.clone(), size: req.expected_size, sha256: digest })
}

async fn attempt_once(
    http: &HttpClient,
    req: &DownloadRequest,
    sink: &dyn ProgressSink<DownloadProgress>,
    cancel: &CancellationToken,
) -> Attempt {
    let host = req.url.host_str().unwrap_or_default().to_owned();
    let part = &req.part_path;

    // Vorhandene .part-Datei prüfen
    let meta: Option<PartMeta> =
        tokio::fs::read(meta_path(part)).await.ok().and_then(|b| serde_json::from_slice(&b).ok());
    let mut existing = tokio::fs::metadata(part).await.map(|m| m.len()).unwrap_or(0);
    let meta_matches = meta.as_ref().is_some_and(|m| m.url == req.url.as_str() && m.expected_size == req.expected_size);
    if existing > 0 && !meta_matches {
        remove_part(part).await;
        existing = 0;
    }
    if existing > req.expected_size {
        remove_part(part).await;
        existing = 0;
    }
    if existing == req.expected_size && existing > 0 {
        // Komplett, aber noch nicht geprüft (z. B. Absturz nach dem letzten Chunk)
        return verify_and_finish(req, cancel).await;
    }

    let mut headers = HeaderMap::new();
    if existing > 0 {
        if let Ok(v) = HeaderValue::from_str(&format!("bytes={existing}-")) {
            headers.insert(RANGE, v);
        }
        let validator = meta.as_ref().and_then(|m| m.etag.clone().or_else(|| m.last_modified.clone()));
        if let Some(v) = validator.and_then(|v| HeaderValue::from_str(&v).ok()) {
            headers.insert(IF_RANGE, v);
        }
    }

    let response = tokio::select! {
        _ = cancel.cancelled() => return Attempt::Fatal(DownloadError::Cancelled),
        r = http.send_get(&req.url, headers, false, req.purpose) => match r {
            Ok(r) => r,
            Err(e @ DownloadError::Network { retryable: true, .. }) => return Attempt::Retry { error: e, delay: None },
            Err(e) => return Attempt::Fatal(e),
        },
    };
    let status = response.status();

    let resumed_from = match status {
        StatusCode::PARTIAL_CONTENT if existing > 0 => {
            let range = header_str(response.headers(), CONTENT_RANGE).and_then(|v| parse_content_range(&v));
            match range {
                Some((start, total)) if start == existing && total.is_none_or(|t| t == req.expected_size) => existing,
                _ => {
                    remove_part(part).await;
                    return Attempt::Retry {
                        error: DownloadError::Network {
                            host,
                            message: "ungültige Teilantwort (Content-Range)".into(),
                            retryable: true,
                        },
                        delay: Some(Duration::ZERO),
                    };
                }
            }
        }
        StatusCode::OK | StatusCode::PARTIAL_CONTENT => {
            // Server hat die Bereichsanfrage ignoriert oder If-Range stimmte nicht: von vorn
            if let Some(len) = header_str(response.headers(), CONTENT_LENGTH).and_then(|v| v.parse::<u64>().ok())
                && len != req.expected_size
            {
                remove_part(part).await;
                return Attempt::Fatal(DownloadError::SizeMismatch {
                    file: req.file_name.clone(),
                    expected: req.expected_size,
                    actual: len,
                });
            }
            0
        }
        StatusCode::RANGE_NOT_SATISFIABLE => {
            remove_part(part).await;
            return Attempt::Retry {
                error: DownloadError::Http { host, status: status.as_u16() },
                delay: Some(Duration::ZERO),
            };
        }
        s if s == StatusCode::REQUEST_TIMEOUT || s == StatusCode::TOO_MANY_REQUESTS || s.is_server_error() => {
            let delay = header_str(response.headers(), RETRY_AFTER)
                .and_then(|v| v.trim().parse::<u64>().ok())
                .map(|secs| Duration::from_secs(secs.min(60)));
            return Attempt::Retry { error: DownloadError::Http { host, status: s.as_u16() }, delay };
        }
        s => return Attempt::Fatal(DownloadError::Http { host, status: s.as_u16() }),
    };

    // Metadaten (Validatoren) für spätere Fortsetzung
    if resumed_from == 0 {
        remove_part(part).await;
        let meta = PartMeta {
            url: req.url.to_string(),
            etag: header_str(response.headers(), ETAG),
            last_modified: header_str(response.headers(), LAST_MODIFIED),
            expected_size: req.expected_size,
        };
        if let Ok(bytes) = serde_json::to_vec(&meta)
            && let Err(e) = tokio::fs::write(meta_path(part), bytes).await
        {
            return Attempt::Fatal(IoError::write(&meta_path(part), e).into());
        }
    }

    let mut hasher = Sha256Stream::new();
    let mut file = if resumed_from > 0 {
        if let Err(e) = hash_existing(part, &mut hasher, cancel).await {
            return Attempt::Fatal(e);
        }
        sink.emit(DownloadProgress::Resumed { from: resumed_from });
        match tokio::fs::OpenOptions::new().append(true).open(part).await {
            Ok(f) => f,
            Err(e) => return Attempt::Fatal(IoError::new(IoOp::Write, part, e).into()),
        }
    } else {
        match tokio::fs::File::create(part).await {
            Ok(f) => f,
            Err(e) => return Attempt::Fatal(IoError::new(IoOp::Write, part, e).into()),
        }
    };

    let started = Instant::now();
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let mut written: u64 = 0;
    let mut stream = response.bytes_stream();
    loop {
        let next = tokio::select! {
            _ = cancel.cancelled() => {
                let _ = file.flush().await;
                return Attempt::Fatal(DownloadError::Cancelled);
            }
            n = stream.next() => n,
        };
        let Some(chunk) = next else { break };
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                let _ = file.flush().await;
                let err = map_error(&host, e);
                return match err {
                    DownloadError::Network { retryable: true, .. } => Attempt::Retry { error: err, delay: None },
                    other => Attempt::Fatal(other),
                };
            }
        };
        let total_now = resumed_from + written + chunk.len() as u64;
        if total_now > req.expected_size {
            drop(file);
            remove_part(part).await;
            return Attempt::Fatal(DownloadError::SizeMismatch {
                file: req.file_name.clone(),
                expected: req.expected_size,
                actual: total_now,
            });
        }
        hasher.update(&chunk);
        if let Err(e) = file.write_all(&chunk).await {
            return Attempt::Fatal(IoError::new(IoOp::Write, part, e).into());
        }
        written += chunk.len() as u64;
        if last_emit.elapsed() >= Duration::from_millis(100) {
            last_emit = Instant::now();
            let secs = started.elapsed().as_secs_f64().max(0.001);
            sink.emit(DownloadProgress::Progress {
                done: resumed_from + written,
                total: req.expected_size,
                bytes_per_second: (written as f64 / secs) as u64,
            });
        }
    }
    if let Err(e) = file.flush().await {
        return Attempt::Fatal(IoError::new(IoOp::Write, part, e).into());
    }
    if let Err(e) = file.sync_all().await {
        return Attempt::Fatal(IoError::new(IoOp::Write, part, e).into());
    }
    drop(file);

    let total = resumed_from + written;
    http.log.record(&host, req.purpose, Some(200), written);
    sink.emit(DownloadProgress::Progress { done: total, total: req.expected_size, bytes_per_second: 0 });
    if total < req.expected_size {
        // Verbindung vorzeitig beendet: .part bleibt, nächster Versuch setzt fort
        return Attempt::Retry {
            error: DownloadError::Network {
                host,
                message: format!("Verbindung nach {total} von {} Bytes beendet", req.expected_size),
                retryable: true,
            },
            delay: None,
        };
    }
    let _ = hasher; // die Prüfsumme wird unten aus der Datei neu berechnet (ein Weg, ein Ergebnis)
    verify_and_finish(req, cancel).await
}

/// Größe einer Datei ohne den Inhalt zu laden (Bereichsanfrage `bytes=0-0`; Antwort `Content-Range` bzw. `Content-Length`).
/// Für die Katalogpflege (`cypher catalog check --online`).
pub async fn probe_size(
    http: &HttpClient,
    url: &Url,
    purpose: NetworkPurpose,
    cancel: &CancellationToken,
) -> Result<u64, DownloadError> {
    let host = url.host_str().unwrap_or_default().to_owned();
    let mut headers = HeaderMap::new();
    headers.insert(RANGE, HeaderValue::from_static("bytes=0-0"));
    let response = tokio::select! {
        _ = cancel.cancelled() => return Err(DownloadError::Cancelled),
        r = http.send_get(url, headers, false, purpose) => r?,
    };
    let status = response.status();
    if !status.is_success() {
        return Err(DownloadError::Http { host, status: status.as_u16() });
    }
    let total = header_str(response.headers(), CONTENT_RANGE)
        .and_then(|v| parse_content_range(&v))
        .and_then(|(_, total)| total)
        .or_else(|| header_str(response.headers(), CONTENT_LENGTH).and_then(|v| v.parse().ok()));
    total.ok_or(DownloadError::Network { host, message: "Server nennt keine Dateigröße".into(), retryable: false })
}

/// Lädt eine kleine Datei (Katalog, Prüfsummendatei, Signatur) in den Speicher. Weiterleitungen nur innerhalb der
/// Hostliste. Bis zu 3 Versuche bei Netzwerkfehlern und 5xx.
pub async fn fetch_small(
    http: &HttpClient,
    url: &Url,
    max_bytes: u64,
    purpose: NetworkPurpose,
    cancel: &CancellationToken,
) -> Result<Vec<u8>, DownloadError> {
    fetch_small_with_delays(http, url, max_bytes, purpose, cancel, &[Duration::from_secs(1), Duration::from_secs(3)])
        .await
}

pub async fn fetch_small_with_delays(
    http: &HttpClient,
    url: &Url,
    max_bytes: u64,
    purpose: NetworkPurpose,
    cancel: &CancellationToken,
    delays: &[Duration],
) -> Result<Vec<u8>, DownloadError> {
    http.policy.check(url)?;
    let host = url.host_str().unwrap_or_default().to_owned();
    let mut attempt = 0usize;
    loop {
        let result = small_once(http, url, &host, max_bytes, purpose, cancel).await;
        match result {
            Err(DownloadError::Network { retryable: true, .. } | DownloadError::Http { status: 500..=599, .. })
                if attempt < delays.len() =>
            {
                let delay = delays[attempt];
                attempt += 1;
                tokio::select! {
                    _ = cancel.cancelled() => return Err(DownloadError::Cancelled),
                    _ = tokio::time::sleep(delay) => {}
                }
            }
            other => return other,
        }
    }
}

async fn small_once(
    http: &HttpClient,
    url: &Url,
    host: &str,
    max_bytes: u64,
    purpose: NetworkPurpose,
    cancel: &CancellationToken,
) -> Result<Vec<u8>, DownloadError> {
    let response = tokio::select! {
        _ = cancel.cancelled() => return Err(DownloadError::Cancelled),
        r = http.send_get(url, HeaderMap::new(), true, purpose) => r?,
    };
    let status = response.status();
    if !status.is_success() {
        return Err(DownloadError::Http { host: host.to_owned(), status: status.as_u16() });
    }
    if response.content_length().is_some_and(|l| l > max_bytes) {
        return Err(DownloadError::TooLarge { limit: max_bytes });
    }
    let mut out = Vec::new();
    let mut stream = response.bytes_stream();
    loop {
        let next = tokio::select! {
            _ = cancel.cancelled() => return Err(DownloadError::Cancelled),
            n = stream.next() => n,
        };
        let Some(chunk) = next else { break };
        let chunk = chunk.map_err(|e| map_error(host, e))?;
        if out.len() as u64 + chunk.len() as u64 > max_bytes {
            return Err(DownloadError::TooLarge { limit: max_bytes });
        }
        out.extend_from_slice(&chunk);
    }
    http.log.record(host, purpose, Some(status.as_u16()), out.len() as u64);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_range_parsing() {
        assert_eq!(parse_content_range("bytes 100-999/1000"), Some((100, Some(1000))));
        assert_eq!(parse_content_range("bytes 0-9/*"), Some((0, None)));
        assert_eq!(parse_content_range("items 0-9/10"), None);
        assert_eq!(parse_content_range("bytes x-9/10"), None);
    }

    #[test]
    fn meta_path_sits_next_to_the_part_file() {
        assert_eq!(meta_path(Path::new("/c/abc.part")), Path::new("/c/abc.part.json"));
    }
}
