//! Eingebettete Hostliste (ARCHITEKTUR.md 4.2, 6.5). Der Katalog kann sie nicht erweitern.

use url::Url;

use crate::error::DownloadError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RedirectPolicy {
    /// Weiterleitungen nur auf Hosts der Liste.
    WithinAllowlist,
    /// Weiterleitung auf beliebige `https`-Hosts erlaubt (Spiegelverteiler wie `download.kde.org`), weil die
    /// SHA-256 aus dem signierten Katalog den Inhalt festnagelt. Prüfsummen und Signaturen kommen nie über Spiegel.
    AnyHttpsPinned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostRule {
    pub host: &'static str,
    pub redirects: RedirectPolicy,
}

/// Erlaubte Download-Hosts (A-05, durch programme.md bestätigt).
pub const EMBEDDED_HOSTS: &[HostRule] = &[
    HostRule { host: "download.blender.org", redirects: RedirectPolicy::WithinAllowlist },
    // Spiegelverteiler (Mirrorbits): 302 auf wechselnde Spiegel
    HostRule { host: "download.kde.org", redirects: RedirectPolicy::AnyHttpsPinned },
    // optional (A-10), Verhalten prüfen
    HostRule { host: "download.gimp.org", redirects: RedirectPolicy::AnyHttpsPinned },
    HostRule { host: "inkscape.org", redirects: RedirectPolicy::WithinAllowlist },
    HostRule { host: "media.inkscape.org", redirects: RedirectPolicy::WithinAllowlist },
    HostRule { host: "github.com", redirects: RedirectPolicy::WithinAllowlist },
    HostRule { host: "objects.githubusercontent.com", redirects: RedirectPolicy::WithinAllowlist },
    HostRule { host: "release-assets.githubusercontent.com", redirects: RedirectPolicy::WithinAllowlist },
    HostRule { host: "studio.cypherxcypher.de", redirects: RedirectPolicy::WithinAllowlist },
    HostRule { host: "raw.githubusercontent.com", redirects: RedirectPolicy::WithinAllowlist },
];

#[derive(Debug, Clone)]
pub struct HostPolicy {
    rules: Vec<HostRule>,
    /// Nur Tests: `http` gegen diese Hosts (127.0.0.1) mit beliebigem Port erlauben.
    loopback_http: bool,
}

impl HostPolicy {
    pub fn embedded() -> Self {
        HostPolicy { rules: EMBEDDED_HOSTS.to_vec(), loopback_http: false }
    }

    /// Nur für Tests und die Linux-Probe: erlaubt `http` gegen `127.0.0.1` und die gegebenen Hosts.
    #[cfg(any(test, feature = "test-util"))]
    pub fn for_test(hosts: &[HostRule]) -> Self {
        HostPolicy { rules: hosts.to_vec(), loopback_http: true }
    }

    pub fn rules(&self) -> &[HostRule] {
        &self.rules
    }

    /// `true` nur in Tests: `http` gegen 127.0.0.1 ist erlaubt.
    pub fn allows_loopback_http(&self) -> bool {
        self.loopback_http
    }

    fn is_loopback_test(&self, url: &Url) -> bool {
        self.loopback_http && url.scheme() == "http" && url.host_str() == Some("127.0.0.1")
    }

    /// Prüft eine Adresse: `https`, Port 443, kein Benutzername/Passwort, Host exakt in der Liste.
    pub fn check(&self, url: &Url) -> Result<&HostRule, DownloadError> {
        let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
        let loopback = self.is_loopback_test(url);
        if url.scheme() != "https" && !loopback {
            return Err(DownloadError::InsecureUrl(redact(url)));
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err(DownloadError::InsecureUrl(redact(url)));
        }
        if !loopback && url.port().is_some_and(|p| p != 443) {
            return Err(DownloadError::HostNotAllowed(format!("{host}:{}", url.port().unwrap_or(0))));
        }
        self.rules.iter().find(|r| r.host == host).ok_or(DownloadError::HostNotAllowed(host))
    }

    /// Prüft eine Weiterleitung von einem Ursprung mit der Regel `origin`.
    pub fn check_redirect(&self, origin: &HostRule, next: &Url) -> Result<(), DownloadError> {
        let loopback = self.is_loopback_test(next);
        if next.scheme() != "https" && !loopback {
            return Err(DownloadError::InsecureUrl(redact(next)));
        }
        if !next.username().is_empty() || next.password().is_some() {
            return Err(DownloadError::InsecureUrl(redact(next)));
        }
        match origin.redirects {
            RedirectPolicy::AnyHttpsPinned => Ok(()),
            RedirectPolicy::WithinAllowlist => self.check(next).map(|_| ()),
        }
    }
}

/// Adresse ohne Zugangsdaten für Fehlermeldungen.
fn redact(url: &Url) -> String {
    let mut u = url.clone();
    let _ = u.set_username("");
    let _ = u.set_password(None);
    u.set_query(None);
    u.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn embedded_policy_accepts_exact_https_hosts() {
        let p = HostPolicy::embedded();
        assert!(p.check(&url("https://download.blender.org/release/Blender5.2/x.zip")).is_ok());
        assert!(p.check(&url("https://DOWNLOAD.KDE.ORG/stable/krita/x")).is_ok());
        assert!(p.check(&url("https://download.kde.org:443/x")).is_ok());
    }

    #[test]
    fn embedded_policy_rejects_everything_else() {
        let p = HostPolicy::embedded();
        assert!(matches!(p.check(&url("http://download.blender.org/x")), Err(DownloadError::InsecureUrl(_))));
        assert!(matches!(p.check(&url("https://evil.example/x")), Err(DownloadError::HostNotAllowed(_))));
        // Wildcards und Unterdomänen sind nicht erlaubt
        assert!(matches!(
            p.check(&url("https://mirror.download.blender.org/x")),
            Err(DownloadError::HostNotAllowed(_))
        ));
        assert!(matches!(
            p.check(&url("https://download.blender.org.evil.example/x")),
            Err(DownloadError::HostNotAllowed(_))
        ));
        assert!(matches!(p.check(&url("https://download.blender.org:8443/x")), Err(DownloadError::HostNotAllowed(_))));
        assert!(matches!(p.check(&url("https://user:pw@download.blender.org/x")), Err(DownloadError::InsecureUrl(_))));
        assert!(matches!(p.check(&url("http://127.0.0.1:8080/x")), Err(DownloadError::InsecureUrl(_))));
    }

    #[test]
    fn redirect_rules_follow_the_origin_rule() {
        let p = HostPolicy::embedded();
        let blender = *p.check(&url("https://download.blender.org/x")).unwrap();
        let kde = *p.check(&url("https://download.kde.org/x")).unwrap();
        // Blender darf nur innerhalb der Liste weiterleiten
        assert!(p.check_redirect(&blender, &url("https://media.inkscape.org/y")).is_ok());
        assert!(p.check_redirect(&blender, &url("https://mirror.dotsrc.org/y")).is_err());
        // KDE darf auf Spiegel, aber nur per https
        assert!(p.check_redirect(&kde, &url("https://ftp.gwdg.de/y")).is_ok());
        assert!(p.check_redirect(&kde, &url("http://ftp.gwdg.de/y")).is_err());
        assert!(p.check_redirect(&kde, &url("https://u:p@ftp.gwdg.de/y")).is_err());
    }

    #[test]
    fn every_embedded_host_is_lowercase_and_unique() {
        let mut seen = std::collections::BTreeSet::new();
        for rule in EMBEDDED_HOSTS {
            assert_eq!(rule.host, rule.host.to_ascii_lowercase());
            assert!(seen.insert(rule.host), "doppelt: {}", rule.host);
        }
    }
}
