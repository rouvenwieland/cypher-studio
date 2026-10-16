---
titel: Motiv zur Druckdatei zu Shirtigo
beschreibung: Ein Motiv in Krita oder Inkscape anlegen, im Druckprüfer messen, als PNG für Shirtigo exportieren und dort hochladen.
lead: Ein Motiv geht nur so zu Shirtigo, wie es sauber gedruckt wird. Der Druckprüfer misst es gegen die Vorgaben, rechnet die Druckgröße mit und exportiert eine fertige PNG-Datei.
stand: Stand der App: im Bau. Die Schritte folgen dem Konzept für Version 0.1. Die Shirtigo-Werte stammen aus dem Hilfecenter (abgerufen am 16.10.2026) und liegen in der App als Profil-Datei, du kannst sie ohne Programmieren ändern.
reihenfolge: 2
---
![Ablauf: Motiv in Krita oder Inkscape, im Druckprüfer messen, als PNG exportieren, bei Shirtigo hochladen](svg:flow-druck)

## Motiv anlegen

Starte auf der Startseite von Cypher Studio mit einer Vorlage: **Shirt vorne** (330 × 450 mm) oder **Hoodie vorne** (330 × 280 mm). Die Datei landet im Projektordner und öffnet sich in Krita. Für Vektorgrafiken nimmst du Inkscape, dort ist die Druckfläche die Seite, in Millimetern.

Drei Dinge machen später Ärger, wenn du sie von Anfang an beachtest, nicht:

- **Transparenter Hintergrund.** Ohne ihn druckt Shirtigo auf farbiger Kleidung ein weißes Rechteck mit.
- **Keine Halbtransparenz.** Der Digitaldruck deckt immer zu 100 %. Weiche Verläufe nach Transparent werden zu einem grauen Schleier. Verrechne sie mit der Wunschfarbe oder rastere sie.
- **Auflösung.** Lege die Datei in der Wunschgröße bei 300 dpi an. Hochskalieren verbessert nichts.

## Im Druckprüfer messen

Öffne **Druck** in der Seitenleiste (<kbd>Strg</kbd>+<kbd>4</kbd>) und ziehe die Datei hinein, PNG, SVG oder Krita-Datei. Die Vorschau zeigt das Motiv auf der Druckfläche des gewählten Profils, zum Beispiel „Shirtigo · Unisex-Shirt · vorne · 330 × 450 mm“. In Cyan siehst du, was Cypher Studio misst: Rahmen der Druckfläche, Lineale, Maße und Problemstellen.

Rechts im Inspektor „Messung“ steht oben das Urteil, darunter Textilfarbe, Druckbreite mit der Auflösung, die daraus folgt („280 mm → 300 dpi“), und der Bericht. Fehler stehen zuerst, dann Hinweise. Die erfüllten Regeln sind eingeklappt.

| Regel | Grenze im Profil |
|---|---|
| Dateiformat | PNG mit Transparenz. JPG ist ein Hinweis, weil ein weißer Kasten mitgedruckt wird. |
| Pixelmaße | 1000 bis 10.500 px je Seite |
| Auflösung bei Druckgröße | ab 300 dpi erfüllt, 150 bis 299 Hinweis, darunter Fehler |
| Passt auf Druckfläche | höchstens 330 × 450 mm (Shirt) bzw. 330 × 280 mm (Hoodie) |
| Halbtransparenz | höchstens 0,5 % der Pixel (Richtwert des Kollektivs) |
| Weiche Kanten | Alpha-Verlauf höchstens 0,5 mm |
| Linienstärke | mindestens 0,8 mm |
| Schriftgröße | mindestens 5 pt, nur bei SVG prüfbar |
| Farbraum | RGB. CMYK ist ein Hinweis, die Farben verschieben sich beim Umrechnen. |
| Dateigröße | bis 16 MB erfüllt, bis 64 MB Hinweis, darüber Fehler |
| Kontrast zum Textil | höchstens 5 % des Motivs fast in Textilfarbe, etwa Schwarz auf schwarzem Shirt |

Passt eine Regel nicht, öffne ihre Zeile. Du siehst die Stelle im Motiv, die Erklärung mit Quelle und, wo es geht, einen Knopf **Beheben**.

:::hinweis
Beim Hoodie gelten zwei Zahlen: Shirtigo nennt in den Produktdaten 330 × 280 mm, in der DTG-Richtlinie eine Höhe bis 240 mm. Cypher Studio prüft gegen den strengeren Wert und zeigt die Quelle.
:::

## Als PNG exportieren

Wenn das Urteil **Druckbereit** lautet, klicke in der Ausgangsleiste unten auf **Für Shirtigo exportieren** (<kbd>Strg</kbd>+<kbd>Enter</kbd>). Cypher Studio schneidet transparente Ränder ab, rechnet auf die Druckgröße, bettet das von Shirtigo empfohlene Farbprofil Adobe RGB (1998) ein und schreibt die Auflösung in die Datei.

Der Dateiname folgt dem Muster `cypher_<kollektion>_<motiv>_<produkt>-<position>.png` und liegt im Projekt unter `Export/Druck/`, zum Beispiel `cypher_rauschen_signal_shirt-vorne.png`. Daneben liegt eine kleine Begleitdatei mit Position und Breite in Millimetern, falls du das Motiv im Designer genau setzen willst.

Sind noch Fehler offen, ist der Knopf gesperrt und sagt, warum. Mit **Trotzdem exportieren …** und einer Rückfrage geht es auch dann.

## Bei Shirtigo hochladen

Cypher Studio lädt nichts zu Shirtigo hoch und braucht dafür kein Konto. Nach dem Export öffnet **Shirtigo öffnen ↗** das Cockpit im Browser. Dort legst du das Produkt an, ziehst die PNG-Datei in den Designer und setzt die Position.

- Der Designer schneidet transparente Ränder beim Hochladen selbst ab. Die Position setzt du danach von Hand.
- Die Vorschauen im Designer sind unverbindlich.
- Ärmel und Nacken druckt Shirtigo immer im DTF-Verfahren, Metallic-Effekte und Neon gehen nicht, Gold wird ein Ockerton.
- **Bildschirm ist kein Farbbeweis.** Für kritische Farben bestellst du ein Probeshirt.

Weiter: [Social und Reels](/anleitung/social-und-reels/) für das Bild zum Drop, oder die [Einführung](/anleitung/) für die Einrichtung.
