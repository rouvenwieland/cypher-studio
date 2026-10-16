# Cypher Studio · Downloader-Seite (Zone D)

Adresse: **https://studio.cypherxcypher.de** (Kanal 3 der Familie). Statische Seite auf Cloudflare Workers Static Assets, nur Dateien, kein Worker-Skript, kein Framework, keine Laufzeit-Bibliothek. Konzept: `docs/CONCEPT.md` Kapitel 9, Tokens: `docs/DESIGN.md` und `docs/tokens.css`.

Die Seite erkennt das Betriebssystem, zeigt **einen** großen Download-Balken passend dazu (Windows Setup, macOS Universal-dmg, Linux AppImage mit .deb und .rpm), erklärt ehrlich, warum Windows und macOS vor der unsignierten App warnen, und bringt die Anleitung „In 30 Minuten startklar“ plus drei Ablaufseiten mit.

## Aufbau

```
site/
  wrangler.jsonc          Workers Static Assets, Custom Domain studio.cypherxcypher.de, workers.dev aus, Konto-ID eingetragen
  release.schema.json     Schema von release.json (JSON Schema 2020-12)
  site.config.json        feste Angaben: Adresse, Repo-Link (null = „folgt“), Systemvoraussetzungen, Muster der Dateinamen
  public/                 wird unverändert nach dist/ kopiert (außer Schriften, die bekommen einen Hash im Namen)
    release.json          Zustand der Veröffentlichung (siehe unten) – steuert die Seite
    _headers              CSP, noindex, Cache-Regeln
    robots.txt  favicon.svg  fonts/ (OFL, mit Lizenztexten)
    releases/  catalog/v1/  Platzhalter: /releases/latest.json (App-Updater, ARCHITEKTUR 5.7) und /catalog/v1/ (Katalog, 5.8)
  src/
    css/site.css          ein Stylesheet, Tokens oben (Familienfarben gespiegelt aus docs/tokens.css, ein Test prüft das)
    js/boot.js            Systemerkennung, blockierend, 1 KB, setzt <html data-os>
    js/site.js            Kopieren, Anleitung aufklappen, Sprung nach dem Download, einmaliger Suchlauf
    templates/            Seitenvorlagen (JS-Funktionen), eigene Strichzeichnungen (drawings.mjs), Markdown-Umsetzer
  content/                QUELLE der Texte (Markdown): anleitung.md, drei Ablaufseiten, install/<system>.md
  scripts/
    build.mjs             baut dist/ und prüft das Ergebnis
    gen-release-json.mjs  erzeugt release.json (und releases/latest.json) aus GitHub-Release-Daten
    serve.mjs             lokaler Server mit _headers und Brotli (ohne Konto)
    fit.mjs               misst die Wortbreiten der Schrift (Breitenachse), Werte stehen in site.css
    lib/                  release.mjs (Schema, Hilfen), lint.mjs (Prüfung von dist/)
  tests/                  unit/ (node:test) und e2e/ (Playwright), fixtures/, run.mjs
  shots/                  Bildschirmfotos 375 / 768 / 1440 aus dem letzten Testlauf
```

## Befehle

```bash
npm install
npm run build          # dist/ bauen + prüfen (CSP ohne Inline-Code, noindex, Links, Anker, 24-MiB-Grenze)
npm run dev            # bauen und wrangler dev auf Port 8788 (lokal, ohne Konto)
npm run serve          # alternativ: scripts/serve.mjs auf Port 8788 (nicht gleichzeitig mit wrangler dev)
npm run test:unit      # Schema, Erkennung, Markdown, Tokens, Bau (node:test)
npm run test:e2e       # baut beide Zustände, startet die Server, führt Playwright aus
npm test               # beides
```

Der Testlauf (`tests/run.mjs`) baut beide Zustände und startet `wrangler dev` auf 8788 (Zustand A, echte Header) und 38789 (Zustand B, Fixture `tests/fixtures/release-b.json`) sowie `scripts/serve.mjs` auf 38790 und 38791 für die Leistungsmessung (Brotli wie bei Cloudflare). Läuft auf einem Port schon etwas, wird es weiterverwendet; was der Lauf selbst gestartet hat, beendet er wieder. Die Leistungsmessung (Handy, 4x CPU, 4G) meldet LCP über 2,0 s als Anmerkung `BUDGET` und scheitert erst bei einer Seite, die erkennbar kaputt ist; auf einem ausgelasteten Rechner schwankt der Wert um das Zwei- bis Dreifache.

Ein einzelner Browser-Test: `node tests/run.mjs -g "Erkennung Windows"`. Bildschirmfoto zur Ansicht: `node tests/shot.mjs / 1440x900 shots/tmp/x.png --ua macos`.

## release.json (steuert die Seite)

Die Seite ist **statisch gebaut**: `npm run build` liest `public/release.json` und backt Links, Größen und Prüfsummen in die HTML-Seiten. Das heißt: Ohne JavaScript funktioniert alles, es gibt keinen Ladezustand und keine toten Knöpfe. Zum Veröffentlichen läuft also immer **erst `gen-release-json.mjs`, dann `build`, dann Deploy**.

Zustand A, noch kein Release (so ist die Datei ausgeliefert):

```json
{ "schemaVersion": 1, "state": "none" }
```

Die Seite zeigt „Die erste Version erscheint in Kürze.“ statt Knöpfen. Anleitung, Prüfhilfen und Ablaufseiten bleiben.

Zustand B, Release vorhanden:

```json
{
  "schemaVersion": 1,
  "state": "released",
  "version": "0.4.0",
  "date": "2026-11-02",
  "releaseUrl": "https://github.com/<org>/cypher-studio/releases/tag/v0.4.0",
  "notes": null,
  "signed": { "windows": false, "macos": false },
  "files": [
    { "os": "windows", "arch": "x86_64", "kind": "nsis", "name": "Cypher-Studio_0.4.0_x64-setup.exe",
      "url": "/releases/Cypher-Studio_0.4.0_x64-setup.exe", "size": 10276044, "sha256": "<64 Hex-Zeichen, klein>" }
  ]
}
```

| Feld | Bedeutung |
|---|---|
| `state` | `none` oder `released`. Bei `none` sind alle anderen Felder außer `schemaVersion` verboten. |
| `version`, `date` | SemVer ohne `v`, Datum ISO. Jeder Dateiname muss die Version enthalten. |
| `releaseUrl` | Release-Seite auf GitHub (Rückfall-Link), oder `null`. |
| `signed.windows` / `.macos` | `true`, sobald der Build signiert bzw. beglaubigt ist: die Seite blendet dann die Warnungs-Schritte (SmartScreen, „Dennoch öffnen“, `xattr`) und den Erklärkasten aus. |
| `files[].os / arch / kind` | `windows`/`macos`/`linux`, `x86_64`/`aarch64`/`universal`, `nsis`/`dmg`/`appimage`/`deb`/`rpm`. |
| `files[].url` | `/releases/<name>` (liegt auf der Seite, höchstens 24 MiB) oder `https://…` (GitHub, bei größeren Dateien). |
| `files[].sha256` | Prüfsumme, die die Seite in Vierergruppen zeigt und die der Nutzer nachrechnet. |

Hauptdatei je System: Windows `nsis`; macOS `dmg` (Universal vor Apple Silicon vor Intel, weitere dmg erscheinen unter „Auch als“); Linux `appimage` groß, `deb` und `rpm` daneben. Fehlt für ein System eine Datei, steht dort „Datei folgt“.

### gen-release-json.mjs (später in `.github/workflows/site.yml`)

```bash
gh api repos/<org>/cypher-studio/releases/tags/v0.4.0 > release-api.json
gh release download v0.4.0 --dir assets          # Installer, latest.json (tauri-action)
node scripts/gen-release-json.mjs --github-release release-api.json --tauri-latest assets/latest.json \
  --files-dir assets --copy-to public/releases
npm run build && npm run deploy
```

- SHA-256 und Größe kommen aus `--files-dir` (berechnet) oder, falls die Datei fehlt, aus dem `digest` der GitHub-API.
- Dateien über 24 MiB (Workers Static Assets erlauben 25 MiB, ARCHITEKTUR R18) werden **nicht** kopiert; `release.json` verlinkt dann die GitHub-Adresse. Das setzt ein öffentliches Repository voraus (R16). Tauri-AppImages sind wegen des mitgelieferten WebKitGTK sehr wahrscheinlich größer als 24 MiB.
- `--tauri-latest` schreibt `public/releases/latest.json` für den App-Updater mit den **gleichen Signaturen**, aber Adressen auf `studio.cypherxcypher.de/releases/…` (ARCHITEKTUR 5.7). Auch hier gilt: Dateien über 24 MiB brauchen den GitHub-Link; der Updater-Endpunkt auf der Seite verweist dann auf Dateien, die dort nicht liegen. Entscheidung dazu steht in `docs/reports/team-d.md`.
- `--none` setzt zurück auf Zustand A.
- `catalog/v1/`: `site.yml` kopiert `catalog/catalog.json` und `.minisig` dorthin (ARCHITEKTUR 5.8). Die Seite fasst den Ordner nicht an.

## Inhalte ändern

- Texte der Anleitung: `content/*.md`. Container: `:::hinweis`, `:::achtung`, `:::tipp`; Schrittfolge `:::::schritte` mit `::::schritt Titel` (und `::::schritt-unsigned`, entfällt bei signierten Systemen); Zeichnung `![Beschreibung](svg:name)` (Name aus `src/templates/drawings.mjs`, die Beschreibung ist zugleich der zugängliche Name); Platzhalter `{{version}}`, `{{file.windows}}`, `{{file.macos}}`, `{{file.linux-appimage}}`, `{{file.linux-deb}}`, `{{file.linux-rpm}}` (echter Dateiname oder Muster aus `site.config.json`). Rohes HTML ist verboten (außer `<kbd>`).
- `@@install@@` in `anleitung.md` fügt die drei Systemblöcke aus `content/install/` ein, dieselben wie auf der Startseite.
- Neue Anleitungsseite: Datei in `content/` mit Kopfdaten `titel`, `beschreibung`, `lead`, `reihenfolge`; sie erscheint unter `/anleitung/<name>/` und in der Weiter-lesen-Leiste.
- Bildschirmfoto der App einsetzen: In `src/templates/home.mjs`, Funktion `aufbau()`, die Zeichnung `drawing('app-schema')` durch ein `<img>` ersetzen (Datei nach `public/img/`, CSP `img-src 'self'` erlaubt es) und Alt-Text schreiben.
- Repo-Link: `site.config.json` → `repoUrl` setzen, sobald das Repository öffentlich ist.

## Veröffentlichen (nicht ausgeführt)

```bash
npx wrangler login            # einmalig, Cloudflare-Konto des Kollektivs (setzt der Nutzer)
npm run build && npm run deploy
```

Legt beim ersten Mal die Custom Domain `studio.cypherxcypher.de` samt DNS-Eintrag und Zertifikat an. `workers_dev` und `preview_urls` sind aus. Beim Deploy gilt `noindex` (Meta und `X-Robots-Tag`), bis Impressum und Datenschutz echt sind:

1. Impressum und Datenschutz in `src/templates/doc.mjs` ausfüllen, „Platzhalter“ entfernen.
2. `noindex, nofollow` ersetzen in `src/templates/layout.mjs` (Meta), `public/_headers` (`X-Robots-Tag`), `scripts/lib/lint.mjs` und den Tests.

## Entscheidungen und Abweichungen

- **Eingebacken statt nachgeladen**: `release.json` wirkt beim Bauen, nicht im Browser. So gibt es nichts Dynamisches, CSP `connect-src 'none'`, keinen Layoutsprung und keine toten Knöpfe. Dafür muss nach jedem Release neu gebaut werden (das tut `site.yml`).
- `wrangler.jsonc` statt `wrangler.toml` (wie `cypher-start`), Ausgabeordner `dist/` statt `public/index.html`.
- macOS: ein Universal-Installer (BAU-REGELN 5). Sollte `release.json` stattdessen getrennte Apple-Silicon- und Intel-Dateien führen, zeigt die Seite die erste als Hauptdatei und die andere unter „Auch als“.
- Kein GSAP: Die Messspur-Szene läuft mit CSS scroll-driven animations (`animation-timeline: view()`), nur mit feinem Zeiger, Desktopbreite und ohne reduzierte Bewegung. Firefox ohne die Funktion, Handy und reduzierte Bewegung zeigen den Endzustand.
