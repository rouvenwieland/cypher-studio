# SPDX-License-Identifier: GPL-3.0-or-later
"""Operatoren von Cypher Export: Prüfen, Korrekturen und der GLB-Export.

Kein `from __future__ import annotations`: Blender liest die Annotationen zur Laufzeit.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path

import bpy
from bpy.props import BoolProperty

from . import checks, glb_post

# Fehler, die auch „Trotzdem exportieren“ nicht überspringt (ohne sie gäbe es keine sinnvolle Datei)
HARD_KEYS = {"naming", "scope"}


@dataclass
class ExportResult:
    glb: Path
    files: list = field(default_factory=list)
    tris: int = 0
    draw_calls: int = 0
    issues: list = field(default_factory=list)
    license_created: bool = False
    forced: bool = False


LAST_RESULT = None  # letztes Exportergebnis (für Tests und den Dialog)


# --------------------------------------------------------------------------- Texturen


def floor_pot(value):
    return 1 << (max(int(value), 1).bit_length() - 1)


def target_dims(width, height, tcfg):
    """Nächstkleinere Potenz von 2 je Kante, höchstens maxPx, mindestens minPx."""
    mx, mn = int(tcfg["maxPx"]), int(tcfg.get("minPx", 1))
    return max(min(floor_pot(width), mx), mn), max(min(floor_pot(height), mx), mn)


def _materials_of(objects):
    mats = {}
    for ob in objects:
        for slot in ob.material_slots:
            if slot.material is not None:
                mats[slot.material.name] = slot.material
    return list(mats.values())


def shrink_textures(objects, tcfg):
    """Ersetzt zu große oder nicht-2er-Potenz-Bilder an den Knoten durch verkleinerte Kopien.

    Das Original bleibt unverändert erhalten. Liefert (Rückgängig-Liste, neue Bilder).
    """
    undo, copies, cache = [], [], {}
    for mat in _materials_of(objects):
        for node, img in checks.material_images(mat):
            w, h = img.size
            if w == 0 or h == 0:
                continue
            tw, th = target_dims(w, h, tcfg)
            if (tw, th) == (w, h):
                continue
            key = (img.name, tw, th)
            new = cache.get(key)
            if new is None:
                new = img.copy()
                new.name = f"{img.name}.{tw}x{th}"[:63]
                new.scale(tw, th)
                new.pack()
                cache[key] = new
                copies.append(new)
            undo.append((node, img))
            node.image = new
    return undo, copies


def restore_textures(undo, copies):
    for node, img in undo:
        node.image = img
    for img in copies:
        bpy.data.images.remove(img)


# --------------------------------------------------------------------------- Auswahl


class _Selection:
    """Merkt Auswahl und aktives Objekt und stellt sie wieder her."""

    def __init__(self, context):
        self.view_layer = context.view_layer
        self.selected = [o for o in self.view_layer.objects if o.select_get()]
        self.active = self.view_layer.objects.active

    def select_only(self, objects):
        for o in self.view_layer.objects:
            if o.select_get():
                o.select_set(False)
        for o in objects:
            o.select_set(True)
        if objects:
            self.view_layer.objects.active = objects[0]

    def restore(self):
        for o in self.view_layer.objects:
            if o.select_get():
                o.select_set(False)
        for o in self.selected:
            if o.name in self.view_layer.objects:
                o.select_set(True)
        self.view_layer.objects.active = self.active


def _object_mode(context):
    if context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


# --------------------------------------------------------------------------- Operatoren


class CYPHER_OT_check(bpy.types.Operator):
    bl_idname = "cypher.check"
    bl_label = "Jetzt prüfen"
    bl_description = "Prüfbericht neu berechnen"

    def execute(self, context):
        from . import panel

        panel.refresh_now(context)
        return {"FINISHED"}


class CYPHER_OT_fix_transforms(bpy.types.Operator):
    bl_idname = "cypher.fix_transforms"
    bl_label = "Transformationen anwenden"
    bl_description = "Wendet Drehung und Skalierung der Mesh-Objekte im Umfang an (Position bleibt)"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        s = context.scene.cypher_export
        targets = [o for o in checks.export_objects(context, s.scope) if o.type in {"MESH", "CURVE"}]
        _object_mode(context)
        sel = _Selection(context)
        try:
            multi = [o for o in targets if o.data is not None and o.data.users > 1]
            if multi:
                sel.select_only(multi)
                bpy.ops.object.make_single_user(object=False, obdata=True, material=False, animation=False)
            sel.select_only(targets)
            if targets:
                bpy.ops.object.transform_apply(location=False, rotation=True, scale=True, properties=False)
        finally:
            sel.restore()
        self.report({"INFO"}, f"Transformationen an {len(targets)} Objekten angewendet")
        return {"FINISHED"}


class CYPHER_OT_fix_textures(bpy.types.Operator):
    bl_idname = "cypher.fix_textures"
    bl_label = "Texturen verkleinern"
    bl_description = "Ersetzt zu große oder ungerade Texturen durch Kopien in der nächstkleineren Potenz von 2 (das Original bleibt erhalten)"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        s = context.scene.cypher_export
        objects = checks.export_objects(context, s.scope)
        undo, copies = shrink_textures(objects, checks.load_budgets()["textures"])
        for _, original in undo:
            original.use_fake_user = True  # Original nicht verlieren
        self.report({"INFO"}, f"{len(copies)} Texturen verkleinert")
        return {"FINISHED"}


def gltf_kwargs(filepath, budgets):
    """Exporter-Einstellungen; unbekannte Namen (andere Blender-Version) werden weggelassen."""
    quality = int(budgets["textures"].get("webpQuality", 90))
    exp = budgets.get("export", {})
    wanted = dict(
        filepath=str(filepath),
        check_existing=False,
        export_format="GLB",
        use_selection=True,
        use_visible=False,
        export_apply=True,
        export_yup=True,
        export_cameras=bool(exp.get("cameras", False)),
        export_lights=bool(exp.get("lights", False)),
        export_extras=False,
        export_image_format="WEBP",
        export_image_add_webp=False,
        export_image_webp_fallback=False,
        export_image_quality=quality,
        export_jpeg_quality=quality,
        export_keep_originals=False,
        export_vertex_color="ACTIVE",
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_unused_images=False,
        export_unused_textures=False,
        export_gn_mesh=False,
        export_animations=bool(exp.get("animations", False)),
        export_draco_mesh_compression_enable=False,  # Shop-CSP erlaubt kein WebAssembly
        export_use_gltfpack=False,
        export_copyright="",
        will_save_settings=False,
    )
    props = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    return {k: v for k, v in wanted.items() if k in props}


class CYPHER_OT_export_glb(bpy.types.Operator):
    bl_idname = "cypher.export_glb"
    bl_label = "Als GLB exportieren"
    bl_description = "Prüft das Modell und schreibt <name>.glb, <name>-basis.webp und <name>.lizenz.json"

    force: BoolProperty(name="Trotz Fehlern", default=False, options={"SKIP_SAVE"})  # type: ignore[valid-type]

    @classmethod
    def poll(cls, context):
        return context.scene is not None

    def invoke(self, context, event):
        if self.force:
            return context.window_manager.invoke_confirm(self, event, title="Trotzdem exportieren?", message="Der Prüfbericht enthält Fehler. Die Datei hält die Shop-Regeln dann evtl. nicht ein.", confirm_text="Trotzdem exportieren")
        return self.execute(context)

    def execute(self, context):
        global LAST_RESULT
        s = context.scene.cypher_export
        budgets = checks.load_budgets()
        report = checks.run_checks(context, scope=s.scope, prefix=s.prefix, name=s.name)
        hard = [f for f in report.findings if f.level == "error" and f.key in HARD_KEYS]
        if hard:
            self.report({"ERROR"}, f"{hard[0].title}: {hard[0].detail}")
            return {"CANCELLED"}
        if report.has_errors and not self.force:
            n = report.count("error")
            self.report({"ERROR"}, f"Export gesperrt: {n} Fehler im Prüfbericht. Korrigiere sie oder wähle „Trotzdem exportieren“.")
            return {"CANCELLED"}

        if s.export_dir:
            outdir = Path(bpy.path.abspath(s.export_dir))
        elif bpy.data.filepath:
            outdir = Path(bpy.data.filepath).parent
        else:
            self.report({"ERROR"}, "Wähle einen Zielordner oder speichere die .blend-Datei zuerst.")
            return {"CANCELLED"}
        outdir.mkdir(parents=True, exist_ok=True)
        name = s.full_name
        glb_path = outdir / f"{name}.glb"

        objects = checks.export_objects(context, s.scope)
        exportable = [o for o in objects if o.type not in {"CAMERA", "LIGHT"}]
        _object_mode(context)
        sel = _Selection(context)
        undo, copies = shrink_textures(exportable, budgets["textures"])
        try:
            sel.select_only(exportable)
            result = bpy.ops.export_scene.gltf(**gltf_kwargs(glb_path, budgets))
        finally:
            restore_textures(undo, copies)
            sel.restore()
        if "FINISHED" not in result:
            self.report({"ERROR"}, "Der glTF-Exporter hat nichts geschrieben.")
            return {"CANCELLED"}

        try:
            files = glb_post.externalize_images(glb_path, name)
        except glb_post.GlbError as exc:
            self.report({"ERROR"}, f"Nachbearbeitung der GLB fehlgeschlagen: {exc}")
            return {"CANCELLED"}
        issues = glb_post.validate_glb(glb_path, budgets)

        lic = outdir / f"{name}.lizenz.json"
        created = False
        if not lic.exists():
            lic.write_text(
                json.dumps(
                    {"name": name, "autor": s.author, "lizenz": s.license_id, "lizenzUrl": s.license_url, "quelle": s.source},
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            created = True
        gltf, _ = glb_post.read_glb(glb_path.read_bytes())
        tris, draws = glb_post.count_geometry(gltf)
        LAST_RESULT = ExportResult(glb_path, [*files, lic], tris, draws, issues, created, self.force and report.has_errors)
        errors = [i for i in issues if i.level == "error"]
        msg = f"{glb_path.name}: {tris} Dreiecke, {draws} Draw-Calls, {len(files)} Textur(en)"
        self.report({"WARNING" if errors else "INFO"}, msg + (f" · {len(errors)} Fehler in der Ausgabe" if errors else ""))
        if not bpy.app.background:
            _popup(context, LAST_RESULT)
        return {"FINISHED"}


def _popup(context, result):
    def draw(self, _ctx):
        col = self.layout.column()
        col.label(text=f"{result.glb.name}", icon="FILE_3D")
        col.label(text=f"{result.tris} Dreiecke · {result.draw_calls} Draw-Calls")
        for f in result.files:
            col.label(text=f.name, icon="FILE_IMAGE" if f.suffix == ".webp" else "TEXT")
        if result.forced:
            col.label(text="Trotz Fehlern im Prüfbericht exportiert", icon="ERROR")
        for issue in result.issues:
            col.label(text=issue.message, icon="CANCEL" if issue.level == "error" else "ERROR")
        if not result.issues:
            col.label(text="Ausgabe geprüft: keine Befunde", icon="CHECKBOX_HLT")

    context.window_manager.popup_menu(draw, title="Cypher Export fertig", icon="EXPORT")


CLASSES = (CYPHER_OT_check, CYPHER_OT_fix_transforms, CYPHER_OT_fix_textures, CYPHER_OT_export_glb)
