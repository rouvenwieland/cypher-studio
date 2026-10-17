//! Kleine Hilfen: Zeitstempel, IDs.

use std::time::Duration;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

/// Jetzt als RFC 3339 (UTC), z. B. `2026-10-16T18:30:00Z`.
pub fn now_iso() -> String {
    to_iso(OffsetDateTime::now_utc())
}

/// Jetzt plus `after` als RFC 3339.
pub fn iso_after(after: Duration) -> String {
    to_iso(OffsetDateTime::now_utc() + after)
}

/// Formatiert auf ganze Sekunden, immer mit `Z`.
pub fn to_iso(t: OffsetDateTime) -> String {
    let t = t.to_offset(time::UtcOffset::UTC).replace_nanosecond(0).unwrap_or(t);
    t.format(&Rfc3339).unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

/// Liest RFC 3339; `None` bei ungültigem Text.
pub fn parse_iso(text: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(text, &Rfc3339).ok()
}

/// Wurzel des Repositories, nur für Tests. Beim Cross-Build für Windows (`cargo xwin` in der WSL) steht in
/// `CARGO_MANIFEST_DIR` ein Linux-Pfad (`/mnt/c/...`); dann zeigt `CYPHER_TEST_REPO` auf den Windows-Pfad.
#[cfg(any(test, feature = "test-util"))]
pub fn repo_root() -> std::path::PathBuf {
    match std::env::var_os("CYPHER_TEST_REPO") {
        Some(root) => std::path::PathBuf::from(root),
        None => std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."),
    }
}

/// Neue zufällige ID (UUID v4, klein geschrieben).
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Kurzer, stabiler Hash-Text (erste 12 Hex-Zeichen von SHA-256) für IDs aus Pfaden o. Ä.
pub fn short_hash(text: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(text.as_bytes());
    hex::encode(digest)[..12].to_owned()
}

/// SHA-256 einer Datei als Hex (gestreamt, 1 MiB Puffer).
pub fn sha256_file_hex(path: &std::path::Path) -> std::io::Result<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Bytes lesbar für Logs und Fehlertexte (1024er-Schritte).
pub fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 { format!("{bytes} B") } else { format!("{value:.1} {}", UNITS[unit]) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_round_trip_and_format() {
        let now = now_iso();
        assert!(now.ends_with('Z'), "{now}");
        assert!(parse_iso(&now).is_some());
        assert_eq!(to_iso(parse_iso("2026-10-16T18:30:00.123+02:00").unwrap()), "2026-10-16T16:30:00Z");
    }

    #[test]
    fn short_hash_is_stable() {
        assert_eq!(short_hash("abc"), "ba7816bf8f01");
    }

    #[test]
    fn human_bytes_scales() {
        assert_eq!(human_bytes(512), "512 B");
        assert_eq!(human_bytes(404_453_484), "385.7 MB");
    }
}
