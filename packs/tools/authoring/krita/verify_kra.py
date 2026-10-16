# -*- coding: utf-8 -*-
"""Öffnet alle Krita-Vorlagen mit dem echten Krita und schreibt die gemessenen Eigenschaften als JSON-Zeilen ins Log.

Umgebung: CYPHER_DIR (Ordner mit .kra, rekursiv), CYPHER_LOG (Logdatei). Wird von den Tests ausgewertet
(packs/tools/tests/krita-live.test.mjs, nur mit CYPHER_LIVE=1) und gehört zum Smoke-Test-Protokoll.
"""
import json
import os
import traceback

from krita import Krita

DIR = os.environ["CYPHER_DIR"]
LOG = os.environ.get("CYPHER_LOG", "/tmp/cypher-verify.log")


def emit(obj):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def is_empty(node, w, h):
    data = bytes(node.pixelData(0, 0, w, h))
    # RGBA 8 Bit: leer, wenn alle Alpha-Bytes 0 sind
    return data[3::4].count(0) == w * h


def main(*args):
    try:
        if os.path.exists(LOG):
            os.remove(LOG)
        app = Krita.instance()
        emit({"krita": app.version()})
        for root, _dirs, files in os.walk(DIR):
            for name in sorted(files):
                if not name.endswith(".kra"):
                    continue
                path = os.path.join(root, name)
                doc = app.openDocument(path)
                w, h = doc.width(), doc.height()
                layers = []
                for node in doc.rootNode().childNodes():
                    layers.append({
                        "name": node.name(),
                        "type": node.type(),
                        "locked": node.locked(),
                        "visible": node.visible(),
                        "opacity": node.opacity(),
                        "empty": is_empty(node, w, h),
                    })
                emit({
                    "file": name,
                    "width": w,
                    "height": h,
                    "xRes": doc.xRes(),
                    "yRes": doc.yRes(),
                    "colorModel": doc.colorModel(),
                    "colorDepth": doc.colorDepth(),
                    "profile": doc.colorProfile(),
                    "layers": layers,
                    "verticalGuides": [round(g, 2) for g in doc.verticalGuides()],
                    "horizontalGuides": [round(g, 2) for g in doc.horizontalGuides()],
                    "guidesVisible": doc.guidesVisible(),
                })
                doc.close()
        emit({"done": True})
    except Exception:
        emit({"error": traceback.format_exc()})
