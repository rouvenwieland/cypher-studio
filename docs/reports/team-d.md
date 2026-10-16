# Bericht Team D: Downloader-Seite `studio.cypherxcypher.de`

Stand 16.10.2026. Zone: `site/**`, `docs/third-party/D.md`, dieser Bericht. Nichts veröffentlicht, kein Login, kein `wrangler deploy` (nur `wrangler deploy --dry-run`: liest 50 Dateien aus `dist/`, lädt nichts hoch).

## Was gebaut ist

- **Seite** (`site/`, eigenes `package.json` und Lockfile, wrangler 4.151.1 als lokale devDependency, `npm audit`: 0 Funde). `wrangler.jsonc` mit Workers Static Assets, Custom Domain `studio.cypherxcypher.de`, Konto-ID `017af360b67c2dbed21ed0d7d123a948`, `workers_dev` und `preview_urls` aus. `public/_headers` (strenge CSP ohne Inline-Code und ohne Fremdquellen, `X-Robots-Tag: noindex, nofollow`, Cache-Regeln, `connect-src 'none'`), `robots.txt`, Favicon, 404 „Kein Signal“, Impressum und Datenschutz als Platzhalter (noindex, Meta und Header).
- **Startseite** nach CONCEPT 9: Cyan-Welt mit CYPHER und STUDIO, die über die Breitenachse exakt die Breite füllen, Testbild-Kreis, Kreuz und Lineal 0 bis 330 mm; ein großer Tinte-Balken passend zum erkannten System (Windows Setup .exe, macOS Universal-.dmg, Linux AppImage mit .deb und .rpm), die anderen beiden klein daneben, „Alle Dateien und Prüfsummen“. Handy: kein Knopf, sondern „Cypher Studio läuft auf Windows, macOS und Linux“ + „nur für Computer“ + Link kopieren. Einmaliger Suchlauf Orange → Gelb → Cyan (je 800 ms, nur von außen, jede Eingabe bricht ab, nie bei reduzierter Bewegung). Danach: Programm-Stapel (KRITA, INKSCAPE, BLENDER, KDENLIVE als Text über die volle Breite, Zeiger und Fokus füllen die Zeile mit Cyan, das Wort rastet neu ein), **Messspur-Szene** (nur CSS scroll-driven animations: Lineale zählen am Scrollweg bis 330 und 450 mm, Maßchip bis 280,0 × 312,0, acht Regeln haken sich ab, am Ende DRUCKBEREIT; Handy, reduzierte Bewegung und Firefox zeigen den Endzustand), Schema der App, Systemvoraussetzungen, „So öffnest du Cypher Studio“, Selbst prüfen, Typenschild, Markenhinweis im Fuß jeder Seite.
- **Anleitung je System** (Windows SmartScreen und Smart App Control, macOS ab Sequoia „Dennoch öffnen“ und `xattr`, Linux `chmod +x`, `libfuse2t64`, .deb/.rpm) mit 15 eigenen Strichzeichnungen als SVG (keine fremden Logos, keine nachgebauten Fenster). Ehrliche Erklärung, warum die Warnung kommt, ohne Panik.
- **Seiten aus Markdown** (`site/content/`, Quelle) mit kleinem Bau-Skript (`marked` als einzige Laufzeit-Abhängigkeit des Baus): `/anleitung/` („In 30 Minuten startklar“), `/anleitung/motiv-zu-shirtigo/`, `/anleitung/social-und-reels/`, `/anleitung/modell-zu-shop/` (Blender, Add-on „Cypher Export“, Konventionen aus `3d-konventionen.md`). Jede Seite sagt ehrlich „Stand der App: im Bau“.
- **release.json-gesteuert**: Zustand A „Die erste Version erscheint in Kürze.“ (keine toten Knöpfe), Zustand B echte Links, Größen, SHA-256 in Vierergruppen mit Kopieren-Knopf. Schema `site/release.schema.json`, Beschreibung in `site/README.md`. `scripts/gen-release-json.mjs` erzeugt `release.json` und `releases/latest.json` (gleiche Signaturen, Seiten-URLs) aus GitHub-Release-Daten. Platzhalter `/releases/` und `/catalog/v1/` mit Header-Regeln. Bei `signed.windows/macos = true` entfallen die Warnungs-Schritte.

## Wie geprüft (alles mit echten Läufen)

| Prüfung | Befehl | Ergebnis |
|---|---|---|
| Unit | `node --test "tests/unit/*.test.mjs"` | 91 von 91 bestanden (Erkennung, Schema, Release-Skript, Markdown, Tokens samt Kontrastpaaren, Bau und Lint) |
| Browser (Chromium, gegen `wrangler dev`, echte `_headers`) | `node tests/run.mjs` | 129 von 129 bestanden in 3,9 min |
| Bau | `node scripts/build.mjs` | „Prüfung ok: 8 Seiten“: kein `style=`, kein Inline-Skript, ein h1, noindex, alle Links und Anker, jede Datei unter 24 MiB |
| Hosting-Konfiguration | `npx wrangler deploy --dry-run` | gültig, 50 Dateien gelesen, nichts hochgeladen |

Abgedeckt: Systemerkennung je User-Agent (Windows, macOS/Safari, Linux Chrome und Firefox, Android, iPhone, iPad als Mac mit Touch, ChromeOS) samt `userAgentData`; ohne JavaScript; beide Zustände; noindex in Meta und Header je Seite; CSP-Verstöße, Konsole, Fremdanfragen, Cookies und Speicher bei einem Rundgang mit Scrollen, Hover, Tab, Downloads, Kopieren (alles 0); axe 0 Verstöße auf allen 8 Seiten in beiden Zuständen bei 375 und 1440 px, mit aufgeklappter Anleitung, an vier Stellen der Szene, mit reduzierter Bewegung; kein Querscrollen bei 320, 375, 768, 1024, 1440; Trefferflächen ≥ 44 px auf dem Handy; Wortbreite bis auf 3 % bei zehn Fenstergrößen; Download-Balken im ersten Bild bei sieben Größen; Tastatur und Fokusring; Download-Ereignis mit richtigem Dateinamen und Sprung zur Anleitung; Zwischenablage; Suchlauf (Reihenfolge, Farben, Dauer ≥ 780 ms, Abbruch, nie bei reduzierter Bewegung, nie aus der Familie oder beim Neuladen); Szene (Zahlen, Endzustand, sticky, Fallback). Bildschirmfotos 375 / 768 / 1440 nach `site/shots/`.

Die Tests fanden echte Fehler, die behoben sind: Kontrast der noch ungeprüften Regeln in der Szene, Layoutsprung durch das nachträglich eingeblendete Kopieren-Knöpfchen (CLS), Querscrollen bei 320 px, zu kleine Trefferflächen, Datei-Links in der Prüfsummenliste auf dem Handy, fehlendes `rel="noopener"` an Downloads auf GitHub, Beschreibungstext der Zeichnungen.

## Leistung: Budget LCP ≤ 2,0 s NICHT bestätigt

Gemessen wie in `cypher-start` (Handy 390 px, 4x CPU, 4G 150 ms/1,6 MBit/s, Brotli, Suchlauf läuft mit), je vier Läufe, kleinster Wert:

| Seite | LCP (Läufe) | CLS | INP-Näherung |
|---|---|---|---|
| Start, Zustand A | 2,9 s (2,9 / 3,0 / 3,0 / 3,4) | 0 | 56 ms |
| Start, Zustand B | 3,3 s (3,3 / 3,3 / 3,8 / 7,2) | 0 | 88 ms |
| Anleitung | **1,8 s** (im Budget) | 0 | 24 ms |
| Start, Desktop-Fenster | 3,1 s | 0,012 | 120 ms |

Der Rechner war während der Messungen durch die anderen Teams stark belastet (Einzelläufe schwankten um das Zwei- bis Dreifache; `cypher-start` misst unter denselben Bedingungen 1,4 bis 4 s). Die Startseite liegt dennoch eher bei 2- bis 2,5-fach der Referenz. Übertragen werden rund 111 KB (HTML 8 KB, CSS 9 KB, JS 2,5 KB, drei Schriften 92 KB, alles Brotli). Die Zeit steckt im ersten Layout und Schriftsatz der langen Seite auf der gedrosselten CPU. Schon gemacht: `text-box-trim` durch gerechnete Ränder ersetzt (halbierte die Layoutzeit), Zeichnungen als lazy SVG-Dateien statt Inline (HTML 54 → 35 KB), CSS ohne Kommentare, Ersatzschriften mit gleicher Zeichenbreite. Versucht und verworfen: `content-visibility: auto` für untere Abschnitte (brachte etwas, machte aber CLS 0,23 beim Scrollen). Nächste Schritte: Messung auf einem ruhigen Rechner oder in CI (Lighthouse CI in `site.yml`), dann gegebenenfalls Abschnitte unterhalb des ersten Bildes erst nach dem ersten Bild einsetzen oder die Seite teilen. Der Test `perf.spec.mjs` scheitert erst bei einer Seite, die erkennbar kaputt ist (LCP > 20 s), meldet aber jede Budget-Überschreitung als Anmerkung `BUDGET`. Lighthouse selbst ist nicht installiert.

## Offen, nicht geprüft, Risiken

1. **Fremdbrowser und echte Geräte**: nur Chromium. Firefox und WebKit sind in diesem Playwright-Stand nicht installiert (Download nicht gemacht). Windows-Kontrastdesign: CSS-Regeln vorhanden, nicht auf einem echten Gerät geprüft. Texte der Dialoge („Der Computer wurde durch Windows geschützt“, „Weitere Informationen“, „Trotzdem ausführen“, „Fertig“, „Dennoch öffnen“) stammen aus `plattform.md` und sind laut ARCHITEKTUR 8.7 vor dem Release auf echten Geräten (SmartScreen, Smart App Control, Gatekeeper ab macOS 15/26) zu prüfen. Die Zeichnungen sind schematisch und überleben abweichende Texte.
2. **AppImage über 24 MiB**: Tauri bündelt WebKitGTK, das AppImage wird sehr wahrscheinlich über der Workers-Grenze (24 MiB, R18) liegen. Dann verlinkt `release.json` auf den GitHub-Release; das braucht ein öffentliches Repo (R16), und der Updater-Endpunkt `releases/latest.json` zeigt für diese Datei auf eine Adresse, die nicht auf der Seite liegt. Entscheidung für Hauptchat/Rouven: Repo öffentlich machen oder die Datei anders hosten.
3. **macOS-Mindestversion 13** und „Linux x86_64 mit WebKitGTK 4.1 (Ubuntu 22.04, Debian 12, Fedora 36)“ sind Annahmen aus `DESIGN.md`/`plattform.md` (`site.config.json`); gegen `tauri.conf.json` (`minimumSystemVersion`) abgleichen. „Plane etwa 3 GB“ ist ein Richtwert aus den Katalogwerten.
4. **Bildschirmfoto der App** fehlt noch (Schema statt Fake, Austausch beschrieben in `site/README.md`). Das Rauschen-Motiv der Szene ist ein eigenes Platzhalter-Schema, kein Shop-Asset.
5. **Impressum und Datenschutz** sind Platzhalter, die Seite bleibt noindex; Umstellung steht in der README. Repo-Link: `site.config.json` → `repoUrl` (null = „folgt“).
6. **Kein Dunkelmodus** (wie `cypher-start`), Papier und Cyan reichen für die Seite.
7. Die Kopfzeile der Commits folgt BAU-REGELN („Claude Opus 5.5“), obwohl dieser Lauf mit Sonnet 5.5 lief.

## Abweichungen vom Vertrag

- `wrangler.jsonc` statt `wrangler.toml` (Vorbild `cypher-start`), Ausgabe nach `dist/` (gitignored) statt `public/index.html`; Quelle in `src/`, `content/`, `public/`. `detect.js` heißt `boot.js` (blockierend, 1,5 KB, vor dem ersten Bild).
- Release-Daten werden **beim Bauen** eingebacken, nicht im Browser geladen (kein `latest.json`-Abruf, kein Ladezustand, `connect-src 'none'`). Dafür läuft nach jedem Release `gen-release-json` → `build` → Deploy.
- macOS: ein Universal-Installer (BAU-REGELN 5, gegen ARCHITEKTUR A-17); das Schema kann auch getrennte Apple-Silicon- und Intel-Dateien (zweite unter „Auch als“).
- Die Messzeile der Programme steht immer sichtbar (nicht erst bei Zeiger); Zeiger und Fokus füllen die Zeile zusätzlich.
- Ports der Tests: 8788 (Zustand A, vorgegeben), 38789 bis 38791 (B und Messserver), weil 8790 bei einem anderen Projekt belegt war.
- Kein GSAP (R14), keine neue Laufzeit-Abhängigkeit im Browser.

## Einschätzung gegen DESIGN.md und Anti-Vibecode

Erfüllt: Familienschriften und Tokens (ein Test gleicht die Farben mit `docs/tokens.css` ab und rechnet 15 Kontrastpaare nach), Radius 0, nur Haarlinien, keine Schatten, Verläufe oder Glas, Cyan nur als Fläche mit Tinte oder als Tiefcyan, harte Schnitte, benannte Kurven, kein Preloader, keine Zählwerke, keine Logos, keine Deko-Ziffern, kein Kicker über Überschriften (nach der Prüfung entfernt). Stark: Kennung, Programm-Stapel, Messspur-Szene. Ruhiger gehalten: Voraussetzungen, Prüfsummen (so gewollt, Rhythmus laut/leise). Schwächer: Schrauben am Typenschild und die Lineal-Zeile sind Familienzitate und könnten als Deko gelten; Seitenmitte zwischen Szene und Installation ist textlastig. Ob es „Awwwards-würdig“ ist, kann ich nicht beurteilen; ohne bestätigtes LCP würde ich es noch nicht dafür einreichen.

## Wichtige Pfade

`site/README.md` (Betrieb, Schema, Deploy), `site/wrangler.jsonc`, `site/public/_headers`, `site/public/release.json`, `site/release.schema.json`, `site/scripts/gen-release-json.mjs`, `site/scripts/build.mjs`, `site/content/`, `site/src/`, `site/tests/` (`run.mjs`, `unit/`, `e2e/`), `site/shots/`, `docs/third-party/D.md`.
