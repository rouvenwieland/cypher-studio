# Bericht Integration (alle Zonen)

Stand 17.10.2026. Zuständig: Integrations-Team (darf alle Zonen ändern). Auftrag: echte App prüfen, vier gemeldete Fehler und alles Gefundene beheben,
Pakete verkleinern, alle Tests grün, neu bauen, Fotos der echten App. Alles auf `main`, nur gezielte Pfade committet, kein Push, nichts veröffentlicht,
auf Windows nichts installiert (Installationen nur gegen einen lokalen Test-Server mit Fixture-Zips). Der echte Ordner
`%LOCALAPPDATA%\de.cypherxcypher.studio` wurde nicht angefasst (zuletzt geändert vor Beginn der Integration; die Suite legt Daten, Einstellungen, Zwischenspeicher,
Protokolle und das WebView2-Profil in einem Wegwerf-Ordner an und löscht ihn).

## 1. Die E2E-Suite gegen die echte App (`npm run e2e:real`)

- Ort: `apps/desktop/e2e-real/` (Playwright, `connectOverCDP` an WebView2), Konfiguration `playwright.real.config.ts`. Jede Datei startet die App selbst,
  Hilfen in `support/` (Start, Test-Server und signierter Test-Katalog, minisign-Schreiber, PNG/JPEG-Leser, Fotos).
- Gebaut wird ein Windows-Debug-Build mit eingebettetem Frontend und dem Cargo-Feature `dev-tools`: `scripts/wsl-build.sh e2e` →
  `dist-builds/windows-e2e/` (nur Debug-Build, ein Release mit dem Feature bricht beim Bauen ab). Das Feature liest Umgebungsvariablen:
  Testschlüssel für den Katalog, `http` gegen `127.0.0.1`, getrennte Erkennung und Einrichtung (alles unter dem Wegwerf-Ordner, kein Blick in die echte
  Registry, keine Schriftanmeldung) und native Dialoge, die aus einer Datei beantwortet werden (kein Fenster).
- Ein Testlauf im eigenen Datenordner setzt die Einzelinstanz-Sperre und das Speichern der Fenstergröße aus, damit eine laufende App des Nutzers nicht gestört wird.
- **49 Tests in 9 Dateien, alle grün (2,7 Minuten):** Erststart (4), Programme mit echter Erkennung (6), Installation gegen den lokalen Server inkl. falscher Prüfsumme (5),
  Druckprüfer mit der echten Probe-PNG samt Export (3), Bibliothek mit Testordner (6), Mockups mit den echten Vorlagen über `cyasset` (6), Social-Export (5),
  Einrichtung im Testprofil mit Anwenden und Zurücknehmen (5), Einstellungen (7). Jede Datei endet mit einer Prüfung auf Konsolenfehler und -warnungen, Seitenfehler,
  CSP-Verstöße, fehlgeschlagene Anfragen und abgelehnte IPC-Aufrufe.
- Fotos (Papier und Tinte): `CYPHER_E2E_SHOTS=docs/shots/echt npm run e2e:real` schreibt 48 Bilder (24 Ansichten, 3200 × 2000), darunter Erststart, Start, Programme,
  Installieren-Vorschau (echter Katalog und Test-Server, Prüfsumme falsch), Druck mit Bericht und nach dem Export, Mockups (leer, mit Motiv, Kontaktbogen, exportiert),
  Social, Bibliothek, Einrichtung, Einstellungen.
- Erwartete, in der Suite ausdrücklich zugelassene Ablehnungen: `app_update_check` (die Seite `studio.cypherxcypher.de` ist noch nicht veröffentlicht,
  die Oberfläche behandelt das still), `catalog_refresh` in den Einstellungen (dieselbe Ursache), `install_start` bei der absichtlich falschen Prüfsumme.

### Was die Suite beim Bauen an der Suite selbst gelehrt hat
- Tauri macht `__TAURI_INTERNALS__.invoke` unveränderbar, Abfangen geht nur im Frontend: `src/ipc/commands.ts` hat einen Haken (`__CYPHER_IPC_ERRORS__`, ohne Liste kostenlos).
- Das Neuladen der Seite (für das Einspielen der Prüfskripte) bricht laufende IPC-Anfragen ab („IPC custom protocol failed“, „Couldn't find callback id“): diese Meldungen zählen nicht.
- WebView2 legt sein Profil unter `%LOCALAPPDATA%\de.cypherxcypher.studio\EBWebView` an (Tauri-Vorgabe, auch mit `CYPHER_STUDIO_DATA_DIR`); die Suite setzt `WEBVIEW2_USER_DATA_FOLDER`.
- Pfade zeigt die App mit „~“ für den echten Heimatordner; Tests schreiben sie wieder aus.

## 2. Gefundene Fehler: Ursache und Behebung

| # | Fehler | Gefunden | Ursache | Behebung (Test) |
|---|---|---|---|---|
| 1 | Gelbe Warnung „Keine Verbindung zum Cypher-Manifest“ bei den Programmen, obwohl der eingebaute Katalog reicht | echtes Fenster | Banner hing an `catalog.lastError`; die Online-Prüfung beim Start scheitert, solange `studio.cypherxcypher.de` nicht veröffentlicht ist | Warnung nur bei `expired`, sonst eine ruhige Zeile „Programm-Katalog vom 16.10.2026 (eingebaut)“; „Manifest“ heißt überall „Programm-Katalog“ (Settings, Dialoge, Mock; `texts.test.ts` verbietet das Wort). Mock-Szenario `catalogExpired`, Playwright (2) und `e2e-real/02`, `09` |
| 2 | Version statt „–“: nicht installierte Programme zeigten einen Strich | echtes Fenster | `versionLabel` kannte nur installierte Versionen | `availableVersion` im Zustand, Anzeige „5.2.2 verfügbar“ (nur wenn für dieses System ein Artefakt da ist). Vitest (3), Playwright, `e2e-real/02` gegen `catalog.json` |
| 3 | Erststart zeigte fest „CYPHER STUDIO 0.4.0“ | echtes Fenster | feste Zeichenkette im Quelltext, Mock-Version 0.4.0 | Version aus `app_info` (Mock und Fixtures 0.1.0); `e2e-real/01` vergleicht mit `app_info` |
| 4 | Ausweich-Katalogquelle zeigte auf `cypher-kollektiv/cypher-studio` | Prüfung | Adresse an vier Stellen verstreut | Eine Konstante in `crates/cypher-core/src/sites.rs` (`github.com/rouvenwieland/cypher-studio`, App-Seiten `/anleitung`, `/releases`); Tests gegen `Cargo.toml` und `tauri.conf.json` (Updater), `tests/app.rs` prüft die geöffneten Adressen; ARCHITEKTUR A-12 angepasst |
| 5 | „Später weitermachen“ in der Kennung sprang bei langsamem Speichern zurück in den Erststart | Suite | Die Hülle schickt bei Status „nicht begonnen“ sofort zurück; die Weiterleitung kam vor dem Speichern | erst nach dem Speichern weiterleiten (`later`, `finish`). Playwright mit künstlich langsamem `settings_update` (neuer Mock-Haken `__CYPHER_MOCK_DELAY__`), `e2e-real/01` |
| 6 | Erststart ohne Vorauswahl (CONCEPT: Krita und Inkscape) | Suite | Rust-Standard `selectedPrograms = []`, der Mock setzte die Auswahl selbst | Rust-Standard `["krita","inkscape"]`, Rust-Test, `e2e-real/01` |
| 7 | Einzeltasten (K, U, G …) taten nichts | Suite | Rust-Standard `singleKeyShortcuts = false`, die Oberfläche nimmt „an“ an (laut CONCEPT/DESIGN nur bei Fokus in der Vorschau, abschaltbar) | Rust-Standard `true`, Rust-Test, `e2e-real/06` (Taste K) |
| 8 | Bibliothek zeigte nach der Ordnerwahl „0 von 5 Dateien“ und blieb so (4 von 5 Läufen) | Suite | `library_use_root` meldet `rootChanged`, bevor das Einlesen fertig ist; TanStack Query hängt eine Invalidierung an eine laufende Abfrage ohne Daten an, die veraltete Antwort blieb, „Scan fertig“ ging verloren | `invalidateFresh()` lädt nach dem Ende der laufenden Abfrage noch einmal (Vitest belegt den Fehler und die Behebung), `e2e-real/05` |
| 9 | Druckprüfer: Ausgangsleiste versprach 3307 × 4319 px, geschrieben wurden 3136 × 4096 px | Suite (Datei nachgemessen) | Die Leiste rechnete immer auf die geplante Breite, Rust vergrößert ohne „Vergrößern erlauben“ nie | `exportSize()` rechnet wie `export::plan`; Vitest (3), `e2e-real/04` vergleicht Leiste und Datei |
| 10 | Druckprüfer: Befund mit gewählter Korrektur („wird beim Export behoben“) sperrte den Export weiter | Suite | nur das Etikett las die vorgemerkten Korrekturen, das Urteil nicht | `withQueuedFixes()` macht daraus Info; Vitest (2), Playwright, `e2e-real/04` (Export ohne „Trotzdem“) |
| 11 | Bibliothek fragte ohne Ordner `library_query` und bekam `libraryNotConfigured` | Suite (IPC-Haken) | Abfrage lief vor der Statusabfrage | Abfrage erst bei eingerichteter Bibliothek; Playwright (kein `library_query` ohne Ordner) |
| 12 | Ausgangsleiste (gesperrt, 1280 px): „Shirtigo P. · 3136 … · 30… · Ado… · ca.…“ | Foto der echten App | Jeder Eintrag schrumpfte einzeln mit Auslassung | ganze Einträge oder gar keine (das „·“ gehört zum Eintrag), Messzeile hat Mindestbreite, der Grund kürzt sich zuerst; Playwright misst bei 1280 und 1536 px |

Keine App-Fehler, sondern Eigenheiten der Testumgebung (in der Suite berücksichtigt): Auswahl in der Bibliothek geht verloren, wenn die entprellte Suche die Liste ersetzt
(Test wartet auf die Liste), `getImageData`-Hinweis von Chrome stammt aus der eigenen Messung der Suite, Mockup-Export braucht ein Projekt („Erst ein Projekt wählen“ führt zu „Neues Projekt“, so gewollt).

## 3. Pakete und Größen (Risiko R18)

- `packs/dist`: **23,8 → 15,4 MiB.** `heather.png` (0,84 MiB × 4, byte-gleich; 2,5 MiB gespart) liegt einmal in `packs/mockups/common/` (Verweis `../common/heather.png`, Schema `layerPath`, Rust-Lader,
  Mock und Blender-Bau angepasst); `preview.png` der Mockup-Vorlagen (3,1 MiB gespart) kommt nicht nach `dist`; die Krita-Vorlagen (2,8 MiB) stehen nur noch unter `projects/*/files/`
  (das Krita-Paket verweist dorthin); `validate.mjs` meldet byte-gleiche Mockup-Ebenen, ein Test hält `dist` unter 16 MiB.
- `packs/dist/blender/pack.json` trägt jetzt die SHA-256 von `dist/cypher_export-1.0.0.zip` (Hinweis aus Team A, Abschnitt 8); `validate --dist` prüft sie.
- Installer (Release, `scripts/wsl-build.sh all`, neu gebaut am 17.10.2026 aus dem letzten Stand):

| Datei | vorher | jetzt |
|---|---|---|
| `.deb` | 26,08 MiB | **20,26 MiB** |
| `.rpm` | 26,11 MiB | **20,28 MiB** |
| AppImage | 97,35 MiB | 94,26 MiB |
| Windows-Setup (NSIS) | 19,29 MiB | 16,17 MiB |

  `.deb` und `.rpm` liegen damit unter 24 MiB (Cloudflare-Grenze 25 MiB, Risiko R18) mit 3,7 MiB Luft.

## 4. Vertrag 0.3.0 (additiv)

Übernommen aus den Teamberichten: `UndoReport.extensionsRemoved`, `EntityKind` um `catalogLink` und `setupPack`, Kommentare zu `AppCloseReq.force` und `files:dropped.position`.
Nicht übernommen (nicht additiv oder ohne Verbraucher): `printcheck_export` mit `null` bei Abbruch (Team A 3), `PrintReport.checks` (Team B 1), `image_probe` (Team B 2),
`MockupDocument.exportColorIds` (Team B 3, die Oberfläche speichert die Dokumente nicht), `files:dropped`-Zone (Team B 5), Schriftpfade in `tokens.css` (Team B 4).
`docs/ipc-contract.ts` und `IPC_CONTRACT_VERSION` stehen auf 0.3.0, ts-rs hat `EntityKind.ts` und `UndoReport.ts` neu erzeugt, Vertragstest und Fixtures grün.

## 5. Testzahlen (17.10.2026)

| Prüfung | Ergebnis |
|---|---|
| `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings` (auch `-p cypher-studio --features dev-tools`), `cargo deny check` | sauber |
| `cargo test --workspace` (WSL) | **569 bestanden**, 0 fehlgeschlagen, 5 ignoriert (Kern 402, app 16, archive 14, catalog 14, contract 6, detect 4, download 18, install 12, library 14, printcheck 27, setup 23, cli 6, Tauri 13) |
| Vitest | 30 Dateien, **508 Tests** |
| Playwright gegen den Mock (`npm run e2e`) | **224 Tests** (219 vorher + 5 neue), grün |
| `npm run e2e:csp` | 3 Tests, 0 Verletzungen |
| `tsc`, ESLint (mit `e2e-real`), Stylelint, Prettier | sauber |
| `packs/tools`: `validate` / `npm test` | 2061 Prüfungen, 0 Fehler; 52 Tests, 46 grün, 6 übersprungen (Smoke-Test-Auswertung) |
| `packs/blender/tests/run_matrix.sh` (Blender 5.2 und 4.5) | alle Prüfungen bestanden, inkl. Mockup-Grundlagen mit gemeinsamer Melange |
| `site`: `npm test` | 129 Tests grün |
| **`npm run e2e:real`** | **49 Tests grün** |

## 6. Offen

- macOS: nichts gelaufen (kein Mac). Linux-Pakete: gebaut, nicht gestartet (die echte Oberfläche lief nur unter Windows).
- Die E2E-Suite läuft nur unter Windows (WebView2) und braucht den Debug-Build aus der WSL (`docs/BAUEN.md`).
- Das Release-Bundle wurde nicht gestartet (ein Release ignoriert `CYPHER_STUDIO_DATA_DIR`, ein Start hätte den echten Ordner berührt).
- `site/site.config.json` hat `repoUrl: null` (privates Repository); mit der Veröffentlichung dort `https://github.com/rouvenwieland/cypher-studio` eintragen.
- Commit-Zeile: BAU-REGELN nennen „Claude Opus 5.5“, die Sitzung ist Sonnet 5.5; wie Team A habe ich den zutreffenden Namen `Claude Sonnet 5.5` benutzt.
- Nicht von mir und nicht angefasst: die geänderten Symbole unter `apps/desktop/src-tauri/icons/`, `docs/reports/review-ui.md`, `scripts/real-app-shots.mjs` und `scripts/real-app-walk.mjs` (liegen unverändert uncommittet im Baum; die Skripte sind durch `e2e-real` mit `CYPHER_E2E_SHOTS` ersetzt).
- Aufgeräumt: Wegwerf-Ordner der Suite, Sonden und Zwischenstände liegen im Scratchpad der Sitzung und sind gelöscht.
