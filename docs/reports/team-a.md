# Bericht Team A: Rust-Kern, Tauri-Schicht, Kommandozeile

Stand 17.10.2026. Zone: `crates/**`, `apps/desktop/src-tauri/**`, `catalog/**`, Erzeuger der TypeScript-Typen, `Cargo.lock`, `deny.toml`,
`scripts/probe-linux.sh`, `docs/contract-fixtures/**`, `docs/third-party/A.md`, dieser Bericht. Alle Arbeit auf `main`, nur eigene Pfade
committet, keine Pushes. Commits: `bd372d7` (Phase 0), `9856940`, `fa453c1`, `1b5703c`, `536ebd8`, `d493d6c`, `95f6e1f`, `d86a2ec`, `71a906e`,
`e7bf829`, `07d65d1`, `99c6976` und der letzte Commit dieses Berichts.

## 1. Stand je Modul

| Modul | Stand | Wie geprüft |
|---|---|---|
| `api` (DTOs, Vertrag) | 71 Commands, alle Ereignisse, Fehlerarten; `ts-rs` erzeugt `apps/desktop/src/ipc/generated/`, Vertragstest gegen `docs/ipc-contract.ts`, 50 Fixture-Ordner als Round-Trip | `tests/contract.rs` |
| `platform`, `settings`, `state`, `jobs`, `plans` | fertig; atomares Schreiben, Wiederholung bei kurzen Windows-Sperren, Rechte 0644 für Dateien, die weitergegeben werden | Unit- und Windows-Tests |
| `catalog` | eingebettet, Cache, Fernabruf, höchste Sequenz, Rollback-Schutz, minisign; Schema-Prüfung; Hostliste fest eingebaut | `tests/catalog.rs`, `cypher catalog verify` |
| `verify`, `download` | SHA-256, minisign, OpenPGP (rPGP; Krita-AppImage RSA durchgesetzt, Inkscape DSA/SHA-1 nur Information); Fortsetzen per Range, Wiederholungen, Hostprüfung mit Weiterleitungen | `tests/download.rs`, echte Krita-AppImage (381 MB) mit Katalogschlüssel |
| `install` | zip, tar.xz, tar.gz, 7z, 7z-SFX, AppImage (FUSE-Rückfall), dmg; Zip-Slip, Symlinks, Hardlinks, Geräte, Duplikate, Bomben; atomar über Zwischenordner und Journal; Wiederherstellung beim Start | `tests/archive.rs`, `tests/install.rs`, echte Inkscape-7z und Kdenlive-SFX |
| `detect`, `launch` | Windows (Registry nur lesend, bekannte Pfade), macOS, Linux (PATH, Flatpak, Snap, AppImage, .desktop); Start entkoppelt | Fixtures je Betriebssystem, Windows-Test gegen die echte Registry (nur lesend) |
| `printcheck` | Analyse (Alpha, Geisterpixel, Auflösung, Format, Farbe, Fläche), Export (Zuschnitt, Skalieren Lanczos mit vormultipliziertem Alpha, Korrekturen, Adobe-RGB-kompatibles Profil über moxcms, pHYs 11811, `.shirtigo.json`), erneute Prüfung der Ausgabe | `tests/printcheck.rs`, CLI-Lauf auf Linux und Windows |
| `setup` | Pakete aus `packs/dist` (Krita, Inkscape, Blender, Kdenlive, Schriften), Wurzeln je Programm und System, Konflikte, Sicherungen, Journal, Zurücknehmen, Schriften (Windows: Registrierung, Linux: fc-cache einmal je Stapel), Blender-Erweiterung über die Blender-Kommandozeile samt Entfernen beim Zurücknehmen | `tests/setup.rs`, echte Pakete, echtes Blender 5.2.2 |
| `library` | Index im Zwischenspeicher, Metadaten als Nebendateien, Umbenennungserkennung, Sync-Konfliktkopien, Abfrage, Vorschaubilder (Bild, SVG, .kra, .blend), Überwachung (1 s entprellt), `.cypherpack` (Austausch) | `tests/library.rs` |
| `projects`, `brand` | Projekte und Vorlagen (25 mitgelieferte), Dokumente der Module, Marke, Mockup- und Social-Vorlagen mit `cyasset`-URLs | Unit-, App- und Windows-Tests |
| `bgremove` | Farbschlüssel mit Flutfüllung vom Rand und weicher Kante; Modellverfahren nicht gebaut (`modelFeature = false`) | Unit- und App-Tests |
| `app` (neu) | Eine Anwendungsschicht (`App`) trägt alle Abläufe der Commands, ohne Tauri; Ereignisse unter den Namen des Vertrags; Auslieferung der Protokolle (`serve`), „Im Browser öffnen“ und „Im Ordner zeigen“ (`shell_ops`) | `tests/app.rs` (16 Tests) |
| `src-tauri` | Alle 71 Commands dünn und gebaut, Capability und AppManifest je Command, Protokolle `cyfile`/`cythumb`/`cyasset` (CORS, nosniff), Dialoge nur aus Rust, Ereignisse, Fortschrittskanäle, Ziehen und Ablegen, Schließen-Wächter, Updater-Kleber (Prüfung 10 s nach dem Start nach Häufigkeit), Protokolldatei (7 Tage), Fehlerdialog beim Start | Mock-Runtime-Tests, echtes Fenster auf Windows (siehe 3) |
| `cypher-cli` | `catalog verify/check/keygen/sign`, `detect`, `install <id>` (erst Plan, dann nur mit `--yes`), `printcheck <datei>` (Prüfung und Export), `setup list/apply/undo` | `tests/cli.rs` gegen lokalen Server |
| Linux-Probe | `scripts/probe-linux.sh`: echtes Blender 5.2.2 (siehe 3) | echter Lauf |

## 2. Qualitätstore und Testzahlen

- `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings` (Linux **und** Ziel `x86_64-pc-windows-msvc`), `cargo deny check`
  (advisories, bans, licenses, sources ok) sauber.
- **Linux (WSL), `cargo test --workspace`: 562 bestanden, 0 fehlgeschlagen, 5 ignoriert** (drei brauchen echte Dateien und liefen einzeln grün,
  siehe 3; zwei sind Leistungsproben, die nur im Release-Build laufen, siehe 3a). Aufteilung: Kern-Unit 396, `app` 16, `archive` 14, `catalog` 14, `contract` 6, `detect` 4, `download` 18, `install` 12,
  `library` 14, `printcheck` 27, `setup` 23, `cypher-cli` 6, `src-tauri` 12.
- **Windows, natives Starten der mit `cargo xwin` gebauten Testdateien: 559 bestanden, 0 fehlgeschlagen**, darunter 9 reine Windows-Tests
  (`crates/cypher-core/tests/windows.rs`) und die Tauri-Tests (Ursprung `http://tauri.localhost`).
- Kein `unwrap`/`expect`/`panic` außerhalb von Tests (Lint verbietet es), ein einziger `unsafe`-Ort (zwei Win32-Aufrufe für Schriften).
- Abhängigkeiten stehen mit Version, Lizenz und Zweck in `docs/third-party/A.md`.

### Windows-Tests wiederholen (ohne Rust auf Windows)
```
# in der WSL
export CYPHER_EMBED_TEST_MANIFEST=1                       # Manifest mit Common Controls v6, sonst startet die Tauri-Testdatei nicht
cargo xwin test --workspace --no-run --target x86_64-pc-windows-msvc
# die *.exe aus target/x86_64-pc-windows-msvc/debug/deps (und debug/cypher.exe) nach Windows kopieren, dann dort:
$env:CYPHER_TEST_REPO   = 'C:\...\cypher-studio'          # beim Cross-Build steht in CARGO_MANIFEST_DIR ein Linux-Pfad
$env:CYPHER_TEST_BIN    = '<ordner>\cypher.exe'           # für die Kommandozeilen-Tests
$env:CYPHER_STUDIO_DATA_DIR = '<temp>'                    # Vorsicht: alles landet dort
& .\cypher_core-*.exe ; & .\windows-*.exe ; ...
```
Die Tests installieren nichts auf dem Rechner und melden keine Schrift an: die echte Schriftenanmeldung (`AddFontResourceW`, Registry) ist nur
übersetzt und über den Fälscher getestet. Erkennung liest die echte Registry nur lesend.

## 3. Echte Läufe (nicht nur Tests mit Fälschern)

**Linux-Probe in der WSL (`scripts/probe-linux.sh --keep`, grün, zweimal wiederholt):**
1. Plan für Blender: Quelle `download.blender.org`, Linux-x64-tar.xz (365,5 MB), SHA-256 `84098912…a168`, Lizenz GPL-3.0-or-later.
2. Die Prüfsumme aus dem Katalog ist dieselbe, die blender.org in `blender-5.2.2.sha256` veröffentlicht.
3. Installation mit `cypher install blender --yes`: Download, Prüfsumme, Entpacken, Registrieren in einen Probe-Ordner (nichts im Benutzerprofil).
4. `blender --version` aus dem Probe-Ordner: „Blender 5.2.2 LTS, build date 2026-09-15“.
5. **Negativtest:** dieselbe Datei mit einem umgedrehten Byte, von einem lokalen Server geliefert (Katalog mit Testschlüssel signiert): Abweisung
   `checksumMismatch`, kein Programmordner, keine Reste im Zwischenordner.
6. Druckprüfer: `probe-motiv.png` exportiert (3136 x 4096 px, 300 dpi, Adobe RGB 1998), erneute Prüfung „Ok“.
7. Danach (von Hand im Probe-Ordner): `cypher setup apply blender --yes` gegen das **echte** Blender 5.2.2: die Erweiterung wird von der echten
   Blender-Kommandozeile installiert (`blender --command extension list` zeigt „cypher_export [installed]“ im Repository „User Default“), die
   App-Vorlage liegt in `portable/scripts/startup/bl_app_templates_user/cypher_ps2`, und `bpy.utils.extension_path_user(...)` liefert genau
   den Pfad, den `blenderExtensionConfig` annimmt (**Annahme bestätigt**). Dieser Lauf zeigte, dass das Zurücknehmen die Erweiterung stehen ließ;
   behoben (Commit `07d65d1`, `blender --command extension remove`).

**Echte Dateien (ignorierte Tests, einzeln grün):** Krita-AppImage (381 MB) gegen `.sig` mit dem Schlüssel aus dem Katalog, dazu dieselbe Datei mit
verändertem Byte (abgewiesen); Inkscape-7z (BCJ2) und Kdenlive-Standalone-SFX entpacken.

**3a. Leistungsproben (nur Release, `cargo test --release`, ohne LTO):** Analyse eines vollen Druckflächen-PNG (3898 x 5315) unter 1,5 s und die
Bibliotheksprobe grün (`printcheck` 28 und `library` ohne Ausfall).

**Echte Windows-App (nativ gestartet, nur im Testordner mit `CYPHER_STUDIO_DATA_DIR`, nichts installiert, danach beendet):** Debug-Build mit eingebettetem
Frontend (`--features tauri/custom-protocol`), gesteuert über das Debug-Protokoll von WebView2:
- Das Fenster lädt `http://tauri.localhost/#/erststart` und zeigt die Erststart-Ansicht (Schrift Anybody über `cyasset`).
- Aufrufe über die IPC antworten: `app_info`, `programs_list` (4 Programme), `settings_get`, `network_info` (`telemetry = false`, die Hostliste),
  `print_profiles_list` (10), `setup_packs_list`, `templates_list` (25), `brand_get`, `mockup_templates_list`, `samples_list`.
- Gesperrt wie vorgesehen: `plugin:dialog|open` („not allowed“), unbekannter Command, `plugin:fs|read_file` („Plugin not found“).
- `cyasset`: Schrift 200 `font/ttf`, Maske 200 und auf einer `OffscreenCanvas` gezeichnet und exportiert (CORS stimmt, die Leinwand ist nicht „tainted“);
  `..%2Fmanifest.json` 404. `cyfile`: Beispielmotiv 200 `image/png` (als Vorschau 3186 x 4096 statt 3898 x 5315), zeichnen und exportieren
  klappt; unbekannte Kennung 404.
- CSP: Abruf von `https://example.org/` wird von `connect-src` blockiert.

## 4. In echten Läufen gefundene und behobene Fehler

| Fund | Wo gefunden | Behebung |
|---|---|---|
| `fc-cache` lief je Schriftdatei: 43 s für das Schriftenpaket (WSL) | `cypher setup apply fonts` | einmal je Ordner nach dem Stapel (`FontInstaller::flush`; Windows: eine Meldung `WM_FONTCHANGE` statt je Datei) |
| Exporte, Pakete, Diagnose hatten `0600` (Temp-Datei) | Linux-CLI-Lauf | `0644` vor dem Umbenennen |
| Umbenennen/Ersetzen scheitert unter Windows kurz mit „Zugriff verweigert“, wenn ein Virenscanner die Datei offen hält | Windows-Test | bis 10 s mit wachsender Wartezeit wiederholen (`write_atomic`, Ordner umbenennen, Download-Datei, Pakete) |
| `canonicalize` lieferte unter Windows Pfade mit `\\?\` (Anzeige, Programmargumente, Dateimanager) | Windows-App-Test | `simplify_path` (kurze Pfade zurückverwandelt); dabei fing der Windows-Test einen Folgefehler in `remove_dir_managed` ab, der die Wurzel nicht mehr erkannt hätte |
| Erkennung meldete dieselbe Installation zweimal (Registry mit `\`, bekannte Pfade mit `/`) | Windows-Test | Pfade vor dem Vergleich vereinheitlichen, Groß/Klein auf Windows ignorieren |
| `install_preview` für unbekanntes Programm meldete `installation` statt `program` | Tauri-Test | Fehlerart `notFound{program}` |
| `project_forget` entfernte Projekte im Projektordner nur aus dem Index, sie erschienen sofort wieder | App-Test | im Projektordner `invalidInput`; vergessen nur für Projekte außerhalb |
| Zurücknehmen ließ die mit Blender installierte Erweiterung stehen | echtes Blender | siehe 3 |

## 5. Abweichungen von der Vorgabe und Annahmen

- **Commit-Zeile:** BAU-REGELN nennen „Claude Opus 5.5“, die Sitzung verlangt `Co-Authored-By: Claude Sonnet 5.5`; ich habe die zweite (zutreffende) benutzt.
- Fenster-Mindestgröße auf 1024 x 680 gesetzt (Vorgabe des Hauptchats), Standard 1280 x 800.
- `strict_names` (Windows-Namensregeln beim Entpacken) ist nur auf Windows und macOS an; auf Linux sind `README.TXT` und `readme.txt` zwei Dateien.
- **Dünne Linien** (Regel `thinLines`): die Erkennung ist nicht gebaut (`minStrokePx = null`, Überlagerung leer). Alles andere der Analyse ist fertig.
- Halbtransparenz „Raster“ ist eine einfache 8 x 8-Bayer-Matrix; Geisterpixel werden beim Export über den Zuschnitt praktisch immer entfernt.
- SVG-Vorschaubilder ohne System-Schriften (nur die Markenschriften aus den Paketen).
- `bgremove_model_install` und `bgremove_model_preview` antworten `notFound`; das Modellverfahren ist ein späterer Ausbau.
- `cyfile` liefert TIFF, 16 Bit und Bilder über 4096 px als PNG-Vorschau (höchstens 4096 px Kantenlänge, zwischengespeichert, höchstens 40 Dateien).
  Wer das Original in voller Größe braucht (Mockup-Ausgabe in voller Größe), muss es über den Pfad der Rust-Seite verarbeiten, nicht über `cyfile`.
- Keine Bereichsanfragen (`Range`) in den Protokollen (Bilder und Schriften brauchen sie nicht).
- Die Projektordner-Werte von `ProjectFolder` stehen im JSON als Ordnernamen (`"Export/Social"`), wie im Vertrag.
- `app_close` ohne `force` bei laufenden Aufträgen: Fehler `busy{jobRunning}`; mit `force` werden Aufträge abgebrochen und bis 10 s auf ihr Aufräumen gewartet.
- `printcheck_export` mit Ziel „Dialog“: bricht die Nutzerin den Speichern-Dialog ab, kommt `cancelled` (der Rückgabetyp ist nicht nullbar). `library_pack_export`,
  `export_save_image` und `diagnostics_export` liefern bei Abbruch `null`.
- `AppPage`-Adressen sind in Rust fest: Hilfe `https://studio.cypherxcypher.de/anleitung/`, Versionshinweise `…/releases/`, Downloads `…/`,
  Quellcode und Drittanbieter aus `repository` in `Cargo.toml` (`github.com/rouvenwieland/cypher-studio`). **Bitte bestätigen**, solange das Repository privat ist.
- `RevealTarget.printProfiles` öffnet den Katalog-Zwischenspeicher (dort liegen die Druckprofile als Teil des Katalogs).
- Annahme `processingarea_type` in `.shirtigo.json` (snake_case-Zeichenketten) ist unverändert eine Annahme; Shirtigo veröffentlicht keine Schemadatei.
- Blender „portable“: bei Cypher-Installationen unter Windows und Linux legt die Einrichtung ein Verzeichnis `portable` neben die Startdatei (bestätigt mit echtem Blender).

## 6. Offen oder nicht geprüft

- **macOS:** nichts gelaufen (kein Mac). dmg-Einhängen, Notarisierungsprüfung, `.app`-Namen und Krita-dmg sind nur gegen Fälscher getestet.
- **AppImage-FUSE-Rückfall:** nur mit Fälscher; die WSL hat kein FUSE 2, ein echter Lauf steht aus.
- **Windows:** keine echte Programm-Installation (Regel), also auch nicht der Pfad „Blender-ZIP nach `%LOCALAPPDATA%`“ mit echtem Virenscanner im Weg
  (die Wiederholung bei Sperren ist mit gehaltenen Dateien getestet). Schriftenanmeldung (`AddFontResourceW`) nicht ausgeführt.
- **App-Fenster:** die echte Windows-App wurde nur als Debug-Build mit eingebettetem Frontend und nur mit lesenden Aufrufen geprüft; die Oberfläche im Ganzen
  (Klicks durch alle Ansichten) ist Sache von Team B. Kein Release-Bundle (NSIS) gebaut, kein Updater-Lauf (die Endpunkte gibt es noch nicht).
- **Fernkatalog und Updater** gegen echte Server (die Seite ist noch nicht veröffentlicht): getestet nur gegen den lokalen Server; ein Fehler beim Start
  wird still protokolliert.
- Bibliothek: Überwachung auf Netzlaufwerken und sehr große Ordner (> 200 000 Dateien) nicht gemessen.
- `cargo deny`: ausgenommen mit Begründung in `deny.toml` sind `RUSTSEC-2023-0071` (rsa, nur Prüfen), `RUSTSEC-2026-0367/0368/0369` (zip 4.6.1 im
  Updater-Plugin, wir rufen dessen `extract` nicht auf) und `RUSTSEC-2024-0370`. Erledigt sich mit einem Update von `tauri-plugin-updater`.

## 7. Vertragswünsche (docs/ipc-contract.ts nicht verändert)

1. `UndoReport` um `extensionsRemoved: number` erweitern (Zahl der mit Blender entfernten Erweiterungen), damit die Oberfläche sagen kann, was zurückgenommen wurde.
2. `EntityKind` um `catalogLink` und `setupPack` ergänzen (heute: `invalidInput` bzw. `setupScope`).
3. `printcheck_export`: Ergebnis `PrintExportResult | null` (Abbruch des Dialogs) statt Fehler `cancelled`, damit alle Dialog-Commands gleich antworten.
4. `AppCloseReq`: im Vertrag festhalten, dass `force: false` bei laufenden Aufträgen `busy` liefert (so gebaut).
5. `FilesDropped.position` ist in CSS-Pixeln (logisch) umgerechnet; im Vertrag als Kommentar festhalten.

## 8. Hinweise an andere Teams

- **Team B:** Ereignisse und Kanäle laufen wie im Vertrag; `files:dropped`-Position in CSS-Pixeln; `app:closeRequested` -> Dialog -> `app_close{force:true}`.
  `cyfile`-Vorschau (siehe 5): das Mockup-Modul sieht für große Motive die verkleinerte Fassung; `printcheck_export` und `export_save_image` arbeiten mit dem Original.
  Abbruch eines Dialogs: `null` bzw. `cancelled`, still behandeln.
- **Team C (Blender-Paket):** `packs/dist/blender/pack.json` trägt für `dist/cypher_export-1.0.0.zip` keinen Eintrag in `sha256`. Der Lader lässt das für
  Aktionen zu (die Datei wird vor dem Aufruf mit dem Plan geprüft); der Bauschritt sollte den Hash trotzdem eintragen.
- **Hauptchat:** `AppPage`-Adressen bestätigen (siehe 5); die Seite `studio.cypherxcypher.de/releases/latest.json` muss gleichzeitig mit dem ersten Release
  stehen, sonst protokolliert die App beim Start eine fehlgeschlagene Prüfung (still).

## 9. Bedienung der Kommandozeile (für CI und Probe)

```
cypher catalog verify [datei] [--key pub]      # Signatur, Schema, Hosts
cypher detect [--json]                          # nur lesend
cypher install <programm> [--version V] [--yes] # ohne --yes: Plan zeigen, nichts laden
cypher printcheck <datei> [--profile ID] [--garment schwarz] [--width-mm 266] [--semi threshold] [--export ziel] [--fail-on error|warning|never]
cypher setup list | apply <paket> [--scope ID] [--yes] | undo <id>
# global: --data-dir <ordner> (alles darunter, auch der Heimatordner der Einrichtung), --packs <packs/dist>,
#         Entwicklung: --trust-key <pub>, --allow-loopback-http
```
