//! Bettet den Katalog (`catalog/catalog.json` + `.minisig`) und alle öffentlichen Katalogschlüssel
//! (`catalog/keys/catalog-*.pub`, aktiv + Reserve) in die Bibliothek ein.

use std::fmt::Write as _;
use std::path::PathBuf;

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let catalog_dir = manifest.join("..").join("..").join("catalog");
    let keys_dir = catalog_dir.join("keys");

    let mut keys: Vec<PathBuf> = std::fs::read_dir(&keys_dir)
        .map(|rd| {
            rd.filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| {
                    p.extension().is_some_and(|e| e == "pub")
                        && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("catalog-"))
                })
                .collect()
        })
        .unwrap_or_default();
    keys.sort();

    let json = catalog_dir.join("catalog.json");
    let sig = catalog_dir.join("catalog.json.minisig");

    let mut out = String::new();
    let _ = writeln!(out, "/// Eingebetteter Katalog (JSON).");
    let _ = writeln!(out, "pub const EMBEDDED_CATALOG_JSON: &[u8] = include_bytes!({:?});", json.to_string_lossy());
    let _ = writeln!(out, "/// Signatur dazu (minisign).");
    let _ = writeln!(out, "pub const EMBEDDED_CATALOG_SIG: &str = include_str!({:?});", sig.to_string_lossy());
    let _ = writeln!(out, "/// Öffentliche Katalogschlüssel (Inhalt der `catalog-*.pub`-Dateien).");
    let _ = writeln!(out, "pub const EMBEDDED_KEYS: &[&str] = &[");
    for key in &keys {
        let _ = writeln!(out, "    include_str!({:?}),", key.to_string_lossy());
        println!("cargo:rerun-if-changed={}", key.display());
    }
    let _ = writeln!(out, "];");

    println!("cargo:rerun-if-changed={}", keys_dir.display());
    println!("cargo:rerun-if-changed={}", json.display());
    println!("cargo:rerun-if-changed={}", sig.display());
    println!("cargo:rerun-if-changed=build.rs");

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap_or_default());
    if let Err(e) = std::fs::write(out_dir.join("embedded.rs"), out) {
        eprintln!("embedded.rs konnte nicht geschrieben werden: {e}");
        std::process::exit(1);
    }
}
