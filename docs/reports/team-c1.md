# Bericht Team C1: Einrichtungspakete (Krita, Inkscape, Kdenlive, Schriften), Vorlagen, Marke, Werkzeuge

Stand 16.10.2026 · Zone: `packs/**` ohne `packs/blender/**` und `packs/mockups/**`, `docs/third-party/C1.md`, `docs/reports/team-c1.md` · Commits auf `main`, nur eigene Pfade.

## 1. Ergebnis in Kürze

- Alle Binärformate sind **mit den echten Programmen** erzeugt oder in ihnen geladen und gemessen worden (WSL, offizielle AppImages mit Prüfsumme/Signatur: Krita 5.3.4.1, Inkscape 1.4.4, Kdenlive 26.08.2 samt melt 7.43).
- `node packs/tools/validate.mjs`: **2061 Prüfungen, 0 Fehler, 0 Hinweise**. `npm test` in `packs/tools`: **50 Tests, 44 laufen überall, 6 werten den Smoke-Test aus** (mit `CYPHER_SMOKE_DIR`: alle 50 grün). `node packs/tools/build.mjs`: baut `packs/dist` (214 Dateien, alle Pakete inkl. blender von C2, bytegleich bei jedem Lauf, Prüfsummen vollständig).
- Eigener Anteil an `packs/dist`: 176 Dateien, 9,1 MB unkomprimiert (Gesamt-dist inkl. C2: 24,9 MB, davon Mockups 14,5 MB; PNG/TTF/ZIP komprimieren kaum, siehe Risiko R18 „Installer < 24 MiB“).

## 2. Was gebaut wurde

| Ort (`packs/…`) | Inhalt | Erzeugt / geprüft mit |
|---|---|---|
| `schema/{common,pack,template,social,mockup,brand}.schema.json` | JSON Schema 2020-12 zu ARCHITEKTUR 4.4, 4.5, 4.8; `mockup` liefert C1, Inhalte C2 | Ajv 8 strict als Gegenprobe (Tests), eigener Prüfer |
| `shared/brand/{brand.json, LICENSE-BRAND.md, logos/}` | 3 Kollektionen, 6 Textilfarben (A-16), Kanalfarben inkl. Studio-Cyan `#00d4d8` (tief `#00676b`), 2 Paletten, Schriftzuordnung, Wortmarke hell/dunkel (Text zu Pfaden) | Inkscape 1.4.4 (Wortmarke), validate |
| `shared/formats.json` | eine Quelle für alle Maße (Druckflächen Creator 2.0/Cruiser 2.0, Poster A2 mit Anschnitt, Sticker, Social, Video) | Pflichtmaße aus ARCHITEKTUR 4.7 unabhängig geprüft |
| `shared/palettes/` | „Cypher Kollektionen“ (17 Farben, deutsche Namen) und „Cypher Textil (Druckfarben)“ als `.gpl` (Inkscape, Krita) und `.kpl` | echtes Krita lädt die `.kpl` (17 Einträge, Farben stimmen) |
| `shared/fonts/` | variable + statische Schnitte von Anybody, Atkinson Hyperlegible Next, Martian Mono, OFL, `SHA256SUMS`, `QUELLEN.md` | Upstream-Vergleich, fontTools, Schriftleser |
| `krita/` | `pack.json`; 9 Vorlagen (`.kra`) in `templates/Cypher/` mit `.desktop`, `.directory`, `.icon`; `bundles/cypher.bundle` (Paletten), `bundles/cypher-arbeitsflaeche.bundle`, `workspaces/cypher-druck.kws` | kritarunner (Python-API), Krita-GUI (xvfb) |
| `inkscape/` | `pack.json`; 9 Vorlagen (`.svg`, mm bzw. px, Hilfslinien, `inkscape:templateinfo`, Export-Hinweis 300 dpi, transparent) | Inkscape: Export-Pixelmaße, GUI-Vorlagenliste |
| `kdenlive/` | `pack.json` (braucht Paket `fonts`); 8 Titel (Bauchbinde, Titelkarte, Reel-Hook, Untertitel-Stil je 9:16 und 4:5); Profile `cypher_reel_1080x1920_30`, `cypher_reel_1080x1350_30` | melt rendert jeden Titel; Kdenlive listet die Profile |
| `fonts/pack.json` | Paket „fonts“: 20 statische Schnitte nach `userFonts`, 20 `installFont`-Aktionen mit Windows-Anzeigenamen | Schriftleser (Namen/Gewicht), fontconfig |
| `projects/<id>/` | 25 Projektvorlagen (`template.json`, `files/`, `preview.png`): Shirt/Hoodie vorn und hinten, Poster A2, Sticker, Post, Story, Reel-Cover je in Krita und Inkscape (18), `reel-kdenlive`, je Social-Vorlage ein Eintrag für das Social-Modul (6) | Schema, Maße gegen die Dateien, Vorschau gerendert (Inkscape) |
| `social/<id>/` | 6 Vorlagen nach `SocialTemplate`: Drop-Ankündigung (Post, Story), Motiv-Vorstellung, Event-Plakat, Zitat, Reel-Cover; `template.json` + `preview.png` | Schema, Zonen, Mindestschrift ≥ 28 px, Kontrast ≥ 4,5:1, Schriften nur aus `brand.json` |
| `samples/probe-motiv.png` | Probe-Motiv für den Erststart: 280 × 360 mm, 300 dpi, absichtlich 2,1 % Halbtransparenz | Pixelzählung im Test |
| `tools/` | `validate.mjs`, `build.mjs`, `gen-*.mjs` (Paletten, Bundles, Arbeitsfläche, Vorlagen, Titel, Projekt, Social, Pakete, Probe-Motiv), `lib/` (ZIP, PNG, XML, TTF, Schema, Farbe), `tests/`, `authoring/` (Krita-Python, WSL-Skripte) | Node 24, keine Laufzeit-Abhängigkeiten (Ajv nur devDependency) |

Zu den Vorlagen im Einzelnen:

- **Krita** (Leinwand = Druckfläche, 300 dpi, RGBA 8 Bit sRGB, transparent, Ebene „Motiv“): Shirt vorne/hinten 330 × 450 mm = **3898 × 5315 px**, Hoodie vorne 330 × 280 mm = **3898 × 3307 px**, hinten 330 × 390 mm = **3898 × 4606 px**; Hilfslinien für Mitte, ideale Breite 300 mm und Richtwert der sicheren Fläche 280 × 360 mm (Shirt) bzw. Höhe 240 mm (Hoodie vorne). Post 1080 × 1350, Story 1080 × 1920, Reel-Cover 1080 × 1920 mit Hilfslinien (oben 270, unten 672, seitlich 120; Rasterausschnitt y 240 bis 1680) und **gesperrter** Ebene „Sicherheitszonen (vor dem Export ausblenden)“. Zusätzlich Poster A2 (426 × 600 mm, 5031 × 7087 px) und Sticker (80 × 80 mm).
- **Inkscape**: gleiche Formate, Seite in mm (1 Benutzereinheit = 1 mm) bzw. px, Hilfslinien, `inkscape:export-xdpi/-ydpi` 300 bzw. 96, Seitengrund transparent. Die Zonenebene der Social-Vorlagen ist **gesperrt und ausgeblendet**, wird also nie mitexportiert (geprüft: Export vollständig transparent).
- **Kdenlive**: Titel im Cypher-Stil (Papier/Tinte, Empfang-Gelb als Akzent, Anybody UltraCondensed/ExtraBold, Atkinson, Martian Mono), Texte in der Sicherheitszone; Reel-Projekt `projects/reel-kdenlive/files/reel.kdenlive` (1080 × 1920, 30 fps, Spuren Untertitel, Titel, Video, Originalton, Musik). **Das Projekt hat Kdenlive 26.08.2 selbst geschrieben** (Oberfläche per xdotool bedient: `authoring/wsl/capture-kdenlive-project.sh`), `gen-kdenlive-project.mjs` entfernt nur Rechnerspezifisches und benennt die Spuren.

## 3. Wie geprüft (echte Befehle, Ausgaben gekürzt)

Windows (Node 24):

```
> node packs/tools/validate.mjs
2061 Prüfungen, 0 Fehler, 0 Hinweise
> node packs/tools/build.mjs
dist gebaut: 214 Dateien, Pakete: blender, fonts, inkscape, kdenlive, krita
> cd packs/tools && npm test
ℹ tests 50   ℹ pass 44   ℹ fail 0   ℹ skipped 6   (die 6 übersprungenen: Auswertung des Smoke-Tests, siehe unten)
> CYPHER_SMOKE_DIR=\\wsl.localhost\Ubuntu\home\nevuor\c1work\smoke-out node --test tests/live.test.mjs
ℹ tests 6   ℹ pass 6   ℹ fail 0
```

Was die Tests belegen: eigener Schema-Prüfer und Ajv (strict) urteilen bei allen Paketdaten und bei über 500 eingebauten Fehlern gleich; Negativtests zu allen Prüfgruppen (Palette, Marke, Schriften inkl. kursiver Datei unter aufrechtem Namen, Paket-Pfade, Wurzeln, Ausweichbausteine, `.kra`-Maße/dpi/Sperre, Bundle-md5, SVG-Größe/Export-Hinweis/Zonenebene, Kdenlive-XML/Schrift/Profil, Social-Kontrast/Zone/Mindestschrift, Vorlagenmaße); Pixelmaße und dpi aller Vorlagen gegen Sollwerte, die im Test noch einmal im Klartext stehen; Marken- und Textilfarben gegen CONCEPT 6.3 und A-16; Generatoren und `dist` deterministisch; Probe-Motiv 2,11 % Halbtransparenz (Soll 2,1 %).

Smoke-Test in der WSL (`packs/tools/authoring/wsl/smoke-all.sh`, vollständiges Protokoll `~/c1work/smoke-out/smoke.md`):

| Programm | Befehl (gekürzt) | Ausgabe / Befund |
|---|---|---|
| Quellen | `setup-apps.sh` | Krita: SHA-256 OK, OpenPGP gültig (Schlüssel `E9FB 29E7 4ADE ACC5 E303 5B8A B69E B4CF 7468 332F`); Kdenlive: SHA-256 OK; Inkscape: Signatur gültig (74E8 DA13 …, DSA-1024/SHA-1), SHA-256 festgenagelt `d217fe05…2166` |
| Krita | `kritarunner -s build_kra` | 9 Vorlagen mit Krita 5.3.4.1 erzeugt |
| Krita | `kritarunner -s verify_kra` (frisch und eingecheckt) | alle 9 öffnen: z. B. `cypher-shirt-front.kra` 3898 × 5315, xRes/yRes 300, RGBA/U8, sRGB; Ebene „Motiv“ leer; Social: Zonenebene `locked: true`; Hilfslinien in px wie erwartet |
| Krita | `kritarunner -s verify_resources` (Bundles / lose Dateien) | `workspaces: ["Cypher Druck"]`; Palette „Cypher Kollektionen“ `total 17`, „Cypher Textil (Druckfarben)“ `total 6`, alle Hexwerte gleich `brand.json` |
| Krita (Oberfläche) | `gui-krita-templates.sh` | Dialog „Create new document“ zeigt die Gruppe **Cypher** mit Symbolen: „Hoodie hinten (330 × 390 mm)“, „Hoodie vorne (330 × 280 mm)“, „Post 4:5 (1080 × 1350 px)“, „Poster A2 (426 × 600 mm)“ …, Beschreibung aus `Comment=`; „Use This Template“ öffnet ein ungespeichertes Dokument |
| Inkscape | `inkscape templates/<n>.svg --export-type=png --export-dpi=300 -o …` | `cypher-shirt-front.png: 3898 x 5315, RGBA`; `hoodie-front 3898 x 3307`; `hoodie-back 3898 x 4606`; `poster-a2 5031 x 7087`; `sticker 945 x 945`; Social bei 96 dpi `1080 x 1350/1920`; pHYs 300 bzw. 96 dpi; Exporte vollständig transparent |
| Inkscape (Oberfläche) | `gui-inkscape-templates.sh` | Willkommensdialog „Time to Draw“ listet die Kategorie **Cypher** neben Print, Video, Social … (Template-Info wird gelesen); Schrift Martian Mono aus `<profil>/fonts/cypher/` wird gerendert |
| Kdenlive | `melt -profile cypher_reel_1080x1920_30 kdenlivetitle:<datei>` | alle 8 Titel rendern in Profilgröße (RGBA), Titelkarte deckend, die anderen transparent; `fc-list`: 20 statische Schriften sichtbar |
| Kdenlive (Oberfläche) | Dialog „Project Settings“ | unter „Custom“: „Cypher Reel 4:5 (1080x1350, 30 fps)“, „Cypher Reel 9:16 (1080x1920, 30 fps)“; `kdenlive reel.kdenlive` öffnet mit Fenstertitel `reel / Cypher Reel 9:16 (1080x1920, 30 fps) — Kdenlive`, Spurnamen sichtbar; `melt reel.kdenlive` rendert 1080 × 1920 |

## 4. Zielpfade je Betriebssystem und Version

Die Pakete nennen nur `root` + `rel`; die Ordner löst `setup/roots.rs` auf (ARCHITEKTUR 7.4). Verwendete Wurzeln und `rel`:

| Paket | Wurzel | Windows / macOS / Linux (nativ, AppImage) | `rel` im Paket |
|---|---|---|---|
| krita | `kritaResources` | `%APPDATA%\krita` / `~/Library/Application Support/Krita` / `~/.local/share/krita` (Flatpak `~/.var/app/org.kde.krita/data/krita`) | `bundles/*.bundle`, `templates/Cypher/…`, `fonts/cypher/*.ttf`, lose: `palettes/*.kpl`, `workspaces/*.kws` |
| inkscape | `inkscapeProfile` | `%APPDATA%\inkscape` / `~/Library/Application Support/org.inkscape.Inkscape/config/inkscape` (Smoke-Test auf macOS offen) / `~/.config/inkscape` | `palettes/*.gpl`, `templates/*.svg`, `fonts/cypher/*.ttf` |
| kdenlive | `kdenliveData` | `%APPDATA%\kdenlive` / `~/Library/Application Support/kdenlive` / `~/.local/share/kdenlive` | `titles/*.kdenlivetitle`, `profiles/<name>` |
| fonts | `userFonts` | `%LOCALAPPDATA%\Microsoft\Windows\Fonts` (+ Registry laut Aktion) / `~/Library/Fonts` / `~/.local/share/fonts/cypher` | `<datei>.ttf` (flach) |

Versionsabhängig: `programVersions` je Paket (krita `>=5.2, <6`, inkscape `>=1.3, <1.5`, kdenlive `>=26.04, <27`); getestet nur mit den genannten Versionen. Das Schema erlaubt je Datei zusätzlich `platforms` und `programVersions`, derzeit ungenutzt. Auf Linux-AppImage liegt der Krita-Ressourcenordner unter `~/.local/share/krita` (wie nativ; geprüft mit `XDG_DATA_HOME`); `kritarunner` nutzt `…/kritarunner` (nur für die Tests).

## 5. Abweichungen vom Vertrag / von ARCHITEKTUR (bitte Zone I nachziehen)

1. **Schriften liegen jetzt in `packs/shared/fonts/<familie>/`** (Auftrag), nicht mehr in `packs/fonts/`. ARCHITEKTUR 0.4 A-09, 1.2 (Zeilen B und D), 8.6 und 10.4 nennen noch `packs/fonts/`; `packs/fonts/` enthält nur `pack.json` des Pakets `fonts`. Team B und D müssen ihre Importe auf den neuen Ort setzen (B hat Kopien in `apps/desktop/public/fonts/`).
2. **Anybody: die statischen Upstream-Dateien sind fehlerhaft.** Die „aufrechten“ `Anybody-*.ttf` in `Etcetera-Type-Co/Anybody` (`fonts/ttf/`) haben `italicAngle −10` und bytegleiche Glyphendaten wie die Kursiven (Regular = Italic). Sie wurden nicht übernommen; die statischen Anybody-Schnitte sind **aus der unveränderten variablen Datei abgeleitet** (`authoring/fonts/instance_anybody.py`, fontTools 4.67, deterministisch). Zulässig, weil keine der drei Familien einen Reserved Font Name deklariert (`QUELLEN.md`). Atkinson und Martian Mono sind unverändert aus Upstream.
3. **Neue Dateien im Schema-Ordner:** `common.schema.json` (gemeinsame Typen) und `brand.schema.json`.
4. **Zusätze gegenüber den Vertragstypen** (alle optional bzw. ergänzend; Rust sollte diese Dateien nicht mit `deny_unknown_fields` lesen oder die Typen erweitern):
   - `brand.json`: `formatVersion`, `channels` (Kanalfarben aus DESIGN.md), `base` (Tinte, Papier); `fonts[].files[].file` und `logos[].file` (Pfad relativ zu `packs/`) statt `url`; Schriftdateien dort sind die **statischen** Schnitte (Gewichte 400 bis 900).
   - `template.json` (Projekt): `formatVersion`, `socialTemplateId`/`mockupTemplateId` (Verknüpfung zum Modul), `assumptions`; `id` ohne Präfix `builtin:`; `preview` ist ein Dateiname.
   - `pack.json`: `formatVersion`, `description`, je Baustein `defaultSelected`, `fallbackFor`, `preview {colors, formats, fonts}`, je Datei `platforms`, `programVersions`.
   - Social: `formatVersion`, `description`, `tags`, `preview` (Dateiname) statt `previewUrl`, Fill-Typ „image“ mit `file`. **`safeZones` sind die Innenboxen** (hier soll Text/Logo liegen), nicht die gesperrten Randstreifen.
5. **Zwei Krita-Bundles statt einem** (`cypher.bundle` für Paletten, `cypher-arbeitsflaeche.bundle`), damit die Arbeitsfläche in der Einrichtung abwählbar bleibt (CONCEPT 6.3: optional). Ausweichweg: lose `.kpl`/`.kws` als Bausteine `palette-lose`/`workspace-lose` (`fallbackFor`, optional, standardmäßig aus; nie zusammen mit dem Bundle anwenden, sonst doppelte Ressourcen).
6. **Das Krita-Bundle entsteht per Skript, nicht in Krita**: Es gibt keine Python-Schnittstelle zum Erzeugen von Bundles. Das Format ist aus dem Krita-Quelltext/den mitgelieferten Bundles abgeleitet und wird zweifach belegt: md5sum-Prüfung in `validate.mjs` und **Laden in Krita 5.3.4.1** (Paletten und Arbeitsfläche erscheinen in der Ressourcenverwaltung). Die `.kra`-Dateien dagegen schreibt Krita selbst.
7. **Krita-Raster nicht gesetzt**: Die Python-API 5.3.4.1 hat keine Raster-Einstellung im Dokument (nur Hilfslinien); es gibt deshalb nur Hilfslinien.
8. **Keine Kdenlive-Render-Voreinstellung** (A-14, Ort Roaming/Local ungeklärt) und keine `preferences.xml`/`kritarc`/`kdenliverc`-Eingriffe.
9. **Nicht von C1 geliefert:** Projektvorlagen für Blender („Modell“) und Mockups (Eintrag in `packs/projects/…` mit `target: "mockup"` bzw. `programId: "blender"`); das Schema ist bereit, die Inhalte kommen von C2/Zone I. Die Mockup-Dateien von C2 verletzen derzeit `mockup.schema.json` (`printArea.quad` als `[x, y]`-Paare statt `{x, y}` wie `Point` im Vertrag); `validate.mjs` meldet das als Hinweis, mit `--strict` als Fehler.

## 6. Annahmen und offene Punkte

- **Lage der sicheren Fläche** (Shirt 280 × 360 mm, oben mittig; Hoodie vorne 280 × 240 mm nach CONCEPT 6.4) ist eine Annahme bis zum Testdruck; die Maße der kleinen Platte stehen in vorgaben.md, die Lage nicht. Gekennzeichnet in `formats.json` (`assumption`), in den Hilfslinien-Namen und in `template.json` (`assumptions`). Hoodie hinten hat keine sichere Fläche (keine Quelle). Sticker 80 × 80 mm ist ebenfalls eine Annahme.
- **Kdenlive-Schriften auf macOS** unklar: Die Titel nennen die Familie wie in der Schrift („Anybody ExtraBold“, Namenseintrag 1), das findet Qt unter Linux (geprüft) und sehr wahrscheinlich unter Windows (GDI-Familiennamen), unter macOS ist es nicht geprüft; dort fällt Kdenlive sonst auf eine Ersatzschrift zurück.
- **Windows/macOS nicht geprüft** (BAU-REGELN 9, nur WSL): Registry-Anmeldung der Schriften, Pfade je OS und die Programme selbst; die Pakete beruhen dort auf ARCHITEKTUR 7.4. Offen aus programme.md 9.4: Inkscape-macOS-Profilpfad und Startweg, Kdenlive-SFX.
- **Hidden-Ordner in `dist`**: `krita/templates/Cypher/.source`, `.icon`, `.directory` müssen beim Tauri-Bundling mitkommen (Team A bitte mit dem echten Bundle prüfen; `dist/manifest.json` listet alle Dateien als Gegenprobe).
- Größe: Krita-Vorlagen und die kopierten `.kra` in `projects/` (zusammen ca. 6 MB) sind die größten Posten von C1; die Poster-Vorlage allein 0,6 MB je Kopie.
- `gui-inkscape-templates.sh` hängt vom Zeitverhalten des Willkommensdialogs ab und ist nicht Teil von `smoke-all.sh`; `gui-krita-templates.sh` ebenso (Bildschirmkoordinaten für 1280 × 800).

## 7. Wartung (alle Befehle aus dem Repo-Wurzelordner, Windows, Node 24)

```
node packs/tools/validate.mjs [--dist] [--strict]     # prüfen
node packs/tools/build.mjs                           # packs/dist bauen (prüft vorher)
cd packs/tools && npm test                           # Tests
cd packs/tools && npm run gen                        # alle erzeugten Dateien neu schreiben (Paletten, Bundles, kws, Vorlagen, Titel, Projekt, Social, pack.json)
node packs/tools/gen-probe-motif.mjs                 # Probe-Motiv
node packs/tools/authoring/build-previews.mjs        # preview.png (braucht WSL mit Inkscape)
```

Nur in der WSL (AppImages, `authoring/wsl/`): `setup-apps.sh` (laden, prüfen, entpacken), `run-krita.sh build_kra` (Vorlagen neu mit Krita erzeugen; Dateien enthalten Zeitstempel und UUIDs, daher nicht bytegleich: nur bei Formatänderungen ausführen), `capture-workspace.sh`, `capture-kdenlive-project.sh`, `build-logos.sh`, `smoke-all.sh` (Gesamtprüfung mit allen Programmen, Ausgabe `smoke.md`).

## 8. Hinweise an andere Teams

- **A (Rust):** `pack.json`-Felder siehe 5.4; `sha256`-Schlüssel ist `src` (relativ zum Paketordner, auch `../shared/…`); `dist/manifest.json` gibt es zusätzlich. Aktionen `installFont` (mit `displayName` für den Registry-Wert) und `writeConfig` sind im Schema, `writeConfig`/`blenderExtensionInstall` nutzt nur C2. Bausteine mit `fallbackFor` nie zusammen mit dem Ziel-Baustein anwenden. Kdenlive-Paket verlangt `requiresPacks: ["fonts"]`.
- **B (Frontend):** Marke und Schriften in `brand.json` (statische Anybody-Schnitte upright); Social-`safeZones` = Innenboxen; Vorschauen in `preview.png`; Projektvorlagen als `TemplateInfo` ohne `aspect`/`source`.
- **C2:** `mockup.schema.json` (Quad als `{x, y}`), Pfade relativ zum Vorlagenordner; `validate.mjs` prüft eure `template.json` gegen das Schema.
- **I (Integration):** ARCHITEKTUR-Stellen zu `packs/fonts/` anpassen; `THIRD_PARTY.md` aus `docs/third-party/C1.md` ergänzen; `scripts/zone-check.mjs` kennt die neuen Pfade `packs/tools/**` (Zone C).
