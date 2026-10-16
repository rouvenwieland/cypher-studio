//! `verify` – Prüfsummen und Signaturen (ARCHITEKTUR.md 2.5).
//!
//! SHA-256 ist Pflicht und stammt aus dem signierten Katalog. Die minisign-Prüfung schützt Katalog und
//! Modelle; die OpenPGP-Prüfung (rPGP) kommt zusätzlich, wenn das Upstream-Projekt signiert.

mod pgp_verify;

use std::fs::File;
use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

use crate::api::IoOp;
use crate::error::{IoError, VerifyError};

pub use pgp_verify::{PgpTrust, verify_pgp_detached};

/// Puffergröße beim Lesen großer Dateien.
const BUFFER: usize = 1024 * 1024;

/// Streaming-SHA-256.
#[derive(Default)]
pub struct Sha256Stream(Sha256);

impl Sha256Stream {
    pub fn new() -> Self {
        Sha256Stream(Sha256::new())
    }

    pub fn update(&mut self, bytes: &[u8]) {
        self.0.update(bytes);
    }

    pub fn finalize(self) -> [u8; 32] {
        self.0.finalize().into()
    }
}

/// SHA-256 einer Datei, mit Abbruchprüfung nach jedem Megabyte.
pub fn sha256_file(path: &Path, cancel: &CancellationToken) -> Result<[u8; 32], VerifyError> {
    let mut file = File::open(path).map_err(|e| IoError::read(path, e))?;
    let mut hasher = Sha256Stream::new();
    let mut buf = vec![0u8; BUFFER];
    loop {
        if cancel.is_cancelled() {
            return Err(VerifyError::Cancelled);
        }
        let n = file.read(&mut buf).map_err(|e| IoError::read(path, e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize())
}

pub fn sha256_bytes(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

pub fn to_hex(digest: &[u8; 32]) -> String {
    hex::encode(digest)
}

/// Vergleicht eine berechnete mit einer erwarteten Prüfsumme (Hex, Groß-/Kleinschreibung egal).
pub fn expect_sha256(actual: &[u8; 32], expected_hex: &str, file: &str) -> Result<(), VerifyError> {
    let actual_hex = to_hex(actual);
    if actual_hex.eq_ignore_ascii_case(expected_hex.trim()) {
        Ok(())
    } else {
        Err(VerifyError::ChecksumMismatch {
            file: file.to_owned(),
            expected: expected_hex.trim().to_ascii_lowercase(),
            actual: actual_hex,
        })
    }
}

/// Liest eine Prüfsummendatei im `sha256sum`-Format (`<hash>  <name>` oder `<hash> *<name>`) und liefert den Hash
/// zur gesuchten Datei. Eine Datei mit nur einem Hash (ohne Namen) gilt für `file_name`.
pub fn find_in_sha256sums(text: &str, file_name: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.splitn(2, char::is_whitespace);
        let hash = parts.next()?.trim();
        let name = parts.next().map(|n| n.trim().trim_start_matches('*').trim());
        if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            continue;
        }
        match name {
            None | Some("") => return Some(hash.to_ascii_lowercase()),
            Some(n) if n == file_name || n.rsplit(['/', '\\']).next() == Some(file_name) => {
                return Some(hash.to_ascii_lowercase());
            }
            _ => {}
        }
    }
    None
}

// ---------------------------------------------------------------------------------------------
// minisign
// ---------------------------------------------------------------------------------------------

/// Schlüssel-ID einer minisign-Signatur oder eines öffentlichen Schlüssels (16 Hex-Zeichen, wie `minisign -V` sie zeigt).
pub type KeyId = String;

struct TrustedKey {
    id: KeyId,
    key: minisign_verify::PublicKey,
}

/// Die der App bekannten öffentlichen Schlüssel (aktiv + Reserve).
pub struct TrustedKeys {
    keys: Vec<TrustedKey>,
}

/// Fehler beim Lesen eines Schlüssels.
#[derive(Debug, thiserror::Error)]
#[error("ungültiger Schlüssel: {0}")]
pub struct KeyParseError(pub String);

fn key_id_from_base64(b64: &str) -> Option<KeyId> {
    use base64::Engine;
    let raw = base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok()?;
    // 2 Byte Algorithmus, 8 Byte Schlüssel-ID (little endian), dann der Schlüssel bzw. die Signatur
    let id = raw.get(2..10)?;
    Some(id.iter().rev().map(|b| format!("{b:02X}")).collect())
}

impl TrustedKeys {
    pub fn from_strs(keys: &[&str]) -> Result<Self, KeyParseError> {
        let mut out = Vec::new();
        for text in keys {
            let text = text.trim();
            let (key, b64) = if text.contains('\n') || text.starts_with("untrusted comment") {
                let b64 = text
                    .lines()
                    .map(str::trim)
                    .find(|l| !l.is_empty() && !l.starts_with("untrusted comment"))
                    .ok_or_else(|| KeyParseError("leer".into()))?;
                (minisign_verify::PublicKey::decode(text), b64.to_owned())
            } else {
                (minisign_verify::PublicKey::from_base64(text), text.to_owned())
            };
            let key = key.map_err(|e| KeyParseError(e.to_string()))?;
            let id = key_id_from_base64(&b64).ok_or_else(|| KeyParseError("Schlüssel-ID nicht lesbar".into()))?;
            out.push(TrustedKey { id, key });
        }
        Ok(TrustedKeys { keys: out })
    }

    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    pub fn ids(&self) -> Vec<KeyId> {
        self.keys.iter().map(|k| k.id.clone()).collect()
    }

    /// Findet den Schlüssel zur ID in der Signatur.
    fn for_signature(&self, minisig: &str) -> Result<(&TrustedKey, minisign_verify::Signature), VerifyError> {
        let signature =
            minisign_verify::Signature::decode(minisig).map_err(|e| VerifyError::Signature(format!("{e}")))?;
        // Zeile 2 der Signatur trägt die Schlüssel-ID
        let sig_line = minisig
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty() && !l.starts_with("untrusted comment") && !l.starts_with("trusted comment"))
            .ok_or_else(|| VerifyError::Signature("Signatur leer".into()))?;
        let id = key_id_from_base64(sig_line).ok_or_else(|| VerifyError::Signature("Schlüssel-ID fehlt".into()))?;
        match self.keys.iter().find(|k| k.id == id) {
            Some(k) => Ok((k, signature)),
            None => Err(VerifyError::KeyNotAllowed(id)),
        }
    }
}

/// Prüft eine minisign-Signatur über `data` gegen die vertrauten Schlüssel; liefert die Schlüssel-ID.
pub fn verify_minisign(data: &[u8], minisig: &str, keys: &TrustedKeys) -> Result<KeyId, VerifyError> {
    let (key, signature) = keys.for_signature(minisig)?;
    key.key.verify(data, &signature, true).map_err(|e| VerifyError::Signature(format!("{e}")))?;
    Ok(key.id.clone())
}

/// Wie [`verify_minisign`], aber streamend für große Dateien (nur vorgehashte Signaturen).
pub fn verify_minisign_file(
    path: &Path,
    minisig: &str,
    keys: &TrustedKeys,
    cancel: &CancellationToken,
) -> Result<KeyId, VerifyError> {
    let (key, signature) = keys.for_signature(minisig)?;
    let mut verifier = key.key.verify_stream(&signature).map_err(|e| VerifyError::Signature(format!("{e}")))?;
    let mut file = File::open(path).map_err(|e| IoError::new(IoOp::Read, path, e))?;
    let mut buf = vec![0u8; BUFFER];
    loop {
        if cancel.is_cancelled() {
            return Err(VerifyError::Cancelled);
        }
        let n = file.read(&mut buf).map_err(|e| IoError::read(path, e))?;
        if n == 0 {
            break;
        }
        verifier.update(&buf[..n]);
    }
    verifier.finalize().map_err(|e| VerifyError::Signature(format!("{e}")))?;
    Ok(key.id.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    #[test]
    fn sha256_known_vectors() {
        assert_eq!(hex::encode(sha256_bytes(b"abc")), ABC);
        assert_eq!(hex::encode(sha256_bytes(b"")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        let mut s = Sha256Stream::new();
        s.update(b"a");
        s.update(b"bc");
        assert_eq!(hex::encode(s.finalize()), ABC);
    }

    #[test]
    fn sha256_file_hashes_and_can_be_cancelled() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.bin");
        std::fs::write(&path, b"abc").unwrap();
        let cancel = CancellationToken::new();
        assert_eq!(hex::encode(sha256_file(&path, &cancel).unwrap()), ABC);
        cancel.cancel();
        assert!(matches!(sha256_file(&path, &cancel), Err(VerifyError::Cancelled)));
        assert!(matches!(sha256_file(&dir.path().join("fehlt"), &CancellationToken::new()), Err(VerifyError::Io(_))));
    }

    #[test]
    fn expect_sha256_reports_both_values() {
        let digest = sha256_bytes(b"abc");
        expect_sha256(&digest, &ABC.to_ascii_uppercase(), "a.zip").unwrap();
        match expect_sha256(&digest, &"0".repeat(64), "a.zip") {
            Err(VerifyError::ChecksumMismatch { file, expected, actual }) => {
                assert_eq!(file, "a.zip");
                assert_eq!(expected, "0".repeat(64));
                assert_eq!(actual, ABC);
            }
            other => panic!("erwartet ChecksumMismatch, erhalten {other:?}"),
        }
    }

    #[test]
    fn sha256sums_parsing() {
        let text = format!(
            "# Kommentar\n{a}  blender-5.2.2-linux-x64.tar.xz\n{b} *blender-5.2.2-windows-x64.zip\n\n{c}  sub/dir/x.dmg\n",
            a = "a".repeat(64),
            b = "b".repeat(64),
            c = "c".repeat(64)
        );
        assert_eq!(find_in_sha256sums(&text, "blender-5.2.2-linux-x64.tar.xz").unwrap(), "a".repeat(64));
        assert_eq!(find_in_sha256sums(&text, "blender-5.2.2-windows-x64.zip").unwrap(), "b".repeat(64));
        assert_eq!(find_in_sha256sums(&text, "x.dmg").unwrap(), "c".repeat(64));
        assert!(find_in_sha256sums(&text, "gibt-es-nicht.zip").is_none());
        // Datei mit nur einem Hash (KDE-Stil ohne Dateinamen)
        assert_eq!(find_in_sha256sums(&"d".repeat(64), "irgendwas").unwrap(), "d".repeat(64));
    }

    /// Erzeugt im Test ein Schlüsselpaar (nie eingecheckt) und signiert `data`.
    fn signed(data: &[u8], comment: &str) -> (TrustedKeys, String, minisign::KeyPair) {
        let pair = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
        let sig = minisign::sign(Some(&pair.pk), &pair.sk, Cursor::new(data), Some(comment), None).unwrap();
        let keys = TrustedKeys::from_strs(&[&pair.pk.to_box().unwrap().to_string()]).unwrap();
        (keys, sig.to_string(), pair)
    }

    #[test]
    fn minisign_accepts_a_valid_signature_and_reports_the_key_id() {
        let (keys, sig, _) = signed(b"katalog", "cypher-catalog seq=1");
        let id = verify_minisign(b"katalog", &sig, &keys).unwrap();
        assert_eq!(id.len(), 16);
        assert_eq!(keys.ids(), vec![id]);
    }

    #[test]
    fn minisign_rejects_tampered_data_wrong_key_and_garbage() {
        let (keys, sig, _) = signed(b"katalog", "x");
        assert!(matches!(verify_minisign(b"katalog!", &sig, &keys), Err(VerifyError::Signature(_))));
        let (other_keys, _, _) = signed(b"x", "x");
        assert!(matches!(verify_minisign(b"katalog", &sig, &other_keys), Err(VerifyError::KeyNotAllowed(_))));
        assert!(matches!(verify_minisign(b"katalog", "Unsinn", &keys), Err(VerifyError::Signature(_))));
    }

    #[test]
    fn minisign_streaming_matches_in_memory() {
        let dir = tempfile::tempdir().unwrap();
        let data = vec![7u8; 3 * BUFFER + 11];
        let (keys, sig, _) = signed(&data, "gross");
        let path = dir.path().join("gross.bin");
        std::fs::write(&path, &data).unwrap();
        let token = CancellationToken::new();
        assert!(verify_minisign_file(&path, &sig, &keys, &token).is_ok());
        std::fs::write(&path, [&data[..], b"x"].concat()).unwrap();
        assert!(matches!(verify_minisign_file(&path, &sig, &keys, &token), Err(VerifyError::Signature(_))));
    }

    #[test]
    fn keys_can_be_given_as_pub_file_or_bare_base64() {
        let pair = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
        let file_text = pair.pk.to_box().unwrap().to_string();
        let bare = file_text.lines().nth(1).unwrap().to_owned();
        let a = TrustedKeys::from_strs(&[&file_text]).unwrap();
        let b = TrustedKeys::from_strs(&[&bare]).unwrap();
        assert_eq!(a.ids(), b.ids());
        assert!(TrustedKeys::from_strs(&["kein schlüssel"]).is_err());
    }
}
