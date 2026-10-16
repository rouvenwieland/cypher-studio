//! Vorschaubilder ohne Fremdprogramme (ARCHITEKTUR.md 2.12).
//!
//! - PNG, JPEG, WebP, TIFF, GIF, BMP: `image`
//! - SVG: `resvg` (gerastert, keine Skripte, keine Netzwerkzugriffe; Text nur mit geladenen Markenschriften)
//! - `.kra`/`.ora`: ZIP mit eingebettetem Vorschaubild
//! - `.blend`: eingebettete Vorschau (Block `TEST`), unkomprimierte und gzip-Dateien
//!
//! Die Bilder liegen im lokalen Cache, nicht im geteilten Ordner. Schlüssel = Hash aus Pfad, Größe und Änderungszeit.

use std::io::Read;
use std::path::{Path, PathBuf};

use crate::error::{IoError, LibraryError};
use crate::platform::fsx;
use crate::util::short_hash;

use super::model::extension_of;

/// Längste Seite eines Vorschaubilds.
pub const THUMB_MAX_PX: u32 = 512;
/// Größere Quellbilder werden nicht dekodiert (Speicher).
const MAX_SOURCE_PIXELS: u64 = 120_000_000;
/// Größte Datei, die für eine Vorschau gelesen wird.
const MAX_SOURCE_BYTES: u64 = 512 * 1024 * 1024;

/// Einstellungen der Vorschau.
#[derive(Debug, Clone, Default)]
pub struct ThumbConfig {
    /// Schriftdateien, die SVG-Text beim Rastern benutzen darf.
    pub fonts: Vec<PathBuf>,
}

fn decode_err(what: &str, e: impl std::fmt::Display) -> LibraryError {
    LibraryError::InvalidInput { field: "thumbnail".into(), reason: format!("{what}: {e}") }
}

fn png_bytes(img: &image::DynamicImage) -> Result<Vec<u8>, LibraryError> {
    let rgba = img.to_rgba8();
    let mut out = Vec::new();
    let mut enc = png::Encoder::new(&mut out, rgba.width(), rgba.height());
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_compression(png::Compression::Fast);
    let mut w = enc.write_header().map_err(|e| decode_err("PNG", e))?;
    w.write_image_data(rgba.as_raw()).map_err(|e| decode_err("PNG", e))?;
    w.finish().map_err(|e| decode_err("PNG", e))?;
    Ok(out)
}

fn fit(img: image::DynamicImage) -> image::DynamicImage {
    if img.width() <= THUMB_MAX_PX && img.height() <= THUMB_MAX_PX {
        img
    } else {
        img.thumbnail(THUMB_MAX_PX, THUMB_MAX_PX)
    }
}

fn from_raster_file(path: &Path) -> Result<image::DynamicImage, LibraryError> {
    let reader = image::ImageReader::open(path)
        .map_err(|e| IoError::read(path, e))?
        .with_guessed_format()
        .map_err(|e| IoError::read(path, e))?;
    let (w, h) = reader.into_dimensions().map_err(|e| decode_err("Bild", e))?;
    if u64::from(w) * u64::from(h) > MAX_SOURCE_PIXELS {
        return Err(decode_err("Bild", "zu groß für eine Vorschau"));
    }
    image::open(path).map_err(|e| decode_err("Bild", e))
}

fn from_raster_bytes(bytes: &[u8]) -> Result<image::DynamicImage, LibraryError> {
    image::load_from_memory(bytes).map_err(|e| decode_err("Bild", e))
}

fn from_svg(path: &Path, config: &ThumbConfig) -> Result<image::DynamicImage, LibraryError> {
    let data = std::fs::read(path).map_err(|e| IoError::read(path, e))?;
    if data.len() as u64 > 32 * 1024 * 1024 {
        return Err(decode_err("SVG", "Datei zu groß"));
    }
    let mut options = resvg::usvg::Options::default();
    {
        let db = options.fontdb_mut();
        for f in &config.fonts {
            if let Ok(bytes) = std::fs::read(f) {
                db.load_font_data(bytes);
            }
        }
    }
    let tree = resvg::usvg::Tree::from_data(&data, &options).map_err(|e| decode_err("SVG", e))?;
    let size = tree.size();
    let (w, h) = (size.width().max(1.0), size.height().max(1.0));
    let scale = (f64::from(THUMB_MAX_PX) / f64::from(w.max(h))).min(4.0) as f32;
    let (pw, ph) = (((w * scale).round() as u32).max(1), ((h * scale).round() as u32).max(1));
    let mut pixmap = resvg::tiny_skia::Pixmap::new(pw, ph).ok_or_else(|| decode_err("SVG", "Größe ungültig"))?;
    resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    // tiny-skia liefert vormultipliziertes RGBA; für PNG mit geradem Alpha zurückrechnen
    let mut rgba = pixmap.take();
    for px in rgba.chunks_exact_mut(4) {
        let a = u32::from(px[3]);
        if a != 0 && a != 255 {
            for c in &mut px[..3] {
                *c = ((u32::from(*c) * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    let img = image::RgbaImage::from_raw(pw, ph, rgba).ok_or_else(|| decode_err("SVG", "Pixeldaten"))?;
    Ok(image::DynamicImage::ImageRgba8(img))
}

fn read_zip_entry(path: &Path, names: &[&str]) -> Result<Vec<u8>, LibraryError> {
    let file = std::fs::File::open(path).map_err(|e| IoError::read(path, e))?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|e| decode_err("ZIP", e))?;
    for name in names {
        if let Ok(mut entry) = zip.by_name(name) {
            if entry.size() > 64 * 1024 * 1024 {
                continue;
            }
            let mut buf = Vec::with_capacity(entry.size() as usize);
            entry.by_ref().take(64 * 1024 * 1024).read_to_end(&mut buf).map_err(|e| decode_err("ZIP", e))?;
            return Ok(buf);
        }
    }
    Err(decode_err("ZIP", "kein eingebettetes Vorschaubild"))
}

fn le_u32(b: &[u8]) -> u32 {
    u32::from_le_bytes([b[0], b[1], b[2], b[3]])
}
fn be_u32(b: &[u8]) -> u32 {
    u32::from_be_bytes([b[0], b[1], b[2], b[3]])
}

/// Liest das eingebettete Vorschaubild einer `.blend`-Datei (Block `TEST`). `None`, wenn es keins gibt oder die Datei
/// anders komprimiert ist (zstd).
pub fn blend_thumbnail(bytes: &[u8]) -> Option<image::RgbaImage> {
    let plain;
    let data: &[u8] = if bytes.starts_with(&[0x1f, 0x8b]) {
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(bytes).take(256 * 1024 * 1024).read_to_end(&mut out).ok()?;
        plain = out;
        &plain
    } else {
        bytes
    };
    if !data.starts_with(b"BLENDER") || data.len() < 17 {
        return None;
    }
    // Kopf: alt `BLENDER-v280` (Zeigergröße `_`/`-`, Byte-Reihenfolge `v`/`V`), neu `BLENDER17-01v0500`
    let (header_len, ptr_size, little, large) = if data[7].is_ascii_digit() && data[8].is_ascii_digit() {
        let len: usize = std::str::from_utf8(&data[7..9]).ok()?.parse().ok()?;
        (len, 8usize, data[12] == b'v', true)
    } else {
        (12, if data[7] == b'-' { 8 } else { 4 }, data[8] == b'v', false)
    };
    let u32_at = |b: &[u8]| if little { le_u32(b) } else { be_u32(b) };
    let mut pos = header_len;
    for _ in 0..4000 {
        let (code, len, head) = if large {
            let head = pos.checked_add(32)?;
            let h = data.get(pos..head)?;
            let len = i64::from_le_bytes(h[16..24].try_into().ok()?);
            (&h[..4], usize::try_from(len).ok()?, 32)
        } else {
            let head = 16 + ptr_size;
            let h = data.get(pos..pos + head)?;
            (&h[..4], u32_at(&h[4..8]) as usize, head)
        };
        let start = pos.checked_add(head)?;
        if code == b"ENDB" || code == b"DNA1" {
            return None;
        }
        if code == b"TEST" {
            let block = data.get(start..start.checked_add(len)?)?;
            if block.len() < 8 {
                return None;
            }
            let (w, h) = (u32_at(&block[0..4]), u32_at(&block[4..8]));
            if w == 0 || h == 0 || w > 4096 || h > 4096 || block.len() < 8 + (w * h * 4) as usize {
                return None;
            }
            let px = &block[8..8 + (w * h * 4) as usize];
            // Zeilen stehen unten-nach-oben
            let mut rgba = Vec::with_capacity(px.len());
            for row in (0..h as usize).rev() {
                rgba.extend_from_slice(&px[row * w as usize * 4..(row + 1) * w as usize * 4]);
            }
            return image::RgbaImage::from_raw(w, h, rgba);
        }
        pos = start.checked_add(len)?;
    }
    None
}

fn from_blend(path: &Path) -> Result<image::DynamicImage, LibraryError> {
    let meta = std::fs::metadata(path).map_err(|e| IoError::read(path, e))?;
    if meta.len() > MAX_SOURCE_BYTES {
        return Err(decode_err("Blender", "Datei zu groß"));
    }
    // Die Vorschau steht am Anfang der Datei; unkomprimierte Dateien nur teilweise lesen
    let mut head = Vec::new();
    std::fs::File::open(path)
        .map_err(|e| IoError::read(path, e))?
        .take(24 * 1024 * 1024)
        .read_to_end(&mut head)
        .map_err(|e| IoError::read(path, e))?;
    let img = if head.starts_with(&[0x1f, 0x8b]) {
        let all = std::fs::read(path).map_err(|e| IoError::read(path, e))?;
        blend_thumbnail(&all)
    } else {
        blend_thumbnail(&head)
    };
    img.map(image::DynamicImage::ImageRgba8).ok_or_else(|| decode_err("Blender", "keine eingebettete Vorschau"))
}

/// Erzeugt das Vorschaubild als PNG-Bytes.
pub fn render(path: &Path, config: &ThumbConfig) -> Result<Vec<u8>, LibraryError> {
    let ext = extension_of(&path.to_string_lossy());
    let md = std::fs::metadata(path).map_err(|e| IoError::read(path, e))?;
    if md.len() > MAX_SOURCE_BYTES {
        return Err(decode_err("Datei", "zu groß für eine Vorschau"));
    }
    let img = match ext.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "tif" | "tiff" | "gif" | "bmp" => from_raster_file(path)?,
        "svg" => from_svg(path, config)?,
        "kra" => from_raster_bytes(&read_zip_entry(path, &["mergedimage.png", "preview.png"])?)?,
        "ora" => from_raster_bytes(&read_zip_entry(path, &["Thumbnails/thumbnail.png", "mergedimage.png"])?)?,
        "blend" => from_blend(path)?,
        _ => return Err(decode_err("Datei", "keine Vorschau für diese Art")),
    };
    png_bytes(&fit(img))
}

/// Dateiname im Cache.
pub fn cache_key(rel: &str, size: u64, modified_ms: i64) -> String {
    format!("{}.png", short_hash(&format!("{rel}|{size}|{modified_ms}|v1")))
}

/// Liefert die Cache-Datei, erzeugt sie bei Bedarf.
pub fn ensure(
    thumbs_dir: &Path,
    source: &Path,
    rel: &str,
    size: u64,
    modified_ms: i64,
    config: &ThumbConfig,
) -> Result<PathBuf, LibraryError> {
    let target = thumbs_dir.join(cache_key(rel, size, modified_ms));
    if target.is_file() {
        return Ok(target);
    }
    let bytes = render(source, config)?;
    fsx::write_atomic(&target, &bytes)?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_file(dir: &Path, name: &str, w: u32, h: u32, rgba: [u8; 4]) -> PathBuf {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba(rgba));
        let p = dir.join(name);
        img.save(&p).unwrap();
        p
    }

    fn decode(bytes: &[u8]) -> image::RgbaImage {
        image::load_from_memory(bytes).unwrap().to_rgba8()
    }

    #[test]
    fn raster_images_are_scaled_to_512_and_keep_the_aspect_ratio() {
        let tmp = tempfile::tempdir().unwrap();
        let p = png_file(tmp.path(), "gross.png", 2000, 1000, [10, 200, 30, 255]);
        let t = decode(&render(&p, &ThumbConfig::default()).unwrap());
        assert_eq!((t.width(), t.height()), (512, 256));
        let small = png_file(tmp.path(), "klein.png", 40, 30, [1, 2, 3, 255]);
        let t = decode(&render(&small, &ThumbConfig::default()).unwrap());
        assert_eq!((t.width(), t.height()), (40, 30), "kleine Bilder bleiben");
    }

    #[test]
    fn svg_is_rasterised_with_transparency() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("a.svg");
        std::fs::write(&p, r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect x="0" y="0" width="100" height="100" fill="#ff0000"/></svg>"##).unwrap();
        let t = decode(&render(&p, &ThumbConfig::default()).unwrap());
        assert_eq!((t.width(), t.height()), (512, 256));
        assert_eq!(t.get_pixel(10, 10).0, [255, 0, 0, 255]);
        assert_eq!(t.get_pixel(500, 10).0[3], 0, "rechte Hälfte ist transparent");
        let bad = tmp.path().join("b.svg");
        std::fs::write(&bad, b"<svg nicht zu Ende").unwrap();
        assert!(render(&bad, &ThumbConfig::default()).is_err());
    }

    #[test]
    fn kra_uses_the_merged_image_from_the_zip() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("a.kra");
        let mut inner = Vec::new();
        image::RgbaImage::from_pixel(64, 64, image::Rgba([9, 8, 7, 255]))
            .write_to(&mut std::io::Cursor::new(&mut inner), image::ImageFormat::Png)
            .unwrap();
        let file = std::fs::File::create(&p).unwrap();
        let mut zw = zip::ZipWriter::new(file);
        zw.start_file("mimetype", zip::write::SimpleFileOptions::default()).unwrap();
        std::io::Write::write_all(&mut zw, b"application/x-krita").unwrap();
        zw.start_file("mergedimage.png", zip::write::SimpleFileOptions::default()).unwrap();
        std::io::Write::write_all(&mut zw, &inner).unwrap();
        zw.finish().unwrap();
        let t = decode(&render(&p, &ThumbConfig::default()).unwrap());
        assert_eq!((t.width(), t.height()), (64, 64));
        assert_eq!(t.get_pixel(1, 1).0, [9, 8, 7, 255]);
        // ohne eingebettetes Bild: Fehler statt Absturz
        let empty = tmp.path().join("leer.kra");
        let mut zw = zip::ZipWriter::new(std::fs::File::create(&empty).unwrap());
        zw.start_file("x", zip::write::SimpleFileOptions::default()).unwrap();
        zw.finish().unwrap();
        assert!(render(&empty, &ThumbConfig::default()).is_err());
    }

    fn blend_bytes(large: bool, thumb_w: u32, thumb_h: u32) -> Vec<u8> {
        let mut out = Vec::new();
        let mut pixels = Vec::new();
        for y in 0..thumb_h {
            for x in 0..thumb_w {
                // untere Zeile (y = 0 in Blender) rot, obere blau
                let top = y == thumb_h - 1;
                pixels.extend(if top { [0u8, 0, 255, 255] } else { [255, 0, 0, 255] });
                let _ = x;
            }
        }
        let mut block = Vec::new();
        block.extend(thumb_w.to_le_bytes());
        block.extend(thumb_h.to_le_bytes());
        block.extend(&pixels);
        if large {
            out.extend(b"BLENDER17-01v0500");
            // REND-Block ohne Inhalt, dann TEST
            let head = |code: &[u8; 4], len: usize, out: &mut Vec<u8>| {
                out.extend(code);
                out.extend(0i32.to_le_bytes());
                out.extend(0u64.to_le_bytes());
                out.extend((len as i64).to_le_bytes());
                out.extend(1i64.to_le_bytes());
            };
            head(b"REND", 4, &mut out);
            out.extend([0u8; 4]);
            head(b"TEST", block.len(), &mut out);
            out.extend(&block);
            head(b"ENDB", 0, &mut out);
        } else {
            out.extend(b"BLENDER-v280");
            let head = |code: &[u8; 4], len: usize, out: &mut Vec<u8>| {
                out.extend(code);
                out.extend((len as u32).to_le_bytes());
                out.extend(0u64.to_le_bytes());
                out.extend(0u32.to_le_bytes());
                out.extend(1u32.to_le_bytes());
            };
            head(b"REND", 4, &mut out);
            out.extend([0u8; 4]);
            head(b"TEST", block.len(), &mut out);
            out.extend(&block);
            head(b"ENDB", 0, &mut out);
        }
        out
    }

    #[test]
    fn blend_thumbnail_old_and_new_header_and_gzip() {
        for large in [false, true] {
            let data = blend_bytes(large, 4, 3);
            let img = blend_thumbnail(&data).unwrap_or_else(|| panic!("large={large}"));
            assert_eq!((img.width(), img.height()), (4, 3));
            // Blender speichert unten-nach-oben: die zuletzt gespeicherte Zeile ist oben im Bild
            assert_eq!(img.get_pixel(0, 0).0, [0, 0, 255, 255], "large={large}");
            assert_eq!(img.get_pixel(0, 2).0, [255, 0, 0, 255]);
        }
        let mut gz = Vec::new();
        {
            let mut enc = flate2::write::GzEncoder::new(&mut gz, flate2::Compression::fast());
            std::io::Write::write_all(&mut enc, &blend_bytes(false, 2, 2)).unwrap();
            enc.finish().unwrap();
        }
        assert!(blend_thumbnail(&gz).is_some());
        // zstd und Müll: keine Vorschau, kein Absturz
        assert!(blend_thumbnail(&[0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3]).is_none());
        assert!(blend_thumbnail(b"BLENDER-v280").is_none());
        assert!(blend_thumbnail(b"").is_none());
        let mut broken = blend_bytes(false, 4, 3);
        broken.truncate(60);
        assert!(blend_thumbnail(&broken).is_none());
    }

    #[test]
    fn cache_reuses_files_and_changes_with_size_or_time() {
        let tmp = tempfile::tempdir().unwrap();
        let p = png_file(tmp.path(), "a.png", 10, 10, [1, 1, 1, 255]);
        let cache = tmp.path().join("cache");
        let a = ensure(&cache, &p, "a.png", 10, 1000, &ThumbConfig::default()).unwrap();
        let before = std::fs::metadata(&a).unwrap().modified().unwrap();
        let again = ensure(&cache, &p, "a.png", 10, 1000, &ThumbConfig::default()).unwrap();
        assert_eq!(a, again);
        assert_eq!(std::fs::metadata(&again).unwrap().modified().unwrap(), before);
        assert_ne!(cache_key("a.png", 10, 1000), cache_key("a.png", 11, 1000));
        assert_ne!(cache_key("a.png", 10, 1000), cache_key("a.png", 10, 2000));
    }

    #[test]
    fn unsupported_kinds_have_no_thumbnail() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("a.mp4");
        std::fs::write(&p, b"x").unwrap();
        assert!(render(&p, &ThumbConfig::default()).is_err());
    }
}
