//! Hintergrund entfernen ohne KI: Farbschlüssel mit Flutfüllung vom Rand (ARCHITEKTUR.md 2.16).
//!
//! Für flächige Grafiken liefert das saubere, deterministische Kanten und braucht keinen Download. Das Modellverfahren
//! (IS-Net) ist ein späterer Ausbau und hier bewusst nicht enthalten.

use tokio_util::sync::CancellationToken;

use crate::api::ColorKeySample;
use crate::error::{CoreError, PrintError};
use crate::printcheck::DecodedImage;

/// Größter Farbabstand im RGB-Raum (Schwarz zu Weiß).
const MAX_DISTANCE: f64 = 441.672_955_930_063_7;
/// Übergangsbereich jenseits der Toleranz, in dem Randpixel halbtransparent werden (Anteil der Toleranz).
const FEATHER: f64 = 0.6;

fn px(img: &DecodedImage, x: u32, y: u32) -> [u8; 4] {
    let i = ((y as usize) * img.width as usize + x as usize) * 4;
    [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2], img.rgba[i + 3]]
}

fn distance(a: [u8; 4], b: [f64; 3]) -> f64 {
    let d = |i: usize| f64::from(a[i]) - b[i];
    (d(0) * d(0) + d(1) * d(1) + d(2) * d(2)).sqrt()
}

/// Mittlere Farbe der Ecken (3 x 3 je Ecke) oder des ganzen Randes.
fn background_color(img: &DecodedImage, sample: ColorKeySample) -> [f64; 3] {
    let (w, h) = (img.width, img.height);
    let mut sum = [0f64; 3];
    let mut n = 0f64;
    let mut add = |x: u32, y: u32| {
        let p = px(img, x, y);
        if p[3] > 0 {
            for (s, c) in sum.iter_mut().zip(p) {
                *s += f64::from(c);
            }
            n += 1.0;
        }
    };
    match sample {
        ColorKeySample::Corners => {
            let (bx, by) = (3.min(w), 3.min(h));
            for (cx, cy) in [(0, 0), (w - bx, 0), (0, h - by), (w - bx, h - by)] {
                for y in cy..cy + by {
                    for x in cx..cx + bx {
                        add(x, y);
                    }
                }
            }
        }
        ColorKeySample::Border => {
            for x in 0..w {
                add(x, 0);
                add(x, h - 1);
            }
            for y in 1..h.saturating_sub(1) {
                add(0, y);
                add(w - 1, y);
            }
        }
    }
    if n == 0.0 { [255.0, 255.0, 255.0] } else { [sum[0] / n, sum[1] / n, sum[2] / n] }
}

/// Entfernt die Hintergrundfarbe, soweit sie über gleichfarbige Pixel mit dem Bildrand zusammenhängt.
/// `tolerance` 0..1 (Anteil des größten Farbabstands).
pub fn color_key(
    img: &DecodedImage,
    tolerance: f64,
    sample: ColorKeySample,
    cancel: &CancellationToken,
) -> Result<DecodedImage, CoreError> {
    if img.width == 0 || img.height == 0 {
        return Err(CoreError::invalid_input("handleId", "Das Bild ist leer"));
    }
    let bg = background_color(img, sample);
    let max_d = tolerance.clamp(0.0, 1.0) * MAX_DISTANCE;
    let (w, h) = (img.width as usize, img.height as usize);
    let mut is_bg = vec![false; w * h];
    let mut stack: Vec<(u32, u32)> = Vec::new();
    let matches = |x: u32, y: u32| {
        let p = px(img, x, y);
        p[3] == 0 || distance(p, bg) <= max_d
    };
    let seed = |x: u32, y: u32, stack: &mut Vec<(u32, u32)>, is_bg: &mut Vec<bool>| {
        let i = y as usize * w + x as usize;
        if !is_bg[i] && matches(x, y) {
            is_bg[i] = true;
            stack.push((x, y));
        }
    };
    for x in 0..img.width {
        seed(x, 0, &mut stack, &mut is_bg);
        seed(x, img.height - 1, &mut stack, &mut is_bg);
    }
    for y in 0..img.height {
        seed(0, y, &mut stack, &mut is_bg);
        seed(img.width - 1, y, &mut stack, &mut is_bg);
    }
    let mut steps = 0u64;
    while let Some((x, y)) = stack.pop() {
        steps += 1;
        if steps.is_multiple_of(65_536) && cancel.is_cancelled() {
            return Err(CoreError::Cancelled);
        }
        let neighbours = [(x.wrapping_sub(1), y), (x + 1, y), (x, y.wrapping_sub(1)), (x, y + 1)];
        for (nx, ny) in neighbours {
            if nx < img.width && ny < img.height {
                seed(nx, ny, &mut stack, &mut is_bg);
            }
        }
    }

    let mut out = img.clone();
    for y in 0..img.height {
        for x in 0..img.width {
            let i = y as usize * w + x as usize;
            let o = i * 4;
            if is_bg[i] {
                out.rgba[o + 3] = 0;
                continue;
            }
            // Randpixel neben dem Hintergrund: weicher Übergang statt Treppe
            let next_to_bg = [(x.wrapping_sub(1), y), (x + 1, y), (x, y.wrapping_sub(1)), (x, y + 1)]
                .iter()
                .any(|&(nx, ny)| nx < img.width && ny < img.height && is_bg[ny as usize * w + nx as usize]);
            if next_to_bg && max_d > 0.0 {
                let d = distance(px(img, x, y), bg);
                let t = ((d - max_d) / (FEATHER * max_d)).clamp(0.0, 1.0);
                out.rgba[o + 3] = (f64::from(out.rgba[o + 3]) * t).round() as u8;
            }
        }
    }
    Ok(out)
}

/// RGBA8 als PNG (ohne Profil, 72 dpi-Angabe entfällt).
pub fn encode_png(img: &DecodedImage) -> Result<Vec<u8>, PrintError> {
    let enc_err = |e: png::EncodingError| PrintError::Encode(format!("PNG: {e}"));
    let mut out = Vec::new();
    let mut enc = png::Encoder::new(&mut out, img.width, img.height);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_compression(png::Compression::Balanced);
    let mut w = enc.write_header().map_err(enc_err)?;
    w.write_image_data(&img.rgba).map_err(enc_err)?;
    w.finish().map_err(enc_err)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Weißer Hintergrund, rote Scheibe mit weißem Loch in der Mitte.
    fn disc_with_hole() -> DecodedImage {
        let (w, h) = (80u32, 80u32);
        let mut rgba = Vec::new();
        for y in 0..h {
            for x in 0..w {
                let d = ((f64::from(x) - 39.5).powi(2) + (f64::from(y) - 39.5).powi(2)).sqrt();
                let p = if d < 8.0 {
                    [255, 255, 255, 255]
                } else if d < 30.0 {
                    [200, 20, 30, 255]
                } else {
                    [255, 255, 255, 255]
                };
                rgba.extend(p);
            }
        }
        DecodedImage { width: w, height: h, rgba }
    }

    fn alpha(img: &DecodedImage, x: u32, y: u32) -> u8 {
        px(img, x, y)[3]
    }

    #[test]
    fn background_connected_to_the_border_goes_but_inner_white_stays() {
        let img = disc_with_hole();
        for sample in [ColorKeySample::Corners, ColorKeySample::Border] {
            let out = color_key(&img, 0.1, sample, &CancellationToken::new()).unwrap();
            assert_eq!(alpha(&out, 1, 1), 0, "{sample:?}: Hintergrund weg");
            assert_eq!(alpha(&out, 78, 40), 0);
            assert_eq!(alpha(&out, 39, 25), 255, "Scheibe bleibt");
            assert_eq!(alpha(&out, 40, 40), 255, "weißes Loch ist nicht mit dem Rand verbunden und bleibt");
        }
    }

    #[test]
    fn zero_tolerance_removes_only_exact_matches_and_full_tolerance_everything_connected() {
        let img = disc_with_hole();
        let exact = color_key(&img, 0.0, ColorKeySample::Corners, &CancellationToken::new()).unwrap();
        assert_eq!(alpha(&exact, 1, 1), 0);
        assert_eq!(alpha(&exact, 39, 25), 255);
        let all = color_key(&img, 1.0, ColorKeySample::Corners, &CancellationToken::new()).unwrap();
        assert!(all.rgba.chunks_exact(4).all(|p| p[3] == 0), "alles hängt zusammen");
    }

    #[test]
    fn edges_are_softened_not_stair_stepped() {
        let mut img = disc_with_hole();
        // Randpixel der Scheibe leicht aufhellen: liegt zwischen Toleranz und Feder
        let i = ((40usize * 80) + 9) * 4;
        img.rgba[i..i + 3].copy_from_slice(&[255, 200, 200]);
        let out = color_key(&img, 0.3, ColorKeySample::Corners, &CancellationToken::new()).unwrap();
        let a = alpha(&out, 9, 40);
        assert!(a < 255, "{a}");
    }

    #[test]
    fn cancel_and_empty_image() {
        let token = CancellationToken::new();
        token.cancel();
        let big = DecodedImage { width: 600, height: 600, rgba: vec![255; 600 * 600 * 4] };
        assert!(matches!(color_key(&big, 0.1, ColorKeySample::Corners, &token), Err(CoreError::Cancelled)));
        let empty = DecodedImage { width: 0, height: 0, rgba: vec![] };
        assert!(color_key(&empty, 0.1, ColorKeySample::Corners, &CancellationToken::new()).is_err());
    }

    #[test]
    fn png_round_trip() {
        let img = disc_with_hole();
        let bytes = encode_png(&img).unwrap();
        let back = image::load_from_memory(&bytes).unwrap().to_rgba8();
        assert_eq!(back.as_raw(), &img.rgba);
    }
}
