# SPDX-License-Identifier: GPL-3.0-or-later
"""Schnittmuster und Faltenmodelle der Mockup-Grundlagen (T-Shirt, Hoodie; vorne und hinten).

Alles in Metern. Ein Kleidungsstück besteht aus Lagen (`Panel`): jede hat einen Umriss, eine
Grundhöhe und Höhenmerkmale (Falten, Wölbungen, Bündchen). Dazu kommen Bänder mit Rippenstruktur
(`RibBand`) und Nähte/Stiche (`Seam`), die als Geometrie auf der Oberfläche liegen.
Die Zahlen sind Maße eines Unisex-Shirts bzw. -Hoodies in Größe L, flach ausgelegt.
"""

import math
from dataclasses import dataclass, field

import numpy as np

from fields import Dome, Feature, Ridge, Waves, bezier, ellipse_arc, offset_polyline, spline

CM = 0.01
FOLD_GAIN = 2.0


@dataclass
class RibBand:
    """Rippenband (Kragen, Bündchen): Mittellinie, halbe Breite, Rippenabstand, Höhe über dem Stoff."""

    line: np.ndarray
    half_width: float
    pitch: float = 0.0032
    height: float = 0.0018
    rib_amp: float = 0.0006
    ribbed: bool = True  # False: glattes Band (Nackenband, Kapuzenkante)
    edge: float = 0.0030  # Breite des Übergangs an den Bandkanten


@dataclass
class Seam:
    """Naht oder Stichreihe als Linie auf der Oberfläche."""

    line: np.ndarray
    kind: str  # "ridge" (Nahtwulst) | "stitch" (Steppstich, gestrichelt) | "double" (zwei Stichreihen)
    width: float = 0.0016
    height: float = 0.0007
    dash: float = 0.0026
    gap: float = 0.0012
    gap_rows: float = 0.0035  # Abstand der beiden Reihen bei "double"
    closed: bool = False  # geschlossene Schleife (Ösen): Enden laufen nicht aus


@dataclass
class Panel:
    name: str
    outline: np.ndarray  # geschlossen, gegen den Uhrzeigersinn, Meter
    z_base: float
    features: list = field(default_factory=list)
    bands: list = field(default_factory=list)
    seams: list = field(default_factory=list)
    edge_roll: float = 0.0009  # Kante rundet sich über edge_width ab
    edge_width: float = 0.004
    corner_pts: list = field(default_factory=list)


@dataclass
class Garment:
    id: str
    title: str
    product: str  # "tee" | "hoodie"
    view: str  # "front" | "back"
    panels: list  # von unten nach oben
    px_per_m: float
    center: tuple  # Bildmitte in Metern (x, y)
    print_profile: str
    print_area_mm: tuple  # (Breite, Höhe) der Shirtigo-Druckfläche
    print_area_top_y: float  # Oberkante der Druckfläche (Meter, y), Mitte x = 0
    displace_px: float = 5.0
    mesh_h: float = 0.0042  # Punktabstand des Netzes (Meter); der Rand wird halb so fein abgetastet
    meta: dict = field(default_factory=dict)


CANVAS = (2000, 2500)


def _poly_from_half(paths):
    """Rechte Hälfte als Pfadliste (Mitte oben -> Mitte unten) spiegeln zu geschlossenem Umriss (CCW)."""
    pts = []
    for p in paths:
        p = np.asarray(p, float)
        pts.extend(p if not pts else p[1:])
    right = np.array(pts)
    left = right[::-1].copy()
    left[:, 0] *= -1.0
    # Start oben Mitte -> rechts runter -> unten Mitte -> links hoch: im Uhrzeigersinn; für CCW umdrehen
    full = np.vstack([right, left[1:-1]]) if abs(right[-1][0]) < 1e-9 and abs(right[0][0]) < 1e-9 else np.vstack([right, left])
    return full[::-1].copy()


def _half_paths_tee(neck_depth, cfg):
    S = np.array(cfg["shoulder"])
    th = math.radians(cfg["sleeve_angle"])
    C1 = S + cfg["sleeve_len"] * np.array([math.cos(th), -math.sin(th)])
    C2 = C1 + cfg["cuff_w"] * np.array([-math.sin(th), -math.cos(th)])
    A = np.array(cfg["armpit"])
    Hc = np.array(cfg["hem_corner"])
    neck_a = cfg["neck_half"]
    neck = ellipse_arc(0.0, cfg["shoulder_top"], neck_a, neck_depth, -90, 0, 60)
    N = neck[-1]
    # Schulterlinie leicht gebogen, Ärmelkanten gerade, Nähte als weiche Ecken
    shoulder = bezier(N, N + (S - N) * 0.35 + [0, 0.0015], N + (S - N) * 0.7 + [0, 0.0010], S, 24)
    sleeve_top = np.vstack([S, C1])
    cuff = np.vstack([C1, C2])
    under = np.vstack([C2, A])
    side = np.vstack([A, Hc])
    hem = np.vstack([Hc, [0.0, 0.0]])
    return [neck, shoulder, sleeve_top, cuff, under, side, hem], dict(S=S, C1=C1, C2=C2, A=A, N=N, Hc=Hc)


TEE = dict(
    shoulder=(0.240, 0.713),
    shoulder_top=0.740,
    sleeve_angle=33.0,
    sleeve_len=0.215,
    cuff_w=0.190,
    armpit=(0.282, 0.510),
    hem_corner=(0.272, 0.0),
    neck_half=0.086,
)


def build_tee(view):
    cfg = TEE
    front_depth, back_depth = 0.090, 0.026
    paths_f, pts_f = _half_paths_tee(front_depth, cfg)
    paths_b, pts_b = _half_paths_tee(back_depth, cfg)
    outline_front = _poly_from_half(paths_f)
    outline_back = _poly_from_half(paths_b)
    top_is_front = view == "front"
    panels = []
    for name, outline, paths, pts, depth, is_top in (
        ("back" if top_is_front else "front", outline_back if top_is_front else outline_front, paths_b if top_is_front else paths_f, pts_b if top_is_front else pts_f, back_depth if top_is_front else front_depth, False),
        ("front" if top_is_front else "back", outline_front if top_is_front else outline_back, paths_f if top_is_front else paths_b, pts_f if top_is_front else pts_b, front_depth if top_is_front else back_depth, True),
    ):
        panels.append(_tee_panel(name, outline, paths, pts, depth, is_top, top_is_front))
    # Druckfläche: Oberkante 26 mm (vorne) bzw. 74 mm (hinten) unter dem Kragen (Shirtigo-Hinweisgröße)
    if top_is_front:
        collar_bottom = cfg["shoulder_top"] - front_depth - 2 * 0.011
        top = collar_bottom - 0.026
    else:
        collar_bottom = cfg["shoulder_top"] - back_depth - 2 * 0.011
        top = collar_bottom - 0.074
        top = min(top, collar_bottom - 0.030)
    g = Garment(
        id=f"tee-{view}",
        title="Shirt vorne" if top_is_front else "Shirt hinten",
        product="tee",
        view=view,
        panels=panels,
        px_per_m=2150.0,
        center=(0.0, 0.372),
        print_profile=f"shirtigo-tee-{view}",
        print_area_mm=(330, 450),
        print_area_top_y=top,
        displace_px=5.0,
        meta=dict(pts=pts_f),
    )
    return g


def _tee_panel(name, outline, paths, pts, neck_depth, is_top, top_is_front):
    cfg = TEE
    S, C1, C2, A, Hc, N = (pts[k] for k in ("S", "C1", "C2", "A", "Hc", "N"))
    rng = np.random.default_rng(11 if top_is_front else 23)
    z0 = 0.0042 if is_top else 0.0015
    feats: list[Feature] = []
    seams: list[Seam] = []
    bands: list[RibBand] = []
    # Kragen: Rippenband entlang des Halsausschnitts, innen am Stoffrand
    neck = paths[0]
    neck_full = np.vstack([(neck[::-1] * np.array([-1.0, 1.0]))[:-1], neck])  # links -> Mitte -> rechts
    collar_line = offset_polyline(neck_full, -0.011)  # Laufrichtung gegen den Uhrzeigersinn: rechts = Stoff
    bands.append(RibBand(collar_line, 0.011, height=0.0021))
    # Armlochnaht (Bogen von der Schulterspitze zur Achsel)
    armhole = spline([S, S + [-0.016, -0.060], S + [-0.025, -0.115], A + [-0.020, 0.030], A], 12)
    for sgn in (1, -1):
        seams.append(Seam(armhole * np.array([sgn, 1.0]), "ridge", width=0.0016, height=0.0008))
    # Säume: Körper 2,5 cm, Ärmel 2,0 cm; doppelte Steppnaht
    hem_line = np.vstack([[Hc[0] - 0.006, 0.0245], [0.12, 0.0255], [0.0, 0.0258], [-0.12, 0.0255], [-(Hc[0] - 0.006), 0.0245]])
    seams.append(Seam(spline(hem_line, 10), "double"))
    for sgn in (1, -1):
        c1 = np.array([sgn * C1[0], C1[1]])
        c2 = np.array([sgn * C2[0], C2[1]])
        axis = np.array([sgn * (C1[0] - S[0]), C1[1] - S[1]])
        axis /= np.hypot(*axis)
        seams.append(Seam(np.array([c1 - axis * 0.020, c2 - axis * 0.020]), "double"))
    # Schulternähte (leichter Wulst entlang der Schulterlinie, 4 mm innen)
    for sgn in (1, -1):
        sh = np.array([[sgn * N[0], N[1] - 0.004], [sgn * S[0], S[1] - 0.004]])
        seams.append(Seam(sh, "ridge", width=0.0012, height=0.0005))
    # Wölbungen und Falten (nur der obere Stoff ist wirklich wellig; der untere ist nahezu glatt).
    # `facing` = die sichtbare obere Lage ist die Vorderseite; die Rückseite liegt glatter, mit Schulterblatt- und Rückenfalten.
    amp = (1.0 if is_top else 0.35) * FOLD_GAIN
    facing = name == "front"
    feats.append(Dome(0.0, 0.40, 0.17, 0.24, 0.0045 * amp))
    arm = 1.0 if facing else 0.55
    for sgn in (1, -1):
        j = rng.uniform(0.85, 1.15)
        feats.append(Ridge([[sgn * 0.265, 0.500], [sgn * 0.215, 0.470], [sgn * 0.150, 0.440]], 0.0024 * j * amp * arm, 0.010, 0.006, 0.4))
        feats.append(Ridge([[sgn * 0.268, 0.482], [sgn * 0.225, 0.440], [sgn * 0.175, 0.395]], 0.0017 * j * amp * arm, 0.009, 0.006, 0.4))
        feats.append(Ridge([[sgn * 0.270, 0.462], [sgn * 0.240, 0.410], [sgn * 0.205, 0.360]], 0.0012 * j * amp * arm, 0.008, 0.005, 0.4))
        feats.append(Ridge([[sgn * 0.300, 0.640], [sgn * 0.345, 0.590], [sgn * 0.385, 0.540]], 0.0017 * j * amp, 0.008, 0.005, 0.35))
        feats.append(Ridge([[sgn * 0.345, 0.560], [sgn * 0.352, 0.520], [sgn * 0.335, 0.492]], 0.0010 * j * amp, 0.007, 0.004, 0.4))
        if not facing:  # Schulterblattfalten schräg zur Wirbelsäule
            feats.append(Ridge([[sgn * 0.225, 0.585], [sgn * 0.150, 0.555], [sgn * 0.070, 0.540]], 0.0014 * j * amp, 0.012, 0.008, 0.4))
    feats.append(Ridge([[-0.190, 0.262], [-0.050, 0.248], [0.080, 0.262], [0.215, 0.292]], 0.0014 * amp, 0.016, 0.012, 0.4))
    feats.append(Ridge([[-0.215, 0.168], [-0.080, 0.150], [0.090, 0.160], [0.225, 0.190]], 0.0011 * amp, 0.015, 0.011, 0.4))
    if facing:
        feats.append(Ridge([[-0.120, 0.550], [-0.050, 0.532], [0.040, 0.540], [0.115, 0.560]], 0.0010 * amp, 0.012, 0.009, 0.4))
    else:
        feats.append(Ridge(spline([[0.004, 0.610], [-0.006, 0.500], [0.008, 0.380], [-0.004, 0.250]], 10), 0.0009 * amp, 0.016, 0.012, 0.35))
    feats.append(Waves(0.00022 * amp, 0.070, seed=7 if facing else 31, count=28, anisotropy=0.8))
    return Panel(name=name, outline=outline, z_base=z0, features=feats, bands=bands, seams=seams, edge_roll=0.0010 if is_top else 0.0006)


def shrink_outline(outline, dist):
    """Umriss gleichmäßig zur Mitte hin verkleinern (für die Unterlage, damit sie nie über die obere Lage ragt)."""
    pts = np.asarray(outline, float)
    c = pts.mean(axis=0)
    v = pts - c
    return c + v * (1.0 - dist / np.maximum(np.hypot(*v.T).max(), 1e-9))


def build(garment_id):
    kind, view = garment_id.rsplit("-", 1)
    if kind == "tee":
        return build_tee(view)
    if kind == "hoodie":
        import hoodie

        return hoodie.build(view)
    raise KeyError(garment_id)


ALL_IDS = ("tee-front", "tee-back", "hoodie-front", "hoodie-back")
