# Drittbausteine und Lizenzen

Stand: 2026-10-17. Diese Datei fasst die Listen der Bauteams zusammen (Quellen: `docs/third-party/*.md`, geprüft mit `cargo deny check` und dem npm-Lizenzcheck).

## Lizenzen im Überblick

| Teil | Lizenz |
|---|---|
| Eigener Code von Cypher Studio (App, Rust-Kern, Kommandozeile, Werkzeuge, Seite) | MIT (`LICENSE`) |
| Blender-Erweiterung „Cypher Export“ und App-Vorlage `cypher_ps2` (`packs/blender/`) | GPL-3.0-or-later (`packs/blender/cypher_export/LICENSE`), weil sie die Blender-Python-API nutzt |
| Mockup-Grundlagen (`packs/mockups/`), selbst modelliert und gerendert | CC0-1.0 |
| Schriften Anybody, Atkinson Hyperlegible Next, Martian Mono (`packs/shared/fonts/`, App, Seite) | SIL Open Font License 1.1 (Lizenztexte neben den Dateien) |
| Name, Kennung und Logo von Cypher Kollektiv und Cypher Studio | nicht MIT, alle Rechte vorbehalten (`packs/shared/brand/LICENSE-BRAND.md`) |
| Krita, Inkscape, Blender, Kdenlive | werden **nicht** mitgeliefert, sondern bei Bedarf unverändert aus den offiziellen Quellen geladen; es gelten deren Lizenzen (GPL). Die Namen sind Marken ihrer Inhaber; Cypher Studio nutzt keine fremden Logos. |
| Affinity | nur Verweis auf die Herstellerseite, keine Installation |

## Werkzeuge nur zum Bauen (nicht ausgeliefert)

| Werkzeug | Lizenz | Hinweis |
|---|---|---|
| Rust-Toolchain, cargo | MIT OR Apache-2.0 | |
| cargo-xwin / xwin | MIT OR Apache-2.0 | lädt für den Windows-Cross-Build die Microsoft-CRT- und Windows-SDK-Bibliotheken; deren Lizenz wurde beim Bauen akzeptiert (Entscheidung Rouven, 16.10.2026). Release-Builds laufen später auf GitHub-Windows-Runnern. |
| NSIS | zlib/libpng | Windows-Installer |
| linuxdeploy (AppImage) | MIT | |
| Node.js, Vite, TypeScript, Vitest, Playwright | MIT / Apache-2.0 | |

## Zone A: Rust-Kern, Tauri-Schicht, Kommandozeile
Jede direkte Abhängigkeit mit Version (aufgelöst in `Cargo.lock`), Lizenz und Zweck. `THIRD_PARTY.md` führt der Hauptchat zusammen;
`cargo deny check` prüft Lizenzen und Advisories (`deny.toml`). Stand: Phase 1 und 2.

### Ausgeliefert: cypher-core (und damit App und CLI)

| Crate | Version | Lizenz | Zweck |
|---|---|---|---|
| `serde`, `serde_json` | 1.0 | MIT OR Apache-2.0 | Serialisierung des Vertrags, Katalog, Zustand |
| `thiserror` | 2.0 | MIT OR Apache-2.0 | Fehlertypen |
| `ts-rs` | 12.0 | MIT | TypeScript-Typen des IPC-Vertrags erzeugen (Build und Test; zur Laufzeit ohne Wirkung) |
| `tokio`, `tokio-util` | 1.53 / 0.7 | MIT | Async-Laufzeit, `CancellationToken` |
| `futures-util` | 0.3 | MIT OR Apache-2.0 | Streams beim Download |
| `reqwest` | 0.13 | MIT OR Apache-2.0 | HTTP-Client (nur `rustls`, kein OpenSSL); Hostliste fest eingebaut |
| `rustls` | 0.23 | Apache-2.0 OR ISC OR MIT | TLS (Anbieter `ring`) |
| `url` | 2.5 | MIT OR Apache-2.0 | URLs parsen und prüfen |
| `sha2`, `hex` | 0.11 / 0.4 | MIT OR Apache-2.0 | SHA-256 aus dem signierten Katalog prüfen |
| `minisign-verify` | 0.3 | MIT | Katalog- und App-Signatur (minisign) prüfen |
| `directories` | 6.0 | MIT OR Apache-2.0 | Standardordner je Betriebssystem |
| `tempfile` | 3.27 | MIT OR Apache-2.0 | atomares Schreiben (Temp-Datei, dann Umbenennen) |
| `fs4` | 1.1 | MIT OR Apache-2.0 | Sperrdatei, freier Speicherplatz |
| `walkdir`, `globset` | 2.5 / 0.4 | Unlicense OR MIT | Ordner durchlaufen, Muster |
| `which` | 8.0 | MIT | Programme im PATH finden (Erkennung) |
| `sysinfo` | 0.38 | MIT | Betriebssystem, Architektur, Speicher |
| `infer` | 0.19 | MIT | Dateityp aus dem Inhalt (Handles) |
| `uuid`, `time`, `arc-swap`, `semver`, `tracing` | 1 / 0.3 / 1 / 1 / 0.1 | MIT OR Apache-2.0 | IDs, Zeitstempel, Katalog-Austausch ohne Sperre, Versionen, Logging |
| `zip` | 9.0 | MIT | ZIP entpacken (nur `deflate`) |
| `tar`, `flate2`, `liblzma` | 0.4 / 1.1 / 0.4 | MIT OR Apache-2.0 | `tar.xz`, `tar.gz` entpacken |
| `sevenz-rust2` | 0.24 | Apache-2.0 | 7z und 7z-SFX entpacken (Inkscape, Kdenlive) |
| `plist` | 1.10 | MIT | `Info.plist` der macOS-Programme lesen |
| `unicode-normalization` | 0.1 | MIT OR Apache-2.0 | Dateinamen für den Zip-Slip-Vergleich normalisieren (NFC) |
| `base64` | 0.22 | MIT OR Apache-2.0 | Schlüsseldateien im Katalog |
| `image` | 0.25 | MIT OR Apache-2.0 | JPEG, TIFF, WebP dekodieren (PNG läuft direkt über `png`) |
| `png` | 0.18 | MIT OR Apache-2.0 | PNG lesen und schreiben (`pHYs`, `iCCP`) |
| `tiff` | 0.11 | MIT | TIFF-Tags lesen (Auflösung, ICC-Profil); dieselbe Version wie in `image` |
| `fast_image_resize` | 5.5 | MIT OR Apache-2.0 | Skalieren (Lanczos3, vormultipliziertes Alpha) |
| `moxcms` | 0.9 | BSD-3-Clause OR Apache-2.0 | Farbprofile (sRGB, Adobe RGB, Display P3 erzeugen und umrechnen) |
| `winreg` (nur Windows) | 0.55 | MIT | Registrierung lesen (Erkennung installierter Programme) |
| `windows-sys` (nur Windows) | 0.61 | MIT OR Apache-2.0 | `AddFontResourceW`, `SendMessageTimeoutW`: Schriften des Benutzerprofils anmelden (einziger `unsafe`-Ort, zwei Aufrufe) |
| `pgp` (rPGP) | 0.21 | MIT OR Apache-2.0 | OpenPGP-Signatur der Krita- und Inkscape-AppImage prüfen (nur Prüfen, ohne `bzip2`) |
| `notify` | 8.2 | CC0-1.0 | Ordnerüberwachung der Bibliothek (entprellt); `inotify` (ISC) und `notify-types` kommen mit |
| `resvg` (mit `usvg`, `tiny-skia`, `fontdb`) | 0.48 / 0.12 / 0.24 | Apache-2.0 OR MIT / BSD-3-Clause / MIT | SVG-Vorschaubilder der Bibliothek, nur gerastert; Markenschriften werden aus den Paketen geladen, keine System-Schriften |

### Ausgeliefert: cypher-cli

| Crate | Version | Lizenz | Zweck |
|---|---|---|---|
| `clap` | 4.6 | MIT OR Apache-2.0 | Kommandozeile |
| `minisign` | 0.9 | MIT | Katalog signieren (`catalog sign`, nur mit Entwicklungsschlüssel) |
| `tracing-subscriber` | 0.3 | MIT | Warnungen des Kerns auf die Fehlerausgabe |

### Ausgeliefert: src-tauri

| Crate | Version | Lizenz | Zweck |
|---|---|---|---|
| `tauri`, `tauri-build` | 2.12 / 2.7 | Apache-2.0 OR MIT | App-Rahmen, Commands, Capabilities |
| `tauri-plugin-dialog` | 2.8 | Apache-2.0 OR MIT | native Dialoge (nur aus Rust benutzt) |
| `tauri-plugin-opener` | 2.7 | Apache-2.0 OR MIT | URL öffnen, im Ordner zeigen |
| `tauri-plugin-updater` | 2.14 | Apache-2.0 OR MIT | App-Update (minisign-signiert) |
| `tauri-plugin-process` | 2.4 | Apache-2.0 OR MIT | Neustart nach Update |
| `tauri-plugin-single-instance` | 2.5 | Apache-2.0 OR MIT | nur eine Instanz |
| `tauri-plugin-window-state` | 2.5 | Apache-2.0 OR MIT | Fenstergröße merken |
| `tracing`, `tracing-subscriber`, `tracing-appender` | 0.1 / 0.3 / 0.2 | MIT | Protokoll in Dateien (`<data>/logs`, täglich, 7 Tage); kein Netz, keine Telemetrie |
| `time` | 0.3 | MIT OR Apache-2.0 | Fälligkeit der Update-Prüfung |

### Nur Entwicklung und Tests

| Crate | Version | Lizenz | Zweck |
|---|---|---|---|
| `pretty_assertions` | 1.4 | MIT OR Apache-2.0 | lesbare Testvergleiche |
| `proptest` | 1.12 | MIT OR Apache-2.0 | Eigenschaftstests (Pfadprüfung) |
| `axum` | 0.8 | MIT | lokaler Test-Server (Range, Weiterleitungen, Abbrüche) |
| `minisign` | 0.9 | MIT | Testschlüssel, Testsignaturen |
| `jsonschema` | 0.33 | MIT | Katalog gegen das JSON-Schema prüfen |
| `sevenz-rust2` (mit `compress`) | 0.24 | Apache-2.0 | 7z-Testarchive erzeugen |
| `rand`, `rand_chacha` | 0.8 / 0.3 | MIT OR Apache-2.0 | Testschlüssel für die PGP-Prüfung (dieselbe `rand_core`-Version wie rPGP) |
| `tempfile`, `sha2`, `zip`, `image`, `png` (in `cypher-cli`, `src-tauri`) | wie oben | wie oben | Testdaten der Kommandozeilen- und Tauri-Tests (keine Auslieferung) |

Schriften, Bilder und Profile: keine Fremddateien im Repository. Die ICC-Profile (sRGB, Adobe RGB 1998, Display P3) werden zur Laufzeit
von `moxcms` erzeugt; der Name „Adobe RGB (1998)“ bezeichnet nur den Farbraum, den Shirtigo für den Upload empfiehlt.

## Zone B: Oberfläche (apps/desktop)
Stand 16.10.2026. Alle Versionen exakt gepinnt (`apps/desktop/package.json`, `package-lock.json`, keine `^` oder `~`). Lizenzen aus den installierten Paketen gelesen (`node_modules/<paket>/package.json`). Keine npm-Workspaces. Nichts global installiert. `THIRD_PARTY.md` führt der Hauptchat zusammen.

### Ausgeliefert (landet im Bundle der App)

| Baustein | Version | Lizenz | Zweck |
|---|---|---|---|
| `react`, `react-dom` | 19.3.1 | MIT | Oberfläche |
| `react-router` | 8.4.0 | MIT | Adressen mit `#` (HashRouter), träge geladene Ansichten |
| `@tanstack/react-query` | 5.104.3 | MIT | Abfragen der Commands, Zwischenspeicher, Neuladen über Ereignisse |
| `@tanstack/react-virtual` | 3.14.21 | MIT | Virtualisiertes Raster und Liste der Bibliothek (5.000+ Einträge) |
| `zustand` | 5.0.15 | MIT | Kleine Stores (Aufträge, Meldungen, Hauptaktion, Ablage gezogener Dateien) |
| `@tauri-apps/api` | 2.12.4 | Apache-2.0 OR MIT | Typisierter Aufruf der Commands, Ereignisse, Channels; `mocks` nur im Mock-Modus |
| `@radix-ui/react-popover` | 1.3.1 | MIT | Aufträge, Vorlagen-Popover (Fokusfalle, Tastatur) |
| `@radix-ui/react-tooltip` | 1.4.1 | MIT | Kurzinfos mit Tastenkürzel |
| `@radix-ui/react-tabs` | 1.2.1 | MIT | Reiter im Programmdetail und in den Einstellungen |
| `@radix-ui/react-toggle-group` | 1.2.1 | MIT | Umschalter (Segmente) mit Pfeiltasten |
| `@radix-ui/react-radio-group` | 1.5.1 | MIT | Auswahl mit einem Wert |
| `@radix-ui/react-slider` | 1.6.1 | MIT | Druckbreite, Toleranz, Zoom, Kalibrierung |
| `@radix-ui/react-dropdown-menu` | 2.2.1 | MIT | Mehr-Menü („…“) |
| `cmdk` | 1.1.1 | MIT | Befehlspalette (Strg+K), eingebettet in ein natives `<dialog>` |
| `@phosphor-icons/react` | 2.1.10 | MIT | Symbole im Schnitt Regular (Rail, Werkzeuge, Status); Tree-Shaking, nur die benutzten Symbole landen im Bundle |
| Anybody (variabel, woff2, Ausschnitt latin) | wie in `cypher-start` | OFL-1.1 | Kennung, Überschriften, Programmnamen („Bandbreite“ über die Achse `wdth`) |
| Atkinson Hyperlegible Next (variabel, woff2, latin) | wie in `cypher-start` | OFL-1.1 | Fließtext und Bedienung |
| Martian Mono (variabel, woff2, latin) | wie in `cypher-start` | OFL-1.1 | Messwerte, Prüfsummen, Etiketten |

Die drei Schriften liegen als `apps/desktop/public/fonts/*.woff2` mit den Dateinamen, die `docs/tokens.css` erwartet. Sie sind byte-gleich mit den Dateien in `C:\Users\Nevuor\Code\cypher-start\site\assets\fonts` (MD5 geprüft), nur umbenannt. Die OFL-Texte (`Anybody-OFL.txt`, `AtkinsonHyperlegibleNext-OFL.txt`, `MartianMono-OFL.txt`) liegen daneben und erscheinen unter Einstellungen → Über und Lizenzen. Kein CDN, kein Google Fonts, `font-src 'self'` genügt.

Eigener Code, keine Fremdbibliothek: die Mockup-Engine (`src/features/mockup/engine`, Canvas 2D, Worker, OffscreenCanvas), die Layout-Engine des Social-Generators (`src/features/social/engine`), der Farbschlüssel zum Freistellen (Vorschau), FitText („Bandbreite“), der Mock des IPC. Die Beispielbilder des Mocks werden zur Laufzeit gezeichnet (`src/ipc/mock/art.ts`), es liegen keine fremden Bilder im Repository. Die Mockup-Vorlagen im Mock-Modus sind die echten aus `packs/mockups/` (Zone C2, Lizenz in `packs/mockups/LICENSE`): Vite liest sie nur im Mock-Modus direkt aus dem Repository (`src/ipc/mock/packs.ts`), der Produktions-Build enthält sie nicht (geprüft: 0 PNG in `dist`); in der App liefert Rust dieselben Dateien über `cyasset:`.

### Nur Entwicklung, Bau und Tests (nicht ausgeliefert)

| Paket | Version | Lizenz | Zweck |
|---|---|---|---|
| `vite` | 8.3.4 | MIT | Dev-Server (Port 1420) und Bau |
| `@vitejs/plugin-react` | 6.1.2 | MIT | JSX-Umwandlung |
| `typescript` | 6.0.3 | Apache-2.0 | Typprüfung (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| `vitest` | 5.0.5 | MIT | Einheitentests |
| `@vitest/coverage-v8` | 5.0.5 | MIT | Abdeckung |
| `jsdom` | 30.1.3 | MIT | DOM für die Einheitentests |
| `@testing-library/react` | 16.3.3 | MIT | Komponententests |
| `@playwright/test` | 1.64.1 | Apache-2.0 | Browser-Tests gegen den Dev-Server mit gemocktem IPC, Bildschirmfotos |
| `@axe-core/playwright` | 4.14.0 | MPL-2.0 | axe (WCAG 2.2 AA) in den Tests; nur Entwicklung, MPL laut Allowlist erlaubt |
| `eslint`, `@eslint/js` | 10.13.0, 10.0.1 | MIT | Lint |
| `typescript-eslint` | 8.71.2 | MIT | Lint mit Typen (`switch-exhaustiveness-check`, kein `any`) |
| `eslint-plugin-react-hooks` | 7.1.1 | MIT | Regeln für Hooks |
| `globals` | 17.13.0 | MIT | Browser-Globals für ESLint |
| `stylelint` | 17.16.0 | MIT | CSS-Regeln (Tokens statt Zahlen, keine Schatten, keine Rundungen) |
| `prettier` | 3.9.10 | MIT | Formatierung |
| `@tauri-apps/cli` | 2.12.3 | Apache-2.0 OR MIT | `tauri dev` und `tauri build` (Zone A nutzt es, hier nur als Skript) |
| `@types/node`, `@types/react`, `@types/react-dom` | 26.6.5, 19.3.0, 19.3.0 | MIT | Typen |

`@axe-core/playwright` bringt `axe-core` (MPL-2.0) mit; die Datei wird nur in Tests geladen. `npm audit --omit=dev`: 0 Funde. `npm audit` (mit Entwicklungswerkzeugen): 5 Funde der Stufe hoch über `stylelint → globby → fast-glob → micromatch → braces` (Muster-Abgleich beim Lint, ohne fremde Eingaben, nicht ausgeliefert). Behebung nur mit einem Hauptversionssprung von stylelint, deshalb offen und im Bericht vermerkt.

Playwright lädt seinen Chromium in den Benutzer-Cache (`%LOCALAPPDATA%\ms-playwright`), nicht ins Projekt und nicht systemweit.

### Geprüft, bewusst nicht verwendet

- GSAP und jede Animationsbibliothek (BAU-REGELN 7): Bewegung ist CSS und die Web Animations API (Einrasten des Namens).
- CSS-in-JS, Tailwind, Komponentenbibliotheken mit eigenem Stil: widersprechen `style-src 'self'` und der Formsprache (Radius 0, Haarlinien).
- `lucide-react`, Emoji als Symbole: Phosphor Regular genügt, Emoji sind per Test verboten (`src/design-rules.test.ts`).
- Fremde Mockup-Vorlagen und Shirt-Fotos: Platzhalter-Vorlage wird gezeichnet, die echten Vorlagen liefert Team C2 als Paket.
- Adobe-Produktnamen, -Logos und -Icons: nirgends enthalten (Test `design-rules`). Vorkommen von „Adobe RGB“ ist der Farbraum der Shirtigo-Druckvorgabe (`adobeRgb` im Vertrag) und bleibt als Sachbegriff.
- `@tauri-apps/plugin-opener` (JS): nicht nötig, die Oberfläche ruft den Command `app_open_external`; das Plugin selbst liegt in Zone A (Rust).

## Zone C1: Einrichtungspakete, Vorlagen, Schriften
Stand 16.10.2026. Die Pakete enthalten **keinen fremden Code**, nur Daten (Paletten, Vorlagen, Titel, Profile) und Schriften. Die Skripte unter
`packs/tools/` haben **keine Laufzeit-Abhängigkeiten** (nur Node-Standardbibliothek). Alles unter „Ausgeliefert“ landet in `packs/dist` und damit im App-Bundle.

### Ausgeliefert (im App-Bundle)

| Baustein | Version / Stand | Lizenz | Zweck | Ort |
|---|---|---|---|---|
| Anybody (Etcetera Type Co.) | Upstream `fe7b55cf9d1563348ad95ac8e05f43b81a420c31` (10.03.2023); variable Dateien unverändert; statische Schnitte **abgeleitet** (fontTools-Instancer, unten) | SIL OFL 1.1, kein Reserved Font Name; Copyright 2020 The Anybody Project Authors | Anzeigeschrift in App, Krita, Inkscape, Kdenlive | `packs/shared/fonts/anybody/` |
| Atkinson Hyperlegible Next | Upstream `7925f50f649b3813257faf2f4c0b381011f434f1` (21.02.2025), unverändert | SIL OFL 1.1, kein Reserved Font Name; Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors | Lesetext | `packs/shared/fonts/atkinson-hyperlegible-next/` |
| Martian Mono (Evil Martians) | Upstream `8babba8a76cabf54543dca3a994d7af85e425f98` (23.07.2026), unverändert | SIL OFL 1.1, kein Reserved Font Name; Copyright 2021 The Martian Mono Project Authors | Messwerte, Maße | `packs/shared/fonts/martian-mono/` |

Herkunft, Prüfsummen und Änderungen im Einzelnen: `packs/shared/fonts/QUELLEN.md` und `SHA256SUMS`. Die OFL-Texte liegen je Familie bei (`OFL.txt`, byteidentisch zu Upstream).

Wichtig (Upstream-Fehler, gemessen): Die statischen „aufrechten“ Anybody-Dateien im Upstream-Repo haben `post.italicAngle = -10` und bytegleiche Glyphendaten wie die Kursiven.
Sie wurden nicht übernommen. Die statischen Anybody-Schnitte im Paket sind aus der unveränderten variablen Datei abgeleitet (erlaubt, weil kein Reserved Font Name gilt;
bleibt unter OFL-1.1, Namen folgen der Upstream-Benennung).

Eigene Inhalte (MIT, siehe Wurzel-`LICENSE`): Vorlagen, Paletten, Titel, Profile, Skripte, Schemas. Marke und Logos: alle Rechte vorbehalten (`packs/shared/brand/LICENSE-BRAND.md`);
die Wortmarke ist in Anybody gesetzt und zu Pfaden umgewandelt (OFL erlaubt Werke mit der Schrift).
Die Kdenlive-Projektvorlage `reel.kdenlive` wurde von Kdenlive 26.08.2 geschrieben (Daten, kein Programmcode) und von eigenen Angaben bereinigt.

### Nur Entwicklung und Tests (nicht ausgeliefert)

| Baustein | Version | Lizenz | Zweck |
|---|---|---|---|
| ajv | 8.17.1 | MIT | Gegenprobe des eigenen Schema-Prüfers in den Tests (`packs/tools/package.json`, devDependency) |
| fast-deep-equal | 3.1.3 | MIT | Abhängigkeit von ajv |
| fast-uri | 3.1.8 | BSD-3-Clause | Abhängigkeit von ajv |
| json-schema-traverse | 1.0.0 | MIT | Abhängigkeit von ajv |
| require-from-string | 2.0.2 | MIT | Abhängigkeit von ajv |
| fontTools | 4.67.0 | MIT | `packs/tools/authoring/fonts/instance_anybody.py` (venv in der WSL, nicht im Repo) |
| Krita | 5.3.4.1 (AppImage) | GPL-3.0 | Vorlagen/Paletten/Arbeitsfläche erzeugen und laden (WSL, `packs/tools/authoring/wsl/`) |
| Inkscape | 1.4.4 (AppImage) | GPL-2.0-or-later | Vorschaubilder und Wortmarke rendern, Vorlagen testen (WSL) |
| Kdenlive (mit MLT/melt 7.43) | 26.08.2 (AppImage) | GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL | Titel rendern, Projekt öffnen (WSL) |
| ImageMagick | 6.9.12 (apt, WSL) | ImageMagick-Lizenz (Apache-2.0-artig) | Kontaktbögen und Bildschirmfotos prüfen (nur von Hand) |
| xdotool, x11-utils, Xvfb | apt, WSL | BSD-3-Clause / MIT | Kdenlive-Oberfläche beim Erzeugen der Projektvorlage bedienen |

Die Programme werden nur in der WSL (Ubuntu 24.04) betrieben, nie unter Windows installiert (BAU-REGELN 9), nie ausgeliefert und nur aus den offiziellen Quellen geladen
(Krita: SHA-256 von download.kde.org und OpenPGP-Signatur, Kdenlive: SHA-256 von download.kde.org, Inkscape: OpenPGP-Signatur des AppImage und festgenagelte SHA-256
`d217fe05c92faaed5c3af46856b6299c98933dc722819cb5bc2ca052c5522166`).

## Zone C2: Blender-Paket und Mockup-Grundlagen
Stand 16.10.2026. Es wird nichts ausgeliefert, was nicht hier steht. Die Extension „Cypher Export“ und das
App-Template laufen innerhalb von Blender und bringen **keine eigenen Python-Pakete** mit.

### Laufzeit (in Blender)

| Name | Version | Lizenz | Zweck |
|---|---|---|---|
| Blender (Host, wird vom Katalog installiert, nicht mitgeliefert) | 4.5 LTS (≥ 4.2 laut Manifest), 5.2 LTS | GPL-3.0-or-later | Python-API (`bpy`), Extension-Format, offizieller glTF-Exporter |
| NumPy (in Blender enthalten) | 1.26.4 (Blender 4.5), 2.3.4 (Blender 5.2) | BSD-3-Clause | Dreiecks-/Begrenzungsquaderzählung in `checks.py`, Bildberechnung der Startszene |
| glTF-Exporter `io_scene_gltf2` (in Blender enthalten, Apache-2.0 + GPL-Teile) | 4.5.51 bzw. 5.2.40 | Apache-2.0 | `bpy.ops.export_scene.gltf`; die GLB wird danach von `glb_post.py` umgeschrieben |

Code unter `packs/blender/**` ist **GPL-3.0-or-later** (Blender-Python-API), eigene `LICENSE` in
`packs/blender/cypher_export/` (Blender-Extensions verlangen eine GPL-kompatible Lizenz).

### Nur Entwicklung und Tests (nichts davon wird ausgeliefert)

| Name | Version | Lizenz | Zweck | Bezug |
|---|---|---|---|---|
| Blender Linux x64 | 5.2.2 LTS, 4.5.14 LTS | GPL-3.0-or-later | Testmatrix `packs/blender/tests/run_matrix.sh`, Mockup-Renderer | `download.blender.org`, SHA-256 gegen `blender-<version>.sha256` geprüft (5.2.2: `84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168`, 4.5.14: `9ba871ff2ecd36526b77432745980b7e6664ecd0c7ca11c48849073dcfe06da3`), nur in der WSL unter `~/apps` |
| gltf-validator (npm) | 2.0.0-dev.3.10 | Apache-2.0 | offizieller Khronos-glTF-Validator für die exportierten GLB (`tests/validate_gltf.mjs`) | `npm install gltf-validator` in `~/tools/gltf-validator` (WSL, Node 22), nicht in einem Projekt-`package.json` |
| Node.js | 22 (WSL) | MIT | Laufzeit des Validators | vorhanden |

### Inhalte

| Inhalt | Herkunft | Lizenz |
|---|---|---|
| Mockup-Grundlagen `packs/mockups/**` (Bilder, `template.json`) | eigene Arbeit des Kollektivs, in Blender selbst modelliert und gerendert; keine Fotos, keine fremden Modelle, Texturen oder Marken; Quellskripte unter `packs/blender/mockup_build/` | **CC0 1.0** (`packs/mockups/LICENSE`) |
| Beispielmodelle und Texturen der Startszene (Kiste, Schild, Sofa, Shirt, Butler, Gasse) | selbst erzeugt per Skript (`build_startup.py`), Texturen prozedural | Teil des GPL-Codes (Ergebnis des Skripts); frei nutzbar |
| Palette „Cypher Kollektionen“ | `packs/shared/brand/brand.json` (Team C1) | Marke, siehe `LICENSE-BRAND.md` |
| Testmotiv der Vorschaubilder (Messzifferblatt) | eigene Zeichnung per Skript (`mockup_build/preview.py`) | CC0 1.0 |

Keine Adobe-Namen oder -Assets, keine fremden Markenlogos. Das Blender-Logo wird nirgends als Bild verwendet.

## Zone D: Downloader-Seite (site/)
Stand 16.10.2026. Alle Versionen exakt gepinnt (`site/package.json`, `site/package-lock.json`). Nichts davon wird mit der App ausgeliefert. Ausgeliefert wird nur das Ergebnis des Baus (`site/dist/`: HTML, CSS, zwei kleine Skripte, drei Schriften). `THIRD_PARTY.md` führt der Hauptchat zusammen.

### Ausgeliefert (liegt in `site/dist/`)

| Baustein | Version | Lizenz | Zweck | Quelle |
|---|---|---|---|---|
| Anybody (variabel, woff2) | wie im Projekt `cypher-start` | OFL-1.1 | Kennung, Überschriften, Programmnamen | `site/public/fonts/anybody.woff2`, Lizenztext `Anybody-OFL.txt` liegt daneben und wird mit ausgeliefert |
| Atkinson Hyperlegible Next (variabel, woff2) | wie `cypher-start` | OFL-1.1 | Fließtext, Bedienung | `site/public/fonts/atkinson.woff2` + `AtkinsonHyperlegibleNext-OFL.txt` |
| Martian Mono (variabel, woff2) | wie `cypher-start` | OFL-1.1 | Messwerte, Prüfsummen, Etiketten | `site/public/fonts/martian-mono.woff2` + `MartianMono-OFL.txt` |

Die Schriften sind unverändert aus `C:\Users\Nevuor\Code\cypher-start\site\assets\fonts` übernommen (dort bereits als woff2 vorhanden, Unterschriften im Original: `packs/fonts/`). Eigene Skripte (`boot.js`, `site.js`) und eigene Zeichnungen (`drawings.mjs`) stehen unter der Projektlizenz (MIT). Kein CDN, keine Bibliothek im Browser, kein GSAP (BAU-REGELN 7, ARCHITEKTUR R14).

### Nur Entwicklung, Bau und Tests (nicht ausgeliefert)

| Paket | Version | Lizenz | Zweck |
|---|---|---|---|
| `marked` | 18.1.1 | MIT | Markdown (`site/content/*.md`) zu HTML. Null Abhängigkeiten, eigene Erweiterungen in `src/templates/markdown.mjs` (Container, Schritte, Zeichnungen). |
| `ajv` | 8.20.0 | MIT | `release.json` gegen `release.schema.json` prüfen (Bau, Release-Skript, Tests). Mit seinen Abhängigkeiten (fast-deep-equal, json-schema-traverse, require-from-string, fast-uri). |
| `wrangler` | 4.151.1 | MIT OR Apache-2.0 | lokaler Server (`wrangler dev`, ohne Konto) und später der Deploy. Bringt `workerd` (Apache-2.0), `miniflare` (MIT), `esbuild` (MIT) und `sharp` mit. |
| `@playwright/test` | 1.63.0 | Apache-2.0 | Browser-Tests, Screenshots |
| `axe-core` | 4.13.0 | MPL-2.0 | Barrierefreiheitsprüfung in den Tests (nur Entwicklung, MPL laut Allowlist erlaubt) |

Hinweis zu `@img/sharp-win32-x64` (kommt über wrangler): Lizenz `Apache-2.0 AND LGPL-3.0-or-later` (enthält das vorkompilierte libvips). Das Paket ist nur eine Entwicklungsabhängigkeit von wrangler und wird nie weitergegeben oder ausgeliefert. `npm audit` meldet 0 Funde (wrangler 4.151.1 behebt die Meldung zu sharp aus 4.143.1).

`npm install` zeigt eine Warnung zu Installationsskripten von `esbuild` und `workerd`. Beide sind für den lokalen Betrieb nötig (Binärdatei). Es wurde nichts global installiert.

### Geprüft, bewusst nicht verwendet

| Kandidat | Grund |
|---|---|
| GSAP, ScrollTrigger, Lenis | Keine OSI-Lizenz (GSAP), und CSS scroll-driven animations tragen die Messspur-Szene ohne Bibliothek (BAU-REGELN 7, R14). |
| Lighthouse (`npx lighthouse`) | Nicht installiert (große Abhängigkeitsmenge). Stattdessen misst `tests/e2e/perf.spec.mjs` LCP, CLS und lange Tasks selbst per CDP (Handy, 4x CPU, langsames 4G), wie in `cypher-start`. |
| Weitere Markdown-Bibliotheken (markdown-it, remark) | `marked` genügt, hat keine Abhängigkeiten. |
| Bildschirmfotos fremder Betriebssysteme, Betriebssystem-Logos | Verboten (CONCEPT 9, DESIGN 6): Anleitungen sind eigene schematische Strichzeichnungen. |

