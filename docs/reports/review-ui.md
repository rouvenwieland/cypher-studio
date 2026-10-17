# Review Oberfläche Cypher Studio (Finish-Gate vor dem ersten Zeigen)

Stand 17.10.2026 · Prüfer: UI-Finish-Gate-Reviewer · Im Projekt wurde nichts geändert (nur dieser Bericht).

## Urteil: SHIP MIT AUFLAGEN

Die Oberfläche ist erkennbar ein eigenes Werkzeug und kein generisches Dashboard. Ein Blindtest (Wortmarke abdecken) bestünde sie: Gehäuse in Tinte, Anybody-Namen über die Breitenachse, Messspur-Chips, Ausgangsleiste, Radius 0, keine Karten, keine Verläufe als Dekor. Vor dem Zeigen müssen **4 P0-Punkte** weg (kleine Eingriffe, zusammen etwa ein halber Tag). Danach ist die Zeigefassung vertretbar; die P1-Liste gehört in den nächsten Durchgang.

**Produktlinse (angenommen):** 5 Leute im Kollektiv, Einsteiger bis Fortgeschrittene, Laptops 1280 bis 1920 px. Häufigster Ablauf: Motiv wählen, messen (Druck, Mockups, Social), ausgeben. Selten, aber riskant: Programme installieren (Prüfsumme). Erstes Lesen je Ansicht: Urteil bzw. Messzeile, dann die eine Ausgangs-Aktion unten rechts.

## Punktzahl (0 bis 10)

| Kriterium | Punkte | Kurzgrund |
|---|---|---|
| Produktcharakter / Kernidee „Regie“ | 8 | Messspur, Urteil, Ausgangsleiste (inkl. Cyan-Füllung nach Export), Bandbreite-Namen, harte Schnitte; Abzug: „Messung zuerst“ gilt nicht in Social und nur halb in Druck (P1-3) |
| Vertragstreue (Tokens, Radius, Mono, Cyan) | 7 | Tokens sauber (keine Farbwerte außerhalb, keine Schatten, kein Radius); Abzug: Cyan auf Eingabe- und Wiederholen-Knöpfen, Mono für Fließtext |
| Typografie | 8 | Skala konsequent, ein Anybody-Titel plus Kennungen/Urteile; Abzug: Mono-Prosa, Namen mit Endkürzung |
| Abstände und Ausrichtung | 6,5 | Raster stimmt grob; sichtbare Schiefen auf Start, Segmentschalter mit Leerschwanz, Hash-Blöcke kleben |
| Zustände (Laden/Leer/Fehler/Teilweise/Erfolg) | 7,5 | Leer, Fehler, Teilweise, Erfolg gut und ehrlich (echte Zahlen, Phasenliste, Leistenfüllung); Laden nirgends belegt; Freistellen-Vorschau läuft über |
| Mikrotexte (de, Einsteiger) | 6 | Ton und Du-Form gut; doppelte Sätze, Entwicklertext („Alt-Text“), falsche Ungleichungen, Jargon („Spiegel“, „Paket“) |
| Barrierefreiheit | 7 | axe-sauber, Fokusringe da; Abzug: schmale Rail (20-px-Ziele, kein „aktiv“), Fokus fällt im Fehlerdialog auf body |
| Installationsfehler, Prüfsumme falsch | 7 | Stark: Rot + Glyph + Wort, role=alert, Diff unterstrichen und fett (nicht nur Farbe), „gelöscht, nichts installiert“. Lücken: Knopf-Etikett lügt, Überschrift ohne das Wort „Prüfsumme“, Blöcke kleben (P0-2, P1-1) |
| Fenstergrößen (1100 / 1024) | 5,5 | Layout hält, aber die Rail ist unter 1180 px kaputt (P0-1), Prüfungsanzeige zeigt die Zustimmung nicht (P1-2) |
| Werkzeug-Charakter, Tastatur | 8,5 | Kürzel an jedem Eintrag und jeder Hauptaktion, Strg+K, F6, ruhige Dichte |
| **Gesamt** | **7,1** | |

## Methode und Grenzen

- Gesehen: 40 der 88 Fotos in `docs/shots/` (Start, Start-leer, Programme, Programm-Detail, Installieren, Prüfsumme, Druck leer/Hinweise/Fehler, Mockups leer/Motiv/Kontaktbogen, Social, Bibliothek, Einstellungen, Updates, Erststart, Befehle; 1280 × 800 und 1100 × 700, beide Themen).
- Zusätzlich gegen den Dev-Server (Mock; Vite-Cache und alle Aufnahmen im Scratchpad, Projekt unberührt) bei **1024 × 680** (Mindestgröße, dazu gibt es keine Fotos), 1100 × 700 und 1280 × 800: DOM-Messung der Rail, Install-Dialog, Prüfsummenfehler, Offline, Ordner verloren, Netz weg, Installation läuft/fertig, Export-Erfolg, Freistellen-Vorschau.
- Code: `apps/desktop/src/**` gezielt gelesen (Rail, InstallDialog, i18n, ui.css, install.css, shell.css, Cutout/Mockup/Social-Stellen).
- **Nicht geprüft:** Laden-Zustände (weder Foto noch e2e-Aufnahme), 200 % App-Zoom, 1920 × 1080, echtes WebView2-Fenster, Tastaturlauf je Ansicht, Graustufen-Probe des Druckberichts.

## P0 (vor dem Zeigen beheben)

**P0-1 Rail unter 1180 px effektiver Breite ist kaputt.** Betrifft das Mindestfenster 1024, die 1100er-Fotos und auch Windows mit 125 % auf 1366 × 768 (= 1092 px).
- Beleg: `druck-hinweise_1100x700_*`: kein Eintrag invertiert, Icons links statt mittig, Abstand nur 20 px. DOM-Messung bei 1100 px: Jeder Rail-Link trägt als class-Attribut den Quelltext der Funktion (`({isActive:e})=>e?...`), Höhe 20 px, `aria-current="page"` ohne jede Optik.
- Ursache: `app/Rail.tsx:28–47`. Der `NavLink` mit `className`-Funktion steckt im `<Tip>` (Radix `Tooltip.Trigger asChild`), der die Funktion zu einem String zusammenfügt. Folgen: Ziele 55 × 20 px (WCAG 2.5.8 verletzt), keine Anzeige der aktuellen Seite, kein Hover. axe meldet es nicht.
- Korrektur: aktiven Zustand selbst berechnen (`useLocation` oder `useMatch`) und `className` als **String** übergeben. Playwright-Test bei 1100 und 1024 px: Element mit `aria-current="page"` hat die Klasse `rail__item--on`, Höhe ≥ 32 px, Icon mittig.

**P0-2 „Von anderem Spiegel laden“ im Prüfsummenfehler ist Etikettenschwindel.**
- `features/install/InstallDialog.tsx:645–649` ruft `flow.reload` (Zeile 195 = derselbe Plan, dieselbe Quelle). Der Vertrag kennt keine Spiegelwahl (`docs/ipc-contract.ts:424`, nur `mirrorRedirects`). Wer klickt, landet wieder in der Prüfungsanzeige derselben Quelle.
- Korrektur (`i18n/de/programs.ts:250`): „Erneut laden und prüfen“. „Spiegel“ ist Jargon und gehört höchstens in einen erklärenden Satz (siehe P1-1).

**P0-3 Messzeilen im Druckbericht lesen sich falsch.**
- Beleg (Inspektor von `druck-hinweise`, nach Scrollen): „Halbtransparenz 0,4 % ≤ 0,1 %“ und „Linienstärke 0,6 mm ≥ 0,8 mm“. Messwert und Grenze stehen mit demselben Operator hintereinander und ergeben als Aussage Unsinn. In einem Werkzeug, das misst, geht das nicht.
- Quelle: `i18n/de/print.ts:95–102` (Feld `limit`, liefert „≤ ...“), dargestellt in `features/printcheck/PrintInspector.tsx`.
- Korrektur: „gemessen 0,4 % · erlaubt höchstens 0,1 %“ bzw. „gemessen 0,6 mm · mindestens 0,8 mm“; Grenze als eigener Teil in `--mute`, Wert in `--fg`.

**P0-4 Entwicklertext und Doppelsatz in sichtbaren Texten.**
- (a) Mockups-Inspektor: „Vorschlag für den Alt-Text: Ansicht, Farbe kann abweichen: signal_v3.png“ (`features/mockup/Mockup.tsx:569`, `i18n/de/mockup.ts:74–76`). Eine Barrierefreiheits-Notiz erscheint als Messzeile. In den zugänglichen Namen der Leinwand legen, nicht sichtbar zeigen.
- (b) Druck leer: „oder aus der Bibliothek **Aus der Bibliothek wählen**“ (`i18n/de/print.ts:15–16`, `features/printcheck/PrintCheck.tsx:452–456`). Korrektur: „oder“ + Link „aus der Bibliothek wählen“.

## P1 (nächster Durchgang, vor der Weitergabe an die 5 Nutzer)

**P1-1 Prüfsumme falsch: unmissverständlicher machen** (`installieren-pruefsumme_*`).
- Die Überschrift „Die geladene Datei ist nicht die erwartete.“ nennt nicht, worum es geht; das Wort „Prüfsumme“ fehlt im Fehlerblock und über den Hashes. Vorschlag: „Prüfsumme stimmt nicht. Die Datei wurde verworfen.“ / „Es wurde nichts installiert und nichts ausgeführt. Dein Rechner ist nicht betroffen.“ / „Meist ist der Download unterwegs beschädigt worden. Selten wurde die Datei am Server verändert. Darum installieren wir nur, was zur Prüfsumme passt.“ (`i18n/de/programs.ts:246–249`).
- ERWARTET und BERECHNET kleben aneinander: `features/install/install.css:87–90`, `.compare { gap: var(--s-1) }` = 2 px. Korrektur: 16 px zwischen den Blöcken, 4 px Etikett zu Hash, Etiketten „ERWARTET (aus dem Manifest)“ und „BERECHNET (aus deiner Datei)“, Zusammenfassung als Text („5 von 16 Blöcken weichen ab“). Die Markierung trägt heute schon nicht nur die Farbe (fett + unterstrichen), das bleibt.
- Fokus: Nach dem Wechsel Prüfung zu Fehler steht der Fokus auf `body` (gemessen). Der Vertrag verlangt Startfokus auf der Überschrift. Beim Stufenwechsel Fokus auf den Fehlerblock (`tabIndex=-1`) setzen.
- Netzfehler: „Geht automatisch weiter, sobald du online bist“ steht neben dem Knopf „Jetzt erneut“. Prüfen, ob die Wiederaufnahme wirklich passiert, sonst Text anpassen (`programs.ts:263`).

**P1-2 Prüfungsanzeige: Zustimmung und „Danach“ liegen unter dem Falz, der Knopf ist aber scharf.**
- `installieren_1280x800_*` zeigt den Satz „Cypher Studio lädt genau diese Datei ...“ halb abgeschnitten; bei 1024 × 680 sind weder ZUSTIMMUNG noch der vorangekreuzte Punkt „Mit Cypher-Paletten, Schriften und Vorlagen einrichten“ sichtbar (`InstallDialog.tsx:208–222`, Fuß 557–563). Strg+Enter löst ohne Scrollen aus.
- Korrektur: Einwilligungssatz und „Danach“-Haken in den festen Fuß über die Knöpfe; Quellpfad hinter „Warum diese Quelle?“ einklappen; Version und Lizenz in Atkinson statt Mono (nur Zahlen und Pfade in Mono).

**P1-3 „Messung zuerst“ (Kernidee) gilt in Social nicht und in Druck nur zur Hälfte.**
- Social (`social-story_*`): Der Inspektor trägt die Überschrift MESSUNG, zeigt aber zuerst Vorlage, Inhalt, Welt. Der Text „Berlin · Ort folgt“ liegt in der Zone „Bildunterschrift und Knöpfe“, und kein Messhinweis ist ohne Scrollen sichtbar. Ein Urteil (wie in Druck) und die Zonen- und Kontrastzeilen nach oben.
- Druck (`druck-hinweise_*`, `druck-fehler_*`): Das Urteil sagt „2 Hinweise“, die Zeilen stehen unter fünf Eingabegruppen (Bericht beginnt erst bei y > 735 von 800 px). In der Ausgangsleiste steht „1 Fehler zuerst beheben“, ohne den Fehler zu nennen. Korrektur: Bericht direkt unter das Urteil, Eingaben darunter einklappbar; oder die Urteilsfläche nennt die Befunde einzeilig („Halbtransparenz 0,4 % · Linienstärke 0,6 mm“).
- Die Ausgangsleiste im Fehlerfall bricht die Zusammenfassung um (Zeilenende mit „·“, AUSGANG sitzt auf der Grundlinie der zweiten Zeile): `druck-fehler_1280x800_papier.png`. Einzeilig mit Kürzung in der Mitte.

**P1-4 Cyan ist nicht mehr nur „gemessen/Ausgang“.**
- DESIGN §1: Cyan-Fläche nur für die eine Ausgangs-Aktion je Bildschirm. Gefunden: `variant="action"` auf Eingabe- und Wiederholen-Knöpfen, u. a. „Datei wählen“ in `druck-leer`, `mockups-leer`, `freistellen-leer` (`PrintCheck.tsx:448`, `Cutout.tsx:287`), „Ordner wählen“ in `start-leer` (`ProjectsPanel.tsx:142`, `ChooseRoot.tsx:73`), `TemplateStrip.tsx:91,138`, alle Fehlerknöpfe `InstallDialog.tsx:641–677`. In den Leer-Zuständen stehen dadurch zwei Cyan-Dinge (Aufnahme-Knopf plus ausgegrauter Ausgang).
- Korrektur: eine zweite Knopfart `primary` in Tinte (`--select-bg`) für „nächster Schritt“; Cyan bleibt Ausgangsleiste und Bestätigen im Dialog vorbehalten.

**P1-5 Mockups-Demo wirkt wie Attrappe, obwohl das echte Paket existiert.**
- `mockups-*`: polygonales Shirt mit radialem Lichtfleck, dauerhafte Warnzeile „Hoodie: Vorlage fehlt, das Paket ist nicht geladen“ im ersten Blick der Messspalte („Paket“ ist Jargon). `packs/mockups/tee-front/preview.png` zeigt, wie es mit den echten Ebenen aussieht (Faltenwurf, Rippkragen). Fotos und Vorführung mit dem echten Paket erzeugen (dann entfällt auch die Hoodie-Warnung).
- Schwarzes Shirt auf dunklem Umfeld (`mockups-motiv_*_tinte`) hat fast keine Kontur: bei dunklem Textil Umfeld „mittel“ vorschlagen oder 1-px-Kontur.

**P1-6 Freistellen-Vorschau läuft über.**
- `freistellen-ergebnis_1280x800_papier.png`: Das Bild misst 712 × 792 px in einer Bühne von 744 × 688 (gemessen), unten fehlen etwa 100 px (SIGNAL-Balken abgeschnitten). Vorher und Nachher sind auf Schwarz-auf-Schwarz nicht zu unterscheiden.
- Ursache: `features/cutout/cutout.css:59–71`, `max-height: 100%` greift nicht in einem Grid mit `auto`-Zeile. Korrektur: `.cmp__layer` mit `grid-template: minmax(0, 1fr) / minmax(0, 1fr)`, oder das Bild mit `width: 100%; height: 100%` und `object-fit: contain`.
- Der feste Satz „Kanten unsicher, zum Beispiel bei Haaren oder Glas. Für den Druck hart machen.“ steht neben „Halbtransparenz 0,4 %“ und widerspricht der Zahl; nur bei Überschreitung zeigen.

**P1-7 Segmentschalter haben einen leeren Schwanz.**
- Thema, Dichte, Bewegung, Updates (`einstellungen_*`), Platzierung und Verfahren (Druck): `ui/ui.css:313–334`. `.seg` ist `inline-flex`, wird im `.stack` zu einem vollbreiten Block, die Zellen bleiben schmal; es sieht aus, als gäbe es eine leere Zelle. Korrektur: `align-self: flex-start` und `width: fit-content`, oder bewusst `flex: 1 1 0` für gleich breite Zellen.

**P1-8 Erststart.**
- Zeitleiste (`erststart-auswahl_*`): Zahlen 0 bis 30 ohne Einheit, Kästen 1, 2, 3, [Balken], 5, 6 ohne sichtbare Namen. Die Namen stehen nur als `title` (`features/onboarding/Onboarding.tsx:66`), die Einheit „Min.“ existiert (`i18n/de/onboarding.ts:20`), erscheint aber nicht. Für Einsteiger unlesbar: Namen unter die Kästen oder nur den aktuellen Schritt benennen, Einheit an die Achse.
- Der Satz „Die Zeit schätzen wir, sobald der Download läuft.“ steht zweimal (oben rechts und unter der Liste).
- `erststart-kennung_1280x800_papier.png` ist mitten in der Animation aufgenommen (CYP / STU abgeschnitten, kein Start-Knopf), das Tinte-Foto zeigt den Endzustand. Nach dem Einrasten fotografieren. Der Start-Knopf ist klein und ganz unten gegen die 160-px-Schrift schwach.

**P1-9 Start: die erste Ansicht hat sichtbare Schiefen** (`start_1280x800_*`).
- Spaltenköpfe „Projekte“ (Text y ≈ 91, Haarlinie y ≈ 110) und „Programme“ (y ≈ 95, Linie y ≈ 120) fluchten nicht.
- Projektzeilen: Kollektion, Anzahl und Datum haben keine festen Spalten (die Anzahl springt zwischen x = 579 und 591).
- „VEKTOR · / DRUCK“ bricht in der Programmzeile mit hängendem Punkt um; Rolle einzeilig (`white-space: nowrap`) oder die Spalte breiter.
- `start-leer`: zwei Knöpfe „Ordner wählen“ in einem Bild. Im Szenario „Ordner verloren“ steht rechts weiter der Ordnerpfad mit „3.104 Dateien“, links „nicht erreichbar“.

## P2 (Politur)

- Bibliothek: Dateinamen werden am Ende gekürzt („cypher_wellenform_2k.p…“), die Endung geht verloren; der Vertrag verlangt Kürzen in der Mitte (die Ausgangsleiste nach dem Druck-Export macht es richtig). `bibliothek_1280x800_*`.
- Programm-Detail: „PRÜFSUMME ✓ installiert“ ist semantisch schief (Prüfsumme ist kein Zustand), das Wort sitzt 3 px höher als die Zeile; Etikett und Wert laufen ohne Abstand ineinander. Besser „PRÜFSUMME stimmte beim Laden“. Die Aktion „Starten“ steht in der Titelzeile, nicht unten rechts (`programm-detail_*`).
- Grün „eingerichtet“ und „Prüfsumme stimmt“ in Listen widersprechen der Regel „Grüne Häkchen nur im Urteil, Farbe gehört dem, was Arbeit braucht“ (DESIGN color.status.regel). Regel lockern oder in `--mute` setzen.
- Mono für Fließtext: „Was neu ist“ in einem Mono-Kasten (`einstellungen-updates`), „Vorlage fehlt, das Paket ist nicht geladen“, die Zeile „Inkscape 1.4.3 → 1.5.0“, Versionssatz im Installationsdialog. DESIGN: Mono nur für Gemessenes.
- Social: Zonen-Chip „Rand rechts ...“ wird am Leinwandrand ohne Auslassung abgeschnitten und liest sich als „Rand“ (`features/social/social.css:179–180`, `Social.tsx:146–171`); Vorlagen-Beschriftung „1080 × / 1920“ bricht, die Titel der zwei Vorlagen sitzen auf verschiedenen Zeilen; der Satz „Wähle eine Vorlage“ steht in der Mitte und im Inspektor zugleich, dazu die Vorlagen doppelt.
- Druck-Inspektor: „Export“ trägt die Browser-Standardmarke von `<details>` (Vertrag: keine Browser-Standardflächen); durch ein Phosphor-Caret ersetzen. „Shirtigo öffnen ↗“: Unicode-Pfeil statt Icon (DESIGN §8, kleiner Verstoß).
- Jargon für Einsteiger: „Spiegel“, „Paket“, „Alt-Text“, „Prüfungsanzeige“ (Alternative: „Übersicht vor dem Laden“). Du-Form und Satzbau sonst gut.
- Rail-Gruppe „EXTRA · OPTIONAL“ ist laut, die Bedeutung unklar; ohne Modell erklärt nur das Modul selbst, was fehlt.
- Befehlspalette zeigt auf der Startseite „Umfeld hell/mittel/dunkel“, das nur in Vorschau-Modulen etwas tut.
- Abstände im Druck-Inspektor: Untergruppen (Platzierung, Verfahren, Abstand oben) liegen 4 bis 8 px auseinander, der Vertrag verlangt 24 über Abschnittsköpfen; Hinweistexte kleben an der nächsten Gruppe.
- Laden-Zustände fotografieren (DESIGN §7 verlangt sie, es gibt keinen Beleg).

## Was bleibt (nicht umbauen)

- Gehäuse + Cyan-Kennungsbalken + inverser aktiver Eintrag (bei ≥ 1180 px); Kürzel an jedem Eintrag.
- Urteilsflächen mit Glyph-Form + Wort (DRUCKBAR MIT HINWEISEN, NICHT DRUCKBAR), Messspur-Chips mit Maßen, Lineale in Tiefcyan, gestrichelte Hilfslinien.
- Ausgangsleiste: Zusammenfassung links, Aktion mit Kürzel rechts, nach dem Export Cyan-Füllung mit Pfad (in der Mitte gekürzt) und zwei Folgeaktionen. Das ist die stärkste Idee der App.
- Installationsablauf: Prüfungsanzeige mit sechs Feldern, echter Fortschritt („136 / 380 MB · 14 MB/s“), Phasenliste, Erfolg mit einrastendem Programmnamen und „Prüfsumme stimmt Gruppe für Gruppe“.
- Zustandssätze nach der Formel Was passiert · was ist sicher · was tun (Offline, Ordner verloren, Netz weg), mit ehrlichen Zahlen.
- Kontaktbogen mit „Kontrast gering“ je Textilfarbe: echte Messung statt Dekor.
- Tokenbindung: im Code keine Farbwerte, Schatten oder Rundungen außerhalb der Tokens gefunden; der einzige Verlauf ist die Schraffur als Inhalt (`social.css:64`).
- Papier und Tinte beide vollständig, unbunte Flächen in Tinte, Schnitt statt Überblendung.

## PASS-Kriterien für die Zeigefassung

1. P0-1 bis P0-4 behoben; Rail bei 1024, 1100 und 1280 px geprüft (Playwright-Messung: `aria-current` hat Optik, Höhe ≥ 32 px).
2. Fotos neu erzeugt: Mockups mit echtem Paket, Erststart nach dem Einrasten, dazu je ein Foto bei 1024 × 680 (Druck, Prüfsumme, Installieren).
3. Prüfsummenfehler: Wort „Prüfsumme“ in der Überschrift, Knopf ehrlich beschriftet, Blöcke mit Abstand, Fokus auf dem Fehlerblock (mit Tastatur und Screenreader-Ansage geprüft).
4. Kein Entwicklertext und keine falsche Ungleichung in sichtbaren Texten (Suche in `i18n/de/*.ts` nach „Alt-Text“, „≤“, „≥“, doppelten Sätzen).
