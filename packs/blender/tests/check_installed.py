# SPDX-License-Identifier: GPL-3.0-or-later
"""Prüft die als ZIP installierte Extension „Cypher Export“ (Smoke-Test 9.4 Nr. 6 in programme.md).

    blender -b --python-exit-code 1 -P tests/check_installed.py -- <Bibliotheksordner>

Voraussetzung: `run_matrix.sh` hat die ZIP mit `extension install-file -r user_default -e` in ein leeres
BLENDER_USER_RESOURCES installiert. Das Skript schreibt wie die Einrichtung `cypher_studio.json` mit
`assetLibraryPath`, aktiviert die Extension neu und prüft Operatoren, Einstellungen und Asset-Bibliothek.
"""

import importlib
import importlib.util
import json
import sys
from pathlib import Path

import addon_utils
import bpy

PKG = "bl_ext.user_default.cypher_export"
problems = []
lib_dir = Path(sys.argv[sys.argv.index("--") + 1])

if importlib.util.find_spec(PKG) is None:
    problems.append("Extension ist nicht installiert (Modul bl_ext.user_default.cypher_export fehlt)")
else:
    addon_utils.disable(PKG, default_set=False)  # install-file -e hat sie ggf. schon aktiviert
    cfg_dir = Path(bpy.utils.extension_path_user(PKG, create=True))
    (cfg_dir / "cypher_studio.json").write_text(json.dumps({"assetLibraryPath": str(lib_dir)}), encoding="utf-8")
    addon_utils.enable(PKG, default_set=False, persistent=False)
    state = addon_utils.check(PKG)
    if not state[1]:
        problems.append("Extension lässt sich nicht aktivieren")
    else:
        if not hasattr(bpy.types.Scene, "cypher_export"):
            problems.append("scene.cypher_export fehlt")
        if not hasattr(bpy.ops, "cypher") or not hasattr(bpy.ops.cypher, "export_glb"):
            problems.append("Operator cypher.export_glb fehlt")
        libs = lambda: [x for x in bpy.context.preferences.filepaths.asset_libraries if x.name == "Cypher 3D"]  # noqa: E731
        if len(libs()) != 1:
            problems.append(f"Asset-Bibliothek „Cypher 3D“ fehlt oder doppelt ({len(libs())})")
        elif Path(libs()[0].path) != lib_dir:
            problems.append(f"Asset-Bibliothek zeigt auf {libs()[0].path}")
        addon_utils.disable(PKG, default_set=False)
        if libs():
            problems.append("Asset-Bibliothek blieb nach dem Deaktivieren stehen")

if problems:
    print("EXTENSION-FEHLER:\n  " + "\n  ".join(problems))
    sys.exit(1)
print(f"Extension {PKG} installiert, aktiviert und geprüft (Blender {bpy.app.version_string})")
