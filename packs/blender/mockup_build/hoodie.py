# SPDX-License-Identifier: GPL-3.0-or-later
"""Schnittmuster und Faltenmodell des Hoodies (vorne, hinten), Unisex Größe L, flach ausgelegt.

Eine Lage trägt Rumpf, Ärmel und Kapuze; Rippenbünde, Nähte, Tasche und Kordelösen sind Merkmale darauf.
"""

import math

import numpy as np

import garments as G
from fields import Dome, Feature, Plateau, Ridge, Waves, bezier, spline

CM = G.CM

CFG = dict(
    hood_pts=[(0, 104.0), (7.0, 102.8), (12.8, 98.4), (16.4, 91.0), (17.2, 83.0), (15.2, 76.0), (10.8, 70.9)],
    shoulder=(27.2, 67.6),
    sleeve_phi=30.0,  # Ärmel zeigen 30 Grad von der Senkrechten nach außen
    sleeve_len=60.0,
    cuff_w=9.5,
    underside_deg=33.0,
    side_x=31.0,
    rib_top=(28.2, 8.0),
    hem_corner=(27.4, 0.0),
    face=(0.0, 74.0, 8.45, 10.6),  # Mitte x, y und Halbachsen der Kapuzenöffnung
)


def _c(points):
    return np.asarray(points, float) * CM


def geometry():
    c = CFG
    hood = spline(_c(c["hood_pts"]), 14)
    N = hood[-1]
    S = _c(c["shoulder"])
    phi = math.radians(c["sleeve_phi"])
    d = np.array([math.sin(phi), -math.cos(phi)])
    C1 = S + c["sleeve_len"] * CM * d
    n_in = np.array([-math.cos(phi), -math.sin(phi)])
    C2 = C1 + c["cuff_w"] * CM * n_in
    ang = math.radians(c["underside_deg"])
    u = np.array([-math.sin(ang), math.cos(ang)])
    t = (C2[0] - c["side_x"] * CM) / -u[0]
    A = C2 + u * t
    R = np.array([c["side_x"] * CM, 0.090])
    R2, Hc = _c(c["rib_top"]), _c(c["hem_corner"])
    shoulder = bezier(N, N + (S - N) * 0.35 + [0, 0.002], N + (S - N) * 0.7 + [0, 0.001], S, 24)
    paths = [hood, shoulder, np.vstack([S, C1]), np.vstack([C1, C2]), np.vstack([C2, A]), np.vstack([A, R]), np.vstack([R, R2]), np.vstack([R2, Hc]), np.vstack([Hc, [0.0, 0.0]])]
    return paths, dict(N=N, S=S, C1=C1, C2=C2, A=A, R=R, R2=R2, Hc=Hc, d=d, n_in=n_in)


def _ridge(points_cm, h_mm, wl_mm, wr_mm=None, taper=0.35, amp=1.0, sgn=1):
    pts = _c(points_cm) * np.array([sgn, 1.0])
    return Ridge(pts, h_mm * 1e-3 * amp, wl_mm * 1e-3, (wr_mm if wr_mm is not None else wl_mm) * 1e-3, taper)


def build(view):
    cfg = CFG
    top_is_front = view == "front"
    paths, P = geometry()
    outline = G._poly_from_half(paths)
    N, S, C1, C2, A, R, R2, Hc, d, n_in = (P[k] for k in ("N", "S", "C1", "C2", "A", "R", "R2", "Hc", "d", "n_in"))
    rng = np.random.default_rng(41 if top_is_front else 53)
    amp = G.FOLD_GAIN
    feats: list[Feature] = []
    seams: list[G.Seam] = []
    bands: list[G.RibBand] = []
    fx, fy, fa, fb = (v * CM for v in cfg["face"])
    ang = np.radians(np.linspace(0, 360, 120))

    # Rippenbund und Bündchen (Rippen), glatte Bänder an der Kapuze
    bands.append(G.RibBand(np.array([[-0.272, 0.040], [0.272, 0.040]]), 0.040, pitch=0.0034, height=0.0014))
    for sgn in (1, -1):
        c1, c2, dd = C1 * [sgn, 1.0], C2 * [sgn, 1.0], d * [sgn, 1.0]
        bands.append(G.RibBand(np.array([c1 - dd * 0.0375, c2 - dd * 0.0375]), 0.0375, pitch=0.0034, height=0.0016))
    if top_is_front:
        ring = np.stack([fx + (fa + 0.0125) * np.cos(ang), fy + (fb + 0.0125) * np.sin(ang)], axis=1)
        bands.append(G.RibBand(np.vstack([ring, ring[:1]]), 0.0125, height=0.0030, ribbed=False, edge=0.0070))
        face_poly = np.stack([fx + fa * np.cos(ang), fy + fb * np.sin(ang)], axis=1)
        feats.append(Plateau(face_poly, -0.0055, edge=0.0100))  # Öffnung liegt vertieft (Futter)
    else:
        tape = spline([[-0.108, 0.709], [-0.070, 0.682], [0.0, 0.670], [0.070, 0.682], [0.108, 0.709]], 14)
        bands.append(G.RibBand(tape, 0.0120, height=0.0024, ribbed=False, edge=0.0055))

    # Rumpf und Kapuze: Wölbungen, Falten
    feats.append(Dome(0.0, 0.36, 0.22, 0.27, 0.0030 * amp))
    feats.append(Dome(0.0, 0.86, 0.12, 0.15, 0.0100))
    for sgn in (1, -1):
        j = rng.uniform(0.85, 1.15)
        feats.append(_ridge([(30.4, 41.0), (24.0, 44.5), (16.5, 47.0)], 2.0 * j, 9, 6, 0.4, amp, sgn))
        feats.append(_ridge([(30.6, 36.5), (23.5, 37.8), (15.0, 37.0)], 1.5 * j, 9, 6, 0.4, amp, sgn))
        feats.append(_ridge([(30.0, 45.0), (25.5, 50.0), (20.0, 54.0)], 1.4 * j, 8, 5, 0.4, amp, sgn))
        for k, (x0, y0, x1, y1, h) in enumerate([(27.6, 9.8, 22.8, 14.0, 1.6), (26.0, 9.6, 19.0, 12.0, 1.2), (28.4, 11.6, 25.0, 17.0, 1.3), (22.0, 9.4, 14.0, 11.0, 1.0)]):
            feats.append(_ridge([(x0, y0), ((x0 + x1) / 2, (y0 + y1) / 2 + 0.4 * (k % 2)), (x1, y1)], h * j, 6, 4.5, 0.4, amp, sgn))
        dd, nn = d * [sgn, 1.0], n_in * [sgn, 1.0]
        cuff_mid = (C1 + C2) / 2 * [sgn, 1.0]
        for t_cm, h, w in [(10.5, 1.9, 5.5), (14.5, 1.5, 5.0), (19.5, 1.2, 5.0), (26.0, 0.9, 6.0)]:
            base = cuff_mid - dd * (t_cm * CM)
            tilt = rng.uniform(-0.012, 0.012)
            pts = [base - nn * 0.045 + dd * tilt, base + dd * 0.006, base + nn * 0.045 - dd * tilt]
            feats.append(Ridge(np.array(pts), h * 1e-3 * j * amp, w * 1e-3, w * 0.7e-3, 0.3))
        feats.append(_ridge([(33.5, 62.5), (40.0, 54.5), (47.0, 44.0)], 1.5 * j, 9, 6, 0.35, amp, sgn))
        feats.append(_ridge([(31.0, 56.0), (36.0, 48.0), (41.5, 38.0)], 1.0 * j, 8, 5, 0.35, amp, sgn))
        feats.append(_ridge([(14.8, 93.0), (13.2, 85.0), (12.4, 77.0)], 1.8, 10, 6, 0.3, 1.0, sgn))
        feats.append(_ridge([(10.0, 99.0), (8.0, 92.5), (7.0, 85.0)], 1.2, 9, 6, 0.3, 1.0, sgn))
    feats.append(_ridge([(-16, 24.0), (-4, 22.8), (9, 23.6), (18, 25.5)], 1.0, 14, 10, 0.4, amp * (1.0 if top_is_front else 0.6)))
    if top_is_front:
        feats.append(_ridge([(-17, 47.0), (-5, 45.2), (8, 46.0), (17, 48.2)], 1.0, 12, 9, 0.4, amp))
    else:
        feats.append(_ridge([(-18, 52.0), (-5, 50.5), (9, 51.5), (18, 53.5)], 1.0, 12, 9, 0.4, amp))
        feats.append(_ridge([(-17, 34.0), (-3, 32.5), (11, 33.5), (19, 35.5)], 0.9, 14, 10, 0.4, amp))
    feats.append(Waves(0.00022 * amp, 0.075, seed=13 if top_is_front else 19, count=28, anisotropy=0.8))

    # Nähte
    for sgn in (1, -1):
        flip = np.array([sgn, 1.0])
        arm = spline([S * flip, S * flip + [sgn * 0.004, -0.095], A * flip + [-sgn * 0.010, 0.095], A * flip], 12)
        seams.append(G.Seam(arm, "ridge", width=0.0016, height=0.0008))
        seams.append(G.Seam(np.array([N * flip + [-sgn * 0.003, -0.004], S * flip + [-sgn * 0.002, -0.005]]), "ridge", width=0.0012, height=0.0005))
        dd, c1, c2 = d * flip, C1 * flip, C2 * flip
        seams.append(G.Seam(np.array([c1 - dd * 0.075, c2 - dd * 0.075]), "double"))
        seams.append(G.Seam(np.array([c1 - dd * 0.0035, c2 - dd * 0.0035]), "ridge", width=0.0012, height=0.0004))
    seams.append(G.Seam(np.array([[-R2[0] - 0.002, 0.0805], [R2[0] + 0.002, 0.0805]]), "double"))
    seams.append(G.Seam(np.array([[-Hc[0] + 0.004, 0.0035], [Hc[0] - 0.004, 0.0035]]), "ridge", width=0.0012, height=0.0004))
    if top_is_front:
        pocket = _c([(-18.2, 27.6), (18.2, 27.6), (24.4, 8.4), (-24.4, 8.4)])
        feats.append(Plateau(pocket, 0.0030, edge=0.003))
        feats.append(Dome(0.0, 0.175, 0.14, 0.07, 0.0016))
        seams.append(G.Seam(np.array([[-0.176, 0.268], [0.176, 0.268]]), "double"))
        for sgn in (1, -1):
            seams.append(G.Seam(np.array([[sgn * 0.182, 0.2745], [sgn * 0.2435, 0.0875]]), "ridge", width=0.0019, height=0.0011))
            seams.append(G.Seam(np.array([[sgn * 0.171, 0.2635], [sgn * 0.2290, 0.0925]]), "stitch", width=0.0007, height=0.0003))
            seams.append(G.Seam(np.array([[sgn * 0.168, 0.274], [sgn * 0.186, 0.256]]), "ridge", width=0.0015, height=0.0006))
        for sgn in (1, -1):  # Kordelösen und kurze Kordelenden
            th = math.radians(-62.0)
            ex, ey = fx + sgn * (fa + 0.0125) * math.cos(th), fy + (fb + 0.0125) * math.sin(th)
            ring_pts = np.stack([ex + 0.0048 * np.cos(ang), ey + 0.0048 * np.sin(ang)], axis=1)
            seams.append(G.Seam(ring_pts, "ridge", width=0.0018, height=0.0014, closed=True))
            cord = spline([[ex, ey - 0.003], [ex + sgn * 0.004, ey - 0.030], [ex + sgn * 0.012, ey - 0.058], [ex + sgn * 0.030, ey - 0.082]], 10)
            seams.append(G.Seam(cord, "ridge", width=0.0052, height=0.0029))
            tip_dir = (cord[-1] - cord[-3]) / np.hypot(*(cord[-1] - cord[-3]))
            seams.append(G.Seam(np.array([cord[-1], cord[-1] + tip_dir * 0.016]), "ridge", width=0.0058, height=0.0033))
    else:
        seams.append(G.Seam(np.array([[0.0, 1.035], [0.0, 0.730]]), "ridge", width=0.0016, height=0.0008))
        seams.append(G.Seam(np.array([[0.0035, 1.032], [0.0035, 0.732]]), "stitch", width=0.0006, height=0.0003))
        seams.append(G.Seam(spline([[-0.1148, 0.7095], [-0.075, 0.6785], [0.0, 0.6655], [0.075, 0.6785], [0.1148, 0.7095]], 14), "ridge", width=0.0014, height=0.0006))

    top = G.Panel(name="front" if top_is_front else "back", outline=outline, z_base=0.0042, features=feats, bands=bands, seams=seams, edge_roll=0.0012)
    under = G.Panel(name="unterlage", outline=G.shrink_outline(outline, 0.0015), z_base=0.0015)
    if top_is_front:
        top_y = fy - fb - 0.025 - 0.040  # 40 mm unter dem Rand der Kapuzenöffnung (Hinweisgröße Shirtigo)
        mm = (330, 280)
    else:
        top_y = 0.6655 - 0.012 - 0.001  # 1 mm unter dem Nackenband
        mm = (330, 390)
    width = outline[:, 0].max() - outline[:, 0].min()
    height = outline[:, 1].max() - outline[:, 1].min()
    ppm = min(0.95 * G.CANVAS[0] / width, 0.92 * G.CANVAS[1] / height)
    yc = (outline[:, 1].max() + outline[:, 1].min()) / 2
    return G.Garment(
        id=f"hoodie-{view}",
        title="Hoodie vorne" if top_is_front else "Hoodie hinten",
        product="hoodie",
        view=view,
        panels=[under, top],
        px_per_m=round(ppm, 1),
        center=(0.0, round(float(yc), 4)),
        print_profile=f"shirtigo-hoodie-{view}",
        print_area_mm=mm,
        print_area_top_y=top_y,
        displace_px=5.0,
        mesh_h=0.0027,
    )
