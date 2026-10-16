//! Marke, Mockup- und Social-Vorlagen aus den Paketen laden (ARCHITEKTUR.md 2.14, 4.8).
//!
//! Die Dateien von Team C enthalten relative Dateinamen; hier werden sie zu `cyasset`-URLs. Ein kaputter Eintrag überspringt
//! nur seine Vorlage (Warnung im Log), nicht die ganze Liste.

use std::path::Path;

use serde_json::Value;

use crate::api::{Brand, MockupTemplate, SocialTemplate};
use crate::error::{IoError, SetupError};
use crate::urls;

/// Unterordner der Pakete, die das Protokoll `cyasset` ausliefern darf.
pub const ASSET_DIRS: [&str; 5] = ["shared", "mockups", "social", "projects", "samples"];

fn asset(rel: &str) -> Value {
    Value::String(urls::url("cyasset", rel))
}

fn read_json(path: &Path) -> Result<Value, SetupError> {
    let bytes = std::fs::read(path).map_err(|e| IoError::read(path, e))?;
    serde_json::from_slice(&bytes).map_err(|e| SetupError::InvalidPack(format!("{}: {e}", path.display())))
}

/// Ersetzt in `obj` das Feld `from` (relativer Pfad) durch `to` (URL).
fn rewrite(obj: &mut Value, from: &str, to: &str, base: &str) {
    if let Some(map) = obj.as_object_mut()
        && let Some(Value::String(rel)) = map.remove(from)
    {
        map.insert(to.to_owned(), asset(&join(base, &rel)));
    }
}

fn join(base: &str, rel: &str) -> String {
    if base.is_empty() { rel.to_owned() } else { format!("{base}/{rel}") }
}

/// Dateiname einer Vorlage ist sicher? (eine einzige Pfadkomponente)
fn plain_name(name: &str) -> bool {
    !name.is_empty() && !name.contains(['/', '\\', ':']) && name != "." && name != ".."
}

/// `packs/shared/brand/brand.json` -> `Brand` (Schriften und Logos mit URLs).
pub fn load_brand(packs_root: &Path) -> Result<Brand, SetupError> {
    let path = packs_root.join("shared").join("brand").join("brand.json");
    let mut json = read_json(&path)?;
    if let Some(fonts) = json.get_mut("fonts").and_then(Value::as_array_mut) {
        for font in fonts {
            if let Some(files) = font.get_mut("files").and_then(Value::as_array_mut) {
                for f in files {
                    rewrite(f, "file", "url", "");
                }
            }
        }
    }
    if let Some(logos) = json.get_mut("logos").and_then(Value::as_array_mut) {
        for logo in logos {
            rewrite(logo, "file", "url", "");
        }
    }
    serde_json::from_value(json).map_err(|e| SetupError::InvalidPack(format!("{}: {e}", path.display())))
}

fn template_dirs(packs_root: &Path, kind: &str) -> Vec<(String, std::path::PathBuf)> {
    let mut out = Vec::new();
    let Ok(read) = std::fs::read_dir(packs_root.join(kind)) else { return out };
    for e in read.filter_map(Result::ok) {
        let name = e.file_name().to_string_lossy().into_owned();
        if plain_name(&name) && e.path().join("template.json").is_file() {
            out.push((name, e.path()));
        }
    }
    out.sort();
    out
}

/// `packs/mockups/*/template.json`.
pub fn load_mockup_templates(packs_root: &Path) -> Vec<MockupTemplate> {
    let mut out = Vec::new();
    for (dir_name, dir) in template_dirs(packs_root, "mockups") {
        let base = format!("mockups/{dir_name}");
        let loaded = read_json(&dir.join("template.json")).and_then(|mut json| {
            if let Some(variants) = json.get_mut("variants").and_then(Value::as_array_mut) {
                for v in variants {
                    if let Some(layers) = v.get_mut("layers").and_then(Value::as_object_mut) {
                        for (_, value) in layers.iter_mut() {
                            if let Value::String(rel) = value {
                                *value = asset(&join(&base, rel));
                            }
                        }
                    }
                }
            }
            serde_json::from_value::<MockupTemplate>(json).map_err(|e| SetupError::InvalidPack(e.to_string()))
        });
        match loaded {
            Ok(t) if t.id == dir_name => out.push(t),
            Ok(t) => tracing::warn!("Mockup-Vorlage {dir_name}: id `{}` passt nicht zum Ordner", t.id),
            Err(e) => tracing::warn!("Mockup-Vorlage {dir_name} übersprungen: {e}"),
        }
    }
    out
}

/// `packs/social/*/template.json`.
pub fn load_social_templates(packs_root: &Path) -> Vec<SocialTemplate> {
    let mut out = Vec::new();
    for (dir_name, dir) in template_dirs(packs_root, "social") {
        let base = format!("social/{dir_name}");
        let loaded = read_json(&dir.join("template.json")).and_then(|mut json| {
            rewrite(&mut json, "preview", "previewUrl", &base);
            // Bildfüllungen verweisen auf Dateien neben der Vorlage
            fn fix_fill(fill: &mut Value, base: &str) {
                if fill.get("type").and_then(Value::as_str) == Some("image")
                    && let Some(Value::String(rel)) = fill.get("url").cloned()
                {
                    fill["url"] = asset(&join(base, &rel));
                }
            }
            if let Some(bg) = json.get_mut("background") {
                fix_fill(bg, &base);
            }
            if let Some(layers) = json.get_mut("layers").and_then(Value::as_array_mut) {
                for layer in layers {
                    if let Some(fill) = layer.get_mut("fill") {
                        fix_fill(fill, &base);
                    }
                }
            }
            serde_json::from_value::<SocialTemplate>(json).map_err(|e| SetupError::InvalidPack(e.to_string()))
        });
        match loaded {
            Ok(t) if t.id == dir_name => out.push(t),
            Ok(t) => tracing::warn!("Social-Vorlage {dir_name}: id `{}` passt nicht zum Ordner", t.id),
            Err(e) => tracing::warn!("Social-Vorlage {dir_name} übersprungen: {e}"),
        }
    }
    out
}

/// Prüft eine Anfrage an `cyasset` und liefert den Dateipfad. `rel` ist der dekodierte Pfad der URL.
pub fn resolve_asset(packs_root: &Path, rel: &str) -> Option<std::path::PathBuf> {
    let parts = crate::platform::fsx::split_rel(rel).ok()?;
    if !ASSET_DIRS.contains(&parts.first()?.as_str()) {
        return None;
    }
    let candidate = parts.iter().fold(packs_root.to_path_buf(), |p, c| p.join(c));
    let resolved = crate::platform::fsx::ensure_within(packs_root, &candidate).ok()?;
    resolved.is_file().then_some(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> Option<std::path::PathBuf> {
        let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packs/dist");
        p.join("shared/brand/brand.json").is_file().then_some(p)
    }

    #[test]
    fn real_brand_and_templates_load_with_asset_urls() {
        let Some(root) = root() else { return };
        let brand = load_brand(&root).unwrap();
        assert!(brand.garment_colors.iter().any(|g| g.id == "schwarz" && g.underbase));
        assert!(
            brand
                .fonts
                .iter()
                .flat_map(|f| &f.files)
                .all(|f| f.url.contains("cyasset") && f.url.contains("shared/fonts")),
            "{:?}",
            brand.fonts[0].files[0]
        );
        assert!(!brand.logos.is_empty() && brand.logos.iter().all(|l| l.url.contains("shared/brand/logos")));

        let mockups = load_mockup_templates(&root);
        assert!(mockups.len() >= 4, "{}", mockups.len());
        for m in &mockups {
            for v in &m.variants {
                assert!(v.layers.mask.contains(&format!("mockups/{}/mask.png", m.id)), "{}", v.layers.mask);
            }
        }

        let social = load_social_templates(&root);
        assert!(social.len() >= 5, "{}", social.len());
        assert!(
            social
                .iter()
                .all(|s| s.preview_url.as_deref().is_some_and(|u| u.contains(&format!("social/{}/preview.png", s.id))))
        );
    }

    #[test]
    fn asset_requests_are_confined_to_whitelisted_folders() {
        let Some(root) = root() else { return };
        assert!(resolve_asset(&root, "mockups/tee-front/mask.png").is_some());
        assert!(resolve_asset(&root, "shared/brand/brand.json").is_some());
        for bad in [
            "krita/pack.json",
            "../Cargo.toml",
            "mockups/../krita/pack.json",
            "/etc/passwd",
            "mockups/tee-front/fehlt.png",
            "mockups",
            "",
            "C:/x",
        ] {
            assert!(resolve_asset(&root, bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn broken_template_is_skipped_not_fatal() {
        let tmp = tempfile::tempdir().unwrap();
        let good = tmp.path().join("social/gut");
        let bad = tmp.path().join("social/kaputt");
        std::fs::create_dir_all(&good).unwrap();
        std::fs::create_dir_all(&bad).unwrap();
        std::fs::write(bad.join("template.json"), b"{ nicht json").unwrap();
        std::fs::write(
            good.join("template.json"),
            serde_json::json!({
                "id": "gut", "title": "Gut", "format": "post", "size": { "width": 1080, "height": 1350 },
                "background": { "type": "solid", "color": "#ffffff" }, "layers": [], "safeZones": [], "gridCrop": null,
                "preview": "preview.png"
            })
            .to_string(),
        )
        .unwrap();
        let loaded = load_social_templates(tmp.path());
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "gut");
    }
}
