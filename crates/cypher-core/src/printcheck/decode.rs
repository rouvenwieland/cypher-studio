//! Pixel dekodieren: intern immer RGBA mit 8 Bit je Kanal und geradem (nicht vormultipliziertem) Alpha.
//!
//! PNG läuft direkt über das `png`-Crate (Paletten, `tRNS`, 16 Bit, Adam7 und Graustufen werden bereits beim
//! Dekodieren auf RGBA8 gebracht), JPEG/TIFF/WebP über `image`. CMYK wird nicht dekodiert: dort genügt der Befund.

use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use crate::error::{IoError, PrintError};

use super::meta::{Channels, ImageMeta, ImgFormat};

/// Grenzen für das Dekodieren (ARCHITEKTUR.md 2.13).
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_pixels: u64,
    pub max_file_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Limits { max_pixels: 120_000_000, max_file_bytes: 512 * 1024 * 1024 }
    }
}

/// RGBA8, Zeile für Zeile, ohne Zwischenraum.
#[derive(Debug, Clone)]
pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

impl DecodedImage {
    /// Leeres, vollständig transparentes Bild.
    pub fn transparent(width: u32, height: u32) -> Result<Self, PrintError> {
        let len = checked_len(width, height)?;
        Ok(DecodedImage { width, height, rgba: vec![0; len] })
    }

    pub fn pixel_count(&self) -> u64 {
        u64::from(self.width) * u64::from(self.height)
    }

    /// Eine Pixelzeile (4 Bytes je Pixel).
    pub fn row(&self, y: u32) -> &[u8] {
        let stride = self.width as usize * 4;
        let start = y as usize * stride;
        &self.rgba[start..start + stride]
    }
}

fn checked_len(width: u32, height: u32) -> Result<usize, PrintError> {
    (width as usize)
        .checked_mul(height as usize)
        .and_then(|n| n.checked_mul(4))
        .ok_or_else(|| PrintError::Decode("Bild zu groß für den Speicher".into()))
}

/// Dekodiert die Datei. `meta` stammt aus [`super::meta::read_meta`] und hat die Größe schon geprüft.
pub fn decode(path: &Path, meta: &ImageMeta, limits: &Limits) -> Result<DecodedImage, PrintError> {
    if meta.file_bytes > limits.max_file_bytes {
        return Err(PrintError::Decode(format!(
            "Datei ist mit {} MB größer als die erlaubten {} MB",
            meta.file_bytes / (1024 * 1024),
            limits.max_file_bytes / (1024 * 1024)
        )));
    }
    if u64::from(meta.width) * u64::from(meta.height) > limits.max_pixels {
        return Err(PrintError::TooLarge { width: meta.width, height: meta.height, max_pixels: limits.max_pixels });
    }
    if meta.channels == Channels::Cmyk {
        return Err(PrintError::Decode("CMYK-Bilder werden nicht dekodiert".into()));
    }
    match meta.format {
        ImgFormat::Png => decode_png(path, meta),
        ImgFormat::Jpeg | ImgFormat::Tiff | ImgFormat::Webp => decode_with_image(path, meta, limits),
    }
}

fn decode_png(path: &Path, meta: &ImageMeta) -> Result<DecodedImage, PrintError> {
    let file = File::open(path).map_err(|e| IoError::read(path, e))?;
    let len = checked_len(meta.width, meta.height)?;
    // Zwischenpuffer darf höchstens das Vierfache des RGBA-Puffers belegen (Palette/16 Bit werden vorher expandiert)
    let mut decoder =
        png::Decoder::new_with_limits(BufReader::new(file), png::Limits { bytes: len.saturating_mul(2).max(1 << 20) });
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    decoder.set_ignore_iccp_chunk(true);
    decoder.set_ignore_text_chunk(true);
    let mut reader = decoder.read_info().map_err(|e| PrintError::Decode(format!("PNG: {e}")))?;
    let size =
        reader.output_buffer_size().ok_or_else(|| PrintError::Decode("PNG: Puffergröße nicht darstellbar".into()))?;
    let mut raw = vec![0u8; size];
    let info = reader.next_frame(&mut raw).map_err(|e| PrintError::Decode(format!("PNG: {e}")))?;
    raw.truncate(info.line_size * info.height as usize);
    let rgba = match (info.color_type, info.bit_depth) {
        (png::ColorType::Rgba, png::BitDepth::Eight) => raw,
        (png::ColorType::Rgb, png::BitDepth::Eight) => expand(&raw, 3, |s, d| {
            d[..3].copy_from_slice(s);
            d[3] = 255;
        }),
        (png::ColorType::GrayscaleAlpha, png::BitDepth::Eight) => expand(&raw, 2, |s, d| {
            d[..3].fill(s[0]);
            d[3] = s[1];
        }),
        (png::ColorType::Grayscale, png::BitDepth::Eight) => expand(&raw, 1, |s, d| {
            d[..3].fill(s[0]);
            d[3] = 255;
        }),
        (color, depth) => return Err(PrintError::Decode(format!("PNG-Ausgabeformat {color:?}/{depth:?} unerwartet"))),
    };
    if rgba.len() != len {
        return Err(PrintError::Decode("PNG: Pixelzahl passt nicht zur Kopfzeile".into()));
    }
    Ok(DecodedImage { width: info.width, height: info.height, rgba })
}

/// Wandelt `channels`-Byte-Pixel in RGBA-Pixel um.
fn expand(raw: &[u8], channels: usize, f: impl Fn(&[u8], &mut [u8])) -> Vec<u8> {
    let mut out = vec![0u8; raw.len() / channels * 4];
    for (s, d) in raw.chunks_exact(channels).zip(out.chunks_exact_mut(4)) {
        f(s, d);
    }
    out
}

fn decode_with_image(path: &Path, meta: &ImageMeta, limits: &Limits) -> Result<DecodedImage, PrintError> {
    let file = File::open(path).map_err(|e| IoError::read(path, e))?;
    let mut reader = image::ImageReader::new(BufReader::new(file));
    let format = match meta.format {
        ImgFormat::Jpeg => image::ImageFormat::Jpeg,
        ImgFormat::Tiff => image::ImageFormat::Tiff,
        ImgFormat::Webp => image::ImageFormat::WebP,
        ImgFormat::Png => image::ImageFormat::Png,
    };
    reader.set_format(format);
    let mut lim = image::Limits::default();
    lim.max_image_width = Some(meta.width.max(1));
    lim.max_image_height = Some(meta.height.max(1));
    lim.max_alloc = Some(limits.max_pixels.saturating_mul(8));
    reader.limits(lim);
    let decoded = reader.decode().map_err(|e| PrintError::Decode(format!("{}: {e}", meta.format.name())))?;
    let rgba = decoded.into_rgba8();
    let (width, height) = rgba.dimensions();
    Ok(DecodedImage { width, height, rgba: rgba.into_raw() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_converts_gray_and_rgb() {
        let rgba = expand(&[10, 128, 20, 0], 2, |s, d| {
            d[..3].fill(s[0]);
            d[3] = s[1];
        });
        assert_eq!(rgba, vec![10, 10, 10, 128, 20, 20, 20, 0]);
    }

    #[test]
    fn transparent_image_has_the_right_size() {
        let img = DecodedImage::transparent(3, 2).unwrap();
        assert_eq!(img.rgba.len(), 24);
        assert_eq!(img.pixel_count(), 6);
        assert_eq!(img.row(1).len(), 12);
    }

    #[test]
    fn limits_have_the_documented_defaults() {
        let l = Limits::default();
        assert_eq!(l.max_pixels, 120_000_000);
        assert_eq!(l.max_file_bytes, 512 * 1024 * 1024);
    }
}
