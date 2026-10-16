# SPDX-License-Identifier: GPL-3.0-or-later
"""Prüft das installierte App-Template in einer echten Blender-Sitzung.

    blender -b --app-template cypher_ps2 --python-exit-code 1 -P tests/check_template.py

Voraussetzung: `run_matrix.sh` hat Template und startup.blend in ein leeres
BLENDER_USER_RESOURCES gelegt (so wie die Einrichtung es später tut).
"""

import sys

import bpy

problems = []


def need(cond, text):
    if not cond:
        problems.append(text)


active = bpy.context.preferences.app_template
need(active == "cypher_ps2", f"Template nicht aktiv: {active!r}")
need({"Export", "Referenz", "Beispiele"} <= set(bpy.data.collections.keys()), "Sammlungen fehlen")
need("prop-kiste" in bpy.data.objects, "Startobjekt prop-kiste fehlt")
need(bpy.context.scene.camera is not None and bpy.context.scene.camera.name == "Shop-Kamera", "Shop-Kamera fehlt")
need((bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y) == (640, 448), "Auflösung nicht 640 x 448")
need(bpy.context.scene.unit_settings.system == "METRIC", "Einheiten nicht metrisch")
need("Cypher Kollektionen" in bpy.data.palettes, "Palette fehlt")
need(set(w.name for w in bpy.data.workspaces) == {"Aufbauen", "Modellieren", "UV", "Texturen malen", "Material", "Vertexfarben"}, f"Arbeitsbereiche: {[w.name for w in bpy.data.workspaces]}")
need("Cypher-Anleitung" in bpy.data.texts, "Anleitung fehlt")
try:
    import bl_app_templates_user.cypher_ps2 as tmpl

    need(tmpl._on_factory_startup in bpy.app.handlers.load_factory_startup_post, "Handler nicht registriert")
except ImportError as exc:
    problems.append(f"Template-Modul nicht importierbar: {exc}")

if problems:
    print("TEMPLATE-FEHLER:\n  " + "\n  ".join(problems))
    sys.exit(1)
print(f"Template cypher_ps2 geladen: {len(bpy.data.objects)} Objekte, Arbeitsbereiche {[w.name for w in bpy.data.workspaces]}")
