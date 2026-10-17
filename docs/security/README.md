# Sicherheit von Cypher Studio

Stand 17.10.2026. Dieses Dokument beschreibt das Bedrohungsmodell in Kürze, den Umgang mit den Signaturschlüsseln, die Lieferkette (CI, Release) und einen offenen Punkt (Strix). Ausführlicher: `docs/ARCHITEKTUR.md` Kapitel 6 und `docs/reports/review-sicherheit.md` (Befunde und deren Behebung).

## 1. Bedrohungsmodell in Kürze

Was zu schützen ist: die Rechner der Nutzerinnen und Nutzer (die App installiert und startet Programme), ihre Dateien in Bibliothek und Projekten, der Update-Kanal und der Programm-Katalog.

| Angreifer | Weg | Wehr |
|---|---|---|
| Netzwerk, kompromittierter Spiegel oder Server | verfälschte Programmdatei, Weiterleitung auf Geräte im Heimnetz, alter Katalog | Hostliste im Binary (nur `https`, Port 443, exakter Host); Spiegelverteiler dürfen nur auf öffentliche DNS-Namen weiterleiten und der Auflöser lehnt private Adressen ab; SHA-256 und Größe stehen im signierten Katalog, nie auf einem Spiegel; Katalog-Rollback wird abgelehnt (höchste gesehene Sequenz, auch für den Zwischenspeicher); PGP-Signatur zusätzlich, ohne schwache Hashes |
| Mitglied der geteilten Bibliothek, fremdes Austauschpaket | Symlink oder Junction im Ordner, `.exe`/`.bat`/`.lnk` im Paket, Schreiben nach `.cypher` | Schreibwege legen Ordner Glied für Glied an und lehnen Verknüpfungen ab; Positivliste der Dateitypen im Paket; `.cypher` in jeder Schreibweise gesperrt; Blender startet fremde Dateien mit `--disable-autoexec` |
| Böse Programm- oder Bilddatei | Archivbombe, Pfade mit `..`, Gerätenamen, präpariertes Bild | sicheres Entpacken (Pfadregeln, Größen- und Verhältnisgrenzen), Bildgrenzen vor dem Dekodieren, Panics der Dekoder werden abgefangen (`panic = "unwind"`) |
| Eingeschleuster Inhalt im Frontend (XSS) | Text aus Dateinamen, Metadaten oder Release-Notizen wird zu HTML oder Code | strenge CSP ohne `unsafe-inline` für Skripte und Stile, keine Fernschnittstelle, ESLint-Regeln gegen rohes HTML, minimale Tauri-Berechtigungen (nur eigene Befehle) |
| Lieferkette | bösartige Abhängigkeit, geänderte Action, eingeschleuster Schlüssel | `cargo deny`, npm-Lizenzprüfung, `npm audit`, Actions auf Commits festgelegt, Dependabot, CODEOWNERS für Schlüssel und Hostliste, Geheimnissuche in Dateien und Verlauf |
| Diagnose-Weitergabe | Benutzername und Heimatordner in der Diagnose-ZIP | Heimatordner und Kontoname werden in allen Schreibweisen ersetzt (roh, JSON-verdoppelt, mit Schrägstrichen, `%20`, 8.3-Kurzname) |

Nicht abgedeckt: ein Angreifer mit den Rechten der App-Nutzerin auf ihrem eigenen Rechner (er kann Zustandsdateien ändern und die App selbst starten), ein kompromittierter Rechner, und wer den Katalogschlüssel oder den Updater-Schlüssel samt Passwort besitzt. Genau deshalb sind die Schlüssel der wichtigste Teil dieses Dokuments.

Bewusst offen (siehe Bericht): die Installer sind nicht signiert (Windows SmartScreen und macOS Gatekeeper warnen; unter Windows 11 mit Smart App Control lässt sich eine unsignierte Exe gar nicht starten). Vor breiter Verteilung ist die Codesignatur zu klären (für Open Source kostenlos: SignPath Foundation für Windows; macOS: Developer ID und Notarisierung).

## 2. Schlüssel

Es gibt zwei getrennte Schlüssel, die nichts voneinander wissen:

| Schlüssel | Schützt | Kennung | Wer hält ihn | Wo steht der öffentliche Teil |
|---|---|---|---|---|
| **Katalog-Schlüssel** (minisign, passwortgeschützt) | den Programm-Katalog (`catalog/catalog.json.minisig`): welche Programme, URLs, Prüfsummen | `D5F00B731134DE6B` (`catalog-2026a`) | Rouven, offline | `catalog/keys/catalog-2026a.pub`, wird zur Bauzeit in die App eingebettet (`crates/cypher-core/build.rs` vertraut jeder Datei `catalog-*.pub`; deshalb schützt `CODEOWNERS` den Ordner) |
| **Updater-Schlüssel** (Tauri/minisign, passwortgeschützt) | die Updates der App (`latest.json`, `*.sig`) | `32BB3732FD2E6DB2` | Rouven; liegt als Secret im geschützten GitHub-Environment `release` | `plugins.updater.pubkey` in `apps/desktop/src-tauri/tauri.conf.json` |

Wer den Updater-Schlüssel samt Passwort hat, kann gültig signierte Updates für alle Installationen veröffentlichen (Fernausführung auf allen Rechnern). Wer den Katalogschlüssel hat, kann beliebige Programmadressen mit passender Prüfsumme eintragen, allerdings nur auf Hosts der eingebetteten Liste.

### Regeln

1. **Das Passwort liegt nie neben dem Schlüssel.** Die Datei `PASSWORT-SICHERN.txt`, die beim Erzeugen entsteht, wird nach dem Sichern **gelöscht**: Passwort in den Passwortmanager übertragen, die Datei dann überschreiben und löschen (auf SSD genügt Löschen nicht als Schutz vor dem Wiederherstellen; der Schutz ist, dass das Passwort danach nirgends im Klartext steht). `scripts/wsl-build.sh` liest die Datei nur noch als Rückfall, warnt dann und fragt sonst zur Laufzeit.
2. **Zwei Offline-Kopien** jedes Schlüssels (Passwortmanager und verschlüsselter Datenträger). Geht Schlüssel oder Passwort des Updaters verloren, lassen sich für bereits installierte Apps keine Updates mehr veröffentlichen.
3. **Passwörter nie auf der Kommandozeile.** `scripts/sign-catalog.mjs` bekommt das Passwort aus `--password-file` oder der Umgebungsvariable `CYPHER_CATALOG_KEY_PASSWORD` und reicht es dem Signierer über dessen Umgebung weiter, nicht als Argument (Argumente sieht jeder Prozess desselben Benutzers).
4. **Secrets trägt nur Rouven in GitHub ein.** Niemand sonst (auch keine Werkzeuge oder Agenten) legt Schlüssel in Repository, Chat, Tickets oder Dienste. Benötigt werden zwei Secrets, am besten als Secrets der Umgebung `release`: `TAURI_SIGNING_PRIVATE_KEY` (Inhalt der Schlüsseldatei) und `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
5. **Der Katalog-Schlüssel gehört nicht in die CI.** Der Katalog wird offline signiert und eingecheckt. Jeder Pull Request, der `catalog/keys/` oder `catalog/` ändert, braucht die Freigabe der Code-Owner.
6. **Tests und Fixtures benutzen nur Testschlüssel**, die im Test erzeugt oder als Testdaten gekennzeichnet sind (`docs/BAU-REGELN.md` Nr. 6). `scripts/secret-scan.mjs` läuft in der CI über Dateien und Verlauf und schlägt bei privaten Schlüsseln, Passwortdateien und festen Signierpasswörtern an.

### Rotation und Notfall

- **Updater-Schlüssel getauscht** (planmäßig oder nach Verdacht): neuen Schlüssel erzeugen, den neuen öffentlichen Teil in `tauri.conf.json` eintragen und ein Update veröffentlichen, das noch mit dem alten Schlüssel signiert ist. Geht der alte Schlüssel verloren oder ist er abgeflossen, hilft nur eine neue Erstinstallation (neuer Download von der Seite); darum Abfluss sofort ernst nehmen: Secret in GitHub löschen, Download-Seite auf den Stand mit neuem Schlüssel verweisen.
- **Katalog-Schlüssel getauscht**: neue Datei `catalog/keys/catalog-<Jahr><Buchstabe>.pub` einchecken, neues App-Release bauen (der alte Schlüssel bleibt eingebettet, bis alle Installationen aktualisiert sind), danach den alten Schlüssel entfernen. Der Katalog trägt eine laufende Sequenz; ein Rollback wird abgelehnt.
- **Verdacht auf Abfluss**: Secrets in GitHub löschen und den Schlüssel tauschen (wie oben). Ein neues Passwort für dieselbe Schlüsseldatei hilft nicht: Die abgeflossene Datei bleibt mit dem alten Passwort lesbar.

## 3. GitHub einrichten (einmalig, durch Rouven)

Nichts davon kann eine Datei im Repository erledigen:

1. **Branch-Schutz für `main`**: Pull Request vor dem Zusammenführen, Review durch Code-Owner verlangen, Status-Prüfungen `ci` verlangen, Force-Push verbieten.
2. **Environment `release`** (Settings → Environments): *Required reviewers* = Rouven; die zwei Secrets hier eintragen, nicht als Repository-Secrets. Der Release-Workflow wartet dann an jedem Bauauftrag auf die Freigabe.
3. **Actions** (Settings → Actions): Standard-Berechtigung des `GITHUB_TOKEN` auf *Read repository contents*; die Workflows fordern mehr nur dort an, wo es nötig ist (`release.yml`, Job `build`: `contents: write`). Nur Actions aus dem eigenen Konto und von GitHub sowie die in den Workflows festgelegten Versionen zulassen.
4. **Sicherheit** (Settings → Code security): Dependabot-Warnungen und -Sicherheitsupdates, *Secret scanning* mit *Push protection*, Meldung von Schwachstellen (*Private vulnerability reporting*) einschalten.
5. **Konto**: Zwei-Faktor-Anmeldung mit Hardware-Schlüssel oder Passkey.

## 4. Lieferkette und Release

| Datei | Zweck |
|---|---|
| `.github/workflows/ci.yml` | bei Push auf `main` und Pull Requests: Format, Clippy (auch mit `dev-tools`), Tests, `cargo deny` auf Ubuntu 22.04 und Windows; Prüfung, dass das App-Paket `test-util` nicht einzieht und ein Release-Build damit abbricht; Oberfläche (Typen, ESLint, Stylelint, Prettier, Vitest, Playwright gegen den Mock und mit Produktions-CSP, `npm audit`); Pakete (`validate`, Tests); Seite; Lizenz- und Geheimnisprüfung |
| `.github/workflows/packs.yml` | baut `packs/dist` einmal (Blender 5.2.2 aus `download.blender.org`, SHA-256 geprüft, Startszene und Erweiterungs-ZIP) und gibt es als Artefakt weiter |
| `.github/workflows/release.yml` | Tag `v<Version>`: prüft Tag gegen `tauri.conf.json`, baut Windows (NSIS), macOS (Universal, Ad-hoc-Signatur) und Linux (AppImage, deb, rpm) mit `tauri-action`, signiert die Update-Artefakte mit dem Updater-Schlüssel und legt einen **Entwurf** an; `verify-release` prüft `latest.json` und die Dateien. Veröffentlicht wird von Hand |
| `.github/dependabot.yml` | wöchentliche, gebündelte Vorschläge für Actions, Cargo und die drei npm-Projekte |
| `.github/CODEOWNERS` | Freigabe durch den Verantwortlichen für Katalogschlüssel, Hostliste, Prüfungen, Tauri-Konfiguration, Workflows, Skripte |
| `scripts/license-check.mjs` | npm-Lizenzen gegen eine Positivliste (ausgelieferte Pakete streng, Werkzeuge etwas weiter, Ausnahmen mit Begründung) |
| `scripts/secret-scan.mjs` | private Schlüssel, Passwortdateien, feste Signierpasswörter, Tokens in Dateien und Verlauf; lokal als Pre-Commit nutzbar (`--staged`) |

Alle Actions stehen auf Commit-SHA, die Version steht im Kommentar. Dependabot aktualisiert beides. Wer eine Action von Hand ändert, holt die SHA mit `git ls-remote --tags https://github.com/<owner>/<repo>.git` und prüft sie gegen die Release-Seite.

Die Workflows wurden mit `actionlint` 1.7.12 geprüft und laufen seit dem 17.10.2026 auf GitHub (öffentliches Repository, `ubuntu-22.04` und `windows-latest`). Die ersten Läufe deckten Fehler auf, die lokal nie auftraten (Schriften-Rückstand unter Ubuntu 22.04, Kurzpfade unter Windows, Wettläufe in zwei Browsertests, neue RustSec-Meldungen); Befund, Ursache und Behebung stehen in `docs/reports/integration.md`, Abschnitt 6. `release.yml` wurde noch nie ausgeführt (es gibt noch keinen Tag); `packs.yml` läuft als Teil von `ci` mit.

### Vor jeder Veröffentlichung

1. `ci` ist grün (alle Jobs).
2. `node scripts/secret-scan.mjs --history` und `cargo deny check` ohne Fund.
3. Entwurf prüfen: Dateien, `latest.json`, Prüfsummen der Installer stichprobenartig.
4. Katalog neu signiert, wenn sich Programmversionen geändert haben (`scripts/sign-catalog.mjs`, offline).
5. Entwurf veröffentlichen.

## 5. Offener Punkt: Strix-Lauf

`docs/ARCHITEKTUR.md` 6.10 verspricht vor der ersten öffentlichen Veröffentlichung einen einmaligen Sicherheitscheck mit Strix gegen den Release-Build. **Nicht durchgeführt:** Strix braucht Docker und einen Modellschlüssel; beides stand dem Härtungsteam nicht zur Verfügung (kein Docker in der WSL, kein Schlüssel; Schlüssel werden nicht ohne Rouven in Dienste eingetragen).

Vorgesehener Ablauf, wenn beides vorhanden ist:

1. Release-Build wie in `docs/BAUEN.md` bauen (`scripts/wsl-build.sh all` oder die Installer aus dem Entwurf).
2. App mit Wegwerf-Datenordner starten (`CYPHER_STUDIO_DATA_DIR` wirkt nur in Debug-Builds; für den Release-Build einen frischen Windows-Benutzer oder eine VM nehmen).
3. Strix gegen die lokale App und gegen `site/` (lokaler Server) laufen lassen, nicht gegen fremde Server.
4. Ergebnis als `docs/security/strix-<Datum>.md` ablegen, Funde bewerten und in `docs/reports/` nachführen.
5. Erst danach die Veröffentlichung freigeben.

## 6. Meldeweg

Schwachstellen bitte nicht öffentlich als Ticket melden, sondern über *Security → Report a vulnerability* im GitHub-Repository (Punkt 4 in Abschnitt 3 schaltet das ein).
