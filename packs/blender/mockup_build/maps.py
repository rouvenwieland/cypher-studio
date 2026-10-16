# SPDX-License-Identifier: GPL-3.0-or-later
"""Macht aus den Renderdurchgängen die fertigen Ebenen einer Mockup-Vorlage (numpy, läuft in Blender).

    blender -b --factory-startup --python maps.py -- --garment tee-front --work ~/mock/work --out <packs/mockups>

Ebenen (8 Bit, Leinwand 2000 x 2500):
  mask.png          RGBA, Alpha = Textilfläche
  shade.png         Graustufen, wird mit Stoff und Motiv multipliziert (Falten, Schatten; flache Fläche ~ 0,97)
  light.png         Graustufen auf Schwarz, per screen (leichter Stoffglanz) für helle Stoffe
  light-dark.png    kräftigerer Glanz für dunkle Stoffe (eigene "Aufnahme" des schwarzen Stoffs)
  displace.png      R = dx, G = dy (128 = 0), aus dem Höhenverlauf der Falten
  heather.png       Graustufen um 128, Melange-Struktur für soft-light
"""

import json
import math
import os
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import garments  # noqa: E402
import png_io  # noqa: E402

SHADE_FLAT = 0.965  # flache, beleuchtete Fläche (sRGB-kodiert), Lichter werden darauf begrenzt


# --------------------------------------------------------------------------- numpy-Helfer


def srgb_encode(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def gaussian_blur(a, sigma):
    """Gauß-Weichzeichner über FFT (2D, Ränder gespiegelt)."""
    if sigma <= 0:
        return a
    h, w = a.shape
    pad = int(sigma * 3) + 1
    p = np.pad(a, pad, mode="reflect")
    ky = np.fft.fftfreq(p.shape[0])[:, None]
    kx = np.fft.rfftfreq(p.shape[1])[None, :]
    kernel = np.exp(-2.0 * (math.pi * sigma) ** 2 * (kx**2 + ky**2))
    out = np.fft.irfft2(np.fft.rfft2(p) * kernel, s=p.shape)
    return out[pad : pad + h, pad : pad + w]


def masked_blur(a, mask, sigma):
    """Weichzeichnen nur innerhalb der Maske (Normalisierung gegen die Maskenfläche)."""
    num = gaussian_blur(a * mask, sigma)
    den = gaussian_blur(mask.astype(np.float64), sigma)
    return num / np.maximum(den, 1e-6)


def unpremultiply(rgba):
    a = rgba[..., 3]
    rgb = rgba[..., :3] / np.maximum(a, 1e-4)[..., None]
    return rgb, a


# --------------------------------------------------------------------------- Ebenen


def make_mask(light_rgba):
    a = np.clip(light_rgba[..., 3], 0.0, 1.0)
    rgba = np.empty(a.shape + (4,), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = np.round(a * 255).astype(np.uint8)
    return rgba, a


def make_shade(light_rgba, alpha, sigma_px, contrast=1.7):
    rgb, a = unpremultiply(light_rgba)
    lum = rgb.mean(axis=2)
    inside = (alpha > 0.98).astype(np.float64)
    broad = masked_blur(lum, inside, sigma_px)  # Beleuchtungsverlauf ohne Falten
    ratio = lum / np.maximum(broad, 1e-6)
    ratio = np.power(np.clip(ratio, 0.05, 3.0), contrast)
    shade = srgb_encode(np.minimum(ratio * 0.93, 1.0)) * SHADE_FLAT / srgb_encode(0.93)
    shade = np.clip(shade, 0.0, 1.0)
    shade = np.where(alpha > 0.0, shade, 1.0)
    return np.round(shade * 255).astype(np.uint8), ratio


def make_light(dark_rgba, alpha, sigma_px, peak):
    rgb, _ = unpremultiply(dark_rgba)
    lum = rgb.mean(axis=2)
    inside = (alpha > 0.98).astype(np.float64)
    broad = masked_blur(lum, inside, sigma_px)
    rel = np.maximum(lum / np.maximum(broad, 1e-6) - 1.0, 0.0)
    ref = np.percentile(rel[inside > 0], 99.5)
    val = np.clip(rel / max(ref, 1e-6), 0.0, 1.0) ** 0.9 * peak
    val = np.where(alpha > 0.0, val, 0.0)
    return np.round(val * 255).astype(np.uint8)


def make_displace(height_rgba, alpha, strength_sigma=2.6):
    h = height_rgba[..., 0] / np.maximum(height_rgba[..., 3], 1e-4)
    inside = (alpha > 0.98).astype(np.float64)
    # außerhalb mit dem Mittelwert der Umgebung füllen, damit am Rand kein Sprung entsteht
    fill = masked_blur(np.where(inside > 0, h, 0.0), inside, 12.0)
    h = np.where(inside > 0, h, fill)
    h = gaussian_blur(h, strength_sigma)
    gy, gx = np.gradient(h)
    mag = np.hypot(gx, gy)
    ref = np.percentile(mag[inside > 0], 97.0)
    dx = np.clip(gx / ref, -1.0, 1.0)
    dy = np.clip(gy / ref, -1.0, 1.0)
    out = np.empty(h.shape + (3,), np.uint8)
    out[..., 0] = np.round(128 + 127 * dx).astype(np.uint8)
    out[..., 1] = np.round(128 + 127 * dy).astype(np.uint8)
    out[..., 2] = 128
    out[inside == 0] = 128
    return out


def make_heather(shape, seed=20261016):
    """Melange: weiche Flecken und kurze Fasern, 8 Bit um 128 (soft-light). Gleiche Datei für alle Vorlagen."""
    h, w = shape
    rng = np.random.default_rng(seed)
    hh, ww = (h + 1) // 2, (w + 1) // 2  # halbe Auflösung: Fasern ~1 mm, deutlich kleinere Datei
    base = rng.normal(0.0, 1.0, (hh, ww))
    fiber_h = gaussian_blur(rng.normal(0.0, 1.0, (hh, ww)), 0.9)
    fiber_h = gaussian_blur(fiber_h, 0.6) * 2.2
    fine = gaussian_blur(base, 0.55) * 1.6
    mottle = gaussian_blur(rng.normal(0.0, 1.0, (hh, ww)), 9.0) * 6.0
    speck = (rng.random((hh, ww)) > 0.93) * rng.choice([-1.0, 1.0], (hh, ww)) * 1.6
    n = fine + 0.6 * fiber_h + mottle + speck
    n = (n - n.mean()) / n.std()
    # in grobe Stufen legen (kleinere PNG), Amplitude ~ +-26
    levels = np.round(n * 2.0) / 2.0
    img = 128.0 + levels * 11.0
    img = np.repeat(np.repeat(img, 2, axis=0), 2, axis=1)[:h, :w]
    return np.clip(np.round(img), 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------- Ablauf


def build_layers(garment_id, work_root, out_root, peak_light=0.13):
    g = garments.build(garment_id)
    work = Path(work_root) / garment_id
    out = Path(out_root) / garment_id
    light = np.load(work / "light.npy")
    dark = np.load(work / "dark.npy")
    height = np.load(work / "height.npy")
    h, w = light.shape[:2]
    scale = w / garments.CANVAS[0]
    sigma = 150.0 * scale
    mask_img, alpha = make_mask(light)
    shade, _ = make_shade(light, alpha, sigma)
    light_dark = make_light(dark, alpha, sigma, peak=peak_light)
    light_light = np.round(light_dark.astype(np.float64) * 0.28).astype(np.uint8)
    disp = make_displace(height, alpha)
    heather = make_heather((h, w))
    sizes = {}
    for name, arr in (("mask", mask_img), ("shade", shade), ("light", light_light), ("light-dark", light_dark), ("displace", disp), ("heather", heather)):
        sizes[name] = png_io.write_png(out / f"{name}.png", arr)
    write_template(g, out)
    print(f"{garment_id}: " + ", ".join(f"{k} {v / 1024:.0f} KB" for k, v in sizes.items()))
    return out


LIGHT_COLORS = ["weiss", "creme", "sand", "grau-meliert"]
DARK_COLORS = ["schwarz", "navy"]


def print_quad_px(g):
    """Druckfläche (Shirtigo-Maße in mm) als Viereck in Pixeln der Leinwand: oben links, oben rechts, unten rechts, unten links."""
    w, h = garments.CANVAS
    ppm = g.px_per_m
    cx, cy = g.center
    half = g.print_area_mm[0] / 1000.0 / 2
    top = g.print_area_top_y
    bottom = top - g.print_area_mm[1] / 1000.0

    def px(x, y):
        return [round(w / 2 + (x - cx) * ppm, 1), round(h / 2 - (y - cy) * ppm, 1)]

    return [px(-half, top), px(half, top), px(half, bottom), px(-half, bottom)]


def write_template(g, out_dir):
    """template.json im Format MockupTemplate (packs/schema/mockup.schema.json)."""
    w, h = garments.CANVAS
    shared = {"mask": "mask.png", "displace": "displace.png", "texture": None, "heather": "heather.png", "background": None}
    data = {
        "$schema": "../../schema/mockup.schema.json",
        "formatVersion": 1,
        "id": g.id,
        "title": g.title,
        "product": g.product,
        "view": g.view,
        "canvas": {"width": w, "height": h},
        "printProfileId": g.print_profile,
        "printArea": {"quad": print_quad_px(g)},
        "displaceStrengthPx": g.displace_px,
        "variants": [
            {"exposure": "light", "layers": {**shared, "shade": "shade.png", "light": "light.png"}, "colorIds": LIGHT_COLORS},
            {"exposure": "dark", "layers": {**shared, "shade": "shade.png", "light": "light-dark.png"}, "colorIds": DARK_COLORS},
        ],
    }
    order = ["$schema", "formatVersion", "id", "title", "product", "view", "canvas", "printProfileId", "printArea", "displaceStrengthPx", "variants"]
    text = json.dumps({k: data[k] for k in order}, indent=2, ensure_ascii=False) + "\n"
    (Path(out_dir) / "template.json").write_text(text, encoding="utf-8")


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

    def arg(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default

    gid = arg("--garment", "tee-front")
    work = os.path.expanduser(arg("--work", "~/mock/work"))
    out = os.path.expanduser(arg("--out", "~/mock/out"))
    build_layers(gid, work, out)


if __name__ == "__main__":
    main()
