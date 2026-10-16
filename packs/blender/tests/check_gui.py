# SPDX-License-Identifier: GPL-3.0-or-later
"""Zeichentest der Seitenleiste „Cypher“ in einer echten Blender-Oberfläche (braucht ein Display, z. B. WSLg).

    blender --app-template cypher_ps2 --python tests/check_gui.py

Öffnet die Seitenleiste, schaltet auf den Reiter „Cypher“ und zeichnet das Panel in mehreren Zuständen
(grün, Fehler wegen Namen, zu große Textur mit Korrektur-Knopf). Python-Fehler beim Zeichnen landen in der
Konsole als „Python script error in CYPHER_PT_…“; `run_matrix.sh` sucht danach. Setzt voraus, dass die
Extension installiert ist (`extension install-file -r user_default`).
"""

import sys
import traceback

import addon_utils
import bpy

PKG = "bl_ext.user_default.cypher_export"
step = {"n": 0}


def areas_3d():
    return [a for w in bpy.context.window_manager.windows for a in w.screen.areas if a.type == "VIEW_3D"]


def show_panel():
    for area in areas_3d():
        area.spaces.active.show_region_ui = True
        for region in area.regions:
            if region.type == "UI":
                region.active_panel_category = "Cypher"
        area.tag_redraw()


def tick():
    try:
        step["n"] += 1
        n = step["n"]
        scene = bpy.context.scene
        if n == 1:
            addon_utils.enable(PKG, default_set=False, persistent=False)
            return 1.5  # die Reiter der Seitenleiste entstehen erst nach dem Neuzeichnen
        if n == 2:
            show_panel()
            print("GUI-CHECK Zustand 1: grün,", scene.cypher_export.full_name)
            return 1.5
        if n == 3:
            scene.cypher_export.name = "Falscher_Name"  # Benennungsfehler: rote Zeile, Export gesperrt, „Trotzdem“-Knopf
            show_panel()
            print("GUI-CHECK Zustand 2: Namensfehler")
            return 1.5
        if n == 4:
            scene.cypher_export.name = "kiste"
            img = bpy.data.images.new("gross", 1024, 1024)
            mat = bpy.data.objects["prop-kiste"].data.materials[0]
            for node in mat.node_tree.nodes:
                if node.type == "TEX_IMAGE":
                    node.image = img
            show_panel()
            print("GUI-CHECK Zustand 3: Textur zu groß")
            return 1.5
        if n == 5:
            print("GUI-CHECK fertig")
            bpy.ops.wm.quit_blender()
    except Exception:
        traceback.print_exc()
        print("GUI-CHECK Ausnahme")
        bpy.ops.wm.quit_blender()
    return None


bpy.app.timers.register(tick, first_interval=2.0)
sys.stdout.flush()
