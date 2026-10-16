# Bericht Team C2: Blender-Paket und Mockup-Grundlagen

Stand 16.10.2026. Zone: `packs/blender/**`, `packs/mockups/**`, `docs/third-party/C2.md`, dieser Bericht.

## Was gebaut wurde

### 1. App-Template „cypher_ps2“ (`packs/blender/app_template/cypher_ps2/`)
- `build_startup.py` erzeugt `startup.blend` reproduzierbar (`blender -b --factory-startup -P build_startup.py -- --out startup.blend --fingerprint fp.json`).
  Die .blend ist Build-Ergebnis (gitignored); die CI vergleicht den JSON-Fingerabdruck (Objekte, Dreiecke, Materialknoten, Bildhashes, Einstellungen).
- Szene: Meter, Maßstab 1, Einrasten am 0,1-m-Raster, Render 640 × 448 mit Kamera „Shop-Kamera“ (70°, Augenhöhe 1,6 m), EEVEE (`BLENDER_EEVEE_NEXT` in 4.5 / `BLENDER_EEVEE` in 5.x), Farbverwaltung „Standard“, Welt mit Mist-Einstellung und ein ausgeblendeter Nebelquader in „Referenz“ (ein Welt-Volumen machte Cycles-Bilder schwarz, daher bewusst nicht in der Welt).
- Sammlungen `Export` (startet mit `prop-kiste`, grüner Prüfbericht), `Referenz` (Mensch 1,75 m, Bodenraster, Shop-Kamera, Nebel; nie exportiert) und `Beispiele` (je ein Modell pro Präfix: `prop-kiste`, `prop-neon-schild`, `furn-sofa`, `prod-tee`, `fig-butler`, `room-gasse`; 112–400 Dreiecke, alle weit im Budget, Vertexfarben, ein bis zwei Materialien).
- Materialien „Cypher Basis/Stoff/Produkt“ (Textur × Vertexfarbe, Linear-Filter, kleine Texturen 128/256 px) und „Cypher Neon“ (Emission, Studio-Cyan); Palette „Cypher Kollektionen“ (17 Farben, gelesen aus `packs/shared/brand/brand.json`, Rückfall eingebettet; Farbraum je Blender-Version richtig: 5.x linear, 4.5 gamma).
- Arbeitsbereiche für Einsteiger: Aufbauen (mit Seitenleiste, Statistik und Anleitung als Texteditor), Modellieren, UV, Vertexfarben, Texturen malen, Material; Rest entfernt.
- `__init__.py`: Handler `load_factory_startup_post` (Ansichts- und Einraste-Voreinstellungen); keine Netzwerk- oder Dateizugriffe.

### 2. Extension „Cypher Export“ (`packs/blender/cypher_export/`, 1.0.0, GPL-3.0-or-later, `blender_version_min = 4.2.0`)
- Seitenleiste „Cypher“: Umfang (Sammlung „Export“ oder Auswahl), Präfix, Name, **Prüfbericht mit Ampel** (Form + Wort: Häkchen/„erfüllt“, i/„Info“, Dreieck/„Hinweis“, Kreuz/„Fehler“; grün/gelb/rot als Gesamtampel), Live-Prüfung (entprellt, abschaltbar), Korrektur-Knöpfe, Export mit Autor, Lizenz, Quelle; bei Fehlern gesperrt, „Trotzdem exportieren …“ mit Rückfrage (Namen und leerer Umfang sind nie überspringbar).
- Prüfungen aus `budgets.json` (Änderung ohne Code): Dreiecke je Präfix, Szene Handy/Desktop (Dreiecke und Draw-Calls, je zwei Zeilen), ≤ 2 Materialien, nur Basisfarbe + Emission (Metallic, Rauheit, Normal, Specular, Transmission, Coat, Sheen, Subsurface verboten), Alpha nur als Maske (Math „Runden“; weiche Alpha = Fehler), Emission-Stärke > 1 (Hinweis), Texturgröße (Potenz von 2, 8–512 px, Hinweis über 256), Texturfilter linear, UVs bei Texturen, Vertexfarben (Info), keine Kameras/Lichter (Hinweis, werden nie exportiert), Transformationen angewendet, Ursprung am Boden/mittig, Benennung kebab-case mit Präfix.
- Korrekturen: „Transformationen anwenden“ (vereinzelt geteilte Meshes), „Texturen verkleinern“ (nächstkleinere Potenz von 2, ≤ 512; erzeugt Kopien, Original bleibt mit Fake-User).
- Export `cypher.export_glb`: Prüfen → (bei „Trotzdem“: temporär verkleinerte Textur-Kopien) → offizieller glTF-Exporter (GLB, +Y oben, `export_apply`, ohne Kameras/Lichter, ohne Draco/Meshopt, WebP, Vertexfarben `ACTIVE`, UVs nur bei Texturen) → **Nachbearbeitung** (`glb_post.py`, reines Python): Bilder aus dem BIN-Chunk lösen, als `<name>-basis.webp` / `-emission.webp` neben die GLB, `bufferView` → relative `uri`, BIN neu gepackt → Dateiprüfung (verbotene Erweiterungen, Kameras, BLEND, Normal-Maps, NEAREST, Bildgrößen) → `<name>.lizenz.json` `{name, autor, lizenz, lizenzUrl, quelle}` (nur wenn nicht vorhanden). Ergebnisdialog.
- Asset-Bibliothek „Cypher 3D“ aus `cypher_studio.json` (`assetLibraryPath`), beim Deaktivieren nur der eigene Eintrag entfernt.

### 3. Mockup-Grundlagen (`packs/mockups/{tee-front,tee-back,hoodie-front,hoodie-back}/`)
Siehe Abschnitt „Mockups“ unten.

### 4. Paket und Bau
- `packs/blender/pack.json` (gegen `pack.schema.json` geprüft), `packs/blender/build.py` (baut `startup.blend` und `dist/cypher_export-1.0.0.zip`; vor `packs/tools/build.mjs` ausführen).
- `packs/blender/mockup_build/`: Schnittmuster, Faltenmodell, Netz, Rendern, Ebenen, Vorschau (`build_mockups.py` als Treiber).

## Mockups (`packs/mockups/<vorlage>/`)

Vorlagen: `tee-front`, `tee-back`, `hoodie-front`, `hoodie-back` (Druckprofile `shirtigo-tee-front|back`, `shirtigo-hoodie-front|back`). Je Vorlage `mask.png`, `shade.png`, `light.png`, `light-dark.png`, `displace.png`, `heather.png`, `preview.png`, `template.json` (gegen `mockup.schema.json` geprüft). Leinwand **2000 × 2500**, 8 Bit, insgesamt 15 MB (`heather.png` ist in allen Vorlagen byte-gleich, Git speichert es einmal).

- **Eigene Arbeit, keine Fotos, keine fremden Modelle.** Lizenz **CC0 1.0** (`packs/mockups/LICENSE`), die Skripte darunter GPL.
- **Entstehung** (`packs/blender/mockup_build/`): Schnittmuster in Metern (Unisex Größe L: Shirt Brust 56 cm, Länge 74 cm; Hoodie Brust 62 cm, Länge 72 cm, Kapuze, Känguru-Tasche, Rippenbund und -bündchen) → Dreiecksnetz je Lage (gestaffeltes Punktgitter + eingeschränkte Delaunay-Triangulation, 4,2 mm bzw. 2,7 mm, 150 000 bis 430 000 Dreiecke) → Höhenmodell aus Wölbungen, weichen Falten (Achsel-, Ärmel-, Bund-, Kapuzenfalten; die Rückseiten haben eigene Falten), Rippenbändern, Nähten und Doppelsteppnähten (als Geometrie, folgen der Faltenoberfläche) und Kordelösen → Cycles-Draufsicht (orthografisch, weiche Fensterlampe links oben) mit Strickstruktur per Bump-Shader. Drei Durchgänge: weißer Stoff, schwarzer Stoff (Sheen/Glanz), Höhe. Eine Stoffsimulation (Cloth mit Überlänge am festgesteckten Rand) wurde zuerst probiert, lieferte aber zerknüllte Flächen und Gitterartefakte; das gesteuerte Höhenmodell wirkt ruhiger und ist deterministisch.
- **Ebenen** (`maps.py`): `mask` (Alpha), `shade` (Beleuchtungsverlauf herausgerechnet, flache Fläche ≈ 0,965, Falten dunkler), `light` und `light-dark` (Stoffglanz für screen; hell/dunkel als eigene „Aufnahme“ je `variants`), `displace` (R = dx, G = dy aus dem Höhenverlauf, `displaceStrengthPx` 5), `heather` (Melange, soft-light). `variants`: hell = weiss, creme, sand, grau-meliert; dunkel = schwarz, navy (nutzen `light-dark.png`).
- **Druckfläche**: Viereck in Pixeln aus den Shirtigo-Maßen (330 × 450 mm Shirt, Hoodie vorne 330 × 280, hinten 330 × 390 mm) und dem echten Maßstab der Vorlage (Shirt 21,5 px/cm, Hoodie 16,6 px/cm); Oberkante 26 mm (Shirt vorne), 74 mm (Shirt hinten), 40 mm unter der Kapuzenöffnung (Hoodie vorne), 1 mm unter dem Nackenband (Hoodie hinten). Brust 30 × 40 cm (3:4) passt in die Fläche.
- **Vorschau** (`preview.py`, Komposition wie ARCHITEKTUR 5.4): Testmotiv (Messzifferblatt, eigene Zeichnung) in zwei Kollektionsfarben je Vorlage (Shirt: grau-meliert + schwarz, Hoodie: sand + navy). Die Bühne (Grau, weicher Schatten) ist Vorschauschmuck und kein Teil der Ebenen. Die Ergebnisse wurden mit dem Read-Werkzeug angesehen und nachgebessert (Kragen-Seite, Motivverhältnis, Melange zu wolkig, Stiche außerhalb des Umrisses, gezackte Kapuzenkante, Kontrast).

## Wie geprüft (echte Befehle, gekürzt)

Blender 5.2.2 LTS und 4.5.14 LTS (Linux, WSL, SHA-256 gegen `download.blender.org` geprüft; der Wert für 5.2.2 stimmt mit programme.md überein):

```
wsl -d Ubuntu -- bash packs/blender/tests/run_matrix.sh
== Blender 5.2.2 LTS
Blender 5.2.2 LTS: 37 von 37 Tests bestanden
  ok  Extension validiert (extension validate) / gebaut / installiert (install-file -r user_default) / aktiv, Asset-Bibliothek folgt der Einrichtung
  ok  startup.blend gebaut · zweiter Bau liefert denselben Fingerabdruck · Template per --app-template geladen
  ok  Seitenleiste zeichnet in drei Zuständen ohne Python-Fehler (echte Oberfläche über WSLg, alle 6 Arbeitsbereiche geöffnet)
  ok  Mockup-Grundlagen geprüft
  ok  glTF-Validator: 15 GLB ohne Fehler (validator 2.0.0-dev.3.10: Fehler 0, Warnungen 0, Info "URI is used in GLB container")
== Blender 4.5.14 LTS  (identisch: 37 von 37, alle Schritte ok)
Alle Prüfungen bestanden.
```

- **`tests/run.py`** (37 Tests je Version): jede Prüfung erkennt gezielt erzeugte Verstöße (Dreiecke je Präfix inkl. „knapp“, Szene Handy/Desktop, Draw-Calls, 3 Materialien, Metallic/Normal/Fremdshader, Alpha 0,5 und weich verbunden, Textur 300/1024/zu klein/nearest, fehlende UVs, Transformationen inkl. negativer Skalierung und geteilter Daten, Ursprung schwebt/versenkt/seitlich, Benennung, leerer Umfang); `budgets.json` wirkt ohne Code (Test mit geänderter Datei). Export: GLB-Parser **unabhängig vom Add-on** (`tests/glb_check.py`): keine `bufferView`-Bilder, `uri` relativ und Datei vorhanden, WebP-Köpfe Potenz von 2 und ≤ 512, BIN-Puffer lückenlos und ausgerichtet, keine Kameras/Lichter/Draco/Meshopt/KTX2, alphaMode nur OPAQUE/MASK, Dreiecke wie gemeldet und im Budget, Vertexfarben `COLOR_0` vorhanden, +Y oben, Unterkante 0; zweimaliger Export **byte-gleich**; vorhandene Lizenzdatei bleibt; ohne Textur keine UVs; Auswahl wird wiederhergestellt; „Trotzdem“ verkleinert nur temporäre Kopien (Original unverändert, keine Reste).
- **Startszene**: baut fehlerfrei, Fingerabdruck stabil (zweimal gebaut und nach Speichern/Laden gleich), alle Beispiele bestehen den Prüfbericht ohne Fehler und Hinweise, liegen im Budget und exportieren zu gültigen GLB.
- **Mockups** (`tests/check_mockups.py`): Maße, Farben vollständig abgedeckt, Druckflächenecken auf dem Stoff, Shade-Median 0,965 bis 0,969, Displace mittelwertfrei, Glanz < 0,5 und nur auf dem Stoff, Heather um 128; zusätzlich `template.json` und `pack.json` gegen die Schemas von C1 mit Ajv.
- Beim Zeichentest in der echten Oberfläche fiel ein Fehler auf, den die Unit-Tests nicht sehen: das Symbol `SEQUENCE_COLOR_04` gibt es in Blender 5.x nicht mehr (jetzt `COLLECTION_COLOR_04`, in beiden Versionen vorhanden); behoben.

## Abweichungen vom Vertrag und Entscheidungen

1. **Texturen per `EXT_texture_webp`** (in `extensionsUsed` und `extensionsRequired`), Bild-`uri` wie in 3d-konventionen.md Punkt 2. Ein Kern-`source` auf eine .webp ist nicht spezifikationsgerecht: der Khronos-Validator meldet `TEXTURE_INVALID_IMAGE_MIME_TYPE` (im Test nachgestellt). three.js 0.186.1 `GLTFLoader` unterstützt die Erweiterung. **Bitte der Shop-Session mitteilen**, falls dort nach `textures[].source` statt nach `images[].uri` gesucht wird.
2. `budgets.json`: zusätzliche, optionale Schlüssel `textures.minPx` (8), `textures.webpQuality` (90), `export.animations` (false), Block `checks` (Warnschwelle 0,9, Toleranzen Ursprung/Transformation). Alle bisherigen Schlüssel sind unverändert.
3. Der Export schreibt Vertexfarben immer (`export_vertex_color = ACTIVE`), Animationen aus (`export.animations`), UVs nur bei Texturen. `KHR_mesh_quantization` wird nicht erzeugt (optional laut Konvention).
4. **Mockup-Vorlagen mit eigenem Rendering statt Fotos** (ARCHITEKTUR 4.8 sieht Fotos der Muster-Box vor; die Auftragsvorgabe war eigenes Rendern). Das Ebenenformat ist dasselbe, spätere Fotos lassen sich Vorlage für Vorlage ersetzen. Leinwand 2000 × 2500 statt des Beispiels 2400 × 3000 (kleinere Dateien, entspricht dem Export „Shop 2000 × 2500“ 1:1).
5. **`pack.json`**: Das Schema verlangt je Baustein mindestens eine Datei; der Baustein „extension“ trägt daher die LICENSE als Datei (Ziel `blenderExtensionConfig`), die eigentliche Installation steht unter `actions`. Vorschlag an C1/I: `files: []` für reine Aktionsbausteine erlauben.
6. `startup.blend` und die Extension-ZIP sind Build-Ergebnisse (gitignored); `pack.json` verweist darauf. **Reihenfolge im Build:** `python packs/blender/build.py --blender <blender>` vor `packs/tools/build.mjs`.
7. Das Template enthält kein `userpref.blend` (Themes und Tastenkürzel bleiben die des Nutzers); der Texturfilter-Look (linear, kleine Texturen) steckt in Materialien und Texturen.

## Offen

- **Nicht auf dem echten Zielrechner geprüft:** Windows-Blender (nur Linux/WSL), Blender 4.2 (Mindestversion laut Manifest; getestet 4.5 und 5.2), echte Einrichtung über die App (Rust-Aktionen `blenderExtensionInstall`, `writeConfig`, Ordnerwurzeln). Der Smoke-Test 9.4 Nr. 6 (programme.md) ist positiv: `install-file -r user_default -e` funktioniert auf einem leeren Profil.
- **Bildschirmfotos der Blender-Oberfläche** liegen nicht vor: WSLg liefert für Blenders OpenGL nur schwarze Bilder (auch EEVEE-Renderings). Die Seitenleiste ist durch den Zeichentest (kein Python-Fehler in drei Zuständen) belegt, das Aussehen wurde aber nicht gesehen.
- Passform und Maßstab der Mockups beruhen auf Annahmen (Größe L, Shirtigo-Maße aus vorgaben.md); ein Testdruck (R12) sollte die Lage der Druckfläche bestätigen. Ärmel und Kapuze sind vereinfacht (Hoodie-Kapuze als flache Kuppel mit Öffnung, Kordeln nur als kurze Enden, damit sie die Druckfläche nicht kreuzen).
- Die Vorschaubilder wirken gerendert, nicht fotografiert; für Shop-Endbilder bleibt die Empfehlung aus vorgaben.md (4.2 e) bestehen.
- `mockup_build` braucht Blender 5.2 (Eingangsnamen des Principled BSDF der 5.x-API) und eine GPU oder viel Geduld (`--no-gpu`); komplette Neuberechnung ca. 25 Minuten auf einer RTX 3050 Ti.
- Die Szenenbudgets (Handy/Desktop) werden auf den Export-Umfang gerechnet; ein Gesamtbudget über mehrere Modelle gibt es nicht (dafür fehlt das Szenenmodell des Shops).

## Dateien

`packs/blender/` (`pack.json`, `build.py`, `.gitignore`, `app_template/cypher_ps2/`, `cypher_export/`, `mockup_build/`, `tests/`), `packs/mockups/` (LICENSE und 4 Vorlagen), `docs/third-party/C2.md`, dieser Bericht.
