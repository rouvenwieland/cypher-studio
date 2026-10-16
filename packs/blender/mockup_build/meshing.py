# SPDX-License-Identifier: GPL-3.0-or-later
"""Dreiecksnetz für einen Stoffumriss (bpy): gestaffeltes Punktgitter + eingeschränkte Delaunay-Triangulation."""

import numpy as np
from mathutils import Vector, geometry, kdtree

from fields import point_in_polygon


def triangulate_outline(outline, h_int=0.004, h_edge=0.002, seed=3):
    """Liefert (Punkte (N,2), Dreiecke (M,3), Anzahl Randpunkte). Rand zuerst, dann Innenpunkte."""
    outline = np.asarray(outline, float)
    # Rand dicht abtasten, aber die Ecken des Umrisses behalten
    closed = np.vstack([outline, outline[:1]])
    seg = np.hypot(*(closed[1:] - closed[:-1]).T)
    pts = []
    for i in range(len(outline)):
        n = max(1, int(round(seg[i] / h_edge)))
        for k in range(n):
            t = k / n
            pts.append(closed[i] * (1 - t) + closed[i + 1] * t)
    boundary = np.array(pts)
    # doppelte Punkte entfernen (zusammenfallende Ecken)
    keep = np.ones(len(boundary), bool)
    for i in range(1, len(boundary)):
        if np.hypot(*(boundary[i] - boundary[i - 1])) < 1e-6:
            keep[i] = False
    boundary = boundary[keep]
    nb = len(boundary)

    kd = kdtree.KDTree(nb)
    for i, p in enumerate(boundary):
        kd.insert((p[0], p[1], 0.0), i)
    kd.balance()
    lo, hi = outline.min(axis=0), outline.max(axis=0)
    rng = np.random.default_rng(seed)
    dy = h_int * np.sqrt(3) / 2
    ys = np.arange(lo[1], hi[1] + dy, dy)
    rows = []
    for r, y in enumerate(ys):
        xs = np.arange(lo[0] + (h_int / 2 if r % 2 else 0.0), hi[0] + h_int, h_int)
        rows.append(np.stack([xs, np.full_like(xs, y)], axis=1))
    lattice = np.vstack(rows)
    lattice += rng.uniform(-0.2, 0.2, lattice.shape) * h_int
    lattice = lattice[point_in_polygon(lattice, outline)]
    keep = []
    for p in lattice:
        if kd.find((p[0], p[1], 0.0))[2] > 0.8 * h_int:
            keep.append(p)
    inner = np.array(keep)
    allp = np.vstack([boundary, inner])
    verts = [Vector((float(p[0]), float(p[1]))) for p in allp]
    edges = [(i, (i + 1) % nb) for i in range(nb)]
    res = geometry.delaunay_2d_cdt(verts, edges, [list(range(nb))], 1, 1e-7)
    out_verts, out_faces = res[0], res[2]
    xy = np.array([(v.x, v.y) for v in out_verts])
    tris = np.array(out_faces, dtype=np.int64)
    return xy, tris, nb
