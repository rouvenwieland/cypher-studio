//! Überlagerungen für die Oberfläche: ein RGBA-Bild in Größe der Quelle, das nur die problematischen Stellen
//! einfärbt (Halbtransparenz, Geisterpixel, Zuschnitt, Alpha pur). Die Oberfläche legt es über die Vorschau.

use crate::api::{OverlayKind, PrintProfile};
use crate::error::PrintError;

use super::analyze::{self, Measures};
use super::decode::DecodedImage;
use super::scan::{self, PxRect, SemiClass};

const ORANGE: [u8; 4] = [255, 138, 0, 210];
const MAGENTA: [u8; 4] = [255, 0, 200, 235];
const CYAN: [u8; 4] = [0, 200, 255, 255];
/// Geisterpixel sind meist einzelne Pixel: für die Sichtbarkeit um so viele Pixel ausweiten.
const GHOST_GROW: u32 = 3;
const BOUNDS_LINE: u32 = 3;

fn paint(rgba: &mut [u8], index: usize, color: [u8; 4]) {
    rgba[index * 4..index * 4 + 4].copy_from_slice(&color);
}

fn draw_rect_outline(out: &mut DecodedImage, r: PxRect, thickness: u32, color: [u8; 4]) {
    let (w, h) = (out.width, out.height);
    let t = thickness.max(1);
    for y in r.y0..r.y1.min(h) {
        for x in r.x0..r.x1.min(w) {
            let on_edge = x < r.x0 + t || x + t >= r.x1 || y < r.y0 + t || y + t >= r.y1;
            if on_edge {
                paint(&mut out.rgba, y as usize * w as usize + x as usize, color);
            }
        }
    }
}

/// Rendert die Überlagerung. `measures` stammt aus [`analyze::measure`] desselben Bildes.
pub fn render(
    img: &DecodedImage,
    kind: OverlayKind,
    profile: &PrintProfile,
    measures: &Measures,
) -> Result<DecodedImage, PrintError> {
    let (w, h) = (img.width, img.height);
    let mut out = DecodedImage::transparent(w, h)?;
    let th = analyze::thresholds(profile);
    match kind {
        OverlayKind::SemiTransparent => {
            scan::scan_block(&img.rgba, w, h, th, 0, h, |x, y, _px, class| {
                if class == SemiClass::Area {
                    paint(&mut out.rgba, y as usize * w as usize + x as usize, ORANGE);
                }
            });
        }
        OverlayKind::GhostPixels => {
            let mut mask = vec![0u8; w as usize * h as usize];
            let bounds = measures.bounds;
            for (i, px) in img.rgba.chunks_exact(4).enumerate() {
                let a = px[3];
                if a != 0 && a <= th.ghost_max {
                    let (x, y) = ((i % w as usize) as u32, (i / w as usize) as u32);
                    if !bounds.is_some_and(|b| b.contains(x, y)) {
                        mask[i] = 1;
                    }
                }
            }
            let grown = scan::dilate_mask(&mask, w, h, GHOST_GROW);
            for (i, &g) in grown.iter().enumerate() {
                if g != 0 {
                    paint(&mut out.rgba, i, MAGENTA);
                }
            }
        }
        OverlayKind::Bounds => {
            if let Some(b) = measures.bounds {
                draw_rect_outline(&mut out, b, BOUNDS_LINE, CYAN);
            }
        }
        OverlayKind::ThinLines => {
            // Die Strichmessung (Phase 3) fehlt noch: eine leere Überlagerung ist ehrlicher als eine geratene
        }
        OverlayKind::AlphaOnly => {
            for (i, px) in img.rgba.chunks_exact(4).enumerate() {
                paint(&mut out.rgba, i, [px[3], px[3], px[3], 255]);
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::printcheck::testing;

    fn blank(w: u32, h: u32) -> DecodedImage {
        DecodedImage { width: w, height: h, rgba: vec![0; (w * h * 4) as usize] }
    }

    fn set(img: &mut DecodedImage, x: u32, y: u32, a: u8) {
        let i = ((y * img.width + x) * 4) as usize;
        img.rgba[i..i + 4].copy_from_slice(&[10, 20, 30, a]);
    }

    fn alpha_at(img: &DecodedImage, x: u32, y: u32) -> u8 {
        img.rgba[((y * img.width + x) * 4 + 3) as usize]
    }

    #[test]
    fn ghost_overlay_marks_stray_pixels_but_not_the_motif() {
        let profile = testing::tee_front_profile();
        let mut img = blank(60, 60);
        for y in 20..40 {
            for x in 20..40 {
                set(&mut img, x, y, 255);
            }
        }
        set(&mut img, 3, 3, 5);
        let m = analyze::measure(&img, &profile, None);
        assert_eq!(m.ghost, 1);
        let o = render(&img, OverlayKind::GhostPixels, &profile, &m).unwrap();
        assert!(alpha_at(&o, 3, 3) > 0);
        assert!(alpha_at(&o, 5, 5) > 0, "Markierung ist aufgeweitet");
        assert_eq!(alpha_at(&o, 30, 30), 0);
    }

    #[test]
    fn bounds_overlay_is_an_outline() {
        let profile = testing::tee_front_profile();
        let mut img = blank(60, 60);
        for y in 10..50 {
            for x in 10..50 {
                set(&mut img, x, y, 255);
            }
        }
        let m = analyze::measure(&img, &profile, None);
        let o = render(&img, OverlayKind::Bounds, &profile, &m).unwrap();
        assert!(alpha_at(&o, 10, 25) > 0);
        assert_eq!(alpha_at(&o, 30, 30), 0);
    }

    #[test]
    fn alpha_only_shows_the_alpha_channel() {
        let profile = testing::tee_front_profile();
        let mut img = blank(4, 4);
        set(&mut img, 1, 1, 128);
        let m = analyze::measure(&img, &profile, None);
        let o = render(&img, OverlayKind::AlphaOnly, &profile, &m).unwrap();
        let i = ((4 + 1) * 4) as usize;
        assert_eq!(&o.rgba[i..i + 4], &[128, 128, 128, 255]);
    }

    #[test]
    fn thin_lines_overlay_is_empty_until_the_measurement_exists() {
        let profile = testing::tee_front_profile();
        let img = blank(8, 8);
        let m = analyze::measure(&img, &profile, None);
        let o = render(&img, OverlayKind::ThinLines, &profile, &m).unwrap();
        assert!(o.rgba.iter().all(|&b| b == 0));
    }
}
