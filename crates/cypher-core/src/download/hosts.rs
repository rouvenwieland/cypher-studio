//! Eingebettete Hostliste (ARCHITEKTUR.md 4.2, 6.5). Der Katalog kann sie nicht erweitern.

use url::Url;

use crate::error::DownloadError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RedirectPolicy {
    /// Weiterleitungen nur auf Hosts der Liste.
    WithinAllowlist,
    /// Weiterleitung auf öffentliche Spiegel erlaubt (Spiegelverteiler wie `download.kde.org`), weil die SHA-256 aus
    /// dem signierten Katalog den Inhalt festnagelt. „Öffentlich“ heißt: `https`, Port 443, ein DNS-Name mit
    /// mindestens zwei Teilen und keine IP-Adresse, kein `localhost`, `.local`, `.internal` und ähnliche
    /// Namen ([`check_public_mirror`]); der DNS-Auflöser des Clients lehnt zusätzlich private Adressen ab.
    /// Prüfsummen und Signaturen kommen nie über Spiegel.
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
            // Nur im Test gegen den lokalen Server (`http` auf 127.0.0.1): dort gibt es keine echten Spiegel
            RedirectPolicy::AnyHttpsPinned if loopback => Ok(()),
            RedirectPolicy::AnyHttpsPinned => check_public_mirror(next),
            RedirectPolicy::WithinAllowlist => self.check(next).map(|_| ()),
        }
    }
}

/// Namensendungen, die nie ein öffentlicher Spiegel sind (lokale, private und reservierte Namensräume).
const NON_PUBLIC_SUFFIXES: &[&str] = &[
    "localhost",
    "local",
    "localdomain",
    "internal",
    "intranet",
    "corp",
    "lan",
    "home",
    "private",
    "test",
    "invalid",
    "example",
    "arpa",
    "onion",
];

fn is_dns_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 63
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Ist `url` ein möglicher öffentlicher Spiegel? Verlangt `https`, Port 443 (oder keinen), keine Zugangsdaten und einen
/// DNS-Namen mit mindestens zwei gültigen Teilen. IP-Adressen jeder Schreibweise (der URL-Parser macht aus `2130706433`
/// und `0x7f.1` ebenfalls Adressen), `localhost`, einteilige Namen, Namen mit abschließendem Punkt und die Endungen aus
/// [`NON_PUBLIC_SUFFIXES`] fallen durch. Zur Laufzeit lehnt der DNS-Auflöser des Clients außerdem Namen ab, die auf
/// private, Loopback- oder Link-Local-Adressen zeigen.
pub fn check_public_mirror(url: &Url) -> Result<(), DownloadError> {
    let shown = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let denied = || DownloadError::HostNotAllowed(shown.clone());
    if url.scheme() != "https" {
        return Err(DownloadError::InsecureUrl(redact(url)));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(DownloadError::InsecureUrl(redact(url)));
    }
    if url.port().is_some_and(|p| p != 443) {
        return Err(DownloadError::HostNotAllowed(format!("{shown}:{}", url.port().unwrap_or(0))));
    }
    let Some(url::Host::Domain(domain)) = url.host() else { return Err(denied()) };
    let domain = domain.to_ascii_lowercase();
    let labels: Vec<&str> = domain.split('.').collect();
    if labels.len() < 2 || !labels.iter().all(|l| is_dns_label(l)) {
        return Err(denied());
    }
    let tld = labels.last().copied().unwrap_or_default();
    // Die letzte Endung enthält einen Buchstaben (rein numerische Namen sind Adressen) und ist nicht reserviert
    if !tld.bytes().any(|b| b.is_ascii_lowercase()) || NON_PUBLIC_SUFFIXES.contains(&tld) {
        return Err(denied());
    }
    Ok(())
}

/// Ist die Adresse öffentlich erreichbar? Lehnt Loopback, private Netze, Link-Local, Carrier-NAT, Multicast, Dokumentations-
/// und reservierte Bereiche ab (IPv4 und IPv6, auch IPv4 in IPv6 verpackt).
pub fn is_public_ip(ip: std::net::IpAddr) -> bool {
    use std::net::{IpAddr, Ipv4Addr};
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, c, _] = v4.octets();
            !(v4.is_unspecified()
                || v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.is_documentation()
                || a == 0
                || a >= 240
                || (a == 100 && (64..=127).contains(&b)) // Carrier-NAT 100.64.0.0/10
                || (a == 192 && b == 0 && c == 0) // IETF-Protokollzuweisungen 192.0.0.0/24
                || (a == 198 && (b == 18 || b == 19))) // Messnetz 198.18.0.0/15
        }
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(mapped));
            }
            let seg = v6.segments();
            // NAT64 (64:ff9b::/96) trägt eine IPv4-Adresse in den letzten 32 Bit
            if seg[..6] == [0x64, 0xff9b, 0, 0, 0, 0] {
                let [hi, lo] = [seg[6].to_be_bytes(), seg[7].to_be_bytes()];
                return is_public_ip(IpAddr::V4(Ipv4Addr::new(hi[0], hi[1], lo[0], lo[1])));
            }
            !(v6.is_unspecified()
                || v6.is_loopback()
                || v6.is_multicast()
                || (seg[0] & 0xfe00) == 0xfc00 // eindeutig lokal fc00::/7
                || (seg[0] & 0xffc0) == 0xfe80 // Link-Local fe80::/10
                || (seg[0] & 0xffc0) == 0xfec0 // veraltetes Site-Local fec0::/10
                || (seg[0] == 0x2001 && seg[1] == 0x0db8) // Dokumentation 2001:db8::/32
                || (seg[0] == 0x0100 && seg[1] == 0 && seg[2] == 0 && seg[3] == 0)) // Verwerfen 100::/64
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
        assert!(p.check_redirect(&kde, &url("https://ftp.gwdg.de:443/y")).is_ok());
        assert!(p.check_redirect(&kde, &url("https://mirror.dotsrc.org/pub/y")).is_ok());
        assert!(p.check_redirect(&kde, &url("http://ftp.gwdg.de/y")).is_err());
        assert!(p.check_redirect(&kde, &url("https://u:p@ftp.gwdg.de/y")).is_err());
    }

    #[test]
    fn mirror_redirects_go_only_to_public_dns_names_on_port_443() {
        // Befund N1: bisher war jedes https-Ziel erlaubt, auch Adressen im Heimnetz
        let p = HostPolicy::embedded();
        let kde = *p.check(&url("https://download.kde.org/x")).unwrap();
        for bad in [
            "https://127.0.0.1/y",
            "https://127.0.0.1:8443/y",
            "https://localhost/y",
            "https://LOCALHOST/y",
            "https://foo.localhost/y",
            "https://192.168.1.1/y",
            "https://10.0.0.5/y",
            "https://169.254.169.254/latest/meta-data",
            "https://[::1]:9/y",
            "https://[::1]/y",
            "https://[fe80::1]/y",
            "https://[fd00::1]/y",
            "https://[::ffff:127.0.0.1]/y",
            "https://2130706433/y",
            "https://0x7f.1/y",
            "https://017700000001/y",
            "https://nas.local/y",
            "https://router.lan/y",
            "https://drucker.fritz.box.internal/y",
            "https://mirror/y",
            "https://ftp.gwdg.de./y",
            "https://ftp.gwdg.de:8443/y",
            "https://ftp.gwdg.de:80/y",
            "https://1.2.3.4/y",
            "https://8.8.8.8/y",
            "https://host.example/y",
            "https://x.in-addr.arpa/y",
            "https://abc.onion/y",
            "http://ftp.gwdg.de/y",
        ] {
            assert!(p.check_redirect(&kde, &url(bad)).is_err(), "{bad} darf kein Spiegel sein");
        }
        // Internationale Namen kommen als Punycode an und gelten als gewöhnliche Namen
        assert!(p.check_redirect(&kde, &url("https://mirror.m\u{fc}nchen.de/y")).is_ok());
    }

    #[test]
    fn public_ip_classification() {
        for private in [
            "0.0.0.0",
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.0.1",
            "169.254.1.1",
            "100.64.0.1",
            "100.127.255.255",
            "198.18.0.1",
            "192.0.0.8",
            "224.0.0.1",
            "255.255.255.255",
            "240.0.0.1",
            "::",
            "::1",
            "fe80::1",
            "fc00::1",
            "fd12:3456::1",
            "ff02::1",
            "2001:db8::1",
            "::ffff:10.0.0.1",
            "::ffff:127.0.0.1",
            "64:ff9b::7f00:1",
        ] {
            assert!(!is_public_ip(private.parse().unwrap()), "{private}");
        }
        for public in
            ["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]
        {
            assert!(is_public_ip(public.parse().unwrap()), "{public}");
        }
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
