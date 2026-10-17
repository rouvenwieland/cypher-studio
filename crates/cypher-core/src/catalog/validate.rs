//! Semantische Prüfung des Katalogs (zusätzlich zum JSON-Schema, das CI prüft; ARCHITEKTUR.md 2.4).

use std::collections::BTreeSet;

use url::Url;

use super::model::{ArtifactSpec, Catalog, ProgramSpec};
use super::version::{ProgVer, VersionRange};
use crate::api::ArtifactKind;
use crate::download::HostPolicy;
use crate::error::CatalogError;
use crate::platform::fsx;
use crate::util::parse_iso;

/// Höchste Schema-Version, die diese App versteht.
pub const SUPPORTED_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CatalogWarning {
    /// `expiresAt` ist vorbei: der Katalog bleibt nutzbar, die UI zeigt einen Hinweis.
    Expired { expires_at: String },
}

fn fail<T>(path: impl Into<String>, reason: impl Into<String>) -> Result<T, CatalogError> {
    Err(CatalogError::Schema { path: path.into(), reason: reason.into() })
}

pub(crate) fn is_kebab_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 40
        && id
            .split('-')
            .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

fn is_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn is_file_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 200
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'+' | b'-'))
}

fn is_flag(s: &str) -> bool {
    let rest = s.strip_prefix("--").or_else(|| s.strip_prefix('-'));
    let Some(rest) = rest else { return false };
    let (name, value) = match rest.split_once('=') {
        Some((n, v)) => (n, Some(v)),
        None => (rest, None),
    };
    !name.is_empty()
        && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && value.is_none_or(|v| {
            !v.is_empty() && v.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        })
}

fn https_url(path: &str, text: &str) -> Result<Url, CatalogError> {
    let url = Url::parse(text)
        .map_err(|e| CatalogError::Schema { path: path.into(), reason: format!("ungültige Adresse: {e}") })?;
    if url.scheme() != "https" {
        return fail(path, "nur https erlaubt");
    }
    if !url.username().is_empty() || url.password().is_some() {
        return fail(path, "Zugangsdaten in der Adresse");
    }
    Ok(url)
}

fn allowed_url(path: &str, text: &str, hosts: &HostPolicy) -> Result<(), CatalogError> {
    let url = Url::parse(text)
        .map_err(|e| CatalogError::Schema { path: path.into(), reason: format!("ungültige Adresse: {e}") })?;
    // Test-Richtlinien erlauben http gegen 127.0.0.1; die eingebettete Richtlinie verlangt https
    hosts.check(&url).map(|_| ()).map_err(|e| match e {
        crate::error::DownloadError::HostNotAllowed(h) => CatalogError::HostNotAllowed(h),
        other => CatalogError::Schema { path: path.into(), reason: other.to_string() },
    })
}

fn rel_path(path: &str, text: &str) -> Result<(), CatalogError> {
    fsx::split_rel(text)
        .map(|_| ())
        .map_err(|e| CatalogError::Schema { path: path.into(), reason: format!("unsicherer Pfad `{text}`: {e}") })
}

fn check_artifact(path: &str, a: &ArtifactSpec, hosts: &HostPolicy) -> Result<(), CatalogError> {
    allowed_url(&format!("{path}.url"), &a.url, hosts)?;
    if !is_file_name(&a.file_name) {
        return fail(format!("{path}.fileName"), "nur Buchstaben, Ziffern und . _ + -");
    }
    if !is_sha256(&a.sha256) {
        return fail(format!("{path}.sha256"), "64 Hex-Zeichen in Kleinbuchstaben erwartet");
    }
    if a.size == 0 {
        return fail(format!("{path}.size"), "muss größer als 0 sein");
    }
    if a.unpacked_size_max < a.size {
        return fail(format!("{path}.unpackedSizeMax"), "darf nicht kleiner als size sein");
    }
    allowed_url(&format!("{path}.checksumSource"), &a.checksum_source, hosts)?;
    if a.strip_components > 3 {
        return fail(format!("{path}.stripComponents"), "höchstens 3");
    }
    rel_path(&format!("{path}.launch.exe"), &a.launch.exe)?;
    if let Some(glob) = &a.launch.exe_glob
        && (glob.is_empty()
            || glob.starts_with('/')
            || glob.starts_with('\\')
            || glob.contains("..")
            || glob.contains(':'))
    {
        return fail(format!("{path}.launch.exeGlob"), "unsicheres Muster");
    }
    if a.launch.args.len() > 4 || !a.launch.args.iter().all(|x| is_flag(x)) {
        return fail(format!("{path}.launch.args"), "höchstens 4 einfache Optionen wie --app-template=name");
    }
    if let Some(marker) = &a.launch.portable_marker {
        rel_path(&format!("{path}.launch.portableMarker"), marker)?;
    }
    if a.kind == ArtifactKind::ExeInstaller && a.installer_type.is_none() {
        return fail(format!("{path}.installerType"), "exeInstaller braucht nsis oder inno");
    }
    if a.kind == ArtifactKind::Dmg && a.mac_app_name.is_none() {
        return fail(format!("{path}.macAppName"), "dmg braucht den Namen des .app");
    }
    // `macAppName` wird als Pfad benutzt (`programs/<name>`, `staging/<name>`): genau eine sichere Komponente auf `.app`
    if let Some(name) = &a.mac_app_name
        && (fsx::validate_component(name).is_err() || !name.to_ascii_lowercase().ends_with(".app") || name.len() < 5)
    {
        return fail(format!("{path}.macAppName"), "ein einzelner Name, der auf .app endet, ohne Pfadteile");
    }
    if let Some(sig) = &a.signature {
        allowed_url(&format!("{path}.signature.url"), &sig.url, hosts)?;
        if sig.public_keys.is_empty() || sig.fingerprints.is_empty() {
            return fail(format!("{path}.signature"), "Schlüssel und Fingerprints fehlen");
        }
        if sig.public_keys.len() > 8
            || sig.public_keys.iter().any(|k| {
                k.is_empty()
                    || k.len() > 32 * 1024
                    || !k.chars().all(|c| c.is_ascii_graphic() || c == ' ' || c == '\n' || c == '\r')
            })
        {
            return fail(
                format!("{path}.signature.publicKeys"),
                "höchstens 8 Schlüssel aus druckbarem ASCII (bis 32 KiB)",
            );
        }
        if sig.fingerprints.iter().any(|f| f.len() != 40 || !f.bytes().all(|b| b.is_ascii_hexdigit())) {
            return fail(format!("{path}.signature.fingerprints"), "40 Hex-Zeichen erwartet");
        }
    }
    Ok(())
}

fn check_program(p: &ProgramSpec, hosts: &HostPolicy) -> Result<(), CatalogError> {
    let base = format!("programs[{}]", p.id);
    if !is_kebab_id(&p.id) {
        return fail(format!("{base}.id"), "kebab-case mit höchstens 40 Zeichen erwartet");
    }
    https_url(&format!("{base}.homepage"), &p.homepage)?;
    https_url(&format!("{base}.license.url"), &p.license.url)?;
    if let Some(u) = &p.release_notes_url {
        https_url(&format!("{base}.releaseNotesUrl"), u)?;
    }
    if p.description.chars().count() > 400 {
        return fail(format!("{base}.description"), "höchstens 400 Zeichen");
    }
    if let Some(setup) = &p.setup {
        if !is_kebab_id(&setup.pack_id) {
            return fail(format!("{base}.setup.packId"), "kebab-case erwartet");
        }
        if VersionRange::parse(&setup.version_range).is_err() {
            return fail(format!("{base}.setup.versionRange"), "ungültiger Versionsbereich");
        }
        if setup.roots.is_empty() {
            return fail(format!("{base}.setup.roots"), "mindestens eine Wurzel");
        }
    }
    if p.releases.is_empty() {
        return fail(format!("{base}.releases"), "mindestens ein Release");
    }
    let mut versions = BTreeSet::new();
    for release in &p.releases {
        let rbase = format!("{base}.releases[{}]", release.version);
        let parsed = ProgVer::parse(&release.version);
        if parsed.is_err() || !release.version.contains('.') {
            return fail(format!("{rbase}.version"), "punktnumerische Version mit mindestens zwei Gruppen erwartet");
        }
        if !versions.insert(release.version.clone()) {
            return fail(format!("{rbase}.version"), "doppelt");
        }
        let mut targets = BTreeSet::new();
        for (i, a) in release.artifacts.iter().enumerate() {
            let abase = format!("{rbase}.artifacts[{i}]");
            if !targets.insert((a.os, format!("{:?}", a.arch))) {
                return fail(&abase, format!("mehr als ein Artefakt für {} {:?}", a.os, a.arch));
            }
            check_artifact(&abase, a, hosts)?;
        }
    }
    Ok(())
}

/// Prüft den Katalog gegen Host-Richtlinie und App-Version. Liefert Warnungen (z. B. abgelaufen) oder den
/// ersten Fehler.
pub fn validate(
    c: &Catalog,
    hosts: &HostPolicy,
    app_version: &semver::Version,
) -> Result<Vec<CatalogWarning>, CatalogError> {
    let min_app = semver::Version::parse(&c.min_app_version)
        .map_err(|e| CatalogError::Schema { path: "minAppVersion".into(), reason: e.to_string() })?;
    if c.schema_version > SUPPORTED_SCHEMA_VERSION || min_app > *app_version {
        return Err(CatalogError::Incompatible { schema: c.schema_version, min_app: c.min_app_version.clone() });
    }
    if c.schema_version == 0 {
        return fail("schemaVersion", "muss mindestens 1 sein");
    }
    if c.sequence == 0 {
        return fail("sequence", "muss mindestens 1 sein");
    }
    let generated = parse_iso(&c.generated_at)
        .ok_or_else(|| CatalogError::Schema { path: "generatedAt".into(), reason: "kein RFC-3339-Zeitpunkt".into() })?;
    let expires = parse_iso(&c.expires_at)
        .ok_or_else(|| CatalogError::Schema { path: "expiresAt".into(), reason: "kein RFC-3339-Zeitpunkt".into() })?;
    if expires <= generated {
        return fail("expiresAt", "muss nach generatedAt liegen");
    }

    let mut ids = BTreeSet::new();
    for p in &c.programs {
        if !ids.insert(p.id.as_str()) {
            return fail(format!("programs[{}].id", p.id), "doppelt");
        }
        check_program(p, hosts)?;
    }
    let mut link_ids = BTreeSet::new();
    for l in &c.links {
        if !is_kebab_id(&l.id) || !link_ids.insert(l.id.as_str()) {
            return fail(format!("links[{}].id", l.id), "kebab-case und eindeutig erwartet");
        }
        https_url(&format!("links[{}].url", l.id), &l.url)?;
    }
    let mut profile_ids = BTreeSet::new();
    for pr in &c.print_profiles {
        if !profile_ids.insert(pr.id.as_str()) {
            return fail(format!("printProfiles[{}].id", pr.id), "doppelt");
        }
        let base = format!("printProfiles[{}]", pr.id);
        if pr.techniques.is_empty() {
            return fail(format!("{base}.techniques"), "mindestens ein Verfahren");
        }
        if pr.print_area_mm.width <= 0.0 || pr.print_area_mm.height <= 0.0 {
            return fail(format!("{base}.printAreaMm"), "Maße müssen positiv sein");
        }
        if pr.target_dpi == 0 || pr.error_below_dpi == 0 || pr.error_below_dpi > pr.target_dpi {
            return fail(format!("{base}.targetDpi"), "targetDpi >= errorBelowDpi > 0 erwartet");
        }
        if pr.min_px_per_side == 0 || pr.min_px_per_side > pr.max_px_per_side {
            return fail(format!("{base}.minPxPerSide"), "0 < min <= max erwartet");
        }
        if pr.alpha.semi_min > pr.alpha.semi_max {
            return fail(format!("{base}.alpha"), "semiMin darf nicht größer als semiMax sein");
        }
    }
    let mut model_ids = BTreeSet::new();
    for m in &c.models {
        if !is_kebab_id(&m.id) || !model_ids.insert(m.id.as_str()) {
            return fail(format!("models[{}].id", m.id), "kebab-case und eindeutig erwartet");
        }
        allowed_url(&format!("models[{}].url", m.id), &m.url, hosts)?;
        if !is_sha256(&m.sha256) || m.size == 0 {
            return fail(format!("models[{}]", m.id), "sha256 und size erwartet");
        }
    }

    let mut warnings = Vec::new();
    if time::OffsetDateTime::now_utc() > expires {
        warnings.push(CatalogWarning::Expired { expires_at: c.expires_at.clone() });
    }
    Ok(warnings)
}
