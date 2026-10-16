# Cypher Studio: Oberfläche (`apps/desktop`)

Tauri 2 · React 19 · TypeScript 6 · Vite 8. Alle Texte stehen auf Deutsch in `src/i18n`, die Gestaltung kommt aus `docs/tokens.css`.
Der Vertrag zum Rust-Kern ist `docs/ipc-contract.ts` (Alias `@contract`); die Oberfläche schickt nie Pfade, nur IDs und Handles.

## Befehle

| Befehl | Wirkung |
|---|---|
| `npm run dev` | Vite auf Port 1420. Im Browser (ohne Tauri) läuft automatisch das gemockte IPC mit deutschen Beispieldaten. |
| `npm run typecheck` | `tsc` für `src` und für Konfigurationen und Tests |
| `npm run lint` / `lint:css` / `format:check` | ESLint (mit Typen, Texte nur aus `src/i18n`), Stylelint (Tokens statt Zahlen), Prettier |
| `npm test` / `npm run test:cov` | Vitest (Logik, Engines, Mock-Handler, Gestaltungsregeln) |
| `npm run e2e` | Playwright gegen den Dev-Server: Abläufe, Tastatur, axe (WCAG 2.2 AA), Zoom, Bewegung, Rauchtest, Stilprüfung |
| `npm run e2e:csp` | Produktions-Build im Mock-Modus mit der Produktions-CSP aus `src-tauri/tauri.conf.json`; jede Verletzung scheitert |
| `npm run shots` | Bildschirmfotos nach `docs/shots/` (1280 × 800 und 1100 × 700, Papier und Tinte) |
| `npm run build` | Produktions-Build (ohne Mock) |

## Mock-Modus (Tests und Entwicklung)

`window.__CYPHER_SCENARIO__` wählt ein Szenario (z. B. `fresh`, `libraryEmpty`, `installChecksumFail`, `updateAvailable`, mehrere mit `+`),
`__CYPHER_MOCK_SPEED__` beschleunigt Aufträge, `__CYPHER_PICK__` bestimmt die Beispieldatei des Dateidialogs (`signal_v3.png` …).
`window.__CYPHER_MOCK__` zeigt gesendete Aufrufe und gespeicherte Exporte. Die Uhr steht fest auf 16.10.2026, 14:40 Uhr (Berlin).

## Aufbau

- `src/app`: Gerüst (Rail, Titelzeile, Hash-Router, Fehlergrenze, Befehle, Aufträge)
- `src/ui`: Bausteine (Schaltflächen, Eingaben, Ausgangsleiste, Bandbreite-Schrift)
- `src/ipc`: typisierte Aufrufe, Ereignisse, Channels; `ipc/mock` die Beispielwelt
- `src/features/<modul>`: eine Ansicht je Modul; `mockup/engine` und `social/engine` sind reines TypeScript (Canvas 2D, Worker)
- `e2e`: Playwright-Tests, `docs/shots`: Bildschirmfotos
