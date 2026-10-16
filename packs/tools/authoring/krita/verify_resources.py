# -*- coding: utf-8 -*-
"""Listet Paletten und Arbeitsflächen, die der echte Krita aus seinem Ressourcenordner geladen hat (Bundle oder lose Dateien).
Umgebung: CYPHER_LOG. Ergebnis als JSON-Zeilen; ausgewertet vom Smoke-Test-Protokoll."""
import json
import os
import traceback

from krita import Krita, Palette

LOG = os.environ.get("CYPHER_LOG", "/tmp/cypher-resources.log")


def emit(obj):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def main(*args):
    try:
        if os.path.exists(LOG):
            os.remove(LOG)
        app = Krita.instance()
        palettes = app.resources("palette")
        workspaces = app.resources("workspace")
        emit({"workspaces": sorted(k for k in workspaces.keys() if k.lower().startswith("cypher"))})
        for name in sorted(k for k in palettes.keys() if k.startswith("Cypher")):
            p = Palette(palettes[name])
            entries = []
            for g in p.groupNames():
                for i in range(p.colorsCountGroup(g)):
                    e = p.colorSetEntryFromGroup(i, g)
                    c = e.color().components()  # Komponentenreihenfolge des Farbraums: B, G, R, A
                    entries.append({"group": g, "name": e.name(), "hex": "#%02x%02x%02x" % tuple(round(v * 255) for v in (c[2], c[1], c[0]))})
            emit({"palette": name, "file": palettes[name].filename(), "total": p.colorsCountTotal(), "columns": p.columnCount(), "entries": entries})
        emit({"done": True})
    except Exception:
        emit({"error": traceback.format_exc()})
