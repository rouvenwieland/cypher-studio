//! OpenPGP-Detached-Signaturen prüfen (`rPGP`, reines Rust, kein `gpg` nötig).
//!
//! Vertraut wird nur den im Katalog genannten Schlüsseln: Der Katalog liefert die öffentlichen Schlüssel (ASCII-Armor) und
//! die erlaubten Fingerabdrücke der Hauptschlüssel. Eine Signatur gilt, wenn sie mit dem Hauptschlüssel oder einem
//! seiner Unterschlüssel prüfbar ist und der Hauptschlüssel erlaubt ist.
//!
//! Zusätzlich (Befund N4): Signaturen mit schwachem Hash (MD5, SHA-1, RIPEMD-160, SHA-224) werden abgelehnt, außer der
//! Aufrufer erlaubt die dokumentierte Ausnahme (`allow_weak_hash`, nur bei einer von Cypher festgenagelten SHA-256, die den
//! Inhalt ohnehin sichert). Ein widerrufener Schlüssel gilt nie, ein Schlüssel nur, wenn er zum Zeitpunkt der Signatur noch
//! nicht abgelaufen war. Die Schlüssel stammen aus dem signierten Katalog; der Katalogbau soll dieselben Prüfungen mit
//! [`check_key_validity`] vorab machen.

use std::fs::File;
use std::io::{BufReader, Cursor};
use std::path::Path;
use std::time::{Duration, SystemTime};

use pgp::composed::{Deserializable, DetachedSignature, SignedPublicKey, SignedPublicSubKey};
use pgp::crypto::hash::HashAlgorithm;
use pgp::packet::{Signature, SignatureType};
use pgp::types::{KeyDetails, VerifyingKey};

use crate::error::{IoError, VerifyError};

/// Welchen Schlüsseln beim Prüfen vertraut wird.
pub struct PgpTrust<'a> {
    pub public_keys_armored: &'a [String],
    pub allowed_fingerprints: &'a [String],
    /// Dokumentierte Ausnahme: auch Signaturen mit SHA-1/MD5 gelten. Nur setzen, wenn die SHA-256 aus dem Katalog von
    /// Cypher festgenagelt ist (`checksumOrigin: cypherPinned`); dann ist die Signatur eine Zugabe, nicht der Anker.
    pub allow_weak_hash: bool,
}

/// Stark genug für eine Signatur: SHA-256, SHA-384, SHA-512, SHA3-256, SHA3-512.
fn is_strong_hash(hash: HashAlgorithm) -> bool {
    matches!(
        hash,
        HashAlgorithm::Sha256
            | HashAlgorithm::Sha384
            | HashAlgorithm::Sha512
            | HashAlgorithm::Sha3_256
            | HashAlgorithm::Sha3_512
    )
}

/// Fehler, wenn der Hash der Signatur nicht erlaubt ist (schwach, fehlend oder unbekannt), sonst `None`.
fn hash_policy_error(hash: Option<HashAlgorithm>, allow_weak: bool) -> Option<VerifyError> {
    if allow_weak || hash.is_some_and(is_strong_hash) {
        return None;
    }
    Some(sig_err(format!(
        "Die Signatur nutzt den Hash {} (zu schwach; erlaubt sind SHA-256 und stärker)",
        hash.map_or_else(|| "unbekannt".to_owned(), |h| h.to_string())
    )))
}

/// Gültigkeit eines Schlüssels (Haupt- oder Unterschlüssel) nach seinen eigenen Signaturen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyValidity {
    /// Eine Widerrufssignatur liegt im Schlüsselblock (jede zählt; der Block stammt aus dem signierten Katalog).
    pub revoked: bool,
    /// Ende der Gültigkeit, wenn die jüngste Eigensignatur eines setzt.
    pub expires_at: Option<SystemTime>,
}

impl KeyValidity {
    /// Beschreibt, warum der Schlüssel zu `at` nicht verwendbar war, oder `None`.
    pub fn problem_at(&self, at: SystemTime) -> Option<&'static str> {
        if self.revoked {
            Some("der Schlüssel ist widerrufen")
        } else if self.expires_at.is_some_and(|end| at > end) {
            Some("der Schlüssel war zum Zeitpunkt der Signatur abgelaufen")
        } else {
            None
        }
    }
}

fn system_time(ts: pgp::types::Timestamp) -> SystemTime {
    SystemTime::from(ts)
}

/// Ablauf aus der jüngsten Signatur in `sigs`, die der Hauptschlüssel selbst ausgestellt hat (Fingerabdruck oder
/// Schlüssel-ID von `issuer`). Eine jüngere Signatur ohne Ablauf hebt einen älteren Ablauf auf.
fn expiry_from<'a>(
    created: SystemTime,
    sigs: impl Iterator<Item = &'a Signature>,
    issuer: &impl KeyDetails,
) -> Option<SystemTime> {
    let (fp, id) = (issuer.fingerprint(), issuer.legacy_key_id());
    let newest = sigs
        .filter(|s| {
            matches!(
                s.typ(),
                Some(
                    SignatureType::Key
                        | SignatureType::SubkeyBinding
                        | SignatureType::CertGeneric
                        | SignatureType::CertPersona
                        | SignatureType::CertCasual
                        | SignatureType::CertPositive
                )
            ) && (s.issuer_fingerprint().contains(&&fp) || s.issuer_key_id().contains(&&id))
        })
        .max_by_key(|s| s.created().map(system_time))?;
    let seconds = newest.key_expiration_time().map(|d| u64::from(d.as_secs())).filter(|s| *s > 0)?;
    created.checked_add(Duration::from_secs(seconds))
}

/// Gültigkeit des Hauptschlüssels.
pub fn primary_validity(key: &SignedPublicKey) -> KeyValidity {
    let created = system_time(key.primary_key.created_at());
    let self_sigs =
        key.details.direct_signatures.iter().chain(key.details.users.iter().flat_map(|u| u.signatures.iter()));
    KeyValidity {
        revoked: !key.details.revocation_signatures.is_empty(),
        expires_at: expiry_from(created, self_sigs, &key.primary_key),
    }
}

/// Gültigkeit eines Unterschlüssels (Bindungssignaturen des Hauptschlüssels).
pub fn subkey_validity(key: &SignedPublicKey, sub: &SignedPublicSubKey) -> KeyValidity {
    let created = system_time(sub.key.created_at());
    KeyValidity {
        revoked: sub.signatures.iter().any(|s| s.typ() == Some(SignatureType::SubkeyRevocation)),
        expires_at: expiry_from(created, sub.signatures.iter(), &key.primary_key),
    }
}

/// Prüft die erlaubten Schlüssel der Schlüsselblöcke zu `at` (für den Katalogbau): Mindestens ein erlaubter
/// Hauptschlüssel muss vorkommen, und jeder erlaubte Hauptschlüssel darf weder widerrufen noch abgelaufen sein.
pub fn check_key_validity(
    armored_blocks: &[String],
    allowed_fingerprints: &[String],
    at: SystemTime,
) -> Result<Vec<String>, VerifyError> {
    let allowed: Vec<String> = allowed_fingerprints.iter().map(|f| normalize(f)).collect();
    let mut checked = Vec::new();
    for armored in armored_blocks {
        let (keys, _) = SignedPublicKey::from_reader_many(Cursor::new(armored.as_bytes()))
            .map_err(|e| sig_err(format!("Schlüsselblock nicht lesbar: {e}")))?;
        for key in keys.flatten() {
            let fp = normalize(&format!("{:X}", key.primary_key.fingerprint()));
            if !allowed.contains(&fp) {
                continue;
            }
            if let Some(problem) = primary_validity(&key).problem_at(at) {
                return Err(sig_err(format!("Schlüssel {fp}: {problem}")));
            }
            checked.push(fp);
        }
    }
    if checked.is_empty() {
        return Err(VerifyError::KeyNotAllowed(
            "Die Schlüsselblöcke enthalten keinen der erlaubten Fingerabdrücke".into(),
        ));
    }
    Ok(checked)
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
    if let Some(err) = hash_policy_error(sig.signature.hash_alg(), trust.allow_weak_hash) {
        return Err(err);
    }
    // Zeitpunkt der Signatur; fehlt er, zählt jetzt
    let signed_at = sig.signature.created().map_or_else(SystemTime::now, system_time);

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
            // Ein widerrufener oder zum Signaturzeitpunkt abgelaufener Hauptschlüssel macht den ganzen Block unbrauchbar
            if let Some(problem) = primary_validity(&key).problem_at(signed_at) {
                last_error = Some(format!("Schlüssel {primary}: {problem}"));
                continue;
            }
            match try_key(&sig, &key.primary_key, file) {
                Ok(()) => return Ok(primary),
                Err(e) => last_error = Some(e),
            }
            for sub in &key.public_subkeys {
                if let Some(problem) = subkey_validity(&key, sub).problem_at(signed_at) {
                    last_error = Some(format!("Unterschlüssel von {primary}: {problem}"));
                    continue;
                }
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
            &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed, allow_weak_hash: false },
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
                &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed, allow_weak_hash: false },
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
            &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed, allow_weak_hash: false },
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
            &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed, allow_weak_hash: false },
        )
        .unwrap_err();
        assert!(matches!(e, VerifyError::Signature(_)), "{e}");
        // und ohne den passenden Schlüssel erst recht
        let armored = [public_armored(&attacker)];
        assert!(
            verify_pgp_detached(
                &file,
                &signature,
                &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed, allow_weak_hash: false },
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
                &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &none, allow_weak_hash: false },
            )
            .is_err()
        );
        let allowed = [fingerprint(&key)];
        let e = verify_pgp_detached(
            &file,
            b"das ist keine Signatur",
            &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed, allow_weak_hash: false },
        )
        .unwrap_err();
        assert!(matches!(e, VerifyError::Signature(_)));
        // fehlende Datei
        let e = verify_pgp_detached(
            &dir.path().join("fehlt"),
            &sign(&key, b"x"),
            &PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed, allow_weak_hash: false },
        )
        .unwrap_err();
        assert!(matches!(e, VerifyError::Io(_)), "{e}");
    }

    /// Echte Dateien aus der Linux-Probe: die Krita-AppImage und ihre `.sig` (liegen in `CYPHER_PROBE_DL`), geprüft mit dem
    /// Schlüssel und der Fingerabdruck-Liste aus dem eingebetteten Katalog. Nur mit `--ignored`.
    #[test]
    #[ignore = "braucht die heruntergeladene Krita-AppImage (CYPHER_PROBE_DL)"]
    fn real_krita_appimage_signature_verifies_with_the_catalog_key() {
        let Ok(dir) = std::env::var("CYPHER_PROBE_DL") else { return };
        let dir = std::path::PathBuf::from(dir);
        let catalog: serde_json::Value = serde_json::from_slice(crate::catalog::EMBEDDED_CATALOG_JSON).unwrap();
        let krita = catalog["programs"].as_array().unwrap().iter().find(|p| p["id"] == "krita").unwrap();
        let artifact = krita["releases"][0]["artifacts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "appImage")
            .expect("Linux-Artefakt");
        let signature = &artifact["signature"];
        let armored: Vec<String> =
            signature["publicKeys"].as_array().unwrap().iter().map(|k| k.as_str().unwrap().to_owned()).collect();
        let allowed: Vec<String> =
            signature["fingerprints"].as_array().unwrap().iter().map(|k| k.as_str().unwrap().to_owned()).collect();
        let file_name = artifact["fileName"].as_str().unwrap();
        let sig = std::fs::read(dir.join(format!("{file_name}.sig"))).unwrap();
        let trust = PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed, allow_weak_hash: false };
        let got = verify_pgp_detached(&dir.join(file_name), &sig, &trust).unwrap();
        assert!(allowed.contains(&got), "{got}");

        // dieselbe Datei mit verändertem Byte im Kopf: die Signatur stimmt nicht mehr (nur Kopie, Original bleibt)
        let copy = std::env::temp_dir().join(format!("cypher-pgp-{}.AppImage", std::process::id()));
        std::fs::copy(dir.join(file_name), &copy).unwrap();
        {
            use std::io::{Seek, SeekFrom, Write};
            let mut f = std::fs::OpenOptions::new().write(true).open(&copy).unwrap();
            f.seek(SeekFrom::Start(4096)).unwrap();
            f.write_all(&[0xA5]).unwrap();
        }
        let e = verify_pgp_detached(&copy, &sig, &trust).unwrap_err();
        let _ = std::fs::remove_file(&copy);
        assert!(matches!(e, VerifyError::Signature(_)), "{e}");
    }

    #[test]
    fn weak_hashes_are_rejected_unless_the_documented_exception_applies() {
        // Befund N4: MD5 und SHA-1 galten bisher. rPGP signiert selbst nicht mit schwachen Hashes, darum prüft der Test
        // die Richtlinie direkt und die echte Prüfung mit starken Hashes.
        for weak in [
            HashAlgorithm::Md5,
            HashAlgorithm::Sha1,
            HashAlgorithm::Ripemd160,
            HashAlgorithm::Sha224,
            HashAlgorithm::None,
            HashAlgorithm::Other(99),
        ] {
            let err = hash_policy_error(Some(weak), false).unwrap_or_else(|| panic!("{weak:?} wurde zugelassen"));
            assert!(matches!(&err, VerifyError::Signature(m) if m.contains("zu schwach")), "{weak:?}: {err}");
            assert!(hash_policy_error(Some(weak), true).is_none(), "Ausnahme cypherPinned: {weak:?}");
        }
        assert!(hash_policy_error(None, false).is_some(), "unbekannter Hash zählt nicht");
        for strong in [
            HashAlgorithm::Sha256,
            HashAlgorithm::Sha384,
            HashAlgorithm::Sha512,
            HashAlgorithm::Sha3_256,
            HashAlgorithm::Sha3_512,
        ] {
            assert!(hash_policy_error(Some(strong), false).is_none(), "{strong:?}");
        }

        let key = new_key(7, "Stark <stark@example.org>");
        let dir = tempfile::tempdir().unwrap();
        let data = b"AppImage-Inhalt".repeat(100);
        let file = write(dir.path(), "app.AppImage", &data);
        let armored = [public_armored(&key)];
        let allowed = [fingerprint(&key)];
        let trust = PgpTrust { public_keys_armored: &armored, allowed_fingerprints: &allowed, allow_weak_hash: false };
        for hash in [HashAlgorithm::Sha512, HashAlgorithm::Sha384, HashAlgorithm::Sha256] {
            let rng = ChaCha20Rng::seed_from_u64(6);
            let sig = DetachedSignature::sign_binary_data(rng, &key.primary_key, &Password::empty(), hash, &data[..])
                .unwrap();
            let bytes = sig.to_armored_bytes(ArmorOptions::default()).unwrap();
            assert!(verify_pgp_detached(&file, &bytes, &trust).is_ok(), "{hash:?}");
        }
    }

    #[test]
    fn key_validity_reports_revocation_and_expiry() {
        let t = |secs: u64| SystemTime::UNIX_EPOCH + Duration::from_secs(secs);
        assert_eq!(KeyValidity { revoked: false, expires_at: None }.problem_at(t(5)), None);
        assert!(KeyValidity { revoked: true, expires_at: None }.problem_at(t(5)).is_some());
        let expiring = KeyValidity { revoked: false, expires_at: Some(t(100)) };
        assert_eq!(expiring.problem_at(t(99)), None);
        assert_eq!(expiring.problem_at(t(100)), None, "am letzten Tag gilt der Schlüssel noch");
        assert!(expiring.problem_at(t(101)).is_some());
    }

    #[test]
    fn a_fresh_key_is_valid_and_the_catalog_check_finds_it_by_fingerprint() {
        let key = new_key(8, "Frisch <frisch@example.org>");
        let public = key.to_public_key();
        assert_eq!(primary_validity(&public), KeyValidity { revoked: false, expires_at: None });
        let armored = [public_armored(&key)];
        let allowed = [fingerprint(&key)];
        let ok = check_key_validity(&armored, &allowed, SystemTime::now()).unwrap();
        assert_eq!(ok, [normalize(&allowed[0])]);
        let other = [fingerprint(&new_key(9, "Anderer <anderer@example.org>"))];
        assert!(matches!(check_key_validity(&armored, &other, SystemTime::now()), Err(VerifyError::KeyNotAllowed(_))));
        assert!(check_key_validity(&["kein Schlüssel".to_owned()], &allowed, SystemTime::now()).is_err());
    }

    /// Echte Upstream-Signaturen aus der Linux-Probe (`CYPHER_PROBE_SIGS` mit `krita.sig` und `inkscape.sig`), geprüft gegen
    /// die Schlüssel des eingebetteten Katalogs: starker Hash, Schlüssel nicht widerrufen und zur Signaturzeit gültig.
    #[test]
    #[ignore = "braucht die echten .sig-Dateien (CYPHER_PROBE_SIGS)"]
    fn real_upstream_signatures_use_strong_hashes_and_valid_keys() {
        let Ok(dir) = std::env::var("CYPHER_PROBE_SIGS") else { return };
        let dir = std::path::PathBuf::from(dir);
        let catalog: serde_json::Value = serde_json::from_slice(crate::catalog::EMBEDDED_CATALOG_JSON).unwrap();
        for (program, sig_file) in [("krita", "krita.sig"), ("inkscape", "inkscape.sig")] {
            let p = catalog["programs"].as_array().unwrap().iter().find(|p| p["id"] == program).unwrap();
            let a = p["releases"][0]["artifacts"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["kind"] == "appImage")
                .expect("Linux-Artefakt");
            let armored: Vec<String> = a["signature"]["publicKeys"]
                .as_array()
                .unwrap()
                .iter()
                .map(|k| k.as_str().unwrap().to_owned())
                .collect();
            let allowed: Vec<String> = a["signature"]["fingerprints"]
                .as_array()
                .unwrap()
                .iter()
                .map(|k| k.as_str().unwrap().to_owned())
                .collect();
            let bytes = std::fs::read(dir.join(sig_file)).unwrap();
            let (sig, _) = DetachedSignature::from_reader_single(Cursor::new(&bytes[..])).unwrap();
            let hash = sig.signature.hash_alg().unwrap();
            let created = sig.signature.created().map(system_time).unwrap();
            eprintln!("{program}: Hash {hash}, Signatur vom {created:?}");
            let at = SystemTime::now();
            let fps = check_key_validity(&armored, &allowed, at).unwrap_or_else(|e| panic!("{program}: {e}"));
            eprintln!("{program}: Schlüssel {fps:?} heute gültig");
            for block in &armored {
                let (keys, _) = SignedPublicKey::from_reader_many(Cursor::new(block.as_bytes())).unwrap();
                for key in keys.flatten() {
                    let v = primary_validity(&key);
                    eprintln!("{program}: {v:?}; Signaturzeit: {:?}", v.problem_at(created));
                    assert_eq!(v.problem_at(created), None, "{program}: Schlüssel zur Signaturzeit nicht gültig");
                }
            }
            assert!(is_strong_hash(hash) || program == "inkscape", "{program}: schwacher Hash {hash}");
        }
    }
}
