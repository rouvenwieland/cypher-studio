---
titel: Social und Reels
beschreibung: Ein Motiv oder eine Ankündigung in alle Feed-Formate bringen, ohne dass Text unter Profilname oder Knöpfe rutscht, und ein Reel in Kdenlive anlegen.
lead: Ein Motiv oder eine Ankündigung in alle Formate: Post, Story, Reel und Reel-Cover. Cypher Studio zeigt die Sicherheitszonen und prüft, ob Text und Kontrast stimmen.
stand: Stand der App: im Bau. Die Schritte folgen dem Konzept für Version 0.1. Alle Zonen sind Richtwerte (Stand 10/2026) und liegen als Profil-Datei vor, weil die Plattformen für normale Beiträge keine festen Pixelwerte nennen.
reihenfolge: 3
---
![Reel- und Story-Format 1080 × 1920 Pixel mit Sicherheitszonen oben 220, unten 420 und rechts 120 Pixel](svg:zonen-reel)

## Die Formate

| Format | Maß | Wichtig |
|---|---|---|
| Post | 1080 × 1350 px (4:5), JPG | Im Profilraster wird er auf 3:4 zugeschnitten, rechts und links fallen je 34 px weg. |
| Story | 1080 × 1920 px (9:16), PNG | Oben und unten decken Bedienelemente das Bild ab. |
| Reel | 1080 × 1920 px (9:16), Video | Mindestens 30 Bilder pro Sekunde und 720 px, unten und rechts liegen Knöpfe und Beschreibung. |
| Reel-Cover | 1080 × 1920 px, JPG | Das Profilraster zeigt nur die Mitte: 1080 × 1440 px, vertikal zentriert. |

Alles Wichtige gehört in die sichere Fläche. Auf dem Bild oben ist sie ohne Schraffur. Bei Story sind es oben 250 und unten 340 Pixel, beim Reel oben 220, unten 420 und rechts 120 Pixel (Richtwerte).

## Eine Vorlage wählen

Öffne **Social** (<kbd>Strg</kbd>+<kbd>6</kbd>) und wähle oben ein Format oder **Alle**, dann zeigt Cypher Studio die vier Formate nebeneinander. Im Inspektor wählst du eine Vorlage, zum Beispiel **Drop-Ankündigung**, **Neues Motiv**, **Termin** oder **Zitat**. Eigene Vorlagen legst du im gemeinsamen Ordner unter `Vorlagen/Social/` ab.

## Inhalt und Welt

- **Überschrift:** Cypher Studio füllt die Zeile automatisch auf die volle Breite, du schreibst nur den Text.
- **Unterzeile, Datum und Uhrzeit** darunter.
- **Bild** aus der Bibliothek, zum Beispiel ein Mockup. Aus dem Mockup-Modul führt **Als Social-Bild weiter** direkt hierher.
- **Welt:** Kollektiv (Papier oder Tinte), Rauschen, Mittelwelle oder Gold-Lounge. Sie bestimmt Farben und Schrift.

Mit der Taste <kbd>S</kbd> (Fokus in der Vorschau) schaltest du die Sicherheitszonen ein. Sie liegen als schraffierte Fläche mit Namen und Maß auf dem Bild.

## Was Cypher Studio misst

- **Text in der Sicherheitszone.** Ragt Text hinein, steht dort zum Beispiel „Text liegt 38 px in der Zone ‚Bildunterschrift‘ (Reel)“ mit Markierung. Der Export bleibt möglich.
- **Kontrast** zwischen Text und Grund: mindestens 4,5 : 1.
- **Kleinste Schrift:** Richtwert mindestens 28 px bei 1080 px Breite.
- **Bildauflösung:** mindestens 1080 px Breite.

## Exportieren

Die Ausgangsleiste nennt, was entsteht: etwa „4 Dateien · Post JPG 1080 × 1350 · Story PNG 1080 × 1920 · Reel-Cover JPG 1080 × 1920 · sRGB“. Mit **Alle exportieren** (<kbd>Strg</kbd>+<kbd>Enter</kbd>) landen sie im Projekt unter `Export/Social/`. Cypher Studio liefert gleich in Zielgröße, damit die Plattform nicht ein zweites Mal skaliert. Für Text und harte Kanten nimmst du PNG.

## Ein Reel in Kdenlive anlegen

Im Menü `⋯` steht **Reel als Kdenlive-Projekt anlegen**. Es entsteht ein Projekt mit dem Profil 1080 × 1920 bei 30 fps und dem Titel als Clip. Kdenlive muss dafür eingerichtet sein (Programme → Kdenlive → Einrichtung). Zum Ausgeben nimmst du das Render-Profil **Reel (H.264, 1080 × 1920)**.

:::tipp
Das Titelbild eines Reels lässt sich nach dem Hochladen nicht mehr ändern. Prüfe das Cover im Vorschau-Format „Reel-Cover“, bevor du veröffentlichst.
:::

Weiter: [Motiv zur Druckdatei zu Shirtigo](/anleitung/motiv-zu-shirtigo/) oder [3D-Modell zum Shop](/anleitung/modell-zu-shop/).
