//! `cypher catalog verify | check | keygen | sign`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use clap::Subcommand;
use cypher_core::catalog::{self, Catalog, MAX_CATALOG_BYTES};
use cypher_core::download::{HostPolicy, HttpClient, NetLog, probe_size};
use cypher_core::verify::TrustedKeys;
use tokio_util::sync::CancellationToken;

use crate::{CliError, CliResult};

#[derive(Subcommand)]
pub enum CatalogCommand {
    /// Signatur, Schema und Hostliste prüfen (ohne Datei: der eingebettete Katalog mit den eingebetteten Schlüsseln)
    Verify {
        /// catalog.json (Signatur liegt als `<datei>.minisig` daneben)
        file: Option<PathBuf>,
        /// öffentliche Schlüssel (.pub) statt der eingebetteten
        #[arg(long = "key")]
        keys: Vec<PathBuf>,
    },
    /// Katalogdaten prüfen (Schema, Hosts, Größen, Prüfsummen), ohne Signatur
    Check {
        file: PathBuf,
        /// Dateigrößen per Bereichsanfrage bei den Quellen abgleichen
        #[arg(long)]
        online: bool,
        /// Artefakte laden und SHA-256 abgleichen (große Downloads!)
        #[arg(long)]
        download: bool,
    },
    /// Testschlüsselpaar erzeugen (nur Entwicklung; die echten Schlüssel erzeugt die verantwortliche Person offline)
    #[cfg(feature = "dev-tools")]
    Keygen {
        /// Zielordner für `<name>.key` (geheim) und `<name>.pub`
        #[arg(long)]
        out: PathBuf,
        #[arg(long, default_value = "catalog-dev")]
        name: String,
    },
    /// catalog.json mit einem Testschlüssel signieren (nur Entwicklung)
    #[cfg(feature = "dev-tools")]
    Sign {
        file: PathBuf,
        /// geheimer Schlüssel (unverschlüsselt) aus `keygen`
        #[arg(long)]
        key: PathBuf,
    },
}

pub async fn run(cmd: CatalogCommand) -> CliResult {
    match cmd {
        CatalogCommand::Verify { file, keys } => verify(file, keys),
        CatalogCommand::Check { file, online, download } => check(&file, online, download).await,
        #[cfg(feature = "dev-tools")]
        CatalogCommand::Keygen { out, name } => keygen(&out, &name),
        #[cfg(feature = "dev-tools")]
        CatalogCommand::Sign { file, key } => sign(&file, &key),
    }
}

fn app_version() -> semver::Version {
    semver::Version::parse(env!("CARGO_PKG_VERSION")).unwrap_or_else(|_| semver::Version::new(0, 0, 0))
}

fn verify(file: Option<PathBuf>, key_files: Vec<PathBuf>) -> CliResult {
    let keys = if key_files.is_empty() {
        TrustedKeys::embedded().map_err(|e| CliError(e.to_string()))?
    } else {
        let texts: Vec<String> = key_files
            .iter()
            .map(|p| std::fs::read_to_string(p).map_err(|e| CliError(format!("{}: {e}", p.display()))))
            .collect::<Result<_, _>>()?;
        let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
        TrustedKeys::from_strs(&refs).map_err(|e| CliError(e.to_string()))?
    };
    let hosts = HostPolicy::embedded();
    let (json, sig, origin): (Vec<u8>, String, String) = match &file {
        None => (
            catalog::EMBEDDED_CATALOG_JSON.to_vec(),
            catalog::EMBEDDED_CATALOG_SIG.to_owned(),
            "eingebetteter Katalog".to_owned(),
        ),
        Some(path) => {
            let json = std::fs::read(path).map_err(|e| CliError(format!("{}: {e}", path.display())))?;
            let sig_path = PathBuf::from(format!("{}.minisig", path.display()));
            let sig =
                std::fs::read_to_string(&sig_path).map_err(|e| CliError(format!("{}: {e}", sig_path.display())))?;
            (json, sig, path.display().to_string())
        }
    };
    let parsed =
        catalog::parse_and_verify(&json, &sig, &keys).map_err(|e| CliError(format!("Signatur/Format: {e}")))?;
    let warnings =
        catalog::validate(&parsed, &hosts, &app_version()).map_err(|e| CliError(format!("Katalog ungültig: {e}")))?;
    println!(
        "OK  {origin}: Sequenz {}, {} Programme, {} Druckprofile, Schlüssel {}",
        parsed.sequence,
        parsed.programs.len(),
        parsed.print_profiles.len(),
        keys.ids().join(", ")
    );
    for w in warnings {
        println!("Hinweis: {w:?}");
    }
    Ok(())
}

async fn check(file: &Path, online: bool, download: bool) -> CliResult {
    let json = std::fs::read(file).map_err(|e| CliError(format!("{}: {e}", file.display())))?;
    if json.len() as u64 > MAX_CATALOG_BYTES {
        return Err(CliError("catalog.json ist größer als 2 MiB".into()));
    }
    let parsed: Catalog = serde_json::from_slice(&json).map_err(|e| CliError(format!("Format: {e}")))?;
    let policy = Arc::new(HostPolicy::embedded());
    let warnings =
        catalog::validate(&parsed, &policy, &app_version()).map_err(|e| CliError(format!("Katalog ungültig: {e}")))?;
    println!("OK  Schema, Hosts und Zahlen: Sequenz {}, {} Programme", parsed.sequence, parsed.programs.len());
    for w in warnings {
        println!("Hinweis: {w:?}");
    }
    // PGP-Schlüssel der Upstream-Signaturen: nicht widerrufen, nicht abgelaufen (die App prüft das zur Signaturzeit)
    let mut key_problems = 0usize;
    for program in &parsed.programs {
        for release in &program.releases {
            for a in release
                .artifacts
                .iter()
                .filter(|a| a.signature.as_ref().is_some_and(|s| s.kind == catalog::SignatureKind::Pgp))
            {
                let Some(sig) = &a.signature else { continue };
                let label = format!("{} {} {}/{:?}", program.name, release.version, a.os, a.arch);
                match cypher_core::verify::check_key_validity(
                    &sig.public_keys,
                    &sig.fingerprints,
                    std::time::SystemTime::now(),
                ) {
                    Ok(fps) => println!("OK     {label}: PGP-Schlüssel {} gültig", fps.join(", ")),
                    Err(e) => {
                        println!("FEHLER {label}: {e}");
                        key_problems += 1;
                    }
                }
            }
        }
    }
    if key_problems > 0 {
        return Err(CliError(format!("{key_problems} PGP-Schlüssel widerrufen, abgelaufen oder nicht auffindbar")));
    }
    if !online && !download {
        return Ok(());
    }
    let http = HttpClient::new(env!("CARGO_PKG_VERSION"), policy, Arc::new(NetLog::new(None)))
        .map_err(|e| CliError(e.to_string()))?;
    let cancel = CancellationToken::new();
    let mut problems = 0usize;
    for program in &parsed.programs {
        for release in &program.releases {
            for a in &release.artifacts {
                let label = format!("{} {} {}/{:?}", program.name, release.version, a.os, a.arch);
                let Ok(url) = url::Url::parse(&a.url) else {
                    println!("FEHLER {label}: Adresse ungültig");
                    problems += 1;
                    continue;
                };
                if download {
                    let dir = std::env::temp_dir().join(format!("cypher-catalog-check-{}", std::process::id()));
                    let sha: [u8; 32] = hex::decode(&a.sha256).ok().and_then(|b| b.try_into().ok()).unwrap_or([0; 32]);
                    let part = dir.join(format!("{}.part", a.sha256));
                    let fin = dir.join(&a.file_name);
                    let req =
                        cypher_core::download::DownloadRequest::new(url, part, fin.clone(), &a.file_name, a.size, sha);
                    match cypher_core::download::fetch_to_file(&http, &req, &cypher_core::progress::NoProgress, &cancel)
                        .await
                    {
                        Ok(_) => println!("OK     {label}: Größe und SHA-256 stimmen"),
                        Err(e) => {
                            println!("FEHLER {label}: {e}");
                            problems += 1;
                        }
                    }
                    let _ = std::fs::remove_dir_all(&dir);
                } else {
                    match probe_size(&http, &url, cypher_core::api::NetworkPurpose::ProgramDownload, &cancel).await {
                        Ok(size) if size == a.size => println!("OK     {label}: {size} Bytes"),
                        Ok(size) => {
                            println!("FEHLER {label}: Katalog {} Bytes, Quelle {size} Bytes", a.size);
                            problems += 1;
                        }
                        Err(e) => {
                            println!("FEHLER {label}: {e}");
                            problems += 1;
                        }
                    }
                }
            }
        }
    }
    if problems > 0 {
        return Err(CliError(format!("{problems} Artefakt(e) mit Abweichung")));
    }
    Ok(())
}

#[cfg(feature = "dev-tools")]
fn keygen(out: &Path, name: &str) -> CliResult {
    std::fs::create_dir_all(out)?;
    let pair = minisign::KeyPair::generate_unencrypted_keypair().map_err(|e| CliError(e.to_string()))?;
    let pk = pair.pk.to_box().map_err(|e| CliError(e.to_string()))?.to_string();
    let sk = pair.sk.to_box(None).map_err(|e| CliError(e.to_string()))?.to_string();
    let key_path = out.join(format!("{name}.key"));
    let pub_path = out.join(format!("{name}.pub"));
    std::fs::write(&key_path, sk)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::write(&pub_path, pk)?;
    println!("Geheimer Schlüssel: {} (nie einchecken)", key_path.display());
    println!("Öffentlicher Schlüssel: {}", pub_path.display());
    Ok(())
}

#[cfg(feature = "dev-tools")]
fn sign(file: &Path, key: &Path) -> CliResult {
    let data = std::fs::read(file).map_err(|e| CliError(format!("{}: {e}", file.display())))?;
    let seq = serde_json::from_slice::<serde_json::Value>(&data)
        .ok()
        .and_then(|v| v.get("sequence").and_then(serde_json::Value::as_u64))
        .unwrap_or(0);
    let sk_text = std::fs::read_to_string(key).map_err(|e| CliError(format!("{}: {e}", key.display())))?;
    let sk = minisign::SecretKeyBox::from_string(&sk_text)
        .and_then(|b| b.into_unencrypted_secret_key())
        .map_err(|e| CliError(format!("Schlüssel nicht lesbar: {e}")))?;
    let comment = format!("cypher-catalog seq={seq}");
    let sig = minisign::sign(
        None,
        &sk,
        std::io::Cursor::new(&data),
        Some(&comment),
        Some("Cypher Studio Katalog (Testschlüssel)"),
    )
    .map_err(|e| CliError(e.to_string()))?;
    let sig_path = PathBuf::from(format!("{}.minisig", file.display()));
    std::fs::write(&sig_path, sig.to_string())?;
    println!("Signatur geschrieben: {}", sig_path.display());
    Ok(())
}
