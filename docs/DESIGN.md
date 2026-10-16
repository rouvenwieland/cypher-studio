# DESIGN.md – Cypher Studio „Regie“ (Kanal 3)

Format nach google-labs-code/design.md: oben die Tokens als YAML, darunter Vertrag, Zustände, Regeln und Begründung. Idee, Navigation und alle Bildschirme stehen in `CONCEPT.md`, direkt nutzbare Variablen in `tokens.css`. Stand 16.10.2026.

Familie: Startseite „Testbild“ (Kennung), News „Zeitzeichen“ (Kanal 1, Orange), Shop „Empfang“ (Kanal 2, Gelb). Studio kommt als **Kanal 3** dazu, mit **Studio-Cyan**. Gleiche Gerätesprache (Papier und Tinte, Haarlinien, Radius 0, Anybody, Atkinson Hyperlegible Next, Martian Mono), eigene Achse: **Messen und Abnehmen**.

```yaml
meta:
  produkt: "Cypher Studio"
  kanal: 3                          # News 1, Shop 2, Studio 3
  idee: "Regie"                     # Quelle → Vorschau → Messung → Ausgang (CONCEPT.md)
  plattform: "Tauri 2 + React/TS, Fenster 1280 × 800, Minimum 1024 × 680"
  thema_standard: "System (prefers-color-scheme); in Einstellungen: System | Papier | Tinte"
  stand: "2026-10-16"

color:
  familie:
    ink:   "#0d0d0d"                # Tinte (gleich wie Start, News, Pitch)
    paper: "#efeee9"                # Papier
    news:  { surface: "#ff4f12", on: "#0d0d0d" }     # Kanal 1, 5,90:1
    shop:  { surface: "#e4f531", on: "#0d0d0d" }     # Kanal 2, 16,11:1
    studio:
      surface: "#00d4d8"            # Studio-Cyan, oklch(78.9% 0.134 197)
      on: "#0d0d0d"                 # Tinte auf Cyan 10,56:1
      deep: "#00676b"               # Tiefcyan, oklch(46.7% 0.079 199): Linien, Fokus, Text auf Papier (5,73:1)
      gegen_tinte: 10.56            # Cyan als Linie/Text auf Tinte
      gegen_papier: 1.58            # darum auf Papier NIE als Text oder alleinige Kante, nur als Fläche mit Tintentext + 1px Tintenkante
      regel: "Cyan heißt: Das hat Studio gemessen, oder das geht gleich raus. Nie Deko, nie Fläche hinter Bildern, nie Fließtext."

  gehaeuse:                         # Rail, in beiden Themen Tinte (wie das News-Gehäuse)
    bg: "#0d0d0d"
    fg: "#efeee9"                   # 16,73:1
    mute: "#a3a29d"                 # 7,60:1
    line: "#2e2e2b"                 # Haarlinie, nur trennend (1,43:1)
    hover: "#1f1f1d"                # fg 14,21:1 · mute 6,46:1 · Cyan 8,97:1
    gewaehlt: { bg: "#efeee9", fg: "#0d0d0d" }   # gedrückte Taste = invertiert (16,73:1)

  papier:                           # helles Thema
    bg:      "#efeee9"              # Arbeitsgrund
    panel:   "#e7e6e0"              # Inspektor, Titelzeile, Ausgangsleiste
    field:   "#f8f7f3"              # Eingabefelder, Dialoge, Menüs
    hover:   "#e2e1db"
    line:    "#cfcec7"              # Haarlinie, trennt nur (1,36:1 – trägt keine Information)
    control: "#7a7974"              # Rahmen von Bedienelementen: 3,75 bg · 3,49 panel · 4,07 field · 3,33 hover
    fg:      "#0d0d0d"              # 16,73 bg · 15,54 panel · 18,13 field · 14,83 hover
    fg2:     "#2f2f2d"              # 11,55 bg
    mute:    "#5b5a56"              # 5,94 bg · 5,52 panel · 6,44 field · 5,27 hover
    focus:   "#00676b"              # 5,73 bg · 5,33 panel · 6,21 field
    select:  { bg: "#0d0d0d", fg: "#efeee9" }    # Auswahl = invertiert, 16,73:1
    scrim:   "rgb(13 13 13 / 0.48)"

  tinte:                            # dunkles Thema, für lange Bildarbeit
    bg:      "#151515"
    panel:   "#1c1c1c"
    field:   "#222222"
    hover:   "#262626"
    line:    "#2e2e2e"              # 1,34:1, trennt nur
    control: "#7a7a7a"              # 4,25 bg · 3,97 panel · 3,71 field · 3,53 hover
    fg:      "#efeee9"              # 15,72 bg · 14,67 panel · 13,70 field · 13,03 hover
    fg2:     "#cfcfcb"              # 11,69 bg · 10,91 panel
    mute:    "#a3a3a3"              # 7,24 bg · 6,76 panel · 6,31 field · 6,00 hover
    focus:   "#00d4d8"              # 9,92 bg · 9,26 panel · 8,64 field
    select:  { bg: "#efeee9", fg: "#0d0d0d" }
    scrim:   "rgb(0 0 0 / 0.6)"
    regel: "Alle Flächen unbunt (R = G = B, OKLCH-Chroma 0). Kein Blaustich, kein Warmton: Bildfarben bleiben beurteilbar."

  umfeld:                           # Grund der Vorschau (Druck, Mockups, Social, Freistellen, Bibliothek-Detail); Taste U
    hell:   { surface: "#d6d6d6", mess: "#00676b" }      # Messfarbe 4,58:1
    mittel: { surface: "#777777", mess: "#00d4d8" }      # L* ≈ 50 (Mittelgrau); Messfarbe 2,43:1, darum immer mit Gegenlinie
    dunkel: { surface: "#202020", mess: "#00d4d8" }      # 8,85:1
    standard: "Papier-Thema → hell, Tinte-Thema → dunkel; Wahl wird je Modul gemerkt"

  messspur:                         # Signatur 1: was Studio misst, zeichnet es in Cyan auf das Werk
    linie: "1px Messfarbe, außen begleitet von 1px Gegenlinie (Tinte 70 % bzw. Papier 70 %) – sichtbar auf jedem Motiv"
    hilfslinie: "gestrichelt 4/3, 1px"
    chip: { bg: "Messfarbe", fg: "Tinte auf Cyan (10,56:1), Papier auf Tiefcyan (5,73:1)", schrift: "data 12px", innen: "2px 6px" }   # Maße stehen nie frei auf dem Motiv
    alternativen: { magenta: "#ff4fd8", tinte: "#0d0d0d", papier: "#efeee9" }        # Taste M, falls das Motiv selbst cyan ist (Tinte auf Magenta 6,81:1)

  status:                           # immer Form + Wort + Farbe, nie Farbe allein
    ok:     { surface: "#3ccf6e", on: "#0d0d0d", text_papier: "#1d6b38", text_tinte: "#4fd17c", glyph: "CheckSquare fill",    wort: "erfüllt" }   # 9,57 · 5,63 · 9,34
    warn:   { surface: "#f5b700", on: "#0d0d0d", text_papier: "#7a5300", text_tinte: "#f5b700", glyph: "Warning fill",        wort: "Hinweis" }   # 10,79 · 5,90 · 10,14
    fehler: { surface: "#ff5a5a", on: "#0d0d0d", text_papier: "#b0222d", text_tinte: "#ff6b6b", glyph: "WarningOctagon fill", wort: "Fehler" }    # 6,35 · 5,81 · 6,58
    offen:  { text: "mute", glyph: "Square regular, gestrichelt", wort: "nicht geprüft" }
    info:   { text: "fg2", glyph: "Info regular", wort: "Info" }
    regel: "Statusflächen stehen auf Papier mit 1px Tintenkante (Fläche gegen Papier < 3:1). Grüne Häkchen nur im Urteil, erfüllte Regeln einzeln in mute – Farbe gehört dem, was Arbeit braucht."

type:
  familien:
    display: { family: "Anybody (variabel: wdth 50–150, wght 100–900)", lizenz: "OFL", rolle: "ein Titel je Bildschirm, Kennungen (Programmnamen, Erststart), Urteile" }
    text:    { family: "Atkinson Hyperlegible Next (variabel: wght 200–800)", lizenz: "OFL", rolle: "alles, was man liest und bedient" }
    mono:    { family: "Martian Mono (variabel)", lizenz: "OFL", rolle: "Messwerte, Maße, Pfade, Prüfsummen, Versionen, Tastenkürzel, Feldetiketten" }
    anfuehrung: "„ “ ‚ ‘ in Anybody aus einer Systemschrift per unicode-range (Anybody setzt sie als Block, wie im Shop gelöst)"
    einbindung: "alle Schriften lokal im App-Paket (kein Netz), OFL-Texte unter Einstellungen → Über"
  skala:                            # Desktop, CSS-Pixel; line = Zeilenhöhe in px
    label:   { size: 11, line: 14, family: mono,    weight: 500, case: upper, tracking: "0.06em" }   # Feldetiketten (QUELLE, VERSION), Rail-Gruppen
    data:    { size: 12, line: 16, family: mono,    weight: 400, numerals: tabular }                 # Messwerte, Pfade, Hashes
    meta:    { size: 13, line: 18, family: text,    weight: 400 }                                   # Nebeninfo, Dateinamen im Raster
    ui:      { size: 14, line: 20, family: text,    weight: [400, 600] }                            # Standard für Bedienung
    read:    { size: 15, line: 22, family: text,    weight: 400, measure: "64ch" }                  # Dialogtext, Erklärungen, Erststart
    section: { size: 16, line: 22, family: text,    weight: 700 }                                   # Abschnittsköpfe in Panels
    verdict: { size: 22, line: 24, family: display, weight: 800, wdth: 72, case: upper }            # Urteil: DRUCKBEREIT
    title:   { size: 28, line: 28, family: display, weight: 800, wdth: 78, case: upper, tracking: "-0.01em" }
    kennung: { size: "48–160, füllt die Breite", family: display, weight: 800, wdth: "50–150 (Bandbreite)", case: upper, tracking: "-0.02em", leading: 0.8 }
  spruenge: "11 → 14 → 28 → bis 160 (Label : Titel = 1 : 2,5; Label : Kennung bis 1 : 14,5)"
  bandbreite: "Programmnamen und Kennungen füllen ihre Spalte exakt über die Breitenachse (KRITA breit, KDENLIVE schmal). Feste Wörter vorab gemessen (wie scripts/fit.mjs im Start-Projekt), Nutzertext zur Laufzeit: zwei Messungen (wdth 50 und 150), linear interpolieren, keine Schleife."
  regeln:
    - "Genau ein Anybody-Titel je Bildschirm; Atkinson für alles Lesbare; Mono nur für Gemessenes und wörtlich Geschriebenes."
    - "Pixelmaße ohne Tausenderpunkt (3898 × 5315 px), Mengen mit Punkt (3.104 Dateien), Dezimalkomma (11,2 MB), Datum 16.10.2026, Zeit 14:32."
    - "Mindestgröße 11 px nur für Versal-Etiketten; Lesetext nie unter 13 px."
    - "Lange deutsche Wörter: lang=de + hyphens: auto in Panels; Dateinamen kürzen in der Mitte (rauschen_sig…_v3.kra), voller Name im Tooltip und im zugänglichen Namen."

space:
  einheit: 4
  skala: [0, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96]
  regel: "Enge Gruppen (4–8), klare Trennung (24–32), über Abschnittsköpfen mehr Luft als darunter (24 über, 8 unter)."

grid:
  fenster: { standard: "1280 × 800", minimum: "1024 × 680" }
  bereiche:
    rail:           { breit: 216, standard: 200, schmal: 56 }    # ≥ 1360 · 1180–1359 · < 1180 (nur Icons, Tooltip mit Name und Kürzel)
    titelzeile:     56                                           # 48 bei Fensterhöhe < 760
    inspektor:      { breit: 360, standard: 336, schmal: 320 }
    ausgangsleiste: 56                                           # 48 bei Fensterhöhe < 760
    vorschau:       "Rest, mindestens 600 px breit"
  rechnung_1280: "200 Rail + 744 Vorschau + 336 Inspektor; Höhe 56 + 688 + 56"
  rechnung_1024: "56 Rail + 648 Vorschau + 320 Inspektor"
  inhalt: { spalten: 12, gutter: 16, rand: 24, rand_schmal: 16 }
  raster: "4-px-Grundraster; Zeilen, Steuerelemente, Leisten auf Vielfachen von 4"
  achse: "Kennungsbalken (Rail oben) und Titelzeile sind gleich hoch: eine waagrechte Linie läuft durch das ganze Fenster."

shape:
  radius: 0
  ausnahme: "keine runde Ecke; der Kreis existiert nur als Geometrie (Testbild-Kreis im Erststart und auf der Webseite)"

lines:
  haar:    "1px var(--line): trennt, bedeutet nichts"
  control: "1px var(--control): Rahmen von Feldern, Knöpfen, Kacheln (≥ 3:1)"
  stark:   "1px var(--fg): Dialograhmen, gewählte Vorlage · 2px var(--fg): gewählte Kachel im Raster"
  mess:    "siehe color.messspur"
  schatten: "keine. Ebenen trennen Kante und Scrim."

motion:
  ease:
    schub:   "cubic-bezier(.2,.8,.2,1)"     # UI-Reaktion (Familie: push)
    vorhang: "cubic-bezier(.76,0,.24,1)"    # Ausgangsleiste füllt sich, Startklar-Band (Familie: curtain/gong)
    ankunft: "cubic-bezier(.16,1,.3,1)"     # Kennung rastet ein
    linear:  "linear"                       # echter Fortschritt
  dur: { schnitt: 0, mikro: 80, ui: 140, ui_aus: 100, fuellung: 240, einrasten: 480, suchlauf_takt: 800 }
  laute_momente:                            # genau vier, nie im Arbeitsweg
    - "Erststart: Suchlauf 1 → 2 → 3, rastet auf STUDIO ein (3 × 800 ms, jede Eingabe bricht ab)"
    - "Erststart: Startklar-Band (Schnitt auf Cyan, Vorhang 240 ms)"
    - "Programm installiert: Name rastet über die Breitenachse auf Spaltenbreite ein (480 ms, einmal)"
    - "Ausgang erfolgreich: Ausgangsleiste füllt sich von links mit Cyan (240 ms), Text wechselt auf das Ergebnis"
  regeln:
    - "Moduswechsel ist ein harter Schnitt (0 ms). Der Schnitt ist der Effekt und zugleich die schnellste Antwort."
    - "Bewegung zeigt nur echte Arbeit (Laden, Messlauf, Fortschritt). Was in unter 150 ms fertig ist, erscheint ohne Animation; nie gespielte Wartezeit."
    - "Keine Einblendung beim Öffnen von Panels, kein Hover-Zoom, kein Shimmer, kein Spinner, wo echter Fortschritt bekannt ist."
    - "Rückweg kürzer als Hinweg (Popover auf 140 ms, zu 100 ms)."
    - "Große Flächen höchstens 1,25 Farbwechsel pro Sekunde (WCAG 2.3.1)."
    - "Reduziert (System oder Einstellung): alle Dauern 0, kein Suchlauf, Fortschritt als Zahl plus stehender Balken; unbestimmter Fortschritt als Text „läuft …“."

focus:
  ring: "2px solid var(--focus), 2px Abstand außen; in Listen und Rastern innen (-2px), damit Scrollkanten ihn nicht abschneiden"
  farbe: { papier: "#00676b", tinte: "#00d4d8", gehaeuse: "#00d4d8" }
  regel: ":focus-visible – Tastatur immer, Mausklick nicht; Ausgangsleiste verdeckt nie den Fokus (scroll-padding-bottom = Leistenhöhe, WCAG 2.4.11)"
  forced_colors: "outline: 2px solid Highlight; Ränder in CanvasText"

density:                                    # Einstellung „Dichte“, Standard normal
  kompakt: { zeile: 28, steuer: 28, abstand: 4,  vorschaubild: 128 }
  normal:  { zeile: 32, steuer: 32, abstand: 8,  vorschaubild: 160 }
  gross:   { zeile: 44, steuer: 44, abstand: 12, vorschaubild: 200, schrift_ui: 15 }   # Einsteiger, Touch, Beamer
  treffer: "mindestens 24 × 24 (WCAG 2.5.8); Icon-Knöpfe 32 × 32, in „Groß“ 44 × 44"

icons:
  bibliothek: "Phosphor Icons (MIT), Paket @phosphor-icons/react, Version exakt pinnen"
  gewichte: { regular_16: "Strich 16/256 × 16 px = 1 px = Haarlinie", regular_20: "Rail", fill: "nur Status-Glyphen und eingeschaltete Umschalter" }
  eigene: "6 Glyphen auf Phosphors 256er-Raster, Strich 16: Druckfläche, Sicherheitszone, Prüfsumme, Messspur, Umfeld, Bandbreite"
  programme: "keine Logos, keine Buchstabenkacheln: Programmname als Schrift (Anybody, Bandbreite)"

z: { basis: 0, leiste: 10, popover: 100, dialog: 200, meldung: 300, kennung: 400 }
```

## 1. Kanalfarbe: Studio-Cyan `#00d4d8`

| Prüfpunkt | Wert | Folge |
|---|---|---|
| Herkunft | Im Testbild-Farbbalken steht Cyan direkt neben Gelb. Shop (Gelb) ist Kanal 2, Studio wird der nächste Balken. Gelb, Cyan und Rot gehören zu denselben sieben Balken. | Die Familie liest sich wie ein echter Farbbalken. |
| Helligkeitstreppe | OKLCH-L: Shop 92,7 · Studio 78,9 · News 67,0 | Auch in Graustufen und für Farbfehlsichtige sind die drei Kanäle unterscheidbar (wie die Graustufentreppe im Testbild). |
| Druck und Bildschirm | Cyan ist Grundfarbe im Druck (CMYK) und Mischfarbe am Bildschirm (Grün + Blau). | Die Farbe des Kanals, der für Druck (Shirtigo) und Feed (Social) ausgibt. |
| Messfarbe | Cyan kommt in Haut, Textil und den Kollektionsfarben kaum vor und hebt sich von fast jedem Motiv ab. | Darum zeichnet Studio seine Messungen in Cyan (Messspur). |
| Tinte | Tinte auf Cyan 10,56:1 · Cyan auf Tinte 10,56:1 · Cyan auf Tinte-Thema 9,92:1 | Im dunklen Thema trägt Cyan auch Linien, Fortschritt und Fokus. |
| Papier | Cyan gegen Papier 1,58:1 | Auf Papier nur als Fläche mit Tintentext und 1px Tintenkante. Für Linien, Text und Fokus auf Papier gilt Tiefcyan `#00676b` (5,73:1). |
| Abstand zu Fremdmarken | Farbton 197° gegenüber 246° beim Himmelblau-auf-Marine der bekannten Bildbearbeitungs-Kachel; keine Marine-Fläche, keine Buchstabenkachel | Nichts erinnert an fremde Zentralen. |
| Abstand zu Klischees | Kein Neon (`#00ffff`, L 90,5) und kein Tailwind-Cyan (`#22d3ee`, Farbton 212°). Gesättigt wie die Geschwister, aber nur in kleinen Flächen. | Kein „Hacker-Cyan auf Schwarz“: Cyan ist nie Hintergrund des Arbeitsbereichs, nie Glow. |

Wo Cyan erscheint, und nur dort: Kennungsbalken oben in der Rail, die Messspur in der Vorschau, die eine Ausgangs-Aktion je Bildschirm (Fläche mit Tintentext), echter Fortschritt, Fokus (Tiefcyan auf Papier), Textauswahl (`::selection`). Gesamtanteil auf einem Arbeitsbildschirm unter 3 % der Fläche.

## 2. Hell und dunkel: wie die App aussieht

| Element | Papier (hell) | Tinte (dunkel) |
|---|---|---|
| Rail (Gehäuse) | Tinte `#0d0d0d`, Papierschrift, gewählter Eintrag invertiert | gleich: das Gehäuse ändert sich nie |
| Kennungsbalken | Cyan, Wortmarke CYPHER STUDIO in Tinte | gleich |
| Arbeitsgrund / Inspektor | Papier `#efeee9` / `#e7e6e0` | `#151515` / `#1c1c1c`, unbunt |
| Vorschau-Umfeld | hell `#d6d6d6` (unbunt, nicht Papier) | dunkel `#202020` |
| Messspur | Tiefcyan `#00676b` mit Gegenlinie | Cyan `#00d4d8` mit Gegenlinie |
| Ausgangs-Aktion | Cyan-Fläche, Tintenschrift, 1px Tintenkante | Cyan-Fläche, Tintenschrift |
| Auswahl in Listen | Tinte, Papierschrift | Papier, Tintenschrift |
| Statusurteil | Statusfläche + Tintenkante + Glyph + Wort | Statusfläche + Glyph + Wort |
| Fokus | 2px Tiefcyan | 2px Cyan |

Warum die Vorschau nicht auf Papier liegt: Papier ist leicht warm (Chroma 0,007). Für die Beurteilung von Bildfarben braucht es ein unbuntes Umfeld, so verlangen es die Normen für Softproof am Bildschirm (z. B. ISO 12646). Die App ist also Papier, das Bild liegt auf Grau. Das Tinte-Thema ist für lange Bildsitzungen gedacht: dunkles, unbuntes Grau statt Schwarz für die Fläche (weniger Überstrahlen), Tinte nur im Gehäuse.

## 3. Vertrag (prüfbar)

| Punkt | Festlegung | Prüfung |
|---|---|---|
| Zweck | Zentrale des Kollektivs: Programme laden, prüfen, starten, einrichten; Druckdateien prüfen und für Shirtigo ausgeben; Mockups und Social-Bilder erzeugen; gemeinsamen Ordner durchsuchen. | Jede Funktion aus dem Auftrag ist in ≤ 2 Schritten ab Start erreichbar (Klickpfad-Liste im Test) |
| Publikum | 5 Leute, Einsteiger bis Fortgeschrittene, deutsch, Laptops 1280–1920 px, lange Sitzungen. | Bildschirmfotos 1024 × 680, 1280 × 800, 1920 × 1080, je Papier und Tinte |
| Hauptaktion | Pro Bildschirm genau eine Ausgangs-Aktion, immer an derselben Stelle (Ausgangsleiste rechts), immer `Strg+Enter` (macOS `⌘↵`). | Test: `Strg+Enter` löst auf jedem Modul die beschriftete Aktion aus |
| Idee | Regie: Quelle → Vorschau → Messung → Ausgang. Gemessenes erscheint in Cyan. | Blindtest: Kennung abdecken, ist es trotzdem Cypher? Ist es eine Werkzeug-App? |
| Thema | Folgt dem System; beide Themen vollständig; keine Farbe außerhalb der Tokens. | Stylelint verbietet Farbwerte außerhalb `tokens.css` |
| Kontrast | Alle Textpaare ≥ 4,5:1, Bedienelement-Kanten und Statusformen ≥ 3:1 (Werte im YAML). | Skript liest `tokens.css`, rechnet alle Paare nach; axe 0 Verstöße je Bildschirm und Thema |
| Neutralität | Tinte-Flächen und alle Umfelder unbunt; in der Vorschau nur Motiv, Messspur und eingeschaltete Prüfmarken. | Skript prüft R = G = B für `--bg/--panel/--field/--hover/--surround-*` |
| Tastatur | Alles bedienbar ohne Maus. `F6` wechselt die Bereiche (Rail → Vorschau → Inspektor → Ausgang), `Strg+K` Befehle, `Strg+1…7` Module, `Esc` schließt. Einzeltasten (U, G, S, M, 0, 1) nur bei Fokus in der Vorschau (WCAG 2.1.4). | Playwright-Tastaturlauf je Bildschirm, keine Falle |
| Fokus | Immer sichtbar, nie verdeckt, Reihenfolge = Lesereihenfolge. | Bildschirmfotos mit Fokus auf letztem Element über der Ausgangsleiste |
| Ziele | ≥ 24 × 24 px, Dichte „Groß“ ≥ 44 × 44. | Messung im Test |
| Status | Nie nur Farbe: Glyph-Form (Quadrat, Dreieck, Achteck) + Wort. | Graustufen-Screenshot des Druckberichts lesbar |
| Bewegung | Genau vier laute Momente; Moduswechsel 0 ms; reduziert = alles 0. | Aufnahme mit `prefers-reduced-motion: reduce` |
| Tempo | Kaltstart bis bedienbar ≤ 1,5 s (Referenz: Laptop i5, 8 GB). Modulwechsel ≤ 100 ms bis zum ersten Bild. Druckprüfung einer 3898 × 5315-PNG ≤ 1,5 s. Bibliothek mit 5.000 Dateien scrollt ruckelfrei (virtualisiert). Eingabe-Antwort ≤ 100 ms. | Messskript im Repo, Werte im CI-Protokoll |
| Fenster | 1024 × 680 ohne Querscrollen und ohne abgeschnittene Bedienung; App-Zoom 50–200 % (`Strg +/-/0`) bleibt bedienbar (WCAG 1.4.4, 1.4.10 sinngemäß). | Bildschirmfotos bei Minimum und 200 % |
| Vertrauen | Keine Installation ohne Prüfungsanzeige mit sechs Feldern (Quelle · Version · Größe · Lizenz · Prüfsumme · Zielordner) und ausdrückliche Aktion. Nur HTTPS, nur Hosts aus dem signierten Manifest. Prüfsumme falsch → Datei gelöscht, nichts installiert. App-Updates nur mit gültiger Updater-Signatur. | Test mit manipulierter Datei und fremdem Host |
| Datenschutz | Keine Konten, keine Telemetrie. Alle angefragten Adressen stehen in Einstellungen → Netzwerk. Freistellen läuft lokal. | Netzwerkprotokoll eines kompletten Erststarts = Liste in den Einstellungen |
| Marken | Keine fremden Logos, keine Adobe-Namen, -Icons oder -Optik, keine Buchstabenkacheln. Markenhinweise in „Über“ und auf der Webseite. | Sichtprüfung + Suche nach Logodateien im Paket |
| Sprache | de-DE, `Intl`-Formate, alle Texte in einer Textdatei (übersetzbar), Du-Form. | Lint: keine Texte im Komponenten-Code |
| Webseite | noindex (Meta und `X-Robots-Tag`), keine Cookies, keine Drittquellen, LCP ≤ 2,0 s (Handy, 4× CPU), CLS ≤ 0,05, axe 0, kein Querscrollen ab 320 px. | `npm run qa` der Webseite |

## 4. Typografie, Raster, Dichte: Begründung

- **Familienschriften, andere Gewichtung.** Die Webseiten der Familie sprechen laut in Anybody. Eine Werkzeug-App wird stundenlang gelesen und bedient, darum trägt hier Atkinson Hyperlegible Next die Last (entworfen für Lesbarkeit, große Unterscheidung von Il1, O0). Anybody kommt nur einmal je Bildschirm vor und als Kennung der Programme. Martian Mono beschriftet, was gemessen ist, wie die Gerätebeschriftung der Familie.
- **14 px statt 16–17 px.** Desktop-Standard für dichte Werkzeuge; Atkinsons große x-Höhe liest sich wie 15 px. Wer mehr braucht: Dichte „Groß“ oder App-Zoom.
- **Bandbreite statt Logo.** Programmnamen füllen immer ihre Spalte exakt (Technik der Startseite). So wird aus einer Liste mit vier Namen ein erkennbares Bild, ohne fremde Zeichen zu borgen.
- **Drei Zonen, immer gleich.** Vorschau links, Messung rechts, Ausgang unten. Wer ein Modul kennt, kennt alle. Die Breiten sind so gerechnet, dass bei 1280 die Vorschau 744 px hat (eine 4:5-Vorschau mit 1080 × 1350 erscheint in 1:2,1, ein Shirt-Motiv mit Linealen passt ganz).
- **Dichte ist eine Einstellung, keine Laune.** Fortgeschrittene wollen kompakt, Einsteiger und Beamer brauchen groß. Zeilenhöhe, Abstände und Vorschaubilder skalieren gemeinsam, die Typo-Skala bleibt.

## 5. Bewegung: Begründung

Die Familie schneidet hart (Testbild: „Schnitt ist hart, wie ein Kanalwechsel“). Für ein Werkzeug ist das ein Glücksfall: Der schnellste Übergang ist auch der markentreue. Bewegung bekommt nur, was echte Arbeit zeigt oder einen Abschluss feiert. Die vier lauten Momente liegen alle außerhalb des Arbeitswegs (vor der ersten Arbeit oder nach einem Ergebnis). Die Füllung der Ausgangsleiste ist die einzige Animation, die regelmäßig vorkommt; sie dauert 240 ms, blockiert nichts (Fokus und nächste Eingabe sind sofort frei) und sagt in einem Bild „ist raus“.

## 6. Ikonografie und fremde Marken

**Empfehlung: Phosphor Icons (MIT), Gewicht Regular.**

| Kandidat | Lizenz | Strich | Urteil |
|---|---|---|---|
| Phosphor | MIT | Regular = 16 Einheiten auf 256 → **bei 16 px exakt 1 px**, bei 20 px 1,25 px; sechs Gewichte | **gewählt.** Trifft die Haarlinie der Familie genau; Fill-Gewicht als Zustandssprache (Status, Umschalter an); über 1.000 Zeichen, deckt Werkzeug-Aktionen ab (Lupe, Raster, Ebenen, Ordner, Pipette). |
| Lucide | ISC | 2 px auf 24 → 1,33 px bei 16 px | gut, aber Standard von shadcn und damit das Gesicht unzähliger generierter Oberflächen (Anti-Vibecode Nr. 21). |
| Tabler | MIT | 2 px auf 24, Strich einstellbar | sehr groß, eher rund und freundlich; kein eingebautes Füllgewicht für Zustände. |
| Eigene Glyphen | – | frei | nur für sechs Fachzeichen, die keine Bibliothek hat (siehe YAML), gezeichnet auf Phosphors Raster, damit sie nicht auffallen. |

Regeln: Icons nur für bekannte Werkzeug-Aktionen und in der Rail, immer mit sichtbarem Wort oder Tooltip plus zugänglichem Namen; nie Icon über Überschrift, nie Icon pro Funktion als Schmuck. Einbindung als einzelne Importe (Tree-Shaking), keine Icon-Schrift.

**Programme ohne Logos.** Kurzprüfung der Richtlinien (16.10.2026):

- **Blender** ([blender.org/about/logo](https://www.blender.org/about/logo/)): Logo und Name sind eingetragene Marken der Blender Foundation und nicht von der GPL gedeckt. Erlaubt ist das Logo, um auf Blender zu verweisen oder Blender zu nennen, unverändert, nicht als eigenes Logo, eigene Marke muss deutlich stärker sein. Für bloßes Nennen empfiehlt die Seite, den Namen auszuschreiben. Kommerzielle Nutzung braucht Erlaubnis.
- **Krita** ([Krita-Markenrichtlinie](https://krita.org/en/posts/2013/krita-trademark-policy/)): Marke der Stichting Krita Foundation; Nennung im Zusammenhang mit unveränderter Software erlaubt, kein Eindruck offizieller Verbindung.
- **Inkscape** ([inkscape.org/about/branding](https://inkscape.org/about/branding)): Marken über die Software Freedom Conservancy; Logo nicht als Teil einer anderen Marke, keine Verwechslungsgefahr.
- **Kdenlive**: Marke von KDE e.V.; Hinweis aus der KDE-Gemeinschaft: Name und Logo unverändert, Markenhinweis anbringen ([KDE-Forum](https://discuss.kde.org/t/kdenlive-logo-trademark/30743)).

**Entscheidung:** neutrale Typo-Kacheln statt Logos. Jedes Programm erscheint als ausgeschriebener Name in Anybody (Bandbreite), dazu ein Wort für die Rolle in Mono („MALEN · FOTO“, „VEKTOR · DRUCK“, „3D“, „VIDEO“). Keine Programmfarben (kein Blender-Orange), keine nachgezeichneten Formen, keine Zweibuchstaben-Kacheln. Das ist reine Nennung (nominative Nutzung), braucht keine Erlaubnis und bleibt gestalterisch in unserer Welt. In Einstellungen → Über und im Fuß der Webseite steht: „Krita, Inkscape, Blender und Kdenlive sind Marken ihrer jeweiligen Inhaber (Stichting Krita Foundation, Software Freedom Conservancy, Blender Foundation, KDE e.V.). Cypher Studio ist kein offizielles Produkt dieser Projekte und lädt sie unverändert aus ihren offiziellen Quellen.“

## 7. Inhaltszustände je Bildschirm

Gilt für alle: Das Gerüst steht sofort (Rail, Titelzeile, Spaltenköpfe, feste Zeilenhöhen), Platzhalter sind ruhige Flächen in `--panel` ohne Schimmer, nichts verschiebt sich beim Nachladen. Fehlertexte folgen der Formel **Was ist passiert · was ist sicher · was du jetzt tun kannst** (Knöpfe).

**Start**
- Laden: sechs Projektzeilen als leere Flächen; Programmzeilen zeigen „wird geprüft“.
- Leer: kein Ordner gewählt → „Noch kein gemeinsamer Ordner. Wähle den Ordner, den ihr teilt, dann erscheinen hier eure Projekte.“ [Ordner wählen] · Vorlagenleiste bleibt voll, damit man sofort anfangen kann.
- Fehler: Ordner nicht erreichbar → „D:\Sync\Cypher ist gerade nicht erreichbar (Laufwerk getrennt?). Deine Dateien sind nicht betroffen.“ [Erneut versuchen] [Anderen Ordner wählen].
- Teilweise: Ordner noch nicht ganz gelesen → „1.240 von 3.104 Dateien gelesen“ als Zeile über der Liste, Liste wächst unten an.
- Erfolg: Projekt geöffnet → Schnitt in die Bibliothek, gefiltert auf das Projekt.
- Berechtigung: Ordner ohne Leserecht → „Cypher Studio darf D:\Sync\Cypher nicht lesen.“ [Anderen Ordner wählen]; unter macOS Hinweis auf Systemeinstellungen → Datenschutz & Sicherheit → Dateien und Ordner.

**Programme (Tafel und Detail)**
- Laden: vier Zeilen stehen sofort (Namen sind lokal), Versionen und Updates „wird geprüft“.
- Leer: entfällt – die vier Programme stehen immer da, auch „nicht installiert“.
- Fehler: Manifest nicht abrufbar → „Keine Verbindung zum Cypher-Manifest. Installierte Programme laufen weiter; Installieren und Aktualisieren gehen erst wieder online.“ [Erneut prüfen].
- Teilweise: außerhalb von Studio installiertes Programm gefunden → Status „Gefunden: Blender 4.5 in C:\Program Files\…“; Starten und Einrichten möglich, Aktualisieren nicht (Hinweis warum).
- Erfolg: „Krita 5.3.1 installiert und eingerichtet“ + Name rastet ein; [Krita starten ⌃↵].
- Berechtigung: Zielordner schreibgeschützt → Installationsdialog schlägt Ordner im Benutzerverzeichnis vor (Installation ohne Administratorrechte ist der Normalfall).

**Installationsdialog und Fortschritt**
- Laden: Prüfungsanzeige erscheint mit Werten aus dem lokalen Manifest; nur „frei auf dem Datenträger“ wird nachgemessen.
- Leer: entfällt.
- Fehler: Netz weg („Verbindung zu download.kde.org abgebrochen bei 74 von 182 MB. Geht automatisch weiter, sobald du online bist.“ [Jetzt erneut] [Anderen Spiegel]) · Prüfsumme falsch (eigener Abschnitt, Fehlerfläche, erwartete und berechnete Summe nebeneinander: „Die geladene Datei ist nicht die erwartete. Wir haben sie gelöscht, installiert wurde nichts.“ [Von anderem Spiegel laden] [Details kopieren]) · Platz („Auf C: fehlen 328 MB.“ [Anderen Zielordner]) · Programm läuft beim Update („Krita ist noch geöffnet. Speichere und schließe Krita, dann geht es weiter.“ [Erneut prüfen] – Studio beendet nie fremde Programme).
- Teilweise: neue Version bei der Quelle, aber noch nicht im geprüften Manifest → „Krita 5.3.2 ist erschienen, aber noch nicht von uns geprüft. Bis dahin installieren wir 5.3.1.“
- Erfolg: Phasenliste ganz abgehakt; Dialog schließt nach Klick, nicht von selbst; Auftrag bleibt im Verlauf.
- Berechtigung: Betriebssystem fragt nach Rechten (nur wenn ein Paket es zwingend braucht) → vorher im Dialog angekündigt: „Windows fragt gleich nach Administratorrechten, weil …“.

**Einrichtung (Tab im Programm-Detail)**
- Laden: Bausteine stehen sofort, Spalte „Status“ zeigt „vergleicht …“.
- Leer: Programm nicht installiert → „Erst installieren, dann einrichten.“ [Krita installieren].
- Fehler: Zieldatei gesperrt → Zeile mit Fehler-Glyph „cypher.kpl ist von Krita gesperrt. Schließe Krita und wende erneut an.“
- Teilweise: 3 von 4 Bausteinen aktuell; ein Baustein „von dir geändert“ → Wahl: [Überschreiben] [Daneben ablegen als cypher-2026-10.kpl].
- Erfolg: Ausgangsleiste füllt sich: „Angewendet 14:32 · Sicherung angelegt“ [Rückgängig] [Krita starten]; Hinweis, falls das Programm neu starten muss.
- Berechtigung: Konfigurationsordner nicht beschreibbar → Pfad nennen, [Ordner öffnen], keine Umgehung.

**Druckprüfer**
- Laden: Datei liegt schon in der Vorschau, Regeln stehen als Zeilen mit „—“; Werte erscheinen, sobald jede Regel echt fertig ist (Messlauf).
- Leer: leere Druckfläche des gewählten Profils mit Linealen; darin „PNG, SVG oder Krita-Datei hierher ziehen“ [Datei wählen ⌃O] · „oder aus der Bibliothek“.
- Fehler: nicht lesbar → „signal.psd lässt sich nicht öffnen: 16 Bit pro Kanal wird nicht unterstützt. Exportiere aus Krita als PNG mit 8 Bit.“ [In Krita öffnen].
- Teilweise: Regel nicht prüfbar (z. B. Schriftgröße bei Rasterbildern) → Zeile „nicht geprüft“ mit Grund; Urteil sagt „Druckbar mit Hinweisen, 1 Regel nicht geprüft“.
- Erfolg: „Gespeichert: …\Export\Druck\cypher_rauschen_signal_shirt-vorne.png“ [Im Ordner zeigen] [Shirtigo öffnen ↗].
- Berechtigung: Exportordner schreibgeschützt → [Anderen Ordner wählen], Dateiname bleibt.

**Mockups**
- Laden: Grundbild (Shirt/Hoodie) steht, Motiv erscheint, sobald gerendert; Kontaktbogen füllt sich Feld für Feld (echtes Rendern).
- Leer: Grundbild ohne Motiv, „Motiv aus der Bibliothek wählen oder hierher ziehen“.
- Fehler: Motiv hat keine Transparenz → Hinweis mit Glyph „Ohne transparenten Hintergrund liegt ein Kasten auf dem Shirt.“ [Freistellen] [Trotzdem zeigen].
- Teilweise: Hoodie-Vorlage fehlt (Paket nicht geladen) → nur Shirt wählbar, Hoodie mit Grund deaktiviert.
- Erfolg: „6 Mockups gespeichert in …\Mockups\“ [Im Ordner zeigen].
- Berechtigung: wie Druckprüfer.

**Social**
- Laden: Formate als leere Rahmen in echten Seitenverhältnissen.
- Leer: keine Vorlage gewählt → Vorlagenliste ist der Inhalt; „Wähle eine Vorlage. Text und Bild füllst du rechts aus.“
- Fehler: Schrift fehlt → „Anybody ist nicht installiert. Richte ein Programm ein oder installiere die Cypher-Schriften.“ [Schriften installieren].
- Teilweise: Text ragt in eine Sicherheitszone → Messung „Text liegt 38 px in der Zone ‚Bildunterschrift‘ (Reel)“ mit Markierung; Export trotzdem möglich.
- Erfolg: „3 Dateien gespeichert“ + Liste der Namen [Im Ordner zeigen].
- Berechtigung: wie Druckprüfer.

**Bibliothek**
- Laden: Raster mit Platzhalterflächen in echter Seitenproportion (wo bekannt), Zähler „Lese 1.240 von 3.104“.
- Leer: kein Ordner → wie Start · Filter ohne Treffer → „Keine Datei passt zu ‚Gold-Lounge‘ + ‚Video‘.“ [Filter lösen].
- Fehler: Ordner verschwunden → wie Start; einzelne Datei defekt → Kachel mit Fehler-Glyph und Dateiname, Rest normal.
- Teilweise: Vorschaubilder fehlen für .blend ohne eingebettetes Bild → Kachel mit Dateityp in Mono statt Bild; Konfliktkopien des Sync-Programms markiert „Konfliktkopie“.
- Erfolg: Tags gespeichert → kurz „Gespeichert“ in der Zeile, kein Toast.
- Berechtigung: Begleitdatei nicht schreibbar → Tags nur lesbar, Hinweis im Inspektor.

**Freistellen (optional)**
- Laden: Modell lädt einmalig → eigener Installationsdialog mit sechs Feldern; Berechnung zeigt echten Fortschritt.
- Leer: „Bild hierher ziehen. Läuft auf deinem Rechner, kein Bild verlässt den Computer.“
- Fehler: zu wenig Arbeitsspeicher → „Für dieses Bild (8000 × 8000 px) reicht der Speicher nicht. Verkleinere auf 4000 px.“ [Verkleinert freistellen].
- Teilweise: Kanten unsicher (Haare, Glas) → Messung „Halbtransparenz 6,2 %“ mit Hinweis für Druck.
- Erfolg: [Freigestellt speichern] füllt die Leiste; [Im Druckprüfer öffnen].
- Berechtigung: Modell nicht installiert und offline → Modul erklärt, was fehlt; Rest der App unberührt.

**Einstellungen und Updates**
- Laden: Werte sofort aus der lokalen Konfiguration; „Nach Updates suchen“ zeigt Fortschritt in der Zeile.
- Leer: entfällt.
- Fehler: Update-Signatur ungültig → „Das Update ist nicht mit dem Schlüssel des Kollektivs signiert und wurde verworfen.“ (Fehlerfläche, kein Weiter-Knopf).
- Teilweise: App-Update bereit, aber Aufträge laufen → „Neu starten, sobald die 2 Aufträge fertig sind“ [Dann neu starten].
- Erfolg: „Cypher Studio 0.5.0 ist installiert. Was neu ist:“ + Liste.
- Berechtigung: Updater darf nicht ersetzen (Installation durch Administrator) → Hinweis und Link zur Webseite.

**Erststart „In 30 Minuten startklar“**
- Laden: Schritte stehen sofort; Zeitplan schätzt nach den ersten 5 s Download neu.
- Leer: entfällt (geführter Ablauf).
- Fehler: Download scheitert → Schritt bleibt offen, Rest geht weiter; „Blender konnte nicht geladen werden. Du kannst schon weitermachen und es später unter Programme nachholen.“
- Teilweise: Erststart abgebrochen → Start zeigt oben „Einrichtung zu 60 % · Weitermachen“.
- Erfolg: Startklar-Band mit Zusammenfassung.
- Berechtigung: kein Schreibrecht im Standardordner → Ordnerwahl im selben Schritt.

**Webseite studio.cypherxcypher.de**
- Laden: Text und Download-Balken ohne JS sofort da; Betriebssystem-Erkennung verfeinert nur die Reihenfolge.
- Leer: keine Veröffentlichung vorhanden → Balken „Noch kein Download. Erste Version erscheint bald.“, keine toten Links.
- Fehler: `latest.json` nicht erreichbar → feste Links auf die Release-Seite.
- Teilweise: Handy erkannt → kein Download-Knopf für Desktop; „Cypher Studio läuft auf Windows, macOS und Linux.“ [Link kopieren].
- Erfolg: Download gestartet → Anleitung für das erkannte System springt nach oben (Fokus auf ihre Überschrift).
- Berechtigung: entfällt (keine Anmeldung).

## 8. Anti-Vibecode: was wir bewusst NICHT tun

| Nicht | Stattdessen |
|---|---|
| Lila/blaue Verläufe, Mesh, Aurora, Glow | Zwei Familienfarben plus Cyan, flach; Verläufe nur als Inhalt (Alpha-Messung, Palettenvorschau) |
| Glas-Karten, `backdrop-filter` als Schmuck | Kante und Scrim; Ebenen sind Papier auf Papier |
| Emoji oder Unicode-Zeichen als Icons | Phosphor Regular + sechs eigene Glyphen |
| Generische Dashboard-Kacheln, Hero-Kennzahl („4 Programme · 12 Projekte“), Fortschrittsringe | Index-Listen mit Haarlinien, echte Dateien, echte Zustände |
| Kartenraster mit Icon + Titel + zwei Zeilen | Tafel (Tabelle) mit Bandbreite-Namen; Vorlagen in echten Seitenverhältnissen |
| Zweibuchstaben-Programmkacheln in Markenfarben, „Apps / Dateien / Entdecken“-Gerüst, Tutorial-Karussell, Feed mit Stockbildern | Typo-Kacheln, Navigation nach eigener Arbeit (Material / Ausgabe), keine Werbung in der App |
| Fremde Logos, Adobe-Namen oder -Optik | ausgeschriebene Namen, eigene Welt |
| Radius 8–24 px, Pillenknöpfe, Standard-Schatten, harte Versatzschatten | Radius 0, Haarlinien, keine Schatten |
| Verlaufstext, farbiges Akzentwort, Kicker über Überschriften, Deko-Ziffern 01/02 | Gewicht und Größe; Schrittnummern nur im Erststart, wo die Reihenfolge Information ist |
| Monospace als „Technik-Kostüm“ | Mono nur für Messwerte, Pfade, Hashes, Kürzel, Etiketten |
| Reflex-Schriften (Inter, Geist, Space Grotesk, Playfair …) | Anybody, Atkinson Hyperlegible Next, Martian Mono |
| Alles fadet 20 px ein, Hover = scale(1.05), alles 300 ms ease | Harter Schnitt; vier laute Momente; benannte Kurven; Hover = Fläche `--hover` |
| Skelett-Schimmer, Spinner bei bekanntem Fortschritt, gespielte Ladezeit | Ruhige Platzhalter, echte Zahlen („74 von 182 MB“) |
| Konfetti, Erfolgs-Toasts im Stapel | Ausgangsleiste füllt sich, Ergebnis bleibt dort stehen |
| „Magie“, „KI-Zauber“, „nahtlos“, „Next-Gen“ | „Hintergrund entfernen (läuft lokal)“, Zahlen, Orte, Dateinamen |
| Modale Dialoge für Alltägliches | Modal nur für Installieren, Zustimmen, Löschen; sonst Inspektor und Leiste |
| Hell oder dunkel „weil Kreativ-Apps dunkel sind“ | System folgt; Tinte begründet durch Bildbeurteilung (unbunt) |
| „Willkommen zurück, Name!“, Begrüßungsbanner | Start zeigt sofort Arbeit: Projekte, Vorlagen, Programme |
| Browser-Standardflächen (blaue Auswahl, Standard-Scrollbalken, Standard-Fokus) | `::selection` Cyan, Scrollbalken und Caret aus den Tokens, eigener Fokusring |

## 9. Barrierefreiheit (eingebaut, WCAG 2.2 AA)

- **Struktur:** Rail = `nav` („Bereiche“), Arbeitsbereich = `main`, Inspektor = `aside` („Messung“), Ausgangsleiste = `region` („Ausgang“). Ein `h1` je Bildschirm (der Anybody-Titel). `F6` springt zwischen diesen Bereichen (Windows-Konvention).
- **Vorschau:** Leinwand ist `role="img"` mit Zusammenfassung („signal_v3.png, 280,4 × 312,0 mm, mittig auf Druckfläche 330 × 450 mm“); alles, was die Messspur zeigt, steht auch als Text im Inspektor. Keine Information nur im Bild.
- **Live-Meldungen:** `aria-live="polite"` nur für Abschlüsse und Phasenwechsel („Prüfung fertig: 2 Hinweise, 0 Fehler“, „Krita: Prüfsumme stimmt“), Fortschritt gedrosselt (alle 10 % oder 5 s). Fehler, die Arbeit stoppen: `role="alert"`.
- **Formulare:** Etiketten immer sichtbar (Mono-Etikett über dem Feld), Fehler am Feld mit `aria-describedby` und `aria-invalid`, Text + Glyph.
- **Dialoge:** natives `<dialog>` mit `showModal()`, Startfokus auf der Überschrift, `Esc` schließt außer während Prüfsumme/Installation läuft (dann erklärt der Dialog, wie man abbricht).
- **Farbe:** Status über Form + Wort; Prüfmarken in der Vorschau zusätzlich schraffiert (45°-Schraffur für Halbtransparenz, Kreuzschraffur für zu dünne Linien).
- **Bewegung:** System-Einstellung plus eigene Einstellung „Bewegung: System | Reduziert | Voll“. Suchlauf und Bandbreite-Einrasten entfallen bei „Reduziert“.
- **Erzwungene Farben (Windows-Kontrastdesign):** Kanten in `CanvasText`, Fokus in `Highlight`, Statusflächen werden Rahmen + Glyph.
- **Text:** App-Zoom 50–200 %; Panels brechen um statt abzuschneiden; Silbentrennung Deutsch.
- **Tastenkürzel:** Liste unter `F1`/`?`; Einzeltasten nur bei Fokus in der Vorschau; alle Kürzel in Einstellungen abschaltbar.

## 10. Bausteine (erst schauen, dann bauen)

Geprüft und empfohlen, alle Versionen exakt pinnen, nichts global installieren: Radix Primitives (MIT, ungestylt: Dialog-Fokus, Menüs, Tabs, Umschaltgruppen, Schieberegler, Tooltip), `cmdk` (MIT, Befehlspalette), TanStack Virtual (MIT, Bibliotheksraster), `@phosphor-icons/react` (MIT). Gestaltet wird ausschließlich über `tokens.css`; keine Komponenten-Vorlagen mit eigener Optik (shadcn-Standardstile, Komponenten-Kataloge) unverändert übernehmen.

## 11. Annahmen und offene Punkte

- Shirtigo-Werte stammen aus dem Hilfecenter (abgerufen 16.10.2026) und widersprechen sich teils (Dateigröße 16, 32 oder 64 MB; Hoodie 330 × 280 mm gegenüber 240 mm Höhe). Studio prüft gegen den strengeren Wert und zeigt die Quelle; Werte liegen als Profil-Datei vor und sind ohne Code änderbar.
- Social-Sicherheitszonen sind Richtwerte (Stand 10/2026), ebenfalls als Profil-Datei.
- Die Startseite „Testbild“ könnte einen dritten Balken (Kanal 3, Cyan) bekommen. Nicht Teil dieses Auftrags, Entscheidung beim Nutzer.
- Code-Signatur: Builds sind zunächst unsigniert (Windows) bzw. ad-hoc signiert (macOS). Empfehlung für später: SignPath Foundation (kostenlos für Open Source, Windows), Apple Developer Program für Notarisierung.
