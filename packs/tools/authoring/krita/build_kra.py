# -*- coding: utf-8 -*-
"""Erzeugt die Krita-Vorlagen (.kra) mit dem echten Krita (kritarunner, Python-API).

Aufruf siehe packs/tools/authoring/run-krita.sh. Umgebungsvariablen:
  CYPHER_PACKS  Ordner packs/ (Eingabe: shared/formats.json, shared/fonts)
  CYPHER_OUT    Zielordner (packs/krita/templates/Cypher)
  CYPHER_LOG    Logdatei (stdout von kritarunner geht verloren)

Ergebnis je Vorlage: .source/<datei>.kra, <datei>.desktop, .icon/<datei>.png; dazu .directory.
Druckvorlagen: Leinwand = Druckfläche in Pixeln bei 300 dpi, transparente Ebene "Motiv", Hilfslinien für Mitte,
ideale Breite und sichere Fläche. Social-Vorlagen: Ebene "Motiv" plus gesperrte Ebene "Sicherheitszonen".
"""
import json
import os
import traceback
import zipfile

from krita import Krita
from PyQt5.QtCore import QRectF, Qt
from PyQt5.QtGui import QColor, QFont, QFontDatabase, QImage, QPainter, QPen

PACKS = os.environ["CYPHER_PACKS"]
OUT = os.environ["CYPHER_OUT"]
LOG = os.environ.get("CYPHER_LOG", "/tmp/cypher-kra.log")

GUIDE_COLOR = "#00676b"  # Tiefcyan (DESIGN.md): auf hellem Schachbrett und auf Weiß lesbar
ACCENT = QColor("#00d4d8")
INK = QColor("#0d0d0d")
PAPER = QColor("#efeee9")
MM = 300.0 / 25.4


def log(*parts):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(" ".join(str(p) for p in parts) + "\n")


def safe_title(text):
    """Titel ohne Zeichen, die im ZIP-Pfad der Ebenendaten Probleme machen (Schrägstrich, Doppelpunkt, Malzeichen)."""
    return text.replace(" / ", " und ").replace("/", "-").replace(":", "x").replace("×", "x").replace("(", "").replace(")", "")


def px(mm):
    return mm * MM


def xml_escape(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def document_info(title, abstract, keywords):
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<!DOCTYPE document-info PUBLIC '-//KDE//DTD document-info 1.1//EN' 'http://www.calligra.org/DTD/document-info-1.1.dtd'>\n"
        '<document-info xmlns="http://www.calligra.org/DTD/document-info">\n'
        " <about>\n"
        f"  <title>{xml_escape(title)}</title>\n"
        "  <description></description>\n"
        "  <subject></subject>\n"
        f"  <abstract><![CDATA[{abstract}]]></abstract>\n"
        f"  <keyword>{xml_escape(keywords)}</keyword>\n"
        "  <initial-creator>Cypher Kollektiv</initial-creator>\n"
        "  <editing-cycles>0</editing-cycles>\n"
        "  <editing-time></editing-time>\n"
        "  <date>2026-10-16T00:00:00</date>\n"
        "  <creation-date>2026-10-16T00:00:00</creation-date>\n"
        "  <language>de</language>\n"
        "  <license>MIT</license>\n"
        " </about>\n"
        " <author>\n"
        "  <full-name>Cypher Kollektiv</full-name>\n"
        "  <creator-first-name></creator-first-name>\n"
        "  <creator-last-name></creator-last-name>\n"
        "  <initial></initial>\n"
        "  <author-title></author-title>\n"
        "  <position></position>\n"
        "  <company>Cypher Kollektiv</company>\n"
        " </author>\n"
        "</document-info>\n"
    )


def new_document(app, name, width, height, dpi, title, abstract, keywords):
    """Neues RGBA-8-Bit-Dokument (sRGB) mit transparenter Ebene "Motiv"; die weiße Standardebene entfällt."""
    doc = app.createDocument(width, height, name, "RGBA", "U8", "", float(dpi))
    root = doc.rootNode()
    old = root.childNodes()[0]
    motiv = doc.createNode("Motiv", "paintlayer")
    root.addChildNode(motiv, None)
    old.remove()
    doc.setBackgroundColor(QColor(0, 0, 0, 0))
    doc.setDocumentInfo(document_info(title, abstract, keywords))
    doc.setActiveNode(motiv)
    return doc


def apply_guides(doc, vertical, horizontal):
    doc.setVerticalGuides([float(v) for v in vertical])
    doc.setHorizontalGuides([float(v) for v in horizontal])
    doc.setGuidesVisible(True)
    doc.setGuidesLocked(False)
    cfg = doc.guidesConfig()
    cfg.setColor(QColor(GUIDE_COLOR))
    cfg.setLineType("dashed")
    cfg.setSnap(True)
    doc.setGuidesConfig(cfg)


def safe_overlay(width, height, safe_rects, label, font_family):
    """Halbtransparente Schattierung außerhalb der sicheren Rechtecke, Rand in Cyan; als BGRA-Bytes für Krita."""
    img = QImage(width, height, QImage.Format_ARGB32)
    img.fill(QColor(0, 0, 0, 0))
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing, False)
    p.fillRect(0, 0, width, height, QColor(13, 13, 13, 112))
    p.setCompositionMode(QPainter.CompositionMode_Clear)
    for r in safe_rects:
        p.fillRect(QRectF(r["x"], r["y"], r["width"], r["height"]), QColor(0, 0, 0, 0))
    p.setCompositionMode(QPainter.CompositionMode_SourceOver)
    pen = QPen(ACCENT)
    pen.setWidth(4)
    pen.setStyle(Qt.DashLine)
    p.setPen(pen)
    for r in safe_rects:
        p.drawRect(QRectF(r["x"] + 2, r["y"] + 2, r["width"] - 4, r["height"] - 4))
    font = QFont(font_family)
    font.setPixelSize(20)
    p.setFont(font)
    p.setPen(PAPER)
    p.drawText(QRectF(24, 18, width - 48, 40), Qt.AlignLeft | Qt.AlignVCenter, label)
    p.end()
    ptr = img.constBits()
    ptr.setsize(img.byteCount())
    return bytes(ptr)


def add_overlay_layer(doc, width, height, safe_rects, font_family):
    layer = doc.createNode("Sicherheitszonen (vor dem Export ausblenden)", "paintlayer")
    doc.rootNode().addChildNode(layer, None)  # oberste Ebene
    data = safe_overlay(width, height, safe_rects, "SICHERHEITSZONE · Ebene vor dem Export ausblenden", font_family)
    layer.setPixelData(data, 0, 0, width, height)
    layer.setColorLabel(4)  # orange
    layer.setLocked(True)
    doc.setActiveNode(doc.rootNode().childNodes()[0])  # "Motiv" bleibt die aktive Ebene


def save(doc, path):
    for stale in (path, path + "~"):  # Krita legt beim Überschreiben eine Sicherung "~" an; beides weg, damit die Ausgabe sauber bleibt
        if os.path.exists(stale):
            os.remove(stale)
    doc.setBatchmode(True)
    doc.refreshProjection()
    doc.waitForDone()
    ok = doc.saveAs(path)
    log("gespeichert" if ok else "FEHLER beim Speichern", path)
    if not ok:
        raise RuntimeError("saveAs fehlgeschlagen: " + path)
    doc.close()


def desktop_entry(file_stem, name, comment, keywords):
    return (
        "[Desktop Entry]\n"
        "Type=Link\n"
        f"URL=.source/{file_stem}.kra\n"
        f"Icon=.icon/{file_stem}.png\n"
        f"Name={name}\n"
        f"Comment={comment}\n"
        f"Keywords={keywords}\n"
        "X-Krita-Version=28\n"
    )


TEMPLATES = []  # (stem, name, comment, keywords)


def build_print(app, fmt):
    stem = "cypher-" + fmt["id"]
    w, h = fmt["widthPx"], fmt["heightPx"]
    name = f"{fmt['label']} ({fmt['widthMm']} × {fmt['heightMm']} mm)"
    comment = (
        f"Leinwand {fmt['widthMm']} × {fmt['heightMm']} mm = {w} × {h} px bei 300 dpi, transparent. "
        "Hilfslinien: Mitte, ideale Breite 300 mm und Richtwerte der sicheren Fläche."
    )
    doc = new_document(app, stem, w, h, 300, safe_title(f"Cypher {name}"), comment, "Cypher, Shirtigo, Druck, " + fmt["label"])
    vertical = [px(g["at"]) for g in fmt["guidesMm"]["vertical"]]
    horizontal = [px(g["at"]) for g in fmt["guidesMm"]["horizontal"]]
    apply_guides(doc, vertical, horizontal)
    save(doc, os.path.join(OUT, ".source", stem + ".kra"))
    TEMPLATES.append((stem, name, comment, "shirtigo;druck;" + fmt["garment"]))


def build_flat(app, fmt, kind):
    """Poster und Sticker: Maße in mm, 300 dpi, Hilfslinien für Anschnitt bzw. Mitte."""
    stem = "cypher-" + fmt["id"]
    w, h = fmt["widthPx"], fmt["heightPx"]
    name = f"{fmt['label']} ({fmt['widthMm']} × {fmt['heightMm']} mm)"
    comment = f"Leinwand {fmt['widthMm']} × {fmt['heightMm']} mm = {w} × {h} px bei 300 dpi, transparent."
    vertical = [px(fmt["widthMm"] / 2)]
    horizontal = []
    if kind == "poster":
        bleed, inset = fmt["bleedMm"], fmt["safeInsetMm"]
        vertical = [px(bleed), px(bleed + inset), px(fmt["widthMm"] / 2), px(fmt["widthMm"] - bleed - inset), px(fmt["widthMm"] - bleed)]
        horizontal = [px(bleed), px(bleed + inset), px(fmt["heightMm"] - bleed - inset), px(fmt["heightMm"] - bleed)]
        comment += f" Endformat {fmt['trimMm']['width']} × {fmt['trimMm']['height']} mm plus {bleed} mm Anschnitt; Hilfslinien: Endformat und {inset} mm Sicherheitsabstand."
    doc = new_document(app, stem, w, h, 300, safe_title(f"Cypher {name}"), comment, "Cypher, " + fmt["label"])
    apply_guides(doc, vertical, horizontal)
    save(doc, os.path.join(OUT, ".source", stem + ".kra"))
    TEMPLATES.append((stem, name, comment, kind))


def build_social(app, fmt, font_family):
    stem = "cypher-" + fmt["id"]
    w, h = fmt["widthPx"], fmt["heightPx"]
    name = f"{fmt['label']} ({w} × {h} px)"
    comment = f"Leinwand {w} × {h} px mit Hilfslinien und gesperrter Ebene für die Sicherheitszonen (vor dem Export ausblenden)."
    doc = new_document(app, stem, w, h, 72, safe_title(f"Cypher {name}"), comment, "Cypher, Social, Instagram, TikTok, " + fmt["label"])
    apply_guides(doc, [g["at"] for g in fmt["guidesPx"]["vertical"]], [g["at"] for g in fmt["guidesPx"]["horizontal"]])
    add_overlay_layer(doc, w, h, fmt["safeZones"], font_family)
    save(doc, os.path.join(OUT, ".source", stem + ".kra"))
    TEMPLATES.append((stem, name, comment, "social"))


def write_text(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def main(*args):
    try:
        if os.path.exists(LOG):
            os.remove(LOG)
        os.makedirs(os.path.join(OUT, ".source"), exist_ok=True)
        os.makedirs(os.path.join(OUT, ".icon"), exist_ok=True)
        font_id = QFontDatabase.addApplicationFont(os.path.join(PACKS, "shared", "fonts", "martian-mono", "static", "MartianMono-Medium.ttf"))
        families = QFontDatabase.applicationFontFamilies(font_id) if font_id >= 0 else []
        font_family = families[0] if families else "monospace"
        log("Schrift für Beschriftung:", font_family)
        formats = json.load(open(os.path.join(PACKS, "shared", "formats.json"), encoding="utf-8"))
        app = Krita.instance()
        log("Krita", app.version())
        for fmt in formats["print"]:
            build_print(app, fmt)
        build_flat(app, formats["poster"], "poster")
        build_flat(app, formats["sticker"], "sticker")
        for fmt in formats["social"]:
            build_social(app, fmt, font_family)
        # Vorlagen-Einträge und Gruppe
        for stem, name, comment, keywords in TEMPLATES:
            write_text(os.path.join(OUT, stem + ".desktop"), desktop_entry(stem, name, comment, keywords))
            with zipfile.ZipFile(os.path.join(OUT, ".source", stem + ".kra")) as z:
                with open(os.path.join(OUT, ".icon", stem + ".png"), "wb") as f:
                    f.write(z.read("preview.png"))
        write_text(os.path.join(OUT, ".directory"), "[Desktop Entry]\nName=Cypher\nComment=Vorlagen des Cypher Kollektivs: Druckflächen für Shirtigo und Social-Formate\n")
        log("FERTIG", len(TEMPLATES), "Vorlagen")
    except Exception:
        log("FEHLER", traceback.format_exc())
