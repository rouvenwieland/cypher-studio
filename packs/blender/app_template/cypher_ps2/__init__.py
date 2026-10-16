# SPDX-License-Identifier: GPL-3.0-or-later
"""App-Template „Cypher PS2“: Startszene für Modelle im PS2-Retro-Stil des Cypher-Shops.

Erscheint unter Datei → Neu → „Cypher PS2“ (Start per `--app-template cypher_ps2`).
Das Template ändert die persönliche Startdatei und die Einstellungen des Nutzers nicht.
Die Szene selbst (`startup.blend`) erzeugt `build_startup.py` reproduzierbar.

Dieses Modul setzt nur Ansichts- und Einrasteinstellungen, die zur Szene gehören;
es greift weder auf das Netzwerk noch auf Dateien außerhalb von Blender zu.
"""

import bpy
from bpy.app.handlers import persistent

TEMPLATE_ID = "cypher_ps2"


def apply_view_defaults(context=None):
    """Setzt Ansichts- und Einrasteinstellungen (idempotent, gilt für alle 3D-Ansichten der Datei)."""
    scene = (context.scene if context is not None else None) or (bpy.data.scenes[0] if bpy.data.scenes else None)
    if scene is None:
        return
    # Meter, Maßstab 1; Einrasten an der Gitterteilung (0,1 m), Strg schaltet um
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"
    ts = scene.tool_settings
    ts.use_snap = True
    ts.snap_elements = {"INCREMENT"}
    ts.use_snap_grid_absolute = True
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue
            for space in area.spaces:
                if space.type != "VIEW_3D":
                    continue
                space.clip_start = 0.01
                space.clip_end = 200.0
                space.overlay.grid_scale = 1.0
                space.overlay.grid_subdivisions = 10
                space.overlay.show_floor = True


@persistent
def _on_factory_startup(_unused):
    apply_view_defaults()


def register():
    if _on_factory_startup not in bpy.app.handlers.load_factory_startup_post:
        bpy.app.handlers.load_factory_startup_post.append(_on_factory_startup)


def unregister():
    if _on_factory_startup in bpy.app.handlers.load_factory_startup_post:
        bpy.app.handlers.load_factory_startup_post.remove(_on_factory_startup)
