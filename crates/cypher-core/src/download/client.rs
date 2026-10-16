//! HTTP-Client: rustls, Hostliste, eigene Weiterleitungsprüfung, Netzwerkprotokoll (ARCHITEKTUR.md 2.6, 6.8).

use std::collections::VecDeque;
use std::error::Error as StdError;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, Once};
use std::time::Duration;

use reqwest::header::HeaderMap;
use url::Url;

use super::hosts::HostPolicy;
use crate::api::{NetworkPurpose, NetworkRequestLog};
use crate::error::DownloadError;
use crate::platform::fsx;
use crate::util::now_iso;

const LOG_MAX: usize = 200;
const MAX_REDIRECTS: usize = 10;

/// Eine blockierte Weiterleitung (liegt als Ursache im `reqwest::Error`).
#[derive(Debug)]
struct BlockedRedirect(DownloadError);

impl std::fmt::Display for BlockedRedirect {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl StdError for BlockedRedirect {}

/// Ringpuffer der letzten Anfragen (Einstellungen → „Netzwerk und Daten“). Enthält nie Inhalte.
pub struct NetLog {
    entries: Mutex<VecDeque<NetworkRequestLog>>,
    file: Option<PathBuf>,
}

impl NetLog {
    pub fn new(file: Option<PathBuf>) -> Self {
        let entries: VecDeque<NetworkRequestLog> = file
            .as_deref()
            .and_then(|p| fsx::read_json::<Vec<NetworkRequestLog>>(p).ok().flatten())
            .unwrap_or_default()
            .into();
        NetLog { entries: Mutex::new(entries), file }
    }

    pub fn record(&self, host: &str, purpose: NetworkPurpose, status: Option<u16>, bytes: u64) {
        let mut entries = match self.entries.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        entries.push_back(NetworkRequestLog { at: now_iso(), host: host.to_owned(), purpose, status, bytes });
        while entries.len() > LOG_MAX {
            entries.pop_front();
        }
        if let Some(path) = &self.file {
            let all: Vec<&NetworkRequestLog> = entries.iter().collect();
            if let Err(e) = fsx::write_json_atomic(path, &all) {
                tracing::debug!("Netzwerkprotokoll nicht gespeichert: {e}");
            }
        }
    }

    /// Letzte Anfragen, älteste zuerst.
    pub fn recent(&self) -> Vec<NetworkRequestLog> {
        match self.entries.lock() {
            Ok(g) => g.iter().cloned().collect(),
            Err(p) => p.into_inner().iter().cloned().collect(),
        }
    }
}

fn install_crypto_provider() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        // Schlägt nur fehl, wenn schon ein Anbieter installiert ist (z. B. vom Updater-Plugin) – das ist in Ordnung.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

fn build(user_agent: &str, policy: &Arc<HostPolicy>, strict: bool) -> Result<reqwest::Client, DownloadError> {
    install_crypto_provider();
    let redirect_policy = {
        let policy = policy.clone();
        reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                let host = attempt.url().host_str().unwrap_or_default().to_owned();
                return attempt.error(BlockedRedirect(DownloadError::Network {
                    host,
                    message: "zu viele Weiterleitungen".into(),
                    retryable: false,
                }));
            }
            let Some(first) = attempt.previous().first() else { return attempt.follow() };
            let mut origin = match policy.check(first) {
                Ok(rule) => *rule,
                Err(e) => return attempt.error(BlockedRedirect(e)),
            };
            if strict {
                origin.redirects = super::hosts::RedirectPolicy::WithinAllowlist;
            }
            match policy.check_redirect(&origin, attempt.url()) {
                Ok(()) => attempt.follow(),
                Err(e) => attempt.error(BlockedRedirect(e)),
            }
        })
    };
    reqwest::Client::builder()
        .user_agent(user_agent)
        .https_only(!policy.allows_loopback_http())
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .redirect(redirect_policy)
        .build()
        .map_err(|e| DownloadError::Network { host: String::new(), message: e.to_string(), retryable: false })
}

/// HTTP-Client der App. Alle Netzwerkzugriffe laufen hierüber (Entscheidung L3).
#[derive(Clone)]
pub struct HttpClient {
    /// Für Programmdateien: Spiegel-Weiterleitung nach Regel des Ursprungs.
    pub(crate) artifacts: reqwest::Client,
    /// Für Prüfsummen, Signaturen, Katalog: Weiterleitungen immer nur innerhalb der Liste.
    pub(crate) strict: reqwest::Client,
    pub(crate) policy: Arc<HostPolicy>,
    pub(crate) log: Arc<NetLog>,
}

impl HttpClient {
    pub fn new(app_version: &str, policy: Arc<HostPolicy>, log: Arc<NetLog>) -> Result<Self, DownloadError> {
        let ua = format!("CypherStudio/{app_version}");
        Ok(HttpClient { artifacts: build(&ua, &policy, false)?, strict: build(&ua, &policy, true)?, policy, log })
    }

    /// Nur für Tests und die Linux-Probe: `http` gegen 127.0.0.1 erlaubt.
    #[cfg(any(test, feature = "test-util"))]
    pub fn for_test(hosts: &[super::hosts::HostRule]) -> Result<Self, DownloadError> {
        Self::new("test", Arc::new(HostPolicy::for_test(hosts)), Arc::new(NetLog::new(None)))
    }

    pub fn policy(&self) -> &Arc<HostPolicy> {
        &self.policy
    }

    pub fn log(&self) -> &Arc<NetLog> {
        &self.log
    }

    /// Sendet eine GET-Anfrage nach Hostprüfung. `strict` wählt den Client ohne Spiegel-Weiterleitung.
    pub(crate) async fn send_get(
        &self,
        url: &Url,
        headers: HeaderMap,
        strict: bool,
        purpose: NetworkPurpose,
    ) -> Result<reqwest::Response, DownloadError> {
        self.policy.check(url)?;
        let host = url.host_str().unwrap_or_default().to_owned();
        let client = if strict { &self.strict } else { &self.artifacts };
        match client.get(url.clone()).headers(headers).send().await {
            Ok(resp) => {
                self.log.record(&host, purpose, Some(resp.status().as_u16()), 0);
                Ok(resp)
            }
            Err(e) => {
                self.log.record(&host, purpose, None, 0);
                Err(map_error(&host, e))
            }
        }
    }
}

/// Übersetzt reqwest-Fehler: blockierte Weiterleitungen werden zu `HostNotAllowed`/`InsecureUrl`.
pub(crate) fn map_error(host: &str, e: reqwest::Error) -> DownloadError {
    let mut source: Option<&(dyn StdError + 'static)> = Some(&e);
    while let Some(err) = source {
        if let Some(blocked) = err.downcast_ref::<BlockedRedirect>() {
            return match &blocked.0 {
                DownloadError::HostNotAllowed(h) => DownloadError::HostNotAllowed(h.clone()),
                DownloadError::InsecureUrl(u) => DownloadError::InsecureUrl(u.clone()),
                DownloadError::Network { host, message, retryable } => {
                    DownloadError::Network { host: host.clone(), message: message.clone(), retryable: *retryable }
                }
                _ => DownloadError::HostNotAllowed(host.to_owned()),
            };
        }
        source = err.source();
    }
    let retryable = e.is_timeout() || e.is_connect() || e.is_body() || e.is_request() || e.is_decode();
    let message = {
        let mut text = e.to_string();
        let mut src = e.source();
        while let Some(s) = src {
            text.push_str(": ");
            text.push_str(&s.to_string());
            src = s.source();
        }
        text
    };
    DownloadError::Network { host: host.to_owned(), message, retryable }
}
