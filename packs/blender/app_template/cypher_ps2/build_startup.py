# SPDX-License-Identifier: GPL-3.0-or-later
"""Erzeugt `startup.blend` für das App-Template „Cypher PS2“ reproduzierbar.

    blender -b --factory-startup --python build_startup.py -- --out startup.blend [--fingerprint fp.json]

Das Skript ist die Quelle, die .blend-Datei ist das Build-Ergebnis (nicht einchecken). Die CI
vergleicht den JSON-Fingerabdruck der Szene (`--fingerprint`) statt der Binärdatei.

Inhalt der Szene:
  * Meter, Maßstab 1, Einrasten an der 0,1-m-Gitterteilung, Kamera 640 x 448 (PS2-Vorschau)
  * Sammlungen „Export“ (wird exportiert), „Referenz“ (Mensch 1,75 m, Bodenraster, Shop-Kamera;
    nie exportiert) und „Beispiele“ (je ein Modell pro Präfix innerhalb des Budgets)
  * Materialien „Cypher Basis“ (Textur x Vertexfarbe), „Cypher Neon“ (Emission), kleine Texturen
  * Palette „Cypher Kollektionen“ (17 Farben aus packs/shared/brand/brand.json) zum Malen
  * EEVEE-Vorschau mit Nebel, Farbverwaltung „Standard“, Einsteiger-Arbeitsbereiche
"""

import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
BRAND_JSON = HERE.parents[1] / "shared" / "brand" / "brand.json"
TEMPLATE_ID = "cypher_ps2"

# Rückfall, falls die Datei fehlt (z. B. beim Bauen außerhalb des Repos); ein Test hält beide gleich.
FALLBACK_PALETTE = [
    ("Tinte", "#0d0d0d"), ("Papier", "#efeee9"), ("Zeitzeichen-Orange (News)", "#ff4f12"), ("Empfang-Gelb (Shop)", "#e4f531"),
    ("Studio-Cyan", "#00d4d8"), ("Rauschen", "#0b0b0a"), ("Mittelwelle Kobalt", "#1f2bd0"), ("Mittelwelle Hell", "#f3f4f7"),
    ("Gold-Lounge Gold", "#c9a03f"), ("Gold-Lounge Tiefgold", "#a47c2a"), ("Gold-Lounge Tinte", "#0d0a05"), ("Textil Schwarz", "#141210"),
    ("Textil Weiß", "#f2efe8"), ("Textil Grau meliert", "#8c8a86"), ("Textil Navy", "#1d2738"), ("Textil Sand", "#cdbb9a"), ("Textil Creme", "#efe4cc"),
]
PALETTE_NAME = "Cypher Kollektionen"
NEON_HEX = "#00d4d8"  # Studio-Cyan
FOG_HEX = "#101a26"


# --------------------------------------------------------------------------- Hilfen


def _load_template_module():
    spec = importlib.util.spec_from_file_location("cypher_ps2_template", HERE / "__init__.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def hex_rgb(hex_str):
    h = hex_str.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(hex_str):
    return tuple(srgb_to_linear(c) for c in hex_rgb(hex_str))


def safe_set(obj, **values):
    """Setzt Eigenschaften, die es je nach Blender-Version (4.5 / 5.x) geben kann."""
    for key, value in values.items():
        try:
            setattr(obj, key, value)
        except (AttributeError, TypeError, ValueError, RuntimeError):
            pass


def palette_colors():
    try:
        data = json.loads(BRAND_JSON.read_text(encoding="utf-8"))
        pal = next(p for p in data["palettes"] if p["id"] == "cypher-kollektionen")
        return [(c["name"], c["hex"]) for c in pal["colors"]]
    except (OSError, ValueError, StopIteration, KeyError):
        return list(FALLBACK_PALETTE)


# --------------------------------------------------------------------------- Texturen (klein, deterministisch)


def _new_image(name, arr):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    out = np.ones((h, w, 4), dtype=np.float32)
    out[..., :3] = np.clip(arr, 0.0, 1.0)
    img.pixels.foreach_set(out.ravel())
    img.pack()
    img.colorspace_settings.name = "sRGB"
    return img


def make_images():
    rng = np.random.default_rng(20261016)
    yy, xx = np.mgrid[0:128, 0:128]
    # Holz: Bretter mit Maserung und dunklen Fugen (Braun, wie Kiste und Möbel)
    plank = yy // 32
    base = np.array(hex_rgb("#8a6a46"))
    tone = 0.86 + 0.14 * np.sin((xx * 0.21) + plank * 1.7) + rng.normal(0, 0.025, (128, 128))
    holz = base[None, None, :] * tone[..., None]
    holz[(yy % 32) < 2] *= 0.45
    # Stoff: feines Gewebe in warmem Grau
    weave = 0.9 + 0.07 * (((xx // 2) + (yy // 2)) % 2) + rng.normal(0, 0.02, (128, 128))
    stoff = np.array(hex_rgb("#c4bcae"))[None, None, :] * weave[..., None]
    # Motiv: 256 x 256 über den Shirt-Umriss gelegt (u, v = Umriss-Rahmen); Shirtfarbe Creme, Motiv auf der
    # Brust 30 x 40 cm (3:4). Gezeichnet wird in Metern, damit das Seitenverhältnis stimmt.
    pts = tee_outline(1.0)
    x_min, x_max, z_max = min(p[0] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)
    y2, x2 = np.mgrid[0:256, 0:256]
    mx = x_min + (x2 + 0.5) / 256.0 * (x_max - x_min)
    mz = (y2 + 0.5) / 256.0 * z_max
    motiv = np.ones((256, 256, 3)) * np.array(hex_rgb("#efe4cc"))
    area = (np.abs(mx) < 0.15) & (mz > 0.30) & (mz < 0.70)
    grad = np.clip((mz - 0.30) / 0.40, 0, 1)[..., None]
    motiv[area] = (np.array(hex_rgb("#1d2738")) * (1 - grad) + np.array(hex_rgb("#00d4d8")) * grad)[area]
    r = np.hypot(mx, mz - 0.50)
    motiv[area & (r > 0.075) & (r < 0.115)] = np.array(hex_rgb("#e4f531"))
    return {
        "cypher-holz": _new_image("cypher-holz", holz),
        "cypher-stoff": _new_image("cypher-stoff", stoff),
        "cypher-motiv": _new_image("cypher-motiv", motiv),
    }


# --------------------------------------------------------------------------- Materialien


def _basis_material(name, image):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (300, 0)
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.0
    bsdf.inputs["Emission Color"].default_value = (0.0, 0.0, 0.0, 1.0)  # Neon: Emission hier eintragen
    bsdf.inputs["Emission Strength"].default_value = 1.0
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.location = (-500, 100)
    tex.image = image
    tex.interpolation = "Linear"  # PS2: bilinear (verwaschen), nicht „Closest“ wie bei der PS1
    tex.extension = "REPEAT"
    vcol = nt.nodes.new("ShaderNodeVertexColor")
    vcol.location = (-500, -150)
    vcol.layer_name = "Col"
    mix = nt.nodes.new("ShaderNodeMix")
    mix.location = (0, 0)
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    nt.links.new(tex.outputs["Color"], mix.inputs[6])
    nt.links.new(vcol.outputs["Color"], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    mat.diffuse_color = (*lin("#c4bcae"), 1.0)
    return mat


def _neon_material(name, hex_color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.0
    bsdf.inputs["Emission Color"].default_value = (*lin(hex_color), 1.0)
    bsdf.inputs["Emission Strength"].default_value = 1.0  # > 1 braucht KHR_materials_emissive_strength
    out.location = (300, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    mat.diffuse_color = (*lin(hex_color), 1.0)
    return mat


def make_materials(images):
    return {
        "basis": _basis_material("Cypher Basis", images["cypher-holz"]),
        "stoff": _basis_material("Cypher Stoff", images["cypher-stoff"]),
        "produkt": _basis_material("Cypher Produkt", images["cypher-motiv"]),
        "neon": _neon_material("Cypher Neon", NEON_HEX),
    }


# --------------------------------------------------------------------------- Formen


class Shape:
    """Baut ein Mesh aus Quadern, Zylindern und Umrissen mit UVs und Vertexfarben („gebackenes“ Licht)."""

    def __init__(self, name, mats):
        self.name = name
        self.mats = mats
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.col = self.bm.loops.layers.color.new("Col")

    def _finish_part(self, color_hex, tile, mat_slot, zspan):
        base = lin(color_hex)
        for f in self.bm.faces:
            if f.tag:
                continue
            f.material_index = mat_slot
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for loop in f.loops:
                co = loop.vert.co
                u, v = {0: (co.y, co.z), 1: (co.x, co.z), 2: (co.x, co.y)}[ax]
                loop[self.uv].uv = (u / tile, v / tile)
                # „Gebackenes“ Licht: oben hell, unten dunkel, Unterseiten sehr dunkel
                height = min(max(co.z / zspan, 0.0), 1.0)
                shade = 0.62 + 0.38 * height if n.z > -0.5 else 0.45
                if ax != 2:
                    shade *= 0.88
                loop[self.col] = (base[0] * shade, base[1] * shade, base[2] * shade, 1.0)
        for f in self.bm.faces:
            f.tag = True

    def _begin(self):
        for f in self.bm.faces:
            f.tag = True

    def box(self, center, size, color, tile=1.0, mat=0, bevel=0.0, zspan=2.0):
        self._begin()
        res = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = res["verts"]
        bmesh.ops.scale(self.bm, vec=Vector(size), verts=verts)
        bmesh.ops.translate(self.bm, vec=Vector(center), verts=verts)
        if bevel > 0:
            edges = {e for v in verts for e in v.link_edges}
            bmesh.ops.bevel(self.bm, geom=list(edges), offset=bevel, segments=1, affect="EDGES")
        bmesh.ops.recalc_face_normals(self.bm, faces=[f for f in self.bm.faces if not f.tag])
        self._finish_part(color, tile, mat, zspan)

    def cylinder(self, center, radius, depth, color, segments=8, tile=1.0, mat=0, zspan=2.0):
        self._begin()
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=depth)
        bmesh.ops.translate(self.bm, vec=Vector(center), verts=res["verts"])
        self._finish_part(color, tile, mat, zspan)

    def outline(self, points, thickness, color, tile=1.0, mat=0, zspan=1.0, plane="XZ"):
        """Extrudierter Umriss (Punkte in Metern, in der XZ-Ebene, Dicke entlang Y)."""
        self._begin()
        verts = [self.bm.verts.new((x, -thickness / 2, z)) for x, z in points]
        face = self.bm.faces.new(verts)
        res = bmesh.ops.extrude_face_region(self.bm, geom=[face])
        moved = [e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(self.bm, vec=Vector((0.0, thickness, 0.0)), verts=moved)
        new_faces = [f for f in self.bm.faces if not f.tag]
        bmesh.ops.triangulate(self.bm, faces=new_faces)
        bmesh.ops.recalc_face_normals(self.bm, faces=[f for f in self.bm.faces if not f.tag])
        self._finish_part(color, tile, mat, zspan)

    def to_object(self, location=(0.0, 0.0, 0.0)):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        for poly in me.polygons:
            poly.use_smooth = False
        ob = bpy.data.objects.new(self.name, me)
        ob.location = location
        return ob


def tee_outline(scale):
    """Vereinfachter Shirt-Umriss (Vorderseite, Meter): Rumpf, Ärmel, Halsausschnitt."""
    half = [
        (0.0, 0.0), (0.275, 0.0), (0.28, 0.52), (0.387, 0.461), (0.452, 0.64), (0.245, 0.715), (0.09, 0.74), (0.0, 0.655),
    ]
    right = [(x * scale, z * scale) for x, z in half]
    left = [(-x * scale, z * scale) for x, z in reversed(half) if x != 0.0]
    return right + left


def build_examples(mats, collection):
    """Ein Beispielmodell je Präfix. Alle Ursprünge am Boden, Mitte über dem Ursprung."""
    examples = []
    m_basis, m_stoff, m_prod, m_neon = mats["basis"], mats["stoff"], mats["produkt"], mats["neon"]

    # prop-kiste: Holzkiste mit Eckpfosten und Deckelleisten
    s = Shape("prop-kiste", [m_basis])
    s.box((0, 0, 0.30), (0.56, 0.56, 0.60), "#b88a5a", tile=0.6, bevel=0.02)
    for sx in (-1, 1):
        for sy in (-1, 1):
            s.box((sx * 0.27, sy * 0.27, 0.30), (0.07, 0.07, 0.62), "#8a6a46", tile=0.3)
    for i in (-1, 0, 1):
        s.box((0, i * 0.18, 0.615), (0.58, 0.14, 0.03), "#c9a06a", tile=0.4)
    examples.append(("prop-kiste", s.to_object(), 0.0))

    # prop-neon-schild: Schild auf zwei Masten mit Neonröhre
    s = Shape("prop-neon-schild", [m_basis, m_neon])
    for sx in (-1, 1):
        s.cylinder((sx * 0.55, 0, 0.9), 0.04, 1.8, "#3a3f48", segments=6, tile=0.5)
    s.box((0, 0, 1.55), (1.3, 0.06, 0.55), "#1d2738", tile=0.6)
    for (cx, cz, sx_, sz_) in [(0, 1.76, 1.15, 0.03), (0, 1.34, 1.15, 0.03), (-0.58, 1.55, 0.03, 0.45), (0.58, 1.55, 0.03, 0.45)]:
        s.box((cx, -0.045, cz), (sx_, 0.025, sz_), "#ffffff", mat=1)
    s.box((0, -0.045, 1.55), (0.5, 0.025, 0.03), "#ffffff", mat=1)
    examples.append(("prop-neon-schild", s.to_object(), 3.0))

    # furn-sofa: Sofa mit abgerundeten Polstern
    s = Shape("furn-sofa", [m_stoff])
    s.box((0, 0, 0.28), (1.9, 0.85, 0.30), "#5b3a3a", tile=0.8, bevel=0.03)
    s.box((0, 0.35, 0.60), (1.9, 0.20, 0.54), "#6b4545", tile=0.8, bevel=0.04)
    for sx in (-1, 1):
        s.box((sx * 0.90, 0, 0.52), (0.18, 0.85, 0.40), "#6b4545", tile=0.8, bevel=0.03)
    for sx in (-0.45, 0.45):
        s.box((sx, -0.05, 0.50), (0.84, 0.62, 0.16), "#8a5a5a", tile=0.8, bevel=0.04)
        s.box((sx, 0.22, 0.68), (0.84, 0.14, 0.34), "#8a5a5a", tile=0.8, bevel=0.04)
    for sx in (-1, 1):
        for sy in (-1, 1):
            s.box((sx * 0.84, sy * 0.34, 0.06), (0.08, 0.08, 0.12), "#2a2a2a", tile=0.2)
    examples.append(("furn-sofa", s.to_object(), 6.0))

    # prod-tee: Shirt als Produktmodell mit Motivtextur
    s = Shape("prod-tee", [m_prod])
    pts = tee_outline(1.0)
    xs = [p[0] for p in pts]
    zs = [p[1] for p in pts]
    s.outline(pts, 0.025, "#ffffff", tile=1.0, zspan=0.8)
    s.bm.faces.ensure_lookup_table()
    # UV: Umriss auf 0..1 (Motivtextur), Brustfläche 30 x 40 cm = 3:4 liegt links im Bild
    span_x = max(xs) - min(xs)
    for f in s.bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            loop[s.uv].uv = ((co.x - min(xs)) / span_x, co.z / max(zs))
    examples.append(("prod-tee", s.to_object(), 8.5))

    # fig-butler: Figur aus Quadern und Zylindern, Farben über Vertexfarben
    s = Shape("fig-butler", [m_stoff])
    s.box((-0.10, 0, 0.45), (0.14, 0.16, 0.90), "#141210", tile=0.5, zspan=1.8)
    s.box((0.10, 0, 0.45), (0.14, 0.16, 0.90), "#141210", tile=0.5, zspan=1.8)
    s.box((0, 0, 1.22), (0.40, 0.22, 0.62), "#1d2738", tile=0.5, bevel=0.02, zspan=1.8)
    s.box((0, -0.115, 1.30), (0.12, 0.02, 0.40), "#efeee9", tile=0.5, zspan=1.8)
    s.box((0, -0.13, 1.45), (0.14, 0.03, 0.06), "#c9a03f", tile=0.5, zspan=1.8)
    for sx in (-1, 1):
        s.box((sx * 0.28, 0, 1.18), (0.10, 0.12, 0.60), "#1d2738", tile=0.5, zspan=1.8)
        s.box((sx * 0.28, 0, 0.84), (0.09, 0.10, 0.09), "#efeee9", tile=0.5, zspan=1.8)
    s.cylinder((0, 0, 1.64), 0.06, 0.10, "#cdbb9a", segments=8, tile=0.5, zspan=1.8)
    s.box((0, 0, 1.78), (0.20, 0.20, 0.22), "#cdbb9a", tile=0.5, bevel=0.03, zspan=1.8)
    s.box((0, 0.02, 1.83), (0.22, 0.22, 0.06), "#0d0d0d", tile=0.5, zspan=1.8)
    examples.append(("fig-butler", s.to_object(), 11.0))

    # room-gasse: Seitengasse mit Wänden, Müllcontainer, Laterne und Neon
    s = Shape("room-gasse", [m_basis, m_neon])
    s.box((0, 0, 0.05), (6.0, 12.0, 0.10), "#4a4a52", tile=1.5, zspan=4.0)
    s.box((-3.1, 0, 2.5), (0.2, 12.0, 5.0), "#7a4a3a", tile=2.0, zspan=5.0)
    s.box((3.1, 0, 2.5), (0.2, 12.0, 5.0), "#6a5a52", tile=2.0, zspan=5.0)
    s.box((0, 6.1, 2.5), (6.4, 0.2, 5.0), "#5a4a4a", tile=2.0, zspan=5.0)
    for i in range(4):
        s.box((-2.98, -4.2 + i * 2.7, 2.6), (0.04, 1.0, 1.3), "#1a1f2e", tile=1.0, zspan=5.0)
        s.box((2.98, -3.0 + i * 2.7, 2.2), (0.04, 0.9, 1.1), "#1a1f2e", tile=1.0, zspan=5.0)
    s.box((2.2, 3.5, 0.55), (1.3, 1.9, 1.1), "#2f5a45", tile=1.0, bevel=0.03, zspan=5.0)
    s.box((2.2, 3.5, 1.14), (1.4, 2.0, 0.08), "#26483a", tile=1.0, zspan=5.0)
    s.cylinder((-2.6, -2.5, 1.9), 0.06, 3.8, "#2a2a2a", segments=6, tile=1.0, zspan=5.0)
    s.box((-2.45, -2.5, 3.85), (0.5, 0.12, 0.1), "#2a2a2a", tile=1.0, zspan=5.0)
    s.box((-2.2, -2.5, 3.78), (0.2, 0.2, 0.06), "#ffffff", mat=1)
    for (cx, cz, sx_, sz_) in [(-3.0, 4.2, 0.05, 0.9), (-3.0, 3.5, 0.05, 0.05), (-3.0, 4.2, 0.05, 0.05)]:
        s.box((cx + 0.12, 2.0, cz), (sx_, 1.6 if sx_ < 0.1 and sz_ > 0.5 else 0.8, sz_), "#ffffff", mat=1)
    examples.append(("room-gasse", s.to_object(), 14.0))

    for name, ob, x in examples:
        sub = bpy.data.collections.new(name)
        collection.children.link(sub)
        ob.location.x = x
        sub.objects.link(ob)
    return {name: ob for name, ob, _ in examples}


# --------------------------------------------------------------------------- Referenz


def build_reference(collection):
    # Mensch 1,75 m aus Quadern (nur Maßstab, wird nie exportiert)
    mat_none = []
    s = Shape("Mensch-175cm", mat_none)
    s.box((-0.10, 0, 0.42), (0.14, 0.18, 0.84), "#8c8a86", zspan=1.8)
    s.box((0.10, 0, 0.42), (0.14, 0.18, 0.84), "#8c8a86", zspan=1.8)
    s.box((0, 0, 1.15), (0.42, 0.24, 0.62), "#8c8a86", zspan=1.8)
    for sx in (-1, 1):
        s.box((sx * 0.29, 0, 1.12), (0.10, 0.12, 0.66), "#8c8a86", zspan=1.8)
    s.box((0, 0, 1.62), (0.22, 0.22, 0.26), "#8c8a86", zspan=1.8)
    human = s.to_object(location=(-2.0, 0.0, 0.0))
    human.display_type = "SOLID"
    human.hide_render = True
    human.hide_select = True
    collection.objects.link(human)

    # Bodenraster 10 x 10 m, 1-m-Felder (Drahtgitter)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=10, y_segments=10, size=5.0)
    me = bpy.data.meshes.new("Bodenraster")
    bm.to_mesh(me)
    bm.free()
    grid = bpy.data.objects.new("Bodenraster", me)
    grid.location = (0.0, 0.0, -0.002)
    grid.display_type = "WIRE"
    grid.hide_render = True
    grid.hide_select = True
    collection.objects.link(grid)

    # Shop-Kamera: Augenhöhe 1,6 m, 70° Blickfeld, 640 x 448
    cam_data = bpy.data.cameras.new("Shop-Kamera")
    cam_data.sensor_fit = "HORIZONTAL"
    cam_data.angle = math.radians(70.0)
    cam_data.clip_start = 0.05
    cam_data.clip_end = 100.0
    cam = bpy.data.objects.new("Shop-Kamera", cam_data)
    cam.location = (0.0, -4.5, 1.6)
    cam.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    cam.hide_select = False
    collection.objects.link(cam)
    return cam


# --------------------------------------------------------------------------- Szene, Welt, Palette, Oberfläche


def setup_scene(scene, camera):
    scene.camera = camera
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"
    r = scene.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = 640, 448, 100
    r.fps = 30
    engines = [i.identifier for i in r.bl_rna.properties["engine"].enum_items]
    r.engine = next(e for e in engines if "EEVEE" in e)  # BLENDER_EEVEE_NEXT (4.x) bzw. BLENDER_EEVEE (5.x)
    safe_set(r, filter_size=1.0)
    ev = scene.eevee
    safe_set(ev, taa_render_samples=16, taa_samples=8, use_raytracing=False, use_shadows=True, use_volumetric_shadows=False,
             volumetric_start=0.1, volumetric_end=30.0, volumetric_samples=32)
    # Farbverwaltung „Standard“: Texturen und Vertexfarben bleiben unverfälscht
    vs = scene.view_settings
    for name in ("Standard",):
        try:
            vs.view_transform = name
            break
        except TypeError:
            pass
    safe_set(vs, look="None", exposure=0.0, gamma=1.0)
    safe_set(scene.display_settings, display_device="sRGB")
    # Einrasten und Raster
    ts = scene.tool_settings
    ts.use_snap = True
    ts.snap_elements = {"INCREMENT"}
    ts.use_snap_grid_absolute = True
    safe_set(ts, use_snap_translate=True, use_snap_rotate=False, use_snap_scale=False)
    vl = scene.view_layers[0]
    safe_set(vl, use_pass_mist=True)


def setup_world(scene):
    world = scene.world or bpy.data.worlds.new("Gasse bei Nacht")
    scene.world = world
    world.name = "Gasse bei Nacht"
    safe_set(world, use_nodes=True)
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (*lin(FOG_HEX), 1.0)
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    vol = nt.nodes.new("ShaderNodeVolumeScatter")  # Nebel: dünn, in der Vorschau nur bei Bedarf
    vol.inputs["Color"].default_value = (*lin(FOG_HEX), 1.0)
    vol.inputs["Density"].default_value = 0.02
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    ms = world.mist_settings
    ms.start, ms.depth, ms.falloff = 3.0, 30.0, "QUADRATIC"


def setup_palette(scene):
    pal = bpy.data.palettes.new(PALETTE_NAME)
    gamma = bpy.types.PaletteColor.bl_rna.properties["color"].subtype == "COLOR_GAMMA"
    for name, hex_color in palette_colors():
        c = pal.colors.new()
        rgb = hex_rgb(hex_color)
        c.color = rgb if gamma else tuple(srgb_to_linear(v) for v in rgb)
    ts = scene.tool_settings
    for attr in ("image_paint", "vertex_paint"):
        paint = getattr(ts, attr, None)
        if paint is not None:
            paint.palette = pal
    return pal


GUIDE = """CYPHER PS2 – Modelle für den Cypher-Shop

1. Bauen: Maßeinheit Meter. Das Raster rastet alle 0,1 m ein (Strg schaltet um).
   Vergleiche mit dem Menschen (1,75 m) in der Sammlung „Referenz“.
2. Farbe: Vertexfarben (Arbeitsbereich „Vertexfarben“) und kleine Texturen
   (128–256 px, höchstens 512 px, Potenz von 2). Höchstens 2 Materialien,
   nur Basisfarbe und Emission (Neon). Palette „Cypher Kollektionen“ zum Malen.
3. Ablegen: Alles, was exportiert werden soll, gehört in die Sammlung „Export“.
   Unterkante auf den Boden (Z = 0), Mitte über den Ursprung, Transformationen anwenden.
4. Prüfen und exportieren: Seitenleiste (N) → Reiter „Cypher“. Präfix wählen
   (prop-, furn-, prod-, fig-, room-) und Namen eintragen. Grün/Gelb/Rot zeigt,
   ob das Modell ins Budget passt. Dann „Als GLB exportieren“.
5. Beispiele: Sammlung „Beispiele“ – je ein Modell pro Präfix im Budget.

Budgets (Dreiecke): prop 500 · furn 1.500 · prod 1.500 · fig 4.000 · room 15.000.
Die Sammlung „Referenz“ wird nie exportiert.
"""


def setup_text():
    text = bpy.data.texts.new("Cypher-Anleitung")
    text.write(GUIDE)
    text.cursor_set(0)
    return text


def setup_workspaces(guide_text):
    ws = bpy.data.workspaces
    window = bpy.context.window
    renames = {
        "Layout": "Aufbauen",
        "Modeling": "Modellieren",
        "UV Editing": "UV",
        "Texture Paint": "Texturen malen",
        "Shading": "Material",
        "Sculpting": "Vertexfarben",
    }
    drop = ["Animation", "Rendering", "Compositing", "Geometry Nodes", "Scripting"]
    window.workspace = ws["Layout"]
    doomed = [ws[name] for name in drop if name in ws]
    bpy.data.batch_remove(doomed)
    for old, new in renames.items():
        if old in ws:
            ws[old].name = new
    safe_set(ws["Vertexfarben"], object_mode="VERTEX_PAINT")
    for name in ("Aufbauen", "Modellieren", "UV", "Texturen malen", "Material", "Vertexfarben"):
        workspace = ws[name]
        for screen in workspace.screens:
            for area in screen.areas:
                if area.type != "VIEW_3D":
                    continue
                for space in area.spaces:
                    if space.type != "VIEW_3D":
                        continue
                    space.clip_start, space.clip_end = 0.01, 200.0
                    space.overlay.grid_scale = 1.0
                    space.overlay.grid_subdivisions = 10
                    space.overlay.show_stats = name == "Aufbauen"  # zeigt die Dreieckszahl
                    space.show_region_ui = name == "Aufbauen"  # Seitenleiste mit Reiter „Cypher“
                    if name == "Aufbauen":
                        space.shading.type = "MATERIAL"
                    elif name == "Vertexfarben":
                        space.shading.type = "SOLID"
                        safe_set(space.shading, color_type="VERTEX")
                    else:
                        space.shading.type = "SOLID"
                        safe_set(space.shading, color_type="MATERIAL")
    # Zeitleiste im Arbeitsbereich „Aufbauen“ wird zur Anleitung
    for area in ws["Aufbauen"].screens[0].areas:
        if area.type == "DOPESHEET_EDITOR":
            area.type = "TEXT_EDITOR"
            space = area.spaces.active
            space.text = guide_text
            safe_set(space, show_word_wrap=True, show_line_numbers=False)
    window.workspace = ws["Aufbauen"]


# --------------------------------------------------------------------------- Fingerabdruck


def _node_signature(mat):
    tree = mat.node_tree
    if tree is None:
        return []
    nodes = sorted(n.bl_idname + ":" + n.name for n in tree.nodes)
    links = sorted(f"{l.from_node.name}.{l.from_socket.identifier}->{l.to_node.name}.{l.to_socket.identifier}" for l in tree.links)
    values = []
    for n in sorted(tree.nodes, key=lambda x: x.name):
        for s in n.inputs:
            if hasattr(s, "default_value") and not s.is_linked:
                v = s.default_value
                try:
                    v = [round(float(x), 5) for x in v]
                except TypeError:
                    v = round(float(v), 5) if isinstance(v, (int, float)) else str(v)
                values.append([n.name, s.identifier, v])
    return [nodes, links, values]


def fingerprint():
    """Stabile JSON-Beschreibung der Szene (Namen, Dreiecke, Materialien, Bilder, Einstellungen)."""
    sc = bpy.context.scene
    objs = []
    for ob in sorted(bpy.data.objects, key=lambda o: o.name):
        entry = {
            "name": ob.name,
            "type": ob.type,
            "collections": sorted(c.name for c in ob.users_collection),
            "location": [round(v, 4) for v in ob.location],
            "dims": [round(v, 4) for v in ob.dimensions],
            "hide_render": ob.hide_render,
            "hide_select": ob.hide_select,
        }
        if ob.type == "MESH":
            me = ob.data
            me.calc_loop_triangles()
            entry["tris"] = len(me.loop_triangles)
            entry["materials"] = [m.name if m else None for m in me.materials]
            entry["uv"] = [l.name for l in me.uv_layers]
            entry["colors"] = [a.name for a in me.color_attributes]
        objs.append(entry)
    images = {}
    for img in sorted(bpy.data.images, key=lambda i: i.name):
        if img.type == "IMAGE" and img.name != "Render Result":
            px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
            images[img.name] = {"size": list(img.size), "sha1": hashlib.sha1(np.round(px, 3).tobytes()).hexdigest()}
    pal = bpy.data.palettes.get(PALETTE_NAME)
    return {
        "blender": ".".join(str(v) for v in bpy.app.version[:2]),
        "unit": [sc.unit_settings.system, sc.unit_settings.scale_length, sc.unit_settings.length_unit],
        "resolution": [sc.render.resolution_x, sc.render.resolution_y],
        "engine": "EEVEE" if "EEVEE" in sc.render.engine else sc.render.engine,
        "view_transform": sc.view_settings.view_transform,
        "camera": sc.camera.name if sc.camera else None,
        "collections": sorted(c.name for c in bpy.data.collections),
        "objects": objs,
        "materials": {m.name: _node_signature(m) for m in sorted(bpy.data.materials, key=lambda m: m.name)},
        "images": images,
        "palette": [[round(v, 4) for v in c.color] for c in pal.colors] if pal else [],
        "workspaces": [w.name for w in bpy.data.workspaces],
        "texts": {t.name: hashlib.sha1(t.as_string().encode("utf-8")).hexdigest() for t in bpy.data.texts},
        "snap": [sc.tool_settings.use_snap, sorted(sc.tool_settings.snap_elements), sc.tool_settings.use_snap_grid_absolute],
    }


# --------------------------------------------------------------------------- Bauen


def purge_orphans():
    """Entfernt unbenutzte Datenblöcke aus den Werkseinstellungen (sie würden beim Speichern ohnehin fehlen)."""
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.images, bpy.data.textures, bpy.data.node_groups):
        for block in list(coll):
            if block.users == 0 and not block.use_fake_user:
                coll.remove(block)


def build(out_path=None):
    """Baut die Startszene aus dem Nichts (Werkseinstellungen) und speichert optional nach `out_path`.

    Liefert den Fingerabdruck (dict).
    """
    bpy.ops.wm.read_factory_settings(use_empty=False)
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    scene = bpy.context.scene
    scene.name = "Cypher PS2"

    images = make_images()
    mats = make_materials(images)

    root = scene.collection
    export = bpy.data.collections.new("Export")
    reference = bpy.data.collections.new("Referenz")
    examples = bpy.data.collections.new("Beispiele")
    for c in (export, reference, examples):
        root.children.link(c)

    camera = build_reference(reference)
    objs = build_examples(mats, examples)
    export.objects.link(objs["prop-kiste"])  # startet mit grünem Prüfbericht
    objs["prop-kiste"].location.x = 0.0

    setup_scene(scene, camera)
    setup_world(scene)
    setup_palette(scene)
    guide = setup_text()
    setup_workspaces(guide)
    tmpl = _load_template_module()
    tmpl.apply_view_defaults()

    s = scene.cypher_export if hasattr(scene, "cypher_export") else None
    if s is not None:
        s.prefix, s.name = "prop-", "kiste"

    layer = bpy.context.view_layer
    layer.active_layer_collection = layer.layer_collection.children["Export"]
    for ob in layer.objects:
        ob.select_set(False)
    layer.objects.active = None

    purge_orphans()
    fp = fingerprint()
    if out_path is not None:
        bpy.ops.wm.save_as_mainfile(filepath=str(out_path), compress=False, relative_remap=False)
    return fp


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

    def arg(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default

    out = Path(arg("--out", str(HERE / "startup.blend")))
    fp = build(out)
    fp_path = arg("--fingerprint")
    if fp_path:
        Path(fp_path).write_text(json.dumps(fp, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    tris = sum(o.get("tris", 0) for o in fp["objects"])
    print(f"startup.blend gebaut: {out} ({len(fp['objects'])} Objekte, {tris} Dreiecke)")


if __name__ == "__main__":
    main()
