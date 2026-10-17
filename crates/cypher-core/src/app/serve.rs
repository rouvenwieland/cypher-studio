//! Inhalte für die Protokolle `cyfile`, `cythumb` und `cyasset` (ARCHITEKTUR.md 6.3).
//!
//! Hier steht die ganze Entscheidung, was ausgeliefert wird; die Tauri-Schicht verpackt nur noch Kopfzeilen. Jede Ablehnung
//! ist `None` und wird dort zu einem 404 ohne Details.

use std::path::Path;
use std::sync::Arc;

use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

use crate::brand::resolve_asset;
use crate::library::model::{extension_of, mime_of};
use crate::platform::fsx;
use crate::printcheck::export::crop_and_scale;
use crate::printcheck::scan::PxRect;
use crate::printcheck::{DecodedImage, Limits, read_meta};

use super::App;
use super::handles::{is_servable_image, sniff_mime};

/// Größte ausgelieferte Datei.
const MAX_SERVE_BYTES: u64 = 256 * 1024 * 1024;
/// Größte Kantenlänge einer Vorschau.
pub const PREVIEW_MAX_SIDE: u32 = 4096;
/// So viele Vorschauen bleiben im Zwischenspeicher.
const PREVIEW_KEEP: usize = 40;
/// Pakete enthalten nur kleine Dateien; alles darüber wird nicht ausgeliefert.
const MAX_ASSET_BYTES: u64 = 64 * 1024 * 1024;

/// Wie lange der Browser eine Antwort behalten darf.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CachePolicy {
    NoStore,
    MaxAge(u32),
}

/// Eine Antwort der eigenen Protokolle.
#[derive(Debug, Clone)]
pub struct Served {
    pub mime: String,
    pub body: Vec<u8>,
    pub cache: CachePolicy,
}

/// Vorschau nötig? TIFF und 16 Bit kann der Browser nicht oder falsch anzeigen, riesige Bilder sprengen die Leinwand.
fn needs_preview(mime: &str, meta: Option<&crate::printcheck::ImageMeta>) -> bool {
    mime == "image/tiff" || meta.is_some_and(|m| m.bit_depth == 16 || m.width.max(m.height) > PREVIEW_MAX_SIDE)
}

fn preview_key(path: &Path, len: u64, modified: Option<std::time::SystemTime>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(len.to_le_bytes());
    if let Some(t) = modified.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()) {
        hasher.update(t.as_nanos().to_le_bytes());
    }
    hex::encode(hasher.finalize())[..32].to_owned()
}

/// Hält höchstens `PREVIEW_KEEP` Vorschauen (die ältesten gehen zuerst).
fn prune_previews(dir: &Path) {
    let Ok(read) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<_> =
        read.filter_map(Result::ok).filter_map(|e| Some((e.path(), e.metadata().ok()?.modified().ok()?))).collect();
    if files.len() <= PREVIEW_KEEP {
        return;
    }
    files.sort_by_key(|(_, t)| *t);
    let excess = files.len() - PREVIEW_KEEP;
    for (path, _) in files.into_iter().take(excess) {
        let _ = std::fs::remove_file(path);
    }
}

impl App {
    /// `cyfile://localhost/<handleId>`: nur registrierte Handles und nur Bilder (kein SVG).
    pub async fn serve_file(self: &Arc<Self>, handle_id: &str) -> Option<Served> {
        let path = self.handles.resolve(handle_id)?;
        let this = self.clone();
        Self::blocking(move || this.serve_file_blocking(&path)).await.ok().flatten()
    }

    fn serve_file_blocking(&self, path: &Path) -> Option<Served> {
        let md = std::fs::metadata(path).ok()?;
        if !md.is_file() || md.len() > MAX_SERVE_BYTES {
            return None;
        }
        let mime = sniff_mime(path);
        if !is_servable_image(&mime) {
            return None;
        }
        let limits = Limits::default();
        let meta = read_meta(path, limits.max_pixels).ok();
        if !needs_preview(&mime, meta.as_ref()) {
            let body = std::fs::read(path).ok()?;
            return Some(Served { mime, body, cache: CachePolicy::NoStore });
        }
        // Ohne lesbare Metadaten gibt es keine Vorschau (z. B. ein TIFF in einem Format, das wir nicht dekodieren)
        let meta = meta?;
        let dir = self.dirs.cache.join("previews");
        let file = dir.join(format!("{}.png", preview_key(path, md.len(), md.modified().ok())));
        if let Ok(body) = std::fs::read(&file) {
            return Some(Served { mime: "image/png".into(), body, cache: CachePolicy::NoStore });
        }
        let image = crate::printcheck::decode::decode(path, &meta, &limits).ok()?;
        let longest = image.width.max(image.height);
        let image = if longest > PREVIEW_MAX_SIDE {
            let scale = f64::from(PREVIEW_MAX_SIDE) / f64::from(longest);
            let out_w = ((f64::from(image.width) * scale).round() as u32).max(1);
            let out_h = ((f64::from(image.height) * scale).round() as u32).max(1);
            let full = PxRect { x0: 0, y0: 0, x1: image.width, y1: image.height };
            let rgba = crop_and_scale(&image, full, out_w, out_h, &CancellationToken::new()).ok()?;
            DecodedImage { width: out_w, height: out_h, rgba }
        } else {
            image
        };
        let body = crate::bgremove::encode_png(&image).ok()?;
        if fsx::write_atomic(&file, &body).is_ok() {
            prune_previews(&dir);
        }
        Some(Served { mime: "image/png".into(), body, cache: CachePolicy::NoStore })
    }

    /// `cythumb://localhost/<entryId>`: Vorschaubilder der Bibliothek.
    pub async fn serve_thumbnail(self: &Arc<Self>, entry_id: &str) -> Option<Served> {
        let path = self.library_thumbnail_path(entry_id).await.ok()?;
        Self::blocking(move || {
            let md = std::fs::metadata(&path).ok()?;
            if md.len() > MAX_ASSET_BYTES {
                return None;
            }
            let mime = sniff_mime(&path);
            is_servable_image(&mime).then_some(())?;
            Some(Served { mime, body: std::fs::read(&path).ok()?, cache: CachePolicy::NoStore })
        })
        .await
        .ok()
        .flatten()
    }

    /// `cyasset://localhost/<pfad>`: Dateien der Pakete; `..`, fremde Ordner und unbekannte Dateiarten gibt es nicht.
    pub async fn serve_asset(self: &Arc<Self>, rel: &str) -> Option<Served> {
        let path = resolve_asset(&self.packs_root, rel)?;
        Self::blocking(move || {
            let md = std::fs::metadata(&path).ok()?;
            if md.len() > MAX_ASSET_BYTES {
                return None;
            }
            let mime = mime_of(&extension_of(&path.to_string_lossy()));
            let allowed = matches!(mime, "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml")
                || mime.starts_with("font/");
            allowed.then_some(())?;
            Some(Served { mime: mime.to_owned(), body: std::fs::read(&path).ok()?, cache: CachePolicy::MaxAge(86_400) })
        })
        .await
        .ok()
        .flatten()
    }
}
