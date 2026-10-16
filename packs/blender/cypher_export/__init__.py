# SPDX-License-Identifier: GPL-3.0-or-later
"""Cypher Export: Modelle für den Cypher-Shop prüfen und als GLB exportieren.

Blender-Extension (ab 4.2). Prüft gegen `budgets.json` (Dreiecke je Präfix, Szene,
Draw-Calls, Texturen, Materialien, Transformationen, Ursprung, Benennung) und schreibt
`<name>.glb` mit externen `<name>-basis.webp` plus `<name>.lizenz.json`
(research/3d-konventionen.md). Keine Netzwerkzugriffe.
"""

import json
from pathlib import Path

import bpy

from . import checks, glb_post, operators, panel, settings

ASSET_LIBRARY_NAME = "Cypher 3D"
CONFIG_NAME = "cypher_studio.json"

_classes = (settings.CypherExportSettings, *operators.CLASSES, *panel.CLASSES)


def _library_path():
    """Liest den Bibliothekspfad, den die Einrichtung in cypher_studio.json hinterlegt hat."""
    try:
        cfg = Path(bpy.utils.extension_path_user(__package__, create=True)) / CONFIG_NAME
        if not cfg.is_file():
            return None
        raw = json.loads(cfg.read_text(encoding="utf-8")).get("assetLibraryPath")
        return Path(raw) if raw else None
    except (OSError, ValueError, RuntimeError, AttributeError):
        return None


def _add_asset_library():
    """Legt die Asset-Bibliothek „Cypher 3D“ an, falls Pfad bekannt, Ordner da und noch nicht eingetragen."""
    path = _library_path()
    if path is None or not path.is_dir():
        return
    libs = bpy.context.preferences.filepaths.asset_libraries
    if any(lib.name == ASSET_LIBRARY_NAME or Path(lib.path) == path for lib in libs):
        return
    libs.new(name=ASSET_LIBRARY_NAME, directory=str(path))


def _remove_asset_library():
    """Entfernt nur den eigenen Eintrag (Name und Pfad aus der Einrichtung)."""
    path = _library_path()
    libs = bpy.context.preferences.filepaths.asset_libraries
    for lib in list(libs):
        if lib.name == ASSET_LIBRARY_NAME and (path is None or Path(lib.path) == path):
            libs.remove(lib)


def register():
    for cls in _classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.cypher_export = bpy.props.PointerProperty(type=settings.CypherExportSettings)
    panel.register_handlers()
    try:
        _add_asset_library()
    except Exception as exc:  # Die Bibliothek ist Komfort und darf das Aktivieren nie verhindern.
        print(f"Cypher Export: Asset-Bibliothek nicht angelegt: {exc}")


def unregister():
    try:
        _remove_asset_library()
    except Exception as exc:
        print(f"Cypher Export: Asset-Bibliothek nicht entfernt: {exc}")
    panel.unregister_handlers()
    del bpy.types.Scene.cypher_export
    for cls in reversed(_classes):
        bpy.utils.unregister_class(cls)


__all__ = ["register", "unregister", "checks", "glb_post"]
