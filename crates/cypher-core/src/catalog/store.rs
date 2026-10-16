//! Laden, Zwischenspeichern und Aktualisieren des Katalogs (ARCHITEKTUR.md 2.4, 5.8).
//!
//! Kandidaten sind eingebetteter Katalog, Cache und Remote. Gültig ist nur, was mit einem eingebetteten Schlüssel
//! signiert ist und das Schema erfüllt; gewählt wird die höchste `sequence`. Ein Remote-Katalog mit kleinerer
//! Sequenz als die höchste je gesehene wird als Rollback abgelehnt.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use arc_swap::ArcSwap;
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;
use url::Url;

use super::model::Catalog;
use super::validate::{CatalogWarning, validate};
use crate::api::{AppError, CatalogSourceKind, CatalogStatus, NetworkPurpose};
use crate::download::{HostPolicy, HttpClient, fetch_small};
use crate::error::{CatalogError, DownloadError, VerifyError};
use crate::platform::{AppDirs, fsx};
use crate::util::now_iso;
use crate::verify::{TrustedKeys, verify_minisign};

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/embedded.rs"));
}

pub use embedded::{EMBEDDED_CATALOG_JSON, EMBEDDED_CATALOG_SIG, EMBEDDED_KEYS};

/// Quellen des Katalogs, in dieser Reihenfolge (alle signiert, alle gleich vertrauenswürdig).
pub const CATALOG_URLS: &[&str] = &[
    "https://studio.cypherxcypher.de/catalog/v1/catalog.json",
    // aktiv erst bei öffentlichem Repository (A-07); bis dahin antwortet der Host mit 404
    "https://raw.githubusercontent.com/cypher-kollektiv/cypher-studio/main/catalog/catalog.json",
];

/// Größtes erlaubtes `catalog.json`.
pub const MAX_CATALOG_BYTES: u64 = 2 * 1024 * 1024;

/// Wie der Katalog in diese Sitzung kam.
#[derive(Debug, Clone)]
pub struct LoadedCatalog {
    pub catalog: Arc<Catalog>,
    pub source: CatalogSourceKind,
    pub sha256: [u8; 32],
    pub source_url: Option<String>,
    pub warnings: Vec<CatalogWarning>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RefreshOutcome {
    Unchanged,
    Updated { sequence: u64 },
}

impl TrustedKeys {
    /// Die in die Bibliothek eingebetteten Schlüssel (`catalog/keys/catalog-*.pub`).
    pub fn embedded() -> Result<Self, CatalogError> {
        Self::from_strs(EMBEDDED_KEYS).map_err(|e| CatalogError::Parse(e.to_string()))
    }
}

/// Prüft die Signatur und liest den Katalog. Größe ≤ [`MAX_CATALOG_BYTES`].
pub fn parse_and_verify(json: &[u8], minisig: &str, keys: &TrustedKeys) -> Result<Catalog, CatalogError> {
    if json.len() as u64 > MAX_CATALOG_BYTES {
        return Err(CatalogError::Parse("Katalog größer als erlaubt".into()));
    }
    verify_minisign(json, minisig, keys).map_err(|e| match e {
        VerifyError::KeyNotAllowed(id) => CatalogError::UnknownKey(id),
        other => CatalogError::Signature(other.to_string()),
    })?;
    serde_json::from_slice(json).map_err(|e| CatalogError::Parse(e.to_string()))
}

fn digest(json: &[u8]) -> [u8; 32] {
    Sha256::digest(json).into()
}

fn load(
    json: &[u8],
    minisig: &str,
    keys: &TrustedKeys,
    hosts: &HostPolicy,
    app_version: &semver::Version,
    source: CatalogSourceKind,
    source_url: Option<String>,
) -> Result<LoadedCatalog, CatalogError> {
    let catalog = parse_and_verify(json, minisig, keys)?;
    let warnings = validate(&catalog, hosts, app_version)?;
    Ok(LoadedCatalog { catalog: Arc::new(catalog), source, sha256: digest(json), source_url, warnings })
}

/// Der eingebettete Katalog, mit derselben Prüfung wie jeder andere.
pub fn embedded(
    keys: &TrustedKeys,
    hosts: &HostPolicy,
    app_version: &semver::Version,
) -> Result<LoadedCatalog, CatalogError> {
    load(EMBEDDED_CATALOG_JSON, EMBEDDED_CATALOG_SIG, keys, hosts, app_version, CatalogSourceKind::Embedded, None)
}

#[derive(Default)]
struct Meta {
    last_check_at: Option<String>,
    last_error: Option<AppError>,
}

pub struct CatalogStore {
    current: ArcSwap<LoadedCatalog>,
    cache_dir: PathBuf,
    keys: TrustedKeys,
    app_version: semver::Version,
    highest_seen: AtomicU64,
    meta: Mutex<Meta>,
}

impl CatalogStore {
    /// Startet mit dem besten gültigen Katalog aus eingebettet und Cache. `highest_seen` kommt aus `state.json`.
    pub fn load_startup(
        dirs: &AppDirs,
        keys: TrustedKeys,
        hosts: &HostPolicy,
        app_version: semver::Version,
        highest_seen: u64,
    ) -> Result<Self, CatalogError> {
        let embedded = embedded(&keys, hosts, &app_version)?;
        let cache_dir = dirs.catalog_cache();
        let cached = Self::read_cache(&cache_dir, &keys, hosts, &app_version);
        let best = match cached {
            Some(c) if c.catalog.sequence > embedded.catalog.sequence => c,
            _ => embedded,
        };
        let highest = highest_seen.max(best.catalog.sequence);
        Ok(CatalogStore {
            current: ArcSwap::from_pointee(best),
            cache_dir,
            keys,
            app_version,
            highest_seen: AtomicU64::new(highest),
            meta: Mutex::new(Meta::default()),
        })
    }

    fn read_cache(
        cache_dir: &std::path::Path,
        keys: &TrustedKeys,
        hosts: &HostPolicy,
        app: &semver::Version,
    ) -> Option<LoadedCatalog> {
        let json = std::fs::read(cache_dir.join("catalog.json")).ok()?;
        let sig = std::fs::read_to_string(cache_dir.join("catalog.json.minisig")).ok()?;
        match load(&json, &sig, keys, hosts, app, CatalogSourceKind::Cache, None) {
            Ok(c) => Some(c),
            Err(e) => {
                tracing::warn!("zwischengespeicherter Katalog ungültig und ignoriert: {e}");
                None
            }
        }
    }

    pub fn current(&self) -> Arc<LoadedCatalog> {
        self.current.load_full()
    }

    /// Höchste je gesehene Sequenz (in `state.json` festhalten).
    pub fn highest_seen(&self) -> u64 {
        self.highest_seen.load(Ordering::SeqCst)
    }

    /// Holt den Katalog von den Quellen (`urls`, in dieser Reihenfolge) und wechselt, wenn die Sequenz höher ist.
    ///
    /// Fehlerfälle: Netzwerk → nächste Quelle; Signatur/Schema → nächste Quelle; Rollback → abgelehnt, die
    /// bisherigen Kataloge bleiben aktiv. Sind alle Quellen gescheitert, kommt der aussagekräftigste Fehler zurück.
    pub async fn refresh_from(
        &self,
        http: &HttpClient,
        urls: &[Url],
        cancel: &CancellationToken,
    ) -> Result<RefreshOutcome, CatalogError> {
        let result = self.refresh_inner(http, urls, cancel).await;
        let mut meta = match self.meta.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        meta.last_check_at = Some(now_iso());
        meta.last_error = result.as_ref().err().map(crate::error::catalog_to_app);
        result
    }

    /// Wie [`refresh_from`](Self::refresh_from) mit den festen Quellen [`CATALOG_URLS`].
    pub async fn refresh(&self, http: &HttpClient, cancel: &CancellationToken) -> Result<RefreshOutcome, CatalogError> {
        let urls: Vec<Url> = CATALOG_URLS.iter().filter_map(|u| Url::parse(u).ok()).collect();
        self.refresh_from(http, &urls, cancel).await
    }

    async fn refresh_inner(
        &self,
        http: &HttpClient,
        urls: &[Url],
        cancel: &CancellationToken,
    ) -> Result<RefreshOutcome, CatalogError> {
        let mut best_error: Option<CatalogError> = None;
        for url in urls {
            if cancel.is_cancelled() {
                return Err(CatalogError::Download(DownloadError::Cancelled));
            }
            match self.try_url(http, url, cancel).await {
                Ok(outcome) => return Ok(outcome),
                Err(e) => {
                    tracing::info!("Katalogquelle {url} nicht nutzbar: {e}");
                    // Rollback und Inkompatibilität sind aussagekräftiger als Netzwerkfehler
                    let rank = |e: &CatalogError| match e {
                        CatalogError::Rollback { .. } => 3,
                        CatalogError::Incompatible { .. } => 3,
                        CatalogError::Signature(_) | CatalogError::UnknownKey(_) => 2,
                        CatalogError::Download(DownloadError::Cancelled) => 4,
                        _ => 1,
                    };
                    if best_error.as_ref().is_none_or(|b| rank(&e) > rank(b)) {
                        best_error = Some(e);
                    }
                    if matches!(best_error, Some(CatalogError::Download(DownloadError::Cancelled))) {
                        break;
                    }
                }
            }
        }
        Err(best_error.unwrap_or_else(|| CatalogError::Parse("keine Katalogquelle konfiguriert".into())))
    }

    async fn try_url(
        &self,
        http: &HttpClient,
        url: &Url,
        cancel: &CancellationToken,
    ) -> Result<RefreshOutcome, CatalogError> {
        let json = fetch_small(http, url, MAX_CATALOG_BYTES, NetworkPurpose::Catalog, cancel).await?;
        let sig_url = Url::parse(&format!("{url}.minisig")).map_err(|e| CatalogError::Parse(e.to_string()))?;
        let sig_bytes = fetch_small(http, &sig_url, 16 * 1024, NetworkPurpose::Catalog, cancel).await?;
        let sig = String::from_utf8(sig_bytes).map_err(|_| CatalogError::Signature("Signatur ist kein Text".into()))?;

        let loaded = load(
            &json,
            &sig,
            &self.keys,
            http.policy(),
            &self.app_version,
            CatalogSourceKind::Remote,
            Some(url.to_string()),
        )?;
        let offered = loaded.catalog.sequence;
        let highest = self.highest_seen.load(Ordering::SeqCst);
        if offered < highest {
            return Err(CatalogError::Rollback { current: highest, offered });
        }
        if offered == self.current().catalog.sequence {
            return Ok(RefreshOutcome::Unchanged);
        }
        // Cache zuerst (atomar je Datei), dann tauschen
        fsx::write_atomic(&self.cache_dir.join("catalog.json"), &json)?;
        fsx::write_atomic(&self.cache_dir.join("catalog.json.minisig"), sig.as_bytes())?;
        self.highest_seen.fetch_max(offered, Ordering::SeqCst);
        self.current.store(Arc::new(loaded));
        Ok(RefreshOutcome::Updated { sequence: offered })
    }

    /// Zustand für `catalog_status`.
    pub fn status(&self) -> CatalogStatus {
        let current = self.current();
        let c = &current.catalog;
        let meta = match self.meta.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        CatalogStatus {
            source_url: current.source_url.clone(),
            schema_version: c.schema_version,
            sequence: c.sequence,
            generated_at: c.generated_at.clone(),
            expires_at: c.expires_at.clone(),
            expired: current.warnings.iter().any(|w| matches!(w, CatalogWarning::Expired { .. })),
            source: current.source,
            last_check_at: meta.last_check_at.clone(),
            last_error: meta.last_error.clone(),
        }
    }
}
