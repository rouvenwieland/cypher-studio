# Drittbausteine Zone D (Downloader-Seite `site/`)

Stand 16.10.2026. Alle Versionen exakt gepinnt (`site/package.json`, `site/package-lock.json`). Nichts davon wird mit der App ausgeliefert. Ausgeliefert wird nur das Ergebnis des Baus (`site/dist/`: HTML, CSS, zwei kleine Skripte, drei Schriften). `THIRD_PARTY.md` führt der Hauptchat zusammen.

## Ausgeliefert (liegt in `site/dist/`)

| Baustein | Version | Lizenz | Zweck | Quelle |
|---|---|---|---|---|
| Anybody (variabel, woff2) | wie im Projekt `cypher-start` | OFL-1.1 | Kennung, Überschriften, Programmnamen | `site/public/fonts/anybody.woff2`, Lizenztext `Anybody-OFL.txt` liegt daneben und wird mit ausgeliefert |
| Atkinson Hyperlegible Next (variabel, woff2) | wie `cypher-start` | OFL-1.1 | Fließtext, Bedienung | `site/public/fonts/atkinson.woff2` + `AtkinsonHyperlegibleNext-OFL.txt` |
| Martian Mono (variabel, woff2) | wie `cypher-start` | OFL-1.1 | Messwerte, Prüfsummen, Etiketten | `site/public/fonts/martian-mono.woff2` + `MartianMono-OFL.txt` |

Die Schriften sind unverändert aus `C:\Users\Nevuor\Code\cypher-start\site\assets\fonts` übernommen (dort bereits als woff2 vorhanden, Unterschriften im Original: `packs/fonts/`). Eigene Skripte (`boot.js`, `site.js`) und eigene Zeichnungen (`drawings.mjs`) stehen unter der Projektlizenz (MIT). Kein CDN, keine Bibliothek im Browser, kein GSAP (BAU-REGELN 7, ARCHITEKTUR R14).

## Nur Entwicklung, Bau und Tests (nicht ausgeliefert)

| Paket | Version | Lizenz | Zweck |
|---|---|---|---|
| `marked` | 18.1.1 | MIT | Markdown (`site/content/*.md`) zu HTML. Null Abhängigkeiten, eigene Erweiterungen in `src/templates/markdown.mjs` (Container, Schritte, Zeichnungen). |
| `ajv` | 8.20.0 | MIT | `release.json` gegen `release.schema.json` prüfen (Bau, Release-Skript, Tests). Mit seinen Abhängigkeiten (fast-deep-equal, json-schema-traverse, require-from-string, fast-uri). |
| `wrangler` | 4.151.1 | MIT OR Apache-2.0 | lokaler Server (`wrangler dev`, ohne Konto) und später der Deploy. Bringt `workerd` (Apache-2.0), `miniflare` (MIT), `esbuild` (MIT) und `sharp` mit. |
| `@playwright/test` | 1.63.0 | Apache-2.0 | Browser-Tests, Screenshots |
| `axe-core` | 4.13.0 | MPL-2.0 | Barrierefreiheitsprüfung in den Tests (nur Entwicklung, MPL laut Allowlist erlaubt) |

Hinweis zu `@img/sharp-win32-x64` (kommt über wrangler): Lizenz `Apache-2.0 AND LGPL-3.0-or-later` (enthält das vorkompilierte libvips). Das Paket ist nur eine Entwicklungsabhängigkeit von wrangler und wird nie weitergegeben oder ausgeliefert. `npm audit` meldet 0 Funde (wrangler 4.151.1 behebt die Meldung zu sharp aus 4.143.1).

`npm install` zeigt eine Warnung zu Installationsskripten von `esbuild` und `workerd`. Beide sind für den lokalen Betrieb nötig (Binärdatei). Es wurde nichts global installiert.

## Geprüft, bewusst nicht verwendet

| Kandidat | Grund |
|---|---|
| GSAP, ScrollTrigger, Lenis | Keine OSI-Lizenz (GSAP), und CSS scroll-driven animations tragen die Messspur-Szene ohne Bibliothek (BAU-REGELN 7, R14). |
| Lighthouse (`npx lighthouse`) | Nicht installiert (große Abhängigkeitsmenge). Stattdessen misst `tests/e2e/perf.spec.mjs` LCP, CLS und lange Tasks selbst per CDP (Handy, 4x CPU, langsames 4G), wie in `cypher-start`. |
| Weitere Markdown-Bibliotheken (markdown-it, remark) | `marked` genügt, hat keine Abhängigkeiten. |
| Bildschirmfotos fremder Betriebssysteme, Betriebssystem-Logos | Verboten (CONCEPT 9, DESIGN 6): Anleitungen sind eigene schematische Strichzeichnungen. |
