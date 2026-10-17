# Bericht Team B (Oberfläche)

Stand 17.10.2026. Zone: `apps/desktop/src/**` (ohne `ipc/generated`), `apps/desktop/e2e/**`, Konfigurationsdateien in `apps/desktop`, `docs/third-party/B.md`, `docs/shots/**`, dieser Bericht. `docs/ipc-contract.ts` und `docs/tokens.css` sind unverändert (nur gelesen). Die Oberfläche wurde ausschließlich gegen das gemockte IPC geprüft; ein echtes Tauri-Fenster (WebView2) lief in dieser Zone nicht (siehe „Offen“).

## 1. Was gebaut ist

**Phase 0 (Gerüst)**
- Aliase `@contract` (→ `docs/ipc-contract.ts`), `@tokens` (→ `docs/tokens.css`, Schriftpfade beim Laden umgeschrieben, Datei bleibt unverändert), `@/*`.
- Typisierte Aufrufe (`ipc/commands.ts`: `call(cmd, args)` mit `CommandArgs`/`CommandResult`, `exportSaveImage` für den RAW-Command), `errors.ts` (jede Ablehnung wird `AppError`), Channels, Ereignisse (`events.ts`: Ereignisse laden nur neu, Fortschritt der Aufträge geht in einen Store).
- Mock für alle Commands des Vertrags (`ipc/mock`, ein Test prüft, dass `Object.keys(handlers)` genau `COMMAND_NAMES` ist), deutsche Beispieldaten, Szenarien (`fresh`, `libraryEmpty`, `folderLost`, `offline`, `busy`, `updateAvailable`, `setupConflicts`, `installChecksumFail`, `installNetworkFail`, mit `+` kombinierbar), feste Uhr (16.10.2026, 14:40 Berlin). Aktiv automatisch im Browser ohne Tauri.
- Gerüst nach CONCEPT: Rail (Tinte), Titelzeile, Vorschau, Inspektor „Messung“, Ausgangsleiste (Strg+Enter), Hash-Router mit träge geladenen Ansichten, Fehlergrenze, Befehlspalette (Strg+K), Aufträge (Strg+J), Hilfe (F1), F6-Bereichswechsel, App-Zoom 50 bis 200 %, Papier/Tinte/System, Dichte, Bewegung.
- `i18n/de` enthält alle sichtbaren Texte (ESLint-Regel verbietet Textliterale in Komponenten, auch `alt`/`title`/`aria-label` mit Inhalt), `errors.ts` und `findings.ts` setzen `AppError` und Prüfbefunde in Sätze um.
- Schriften selbst gehostet (Anybody, Atkinson Hyperlegible Next, Martian Mono, woff2 + OFL-Texte), Phosphor Regular, CSP-tauglich (kein Inline-Skript, keine `<style>`-Elemente zur Laufzeit, nur `style`-Attribute).

**M1-Bildschirme (volle Qualität, alle Zustände)**
- Start (Projekte, Programme, Ordner, Vorlagen; leer, ohne Ordner, Ordner verloren, Erststart unvollständig).
- Programme: Tafel mit „Bandbreite“ (Name füllt die Spalte über die Achse `wdth`), Detail (Übersicht, Einrichtung, Verlauf), Installationsdialog mit den sechs Angaben Quelle, Version, Größe, Lizenz, Prüfsumme, Zielordner und beschrifteter Zustimmung, Fortschritt mit Abbrechen, Sicherheitswarnung bei falscher Prüfsumme (beide Summen gegenübergestellt), Netz-, Platz-, Läuft-noch-Fehler.
- Druckprüfer: Ziehen oder Dialog, Vorschau mit Raster, Maßen, Linealen, Messspur, Regelprüfer mit Ampel (Form + Wort + Farbe), Druckbreite live, Export über die Ausgangsleiste (Strg+Enter), „Trotzdem exportieren“ fragt nach.
- Aufträge-Popover.

**Danach**
- Einrichtung je Programm (Bausteine mit Status, Konflikt braucht Wahl, Anwenden, Rückgängig, gesperrte Datei je Zeile).
- Bibliothek: virtualisiertes Raster und Liste (5.000+ Einträge, Seiten zu je 200 nachgeladen), Filter (Art, Kollektion, Tags), Mehrfachauswahl mit Sammel-Tags, Schnellansicht (Leertaste), alle Leer- und Fehlerzustände.
- Einstellungen (Darstellung, Arbeitsfläche, Programme, Bibliothek, Profile, Updates, Netzwerk und Daten, Tastenkürzel, Über und Lizenzen) und Updates.
- Erststart (Kennung mit Suchlauf, Auswahl, Download-Zeitleiste, Startklar-Band).
- **Mockups**: Engine in reinem TypeScript (Worker + OffscreenCanvas, Rückfall auf den Hauptstrang), Platzierung nach Shirtigo-Maßen, Textilfarben, Bühne, Kontaktbogen aller Farben (Taste K), Messung (Motivbreite, Transparenz, Kontrast je Textilfarbe), Export mehrerer Farben in den Projektordner `Mockups`, „Als Social-Bild weiter“. Seit der Korrekturrunde 1 laden Mock und Tests die echten Vorlagen aus `packs/mockups/` (Shirt und Hoodie, vorne und hinten, je sechs Textilfarben).
- **Social-Generator**: 1080 × 1350, 1080 × 1920, Reel-Cover; Sicherheitszonen und Profilraster aus `docs/research/vorgaben.md`, Layout-Engine in reinem TypeScript, PNG/JPEG-Export, Messung (Zone, Kontrast, kleinste Schrift, Bildauflösung), Fokuspunkt, Farbwelten aus der Palette der Marke.
- **Freistellen**: Vorher/Nachher mit Trennlinie (Tastatur), Farbschlüssel (läuft sofort), Modell nur mit installiertem Modell (sonst Hinweis und gesperrt), Prüfung der Kanten auf Textilfarbe/Papier/Tinte, Speichern, „Im Druckprüfer öffnen“.

Umfang: ca. 24.000 Zeilen TypeScript/TSX, 4.200 Zeilen CSS, 8.200 Zeilen Tests.

## 2. Wie es geprüft wurde (Zahlen aus den Läufen vom 16./17.10.2026)

| Prüfung | Ergebnis |
|---|---|
| `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) für `src` und für Konfigurationen und Tests | 0 Fehler |
| `eslint --max-warnings 0 src e2e` (mit Typen, kein `any`, `switch-exhaustiveness-check`, Texte nur aus `i18n`) | 0 Funde |
| `stylelint "src/**/*.css"` (nur Tokens, keine Schatten, keine Rundungen) | 0 Funde |
| `prettier --check` | sauber |
| Vitest | 29 Dateien, **497 Tests**, grün. Abdeckung (`ipc`, `i18n`, Engines, `lib`): Anweisungen 83,3 %, Zeilen 83,0 %, Zweige 76,9 %, Funktionen 57,4 % |
| Playwright gegen den Dev-Server (Port 1420) | **219 Tests**, grün: Navigation und Tastatur (Strg+1 bis 7, F6, Strg+K, Tab ohne Falle), Installation (auch Abbrechen und Prüfsummenfehler), Druckprüfer mit Export, Bibliothek, Programme/Einrichtung, Einstellungen, Erststart, Mockups (7), Social (6), Freistellen (4), Bewegung und Zoom (11), Rauchtest (13), Stilprüfung (24) |
| axe-core (WCAG 2.2 AA, alle Stufen, nicht nur schwere) | **64 Läufe** (32 Ansichten und Zustände × Papier und Tinte), 0 Verstöße, Kontrast eingeschlossen |
| CSP (`npm run e2e:csp`) | Produktions-Build im Mock-Modus, Header wörtlich aus `src-tauri/tauri.conf.json`; 3 Tests grün, 0 `securitypolicyviolation`; Gegenprobe (eingeschleustes Inline-Skript wird blockiert und gemeldet) |
| Bewegung | Mit `prefers-reduced-motion` läuft in den Abläufen keine Animation und kein Übergang (`getAnimations()`); ohne den Wunsch füllt sich die Ausgangsleiste (`outbar-fill`, 240 ms); „Voll“/„Reduziert“ in den Einstellungen gelten vor dem Systemwunsch |
| Zoom 200 % (App-Zoom) | 8 Ansichten: kein Querscrollen, Ausgangsleiste im Fenster, Fokusring (Umriss ≥ 2 px) an den ersten vier Tab-Stopps |
| Rauchtest (Browser-QA, Phase 1) | 13 Abläufe: 0 Konsolenfehler/-warnungen, 0 fehlgeschlagene Anfragen, CLS < 0,1 |
| Stilprüfung | Jede Klasse im DOM hat eine Regel in den geladenen Stylesheets beim direkten Einstieg (24 Zustände); ausgenommen sind benannte Haken (`e2e/styles.spec.ts`) |
| Produktions-Build (`npm run build`) | Ohne Mock-Code (nach Beispielnamen durchsucht); Einstieg 317 kB + gemeinsamer Teil 378 kB (zusammen ca. 211 kB gzip), Ansichten 15 bis 58 kB je, Mockup-Worker 13,6 kB |
| `npm audit --omit=dev` | 0 Funde. Mit Entwicklungswerkzeugen: 5 (hoch) über `stylelint → globby → fast-glob → micromatch → braces`, nicht ausgeliefert, Behebung bräuchte einen Hauptsprung von stylelint |

**Bildschirmfotos:** 156 Dateien in `docs/shots/` (seit Korrekturrunde 1, siehe Abschnitt 6; zuvor 88) (`<ansicht>_<breite>x<höhe>_<papier|tinte>.png`, 22 Ansichten, 1280 × 800 und 1100 × 700, Papier und Tinte), erzeugt mit `npm run shots`: start, start-leer, programme, programm-detail, installieren, installieren-pruefsumme, druck-leer, druck-hinweise, druck-fehler, bibliothek, mockups-leer, mockups-motiv, mockups-kontaktbogen, social-vorlage, social-story, freistellen-leer, freistellen-ergebnis, einstellungen, einstellungen-updates, erststart-kennung, erststart-auswahl, befehle.

**Selbstkritik an den Bildern (Vergleich mit DESIGN.md):** keine Kacheln mit Icon-Titel-Text, keine Glasflächen, keine Verläufe als Dekor (die Lichtverläufe auf den Shirts sind Bildinhalt des Mocks), keine Emoji, Radius 0, Haarlinien, Kennung in Anybody mit Bandbreite, Status immer als Form + Wort + Farbe. Beim Durchsehen fielen auf und wurden behoben: fehlende Stile bei direktem Einstieg (Schieberegler in Einstellungen und Freistellen, Kollektionsmarke in der Bibliothek), hängende „·“ am Zeilenende der Messzeile, doppelte Beschriftung in der Ausgangsleiste von Freistellen, Bibliotheksraster klebte links, Dialoge sprangen bei Höhenwechsel (jetzt oben verankert), Inspektor der Mockups sprang beim Laden des Motivs (Messzeilen stehen jetzt immer da), Wort der Kennung sprang von der Ersatzschrift (bleibt unsichtbar bis die Schrift da ist).

**Gefundene und behobene Fehler (Auswahl):** Endlosschleife im Social-Generator (neues Dokumentobjekt je Zeichnen → Layout → Bild nie geladen; Bilder erschienen nie in der Vorschau, jetzt stabil, die Social-Tests laufen dadurch deutlich schneller), Strg + / Strg − verlor bei schnellem Wiederholen Schritte (Lesen-Ändern-Schreiben), Format-Wechsel im Social ließ „fertig“ stehen, die Ansichtsfehler aus dem axe-Lauf (verschachtelte interaktive Elemente → Muster grid/row/gridcell, scrollbare Bereiche ohne Fokus).

## 3. Abweichungen und Entscheidungen

- **ESLint:** `only-throw-error` ist für `src/ipc/**` aus, weil das IPC laut Vertrag mit schlichten `AppError`-Objekten ablehnt (wie Tauri); `switch-exhaustiveness-check` zählt ein `default` als erschöpfend (`considerDefaultExhaustiveForUnions`), damit die 34 Fehlerarten einen allgemeinen Text bekommen können, wo es keinen besonderen gibt.
- **`tsconfig.node.json` ist kein Projektverweis mehr**; `npm run typecheck` prüft beide Konfigurationen nacheinander.
- **CSP-Test-Port 4175** statt 4173: Auf 4173 lauscht ein fremder Python-Server (nicht meiner, nicht angefasst).
- **CSP im Mock-Build:** einzige Abweichung von der Produktions-CSP sind `blob:` und `'self'` in `connect-src`, weil die Beispielbilder des Mocks `blob:`-Adressen sind und die Mockup-Ebenen aus dem eigenen Bundle kommen. In der App laden Bilder über `cyfile:`/`cyasset:` (dort erlaubt).
- **`@tauri-apps/plugin-opener` (JS)** wieder entfernt: Die Oberfläche ruft nur `app_open_external`.
- **Adobe:** „Adobe RGB“ erscheint als Farbraum der Shirtigo-Vorgabe (`adobeRgb` im Vertrag), nicht als Marke; ein Test sperrt Produktnamen und Logos.
- **Dialoge** sind oben statt mittig verankert (kein Springen bei Höhenwechsel, CLS).
- **Playwright-Tests unter Last:** Während der Läufe bauten andere Teams parallel; einige Tests wurden von festen Wartezeiten auf Bedingungen umgestellt. Alle 197 laufen jetzt auch mit 5 Prozessen und Wiederholung stabil.

## 4. Offen

1. **Kein echter Lauf im Tauri-Fenster.** Ungeprüft: `cyfile:`/`cyasset:` im WebView2 (CORS-Köpfe für `fetch` im Worker und in `designTone`), Ziehen von Dateien über das Ereignis `files:dropped` (im Mock ersetzt ein DOM-Drop es), echte Schriftdateien unter `http://tauri.localhost`, 4K/Skalierung 125 bis 200 % unter Windows. Vorschlag: ein manueller Durchgang mit `npm run tauri dev` nach dem Zusammenführen.
2. **Freistellen mit Modell:** Die Oberfläche (Wahl, Hinweis, Laden über den Installationsdialog, Lauf, Kantenprüfung) steht, getestet nur mit dem Farbschlüssel; das Modell selbst gibt es erst mit dem Cargo-Feature in Zone A.
3. **Mockups:** Die echten Vorlagen laufen im Mock (Korrekturrunde 1). In der App kommen sie über `cyasset:` aus Rust, das ist ungeprüft (siehe 1).
4. **Funktionsabdeckung 57 %** (Anweisungen 83 %): niedrig wegen vieler kleiner Hilfsfunktionen in den Engines und Worker-Rohren; die wichtigen Pfade sind über Playwright abgedeckt, nicht über Vitest.
5. **Eingabe großer Bilder:** `designTone` und der Social-Fokuspunkt lesen das Bild im Hauptstrang (auf 64 Pixel verkleinert, aber erst nach dem Dekodieren). Bei 64-MB-Bildern könnte das spürbar sein; Vorschlag siehe Vertragswunsch 2.
6. `npm audit` mit Entwicklungswerkzeugen: 5 Funde, siehe oben.
7. `docs/shots/` wiegt 12 MB; bei jeder Neuerzeugung wächst das Repository. Vorschlag: Fotos nur zu Meilensteinen einchecken, sonst `.gitignore`.

## 5. Wünsche an den Vertrag (nur Wünsche, `docs/ipc-contract.ts` ist nicht geändert)

1. **`PrintReport.checks`:** Der Bericht liefert Rohwerte und `findings`; die Oberfläche baut daraus die 11 Prüfzeilen (`features/printcheck/rules.ts`, `CHECK_RULES`) und kennt dafür die Grenzen aus dem Profil. Besser: Rust liefert je Regel `{ ruleId, state, measured, limit }`, dann gibt es eine einzige Quelle der Schwellen und keine Abweichung zwischen Rechnung und Anzeige.
2. **Leichte Bildabfrage:** ein Command `image_probe(handleId)` → `{ widthPx, heightPx, hasAlpha, transparentShare, luminanceHistogram }` (verkleinert in Rust). Heute dekodiert die Oberfläche das ganze Bild für „hat Transparenz“ und „hebt sich ab“ (Mockups, Social).
3. **`MockupDocument`:** Feld `exportColorIds: GarmentColorId[]`, damit die gewählten Exportfarben mit im Projektdokument liegen (heute nur `colorId`).
4. **Schriftpfade in `docs/tokens.css`** zeigen auf `./fonts/…`; die Oberfläche schreibt sie beim Laden um (Vite-Plugin). Besser ein Pfad, der ohne Umschreiben funktioniert (z. B. absolut `/fonts/…`), damit Seite (Zone D) und App dieselbe Datei nutzen.
5. **`files:dropped`** trägt `position`; für das Social-Modul wäre zusätzlich ein Hinweis nützlich, auf welche Zone gezogen wurde (heute nimmt das Modul den ersten Bild-Platz).

## 6. Korrekturrunde 1 (nach dem Finish-Gate-Review, `docs/reports/review-ui.md`, 7,1 von 10)

Alle P0 und P1 sind behoben, vom P2 das meiste. Jede Korrektur hat eine Prüfung, die sie festhält (`e2e/korrektur.spec.ts`, `e2e/rail.spec.ts`, `src/i18n/texts.test.ts`, Ergänzungen in `rules.test.ts`).

**P0**
- **Rail unter 1180 px (P0-1):** Radix `asChild` im Tooltip machte aus der className-Funktion des `NavLink` den Funktionsquelltext im `class`-Attribut (Ziele 20 px, keine Anzeige der aktuellen Seite). Der aktive Zustand wird jetzt selbst berechnet, `className` ist eine Zeichenkette. Geprüft bei **1024 × 680, 1093 × 614, 1280 × 800 und 1920 × 1080**: genau ein Eintrag mit `aria-current` und Klasse `rail__item--on` mit Hintergrund, Höhe ≥ 32 px, Symbole mittig, kein Querscrollen auf den sieben Hauptansichten, Ausgangsleiste im Fenster. Im Schmalen steht oben „CS“.
- **P0-2:** „Von anderem Spiegel laden“ heißt jetzt **„Erneut laden und prüfen“** (der Vertrag kennt keine Spiegelwahl). „Spiegel“ ist auch aus den Erklärsätzen verschwunden, ebenso „Prüfungsanzeige“ (jetzt „Übersicht vor dem Laden“).
- **P0-3:** Grenzen stehen in Worten: „0,4 % (erlaubt ≤ 0,1 %)“, „0,6 mm (nötig ≥ 0,8 mm)“, „109 dpi bei 280 mm (nötig ≥ 300 dpi)“. Außerdem stand bei einem Kontrast-Befund im Messwert „kein Befund“; jetzt „geringer Kontrast“.
- **P0-4:** Der „Alt-Text“-Vorschlag ist weg, der Text liegt im zugänglichen Namen der Vorschau. Der Doppelsatz im leeren Druckprüfer ist „oder aus der Bibliothek wählen“.

**P1**
- **Prüfsumme falsch:** Überschrift „Prüfsumme stimmt nicht. Die Datei wurde verworfen.“, darunter „Es wurde nichts installiert und nichts ausgeführt. Dein Rechner ist nicht betroffen.“. ERWARTET (aus dem Manifest) und BERECHNET (aus deiner Datei) stehen mit 24 px Abstand, dazu „10 von 16 Blöcken weichen ab.“. Ein Hauptknopf trägt den Startfokus (der Fehler wird als `role=alert` angesagt). Der Netzfehler verspricht nichts Automatisches mehr.
- **Übersicht vor dem Laden:** Zustimmung und „Danach“ stehen im festen Fuß und sind auch bei 1024 × 680 ohne Scrollen sichtbar. Der Quellpfad ist hinter „Warum diese Quelle?“ eingeklappt, Version, Größe und Lizenz stehen in Atkinson statt Mono.
- **Messung zuerst:** Social zeigt oben ein Urteil („Bereit mit Hinweisen“) mit Zonen-, Kontrast-, Schrift- und Bildzeilen. Im Druckprüfer steht der Bericht direkt unter dem Urteil (Eingaben darunter). Die Ausgangsleiste nennt den ersten Fehler („Zuerst beheben: Auflösung bei Druckgröße“) und bleibt einzeilig.
- **Cyan nur für „gemessen/Ausgang“:** neue Knopfart `primary` (Tinte) für „nächster Schritt“ (Datei wählen, Ordner wählen, Erneut laden, Freistellen). Cyan bleibt der Ausgangsleiste und dem Bestätigen im Dialog. Test: keine Cyan-Knöpfe außerhalb der Ausgangsleiste in den leeren Ansichten.
- **Freistellen:** Das Bild bleibt in der Bühne. Der Hinweis zur Halbtransparenz nennt die Grenze und erscheint nur bei Überschreitung.
- **Segmentschalter** ohne leeren Schwanz. **Start:** Spaltenköpfe fluchten, feste Spalten für Kollektion, Anzahl und Datum, Rolle einzeilig, im Schmalen gleich breite Spalten. Ohne Ordner gibt es ein einziges „Ordner wählen“, bei verlorenem Ordner sagt auch die Seitenspalte „nicht erreichbar“, beim Laden steht ein Platzhalter statt „Noch nicht gewählt“.
- **Erststart:** Zeitleiste mit Schrittnamen unter den Kästen und der Einheit „Min.“, der Satz zur Zeit steht einmal, der Einstiegsknopf ist größer, das Foto zeigt den Endzustand. Dabei fiel ein **echter Fehler** auf: Bei manchen Fensterbreiten (z. B. 1100 px) wuchs das Wort der Kennung über den Rand (Rückkopplung zwischen Spaltenbreite und Wortbreite). Behoben und für 1024, 1093, 1100, 1280 und 1920 getestet.
- **Mockups mit den echten Vorlagen** aus `packs/mockups/` (Shirt und Hoodie, vorne und hinten, je 6 Farben, Schema `mockup.schema.json`): `src/ipc/mock/packs.ts` lädt `template.json` und Ebenen im Mock-Modus direkt aus dem Repository (Vite `import.meta.glob`, `server.fs.allow`), der Produktions-Build enthält sie nicht (0 PNG in `dist`). Die Hoodie-Warnung entfällt. Die Platzierung passt sich Produkt und Motiv an (Hoodie-Druckfläche 330 × 280 mm), das Motiv wird gegen die Druckfläche in Breite und Höhe gemessen. Die Bühne „Vorlage“ erscheint nur, wo die Vorlage einen Hintergrund liefert. Dunkles Textil auf dunklem Umfeld bekommt automatisch „mittel“ (Kontur). Dabei gefunden und behoben: Beim Wechsel der Vorlage schien die vorige durch (die Leinwand wurde nicht geleert). Die Mock-Druckprofile sind an `packs/shared/formats.json` angeglichen (Hoodie vorne 330 × 280, Hoodie hinten 330 × 390, Shirt hinten 330 × 450).
- **Mock-Daten realistisch:** Blender 5.2.2, Krita 5.3.4.1, Inkscape 1.4.4, Kdenlive 26.08.2. Update-Beispiel ist Krita 5.3.3 → 5.3.4.1 (kein erfundenes „Inkscape 1.5.0“). Farbnamen sind deutsch, die Herstellerbezeichnung steht klar beschriftet als „Shirtigo: Black“.

**P2 (umgesetzt):** Bibliotheksnamen werden in der Mitte gekürzt (die Endung bleibt). „Prüfsumme stimmte beim Laden“ statt „Prüfsumme ✓ installiert“. „In Ordnung“ in Listen ist ruhig statt Grün. Mono nur für Gemessenes („Was neu ist“, Programm-Updates, leere Messzeilen). Zonen-Chips der Seitenränder laufen senkrecht. Die Vorlagenbeschriftung bricht nicht um, die Titel stehen auf einer Linie. „Export“ im Druckprüfer hat ein eigenes Zeichen statt der Browser-Standardmarke, „Shirtigo öffnen“ ein Symbol statt des Pfeilzeichens. Die Untergruppen im Druckprüfer haben Luft. Die Rail-Gruppe heißt „Extra“ ohne „optional“. Die Befehlspalette bietet „Umfeld“ nur in Vorschau-Ansichten an. Die Laden-Zustände sind fotografiert (`start-laedt`, `programme-laedt`, `bibliothek-laedt`, über die künstliche Antwortzeit `latency`).

**P2 (offen):** Die Aktion „Starten“ im Programm-Detail steht weiter in der Titelzeile. „Paket“ bleibt dort, wo es das Cypher-Einrichtungspaket meint. In den Mock-Szenen stehen die Vorlagen (Social) weiter als Platzhalter ohne Vorschaubild.

**Zahlen nach der Runde:** Vitest 29 Dateien, 497 Tests, grün (Abdeckung Anweisungen 83,1 %, Zeilen 82,8 %). Playwright 219 Tests, grün. axe 64 Läufe ohne Verstoß. CSP-Test 3 grün (mit den echten Vorlagen im Worker). Rauchtest CLS < 0,1. `tsc`, ESLint, Stylelint und Prettier sauber. **Bildschirmfotos:** 156 Dateien in `docs/shots/` (26 Ansichten × 1280 × 800, 1100 × 700 und **1024 × 680** × Papier und Tinte, 19 MB), darunter Mockups mit dem echten Paket (Shirt, Hoodie, Kontaktbogen in allen 6 Farben), der Erststart nach dem Einrasten sowie Prüfsumme und Installieren bei 1024 × 680.
