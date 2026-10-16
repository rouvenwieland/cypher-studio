//! OpenPGP-Detached-Signaturen prüfen (`rPGP`, reines Rust, kein `gpg` nötig).
//!
//! Vertraut wird nur den im Katalog genannten Schlüsseln: Der Katalog liefert die öffentlichen Schlüssel (ASCII-Armor) und
//! die erlaubten Fingerabdrücke der Hauptschlüssel. Eine Signatur gilt, wenn sie mit dem Hauptschlüssel oder einem
//! seiner Unterschlüssel prüfbar ist und der Hauptschlüssel erlaubt ist. Widerrufe und Ablaufdaten der Schlüssel prüft
//! diese Funktion nicht (der Katalog ist signiert und wird mit der App ausgeliefert; ein Schlüsselwechsel läuft über ihn).

use std::fs::File;
use std::io::{BufReader, Cursor};
use std::path::Path;

use pgp::composed::{Deserializable, DetachedSignature, SignedPublicKey};
use pgp::types::{KeyDetails, VerifyingKey};

use crate::error::{IoError, VerifyError};

/// Welchen Schlüsseln beim Prüfen vertraut wird.
pub struct PgpTrust<'a> {
    pub public_keys_armored: &'a [String],
    pub allowed_fingerprints: &'a [String],
}

fn normalize(fingerprint: &str) -> String {
    fingerprint.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_uppercase()
}

fn sig_err(text: impl std::fmt::Display) -> VerifyError {
    VerifyError::Signature(text.to_string())
}

/// Prüft die Signatur mit genau einem Schlüssel; die Datei wird dabei gestreamt (kein Ganzes im Speicher).
fn try_key(sig: &DetachedSignature, key: &impl VerifyingKey, file: &Path) -> Result<(), String> {
    let f = File::open(file).map_err(|e| e.to_string())?;
    sig.signature.verify(key, BufReader::with_capacity(1 << 20, f)).map_err(|e| e.to_string())
}

/// Prüft `file` gegen die abgetrennte Signatur. Gibt den Fingerabdruck des (erlaubten) Hauptschlüssels zurück.
pub fn verify_pgp_detached(file: &Path, signature: &[u8], trust: &PgpTrust<'_>) -> Result<String, VerifyError> {
    if trust.allowed_fingerprints.is_empty() {
        return Err(VerifyError::KeyNotAllowed(
            "Für diese Signatur ist kein Fingerabdruck als vertrauenswürdig hinterlegt".into(),
        ));
    }
    if !file.is_file() {
        return Err(VerifyError::Io(IoError::read(file, std::io::Error::from(std::io::ErrorKind::NotFound))));
    }
    let allowed: Vec<String> = trust.allowed_fingerprints.iter().map(|f| normalize(f)).collect();
    let (sig, _) = DetachedSignature::from_reader_single(Cursor::new(signature))
        .map_err(|e| sig_err(format!("Signaturdatei nicht lesbar: {e}")))?;

    let mut last_error: Option<String> = None;
    let mut any_allowed_key = false;
    for armored in trust.public_keys_armored {
        let Ok((keys, _)) = SignedPublicKey::from_reader_many(Cursor::new(armored.as_bytes())) else {
            continue;
        };
        for key in keys.flatten() {
            let primary = normalize(&format!("{:X}", key.primary_key.fingerprint()));
            if !allowed.contains(&primary) {
                continue;
            }
            any_allowed_key = true;
            match try_key(&sig, &key.primary_key, file) {
                Ok(()) => return Ok(primary),
                Err(e) => last_error = Some(e),
            }
            for sub in &key.public_subkeys {
                match try_key(&sig, &sub.key, file) {
                    Ok(()) => return Ok(primary),
                    Err(e) => last_error = Some(e),
                }
            }
        }
    }
    if !any_allowed_key {
        return Err(VerifyError::KeyNotAllowed(
            "Keiner der hinterlegten öffentlichen Schlüssel passt zu den erlaubten Fingerabdrücken".into(),
        ));
    }
    Err(sig_err(format!(
        "Signatur passt nicht zur Datei oder stammt nicht von einem erlaubten Schlüssel ({})",
        last_error.unwrap_or_else(|| "unbekannter Fehler".into())
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use pgp::composed::{ArmorOptions, KeyType, SecretKeyParamsBuilder, SignedSecretKey};
    use pgp::crypto::hash::HashAlgorithm;
    use pgp::types::Password;
    use rand::SeedableRng;
    use rand_chacha::ChaCha20Rng;

    fn new_key(seed: u64, user: &str) -> SignedSecretKey {
        let mut rng = ChaCha20Rng::seed_from_u64(seed);
        let params = SecretKeyParamsBuilder::default()
            .key_type(KeyType::Ed25519Legacy)
            .can_sign(true)
            .primary_user_id(user.into())
            .build()
            .unwrap();
        params.generate(&mut rng).unwrap()
    }

    fn public_armored(key: &SignedSecretKey) -> String {
        key.to_public_key().to_armored_string(ArmorOptions::default()).unwrap()
    }

    fn fingerprint(key: &SignedSecretKey) -> String {
        format!("{:X}", key.primary_key.fingerprint())
    }

    fn sign(key: &SignedSecretKey, data: &[u8]) -> Vec<u8> {
        let rng = ChaCha20Rng::seed_from_u64(99);
        let sig =
            DetachedSignature::sign_binary_data(rng, &key.primary_key, &Password::empty(), HashAlgorithm::Sha256, data)
                .unwrap();
        sig.to_armored_bytes(ArmorOptions::default()).unwrap()
    }

    fn write(dir: &Path, name: &str, data: &[u8]) -> std::path::PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, data).unwrap();
        p
    }

    #[test]
    fn valid_signature_from_an_allowed_key_passes_and_returns_the_fingerprint() {
        let key = new_key(1, "Test Eins <eins@example.org>");
        let dir = tempfile::tempdir().unwrap();
        let data = b"AppImage-Inhalt".repeat(1000);
        let file = write(dir.path(), "app.AppImage", &data);
        let armored = [public_armored(&key)];
        let allowed = [fingerprint(&key)];
        let got = verify_pgp_detached(
            &file,
            &sign(&key, &data),
            &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed },
        )
        .unwrap();
        assert_eq!(got, fingerprint(&key));
    }

    #[test]
    fn fingerprint_notation_with_spaces_and_lowercase_is_accepted() {
        let key = new_key(2, "Zwei <zwei@example.org>");
        let dir = tempfile::tempdir().unwrap();
        let file = write(dir.path(), "f.bin", b"abc");
        let pretty = fingerprint(&key)
            .as_bytes()
            .chunks(4)
            .map(|c| std::str::from_utf8(c).unwrap().to_lowercase())
            .collect::<Vec<_>>()
            .join(" ");
        let armored = [public_armored(&key)];
        let allowed = [pretty];
        assert!(
            verify_pgp_detached(
                &file,
                &sign(&key, b"abc"),
                &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed },
            )
            .is_ok()
        );
    }

    #[test]
    fn manipulated_file_fails() {
        let key = new_key(3, "Drei <drei@example.org>");
        let dir = tempfile::tempdir().unwrap();
        let signature = sign(&key, b"original");
        let file = write(dir.path(), "f.bin", b"manipuliert");
        let armored = [public_armored(&key)];
        let allowed = [fingerprint(&key)];
        let e = verify_pgp_detached(
            &file,
            &signature,
            &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed },
        )
        .unwrap_err();
        assert!(matches!(e, VerifyError::Signature(_)), "{e}");
    }

    #[test]
    fn signature_from_an_unlisted_key_fails_even_if_the_key_is_supplied() {
        let trusted = new_key(4, "Vertraut <v@example.org>");
        let attacker = new_key(5, "Angreifer <a@example.org>");
        let dir = tempfile::tempdir().unwrap();
        let file = write(dir.path(), "f.bin", b"daten");
        let signature = sign(&attacker, b"daten");
        // Der Katalog nennt nur den vertrauten Schlüssel; der Angreifer legt seinen Schlüssel dazu
        let armored = [public_armored(&trusted), public_armored(&attacker)];
        let allowed = [fingerprint(&trusted)];
        let e = verify_pgp_detached(
            &file,
            &signature,
            &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed },
        )
        .unwrap_err();
        assert!(matches!(e, VerifyError::Signature(_)), "{e}");
        // und ohne den passenden Schlüssel erst recht
        let armored = [public_armored(&attacker)];
        assert!(
            verify_pgp_detached(
                &file,
                &signature,
                &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed },
            )
            .is_err()
        );
    }

    #[test]
    fn empty_trust_list_and_garbage_signature_are_errors() {
        let key = new_key(6, "Sechs <sechs@example.org>");
        let dir = tempfile::tempdir().unwrap();
        let file = write(dir.path(), "f.bin", b"x");
        let armored = [public_armored(&key)];
        let none: [String; 0] = [];
        assert!(
            verify_pgp_detached(
                &file,
                &sign(&key, b"x"),
                &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &none },
            )
            .is_err()
        );
        let allowed = [fingerprint(&key)];
        let e = verify_pgp_detached(
            &file,
            b"das ist keine Signatur",
            &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed },
        )
        .unwrap_err();
        assert!(matches!(e, VerifyError::Signature(_)));
        // fehlende Datei
        let e = verify_pgp_detached(
            &dir.path().join("fehlt"),
            &sign(&key, b"x"),
            &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed },
        )
        .unwrap_err();
        assert!(matches!(e, VerifyError::Io(_)), "{e}");
    }

    /// Echte Dateien aus der Linux-Probe (`scripts/probe-linux.sh` legt sie in `~/probe-dl`): Krita-AppImage mit dem
    /// Krita-Schlüssel. Nur mit `CYPHER_PROBE_DL=<ordner>` und `--ignored`.
    #[test]
    #[ignore = "braucht die heruntergeladene Krita-AppImage (CYPHER_PROBE_DL)"]
    fn real_krita_appimage_signature_verifies() {
        let Ok(dir) = std::env::var("CYPHER_PROBE_DL") else { return };
        let dir = std::path::PathBuf::from(dir);
        let key = std::fs::read_to_string(dir.join("key-E9FB29E74ADEACC5E3035B8AB69EB4CF7468332F.asc")).unwrap();
        let sig = std::fs::read(dir.join("krita-5.3.4.1-x86_64.AppImage.sig")).unwrap();
        let armored = [key];
        let allowed = ["E9FB29E74ADEACC5E3035B8AB69EB4CF7468332F".to_owned()];
        let got = verify_pgp_detached(
            &dir.join("krita-5.3.4.1-x86_64.AppImage"),
            &sig,
            &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed },
        )
        .unwrap();
        assert_eq!(got, "E9FB29E74ADEACC5E3035B8AB69EB4CF7468332F");
    }
}
