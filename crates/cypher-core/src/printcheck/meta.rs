//! Bildmetadaten lesen, ohne die Pixel zu dekodieren: Format, Maße, Bittiefe, Kanäle, Auflösung (`pHYs`, JFIF,
//! EXIF, TIFF-Tags), eingebettetes Profil (`iCCP`, APP2), `sRGB`-Marke, Animation, Interlace
//! (docs/research/vorgaben.md 5.1).

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use crate::api::DpiSource;
use crate::error::{IoError, PrintError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImgFormat {
    Png,
    Jpeg,
    Tiff,
    Webp,
}

impl ImgFormat {
    pub fn name(self) -> &'static str {
        match self {
            ImgFormat::Png => "png",
            ImgFormat::Jpeg => "jpeg",
            ImgFormat::Tiff => "tiff",
            ImgFormat::Webp => "webp",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channels {
    Gray,
    GrayAlpha,
    Rgb,
    Rgba,
    Cmyk,
    Indexed,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImageMeta {
    pub format: ImgFormat,
    pub width: u32,
    pub height: u32,
    pub bit_depth: u8,
    pub channels: Channels,
    /// Es gibt einen Alphakanal oder (PNG) eine `tRNS`-Transparenz.
    pub has_alpha: bool,
    pub interlaced: bool,
    /// APNG (`acTL`).
    pub animated: bool,
    /// Auflösung in dpi mit Quelle; `None`, wenn nicht angegeben oder nur ein Seitenverhältnis.
    pub dpi: Option<(f64, f64, DpiSource)>,
    /// Eingebettetes ICC-Profil (PNG `iCCP`, JPEG APP2, TIFF-Tag 34675).
    pub icc: Option<Vec<u8>>,
    pub srgb_chunk: bool,
    pub file_bytes: u64,
    /// PNG-Pixel pro Meter (für die Prüfung auf 11811).
    pub png_ppm: Option<(u32, u32)>,
}

/// Erkennt das Format an den ersten Bytes (nicht an der Endung).
pub fn sniff(head: &[u8]) -> Option<ImgFormat> {
    if head.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some(ImgFormat::Png)
    } else if head.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(ImgFormat::Jpeg)
    } else if head.starts_with(&[b'I', b'I', 0x2A, 0x00]) || head.starts_with(&[b'M', b'M', 0x00, 0x2A]) {
        Some(ImgFormat::Tiff)
    } else if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        Some(ImgFormat::Webp)
    } else {
        None
    }
}

/// Liest die Metadaten einer Bilddatei.
pub fn read_meta(path: &Path, max_pixels: u64) -> Result<ImageMeta, PrintError> {
    let mut file = File::open(path).map_err(|e| IoError::read(path, e))?;
    let file_bytes = file.metadata().map_err(|e| IoError::read(path, e))?.len();
    let mut head = [0u8; 16];
    let n = file.read(&mut head).map_err(|e| IoError::read(path, e))?;
    let format = sniff(&head[..n]).ok_or_else(|| PrintError::UnsupportedFormat { format: extension_of(path) })?;
    let meta = match format {
        ImgFormat::Png => read_png(path, file_bytes)?,
        ImgFormat::Jpeg => read_jpeg(path, file_bytes)?,
        ImgFormat::Tiff => read_tiff(path, file_bytes)?,
        ImgFormat::Webp => read_webp(path, file_bytes)?,
    };
    let pixels = u64::from(meta.width) * u64::from(meta.height);
    if meta.width == 0 || meta.height == 0 {
        return Err(PrintError::Decode("Bild hat die Größe 0".into()));
    }
    if pixels > max_pixels {
        return Err(PrintError::TooLarge { width: meta.width, height: meta.height, max_pixels });
    }
    Ok(meta)
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| "unbekannt".into())
}

fn ppu_to_dpi(ppu: u32) -> f64 {
    f64::from(ppu) * 0.0254
}

// ---------------------------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------------------------

fn read_png(path: &Path, file_bytes: u64) -> Result<ImageMeta, PrintError> {
    let open = |ignore_iccp: bool| -> Result<png::Reader<BufReader<File>>, png::DecodingError> {
        let file = File::open(path).map_err(png::DecodingError::IoError)?;
        let mut decoder = png::Decoder::new(BufReader::new(file));
        decoder.set_ignore_iccp_chunk(ignore_iccp);
        decoder.read_info()
    };
    let reader = open(false).or_else(|_| open(true)).map_err(|e| PrintError::Decode(format!("PNG: {e}")))?;
    let info = reader.info();
    let bit_depth = match info.bit_depth {
        png::BitDepth::One => 1,
        png::BitDepth::Two => 2,
        png::BitDepth::Four => 4,
        png::BitDepth::Eight => 8,
        png::BitDepth::Sixteen => 16,
    };
    let (channels, mut has_alpha) = match info.color_type {
        png::ColorType::Grayscale => (Channels::Gray, false),
        png::ColorType::GrayscaleAlpha => (Channels::GrayAlpha, true),
        png::ColorType::Rgb => (Channels::Rgb, false),
        png::ColorType::Rgba => (Channels::Rgba, true),
        png::ColorType::Indexed => (Channels::Indexed, false),
    };
    if info.trns.is_some() {
        has_alpha = true;
    }
    let (dpi, png_ppm) = match info.pixel_dims {
        Some(d) if d.unit == png::Unit::Meter && d.xppu > 0 && d.yppu > 0 => {
            (Some((ppu_to_dpi(d.xppu), ppu_to_dpi(d.yppu), DpiSource::PHYs)), Some((d.xppu, d.yppu)))
        }
        _ => (None, None),
    };
    Ok(ImageMeta {
        format: ImgFormat::Png,
        width: info.width,
        height: info.height,
        bit_depth,
        channels,
        has_alpha,
        interlaced: info.interlaced,
        animated: info.animation_control.is_some(),
        dpi,
        icc: info.icc_profile.as_ref().map(|c| c.to_vec()),
        srgb_chunk: info.srgb.is_some(),
        file_bytes,
        png_ppm,
    })
}

// ---------------------------------------------------------------------------------------------
// JPEG: Marker lesen (JFIF-Dichte, EXIF-Auflösung, ICC aus APP2, Komponentenzahl)
// ---------------------------------------------------------------------------------------------

fn read_jpeg(path: &Path, file_bytes: u64) -> Result<ImageMeta, PrintError> {
    // Die Kopfsegmente liegen vor den Bilddaten: 4 MiB reichen für große ICC-Profile
    let mut buf = Vec::new();
    File::open(path).and_then(|f| f.take(4 * 1024 * 1024).read_to_end(&mut buf)).map_err(|e| IoError::read(path, e))?;
    parse_jpeg_headers(&buf, file_bytes)
}

pub(crate) fn parse_jpeg_headers(buf: &[u8], file_bytes: u64) -> Result<ImageMeta, PrintError> {
    let bad = || PrintError::Decode("JPEG-Kopf beschädigt".into());
    if buf.len() < 4 || buf[0] != 0xFF || buf[1] != 0xD8 {
        return Err(bad());
    }
    let mut pos = 2;
    let (mut width, mut height, mut components, mut precision) = (0u32, 0u32, 0u8, 8u8);
    let mut jfif: Option<(u8, u16, u16)> = None;
    let mut exif_dpi: Option<(f64, f64)> = None;
    let mut icc_chunks: Vec<(u8, Vec<u8>)> = Vec::new();
    let mut progressive = false;
    let mut adobe_transform: Option<u8> = None;
    while pos + 4 <= buf.len() {
        if buf[pos] != 0xFF {
            return Err(bad());
        }
        let marker = buf[pos + 1];
        if marker == 0xFF {
            pos += 1;
            continue;
        }
        pos += 2;
        if marker == 0xD8 || (0xD0..=0xD7).contains(&marker) || marker == 0x01 {
            continue;
        }
        if marker == 0xDA || marker == 0xD9 {
            break; // Bilddaten beginnen
        }
        if pos + 2 > buf.len() {
            return Err(bad());
        }
        let len = u16::from_be_bytes([buf[pos], buf[pos + 1]]) as usize;
        if len < 2 || pos + len > buf.len() {
            return Err(bad());
        }
        let data = &buf[pos + 2..pos + len];
        match marker {
            0xE0 if data.starts_with(b"JFIF\0") && data.len() >= 12 => {
                jfif =
                    Some((data[7], u16::from_be_bytes([data[8], data[9]]), u16::from_be_bytes([data[10], data[11]])));
            }
            0xE1 if data.starts_with(b"Exif\0\0") => {
                exif_dpi = parse_exif_resolution(&data[6..]);
            }
            0xE2 if data.starts_with(b"ICC_PROFILE\0") && data.len() > 14 => {
                icc_chunks.push((data[12], data[14..].to_vec()));
            }
            0xEE if data.starts_with(b"Adobe") && data.len() >= 12 => {
                adobe_transform = Some(data[11]);
            }
            0xC0..=0xCF if !matches!(marker, 0xC4 | 0xC8 | 0xCC) && data.len() >= 6 => {
                precision = data[0];
                height = u32::from(u16::from_be_bytes([data[1], data[2]]));
                width = u32::from(u16::from_be_bytes([data[3], data[4]]));
                components = data[5];
                progressive = matches!(marker, 0xC2 | 0xC6 | 0xCA | 0xCE);
            }
            _ => {}
        }
        pos += len;
    }
    if width == 0 || height == 0 || components == 0 {
        return Err(bad());
    }
    let _ = adobe_transform;
    let dpi = match jfif {
        Some((1, x, y)) if x > 0 && y > 0 => Some((f64::from(x), f64::from(y), DpiSource::Jfif)),
        Some((2, x, y)) if x > 0 && y > 0 => Some((f64::from(x) * 2.54, f64::from(y) * 2.54, DpiSource::Jfif)),
        _ => exif_dpi.map(|(x, y)| (x, y, DpiSource::Exif)),
    };
    icc_chunks.sort_by_key(|(seq, _)| *seq);
    let icc = (!icc_chunks.is_empty()).then(|| icc_chunks.into_iter().flat_map(|(_, d)| d).collect::<Vec<u8>>());
    let channels = match components {
        1 => Channels::Gray,
        3 => Channels::Rgb,
        4 => Channels::Cmyk,
        _ => return Err(PrintError::Decode(format!("JPEG mit {components} Komponenten wird nicht unterstützt"))),
    };
    Ok(ImageMeta {
        format: ImgFormat::Jpeg,
        width,
        height,
        bit_depth: precision,
        channels,
        has_alpha: false,
        interlaced: progressive,
        animated: false,
        dpi,
        icc,
        srgb_chunk: false,
        file_bytes,
        png_ppm: None,
    })
}

/// Liest XResolution, YResolution, ResolutionUnit aus dem TIFF-Teil von EXIF (IFD0).
pub(crate) fn parse_exif_resolution(tiff: &[u8]) -> Option<(f64, f64)> {
    let little = match tiff.get(0..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let u16_at = |o: usize| -> Option<u16> {
        let b: [u8; 2] = tiff.get(o..o + 2)?.try_into().ok()?;
        Some(if little { u16::from_le_bytes(b) } else { u16::from_be_bytes(b) })
    };
    let u32_at = |o: usize| -> Option<u32> {
        let b: [u8; 4] = tiff.get(o..o + 4)?.try_into().ok()?;
        Some(if little { u32::from_le_bytes(b) } else { u32::from_be_bytes(b) })
    };
    if u16_at(2)? != 42 {
        return None;
    }
    let ifd = u32_at(4)? as usize;
    let count = u16_at(ifd)? as usize;
    let (mut x, mut y, mut unit) = (None, None, 2u16);
    for i in 0..count.min(200) {
        let e = ifd + 2 + i * 12;
        let tag = u16_at(e)?;
        let kind = u16_at(e + 2)?;
        let value_offset = u32_at(e + 8)? as usize;
        let rational = || -> Option<f64> {
            if kind != 5 {
                return None;
            }
            let n = f64::from(u32_at(value_offset)?);
            let d = f64::from(u32_at(value_offset + 4)?);
            (d > 0.0).then_some(n / d)
        };
        match tag {
            0x011A => x = rational(),
            0x011B => y = rational(),
            0x0128 => unit = u16_at(e + 8)?,
            _ => {}
        }
    }
    let factor = if unit == 3 { 2.54 } else { 1.0 };
    match (x, y) {
        (Some(x), Some(y)) if x > 0.0 && y > 0.0 => Some((x * factor, y * factor)),
        _ => None,
    }
}

// ---------------------------------------------------------------------------------------------
// TIFF und WebP über die Decoder des Crates `image` bzw. `tiff`
// ---------------------------------------------------------------------------------------------

fn read_tiff(path: &Path, file_bytes: u64) -> Result<ImageMeta, PrintError> {
    use tiff::decoder::Decoder;
    use tiff::decoder::ifd::Value;
    use tiff::tags::Tag;
    let file = File::open(path).map_err(|e| IoError::read(path, e))?;
    let mut dec = Decoder::new(BufReader::new(file)).map_err(|e| PrintError::Decode(format!("TIFF: {e}")))?;
    let (width, height) = dec.dimensions().map_err(|e| PrintError::Decode(format!("TIFF: {e}")))?;
    let color = dec.colortype().map_err(|e| PrintError::Decode(format!("TIFF: {e}")))?;
    let (channels, bit_depth, has_alpha) = match color {
        tiff::ColorType::Gray(b) => (Channels::Gray, b, false),
        tiff::ColorType::GrayA(b) => (Channels::GrayAlpha, b, true),
        tiff::ColorType::RGB(b) => (Channels::Rgb, b, false),
        tiff::ColorType::RGBA(b) => (Channels::Rgba, b, true),
        tiff::ColorType::CMYK(b) | tiff::ColorType::CMYKA(b) => (Channels::Cmyk, b, false),
        tiff::ColorType::Palette(b) => (Channels::Indexed, b, false),
        other => return Err(PrintError::Decode(format!("TIFF-Farbart {other:?} wird nicht unterstützt"))),
    };
    let rational = |dec: &mut Decoder<BufReader<File>>, tag: Tag| -> Option<f64> {
        match dec.find_tag(tag).ok().flatten()? {
            Value::Rational(n, d) if d > 0 => Some(f64::from(n) / f64::from(d)),
            Value::Double(v) => Some(v),
            Value::Float(v) => Some(f64::from(v)),
            _ => None,
        }
    };
    let dpi = match (rational(&mut dec, Tag::XResolution), rational(&mut dec, Tag::YResolution)) {
        (Some(x), Some(y)) if x > 0.0 && y > 0.0 => {
            let unit = dec.find_tag(Tag::ResolutionUnit).ok().flatten().and_then(|v| v.into_u32().ok()).unwrap_or(2);
            let f = if unit == 3 { 2.54 } else { 1.0 };
            (unit != 1).then_some((x * f, y * f, DpiSource::TiffTags))
        }
        _ => None,
    };
    let icc = dec.find_tag(Tag::IccProfile).ok().flatten().and_then(|v| v.into_u8_vec().ok()).filter(|v| !v.is_empty());
    Ok(ImageMeta {
        format: ImgFormat::Tiff,
        width,
        height,
        bit_depth,
        channels,
        has_alpha,
        interlaced: false,
        animated: false,
        dpi,
        icc,
        srgb_chunk: false,
        file_bytes,
        png_ppm: None,
    })
}

fn read_webp(path: &Path, file_bytes: u64) -> Result<ImageMeta, PrintError> {
    use image::ImageDecoder;
    let file = File::open(path).map_err(|e| IoError::read(path, e))?;
    let mut decoder = image::codecs::webp::WebPDecoder::new(BufReader::new(file))
        .map_err(|e| PrintError::Decode(format!("WebP: {e}")))?;
    let (width, height) = decoder.dimensions();
    let has_alpha = decoder.color_type().has_alpha();
    let icc = decoder.icc_profile().ok().flatten();
    Ok(ImageMeta {
        format: ImgFormat::Webp,
        width,
        height,
        bit_depth: 8,
        channels: if has_alpha { Channels::Rgba } else { Channels::Rgb },
        has_alpha,
        interlaced: false,
        animated: false,
        dpi: None,
        icc,
        srgb_chunk: false,
        file_bytes,
        png_ppm: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffing_uses_content_not_extension() {
        assert_eq!(sniff(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0]), Some(ImgFormat::Png));
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some(ImgFormat::Jpeg));
        assert_eq!(sniff(b"II*\0abcd"), Some(ImgFormat::Tiff));
        assert_eq!(sniff(b"MM\0*abcd"), Some(ImgFormat::Tiff));
        assert_eq!(sniff(b"RIFF\x10\0\0\0WEBPVP8 "), Some(ImgFormat::Webp));
        assert_eq!(sniff(b"GIF89a"), None);
        assert_eq!(sniff(b""), None);
    }

    fn jpeg_with(segments: &[(u8, Vec<u8>)], components: u8) -> Vec<u8> {
        let mut out = vec![0xFF, 0xD8];
        for (marker, data) in segments {
            out.extend([0xFF, *marker]);
            out.extend(((data.len() + 2) as u16).to_be_bytes());
            out.extend(data);
        }
        // SOF0: Präzision 8, Höhe 20, Breite 10
        let mut sof = vec![8, 0, 20, 0, 10, components];
        for i in 0..components {
            sof.extend([i + 1, 0x11, 0]);
        }
        out.extend([0xFF, 0xC0]);
        out.extend(((sof.len() + 2) as u16).to_be_bytes());
        out.extend(sof);
        out.extend([0xFF, 0xDA, 0, 2]);
        out
    }

    #[test]
    fn jpeg_headers_give_size_density_and_icc() {
        let mut jfif = b"JFIF\0\x01\x02\x01".to_vec();
        jfif.extend(300u16.to_be_bytes());
        jfif.extend(300u16.to_be_bytes());
        jfif.extend([0, 0]);
        let mut icc1 = b"ICC_PROFILE\0\x01\x02".to_vec();
        icc1.extend(b"AAAA");
        let mut icc2 = b"ICC_PROFILE\0\x02\x02".to_vec();
        icc2.extend(b"BBBB");
        // Reihenfolge der APP2-Stücke ist egal: sie werden nach Nummer zusammengesetzt
        let meta = parse_jpeg_headers(&jpeg_with(&[(0xE0, jfif), (0xE2, icc2), (0xE2, icc1)], 3), 1234).unwrap();
        assert_eq!((meta.width, meta.height), (10, 20));
        assert_eq!(meta.channels, Channels::Rgb);
        assert_eq!(meta.dpi, Some((300.0, 300.0, DpiSource::Jfif)));
        assert_eq!(meta.icc.as_deref(), Some(&b"AAAABBBB"[..]));
        assert!(!meta.has_alpha);
    }

    #[test]
    fn jpeg_density_in_dots_per_cm_and_cmyk_detection() {
        let mut jfif = b"JFIF\0\x01\x02\x02".to_vec();
        jfif.extend(118u16.to_be_bytes());
        jfif.extend(118u16.to_be_bytes());
        jfif.extend([0, 0]);
        let meta = parse_jpeg_headers(&jpeg_with(&[(0xE0, jfif)], 4), 1).unwrap();
        assert_eq!(meta.channels, Channels::Cmyk);
        let (x, _, source) = meta.dpi.unwrap();
        assert!((x - 299.72).abs() < 0.01, "{x}");
        assert_eq!(source, DpiSource::Jfif);
    }

    #[test]
    fn exif_resolution_is_read_in_both_byte_orders() {
        // little endian: IFD0 mit XResolution=72/1, YResolution=72/1, ResolutionUnit=2
        let mut t = b"II*\0".to_vec();
        t.extend(8u32.to_le_bytes());
        t.extend(3u16.to_le_bytes());
        let entry = |tag: u16, kind: u16, value: u32| {
            let mut e = Vec::new();
            e.extend(tag.to_le_bytes());
            e.extend(kind.to_le_bytes());
            e.extend(1u32.to_le_bytes());
            e.extend(value.to_le_bytes());
            e
        };
        t.extend(entry(0x011A, 5, 8 + 2 + 36 + 4));
        t.extend(entry(0x011B, 5, 8 + 2 + 36 + 4));
        t.extend(entry(0x0128, 3, 2));
        t.extend(0u32.to_le_bytes());
        t.extend(72u32.to_le_bytes());
        t.extend(1u32.to_le_bytes());
        assert_eq!(parse_exif_resolution(&t), Some((72.0, 72.0)));
        assert_eq!(parse_exif_resolution(b"XX*\0"), None);
        assert_eq!(parse_exif_resolution(b""), None);
    }

    #[test]
    fn broken_jpeg_heads_are_errors_not_panics() {
        assert!(parse_jpeg_headers(b"", 0).is_err());
        assert!(parse_jpeg_headers(&[0xFF, 0xD8, 0xFF, 0xE0, 0xFF, 0xFF], 0).is_err());
        assert!(parse_jpeg_headers(&[0xFF, 0xD8, 0xFF, 0xD9], 0).is_err());
    }
}
