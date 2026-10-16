# SPDX-License-Identifier: GPL-3.0-or-later
"""Prüft die Mockup-Grundlagen unter packs/mockups (läuft in Blender, nur zum Bilddecodieren).

    blender -b --factory-startup --python-exit-code 1 -P tests/check_mockups.py

Je Vorlage: template.json vollständig und stimmig (Schema-Felder, Druckfläche, Farben), alle Ebenen vorhanden,
8 Bit, Leinwand ≥ 2000 px, Maske deckt das Viereck der Druckfläche ab, Shade/Light/Displace/Heather mit sinnvollen
Wertebereichen, Vorschaubild vorhanden. Das Schema selbst prüft `packs/tools/validate.mjs` (Team C1).
"""

import json
import struct
import sys
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2] / "mockups"
BRAND = Path(__file__).resolve().parents[2] / "shared" / "brand" / "brand.json"
IDS = {
    "tee-front": ("tee", "front", (330, 450), "shirtigo-tee-front"),
    "tee-back": ("tee", "back", (330, 450), "shirtigo-tee-back"),
    "hoodie-front": ("hoodie", "front", (330, 280), "shirtigo-hoodie-front"),
    "hoodie-back": ("hoodie", "back", (330, 390), "shirtigo-hoodie-back"),
}
COLOR_TYPE = {"mask": 6, "shade": 0, "light": 0, "light-dark": 0, "displace": 2, "heather": 0, "preview": 2}
problems = []


def need(cond, text):
    if not cond:
        problems.append(text)


def png_header(path):
    data = path.read_bytes()[:33]
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"{path.name}: kein PNG"
    w, h, depth, ctype = struct.unpack(">IIBB", data[16:26])
    return w, h, depth, ctype


def load(path):
    img = bpy.data.images.load(str(path))
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    arr = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(arr)
    bpy.data.images.remove(img)
    return arr.reshape(h, w, 4)[::-1]  # Zeile 0 = oben, Werte 0..1


def check(gid):
    folder = ROOT / gid
    product, view, mm, profile = IDS[gid]
    tpl = json.loads((folder / "template.json").read_text(encoding="utf-8"))
    need(tpl["id"] == gid and tpl["product"] == product and tpl["view"] == view, f"{gid}: id/product/view")
    need(tpl["printProfileId"] == profile, f"{gid}: printProfileId {tpl['printProfileId']}")
    cw, ch = tpl["canvas"]["width"], tpl["canvas"]["height"]
    need(cw >= 2000 and ch >= 2000, f"{gid}: Leinwand {cw}x{ch} kleiner als 2000 px")
    colors = {c["id"] for c in json.loads(BRAND.read_text(encoding="utf-8"))["garmentColors"]}
    seen = set()
    for variant in tpl["variants"]:
        need(variant["exposure"] in {"light", "dark"}, f"{gid}: exposure")
        for cid in variant["colorIds"]:
            need(cid in colors, f"{gid}: unbekannte Farbe {cid}")
            need(cid not in seen, f"{gid}: Farbe {cid} doppelt")
            seen.add(cid)
        for key, rel in variant["layers"].items():
            if rel is not None:
                need((folder / rel).is_file(), f"{gid}: Ebene {key} fehlt ({rel})")
    need(seen == colors, f"{gid}: Farben nicht vollständig abgedeckt: {sorted(colors - seen)}")
    quad = tpl["printArea"]["quad"]
    need(len(quad) == 4, f"{gid}: Viereck")
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = ((p["x"], p["y"]) for p in quad)
    wpx, hpx = x1 - x0, y3 - y0
    need(abs(wpx / hpx - mm[0] / mm[1]) < 0.01, f"{gid}: Druckfläche {wpx:.0f}x{hpx:.0f} px passt nicht zu {mm[0]}x{mm[1]} mm")
    need(abs(y1 - y0) < 0.5 and abs(x2 - x1) < 0.5 and abs(x3 - x0) < 0.5, f"{gid}: Viereck kein Rechteck (Draufsicht)")
    need(all(0 <= p["x"] <= cw and 0 <= p["y"] <= ch for p in quad), f"{gid}: Viereck außerhalb der Leinwand")
    need(abs((x0 + x1) / 2 - cw / 2) < 2, f"{gid}: Druckfläche nicht mittig")
    px_per_cm = wpx / (mm[0] / 10)

    # Dateiköpfe
    for name, ctype in COLOR_TYPE.items():
        path = folder / f"{name}.png"
        need(path.is_file(), f"{gid}: {name}.png fehlt")
        if not path.is_file():
            continue
        w, h, depth, ct = png_header(path)
        need(depth == 8 and ct == ctype, f"{gid}: {name}.png Tiefe {depth} Typ {ct}, erwartet 8/{ctype}")
        if name != "preview":
            need((w, h) == (cw, ch), f"{gid}: {name}.png {w}x{h} statt {cw}x{ch}")
        else:
            need(w >= 2000 and h >= 1000, f"{gid}: preview.png nur {w}x{h}")

    # Inhalt
    mask = load(folder / "mask.png")[..., 3]
    coverage = float((mask > 0.5).mean())
    need(0.20 < coverage < 0.75, f"{gid}: Maske deckt {coverage:.0%} der Leinwand")
    xs = [int(round(v)) for v in (x0, x1 - 1)]
    ys = [int(round(v)) for v in (y0, y3 - 1)]
    for x in xs:
        for y in ys:
            need(mask[y, x] > 0.9, f"{gid}: Druckflächenecke ({x}, {y}) liegt nicht auf dem Stoff")
    inside = mask > 0.98
    shade = load(folder / "shade.png")[..., 0]
    need(0.90 < float(np.median(shade[inside])) <= 1.0, f"{gid}: Shade-Median {np.median(shade[inside]):.3f} (flache Fläche soll fast weiß sein)")
    need(float(shade[inside].min()) < 0.82, f"{gid}: Shade ohne Falten (Minimum {shade[inside].min():.2f})")
    for lname in ("light", "light-dark"):
        light = load(folder / f"{lname}.png")[..., 0]
        need(float(light.max()) < 0.5 and float(light[~(mask > 0)].max(initial=0.0)) == 0.0, f"{gid}: {lname} zu hell oder außerhalb des Stoffs")
    need(float(load(folder / "light-dark.png")[..., 0].max()) > 0.04, f"{gid}: light-dark ohne Glanz")
    disp = load(folder / "displace.png")
    need(abs(float(disp[..., 0][inside].mean()) * 255 - 128) < 4 and abs(float(disp[..., 1][inside].mean()) * 255 - 128) < 4, f"{gid}: Displace nicht mittelwertfrei")
    need(float(np.abs(disp[..., 0][inside] * 255 - 128).max()) > 40, f"{gid}: Displace ohne Ausschlag")
    heather = load(folder / "heather.png")[..., 0]
    need(abs(float(heather.mean()) * 255 - 128) < 6 and float(heather.std()) * 255 > 4, f"{gid}: heather Mittel/Streuung")
    print(f"  {gid}: {cw}x{ch}, Maske {coverage:.0%}, Druckfläche {wpx:.0f} x {hpx:.0f} px ({px_per_cm:.1f} px/cm), Shade-Median {np.median(shade[inside]):.3f}")


need((ROOT / "LICENSE").is_file(), "packs/mockups/LICENSE fehlt")
ids = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else list(IDS)
for gid in ids:
    check(gid)
if problems:
    print("MOCKUP-FEHLER:\n  " + "\n  ".join(problems))
    sys.exit(1)
print("Mockup-Grundlagen geprüft:", ", ".join(ids))
