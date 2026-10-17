# Cypher Studio – Architektur

Version 0.1 · 16.10.2026 · Status: **Entwurf zur Umsetzung** · Begleitdatei: [`docs/ipc-contract.ts`](ipc-contract.ts) (kanonischer IPC-Vertrag, Version 0.2.0)

Zielgruppe: Entwickler (auch KI-Entwickler auf Sonnet-Niveau), die parallel in getrennten Dateibereichen bauen. Bildschirme, Abläufe und Texte stehen in [`docs/CONCEPT.md`](CONCEPT.md), Gestaltung und prüfbarer Design-Vertrag in [`docs/DESIGN.md`](DESIGN.md) und [`docs/tokens.css`](tokens.css); dieses Dokument legt fest, **wie** das gebaut wird. Ausgangspunkt ist das vorhandene Gerüst (Commit „Grundgerüst: Tauri 2 + React …“: `apps/desktop` aus create-tauri-app, `packs/fonts`, `scripts/wsl-build.sh`). Alles, was mit **ANNAHME A-xx** markiert ist, wurde ohne fertige Recherche festgelegt und wird durch die Berichte in `docs/research/` (programme.md, catalog-draft.json, vorgaben.md, plattform.md) bestätigt oder ersetzt. Annahmen sind so gewählt, dass eine Korrektur **Daten** ändert (Katalog, Druckprofil, Paket-Manifest), nicht Code.

## Inhalt

0. [Überblick, Leitentscheidungen, Technikwahl, Annahmen](#0-überblick)
1. [Repo-Layout und Dateibereiche der Bauteams](#1-repo-layout-und-dateibereiche)
2. [Rust-Kern: Module und öffentliche API](#2-rust-kern-module-und-öffentliche-api)
3. [IPC-Vertrag: Commands, Channels, Events, Fehler](#3-ipc-vertrag)
4. [Datenmodelle](#4-datenmodelle)
5. [Abläufe](#5-abläufe)
6. [Sicherheitsmodell](#6-sicherheitsmodell)
7. [Plattform-Details](#7-plattform-details)
8. [Teststrategie und Qualitätstore](#8-teststrategie-und-qualitätstore)
9. [Bauplan, Meilensteine, Risiken](#9-bauplan-meilensteine-risiken)
10. [Externe Bausteine (Vorlage für THIRD_PARTY.md)](#10-externe-bausteine)

---

## 0. Überblick

### 0.1 Produkt in einem Absatz

Cypher Studio ist die Zentrale des Cypher Kollektivs: eine Desktop-App (Windows, macOS, Linux, deutschsprachig), die freie Profiprogramme (Krita, Inkscape, Blender, Kdenlive) aus offiziellen Quellen geprüft und ohne Adminrechte installiert, startet und mit einer **Cypher-Einrichtung** versieht (Paletten, OFL-Schriften, Vorlagen, Export-Voreinstellungen, Blender-Add-on). Dazu kommen eigene Module: **Druckprüfer** mit Export nach Shirtigo-Vorgaben, **Mockup-Generator**, **Social-Generator** und eine **gemeinsame Bibliothek**, die ohne Konten und laufende Kosten über einen geteilten Ordner funktioniert. Die App aktualisiert sich über den Tauri-Updater, der Programm-Katalog unabhängig davon über eine signierte JSON-Datei. Es gibt keinen Adobe-Nachbau, keine Adobe-Namen und keine Adobe-Assets.

### 0.2 Leitentscheidungen

| Nr. | Entscheidung | Grund |
|---|---|---|
| L1 | Der **Rust-Kern ist eine Bibliothek ohne Tauri-Abhängigkeit** (`crates/cypher-core`). Die Tauri-App (`src-tauri`) ist nur eine dünne Schicht aus Commands, Protokollen und Dialogen. | Testbar ohne WebView, nutzbar von der CLI (`cypher-cli`) für CI und die Linux-Probe in WSL. |
| L2 | **Das Frontend kennt keine Dateipfade.** Es arbeitet mit IDs (FileHandle, Bibliothekseintrag, Projekt, Installation). Dateien kommen nur über native Dialoge, Drag & Drop (in Rust abgefangen) oder die Bibliothek herein. | Kein Pfad-Missbrauch über die IPC-Grenze, kein `fs`-Plugin im Frontend nötig. |
| L3 | **Alle Netzwerkzugriffe in Rust**, das WebView hat `connect-src` nur für IPC. | Eine Stelle für Hostliste, TLS, Wiederholung, Abbruch. Kein Tracking über Web-Ressourcen. |
| L4 | **Keine Fernausführung von Code.** Der Katalog enthält nur Daten. Einrichtungspakete (inkl. Blender-Python) sind Teil des signierten App-Bundles und kommen nur mit App-Updates. | Ein kompromittierter Katalog kann höchstens auf Dateien mit festgenagelter Prüfsumme von erlaubten Hosts zeigen. |
| L5 | **Daten statt Code** für alles, was sich ändert: Programmversionen, URLs, Prüfsummen, Druckprofile (Shirtigo), Mockup- und Social-Vorlagen, Blender-Budgets. | Korrekturen ohne Umbau; Recherche-Ergebnisse fließen als Daten ein. |
| L6 | **Portable Installation** in den App-Datenordner (`<data>/programs/<id>/<version>/`; macOS: `~/Applications/Cypher Studio/`, CONCEPT.md 10), atomar über einen Staging-Ordner. Systeminstallationen werden erkannt und mitgenutzt, nie verändert. | Kein Admin, keine Registry-Einträge fremder Programme, sauberes Entfernen. |
| L7 | **Zustimmung ist an den Plan gebunden.** Jede Installation und jede Einrichtung läuft zweistufig: `*_preview` liefert einen Plan (was, woher, wie groß, Lizenz, wohin), `*_start`/`*_apply` führt genau diesen Plan aus. | Nutzer sieht vorher alles; Rust prüft, dass die Zustimmung zum gezeigten Plan passt. |
| L8 | **Einrichtung ist idempotent und umkehrbar**: Manifest aller geschriebenen Dateien mit Hash, Sicherung überschriebener Dateien, Journal gegen Abstürze. | Zweimal anwenden ändert nichts; Rückgängig stellt den Vorzustand her. |
| L9 | **Rendering von Mockups und Social-Bildern im WebView mit Canvas 2D** (OffscreenCanvas im Worker), Druckdateien dagegen **in Rust**. | Mockups/Social brauchen Schrift- und Layout-Rendering (Browser-Stärke); Druckdateien brauchen exakte Pixel, dpi-Metadaten und große Bilder (Rust-Stärke). Begründung in 5.4. |
| L10 | **Keine Telemetrie, keine Konten, keine laufenden Kosten.** Netzwerkziele sind abschließend in 6.8 aufgelistet. | Vertrauen im Kollektiv, DSGVO-Ruhe. |

### 0.3 Technikwahl: Tauri 2 + Rust + React 19 + TypeScript + Vite

| Kriterium | **Tauri 2** (gewählt) | Electron | Flutter | Qt / Slint | Wails |
|---|---|---|---|---|---|
| Installer-Größe | ca. 8–15 MB | ca. 90–150 MB | ca. 20–40 MB | Qt 30–60 MB, Slint klein | ca. 10–20 MB |
| Systemnahe Arbeit (Archive, Krypto, Bilder, Prozesse) | Rust: zip/7z/tar.xz, sha2, minisign, rPGP, png/tiff ohne Fremdlaufzeit | Node, viele native Module nötig | Dart, schwächeres Ökosystem für 7z/PGP | C++/Rust gut | Go gut |
| Sicherheitsmodell | Capabilities je Fenster, Command-Freigaben, CSP-Injektion, kein Node im UI | Node im Hauptprozess, viele Fallstricke (contextIsolation, sandbox) | keine Web-Angriffsfläche, aber kein Rechte-Modell | eigenes | kein Capability-System |
| Updater mit Signatur | eingebaut (minisign-signiert, GitHub Releases) | electron-updater (gut) | selbst bauen | selbst bauen | selbst bauen |
| UI-Entwicklung | React/TS, große Bibliotheken, gut für KI-Entwickler | gleich | Dart/Widgets | QML/Slint-DSL | Web wie Tauri |
| Lizenz | MIT/Apache-2.0 | MIT | BSD-3 | Qt: LGPL/kommerziell; Slint: GPL-3 oder Royalty-free mit Bedingungen | MIT |
| Schwäche | drei verschiedene WebViews (WebView2, WKWebView, WebKitGTK) | Größe, RAM, Sicherheits-Updates von Chromium | Desktop-Ökosystem kleiner | Lizenz-Reibung mit MIT, langsamere UI-Arbeit | v3 lange in Alpha, kleiner |

Fazit: Tauri 2 ist klein, hat das beste eingebaute Sicherheits- und Update-Modell, und Rust deckt die heiklen Teile (Download, Prüfung, Entpacken, Druckdateien) mit erprobten, permissiv lizenzierten Crates ab. Die WebView-Unterschiede fangen wir ab, indem das UI nur Standard-Web-Features nutzt (Canvas 2D, CSS ohne Experimente, FontFace-API) und auf allen drei Engines getestet wird (Kap. 8).

### 0.4 Annahmen und übernommene Recherche-Ergebnisse

| ID | Annahme bzw. Festlegung | Wirkt auf | Quelle / Bestätigung |
|---|---|---|---|
| A-01 | **Übernommen aus `research/vorgaben.md` (Abschnitt 0/1.2):** Druckflächen je Produkt aus den Shirtigo-Produktdaten, z. B. T-Shirt (Organic Shirt, Creator 2.0) Front/Back 330 × 450 mm (3898 × 5315 px), sichere Fläche 280 × 360 mm, Ärmel 100 × 100 mm (nur DTF), Nacken innen 70 × 50 mm; Hoodie (Cruiser 2.0) Front 330 × 280 mm, Back 330 × 390 mm. Formate PNG/JPEG, 150–300 dpi, 1000–10 500 px je Seite nach Zuschnitt, ≤ 64 MB. Offen: Wahl der Grundprodukte durch das Kollektiv. | Druckprofile im Katalog (`printProfiles`) | vorgaben.md (bestätigt), Kollektiv |
| A-02 | **Übernommen aus vorgaben.md 5.4 (eigene Festlegung dort, [U]):** Halbtransparenz = Alpha 13–252, Anti-Aliasing-Saum (2 px) ausgenommen, Warnung ab 0,1 %, Fehler ab 1 % der sichtbaren Pixel (farbiges Textil, DTF immer Fehler, weißes Textil nur Hinweis); Geisterpixel Alpha 1–12; dpi < 300 Warnung, < 150 Fehler; Linien < 10 px Warnung. Nachjustieren nach Testdruck. | Druckprofile | Testdruck |
| A-03 | **Bestätigt durch programme.md (Stand 16.10.2026):** Blender 5.2.2 LTS zip / tar.xz / dmg (arm64; **Intel-Mac nur 4.5.14 LTS**); Krita 5.3.4.1 zip / AppImage / dmg (6.0.x nur Kanal „preview“); Inkscape 1.4.4 7z / AppImage / dmg je Arch; Kdenlive 26.08.2 Standalone-SFX / AppImage / dmg je Arch. Offen (Smoke-Test 9.4 dort): Archiv-Layout/Exe-Pfade, SFX-Typ von Kdenlive. | `ArtifactKind`, Entpacker, Katalog | programme.md |
| A-04 | **Korrigiert durch programme.md:** PGP-Signaturen nur für das **Krita-AppImage** (durchgesetzt) und das Inkscape-AppImage (DSA-1024/SHA-1, kryptografisch schwach → nur informativ). Alle anderen Artefakte: SHA-256 von der Hauptquelle. Inkscape-AppImage hat keine offizielle Prüfsumme → SHA-256 wird von der Katalog-Pflege nach Signaturprüfung festgeschrieben (`checksumOrigin: "cypherPinned"`). | `signature`, `checksumOrigin` im Katalog | – |
| A-05 | **Bestätigt:** `download.blender.org` (direkt, Spiegel nicht nutzen), `download.kde.org` (302 auf Mirrorbits-Spiegel; `.sha256`/`.sig` direkt von dort), `inkscape.org` → `media.inkscape.org`, GitHub-Hosts (Audacity, Modelle, eigene Releases), `studio.cypherxcypher.de`. Optional `download.gimp.org`. | eingebettete Hostliste (4.2) | programme.md |
| A-06 | Konfigurationsordner je Programm/OS wie in Tabelle 7.4, **weitgehend bestätigt durch programme.md** (Krita, Inkscape, Blender aus Quellcode/Doku; Inkscape-macOS-Pfad und Kdenlive-Render-Presets noch per Smoke-Test). | `setup::roots` | programme.md 9.4 |
| A-07 | Das GitHub-Repo bleibt privat, bis Rouven zustimmt (Vault-Notiz „Koordinator-Übergabe“). Darum: Katalog und Release-Dateien liegen **primär auf `studio.cypherxcypher.de`**, GitHub ist zweite Quelle, sobald das Repo öffentlich ist. Updater-Endpunkte sind konfigurierbar. | Updater, Katalog-URLs, Downloader-Seite | Entscheidung Kollektiv |
| A-08 | Keine kostenpflichtigen Code-Signing-Zertifikate (Apple Developer ID 99 $/Jahr, Windows-Zertifikat). Folge: SmartScreen- und Gatekeeper-Hinweise beim ersten Start von Cypher Studio, dokumentiert auf der Downloader-Seite. Option: SignPath Foundation (kostenlos für OSS, braucht öffentliches Repo). | Release, Site | Entscheidung Kollektiv |
| A-09 | **Festgelegt durch DESIGN.md:** Familienschriften Anybody, Atkinson Hyperlegible Next, Martian Mono (OFL-1.1, liegen bereits in `packs/fonts/` mit `SHA256SUMS`). Sie dienen der App-Oberfläche und werden von der Einrichtung an Krita, Inkscape, Kdenlive weitergegeben. Weitere Motiv-Schriften (z. B. Pixel-Schrift für PS2-Optik) nur OFL, Wahl beim Kollektiv. | Paket `fonts`, UI | – |
| A-10 | Zusatzprogramme laut programme.md 9.2: **GIMP 3.2** (Foto-Retusche; Windows nur als Inno-Installer, Benutzermodus `/CURRENTUSER` prüfen) und **Audacity** (Ton für Reels, Ersatz für das unsichere Scribus). Upscayl wird nicht aufgenommen. Affinity nur als Link. | Katalog (Phase 4) | – |
| A-11 | **Übernommen aus vorgaben.md 2:** Post 1080 × 1350 (4:5) und 1080 × 1440 (3:4), Story/Reel 1080 × 1920; Hilfslinien konservativ oben 270, unten 672, seitlich 120 px (Instagram + TikTok), Reel-Cover-Rasterbox y 240–1680, 4:5-Post im Raster x 34–1046. Sicherheitszonen sind Meta-Anzeigenwerte ([U] für organisch). | `SOCIAL_GUIDES`, Social-Vorlagen | – |
| A-12 | Das Repository ist `github.com/rouvenwieland/cypher-studio` (Festlegung Hauptchat 17.10.2026, eine Konstante in `crates/cypher-core/src/sites.rs`); App-Seiten `studio.cypherxcypher.de/anleitung` und `/releases`. | URLs | Kollektiv |
| A-13 | Werkzeuge (Versionen aus plattform.md 1, Stand 16.10.2026): Rust 1.99.1 (MSRV der Tauri-Crates 1.90), Tauri 2.12.x (nicht Tauri 3 alpha), tauri-plugin-updater 2.14, React 19.3, Vite 8.3, TypeScript 7.0 strict, Vitest 5.0, Playwright 1.64, Node 24 LTS, npm-Workspaces (wie im Cypher-Shop). | Root-Konfiguration | – |
| A-14 | **Bestätigt:** Kdenlive-Daten (Titel, Profile) unter `%APPDATA%\kdenlive\`; Render-Presets laut Quellcode unter `%LOCALAPPDATA%\kdenlive\export\` (Doku widerspricht → Smoke-Test, bis dahin keine Render-Presets im Paket). | `setup::roots` | programme.md 5.5 |
| A-15 | **Export-Farbprofil Adobe RGB (1998)** für Shirtigo (dort ausdrücklich empfohlen, sRGB akzeptiert), umgerechnet und eingebettet mit `moxcms`; bis zum Testdruck mit Farbkarte als Profilvorgabe, umschaltbar. „Adobe RGB“ ist hier nur der Fachbegriff des Farbraums, keine Adobe-Marke in der App-Gestaltung. | printcheck-Export | Testdruck |
| A-16 | Zuordnung Kollektionsfarbe → Shirtigo-Textilfarbe (für Mockups): Schwarz → Black `#201e1f`, Weiß → White `#ffffff`, Grau meliert → Mid Heather Grey `#818381`, Navy → French Navy `#2f354a`, Sand → Desert Dust `#d5c9bc`, Creme → Natural Raw `#fcf0dc` (Vorschlag vorgaben.md 1.10). Nur Weiß hat keine weiße Unterlage. | `brand.json` | Kollektiv |
| A-17 | **macOS-Builds arm64 und x64 getrennt, kein Universal-Binary** (plattform.md: halbe Downloadgröße, macOS 27 nur noch Apple Silicon). Abweichung von CONCEPT.md 9 (Universal): Die Downloader-Seite zeigt zwei Knöpfe („Apple Silicon (M1 und neuer)“ zuerst, „Intel“ darunter) mit einem Satz zur Prüfung (Apfelmenü → Über diesen Mac). | Release, Site | Kollektiv kann auf Universal umstellen (eine Zeile in release.yml) |
| A-18 | **Projekte liegen im gemeinsamen Ordner** unter `Projekte/` (CONCEPT.md 4), ohne Bibliothek unter `<Dokumente>/Cypher Studio/Projekte`. | `projects` | – |

### 0.5 Begriffe

- **Programm**: externes Open-Source-Programm aus dem Katalog (Krita, Inkscape, Blender, Kdenlive, optional GIMP/Audacity).
- **Installation**: eine konkrete, startbare Kopie eines Programms (von Cypher verwaltet, System, Flatpak, Snap, Store, Steam, manuell).
- **Artefakt**: eine herunterladbare Datei für ein OS/Arch-Paar mit Prüfsumme.
- **Einrichtungspaket (Pack)**: mitgelieferte Dateien und Aktionen, die ein Programm „cypher-fertig“ machen.
- **Geltungsbereich (Scope)**: der Konfigurationsort, auf den eine Einrichtung wirkt (Benutzerprofil, portabler Programmordner, Flatpak-Profil, Benutzerschriften).
- **Plan**: vorab berechnete, 10 Minuten gültige Beschreibung einer Installation oder Einrichtung, die der Nutzer bestätigt.
- **Handle**: undurchsichtige ID, hinter der Rust einen echten Pfad verwaltet.
- **Zone**: Dateibereich eines Bauteams.

---

## 1. Repo-Layout und Dateibereiche

### 1.1 Baum

```
cypher-studio/
├─ Cargo.toml                    # [I] Rust-Workspace: crates/*, apps/desktop/src-tauri
├─ Cargo.lock                    # [A]
├─ rust-toolchain.toml           # [I] stable, gepinnt
├─ deny.toml                     # [I] cargo-deny: Lizenzen, Advisories, Quellen
├─ package.json                  # [I] npm-Workspaces: apps/desktop, site, packs/tools
├─ package-lock.json             # [I] (wird von B/C/D über npm install mitgeändert → Konflikt-Regel 1.3)
├─ zones.json                    # [I] Zonen-Zuordnung für den CI-Check
├─ LICENSE                       # [I] MIT
├─ THIRD_PARTY.md                # [I] aus Kap. 10, von CI gegen cargo-deny/npm-Lizenzen geprüft
├─ README.md                     # [I]
├─ .editorconfig  .gitattributes  .gitignore   # [I] (gitattributes: *.blend, *.kra, *.png binary; LFS nicht nötig)
│
├─ crates/
│  ├─ cypher-core/               # [A] Bibliothek, KEINE Tauri-Abhängigkeit
│  │  ├─ Cargo.toml
│  │  ├─ src/{lib.rs, api/ (DTOs + AppError, ts-rs), error.rs, progress.rs, jobs.rs, platform/, catalog/, verify/, download/,
│  │  │       install/, detect/, launch/, setup/, projects/, library/, printcheck/, brand/,
│  │  │       templates/, settings/, state/, bgremove/}
│  │  └─ tests/                  # Integrationstests + fixtures/
│  └─ cypher-cli/                # [A] Kommandozeile für CI, Linux-Probe, Katalogpflege
│     └─ src/main.rs             #     cypher catalog build|check|verify, cypher install <id>, cypher printcheck <datei>, cypher setup apply|undo <pack>
│
├─ apps/desktop/
│  ├─ package.json               # [B] Frontend-Abhängigkeiten, Skripte (dev, build, test, e2e, tauri); Lockfile wandert in Phase 0 an die Wurzel
│  ├─ index.html  vite.config.ts  tsconfig.json  tsconfig.node.json  eslint.config.js  # [B]
│  ├─ src/                       # [B] React-Frontend
│  │  ├─ main.tsx  app/          # Shell, Router (Hash-Router), Fehlergrenze, Layout
│  │  ├─ ipc/                    # commands.ts (typisierte Wrapper), events.ts, channel.ts,
│  │  │                          # generated/ ([A] erzeugt, eingecheckt), contract-check.ts, mock/ (Fixture-Handler)
│  │  ├─ features/               # home, programs, install, setup, printcheck, mockup, social, library, projects, settings, updates
│  │  │  ├─ mockup/engine/       # reines TS + Worker (OffscreenCanvas), keine React-Abhängigkeit
│  │  │  └─ social/engine/       # reines TS (Layout, Textanpassung, Zeichnen)
│  │  ├─ ui/                     # Design-System-Komponenten (Button, Dialog, Progress, Toast, …)
│  │  ├─ styles/                 # base.css; tokens.css kommt per Alias @tokens aus docs/ (kanonisch)
│  │  └─ i18n/de.ts              # ALLE UI-Texte, inkl. errorText(AppError) und findingText(Finding)
│  ├─ e2e/                       # [B] Playwright-Tests gegen Vite mit gemocktem IPC
│  └─ src-tauri/                 # [A] Tauri-Schicht
│     ├─ Cargo.toml  build.rs  tauri.conf.json  tauri.linux.conf.json  tauri.macos.conf.json  tauri.windows.conf.json
│     ├─ capabilities/main.json  # minimale Rechte (6.1)
│     ├─ permissions/            # App-Command-Freigaben (autogeneriert aus build.rs AppManifest)
│     ├─ icons/
│     └─ src/{main.rs, lib.rs, ctx.rs, events.rs, sink.rs, handles.rs, protocols.rs,
│             dragdrop.rs, updater.rs, close_guard.rs, commands/*.rs}
│
├─ packs/                        # [C] Einrichtungspakete und Inhalte (Daten + Blender-Python)
│  ├─ schema/{pack.schema.json, template.schema.json, mockup.schema.json, social.schema.json}
│  ├─ shared/brand/
│  │  ├─ brand.json              # Kollektionen, Textilfarben, Paletten (17 Farben, CONCEPT.md 6.3), Schriftzuordnung, Logos
│  │  └─ LICENSE-BRAND.md        # Logos/Marke: NICHT MIT, alle Rechte vorbehalten
│  ├─ fonts/                     # VORHANDEN: anybody/, atkinson-hyperlegible-next/, martian-mono/ (je OFL.txt), SHA256SUMS
│  │  └─ pack.json               # Paket "fonts" (Benutzerschriften des OS, für Programme ohne eigenen Schriftordner)
│  ├─ samples/probe-motiv.png    # Probe-Motiv für den Erststart (absichtlich mit Halbtransparenz, CONCEPT.md 6.10)
│  ├─ krita/{pack.json, palettes/, templates/, workspaces/}
│  ├─ inkscape/{pack.json, palettes/, templates/}
│  ├─ blender/
│  │  ├─ pack.json
│  │  ├─ app_template/cypher_ps2/{__init__.py, build_startup.py}   # erzeugt startup.blend reproduzierbar
│  │  ├─ cypher_export/          # Blender-Extension "Cypher Export" (GPL-3.0-or-later, eigene LICENSE)
│  │  │  └─ {blender_manifest.toml, __init__.py, operators.py, checks.py, panel.py, budgets.json, LICENSE}
│  │  └─ tests/                  # laufen in Blender: blender -b --python-exit-code 1 -P tests/run.py
│  ├─ kdenlive/{pack.json, titles/*.kdenlivetitle, profiles/}
│  ├─ projects/<vorlage>/{template.json, preview.png, files/…}   # Vorlagen der Formatleiste (4.5)
│  ├─ mockups/<vorlage>/{template.json, mask.png, shade.png, light.png, displace.png, heather.png}
│  ├─ social/<vorlage>/{template.json, preview.png}
│  ├─ tools/                     # Node-Skripte ohne Laufzeitabhängigkeiten: validate.mjs, build.mjs, gen-palettes.mjs
│  └─ dist/                      # (gitignored) Ergebnis von build.mjs → Tauri-Ressourcen
│
├─ catalog/                      # [A] Programm-Katalog
│  ├─ sources.json               # Rezept (URL-Vorlagen, Versionsermittlung) aus research/catalog-draft.json – nur CLI/CI
│  ├─ catalog.json               # aufgelöste Daten für die App (von `cypher catalog build` erzeugt, von Menschen geprüft)
│  ├─ catalog.json.minisig       # Signatur (lokal vom Katalog-Verantwortlichen erzeugt, nie in CI)
│  ├─ schema/catalog.schema.json # JSON Schema 2020-12 (4.1)
│  ├─ keys/catalog-*.pub         # öffentliche Schlüssel (aktuell + Reserve), werden eingebettet
│  └─ README.md                  # Pflegeablauf (5.8)
│
├─ site/                         # [D] Downloader-Seite studio.cypherxcypher.de
│  ├─ wrangler.toml              # Workers Static Assets, ohne Worker-Skript
│  ├─ public/{index.html, styles.css, detect.js, release.json, _headers, robots.txt, favicon.svg, fonts/}
│  │  └─ catalog/v1/             # Kopie von catalog/catalog.json(+.minisig), beim Deploy hineinkopiert
│  ├─ scripts/gen-release-json.mjs
│  └─ tests/                     # Playwright: OS-Erkennung je User-Agent, noindex, CSP
│
├─ scripts/                      # [I] wsl-build.sh (VORHANDEN), probe-linux.sh (WSL), zone-check.mjs, license-check.mjs
├─ dist-builds/                  # lokal, gitignored: Ergebnisse von wsl-build.sh
├─ docs/                         # [I] ARCHITEKTUR.md, ipc-contract.ts, CONCEPT.md, DESIGN.md, tokens.css (kanonisch), research/, adr/, contract-fixtures/
└─ .github/workflows/            # [I] ci.yml, release.yml, catalog.yml, site.yml, packs-blender.yml
```

### 1.2 Zonen

| Zone | Team | Schreibt | Liefert an andere | Liest von anderen |
|---|---|---|---|---|
| **A – Rust-Kern** | A | `crates/**`, `apps/desktop/src-tauri/**`, `catalog/**`, `apps/desktop/src/ipc/generated/**` (nur per Generator), `Cargo.lock` | Commands nach Vertrag, generierte TS-Typen, Fixture-JSONs in `docs/contract-fixtures/` (per Vertrags-PR) | `docs/ipc-contract.ts`, `packs/schema/*`, `packs/dist/*` (Ressourcen) |
| **B – Frontend** | B | `apps/desktop/src/**` (ohne `ipc/generated`), `apps/desktop/e2e/**`, `apps/desktop/*.{json,ts,js,html}` außer `src-tauri` | UI | `docs/ipc-contract.ts` (Alias `@contract`), `docs/tokens.css` (Alias `@tokens`, Stylelint-Quelle), `docs/CONCEPT.md`, `docs/DESIGN.md`, `docs/contract-fixtures/`, `packs/fonts/` (UI-Schriften per Vite-Import) |
| **C – Pakete/Blender** | C | `packs/**` | `packs/dist/` (Build), Schemas, Vorlagen, Mockup-/Social-Inhalte | `docs/ipc-contract.ts` (Typen Mockup/Social/Template), Kap. 4.4–4.8 |
| **D – Downloader-Seite** | D | `site/**` | statische Seite | `catalog/catalog.json` (Kopie beim Deploy), Release-Metadaten, `docs/tokens.css`, `docs/CONCEPT.md` 9, `packs/fonts/` |
| **I – Integration** | Architekt/Hauptchat | Root-Dateien, `docs/**`, `.github/**`, `scripts/**`, `zones.json`, `THIRD_PARTY.md` | Vertrag, CI, Releases | alles |

### 1.3 Regeln für paralleles Arbeiten

1. **Ein PR berührt genau eine Zone.** `scripts/zone-check.mjs` vergleicht die geänderten Pfade mit `zones.json` und dem Branch-Präfix (`a/…`, `b/…`, `c/…`, `d/…`, `i/…`). Ausnahme: `package-lock.json` darf von B, C, D mitgeändert werden; bei Konflikt gewinnt `main`, danach `npm install` neu.
2. **Vertragsänderungen** (`docs/ipc-contract.ts`, `docs/contract-fixtures/**`, `packs/schema/**`) nur als eigener PR `i/vertrag-…`, mit Review von A und B (bzw. A und C bei Schemas). Version in `IPC_CONTRACT_VERSION` hochzählen (minor = additiv, major = brechend).
3. **Lesen über Zonengrenzen ist erlaubt, Schreiben nicht.** Wer etwas in einer fremden Zone braucht, legt ein Issue mit Label `zone:x` an.
4. **Neue Abhängigkeit = Eintrag in THIRD_PARTY.md** im selben PR (über Zone I nachgezogen, wenn nötig); `cargo deny` und der npm-Lizenzcheck müssen grün sein.
5. **Bezeichner Englisch, UI-Texte und Kommentare Deutsch.** UI-Texte nur in `src/i18n/de.ts`.
6. **Kein `unwrap()`/`expect()` außerhalb von Tests** (Clippy-Lint `unwrap_used`, `expect_used` = deny in `cypher-core`), kein `any` und kein `as`-Cast ohne Kommentar in TS, `switch` über getaggte Unions immer erschöpfend (`assertNever`).
7. **Jeder PR**: Tests für neues Verhalten, alle Qualitätstore aus 8.7 grün, Screenshot bei UI-Änderungen.

### 1.4 Wichtige Konfigurationswerte

| Datei | Schlüssel | Wert |
|---|---|---|
| `tauri.conf.json` | `identifier` | `de.cypherxcypher.studio` (im Gerüst bereits gesetzt) |
| | `productName` | `Cypher Studio` (Gerüst: noch `desktop`) |
| | `mainBinaryName` | `cypher-studio` (keine Leerzeichen in Release-Dateinamen) |
| | `app.security.csp` / `devCsp` | siehe 6.2 |
| | `app.security.freezePrototype` | `true` |
| | `app.security.assetProtocol.enable` | `false` (eigene, eng begrenzte Protokolle statt Asset-Protokoll) |
| | `app.windows[0]` | `label: "main"`, `dragDropEnabled: true`, Größe 1280 × 800, Minimum 1024 × 680 (DESIGN.md) |
| | `bundle.resources` | `{"../../../packs/dist/": "packs/"}` |
| | `bundle.createUpdaterArtifacts` | `true` |
| | `bundle.windows.nsis.installMode` | `"currentUser"` |
| | `bundle.windows.webviewInstallMode` | `{"type": "downloadBootstrapper", "silent": true}`; `minimumWebview2Version: "110.0.1531.0"` (eigene URI-Schemata) |
| | `bundle.macOS.signingIdentity` | `"-"` (ad-hoc, in `tauri.macos.conf.json`, bis A-08 entschieden) |
| | `bundle.linux.appimage.bundleMediaFramework` | `false` |
| | `plugins.updater.endpoints` | `["https://studio.cypherxcypher.de/releases/latest.json", "https://github.com/<org>/cypher-studio/releases/latest/download/latest.json"]` |
| | `plugins.updater.pubkey` | Updater-Schlüssel (öffentlich), **getrennt** vom Katalogschlüssel |
| | `plugins.updater.windows.installMode` | `"passive"` (keine UAC-Abfrage bei currentUser) |
| | `plugins.updater.requireSignedVersion` | `true` laut plattform.md (Anti-Downgrade; Schlüssel gegen das Schema prüfen) |
| `crates/cypher-core` | `platform::APP_DIR_NAME` | `"de.cypherxcypher.studio"` → `directories::ProjectDirs::from_path(APP_DIR_NAME.into())`, damit unsere Ordner unter derselben Wurzel liegen wie die WebView-Daten von Tauri (sauberes Deinstallieren, 7.1) |

---

## 2. Rust-Kern: Module und öffentliche API

### 2.1 Crates und Schichten

```
                       ┌────────────────────────────── apps/desktop/src-tauri (Bin "cypher-studio") ─┐
                       │ commands/*  protocols  handles  dragdrop  updater  close_guard  events  sink │
                       └───────────────┬──────────────────────────────────────────────────────────────┘
                                       │ ruft nur öffentliche API von cypher-core
 crates/cypher-cli ────────────────────┤
                                       ▼
 cypher-core:  ┌────────────── Anwendungsebene ──────────────┐
               │ install  setup  projects  library  bgremove │
               ├──────────── Fachebene ──────────────────────┤
               │ catalog  detect  launch  printcheck  brand   │
               │ templates                                    │
               ├──────────── Infrastruktur ──────────────────┤
               │ download  verify  platform  settings  state  │
               │ jobs  progress  error                        │
               └──────────────────────────────────────────────┘
 Regel: Abhängigkeiten nur nach unten oder seitlich innerhalb einer Ebene ohne Zyklen.
        printcheck hängt von nichts außer error/progress ab (reine Bildlogik).
```

**Async-Modell:** `tokio` (Multi-Thread, von Tauri bereitgestellt). Blockierende Arbeit (Hashen, Entpacken, Bild-Dekodierung, Prozessstarts mit Wartezeit) läuft in `tokio::task::spawn_blocking`. Abbruch über `tokio_util::sync::CancellationToken`, das blockierende Code in Schleifen prüft (mindestens alle 1 MiB bzw. je Archiveintrag).

**Fortschritt ohne Tauri:** `cypher-core` definiert

```rust
// crates/cypher-core/src/progress.rs
pub trait ProgressSink<E>: Send + Sync {
    fn emit(&self, event: E);
}
impl<E, F: Fn(E) + Send + Sync> ProgressSink<E> for F { fn emit(&self, e: E) { self(e) } }
pub struct NoProgress;           // für CLI/Tests
pub struct Throttled<S> { … }    // höchstens 10 Ereignisse/s für *Progress-Varianten, Start/Ende immer
```

`src-tauri/src/sink.rs` adaptiert `tauri::ipc::Channel<E>` auf `ProgressSink<E>` (Fehler beim Senden werden geloggt, nicht weitergereicht; ein geschlossenes Fenster bricht den Job **nicht** ab).

### 2.2 Querschnitt: Fehler, Jobs, Pläne

```rust
// crates/cypher-core/src/error.rs – ein Fehler-Enum je Modul (thiserror), alle konvertierbar nach CoreError
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error(transparent)] Catalog(#[from] CatalogError),
    #[error(transparent)] Download(#[from] DownloadError),
    #[error(transparent)] Verify(#[from] VerifyError),
    #[error(transparent)] Install(#[from] InstallError),
    #[error(transparent)] Archive(#[from] ArchiveError),
    #[error(transparent)] Detect(#[from] DetectError),
    #[error(transparent)] Launch(#[from] LaunchError),
    #[error(transparent)] Setup(#[from] SetupError),
    #[error(transparent)] Library(#[from] LibraryError),
    #[error(transparent)] Print(#[from] PrintError),
    #[error(transparent)] Project(#[from] ProjectError),
    #[error(transparent)] Io(#[from] IoError),          // IoError { op: IoOp, path: Option<PathBuf>, source: std::io::Error }
    #[error("abgebrochen")] Cancelled,
    #[error("beschäftigt: {0:?}")] Busy(BusyInfo),
}
```

- `cypher-core/src/api/error.rs` definiert `AppError` exakt wie in `ipc-contract.ts` (ts-rs-Export) und `impl From<CoreError> for AppError`; `src-tauri` reicht ihn nur durch. Pfade werden dabei zu `DisplayPath` (String, `~` für Home abgekürzt). Unbekannte Fehler → `internal { message, correlationId }`, die Korrelations-ID steht auch im Log.
- `jobs.rs`:

```rust
pub struct JobRegistry { /* Mutex<HashMap<JobId, JobEntry>> */ }
pub struct JobGuard { pub id: JobId, pub token: CancellationToken /* Drop: austragen + on_change */ }
impl JobRegistry {
    pub fn new(on_change: impl Fn(Vec<JobInfo>) + Send + Sync + 'static) -> Self;
    /// Fehler Busy, wenn ein Job mit gleichem Konfliktschlüssel läuft
    /// (install:<programId>, setup:<packId>:<scopeId>, library:*, appUpdate).
    pub fn start(&self, kind: JobKind, subject: &str, conflict_key: &str, cancellable: bool) -> Result<JobGuard, CoreError>;
    pub fn cancel(&self, id: &JobId) -> bool;
    pub fn active(&self) -> Vec<JobInfo>;
    pub fn recent(&self) -> Vec<JobRecord>;            // letzte 24 h, max. 200, persistiert in <data>/jobs-history.json
}
impl JobGuard {
    pub fn progress(&self, fraction: Option<f32>, phase: &'static str);   // speist jobs:changed (gedrosselt ≤ 2/s) für das Popover „Aufträge“
    pub fn needs_attention(&self, yes: bool);
    pub fn finish(self, outcome: JobOutcome);                             // schreibt JobRecord, Event jobs:changed { finished }
}
```

- `PlanStore<T>` (in `install` und `setup` verwendet): `insert(plan) -> PlanId`, `take(id) -> Result<T, PlanExpired>` (einmalig verwendbar), TTL 10 min, höchstens 20 Pläne.

### 2.3 `platform` – OS, Architektur, Pfade, sichere Dateioperationen

Verantwortung: einzige Stelle für OS-Unterschiede bei Pfaden und Dateisystem. Nutzt `directories` (`ProjectDirs::from_path("de.cypherxcypher.studio")`, `BaseDirs`, `UserDirs`). Die konkreten Pfade je OS stehen in 7.1–7.3 und werden per Snapshot-Test festgeschrieben.

```rust
pub enum Os { Windows, Macos, Linux }
pub enum Arch { X86_64, Aarch64 }
pub struct PlatformInfo { pub os: Os, pub arch: Arch, pub os_version: String, pub rosetta: bool }
pub fn current() -> PlatformInfo;            // macOS: sysctl hw.optional.arm64 → echte Hardware

pub struct AppDirs {
    pub data: PathBuf,        // ProjectDirs::data_local_dir()  Win: %LOCALAPPDATA%\de.cypherxcypher.studio\data
    pub config: PathBuf,      // ProjectDirs::config_dir()      settings.json; Win: %APPDATA%\de.cypherxcypher.studio\config
    pub cache: PathBuf,       // ProjectDirs::cache_dir()       Vorschaubilder, Download-Cache
    pub logs: PathBuf,        // <data>/logs
    pub documents: PathBuf,   // UserDirs::document_dir() oder Home
    pub home: PathBuf,
    pub resources: PathBuf,   // von src-tauri gesetzt (app.path().resource_dir()), CLI: --resources
}
impl AppDirs {
    pub fn discover(resources: PathBuf) -> Result<Self, IoError>;
    pub fn for_test(root: &Path) -> Self;                    // alles unter einem Temp-Ordner
    pub fn programs_default(&self) -> PathBuf;               // <data>/programs
    pub fn downloads(&self) -> PathBuf;                      // <cache>/downloads
    pub fn staging(&self) -> PathBuf;                        // <data>/staging   (gleiches Volume wie programs!)
    pub fn state_file(&self) -> PathBuf;                     // <data>/state.json
    pub fn setup_dir(&self) -> PathBuf;                      // <data>/setup (manifests/, backups/, journal/)
    pub fn catalog_cache(&self) -> PathBuf;                  // <data>/catalog
}

pub struct KnownDirs { /* aus BaseDirs + Umgebungsvariablen */ }
impl KnownDirs {
    pub fn roaming_appdata(&self) -> Option<PathBuf>;   // %APPDATA%
    pub fn local_appdata(&self) -> Option<PathBuf>;     // %LOCALAPPDATA%
    pub fn program_files(&self) -> Vec<PathBuf>;        // %ProgramFiles%, %ProgramFiles(x86)%
    pub fn mac_app_support(&self) -> Option<PathBuf>;   // ~/Library/Application Support
    pub fn mac_applications(&self) -> Vec<PathBuf>;     // /Applications, ~/Applications
    pub fn xdg_config(&self) -> Option<PathBuf>;        // $XDG_CONFIG_HOME oder ~/.config
    pub fn xdg_data(&self) -> Option<PathBuf>;          // $XDG_DATA_HOME oder ~/.local/share
    pub fn flatpak_app_dir(&self, app_id: &str) -> Option<PathBuf>; // ~/.var/app/<id>
    pub fn snap_user_dir(&self, name: &str) -> Option<PathBuf>;      // ~/snap/<name>/current
}

pub mod fsx {
    pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), IoError>;           // tempfile im Zielordner + fsync + persist (rename)
    pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), IoError>;
    pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, IoError>;  // None wenn fehlt
    pub fn quarantine_corrupt(path: &Path) -> Result<PathBuf, IoError>;               // <datei>.corrupt-<ts>
    pub fn safe_join(base: &Path, rel: &str) -> Result<PathBuf, PathError>;           // siehe 6.6
    pub fn ensure_within(base: &Path, candidate: &Path) -> Result<PathBuf, PathError>; // kanonisiert, Symlinks aufgelöst
    pub fn sanitize_file_name(name: &str) -> String;                                  // Ordner-/Dateinamen aus Nutzereingaben
    pub fn free_space(path: &Path) -> Result<u64, IoError>;                           // fs4::available_space
    pub fn rename_dir_atomic(from: &Path, to: &Path) -> Result<(), IoError>;         // gleiches Volume erzwungen, sonst Fehler
    pub fn remove_dir_managed(dir: &Path, managed_root: &Path) -> Result<(), IoError>; // löscht nur innerhalb managed_root
}
```

Tests: Pfad-Suffixe je OS (Snapshot), `safe_join`/`ensure_within` mit proptest (zufällige `..`, `\`, `:`, NUL, UNC, Laufwerksbuchstaben, reservierte Namen), `write_atomic` unter simuliertem Absturz (Temp-Datei bleibt, Ziel unverändert).

### 2.4 `catalog` – Laden, Signaturprüfung, Schema, Auswahl

Verantwortung: liefert den gültigen Katalog. Alle Quellen sind gleich vertrauenswürdig (alle signiert), gewählt wird die höchste `sequence`.

```rust
pub struct Catalog { pub schema_version: u32, pub sequence: u64, pub generated_at: OffsetDateTime,
                     pub expires_at: OffsetDateTime, pub min_app_version: Version,
                     pub programs: Vec<ProgramSpec>, pub links: Vec<LinkSpec>,
                     pub print_profiles: Vec<PrintProfileSpec>, pub models: Vec<ModelSpec> }   // Felder wie 4.1
pub enum CatalogSource { Remote, Cache, Embedded }
pub struct LoadedCatalog { pub catalog: Arc<Catalog>, pub source: CatalogSource, pub sha256: [u8; 32] }

pub struct TrustedKeys { keys: Vec<minisign_verify::PublicKey> }   // eingebettet: include_str!("../../../catalog/keys/catalog-*.pub")
impl TrustedKeys { pub fn embedded() -> Self; pub fn from_strs(keys: &[&str]) -> Result<Self, CatalogError>; }

pub const CATALOG_URLS: &[&str] = &[
    "https://studio.cypherxcypher.de/catalog/v1/catalog.json",
    "https://raw.githubusercontent.com/<org>/cypher-studio/main/catalog/catalog.json", // aktiv erst bei öffentlichem Repo (A-07)
];
pub const MAX_CATALOG_BYTES: u64 = 2 * 1024 * 1024;

pub fn parse_and_verify(json: &[u8], minisig: &str, keys: &TrustedKeys) -> Result<Catalog, CatalogError>;
pub fn validate(c: &Catalog, hosts: &HostPolicy, app_version: &Version) -> Result<Vec<CatalogWarning>, CatalogError>;
pub fn embedded(keys: &TrustedKeys) -> Result<LoadedCatalog, CatalogError>;   // include_bytes! Katalog + Signatur, gleiche Prüfung

pub struct CatalogStore { /* ArcSwap<LoadedCatalog>, cache_dir, highest_seen (aus state) */ }
impl CatalogStore {
    pub fn load_startup(dirs: &AppDirs, keys: TrustedKeys, highest_seen: u64) -> Result<Self, CatalogError>; // max(embedded, cache)
    pub async fn refresh(&self, http: &HttpClient, hosts: &HostPolicy, cancel: CancellationToken) -> Result<RefreshOutcome, CatalogError>;
    pub fn current(&self) -> Arc<LoadedCatalog>;
    pub fn status(&self) -> CatalogStatus;
}
impl Catalog {
    pub fn program(&self, id: &str) -> Option<&ProgramSpec>;
    pub fn release_for(&self, id: &str, version: Option<&ProgramVersion>, channel: ReleaseChannel, p: &PlatformInfo) -> Result<(&ReleaseSpec, &ArtifactSpec), CatalogError>;
    // ProgramVersion: punktnumerisch (5.3.4.1, 26.08.2), eigener Typ mit Ord; Bereiche wie ">=4.2, <6" über eigenen kleinen Parser
    pub fn print_profile(&self, id: &str) -> Option<&PrintProfileSpec>;
}

#[derive(thiserror::Error, Debug)]
pub enum CatalogError { Parse(String), Schema { path: String, reason: String }, Signature(String), UnknownKey(String),
                        Rollback { current: u64, offered: u64 }, Incompatible { schema: u32, min_app: Version },
                        HostNotAllowed(String), NoArtifact { program: String, os: Os, arch: Arch }, Io(IoError), Download(DownloadError) }
```

Semantische Prüfungen in `validate` (zusätzlich zum JSON-Schema in CI): IDs eindeutig und kebab-case; jede `url` ist `https`; Host ∈ eingebettete Hostliste (`HostPolicy::embedded()`); `sha256` 64 Hex; `size > 0`; `unpackedSizeMax ≥ size`; `launch.exe` ist relativer Pfad ohne `..`; je (Programm, Version) höchstens ein Artefakt pro OS/Arch; `expiresAt > generatedAt`; `schemaVersion` ≤ unterstützte Version, sonst `Incompatible`.

Auswahlregel: Kandidaten = {eingebettet, Cache, Remote}; nur gültig signierte, schema-kompatible; davon höchste `sequence`; `sequence < highest_seen` → `Rollback` (Remote abgelehnt, Cache/Embedded bleiben). `highest_seen` wird in `state.json` persistiert. Abgelaufene Kataloge (`expiresAt` vorbei) bleiben nutzbar, UI zeigt einen Hinweis (A: bewusst weich, weil ein kleines Kollektiv nicht jede Woche signiert).

### 2.5 `verify` – Prüfsummen und Signaturen

```rust
pub struct Sha256Stream(sha2::Sha256);
impl Sha256Stream { pub fn new() -> Self; pub fn update(&mut self, b: &[u8]); pub fn finalize(self) -> [u8; 32]; }
pub fn sha256_file(path: &Path, cancel: &CancellationToken) -> Result<[u8; 32], VerifyError>;   // 1 MiB-Puffer
pub fn expect_sha256(actual: &[u8; 32], expected_hex: &str, file: &str) -> Result<(), VerifyError>;

/// minisign (prehashed "ED" und legacy "Ed"), Katalog und Modelle
pub fn verify_minisign(data: &[u8], minisig: &str, keys: &TrustedKeys) -> Result<KeyId, VerifyError>;

/// OpenPGP-Detached-Signatur mit rPGP (`pgp`-Crate, MIT/Apache). Sequoia NICHT verwenden (LGPL).
/// Datei per memmap2 eingeblendet (kein Komplett-Laden großer Archive).
pub fn verify_pgp_detached(file: &Path, sig_armored_or_binary: &[u8], public_keys_armored: &[String],
                           allowed_fingerprints: &[String]) -> Result<String /* Fingerprint */, VerifyError>;

pub enum VerifyError { ChecksumMismatch { file: String, expected: String, actual: String },
                       Signature(String), KeyNotAllowed(String), KeyExpired(String), Io(IoError), Cancelled }
```

Regeln: **SHA-256 ist Pflicht** und stammt aus dem signierten Katalog, der sie von der offiziellen Hauptquelle übernommen hat (`checksumSource`; Sonderfall Inkscape-AppImage ohne offizielle Summe: `checksumOrigin: "cypherPinned"`, von der Katalog-Pflege nach Signaturprüfung festgeschrieben). Die Upstream-Signatur ist **zusätzlich**, wenn vorhanden (heute nur Krita-AppImage durchgesetzt; Inkscape-AppImage DSA-1024/SHA-1 wird mit `enforce: false` nur protokolliert, weil SHA-1 keine Sicherheit mehr bietet): Schlüssel (armored) und erlaubte Fingerprints stehen im signierten Katalog; Signaturdatei wird vom selben Host wie das Artefakt geladen. Ist eine Signatur im Katalog angegeben, ist ihr Fehlschlag ein harter Fehler. Signaturzeit muss vor `now + 1 Tag` liegen, Schlüssel nicht widerrufen/abgelaufen zum Signaturzeitpunkt.

### 2.6 `download` – HTTP mit Fortschritt, Fortsetzen, Abbruch, Hostliste

```rust
pub enum RedirectPolicy { WithinAllowlist, AnyHttpsPinned }  // AnyHttpsPinned nur für Spiegel-Verteiler (download.kde.org), Inhalt per sha256 festgenagelt
pub struct HostRule { pub host: &'static str, pub redirects: RedirectPolicy }
pub struct HostPolicy { rules: Vec<HostRule> }
impl HostPolicy {
    pub fn embedded() -> Self;                                    // Liste A-05, im Binary; Katalog kann sie NICHT erweitern
    pub fn check(&self, url: &Url) -> Result<&HostRule, DownloadError>;   // https, Port 443, kein Userinfo, Host exakt (keine Wildcards)
    pub fn check_redirect(&self, origin: &HostRule, next: &Url) -> Result<(), DownloadError>;
}

pub struct HttpClient { inner: reqwest::Client }
impl HttpClient {
    /// reqwest 0.13 mit default-features = false, ["rustls-no-provider", "stream", "http2", "system-proxy"] + rustls/ring
    /// (gleicher Krypto-Provider wie tauri-plugin-updater), Systemzertifikate, UA "CypherStudio/<version>", keine Cookies, gzip aus,
    /// connect 15 s, read-idle 60 s, max. 10 Weiterleitungen über eigene redirect::Policy (HostPolicy).
    pub fn new(app_version: &str, hosts: Arc<HostPolicy>) -> Result<Self, DownloadError>;
}

pub struct DownloadRequest { pub url: Url, pub part_path: PathBuf, pub expected_size: u64,
                             pub expected_sha256: [u8; 32], pub max_attempts: u32 /* 4 */ }
pub enum DownloadProgress { Started { total: u64 }, Progress { done: u64, total: u64, bytes_per_second: u64 },
                            Resumed { from: u64 }, Retrying { attempt: u32, max: u32, delay_ms: u64, reason: String } }
pub struct DownloadedFile { pub path: PathBuf, pub size: u64, pub sha256: [u8; 32] }

pub async fn fetch_to_file(http: &HttpClient, req: DownloadRequest, sink: &dyn ProgressSink<DownloadProgress>,
                           cancel: CancellationToken) -> Result<DownloadedFile, DownloadError>;
pub async fn fetch_small(http: &HttpClient, url: &Url, max_bytes: u64, cancel: CancellationToken) -> Result<Vec<u8>, DownloadError>;

pub enum DownloadError { HostNotAllowed(String), InsecureUrl(String), Http { host: String, status: u16 },
                         Network { host: String, message: String, retryable: bool }, SizeMismatch { expected: u64, actual: u64 },
                         TooLarge { limit: u64 }, Checksum(VerifyError), Io(IoError), Cancelled }
```

Ablauf `fetch_to_file`:
1. `part_path` = `<cache>/downloads/<sha256>.part`, daneben `<sha256>.part.json` `{url, etag, lastModified, expectedSize}`.
2. Existiert `.part` mit passender Metadatei: vorhandene Bytes erst hashen (Hasher-Zustand ist nicht speicherbar), dann `Range: bytes=N-` + `If-Range: <etag|lastModified>`. Antwort `206` → anhängen; `200` → von vorn; `416` → Datei verwerfen, von vorn.
3. Streaming: jedes Chunk → Datei + `Sha256Stream`; Abbruch prüfen; Fortschritt gedrosselt.
4. Mehr Bytes als `expected_size` → sofort `SizeMismatch`. Ende: Größe und Hash prüfen. Fehlschlag → `.part` löschen (kein Fortsetzen auf Müll).
5. Wiederholen bei `Network{retryable}`, 408, 429 (Retry-After beachten), 5xx: Backoff 1 s, 4 s, 15 s. Nie bei 4xx sonst.
6. Abbruch: `.part` bleibt für späteres Fortsetzen (UI bietet „Fortsetzen“ über `InstallNote::resumeAvailable`).
7. Parallelität: globaler Semaphor (`settings.downloads.maxParallel`, Standard 2).

### 2.7 `install` – Plan, Entpacken, atomare Registrierung

```rust
pub struct InstallPlanData { /* alles aus InstallPlan + interne Felder: artifact: ArtifactSpec, target_dir, staging_dir */ }
pub fn plan(cat: &Catalog, p: &PlatformInfo, dirs: &AppDirs, settings: &Settings, program_id: &str,
            version: Option<&ProgramVersion>, channel: ReleaseChannel, known: &[Installation]) -> Result<InstallPlanData, InstallError>;

pub struct InstallCtx<'a> { pub dirs: &'a AppDirs, pub http: &'a HttpClient, pub state: &'a StateStore,
                            pub platform: &'a PlatformInfo, pub settings: &'a Settings }
pub async fn execute(ctx: &InstallCtx<'_>, plan: InstallPlanData, consent: &InstallConsent,
                     sink: &dyn ProgressSink<InstallEvent>, cancel: CancellationToken) -> Result<Installation, InstallError>;
pub fn remove_managed(ctx: &InstallCtx<'_>, installation_id: &str) -> Result<(), InstallError>;
pub fn recover_on_startup(dirs: &AppDirs, state: &StateStore) -> Result<RecoveryReport, InstallError>;

pub mod archive {
    pub struct ExtractLimits { pub max_total_bytes: u64, pub max_entries: u64, pub max_ratio: u64 /* 200 */ }
    pub struct ExtractOptions { pub strip_components: u32, pub allow_symlinks: bool }
    pub fn extract(kind: ArtifactKind, src: &Path, dest: &Path, limits: &ExtractLimits, opts: &ExtractOptions,
                   sink: &dyn ProgressSink<ExtractProgress>, cancel: &CancellationToken) -> Result<ExtractStats, ArchiveError>;
    pub fn sanitize_entry(raw: &str, strip: u32) -> Result<Option<RelPath>, UnsafeEntryReason>; // None = durch strip entfallen
}
#[cfg(target_os = "macos")] pub mod dmg {
    pub struct MountGuard { pub mount_point: PathBuf }           // Drop: hdiutil detach -force
    pub fn attach(dmg: &Path) -> Result<MountGuard, InstallError>;  // hdiutil attach -nobrowse -readonly -noautoopen -mountrandom <tmp> -plist
    pub fn copy_bundle(src_app: &Path, dest: &Path) -> Result<(), InstallError>; // /usr/bin/ditto
    pub fn assess(app: &Path) -> Result<Assessment, InstallError>;  // codesign --verify --deep --strict ; spctl --assess --type execute
}
#[cfg(target_os = "linux")] pub mod appimage {
    pub fn fuse2_available() -> bool;                     // /dev/fuse + libfuse.so.2 (ldconfig -p oder bekannte Pfade)
    pub fn make_executable(path: &Path) -> Result<(), InstallError>;  // 0o755
    pub fn extract(appimage: &Path, dest: &Path, cancel: &CancellationToken) -> Result<PathBuf /* AppRun */, InstallError>; // <appimage> --appimage-extract im Zielordner
}
```

Formate: `zip` (Crate `zip`), `7z` und `sfx7z` (Crate `sevenz-rust2`; SFX: 7z-Signatur `37 7A BC AF 27 1C` im Kopf suchen, ab dort lesen), `tarXz` (`tar` + `liblzma`), `tarGz` (`tar` + `flate2`), `dmg` (hdiutil, nur macOS), `appImage` (keine Entpackung, nur kopieren + ausführbar; optional `--appimage-extract`), `exeInstaller` (nur bekannte Installer-Typen mit festen Argumenten: `nsis` → `/S /D=<ziel>`, `inno` → `/VERYSILENT /CURRENTUSER /DIR=<ziel>`; Argumente kommen aus Code, nicht aus dem Katalog).

Atomarer Ablauf (Details 5.1):
`download → verify → extract nach <data>/staging/<jobId>/ (macOS: ~/Applications/Cypher Studio/.staging/, 7.2) → Inhaltsprüfung (launch.exe existiert, macOS assess) → falls Ziel existiert: Ziel → <ziel>.old-<ts> → rename staging → ziel → state.json atomar → .old löschen`. Jeder Schritt schreibt `<data>/staging/<jobId>.journal.json`; `recover_on_startup` räumt unvollständige Staging-Ordner weg und stellt `.old-*` zurück, wenn das Ziel fehlt.

### 2.8 `detect` – vorhandene Installationen

```rust
pub trait FsProbe: Send + Sync { fn exists(&self, p: &Path) -> bool; fn read(&self, p: &Path) -> Option<Vec<u8>>; fn glob(&self, pattern: &Path) -> Vec<PathBuf>; }
pub trait CommandRunner: Send + Sync { fn run(&self, exe: &Path, args: &[&str], timeout: Duration) -> Option<Output>; }
#[cfg(windows)] pub trait RegistryProbe: Send + Sync { fn uninstall_entries(&self) -> Vec<UninstallEntry>; }
pub struct DetectEnv { pub platform: PlatformInfo, pub known: KnownDirs, pub fs: Arc<dyn FsProbe>, pub cmd: Arc<dyn CommandRunner>,
                       #[cfg(windows)] pub registry: Arc<dyn RegistryProbe> }   // echte Implementierungen + Fakes für Tests
pub fn detect_all(env: &DetectEnv, cat: &Catalog, managed: &[Installation]) -> Vec<Installation>;  // parallel je Programm, Gesamtbudget 5 s
pub fn probe_manual(env: &DetectEnv, spec: &ProgramSpec, picked: &Path) -> Result<Installation, DetectError>;
```

Strategien je OS (Regeln stehen als Daten in `programs[].detect`, 4.1):

| OS | Quellen (in dieser Reihenfolge) | Version |
|---|---|---|
| Windows | Registry `HKLM\…\Uninstall`, `HKLM\WOW6432Node\…\Uninstall`, `HKCU\…\Uninstall` (DisplayName-Präfix, InstallLocation, DisplayIcon); bekannte Pfade (`%ProgramFiles%\Krita (x64)\bin\krita.exe`, `%ProgramFiles%\Inkscape\bin\inkscape.exe`, `%ProgramFiles%\Blender Foundation\Blender *\blender.exe`, `%ProgramFiles%\kdenlive\bin\kdenlive.exe`); Steam (`libraryfolders.vdf` → `steamapps\common\Blender`); MS Store (Phase 3: `Get-AppxPackage`-Äquivalent über Registry `…\AppModel\Repository\Packages`) | `DisplayVersion`, sonst Datei-Version der exe (VERSIONINFO) |
| macOS | `/Applications`, `~/Applications`, Spotlight `mdfind "kMDItemCFBundleIdentifier == '<bundleId>'"` (Timeout 3 s) | `Info.plist` → `CFBundleShortVersionString` |
| Linux | Flatpak (`flatpak list --app --columns=application,version,installation`), Snap (`snap list`), `PATH` (`which`), `~/Applications/*.AppImage`, `.desktop`-Dateien in `~/.local/share/applications` und `/usr/share/applications` (Exec-Zeile, ohne Ausführung) | Flatpak/Snap-Ausgabe; PATH-Binaries nur mit `--version`, wenn `detect.linux.versionProbe = true` (Timeout 5 s, ohne Shell, Umgebung bereinigt) |

Erkannte Installationen werden **nie** verändert; `managedByCypher = false`. IDs sind stabil (`system:<programId>:<hash(pfad)>`).

### 2.9 `launch` – Programme starten

```rust
pub enum Launcher { Exe { path: PathBuf }, MacApp { bundle: PathBuf }, AppImage { path: PathBuf, extract_and_run: bool },
                    Extracted { app_run: PathBuf }, Flatpak { app_id: String }, Snap { name: String }, MsStore { aumid: String } }
pub enum LaunchMode { Normal, BlenderAppTemplate }
pub struct LaunchSpec { pub program: PathBuf, pub args: Vec<OsString>, pub env_remove: Vec<&'static str>,
                        pub env_set: Vec<(OsString, OsString)>, pub cwd: Option<PathBuf> }
pub fn build(inst: &Installation, spec: &ProgramSpec, files: &[PathBuf], mode: LaunchMode, p: &PlatformInfo) -> Result<LaunchSpec, LaunchError>;
pub fn spawn(spec: &LaunchSpec) -> Result<Option<u32>, LaunchError>;
pub fn running_instances(spec: &ProgramSpec) -> usize;   // sysinfo, für "bitte Programm schließen" vor Einrichtung
```

Regeln: keine Shell, absolute Programmpfade, Argumente als Liste, Dateien nur aus Handles (bereits validiert), `stdin/stdout/stderr = null`. Windows: `CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS`. Unix: `process_group(0)`, damit das Programm Cypher Studio überlebt. macOS: `/usr/bin/open -n -a <App.app> [Dateien] [--args …]`. Flatpak: `flatpak run <id> [Dateien]`. Blender-Vorlage: `--app-template cypher_ps2`. **Umgebung bereinigen** (wichtig, wenn Cypher Studio selbst als AppImage läuft): `APPDIR, APPIMAGE, ARGV0, OWD, LD_LIBRARY_PATH, LD_PRELOAD, GDK_PIXBUF_MODULE_FILE, GDK_PIXBUF_MODULEDIR, GIO_MODULE_DIR, GSETTINGS_SCHEMA_DIR, GST_PLUGIN_SYSTEM_PATH, GST_PLUGIN_SYSTEM_PATH_1_0, GTK_PATH, GTK_EXE_PREFIX, GTK_DATA_PREFIX, GTK_IM_MODULE_FILE, PYTHONHOME, PYTHONPATH, PERLLIB, QT_PLUGIN_PATH, WEBKIT_*` entfernen; `PATH`/`XDG_DATA_DIRS` auf die beim Start gesicherten Originalwerte zurücksetzen, falls AppRun sie verändert hat.

### 2.10 `setup` – Einrichtungspakete anwenden und rückgängig machen

```rust
pub enum RootId { KritaResources, InkscapeProfile, BlenderConfig, BlenderScripts, BlenderExtensions, BlenderExtensionConfig, KdenliveData, KdenliveLocalData, UserFonts, ProjectTemplates }
pub struct PackManifest { /* 4.4 */ }
pub fn load_packs(resources: &Path) -> Result<Vec<PackManifest>, SetupError>;       // packs/*/pack.json, Schema + Hashes prüfen

pub struct ResolvedScope { pub scope_id: String, pub kind: ScopeKind, pub roots: BTreeMap<RootId, PathBuf>, pub installation_ids: Vec<String> }
pub fn resolve_scopes(pack: &PackManifest, installs: &[Installation], known: &KnownDirs, p: &PlatformInfo) -> Vec<ResolvedScope>;

pub struct SetupStore { /* <data>/setup: manifests/<setupId>.json, backups/<setupId>/…, journal/<setupId>.json */ }
pub fn plan(pack: &PackManifest, scope: &ResolvedScope, store: &SetupStore, running: bool) -> Result<SetupPlanData, SetupError>;
pub struct ApplySelection { pub components: Vec<String>, pub resolutions: BTreeMap<String /* conflictId */, ConflictResolution> }
pub fn apply(plan: SetupPlanData, sel: &ApplySelection, store: &SetupStore, runner: &dyn CommandRunner, sink: &dyn ProgressSink<SetupEvent>, cancel: &CancellationToken) -> Result<SetupRecord, SetupError>;
pub fn history(pack_id: &str, scope_id: &str, store: &SetupStore) -> Vec<SetupRecord>;
pub fn undo(setup_id: &str, store: &SetupStore, sink: &dyn ProgressSink<SetupEvent>) -> Result<UndoReport, SetupError>;
pub fn recover(store: &SetupStore) -> Result<(), SetupError>;   // offene Journale beim Start zurückrollen
pub fn status(pack: &PackManifest, scopes: &[ResolvedScope], store: &SetupStore) -> SetupSummary;

#[cfg(windows)] mod fonts_win;   // Kopie nach %LOCALAPPDATA%\Microsoft\Windows\Fonts, HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts, AddFontResourceW + WM_FONTCHANGE
#[cfg(target_os = "macos")] mod fonts_mac;   // ~/Library/Fonts
#[cfg(target_os = "linux")] mod fonts_linux; // ~/.local/share/fonts/cypher/ + fc-cache -f <ordner> (falls vorhanden)
```

Zielwurzeln (`RootId` → Pfad) sind **Code** in `setup/roots.rs`, je OS und Installationsart (Tabelle 7.4), nicht Katalogdaten: so kann ein manipulierter Katalog keine Schreibziele umlenken. Paket-Ziele sind `{root, rel}` mit validiertem `rel` (6.6). Erlaubte Aktionen sind eine geschlossene Liste: `copyFile`, `installFont`, `writeConfig` (kleine JSON-Datei aus festen Feldern, z. B. `cypher_studio.json` mit dem Pfad der Asset-Bibliothek für die Blender-Extension), `blenderExtensionInstall` (ruft `blender --command extension install-file --repo user_default --enable <zip>` der gewählten Installation auf, Timeout 120 s). Kein beliebiges Skript.

Idempotenz- und Sicherungsregeln je Datei (Hash = SHA-256 des Inhalts):

| Zustand am Ziel | Vorheriges Manifest | Operation |
|---|---|---|
| fehlt | – | `create` |
| Hash = Paketdatei | egal | `skip` |
| Hash = Hash aus unserem letzten Manifest | ja | `update` (ist unsere Datei, unverändert) |
| anderer Hash | nein oder anderer Hash | `conflict` → Nutzer entscheidet je Zeile: **Überschreiben** (immer mit Sicherung nach `backups/<setupId>/<root>/<rel>`), **Daneben ablegen** (`keepBothName`, z. B. `cypher-2026-10.kpl`) oder **Überspringen** (Standard). Studio überschreibt nie still. |

Pakete bestehen aus **Bausteinen** (`components` in pack.json: Palette, Schriften, Vorlagen, Arbeitsfläche, App-Template, Extension, Asset-Bibliothek, Titel, Videoprofile, Render-Preset), einzeln abwählbar und mit Status (aktuell, neu, veraltet, von dir geändert), wie in CONCEPT.md 6.3. Rückgängig ist bis zur nächsten Anwendung im selben Scope möglich (`undoAvailable`); ältere Einrichtungen stehen im Verlauf (`setup_history`). Gesperrte Dateien (Programm offen, Windows) werden je Zeile als Fehler gemeldet (`failures`), der Rest wird angewendet (Status `partial`).

Rückgängig: eigene Dateien, deren Hash noch dem Manifest entspricht, entfernen; Sicherungen zurückspielen; vom Nutzer geänderte Dateien bleiben liegen und werden in `keptModified` gemeldet. Schriften: nur entfernen, wenn keine andere aktive Einrichtung sie braucht (Referenzzählung über Manifeste).

### 2.11 `projects` und `templates` – Projekte und Vorlagen

Modell nach `docs/CONCEPT.md` (Abschnitt 4 „Objekte“, 6.1 Start): Ein **Projekt ist ein Ordner** `Projekte/<Name>/` im gemeinsamen Ordner (ohne Bibliothek: `<Dokumente>/Cypher Studio/Projekte`) mit `projekt.json` und festen Unterordnern. Eine **Vorlage** erzeugt eine **Datei** im passenden Unterordner eines Projekts und öffnet sie im Programm oder Modul.

```rust
pub fn list_templates(resources: &Path, library: Option<&Library>) -> Result<Vec<TemplateInfo>, ProjectError>; // packs/projects/*/template.json + <Bibliothek>/Vorlagen/*/template.json
pub fn list(root: &Path, state: &StateStore) -> Result<Vec<Project>, ProjectError>;   // Projekte/*/projekt.json; Index in state.json nur als Cache (zuletzt geöffnet)
pub fn create(root: &Path, name: &str, collection: Option<&str>) -> Result<Project, ProjectError>;   // Ordner + projekt.json + Unterordner; Name → sicherer Ordnername, Kollision → " (2)"
pub fn new_file(p: &Project, tpl: &TemplateInfo, resources: &Path, file_name: &str) -> Result<ProjectFile, ProjectError>; // kopiert Vorlagendatei nach <folder>/<name><ext>, nie überschreiben
pub fn last_file(p: &Project) -> Option<ProjectFileRef>;                              // jüngste Datei außer Export/
pub fn resolve_file(p: &Project, rel: &str) -> Result<PathBuf, ProjectError>;          // safe_join, muss existieren
pub fn read_document(p: &Project, rel: &str) -> Result<Option<ProjectDocument>, ProjectError>;
pub fn write_document(p: &Project, rel: &str, doc: &ProjectDocument) -> Result<ProjectFileRef, ProjectError>; // ≤ 1 MB, schemaVersion prüfen, atomar
pub fn add_asset(p: &Project, src: &Path, folder: ProjectFolder) -> Result<ProjectAsset, ProjectError>;      // Namenskollision → -2, -3 …
pub fn set_collection(p: &Project, collection: Option<&str>) -> Result<Project, ProjectError>;
pub fn program_for(path: &Path) -> Option<ProgramId>;  // .kra → krita, .svg → inkscape, .blend → blender, .kdenlive → kdenlive
```

Zuordnung Vorlage → Ordner: Shirt/Hoodie/Poster/Sticker (Krita, Inkscape) → `Motive/`; Mockup → `Mockups/`; Post/Story/Reel-Cover → `Social/` (Export nach `Export/Social/`); Reel (Kdenlive) → `Video/`; Modell (Blender) → `3D/`; Druck-Exporte → `Export/Druck/`.

### 2.12 `library` – gemeinsamer Ordner

```rust
pub struct Library { /* root, Index (HashMap<EntryId, Entry>), Facetten-Zähler, Cache-Pfad, optional notify-Watcher */ }
pub fn inspect_root(path: &Path, app_dirs: &AppDirs) -> Result<LibraryRootCandidate, LibraryError>;   // zählt Dateien/Größe/Projekte (Budget 3 s, sonst Schätzung), prüft Wurzel (6.6)
impl Library {
    pub fn open(root: &Path, cache_dir: &Path) -> Result<Self, LibraryError>;     // lädt Index-Cache
    pub fn init(root: &Path, display_name: &str, collections: &[Collection]) -> Result<(), LibraryError>; // .cypher/library.json + Standardordner
    pub fn scan(&mut self, sink: &dyn ProgressSink<ScanEvent>, cancel: &CancellationToken) -> Result<LibraryStatus, LibraryError>;
    pub fn query(&self, q: &LibraryQuery) -> LibraryPage;                        // inkl. Facetten; Ziel < 30 ms bei 5 000 Einträgen
    pub fn get(&self, id: &str) -> Result<&LibraryEntry, LibraryError>;
    pub fn path_of(&self, id: &str) -> Result<PathBuf, LibraryError>;
    pub fn update_meta(&mut self, id: &str, patch: &MetaPatch) -> Result<LibraryEntry, LibraryError>;  // Begleitdatei atomar
    pub fn bulk_meta(&mut self, ids: &[String], op: &BulkMeta) -> Result<usize, LibraryError>;
    pub fn import(&mut self, files: &[PathBuf], sub: Option<&str>, meta: &ImportMeta) -> Result<Vec<LibraryEntry>, LibraryError>;
    pub fn set_collections(&mut self, c: &[Collection]) -> Result<LibraryStatus, LibraryError>;
    pub fn thumbnail(&self, id: &str) -> Result<PathBuf, LibraryError>;  // bei Bedarf 512 px PNG im Cache, Schlüssel = hash(relPath, size, mtime)
    pub fn clear_thumbnails(&self) -> Result<(), LibraryError>;
    pub fn watch(&mut self, on_change: impl Fn(usize) + Send + 'static) -> Result<(), LibraryError>;   // notify, entprellt 1 s
    pub fn status(&self) -> LibraryStatus;
}
pub mod thumbs {   // Vorschaubilder ohne Fremdprogramme
    // PNG/JPEG/WebP/TIFF: image; SVG: resvg (gerastert, kein Skript); .kra: ZIP → mergedimage.png/preview.png;
    // .blend: eingebettete Vorschau (Block "TEST", ggf. zstd-komprimierte Datei); Video: Phase 4 (ffmpeg aus einer vorhandenen Kdenlive-Installation, sonst Symbol)
}
pub mod exchange {   // Austauschpaket .cypherpack
    pub fn export(lib: &Library, ids: &[String], dest: &Path, title: &str, author: &str, sink: &dyn ProgressSink<PackEvent>, cancel: &CancellationToken) -> Result<(), LibraryError>;
    pub fn inspect(src: &Path, lib: &Library) -> Result<PackPreview, LibraryError>;
    pub fn import(lib: &mut Library, src: &Path, policy: PackConflictPolicy, sink: &dyn ProgressSink<PackEvent>, cancel: &CancellationToken) -> Result<PackImportReport, LibraryError>;
}
pub fn detect_sync_tool(root: &Path) -> Option<SyncTool>;   // .stfolder → Syncthing, .sync_*.db/.owncloudsync.log → Nextcloud, .dropbox → Dropbox …
```

Index und Vorschaubilder liegen **lokal** im Cache (nicht im geteilten Ordner) → keine Sync-Konflikte. Geteilt werden nur Dateien und **Begleitdateien unter `.cypher/meta/<relPath>.json`** (eine je Datei, damit zwei Personen gleichzeitig verschiedene Dateien taggen können, ohne Konfliktkopien; CONCEPT.md 4). Umbenennen in Cypher Studio verschiebt die Begleitdatei mit; extern umbenannte Dateien findet der Scan über `contentSha256` wieder. Konfliktkopien der Sync-Werkzeuge (`*.sync-conflict-*` bei Syncthing, `* (conflicted copy)*` bei Dropbox, `*_conflict-*` bei Nextcloud) werden erkannt und markiert, nie automatisch gelöscht.

### 2.13 `printcheck` – Druckdateien prüfen und exportieren

Grundlage: `docs/research/vorgaben.md` (Abschnitte 0, 1, 5). Alle Zahlen stehen im Druckprofil (Katalog), nicht im Code.

```rust
pub struct ImageMeta { pub format: ImgFormat, pub width: u32, pub height: u32, pub bit_depth: u8, pub channels: Channels,
                       pub interlaced: bool, pub animated: bool /* acTL */, pub dpi: Option<(f64, f64, DpiSource)>,
                       pub icc: Option<Vec<u8>>, pub srgb_chunk: bool, pub file_bytes: u64 }
pub struct Limits { pub max_pixels: u64 /* 120 Mio. */, pub max_file_bytes: u64 /* 512 MB Eingabe */ }
pub fn read_meta(path: &Path) -> Result<ImageMeta, PrintError>;      // png::Info (pixel_dims, icc_profile, srgb, animation_control, interlaced),
                                                                      // tiff-Tags 282/283/296/34675/338, JPEG APP0/APP1/APP2
pub fn describe_icc(icc: &[u8]) -> IccInfo;                          // moxcms::ColorProfile::new_from_slice → Farbraum + Beschreibung → ColorProfileKind
pub fn decode(path: &Path, limits: &Limits) -> Result<DecodedImage, PrintError>;   // intern RGBA16; CMYK wird nicht dekodiert (Befund reicht)
pub fn analyze(img: &DecodedImage, meta: &ImageMeta, profile: &PrintProfile, garment: Option<&GarmentColor>,
               technique: PrintTechnique, planned_width_mm: f64) -> PrintReport;    // rein, deterministisch, Regel-Reihenfolge fest
pub fn plan_export(report: &PrintReport, profile: &PrintProfile, opts: &PrintExportOptions) -> ExportGeometry;
pub fn apply_fixes(img: &mut DecodedImage, fixes: &Fixes, garment: Option<&GarmentColor>, profile: &PrintProfile);
pub fn render_export(img: &DecodedImage, geo: &ExportGeometry) -> Result<image::RgbaImage, PrintError>; // fast_image_resize Lanczos3, VORMULTIPLIZIERTES Alpha
pub fn convert_profile(img: &mut image::RgbaImage, from: &IccInfo, to: ExportColorProfile) -> Result<Vec<u8> /* ICC */, PrintError>; // moxcms
pub fn encode_png(img: &image::RgbaImage, dpi: u32, icc: &[u8], out: &mut impl Write) -> Result<(), PrintError>;
        // 8 bit RGBA, nicht interlaced, pHYs = 11811 px/m (300 dpi), iCCP eingebettet, kein sRGB-Chunk zusätzlich
pub fn placement_json(report: &PrintReport, profile: &PrintProfile, opts: &PrintExportOptions, file: &str, sha256: &str) -> PlacementJson;
pub fn overlay(img: &DecodedImage, kind: OverlayKind, profile: &PrintProfile) -> image::RgbaImage;
pub const ENGINE_VERSION: &str = "1.0.0";
```

**Messgrößen** (Reihenfolge der Berechnung):
1. `V` = Pixel mit `a > 0`; `bounds` = Hüllrechteck der Pixel mit `a ≥ semiMin` (13); `trimmedPx` = Größe von `bounds` (so misst Shirtigo nach dem automatischen Zuschnitt).
2. Geisterpixel = Pixel mit `1 ≤ a ≤ ghostMax` (12) **außerhalb** von `bounds`.
3. Halbtransparenz roh `A` = Pixel mit `semiMin ≤ a ≤ semiMax`. Kantensaum: Pixel aus `A`, die im Umkreis von `edgeRadiusPx` (2) sowohl ein Pixel mit `a = 0` als auch eines mit `a = 255` haben → normales Anti-Aliasing. Rest `H`. Maßgeblich `semiAreaShareOfVisible = |H| / |V|`. Umsetzung: zwei Dilatationen (Masken „transparent“ und „deckend“, Radius 2, quadratischer Kern) in einem Durchlauf über Zeilenpuffer, O(n), ohne Zusatz-Crate.
4. Effektive dpi = `trimmedPx.width / (plannedWidthMm / 25.4)`; `plannedHeightMm` folgt aus dem Seitenverhältnis; `maxWidthMmAtTargetDpi = trimmedPx.width / targetDpi × 25.4`.
5. Dünnste Linie (Phase 3): morphologische Öffnung der Maske `a ≥ 128` mit Radius `warnBelowPx/2`; verschwindende Pixel = zu dünn; `minStrokePx` aus Distanztransformation.
6. Kontrast: Anteil sichtbarer Pixel mit Kontrastverhältnis < 1,3 zur `textileHex` der gewählten Textilfarbe.

**Regeln** (Schwellen aus dem Profil; „Unterlage“ = `garment.underbase`):

| Regel | Bedingung | Schwere |
|---|---|---|
| `format.unreadable` | Datei nicht dekodierbar | error |
| `format.notUploadable` | TIFF/WebP (wird beim Export PNG) | info |
| `format.jpegNoAlpha` | JPEG | warning (kein Alphakanal → Rechteck) |
| `format.animated` | APNG (`acTL`) | error |
| `format.interlaced` | Adam7 | warning (Export ohne Interlace) |
| `format.bitDepth16` | 16 bit je Kanal | warning (Export 8 bit) |
| `format.indexed` | Palettenbild | info |
| `size.belowMinPixels` | `trimmedPx` beide Seiten < 1000 / eine Seite < 1000 | error / warning |
| `size.aboveMaxPixels` | eine Seite > 10 500 px | error |
| `file.tooLarge` | > 48 MB / > 64 MB | warning / error |
| `resolution.tooLow` | effektive dpi < 150 | error |
| `resolution.belowTarget` | 150 ≤ effektive dpi < 300 | warning |
| `resolution.metadataMismatch` | pHYs fehlt oder ≠ 11811 px/m | info (Export setzt 300 dpi; Shirtigo wertet pHYs nicht aus) |
| `resolution.upscaleNeeded` | Export müsste vergrößern | warning |
| `layout.empty` | `bounds = null` | error |
| `layout.exceedsPrintArea` | geplante Breite/Höhe > `printAreaMm` | error |
| `layout.exceedsSafeArea` | > `safeAreaMm` (280 × 360) | warning („kleine Größen werden verkleinert“) |
| `layout.touchesEdge` | `bounds` berührt Bildrand | info (evtl. abgeschnittenes Motiv) |
| `color.cmyk` | CMYK | error |
| `color.noProfile` | weder iCCP noch sRGB-Chunk | warning (als sRGB angenommen) |
| `color.unsupportedProfile` | Profil ≠ sRGB/Adobe RGB | warning (Export rechnet um) |
| `color.profileDiffers` | Profil ≠ `exportProfile` (z. B. sRGB bei Shirtigo) | info (Export rechnet um) |
| `color.grayscale` | Graustufen | info |
| `color.nearBlack` | > 5 % der sichtbaren Pixel mit Helligkeit < 5 %, aber nicht `#000000` | info (Korrektur „Reinschwarz“ anbieten) |
| `alpha.missing` | kein Alphakanal | error bei Unterlage, sonst warning |
| `alpha.opaqueBackground` | Alpha vorhanden, aber > 98 % der Randpixel deckend | warning (vergessener Hintergrund) |
| `alpha.semiTransparent` | `semiAreaShareOfVisible` ≥ 0,1 % (≥ 1 % → error) | warning/error; DTF: error ab 0,1 %; weißes Textil: info |
| `alpha.ghostPixels` | Geisterpixel > 0 | warning (verhindern den automatischen Zuschnitt) |
| `detail.thinLines` | `minStrokePx` < 10 (< 5 kritisch) | warning |
| `contrast.lowOnGarment` | > 40 % der sichtbaren Pixel mit Kontrast < 1,3 | warning |

**Korrekturen beim Export** (`PrintExportOptions.fixes`, jede einzeln abschaltbar, Standard aus):
- `cleanGhostPixels`: Alpha 1–12 außerhalb von `bounds` → 0.
- `semiTransparency`: `threshold` (Alpha ≥ 128 → 255, sonst 0), `blendWithGarment` (Pixel aus `H` mit `textileHex` verrechnen, Alpha → 255; Shirtigo-Empfehlung für Flächen), `halftone` (geordnetes Raster in Volltonpunkte; Phase 3+).
- `nearBlackToPureBlack`: Helligkeit < 5 % → `#000000` (bekommt keine weiße Unterlage).

**Exportarten** (vorgaben.md 1.8):
- `trimmed`: Motiv auf `bounds` zugeschnitten, skaliert auf `plannedWidthMm` bei 300 dpi, plus Begleitdatei `<name>.shirtigo.json` (4.7) mit Fläche, Verfahren, Breite und Versatz in mm. Für den Designer-Upload und spätere API-Aufrufe (`width`, `offset_top`, `offset_center`).
- `fullArea`: transparente Leinwand in Größe der Druckfläche (z. B. 3898 × 5315), Motiv an `offsetTopMm`/`offsetCenterMm`. Für `extract_size_and_position`.

Speicher: RGBA16 für 3898 × 5315 ≈ 166 MB; Grenze 120 Mio. Pixel schützt vor Ausreißern (`imageTooLarge`). Analyse in `spawn_blocking`, Ziel ≤ 1,5 s für eine 3898 × 5315-PNG (DESIGN.md „Tempo“, Referenz Laptop i5/8 GB); dafür Analyse auf 8-bit-Alpha-Ebene und parallel über Zeilenblöcke (`std::thread::scope`, kein rayon nötig).

### 2.14 `brand` und Vorlagen der Module

```rust
pub fn load_brand(resources: &Path) -> Result<BrandData, CoreError>;                    // packs/shared/brand/brand.json
pub fn load_mockup_templates(resources: &Path) -> Result<Vec<MockupTemplateData>, CoreError>;  // packs/mockups/*/template.json
pub fn load_social_templates(resources: &Path) -> Result<Vec<SocialTemplateData>, CoreError>;  // packs/social/*/template.json
```

Die Daten enthalten relative Dateinamen; `src-tauri` ersetzt sie durch `AssetUrl`s des Protokolls `cyasset` (6.3).

### 2.15 `settings` und `state`

```rust
pub struct SettingsStore { /* path, RwLock<Settings> */ }
impl SettingsStore {
    pub fn load(dirs: &AppDirs) -> Self;                    // fehlt/kaputt → Standardwerte, kaputte Datei per fsx::quarantine_corrupt sichern
    pub fn get(&self) -> Settings;
    pub fn update(&self, patch: &SettingsPatch) -> Result<Settings, CoreError>;   // validieren, atomar schreiben
    pub fn set_dir(&self, which: DirSetting, path: &Path) -> Result<Settings, CoreError>;   // nur aus nativem Dialog; beschreibbar, nicht im Systemordner
}
// `ui` (UiPreferences) und `onboarding` gehören fachlich dem Frontend; Rust prüft nur Typen, Wertebereiche (zoom 50–200) und Größe (≤ 64 KB).
// Netzwerk-Protokoll: `download::HttpClient` schreibt jede Anfrage (Zeit, Host, Zweck, Status, Bytes) in einen Ringpuffer (200) → network_info.
pub struct StateStore { /* path, RwLock<PersistedState> */ }
impl StateStore {
    pub fn load(dirs: &AppDirs) -> Result<Self, CoreError>;    // Migrationen über schemaVersion
    pub fn read<R>(&self, f: impl FnOnce(&PersistedState) -> R) -> R;
    pub fn update<R>(&self, f: impl FnOnce(&mut PersistedState) -> R) -> Result<R, CoreError>;  // schreibt atomar nach jeder Änderung
}
```

Single-Instance (`tauri-plugin-single-instance`) verhindert zwei Prozesse auf derselben `state.json`; `cypher-cli` nimmt eine Sperrdatei (`<data>/.lock`, `fs4`-Lock) und verweigert die Arbeit, wenn die App läuft.

### 2.16 `bgremove` – Hintergrund entfernen (Farbschlüssel Phase 3, Modell Phase 5 mit Cargo-Feature `bgremove`)

Empfehlung aus `research/vorgaben.md` 3.4:
- **Zuerst ohne KI**: Farbschlüssel/Flood-Fill von den Ecken bzw. vom Rand mit Toleranz (`method: colorKey`). Für flächige Grafiken perfekte, deterministische Kanten, kein Download. Teil von `cypher-core` ohne Feature.
- **Modell**: **IS-Net general-use** (`isnet-general-use.onnx`, Apache-2.0, ca. 179 MB) über `ort` (MIT/Apache-2.0, **genau gepinnt**, da noch Release Candidate) mit `load-dynamic`. Modell **und** die ONNX-Runtime-Bibliothek (MIT, offizielle Microsoft-Builds) kommen als Katalog-Einträge (`models[]`) über dieselbe Plan-/Zustimmungs-/Prüfkette nach `<data>/models/`, nicht in den Installer. Upstream veröffentlicht nur MD5 → beim ersten Aufnehmen einmal laden, SHA-256 berechnen, im Katalog festschreiben und die Datei als Release-Asset des eigenen Repos spiegeln (Apache-2.0 erlaubt Weitergabe mit Lizenztext). Datei > 25 MiB → GitHub Releases, nicht die Downloader-Seite.
- Vorverarbeitung wie rembg: 1024 × 1024 Lanczos, RGB, `x − 0,5`, NCHW float32; Ausgabe `pred[:,0]` min-max → Alpha in Originalgröße (Lanczos).
- **Nicht** BRIA RMBG-1.4/2.0 (nichtkommerziell). Hinweis zu den Trainingsdaten (DIS5K nur nichtkommerziell, Rechtslage der Gewichte ungeklärt) steht in `NOTICE` und in `BgRemoveModelInfo.notice`.
- Später optional BiRefNet lite (MIT), wenn es auf den Rechnern des Kollektivs < 3 s und < 4 GB bleibt.

API: `status() -> BgRemoveStatus`, `color_key(img, tolerance, sample) -> RgbaImage`, `run_model(input, model, refine, sink, cancel) -> RgbaImage`. Ergebnis immer als neue Datei (Handle), Original bleibt unverändert.

### 2.17 `src-tauri` – Tauri-Schicht

| Datei | Inhalt |
|---|---|
| `lib.rs` | `tauri::Builder`: Plugins (`single-instance` **als erstes**, `dialog`, `opener`, `updater`, `process`, `window-state`; alle nur aus Rust benutzt, `single-instance` braucht keine Capability; Logging über `tracing` mit Datei-Rotation, kein JS-Log-Plugin), `.manage(AppCtx)`, `invoke_handler(generate_handler![…alle Commands…])`, `register_asynchronous_uri_scheme_protocol` für `cyfile`, `cythumb`, `cyasset`, `setup`-Hook (Recovery, Katalog laden, Erkennung im Hintergrund, Update-Prüfung nach 10 s) |
| `ctx.rs` | `pub struct AppCtx { dirs, platform, settings: SettingsStore, state: StateStore, catalog: CatalogStore, http: HttpClient, hosts: Arc<HostPolicy>, jobs: JobRegistry, install_plans: PlanStore<InstallPlanData>, setup_plans: PlanStore<SetupPlanData>, handles: HandleRegistry, library: tokio::sync::RwLock<Option<Library>>, packs: Vec<PackManifest> }` |
| `handles.rs` | `HandleRegistry`: `register(path, source) -> FileHandleInfo` (MIME per `infer` aus dem Inhalt), `resolve(id) -> PathBuf`, LRU 1000, nur Sitzung |
| `protocols.rs` | Auslieferung von Handles, Vorschaubildern und Paket-Assets, mit Bereichsprüfung, `Content-Type`, `Access-Control-Allow-Origin: <App-Origin>` (sonst „tainted canvas“) |
| `dragdrop.rs` | `WindowEvent::DragDrop(Drop { paths, position })` → Handles registrieren → Event `files:dropped` |
| `close_guard.rs` | `CloseRequested` abfangen, wenn Jobs laufen → Event `app:closeRequested`; `app_close{force}` bricht ab und beendet |
| `updater.rs` | Kleber für `tauri-plugin-updater` (5.7) |
| `commands/*.rs` | je Modul eine Datei; nur Parameter prüfen, Kern aufrufen, Fehler mappen. Keine Fachlogik. |
| `build.rs` | `tauri_build::try_build(Attributes::new().app_manifest(AppManifest::new().commands(&[…])))`, damit jeder Command eine Freigabe braucht (6.1) |

---

## 3. IPC-Vertrag

Die vollständigen TypeScript-Typen stehen in [`docs/ipc-contract.ts`](ipc-contract.ts) (kompiliert mit `tsc --strict --exactOptionalPropertyTypes`). Dieses Kapitel ergänzt Rust-Signaturen, Semantik, Fehler und die Absicherung des Vertrags.

### 3.1 Grundregeln

1. Ein Argument `req` (Request-Struct) + optional `on_event: Channel<E>`. JS-Schlüssel camelCase (`onEvent`), Tauri mappt auf snake_case-Parameter.
2. Alle DTOs liegen in `crates/cypher-core/src/api/` mit `#[derive(Serialize, Deserialize, ts_rs::TS)]`, `#[serde(rename_all = "camelCase")]`, `#[ts(export, export_to = "../../apps/desktop/src/ipc/generated/")]`. `u64`/`i64` immer mit `#[ts(type = "number")]` (ts-rs erzeugt sonst `bigint`).
3. Rückgabe immer `Result<T, AppError>`; `AppError` ist `#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]`.
4. Lange Vorgänge: Command bleibt offen bis zum Ende, liefert das Endergebnis; Fortschritt über den Channel; erstes Ereignis ist immer `started { jobId }`; Abbruch über `job_cancel` → Command rejected mit `{ kind: "cancelled" }`.
5. Kein Command nimmt absolute Pfade oder URLs entgegen. Einzige Ausnahme sind **relative** Pfade innerhalb eines Projekts (`relPath`), die Rust mit `safe_join` gegen den Projektordner prüft (6.6).
6. Commands sind **nebenläufig sicher**; Konflikte melden `busy`.

### 3.2 Commands mit Rust-Signatur

Alle Funktionen tragen `#[tauri::command]` und liegen in `apps/desktop/src-tauri/src/commands/<datei>.rs`. Abkürzungen: `C = State<'_, AppCtx>`, `A = AppHandle`, `R<T> = Result<T, AppError>`, `Ch<E> = tauri::ipc::Channel<E>`.

```rust
// app.rs
pub async fn app_info(ctx: C) -> R<AppInfo>;
pub async fn app_open_external(app: A, ctx: C, req: OpenExternalReq) -> R<()>;          // tauri-plugin-opener, URL aus Katalog/fester Liste
pub async fn app_reveal(app: A, ctx: C, req: RevealReq) -> R<()>;                        // opener::reveal_item_in_dir
pub async fn app_close(app: A, ctx: C, req: AppCloseReq) -> R<()>;
pub async fn diagnostics_export(app: A, ctx: C) -> R<Option<FileHandleInfo>>;            // ZIP: Logs, settings.json, state.json (ohne Pfade außerhalb), app_info
// settings.rs
pub async fn settings_get(ctx: C) -> R<Settings>;
pub async fn settings_update(ctx: C, req: SettingsPatch) -> R<Settings>;
pub async fn settings_choose_dir(app: A, ctx: C, req: SettingsChooseDirReq) -> R<Option<Settings>>;
pub async fn network_info(ctx: C) -> R<NetworkInfo>;                                    // Endpunkte aus Code + Katalog-Hosts, Ringpuffer der Anfragen
// catalog.rs
pub async fn catalog_status(ctx: C) -> R<CatalogStatus>;
pub async fn catalog_refresh(app: A, ctx: C) -> R<CatalogRefreshResult>;                  // emit catalog:updated, programs:changed bei Änderung
// programs.rs
pub async fn programs_list(ctx: C) -> R<ProgramsView>;                                   // aus Cache, schnell (< 50 ms)
pub async fn programs_rescan(app: A, ctx: C) -> R<ProgramsView>;                         // detect_all, emit programs:changed
pub async fn program_set_preferred(app: A, ctx: C, req: SetPreferredReq) -> R<ProgramOverview>;
pub async fn program_add_manual(app: A, ctx: C, req: AddManualReq) -> R<Option<Installation>>;   // nativer Dialog, probe_manual
// install.rs
pub async fn install_preview(ctx: C, req: InstallPreviewReq) -> R<InstallPlan>;
pub async fn install_start(app: A, ctx: C, req: InstallStartReq, on_event: Ch<InstallEvent>) -> R<Installation>;
pub async fn installation_remove(app: A, ctx: C, req: InstallationRemoveReq) -> R<()>;
// launch.rs
pub async fn program_launch(ctx: C, req: LaunchReq) -> R<LaunchResult>;
// setup.rs
pub async fn setup_packs_list(ctx: C) -> R<Vec<SetupSummary>>;
pub async fn setup_status(ctx: C, req: SetupStatusReq) -> R<SetupSummary>;
pub async fn setup_preview(ctx: C, req: SetupPreviewReq) -> R<SetupPlan>;
pub async fn setup_apply(app: A, ctx: C, req: SetupApplyReq, on_event: Ch<SetupEvent>) -> R<SetupRecord>;
pub async fn setup_undo(app: A, ctx: C, req: SetupUndoReq) -> R<UndoReport>;
pub async fn setup_history(ctx: C, req: SetupHistoryReq) -> R<Vec<SetupRecord>>;
// files.rs
pub async fn file_pick(app: A, ctx: C, req: FilePickReq) -> R<Vec<FileHandleInfo>>;      // tauri-plugin-dialog aus Rust (blocking_pick_file in spawn_blocking)
pub async fn export_save_image(app: A, ctx: C, request: tauri::ipc::Request<'_>) -> R<Option<FileHandleInfo>>;  // RAW: InvokeBody::Raw + Header x-cypher-export-meta
pub async fn samples_list(ctx: C) -> R<Vec<SampleInfo>>;                                // packs/samples/* als Handles
// projects.rs
pub async fn templates_list(ctx: C) -> R<Vec<TemplateInfo>>;
pub async fn projects_list(ctx: C) -> R<Vec<Project>>;
pub async fn project_create(app: A, ctx: C, req: ProjectCreateReq) -> R<Project>;        // emit projects:changed
pub async fn project_new_file(app: A, ctx: C, req: ProjectNewFileReq) -> R<ProjectFile>;
pub async fn project_open_file(ctx: C, req: ProjectFileReq) -> R<ProjectOpenResult>;
pub async fn project_open_last(ctx: C, req: ProjectRef) -> R<ProjectOpenResult>;
pub async fn project_file_handle(ctx: C, req: ProjectFileReq) -> R<FileHandleInfo>;
pub async fn project_set_collection(app: A, ctx: C, req: ProjectSetCollectionReq) -> R<Project>;
pub async fn project_forget(app: A, ctx: C, req: ProjectRef) -> R<()>;                    // nur aus der Liste (Index), Dateien bleiben
pub async fn project_read_document(ctx: C, req: ProjectReadDocumentReq) -> R<Option<ProjectDocument>>;
pub async fn project_write_document(ctx: C, req: ProjectWriteDocumentReq) -> R<ProjectFileRef>;
pub async fn project_add_asset(ctx: C, req: ProjectAddAssetReq) -> R<ProjectAsset>;
// library.rs
pub async fn library_status(ctx: C) -> R<LibraryStatus>;
pub async fn library_choose_root(app: A, ctx: C) -> R<Option<LibraryRootCandidate>>;     // nativer Ordnerdialog + Zusammenfassung
pub async fn library_use_root(app: A, ctx: C, req: LibraryUseRootReq) -> R<LibraryStatus>; // emit library:changed { rootChanged }
pub async fn library_scan(app: A, ctx: C, on_event: Ch<ScanEvent>) -> R<LibraryStatus>;
pub async fn library_query(ctx: C, req: LibraryQuery) -> R<LibraryPage>;
pub async fn library_get(ctx: C, req: LibraryGetReq) -> R<LibraryEntry>;
pub async fn library_update_meta(app: A, ctx: C, req: LibraryMetaPatchReq) -> R<LibraryEntry>;
pub async fn library_bulk_meta(app: A, ctx: C, req: LibraryBulkMetaReq) -> R<u32>;
pub async fn library_import(app: A, ctx: C, req: LibraryImportReq) -> R<Vec<LibraryEntry>>;
pub async fn library_entry_handle(ctx: C, req: LibraryGetReq) -> R<FileHandleInfo>;
pub async fn library_set_collections(app: A, ctx: C, req: LibrarySetCollectionsReq) -> R<LibraryStatus>;
pub async fn library_thumbnails_clear(ctx: C) -> R<()>;
pub async fn library_pack_export(app: A, ctx: C, req: PackExportReq, on_event: Ch<PackEvent>) -> R<Option<FileHandleInfo>>;
pub async fn library_pack_inspect(ctx: C, req: PackInspectReq) -> R<PackPreview>;
pub async fn library_pack_import(app: A, ctx: C, req: PackImportReq, on_event: Ch<PackEvent>) -> R<PackImportReport>;
// printcheck.rs
pub async fn print_profiles_list(ctx: C) -> R<Vec<PrintProfile>>;
pub async fn printcheck_analyze(ctx: C, req: PrintAnalyzeReq) -> R<PrintReport>;
pub async fn printcheck_export(app: A, ctx: C, req: PrintExportReq, on_event: Ch<PrintExportEvent>) -> R<PrintExportResult>;
pub async fn printcheck_overlay(ctx: C, req: PrintOverlayReq) -> R<FileHandleInfo>;        // PNG im Cache, als Handle
// brand.rs
pub async fn brand_get(ctx: C) -> R<Brand>;
pub async fn mockup_templates_list(ctx: C) -> R<Vec<MockupTemplate>>;
pub async fn social_templates_list(ctx: C) -> R<Vec<SocialTemplate>>;
// updater.rs
pub async fn app_update_check(app: A, ctx: C) -> R<UpdateCheck>;
pub async fn app_update_install(app: A, ctx: C, on_event: Ch<UpdateEvent>) -> R<()>;     // endet mit app.restart()
// jobs.rs
pub async fn jobs_active(ctx: C) -> R<Vec<JobInfo>>;
pub async fn jobs_recent(ctx: C) -> R<Vec<JobRecord>>;
pub async fn job_cancel(ctx: C, req: JobCancelReq) -> R<bool>;
// bgremove.rs  (colorKey immer; Modell-Commands nur mit #[cfg(feature = "bgremove")], sonst modelFeature=false bzw. notFound)
pub async fn bgremove_status(ctx: C) -> R<BgRemoveStatus>;
pub async fn bgremove_model_preview(ctx: C, req: BgRemoveModelReq) -> R<InstallPlan>;
pub async fn bgremove_model_install(app: A, ctx: C, req: InstallStartReq, on_event: Ch<InstallEvent>) -> R<BgRemoveStatus>;
pub async fn bgremove_run(app: A, ctx: C, req: BgRemoveRunReq, on_event: Ch<BgRemoveEvent>) -> R<FileHandleInfo>;
```

### 3.3 Semantik und typische Fehler je Command

| Command | Semantik | Typische `AppError.kind` |
|---|---|---|
| `programs_list` | Katalog ⨝ Installationen ⨝ Einrichtungsstatus, aus dem Speicher. Beim App-Start läuft `detect_all` einmal im Hintergrund, danach `programs:changed`. | – |
| `install_preview` | Wählt Artefakt für echtes OS/Arch, prüft freien Platz (Download + `unpackedSizeMax`), legt Plan an. Keine Netzwerkzugriffe. | `notFound`, `unsupportedPlatform`, `diskFull` |
| `install_start` | Führt Plan aus (5.1). Zustimmung muss `planId`, `sha256`, `licenseSpdx`, `targetDir` des Plans exakt wiederholen. Plan ist danach verbraucht. | `planExpired`, `consentMismatch`, `busy`, `network`, `httpStatus`, `hostNotAllowed`, `sizeMismatch`, `checksumMismatch`, `signatureInvalid`, `archiveUnsafeEntry`, `archiveTooLarge`, `installVerificationFailed`, `diskFull`, `cancelled` |
| `installation_remove` | `deleteFiles` nur für `managedByCypher`; prüft, dass das Programm nicht läuft; löscht nur unterhalb `programsDir`. Einrichtungen im portablen Scope werden mit entfernt (Manifest markiert). | `invalidInput`, `busy` (`programRunning`) |
| `program_launch` | Startet entkoppelt (2.9). | `notFound`, `launchFailed` |
| `setup_preview` | Löst Scope auf, berechnet Operationen (2.10), prüft laufende Programme. | `setupUnsupported`, `notFound` |
| `setup_apply` | Nur gewählte Bausteine; Konflikte nach `resolutions` (fehlend = überspringen). Journal → Dateien → Manifest. Einzelne gesperrte Dateien → `failures` + Status `partial`; schwerer Fehler → automatische Rückrollung, dann Rejection. | `planExpired`, `busy`, `io`, `permissionDenied`, `cancelled` |
| `setup_undo` | Stellt Sicherungen wieder her; nie fremde Dateien löschen. | `notFound`, `io` |
| `file_pick` | Nativer Dialog mit Filter je `purpose`; Ergebnis als Handles. Abbruch = `[]`. | – |
| `export_save_image` | Prüft Magic Bytes (PNG/JPEG), Größe ≤ 64 MB; setzt bei PNG optional pHYs (Chunk wird eingefügt, nicht neu kodiert). Ziel per Dialog, Projekt oder Bibliothek. | `invalidInput`, `unsupportedFormat`, `io` |
| `project_create` | Ordner `Projekte/<Name>/` mit `projekt.json` und Unterordnern; Name wird bereinigt, Kollision → „ (2)“. | `io`, `invalidInput`, `libraryNotConfigured` (nur Hinweis, dann Dokumente-Ordner) |
| `project_new_file` | Datei aus Vorlage im passenden Unterordner, nie überschreiben (Kollision → `invalidInput{field:"fileName"}`). | `notFound`, `io`, `invalidInput` |
| `project_open_file` / `project_open_last` | Programm-Datei: bevorzugte Installation starten; Modul-Dokument: `outcome.kind = "module"`; Programm fehlt: `programMissing`. | `launchFailed`, `notFound` |
| `library_choose_root` | Dialog + Zusammenfassung (Dateien, Größe, Projekte, Sync-Werkzeug, Probleme), noch **ohne** Umstellung. | `libraryRootInvalid` |
| `library_use_root` | Übernimmt den Kandidaten, legt bei `initialize` die Struktur an, startet Scan + Watcher. | `notFound` (Kandidat abgelaufen), `libraryRootInvalid`, `io` |
| `library_pack_import` | Vorher `library_pack_inspect`; Import mit Zip-Slip-Schutz, Größenlimit, Konfliktpolitik. | `packInvalid`, `archiveUnsafeEntry`, `io` |
| `printcheck_analyze` | Metadaten + Pixelanalyse in `spawn_blocking`; Ziel ≤ 1,5 s für 3898 × 5315 (DESIGN.md). | `imageDecode`, `unsupportedFormat`, `imageTooLarge` |
| `printcheck_export` | Korrekturen → Zuschnitt/Leinwand → Resampling → Farbprofil → PNG 300 dpi → erneute Analyse; optional Begleitdatei `.shirtigo.json`. Dateiname `<name>_<produkt>-<fläche>_<breite>mm_300dpi.png`. | wie analyze + `io` |
| `app_update_install` | Nur wenn keine Jobs laufen (`busy`), Zustand ist gespeichert; Windows: NSIS „passive“, App beendet sich. | `busy`, `updateFailed`, `signatureInvalid` |

### 3.4 Channels (Fortschritt)

| Command | Ereignistyp | Reihenfolge |
|---|---|---|
| `install_start`, `bgremove_model_install` | `InstallEvent` | `started` → `phase(download)` → `downloadProgress`* (`resumed`, `retrying` möglich) → `phase(verifyChecksum)` → [`phase(verifySignature)`] → `verified` → `phase(extract)` → `extractProgress`* → `phase(checkContent)` → `phase(register)` → `finished` |
| `setup_apply` | `SetupEvent` | `started` → `step`* → `finished` |
| `library_scan` | `ScanEvent` | `started` → `progress`* → `finished` |
| `library_pack_export/import` | `PackEvent` | `started` → `progress`* → `finished` |
| `printcheck_export` | `PrintExportEvent` | `started` → `stage`* → `finished` |
| `app_update_install` | `UpdateEvent` | `started` → `progress`* → `installing` |
| `bgremove_run` | `BgRemoveEvent` | `started` → `stage`* → `finished` |

`*Progress`-Ereignisse sind auf 10/s gedrosselt. Fehler kommen **nicht** über den Channel, sondern als Rejection des Commands.

### 3.5 Globale Events

| Event | Nutzlast | Wann |
|---|---|---|
| `catalog:updated` | `CatalogStatus` | nach erfolgreichem Wechsel auf neueren Katalog |
| `programs:changed` | `{ reason }` | nach Installation, Entfernen, Neuerkennung, Einrichtung, Katalogwechsel |
| `library:changed` | `{ reason, changedCount }` | Watcher (entprellt 1 s), Import, Scan, Metadaten |
| `projects:changed` | `{ projectId \| null }` | Projekt angelegt, Datei neu, Kollektion geändert, Watcher im Ordner `Projekte/` |
| `files:dropped` | `{ handles, position }` | Dateien auf das Fenster gezogen |
| `update:available` | `UpdateCheck` | automatische Prüfung beim Start fand ein Update |
| `app:closeRequested` | `{ activeJobs }` | Fenster schließen, während Jobs laufen |
| `jobs:changed` | `{ active, finished }` | Job beginnt, macht Fortschritt (≤ 2/s) oder endet (`finished` = JobRecord) |

Frontend-Regel: Events nur **invalidieren** (TanStack Query `invalidateQueries`), Daten immer über Commands holen. So bleiben Event-Nutzlasten klein und Reihenfolgeprobleme harmlos.

### 3.6 Fehlerarten und UI-Reaktion

| `kind` | Bedeutung | Wiederholen sinnvoll | UI |
|---|---|---|---|
| `notFound` | ID unbekannt (veraltete Ansicht) | nein | Liste neu laden, Toast |
| `invalidInput` | Programmierfehler oder ungültige Eingabe | nein | Feldfehler |
| `planExpired` / `consentMismatch` | Plan abgelaufen/abweichend | ja, neuer Plan | Vorschau neu öffnen |
| `busy` | gleicher Vorgang läuft / Programm offen | später | Hinweis mit Job-Anzeige bzw. „Programm schließen“ |
| `cancelled` | Abbruch durch Nutzer | – | still, Zustand „abgebrochen“, ggf. „Fortsetzen“ |
| `io`, `permissionDenied`, `diskFull` | Dateisystem | nach Behebung | Pfad anzeigen, „Ordner öffnen“ |
| `network`, `httpStatus` | Netz/Server | ja (`retryable`) | „Erneut versuchen“, Hinweis Offline |
| `hostNotAllowed`, `insecureUrl` | Katalog zeigt auf nicht erlaubtes Ziel | nein | Sicherheitswarnung, Katalog neu laden |
| `checksumMismatch`, `sizeMismatch`, `signatureInvalid` | Datei manipuliert oder kaputt | einmal (Download wird verworfen) | **Sicherheitswarnung**, Datei gelöscht, nichts installiert |
| `catalogRollback`, `catalogIncompatible` | alter/zu neuer Katalog | nein | Hinweis „App aktualisieren“ |
| `unsupportedPlatform` | kein Artefakt für OS/Arch | nein | Link zur Programmseite |
| `archiveInvalid`, `archiveUnsafeEntry`, `archiveTooLarge` | Archiv defekt/gefährlich | nein | Sicherheitswarnung |
| `installVerificationFailed` | Inhalt unerwartet (exe fehlt, macOS-Prüfung) | nein | Fehlerbericht anbieten |
| `launchFailed` | Start fehlgeschlagen | ja | Details, „Installation prüfen“ |
| `setupConflict`, `setupUnsupported` | Einrichtung nicht möglich | nein | Erklärung |
| `imageDecode`, `imageTooLarge`, `unsupportedFormat` | Bilddatei | nein | Erklärung mit unterstützten Formaten |
| `libraryNotConfigured`, `libraryRootInvalid` | Bibliothek | – | Einrichtungsassistent |
| `packInvalid` | Austauschpaket defekt | nein | Erklärung |
| `updateFailed` | App-Update | ja | „Später erneut“, Link Downloader-Seite |
| `internal` | Fehler im Code | – | „Etwas ist schiefgelaufen“ + Korrelations-ID + „Diagnose exportieren“ |

### 3.7 Absicherung des Vertrags

1. **Kanonisch:** `docs/ipc-contract.ts`.
2. **Generiert:** `cargo test -p cypher-core --features ts-export export_bindings` schreibt `apps/desktop/src/ipc/generated/*.ts` (eingecheckt; CI prüft mit `git diff --exit-code`, dass nichts veraltet ist).
3. **Gegenprüfung (Compile-Zeit):** `apps/desktop/src/ipc/contract-check.ts` prüft für jeden DTO-Typ beidseitige Zuweisbarkeit:

```ts
import type * as C from "@contract";
import type * as G from "./generated";
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type _AppError = Assert<Mutual<C.AppError, G.AppError>>;
export type _InstallPlan = Assert<Mutual<C.InstallPlan, G.InstallPlan>>;
// … ein Eintrag je exportiertem Typ; ein Vitest-Test prüft, dass jede Datei in generated/ hier vorkommt.
```

4. **Gemeinsame Fixtures:** `docs/contract-fixtures/<Typ>/<fall>.json`. Rust-Test: jede Fixture deserialisieren und verlustfrei wieder serialisieren (Round-Trip). Frontend-Mocks (`src/ipc/mock/`) laden dieselben Dateien (`satisfies C.InstallPlan`).
5. **Command-Liste:** Rust-Test vergleicht `generate_handler!`-Liste mit `COMMAND_NAMES` (Datei wird per `include_str!` gelesen und geparst); Vitest prüft, dass der Mock-Handler alle `COMMAND_NAMES` bedient.
6. **Typisierter Aufruf im Frontend** (`src/ipc/commands.ts`):

```ts
import { invoke, Channel } from "@tauri-apps/api/core";
import type { CommandName, CommandArgs, CommandResult, AppError } from "@contract";

declare function toAppError(raw: unknown): AppError; // in src/ipc/errors.ts, mit Tests für jede kind

export async function call<K extends CommandName>(cmd: K, args: CommandArgs<K>): Promise<CommandResult<K>> {
  try {
    return (await invoke(cmd, args as Record<string, unknown>)) as CommandResult<K>;
  } catch (raw) {
    throw toAppError(raw); // prüft { kind: string }, sonst { kind: "internal", … }
  }
}
export function channel<E>(onEvent: (e: E) => void): Channel<E> {
  const ch = new Channel<E>();
  ch.onmessage = onEvent;
  return ch;
}
```

---

## 4. Datenmodelle

### 4.1 Katalog (`catalog/catalog.json`)

Zwei Ebenen:
- **`catalog/sources.json` (Rezept, nur CLI/CI):** übernommen aus `research/catalog-draft.json` – URL-Vorlagen (`{series}`, `{version}`), `versionDiscovery` (Verzeichnislisten, HTML-Seiten bei Inkscape), Prüfsummen-Quellen, Signaturschlüssel, Erkennungsregeln, Konfigurationsordner. Wird **nie** von der App gelesen; das Scrapen von Webseiten läuft so nur in `cypher catalog build`, nie beim Nutzer.
- **`catalog/catalog.json` (aufgelöst, signiert, App):** konkrete URLs, Größen, SHA-256, Startbefehle; Schema unten. `cypher catalog build sources.json` erzeugt einen Kandidaten, Mensch prüft und signiert (5.8).

Datei-Layout: UTF-8, LF, 2 Leerzeichen eingerückt, Schlüsselreihenfolge stabil (für lesbare Diffs). Signatur: `catalog.json.minisig` (minisign, prehashed). Größe ≤ 2 MB. Versionsvergleich für Programme punktnumerisch (`ProgramVersion`, eigener Typ), SemVer nur für App und Pakete. Auswahlregel je Plattform: neueste Release mit Artefakt für OS/Arch im gewünschten Kanal → Intel-Macs erhalten so automatisch Blender 4.5 LTS.

JSON Schema (gekürzt auf das Verbindliche; Team A legt es vollständig als `catalog/schema/catalog.schema.json` an, CI prüft mit Ajv):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://studio.cypherxcypher.de/catalog/v1/catalog.schema.json",
  "type": "object",
  "required": ["schemaVersion", "sequence", "generatedAt", "expiresAt", "minAppVersion", "programs", "links", "printProfiles"],
  "properties": {
    "schemaVersion": { "const": 1 },
    "sequence":      { "type": "integer", "minimum": 1, "description": "streng steigend, Rollback-Schutz" },
    "generatedAt":   { "type": "string", "format": "date-time" },
    "expiresAt":     { "type": "string", "format": "date-time" },
    "minAppVersion": { "$ref": "#/$defs/semver" },
    "programs":      { "type": "array", "items": { "$ref": "#/$defs/program" } },
    "links":         { "type": "array", "items": { "$ref": "#/$defs/link" } },
    "printProfiles": { "type": "array", "items": { "$ref": "#/$defs/printProfile" } },
    "models":        { "type": "array", "items": { "$ref": "#/$defs/model" }, "default": [] }
  },
  "$defs": {
    "id":     { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$", "maxLength": 40 },
    "semver": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+([-+][0-9A-Za-z.-]+)?$" },
    "programVersion": { "type": "string", "pattern": "^\\d+(\\.\\d+){1,3}([-+][0-9A-Za-z.-]+)?$", "description": "punktnumerisch, z. B. 5.3.4.1 oder 26.08.2 (kein SemVer!)" },
    "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "httpsUrl": { "type": "string", "pattern": "^https://[^\\s@]+$", "maxLength": 512 },
    "relPath": { "type": "string", "pattern": "^(?!/)(?!.*\\.\\.)(?!.*\\\\)[^:*?\"<>|]+$", "maxLength": 200 },
    "license": { "type": "object", "required": ["spdx", "name", "url"],
                 "properties": { "spdx": { "type": "string" }, "name": { "type": "string" }, "url": { "$ref": "#/$defs/httpsUrl" } } },
    "program": {
      "type": "object",
      "required": ["id", "name", "vendor", "category", "description", "homepage", "license", "detect", "releases"],
      "properties": {
        "id": { "$ref": "#/$defs/id" },
        "name": { "type": "string" }, "vendor": { "type": "string" },
        "category": { "enum": ["raster", "vector", "3d", "video", "audio", "upscale", "other"] },
        "description": { "type": "string", "maxLength": 400 },
        "homepage": { "$ref": "#/$defs/httpsUrl" },
        "releaseNotesUrl": { "$ref": "#/$defs/httpsUrl" },
        "license": { "$ref": "#/$defs/license" },
        "detect": { "$ref": "#/$defs/detect" },
        "setup": {
          "type": "object", "required": ["packId", "versionRange", "roots"],
          "properties": {
            "packId": { "$ref": "#/$defs/id" },
            "versionRange": { "type": "string", "description": "semver-Bereich, z. B. \">=4.2, <6\"" },
            "roots": { "type": "array", "items": { "enum": ["kritaResources", "inkscapeProfile", "blenderConfig", "blenderScripts",
                       "blenderExtensions", "kdenliveData", "userFonts", "projectTemplates"] },
                       "description": "Auswahl aus im Code definierten Wurzeln – der Katalog kann KEINE Pfade setzen" },
            "configVersionDir": { "enum": ["none", "majorMinor"], "default": "none", "description": "Blender: <config>/<X.Y>/" }
          }
        },
        "releases": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/release" } }
      }
    },
    "release": {
      "type": "object", "required": ["version", "channel", "artifacts"],
      "properties": {
        "version": { "$ref": "#/$defs/programVersion" },
        "channel": { "enum": ["stable", "lts", "preview"] },
        "releasedAt": { "type": "string", "format": "date" },
        "artifacts": { "type": "array", "items": { "$ref": "#/$defs/artifact" } }
      }
    },
    "artifact": {
      "type": "object",
      "required": ["os", "arch", "kind", "url", "fileName", "size", "sha256", "checksumSource", "unpackedSizeMax", "launch"],
      "properties": {
        "os": { "enum": ["windows", "macos", "linux"] },
        "arch": { "enum": ["x86_64", "aarch64", "universal"] },
        "kind": { "enum": ["zip", "7z", "tarXz", "tarGz", "dmg", "appImage", "sfx7z", "exeInstaller"] },
        "installerType": { "enum": ["nsis", "inno"], "description": "nur bei exeInstaller; Argumente stehen im Code" },
        "url": { "$ref": "#/$defs/httpsUrl" },
        "fileName": { "type": "string", "pattern": "^[A-Za-z0-9._+-]+$" },
        "size": { "type": "integer", "minimum": 1 },
        "sha256": { "$ref": "#/$defs/sha256" },
        "checksumSource": { "$ref": "#/$defs/httpsUrl", "description": "offizielle Prüfsummendatei/-seite, von CI gegengeprüft" },
        "checksumOrigin": { "enum": ["upstream", "cypherPinned"], "default": "upstream" },
        "signature": {
          "type": "object", "required": ["type", "url", "publicKeys", "fingerprints"],
          "properties": {
            "type": { "enum": ["pgp", "minisign"] },
            "enforce": { "type": "boolean", "default": true, "description": "false = nur protokollieren (schwache Upstream-Signatur)" },
            "url": { "$ref": "#/$defs/httpsUrl" },
            "publicKeys": { "type": "array", "items": { "type": "string" }, "description": "armored PGP-Schlüssel bzw. minisign-Pubkeys" },
            "fingerprints": { "type": "array", "items": { "type": "string" } }
          }
        },
        "stripComponents": { "type": "integer", "minimum": 0, "maximum": 3, "default": 0 },
        "unpackedSizeMax": { "type": "integer", "minimum": 1 },
        "macAppName": { "type": "string", "description": "Name des .app im dmg, z. B. Blender.app" },
        "launch": {
          "type": "object", "required": ["exe"],
          "properties": {
            "exe": { "$ref": "#/$defs/relPath", "description": "relativ zum Installationsordner bzw. Contents/MacOS im .app" },
            "args": { "type": "array", "items": { "type": "string", "pattern": "^--?[a-z0-9-]+(=[A-Za-z0-9._-]+)?$" }, "maxItems": 4 },
            "fileArgs": { "enum": ["append", "none"], "default": "append" },
            "portableMarker": { "$ref": "#/$defs/relPath", "description": "Ordner, der den portablen Modus aktiviert, z. B. \"portable\" (Blender ≥ 4.2)" }
          }
        }
      }
    },
    "detect": {
      "type": "object",
      "properties": {
        "windows": { "type": "object", "properties": {
          "uninstallDisplayNamePrefixes": { "type": "array", "items": { "type": "string" } },
          "exeNames": { "type": "array", "items": { "type": "string" } },
          "knownPaths": { "type": "array", "items": { "type": "string" }, "description": "mit {ProgramFiles}, {LocalAppData}, * als Platzhalter" },
          "steamAppId": { "type": "integer" },
          "msStorePackageFamily": { "type": "string" } } },
        "macos": { "type": "object", "properties": { "bundleIds": { "type": "array", "items": { "type": "string" } } } },
        "linux": { "type": "object", "properties": {
          "flatpakIds": { "type": "array", "items": { "type": "string" } },
          "snapNames": { "type": "array", "items": { "type": "string" } },
          "binNames": { "type": "array", "items": { "type": "string" } },
          "appImageGlobs": { "type": "array", "items": { "type": "string" } },
          "versionProbe": { "type": "boolean", "default": false } } }
      }
    },
    "link": { "type": "object", "required": ["id", "name", "url", "description"],
              "properties": { "id": { "$ref": "#/$defs/id" }, "name": { "type": "string" }, "url": { "$ref": "#/$defs/httpsUrl" },
                              "description": { "type": "string" }, "note": { "type": "string" } } },
    "printProfile": { "type": "object", "description": "Felder 1:1 wie PrintProfile in ipc-contract.ts" },
    "model": { "type": "object", "required": ["id", "name", "license", "url", "size", "sha256", "purpose"],
               "properties": { "purpose": { "const": "bgremove" } } }
  }
}
```

Beispiel (Werte **Beispiel/ANNAHME**, echte Zahlen aus `research/catalog-draft.json`):

```json
{
  "schemaVersion": 1,
  "sequence": 1,
  "generatedAt": "2026-10-16T12:00:00Z",
  "expiresAt": "2027-04-16T00:00:00Z",
  "minAppVersion": "0.1.0",
  "programs": [{
    "id": "blender", "name": "Blender", "vendor": "Blender Foundation", "category": "3d",
    "description": "3D-Modelle im PS2-Retro-Stil für den 3D-Shop, mit Cypher-Startszene und Export-Add-on.",
    "homepage": "https://www.blender.org",
    "license": { "spdx": "GPL-3.0-or-later", "name": "GNU GPL v3 oder später", "url": "https://www.blender.org/about/license/" },
    "detect": {
      "windows": { "uninstallDisplayNamePrefixes": ["Blender"], "exeNames": ["blender.exe"],
                   "knownPaths": ["{ProgramFiles}\\Blender Foundation\\Blender *\\blender.exe"], "steamAppId": 365670 },
      "macos": { "bundleIds": ["org.blenderfoundation.blender"] },
      "linux": { "flatpakIds": ["org.blender.Blender"], "snapNames": ["blender"], "binNames": ["blender"], "versionProbe": true }
    },
    "setup": { "packId": "blender", "versionRange": ">=4.2, <6", "roots": ["blenderScripts", "blenderExtensions"], "configVersionDir": "majorMinor" },
    "releases": [{
      "version": "5.2.2", "channel": "lts", "releasedAt": "2026-09-15",
      "artifacts": [{
        "os": "windows", "arch": "x86_64", "kind": "zip",
        "url": "https://download.blender.org/release/Blender5.2/blender-5.2.2-windows-x64.zip",
        "fileName": "blender-5.2.2-windows-x64.zip", "size": 404453484,
        "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
        "checksumSource": "https://download.blender.org/release/Blender5.2/blender-5.2.2.sha256",
        "stripComponents": 1, "unpackedSizeMax": 1600000000,
        "launch": { "exe": "blender.exe", "fileArgs": "append", "portableMarker": "portable" }
      }]
    }, {
      "version": "4.5.14", "channel": "lts", "releasedAt": "2026-09-01",
      "artifacts": [{ "os": "macos", "arch": "x86_64", "kind": "dmg", "macAppName": "Blender.app",
                      "url": "https://download.blender.org/release/Blender4.5/blender-4.5.14-macos-x64.dmg", "…": "…" }]
    }]
  }],
  "links": [{ "id": "affinity", "name": "Affinity", "url": "https://www.affinity.studio/",
              "description": "Kommerzielles Grafikprogramm (Canva).", "note": "Nur Verweis, keine Installation durch Cypher Studio." }],
  "printProfiles": [{
    "id": "shirtigo-tee-front", "provider": "shirtigo",
    "product": { "id": "tee", "providerProductId": "organic-shirt", "label": "Organic Shirt (Creator 2.0, STTU169)" },
    "placement": "front", "techniques": ["dtg", "dtf"], "title": "T-Shirt Vorderseite",
    "printAreaMm": { "width": 330, "height": 450 }, "safeAreaMm": { "width": 280, "height": 360 }, "topMarginHintMm": 26,
    "widthPresets": [
      { "id": "chestEmblem", "label": "Brustemblem", "widthMm": 100, "maxWidthMm": 150 },
      { "id": "chestCentered", "label": "Brust zentriert", "widthMm": 280, "maxWidthMm": 330 }
    ],
    "defaultWidthMm": 280, "targetDpi": 300, "errorBelowDpi": 150,
    "minPxPerSide": 1000, "maxPxPerSide": 10500, "warnFileBytes": 50331648, "maxFileBytes": 67108864,
    "acceptedUploadFormats": ["png", "jpeg"],
    "color": { "exportProfile": "adobeRgb", "acceptedProfiles": ["adobeRgb", "srgb"] },
    "alpha": { "semiMin": 13, "semiMax": 252, "ghostMax": 12, "edgeRadiusPx": 2, "warnShare": 0.001, "errorShare": 0.01,
               "severityOnLightGarment": "info", "severityForDtf": "error" },
    "strokes": { "warnBelowPx": 10, "criticalBelowPx": 5 },
    "source": { "urls": ["https://cockpit.shirtigo.com/de/catalog/product/organic-shirt",
                         "https://helpcenter.shirtigo.de/faq/haeufigste-fragen/motiverstellung-haeufigste-fragen/dtg-guideline/"],
                "checkedAt": "2026-10-16T00:00:00Z" },
    "assumption": true
  }],
  "models": []
}
```

### 4.2 Eingebettete Hostliste (Code, nicht Katalog)

```rust
// crates/cypher-core/src/download/hosts.rs  – ANNAHME A-05, programme.md bestätigt
pub const EMBEDDED_HOSTS: &[HostRule] = &[
    HostRule { host: "download.blender.org",                  redirects: RedirectPolicy::WithinAllowlist },
    HostRule { host: "download.kde.org",                      redirects: RedirectPolicy::AnyHttpsPinned }, // Spiegelverteiler (MirrorBrain)
    HostRule { host: "download.gimp.org",                     redirects: RedirectPolicy::AnyHttpsPinned }, // optional (A-10), Verhalten prüfen
    HostRule { host: "inkscape.org",                          redirects: RedirectPolicy::WithinAllowlist },
    HostRule { host: "media.inkscape.org",                    redirects: RedirectPolicy::WithinAllowlist },
    HostRule { host: "github.com",                            redirects: RedirectPolicy::WithinAllowlist },
    HostRule { host: "objects.githubusercontent.com",         redirects: RedirectPolicy::WithinAllowlist },
    HostRule { host: "release-assets.githubusercontent.com",  redirects: RedirectPolicy::WithinAllowlist },
    HostRule { host: "studio.cypherxcypher.de",               redirects: RedirectPolicy::WithinAllowlist },
    HostRule { host: "raw.githubusercontent.com",             redirects: RedirectPolicy::WithinAllowlist },
];
```

`AnyHttpsPinned` heißt: Weiterleitung auf beliebige `https`-Hosts erlaubt, **weil** die SHA-256 aus dem signierten Katalog den Inhalt festnagelt; Signatur- und Prüfsummendateien werden dagegen immer direkt von der Hauptquelle geladen (Redirects dort nur `WithinAllowlist`).

### 4.3 App-Zustand

Datenordner (`<data>` siehe 2.3):

```
<data>/
├─ state.json                  # PersistedState (unten)
├─ .lock                       # CLI-/App-Sperre
├─ catalog/{catalog.json, catalog.json.minisig}       # zuletzt gültiger Remote-Katalog
├─ programs/<programId>/<version>/…                    # portable Installationen
├─ staging/<jobId>/ , staging/<jobId>.journal.json      # nur während Installation
├─ setup/{manifests/<setupId>.json, backups/<setupId>/…, journal/<setupId>.json}
├─ jobs-history.json           # Aufträge der letzten 24 h (max. 200)
├─ network-log.json            # letzte 200 Anfragen (Einstellungen → Netzwerk), ohne Inhalte
├─ models/<modelId>/…                                   # Phase 5
└─ logs/cypher-studio.log (+ rotiert, 7 Dateien à 5 MB)
<cache>/
├─ downloads/<sha256>.part(.json) , downloads/<sha256>.<ext>   # Cache nur bei settings.downloads.keepCache
├─ thumbs/<hash>.png
└─ library-index/<hash(root)>.json
<config>/settings.json
```

`state.json` (Rust `PersistedState`, alle Felder camelCase):

```json
{
  "schemaVersion": 1,
  "catalogHighestSequence": 7,
  "installations": [{
    "id": "cypher:blender:5.2.2", "programId": "blender", "version": "5.2.2", "kind": "cypher",
    "path": "C:\\Users\\…\\AppData\\Local\\de.cypherxcypher.studio\\data\\programs\\blender\\5.2.2",
    "launcher": { "type": "exe", "relExe": "blender.exe" },
    "installedAt": "2026-10-20T10:00:00Z",
    "verified": { "sha256": "…", "catalogSequence": 7, "signatureChecked": false },
    "artifact": { "url": "https://download.blender.org/…", "kind": "zip" }
  }],
  "manualInstallations": [{ "id": "manual:krita:ab12", "programId": "krita", "path": "D:\\Tools\\krita\\bin\\krita.exe" }],
  "preferred": { "blender": "cypher:blender:5.2.2" },
  "setups": [{ "setupId": "7c1e…", "packId": "blender", "programId": "blender", "scopeId": "b3f…", "packVersion": "1.0.0",
               "appliedAt": "2026-10-20T10:05:00Z", "status": "applied", "filesWritten": 6, "backupsTaken": 0 }],
  "projectIndex": [{ "id": "1f0c…", "dir": "D:\\Sync\\Cypher\\Projekte\\Herbst-Drop 26", "lastOpenedAt": "2026-10-20T11:00:00Z" }],
  "libraryRoot": "D:\\Sync\\Cypher"
}
```

Erkannte Systeminstallationen werden **nicht** gespeichert (bei jedem Start neu erkannt, Ergebnis nur im Speicher), verwaltete und manuelle schon. Migrationen: `state::migrate(v_alt) -> v_neu`, jede Version mit Fixture-Test.

### 4.4 Einrichtungspaket (`packs/<id>/pack.json`) und Setup-Manifest

```json
{
  "$schema": "../schema/pack.schema.json",
  "id": "krita",
  "programId": "krita",
  "version": "1.0.0",
  "title": "Cypher-Einrichtung für Krita",
  "programVersions": ">=5.2, <6",
  "requiresPacks": [],
  "requiresProgramClosed": false,
  "components": [
    { "id": "bundle",    "kind": "bundle",    "label": "Palette „Cypher Kollektionen“ und Arbeitsfläche", "optional": false, "files": ["bundle"] },
    { "id": "templates", "kind": "templates", "label": "Vorlagen (Shirt vorne, Hoodie vorne, Post, Story)", "optional": false, "files": ["tpl-dir", "tpl-tee", "tpl-tee-kra"] },
    { "id": "fonts",     "kind": "fonts",     "label": "Schriften", "optional": false, "files": ["font-anybody"] }
  ],
  "files": [
    { "id": "bundle",        "src": "bundles/cypher.bundle",                 "root": "kritaResources", "rel": "bundles/cypher.bundle" },
    { "id": "tpl-dir",       "src": "templates/Cypher/.directory",           "root": "kritaResources", "rel": "templates/Cypher/.directory" },
    { "id": "tpl-tee",       "src": "templates/Cypher/Shirt-Front.desktop",  "root": "kritaResources", "rel": "templates/Cypher/Shirt-Front.desktop" },
    { "id": "tpl-tee-kra",   "src": "templates/Cypher/.source/Shirt-Front.kra", "root": "kritaResources", "rel": "templates/Cypher/.source/Shirt-Front.kra" },
    { "id": "font-anybody",  "src": "../fonts/anybody/Anybody-Variable.ttf", "root": "kritaResources", "rel": "fonts/cypher/Anybody-Variable.ttf" }
  ],
  "actions": [],
  "sha256": { "bundles/cypher.bundle": "…", "templates/Cypher/.source/Shirt-Front.kra": "…" }
}
```

- `cypher.bundle` (Paletten, Arbeitsfläche, Pinselvoreinstellungen) wird **einmal in Krita erzeugt** und eingecheckt (Format mit `md5sum`-Pflicht, Handbau fehleranfällig); Krita registriert Bundles aus `bundles/` beim nächsten Start. Vorlagen nach Krita-Struktur `templates/<Gruppe>/.directory`, `<Name>.desktop` (`URL=.source/<Name>.kra`).
- **Schriften programmeigen statt systemweit**, wo möglich: Krita lädt `<ressourcen>/fonts/`, Inkscape `<profil>/fonts/` (programme.md). Das Paket `fonts` (`programId: null`, `root: "userFonts"`, Aktion `installFont`) installiert nur für Programme ohne eigenen Schriftordner (Kdenlive, andere Apps) in den Benutzer-Schriftordner des OS; `kdenlive` hat `requiresPacks: ["fonts"]`.
- Konfigurationsdateien der Programme (`kritarc`, `preferences.xml`, `kdenliverc`) werden **nicht** angefasst.
- Paket `blender`: Dateien unter `blenderScripts` (`startup/bl_app_templates_user/cypher_ps2/{__init__.py, startup.blend}`), Aktionen `{ "type": "blenderExtensionInstall", "zip": "dist/cypher_export-1.0.0.zip" }` und `{ "type": "writeConfig", "root": "blenderExtensionConfig", "rel": "cypher_studio.json", "fields": { "assetLibraryPath": "{libraryRoot}/3D" } }` (Platzhalter nur aus fester Liste). Im Manifest stehen dann `fonts` (Paket `fonts`: installierte Datei, unter Windows der Registry-Wert) bzw. `actions` mit Ergebnis (`exitCode`).
- `sha256` wird von `packs/tools/build.mjs` erzeugt; Rust prüft beim Laden jede Paketdatei dagegen (Schutz gegen beschädigte Installation).

Setup-Manifest `<data>/setup/manifests/<setupId>.json`:

```json
{
  "setupId": "7c1e…", "packId": "krita", "packVersion": "1.0.0", "scopeId": "b3f…", "scopeKind": "userProfile",
  "roots": { "kritaResources": "C:\\Users\\…\\AppData\\Roaming\\krita" },
  "appliedAt": "2026-10-20T10:05:00Z",
  "entries": [
    { "component": "bundle", "root": "kritaResources", "rel": "bundles/cypher.bundle", "op": "create", "sha256": "…", "backup": null },
    { "component": "templates", "root": "kritaResources", "rel": "templates/Cypher/Shirt-Front.desktop", "op": "conflict:overwrite", "sha256": "…",
      "backup": { "rel": "backups/7c1e…/kritaResources/templates/Cypher/Shirt-Front.desktop", "sha256": "…" } }
  ],
  "fonts": [],
  "actions": []
}
```

Journal `<data>/setup/journal/<setupId>.json`: `{ "state": "applying" | "undoing", "done": [<entry-index>…] }`. Beim Start: Journal vorhanden → abgeschlossene Schritte rückwärts zurückrollen, Manifest verwerfen, Ereignis im Log.

### 4.5 Projekt und Vorlage

Projektordner (CONCEPT.md 4, ergänzt um `Social/`, `Video/`, `3D/`):

```
<Bibliothek>/Projekte/Herbst-Drop 26/
├─ projekt.json
├─ Motive/          # .kra, .svg, .png (Vorlagen „Shirt vorne“, „Hoodie vorne“, Poster, Sticker)
├─ Mockups/         # *.mockup.json (Modul-Dokument) + gerenderte PNG
├─ Social/          # *.social.json (Modul-Dokument)
├─ Video/           # .kdenlive (Reel)
├─ 3D/              # .blend
└─ Export/
   ├─ Druck/        # Shirtigo-PNG + .shirtigo.json
   └─ Social/       # PNG/JPEG in Zielgröße
```

`projekt.json`:

```json
{
  "formatVersion": 1,
  "id": "1f0c7a9e-…",
  "name": "Herbst-Drop 26",
  "collection": "rauschen",
  "formats": ["shirtigo-tee-front", "post", "story"],
  "createdAt": "2026-10-20T11:00:00Z",
  "createdBy": "Mo"
}
```

Dateizahl, letzte Datei und Änderungszeit berechnet Rust beim Auflisten (nicht in der Datei → keine Sync-Konflikte bei paralleler Arbeit).

Vorlage `packs/projects/<id>/template.json` (eigene Vorlagen genauso unter `<Bibliothek>/Vorlagen/<id>/`):

```json
{
  "id": "shirt-front-krita", "title": "Shirt vorne", "target": "program", "programId": "krita",
  "description": "Leinwand 330 × 450 mm (3898 × 5315 px, 300 dpi), transparent, Hilfslinien der sicheren Fläche 280 × 360 mm.",
  "format": { "label": "330 × 450 mm", "widthPx": 3898, "heightPx": 5315, "dpi": 300, "widthMm": 330, "heightMm": 450 },
  "folder": "Motive", "fileExtension": ".kra", "file": "files/shirt-front.kra",
  "printProfileId": "shirtigo-tee-front", "preview": "preview.png", "requiresSetup": false, "tags": ["shirt", "druck"]
}
```

Mitgelieferte Vorlagen (Formatleiste der Startseite, Inhalte Team C): Shirt vorne (Krita und Inkscape, 330 × 450 mm), Hoodie vorne (330 × 280 mm), Post 1080 × 1350, Story 1080 × 1920, Reel 1080 × 1920 (Kdenlive), Reel-Cover, Poster A2 (426 × 600 mm mit Anschnitt, vorgaben.md 1.2), Sticker 1:1 (nur Datei; Shirtigo druckt keine Sticker), Modell (Blender, App-Template `cypher_ps2`), Mockup Shirt/Hoodie.

### 4.6 Bibliothek: Ordner, Begleitdateien, Austauschpaket

Teil-Lösung ohne Konten und Kosten: **ein normaler Ordner**, den jedes Mitglied mit seinem vorhandenen Sync-Werkzeug teilt. Cypher Studio synchronisiert nicht selbst. Empfehlung: **Syncthing** (MPL-2.0, Peer-to-Peer, kein Konto, kein Server); funktioniert genauso mit Nextcloud, Google Drive, Dropbox, OneDrive oder iCloud. Wer nichts synchronisieren will, tauscht **Austauschpakete** (`.cypherpack`) per Messenger oder USB-Stick.

```
Cypher/                        # gemeinsamer Ordner (Name frei)
├─ .cypher/
│  ├─ library.json             # { "formatVersion": 1, "name": "Cypher Kollektiv", "collections": [ { "id": "rauschen", "name": "Rauschen", "hex": "#0b0b0a" }, … ], "createdAt": "…" }
│  ├─ meta/<relPath>.json      # Begleitdatei je Datei (Tags, Kollektion, Status …)
│  └─ trash/                   # beim Überschreiben durch Paket-Import ersetzte Vorversionen
├─ Projekte/                   # Projekte (4.5)
├─ Vorlagen/                   # eigene Vorlagen (Ordner mit template.json)
├─ 3D/                         # Blender-Asset-Bibliothek (.blend, .glb + .lizenz.json nach research/3d-konventionen.md)
├─ Motive/  Schriften/  Paletten/
└─ LIESMICH.txt                # Erklärung für Menschen ohne App
```

Begleitdatei `.cypher/meta/Projekte/Herbst-Drop 26/Motive/neon-ratte.png.json`:

```json
{ "formatVersion": 1, "id": "2d6f…", "title": "Neon Ratte", "tags": ["ratte", "neon", "final"], "collection": "rauschen",
  "author": "Mo", "status": "approved", "notes": "", "colors": ["#ff2bd6"], "printProfileId": "shirtigo-tee-front",
  "garmentColorIds": ["schwarz", "navy"], "createdAt": "…", "updatedAt": "…", "contentSha256": "…" }
```

Austauschpaket `.cypherpack` = ZIP:

```
cypherpack.json   { "formatVersion": 1, "title": "Drop Oktober", "createdBy": "Mo", "createdAt": "…", "appVersion": "0.3.0",
                    "entries": [{ "relPath": "Motive/neon-ratte.png", "size": 123, "sha256": "…", "kind": "image" }] }
files/<relPath>              # Dateien
meta/<relPath>.json          # Begleitdateien (optional)
```

Import-Regeln: Manifest muss jede Datei mit Hash nennen (keine unbekannten Einträge), Zip-Slip-Schutz (6.6), höchstens 5000 Einträge, höchstens 4 GB entpackt, Ziel nur unterhalb der Bibliothekswurzel.

### 4.7 Druckprofil, Prüfbericht, Begleitdatei

Typen: `PrintProfile`, `PrintReport`, `Finding`, `PrintExportOptions` in `ipc-contract.ts`. Der Katalog enthält je Produkt und Fläche ein Profil (Werte aus vorgaben.md 1.2):

| Profil-ID | Produkt | Fläche | mm | px @ 300 dpi | Verfahren |
|---|---|---|---|---|---|
| `shirtigo-tee-front` | Organic Shirt (Creator 2.0, STTU169) | front | 330 × 450 (sicher 280 × 360) | 3898 × 5315 | dtg, dtf |
| `shirtigo-tee-back` | ← | back | 330 × 450 (sicher 280 × 360) | 3898 × 5315 | dtg, dtf |
| `shirtigo-tee-sleeve-left` / `-right` | ← | sleeveLeft/Right | 100 × 100 | 1181 × 1181 | dtf |
| `shirtigo-tee-back-inside` | ← | backInside | 70 × 50 | 827 × 591 | dtf |
| `shirtigo-hoodie-front` | Organic Hoodie (Cruiser 2.0, STSU177) | front | 330 × 280 | 3898 × 3307 | dtg, dtf |
| `shirtigo-hoodie-back` | ← | back | 330 × 390 | 3898 × 4606 | dtg, dtf |
| `shirtigo-hoodie-sleeve-left` / `-right` | ← | sleeveLeft/Right | 100 × 400 | 1181 × 4724 | dtf |
| `shirtigo-hoodie-back-inside` | ← | backInside | 70 × 50 | 827 × 591 | dtf |

Breiten-Voreinstellungen (Front T-Shirt): Brustemblem 100 mm (max. 150), Brust zentriert 280 mm (Herren 280–300, Damen 240–260), Rücken Schulterhöhe 300 mm. Pixelvergleiche mit ±1 px Toleranz.

Beispielbericht (gekürzt):

```json
{
  "engineVersion": "1.0.0", "analyzedAt": "2026-10-20T12:00:00Z",
  "file": { "name": "ratte.png", "format": "png", "widthPx": 2400, "heightPx": 3200, "bitDepth": 8, "channels": "rgba",
            "interlaced": false, "animated": false, "fileBytes": 4123456 },
  "dpi": { "x": 72, "y": 72, "source": "pHYs" },
  "color": { "profile": "srgb", "iccDescription": "sRGB IEC61966-2.1", "srgbChunk": false },
  "alpha": { "present": true, "transparentShare": 0.61, "opaqueShare": 0.36, "semiShareOfVisible": 0.031,
             "semiAreaShareOfVisible": 0.0042, "ghostPixelCount": 37 },
  "bounds": { "x": 120, "y": 80, "width": 2160, "height": 3010 },
  "marginsPx": { "top": 80, "right": 120, "bottom": 110, "left": 120 },
  "trimmedPx": { "width": 2160, "height": 3010 },
  "profileId": "shirtigo-tee-front", "technique": "dtg", "garment": { "colorId": "schwarz", "underbase": true },
  "placement": { "plannedWidthMm": 280, "plannedHeightMm": 390.2, "effectiveDpi": 196, "maxWidthMmAtTargetDpi": 182.9,
                 "targetPx": { "width": 3307, "height": 4609 }, "fitsPrintArea": true, "fitsSafeArea": false },
  "minStrokePx": null,
  "findings": [
    { "ruleId": "resolution.belowTarget", "severity": "warning", "params": { "effectiveDpi": 196, "targetDpi": 300, "maxWidthMm": 182.9 }, "region": null, "fix": null },
    { "ruleId": "layout.exceedsSafeArea", "severity": "warning", "params": { "heightMm": 390.2, "safeHeightMm": 360 }, "region": null, "fix": null },
    { "ruleId": "alpha.semiTransparent", "severity": "warning", "params": { "share": 0.0042, "warnShare": 0.001, "errorShare": 0.01 },
      "region": { "x": 300, "y": 2600, "width": 1800, "height": 400 }, "fix": "semiTransparency" },
    { "ruleId": "alpha.ghostPixels", "severity": "warning", "params": { "count": 37 }, "region": null, "fix": "cleanGhostPixels" },
    { "ruleId": "color.profileDiffers", "severity": "info", "params": { "from": "srgb", "to": "adobeRgb" }, "region": null, "fix": "colorProfile" },
    { "ruleId": "resolution.metadataMismatch", "severity": "info", "params": { "dpi": 72 }, "region": null, "fix": null }
  ],
  "verdict": "warning"
}
```

Begleitdatei `<name>.shirtigo.json` (Exportart `trimmed`), Feldnamen wie in der Shirtigo-API:

```json
{
  "formatVersion": 1, "provider": "shirtigo", "product": "organic-shirt",
  "processingarea_type": "front", "processingmethod": "dtg",
  "width_mm": 280, "offset_top_mm": 0, "offset_center_mm": 0, "force_position": false,
  "file": "ratte_tee-front_280mm_300dpi.png", "sha256": "…", "widthPx": 3307, "heightPx": 4609,
  "colorProfile": "adobeRgb", "createdBy": "Cypher Studio 0.2.0", "createdAt": "2026-10-20T12:01:00Z"
}
```

### 4.8 Marke, Mockup- und Social-Vorlagen (Team C liefert, Team B rendert)

- `packs/shared/brand/brand.json` = `Brand` ohne URLs. Textilfarben (Kollektion → Druckanbieter, A-16):

| ID | Name | Marke `hex` | `textileHex` (Shirtigo) | `heather` | `underbase` |
|---|---|---|---|---|---|
| `schwarz` | Schwarz | `#141210` | `#201e1f` Black | nein | ja |
| `weiss` | Weiß | `#f2efe8` | `#ffffff` White | nein | **nein** |
| `grau-meliert` | Grau meliert | `#8c8a86` | `#818381` Mid Heather Grey | ja | ja |
| `navy` | Navy | `#1d2738` | `#2f354a` French Navy | nein | ja |
| `sand` | Sand | `#cdbb9a` | `#d5c9bc` Desert Dust | nein | ja |
| `creme` | Creme | `#efe4cc` | `#fcf0dc` Natural Raw | nein | ja |

- `packs/mockups/<id>/template.json` = `MockupTemplate` ohne URLs (Dateinamen statt `AssetUrl`). Bilder 8-bit PNG, Leinwand z. B. 2400 × 3000. **Quelle: eigene Fotos der echten Grundprodukte** (Shirtigo-Musterbox, auf neutralem Grund, ohne Etikett), je Produkt und Ansicht eine helle und eine dunkle Aufnahme (`variants`), daraus `mask`, `shade` (normalisierte Helligkeit), `light`, `displace`; optional CC0-Stoffstruktur (Poly Haven `cotton_jersey`, `knitted_fleece`). Bis Fotos vorliegen: Auffangvorlage aus eigener Vektor-Silhouette mit prozeduraler Schattierung. Keine fremden Mockups, keine Shirtigo-Mockups im Paket (Nutzungsbedingungen ungeprüft).
- `packs/social/<id>/template.json` = `SocialTemplate` ohne URLs. Schriften nur aus `brand.json`; Hilfslinien aus `SOCIAL_GUIDES`.

### 4.9 Blender-Paket: Startszene `cypher_ps2` und Extension „Cypher Export“ (Team C)

Grundlage: `research/3d-konventionen.md` (endgültig, Abstimmung mit dem Shop) und programme.md 2.5/2.6. Code unter `packs/blender/**` ist **GPL-3.0-or-later** (Blender-Python-API; Pflicht für Extensions), eigene `LICENSE` im Ordner.

**App-Template `cypher_ps2`** (`scripts/startup/bl_app_templates_user/cypher_ps2/`): erscheint unter Datei → Neu, Start per `--app-template cypher_ps2`, verändert die persönliche Startdatei nicht.
- `build_startup.py` erzeugt `startup.blend` reproduzierbar: `blender -b --factory-startup --python build_startup.py -- --out startup.blend` (CI prüft, dass die eingecheckte Datei dem Skript entspricht, über einen JSON-Fingerabdruck der Szene).
- Szene: Einheiten metrisch, Maßstab 1; Sammlungen `Export` (wird exportiert) und `Referenz` (Menschgröße 1,75 m, Bodenraster, Shop-Kamera als Ansicht, nie exportiert); Farbverwaltung „Standard“ (Texturen und Vertexfarben unverfälscht); Beispielmaterial „Cypher Basis“ (Basisfarbe × Vertexfarbe, optional Emission für Neon), Texturfilter linear (PS2, kein nearest); Palette der Marke für Texturmalen; EEVEE-Vorschau mit Nebel als Stimmung.
- `__init__.py`: Handler `load_factory_startup_post` setzt Ansichts- und Snap-Voreinstellungen; keine Netzwerkzugriffe, keine Dateisystemzugriffe außerhalb Blenders.

**Extension `cypher_export`** (`packs/blender/cypher_export/`, `blender_manifest.toml`: `id = "cypher_export"`, `blender_version_min = "4.2.0"`, `license = ["SPDX:GPL-3.0-or-later"]`, `permissions.files = "glTF und Texturen exportieren"`):
- Seitenleiste „Cypher“ im 3D-Viewport: Präfix-Wahl (`prop-`, `furn-`, `prod-`, `fig-`, `room-`) und Live-Prüfung gegen `budgets.json`: Dreiecke (ausgewertet, mit Modifikatoren), Materialien ≤ 2, nur Basisfarbe/Emission, Alpha nur `MASK`, Texturen Potenz von 2 und ≤ 512 px (Standard 128–256), UV vorhanden, Transformationen angewendet, keine Kameras/Lichter in der Auswahl, Ursprung am Boden mittig. Ampel je Prüfung (Form + Wort, wie DESIGN.md).
- Operator `cypher.export_glb`: Prüfen → Texturen als temporäre Kopien auf Budget verkleinern → `bpy.ops.export_scene.gltf(export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_cameras=False, export_lights=False, export_draco_mesh_compression_enable=False, …)` → **Nachbearbeitung der GLB** (reines Python, `struct` + `json`): Bilder aus dem BIN-Chunk lösen, als `<name>-basis.webp` (bzw. weitere Maps) neben die `.glb` schreiben, `bufferView` durch relative `uri` ersetzen, BIN-Chunk neu packen (4-Byte-Ausrichtung) – nötig, weil die Shop-CSP `blob:`-Bilder blockiert. Danach `<name>.lizenz.json` (`{name, autor, lizenz, lizenzUrl, quelle}`) anlegen, falls nicht vorhanden. Bericht als Dialog.
- Kein Draco, kein Meshopt, kein KTX2; `KHR_mesh_quantization` erlaubt, aber nicht nötig.
- Asset-Bibliothek: Beim Aktivieren liest die Extension `cypher_studio.json` aus `bpy.utils.extension_path_user(__package__, create=True)` (von der Einrichtung geschrieben, Baustein `assetLibrary`) und legt die Bibliothek „Cypher 3D“ → `<Bibliothek>/3D` an, falls noch nicht vorhanden; beim Deaktivieren nur diesen Eintrag entfernen (Smoke-Test 9.4 in programme.md).
- `budgets.json` (Pfad laut 3d-konventionen.md, Änderungen ohne Code):

```json
{
  "formatVersion": 1,
  "prefixes": { "prop-": { "maxTris": 500 }, "furn-": { "maxTris": 1500 }, "prod-": { "maxTris": 1500 },
                "fig-": { "maxTris": 4000 }, "room-": { "maxTris": 15000 } },
  "scene": { "mobileMaxTris": 45000, "desktopMaxTris": 120000, "mobileMaxDrawCalls": 90, "desktopMaxDrawCalls": 180 },
  "textures": { "powerOfTwo": true, "defaultPx": 256, "maxPx": 512, "format": "webp", "embed": false, "filter": "linear-mipmap" },
  "materials": { "max": 2, "channels": ["baseColor", "emission"], "alphaMode": "MASK", "vertexColors": "erwünscht" },
  "export": { "draco": false, "meshopt": false, "ktx2": false, "cameras": false, "lights": false, "upAxis": "+Y", "units": "m" },
  "loadBudget": { "firstSceneBytes": 2000000, "perWorldBytes": 1500000, "totalBytes": 5000000 }
}
```

- Tests (`packs/blender/tests/run.py`, headless mit leerem `BLENDER_USER_RESOURCES`, gegen Blender 4.5 LTS und 5.2 LTS): Budgetzählung an Testmodellen, Export → GLB enthält keine eingebetteten Bilder, `uri` zeigt auf existierende `.webp`, keine Kameras/Lichter, Dreieckszahl wie gemeldet; zweimaliger Export erzeugt identische Dateien.

---

## 5. Abläufe

### 5.0 App-Start

1. `single-instance`: zweiter Start fokussiert das vorhandene Fenster.
2. `AppDirs::discover`, Logging (lokal), `SettingsStore::load`, `StateStore::load` (Migration).
3. Recovery: `install::recover_on_startup`, `setup::recover`, verwaiste `.part` älter als 14 Tage löschen.
4. `CatalogStore::load_startup` (Embedded vs. Cache, höchste gültige `sequence`).
5. Fenster zeigt sofort die Startseite (Daten aus Speicher, Erkennung läuft noch: Skeleton-Zustand).
6. Hintergrund: `detect_all` → `programs:changed`; `catalog.refresh` (wenn `autoRefresh`); nach 10 s Update-Prüfung (gemäß `updates.frequency`: täglich/wöchentlich/nie, gemessen an `lastCheckAt`) → ggf. `update:available`; Bibliothek öffnen + Watcher.

### 5.1 Programm installieren

```mermaid
sequenceDiagram
    actor N as Nutzer
    participant F as Frontend
    participant T as src-tauri (commands)
    participant K as cypher-core
    N->>F: „Blender installieren“
    F->>T: install_preview({programId:"blender"})
    T->>K: catalog.release_for(os, arch) · free_space · PlanStore.insert
    T-->>F: InstallPlan (Quelle, Version, Größe, sha256, Signatur, Lizenz, Zielordner, Hinweise)
    F->>N: Vorschau-Dialog mit Lizenz-Link
    N->>F: „Installieren“
    F->>T: install_start({planId, consent}, onEvent)
    T->>K: PlanStore.take · Zustimmung = Plan? · JobRegistry.start
    T-->>F: started{jobId}
    K->>K: download (Hostliste, Resume, Retry)  ──► downloadProgress*
    K->>K: sha256 == Katalog?  ──► phase(verifyChecksum)
    K->>K: [PGP-Signatur vom Hauptquellen-Host]  ──► verified
    K->>K: entpacken → staging/<jobId> (Zip-Slip, Limits)  ──► extractProgress*
    K->>K: Inhalt prüfen (exe, macOS codesign/spctl, AppImage chmod)
    K->>K: atomar umbenennen → programs/blender/5.2.2 · state.json
    T-->>F: finished{installation}  + Event programs:changed
    F->>N: „Fertig. Cypher-Einrichtung jetzt anwenden?“ → 5.2
```

Abbruch- und Fehlerzustände:

| Phase | Abbruch/Fehler | Danach liegt |
|---|---|---|
| Download | Abbruch | `.part` + `.part.json` (Fortsetzen möglich), kein Staging |
| Download | Netzwerkfehler nach 4 Versuchen | wie Abbruch, Fehler `network` |
| Prüfung | `checksumMismatch`/`signatureInvalid`/`sizeMismatch` | **nichts**: `.part` gelöscht, Sicherheitswarnung, Log-Eintrag mit beiden Hashes |
| Entpacken | Abbruch oder `archiveUnsafeEntry` | Staging-Ordner gelöscht; geprüftes Archiv im Cache (nur wenn `keepCache`) |
| Inhaltsprüfung | `installVerificationFailed` | Staging gelöscht |
| Registrierung | Absturz zwischen Rename und `state.json` | Recovery beim nächsten Start: Ordner + Journal vorhanden → Registrierung nachholen |
| Ersetzen einer alten Version | Absturz | `.old-<ts>` wird zurückbenannt, wenn das Ziel fehlt, sonst gelöscht |

Abschluss-Angebot: Hat das Programm ein Paket und der neue Scope den Status `notApplied`, zeigt das Frontend direkt die Einrichtungsvorschau an (`setup_preview`). Die Vorschau startet nicht automatisch.

### 5.2 Einrichtung anwenden und rückgängig machen

```mermaid
sequenceDiagram
    actor N as Nutzer
    participant F as Frontend
    participant T as src-tauri
    participant S as setup
    F->>T: setup_packs_list()
    T-->>F: SetupSummary[] (Scopes je Paket, Status)
    N->>F: „Krita einrichten“ (Scope Benutzerprofil)
    F->>T: setup_preview({packId:"krita", scopeId})
    T->>S: resolve_scopes · plan (Hash-Vergleich je Datei) · laufende Krita-Prozesse?
    T-->>F: SetupPlan (Bausteine mit Status, Konflikte, programRunning)
    F->>N: Tabelle der Bausteine (aktuell/neu/veraltet/von dir geändert), Konflikt je Zeile: Überschreiben · Daneben ablegen
    N->>F: Auswahl + „Einrichtung anwenden“ (Strg+Enter)
    F->>T: setup_apply({planId, components, resolutions}, onEvent)
    S->>S: Journal anlegen → je Datei: Sicherung (falls nötig) → write_atomic → Journal fortschreiben
    S->>S: Aktionen (installFont, blenderExtensionInstall) → Manifest schreiben → Journal löschen
    T-->>F: finished{record} + Event programs:changed
    Note over N,S: Rückgängig
    N->>F: „Einrichtung entfernen“
    F->>T: setup_undo({setupId})
    S->>S: eigene Dateien (Hash unverändert) löschen · Sicherungen zurück · Schriften (Referenzzählung) · Extension deinstallieren
    T-->>F: UndoReport (keptModified)
```

Idempotenz-Test (Pflicht, 8.1): `apply` zweimal → zweiter Plan nur `skip`; `apply` → `undo` → Zielbaum Hash-identisch zum Ausgangszustand (Fixture-Profil mit vorhandenen Nutzerdateien).

Programmspezifisch:
- **Krita**: `bundles/cypher.bundle` (Paletten, Arbeitsfläche), Vorlagen (`templates/Cypher/…`), Schriften in `fonts/cypher/`. Krita synchronisiert Ressourcen beim Start → Hinweis „Krita neu starten“. Export-Voreinstellung: Vorlage enthält 300 dpi; PNG-Exportoptionen bleiben Krita-Standard (kein Eingriff in `kritarc`). Achtung: Die Krita-ZIP teilt Einstellungen mit einer installierten Krita (gleicher Scope).
- **Inkscape**: Schriften in `fonts/` (Windows/macOS: nach Neustart sichtbar), `palettes/*.gpl`, `templates/*.svg` (Shirt 330 × 450 mm mit Hilfslinie der sicheren Fläche 280 × 360 mm, Hoodie 330 × 280 mm, je mit `inkscape:export-xdpi="300"`; Post/Story in px). Kein Eingriff in `preferences.xml`.
- **Blender**: App-Template `cypher_ps2` (Startszene, 4.9) + Extension `cypher_export` per Blender-CLI + Asset-Bibliothek `<Bibliothek>/3D` (Baustein `assetLibrary`). Bei Cypher-Installationen (Windows/Linux) liegt die Konfiguration im `portable/`-Ordner der Installation (isoliert von einer System-Blender-Konfiguration). Konfiguration hängt an Major.Minor (`5.2`): eine neue Serie ist ein neuer Scope mit Status `notApplied` → UI bietet die Einrichtung erneut an.
- **Kdenlive**: Titelvorlagen mit Cypher-Schriften (`titles/*.kdenlivetitle`), MLT-Projektprofile 1080 × 1920 und 1080 × 1350 bei 30 fps (`profiles/`, Textdateien ohne Endung); Reel-Projektvorlage als Cypher-Projektvorlage. Render-Presets erst nach Smoke-Test (Ort unklar, A-14).
- **Schriften** (Paket `fonts`): Benutzerschriften ohne Admin (7.1–7.3).

### 5.3 Druckdatei prüfen und exportieren

```mermaid
sequenceDiagram
    actor N as Nutzer
    participant F as Frontend
    participant T as src-tauri
    participant P as printcheck
    N->>F: Datei ziehen / wählen / aus Bibliothek
    F->>T: (files:dropped | file_pick | library_entry_handle) → FileHandleInfo
    N->>F: Produkt + Fläche (Profil), Textilfarbe, Verfahren, geplante Breite (Voreinstellung)
    F->>T: printcheck_analyze({handleId, profileId:"shirtigo-tee-front", garmentColorId:"schwarz", plannedWidthMm:280})
    T->>P: read_meta → decode (spawn_blocking) → analyze
    T-->>F: PrintReport
    F->>N: Ampel + Befunde (deutsche Texte aus ruleId/params) + Vorschau mit Druck- und Sicherheitsfläche (CSS-Overlay)
    opt Problemstellen ansehen
      F->>T: printcheck_overlay({handleId, profileId, overlay:"semiTransparent"}) → Handle → <img>
    end
    N->>F: „Für Shirtigo exportieren“ (Exportart, Korrekturen, Farbprofil, Ziel)
    F->>T: printcheck_export({handleId, profileId, garmentColorId, options}, onEvent)
    T->>P: Korrekturen → Zuschnitt/Leinwand → Lanczos3 (vormultipliziert) → Profil umrechnen (moxcms) → PNG (300 dpi, iCCP)
    T->>P: Ausgabe erneut analysieren · Begleitdatei schreiben
    T-->>F: PrintExportResult (Handle, Pixelmaße, Bericht der Ausgabe, Begleitdatei)
```

Geometrie: Zielbreite in Pixel = `round(plannedWidthMm / 25.4 × 300)` (280 mm → 3307 px), Höhe aus dem Seitenverhältnis von `bounds`. Ohne `allowUpscale` wird nie vergrößert: ist das Motiv zu klein, bietet die UI an, die geplante Breite auf `maxWidthMmAtTargetDpi` zu senken, oder empfiehlt, das Motiv in Zielgröße neu anzulegen bzw. als Vektor (Inkscape) zu exportieren, denn Hochskalieren erzeugt keine Details. `fullArea` legt eine transparente Leinwand der ganzen Fläche (3898 × 5315) an und setzt das Motiv an `offsetTopMm`/`offsetCenterMm`. Dateiname: `<name>_<produkt>-<fläche>_<breite>mm_300dpi.png`.

### 5.4 Mockup rendern

**Entscheidung: Canvas 2D im WebView, Rechenteil im Web Worker mit OffscreenCanvas. Kein three.js für Mockups.**

Begründung:
- Flatlay-Mockups aus Fotos sind 2D-Ebenenarbeit (Maske, Schatten, Glanz, Verzerrung). Das ist mit Canvas 2D (`globalCompositeOperation: multiply | screen | soft-light | destination-in`) plus einer Verschiebungs-Map in typed arrays vollständig lösbar, und die Recherche empfiehlt genau diesen Weg mit **eigenen Fotos** (vorgaben.md 4.3).
- three.js bräuchte ein 3D-Textilmodell; es gibt **kein CC0-Shirt/Hoodie in Mockup-Qualität** (vorgaben.md 4.1), und der Shop nutzt bewusst kein gemeinsames Mesh (`research/3d-konventionen.md` Punkt 9). Dazu ca. 600 KB mehr Code, GPU-abhängige Ergebnisse und wackelige WebGL-Unterstützung in WebKitGTK auf manchen Linux-GPUs.
- Canvas 2D ist auf allen drei WebViews stabil, deterministisch genug für Screenshot-Tests, und die Engine ist reines, testbares TS.
- three.js bleibt für eine spätere **glTF-Vorschau** der Blender-Exporte (Phase 5) vorgesehen, dort ist 3D der Zweck.

Pipeline (`features/mockup/engine/`, alles im Worker):
1. Laden: Vorlagen-Ebenen über `cyasset`-URLs, Motiv über `cyfile`-URL (`fetch` → `createImageBitmap`; die Protokolle senden CORS-Header, sonst wäre die Leinwand „tainted“ und `convertToBlob` scheitert).
2. Variante wählen: `variants[].colorIds` enthält die Textilfarbe (Schwarz/Navy → `dark`, sonst `light`).
3. Motiv-Ebene: Größe aus `placement.widthMm` über das Druckprofil (mm → Pixel der Vorlage über das Quad), Lage aus `offsetTopMm`/`offsetCenterMm`, affin per `setTransform` (Quad ist ein Parallelogramm, Frontalaufnahmen).
4. Verzerrung: `getImageData` der Motiv-Ebene, je Pixel bilineare Abtastung an `(x − dx, y − dy)`, `dx = (R − 128) / 127 × displaceStrengthPx`; Kanten danach leicht weichzeichnen (0,5 px).
5. Stoff: `textileHex` füllen, mit `mask` per `destination-in` beschneiden; `heather`/`texture` per `soft-light`.
6. Motiv auf Stoff (`source-over`), dann `shade` per `multiply` über Stoff und Motiv (Falten wirken auf den Druck), dann `light` per `screen`.
7. Hintergrund (transparent/Farbe/Vorlage), Ausgabe `convertToBlob({type: "image/png"})` → `export_save_image`.
8. Grenzen: Leinwand ≤ 3000 × 3750 px (≈ 11 MP, unter den Canvas-Grenzen von WKWebView); Vorschau im Editor in halber Auflösung, Export in voller.

### 5.5 Social-Bild erzeugen

1. `social_templates_list` + `brand_get` → Schriften per `FontFace` aus `cyasset`-URLs laden, `await document.fonts.ready` (im Worker: `self.fonts`).
2. Projekt anlegen (`project_create` mit Social-Vorlage) oder öffnen (`project_read_document`).
3. Editor: Text-Slots, Bild-Slots (Handle → `project_add_asset`), Fokuspunkt, Farben aus der Palette; Hilfslinien aus `SOCIAL_GUIDES` (konservativ: oben 270, unten 672, seitlich 120 px; Reel-Cover-Rasterbox y 240–1680; 4:5-Post x 34–1046).
4. Layout-Engine (reines TS, Vitest-getestet): je Text-Ebene Schriftgröße per Binärsuche zwischen `minSizePx` und `sizePx`, Zeilenumbruch an Wortgrenzen (`Intl.Segmenter("de", {granularity: "word"})`), weiche Trennstriche (`­`) werden respektiert, danach Kürzung mit „…“ bei `maxLines`. Warnung, wenn Text oder Pflicht-Bild die Hilfslinien schneidet.
5. Zeichnen in Ebenen-Reihenfolge (sRGB-Leinwand); Hilfslinien nur im Editor.
6. Speichern: `project_write_document` (entprellt 1 s); Export in Zielgröße (kein Nachskalieren durch Instagram): PNG für Grafik/Text, JPEG Qualität 0,90 für Fotos, via `export_save_image`.

### 5.6 Projekt anlegen, Datei aus Vorlage, öffnen

1. Start → [Neues Projekt ⌃N] → `project_create({name, collection})` → Ordner + `projekt.json` → Event `projects:changed`.
2. Formatleiste → Vorlage wählen → Popover „Name · Projekt“ → `project_new_file({projectId, templateId, fileName})` → Datei im passenden Unterordner (nie überschreiben) → `project_open_file` → Programm startet mit der Datei (Blender-Vorlage zusätzlich `--app-template cypher_ps2`) bzw. Modul-Editor öffnet. Fehlt das Programm: `outcome.kind = "programMissing"` → Frontend bietet die Installation an (5.1).
3. Projektzeile `Strg+Enter` → `project_open_last`. `Enter` → Bibliothek mit `LibraryQuery.projectId`.
4. Export eines Moduls landet in `Export/Druck/` bzw. `Export/Social/`; `library:changed` aktualisiert Listen.

### 5.7 App-Update (Tauri-Updater)

```mermaid
sequenceDiagram
    participant U as tauri-plugin-updater
    participant T as src-tauri/updater.rs
    participant F as Frontend
    actor N as Nutzer
    T->>U: (Start + 10 s, wenn laut updates.frequency fällig) check()
    U->>U: latest.json von Endpunkt 1, sonst 2 (A-07)
    U-->>T: Update { version, notes, date }
    T-->>F: Event update:available
    F->>N: Banner „Version x verfügbar“ + Notizen
    N->>F: „Jetzt aktualisieren“
    F->>T: app_update_install(onEvent)
    T->>T: Jobs aktiv? → busy · state/settings sichern
    T->>U: download_and_install(on_chunk, on_finish) – prüft minisign-Signatur mit eingebettetem Updater-Pubkey
    U-->>F: started / progress* / installing
    U->>U: Windows: NSIS passive (App beendet sich) · macOS: .app ersetzen · Linux: AppImage ersetzen
    T->>T: app.restart()
```

Release-Seite: Tag `v*` → `release.yml` (`tauri-apps/tauri-action@v1`, Option `uploadUpdaterJson`) baut Windows (NSIS, x64, `windows-latest`, MSVC), macOS (arm64 auf `macos-latest`, x64 auf `macos-15-intel`, je `.dmg` + `.app.tar.gz`, ad-hoc in `tauri.macos.conf.json`), Linux (AppImage + `.deb` + `.rpm` auf `ubuntu-22.04`), signiert die Updater-Artefakte mit `TAURI_SIGNING_PRIVATE_KEY` (GitHub-Secret im Environment `release` mit Pflicht-Freigabe), erzeugt `latest.json` (Plattformschlüssel `windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`) und einen **Entwurf** des Releases. Ein Mensch veröffentlicht. Danach kopiert `site.yml` Installer und `latest.json` nach `studio.cypherxcypher.de/releases/` (Dateigrenze von Workers Static Assets 25 MiB, CI bricht bei > 24 MiB ab). Achtung: tauri-action v1 schreibt in `latest.json` GitHub-API-Asset-URLs; für den Endpunkt auf `studio.cypherxcypher.de` erzeugt `site/scripts/gen-release-json.mjs` eine eigene `latest.json` mit Site-URLs (gleiche Signaturen). `.deb`/`.rpm` aktualisieren über `pkexec` (Passwortabfrage).

### 5.8 Katalog-Update (ohne App-Update)

Pflege (Mensch + CI, keine Schlüssel in CI):
1. `catalog.yml` (wöchentlich + manuell) ruft `cypher catalog build catalog/sources.json` auf: Versionsermittlung laut Rezept (Verzeichnislisten von download.blender.org/download.kde.org, `/dl/`-Seite bei Inkscape, GitHub-API bei Audacity), Download neuer Artefakte, offizielle Prüfsummendatei (`checksumSource`) holen, SHA-256 berechnen und vergleichen, PGP-Signaturen gegen die gepinnten Schlüssel prüfen; Gegenprobe gegen winget-/Scoop-Manifeste (nur Warnung bei Abweichung). Ergebnis: **unsignierter** Kandidat mit `sequence + 1` als PR.
2. Verantwortliche Person prüft den PR und führt lokal aus: `cypher catalog check catalog/catalog.json` (Schema, Hosts, Größen per HEAD, optional `--download` mit Hashvergleich), dann `minisign -S -m catalog/catalog.json -s <offline-schlüssel> -t "cypher-catalog seq=<n>"`, committet `catalog.json.minisig`.
3. CI prüft die Signatur gegen `catalog/keys/*.pub`; nach Merge kopiert `site.yml` beides nach `studio.cypherxcypher.de/catalog/v1/`.
4. Jede App-Version bettet den Katalog von `main` ein (Fallback).

Client:

```mermaid
sequenceDiagram
    participant T as src-tauri
    participant C as CatalogStore
    participant H as HttpClient
    T->>C: refresh() (Start, wenn autoRefresh, oder Knopf „Katalog aktualisieren“)
    C->>H: GET catalog.json + catalog.json.minisig (URL 1, sonst URL 2), je ≤ 2 MB
    C->>C: minisign prüfen (eingebettete Schlüssel) → JSON parsen → validate (Schema, Hostliste ⊇ URLs, minAppVersion)
    alt sequence > aktuell
        C->>C: Cache atomar schreiben · highest_seen in state.json · ArcSwap
        C-->>T: changed → Events catalog:updated, programs:changed
    else sequence == aktuell
        C-->>T: unverändert
    else sequence < highest_seen
        C-->>T: catalogRollback (Remote verworfen)
    end
```

Schlüssel (abweichend von CONCEPT.md 10, das den Updater-Schlüssel nennt; plattform.md empfiehlt getrennte Schlüssel je Zweck): Katalog-Schlüsselpaar wird **offline** von der verantwortlichen Person erzeugt (`minisign -G`, Passwort), Sicherung bei einer zweiten Person. Zwei öffentliche Schlüssel sind eingebettet (aktiv + Reserve), damit ein Schlüsselwechsel ohne Sackgasse möglich ist. Der Updater-Schlüssel ist ein **anderes** Paar. In diesem Dokument werden keine Schlüssel erzeugt.

### 5.9 Bibliothek einrichten und teilen

1. Einstellungen/Erststart → „Ordner wählen“ → `library_choose_root` (nativer Dialog) → `LibraryRootCandidate` („3.104 Dateien · 41 GB · 12 Projekte gefunden“, erkanntes Sync-Werkzeug, Probleme) → [Diesen Ordner nutzen] → `library_use_root({candidateId, initialize})` legt bei Bedarf `.cypher/` und Standardordner an.
2. Hinweis im UI: „Cypher Studio synchronisiert nicht selbst. Nutzt einen Ordner von Syncthing, Nextcloud oder einem ähnlichen Dienst.“
3. `library_scan` indiziert (Auftrag mit Fortschritt), der Watcher hält den Index aktuell; Konfliktkopien werden markiert.
4. Austausch ohne Sync: Auswahl → `library_pack_export` → `.cypherpack`; Empfänger: `file_pick({purpose:"packImport"})` → `library_pack_inspect` (neu/identisch/Konflikt) → `library_pack_import` mit Konfliktpolitik.
5. Blender: Das Paket `blender` schreibt eine kleine Konfigurationsdatei für die Extension `cypher_export`, die beim Aktivieren `<Bibliothek>/3D` als Asset-Bibliothek in Blender einträgt (Baustein `assetLibrary`, umkehrbar, kein Eingriff in `userpref.blend` von außen).

---

## 6. Sicherheitsmodell

### 6.1 Tauri-Capabilities (minimal je Fenster)

Es gibt ein Fenster (`main`). Das Frontend bekommt **nur** Event-Abonnement und die eigenen Commands. Dialog, Opener, Updater und Prozess-Plugin werden ausschließlich aus Rust benutzt und erhalten keine JS-Rechte. `build.rs` registriert alle App-Commands über `AppManifest`, dadurch braucht jeder Command eine ausdrückliche Freigabe.

`apps/desktop/src-tauri/capabilities/main.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main",
  "description": "Hauptfenster: Events abonnieren und Cypher-Commands aufrufen, sonst nichts.",
  "windows": ["main"],
  "permissions": [
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "allow-app", "allow-settings", "allow-catalog", "allow-programs", "allow-install", "allow-launch",
    "allow-setup", "allow-files", "allow-projects", "allow-library", "allow-printcheck", "allow-brand",
    "allow-updater", "allow-jobs"
  ]
}
```

`apps/desktop/src-tauri/permissions/sets.toml` (Auszug; die einzelnen `allow-<command>`-Rechte erzeugt `tauri-build`):

```toml
[[set]]
identifier = "allow-install"
description = "Installationsvorschau, Installation, Entfernen"
permissions = ["allow-install-preview", "allow-install-start", "allow-installation-remove"]
```

Phase 0 prüft, dass Channels und `invoke` ohne `core:default` funktionieren; fehlende Kern-Rechte werden einzeln ergänzt und hier dokumentiert. `bgremove`-Commands bekommen ein eigenes Set, das nur mit dem Cargo-Feature in die Capability kommt.

### 6.2 Content Security Policy

`app.security.csp` (Produktion):

```
default-src 'none';
script-src 'self';
style-src 'self';
style-src-attr 'unsafe-inline';
img-src 'self' data: blob: cyfile: cythumb: cyasset: http://cyfile.localhost http://cythumb.localhost http://cyasset.localhost;
font-src 'self' cyasset: http://cyasset.localhost;
connect-src ipc: http://ipc.localhost cyfile: cyasset: http://cyfile.localhost http://cyasset.localhost;
worker-src 'self' blob:;
media-src 'self' cyfile: http://cyfile.localhost;
object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'
```

- `script-src` ohne `unsafe-inline`/`unsafe-eval`. Tauri ergänzt Hashes/Nonces für die gebündelten Skripte.
- `style-src-attr 'unsafe-inline'` erlaubt nur `style`-Attribute (React `style={{…}}`), keine `<style>`-Elemente. Regel für Team B: keine CSS-in-JS-Bibliothek. Radix-Primitives (DESIGN.md 10) sind gesetzt; Bausteine, die zur Laufzeit `<style>`-Elemente einfügen (z. B. Scroll-Sperre modaler Dialoge), werden durch den CSP-Test entdeckt und dann ersetzt (Modal über natives `<dialog>` mit `showModal()`, Fokusfalle bleibt bei Radix `FocusScope`, Scroll-Sperre per CSS `body:has(dialog[open])`). Ein Playwright-Test lädt den Produktions-Build mit der Produktions-CSP und schlägt bei jedem `securitypolicyviolation`-Ereignis fehl. Nur falls eine unverzichtbare Bibliothek das braucht: `style-src-elem 'unsafe-inline'` als dokumentierte Ausnahme (ADR).
- Kein einziger Fremd-Ursprung. Schriften und Bilder kommen aus dem Bundle oder den eigenen Protokollen.
- `devCsp` erlaubt zusätzlich `ws://localhost:1420` und `'unsafe-inline'` für Skripte (Vite-HMR-Präambel), nur im Dev-Build.
- `freezePrototype: true`, kein `withGlobalTauri`.

### 6.3 Eigene URI-Protokolle

| Schema | Liefert | Prüfung |
|---|---|---|
| `cyfile://localhost/<handleId>` | Bilddateien hinter registrierten Handles; TIFF/16-bit/große Bilder als zwischengespeicherte PNG-Vorschau (max. 4096 px) | Handle existiert; MIME per Inhalt ∈ {png, jpeg, webp, gif}; **kein SVG** (SVG nur gerastert über `resvg`) |
| `cythumb://localhost/<entryId>` | Vorschaubilder der Bibliothek aus dem Cache | Eintrag existiert |
| `cyasset://localhost/<pfad>` | Paket-Assets (Mockups, Social, Marke, Schriften, Vorschaubilder der Vorlagen) | `ensure_within(<resources>/packs, pfad)` und Whitelist der Unterordner |

Antwort-Header: `Content-Type`, `X-Content-Type-Options: nosniff`, `Access-Control-Allow-Origin: <App-Origin>` (`tauri://localhost` bzw. `http://tauri.localhost`), `Cache-Control: no-store` (cyfile) bzw. `max-age=86400` (cyasset). Unbekanntes → 404 ohne Details. Unter Windows lauten die URLs `http://<schema>.localhost/…`; Rust baut die URL passend zum OS (`protocols::url(scheme, path)`), das Frontend benutzt sie unverändert.

### 6.4 Keine Fernausführung von Code

- Der Katalog ist reines JSON ohne Ausdrücke, Skripte oder Pfade für Schreibziele; `launch.args` sind per Muster auf einfache Flags beschränkt.
- Einrichtungspakete und Blender-Python liegen im signierten App-Bundle; Paketdateien werden beim Laden gegen ihre im Bundle hinterlegten Hashes geprüft.
- Ausgeführt werden nur: verifizierte Programme beim Start durch den Nutzer, festgelegte Systemwerkzeuge (6.7) und Blender für die Extension-Installation.
- Das Frontend lädt keinen Remote-Inhalt (CSP), `dangerouslySetInnerHTML` ist per ESLint-Regel verboten, Release-Notizen werden als Text dargestellt.

### 6.5 Downloads

1. **Hostliste im Binary** (4.2), exakter Hostvergleich, nur `https`, Port 443; der Katalog kann die Liste nicht erweitern.
2. **Redirect-Prüfung** bei jedem Sprung (eigene `reqwest::redirect::Policy`).
3. **Prüfsumme immer von der Hauptquelle**: Die SHA-256 im Katalog stammt aus der offiziellen Prüfsummendatei des Projekts (CI vergleicht sie mit dem selbst berechneten Wert), nie von einem Spiegel. Signaturdateien werden direkt von der Hauptquelle geladen.
4. **Signatur zusätzlich**, wenn das Projekt signiert (PGP mit rPGP, Schlüssel und Fingerprints im signierten Katalog).
5. **Größe festgenagelt** (`size`), Abbruch bei Überschreitung; Entpack-Limits gegen Archivbomben.
6. **TLS** mit rustls und Zertifikatsspeicher des Systems, keine Abschaltung der Zertifikatsprüfung (auch nicht per Einstellung).
7. **Zustimmung vor jedem Download** von Programmen oder Modellen (Plan, 5.1).

### 6.6 Pfad-Validierung

`fsx::safe_join(base, rel)` und `archive::sanitize_entry` lehnen ab:
- absolute Pfade, Laufwerks- und UNC-Präfixe (`C:`, `\\server`, `\\?\`), führendes `/` oder `\`;
- Komponenten `..` und `.` (nach Normalisierung von `\` zu `/`), leere Komponenten;
- NUL, Steuerzeichen, `:` (Windows-ADS), `* ? " < > |`;
- reservierte Windows-Namen (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, auch mit Endung), Komponenten mit Punkt/Leerzeichen am Ende;
- Komponenten > 240 Byte; Duplikate nach Unicode-NFC und (Windows/macOS) Groß-/Kleinschreibung.

Beim Entpacken: Ziel nur innerhalb des Staging-Ordners; Dateien mit `create_new`; Symlinks nur mit `allow_symlinks` und nur, wenn das Ziel relativ zum Link-Ordner innerhalb des Staging-Ordners bleibt; Hardlinks, Geräte, FIFOs → `archiveUnsafeEntry`. Vom Nutzer gewählte Ordner (Programme, Projekte, Bibliothek): kein Systemordner (`C:\Windows`, `%ProgramFiles%`, `/System`, `/usr`, `/etc`, `/` …), Bibliothek nicht innerhalb des App-Datenordners, Schreibprobe mit Temp-Datei.

### 6.7 Prozesse

Nur `std::process::Command` mit absolutem Programmpfad und Argumentliste, nie eine Shell. Erlaubte Systemwerkzeuge: macOS `/usr/bin/hdiutil`, `/usr/bin/ditto`, `/usr/bin/codesign`, `/usr/sbin/spctl`, `/usr/bin/open`, `/usr/bin/mdfind`, `/usr/sbin/sysctl`; Linux `flatpak`, `snap`, `fc-cache`, `ldconfig` (einmal per `which` aufgelöst, Pfad geloggt); Windows keine (Registry über `winreg`, Schriften über Win32-API). Jeder Aufruf mit Timeout und bereinigter Umgebung (2.9).

### 6.8 Netzwerk-Inventar, keine Telemetrie

| Ziel | Wann | Abschaltbar |
|---|---|---|
| `studio.cypherxcypher.de/catalog/v1/…` (Fallback `raw.githubusercontent.com`) | Start, Knopf | ja (`catalog.autoRefresh`) |
| `studio.cypherxcypher.de/releases/latest.json` (Fallback GitHub Releases) | Start + 10 s (täglich/wöchentlich), Knopf | ja (`updates.frequency = never`) |
| Hosts aus 4.2 für Artefakte/Signaturen | nur nach Zustimmung | – |

Die Liste kommt zur Laufzeit aus `network_info` (Endpunkte + letzte Anfragen) und steht in Einstellungen → „Netzwerk und Daten“; der Test „Netzwerkprotokoll eines kompletten Erststarts = Liste in den Einstellungen“ (DESIGN.md) prüft das. Sonst nichts: keine Telemetrie, keine Absturzberichte nach außen, keine Schriften/Bilder aus dem Netz, User-Agent ohne Kennung (`CypherStudio/<version>`). „Diagnose exportieren“ erzeugt eine ZIP-Datei, die der Nutzer selbst weitergibt.

### 6.9 Fehler- und Abbruchzustände

- Jeder lange Vorgang ist ein Job mit `CancellationToken`; Abbruch ist in jeder Phase möglich und hinterlässt einen definierten Zustand (Tabelle 5.1, Journal bei Einrichtung).
- Fenster schließen bei laufenden Jobs → Nachfrage (`app:closeRequested`), „Trotzdem beenden“ bricht sauber ab (max. 5 s Aufräumen).
- Absturzfest: alle Zustandsdateien atomar; Recovery beim Start (5.0).
- Fehler werden lokal geloggt (ohne Dateiinhalte), dem Nutzer verständlich erklärt (3.6) und nie verschluckt.
- Sicherheitsrelevante Fehler (`checksumMismatch`, `signatureInvalid`, `hostNotAllowed`, `archiveUnsafeEntry`) erscheinen als eigene, nicht wegklickbare Warnung mit Erklärung, nie als Toast.

### 6.10 Lieferkette und Schlüssel

- `Cargo.lock` und `package-lock.json` eingecheckt; CI nutzt `npm ci` und `cargo --locked`.
- `cargo deny check` (Lizenzen nach Allowlist, Advisories, gesperrte Crates wie `openssl-sys`, nur crates.io als Quelle); npm-Lizenzcheck (`scripts/license-check.mjs`) mit derselben Allowlist; GPL/LGPL/AGPL in App-Abhängigkeiten verboten.
- GitHub Actions auf Commit-SHA gepinnt; Dependabot wöchentlich, gruppiert.
- Schlüssel: Katalog offline (Mensch), Updater als GitHub-Secret im geschützten Environment; kein Schlüssel im Repo, keine Schlüssel in diesem Dokument.
- Vor der ersten öffentlichen Veröffentlichung: einmaliger Sicherheitscheck (Strix) gegen den Release-Build, Ergebnis in `docs/security/`.

---

## 7. Plattform-Details

### 7.1 Windows

- **Pfade**: `<data>` = `%LOCALAPPDATA%\de.cypherxcypher.studio\data`, `<config>` = `%APPDATA%\de.cypherxcypher.studio\config`, `<cache>` = `%LOCALAPPDATA%\de.cypherxcypher.studio\cache` (`directories::ProjectDirs::from_path("de.cypherxcypher.studio")`, gleiche Wurzel wie Tauri/WebView2 → der NSIS-Deinstallierer kann mit „App-Daten löschen“ alles entfernen).
- **Installer**: NSIS `installMode: currentUser` → `%LOCALAPPDATA%\Cypher Studio\`, kein Admin; WebView2 ist auf Windows 10/11 meist vorhanden, sonst Bootstrapper.
- **Programme portable**: Blender-ZIP mit `portable/`-Ordner (eigene Konfiguration); Krita-ZIP (Konfiguration trotzdem in `%APPDATA%\krita`, teilt sie mit einer installierten Krita, programme.md 1.4); Inkscape-7z (Profil `%APPDATA%\inkscape`); Kdenlive „standalone“ (A-03).
- **Long Paths**: Rust-std nutzt bei langen Pfaden automatisch `\\?\`; Installationsordner bleibt trotzdem kurz (`programs\<id>\<version>`).
- **Mark of the Web**: von Cypher Studio geladene Dateien tragen kein `Zone.Identifier`; die Vertrauensprüfung leistet unsere Prüfkette (sha256 + Signatur). Defender scannt beim Entpacken; das kann dauern (Fortschritt zeigt Einträge).
- **Schriften ohne Admin**: Kopie nach `%LOCALAPPDATA%\Microsoft\Windows\Fonts\`, Wert unter `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts`, `AddFontResourceW`, `WM_FONTCHANGE` broadcasten (ab Windows 10 1809).
- **SmartScreen**: Cypher Studio selbst ist unsigniert (A-08) → „Weitere Informationen → Trotzdem ausführen“, auf der Downloader-Seite mit Strichzeichnungen erklärt. **Smart App Control** (Windows 11, frische Installationen) blockiert unsignierte EXE ohne Ausweg → Hinweis auf der Seite, Signier-Entscheidung in Phase 4 (R2).
- **Store-Installationen** (Krita/Inkscape aus dem Microsoft Store): Start über `explorer.exe shell:AppsFolder\<AUMID>`, Einrichtung nicht unterstützt (virtualisierte Profile) → `setupNotSupported`.

### 7.2 macOS

- **Pfade**: `<data>` = `~/Library/Application Support/de.cypherxcypher.studio`, `<cache>` = `~/Library/Caches/de.cypherxcypher.studio`.
- **dmg**: `hdiutil attach -nobrowse -readonly -noautoopen -mountrandom <tmp> -plist <dmg>` → Mount-Punkt aus Plist → `.app` (Name aus `macAppName`) per `ditto` nach `~/Applications/Cypher Studio/.staging/<jobId>/` → atomar nach `~/Applications/Cypher Studio/<Name>.app` (sichtbar in Launchpad/Spotlight, kein Admin; eine Version je Programm, die alte wird erst nach Erfolg entfernt) → `hdiutil detach -force` im `Drop` des `MountGuard` (auch bei Abbruch/Panik).
- **Quarantäne-Politik**: Downloads über `reqwest` erhalten kein `com.apple.quarantine`, Gatekeeper würde also nicht prüfen. Deshalb prüft Cypher Studio vor der Registrierung selbst: `codesign --verify --deep --strict` und `spctl --assess --type execute` (beglaubigt?). Ergebnis „nicht beglaubigt“ → Hinweis `notNotarized`, Start nur nach ausdrücklicher Bestätigung. Wir **setzen keine** Quarantäne (würde App Translocation auslösen und die Konfiguration verschieben) und **entfernen keine** vorhandene Quarantäne (manuell hinzugefügte Apps durchlaufen Gatekeeper normal über `open`).
- **Architektur**: echte Hardware über `sysctl hw.optional.arm64`; bevorzugt `aarch64`-Artefakte, sonst `x86_64` mit Hinweis „läuft über Rosetta 2“. Intel-Macs: Blender nur 4.5 LTS (Support-Ende ca. Juli 2027, Hinweis in der UI); macOS 27 ist Apple-Silicon-only.
- **Programm-Besonderheiten**: Kdenlive-macOS ist **nicht notarisiert** → `notNotarized`, Start nach Bestätigung. Inkscape 1.4.3/1.4.4: Extensions funktionieren nicht bei Start „von der Kommandozeile“ → Start immer über `/usr/bin/open -a`, früh testen.
- **Cypher Studio selbst**: getrennte Builds arm64 (Haupt) und x64 (A-17), ad-hoc signiert (A-08); erster Start: Systemeinstellungen → Datenschutz & Sicherheit → „Dennoch öffnen“ (seit macOS 15 kein Rechtsklick-Umweg mehr). Für den Updater muss die App in einem beschreibbaren Ordner liegen; Empfehlung `~/Applications` oder `/Applications` mit Adminrechten des Nutzers.
- **Schriften**: `~/Library/Fonts/` (sofort verfügbar).

### 7.3 Linux

- **Pfade**: `<data>` = `$XDG_DATA_HOME/de.cypherxcypher.studio` (Standard `~/.local/share/…`), `<config>` = `~/.config/de.cypherxcypher.studio`, `<cache>` = `~/.cache/de.cypherxcypher.studio`.
- **AppImage** (Krita, Inkscape, Kdenlive): Kopie nach `<data>/programs/<id>/<version>/<datei>.AppImage`, `chmod 0755`.
  - Modus `auto` (Standard): `fuse2_available()` → direkt starten; sonst einmalig `--appimage-extract` in den Installationsordner (`squashfs-root/AppRun`), danach ohne FUSE starten (schnell, WSL-tauglich).
  - Modus `extract`: immer entpacken. Modus `direct`: nie entpacken; fehlt FUSE, wird mit `--appimage-extract-and-run` bzw. `APPIMAGE_EXTRACT_AND_RUN=1` gestartet (entpackt bei jedem Start nach `/tmp`, langsamer).
  - Installationshinweis `linuxFuseMissing` erklärt den gewählten Weg; Paketname `libfuse2` (Debian/Ubuntu ≤ 22.04) bzw. `libfuse2t64` (Ubuntu ≥ 24.04) als optionaler Tipp.
- **Blender**: `tar.xz` mit `stripComponents: 1`, Symlinks erlaubt (Bibliotheken), `portable/`-Ordner.
- **Flatpak-Erkennung**: `flatpak list --app --columns=application,version,installation`; Start `flatpak run <id> <datei>`; Profile unter `~/.var/app/<id>/{config,data}/…` (Tabelle 7.4). Dateien außerhalb der Flatpak-Freigaben kann das Programm evtl. nicht öffnen → Fehlerhinweis „Flatseal: Zugriff auf Ordner erlauben“. Schriften in `~/.local/share/fonts` sieht Flatpak automatisch.
- **Snap**: Erkennung über `snap list`, Start `/snap/bin/<name>`, Einrichtung nicht unterstützt (v1).
- **Cypher Studio selbst**: AppImage, `.deb` und `.rpm`; alle drei aktualisierbar (Updater ≥ 2.10; `.deb`/`.rpm` über `pkexec` mit Passwortabfrage). AppImage wird auf `ubuntu-22.04` gebaut (älteste glibc-Basis); ein AppImage aus der WSL (24.04) taugt nur für lokale Tests. Voraussetzung WebKitGTK 4.1 (Ubuntu 22.04+, Debian 12+, Fedora 36+). Bei schwarzen/weißen Fenstern (NVIDIA/Wayland, WSLg): Einstellung „Kompatibilitätsmodus Grafik“ setzt vor dem WebView-Start `WEBKIT_DISABLE_DMABUF_RENDERER=1`, als letzte Stufe `WEBKIT_DISABLE_COMPOSITING_MODE=1`.
- **Schriften**: `~/.local/share/fonts/cypher/` + `fc-cache -f` auf diesen Ordner.

### 7.4 Konfigurationswurzeln je Programm (ANNAHME A-06, `setup/roots.rs`)

| RootId | Windows | macOS | Linux (nativ/AppImage) | Linux Flatpak |
|---|---|---|---|---|
| `kritaResources` | `%APPDATA%\krita` (Store: `%LOCALAPPDATA%\Packages\49800Krita_*\LocalCache\Roaming\krita`, nicht unterstützt) | `~/Library/Application Support/Krita` | `~/.local/share/krita` | `~/.var/app/org.kde.krita/data/krita` |
| `inkscapeProfile` | `%APPDATA%\inkscape` (oder `INKSCAPE_PROFILE_DIR`, falls gesetzt) | `~/Library/Application Support/org.inkscape.Inkscape/config/inkscape` (Smoke-Test) | `$XDG_CONFIG_HOME/inkscape` | `~/.var/app/org.inkscape.Inkscape/config/inkscape` |
| `blenderConfig` (X.Y) | System: `%APPDATA%\Blender Foundation\Blender\X.Y`; Cypher: `<install>\portable` | `~/Library/Application Support/Blender/X.Y` | System: `~/.config/blender/X.Y`; Cypher: `<install>/portable` | `~/.var/app/org.blender.Blender/config/blender/X.Y` |
| `blenderScripts` | `<blenderConfig>\scripts` | `<blenderConfig>/scripts` | `<blenderConfig>/scripts` | `<blenderConfig>/scripts` |
| `blenderExtensions` | über Blender-CLI (`--repo user_default`), kein direkter Schreibzugriff; Tests mit leerem `BLENDER_USER_RESOURCES` | ← | ← | ← |
| `kdenliveData` | `%APPDATA%\kdenlive` (A-14) | `~/Library/Application Support/kdenlive` | `~/.local/share/kdenlive` | `~/.var/app/org.kde.kdenlive/data/kdenlive` |
| `kdenliveLocalData` (Render-Presets, nach Smoke-Test) | `%LOCALAPPDATA%\kdenlive` | `~/Library/Application Support/kdenlive` | `~/.local/share/kdenlive` | wie links |
| `userFonts` | `%LOCALAPPDATA%\Microsoft\Windows\Fonts` | `~/Library/Fonts` | `~/.local/share/fonts/cypher` | (wie Linux) |
| `projectTemplates` | `<data>\templates` (eigene Vorlagen) | ← | ← | ← |

Hinweis: Cypher-Blender auf macOS nutzt das Benutzerprofil (ein `portable`-Ordner im signierten `.app` würde die Signatur brechen).

### 7.5 Artefaktarten je Programm (bestätigt durch programme.md, Stand 16.10.2026)

| Programm (Kanal) | Windows x86_64 | macOS | Linux x86_64 | Prüfsumme (Host) | Signatur |
|---|---|---|---|---|---|
| Blender 5.2.2 (LTS) | `zip` 404 MB | `dmg` arm64 346 MB; Intel: 4.5.14 `dmg` 340 MB | `tarXz` 383 MB | `blender-<v>.sha256` (download.blender.org, eine Datei für alle) | keine |
| Krita 5.3.4.1 (stable), 6.0.x (preview) | `zip` 228 MB | `dmg` 392 MB (universal prüfen) | `appImage` 382 MB | `<datei>.sha256` (download.kde.org) | PGP nur AppImage (durchgesetzt) |
| Inkscape 1.4.4 | `7z` 110 MB (Dateiname mit Datum/Hash/Zufall → `sources.json` liest `/dl/`-Seite) | `dmg` je Arch ≈ 160 MB | `appImage` 120 MB | `.sha256` (media.inkscape.org); AppImage: `cypherPinned` | AppImage DSA-1024/SHA-1 (nur informativ) |
| Kdenlive 26.08.2 | `sfx7z` Standalone 135 MB (SFX-Typ per Smoke-Test) | `dmg` je Arch ≈ 150 MB, nicht notarisiert | `appImage` 215 MB | `<datei>.sha256` (download.kde.org) | keine |
| GIMP 3.2 (optional) | `exeInstaller` (inno, `/CURRENTUSER`) | `dmg` je Arch | `appImage` | SHA-256/SHA-512-Listen (Hauptquelle) | – |
| Audacity (optional) | `zip` falls angeboten, sonst `exeInstaller` | `dmg` | `appImage` | GitHub-Release | – |

Summe der vier Pflichtprogramme ≈ 0,9–1,1 GB je Plattform → Platzprüfung, Fortsetzen und Hinweis `largeDownload` sind Pflicht.

Linux aarch64 und Windows ARM64 werden im Katalog unterstützt, aber erst befüllt, wenn Upstream Artefakte anbietet.

---

## 8. Teststrategie und Qualitätstore

Schichten: (1) Fachlogik in `cypher-core` ohne Tauri → schnelle `cargo test`, auch ohne WebKit-Bibliotheken; (2) Commands über `tauri::test` (Mock-Runtime); (3) Frontend-Logik mit Vitest + `mockIPC`; (4) UI mit Playwright gegen Vite und gemocktes IPC; (5) echte End-to-End-Tests in der gebauten App auf allen drei WebViews; (6) Installer-Probe unter Linux (WSL/CI) und Windows-Build.

### 8.1 Rust (`cypher-core`, `src-tauri`)

| Modul | Pflichttests | Fixtures / Hilfen |
|---|---|---|
| `platform` | Pfad-Snapshots je OS (`#[cfg]`), `safe_join`/`ensure_within` mit proptest (zufällige `..`, `\`, `:`, NUL, UNC, Laufwerke, reservierte Namen, NFC/NFD), `write_atomic` bei simuliertem Absturz | `AppDirs::for_test` |
| `catalog` | gültig signiert; falsche Signatur; unbekannter Schlüssel; Rollback (`sequence` kleiner); `schemaVersion` zu neu; Host nicht erlaubt; abgelaufen (nur Warnung); Auswahl Embedded/Cache/Remote; Intel-Mac bekommt Blender 4.5 | Testschlüssel **im Test erzeugt** (`minisign`-Crate als dev-dependency), nie eingecheckte Geheimschlüssel; Test: eingebetteter Katalog ist mit einem eingebetteten Schlüssel signiert |
| `verify` | SHA-256-Testvektoren; Abbruch beim Hashen; PGP gültig/ungültig/falscher Fingerprint/abgelaufen; `enforce: false` protokolliert nur | kleine Datei + mit Testschlüssel signierte `.sig` (Skript `tests/gen-pgp-fixtures.rs`) |
| `download` | Normal; Range/206; `If-Range`-Abweichung → 200 von vorn; 416; 500 → Wiederholung → 200; 429 mit Retry-After; langsames Tröpfeln → Abbruch; Größe überschritten; Weiterleitung auf erlaubten/verbotenen Host; Hash falsch → `.part` gelöscht | **lokaler Test-HTTP-Server** (`axum` auf `127.0.0.1:0`) mit Handlern je Fall; `HostPolicy::for_test(["127.0.0.1"])` und `HttpClient::for_test` (erlaubt `http` nur für 127.0.0.1, nur mit Feature `test-util`) |
| `install` / `archive` | Zip-Slip (`../`, absolut, `C:\`, `\\server`), Symlink-Ausbruch (tar), Hardlink, Gerätedatei, Duplikate nach Groß/Klein, Zip-Bombe (Verhältnis), 7z mit BCJ-Filter, SFX-Versatz, `stripComponents`; Absturz zwischen Rename und `state.json` → Recovery; Ersetzen alter Version; macOS: dmg anhängen/kopieren/aushängen (nur macOS-CI, Test-dmg per `hdiutil create`) | `tests/fixtures/archives/*` (per Skript erzeugt, klein) |
| `detect` | je OS: Registry-/Pfad-/Flatpak-/Snap-/Bundle-ID-Fälle, kaputte Einträge, Timeout von `--version` | Fakes für `FsProbe`, `CommandRunner`, `RegistryProbe` aus JSON-Fixtures |
| `launch` | `build()`-Snapshots je Launcher (Argumente, entfernte Umgebungsvariablen, `open -a`, `flatpak run`, `--app-template`); `spawn` mit Test-Binary `tests/bin/echo-args` | – |
| `setup` | **Goldener Test:** Temp-HOME mit vorhandenen Nutzerdateien → anwenden → zweiter Plan nur `skip` → rückgängig → Baum Hash-identisch zum Ausgangszustand; Konflikte (`overwrite` mit Sicherung, `keepBoth`, `skip`); gesperrte Datei → `partial`; Absturz nach n Schritten → Journal-Recovery; Schriften-Referenzzählung; neue Blender-Serie = neuer Scope | echte Paketdateien aus `packs/dist` |
| `library` | Scan mit Konfliktkopien, Begleitdateien in `.cypher/meta`, extern umbenannte Datei (Wiederfinden über `contentSha256`), Facetten, Paket-Export/-Import mit allen Konfliktpolitiken und bösartigem Paket; Leistung: Abfrage über 5 000 Einträge < 30 ms (`#[ignore]`, eigener CI-Job) | Ordner-Fixture mit 50 Dateien, Generator für 5 000 |
| `printcheck` | je Regel mindestens ein positiver und ein negativer Fall; Export: exakt 3307 px bei 280 mm, pHYs 11811, iCCP Adobe RGB, keine dunklen Säume an Alpha-Kanten (vormultipliziertes Resampling), Ausgabe besteht erneute Prüfung; Leistung ≤ 1,5 s für 3898 × 5315 (CI-Grenze 2× wegen Runner) | **deterministisch im Test erzeugte Bilder** (pHYs 72/300/fehlt, iCCP sRGB/Adobe RGB/Display P3 aus `moxcms`, 16 bit, Palette+tRNS, APNG, interlaced, CMYK-TIFF, JPEG; harte Kanten mit nur AA-Saum → 0 %, Fade-out-Band → 3 %, Geisterpixel, deckender Hintergrund, leer; Linien 4/8/12 px); Berichte als `insta`-Snapshots |
| `bgremove` (colorKey) | einfarbiger Hintergrund, Verlauf, Toleranzgrenzen | erzeugte Bilder |
| Vertrag | jede Datei in `docs/contract-fixtures` verlustfrei (de)serialisierbar; ts-rs-Export aktuell; `generate_handler!`-Liste = `COMMAND_NAMES` | – |
| `src-tauri` | Mock-Runtime: jeder Command registriert; Aufruf ohne Freigabe wird abgelehnt; Protokolle: `cyfile` nur registrierte Handles, `cyasset` mit `..%2F` → 404, CORS-Header vorhanden | `tauri::test::mock_builder` |

Werkzeuge: `cargo nextest`, `cargo llvm-cov` (Zeilenabdeckung `cypher-core` ≥ 80 %, `archive`/`verify`/`setup`/`printcheck` ≥ 90 %), ab Phase 4 `cargo fuzz` (wöchentlich) für `sanitize_entry`, Katalog-Parser und PNG-Metadaten.

### 8.2 Frontend-Logik (Vitest 5 + Testing Library + jsdom)

- IPC-Schicht: `call()` mappt Rejections auf `AppError`, Channel-Hilfe, Event → Invalidierung (TanStack Query).
- Texte: `errorText()` deckt **jede** `AppError.kind` ab, `findingText()` jede `PrintRuleId` (Test iteriert über Fixtures); ESLint-Regel verbietet Textliterale in JSX außerhalb `i18n/`.
- Engines (reines TS): Social-Layout (Textanpassung, Umbruch mit `Intl.Segmenter`, Kürzung, Hilfslinien-Überschneidung), Mockup-Geometrie (mm → Vorlagenpixel über Quad, Verschiebungsabtastung auf typed arrays). Canvas-Zeichnen selbst wird in Playwright geprüft.
- Mock-Handler `src/ipc/mock/` bedient alle `COMMAND_NAMES` (Test), Daten aus `docs/contract-fixtures`, Szenarien für Fehlerfälle; Channels im Mock: `args.onEvent.onmessage(...)` simuliert Fortschritt. jsdom braucht das WebCrypto-Polyfill aus der Tauri-Doku.

### 8.3 Playwright gegen Vite mit gemocktem IPC

- `VITE_MOCK_IPC=1` installiert die Mocks (Zweig wird im Produktions-Build entfernt); Szenario per `page.addInitScript(() => window.__CYPHER_SCENARIO__ = "…")`: `fresh`, `allInstalled`, `installChecksumFail`, `setupConflicts`, `library5000`, `offline`, `updateAvailable`.
- Pflicht-Abläufe: Erststart komplett; Start (leer/voll); Programm installieren mit Fortschritt, Abbruch und Sicherheitswarnung; Einrichtung mit Konfliktwahl und Rückgängig; Druckprüfer (Bericht, Overlay, Export); Mockup (Render-Screenshot je Textilfarbe); Social (Textanpassung); Bibliothek (5 000 Einträge virtualisiert, Filter, Mehrfachauswahl); Einstellungen (Netzwerkliste); Aufträge-Popover.
- Design-Vertrag (DESIGN.md 3): `Strg+Enter` löst auf jedem Modul die Ausgangsaktion aus; `F6`-Zyklus, `Strg+1…7`, `Esc`, keine Tastaturfalle; Fokus sichtbar; Screenshots bei 1024 × 680, 1280 × 800, 1920 × 1080 in Papier und Tinte; 200 % App-Zoom; `prefers-reduced-motion`; **axe 0 Verstöße** je Bildschirm und Thema (`@axe-core/playwright`, nur Dev).
- **CSP-Test:** `vite preview` mit der Produktions-CSP als Header; jedes `securitypolicyviolation`-Ereignis lässt den Test scheitern.
- Projekte `chromium` (≈ WebView2) **und** `webkit` (Näherung für WKWebView/WebKitGTK bei Canvas/CSS); Screenshot-Baselines nur auf Linux-CI (gebündelte Schriften → stabil).

### 8.4 Linux-Installer-Probe in WSL (xvfb)

`scripts/probe-linux.sh [all|blender|krita|inkscape|kdenlive|app]` (Zone I), angelehnt an `scripts/wsl-build.sh` (Spiegel nach `~/build`, nie auf `/mnt/c` bauen):
1. Baut `cypher-cli` (release) in der WSL (Ubuntu 24.04).
2. Je Linux-Artefakt des Katalogs: `cypher install <id> --yes --data-dir /tmp/cyprobe --catalog catalog/catalog.json` (die CLI zeigt den Plan wie die App; `--yes` ist die ausdrückliche Zustimmung des Aufrufers) → Hash/Signatur geprüft → FUSE-Erkennung (WSL hat meist kein FUSE → Entpack-Weg wird getestet).
3. Start-Probe: `dbus-run-session -- xvfb-run -a -s "-screen 0 1440x900x24"` startet das Programm 20 s, prüft „läuft noch“, Bildschirmfoto mit `import -window root` nach `dist-builds/probe/<id>.png`. Blender zusätzlich `-b --python-expr` (Version) und Extension-Installation mit leerem `BLENDER_USER_RESOURCES`.
4. Einrichtung: `cypher setup apply <pack> --home /tmp/cyhome` zweimal (zweiter Lauf: 0 Änderungen), dann `undo` (Baum identisch).
5. `app`: Cypher-Studio-AppImage unter xvfb starten + Bildschirmfoto; `.deb`/`.rpm` mit `dpkg -I/-c`, `rpm -qpi` prüfen; bei leerem Fenster `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
Benötigte Pakete (xvfb, imagemagick, dbus, libwebkit2gtk-4.1, libfuse2t64 optional) nennt das Skript; es installiert nichts selbst (`apt`-Befehl wird nur ausgegeben). Derselbe Ablauf läuft wöchentlich in CI auf `ubuntu-22.04`. Downloads ≈ 1 GB: lokal nur auf Zuruf.

### 8.5 Windows-Build und echte End-to-End-Tests

- CI `windows-latest` (MSVC): `npm ci`, `cargo nextest`, `npm run tauri build -- --bundles nsis`; Rauchtest: ungebündelte `cypher-studio.exe --smoke-test` (nur in Builds mit Feature `e2e`: startet, lädt Katalog, erkennt Programme, schreibt Bericht-JSON, beendet mit 0).
- Lokal unter Windows: `scripts/wsl-build.sh windows` (cargo-xwin; dabei wird die Microsoft-SDK-Lizenz akzeptiert → Entscheidung des Nutzers) erzeugt `dist-builds/cypher-studio-portable.exe`, die direkt startet. Der NSIS-Installer wird **nicht** ohne Zustimmung auf dem Entwicklerrechner installiert (VM/Windows-Sandbox wären Systemänderungen).
- Echte WebViews: **WebdriverIO + `@wdio/tauri-service`** mit eingebettetem Treiber (Rust-Plugin nur mit Cargo-Feature `e2e`, nie im Release) auf `windows-latest`, `macos-latest`, `ubuntu-22.04` (xvfb): fünf Rauchabläufe (Start, Programme, Druckprüfung mit echter Rust-Analyse, Mockup-Export auf der echten Canvas-Engine, Einstellungen). Nachts und vor jedem Release.
- Update-Rundlauf vor 1.0: Probe-Tag `v0.1.0-rc.1` → `rc.2` je Plattform mit **gebündelten** Artefakten (nicht dem Roh-Binary), Checkliste in `docs/release-checkliste.md`.

### 8.6 Pakete (Team C) und Downloader-Seite (Team D)

- Pakete: `packs/tools/validate.mjs` (Ajv) prüft alle `pack.json`/`template.json`/Mockup-/Social-Vorlagen gegen die Schemas, Dateiexistenz, Hashes, `OFL.txt` je Schrift, `packs/fonts/SHA256SUMS`; `gen-palettes.mjs` ist deterministisch (gleiche Ausgabe für `.kpl`/`.gpl`/`brand.json`); XML-Gültigkeit von `.kdenlivetitle`/`.svg`, ZIP-Struktur von `.kra`/`.bundle` (inkl. `md5sum` im Manifest), Schlüssel der MLT-Profile; Blender-Tests (4.9) im Job `packs-blender.yml`, Blender wird dort über `cypher-cli` geprüft geladen.
- Seite: html-validate, Playwright (OS-Erkennung je User-Agent und `userAgentData`, Android/iOS ohne Download-Knopf, Ansicht ohne JavaScript), axe 0, Lighthouse CI (LCP ≤ 2,0 s Handy bei 4× CPU, CLS ≤ 0,05), `_headers` (CSP ohne Inline-Code, `X-Robots-Tag: noindex, nofollow`, keine Cookies), keine Anfragen an fremde Hosts (Request-Interception), Schema von `release.json`, Linkprüfung, kein Querscrollen ab 320 px.

### 8.7 Qualitätstore

| Tor | Befehl / Prüfung | Schwelle | Wann |
|---|---|---|---|
| Rust-Format | `cargo fmt --all --check` | sauber | jeder PR |
| Clippy | `cargo clippy --workspace --all-targets --locked -- -D warnings` (+ `unwrap_used`, `expect_used`, `panic` in `cypher-core`) | 0 Warnungen | jeder PR |
| Rust-Tests | `cargo nextest run --workspace --locked` auf Windows, Linux, macOS | grün | jeder PR |
| Abdeckung | `cargo llvm-cov` | ≥ 80 % (`cypher-core`), ≥ 90 % sicherheitsrelevante Module | jeder PR (Linux) |
| Lizenzen/Advisories | `cargo deny check` + `node scripts/license-check.mjs` (Allowlist: MIT, Apache-2.0, BSD-2/3, ISC, Zlib, Unicode-3.0, CC0-1.0, MPL-2.0 nur Dev, OFL-1.1 nur Schriften) | 0 Funde | jeder PR + täglich |
| Geheimnisse | `gitleaks detect` | 0 Funde | jeder PR |
| Vertrag | ts-rs-Export ohne Diff, `tsc` inkl. `contract-check.ts`, Fixture-Round-Trip, Command-Liste | grün | jeder PR |
| TypeScript | `tsc --noEmit` (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), `eslint --max-warnings 0`, `prettier --check`, `stylelint` (Farben nur aus `tokens.css`) | 0 Fehler | jeder PR |
| Vitest | `vitest run --coverage` | ≥ 80 % für `ipc/`, `i18n/`, `features/*/engine/` | jeder PR |
| Playwright | alle Abläufe, axe 0, keine CSP-Verletzung, Screenshot-Abweichung ≤ 0,1 % | grün | jeder PR (B), nachts |
| Budgets | initiales JS ≤ 250 KB gzip; Kaltstart ≤ 1,5 s, Modulwechsel ≤ 100 ms, Druckprüfung ≤ 1,5 s (DESIGN.md „Tempo“, Messskript) | eingehalten | nachts + Release |
| Zonen | `node scripts/zone-check.mjs` | nur eigene Zone | jeder PR |
| Pakete/Seite | 8.6 | grün | PR in Zone C/D |
| E2E echt | WebdriverIO auf drei OS, Linux-Probe | grün | nachts + Release |
| Release | alles oben + Update-Rundlauf + Sicherheitscheck (Strix) vor der ersten öffentlichen Version + SmartScreen-/Gatekeeper-Anleitung auf echten Geräten geprüft | grün, protokolliert | vor jedem Release |

**Definition of Done je PR:** Tests für neues Verhalten, alle zutreffenden Tore grün, keine neue Abhängigkeit ohne Eintrag in THIRD_PARTY.md, UI-Änderung mit Screenshot (beide Themen), Vertragsänderungen nur über Zone I.

---

## 9. Bauplan, Meilensteine, Risiken

### 9.1 Phasen

| Phase | Ziel | Team A (Rust) | Team B (Frontend) | Team C (Pakete/Blender) | Team D (Seite) | Zone I |
|---|---|---|---|---|---|---|
| **0 Fundament** (1–2 Tage) | Gerüst, das alle Tore fahren kann | Cargo-Workspace (`crates/cypher-core`, `crates/cypher-cli`, `src-tauri`), `api/`-DTOs nach Vertrag 0.2.0 + ts-rs, Fehler-Enum, alle Commands registriert (antworten `internal: "noch nicht gebaut"`), `AppManifest` + Capability + CSP, `productName`/`mainBinaryName` korrigieren | Aliase `@contract`/`@tokens`, `ipc/commands.ts`, Mock-Handler für alle Commands, App-Gerüst (Rail, Hash-Router, Fehlergrenze), i18n-Gerüst, Stylelint mit `tokens.css` | `packs/schema/*`, `validate.mjs`, `brand.json` (Kollektionen, Textilfarben, 17er-Palette), `gen-palettes.mjs` | Seitengerüst (`wrangler.toml` nur Assets, `_headers`, `robots.txt`, OS-Erkennung) | npm-Workspaces mit Wurzel-Lockfile, `rust-toolchain.toml`, `deny.toml`, `zones.json` + Zonen-Check, `ci.yml`, THIRD_PARTY.md, `docs/contract-fixtures/` |
| **1 → M1** (1–2 Wochen) | erster lauffähiger Stand | `platform`, `settings`, `state`, `jobs`, `catalog` (eingebettet, testsigniert, Blender mit echten Hashes), `verify` (sha256, minisign), `download`, `install` (zip, tar.xz), `detect` (alle OS), `launch`, `printcheck` (Analyse + Export beide Arten, Adobe RGB via moxcms), `cyfile`-Protokoll | Start (Projekte-Leerzustand, Formatleiste, Programme-Spalte), Programme (Liste, Detail, Installationsdialog mit sechs Feldern, Fortschritt, Sicherheitswarnung), Druckprüfer (Vorschau mit Druck-/Sicherheitsfläche, Inspektor, Export), Aufträge-Popover (Grundform) | Krita v0 (Palette, Vorlagen Shirt/Hoodie als `.kra`), Inkscape v0 (Palette, SVG-Vorlagen), Probe-Motiv | Seite v1 lokal mit `wrangler dev` (ohne Konto) | `probe-linux.sh` (Blender) |
| **2 → M2** | alle Programme, Katalog-Update, Einrichtung, Bibliothek | 7z/SFX, AppImage (FUSE/Entpacken), dmg, PGP, Spiegel-Weiterleitung, Remote-Katalog + Cache + Rollback, `cypher catalog build/check` aus `sources.json`, `setup` komplett, `library` (Scan, Index, Begleitdateien, Vorschaubilder png/kra/svg, Watcher, Facetten), `projects` | Einrichtung (Bausteine, Konflikte, Rückgängig, Verlauf), Bibliothek (virtualisiertes Raster, Filter, Inspektor, Mehrfachauswahl), Projekte auf Start, Einstellungen komplett (Netzwerk, Profile), Erststart-Assistent | Krita-Bundle (in Krita erzeugt), Kdenlive (Titel, Profile 1080 × 1920/1350), Paket `fonts` | Anleitung je OS mit Strichzeichnungen, Prüfsummen-Abschnitt, `gen-release-json.mjs` | `catalog.yml`, Signier-Ablauf dokumentiert (Schlüssel erzeugt die verantwortliche Person) |
| **3 → M3** | Ausgabe-Module, Blender-Paket | Druckprüfer-Extras (dünne Linien, Korrekturen, Reinschwarz), Freistellen per Farbschlüssel, `export_save_image` (raw, pHYs), `cyasset`, Vorlagen laden, `.blend`-Vorschau | Mockups (Engine + Worker + Editor), Social (Layout-Engine + Editor), Freistellen-UI | Mockup-Vorlagen (eigene Fotos, hell/dunkel; bis dahin Silhouetten), Social-Vorlagen, Blender App-Template + Extension + Tests, Kdenlive-Reel-Vorlage | Messspur-Szene (zuerst CSS scroll-driven animations) | – |
| **4 → M4 (v0.1.0)** | Release-Reife | Updater-Kleber, `release.yml`, Site-`latest.json`, Diagnose-Export, `--smoke-test`, Fuzzing, E2E-Feature | Feinschliff nach DESIGN.md (vier laute Momente), Tastenkürzel-Editor, Barrierefreiheit, Budgets | optionale Katalog-Programme (GIMP, Audacity) in `sources.json` (mit A) | Deploy auf `studio.cypherxcypher.de` (Cloudflare-Token setzt der Nutzer) | Strix-Check, `cargo about` → THIRD_PARTY, Signier-Entscheidung, Entscheidung „Repo öffentlich“ (Rouven), Probe-Tag, Update-Rundlauf |
| **5 Ausbau** | Extras | Freistellen per Modell (IS-Net, `ort`), Halbton-Korrektur, Video-Vorschaubilder (ffmpeg einer Kdenlive-Installation), Kdenlive-Render-Presets nach Smoke-Test | glTF-Vorschau (three.js) im PS2-Look wie im Shop | weitere Vorlagen | – | optional Shirtigo-API (braucht Konto → Entscheidung des Nutzers) |

### 9.2 Meilenstein M1 „erster lauffähiger Stand“ (Abnahme, selbst prüfbar)

1. `npm run tauri dev` unter Windows: Startseite mit Formatleiste (aus `templates_list`), Programme-Spalte und Leerzustand „Noch kein gemeinsamer Ordner“.
2. **Programme-Liste mit echter Erkennung**: Krita, Inkscape, Blender, Kdenlive mit Status; auf dem Entwicklerrechner vorhandene Installationen werden erkannt (Sichtprüfung + Bildschirmfoto); Unit-Tests mit Fixtures für alle drei OS grün.
3. **Eine echte, verifizierte Installation**: Blender 5.2.2 portable unter Windows. Vorschau mit Quelle · Version · Größe · Lizenz · Prüfsumme · Zielordner → Zustimmung → Download mit Fortschritt, Abbruch und Fortsetzen → SHA-256 gegen `download.blender.org` → Entpacken nach `%LOCALAPPDATA%\de.cypherxcypher.studio\data\programs\blender\5.2.2` → Start aus der App. Negativtest mit manipulierter Datei (Test-Server): Sicherheitswarnung, nichts installiert, `.part` gelöscht. Blender zuerst, weil ZIP und offizielle Prüfsummendatei ohne Spiegel- und Signatur-Sonderfälle auskommen.
4. **Druckprüfer**: Fixture-Suite grün; echte PNG → Bericht in ≤ 1,5 s; Export bei 280 mm → 3307 px breit, pHYs 11811, Adobe-RGB-Profil eingebettet, Begleitdatei `.shirtigo.json`; Export besteht die erneute Prüfung.
5. CI grün auf Windows und Linux, macOS baut; alle Tore aus 8.7, die in Phase 1 zutreffen.

### 9.3 Risiken und Gegenmaßnahmen

| # | Risiko | Wirkung | Gegenmaßnahme |
|---|---|---|---|
| R1 | Upstream ändert URLs/Dateinamen (Inkscape mit Zufallssuffix, KDE-Spiegel) | Installation scheitert | signierter Katalog ohne App-Update; wöchentlicher `catalog.yml`-Lauf; Rezept in `sources.json`; Fehlerfall bietet „Programmseite öffnen“ |
| R2 | Unsignierte App: SmartScreen, **Smart App Control** (blockiert unsignierte EXE ganz), Gatekeeper | Nutzer verunsichert oder blockiert | ehrliche Anleitung mit Strichzeichnungen, Prüfsummen auf der Seite; Phase 4: SignPath Foundation (kostenlos, braucht öffentliches Repo) bzw. Apple Developer Program (Kostenentscheidung) |
| R3 | Drei WebView-Engines verhalten sich unterschiedlich | Darstellungs-/Canvas-Fehler | nur Standard-Web-Features, Playwright `webkit`-Projekt, WebdriverIO auf drei OS, Grafik-Kompatibilitätsmodus unter Linux |
| R4 | Konfigurationsorte ändern sich mit Programmversionen | Einrichtung landet falsch | Wurzeln im Code je Versionsbereich + Tests; Smoke-Tests (programme.md 9.4) in der Probe; Vorschau zeigt Ziele; Rückgängig |
| R5 | Blender-API ändert sich (4.5 ↔ 5.x) | Add-on bricht | `blender_version_min`, Tests gegen beide LTS-Serien, Extension-Format |
| R6 | Krita-Ressourcen erscheinen erst nach Neustart / Bundle-Verhalten | Nutzer sieht Palette nicht | Neustart-Hinweis, Smoke-Test, Ausweichweg lose Dateien |
| R7 | Schwache oder fehlende Upstream-Signaturen (Inkscape DSA-1024/SHA-1, keine SHA-256 fürs AppImage) | Lieferkette | `cypherPinned`-Prüfsumme nach Signaturprüfung durch die Pflege, Hostliste, HTTPS; offen dokumentiert |
| R8 | Katalogschlüssel verloren oder kompromittiert | keine Katalog-Updates / bösartiger Katalog | zwei eingebettete Schlüssel (aktiv + Reserve), offline mit Zweitkopie; Schaden begrenzt durch Hostliste und „keine Fernausführung“; Schlüsselwechsel per App-Update |
| R9 | Updater-Schlüssel verloren | keine Auto-Updates mehr | Passwort + zwei Offline-Kopien; Neuinstallation über die Seite möglich |
| R10 | Große Downloads (≈ 1 GB), langsames Netz | Abbrüche | Fortsetzen, Parallelitätsgrenze, Platzprüfung, Aufträge im Hintergrund |
| R11 | Virenscanner-Fehlalarme beim Entpacken/Starten | blockierte Programme | nur offizielle Binaries, keine Packer; Hinweis in der Hilfe |
| R12 | Shirtigo-Vorgaben unsicher (Profilauswertung, Schwellen, Plattengrößen) | Fehldrucke | Profile als Daten mit `assumption`, Testdruck mit Farbkarte und Halbtransparenz-Streifen (vorgaben.md 7), danach Werte anpassen |
| R13 | Lizenzmischung (Blender-Add-on GPL, Markenzeichen) | Lizenzkonflikt | getrennte `LICENSE` in `packs/blender`, Logos nicht unter MIT, `cargo deny`/npm-Prüfung, THIRD_PARTY.md |
| R14 | GSAP (Seite) hat keine OSI-Lizenz | Repo nicht rein quelloffen | zuerst CSS scroll-driven animations + kleines Vanilla-JS; GSAP nur nach dokumentierter Entscheidung |
| R15 | Freistell-Modell: Trainingsdaten nur nichtkommerziell (DIS5K) | rechtliche Grauzone | optional, Farbschlüssel als Standard, Hinweis in `NOTICE` und UI |
| R16 | Repo bleibt privat → GitHub-Endpunkte nicht erreichbar | Updates/Katalog scheitern | Hauptendpunkte auf `studio.cypherxcypher.de` (A-07) |
| R17 | Teams laufen vom Vertrag weg | Integrationsfehler | `contract-check.ts`, gemeinsame Fixtures, Zonen-Check, Vertrags-PR-Prozess |
| R18 | Workers-Static-Assets-Grenze 25 MiB je Datei | Dateien nicht hostbar | Installer < 24 MiB (CI-Prüfung), Modelle über GitHub Releases |
| R19 | Flatpak-Sandbox | Programm kann Projektdateien nicht öffnen | Erkennen und Hinweis (Flatseal), Cypher-Installation empfehlen |
| R20 | Gemeinsamer Ordner in OneDrive/iCloud mit „Dateien bei Bedarf“ | Vorschaubilder lösen Downloads aus | Vorschaubilder nur für lokal vorhandene Dateien (Windows `FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS`, macOS `NSURLUbiquitousItemDownloadingStatusKey`), sonst Platzhalter |
| R21 | Gleichzeitiges Bearbeiten derselben Datei durch zwei Personen | Konfliktkopien, Datenverlust | Konflikterkennung, nie automatisch löschen, Begleitdatei je Datei, Hinweis „wer arbeitet gerade“ ist bewusst nicht Teil von v1 |
| R22 | `ort` ist noch Release Candidate | Brüche bei Updates | genau pinnen, Feature optional, Farbschlüssel ohne ML |

---

## 10. Externe Bausteine

Versionen: Stand 16.10.2026 laut `research/plattform.md` und `research/vorgaben.md`, wo vorhanden; sonst „Phase 0 pinnen“. Lizenzangaben vor Aufnahme mit `cargo deny`/`cargo about` bzw. dem npm-Lizenzcheck bestätigen. Diese Tabellen sind die Vorlage für `THIRD_PARTY.md` (ab Phase 4 aus `cargo about` + npm-Lizenzliste erzeugt).

### 10.1 Rust (ausgeliefert)

| Crate | Version | Lizenz | Zweck |
|---|---|---|---|
| `tauri`, `tauri-build` | 2.12.4 / 2.7.3 | Apache-2.0 OR MIT | App-Rahmen |
| `tauri-plugin-updater` | 2.14.0 | MIT OR Apache-2.0 | App-Update |
| `tauri-plugin-dialog` | 2.8.3 | MIT OR Apache-2.0 | native Dialoge (nur aus Rust) |
| `tauri-plugin-opener` | 2.7.2 | MIT OR Apache-2.0 | URL öffnen, im Ordner zeigen |
| `tauri-plugin-process` | 2.4.0 | MIT OR Apache-2.0 | Neustart nach Update |
| `tauri-plugin-single-instance` | 2.5.4 | MIT OR Apache-2.0 | eine Instanz |
| `tauri-plugin-window-state` | 2.5.0 | MIT OR Apache-2.0 | Fenstergröße merken |
| `wry` / `tao` (transitiv) | 0.57 / 0.37 | Apache-2.0 OR MIT / Apache-2.0 | WebView/Fenster |
| `serde`, `serde_json` | 1.0.229 / 1.0.154 | MIT OR Apache-2.0 | Serialisierung |
| `thiserror` | 2.0 | MIT OR Apache-2.0 | Fehler |
| `tokio`, `tokio-util` | 1.53 / 0.7.20 | MIT | Async, `CancellationToken` |
| `futures-util` | 0.3.34 | MIT OR Apache-2.0 | Streams |
| `reqwest` | 0.13.5 (`rustls-no-provider`, `stream`, `http2`, `system-proxy`) | MIT OR Apache-2.0 | HTTP |
| `rustls` (Provider `ring`) | 0.23 | Apache-2.0 OR ISC OR MIT (`ring`: Apache-2.0 AND ISC) | TLS |
| `url` | 2.5.8 | MIT OR Apache-2.0 | URLs |
| `sha2`, `hex` | 0.11 / 0.4.3 | MIT OR Apache-2.0 | Prüfsummen |
| `minisign-verify` | 0.3.0 | MIT | Katalog-/Modellsignaturen (wie im Updater) |
| `pgp` (rPGP) | 0.21.0 | MIT OR Apache-2.0 | Upstream-PGP-Signaturen (**nicht** Sequoia, LGPL) |
| `memmap2` | aktuell | MIT OR Apache-2.0 | große Dateien prüfen |
| `zip` | 9.0.4 (`default-features = false`, `deflate`) | MIT | ZIP |
| `sevenz-rust2` | 0.24.0 | Apache-2.0 | 7z, SFX |
| `tar` | 0.4.46 | MIT OR Apache-2.0 | TAR |
| `liblzma` | 0.4.8 | MIT OR Apache-2.0 (liblzma: 0BSD) | XZ |
| `flate2` | 1.1.10 | MIT OR Apache-2.0 | GZip |
| `ruzstd` | aktuell | MIT | zstd-komprimierte `.blend` lesen (Vorschau) |
| `directories` | 6.0.0 | MIT OR Apache-2.0 | Pfade |
| `which` | 8.0.6 | MIT | Programme im PATH |
| `globset`, `walkdir` | aktuell | Unlicense OR MIT | Pfadmuster, Ordnerlauf |
| `notify` | 8.2.0 | CC0-1.0 | Ordnerüberwachung |
| `tempfile` | 3.27.0 | MIT OR Apache-2.0 | atomares Schreiben |
| `fs4` | aktuell | MIT OR Apache-2.0 | freier Platz, Dateisperre |
| `sysinfo` | 0.39.6 (`system`) | MIT | laufende Programme |
| `infer` | 0.22.0 | MIT | MIME aus Inhalt |
| `uuid`, `time`, `semver` | aktuell / aktuell / 1.0.28 | MIT OR Apache-2.0 | IDs, Zeit, Versionen |
| `arc-swap` | aktuell | MIT OR Apache-2.0 | Katalog tauschen |
| `image` | 0.25.10 (`default-features = false`, png/jpeg/tiff/webp) | MIT OR Apache-2.0 | Bilder |
| `png`, `tiff` | 0.18.1 / aktuell | MIT OR Apache-2.0 / MIT | Metadaten, Export |
| `fast_image_resize` | aktuell | MIT OR Apache-2.0 | Lanczos3 |
| `moxcms` | 0.9.x | BSD-3-Clause OR Apache-2.0 | ICC lesen, Adobe RGB/sRGB umrechnen und erzeugen |
| `resvg` / `usvg` | aktuell | Apache-2.0 OR MIT (prüfen) | SVG-Vorschaubilder |
| `tracing`, `tracing-subscriber`, `tracing-appender` | aktuell | MIT | lokale Logs |
| `ts-rs` | aktuell | MIT | TS-Typen erzeugen (nur Build/Test) |
| `winreg` (Windows) | aktuell | MIT | Registry lesen |
| `windows-sys` (Windows) | aktuell | MIT OR Apache-2.0 | Schriften-API, Prozess-Flags, Datei-Attribute |
| `plist` (macOS) | aktuell | MIT | Info.plist |
| `ort` (Feature `bgremove`, Phase 5) | 2.0.0-rc.14 (genau pinnen, `load-dynamic`) | MIT OR Apache-2.0 | ONNX Runtime (Bibliothek MIT, wird nachgeladen) |

### 10.2 Rust (nur Entwicklung/Tests/Werkzeuge)

`axum` (MIT, Test-HTTP-Server), `proptest` (MIT OR Apache-2.0), `insta` (Apache-2.0), `minisign` (MIT, Testschlüssel), `pretty_assertions` (MIT OR Apache-2.0); Werkzeuge `cargo-deny` 0.20.2, `cargo-about` 0.9.2, `cargo-nextest` 0.9.148, `cargo-llvm-cov`, `cargo-fuzz` (alle MIT OR Apache-2.0), `cargo-xwin` (MIT; akzeptiert die Microsoft-SDK-Lizenz → Nutzerentscheidung), `tauri-cli` 2.12.3, `tauri-driver` 2.1.0 (Apache-2.0 OR MIT), `minisign`-CLI (ISC) zum Signieren des Katalogs, `gitleaks` (MIT).

### 10.3 npm

| Paket | Version | Lizenz | Zweck | ausgeliefert |
|---|---|---|---|---|
| `react`, `react-dom` | 19.3.1 | MIT | UI | ja |
| `@tauri-apps/api` | 2.12.4 | Apache-2.0 OR MIT | IPC | ja |
| `@tanstack/react-query` | aktuell | MIT | IPC-Daten, Invalidierung | ja |
| `@tanstack/react-virtual` | aktuell | MIT | Bibliotheksraster | ja |
| `zustand` | aktuell | MIT | UI-Zustand | ja |
| `react-router` | aktuell | MIT | Hash-Router | ja |
| `@radix-ui/*` (Primitives) | aktuell | MIT | Fokus, Menüs, Tabs, Tooltip (DESIGN.md 10) | ja |
| `cmdk` | aktuell | MIT | Befehlspalette | ja |
| `@phosphor-icons/react` | aktuell | MIT | Symbole | ja |
| `three` | aktuell (Phase 5) | MIT | glTF-Vorschau | ja |
| `typescript` | 7.0.2 | Apache-2.0 | Typprüfung | nein |
| `vite`, `@vitejs/plugin-react` | 8.3.4 / aktuell | MIT | Build | nein |
| `@tauri-apps/cli` | 2.12.3 | Apache-2.0 OR MIT | Build | nein |
| `vitest`, `@vitest/coverage-v8` | 5.0.5 | MIT | Tests | nein |
| `@testing-library/react`, `jsdom` | 16.3.3 / 30.1.3 | MIT | Tests | nein |
| `@playwright/test` | 1.64.1 | Apache-2.0 | UI-Tests | nein |
| `@axe-core/playwright` | 4.14.0 | MPL-2.0 | Barrierefreiheit | nein |
| `webdriverio`, `@wdio/tauri-service` | aktuell / 1.5.0 | MIT | echte E2E | nein |
| `eslint`, `typescript-eslint`, `prettier`, `stylelint` | aktuell | MIT (typescript-eslint teils BSD-2) | Qualität | nein |
| `ajv` | aktuell | MIT | Schema-Prüfung (Katalog, Pakete) | nein |
| `wrangler` | aktuell | MIT OR Apache-2.0 | Seite lokal/Deploy | nein |
| `html-validate`, `@lhci/cli` | aktuell | MIT / Apache-2.0 | Seite prüfen | nein |
| `gsap` | – | GSAP Standard License (keine OSI-Lizenz) | nur nach Entscheidung (R14) | – |

### 10.4 Schriften, Daten, Bilder

| Baustein | Lizenz | Hinweis |
|---|---|---|
| Anybody, Atkinson Hyperlegible Next, Martian Mono | OFL-1.1 | in `packs/fonts/` mit `OFL.txt` und `SHA256SUMS`; Weitergabe an Programme erlaubt |
| ICC-Profile sRGB/Adobe-RGB-kompatibel | – | werden von `moxcms` erzeugt, keine fremde `.icc`-Datei |
| Stofftexturen (optional) | CC0-1.0 | Poly Haven `cotton_jersey`, `knitted_fleece` |
| Mockup-Fotos, Probe-Motiv, Vorlagen | eigenes Werk des Kollektivs | Lizenz entscheidet das Kollektiv (Vorschlag CC BY 4.0); Logos/Marke: alle Rechte vorbehalten |
| Freistell-Modell IS-Net general-use (Phase 5) | Apache-2.0 (Trainingsdaten-Vorbehalt, R15) | nicht im Installer, über Katalog nachgeladen |

### 10.5 Heruntergeladen, nicht weitergegeben

Krita (GPL-3.0-or-later), Inkscape (GPL-2.0-or-later), Blender (GPL-3.0-or-later), Kdenlive (GPL-3.0), optional GIMP (GPL-3.0-or-later) und Audacity (GPL-2.0-or-later); maßgeblich ist das `license`-Feld im Katalog, das die Recherche befüllt. Cypher Studio linkt nichts davon, startet die Programme nur als eigene Prozesse und zeigt die Lizenz vor jeder Installation. Affinity: nur Link, keine Installation.

### 10.6 Bewusst nicht verwendet

`sequoia-openpgp` (LGPL), `tauri-plugin-fs`/`-shell`/`-http` im WebView (Angriffsfläche), BRIA RMBG-1.4/2.0 (nichtkommerziell), Upscayl (laut Recherche veraltet), Electron/Flutter/Qt/Slint/Wails (0.3), Universal-macOS-Binary (A-17), GSAP bis zur Lizenzentscheidung.
