# Bauen und Prüfen (Stand 17.10.2026)

Alles unter Windows 11 mit Node 24; Rust gibt es nur in der WSL (Ubuntu 24.04), siehe `docs/BAU-REGELN.md`.

## Pakete (Einrichtungspakete, Vorlagen, Schriften)

```
node packs/tools/validate.mjs          # Quellbaum prüfen
node packs/tools/build.mjs             # packs/dist bauen (Prüfsummen, Manifest); Größenrahmen im Test: unter 16 MiB
cd packs/tools && npm test             # Prüfungen, Bau, Generatoren
```

Mockup-Vorlagen: `packs/mockups/<id>/template.json` verweist auf Ebenen neben der Datei; die für alle gleiche Melange liegt einmal als
`packs/mockups/common/heather.png` (Verweis `../common/heather.png`). `preview.png` je Vorlage ist ein Prüfbild der Entwicklung und
kommt nicht nach `dist`. Das Krita-Paket verweist für seine Vorlagen auf `packs/projects/*/files/*.kra`, damit jede Datei nur einmal
in den Installern steckt (Cloudflare-Grenze von 25 MiB für die Downloads, Risiko R18: `.deb` und `.rpm` unter 24 MiB).

## Rust (WSL)

```
wsl -d Ubuntu -- bash -lc 'source ~/.cargo/env; cd /mnt/c/Users/<du>/Code/cypher-studio && CARGO_TARGET_DIR=$HOME/target/cs cargo test --workspace'
# ebenso: cargo fmt --all -- --check, cargo clippy --workspace --all-targets -- -D warnings,
#         cargo clippy -p cypher-studio --features dev-tools --all-targets -- -D warnings
```

`cargo test` erzeugt dabei die TypeScript-Typen des Vertrags (`apps/desktop/src/ipc/generated/`).

## Release-Builds

```
wsl -d Ubuntu -- bash /mnt/c/Users/<du>/Code/cypher-studio/scripts/wsl-build.sh all
```

Ergebnis in `dist-builds/`: Windows-Setup (NSIS), `.deb`, `.rpm`, AppImage und `windows-portable/` (Programm samt `packs/` zum Testen ohne
Installation). Zuerst werden Blender-Erweiterung und `packs/dist` gebaut (Blender 5.x unter `~/apps`).

## Oberfläche

```
cd apps/desktop
npm run typecheck && npm run lint && npm run lint:css && npm run format:check
npm test                 # Vitest
npm run e2e              # Playwright gegen den Mock (Port 1420)
npm run e2e:csp          # Produktions-CSP (Port 4175)
```

## E2E gegen die echte App (`npm run e2e:real`)

Die Suite startet die echte Windows-App (WebView2) selbst, steuert sie über das DevTools-Protokoll und löscht danach ihren
Wegwerf-Datenordner. Der echte Ordner `%LOCALAPPDATA%\de.cypherxcypher.studio` bleibt unberührt (Daten, Einstellungen, Zwischenspeicher,
Protokolle und das WebView2-Profil liegen im Wegwerf-Ordner).

```
wsl -d Ubuntu -- bash /mnt/c/Users/<du>/Code/cypher-studio/scripts/wsl-build.sh e2e   # Debug-Build mit Feature dev-tools
cd apps/desktop && npm run e2e:real
```

- `CYPHER_E2E_EXE` anderer Build, `CYPHER_E2E_TMP` Wegwerf-Ordner (Standard: Temp), `CYPHER_E2E_SHOTS=<ordner>` zusätzlich Fotos
  (Papier und Tinte) der Ansichten, z. B. `docs/shots/echt`.
- Das Feature `dev-tools` (nur Debug-Build, Release bricht beim Bauen ab) liest Umgebungsvariablen: `CYPHER_DEV_TRUST_KEY` (zusätzlicher
  öffentlicher Katalogschlüssel), `CYPHER_DEV_ALLOW_LOOPBACK_HTTP=1` (http gegen 127.0.0.1), `CYPHER_DEV_ISOLATE=1` (Erkennung und
  Einrichtung sehen nur den Testordner), `CYPHER_DEV_DIALOGS=<ordner>` (native Dialoge werden aus `next.json` beantwortet).
- Installationen laufen nur gegen einen lokalen Test-Server mit kleinen Fixture-Zips und einem mit Testschlüssel signierten Katalog
  (BAU-REGELN 9); echte Programme werden nicht geladen.
