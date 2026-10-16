# Cypher Studio: Vorgaben-Recherche (Shirtigo, Social, Hintergrundentfernung, Mockups, PNG-Prüfung)

Stand: 16.10.2026. Alle Quellen wurden am **2026-10-16** abgerufen (Abrufdatum gilt für jede URL in diesem Dokument, sofern nichts anderes dasteht).
Kennzeichnung: **[B]** belegt durch Quelle, **[A]** abgeleitet oder berechnet, **[U]** unbelegt (dann mit sicherem Standardwert und Begründung).
Es wurde nichts installiert und nichts außer kleinen Textdateien (Doku-Seiten, JSON, eine 90-KB-PDF mit Nutzungsbedingungen) geladen. Keine Anmeldung, keine Konten.

---

## 0. Kurzfassung: feste Zahlen für die App (JSON)

```json
{
  "meta": {
    "retrieved": "2026-10-16",
    "provider": "shirtigo",
    "basis": "Shirtigo Helpcenter + Cockpit-Produktdaten + API-Spezifikation (siehe Abschnitt 8)"
  },
  "dpi": {
    "min": 150,
    "recommended": 300,
    "pxPerMmAt300": 11.811,
    "writePhysChunkDpi": 300,
    "physChunkIsAuthoritative": false
  },
  "file": {
    "formats": ["png", "jpeg"],
    "preferredFormat": "png",
    "exportBitDepth": 8,
    "interlaced": false,
    "animated": false,
    "maxFileSizeMB": 64,
    "minPx": { "designerBothSides": 1000, "apiEitherSide": 1000 },
    "maxPxPerSide": 10500,
    "pxMeasuredAfterTransparentCrop": true,
    "idealDesignWidthMm": 300
  },
  "colorSpace": {
    "mode": "RGB",
    "cmyk": "reject",
    "recommendedProfile": "Adobe RGB (1998)",
    "acceptedProfiles": ["Adobe RGB (1998)", "sRGB IEC61966-2.1"],
    "untaggedPng": "warn",
    "embedProfileOnExport": true,
    "unverified": "Wie Shirtigo eingebettete Profile auswertet, ist nicht dokumentiert; Testdruck empfohlen"
  },
  "transparencyRules": {
    "backgroundMustBeTransparent": true,
    "noAlphaChannelMeansFullRectanglePrinted": true,
    "shirtigoAutoCropsTransparentMargins": true,
    "semiTransparentAlpha8bit": [13, 252],
    "ghostPixelAlphaMax": 12,
    "antiAliasEdgeRadiusPx300": 2,
    "areaSemiTransparentShareOfVisible": { "warn": 0.001, "error": 0.01 },
    "lightTextileSeverity": "info",
    "dtfSeverity": "error",
    "pureBlackHex": "#000000",
    "minTonalStepPercent": 10,
    "note": "Bereich 5..99 % Alpha nennt Shirtigo; die Prozentschwellen der App sind eigene Festlegungen (Shirtigo nennt keine Toleranz)"
  },
  "strokes": {
    "minLineMm": 0.8,
    "minLinePx300": 10,
    "absoluteMinLineMm": 0.4,
    "absoluteMinLinePx300": 5,
    "minFontPt": 5,
    "capEmbroideryMinLineMm": 1.5
  },
  "printAreas": {
    "tee": {
      "shirtigoProduct": "Organic Shirt, Stanley/Stella Creator 2.0, STTU169 (slug organic-shirt)",
      "smallSizeSafeMm": [280, 360],
      "recommendedWidthMm": { "chestEmblem": [80, 110], "chestCentered": [280, 300], "backShoulder": [300, 300] },
      "maxWidthMm": { "chestEmblem": 150 },
      "positions": {
        "front":        { "mm": [330, 450], "px300": [3898, 5315], "methods": ["dtg", "dtf"], "topMarginMm": 26 },
        "back":         { "mm": [330, 450], "px300": [3898, 5315], "methods": ["dtg", "dtf"], "topMarginMm": 74 },
        "sleeve-left":  { "mm": [100, 100], "px300": [1181, 1181], "methods": ["dtf"] },
        "sleeve-right": { "mm": [100, 100], "px300": [1181, 1181], "methods": ["dtf"] },
        "back-inside":  { "mm": [70, 50],   "px300": [827, 591],   "methods": ["dtf"] }
      }
    },
    "hoodie": {
      "shirtigoProduct": "Organic Hoodie, Stanley/Stella Cruiser 2.0, STSU177 (slug organic-hoodie)",
      "positions": {
        "front":        { "mm": [330, 280], "px300": [3898, 3307], "methods": ["dtg", "dtf"], "topMarginMm": 40 },
        "back":         { "mm": [330, 390], "px300": [3898, 4606], "methods": ["dtg", "dtf"], "topMarginMm": 1 },
        "sleeve-left":  { "mm": [100, 400], "px300": [1181, 4724], "methods": ["dtf"] },
        "sleeve-right": { "mm": [100, 400], "px300": [1181, 4724], "methods": ["dtf"] },
        "back-inside":  { "mm": [70, 50],   "px300": [827, 591],   "methods": ["dtf"] }
      }
    }
  },
  "social": {
    "instagram": {
      "post45": { "px": [1080, 1350], "ratio": "4:5", "gridCropKeepX": [34, 1046] },
      "post34": { "px": [1080, 1440], "ratio": "3:4", "note": "obere Grenze laut Instagram-Hilfe, füllt das hohe Profilraster" },
      "story":  { "px": [1080, 1920], "safeZonePct": { "top": 14, "bottom": 35, "sides": 6 }, "safeZonePx": { "top": 269, "bottom": 672, "left": 65, "right": 65 } },
      "reel":   { "px": [1080, 1920], "safeZonePct": { "top": 14, "bottom": 35, "sides": 6 }, "safeZonePx": { "top": 269, "bottom": 672, "left": 65, "right": 65 } },
      "reelCover": {
        "canvasPx": [1080, 1920],
        "gridSafeBoxPx": [1080, 1440],
        "gridSafeBoxY": [240, 1680],
        "officialCoverHint": { "px": [420, 654], "ratio": "1:1.55" }
      }
    },
    "tiktok": {
      "px": [1080, 1920],
      "officialNumbers": false,
      "conservativeSafeZonePx": { "top": 270, "bottom": 672, "left": 120, "right": 120 }
    },
    "universalVertical": {
      "px": [1080, 1920],
      "safeZonePx": { "top": 270, "bottom": 672, "left": 120, "right": 120 },
      "innerBoxPx": [840, 978]
    },
    "export": {
      "jpeg": { "quality": 90, "colorSpace": "sRGB", "chroma": "4:4:4", "note": "Praxiswert, nicht offiziell" },
      "png": { "colorSpace": "sRGB", "use": "Text und Grafik mit harten Kanten" },
      "maxFileSizeMB": 30,
      "maxFileSizeSource": "Meta-Werbeanzeigen (Bilder); für organische Beiträge nennt Instagram keine Zahl"
    }
  }
}
```

**Die wichtigsten Konsequenzen in Kürze**

1. Shirtigo verlangt **Adobe RGB (1998)** als Farbprofil (nicht sRGB, anders als Printify/Gelato). Die App sollte beim Export das Profil per Farbmanagement umrechnen und einbetten (Abschnitt 1.4).
2. Halbtransparenz (Alpha 5 bis 99 %) ist auf farbigen Textilien ausdrücklich verboten wegen der weißen Unterlage; Shirtigo schneidet transparente Ränder nach dem Upload automatisch zu (Abschnitt 1.3).
3. Die Druckflächen kommen aus den Produktdaten von Shirtigo und unterscheiden sich je Produkt; der Hoodie-Vorderdruck ist nur 280 mm hoch (Abschnitt 1.2).
4. Hintergrundentfernung: **IS-Net general-use (Apache-2.0) über Rust-Crate `ort`**, Modell bei Bedarf nachladen, nicht im Installer (Abschnitt 3).
5. Mockups: **eigene Fotos der echten Grundprodukte als Shading-Ebenen** (Phase 1), Blender nur optional; es gibt kein brauchbares CC0-3D-Modell (Abschnitt 4).
6. PNG-Prüfung: dpi aus `pHYs` nur als Hinweis, die echte Prüfung rechnet in Pixeln gegen Millimeter (Abschnitt 5).

---

## 1. Shirtigo-Druckvorgaben

### 1.0 Einordnung

- Shirtigo (cockpit.shirtigo.com) druckt on demand mit **DTG (Kornit), DTF und Stick**. Siebdruck bietet die Print-on-Demand-Seite nicht an. [B] https://helpcenter.shirtigo.de/faq/motiverstellung/technische-anforderungen-druckverfahren/welche-druckverfahren-benutzt-ihr/
- Großauflagen laufen seit Kurzem unter der Marke **Prinovia** (shirtigo.de leitet auf prinovia.com um; dort gibt es Siebdruck). Für die Einzelstück-Fertigung des Shops bleibt das Shirtigo-Cockpit zuständig. [B] https://cockpit.shirtigo.com/de und https://www.prinovia.com/de/
- Die Druckflächen unten stammen aus der öffentlichen Produktseite und dem öffentlichen Katalog-JSON (`https://cockpit.shirtigo.com/api/catalog?locale=de&page=1..6`, undokumentierte Schnittstelle der eigenen Website, nur zum Abgleich benutzt) sowie der dokumentierten API (`GET /base-products/{id}?include_print_dimensions=true`, braucht Schlüssel). Die App sollte die Zahlen fest einbauen und später optional gegen die dokumentierte API abgleichen.

### 1.1 Datei-Vorgaben (Textil, DTG und DTF)

| Eigenschaft | Vorgabe | Beleg |
|---|---|---|
| Dateiformat | PNG und JPG (Designer); API: PNG oder JPEG | [B] Helpcenter "Welches Dateiformat sollte ich für meine Motive verwenden?", API `POST /designs/file` |
| Farbmodus | RGB, nicht CMYK (CMYK wird automatisch nach RGB gewandelt, Farbabweichungen möglich; 100 % Schwarz-Kanal wird nicht zu #000000) | [B] DTG-Guideline, Besonderheiten Digitaldruck |
| Auflösung | 150 bis 300 dpi; Datei in Wunschdruckgröße bei 300 dpi anlegen; Hochskalieren verbessert nichts | [B] Helpcenter Dateiformat, DTG-Guideline |
| Ideale Breite | "Idealerweise immer 30 cm Breite" bei 300 dpi, damit unterschiedliche Druckgrößen ohne Qualitätsverlust gehen (30 cm entsprechen 3543 px) | [B] DTG-Guideline, [A] Umrechnung |
| Mindestgröße | Designer: 1000 px Breite und Höhe jeweils, gemessen **nach** dem Zuschnitt auf die äußersten Pixel. API `POST /designs/file`: mindestens 1000 px in Breite **oder** Höhe | [B] Helpcenter "Mindestmaße", API-Spezifikation (Widerspruch, siehe 1.9) |
| Maximalgröße | 10.500 px Breite/Höhe | [B] Helpcenter Dateiformat |
| Dateigröße | höchstens 64 MB | [B] Helpcenter "maximale Dateigröße" |
| Zuschnitt | Transparente Ränder werden nach dem Upload automatisch entfernt; Datei besser gleich ohne Rand anlegen | [B] DTG-Guideline, "Warum ist das bedruckte Motiv kleiner" |
| Hintergrund | transparent bzw. freigestellt; ohne transparenten Hintergrund legt der Designer bei farbigen Textilien ein weißes Rechteck darunter | [B] Helpcenter Dateiformat |
| Schärfe-Faustregel | Konturen müssen bei 300 % Zoom scharf bleiben | [B] Helpcenter Dateiformat |
| Prüfung durch Shirtigo | nur Marken-/Urheberrechtssicht, keine Formprüfung | [B] Besonderheiten Digitaldruck |

Quellen (Helpcenter):
- https://helpcenter.shirtigo.de/faq/motiverstellung/technische-anforderungen-druckverfahren/welches-dateiformat-sollte-ich-fuer-mein-design-verwenden/
- https://helpcenter.shirtigo.de/faq/haeufigste-fragen/motiverstellung-haeufigste-fragen/dtg-guideline/
- https://helpcenter.shirtigo.de/faq/motiverstellung/technische-anforderungen-druckverfahren/was-sind-die-mindestmasse-fuer-designs/
- https://helpcenter.shirtigo.de/faq/motiverstellung/technische-anforderungen-druckverfahren/wie-gross-ist-die-maximale-dateigroesse-die-ich-hochladen-kann/
- https://helpcenter.shirtigo.de/faq/motiverstellung/technische-anforderungen-druckverfahren/welche-besonderheiten-muss-ich-beim-digitaldruck-dtg-beachten/
- https://helpcenter.shirtigo.de/faq/motiverstellung/druckmotiv-design-platzierung/allgemeine-hinweise-zur-druckmotiv-erstellung/

### 1.2 Druckflächen (Produktdaten, in mm und in Pixeln bei 300 dpi)

**Passende Grundprodukte für den Cypher-Shop.** Der Shop (`catalog/products.mjs`) kennt nur zwei Grundprodukte als Bekleidung: `tee` ("Unisex-T-Shirt, Rundhals") und `hoodie` ("Unisex-Hoodie"); alle Faser-, Grammatur- und SKU-Angaben sind dort noch PLATZHALTER. Vorschlag (nicht entschieden, Entscheidung beim Kollektiv):

| Shop-Basis | Shirtigo-Produkt | Daten laut Katalog (16.10.2026) |
|---|---|---|
| `tee` | **Organic Shirt, Stanley/Stella Creator 2.0, STTU169** (Slug `organic-shirt`, Badge "Empfehlung") | Unisex, Rundhals, 180 g/m², 100 % Bio-Baumwolle (ringgesponnen, gekämmt), XS bis 5XL, 28 Farben, ab 13,22 EUR brutto inkl. 1-seitigem Druck, Produktion 2 bis 5 Werktage |
| `hoodie` | **Organic Hoodie, Stanley/Stella Cruiser 2.0, STSU177** (Slug `organic-hoodie`, Badge "Empfehlung") | Unisex, 350 g/m², 100 % gekämmte ringgesponnene Bio-Baumwolle, XS bis 5XL, 15 Farben, ab 33,18 EUR brutto |

Pixelwerte: Millimeter / 25,4 x 300, gerundet [A]. Die App sollte beim Vergleich ±1 px Toleranz zulassen.

**Unisex-T-Shirt (Creator 2.0, STTU169)** [B] Produktseite https://cockpit.shirtigo.com/de/catalog/product/organic-shirt (Reiter "Druckinfo") und Katalog-JSON; alle Größen XS bis 5XL haben dieselben Werte.

| Position (API-Schlüssel) | Verfahren | mm (B x H) | px bei 300 dpi | Abstand Oberkante laut Katalog* |
|---|---|---|---|---|
| Vorderseite `front` | DTG, DTF | 330 x 450 | 3898 x 5315 | 26 mm |
| Rückseite `back` | DTG, DTF | 330 x 450 | 3898 x 5315 | 74 mm |
| Ärmel links `sleeve-left` | nur DTF | 100 x 100 | 1181 x 1181 | 0 |
| Ärmel rechts `sleeve-right` | nur DTF | 100 x 100 | 1181 x 1181 | 0 |
| Innen/Nacken `back-inside` (Nacken-Imprint) | nur DTF | 70 x 50 | 827 x 591 | 0 |
| Vorderseite Stick `front` | Stick | 300 x 100 | (entfällt) | 46 mm |

**Unisex-Hoodie (Cruiser 2.0, STSU177)** [B] https://cockpit.shirtigo.com/de/catalog/product/organic-hoodie und Katalog-JSON; alle Größen identisch.

| Position | Verfahren | mm (B x H) | px bei 300 dpi | Abstand Oberkante laut Katalog* |
|---|---|---|---|---|
| Vorderseite `front` | DTG, DTF | 330 x 280 | 3898 x 3307 | 40 mm |
| Rückseite `back` | DTG, DTF | 330 x 390 | 3898 x 4606 | 1 mm |
| Ärmel links/rechts | nur DTF | 100 x 400 | 1181 x 4724 | 0 |
| Innen/Nacken `back-inside` | nur DTF | 70 x 50 | 827 x 591 | 0 |
| Vorderseite Stick | Stick | 300 x 100 | (entfällt) | 40 mm |

\* Feld `processable_area_margin_from_top_mm` des Katalogs. Die API-Spezifikation beschreibt Verwandtes uneinheitlich ("Abstand Kragen zu Oberkante der Fläche" bzw. "Abstand Oberkante zu bearbeitbarer Fläche"). Nur als Hinweisgröße verwenden, nicht zum Prüfen. [U]

**Weitere Unisex-Shirts und Hoodies** (zum Vergleich, jeweils Vorderseite / Rückseite DTG und DTF, gleiche Werte für alle Größen) [B] Katalog-JSON:

| Produkt (Hersteller, Code) | Front mm (px300) | Back mm (px300) | Ärmel | Hinweis |
|---|---|---|---|---|
| Premium Shirt (B&C #E190, TU03T) | 330 x 450 (3898 x 5315) | 330 x 450 | 100 x 100 DTF | 185 g/m² |
| Heavy Cotton T-Shirt (Gildan 5000) | 330 x 450 | 330 x 450 | 100 x 100 DTF | 180 g/m² |
| Organic Basic Shirt (Crafter, STTU170) | 330 x 450 | 330 x 450 | 100 x 100 DTF | 155 g/m² |
| Organic Oversize Shirt (Blaster 2.0, STTU959) | 380 x 460 (4488 x 5433) | 380 x 460 | keine | 200 g/m² |
| Organic Basic Hoodie (Drummer 2.0, STSU168) | 330 x 260 (3898 x 3071) | 330 x 415 (3898 x 4902) | keine | 280 g/m², 85 % Baumwolle, 15 % Polyester |
| Basic Unisex Hoodie (College Hoodie, JH001) | 330 x 280 | 330 x 390 | keine | 280 g/m², 80/20 |
| Organic Oversize Hoodie (Slammer 2.0, STSU209) | 380 x 280 (4488 x 3307) | 380 x 460 | keine | 350 g/m² |

**Hinweise zu den Zahlen**
- Das Helpcenter nennt als Richtwerte Front: T-Shirts/Sweatshirts Unisex bis 330 x 450 mm, Oversize bis 380 x 460 mm, Hoodies/Zipper bis 330 x 280 mm. Die Produktdaten bestätigen das. [B] https://helpcenter.shirtigo.de/faq/motiverstellung/technische-anforderungen-druckverfahren/wie-gross-ist-die-maximale-druckflaeche-die-ich-bedrucken-lassen-kann/
- Das Helpcenter warnt, dass je Konfektionsgröße unterschiedliche Druckplatten verwendet werden und kleine Größen verkleinert werden können; als Beispiel nennt es Herren-Premium-Shirts XS bis M mit einer Small-Platte von 280 x 360 mm gegenüber 330 x 450 mm. In den API-Produktdaten der empfohlenen Produkte ist das nicht abgebildet. **Sicherer Standardwert [A/U]:** wer Motive bis 280 x 360 mm hält, wird auf keiner Größe verkleinert; die App zeigt oberhalb davon einen Hinweis (kein Fehler). Quelle: https://helpcenter.shirtigo.de/faq/motiverstellung/druckmotiv-design-platzierung/warum-ist-das-bedruckte-motiv-kleiner-als-im-designer/
- Ärmel: Das Helpcenter nennt allgemein 10 x 10 cm je Ärmel, DTF, 2,25 EUR netto Aufpreis je Ärmel (zusätzlich zu Front/Rücken), Nacken-Imprint 1,50 EUR netto. Beim Cruiser-Hoodie führt die Produktdatenbank 100 x 400 mm. App: Wert je Produkt aus den Produktdaten nehmen. [B] https://helpcenter.shirtigo.de/faq/produkte-produkterstellung/aermeldruck-dtf-hinzufuegen/
- Bis zu fünf Druckflächen je Produkt: Front, Rücken, Nacken-Imprint, linker und rechter Ärmel. [B] gleiche Seite.
- Zwei Verfahren pro Fläche nicht kombinierbar; je Fläche genau eines. Nacken-Imprint nur als Druck. [B] https://helpcenter.shirtigo.de/faq/motiverstellung/technische-anforderungen-druckverfahren/welches-druckverfahren-ist-das-richtige-fuer-mich/

**Nicht-Textilprodukte aus dem Shop-Katalog (zur Information)**

| Shop-Produkt | Shirtigo | Befund |
|---|---|---|
| Six-Panel-Cap, bestickt | Caps (z. B. "Organic Cotton Cap", "Pro-Style Heavy Cotton Cap") | nur **Stick**, Fläche vorn 100 x 50 mm; bei Druck Strichstärke mindestens 1,5 mm (besser 2 mm) [B] Katalog-JSON, Helpcenter "Kappen" |
| Poster A2, matt | "Poster Din A2 (hoch/quer)", 250 g/m², Farboption "Paperwhite Matt" | Endformat 420 x 594 mm plus 3 mm Anschnitt je Seite (426 x 600 mm, 5031 x 7087 px), wichtige Elemente 4 mm vom Endformat weg [B] Helpcenter "Posterdruck". Das Katalog-JSON nennt für "A2 hoch" 600 x 847 mm (entspricht A1 plus Anschnitt), das ist **widersprüchlich [U]**: Anschnitt-Regel des Helpcenters verwenden |
| Vinyl-Aufkleber (Sticker-Set) | **nicht im Katalog** (144 Produkte geprüft, kein Aufkleber) | Zweitanbieter nötig oder streichen [B] Katalog-JSON |

### 1.3 Transparenz, Halbtransparenz, Verläufe, weiße Unterlage

- **Weiße Unterlage (Underbase):** Auf farbigen Textilien wird jedes Motivelement mit weißer Farbe unterlegt (kräftigere Farben, Druck etwas plastischer). Auf weißen Textilien gibt es keine Unterlage; der Druck zieht ins Gewebe und wirkt gegen das Licht blass. [B] https://helpcenter.shirtigo.de/faq/motiverstellung/farben-druckqualitaet/was-ist-der-unterschied-zwischen-dem-druck-auf-weissen-und-farbigen-textilien/
- **Ausnahme Reinschwarz:** Elemente in exakt `#000000` bekommen keine weiße Unterlage; alles andere Dunkle schon. Ab welcher Abstufung Schwarztöne als Reinschwarz gelten, wird dynamisch bestimmt, keine verbindliche Aussage. [B] Besonderheiten Digitaldruck
- **Halbtransparenzen sind im DTG nicht umsetzbar** (Druckfarben decken immer 100 %). Woran man sie erkennt: Farben ändern sich je nach Hintergrund. [B] https://helpcenter.shirtigo.de/faq/motiverstellung/druckmotiv-design-platzierung/halbtransparenzen-wie-erzeuge-ich-transparenzeffekte-fade-out-effekte/
  1. Alpha 100 % und transparenter Hintergrund: unproblematisch, wird nicht gedruckt.
  2. Alpha **5 bis 99 %** über geschlossenen Motivflächen: Druck weicht stark ab; Lösung: mit der Wunsch-Hintergrundfarbe verrechnen ("rastern") und ohne Alphakanal liefern.
  3. Alpha als Übergang zwischen Motiv und transparentem Hintergrund (Fade-out): die weiße Unterlage scheint durch, grauer Schleier; Lösung: Bereiche manuell rastern (Halbton) und nur über RGB abbilden.
- Auch **unscharfe Ränder** (schlechte Auflösung) können weißen Schein erzeugen. [B] DTG-Guideline
- **DTF:** Halbtransparenzen sind noch schlechter oder gar nicht umsetzbar; Motive für DTF ohne Halbtransparenz anlegen. [B] DTG-Guideline
- **Halbton als Ersatz:** Halbtonrasterung wandelt Verläufe und Transparenz in volltonfarbige Punkte unterschiedlicher Größe (Photoshop-Anleitung im Helpcenter). Beim Export als transparente PNG mit Profil Adobe RGB 1998. [B] https://helpcenter.shirtigo.de/faq/motiverstellung/druckmotiv-design-platzierung/halbtonrasterung-bei-halbtransparenzen-farbverlaeufen/
- **Verläufe/Farbabstufung:** Farbwerte sollten sich bei gewünschten Abstufungen um mindestens 10 % unterscheiden; Unterschiede unter 5 % gleicht die Druck-Software automatisch an. Freistehende feine Elemente: im einzelnen RGB-Kanal nicht unter 5 %. [B] https://helpcenter.shirtigo.de/faq/motiverstellung/farben-druckqualitaet/farbtiefe-farbabstufungen/ und Besonderheiten Digitaldruck
- **Kontrast:** Textilfarbe in das Design einbeziehen; z. B. schwarze Elemente auf schwarzem Textil aussparen; schwarzer Druck auf dunkelgrauem Textil vermeiden. [B] DTG-Guideline
- **Intensive Farben:** Rot, Grün, Gelb wirken im DTG blasser; reines Rot/Grün erreicht man mit Kanal 255 und den anderen auf 0. Neon nicht umsetzbar, Gold/Silber werden zu Ocker/Grau. [B] Besonderheiten Digitaldruck
- **Keine Metallic-Effekte:** Für die Kollektion "Gold-Lounge" gilt: Goldfarbton als CMYK-Annäherung ja (Ocker-Ton), Metallic-Glanz nein. [B] Besonderheiten Digitaldruck

**Standardregeln der App [A/U]** (Shirtigo nennt keine Toleranzprozente): siehe JSON `transparencyRules` und Abschnitt 5.4.

### 1.4 Farbraum und ICC-Profil

- Shirtigo: Druckdateien im **RGB-Farbraum**, als Farbprofil "am besten **Adobe RGB 1998**" (zweimal ausdrücklich genannt, auch beim Export der Halbton-Anleitung und bei der Farbechtheit). Die Druck-Software trennt RGB intern in CMYK + Rot + Grün + Weiß. [B] DTG-Guideline, Besonderheiten Digitaldruck, https://helpcenter.shirtigo.de/faq/motiverstellung/farben-druckqualitaet/farbechtheit-im-digitaldruck-optimieren/
- Die Guideline zeigt Vergleichsbilder "Adobe RGB 1998, sRGB, CMYK" und sagt, CMYK sei ungeeignet. sRGB wird also nicht verboten. [B] DTG-Guideline
- Ob eine eingebettete Profilangabe (iCCP/sRGB) bei Shirtigo ausgewertet wird oder jede RGB-Datei als Adobe RGB angenommen wird, steht nirgends. **[U]** Standardwert: Beim Export das Profil per Farbmanagement umrechnen und einbetten (Rust: `moxcms` hat `ColorProfile::new_adobe_rgb()` und `new_srgb()`, Lizenz BSD-3-Clause OR Apache-2.0, spart eine fremde, evtl. lizenzierte `.icc`-Datei; docs.rs/moxcms/0.9.1/moxcms/struct.ColorProfile.html). Einmaliger Testdruck mit Farbkarte klärt die Annahme.
- Zum Vergleich: Printify und Gelato verlangen sRGB (https://printify.com/knowledge-hub/png-file-setup-for-tshirts/, https://support.gelato.com/en/articles/8996354-what-are-the-guidelines-regarding-design-files-for-dtg-printing). Die App braucht daher **Profile-Voreinstellungen je Anbieter** (Shirtigo: Adobe RGB, andere: sRGB).

### 1.5 Mindest-Strichstärken

| Größe | Wert | Beleg |
|---|---|---|
| Linie/Strich Textil (positiv und negativ) | empfohlen mindestens **0,8 mm** (= 9,4 px bei 300 dpi, App rundet auf 10 px) | [B] DTG-Guideline, Besonderheiten Digitaldruck |
| theoretisches Minimum | 0,4 mm (4,7 px), wegen Vorbehandlungsschwankungen und Ausbluten nicht empfohlen | [B] ebenda |
| Schrift | empfohlene Mindestgröße 5 pt (die Seite nennt zusätzlich "0,3 mm", vermutlich Strichstärke der Schrift) | [B] DTG-Guideline |
| Weiß auf Schwarz | etwas weniger kontrastreich als Schwarz auf Weiß, also eher großzügig sein | [B] ebenda |
| Kappen | mindestens 1,5 mm, besser 2 mm | [B] ebenda, Helpcenter "Kappen" |

### 1.6 Druckverfahren

| Verfahren | Beschreibung laut Shirtigo | Eignung |
|---|---|---|
| DTG (Kornit, Nass-in-Nass) | Tinte zieht in die Faser, weicher Griff, feine Details, Fotos, Farbverläufe | große, detailreiche Motive; Toleranzen bei Position und Farbe unvermeidbar |
| DTF (Direct-to-Film) | Folie wird bedruckt, bepudert, aufgepresst; kräftige Farben, feine Schriften | kleine bis mittlere Flächen, **Ärmel und Nacken immer DTF**; bei manchen Textilfarben stellt Shirtigo automatisch von DTG auf DTF um (gekennzeichnete Varianten) |
| Stick | Garn direkt ins Textil | Logos, einfache Motive, keine Verläufe; Caps nur Stick |
| Siebdruck | bei Shirtigo POD nicht angeboten (Prinovia, Großauflage) | farbechte Sonderfälle |

Quellen: https://helpcenter.shirtigo.de/faq/motiverstellung/technische-anforderungen-druckverfahren/welches-druckverfahren-ist-das-richtige-fuer-mich/ , https://helpcenter.shirtigo.de/faq/motiverstellung/druckanforderungen-fuer-verschiedene-produkte/warum-wird-bei-manchen-produkten-statt-dtg-der-dtf-druck-verwendet/ , https://helpcenter.shirtigo.de/faq/motiverstellung/technische-anforderungen-druckverfahren/technische-grenzen-des-digitaldrucks-was-geht-was-geht-nicht/

### 1.7 Hinweise zur Platzierung

| Position | empfohlene Breite | maximale Breite | Beleg |
|---|---|---|---|
| Brustemblem | 8 bis 11 cm | 15 cm | [B] DTG-Guideline |
| Brust zentriert (Saum zentriert) | Herren 28 bis 30 cm, Damen 24 bis 26 cm, Kinder ab 104: 20 cm, ab 128: 22 cm | 35 cm laut Tabelle (Produktdaten begrenzen auf 33 cm) | [B] DTG-Guideline |
| Rücken Schulterhöhe | Herren 30 cm, Damen 28 cm | 35 cm laut Tabelle (Produktdaten 33 cm) | [B] ebenda |

- Brustemblem: Höhe der Achsel-Kreuznaht, ca. 8 cm von der Mitte (Oversize ca. 10 cm). Erkennen die Druck-Operatoren ein klassisches Emblem oder eine gewollt zentrierte Platzierung, richten sie es automatisch aus. [B] https://helpcenter.shirtigo.de/faq/motiverstellung/druckmotiv-design-platzierung/wie-positioniere-ich-im-designer-ein-brust-emblem/ und .../wie-kann-ich-mein-druckmotiv-mittig-platzieren/
- Der Abstand zum Kragen wird je nach Größe angepasst; Positionierung unterliegt Toleranzen (schiefe Shirts, Kragen nicht mittig). [B] Technische Grenzen des Digitaldrucks
- Spitze Ausläufer lassen ein Motiv gedruckt kleiner wirken als großflächige Formen. [B] DTG-Guideline
- Mockups im Designer sind unverbindlich (meist Größe L). [B] "Warum ist das bedruckte Motiv kleiner"

### 1.8 API für Druckdateien und Produkte

Basis `https://cockpit.shirtigo.com/api`, Kopf `Authorization: Bearer <Schlüssel>` (API-Key oder OAuth2), `Accept: application/json`. **Es gibt keine Sandbox und keinen Testmodus**; zum gefahrlosen Testen: separates Konto mit Zahlungsart Vorkasse (Aufträge bleiben "pending", keine Produktion), Aufträge mit `"is_onhold": true` (werden erst mit `PUT /order/{reference}/release-onhold` freigegeben), Stornierung per `POST /orders/{reference}/cancel`, Webhook-Test per `POST /webhooks/{id}/test`. [B] https://cockpit.shirtigo.com/docs/ , API-Spezifikation https://cockpit.shirtigo.com/docs/redocusaurus/plugin-redoc-0.yaml (Swagger 2.0, 374 KB, am 2026-10-16 gelesen)

| Zweck | Aufruf | Felder (Auswahl) |
|---|---|---|
| Motiv hochladen (Datei) | `POST /designs/file` (multipart) | `file` (PNG/JPEG, mindestens 1000 px in Breite oder Höhe), `processingmethod` (`dtg`, `embroidery`, `engraving`), `name`, `tags[]`; Antwort `Design`, bei Verstoß HTTP 422 |
| Motiv hochladen (base64) | `POST /designs/base64` | `data`, `original_filename`, `processingmethod`, `name`, `tags` |
| Motiv per URL | `POST /designs/url` | `url`, `processingmethod`, `name`, `tags` |
| Design-Antwort | `Design` | `reference` (UUID), `filename`, `name`, `width`, `height` (px), `filetype`, `processingmethod_key`, `colors`, `palette`, `preview`, `original_file`, `is_processed`, `is_dark`, `is_editable`, `is_ai_generated`, Zeitstempel |
| Produkt anlegen | `POST /customized-product` | `project_id`, `base_product_id`, `price`, `custom_name`, `processings[]` mit `processingarea_type`, `processingposition`, `processingmethod`, `design_reference`, `offset_top`, `offset_center`, `width` (mm), `force_position`, `mockups[]`, `colors[]` (`colorId`, `price`) |
| Auftrag mit Druckdaten | `POST /orders` | je Position `base_product_sku` + `amount` + `processings[]`; je Processing: `processingarea_type` (`front`, `back`, `sleeve-left`, `sleeve-right`, `back-inside`), `processingmethod` (`dtg`, `dtf`, `embroidery`, `sublimation`), `design_url` (öffentliche URL, PNG/JPEG) **oder** `design_reference`, `width` oder `height` in mm (das andere folgt aus dem Seitenverhältnis), `offset_top`, `offset_center` in mm, `force_position`, `extract_size_and_position`, `resize_to_processingarea`, `ignore_validation` (Mindestauflösung 1000 px überspringen, bei `design_url` Standard true) |
| Auftrag per SKU | `POST /orders` | `products: [{ sku, amount }]` (genau das nutzt der Adapter im Shop); `external_reference`, `check_unique_external_reference`, `delayed_address_validation` |
| Katalog | `GET /base-products`, `GET /base-products/{id}?include_print_dimensions=true` | Druckflächen je Größe (`print_dimensions`), `processing_areas` mit `width_in_mm`, `height_in_mm`, `processing_method` |
| Mockup-Fabrik | `POST /mockup-factory/generate-image` | `base_product_id`, `mockup_ids`, `color_ids` oder SKUs, `design_url`, `design_width_mm`, `design_x_center_mm`, `design_y_top_mm`, `mockup_width_px` (quadratisch, max. 2000), `format` (`jpg`/`png`), `background_color_hex`/`background_url` |
| KI-Funktionen | `POST /ai/designs/{reference}/remove-background`, `.../upscale` | kostenpflichtig ("insufficient credits" im Fehlerfall) |

Wichtige Regeln aus der Spezifikation [B]:
- `width` + 2 x |`offset_center`| muss in die Druckfläche passen; `height` + `offset_top` ebenso. Position wird je Größe automatisch angepasst, wenn `force_position` false (empfohlen).
- `extract_size_and_position: true`: die Datei wird als Druckdatei behandelt, die die **ganze Druckfläche bei 300 dpi** abdeckt; transparente Ränder werden getrimmt, Größe und Versatz ergeben sich aus dem sichtbaren Inhalt (für DTG, DTF, Sublimation, Poster).

**Folge für den Export der App:** zwei Exportarten anbieten.
1. *Zugeschnitten* (Motiv ohne Rand, 300 dpi) plus Begleitdatei (JSON) mit `processingarea_type`, `width_mm`, `offset_top_mm`, `offset_center_mm`. Für manuellen Upload im Designer und für `width`/`offset_*`-Aufrufe.
2. *Vollflächig* (Leinwand in Größe der Druckfläche aus Abschnitt 1.2, z. B. 3898 x 5315 px, transparent) für `extract_size_and_position`. Achtung: Shirtigo schneidet beim Designer-Upload ebenfalls zu, die Position muss dort dann von Hand gesetzt werden.

### 1.9 Widersprüche und Lücken in den Quellen

- Mindestgröße: API sagt "Breite **oder** Höhe 1000 px", Helpcenter "Breite und Höhe jeweils 1000 px". Sehr breite, flache Motive (z. B. 330 x 40 mm = 3898 x 472 px) wären im Designer daher möglicherweise unzulässig. Standard der App: Fehler, wenn beide Seiten unter 1000 px, Warnung, wenn nur eine Seite darunter liegt.
- Das Helpcenter nennt 150 bis 300 dpi; zugleich ist 300 dpi in Wunschgröße Vorgabe. Standard: unter 150 dpi Fehler, 150 bis 299 Warnung, ab 300 in Ordnung.
- Der Cockpit-Hinweis "Adobe RGB" bei gleichzeitig üblichem sRGB: siehe 1.4.
- **Richtlinien für Motive:** Shirtigo lehnt Motive ab (im äußersten Fall Kontosperre) bei Marken-/Urheberrechtsähnlichkeit, realen Personen ohne Genehmigung, diskriminierenden, pornografischen, gewaltverherrlichenden Inhalten, Katastrophen/Tragödien und "politisch und ideologisch kontroversen Themen". Für die satirische Gold-Lounge (Luxus-Anspielungen) ist das ein Ablehnungsrisiko; die Satire-Leitplanken des Shops (keine echten Marken, Logos, Muster) decken das teilweise ab. [B] https://helpcenter.shirtigo.de/faq/motiverstellung/druckmotiv-design-platzierung/richtlinien-fuer-druckmotive/

### 1.10 Beobachtungen zum Projekt cypher-shop (nur gelesen, nichts geändert)

- `server/fulfillment/shirtigo.mjs` benutzt den Workflow "Order a Product" (`products: [{sku, amount}]`). Das passt zur Doku. Die Annahme "keine Testmodus" stimmt, die Doku nennt aber den sicheren Testweg `is_onhold: true` plus Vorkasse-Konto (siehe 1.8). Das könnte in `docs/EINRICHTEN.md` ergänzt werden.
- `BASES.tee` und `BASES.hoodie` (Faser, Grammatur) lassen sich mit den Katalogdaten oben füllen, sobald Creator 2.0 und Cruiser 2.0 gewählt sind.
- Das Rauschen-Shirt hat "Druck vorn und im Nacken": bei Shirtigo gibt es den **Nacken-Imprint innen** (`back-inside`, 70 x 50 mm, DTF, 1,50 EUR netto Aufpreis). Ein Außen-Nackendruck wäre stattdessen ein Motiv am oberen Rand der Rückseite.
- Sticker-Set ist bei Shirtigo nicht verfügbar; Cap nur gestickt (passt zum Shop); Poster A2 matt ist verfügbar.
- Farbzuordnung (Vorschlag, Hexwerte aus dem Katalog): schwarz = Black `201e1f` (Designer-Vorschau `272727`); weiß = White `FFFFFF` (Vorschau `F8F8F8`); grau meliert = Mid Heather Grey `818381` oder Heather Grey `C0BDB9`; navy = French Navy `2F354A` (Vorschau `0e2035`); sand = Desert Dust `D5C9BC`; creme = Natural Raw `FCF0DC` oder Off White `f4efe8`. Die Shop-Hexwerte (`#1d2738`, `#cdbb9a`, `#efe4cc`) weichen davon ab; für Mockups die Shirtigo-Werte nehmen. [B] Katalog-JSON

---

## 2. Social-Formate (Stand 2026)

| Format | Maße | Beleg |
|---|---|---|
| Instagram-Foto: höchste gespeicherte Breite 1080 px; zwischen 320 und 1080 px Breite bleibt die Auflösung, wenn das Seitenverhältnis zwischen **1,91:1 und 3:4** liegt (bei 1080 px Breite 566 bis 1440 px Höhe); größere werden auf 1080 px Breite verkleinert, nicht unterstützte Verhältnisse zugeschnitten | [B] Instagram-Hilfe https://help.instagram.com/1631821640426723/ (deutsche Fassung). Hinweis: Suchtreffer zeigten eine ältere Fassung mit Grenze 4:5 (1350 px); Fassung ist nicht stabil |
| **Post 4:5: 1080 x 1350** | innerhalb des Bereichs; sicherer Standard | [A] |
| **Post 3:4: 1080 x 1440** | obere Grenze laut aktueller Hilfe; füllt das hohe Profilraster | [A] aus Hilfeseite |
| Story / Reel Video und Bild: **1080 x 1920 (9:16)** | Meta empfiehlt für Stories 1080 x 1920, Minimum 600 x 1067; Bilder JPG/PNG bis 30 MB | [B] https://www.facebook.com/business/help/2222978001316177 |
| Reels (Video): Seitenverhältnis zwischen 1,91:1 und 9:16, mindestens 30 fps und mindestens 720 px | [B] https://help.instagram.com/1038071743007909 |
| Reel-Titelbild: empfohlen **420 x 654 px bzw. 1:1,55**; nach dem Upload nicht mehr änderbar (Aussage der Hilfe) | [B] https://help.instagram.com/1038071743007909 (deutsche Fassung) |

### 2.1 Sicherheitszonen (Bedien-Overlays)

Meta nennt für 9:16-Anzeigen (Stories, Reels, 9:16 im Feed) in der Ads-Guide-Seite: **oben etwa 14 %, unten etwa 35 %, seitlich je 6 %** freihalten (von Text, Logos, Schlüsselelementen). [B] https://www.facebook.com/business/ads-guide/update/image/instagram-reels (Auflösung dort 1440 x 2560, JPG/PNG, 30 MB, Mindestbreite 500 px). Das Hilfecenter bestätigt das Prinzip für Stories und Reels und ergänzt: bei Disclaimern in Reels-Anzeigen die unteren 40 % freihalten; auf höheren Bildschirmen kann zugezoomt werden, also Wichtiges deutlich innerhalb der Zone halten. [B] https://www.facebook.com/business/help/980593475366490?locale=en_US

Umrechnung auf 1080 x 1920 [A]:

| Rand | Prozent | Pixel |
|---|---|---|
| oben | 14 % | 269 |
| unten | 35 % | 672 |
| links/rechts | 6 % | 65 |
| innere Box | | x 65 bis 1015, y 269 bis 1248 (950 x 979) |

Wichtig: Diese Zahlen gelten laut Meta für **Werbeanzeigen**. Für organische Reels/Stories veröffentlicht Instagram keine Pixel, die Praxis (Drittanbieter-Leitfäden) benutzt dieselben Werte. **[U]**

**TikTok:** TikTok veröffentlicht Sicherheitszonen nur als herunterladbare Vorlagen (zip/PSD) je Anzeigenformat, Beschriftungslänge und Sprachrichtung, **keine Zahlen** in der Hilfe; Zone hängt von Beschriftungslänge ab. [B] https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads (über Suchergebnis; Seite selbst per Abruf nicht erreichbar). Drittquellen nennen oben 240, unten 660, links/rechts 120 px (https://www.socialync.io/tools/safe-zones/instagram-reels), eine andere unten 20 % und oben/unten 10 % (https://houseofmarketers.com/guide-to-safe-zones-tiktok-facebook-instagram-stories-reels/): uneinheitlich. **[U]** Konservativer Standard der App für alle vertikalen Formate gleichzeitig: oben 270, unten 672, links 120, rechts 120 px, innere Box 840 x 978 px (JSON `universalVertical`).

### 2.2 Reel-Titelbild im Profilraster

- Instagram hat das Raster von Quadraten auf **hochformatige Kacheln** umgestellt (SocialMediaToday, 19.01.2025, mit Aussage von Adam Mosseri, dass die meisten Uploads vertikal sind): https://www.socialmediatoday.com/news/instagram-rolls-out-vertically-aligned-profile-grid/737777/ . Eine Pixelzahl nennt diese Quelle nicht. Spätere Funktion "Vorschaubild bearbeiten" (Stand 01.03.2026): https://www.socialmediatoday.com/news/instagram-introduces-thumbnail-post-editing-for-grids/813444/
- Das Verhältnis **3:4** (1080 x 1440 bei voller Breite) stammt aus Drittquellen (u. a. Planoly: Cover 1080 x 1920 erscheinen im Raster als 1013 x 1350; PostFast: Titel und Logo in zentrierte Box 1080 x 1440, links mindestens 60, rechts mindestens 120 px Rand): https://planoly.com/blog/guide-to-instagrams-new-vertical-grid , https://postfa.st/blog/instagram-reel-cover-size-safe-zones . Die offizielle Hilfe nennt nur 420 x 654 (1:1,55). **[U]** für 3:4 als offizielle Zahl.
- **Standard der App:** Cover auf 1080 x 1920 anlegen, alles Wichtige in die zentrierte Box 1080 x 1440 (y 240 bis 1680). Diese Box liegt auch innerhalb des offiziell genannten 1:1,55-Ausschnitts (1080 x 1674, y 123 bis 1797). [A]
- Posts 4:5 (1080 x 1350) werden im 3:4-Raster auf 1012 x 1350 zugeschnitten: Wichtiges zwischen x 34 und 1046 halten; quadratische 1080 x 1080 behalten im Raster nur etwa 810 px Breite (x 135 bis 945). [A]; zentrierter Zuschnitt laut Drittquellen [U]

### 2.3 Exportformate und Limits

| Punkt | Wert | Status |
|---|---|---|
| Dateitypen Bilder | JPG oder PNG | [B] Meta (Anzeigen); Instagram-Hilfe nennt für Organisches keine Typen |
| Maximale Dateigröße Bild | 30 MB | [B] nur Meta-Anzeigen; organisch **[U]** |
| Farbraum | sRGB | [U] kein offizielles Statement gefunden (Suche in help.instagram.com und facebook.com ohne Treffer); Praxis |
| JPEG-Qualität | 90, bei Text 4:4:4 oder PNG | [U] Praxiswert; Instagram komprimiert ohnehin neu, deshalb gleich in Zielgröße (1080 px Breite) liefern, damit nicht zweimal skaliert wird |
| PNG | für Grafik mit harten Kanten und Text | [A] |

---

## 3. Lokale Hintergrundentfernung

### 3.1 Kandidaten

| Kandidat | Lizenz Code | Lizenz Gewichte | ONNX (Quelle) | Größe | Qualität | CPU-Laufzeit | Urteil |
|---|---|---|---|---|---|---|---|
| **u2netp** (U²-Net klein) | Apache-2.0 (github.com/xuebinqin/U-2-Net) | im Repo Apache-2.0 [B GitHub-API], Gewichte-Hosting über Drive/rembg | rembg-Release `u2netp.onnx`: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx | 4.574.861 Byte (4,6 MB), MD5 `8e83ca70e441ab06c318d82300c84806` (aus rembg-Quelltext) | gröber als u2net (nicht gemessen) | nicht gemessen [U] | nur als Not-Fallback/Vorschau |
| **u2net** | Apache-2.0 | Apache-2.0 (Repo) | `.../v0.0.0/u2net.onnx`, MD5 `60024c5c889badc19c04ad937298a77b` | 175.997.641 Byte | AIM-500: SAD 70,7, IoU 0,859, 24 von 34 transparenten Objekten scheitern | 0,12 s Median, 2,1 GB RAM (Test 01.10.2026, Ryzen 7 9700X, 6 vCPU, ohne GPU) | schnell, aber schwächer als IS-Net |
| **IS-Net general-use** (DIS) | Apache-2.0 (github.com/xuebinqin/DIS) | Apache-2.0 (Repo; Trainingsdaten siehe 3.2) | rembg-Release `isnet-general-use.onnx` (konvertiert aus dem DIS-`.pth`) | 178.648.008 Byte, MD5 `fc16ebd8b0c10d971d3513d564d01e29` | AIM-500: SAD 65,8, IoU 0,876, 17 von 34 transparenten Objekten scheitern; bei Glas/Haar Schwächen | **0,33 s Median**, 2,8 GB RAM (gleicher Test); ein anderer Test: 1,1 s | **empfohlen** |
| **BiRefNet** (general) | MIT (github.com/ZhengPeng7/BiRefNet) | MIT (HF-Modellkarte `license: mit`) | GitHub-Release v1 und onnx-community; `lite` = `BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx` | lite 224.005.088 Byte; voll 972.666.916 Byte; fp16 lite 114,5 MB, voll 489,7 MB | modernster Stand, beste Kanten/Haare/Details | Standard-Export lite: **6,5 s und 10,5 GB Spitzen-RAM** bei 1024 px; im rembg-Test auf 12-GB-Rechner "killed" bei lite und voll | Qualitäts-Option später, siehe 3.3 |
| BiRefNet lite, **Drittexport mit nativem DeformConv** (senty-au) | MIT | MIT | https://huggingface.co/senty-au/BiRefNet_lite-ONNX-dynamic (Privatperson, nicht offiziell) | 180.839.545 Byte, SHA-256 `1e0da42f0fde010e32e938bad388457ecefe35806fde9d923421997861ae9391` (vom Autor angegeben) | gleiche Maske wie PyTorch (IoU 0,999 bei 1024 px) | 2,4 s bei 1024, 1,4 s bei 768, 0,6 s und ca. 1,3 GB bei 512 (Core Ultra 9 185H, ORT 1.30; Selbstangabe) | gut, aber Lieferkettenrisiko durch Einzelperson; eigener Export aus Quelltext möglich |
| BiRefNet lite (onnx-community) | MIT | MIT | https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model.onnx | 224.005.088 Byte, SHA-256 `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333` (HF-LFS-Metadaten, Revision `de15b22ba131738a16dff04aab8bdf8dc32e3ac1`) | wie oben | wie Standard-Export | Prüfsumme belegt, aber schwer |
| **InSPyReNet** | MIT | Gewichte nur über Google Drive (Pakete laden sie dort), kein offizielles ONNX | nein | n. b. | gut | n. b. | ausgeschieden (Vertrieb) |
| **MODNet** | Apache-2.0, "Code, Modelle, Demos" laut README | Apache-2.0 | nur Export-Skript, Gewichte über Drive | n. b. | **nur Porträts** (Matting von Personen) | n. b. | ungeeignet für Grafiken |
| **BEN2** (PramaLLC) | MIT | MIT für das Basismodell; stärkeres Modell kommerziell (sales@backgrounderase.com) | `BEN2_Base.onnx` im HF-Repo | 222.932.053 Byte | trainiert auf DIS5K plus 22K proprietären Bildern; Selbstvergleich nennt Spitzenwerte | nicht belegt | Alternative, aber jung (257 Sterne), keine Fremd-Tests gefunden |
| RMBG-1.4 (BRIA) | n. b. | **"bria-rmbg-1.4": Quellcode-verfügbar nur nichtkommerziell, kommerziell nur mit Vertrag** | auf HF vorhanden | n. b. | gut | n. b. | **ausgeschlossen** (bestätigt) |
| RMBG-2.0 (BRIA) | n. b. | **nichtkommerziell** (HF `license: other`, gesperrt; BiRefNet-README und rembg-Test nennen CC BY-NC 4.0 / nichtkommerziell); rembg liefert `bria-rmbg-2.0.onnx` und nutzte es als Standardmodell | | 1.024.331.469 Byte | | | **ausgeschlossen** (bestätigt). Achtung: wer `rembg` unverändert nutzt, bekommt RMBG-2.0 als Standard |

Quellen: Modellkarten https://huggingface.co/ZhengPeng7/BiRefNet , https://huggingface.co/PramaLLC/BEN2 , https://huggingface.co/briaai/RMBG-1.4 ; Repos über die GitHub-API (Lizenz-Feld, 16.10.2026): xuebinqin/U-2-Net Apache-2.0, xuebinqin/DIS Apache-2.0, ZhengPeng7/BiRefNet MIT, plemeri/InSPyReNet MIT, ZHKKKe/MODNet Apache-2.0, PramaLLC/BEN2 MIT, danielgatis/rembg MIT; rembg-Quelltext `rembg/sessions/*.py` (Download-URLs und MD5); Test: https://www.creativeainews.com/articles/rembg-background-removal-models-tested-2026/ (Drittquelle, 500 AIM-500-Fotos, rembg 2.0.85, ORT 1.30.0); BiRefNet-README https://github.com/ZhengPeng7/BiRefNet (ONNX-Release v1, nur GPU-Zeiten offiziell: lite mit ONNX etwa 94 ms auf A100).

Keine Messung von Qualität auf **Grafiken/Logos/Text** gefunden (der Test hat sie ausdrücklich nicht geprüft). **[U]** Vor Festlegung eine kleine eigene Testreihe (10 echte Shirt-Motive) fahren.

### 3.2 Rechtlicher Restvorbehalt

Die Gewichte von IS-Net, BiRefNet und BEN2 wurden (auch) auf **DIS5K** trainiert. Die DIS5K-Nutzungsbedingungen erlauben den Datensatz nur für **nichtkommerzielle Forschung und Lehre** und verbieten kommerzielle Nutzung ohne Erlaubnis (https://raw.githubusercontent.com/xuebinqin/DIS/main/DIS5K-Dataset-Terms-of-Use.pdf, 2 Seiten gelesen). Die Lizenzen der veröffentlichten Gewichte (Apache-2.0/MIT) enthalten diese Einschränkung nicht, ob sie sich rechtlich auf trainierte Gewichte erstreckt, ist ungeklärt. U²-Net wurde ebenfalls auf einem Forschungsdatensatz (DUTS-TR) trainiert (Lizenz dort nicht geprüft). **Fazit:** Das Restrisiko ist bei allen gängigen offenen Modellen gleich; es lässt sich nur durch ein selbst trainiertes Modell auf eigenen Daten beseitigen. Für ein gemeinnützig-kreatives Kollektiv mit kleinem Shop ist es vertretbar, sollte aber im Projekt (z. B. `NOTICE`/Lizenzseite) offen stehen. Das ist keine Rechtsberatung.

### 3.3 Laufzeit-Optionen

| Option | Befund |
|---|---|
| **Rust-Crate `ort`** (pykeio/ort) | Lizenz MIT OR Apache-2.0; aktuell **2.0.0-rc.14 vom 12.10.2026** (noch Release Candidate, genau pinnen); bindet ONNX Runtime 1.31.0 (MIT, github.com/microsoft/onnxruntime). Linken: `load-dynamic` wird von ort ausdrücklich empfohlen (Bibliothek zur Laufzeit laden, `ort::init_from(pfad)` oder `ORT_DYLIB_PATH`); damit lässt sich die offizielle Microsoft-`onnxruntime.dll` neben der App mitliefern und der Download der Standard-Binaries vermeiden. Execution Provider (DirectML/CoreML/CUDA) später nachrüstbar. [B] https://ort.pyke.io/setup/linking , crates.io-API |
| `tract-onnx` (reines Rust, 0.23.9, MIT OR Apache-2.0) | keine Fremdbibliothek, aber für große Faltungsnetze erfahrungsgemäß langsamer; nicht gemessen [U] |
| onnxruntime-web / transformers.js im WebView | Windows (WebView2, Chromium) kann WebGPU, macOS (WKWebView) und Linux (WebKitGTK) nicht verlässlich; ein Tauri-Issue zeigt, dass WebGPU unter WebView2 hinter einem Flag lag (https://github.com/tauri-apps/tauri/issues/6381) und für macOS/Linux keine Einstellung existierte. Dann bleibt WASM auf CPU, langsamer, und das Modell lebt im JS-Speicher. **Nicht empfohlen** als Hauptweg; einziger Vorteil wäre kein nativer Code |

### 3.4 Empfehlung (eine Lösung)

**IS-Net general-use (`isnet-general-use.onnx`, Apache-2.0) über das Rust-Crate `ort` 2.0.0-rc.14 mit `load-dynamic`.**

- Download-URL: `https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx` (178.648.008 Byte).
- Prüfsumme: **MD5 `fc16ebd8b0c10d971d3513d564d01e29`** (vom rembg-Projekt veröffentlicht, Quelle `rembg/sessions/dis_general_use.py`). Eine SHA-256 ist nicht veröffentlicht; ich habe die Datei absichtlich nicht geladen. **Beim ersten Build die Datei einmal laden, SHA-256 berechnen, im Projekt festschreiben und als Release-Asset des Cypher-Studio-Repos spiegeln** (Apache-2.0 erlaubt Weitergabe mit Lizenztext und Hinweis), damit die App nicht von einem fremden Repo abhängt.
- Nicht in den Installer legen, sondern beim ersten Gebrauch nachladen, in den App-Datenordner, mit Prüfsumme und Fortschrittsanzeige. Optional die 4,6-MB-Datei `u2netp.onnx` als Mini-Fallback.
- Vorverarbeitung laut rembg: Bild auf 1024 x 1024 skalieren (Lanczos), RGB, Wert minus 0,5 (Standardabweichung 1,0), Kanäle zuerst (NCHW, float32); Ausgabe `pred[:,0]`, min-max auf 0..1, mit Lanczos auf Originalgröße, als Alpha. rembg teilt dabei durch das Bildmaximum statt durch 255 (Eigenheit von `normalize()`); mit beiden Varianten an echten Motiven testen. [B] rembg-Quelltext
- Laufzeit-Erwartung: etwa 0,3 bis 1,1 s je Bild auf einem aktuellen Mehrkern-Rechner und ca. 3 GB RAM-Spitze (Drittmessung). [B/U]
- Ergänzung ohne KI für **flächige Grafiken** (einfarbiger Hintergrund): Flood-Fill/Farbschlüssel mit Toleranz liefert perfekte Kanten, braucht keine 178 MB und ist deterministisch. Das sollte der erste Weg sein, ML nur bei Fotos oder komplexen Hintergründen.
- **Ausbaustufe "Qualität":** BiRefNet lite (MIT) als zweites, optional nachladbares Modell, sobald es mit dem DeformConv-Export (oder eigenem Export aus dem Quelltext) auf den Rechnern des Kollektivs unter 3 s und unter 4 GB bleibt. Mit dem Standard-Export (6,5 s, 10,5 GB) ist es für Laptops ungeeignet.
- Haar- und Glaskanten: ViTMatte-Nachbearbeitung kostet im rembg-Test etwa 1,3 s zusätzlich und senkt den Kantenfehler um etwa ein Fünftel; optional später.

---

## 4. Mockup-Grundlagen (Shirt/Hoodie in Kollektionsfarben)

### 4.1 Befund zu CC0-3D-Modellen (Suche am 16.10.2026)

| Quelle | Ergebnis | Lizenzbeleg |
|---|---|---|
| **Sketchfab**, Filter CC0 + herunterladbar (API-Suche nach shirt, t-shirt, tshirt, hoodie, sweater, pullover, jumper, garment, clothes, clothing, apparel, polo, jersey, mockup) | **kein T-Shirt, kein Hoodie.** Nur historische Museumsstücke, z. B. "shirtwaist" (Smithsonian, 99.999 Flächen) https://sketchfab.com/3d-models/none-6d8e371807e4494792df4bd19770d309 ; zum Vergleich liefert der Filter CC-BY viele Hoodies/Shirts | Sketchfab-Lizenzfeld `cc0` (Smithsonian Open Access); Download nur mit Konto (allgemeines Verhalten, nicht getestet, da keine Konten angelegt wurden) [U] |
| **Poly Pizza** (Suche "shirt", "hoodie") | Standalone-T-Shirts: "T-shirt" (Poly by Google) https://poly.pizza/m/bdOMzzh-fSl und "T Shirt" (Nour) https://poly.pizza/m/oZOt671DyI , beide **CC BY 3.0**, nicht CC0; Hoodie nur als "Hoodie Character" (Quaternius) https://poly.pizza/m/gKLBoRsyKe mit Anzeige "Public Domain (CC0)", aber stilisierte Low-Poly-Figur, kein Kleidungsstück für Mockups | Seitenangabe "Creative Commons Attribution" bzw. "Public Domain (CC0)"; ob ein Konto zum Download nötig ist, sagt die Seite nicht [U] |
| **OpenGameArt** | "T-Shirt and Hanger" (plaggy), **CC0**, ZIP 924,5 KB, Shirt am Kleiderbügel, kein Hoodie https://opengameart.org/content/t-shirt-and-hanger | Seitenangabe "CC0"; Detailgrad niedrig, Formate nicht benannt |
| **Poly Haven** (521 Modelle) | keine Shirts/Hoodies. Aber CC0-Stoffe: `cotton_jersey`, `jersey_melange`, `knitted_fleece`, `waffle_pique_cotton` https://polyhaven.com/a/cotton_jersey | https://polyhaven.com/license (CC0, kommerziell frei, ohne Namensnennung) |
| **ambientCG** | Materialien CC0 (Stoffe für Normal/Displacement/Roughness) | https://docs.ambientcg.com/license/ (CC0 1.0) |
| **Kenney**, **Quaternius** | keine Kleidungsstücke einzeln gefunden (Websuche, nicht erschöpfend); Quaternius-Figuren sind CC0 | Poly-Pizza-Seitenangabe CC0 |
| Kostenpflichtig/eingeschränkt (nicht nutzbar) | RenderHub, Blender Market (nichtkommerziell), CGTrader "Royalty Free" | nicht CC0 |

**Ergebnis:** Es gibt **kein CC0-3D-Modell von T-Shirt oder Hoodie in Mockup-Qualität**. Die wenigen CC0-Treffer sind Hänger-Szene, stilisierte Figur oder historisches Kleid.

### 4.2 Bewertung der Wege

| Weg | Qualität | Aufwand | Lizenz | Urteil |
|---|---|---|---|---|
| (a) Blender: selbst modellieren und Stoff simulieren (Python-Skript) | hoch (Falten, echte Hoodie-Kapuze), Seitenansichten möglich | hoch: Modellieren, Schnittmuster, Cloth-Simulation, Rendern; Tage bis Wochen für Hoodie | **unkritisch**: Blender-Seite: "Was du mit Blender erstellst, gehört dir allein", .blend-Dateien frei nutzbar (https://www.blender.org/about/license/); Stoffe CC0 von Poly Haven/ambientCG | gut als Phase 2, nur zum einmaligen Erzeugen der Ebenen, nicht zur Laufzeit |
| (b) CC0-3D-Modell übernehmen | nicht verfügbar in brauchbarer Qualität | gering | CC0 | scheidet aus (4.1) |
| (c) 2D-Vektor-Silhouetten plus prozedurale Schattierung (Multiply, Displacement) | mittel (wirkt flach, gut für Social/Vorschau) | gering bis mittel, alles in der App berechenbar | **eigene Zeichnung, keine Fremdrechte** | gutes Auffang- und Start-Verfahren |
| (d) **Eigene Fotos** der echten Grundprodukte (Muster-Box von Shirtigo, ausgelegt auf neutralem Grund, ohne sichtbares Etikett) als Basis | **sehr hoch** (echte Falten, Nähte, Stoff) | gering: 2 Produkte x 2 Ansichten x 2 Belichtungen (hell/dunkel) fotografieren | **eigenes Urheberrecht** an den Fotos | **empfohlen** |
| (e) Shirtigo-Mockups (Cockpit: "Mockups herunterladen", hochwertig mit transparentem Hintergrund; API `mockup-factory`, max. 2000 px) | sehr hoch, authentisch | gering, braucht Konto/Schlüssel | Nutzungsbedingungen für Mockups nicht geprüft [U] | für **endgültige Shop-Bilder** naheliegend, aber nicht lokal/offen; Studio-Mockup-Generator dient Entwurf und Social |

Beleg Cockpit-Mockups: https://helpcenter.shirtigo.de/faq/motiverstellung/sonstiges-motiverstellung/wo-finde-ich-produkt-mockups/ ; Muster-Box: https://cockpit.shirtigo.com/de/musterboxen (Seite nur als Navigationspunkt gesehen, Inhalt nicht gelesen).

### 4.3 Empfehlung

**Mockup-Vorlagenpaket aus eigenen Fotos (Weg d), Auffangebene aus Silhouette (Weg c), Blender (Weg a) optional später.**

Technik der App (Standardverfahren, [A] Fachwissen, nicht aus einer Quelle):
1. Je Produkt und Ansicht ein Paket: Alpha-Maske, **Shading-Karte** (Helligkeit des fotografierten Shirts, normalisiert), Falten-Verschiebungskarte (Displacement) für die Verzerrung des Motivs, Druckflächen-Viereck (aus Abschnitt 1.2, in Pixel der Vorlage) und optional Stofftextur (CC0 `cotton_jersey` für Shirt, `knitted_fleece` für Hoodie).
2. Färben: Stofffarbe (Hexwerte aus 1.10) per Multiplikation mit der Shading-Karte plus Anhebung der Lichter, für sehr dunkle Farben eigenes Paket aus dunkler Aufnahme (reines Multiplizieren lässt Schwarz zu flach wirken).
3. Motiv einsetzen: auf die Druckfläche skalieren (mm zu Pixel der Vorlage), mit der Displacement-Karte verzerren, mit Shading überlagern (Multiply/Soft-Light), Kantenschärfe leicht reduzieren.
4. Ausgabe als PNG mit Transparenz (so liefert auch Shirtigo seine Mockups).

---

## 5. Prüfregeln für den Druckdatei-Prüfer (PNG-Interna und Halbtransparenz)

### 5.1 PNG-Chunks auslesen

Spezifikation: W3C PNG Third Edition, Recommendation vom 24.06.2025, https://www.w3.org/TR/png-3/ [B]

| Info | Chunk | Aufbau | Auslesen und Regel |
|---|---|---|---|
| Farbtyp, Bittiefe, Größe | `IHDR` | Breite, Höhe, Bittiefe, Farbtyp (0 Grau, 2 RGB, 3 Palette, 4 Grau+Alpha, 6 RGBA) | Alphakanal vorhanden bei Farbtyp **4 oder 6**; bei Typ 0, 2, 3 kann `tRNS` Transparenz liefern |
| Auflösung | `pHYs` (hex `70 48 59 73`) | 4 Byte Pixel pro Einheit X, 4 Byte Pixel pro Einheit Y, 1 Byte Einheit (0 unbekannt, 1 Meter) | dpi = Pixel pro Meter x 0,0254. 300 dpi = **11811** (11811,02), 150 dpi = 5906, 72 dpi = 2835. Bei Einheit 0 nur Seitenverhältnis, **keine** physische Größe. Fehlt der Chunk: Größe unbekannt. Muss vor `IDAT` stehen |
| Eingebettetes Profil | `iCCP` (hex `69 43 43 50`) | Profilname 1 bis 79 Byte (Latin-1), 1 Null-Byte, 1 Byte Kompressionsmethode (nur 0 = zlib/deflate), dann das komprimierte ICC-Profil | zlib entpacken, ICC-Header lesen; Farbraum RGB für Farbbilder, Name und Beschreibung aus dem Profil anzeigen |
| sRGB-Marke | `sRGB` (hex `73 52 47 42`) | 1 Byte Rendering-Intent (0 perzeptuell, 1 relativ farbmetrisch, 2 Sättigung, 3 absolut) | bedeutet "Pixel sind sRGB" |
| Gamma/Primärvalenzen | `gAMA`, `cHRM` | | nur Ersatz, wenn nichts Höheres da; sRGB-Datei trägt gAMA 45455 und feste cHRM-Werte |
| Vorrang | Tabelle 1 der Spezifikation | `cICP` (1) vor `iCCP` (2) vor `sRGB` (3) vor `cHRM`+`gAMA` (4) | höchste Nummer wird ignoriert; `iCCP` und `sRGB` sollen nicht zugleich vorkommen; bei Verstoß Warnung |
| Animation | `acTL` | | vorhanden: animiertes PNG, ablehnen |
| Platzierung | | `iCCP`, `sRGB`, `cHRM`, `gAMA`, `pHYs` vor `IDAT`, `tRNS` nach `PLTE` und vor `IDAT` | Reihenfolge prüfen |

**Rust:** Das Crate `png` (0.18.1, MIT OR Apache-2.0) stellt dies als öffentliche Felder von `png::Info` bereit: `pixel_dims` (`pHYs`: Pixel pro Einheit X/Y und Einheit), `icc_profile` (`Option<Cow<[u8]>>`, bereits entpackt), `srgb`, `gama_chunk`, `chrm_chunk`, `trns`, `color_type`, `bit_depth`, `animation_control`, `exif_metadata`. [B] https://docs.rs/png/0.18.1/png/struct.Info.html (Feldnamen der `PixelDimensions` auf der Seite nicht aufgelistet; im Quelltext prüfen). ICC-Profil lesen und beschriften: `moxcms::ColorProfile::new_from_slice(...)` mit den öffentlichen Feldern `description` und `color_space`; Alternative `lcms2` 6.2.0 (MIT, C-Bindung) [B] docs.rs/moxcms.
JPEG: Auflösung steht in JFIF-APP0 bzw. EXIF, ICC in APP2 ("ICC_PROFILE") [A] allgemein bekannt, hier nicht neu belegt.

**Wichtig [A/U]:** Shirtigo rechnet mit Pixeln und Millimetern (Designer und API-Feld `width` in mm). Dass `pHYs` bei Shirtigo ausgewertet wird, ist nirgends belegt. Deshalb:
- Prüfer: effektive Auflösung = Pixelbreite / (gewünschte Druckbreite in Zoll), `pHYs` nur als Information (Hinweis, wenn fehlt oder abweicht).
- Export: `pHYs` trotzdem auf 11811 Pixel pro Meter (300 dpi) schreiben, weil Photoshop & Co. es so lesen und das Helpcenter "300 dpi" nennt.

### 5.2 Vorschlag Prüfkatalog

| Nr | Prüfung | Fehler | Warnung | Quelle |
|---|---|---|---|---|
| 1 | Format PNG oder JPEG | andere | JPEG mit Transparenzbedarf (JPEG hat keinen Alphakanal) | 1.1 |
| 2 | Pixelgröße nach Zuschnitt auf sichtbare Pixel | beide Seiten unter 1000 px, oder eine Seite über 10.500 px | nur eine Seite unter 1000 px | 1.1, 1.9 |
| 3 | Dateigröße | über 64 MB | über 48 MB | 1.1 |
| 4 | Effektive Auflösung bei geplanter Druckbreite | unter 150 dpi | unter 300 dpi | 1.1 |
| 5 | Passt in Druckfläche (mm aus Abschnitt 1.2) | überschreitet Breite oder Höhe | über 280 x 360 mm beim T-Shirt (Verkleinerungsrisiko kleiner Größen) | 1.2 |
| 6 | Farbmodus | CMYK-JPEG; Graustufen/Palette nur Hinweis | ohne Profil | 1.4 |
| 7 | Profil | | nicht Adobe RGB und nicht sRGB; sRGB bei Shirtigo: Hinweis | 1.4 |
| 8 | Hintergrund transparent | kein Alphakanal und Motiv deckt das ganze Rechteck (weißes Rechteck bei farbigen Textilien) | | 1.1 |
| 9 | Halbtransparenz (5.4) | über Schwelle bei farbigem Textil/DTF | unter Schwelle; bei weißem Textil nur Hinweis | 1.3 |
| 10 | Geisterpixel (Alpha 1 bis 12 außerhalb des Motiv-Rahmens) | | verhindern den automatischen Zuschnitt | 1.3 |
| 11 | Mindeststrichstärke | | unter 0,8 mm (10 px) | 1.5 |
| 12 | Kontrast Motiv zu Textilfarbe | | zu ähnlich (z. B. schwarzer Druck auf dunkelgrauem Textil) | 1.3 |
| 13 | Bittiefe, Interlace, APNG | APNG | 16 Bit, interlaced (Shirtigo-Verhalten unbelegt [U]) | 5.1 |
| 14 | `pHYs` | | fehlt oder nicht 11811 | 5.1 |

### 5.3 Halbtransparenz: was Druckereien typischerweise prüfen

| Anbieter/Quelle | Regel | Zahl |
|---|---|---|
| **Shirtigo** (Hersteller dieses Projekts) | Alpha 5 bis 99 % über geschlossenen Flächen und Fade-outs auf farbigen Textilien vermeiden; 100 % Alpha plus transparenter Hintergrund unproblematisch | **5 bis 99 %** (8 Bit: 13 bis 252) |
| Printify (Leitfaden) | Das RIP wertet jeden Pixel mit Deckkraft über 0 % als "weiß unterlegen"; "genau zwei Pixelarten: 100 % deckend oder 100 % transparent"; Verläufe per Halbton; Test mit rotem Hintergrund hinter dem Motiv | Schwelle 0 %; nur 0 oder 100 % |
| Gelato | Halbtransparente Elemente drucken im DTG evtl. schlecht; Halbton als Ersatz | keine |
| Printful | Halbtransparente Kanten/Verläufe/Schatten/Glühen vermeiden (Hilfeseite per Abruf gesperrt, nur über Suchzusammenfassung) | keine |
| DTF-Software-Anbieter (z. B. DTFWiz) | harter Alpha-Schwellenwert (Voreinstellung 144 = ca. 56 %), alles darüber voll, darunter transparent | 144/255 |

Quellen: https://printify.com/knowledge-hub/png-file-setup-for-tshirts/ , https://support.gelato.com/en/articles/8996354-what-are-the-guidelines-regarding-design-files-for-dtg-printing , https://help.printful.com/hc/en-us/articles/50264019148177-How-should-I-prepare-my-print-file-for-the-best-results (nicht abrufbar, 403), https://dtfwiz.com/fix/semi-transparent-pixels-dtf (Anbieter-Werkzeug, kein Druckerstandard).

Folgerung: Es gibt **keinen** veröffentlichten Prozentwert für "erlaubten Anteil" halbtransparenter Pixel. Die strengste und einfachste Branchenregel lautet "nur 0 oder 255", praktisch toleriert man aber den 1 bis 2 Pixel breiten Anti-Aliasing-Rand (unvermeidlich bei weichen Kanten, bei 300 dpi unsichtbar).

### 5.4 Algorithmus der App (eigene Festlegung, zur Prüfung am echten Druck)

1. `A` = alle Pixel mit Alpha 13 bis 252 (= 5 bis 99 %), `V` = alle Pixel mit Alpha größer 0.
2. Kantenpixel ausnehmen: Pixel aus `A`, die innerhalb von **2 px** sowohl ein volltransparentes (Alpha 0) als auch ein volldeckendes (Alpha 255) Pixel haben, gelten als normales Anti-Aliasing (Entfernungstransformation oder Dilatation, `imageproc`/eigener Code).
3. Rest `H` = flächige Halbtransparenz (Fade-outs, Schatten, Glühen, transluzente Flächen, breite weiche Ränder). **Anteil = |H| / |V|.** Schwellen: unter 0,1 % in Ordnung, 0,1 bis 1 % Warnung, über 1 % Fehler (farbige Textilien und DTF); bei weißen Textilien nur Hinweis (keine Unterlage). Schwellen konfigurierbar, nach den ersten Testdrucken nachjustieren. [U]
4. Anzeige: Heatmap der Pixel aus `H`, Hinweis auf die Shirtigo-Lösungen (Volltonfarbe, Halbton-Rasterung) und ein Knopf "Halbtransparenz in Raster umwandeln" (Dithering/Halbton mit der gewählten Textilfarbe).
5. Geisterpixel: Pixel mit Alpha 1 bis 12, die außerhalb des Rahmens der Pixel mit Alpha ab 13 liegen, verhindern laut Shirtigo den automatischen Zuschnitt und verkleinern das Motiv unnötig. Warnung plus Knopf "säubern".
6. Reinschwarz: nur `#000000` bleibt ohne Unterlage; beim Bereinigen "fast schwarz" (z. B. unter 5 % Helligkeit) auf `#000000` anbieten, wenn das gewollt ist (Shirtigo bestätigt keine Schwelle).

---

## 6. Offene Unsicherheiten (nach Wichtigkeit)

1. **Farbprofil bei Shirtigo:** Adobe RGB (1998) wird verlangt, ob ein eingebettetes sRGB/Adobe-Profil umgerechnet wird, ist unbelegt. Ein Testdruck mit Farbkarte (beide Varianten) klärt es; bis dahin Adobe RGB einbetten.
2. **Halbtransparenz-Schwellen** (0,1 %/1 %, Kantenradius 2 px) sind eigene Festlegungen, Shirtigo nennt nur den Bereich 5 bis 99 %.
3. **Druckplatten je Größe:** API-Daten zeigen für alle Größen dieselbe Fläche, das Helpcenter beschreibt kleinere Platten; Sicherheitsfläche 280 x 360 mm ist abgeleitet.
4. **Hoodie-Ärmel 100 x 400 mm** (Produktdaten) gegen "10 x 10 cm" (Helpcenter): Produktdaten gelten; Bedeutung des Feldes `processable_area_margin_from_top_mm` unklar.
5. **Mindestgröße 1000 px:** "oder" (API) gegen "und" (Designer).
6. **Poster A2:** Katalogwerte (600 x 847 mm) widersprechen dem Helpcenter (426 x 600 mm mit Anschnitt).
7. **Instagram:** 3:4-Raster nur über Drittquellen mit Maßen; offizielle Hilfe nennt Cover 420 x 654 (1:1,55). Instagram-Hilfe zu Fotos existiert in Fassungen mit 3:4 und 4:5. Sicherheitszonen sind Meta-**Anzeigen**-Werte. sRGB, JPEG-Qualität und Dateigrößengrenze organisch unbelegt.
8. **TikTok:** keine offiziellen Zahlen, Drittquellen uneins; konservativer Standard.
9. **Hintergrundentfernung:** keine belastbare Messung auf Grafiken/Logos; u2netp ohne Laufzeitdaten; BiRefNet-lite-Speicherbedarf bei 1024 px mit dem schnellen Export nicht belegt; Trainingsdaten-Restvorbehalt (DIS5K nichtkommerziell); `ort` ist noch Release Candidate.
10. **Mockups:** Nutzungsbedingungen für Shirtigo-Mockups nicht geprüft; Sketchfab/Poly-Pizza-Kontozwang nicht getestet.
11. **Katalog-JSON** (`/api/catalog`) ist undokumentiert und kann sich ändern; Preise (13,22 EUR/33,18 EUR brutto) sind Momentaufnahme vom 16.10.2026.
12. **Shirtigo-Motivrichtlinien** (u. a. "politisch/ideologisch kontrovers") können Satire-Motive treffen; Vorabklärung mit dem Support sinnvoll.

---

## 7. Empfohlene nächste Schritte (kurz)

1. Creator 2.0 und Cruiser 2.0 bestätigen (oder andere Wahl treffen), Katalogdaten in `printAreas` einfrieren.
2. Eine Muster-Box bei Shirtigo bestellen (Fotos für Mockups, Prüfung von Haptik/Farbe) und einen Testdruck mit Farbkarte (Adobe RGB gegen sRGB) und mit Halbtransparenz-Teststreifen (0,1 %, 1 %, Fade) machen.
3. IS-Net-Modell einmal laden, SHA-256 festhalten, als Release-Asset spiegeln; 10 Beispielmotive durchrechnen (Foto, Grafik, Text).
4. Prüfer zuerst als reine Rust-Bibliothek (`png`, `moxcms`) mit Testdateien bauen (Abschnitt 5.2).

---

## 8. Quellenverzeichnis (alle abgerufen am 2026-10-16)

**Shirtigo (Doku, API, Produkte)**
- https://cockpit.shirtigo.com/docs/ , /docs/getting-started/core-concepts , /docs/getting-started/customize-order-products/ , /docs/rest-api
- https://cockpit.shirtigo.com/docs/redocusaurus/plugin-redoc-0.yaml (OpenAPI/Swagger 2.0, 374.094 Byte)
- https://cockpit.shirtigo.com/de , https://cockpit.shirtigo.com/de/catalog , https://cockpit.shirtigo.com/de/catalog/product/organic-shirt , .../organic-hoodie
- https://cockpit.shirtigo.com/api/catalog?locale=de&page=1 bis 6 (undokumentiert, nur Abgleich)
- https://www.prinovia.com/de/ (Großauflagen-Marke)
- Helpcenter: https://helpcenter.shirtigo.de/ mit den in Abschnitt 1 genannten Artikeln (Dateiformat, Mindestmaße, Dateigröße, Druckfläche, Digitaldruck-Besonderheiten, DTG-Guideline, Halbtransparenzen, Halbtonrasterung, Farbechtheit, Farbtiefe, Weiß/Farbig, Platzierung, Brust-Emblem, Ärmeldruck, Posterdruck, Kappen, Mockups, Motiv-Richtlinien, Druckverfahren)
- Projekt: C:\Users\Nevuor\Code\cypher-shop (`catalog/products.mjs`, `server/fulfillment/shirtigo.mjs`, `docs/EINRICHTEN.md`), nur gelesen

**Social**
- https://help.instagram.com/1631821640426723/ , https://help.instagram.com/1038071743007909
- https://www.facebook.com/business/ads-guide/update/image/instagram-reels , https://www.facebook.com/business/ads-guide/update/image/instagram-feed , https://www.facebook.com/business/help/980593475366490?locale=en_US , https://www.facebook.com/business/help/2222978001316177?locale=en_US
- https://www.socialmediatoday.com/news/instagram-rolls-out-vertically-aligned-profile-grid/737777/ , https://www.socialmediatoday.com/news/instagram-introduces-thumbnail-post-editing-for-grids/813444/
- Drittquellen: https://planoly.com/blog/guide-to-instagrams-new-vertical-grid , https://postfa.st/blog/instagram-reel-cover-size-safe-zones , https://www.socialync.io/tools/safe-zones/instagram-reels , https://houseofmarketers.com/guide-to-safe-zones-tiktok-facebook-instagram-stories-reels/

**Hintergrundentfernung**
- https://github.com/danielgatis/rembg (und `rembg/sessions/*.py`, Release v0.0.0 API)
- https://github.com/ZhengPeng7/BiRefNet (README, Release v1) , https://huggingface.co/ZhengPeng7/BiRefNet , https://huggingface.co/onnx-community/BiRefNet_lite-ONNX , https://huggingface.co/senty-au/BiRefNet_lite-ONNX-dynamic , https://huggingface.co/PramaLLC/BEN2 , https://huggingface.co/briaai/RMBG-1.4 , https://huggingface.co/briaai/RMBG-2.0
- https://github.com/xuebinqin/U-2-Net , https://github.com/xuebinqin/DIS (DIS5K-Terms-of-Use) , https://github.com/plemeri/InSPyReNet , https://github.com/plemeri/transparent-background , https://github.com/ZHKKKe/MODNet
- https://www.creativeainews.com/articles/rembg-background-removal-models-tested-2026/
- https://github.com/pykeio/ort , https://ort.pyke.io/setup/linking , https://crates.io/crates/ort , https://github.com/microsoft/onnxruntime , https://github.com/tauri-apps/tauri/issues/6381

**Mockups**
- https://api.sketchfab.com/v3/search (Lizenzfilter cc0), https://poly.pizza/search/shirt , https://poly.pizza/search/hoodie , https://opengameart.org/content/t-shirt-and-hanger , https://api.polyhaven.com/assets?t=models , https://polyhaven.com/license , https://docs.ambientcg.com/license/ , https://www.blender.org/about/license/

**PNG und Halbtransparenz**
- https://www.w3.org/TR/png-3/ , https://docs.rs/png/0.18.1/png/struct.Info.html , https://docs.rs/moxcms/0.9.1/moxcms/struct.ColorProfile.html
- https://printify.com/knowledge-hub/png-file-setup-for-tshirts/ , https://support.gelato.com/en/articles/8996354-what-are-the-guidelines-regarding-design-files-for-dtg-printing , https://dtfwiz.com/fix/semi-transparent-pixels-dtf
