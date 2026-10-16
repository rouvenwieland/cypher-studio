# -*- coding: utf-8 -*-
"""Erzeugt aufrechte statische Schnitte von Anybody aus der unveränderten variablen Upstream-Schrift (fontTools-Instancer).

Warum: Die statischen Dateien im Upstream-Repo (Etcetera-Type-Co/Anybody, fonts/ttf/Anybody-*.ttf) sind fehlerhaft: Die Glyphendaten von
Anybody-Regular.ttf und Anybody-Italic.ttf sind bytegleich (post.italicAngle = -10 in allen "aufrechten" Schnitten), d. h. die statischen
"Roman"-Dateien sind in Wahrheit die Kursiven. Die variable Datei ist korrekt (italicAngle 0). Siehe packs/shared/fonts/QUELLEN.md.

Erlaubt: Die OFL-1.1-Urheberzeile von Anybody nennt keinen "Reserved Font Name"; Änderungen mit gleichem Familiennamen sind damit zulässig, die
Lizenz (OFL.txt) bleibt erhalten. Namen, Urheberrechts- und Lizenzeinträge werden aus der Quelldatei übernommen; nur die Namenseinträge 1, 2, 4, 6,
16 und 17 folgen der Benennung der Upstream-Statics (z. B. "Anybody ExtraBold" / typografische Familie "Anybody").

Aufruf (WSL, venv mit fontTools>=4.50): python instance_anybody.py <Quelle: Anybody-Variable.ttf> <Zielordner static/>
"""
import os
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# (Dateiname, wght, wdth, nameID1, nameID2, nameID16, nameID17, nameID4, nameID6)
SPECS = [
    ("Anybody-Regular", 400, 100, "Anybody", "Regular", None, None, "Anybody Regular", "Anybody-Regular"),
    ("Anybody-Medium", 500, 100, "Anybody Medium", "Regular", "Anybody", "Medium", "Anybody Medium", "Anybody-Medium"),
    ("Anybody-SemiBold", 600, 100, "Anybody SemiBold", "Regular", "Anybody", "SemiBold", "Anybody SemiBold", "Anybody-SemiBold"),
    ("Anybody-Bold", 700, 100, "Anybody", "Bold", None, None, "Anybody Bold", "Anybody-Bold"),
    ("Anybody-ExtraBold", 800, 100, "Anybody ExtraBold", "Regular", "Anybody", "ExtraBold", "Anybody ExtraBold", "Anybody-ExtraBold"),
    ("Anybody-Black", 900, 100, "Anybody Black", "Regular", "Anybody", "Black", "Anybody Black", "Anybody-Black"),
    ("AnybodyUltraCondensed-ExtraBold", 800, 50, "Anybody UltraCondensed ExtraBold", "Regular", "Anybody UltraCondensed", "ExtraBold", "Anybody UltraCondensed ExtraBold", "AnybodyUltraCondensed-ExtraBold"),
    ("AnybodyUltraCondensed-Black", 900, 50, "Anybody UltraCondensed Black", "Regular", "Anybody UltraCondensed", "Black", "Anybody UltraCondensed Black", "AnybodyUltraCondensed-Black"),
    ("AnybodyExtraExpanded-ExtraBold", 800, 150, "Anybody ExtraExpanded ExtraBold", "Regular", "Anybody ExtraExpanded", "ExtraBold", "Anybody ExtraExpanded ExtraBold", "AnybodyExtraExpanded-ExtraBold"),
    ("AnybodyExtraExpanded-Black", 900, 150, "Anybody ExtraExpanded Black", "Regular", "Anybody ExtraExpanded", "Black", "Anybody ExtraExpanded Black", "AnybodyExtraExpanded-Black"),
]
WIDTH_CLASS = {50: 1, 100: 5, 150: 8}  # UltraCondensed, Medium (normal), ExtraExpanded


def set_name(font, name_id, value):
    name = font["name"]
    name.removeNames(nameID=name_id)
    if value is not None:
        name.setName(value, name_id, 3, 1, 0x409)  # Windows, Unicode BMP, Englisch (USA)
        name.setName(value, name_id, 1, 0, 0)  # Macintosh, Roman, Englisch


def main(source, target_dir):
    os.makedirs(target_dir, exist_ok=True)
    for stem, wght, wdth, id1, id2, id16, id17, id4, id6 in SPECS:
        vf = TTFont(source, recalcTimestamp=False)
        font = instancer.instantiateVariableFont(vf, {"wght": wght, "wdth": wdth}, inplace=False)
        font.recalcTimestamp = False
        for name_id, value in ((1, id1), (2, id2), (16, id16), (17, id17), (4, id4), (6, id6)):
            set_name(font, name_id, value)
        set_name(font, 3, "Cypher;%s;instanced" % id6)  # eindeutige Kennung
        os2 = font["OS/2"]
        os2.usWeightClass = wght
        os2.usWidthClass = WIDTH_CLASS[wdth]
        bold = id2 == "Bold"
        os2.fsSelection = (os2.fsSelection & ~(1 << 0) & ~(1 << 5) & ~(1 << 6)) | ((1 << 5) if bold else (1 << 6))
        font["head"].macStyle = 1 if bold else 0
        font["post"].italicAngle = 0
        for table in ("STAT", "avar", "fvar", "gvar", "HVAR", "MVAR"):
            if table in font:
                del font[table]
        out = os.path.join(target_dir, stem + ".ttf")
        font.save(out)
        print("geschrieben", out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
