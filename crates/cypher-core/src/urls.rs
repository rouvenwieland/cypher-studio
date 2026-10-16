//! URLs der eigenen Protokolle `cyfile`, `cythumb`, `cyasset` (ARCHITEKTUR.md 6.3).
//!
//! WebView2 (Windows) und Android liefern eigene Protokolle als `http://<schema>.localhost/…` aus; macOS und Linux als
//! `<schema>://localhost/…`. Das Frontend benutzt die fertige URL unverändert.

/// `true`, wenn das Betriebssystem eigene Schemata über `http://<schema>.localhost` abbildet.
pub const fn uses_http_scheme_mapping() -> bool {
    cfg!(any(windows, target_os = "android"))
}

/// Prozentkodierung für einen Pfad (Schrägstriche bleiben, `[A-Za-z0-9-._~]` bleiben).
pub fn encode_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for b in path.trim_start_matches('/').bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// URL für `scheme` (`cyfile`, `cythumb`, `cyasset`) und `path` für das laufende Betriebssystem.
pub fn url(scheme: &str, path: &str) -> String {
    url_for(uses_http_scheme_mapping(), scheme, path)
}

/// Wie [`url`] mit ausdrücklicher Wahl der Abbildung (testbar).
pub fn url_for(http_mapping: bool, scheme: &str, path: &str) -> String {
    let encoded = encode_path(path);
    if http_mapping {
        format!("http://{scheme}.localhost/{encoded}")
    } else {
        format!("{scheme}://localhost/{encoded}")
    }
}

/// Zerlegt eine Anfrage-URL der eigenen Protokolle in den dekodierten Pfad (ohne führenden `/`). `None` bei ungültiger Kodierung.
pub fn decode_request_path(uri_path: &str) -> Option<String> {
    let raw = uri_path.trim_start_matches('/');
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hex = raw.get(i + 1..i + 3)?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_per_mapping() {
        assert_eq!(url_for(false, "cyasset", "shared/fonts/a b.ttf"), "cyasset://localhost/shared/fonts/a%20b.ttf");
        assert_eq!(url_for(true, "cyfile", "abc"), "http://cyfile.localhost/abc");
        assert_eq!(url_for(false, "cythumb", "/x"), "cythumb://localhost/x");
    }

    #[test]
    fn encode_and_decode_round_trip() {
        for p in ["a/b c/ä.png", "„Zitat“ (1).png", "x%y", "plain/path.svg"] {
            let enc = encode_path(p);
            assert!(!enc.contains(' ') && !enc.contains('„'));
            assert_eq!(decode_request_path(&enc).as_deref(), Some(p));
        }
    }

    #[test]
    fn invalid_escapes_are_rejected() {
        assert_eq!(decode_request_path("%zz"), None);
        assert_eq!(decode_request_path("%4"), None);
        assert_eq!(decode_request_path("%ff%fe"), None, "kein gültiges UTF-8");
    }
}
