//! OpenPGP-Detached-Signaturen (Platzhalter bis Phase 2).

use std::path::Path;

use crate::error::VerifyError;

/// Welchen Schlüsseln beim Prüfen vertraut wird.
pub struct PgpTrust<'a> {
    pub public_keys_armored: &'a [String],
    pub allowed_fingerprints: &'a [String],
}

pub fn verify_pgp_detached(_file: &Path, _signature: &[u8], _trust: &PgpTrust<'_>) -> Result<String, VerifyError> {
    Err(VerifyError::Signature("OpenPGP-Prüfung ist noch nicht gebaut".into()))
}
