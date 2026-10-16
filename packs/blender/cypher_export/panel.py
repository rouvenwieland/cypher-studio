# SPDX-License-Identifier: GPL-3.0-or-later
"""Seitenleiste „Cypher“ im 3D-Viewport: Prüfbericht mit Ampel und Export-Knopf.

Kein `from __future__ import annotations`: Blender liest die Annotationen zur Laufzeit.
"""

import textwrap
import traceback

import bpy
from bpy.app.handlers import persistent

from . import checks

# Form + Wort + Farbe, nie Farbe allein (DESIGN.md, Status):
# erfüllt = Häkchen im Kasten, Info = i, Hinweis = Dreieck, Fehler = Kreuz im Kreis
LEVEL_UI = {
    "ok": ("CHECKBOX_HLT", "erfüllt"),
    "info": ("INFO", "Info"),
    "warn": ("ERROR", "Hinweis"),
    "error": ("CANCEL", "Fehler"),
}
AMPEL_ICON = {"ok": "SEQUENCE_COLOR_04", "info": "SEQUENCE_COLOR_04", "warn": "SEQUENCE_COLOR_03", "error": "SEQUENCE_COLOR_01"}
AMPEL_TEXT = {"ok": "Grün: alles erfüllt", "info": "Grün: alles erfüllt", "warn": "Gelb: Hinweise", "error": "Rot: Fehler"}

_cache = {"report": None, "scene": None}


# --------------------------------------------------------------------------- Live-Prüfung


def get_report():
    return _cache["report"]


def refresh_now(context=None):
    """Berechnet den Prüfbericht sofort neu und löst ein Neuzeichnen aus."""
    context = context or bpy.context
    s = context.scene.cypher_export
    _cache["report"] = checks.run_checks(context, scope=s.scope, prefix=s.prefix, name=s.name)
    _cache["scene"] = context.scene.name
    _redraw()
    return _cache["report"]


def _redraw():
    wm = bpy.context.window_manager
    if wm is None:
        return
    for window in wm.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                area.tag_redraw()


def _timer():
    try:
        scene = bpy.context.scene
        settings = getattr(scene, "cypher_export", None)
        if settings is not None and settings.live:
            refresh_now(bpy.context)
    except Exception:  # Die Prüfung darf Blender nie stören.
        traceback.print_exc()
    return None


def schedule():
    """Plant eine Neuberechnung (entprellt, 0,4 s); doppelte Aufrufe fallen zusammen."""
    if not bpy.app.timers.is_registered(_timer):
        bpy.app.timers.register(_timer, first_interval=0.4, persistent=True)


@persistent
def _on_depsgraph_update(_scene, _depsgraph):
    schedule()


@persistent
def _on_load_post(_unused):
    _cache["report"] = None
    schedule()


# --------------------------------------------------------------------------- Oberfläche


def _wrap(layout, text, context, icon="NONE"):
    """Zeigt langen Text in der Seitenleiste umgebrochen."""
    width = max(20, int(context.region.width / (7.2 * max(context.preferences.view.ui_scale, 0.5))) - 4)
    col = layout.column(align=True)
    for i, line in enumerate(textwrap.wrap(text, width) or [""]):
        col.label(text=line, icon=icon if i == 0 else "BLANK1")


class CYPHER_PT_main(bpy.types.Panel):
    bl_label = "Cypher Export"
    bl_idname = "CYPHER_PT_main"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Cypher"

    def draw(self, context):
        layout = self.layout
        s = context.scene.cypher_export
        col = layout.column(align=True)
        col.prop(s, "scope", text="Umfang")
        col.prop(s, "prefix", text="Präfix")
        col.prop(s, "name", text="Name")
        layout.label(text=f"Datei: {s.full_name}.glb", icon="FILE_3D")

        report = get_report()
        if report is None:
            schedule()
            layout.label(text="Prüfung läuft …", icon="TIME")
            layout.operator("cypher.check", icon="FILE_REFRESH")
            return
        level = report.level
        box = layout.box()
        row = box.row()
        row.alert = level == "error"
        row.label(text=AMPEL_TEXT[level], icon=AMPEL_ICON[level])
        counts = f"{report.count('error')} Fehler · {report.count('warn')} Hinweise · {sum(1 for f in report.findings if f.level in ('ok', 'info'))} erfüllt"
        box.label(text=counts)
        row = box.row(align=True)
        row.prop(s, "live", text="Live", toggle=True)
        row.operator("cypher.check", text="Prüfen", icon="FILE_REFRESH")


class CYPHER_PT_report(bpy.types.Panel):
    bl_label = "Prüfbericht"
    bl_idname = "CYPHER_PT_report"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Cypher"
    bl_parent_id = "CYPHER_PT_main"

    def draw(self, context):
        layout = self.layout
        report = get_report()
        if report is None:
            return
        for f in report.findings:
            icon, word = LEVEL_UI[f.level]
            box = layout.column(align=True)
            split = box.split(factor=0.58, align=True)
            left = split.row()
            left.alert = f.level == "error"
            left.label(text=f.title, icon=icon)
            split.label(text=f.value)
            if f.detail and f.level != "ok":
                _wrap(box, f"{word}: {f.detail}", context)
            if f.fix:
                box.operator(f.fix, icon="MODIFIER")


class CYPHER_PT_export(bpy.types.Panel):
    bl_label = "Exportieren"
    bl_idname = "CYPHER_PT_export"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Cypher"
    bl_parent_id = "CYPHER_PT_main"

    def draw(self, context):
        layout = self.layout
        s = context.scene.cypher_export
        col = layout.column(align=True)
        col.prop(s, "export_dir", text="Ordner")
        col.prop(s, "author", text="Autor")
        col.prop(s, "license_id", text="Lizenz")
        col.prop(s, "source", text="Quelle")
        report = get_report()
        blocked = report is not None and report.has_errors
        row = layout.row()
        row.scale_y = 1.5
        row.enabled = not blocked
        row.operator("cypher.export_glb", text="Als GLB exportieren", icon="EXPORT")
        if blocked:
            _wrap(layout, "Export gesperrt: Behebe zuerst die Fehler im Prüfbericht.", context, icon="LOCKED")
            op = layout.operator("cypher.export_glb", text="Trotzdem exportieren …", icon="ERROR")
            op.force = True


CLASSES = (CYPHER_PT_main, CYPHER_PT_report, CYPHER_PT_export)


def register_handlers():
    if _on_depsgraph_update not in bpy.app.handlers.depsgraph_update_post:
        bpy.app.handlers.depsgraph_update_post.append(_on_depsgraph_update)
    if _on_load_post not in bpy.app.handlers.load_post:
        bpy.app.handlers.load_post.append(_on_load_post)


def unregister_handlers():
    for handlers, fn in ((bpy.app.handlers.depsgraph_update_post, _on_depsgraph_update), (bpy.app.handlers.load_post, _on_load_post)):
        if fn in handlers:
            handlers.remove(fn)
    if bpy.app.timers.is_registered(_timer):
        bpy.app.timers.unregister(_timer)
    _cache["report"] = None
