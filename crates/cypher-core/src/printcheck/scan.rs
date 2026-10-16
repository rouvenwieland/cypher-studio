//! Pixelmessung auf der 8-Bit-Alphaebene, zeilenblockweise und parallel (`std::thread::scope`, kein rayon).
//!
//! Begriffe (ARCHITEKTUR.md 2.13, Messgrößen):
//! - sichtbar: Alpha > 0
//! - `bounds`: Hüllrechteck der Pixel mit Alpha >= `semi_min`
//! - Geisterpixel: 1 <= Alpha <= `ghost_max` außerhalb von `bounds`
//! - halbtransparent (roh `A`): `semi_min` <= Alpha <= `semi_max`
//! - Kantensaum: ein Pixel aus `A`, das im Umkreis von `edge_radius_px` (quadratischer Kern) sowohl ein
//!   (nahezu) transparentes als auch ein (nahezu) deckendes Pixel hat – normales Anti-Aliasing
//! - `H` = `A` ohne Kantensaum: die störende Halbtransparenz

use std::thread;

/// Grenzwerte aus dem Druckprofil (`AlphaRules`).
#[derive(Debug, Clone, Copy)]
pub struct Thresholds {
    pub semi_min: u8,
    pub semi_max: u8,
    pub ghost_max: u8,
    pub edge_radius: u32,
}

/// Achsenparalleles Rechteck in Pixeln, `x1`/`y1` exklusiv.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PxRect {
    pub x0: u32,
    pub y0: u32,
    pub x1: u32,
    pub y1: u32,
}

impl PxRect {
    pub fn width(&self) -> u32 {
        self.x1 - self.x0
    }

    pub fn height(&self) -> u32 {
        self.y1 - self.y0
    }

    pub fn contains(&self, x: u32, y: u32) -> bool {
        x >= self.x0 && x < self.x1 && y >= self.y0 && y < self.y1
    }

    pub fn union(self, other: PxRect) -> PxRect {
        PxRect {
            x0: self.x0.min(other.x0),
            y0: self.y0.min(other.y0),
            x1: self.x1.max(other.x1),
            y1: self.y1.max(other.y1),
        }
    }
}

/// Sammelt ein Hüllrechteck Pixel für Pixel.
#[derive(Debug, Default, Clone, Copy)]
pub struct RectAcc(pub Option<PxRect>);

impl RectAcc {
    pub fn add(&mut self, x: u32, y: u32) {
        let p = PxRect { x0: x, y0: y, x1: x + 1, y1: y + 1 };
        self.0 = Some(match self.0 {
            Some(r) => r.union(p),
            None => p,
        });
    }

    pub fn merge(&mut self, other: RectAcc) {
        self.0 = match (self.0, other.0) {
            (Some(a), Some(b)) => Some(a.union(b)),
            (a, None) => a,
            (None, b) => b,
        };
    }
}

/// Zeilenblöcke für die Parallelisierung: höchstens 8 Blöcke, mindestens 64 Zeilen je Block.
pub fn blocks(height: u32) -> Vec<(u32, u32)> {
    let cpus = thread::available_parallelism().map_or(1, usize::from).clamp(1, 8) as u32;
    let n = cpus.min((height / 64).max(1));
    let step = height.div_ceil(n).max(1);
    (0..n).map(|i| (i * step, ((i + 1) * step).min(height))).filter(|(a, b)| a < b).collect()
}

/// Führt `f` je Block parallel aus und gibt die Ergebnisse in Blockreihenfolge zurück.
pub fn par_blocks<T: Send>(height: u32, f: impl Fn(u32, u32) -> T + Sync) -> Vec<T> {
    let parts = blocks(height);
    if parts.len() <= 1 {
        return parts.into_iter().map(|(a, b)| f(a, b)).collect();
    }
    let f = &f;
    thread::scope(|s| {
        let handles: Vec<_> = parts.iter().map(|&(a, b)| s.spawn(move || f(a, b))).collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    })
}

/// Ergebnis des ersten Durchlaufs.
#[derive(Debug, Default, Clone, Copy)]
pub struct Pass1 {
    pub visible: u64,
    pub transparent: u64,
    pub opaque: u64,
    pub semi_raw: u64,
    pub bounds: Option<PxRect>,
}

/// Erster Durchlauf: Zählungen und `bounds`.
pub fn pass1(rgba: &[u8], width: u32, height: u32, th: Thresholds) -> Pass1 {
    let stride = width as usize * 4;
    let parts = par_blocks(height, |y0, y1| {
        let mut out = Pass1::default();
        let mut rect = RectAcc::default();
        for y in y0..y1 {
            let row = &rgba[y as usize * stride..(y as usize + 1) * stride];
            // Zeilenspanne der Pixel mit Alpha >= semi_min
            let (mut first, mut last) = (u32::MAX, 0u32);
            for (x, px) in row.chunks_exact(4).enumerate() {
                let a = px[3];
                if a == 0 {
                    out.transparent += 1;
                    continue;
                }
                out.visible += 1;
                if a == 255 {
                    out.opaque += 1;
                }
                if a >= th.semi_min {
                    if first == u32::MAX {
                        first = x as u32;
                    }
                    last = x as u32;
                    if a <= th.semi_max {
                        out.semi_raw += 1;
                    }
                }
            }
            if first != u32::MAX {
                rect.add(first, y);
                rect.add(last, y);
            }
        }
        out.bounds = rect.0;
        out
    });
    let mut total = Pass1::default();
    let mut rect = RectAcc::default();
    for p in parts {
        total.visible += p.visible;
        total.transparent += p.transparent;
        total.opaque += p.opaque;
        total.semi_raw += p.semi_raw;
        rect.merge(RectAcc(p.bounds));
    }
    total.bounds = rect.0;
    total
}

/// Anteil deckender Randpixel (Alpha > `semi_max`) auf dem äußersten Pixelring.
pub fn border_opaque_share(rgba: &[u8], width: u32, height: u32, th: Thresholds) -> f64 {
    if width == 0 || height == 0 {
        return 0.0;
    }
    let stride = width as usize * 4;
    let at = |x: u32, y: u32| rgba[y as usize * stride + x as usize * 4 + 3];
    let (mut total, mut opaque) = (0u64, 0u64);
    let mut count = |a: u8| {
        total += 1;
        if a > th.semi_max {
            opaque += 1;
        }
    };
    for x in 0..width {
        count(at(x, 0));
        if height > 1 {
            count(at(x, height - 1));
        }
    }
    if height > 2 {
        for y in 1..height - 1 {
            count(at(0, y));
            if width > 1 {
                count(at(width - 1, y));
            }
        }
    }
    opaque as f64 / total.max(1) as f64
}

const FLAG_TRANSPARENT: u8 = 1;
const FLAG_OPAQUE: u8 = 2;

/// Waagerecht aufgeweitete Flags einer Zeile: „im Umkreis `r` gibt es ein (nahezu) transparentes / deckendes Pixel“.
fn flag_row(row: &[u8], th: Thresholds, out: &mut [u8]) {
    let w = out.len();
    let r = th.edge_radius as usize;
    let class = |i: usize| -> (u32, u32) {
        let a = row[i * 4 + 3];
        (u32::from(a < th.semi_min), u32::from(a > th.semi_max))
    };
    let (mut ct, mut co) = (0u32, 0u32);
    for i in 0..=r.min(w.saturating_sub(1)) {
        let (t, o) = class(i);
        ct += t;
        co += o;
    }
    for (x, flags) in out.iter_mut().enumerate() {
        *flags = (u8::from(ct > 0) * FLAG_TRANSPARENT) | (u8::from(co > 0) * FLAG_OPAQUE);
        if x + r + 1 < w {
            let (t, o) = class(x + r + 1);
            ct += t;
            co += o;
        }
        if x >= r {
            let (t, o) = class(x - r);
            ct -= t;
            co -= o;
        }
    }
}

/// Wie ein Pixel bei der Halbtransparenz-Messung eingestuft wird.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SemiClass {
    /// Alpha liegt außerhalb von `semi_min..=semi_max`.
    NotSemi,
    /// halbtransparent, aber normaler Kantensaum
    Fringe,
    /// halbtransparente Fläche (`H`)
    Area,
}

/// Besucht alle Pixel der Zeilen `y0..y1` und meldet, ob sie zu `H` gehören. Die Kantenprüfung braucht
/// `edge_radius` Zeilen Rand über und unter dem Block; diese werden aus dem Gesamtbild gelesen.
pub fn scan_block(
    rgba: &[u8],
    width: u32,
    height: u32,
    th: Thresholds,
    y0: u32,
    y1: u32,
    mut visit: impl FnMut(u32, u32, &[u8], SemiClass),
) {
    let w = width as usize;
    let stride = w * 4;
    let r = th.edge_radius as i64;
    let slots = (2 * r + 1) as usize;
    let mut ring: Vec<Vec<u8>> = vec![vec![0u8; w]; slots];
    let mut ring_row: Vec<i64> = vec![i64::MIN; slots];
    for y in y0..y1 {
        for need in (i64::from(y) - r)..=(i64::from(y) + r) {
            if need < 0 || need >= i64::from(height) {
                continue;
            }
            let slot = (need.rem_euclid(slots as i64)) as usize;
            if ring_row[slot] != need {
                let start = need as usize * stride;
                flag_row(&rgba[start..start + stride], th, &mut ring[slot]);
                ring_row[slot] = need;
            }
        }
        let row = &rgba[y as usize * stride..(y as usize + 1) * stride];
        for (x, px) in row.chunks_exact(4).enumerate() {
            let a = px[3];
            let class = if a < th.semi_min || a > th.semi_max {
                SemiClass::NotSemi
            } else {
                let mut flags = 0u8;
                for need in (i64::from(y) - r)..=(i64::from(y) + r) {
                    if need >= 0 && need < i64::from(height) {
                        flags |= ring[(need.rem_euclid(slots as i64)) as usize][x];
                    }
                }
                if flags == FLAG_TRANSPARENT | FLAG_OPAQUE { SemiClass::Fringe } else { SemiClass::Area }
            };
            visit(x as u32, y, px, class);
        }
    }
}

/// Maske der Pixel aus `H` (1 = halbtransparente Fläche), für Korrekturen und die Überlagerung.
pub fn semi_area_mask(rgba: &[u8], width: u32, height: u32, th: Thresholds) -> Vec<u8> {
    let w = width as usize;
    let mut mask = vec![0u8; w * height as usize];
    let parts = blocks(height);
    // jeder Block schreibt in seinen eigenen, nicht überlappenden Maskenabschnitt
    let mut rest: &mut [u8] = &mut mask;
    let mut slices: Vec<(u32, u32, &mut [u8])> = Vec::with_capacity(parts.len());
    for &(a, b) in &parts {
        let (head, tail) = rest.split_at_mut((b - a) as usize * w);
        slices.push((a, b, head));
        rest = tail;
    }
    thread::scope(|s| {
        for (a, b, chunk) in slices {
            s.spawn(move || {
                scan_block(rgba, width, height, th, a, b, |x, y, _px, class| {
                    if class == SemiClass::Area {
                        chunk[(y - a) as usize * w + x as usize] = 1;
                    }
                });
            });
        }
    });
    mask
}

/// Weitet eine 0/1-Maske um `r` Pixel (quadratischer Kern) aus, O(n).
pub fn dilate_mask(mask: &[u8], width: u32, height: u32, r: u32) -> Vec<u8> {
    let (w, h, r) = (width as usize, height as usize, r as usize);
    if r == 0 || w == 0 || h == 0 {
        return mask.to_vec();
    }
    // waagerecht
    let mut horizontal = vec![0u8; mask.len()];
    for y in 0..h {
        let row = &mask[y * w..(y + 1) * w];
        let out = &mut horizontal[y * w..(y + 1) * w];
        let mut count = row[..=r.min(w - 1)].iter().filter(|&&v| v != 0).count();
        for x in 0..w {
            out[x] = u8::from(count > 0);
            if x + r + 1 < w && row[x + r + 1] != 0 {
                count += 1;
            }
            if x >= r && row[x - r] != 0 {
                count -= 1;
            }
        }
    }
    // senkrecht
    let mut out = vec![0u8; mask.len()];
    for x in 0..w {
        let mut count = (0..=r.min(h - 1)).filter(|&y| horizontal[y * w + x] != 0).count();
        for y in 0..h {
            out[y * w + x] = u8::from(count > 0);
            if y + r + 1 < h && horizontal[(y + r + 1) * w + x] != 0 {
                count += 1;
            }
            if y >= r && horizontal[(y - r) * w + x] != 0 {
                count -= 1;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const TH: Thresholds = Thresholds { semi_min: 13, semi_max: 252, ghost_max: 12, edge_radius: 2 };

    fn image(w: u32, h: u32, f: impl Fn(u32, u32) -> u8) -> Vec<u8> {
        let mut v = Vec::with_capacity((w * h * 4) as usize);
        for y in 0..h {
            for x in 0..w {
                v.extend([200, 100, 50, f(x, y)]);
            }
        }
        v
    }

    fn count_classes(rgba: &[u8], w: u32, h: u32) -> (u64, u64) {
        let (mut fringe, mut area) = (0, 0);
        scan_block(rgba, w, h, TH, 0, h, |_, _, _, c| match c {
            SemiClass::Fringe => fringe += 1,
            SemiClass::Area => area += 1,
            SemiClass::NotSemi => {}
        });
        (fringe, area)
    }

    #[test]
    fn hard_edge_with_one_pixel_antialiasing_has_no_semi_area() {
        // links transparent, eine Spalte Anti-Aliasing (alpha 128), rechts deckend
        let (w, h) = (40, 30);
        let img = image(w, h, |x, _| {
            if x < 19 {
                0
            } else if x == 19 {
                128
            } else {
                255
            }
        });
        let (fringe, area) = count_classes(&img, w, h);
        assert_eq!(area, 0);
        assert_eq!(fringe, u64::from(h));
    }

    #[test]
    fn long_fade_is_semi_area() {
        // 40 Pixel langer Verlauf von 0 nach 255
        let (w, h) = (80, 10);
        let img = image(w, h, |x, _| {
            if x < 20 {
                0
            } else if x >= 60 {
                255
            } else {
                ((x - 20) * 255 / 40) as u8
            }
        });
        let (_, area) = count_classes(&img, w, h);
        // die Mitte des Verlaufs (ohne die je zwei Pixel am Rand, die beide Seiten sehen) ist Fläche
        assert!(area >= u64::from(h) * 30, "{area}");
    }

    #[test]
    fn block_boundaries_do_not_change_the_result() {
        let (w, h) = (50, 300);
        let img = image(w, h, |x, y| ((x * 5 + y * 3) % 256) as u8);
        let full = {
            let mut c = 0u64;
            scan_block(&img, w, h, TH, 0, h, |_, _, _, k| c += u64::from(k == SemiClass::Area));
            c
        };
        let mut split = 0u64;
        for (a, b) in [(0, 100), (100, 101), (101, 300)] {
            scan_block(&img, w, h, TH, a, b, |_, _, _, k| split += u64::from(k == SemiClass::Area));
        }
        assert_eq!(full, split);
        let mask = semi_area_mask(&img, w, h, TH);
        assert_eq!(mask.iter().map(|&v| u64::from(v)).sum::<u64>(), full);
    }

    #[test]
    fn pass1_counts_and_bounds() {
        let (w, h) = (10, 8);
        let img = image(w, h, |x, y| {
            if (3..6).contains(&x) && (2..5).contains(&y) {
                255
            } else if x == 9 && y == 7 {
                5
            } else {
                0
            }
        });
        let p = pass1(&img, w, h, TH);
        assert_eq!(p.opaque, 9);
        assert_eq!(p.visible, 10);
        assert_eq!(p.semi_raw, 0);
        assert_eq!(p.bounds, Some(PxRect { x0: 3, y0: 2, x1: 6, y1: 5 }));
    }

    #[test]
    fn border_share_detects_forgotten_background() {
        let (w, h) = (6, 6);
        let opaque = image(w, h, |_, _| 255);
        assert!((border_opaque_share(&opaque, w, h, TH) - 1.0).abs() < 1e-9);
        let clear = image(w, h, |x, y| if x == 0 && y == 0 { 255 } else { 0 });
        assert!(border_opaque_share(&clear, w, h, TH) < 0.1);
    }

    #[test]
    fn dilation_grows_by_radius() {
        let (w, h) = (9, 9);
        let mut m = vec![0u8; 81];
        m[4 * 9 + 4] = 1;
        let d = dilate_mask(&m, w, h, 2);
        assert_eq!(d.iter().map(|&v| u32::from(v)).sum::<u32>(), 25);
        assert_eq!(d[2 * 9 + 2], 1);
        assert_eq!(d[9 + 1], 0);
    }

    #[test]
    fn blocks_cover_all_rows_without_overlap() {
        for h in [1u32, 5, 64, 65, 1000, 5315] {
            let parts = blocks(h);
            assert_eq!(parts.first().map(|p| p.0), Some(0));
            assert_eq!(parts.last().map(|p| p.1), Some(h));
            for pair in parts.windows(2) {
                assert_eq!(pair[0].1, pair[1].0);
            }
        }
    }

    #[test]
    fn rect_accumulator_merges() {
        let mut a = RectAcc::default();
        a.add(5, 5);
        a.add(2, 9);
        let mut b = RectAcc::default();
        b.add(8, 1);
        a.merge(b);
        assert_eq!(a.0, Some(PxRect { x0: 2, y0: 1, x1: 9, y1: 10 }));
    }
}
