# -*- coding: utf-8 -*-
"""Entwicklungswerkzeug (nicht Teil des Pakets): Läuft in einer echten Krita-Sitzung unter Xvfb, öffnet ein Dokument (erst dann
zeigt Krita seine Docker), ordnet die Docker nach layout.py an und schreibt QMainWindow.saveState() (Base64) nach CYPHER_WS_OUT.
Danach beendet es Krita. Modus CYPHER_WS_MODE=dump listet nur die Docker."""
import base64
import json
import os
import traceback

from krita import Extension, Krita
from PyQt5.QtCore import QTimer
from PyQt5.QtWidgets import QApplication

OUT = os.environ.get("CYPHER_WS_OUT", "/tmp/cypher-ws.json")


def _log(obj):
    with open(OUT + ".log", "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def _quit():
    QTimer.singleShot(500, lambda: os._exit(0))


class CypherWs(Extension):
    def __init__(self, parent):
        super().__init__(parent)

    def setup(self):
        pass

    def createActions(self, window):
        QTimer.singleShot(int(os.environ.get("CYPHER_WS_DELAY", "8000")), self.open_document)

    def open_document(self):
        try:
            app = Krita.instance()
            window = app.activeWindow()  # das an createActions übergebene Objekt ist zu diesem Zeitpunkt schon ungültig
            doc = app.createDocument(512, 512, "workspace", "RGBA", "U8", "", 72.0)
            window.addView(doc)
            QTimer.singleShot(5000, self.run)
        except Exception:
            _log({"error": traceback.format_exc()})
            _quit()

    def run(self):
        try:
            window = Krita.instance().activeWindow()
            main = window.qwindow()
            dockers = {d.objectName(): d for d in Krita.instance().dockers()}
            _log({"dockers": [{"name": n, "visible": d.isVisible(), "area": int(main.dockWidgetArea(d))} for n, d in dockers.items()]})
            if os.environ.get("CYPHER_WS_MODE") != "dump":
                from .layout import arrange
                arrange(main, dockers, _log)
                QApplication.processEvents()
                _log({"after": [{"name": n, "visible": d.isVisible(), "area": int(main.dockWidgetArea(d))} for n, d in dockers.items() if d.isVisible()]})
            state = bytes(main.saveState())
            with open(OUT, "w", encoding="utf-8") as f:
                json.dump({"state": base64.b64encode(state).decode("ascii")}, f)
        except Exception:
            _log({"error": traceback.format_exc()})
        finally:
            _quit()


def register():
    Krita.instance().addExtension(CypherWs(Krita.instance()))
