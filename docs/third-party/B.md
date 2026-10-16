# Drittbausteine Zone B (Oberfläche `apps/desktop`)

Stand 16.10.2026. Alle Versionen exakt gepinnt (`apps/desktop/package.json`, `package-lock.json`, keine `^` oder `~`). Lizenzen aus den installierten Paketen gelesen (`node_modules/<paket>/package.json`). Keine npm-Workspaces. Nichts global installiert. `THIRD_PARTY.md` führt der Hauptchat zusammen.

## Ausgeliefert (landet im Bundle der App)

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

Eigener Code, keine Fremdbibliothek: die Mockup-Engine (`src/features/mockup/engine`, Canvas 2D, Worker, OffscreenCanvas), die Layout-Engine des Social-Generators (`src/features/social/engine`), der Farbschlüssel zum Freistellen (Vorschau), FitText („Bandbreite“), der Mock des IPC. Die Beispielbilder und Textilebenen des Mocks werden zur Laufzeit gezeichnet (`src/ipc/mock/art.ts`), es liegen keine fremden Bilder im Repository.

## Nur Entwicklung, Bau und Tests (nicht ausgeliefert)

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

## Geprüft, bewusst nicht verwendet

- GSAP und jede Animationsbibliothek (BAU-REGELN 7): Bewegung ist CSS und die Web Animations API (Einrasten des Namens).
- CSS-in-JS, Tailwind, Komponentenbibliotheken mit eigenem Stil: widersprechen `style-src 'self'` und der Formsprache (Radius 0, Haarlinien).
- `lucide-react`, Emoji als Symbole: Phosphor Regular genügt, Emoji sind per Test verboten (`src/design-rules.test.ts`).
- Fremde Mockup-Vorlagen und Shirt-Fotos: Platzhalter-Vorlage wird gezeichnet, die echten Vorlagen liefert Team C2 als Paket.
- Adobe-Produktnamen, -Logos und -Icons: nirgends enthalten (Test `design-rules`). Vorkommen von „Adobe RGB“ ist der Farbraum der Shirtigo-Druckvorgabe (`adobeRgb` im Vertrag) und bleibt als Sachbegriff.
- `@tauri-apps/plugin-opener` (JS): nicht nötig, die Oberfläche ruft den Command `app_open_external`; das Plugin selbst liegt in Zone A (Rust).
