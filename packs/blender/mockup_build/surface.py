# SPDX-License-Identifier: GPL-3.0-or-later
"""Oberflächenhöhe einer Lage und Hilfen für Netz, Bänder und Nähte (numpy, kein bpy)."""

import numpy as np

from fields import evaluate, nearest_on_polyline, smoothstep


def closed(poly):
    poly = np.asarray(poly, float)
    return np.vstack([poly, poly[:1]])


def band_height(band, xy):
    d, _, _, _ = nearest_on_polyline(xy, band.line)
    return band.height * (1.0 - smoothstep((d - band.half_width + 0.0012) / band.edge))


def surface_z(panel, xy, edge_dist=None):
    """Höhe der Stoffoberfläche (Meter) an den Punkten `xy` (N, 2)."""
    xy = np.asarray(xy, float)
    if edge_dist is None:
        edge_dist, *_ = nearest_on_polyline(xy, closed(panel.outline))
    z = panel.z_base + panel.edge_roll * smoothstep(edge_dist / panel.edge_width)
    # Falten laufen zu den Nähten hin aus (Kanten sind vernäht und liegen flach)
    z += evaluate(panel.features, xy) * smoothstep((edge_dist - 0.004) / 0.025)
    for band in panel.bands:
        z += band_height(band, xy)
    return z


def band_attributes(panel, xy):
    """Je Punkt: Bandnummer (0 = keins), Rippenparameter s (Meter) und d/halbe Breite."""
    n = len(xy)
    band_id = np.zeros(n)
    s_out = np.zeros(n)
    dn_out = np.full(n, 9.0)
    for i, band in enumerate(panel.bands, start=1):
        if not band.ribbed:
            continue
        d, s, side, _ = nearest_on_polyline(xy, band.line)
        dn = d / band.half_width
        better = dn < np.abs(dn_out)
        band_id[better] = np.where(dn[better] <= 1.0, float(i), 0.0)
        s_out[better] = s[better]
        dn_out[better] = (side * dn)[better]
    return band_id, s_out, dn_out
