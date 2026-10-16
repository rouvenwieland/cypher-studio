# Konzept: Cypher Studio „Regie“ (Kanal 3)

Stand 16.10.2026. Tokens, Vertrag, Zustände und Anti-Vibecode-Liste: `DESIGN.md`. Variablen: `tokens.css`.
Alle Versionsnummern, Größen, Prüfsummen und Pfade in diesem Dokument sind **Beispielwerte**; echte Werte kommen aus dem signierten Programm-Manifest.

## 1. Konzept-Karte

| Feld | Inhalt |
|---|---|
| Idee (ein Satz) | Cypher Studio ist die Regie des Kollektivs: Jede Arbeit kommt als Quelle herein, liegt auf der Vorschau, wird gemessen und geht erst nach Abnahme auf den Ausgang, also ins Programm, in den Druck oder in den Feed. |
| Rolle in der Familie | Start = Kennung (der Sender), News = Sendezeit (Kanal 1), Shop = Empfang (Kanal 2), Pitch = Suchlauf. **Studio = Regie (Kanal 3)**: der Raum, in dem gemacht und abgenommen wird, bevor etwas gesendet wird. Gleiche Gerätesprache, eigene Achse: Messen. |
| Metapher | Bildregie im Sender. Dort sind Vorschau und Sendung getrennt, die Messgeräte stehen neben dem Bild, das Licht ist neutral grau, damit Farben stimmen. Nichts geht ungeprüft raus. |
| Zielgefühle | sicher · konzentriert · startklar |
| Hero-Moment | Erststart: ein Testbild in Fenstergröße. Der Suchlauf schneidet Kanal 1 (Orange) → 2 (Gelb) → 3 (Cyan) und rastet auf STUDIO ein, CYPHER und STUDIO füllen exakt die Breite. Ohne Text verständlich: ein Sender, der auf einen neuen Kanal schaltet. Danach Ruhe. |
| Signatur 1: Messspur | Was Studio misst, zeichnet es in Cyan auf das Werk: Druckfläche, Lineale, Maße, Sicherheitszonen, Problemstellen. Werte stehen auf Cyan-Chips, nie frei auf dem Motiv. Cyan bedeutet in der ganzen App nur „gemessen“ oder „Ausgang“. |
| Signatur 2: Ausgangsleiste | Jede Arbeitsansicht endet in derselben Leiste: links die Messzeile des Ergebnisses („PNG · 3898 × 5315 px · 300 dpi · 11,2 MB“), rechts genau eine Aktion, immer `Strg+Enter`. Gelingt sie, füllt sich die Leiste von links mit Cyan und das Ergebnis bleibt dort stehen. |
| Stützen (leise) | Bandbreite: Programmnamen füllen ihre Spalte exakt über Anybodys Breitenachse (Familientechnik). Gehäuse in Tinte mit invertierter gedrückter Taste (wie News). Zeitplan-Skala mit Nadel im Erststart (Familie: Skala). |
| Rhythmus | Erststart 5 (Kennung) → Arbeit 1–2 (alle Module, still) → Ausgang 3 (Füllung) → Arbeit 1–2. Webseite eigenes Kapitel. |
| Hauptpfad | Die Ausgangs-Aktion: rechts in der Ausgangsleiste, Cyan-Fläche mit Tintenschrift, `Strg+Enter`, bewegt sich nie, eine je Bildschirm. |
| Nicht tun | keine fremde Zentrale nachbauen (kein App-Raster mit Buchstabenkacheln, kein Entdecken-Feed, kein Konto), keine Logos, kein Kino im Arbeitsweg, keine Farbe hinter Bildern. Vollständig: DESIGN.md §8. |

## 2. Referenzen (Prinzip, nicht Look)

1. **Testbild FuBK und Philips PM5544, dazu die eigene Familie (Start „Testbild“, News „Zeitzeichen“).** Prinzip: Raster und Kreis sind sichtbar, Farbbalken sind Kanäle, Wörter füllen die Breite, Umschalten ist ein harter Schnitt. Übernommen: Kennung im Erststart, Cyan als nächster Balken, Moduswechsel = Schnitt, Bandbreite für Programmnamen, Gehäuse in Tinte.
2. **Bildregie (Vorschau und Sendung am Bildmischer, Waveform und Vektorskop neben dem Bild).** Prinzip: Beurteilen und Senden sind zwei Schritte; Messwerte stehen neben dem Bild, nicht darin; ein Knopf übernimmt auf Sendung. Übernommen: Vorschau | Messung | Ausgang in jedem Modul, `Strg+Enter` als „Übernehmen“.
3. **Farbabmusterung (Normlichtkabine, Softproof-Arbeitsplatz nach ISO 12646).** Prinzip: Ein unbuntes Umfeld ist Messbedingung, kein Stil. Übernommen: Umfeld hell/mittel/dunkel per Taste `U`, Tinte-Thema strikt unbunt, keine Kanalfarbe hinter Bildern.

Öffentlich bekannte Bedienmuster von Kreativ-Zentralen dienen nur als Muster: installierte Programme mit Status und „Starten“, gebündelte Updates, zuletzt bearbeitete Dateien auf der Startseite. Nicht übernommen: Raster aus Buchstabenkacheln, Entdecken-Feed mit Tutorials, Kontosystem, jede Marke, Farbe und Ikonografie.

## 3. Wie aus der Regie alles folgt

| Ebene | Ableitung |
|---|---|
| Layout | Drei Zonen in jedem Arbeitsmodul: **Vorschau** (der Monitor, links, groß, unbuntes Umfeld), **Messung** (die Messgeräte, Inspektor rechts), **Ausgang** (die Leitung nach draußen, Leiste unten). Wer ein Modul kann, kann alle. |
| Typografie | Anybody ist die Kennung (Sendername, ein Titel je Bildschirm, Programmnamen). Atkinson Hyperlegible Next ist die Bedienung. Martian Mono ist das Messgerät: Maße, dpi, Größen, Prüfsummen, Pfade, Kürzel. |
| Farbe | Cyan = gemessen oder Ausgang. Status als Ampel mit drei Formen. Alles, was neben einem Bild liegt, ist unbunt. |
| Bewegung | Umschalten = harter Schnitt (0 ms). Übernehmen = die Leiste füllt sich (240 ms). Senderkennung = Suchlauf, einmal, beim Erststart. |
| Mikrotexte | Knöpfe sagen, was passiert („Für Shirtigo exportieren“). Urteile sind ein Wort in Anybody: DRUCKBEREIT, EINGERICHTET, STARTKLAR. Fehler sagen, was sicher ist. Einziges Regie-Wort in der Oberfläche: die Etiketten AUSGANG und MESSUNG. |

## 4. Informationsarchitektur

### Navigation (Rail, Gehäuse in Tinte)

```
┌──────────────────────┐
│ CYPHER STUDIO        │  Kennungsbalken, Cyan, 56 px hoch; Klick = Start
├──────────────────────┤
│ Start         Strg+1 │
│ MATERIAL             │  Gruppenetikett, Mono 11 px, mute
│   Bibliothek  Strg+2 │
│   Programme   Strg+3 │
│ AUSGABE              │
│   Druck       Strg+4 │
│   Mockups     Strg+5 │
│   Social      Strg+6 │
│ EXTRA                │
│   Freistellen Strg+7 │  „optional“ in mute, bis das Modell geladen ist
│                      │
├──────────────────────┤
│ ■ Aufträge 2  Strg+J │  Quadrat = Lampe: Cyan läuft · Bernstein braucht dich · Rot gescheitert
│   Einstellungen  ⌃,  │
└──────────────────────┘
```

- Reihenfolge = Arbeitsweg: Material holen (Bibliothek, Programme), dann ausgeben (Druck, Mockups, Social). Freistellen ist ein Extra und steht am Ende, damit die Kürzel 1–6 stabil bleiben.
- Gewählter Eintrag: invertiert (Papier auf Tinte), Icon bleibt Regular. Hover: `--case-hover`.
- Unter 1180 px Fensterbreite schrumpft die Rail auf 56 px (nur Icons, Tooltip mit Name und Kürzel); der Kennungsbalken zeigt dann nur die Cyan-Fläche ohne Schrift, Tooltip „Cypher Studio · Start“ (bewusst kein Buchstabenlogo).
- Fenstertitel fürs Betriebssystem: „Druck – Cypher Studio“.

### Globale Werkzeuge

- **Befehle `Strg+K`** (Palette, `cmdk`): Module, Aktionen („Krita starten“, „Nach Updates suchen“, „Umfeld dunkel“), zuletzt geöffnete Dateien, Einstellungen. Eingabe „dr“ findet „Druck“, „Druckfläche wechseln“, „drop_signal_v3.png“.
- **Aufträge `Strg+J`**: Popover über der Rail-Lampe mit allen Hintergrundarbeiten (Laden, Installieren, Exportieren, Bibliothek lesen), je Zeile echter Fortschritt, Abbrechen, und den Ergebnissen der letzten 24 Stunden.
- **Meldungen**: Nur fertige Hintergrundarbeit meldet sich unten rechts über der Ausgangsleiste (eine Zeile, bleibt 6 s, bei Fehlern bis zum Schließen, immer auch in Aufträgen). Alles, was du gerade selbst ausgelöst hast, antwortet in der Ausgangsleiste, nicht als Meldung.

### Objekte

- **Gemeinsamer Ordner**: ein Ordner, den die fünf mit Syncthing, Nextcloud o. ä. teilen. Studio synchronisiert nicht selbst.
- **Projekt**: Unterordner `Projekte/<Name>/` mit `projekt.json` (Kollektion, Formate) und den Ordnern `Motive/`, `Export/Druck/`, `Export/Social/`, `Mockups/`.
- **Vorlage**: Datei unter `Vorlagen/` im gemeinsamen Ordner, dazu die mitgelieferten Grundvorlagen.
- **Tags**: je Datei eine kleine Begleitdatei in `.cypher/`, damit zwei Leute gleichzeitig taggen können, ohne dass der Sync Konfliktkopien erzeugt.
- **Auftrag**: jede Arbeit, die länger als eine Sekunde dauert.

### Querwege

Bibliothek → Druck, Mockups, Social, Freistellen (Inspektor-Aktionen und Kontextmenü) · Freistellen → Druck · Druck → „Mockup aus diesem Motiv“ · Mockups → „Als Social-Bild weiter“ · Programm-Detail → Einrichtung · überall: Datei → „In Krita öffnen“ (bzw. dem passenden Programm).

## 5. Das Gerüst

### Komposition bei 1280 × 800

```
 200                      744                                        336
┌────────────────┬──────────────────────────────────────────────┬───────────────────────┐
│ CYPHER STUDIO  │ DRUCK  signal_v3.png · 3307 × 3685 px  [Profil: Shirtigo · Unisex-Shirt · vorne ▾] │ 56  Titelzeile
├────────────────┼──────────────────────────────────────────────┼───────────────────────┤
│ Start          │                                      ⊞ ◐ ▦ ✓ │ MESSUNG               │
│ MATERIAL       │   ┊0    50    100   150   200   250   300 mm │ ▲ DRUCKBAR MIT        │
│  Bibliothek    │   ┌──────────────────────────────────────┐   │   HINWEISEN           │
│  Programme     │   │         Druckfläche 330 × 450 mm     │   │ 2 Hinweise · 0 Fehler │
│ AUSGABE        │   │        ┌──────────────┐              │   │───────────────────────│
│ ▌Druck         │   │        │    Motiv     │ 280,0 mm     │   │ Textil  ■ Schwarz ▾   │
│  Mockups       │   │        └──────────────┘              │   │ Breite  280 mm 300 dpi│
│  Social        │   │                                      │   │───────────────────────│
│ EXTRA          │   └──────────────────────────────────────┘   │ ▲ Halbtransparenz 2,1%│
│  Freistellen   │     Vorschau, Umfeld unbunt                  │ ▲ Linie 0,6 mm        │
│                │                                              │ ✓ 11 Regeln erfüllt ▸ │
├────────────────┼──────────────────────────────────────────────┴───────────────────────┤
│ ■ Aufträge 2   │ AUSGANG  Shirtigo · PNG · 3307 × 3685 px · 300 dpi · 9,4 MB  [Für Shirtigo exportieren  Strg+↵] │ 56
│   Einstellungen│                                                                       │
└────────────────┴───────────────────────────────────────────────────────────────────────┘
```

Bei 1024 × 680: Rail 56, Vorschau 648, Inspektor 320; Titelzeile und Ausgangsleiste 48. Unter 1024 gibt es nichts (Fenster-Minimum).

### Bausteine des Gerüsts

- **Titelzeile** (56, `--panel`, Haarlinie unten): links der Bildschirmtitel in Anybody (28 px, Versalien, `wdth 78`), daneben die Kontext-Messzeile (Mono 12, mute), rechts Profil- oder Ansichtswahl. Genau ein Titel je Bildschirm.
- **Vorschau** (`--surround-*`, unbunt): Werkzeugleiste oben rechts innerhalb der Vorschau (32-px-Icon-Knöpfe, Tooltip mit Kürzel): Einpassen `0`, 100 % `1`, Echtgröße `E`, Umfeld `U`, Raster `G`, Prüfmarken `P`, Messfarbe `M`. Diese Einzeltasten wirken nur, wenn die Vorschau den Fokus hat. Zoom mit `Strg+Mausrad`, Verschieben mit Leertaste + Ziehen oder Pfeiltasten.
- **Inspektor „Messung“** (`--panel`, Haarlinie links): oben das Urteil, darunter Einstellungen, darunter der Bericht. Scrollt allein, Kopf bleibt stehen.
- **Ausgangsleiste** (56, `--panel`, Haarlinie oben): Etikett AUSGANG (Mono 11), Ziel, Messzeile des Ergebnisses; rechts höchstens eine Textaktion und die Ausgangs-Aktion. Zustände:
  - *bereit*: Cyan-Fläche, Tintenschrift, rechts im Knopf das Kürzel in Mono („Strg+↵“).
  - *gesperrt*: neutraler Rahmenknopf mit Grund („1 Fehler zuerst beheben“); Klick springt zum ersten Fehler. Daneben als Textaktion „Trotzdem exportieren …“ mit Rückfrage.
  - *läuft*: der Knopf wird zum Fortschritt (Cyan füllt mit echtem Prozentwert, „Exportiere … 62 %“), daneben „Abbrechen“.
  - *erledigt*: die ganze Leiste füllt sich von links mit Cyan (240 ms, Vorhang), Tintenschrift „Gespeichert: …\Export\Druck\cypher_rauschen_signal_shirt-vorne.png“, rechts [Im Ordner zeigen]. Bleibt, bis du etwas änderst; dann Schnitt zurück auf *bereit*.
- **Messzeile** (Komponente, überall gleich): Paare aus Etikett (Mono 11, Versal, mute) und Wert (Mono 12), getrennt durch „ · “. In Leisten nur Werte, in Dialogen als zweispaltige Tabelle. Kürzungsreihenfolge bei Platzmangel: Pfade in der Mitte, dann Lizenzzusatz, nie Zahlen.
- **Kennungsbalken**: Cyan, CYPHER STUDIO in Anybody 800, Tinte, Bandbreite auf Railbreite minus 32 px. Gleiche Höhe wie die Titelzeile: Eine Linie läuft durch das Fenster.

### Seiten ohne Ausgang

Start, Bibliothek, Programme-Tafel und Einstellungen haben keine Ausgangsleiste. Dort löst `Strg+Enter` die Hauptaktion des gewählten Eintrags aus (Öffnen, Starten).

## 6. Bildschirme

### 6.1 Start

Zweck: in drei Sekunden zurück an die Arbeit, oder etwas Neues aus einer Vorlage anfangen. Keine Begrüßung, keine Kennzahlen.

```
START                                                        [Neues Projekt ⌃N]  [Datei öffnen ⌃O]
──────────────────────────────────────────────────────────────┬────────────────────────────────────
Projekte                                  D:\Sync\Cypher\Projekte │ Programme
──────────────────────────────────────────────────────────────│────────────────────────────────────
Herbst-Drop 26        ■ RAUSCHEN     14 Dateien   heute 14:32  │ KRITA     5.3.1         ■ eingerichtet
  zuletzt: rauschen_signal_v3.kra                              │ INKSCAPE  1.4.3 → 1.5.0 ▲ Update
Mittelwelle-Poster    ■ MITTELWELLE   6 Dateien   gestern      │ BLENDER   —             □ nicht installiert
Contenance-Kampagne   ■ GOLD-LOUNGE   9 Dateien   12.10.       │ KDENLIVE  lädt 64 %     ▬▬▬▬▬▬░░░
…                                                              │────────────────────────────────────
                                                               │ Gemeinsamer Ordner
Vorlagen                                                       │ D:\Sync\Cypher · 3.104 Dateien
┌──┐ ┌────┐ ┌──┐ ┌─┐ ┌─┐ ┌──┐ ┌───┐                            │ [Ordner wechseln]
│  │ │    │ │  │ │ │ │ │ │  │ │   │                            │
└──┘ └────┘ └──┘ └─┘ └─┘ └──┘ └───┘                            │
Shirt Hoodie Post Story Reel Poster Sticker                    │
```

- **Raster**: 12 Spalten im Inhalt; Projekte und Vorlagen über 8, Programme und Ordner über 4.
- **Projekte**: Index-Liste mit Haarlinien, Zeile 56 px: Name (Atkinson 15/600), Kollektion als Wort in Mono mit 8-px-Farbquadrat (Farbe ist hier Information, mit Kante), Dateizahl, Änderungszeit (Mono), zweite Zeile die zuletzt bearbeitete Datei (meta, in der Mitte gekürzt). Höchstens 6 Zeilen, dann „Alle 12 Projekte in der Bibliothek“.
  Bedienung: `↑ ↓` wählen, `Enter` öffnet das Projekt in der Bibliothek, `Strg+Enter` öffnet die zuletzt bearbeitete Datei im passenden Programm, Kontextmenü: Im Ordner zeigen, Kollektion ändern.
- **Vorlagen (Formatleiste)**: Jede Vorlage steht in ihrem echten Seitenverhältnis, alle auf gleicher Höhe (112 px): Shirt vorne 330 × 450 mm, Hoodie vorne 330 × 280 mm, Post 1080 × 1350, Story 1080 × 1920, Reel 1080 × 1920 (Kdenlive), Poster A2, Sticker 1:1. Unter jeder: Name (ui 600), Maß (Mono 12), „öffnet in KRITA“ (Etikett). Die unterschiedlich breiten Rahmen lesen sich wie Testbild-Balken und erklären die Formate ohne Text.
  `← →` wählen, `Enter` öffnet ein kleines Popover: „Name: herbst-drop_signal · Projekt: Herbst-Drop 26“ [Anlegen und in Krita öffnen ⌃↵]. Die Datei landet im Projektordner.
- **Programme**: Zeilen 40 px, Name in Anybody 800 als Bandbreite auf 104 px Spaltenbreite (KRITA breit, KDENLIVE schmal), Version (Mono), Status (Glyph + Wort), rechts die Zeilenaktion als Textknopf (Starten, Installieren, Aktualisieren). Klick auf die Zeile = Programm-Detail.
- **Leerzustände**: kein Ordner → Projekte-Bereich: „Noch kein gemeinsamer Ordner. Wähle den Ordner, den ihr teilt, dann erscheinen hier eure Projekte.“ [Ordner wählen]. Ordner ohne Projekte → „In D:\Sync\Cypher gibt es noch keinen Ordner ‚Projekte‘.“ [Erstes Projekt anlegen]. Erststart nicht beendet → Zeile ganz oben: „Einrichtung zu 60 % · noch etwa 12 Min.“ [Weitermachen].

### 6.2 Programme

**Tafel** (Liste aller vier, keine Karten):

```
PROGRAMME                                                              [Nach Updates suchen]
──────────────────────────────────────────────────────────────────────────────────────────
KRITA          MALEN · FOTO     5.3.1            ■ eingerichtet         [Starten]
INKSCAPE       VEKTOR · DRUCK   1.4.3 → 1.5.0    ▲ Update verfügbar     [Aktualisieren]
BLENDER        3D               —                □ nicht installiert    [Installieren]
KDENLIVE       VIDEO            lädt 64 %        ▬▬▬▬▬▬▬░░░  90 / 140 MB [Abbrechen]
──────────────────────────────────────────────────────────────────────────────────────────
Alle Programme kommen unverändert aus ihren offiziellen Quellen.   Markenhinweise
```

- Zeile 72 px. Erste Spalte 280 px: Name in Anybody 800, jedes Wort exakt 280 px breit (Bandbreite), Versalhöhe ca. 36 px. Rolle als Etikett, Version in Mono (`→` zeigt Update), Status als Glyph + Wort, Aktion als Knopf (die Zeilen-Hauptaktion; `Strg+Enter` bei gewählter Zeile).
- `↑ ↓` wählen, `Enter` öffnet das Detail, `Strg+Enter` führt die Zeilenaktion aus, `U` sucht nach Updates (nur bei Fokus in der Tafel).
- Status-Wörter: nicht installiert · wird geladen · wird geprüft · wird installiert · installiert · eingerichtet · Update verfügbar · gefunden (außerhalb von Studio installiert) · Fehler.

**Detail** (`Programme / Krita`, `Esc` oder `Alt+←` zurück):

```
Programme / Krita                                                      [Starten ⌃↵]  [⋯]
KRITA ────────────────────────────────────────────────── (Bandbreite über 8 Spalten, ≤ 112 px hoch)
MALEN · FOTO
QUELLE download.kde.org · VERSION 5.3.1 · GRÖSSE 540 MB · LIZENZ GPL-3.0-or-later · PRÜFSUMME ✓ · ZIEL …\Programme\Krita\5.3.1
[Übersicht]  [Einrichtung]  [Verlauf]
```

- *Übersicht*: ein Satz, wofür das Kollektiv Krita nutzt („Motive malen, Fotos bearbeiten, Druckdateien als PNG ausgeben“); die letzten fünf Krita-Dateien aus der Bibliothek; Update-Zeile; im Menü `⋯`: Im Ordner zeigen, Deinstallieren.
- *Einrichtung*: siehe 6.3.
- *Verlauf*: Installationen, Updates, Einrichtungen mit Zeit, Version und Prüfsumme; je Einrichtung [Wiederherstellen].
- Deinstallieren fragt: „Krita 5.3.1 deinstallieren? Gelöscht wird …\Programme\Krita\5.3.1 (540 MB). Deine Krita-Dateien und die Einrichtung bleiben.“ [Deinstallieren] [Abbrechen].

**Installationsdialog** (modal, 600 px breit, natives `<dialog>`; modal, weil hier Zustimmung gefragt ist):

```
Krita installieren                                                              ×
────────────────────────────────────────────────────────────────────────────────
QUELLE      download.kde.org/stable/krita/5.3.1/            offizielle Quelle ✓
VERSION     5.3.1 · stabil · erschienen 02.10.2026
GRÖSSE      182 MB laden · 540 MB auf dem Datenträger · frei auf C: 212 GB
LIZENZ      GPL-3.0-or-later · frei nutzen, weitergeben, verändern   [Lizenztext]
PRÜFSUMME   SHA-256  9f3a 1c0e … 77b2 d4e1
            aus dem signierten Cypher-Manifest · wird nach dem Laden verglichen
ZIELORDNER  C:\Users\…\AppData\Local\CypherStudio\Programme\Krita\5.3.1  [Ändern]
            ohne Administratorrechte
────────────────────────────────────────────────────────────────────────────────
DANACH      ☑ Mit Cypher-Paletten, Schriften und Vorlagen einrichten
────────────────────────────────────────────────────────────────────────────────
ZUSTIMMUNG  Cypher Studio lädt genau diese Datei aus dieser Quelle, vergleicht
            die Prüfsumme und installiert nur, wenn sie stimmt.
                                        [Abbrechen]  [Laden und installieren  Strg+↵]
```

- Etiketten Mono 11, Werte Mono 12 (Pfade, Hashes) bzw. Atkinson 14 (Sätze). Die Prüfsumme steht in Vierergruppen; „Details“ zeigt alle 64 Zeichen in zwei Zeilen zu je acht Gruppen, kopierbar.
- Die Zustimmung ist der beschriftete Knopf, kein Pflicht-Häkchen: Die GPL verlangt für die Nutzung keine Annahme. Hat ein Paket Bedingungen, die man annehmen muss (z. B. ein Modell mit eigener Lizenz), erscheint ein Häkchen „Ich habe die Bedingungen gelesen“ und der Knopf ist bis dahin gesperrt (mit Grund).
- „Warum diese Quelle?“ öffnet eine Zeile: „Steht im Cypher-Manifest als offizielle Quelle von Krita. Weiterleitungen nur zu Spiegeln derselben Liste.“

**Fortschritt** (gleicher Dialog, unterer Teil wird zur Phasenliste):

```
✓ Laden          182 / 182 MB · 6,1 MB/s
◼ Prüfen         SHA-256 wird verglichen  ▬▬▬▬▬▬▬░░
○ Installieren
○ Einrichten
                                   [Im Hintergrund weiter]  [Abbrechen]
```

Phasen mit echtem Fortschritt (`<progress>`, `aria-valuetext="Laden 74 von 182 MB"`). Beim Prüfen läuft die Messspur sichtbar: die Prüfsumme füllt sich Gruppe für Gruppe in Cyan, so schnell wie gerechnet wird; am Ende stehen erwartete und berechnete Summe übereinander, jede Gruppe ✓. „Im Hintergrund weiter“ schließt den Dialog, der Auftrag lebt in der Rail-Lampe weiter. Abbrechen löscht Teildateien und sagt das.

**Fehler** (im Dialog, Fehlerfläche über der Phasenliste, Texte siehe DESIGN.md §7). Der schwerste Fall, Prüfsumme falsch, bekommt eine eigene Ansicht:

```
■ Die geladene Datei ist nicht die erwartete.
  Wir haben sie gelöscht. Installiert wurde nichts.
ERWARTET   9f3a 1c0e 5b7d …  77b2 d4e1
BERECHNET  4c19 e2aa 0f63 …  1d08 9b3c
Das passiert bei abgebrochenen Downloads oder einem veränderten Spiegel.
                        [Details kopieren]  [Von anderem Spiegel laden]
```

### 6.3 Einrichtung je Programm

Zweck: Krita, Inkscape, Blender und Kdenlive kennen danach die Cypher-Farben, -Schriften und -Formate. Alles umkehrbar.

```
Einrichtung                                       Cypher-Paket 2026.10 · teilweise (3 von 4)
──────────────────────────────────────────────────────────────────────────────────────────
☑ Palette „Cypher Kollektionen“   ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮  17 Farben   …\krita\palettes\cypher.kpl   ■ aktuell
☑ Schriften                        Anybody · Atkinson Hyperlegible Next · Martian Mono   ▲ veraltet
☑ Vorlagen                         Shirt vorne 330 × 450 mm · Hoodie 330 × 280 mm ·      □ neu
                                   Post 1080 × 1350 · Story 1080 × 1920
☐ Arbeitsfläche „Cypher“           (optional)                                            ◆ von dir geändert
──────────────────────────────────────────────────────────────────────────────────────────
AUSGANG  3 Bausteine · 1 neu · 1 aktualisiert · Sicherung wird angelegt     [Einrichtung anwenden  Strg+↵]
```

- Zeilen als Tabelle: Häkchen, Baustein, Vorschau (Palette als Farbstreifen mit Namen im Tooltip; Vorlagen als Maße), Ziel (Mono, Mitte gekürzt), Status (Glyph + Wort: aktuell, neu, veraltet, von dir geändert).
- Inhalt der Palette (17 Farben, aus Marke und Shop-Katalog): Tinte `#0d0d0d`, Papier `#efeee9`; Kanäle News `#ff4f12`, Shop `#e4f531`, Studio `#00d4d8`; Rauschen `#0b0b0a`; Mittelwelle `#1f2bd0`, `#f3f4f7`; Gold-Lounge `#c9a03f`, `#a47c2a`, `#0d0a05`; Textilfarben (Platzhalter laut Katalog) Schwarz `#141210`, Weiß `#f2efe8`, Grau meliert `#8c8a86`, Navy `#1d2738`, Sand `#cdbb9a`, Creme `#efe4cc`.
- Je Programm (Bausteine): **Krita** Palette `.kpl`, Dokumentvorlagen (Shirt 3898 × 5315 px bei 300 dpi, Hoodie 3898 × 3307 px, Post, Story). **Inkscape** Palette `.gpl`, Vorlagen mit Druckfläche als Seite in mm, Export-Voreinstellung 300 dpi. **Blender** Asset-Bibliothek auf `<Ordner>/3D` verweisen, Mockup-Szene, Palette für Texturmalen; keine Änderung der Startdatei. **Kdenlive** Projektprofile 1080 × 1920 und 1080 × 1350 bei 30 fps, Titelvorlagen mit Cypher-Schriften, Render-Profil „Reel (H.264, 1080 × 1920)“. **Schriften** für alle: im Benutzer-Schriftordner, ohne Administratorrechte.
- „Von dir geändert“: Studio überschreibt nie still. Wahl in der Zeile: [Überschreiben] [Daneben ablegen als cypher-2026-10.kpl].
- Nach dem Anwenden füllt sich die Ausgangsleiste: „Angewendet 14:32 · Sicherung angelegt · Krita neu starten, damit die Palette erscheint“ [Rückgängig] [Krita starten]. Rückgängig stellt die Sicherung her und bleibt bis zur nächsten Anwendung möglich; ältere Sicherungen unter *Verlauf*.
- Läuft das Programm: Hinweis, kein Abbruch („Krita ist geöffnet. Neue Paletten erscheinen nach einem Neustart.“); gesperrte Dateien werden als Fehler je Zeile gemeldet.

### 6.4 Druckprüfer

Zweck: Ein Motiv geht nur so zu Shirtigo, wie es sauber gedruckt wird. Profil-Datei `profiles/shirtigo.json`, Werte aus dem Shirtigo-Hilfecenter (abgerufen 16.10.2026), Quelle je Regel verlinkt.

- **Titelzeile**: DRUCK · Dateichip „signal_v3.png ×“ · Profilwahl: „Shirtigo · Unisex-Shirt · vorne · 330 × 450 mm“, weitere: Hoodie vorne (330 × 280 mm, Höhe ≤ 240 mm laut DTG-Richtlinie, es gilt der strengere Wert), Rücken (Breite ≤ 350 mm), Brust-Emblem (80–110 mm, höchstens 150 mm).
- **Vorschau**: Die Druckfläche liegt auf der gewählten Textilfarbe, das Umfeld daneben bleibt unbunt. Messspur: Rahmen der Druckfläche, Lineale oben und links mit Strich alle 10 mm und Zahl alle 50 mm (Mono 11 auf Chip), Mittelachse gestrichelt, Rahmen des Motivs mit Maßlinien und Chip „280,0 × 312,0 mm“. Raster `G`: 10-mm-Gitter in Messfarbe mit 25 % Deckkraft. Prüfmarken `P`: Halbtransparenz 45°-schraffiert, zu dünne Linien kreuzschraffiert, beides in Bernstein. Echtgröße `E` zeigt das Motiv in Millimetern am Bildschirm (einmalig mit Lineal kalibriert unter Einstellungen → Arbeitsfläche).
- **Inspektor „Messung“**:
  1. Urteil (Statusfläche über die ganze Breite, 64 px, Glyph + Anybody 22): DRUCKBEREIT · DRUCKBAR MIT HINWEISEN · NICHT DRUCKBAR, darunter „2 Hinweise · 0 Fehler · 1 nicht geprüft“.
  2. Textil: Farbfelder aus dem Shop-Katalog (Schwarz, Weiß, Grau meliert, Navy, Sand, Creme), Radiogruppe mit Pfeiltasten, Name des gewählten Felds sichtbar.
  3. Größe: Druckbreite in mm (Eingabefeld + Schieberegler), daneben live die effektive Auflösung („280 mm → 300 dpi“; „330 mm → 254 dpi ▲“). Platzierung: Brust mittig / Brust links / Rücken.
  4. Bericht: Fehler zuerst, dann Hinweise, dann „11 Regeln erfüllt ▸“ (eingeklappt). Zeile: Glyph, Regel, Messwert (Mono), Grenze (mute). Aufklappen zeigt Erklärung, Quelle und, wo es geht, [Beheben].

| Regel | Messung | Grenze (Profil) | Beheben |
|---|---|---|---|
| Dateiformat | PNG / JPG / SVG / KRA | PNG mit Transparenz; JPG = Hinweis „weißer Kasten wird mitgedruckt“ | Export erzeugt PNG |
| Pixelmaße | Breite, Höhe in px | 1000–10.500 px je Seite (Fehler außerhalb) | – |
| Auflösung bei Druckgröße | dpi | ≥ 300 erfüllt · 150–299 Hinweis · < 150 Fehler | Druckbreite verringern |
| Passt auf Druckfläche | mm | ≤ 330 × 450 mm (Profil) | auf Fläche einpassen |
| Transparenter Hintergrund | Randpixel | Ränder transparent | – |
| Halbtransparenz | Anteil Pixel mit Alpha 1–254 außerhalb der Kantenglättung | ≤ 0,5 % (Cypher-Richtwert; Shirtigo: grauer Schleier auf farbigem Textil, bei DTF nicht machbar) | Alpha auf 0 oder 100 % runden (Schwelle wählbar) |
| Weiche Kanten | Breite des Alpha-Verlaufs | ≤ 0,5 mm (sonst weißer Rand) | Kanten härten |
| Linienstärke | dünnste deckende Linie | ≥ 0,8 mm | – (Hinweis mit Stelle) |
| Schriftgröße | kleinste Schrift | ≥ 5 pt; nur bei SVG prüfbar, sonst „nicht geprüft“ | – |
| Farbraum | Modus, Profil | RGB mit Profil; CMYK = Hinweis (wird umgerechnet, Farben verschieben sich) | in RGB umrechnen |
| Dateigröße | MB | ≤ 16 MB erfüllt (Grenze des Produktdesigners) · bis 64 MB Hinweis · darüber Fehler | leere Ränder abschneiden, verlustfrei stärker packen |
| Kontrast zum Textil | Motivanteil mit ΔE00 < 10 zur Textilfarbe | ≤ 5 % (Cypher-Richtwert; z. B. Schwarz auf schwarzem Shirt) | – (Hinweis mit Stelle) |
| Transparente Ränder | Rand in mm | werden beim Hochladen entfernt (Info) | Export schneidet zu |

- **Ausgangsleiste**: „AUSGANG Shirtigo · PNG · 3307 × 3685 px · 300 dpi · RGB · 9,4 MB“ [Für Shirtigo exportieren ⌃↵]. Dateiname: `cypher_<kollektion>_<motiv>_<produkt>-<position>.png`, Ziel `Projekt/Export/Druck/`. Bei Fehlern gesperrt mit Grund, „Trotzdem exportieren …“ mit Rückfrage. Erledigt: Leiste füllt sich, [Im Ordner zeigen] [Shirtigo öffnen ↗].
- **Messlauf**: Datei rein → Vorschau sofort, Regeln stehen mit „—“, jede Zeile bekommt ihren Wert, sobald sie fertig ist (Arbeit in Rust, parallel). Unter 150 ms gesamt: alles auf einmal, ohne Animation. Danach `aria-live`: „Prüfung fertig: 2 Hinweise, 0 Fehler.“
- **Leer**: Die leere Druckfläche mit Linealen ist das Bild; darin „PNG, SVG oder Krita-Datei hierher ziehen“ [Datei wählen ⌃O] · „oder aus der Bibliothek“.
- Ehrlichkeit: unter der Vorschau klein „Bildschirm ist kein Farbbeweis. Für kritische Farben ein Probeshirt bestellen.“

### 6.5 Mockups

Zweck: Ein Motiv auf Shirt oder Hoodie in den Kollektionsfarben sehen und als Bild für Shop und Feed ausgeben.

- **Vorschau**: eigenes Grundbild (vom Kollektiv in Blender gerendert, mit Faltenkarte, keine Stock-Mockups mit unklarer Lizenz), Motiv folgt den Falten. Bühne dahinter wählbar. `K` schaltet den **Kontaktbogen**: alle Textilfarben des Produkts im Raster 3 × 2, gleiche Platzierung, darunter Farbname, um in einem Blick zu entscheiden.
- **Inspektor**: Produkt (Umschalter Shirt | Hoodie) · Ansicht (vorne | hinten) · Farbe (Felder aus dem Katalog, Mehrfachwahl für den Export) · Platzierung (Brust mittig 280–300 mm breit, Brust links 80–110 mm, 80 mm von der Mitte, Rücken Schulterhöhe 300 mm – Werte aus der Shirtigo-Richtlinie, als Felder in mm änderbar) · Bühne (Unbunt, Papier, Rauschen `#e4f531`, Mittelwelle `#1f2bd0`, Gold-Lounge `#c9a03f`).
- **Messung**: „Motivbreite 280 mm entspricht 2 von 3 Druckflächen-Dritteln“, „Motiv ohne Transparenz“ (Hinweis), „Kontrast zum Textil“ (gleiche Regel wie Druckprüfer).
- **Ausgangsleiste**: „AUSGANG 6 Bilder · PNG · 2000 × 2500 px (Shop 4:5)“ [Mockups exportieren ⌃↵]; Formatwahl im Inspektor: Shop 2000 × 2500, Post 1080 × 1350, Story 1080 × 1920. Weiter-Aktion nach Erfolg: [Als Social-Bild weiter].
- **Leer**: Grundbild ohne Motiv, „Motiv aus der Bibliothek wählen oder hierher ziehen“.
- Kennzeichnung im Export-Dateinamen und im Bild-Alt-Text-Vorschlag: „Ansicht, Farbe kann abweichen“.

### 6.6 Social

Zweck: Ein Motiv oder eine Ankündigung in alle Feed-Formate bringen, ohne dass Text unter Profilname oder Knöpfe rutscht.

- **Titelzeile**: SOCIAL · Formatleiste als Tabs mit kleinen Rahmen in echtem Verhältnis: [4:5 Post] [9:16 Story] [9:16 Reel] [Reel-Cover] [Alle]. Pfeiltasten wechseln, „Alle“ zeigt die vier nebeneinander auf gleicher Höhe.
- **Vorschau**: gewähltes Format groß. Sicherheitszonen `S` (Messspur, schraffiert, Zonen-Chip mit Namen und Maß): Story oben 250 px, unten 340 px; Reel oben 220 px, unten 420 px, rechts 120 px; Post: Rasterzuschnitt 3:4 im Profil (1012 × 1350 sichtbar, je 34 px links und rechts weg); Reel-Cover: Profilraster 3:4 zeigt 1080 × 1440 mittig. Alle Werte sind Richtwerte (Stand 10/2026) aus `profiles/social.json`.
- **Inspektor**: Vorlage (Liste mit Vorschaubildern: „Drop-Ankündigung“, „Neues Motiv“, „Termin“, „Zitat“; eigene Vorlagen aus `Vorlagen/Social/`) · Inhalt (Überschrift mit Bandbreite: füllt die Zeile automatisch; Unterzeile; Datum und Uhrzeit; Bild aus der Bibliothek) · Welt (Kollektiv Papier/Tinte, Rauschen, Mittelwelle, Gold-Lounge) · Messung: Text in Sicherheitszone, Kontrast Text/Grund (≥ 4,5:1), kleinste Schrift (Richtwert ≥ 28 px bei 1080 px Breite), Bildauflösung (≥ 1080 px Breite).
- **Ausgangsleiste**: „AUSGANG 4 Dateien · Post JPG 1080 × 1350 · Story PNG 1080 × 1920 · Reel-Cover JPG 1080 × 1920 · sRGB“ [Alle exportieren ⌃↵]. Im Menü `⋯`: „Reel als Kdenlive-Projekt anlegen“ (Profil 1080 × 1920, 30 fps, Titel als Clip).
- **Leer**: Vorlagenliste ist der Inhalt: „Wähle eine Vorlage. Text und Bild füllst du rechts aus.“

### 6.7 Bibliothek

Zweck: den gemeinsamen Ordner schneller durchsuchen als im Datei-Explorer, mit Vorschaubildern auch für `.kra`, `.svg`, `.blend` und Videos.

```
BIBLIOTHEK   D:\Sync\Cypher   [Ordner wechseln]        [Suchen in 3.104 Dateien  ⌃F]  [▦ ☰]  [Geändert ▾]
──────────────────┬───────────────────────────────────────────────────────┬──────────────────────
ART               │ ┌────┐ ┌────┐ ┌────┐ ┌────┐                          │ (Inspektor bei Auswahl)
☐ Bild       1.840│ │    │ │    │ │    │ │    │                          │ Vorschau groß
☐ Vektor       412│ └────┘ └────┘ └────┘ └────┘                          │ QUELLE / MASSE / …
☐ 3D            96│ rauschen_sig…_v3.kra                                 │ Tags  [+]
☐ Video         38│ KRA · 4,2 MB                                         │ [In Krita öffnen ⌃↵]
KOLLEKTION        │                                                      │ [Im Druck prüfen]
☐ Rauschen     610│                                                      │ [Mockup erzeugen]
☐ Mittelwelle  230│                                                      │
☐ Gold-Lounge  118│                                                      │
TAGS              │                                                      │
☐ final         64│                                                      │
```

- **Filterspalte** (216 px): Art, Kollektion, Tags, Zeitraum als Kästchen mit Zahlen (Mono); aktive Filter erscheinen als Zeile über dem Raster: „Rauschen · final · ×“ [Alle Filter lösen].
- **Raster**: Zellen 160 px (Dichte), Bild eingepasst (nicht beschnitten, damit Formate ehrlich bleiben) auf unbuntem Umfeld, Name in Atkinson 13 (zwei Zeilen, Mitte gekürzt), Typ und Größe in Mono 11. Gewählt: 2px Rahmen in `--fg` + gefülltes Häkchenquadrat oben links. Liste `☰` als Tabelle mit sortierbaren Spalten (Name, Art, Kollektion, Tags, Geändert, Größe).
- **Bedienung**: Pfeiltasten im Raster, `Leertaste` große Schnellansicht, `Enter` öffnet im passenden Programm, `T` Tags (bei Fokus im Raster), `Strg+A`, `Umschalt`-Klick für Bereiche, `Strg+F` Suche (Name, Tags, Projekt).
- **Mehrfachauswahl**: Leiste unten statt Ausgang: „3 ausgewählt“ [Tags setzen] [Kollektion] [Im Druck prüfen] [Im Ordner zeigen].
- **Ordner wählen**: nativer Ordnerdialog, dann kurze Zusammenfassung „3.104 Dateien · 41 GB · 12 Projekte gefunden“ [Diesen Ordner nutzen]. Hinweis: „Cypher Studio synchronisiert nicht selbst. Nutzt einen Ordner von Syncthing, Nextcloud oder einem ähnlichen Dienst.“
- **Leer**: siehe Start; Filter ohne Treffer: „Keine Datei passt zu ‚Gold-Lounge‘ + ‚Video‘.“ [Filter lösen].

### 6.8 Freistellen (optional)

Zweck: Hintergrund eines Fotos oder Scans entfernen, lokal, für Druck und Mockups.

- **Erster Besuch**: Modul erklärt in zwei Sätzen, was es tut und dass es ein Modell braucht; [Modell laden] öffnet den Installationsdialog mit denselben sechs Feldern (Beispiel: Quelle huggingface.co/…, Größe 176 MB, Lizenz MIT, Prüfsumme, Zielordner). Nur Modelle mit kommerziell nutzbarer Lizenz (z. B. BiRefNet MIT, U²-Net Apache-2.0); **nicht** BRIA RMBG (nur nicht-kommerziell), weil das Kollektiv Merch verkauft.
- **Vorschau**: Vorher/Nachher mit Trennlinie (ziehen oder `← →` 5 %, `Umschalt` 25 %), Hintergrund wählbar: Schachbrett, Textilfarbe, Papier, Tinte. Die Kante zeigt die Messspur, wo Alpha unsicher ist.
- **Inspektor**: Kante (Hart ↔ Weich, mit Hinweis „Für den Druck hart, sonst grauer Schleier“), Halbtransparenz entfernen (Schwelle 50 %), Messung: „Halbtransparente Pixel 0,4 %“, „Weiche Kante 0,3 mm“.
- **Ausgangsleiste**: „AUSGANG PNG mit Transparenz · 4000 × 5000 px“ [Freigestellt speichern ⌃↵]; nach Erfolg [Im Druckprüfer öffnen].
- **Leer**: „Bild hierher ziehen. Läuft auf deinem Rechner, kein Bild verlässt den Computer.“

### 6.9 Einstellungen und Updates

Zwei Spalten: Abschnittsliste links (240 px), Inhalt rechts (Lesemaß 64ch für Erklärtexte).

- **Darstellung**: Thema (System · Papier · Tinte) · Dichte (Kompakt · Normal · Groß) · Bewegung (System · Reduziert · Voll) · App-Zoom (50–200 %).
- **Arbeitsfläche**: Standard-Umfeld je Thema · Messfarbe (Cyan · Magenta · Tinte · Papier) · Echtgröße kalibrieren (Linie auf 100 mm ziehen, mit Lineal am Bildschirm messen).
- **Programme**: Installationsordner · Manifest-Quelle (nur lesen) · „Außerhalb von Studio installierte Programme suchen“.
- **Bibliothek**: gemeinsamer Ordner · Vorschaubilder neu erzeugen · Speicher für Vorschaubilder (Größe, [Leeren]).
- **Profile**: Shirtigo und Social als Tabellen, mit Quelle und Abrufdatum je Wert; [Profil-Ordner öffnen].
- **Updates**: „Cypher Studio 0.4.0 · aktuell · geprüft heute 12:10“ [Jetzt prüfen] · Automatisch prüfen (täglich · wöchentlich · nie) · Erklärung: „Updates werden nur installiert, wenn sie mit dem Schlüssel des Kollektivs signiert sind.“ · Programm-Updates gebündelt mit [Alle aktualisieren]. Update bereit → Zeile in der Rail über den Aufträgen: „Update 0.5.0 bereit · Neu starten“.
- **Netzwerk und Daten**: Liste aller Adressen, die Studio anfragt (Manifest und Updates, die vier Programmquellen, Modellquelle), keine Telemetrie, keine Konten.
- **Tastenkürzel**: Liste, einzeln änderbar, Einzeltasten abschaltbar.
- **Über und Lizenzen**: Version, Lizenzen aller Bestandteile, OFL-Texte der Schriften, Markenhinweise (DESIGN.md §6).

### 6.10 Erststart „In 30 Minuten startklar“

Vollfenster ohne Rail. Jederzeit „Später weitermachen“ (oben rechts); der Stand bleibt erhalten, Start zeigt dann „Einrichtung zu 60 %“.

**0 · Kennung (3 s, einmal).** Testbild in Fenstergröße: sichtbares 12-Spalten-Raster aus Haarlinien, Haarlinienkreis, Mittelkreuz. CYPHER über die volle Breite, darunter STUDIO über die volle Breite (Bandbreite), dazwischen in Mono „KANAL 3 · CYPHER STUDIO 0.4.0 · BERLIN“. Unten drei Balken: 1 NEWS, 2 SHOP, 3 STUDIO. Suchlauf: Das ganze Bild schneidet im 800-ms-Takt auf Orange, Gelb, Cyan und rastet auf Cyan ein (Kanalwort wechselt mit). Jede Taste oder jeder Klick springt zum Ende. Reduziert: sofort das Standbild auf Cyan. Darunter [Los geht’s  Enter].

**Zeitplan-Skala** (ab Schritt 1 oben über dem Inhalt, Familie: Skala mit Nadel):

```
0         5         10        15        20        25        30 Min.
|''''|''''|''''|''''|''''|''''|''''|''''|''''|''''|''''|''''|
[1 ][2  ][3 Prüfen ]                    [5 Einrichten][6 Probelauf ]
          ════ 4 Programme laden (im Hintergrund) ════
     ▲ jetzt                                       noch etwa 24 Min.
```

Erledigtes füllt sich Cyan, die Nadel zeigt „jetzt“, Downloads laufen als zweite Spur parallel. Die Restzeit wird nach den ersten Sekunden Download aus der echten Geschwindigkeit neu gerechnet und gerundet, nie geschönt.

1. **Was machst du vor allem?** (1 Min.) Vier große Zeilen zum Ankreuzen, Programmname als Bandbreite: „Malen und Foto · KRITA · 182 MB“, „Vektor und Druck · INKSCAPE · 120 MB“, „3D · BLENDER · 380 MB“, „Video · KDENLIVE · 140 MB“. Unten: „Zusammen 302 MB bei Standardwahl. Die Zeit schätzen wir, sobald der Download läuft.“ Mehrfachwahl, Standard: Krita und Inkscape (Druck ist der Kern).
2. **Euer gemeinsamer Ordner** (2 Min.) Ordner wählen oder [Später]. Gleiche Zusammenfassung wie in der Bibliothek.
3. **Prüfen und zustimmen** (2 Min.) Prüfungsanzeige als Tabelle, eine Zeile je gewähltem Programm, Spalten Quelle · Version · Größe · Lizenz · Prüfsumme · Zielordner; Zeile aufklappbar für Details. Ein Knopf für alle: [Alle laden und installieren ⌃↵]. Ab hier läuft Spur 4 im Hintergrund.
4. **Programme laden** (10–20 Min., parallel) Spur in der Zeitplan-Skala, Details in Aufträgen. Scheitert eines, bleibt es offen, der Rest geht weiter.
5. **Einrichten** (3 Min.) Sobald ein Programm installiert ist, richtet Studio es ein (Häkchen aus Schritt 3); hier sieht man die Liste mit Status je Baustein und kann einzelne abwählen.
6. **Probelauf** (5 Min., optional) Ein mitgeliefertes Probe-Motiv öffnet im Druckprüfer. Es hat absichtlich einen Hinweis (Halbtransparenz 2,1 %). Drei kurze Sätze im Inspektor erklären Urteil, Regel und [Beheben]; danach Export in einen Probeordner. Wer will, öffnet das Motiv in Krita.

**Startklar.** Harter Schnitt auf das Startklar-Band: ein Cyan-Band über die volle Breite (im Tinte-Thema auf Tinte, im Papier-Thema auf Papier), darin STARTKLAR in Anybody als Bandbreite, das Band füllt sich einmal von links (Vorhang, 240 ms). Darunter die Zusammenfassung als Messzeilen: „KRITA 5.3.1 eingerichtet · INKSCAPE 1.4.3 eingerichtet · ORDNER D:\Sync\Cypher · 4 VORLAGEN“, Offenes in Bernstein („BLENDER nicht geladen · später unter Programme“). [Zur Zentrale  Enter].

## 7. Mikrotexte

**Ton**: Du-Form, kurz, konkret, ohne Floskeln. Knöpfe sind Verben mit Gegenstand („Für Shirtigo exportieren“, nicht „OK“). Zahlen statt Adjektiven. Keine Entschuldigungen, keine Ausrufezeichen, keine Werbewörter.

**Formeln**
- Fehler: *Was ist passiert. Was ist sicher. Was du tun kannst.* → „Verbindung zu download.kde.org abgebrochen bei 74 von 182 MB. Nichts ist installiert. Geht automatisch weiter, sobald du online bist.“ [Jetzt erneut]
- Löschen/Entfernen: *Was genau, wie groß, was bleibt.* → „Gelöscht wird …\Krita\5.3.1 (540 MB). Deine Krita-Dateien bleiben.“ [Deinstallieren]
- Urteil: ein Wort in Anybody + Zählung → „DRUCKBEREIT · 13 Regeln erfüllt“.
- Leer: *Was fehlt + was der nächste Schritt bewirkt.* → „Noch kein gemeinsamer Ordner. Wähle den Ordner, den ihr teilt, dann erscheinen hier eure Projekte.“

**Glossar**

| Wir sagen | Nicht |
|---|---|
| Programm | App, Tool |
| einrichten, Einrichtung | konfigurieren, Setup |
| Prüfsumme (in Details: SHA-256) | Hash, Checksum |
| Auftrag, Aufträge | Job, Task |
| Vorlage | Template |
| Druckfläche | Print Area |
| Freistellen | Background Removal, KI-Magie |
| gemeinsamer Ordner | Cloud, Workspace |
| Sicherung | Backup |
| Hinweis / Fehler | Warning / Error |
| Ausgang (Etikett) | Output |
| startklar | ready, onboarding complete |

**Zahlen und Zeit**: Pixelmaße ohne Tausenderpunkt (1080 × 1350 px), Mengen mit Punkt (3.104 Dateien), Dezimalkomma (9,4 MB), Datum 16.10.2026, relative Zeit nur bis gestern („heute 14:32“, „gestern“), danach Datum. `×` (U+00D7) mit Leerzeichen; Einheiten mit Leerzeichen.

## 8. Tastenkürzel

macOS: `⌘` statt `Strg`, `⌥` statt `Alt`.

| Bereich | Kürzel | Wirkung |
|---|---|---|
| Global | `Strg+1 … 7` | Start, Bibliothek, Programme, Druck, Mockups, Social, Freistellen |
| | `Strg+K` | Befehle |
| | `Strg+Enter` | Ausgangs-Aktion bzw. Hauptaktion des gewählten Eintrags |
| | `Strg+O` / `Strg+N` | Datei öffnen / Neues Projekt |
| | `Strg+J` | Aufträge |
| | `Strg+,` | Einstellungen |
| | `F6` / `Umschalt+F6` | nächster / vorheriger Bereich (Rail, Vorschau, Inspektor, Ausgang) |
| | `F1` oder `?` | Tastenkürzel und Hilfe |
| | `Strg + / - / 0` | App-Zoom |
| | `Esc` | Dialog, Popover, Detail schließen |
| Vorschau (nur bei Fokus) | `0` · `1` · `E` | Einpassen · 100 % · Echtgröße |
| | `U` · `G` · `S` · `P` · `M` | Umfeld · Raster · Sicherheitszonen · Prüfmarken · Messfarbe |
| | `Leertaste`+Ziehen, Pfeile | Verschieben |
| Bibliothek (bei Fokus im Raster) | `Leertaste` · `Enter` · `T` | Schnellansicht · Öffnen · Tags |
| Mockups | `K` | Kontaktbogen |
| Erststart | `Enter` · beliebige Taste in der Kennung | weiter · Suchlauf überspringen |

## 9. Downloader-Webseite studio.cypherxcypher.de

Eigene Fläche, Modus „überzeugen“, darf deutlich cineastischer sein als die App. Statisch, `noindex` (Meta und `X-Robots-Tag`), keine Cookies, kein Tracking, keine Drittquellen, strenge CSP ohne Inline-Code (wie Start und Shop).

### Konzept-Karte der Seite

| Feld | Inhalt |
|---|---|
| Idee | Kanal 3 geht auf Sendung. Wer auf der Startseite den Cyan-Balken drückt, landet in der Cyan-Welt, und der Download ist der Balken selbst. |
| Hero-Moment | Volle Cyan-Fläche. CYPHER und STUDIO füllen in Tinte exakt die Breite, Testbild-Kreis und Kreuz als Haarlinien darüber. Darunter ein Tintenbalken über die volle Breite: „Cypher Studio für Windows laden“, darunter die Messzeile „0.4.0 · 9,8 MB · Windows 10/11 x64 · SHA-256 9f3a … d4e1“. Von außen kommend läuft einmal der Suchlauf der Familie (Orange → Gelb → Cyan, 3 × 800 ms, jede Eingabe bricht ab). |
| Signatur 1: Messspur-Szene | Ein echtes Cypher-Motiv (Rauschen-Shirt aus den Shop-Assets) liegt groß auf Unbunt. Beim Scrollen zeichnet Cyan, was die App misst: Rahmen der Druckfläche, Lineale zählen bis 330 und 450 mm, Maßchip „280,0 × 312,0 mm“, Regeln haken sich ab, am Ende DRUCKBEREIT. Gescrubbt am Scrollweg (GSAP ScrollTrigger, nach dem ersten Bild geladen). |
| Signatur 2: Programm-Stapel | KRITA / INKSCAPE / BLENDER / KDENLIVE, jedes Wort exakt über die volle Breite (Bandbreite), Zeile für Zeile. Zeiger oder Fokus auf einer Zeile: Das Wort rastet über die Breitenachse neu ein und die Zeile öffnet ihre Messzeile („Quelle download.blender.org · Lizenz GPL · Studio richtet ein: Asset-Bibliothek, Mockup-Szene“). Namen als Text, keine Logos. |
| Zielgefühle | neugierig · vertraut (Familie) · sicher (alles geprüft, nichts versteckt) |
| Hauptpfad | Der Tintenbalken im Hero: ganze Fläche ist der Link, voller Kontrast (Papier auf Tinte 16,73:1), bewegt sich nie, im ersten Bildschirm auf jedem Gerät. Andere Systeme als Textlinks darunter. |
| Nicht tun | kein Preloader, keine Fake-Screenshots fremder Betriebssysteme, keine Logos, keine Zählwerke („1.000+ Downloads“), keine Newsletter-Box, kein automatischer Download. |

### Szenen

| # | Szene | Intensität | Inhalt |
|---|---|---|---|
| 00 | Kennung + Download | 5 | Cyan-Welt, CYPHER / STUDIO, Tintenbalken mit Messzeile, darunter in Mono: „macOS (Apple Silicon und Intel) · Linux AppImage · Linux .deb · Alle Dateien und Prüfsummen“. Ein Satz: „Die Zentrale des Cypher Kollektivs: lädt Krita, Inkscape, Blender und Kdenlive aus ihren offiziellen Quellen, prüft sie, richtet sie mit unseren Farben, Schriften und Vorlagen ein und prüft Druckdateien für Shirtigo.“ |
| 01 | Programme | 3 | Schnitt auf Papier. Programm-Stapel (Signatur 2). |
| 02 | Messspur | 4 | Szene am Scrollweg (Signatur 1), danach ein echtes Bildschirmfoto der App (Druckprüfer, Tinte-Thema), Alt-Text beschreibt, was zu sehen ist. |
| 03 | So installierst du es | 2 | Anleitung für das erkannte System zuerst, die anderen aufklappbar. |
| 04 | Selbst prüfen | 1 | Prüfsumme nachrechnen, ruhigste Stelle. |
| 05 | Typenschild | 1 | Kollektiv, Berlin, Open Source (Repo-Link), Lizenz, Impressum/Datenschutz (Platzhalter bis zur Gründung), Markenhinweise, „Kanal 3 · studio.cypherxcypher.de“. |

### Anleitung (Texte)

**Windows** (unsigniert):
1. Datei `cypher-studio_0.4.0_x64-setup.exe` öffnen.
2. Windows zeigt „Der Computer wurde durch Windows geschützt“. Das liegt daran, dass Cypher Studio noch nicht mit einem gekauften Zertifikat signiert ist, nicht an der Datei selbst.
3. Auf „Weitere Informationen“ klicken, prüfen, dass als App `cypher-studio_0.4.0_x64-setup.exe` steht, dann „Trotzdem ausführen“.
4. Wer sichergehen will: erst die Prüfsumme vergleichen (Szene 04).

**macOS** (ad-hoc signiert, nicht notarisiert):
1. `Cypher-Studio_0.4.0_universal.dmg` öffnen, Cypher Studio in „Programme“ ziehen.
2. Beim ersten Öffnen meldet macOS, dass es die App nicht überprüfen konnte. Auf „Fertig“ klicken.
3. Systemeinstellungen → Datenschutz & Sicherheit, nach unten scrollen, bei „Cypher Studio“ auf „Dennoch öffnen“ klicken und mit dem Passwort bestätigen. (Seit macOS 15 reicht Rechtsklick → Öffnen nicht mehr.)
4. Nur falls macOS „beschädigt“ meldet: Terminal öffnen und `xattr -dr com.apple.quarantine "/Applications/Cypher Studio.app"` ausführen. Das entfernt die Download-Markierung, sonst nichts.

**Linux**: AppImage herunterladen, ausführbar machen (`chmod +x Cypher-Studio_0.4.0_amd64.AppImage` oder Dateieigenschaften → „Als Programm ausführen“), starten. Alternativ `.deb`.

Die Schritte stehen als nummerierte Liste mit schematischen Strichzeichnungen im Seitenstil (Haarlinien, die Knopfbeschriftung in Cyan markiert), keine nachgebauten Betriebssystem-Fenster.

### Prüfsumme selbst prüfen

- Windows (PowerShell): `Get-FileHash .\cypher-studio_0.4.0_x64-setup.exe -Algorithm SHA256`
- macOS: `shasum -a 256 Cypher-Studio_0.4.0_universal.dmg`
- Linux: `sha256sum Cypher-Studio_0.4.0_amd64.AppImage`

Daneben die erwartete Summe in Vierergruppen (Mono), je Zeile [Kopieren]. Ein Satz: „Stimmen alle Gruppen überein, ist es genau die Datei, die wir veröffentlicht haben.“

### Technik und Verhalten

- **Eine Quelle**: Version, Größe, Dateinamen und Prüfsummen kommen aus derselben `latest.json`, die auch der App-Updater liest. Ohne erreichbare JSON zeigt die Seite feste Links zur Release-Seite.
- **Systemerkennung**: `navigator.userAgentData.platform`, sonst User-Agent; nur zum Sortieren und Beschriften. Ohne JavaScript stehen alle drei Systeme gleichrangig da. Nie automatischer Download. macOS bekommt den Universal-Build (Apple Silicon ist per Browser nicht sicher erkennbar). Handy: kein Download-Knopf, sondern „Cypher Studio läuft auf Windows, macOS und Linux.“ [Link kopieren].
- **Budget**: LCP ≤ 2,0 s (Handy, 4× CPU), LCP-Element ist der Hero-Text; CLS ≤ 0,05 (Anybody vorgeladen, Bandbreite-Werte vorab gemessen); GSAP und ScrollTrigger (lokal, gepinnt) erst nach dem ersten Bild und nur bei feinem Zeiger und Desktop-Breite; auf dem Handy zeigt Szene 02 den Endzustand als Bild.
- **Reduziert**: kein Suchlauf, Messspur-Szene als Endzustand, Programm-Stapel ohne Einrasten (Messzeilen per Fokus trotzdem erreichbar).
- **Barrierefreiheit**: DOM-Reihenfolge = Lesereihenfolge; Download-Balken ist ein echter Link mit Name „Cypher Studio 0.4.0 für Windows herunterladen, 9,8 MB“; Programmwörter sind Überschriften der Liste, Messzeilen per `details`/Fokus erreichbar; Leinwände `aria-hidden`; axe 0; kein Querscrollen ab 320 px; Ziele ≥ 44 px auf dem Handy.
- **Später signieren**: Windows über SignPath Foundation (kostenlos für Open Source), macOS über das Apple Developer Program (Notarisierung). Dann entfallen die Schritte 2–3 bzw. 2–4, die Seite blendet sie aus (Feld `signed` in `latest.json`).

## 10. Annahmen

- Studio installiert Programme benutzerweit ohne Administratorrechte (portable Pakete, AppImage, `.app` in `~/Applications`); wo das nicht geht, kündigt der Dialog die Rechteabfrage vorher an.
- Das Programm-Manifest liegt im Repo des Kollektivs, ist mit dem Updater-Schlüssel signiert und nennt je Programm Quelle, erlaubte Spiegel, Version, Größe, Lizenz (SPDX) und SHA-256; wo die Projekte eigene Prüfsummen veröffentlichen, vergleicht Studio beide.
- Mockup-Grundbilder rendert das Kollektiv selbst in Blender; bis dahin Platzhalter, als solche markiert.
- Die Social-Vorlagen und das Probe-Motiv entstehen im Kollektiv; dieses Dokument legt nur Format, Felder und Messregeln fest.
