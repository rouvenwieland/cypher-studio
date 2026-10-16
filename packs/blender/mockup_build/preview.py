# SPDX-License-Identifier: GPL-3.0-or-later
"""Vorschau einer Mockup-Vorlage: Testmotiv in zwei Kollektionsfarben (läuft in Blender, nur für Bild-E/A).

    blender -b --factory-startup --python preview.py -- --garment tee-front --mockups <packs/mockups> --colors grau-meliert,schwarz

Die Komposition folgt ARCHITEKTUR 5.4 (Canvas-2D-Pipeline der App), nur mit numpy:
  1. Stofffarbe (textileHex) füllen, mit `mask` beschneiden
  2. bei Melange `heather` per soft-light
  3. Motiv (Druckfläche mm -> Pixel über das Viereck, `displace` verzerrt es) mit source-over auf den Stoff
  4. `shade` per multiply über Stoff und Motiv, dann `light` per screen
Die Bühne dahinter (Grau mit weichem Schatten) ist nur Vorschauschmuck und gehört nicht zu den Ebenen.
"""

import json
import math
import os
import sys
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import png_io  # noqa: E402
from maps import gaussian_blur  # noqa: E402

BRAND = HERE.parents[1] / "shared" / "brand" / "brand.json"
# Testmotiv 3:4 je Vorlage: (Breite mm, Abstand zur Oberkante der Druckfläche mm) - Brust 300 x 400 mm; der Hoodie-Bauch ist nur 280 mm hoch
PLACEMENT = {"tee-front": (300.0, 22.0), "tee-back": (300.0, 30.0), "hoodie-front": (200.0, 8.0), "hoodie-back": (280.0, 10.0)}


# --------------------------------------------------------------------------- Bild-E/A


def read_layer(path, channels):
    """Liest ein 8-Bit-PNG unverändert als uint8-Array (H, W, channels)."""
    img = bpy.data.images.load(str(path))
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    arr = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(arr)
    bpy.data.images.remove(img)
    out = np.round(arr.reshape(h, w, 4)[::-1] * 255).astype(np.uint8)
    return out[..., :channels]


def hex_rgb(hex_color):
    h = hex_color.lstrip("#")
    return np.array([int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)])


# --------------------------------------------------------------------------- Mischmodi (W3C compositing)


def soft_light(cb, cs):
    d = np.where(cb <= 0.25, ((16 * cb - 12) * cb + 4) * cb, np.sqrt(cb))
    return np.where(cs <= 0.5, cb - (1 - 2 * cs) * cb * (1 - cb), cb + (2 * cs - 1) * (d - cb))


def srgb_to_linear_scalar(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# --------------------------------------------------------------------------- Testmotiv


def test_motif(w, h, supersample=3):
    """Eigenes Testmotiv (Messzifferblatt) im Seitenverhältnis 3:4, RGBA (nicht vormultipliziert)."""
    W, H = w * supersample, h * supersample
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    u = (xx + 0.5) / W - 0.5  # -0.5 .. 0.5 (Einheit: Motivbreite)
    v = ((yy + 0.5) - H / 2.0) / W  # gleiche Einheit wie u, Höhe = 4/3
    unit = 1.0 / W  # eine Breite = 1
    cx, cy = 0.0, -0.105
    r = np.hypot(u - cx, v - cy)
    ang = np.degrees(np.arctan2(v - cy, u - cx)) % 360.0
    aa = 1.2 * unit

    def edge(d):  # weiche Kante, d < 0 = innen
        return np.clip(0.5 - d / aa, 0.0, 1.0)

    cyan, magenta, paper = hex_rgb("#00d4d8"), hex_rgb("#ff4fd8"), hex_rgb("#efeee9")
    col = np.zeros((H, W, 3))
    alpha = np.zeros((H, W))

    def paint(a, rgb):
        nonlocal col, alpha
        out_a = a + alpha * (1 - a)
        col = np.where(out_a[..., None] > 0, (rgb * a[..., None] + col * alpha[..., None] * (1 - a[..., None])) / np.maximum(out_a[..., None], 1e-9), col)
        alpha = out_a

    r0 = 0.44
    paint(edge(np.abs(r - r0) - 0.030), cyan)  # Außenring
    paint(edge(np.abs(r - (r0 - 0.075)) - 0.0035), cyan)  # feiner Innenring
    # Skala: kurze Striche alle 5 Grad, lange alle 30 Grad
    step = np.round(ang / 5.0) * 5.0
    arc = np.abs(ang - step) * math.pi / 180.0 * r
    long_tick = (np.round(ang / 30.0) * 30.0 - step == 0)
    tick_len = np.where(long_tick, 0.085, 0.045)
    tick_w = np.where(long_tick, 0.0075, 0.0042)
    ring_in = r0 - 0.100
    tick = edge(np.maximum(arc - tick_w / 2, np.maximum(ring_in - tick_len - r, r - ring_in))) * (r < ring_in + 0.002)
    paint(tick, paper)
    # Nadel (magenta) und Nabe
    th = math.radians(-52.0)
    dx, dy = math.cos(th), math.sin(th)
    along = (u - cx) * dx + (v - cy) * dy
    perp = np.abs(-(u - cx) * dy + (v - cy) * dx)
    taper = 0.011 * (1 - np.clip(along / 0.36, 0, 1) * 0.7)
    needle = edge(np.maximum(perp - taper, np.maximum(-along - 0.06, along - 0.36)))
    paint(needle, magenta)
    paint(edge(r - 0.032), magenta)
    paint(edge(np.abs(r - 0.032) - 0.003), paper)
    # Fußzeile: gestaffelte Balken wie ein Messprotokoll
    base_y = 0.545
    for i, (width, color) in enumerate([(0.74, cyan), (0.46, magenta), (0.60, cyan)]):
        y = base_y + i * 0.062
        bar = edge(np.maximum(np.abs(u) - width / 2, np.abs(v - y) - 0.014))
        paint(bar, color)
    rgba = np.concatenate([col, alpha[..., None]], axis=2)
    # Mittelwert über die Überabtastung (Farbe nach Alpha gewichtet)
    pm = rgba.copy()
    pm[..., :3] *= pm[..., 3:4]
    pm = pm.reshape(h, supersample, w, supersample, 4).mean(axis=(1, 3))
    a = pm[..., 3]
    rgb = pm[..., :3] / np.maximum(a, 1e-6)[..., None]
    return np.concatenate([rgb, a[..., None]], axis=2)


# --------------------------------------------------------------------------- Komposition


def bilinear_sample(img, xs, ys):
    h, w = img.shape[:2]
    x0 = np.clip(np.floor(xs).astype(int), 0, w - 1)
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 1)
    x1 = np.clip(x0 + 1, 0, w - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    fx = (xs - np.floor(xs))[..., None]
    fy = (ys - np.floor(ys))[..., None]
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x1] * fx * (1 - fy) + img[y1, x0] * (1 - fx) * fy + img[y1, x1] * fx * fy)


def compose(layers, template, color, motif_rgba, placement, brand):
    """Wendet die Ebenen auf eine Textilfarbe an. Liefert (RGB float 0..1, Alpha float)."""
    h, w = layers["mask"].shape[:2]
    mask = layers["mask"][..., 3] / 255.0
    shade = layers["shade"][..., 0] / 255.0
    light = layers["light"][..., 0] / 255.0
    base = np.ones((h, w, 3)) * hex_rgb(color["textileHex"])
    if color["heather"] and layers.get("heather") is not None:
        hv = layers["heather"][..., 0:1] / 255.0
        base = soft_light(base, np.repeat(hv, 3, axis=2))
    # Motiv auf die Druckfläche setzen
    quad = template["printArea"]["quad"]
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = ((p["x"], p["y"]) for p in quad)
    area_w_px = math.hypot(x1 - x0, y1 - y0)
    px_per_mm = area_w_px / template["_printAreaMm"][0]
    mw = placement["widthMm"] * px_per_mm
    mh = mw * 4.0 / 3.0
    left = (x0 + x1) / 2 + placement["offsetCenterMm"] * px_per_mm - mw / 2
    top = y0 + placement["offsetTopMm"] * px_per_mm
    mpx_w, mpx_h = int(round(mw)), int(round(mh))
    pm = motif_rgba(mpx_w, mpx_h)
    layer = np.zeros((h, w, 4))
    ix, iy = int(round(left)), int(round(top))
    layer[iy : iy + mpx_h, ix : ix + mpx_w] = pm
    layer[..., :3] *= layer[..., 3:4]  # vormultipliziert
    # Verzerrung: je Pixel an (x - dx, y - dy) abtasten
    disp = layers["displace"].astype(np.float64)
    strength = template["displaceStrengthPx"]
    dxm = (disp[..., 0] - 128.0) / 127.0 * strength
    dym = (disp[..., 1] - 128.0) / 127.0 * strength
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float64), np.arange(h, dtype=np.float64))
    layer = bilinear_sample(layer, gx - dxm, gy - dym)
    # Kanten leicht weichzeichnen (0,5 px)
    for c in range(4):
        layer[..., c] = gaussian_blur(layer[..., c], 0.5)
    a = np.clip(layer[..., 3:4], 0, 1)
    out = layer[..., :3] + base * (1 - a)
    out = out * shade[..., None]  # multiply
    out = 1.0 - (1.0 - out) * (1.0 - light[..., None])  # screen
    return np.clip(out, 0, 1), mask


def stage(rgb, alpha, bg_hex, scale_down=2, shadow=0.30):
    """Kachel auf grauer Bühne mit weichem Kontaktschatten (nur Vorschauschmuck)."""
    h, w = alpha.shape
    bg = np.ones((h, w, 3)) * hex_rgb(bg_hex)
    sh = gaussian_blur(np.roll(alpha, (22, 8), axis=(0, 1)), 22.0)
    sh2 = gaussian_blur(np.roll(alpha, (6, 3), axis=(0, 1)), 5.0)
    shadow_a = np.clip(shadow * (0.65 * sh + 0.5 * sh2), 0, 0.5)[..., None]
    comp = bg * (1 - shadow_a)
    comp = comp * (1 - alpha[..., None]) + rgb * alpha[..., None]
    if scale_down > 1:
        comp = comp[: h // scale_down * scale_down, : w // scale_down * scale_down].reshape(h // scale_down, scale_down, w // scale_down, scale_down, 3).mean(axis=(1, 3))
    return comp


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

    def arg(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default

    gid = arg("--garment", "tee-front")
    root = Path(os.path.expanduser(arg("--mockups", "~/mock/out")))
    colors = arg("--colors", "weiss,schwarz").split(",")
    folder = root / gid
    import garments

    template = json.loads((folder / "template.json").read_text(encoding="utf-8"))
    template["_printAreaMm"] = garments.build(gid).print_area_mm
    brand = json.loads(BRAND.read_text(encoding="utf-8"))
    by_id = {c["id"]: c for c in brand["garmentColors"]}
    width_mm, top_mm = PLACEMENT[gid]
    placement = {"widthMm": width_mm, "offsetTopMm": top_mm, "offsetCenterMm": 0.0}
    shared = {
        "mask": read_layer(folder / template["variants"][0]["layers"]["mask"], 4),
        "displace": read_layer(folder / template["variants"][0]["layers"]["displace"], 3),
    }
    tiles = []
    for cid in colors:
        color = by_id[cid]
        variant = next(v for v in template["variants"] if cid in v["colorIds"])
        lay = variant["layers"]
        layers = dict(shared)
        layers["shade"] = read_layer(folder / lay["shade"], 1)
        layers["light"] = read_layer(folder / lay["light"], 1)
        layers["heather"] = read_layer(folder / lay["heather"], 1) if lay.get("heather") else None
        rgb, alpha = compose(layers, template, color, test_motif, placement, brand)
        tiles.append(stage(rgb, alpha, "#d9d8d3"))
    sheet = np.concatenate(tiles, axis=1)
    img = np.round(np.clip(sheet, 0, 1) * 255).astype(np.uint8)
    n = png_io.write_png(folder / "preview.png", img)
    print(f"{gid}: preview.png {img.shape[1]}x{img.shape[0]}, {n / 1024:.0f} KB ({', '.join(colors)})")


if __name__ == "__main__":
    main()
