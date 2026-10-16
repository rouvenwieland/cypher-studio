# Bau-Regeln (verbindlich für alle Bau-Teams, gehen ARCHITEKTUR.md vor)

Stand 16.10.2026, festgelegt vom Hauptchat (Zone I).

## Entscheidungen
1. **Keine npm-Workspaces.** `apps/desktop`, `site`, `packs/tools` haben je ein eigenes `package.json` und Lockfile. Kein Wurzel-`package.json`.
2. **Keine Branches/PRs.** Alle arbeiten auf `main`, jedes Team NUR in seiner Zone (ARCHITEKTUR.md 1.2). Lesen über Zonengrenzen ist erlaubt, Schreiben nicht.
3. **Committen:** nur eigene Pfade (`git add <zonenpfade>`), nie `git add -A` oder `git add .`. Commit-Nachricht deutsch, letzte Zeile `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Bei `index.lock`-Fehler 10 s warten und erneut versuchen. Kein `git push`, kein `git reset --hard`, keine fremden Dateien zurücksetzen.
4. **Abhängigkeiten:** jede neue Abhängigkeit mit Version, Lizenz und Zweck in `docs/third-party/<zone>.md` (A, B, C1, C2, D). `THIRD_PARTY.md` führt der Hauptchat zusammen.
5. **macOS** wird als Universal-Build ausgeliefert (die Webseite kann Apple Silicon und Intel nicht sicher unterscheiden). Blender-Katalog behält die Intel-Ausnahme (4.5 LTS).
6. **Schlüssel:** Katalog- und Updater-Schlüssel sind getrennt. In Tests und Fixtures nur Test-Schlüssel, die im Test erzeugt oder als offensichtliche Test-Fixture markiert sind. Echte Schlüssel erzeugt später die verantwortliche Person; `bundle.createUpdaterArtifacts` bleibt `false`, bis das entschieden ist.
7. **Kein GSAP** (keine OSI-Lizenz). Animationen mit CSS (auch scroll-driven) und Web Animations API.
8. **Shirtigo-Profile:** Unisex-Shirt = Creator 2.0, Hoodie = Cruiser 2.0 (Werte aus `docs/research/vorgaben.md`), als Daten mit `assumption`-Feld.
9. **Echte Programm-Installationen auf Windows nur nach Rouvens Ja.** Bis dahin: echte Downloads/Installationen nur in der WSL; unter Windows nur gegen lokalen Test-Server mit kleinen Fixtures und in einen Test-Datenordner (Umgebungsvariable `CYPHER_STUDIO_DATA_DIR`, nur in Debug-/Test-Builds wirksam).
10. **Ports:** Vite (B) 1420, Playwright-Vorschau (B) 4173, Seite (D) 8788, Test-HTTP-Server (A) zufällig/ephemer.

## Umgebung
- Windows 11, Node 24 und npm unter Windows (für Frontend und Seite). Playwright-Chromium liegt bereits im Benutzer-Cache (`%LOCALAPPDATA%\ms-playwright`); fehlt die passende Version, darf `npx playwright install chromium` sie in diesen Cache laden.
- **Rust gibt es nur in der WSL** (Ubuntu 24.04, Rust 1.99.1, cargo-xwin, NSIS, Node 22). Aufruf aus **PowerShell** (Git Bash verbiegt `/mnt/...`-Pfade):
  `wsl -d Ubuntu -- bash -lc 'source ~/.cargo/env; cd /mnt/c/Users/Nevuor/Code/cypher-studio && CARGO_TARGET_DIR=$HOME/target/cs cargo test --workspace'`
  Zielordner immer im Linux-Dateisystem (`$HOME/target/...`), sonst sehr langsam.
- Windows-Binärdateien: `cargo xwin build --target x86_64-pc-windows-msvc` (Lizenz der Microsoft-Bibliotheken ist vom Nutzer akzeptiert) oder komplett `scripts/wsl-build.sh windows`. Windows-Testbinärdateien lassen sich mit `cargo xwin test --no-run --target x86_64-pc-windows-msvc` bauen und dann unter Windows ausführen.
- Echte App unter Windows testen: `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'` setzen, App starten, Playwright `chromium.connectOverCDP('http://127.0.0.1:9222')` – so gehen Screenshots und E2E gegen die echte App.
- In der WSL darf installiert werden (`wsl -d Ubuntu -u root -- apt-get install ...`, sonst nutzerlokal unter `~/apps`). Programme (Blender, Krita, Inkscape, Kdenlive) für Tests nur aus offiziellen Quellen mit Prüfsumme.

## Verboten
Auf Windows systemweit etwas installieren · Konten anlegen · etwas kaufen · Schlüssel/Token in Dienste eintragen · andere Projekte unter `C:\Users\Nevuor\Code` ändern (lesen erlaubt) · veröffentlichen (kein push, kein `wrangler deploy`) · Adobe-Namen, -Logos, -Icons oder -Assets · fremde Markenlogos (Krita, Inkscape, Blender, Kdenlive) als Bild verwenden.

## Qualität
Profi-Software, kein Vibe-Code. Rust: kein `unwrap`/`expect` außerhalb von Tests, `clippy -D warnings`, `rustfmt`. TS: `strict`, kein `any`, erschöpfende `switch`. Tests für jedes Verhalten, Prüfungen mit echter Befehlsausgabe belegen. Bezeichner englisch, UI-Texte und Kommentare deutsch.

## Bericht
Am Ende `docs/reports/<team>.md`: was gebaut, wie geprüft (echte Befehle + Ausgaben gekürzt), was offen, Abweichungen vom Vertrag. Zurück an den Hauptchat nur eine Zusammenfassung von höchstens 15 Zeilen, den Endbericht genau einmal.
