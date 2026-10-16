# SPDX-License-Identifier: GPL-3.0-or-later
"""Geometrie und Höhenfelder für die Mockup-Grundlagen (reines numpy, kein bpy).

Alle Längen in Metern, Koordinaten (x nach rechts, y nach oben) in der Ebene des Flatlays.
"""

import math

import numpy as np


# --------------------------------------------------------------------------- Kurven


def bezier(p0, p1, p2, p3, n=40):
    t = np.linspace(0.0, 1.0, n)[:, None]
    u = 1.0 - t
    p0, p1, p2, p3 = (np.asarray(p, float) for p in (p0, p1, p2, p3))
    return u**3 * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t**3 * p3


def spline(points, n_per=24):
    """Catmull-Rom-Kurve durch die Punkte (zentripetal vereinfacht, gleichmäßig)."""
    pts = np.asarray(points, float)
    ext = np.vstack([2 * pts[0] - pts[1], pts, 2 * pts[-1] - pts[-2]])
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for t in np.linspace(0, 1, n_per, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return np.array(out)


def ellipse_arc(cx, cy, a, b, deg0, deg1, n=60):
    t = np.radians(np.linspace(deg0, deg1, n))
    return np.stack([cx + a * np.cos(t), cy + b * np.sin(t)], axis=1)


def polyline_length(line):
    line = np.asarray(line, float)
    return float(np.hypot(*(line[1:] - line[:-1]).T).sum())


def resample(line, h, keep_end=True):
    """Gleichmäßig nach Bogenlänge abtasten; Anfang enthalten, Ende optional."""
    line = np.asarray(line, float)
    seg = np.hypot(*(line[1:] - line[:-1]).T)
    total = seg.sum()
    n = max(1, int(round(total / h)))
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    ts = np.linspace(0.0, total, n + 1)
    if not keep_end:
        ts = ts[:-1]
    return np.stack([np.interp(ts, cum, line[:, 0]), np.interp(ts, cum, line[:, 1])], axis=1)


def offset_polyline(line, dist):
    """Parallelkurve (positive Distanz = links der Laufrichtung)."""
    line = np.asarray(line, float)
    tang = np.gradient(line, axis=0)
    tang /= np.maximum(np.hypot(*tang.T), 1e-12)[:, None]
    normal = np.stack([-tang[:, 1], tang[:, 0]], axis=1)
    return line + normal * dist


# --------------------------------------------------------------------------- Abstände


def _chunks(n, size=20000):
    for i in range(0, n, size):
        yield slice(i, min(n, i + size))


def nearest_on_polyline(points, line):
    """Für jeden Punkt: (Abstand, Bogenlängenparameter 0..L, Seite +1 links/-1 rechts, Tangente)."""
    pts = np.asarray(points, float)
    line = np.asarray(line, float)
    a, b = line[:-1], line[1:]
    ab = b - a
    seg_len = np.hypot(*ab.T)
    cum = np.concatenate([[0.0], np.cumsum(seg_len)])
    dist = np.full(len(pts), np.inf)
    par = np.zeros(len(pts))
    side = np.ones(len(pts))
    tangent = np.zeros((len(pts), 2))
    inv = 1.0 / np.maximum(seg_len**2, 1e-18)
    for sl in _chunks(len(pts)):
        p = pts[sl]
        best = np.full(len(p), np.inf)
        bp = np.zeros(len(p))
        bs = np.ones(len(p))
        bt = np.zeros((len(p), 2))
        for i in range(len(a)):
            rel = p - a[i]
            t = np.clip((rel @ ab[i]) * inv[i], 0.0, 1.0)
            closest = a[i] + t[:, None] * ab[i]
            d = np.hypot(*(p - closest).T)
            m = d < best
            if m.any():
                best[m] = d[m]
                bp[m] = cum[i] + t[m] * seg_len[i]
                cross = ab[i][0] * rel[m, 1] - ab[i][1] * rel[m, 0]
                bs[m] = np.where(cross >= 0, 1.0, -1.0)
                bt[m] = ab[i] / max(seg_len[i], 1e-12)
        dist[sl], par[sl], side[sl], tangent[sl] = best, bp, bs, bt
    return dist, par, side, tangent


def point_in_polygon(points, poly):
    pts = np.asarray(points, float)
    poly = np.asarray(poly, float)
    x, y = pts[:, 0], pts[:, 1]
    inside = np.zeros(len(pts), bool)
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        cond = ((yi > y) != (yj > y)) & (x < (xj - xi) * (y - yi) / (yj - yi + 1e-30) + xi)
        inside ^= cond
        j = i
    return inside


def signed_distance_polygon(points, poly):
    """Negativ innen, positiv außen."""
    closed = np.vstack([poly, poly[:1]])
    d, *_ = nearest_on_polyline(points, closed)
    return np.where(point_in_polygon(points, poly), -d, d)


# --------------------------------------------------------------------------- Profile


def smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def gauss(d, w):
    return np.exp(-((d / w) ** 2))


# --------------------------------------------------------------------------- Höhenmerkmale


class Feature:
    """Basisklasse: `height(xy)` liefert z-Beitrag in Metern für (N, 2)-Punkte."""

    def height(self, xy):  # pragma: no cover - Schnittstelle
        raise NotImplementedError


class Dome(Feature):
    def __init__(self, cx, cy, sx, sy, h, angle_deg=0.0):
        self.c, self.s, self.h = np.array([cx, cy], float), (sx, sy), h
        a = math.radians(angle_deg)
        self.rot = np.array([[math.cos(a), math.sin(a)], [-math.sin(a), math.cos(a)]])

    def height(self, xy):
        q = (np.asarray(xy) - self.c) @ self.rot.T
        return self.h * np.exp(-((q[:, 0] / self.s[0]) ** 2 + (q[:, 1] / self.s[1]) ** 2))


class Ridge(Feature):
    """Weiche Falte entlang einer Linie; `side` +1 = hohe Flanke links der Laufrichtung steiler.

    w_left / w_right: Breite der Flanken (asymmetrisch -> Schattenseite), h: Höhe,
    taper: Anteil der Länge, über den die Falte ein- und ausläuft (0..0.5).
    """

    def __init__(self, line, h, w_left, w_right=None, taper=0.35, power=1.0):
        self.line = np.asarray(line, float)
        self.h, self.wl, self.wr = h, w_left, w_right if w_right is not None else w_left
        self.taper, self.power = taper, power
        self.length = polyline_length(self.line)

    def height(self, xy):
        d, s, side, _ = nearest_on_polyline(xy, self.line)
        w = np.where(side > 0, self.wl, self.wr)
        t = s / max(self.length, 1e-9)
        env = np.minimum(smoothstep(t / max(self.taper, 1e-6)), smoothstep((1 - t) / max(self.taper, 1e-6))) ** self.power
        return self.h * env * np.exp(-((d / w) ** 2))


class Plateau(Feature):
    """Angehobene Fläche (Tasche, Bund) mit weicher Kante; `h` darf negativ sein."""

    def __init__(self, poly, h, edge=0.003):
        self.poly, self.h, self.edge = np.asarray(poly, float), h, edge

    def height(self, xy):
        sd = signed_distance_polygon(xy, self.poly)
        return self.h * smoothstep(0.5 - sd / (2 * self.edge))


class Waves(Feature):
    """Weiches, deterministisches Rauschen (Summe von Sinuswellen mit zufälliger Richtung)."""

    def __init__(self, amp, wavelength, seed=1, count=14, anisotropy=1.0):
        rng = np.random.default_rng(seed)
        ang = rng.uniform(0, 2 * math.pi, count)
        wl = wavelength * rng.uniform(0.6, 1.6, count)
        self.k = np.stack([np.cos(ang), np.sin(ang) * anisotropy], axis=1) * (2 * math.pi / wl)[:, None]
        self.phase = rng.uniform(0, 2 * math.pi, count)
        self.amp = amp * rng.uniform(0.5, 1.0, count) / math.sqrt(count / 2)

    def height(self, xy):
        xy = np.asarray(xy)
        return (np.sin(xy @ self.k.T + self.phase) * self.amp).sum(axis=1)


def evaluate(features, xy):
    z = np.zeros(len(xy))
    for f in features:
        z += f.height(xy)
    return z
