# SPDX-License-Identifier: GPL-3.0-or-later
"""Prüfungen für Cypher Export.

Reine Lese-Auswertung der Szene gegen `budgets.json`. Jede Prüfung liefert einen
`Finding` mit Ampelstufe (ok, info, warn, error) und deutschem Text. Nichts hier
verändert die Szene; Korrekturen stehen in `operators.py`.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Iterator

import bpy
import numpy as np

PREFIXES = ("prop-", "furn-", "prod-", "room-", "fig-")
NAME_RE = re.compile(r"^(?:prop|furn|prod|room|fig)-[a-z0-9]+(?:-[a-z0-9]+)*$")
EXPORT_COLLECTION = "Export"
MESH_LIKE = {"MESH", "CURVE", "SURFACE", "META", "FONT"}
STRUCTURE_TYPES = {"EMPTY", "ARMATURE"}
LEVEL_RANK = {"ok": 0, "info": 0, "warn": 1, "error": 2}

# Principled-BSDF-Eingänge, die der Shop nicht liest (Lambert bzw. unlit mit Basisfarbe + Emission)
FORBIDDEN_SOCKETS = (
    "Metallic",
    "Roughness",
    "Normal",
    "Specular IOR Level",
    "Specular Tint",
    "Anisotropic",
    "Transmission Weight",
    "Coat Weight",
    "Sheen Weight",
    "Subsurface Weight",
    "Thin Film Thickness",
)
# nur der Wert zählt (verbunden ist ohnehin Fehler): Werte ungleich 0 werden ignoriert -> Hinweis
IGNORED_VALUE_SOCKETS = ("Metallic", "Transmission Weight", "Coat Weight", "Sheen Weight", "Subsurface Weight")

_BUDGETS_PATH = Path(__file__).with_name("budgets.json")
_budget_cache: dict[str, Any] = {"mtime": None, "data": None, "path": None}


@dataclass
class Finding:
    """Ergebnis einer Prüfung. `key` ist stabil (Tests, Oberfläche)."""

    key: str
    level: str
    title: str
    value: str = ""
    detail: str = ""
    fix: str = ""  # Operator-Kennung der Korrektur, falls vorhanden


@dataclass
class Report:
    findings: list[Finding] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)

    @property
    def level(self) -> str:
        worst = "ok"
        for f in self.findings:
            if LEVEL_RANK[f.level] > LEVEL_RANK[worst]:
                worst = f.level
        return worst

    @property
    def has_errors(self) -> bool:
        return any(f.level == "error" for f in self.findings)

    def get(self, key: str) -> Finding | None:
        for f in self.findings:
            if f.key == key:
                return f
        return None

    def count(self, level: str) -> int:
        return sum(1 for f in self.findings if f.level == level)


def de(n: int | float) -> str:
    """Zahl mit deutschem Tausenderpunkt."""
    return f"{int(round(n)):,}".replace(",", ".")


# --------------------------------------------------------------------------- Budgets


def load_budgets() -> dict[str, Any]:
    """Liest budgets.json (neu, sobald sich die Datei ändert). Änderungen brauchen keinen Code."""
    path = _BUDGETS_PATH
    mtime = path.stat().st_mtime
    if _budget_cache["data"] is None or _budget_cache["mtime"] != mtime or _budget_cache["path"] != str(path):
        _budget_cache.update(data=json.loads(path.read_text(encoding="utf-8")), mtime=mtime, path=str(path))
    return _budget_cache["data"]


def _cfg(budgets: dict[str, Any], key: str, default: float) -> float:
    return float(budgets.get("checks", {}).get(key, default))


# --------------------------------------------------------------------------- Umfang


def export_objects(context: bpy.types.Context, scope: str) -> list[bpy.types.Object]:
    """Objekte, die exportiert würden: Sammlung "Export" oder die Auswahl; nur sichtbare."""
    view_layer = context.view_layer
    if scope == "SELECTION":
        base = list(context.selected_objects)
    else:
        coll = bpy.data.collections.get(EXPORT_COLLECTION)
        base = list(coll.all_objects) if coll else []
    result = []
    for ob in base:
        try:
            if ob.name in view_layer.objects and ob.visible_get(view_layer=view_layer):
                result.append(ob)
        except RuntimeError:
            continue
    return result


# --------------------------------------------------------------------------- Knoten und Materialien


def iter_nodes(tree: bpy.types.NodeTree | None, _depth: int = 0) -> Iterator[bpy.types.Node]:
    """Alle Knoten eines Materials, auch in Gruppen."""
    if tree is None or _depth > 4:
        return
    for node in tree.nodes:
        yield node
        if node.type == "GROUP" and getattr(node, "node_tree", None) is not None:
            yield from iter_nodes(node.node_tree, _depth + 1)


def material_images(mat: bpy.types.Material) -> list[tuple[bpy.types.Node, bpy.types.Image]]:
    """Bild-Textur-Knoten mit Bild, deren Ausgang benutzt wird."""
    found = []
    for node in iter_nodes(mat.node_tree):
        if node.type == "TEX_IMAGE" and node.image is not None and any(o.is_linked for o in node.outputs):
            found.append((node, node.image))
    return found


def _alpha_is_mask(sock: bpy.types.NodeSocket) -> bool:
    """Alpha als Maske: direkt von Math (Runden / Größer / Kleiner) gespeist."""
    link = sock.links[0] if sock.links else None
    if link is None:
        return False
    node = link.from_node
    return node.type == "MATH" and node.operation in {"ROUND", "GREATER_THAN", "LESS_THAN"}


def inspect_material(mat: bpy.types.Material) -> list[tuple[str, str, str]]:
    """Gibt Probleme eines Materials als (Schlüssel, Stufe, Text) zurück."""
    problems: list[tuple[str, str, str]] = []
    tree = mat.node_tree
    if tree is None:
        return problems  # einfache Farbe, wird als Basisfarbe exportiert
    out = tree.get_output_node("ALL")
    surface = out.inputs["Surface"] if out is not None else None
    shader = surface.links[0].from_node if surface is not None and surface.links else None
    if shader is None:
        return problems  # nichts angeschlossen: Standardmaterial
    if shader.type != "BSDF_PRINCIPLED":
        problems.append(("channels", "error", f"{mat.name}: am Ausgang hängt kein Principled BSDF (nur Basisfarbe und Emission werden übernommen)"))
        return problems
    for name in FORBIDDEN_SOCKETS:
        sock = shader.inputs.get(name)
        if sock is None:
            continue
        if sock.is_linked:
            problems.append(("channels", "error", f"{mat.name}: „{name}“ ist verbunden (erlaubt sind nur Basisfarbe und Emission)"))
        elif name in IGNORED_VALUE_SOCKETS and getattr(sock, "default_value", 0.0) > 1e-4:
            problems.append(("channels", "warn", f"{mat.name}: „{name}“ ist nicht 0 und wird im Shop ignoriert"))
    alpha = shader.inputs.get("Alpha")
    if alpha is not None:
        if alpha.is_linked:
            if not _alpha_is_mask(alpha):
                problems.append(("alpha", "error", f"{mat.name}: Alpha ist keine Maske (Math-Knoten „Runden“ dazwischenschalten; alphaMode BLEND ist verboten)"))
        elif 1e-4 < alpha.default_value < 1.0 - 1e-4:
            problems.append(("alpha", "error", f"{mat.name}: Alpha {alpha.default_value:.2f} ergäbe alphaMode BLEND (erlaubt ist nur MASK)"))
    strength = shader.inputs.get("Emission Strength")
    color = shader.inputs.get("Emission Color")
    if strength is not None and not strength.is_linked and strength.default_value > 1.0 + 1e-4:
        if color is None or color.is_linked or max(color.default_value[:3]) > 1e-4:
            problems.append(("emission", "warn", f"{mat.name}: Emission-Stärke {strength.default_value:.1f} > 1 braucht KHR_materials_emissive_strength"))
    return problems


# --------------------------------------------------------------------------- Geometrie


@dataclass
class Scan:
    tris: int = 0
    draw_calls: int = 0
    materials: dict[str, bpy.types.Material] = field(default_factory=dict)
    bbox_min: np.ndarray | None = None
    bbox_max: np.ndarray | None = None
    missing_uv: set[str] = field(default_factory=set)
    has_vertex_colors: bool = False
    mesh_objects: set[str] = field(default_factory=set)
    tris_by_object: dict[str, int] = field(default_factory=dict)


def scan_geometry(context: bpy.types.Context, objects: Iterable[bpy.types.Object]) -> Scan:
    """Zählt Dreiecke, Zeichenaufrufe und Begrenzungsquader der ausgewerteten Geometrie."""
    names = {o.name for o in objects}
    scan = Scan()
    depsgraph = context.evaluated_depsgraph_get()
    for inst in depsgraph.object_instances:
        ev = inst.object
        owner = inst.parent.original if inst.is_instance and inst.parent is not None else ev.original
        if owner.name not in names or ev.type not in MESH_LIKE:
            continue
        me = None
        try:
            me = ev.to_mesh()
        except RuntimeError:
            me = None
        if me is None:
            continue
        try:
            me.calc_loop_triangles()
            tri_count = len(me.loop_triangles)
            if tri_count == 0:
                continue
            scan.tris += tri_count
            scan.tris_by_object[owner.name] = scan.tris_by_object.get(owner.name, 0) + tri_count
            scan.mesh_objects.add(owner.name)
            n_poly = len(me.polygons)
            idx = np.empty(n_poly, dtype=np.int32)
            me.polygons.foreach_get("material_index", idx)
            used: set[str | None] = set()
            slots = list(ev.material_slots)
            for i in np.unique(idx).tolist():
                mat = slots[i].material if 0 <= i < len(slots) else None
                used.add(mat.name if mat is not None else None)
                if mat is not None:
                    scan.materials[mat.name] = mat
            scan.draw_calls += max(1, len(used))
            if len(me.color_attributes) > 0:
                scan.has_vertex_colors = True
            has_tex = any(slot.material is not None and material_images(slot.material) for slot in slots)
            if has_tex and len(me.uv_layers) == 0:
                scan.missing_uv.add(owner.name)
            n_vert = len(me.vertices)
            co = np.empty(n_vert * 3, dtype=np.float32)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            m = np.array(inst.matrix_world, dtype=np.float64)
            world = co @ m[:3, :3].T + m[:3, 3]
            lo, hi = world.min(axis=0), world.max(axis=0)
            scan.bbox_min = lo if scan.bbox_min is None else np.minimum(scan.bbox_min, lo)
            scan.bbox_max = hi if scan.bbox_max is None else np.maximum(scan.bbox_max, hi)
        finally:
            ev.to_mesh_clear()
    return scan


# --------------------------------------------------------------------------- Prüfungen


def run_checks(
    context: bpy.types.Context,
    *,
    scope: str = "COLLECTION",
    prefix: str = "prop-",
    name: str = "",
) -> Report:
    """Führt alle Prüfungen aus und liefert den Bericht (Ampel je Zeile)."""
    budgets = load_budgets()
    report = Report()
    add = report.findings.append
    context.evaluated_depsgraph_get()  # gleicht Ebenen und Auswertung ab, bevor Sichtbarkeit gelesen wird
    objects = export_objects(context, scope)
    full_name = f"{prefix}{name}"

    # Benennung
    if NAME_RE.match(full_name) and full_name.startswith(prefix):
        add(Finding("naming", "ok", "Benennung", full_name))
    else:
        add(Finding("naming", "error", "Benennung", full_name or "(leer)",
                    "Name in kebab-case mit Präfix (prop-, furn-, prod-, room-, fig-), z. B. prop-laterne-neon: nur a–z, 0–9 und einzelne Bindestriche."))

    # Umfang
    where = "Sammlung „Export“" if scope == "COLLECTION" else "Auswahl"
    if scope == "COLLECTION" and bpy.data.collections.get(EXPORT_COLLECTION) is None:
        add(Finding("scope", "error", "Umfang", "Sammlung fehlt", "Lege eine Sammlung „Export“ an oder stelle den Umfang auf „Auswahl“."))
    elif not objects:
        add(Finding("scope", "error", "Umfang", f"{where} leer", f"In der {where} liegt kein sichtbares Objekt." if scope == "COLLECTION" else "Wähle die zu exportierenden Objekte aus."))
    else:
        add(Finding("scope", "ok", "Umfang", f"{len(objects)} Objekte aus {where}"))

    # Kameras und Lichter
    bad = sorted(o.name for o in objects if o.type in {"CAMERA", "LIGHT"})
    if bad:
        add(Finding("cameras-lights", "warn", "Kameras und Lichter", f"{len(bad)} im Umfang",
                    "Werden nicht mit exportiert (der Shop bringt eigenes Licht): " + ", ".join(bad[:5])))
    else:
        add(Finding("cameras-lights", "ok", "Kameras und Lichter", "keine"))
    other = sorted(o.name for o in objects if o.type not in MESH_LIKE | STRUCTURE_TYPES | {"CAMERA", "LIGHT"})
    if other:
        add(Finding("object-types", "warn", "Objekttypen", f"{len(other)} nicht exportierbar",
                    "Wird ignoriert: " + ", ".join(f"{n}" for n in other[:5])))

    scan = scan_geometry(context, objects)
    report.stats.update(tris=scan.tris, draw_calls=scan.draw_calls, materials=len(scan.materials), objects=len(objects))

    # Dreiecke je Präfix
    pcfg = budgets["prefixes"].get(prefix)
    if pcfg is not None:
        limit = int(pcfg["maxTris"])
        ratio = _cfg(budgets, "warnRatio", 0.9)
        title = f"Dreiecke ({prefix})"
        value = f"{de(scan.tris)} / {de(limit)}"
        if scan.tris > limit:
            add(Finding("tris", "error", title, value, f"{de(scan.tris - limit)} Dreiecke zu viel. Vereinfachen (Modifikator „Zerlegen“ / weniger Unterteilungen) oder anderes Präfix wählen."))
        elif scan.tris > limit * ratio:
            add(Finding("tris", "warn", title, value, "Knapp am Budget."))
        else:
            add(Finding("tris", "ok", title, value))
    else:
        add(Finding("tris", "error", "Dreiecke", f"{de(scan.tris)}", "Unbekanntes Präfix, kein Budget."))

    # Szenenbudget Handy / Desktop
    sc = budgets["scene"]
    add(Finding("scene-tris-mobile", "ok" if scan.tris <= sc["mobileMaxTris"] else "warn", "Szene Handy: Dreiecke",
                f"{de(scan.tris)} / {de(sc['mobileMaxTris'])}", "" if scan.tris <= sc["mobileMaxTris"] else "Zu schwer für Handys."))
    add(Finding("scene-tris-desktop", "ok" if scan.tris <= sc["desktopMaxTris"] else "error", "Szene Desktop: Dreiecke",
                f"{de(scan.tris)} / {de(sc['desktopMaxTris'])}", "" if scan.tris <= sc["desktopMaxTris"] else "Über dem Desktop-Budget."))
    add(Finding("draw-mobile", "ok" if scan.draw_calls <= sc["mobileMaxDrawCalls"] else "warn", "Handy: Draw-Calls",
                f"{scan.draw_calls} / {sc['mobileMaxDrawCalls']}", "" if scan.draw_calls <= sc["mobileMaxDrawCalls"] else "Objekte und Materialien zusammenfassen."))
    add(Finding("draw-desktop", "ok" if scan.draw_calls <= sc["desktopMaxDrawCalls"] else "error", "Desktop: Draw-Calls",
                f"{scan.draw_calls} / {sc['desktopMaxDrawCalls']}", "" if scan.draw_calls <= sc["desktopMaxDrawCalls"] else "Objekte und Materialien zusammenfassen."))

    # Materialien
    mcfg = budgets["materials"]
    n_mat = len(scan.materials)
    if n_mat > mcfg["max"]:
        add(Finding("materials", "error", "Materialien", f"{n_mat} / {mcfg['max']}",
                    "Höchstens " + str(mcfg["max"]) + " Materialien: " + ", ".join(sorted(scan.materials)[:6])))
    else:
        add(Finding("materials", "ok", "Materialien", f"{n_mat} / {mcfg['max']}"))

    channel_msgs: list[tuple[str, str, str]] = []
    for mat in scan.materials.values():
        channel_msgs.extend(inspect_material(mat))
    for key, title in (("channels", "Nur Basisfarbe und Emission"), ("alpha", "Alpha nur als Maske"), ("emission", "Emission-Stärke")):
        msgs = [(lvl, txt) for k, lvl, txt in channel_msgs if k == key]
        if msgs:
            worst = "error" if any(lvl == "error" for lvl, _ in msgs) else "warn"
            add(Finding(key, worst, title, f"{len(msgs)}×", " · ".join(t for _, t in msgs[:4])))
        elif key != "emission":
            add(Finding(key, "ok", title, "erfüllt"))

    # Texturen
    tcfg = budgets["textures"]
    seen: dict[str, bpy.types.Image] = {}
    nearest: list[str] = []
    for mat in scan.materials.values():
        for node, img in material_images(mat):
            seen[img.name] = img
            if node.interpolation == "Closest":
                nearest.append(f"{mat.name}/{img.name}")
    non_pot, too_big, too_small, missing, over_default = [], [], [], [], []
    for img in seen.values():
        w, h = img.size
        if w == 0 or h == 0:
            missing.append(img.name)
            continue
        if (w & (w - 1)) or (h & (h - 1)):
            non_pot.append(f"{img.name} ({w}×{h})")
        if max(w, h) > tcfg["maxPx"]:
            too_big.append(f"{img.name} ({w}×{h})")
        elif max(w, h) > tcfg["defaultPx"]:
            over_default.append(f"{img.name} ({w}×{h})")
        if min(w, h) < tcfg.get("minPx", 1):
            too_small.append(f"{img.name} ({w}×{h})")
    fixable = non_pot or too_big
    if missing:
        add(Finding("texture-missing", "error", "Texturdateien", f"{len(missing)} fehlen", "Bild nicht gefunden oder leer: " + ", ".join(missing)))
    if not seen:
        add(Finding("texture-size", "ok", "Texturgröße", "keine Texturen"))
    elif fixable or too_small:
        parts = []
        if non_pot:
            parts.append("keine Potenz von 2: " + ", ".join(non_pot[:4]))
        if too_big:
            parts.append(f"über {tcfg['maxPx']} px: " + ", ".join(too_big[:4]))
        if too_small:
            parts.append("zu klein: " + ", ".join(too_small[:4]))
        add(Finding("texture-size", "error", "Texturgröße", f"{len(non_pot) + len(too_big) + len(too_small)}× falsch", " · ".join(parts),
                    fix="cypher.fix_textures" if fixable else ""))
    elif over_default:
        add(Finding("texture-size", "info", "Texturgröße", f"{len(seen)} Bilder", f"Über dem Standard von {tcfg['defaultPx']} px (erlaubt bis {tcfg['maxPx']} px, nur für Motive in Nahaufnahme): " + ", ".join(over_default[:4])))
    else:
        add(Finding("texture-size", "ok", "Texturgröße", f"{len(seen)} Bilder, Potenz von 2, ≤ {tcfg['defaultPx']} px"))
    if nearest:
        add(Finding("texture-filter", "error", "Texturfilter", "Closest", "Der Shop filtert linear (PS2-Look, nicht PS1). Interpolation am Bild-Knoten auf „Linear“ stellen: " + ", ".join(nearest[:4])))
    elif seen:
        add(Finding("texture-filter", "ok", "Texturfilter", "linear"))

    # UV und Vertexfarben
    if scan.missing_uv:
        add(Finding("uv", "error", "UV-Karte", f"{len(scan.missing_uv)} ohne", "Objekte mit Textur brauchen UVs: " + ", ".join(sorted(scan.missing_uv)[:5])))
    else:
        add(Finding("uv", "ok", "UV-Karte", "vorhanden" if seen else "nicht nötig"))
    add(Finding("vertex-colors", "ok" if scan.has_vertex_colors else "info", "Vertexfarben",
                "vorhanden" if scan.has_vertex_colors else "keine",
                "" if scan.has_vertex_colors else "Erwünscht: Der Shop backt sein Licht in die Vertexfarben."))

    # Transformationen
    tol = _cfg(budgets, "transformTolerance", 1e-4)
    unapplied_mesh, unapplied_other = [], []
    for ob in objects:
        if ob.type in {"CAMERA", "LIGHT"} or ob.type == "ARMATURE":
            continue
        _, rot, scl = ob.matrix_basis.decompose()
        off = max(abs(scl[0] - 1), abs(scl[1] - 1), abs(scl[2] - 1)) > tol or abs(rot.angle) > tol
        if off:
            (unapplied_mesh if ob.type in MESH_LIKE else unapplied_other).append(ob.name)
    if unapplied_mesh:
        add(Finding("transforms", "error", "Transformationen angewendet", f"{len(unapplied_mesh)} nicht", "Drehung und Skalierung noch nicht angewendet: " + ", ".join(unapplied_mesh[:5]), fix="cypher.fix_transforms"))
    elif unapplied_other:
        add(Finding("transforms", "warn", "Transformationen angewendet", f"{len(unapplied_other)} Gruppen", "Leere Objekte sind gedreht oder skaliert (Alt+R / Alt+S setzt zurück): " + ", ".join(unapplied_other[:5])))
    else:
        add(Finding("transforms", "ok", "Transformationen angewendet", "erfüllt"))

    # Ursprung am Boden, mittig
    if scan.bbox_min is None:
        add(Finding("origin", "ok", "Ursprung am Boden", "nicht prüfbar", "Keine Geometrie."))
    else:
        zmin = float(scan.bbox_min[2])
        center = (scan.bbox_min[:2] + scan.bbox_max[:2]) / 2
        extent = scan.bbox_max[:2] - scan.bbox_min[:2]
        ztol = _cfg(budgets, "originZTolerance", 0.01)
        xy_allowed = max(_cfg(budgets, "originXYTolerance", 0.05), _cfg(budgets, "originXYRatio", 0.1) * float(extent.max()))
        xy_off = float(np.hypot(center[0], center[1]))
        if abs(zmin) > ztol:
            add(Finding("origin", "error", "Ursprung am Boden", f"{zmin * 100:+.1f} cm", f"Die Unterkante liegt {zmin * 100:+.1f} cm über dem Ursprung; sie muss auf 0 liegen (Boden)."))
        elif xy_off > xy_allowed:
            add(Finding("origin", "warn", "Ursprung am Boden", f"{xy_off * 100:.0f} cm neben der Mitte", "Das Modell sollte mittig über dem Ursprung stehen (Platzierung im Shop)."))
        else:
            add(Finding("origin", "ok", "Ursprung am Boden", "mittig, Unterkante 0"))
        report.stats["size"] = tuple(float(v) for v in (scan.bbox_max - scan.bbox_min))
    return report
