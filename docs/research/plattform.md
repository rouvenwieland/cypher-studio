# Plattform-Recherche: Cypher Studio (Tauri 2) – Updater, Release-Pipeline, Cross-Compile, Signierung, Sicherheit, Tests

Stand: 16.10.2026. Alle Abrufe am 16.10.2026. Es wurde nichts installiert, kein Konto angelegt, kein Schlüssel erzeugt, nichts beantragt.

## Lesehilfe

Quellenverweise stehen als `[S12]` im Text; die Liste mit URLs und Abrufdatum steht am Ende („Quellen“). Vertrauensstufe pro Aussage, wo sie nicht offensichtlich ist:

| Marke | Bedeutung |
|---|---|
| (B) | belegt durch Primärquelle (offizielle Doku, Quelltext, Registry-API des Herstellers) |
| (S) | nur sekundär belegt (Blog, Nachrichtenseite, Händlerseite) |
| (A) | von mir aus Quelltext/Doku abgeleitet (Schlussfolgerung, nicht wörtlich dokumentiert) |
| (U) | Erfahrungs-/Allgemeinwissen, in diesem Lauf NICHT geprüft – vor Verwendung testen |

Code- und Konfigurationsbeispiele sind Vorlagen. Auf dem Windows-Rechner wurde nichts installiert und nichts gebaut. Geprüft wurde in der WSL (dort ist Rust 1.99.1 vorhanden) mit Wegwerf-Crates, die danach wieder gelöscht wurden: (1) die Rust-Download-Skizze in 8.4 per `cargo check`, (2) der Rust-Test in 9.1 per `cargo test` (läuft grün). Die YAML-, JSON- und TOML-Blöcke wurden lokal mit Parsern auf Syntax geprüft (Tauri-/Workflow-Semantik nicht). Alles Übrige (TypeScript-Beispiele, Skripte, Worker-Ideen) ist ungetestet; wo es wichtig ist, steht „(U)“.

## Kurzfassung: was von der Auftragsannahme abweicht

1. **.deb und .rpm sind aktualisierbar.** Das Updater-Plugin kann seit Version 2.10.0 alle Bundle-Typen installieren (Deb, Rpm, AppImage; NSIS, MSI). Bei Deb/Rpm läuft die Installation über `pkexec dpkg -i` bzw. `pkexec rpm -U` mit Passwortabfrage (B) [S8][S9]. Die offizielle Doku-Seite erwähnt das nicht, der Quelltext schon.
2. **Tauri 3 existiert nur als Alpha** (`3.0.0-alpha.5`, 14.10.2026). Stabil ist weiter 2.12.x (B) [S22][S48].
3. **tauri-action ist jetzt v1** (Release `action-v1.0.0`, 29.06.2026) mit Breaking Changes: `latest.json` verweist nun auf **GitHub-API-Asset-URLs** statt auf `browser_download_url`; `includeUpdaterJson` heißt `uploadUpdaterJson`; die Action bricht ab, wenn `releaseDraft: true` gesetzt ist, der vorhandene Release aber kein Entwurf ist (B) [S4][S5].
4. **Azure Artifact Signing (früher Trusted Signing):** Für Einzelpersonen nur in USA/Kanada. Organisationen in der EU sind zugelassen, aber nur als „legal business entity“ mit Geschäftskennung, Firmen-Domain und Handelsdokumenten (B) [S33]. Eine deutsche Einzelperson oder GbR ist laut Doku nicht ausdrücklich abgedeckt (offen, siehe Abschnitt 7).
5. **AppImage muss auf der ältesten Zielbasis gebaut werden** (Ubuntu 22.04 / Debian 12), sonst steigt die geforderte glibc. Ein AppImage aus der WSL (Ubuntu 24.04) taugt nur für lokale Tests (B) [S14].
6. **x86_64-pc-windows-gnu ist keine Option für Releases:** webview2-com-sys linkt dort nicht statisch, die `WebView2Loader.dll` müsste manuell neben die EXE gelegt werden; Tauri unterstützt offiziell nur das MSVC-Target (B) [S11][S20].
7. **macOS 27 ist Apple-Silicon-only**; macOS 26 Tahoe war die letzte Version für Intel-Macs (S) [S43].

---

## 1. Aktuelle stabile Versionen (Oktober 2026) und Lizenzen

Quelle der Versionen: crates.io-API (`max_stable_version`) bzw. npm-Registry (`/latest`), abgerufen 16.10.2026 [S22][S23]. Alle Tauri-Crates/-Pakete stehen unter `Apache-2.0 OR MIT` (B). Mindest-Rust (MSRV) laut crates.io: **1.90** für alle unten genannten Tauri-Crates. Aktuelle Rust-Stable: **1.99.1** (13.10.2026) [S24].

| Komponente | Crate (Rust) | npm-Paket | Lizenz |
|---|---|---|---|
| tauri | `tauri` **2.12.4** (`tauri-build` 2.7.3) | `@tauri-apps/api` **2.12.4** | Apache-2.0 OR MIT |
| tauri-cli | `tauri-cli` **2.12.3** | `@tauri-apps/cli` **2.12.3** | Apache-2.0 OR MIT |
| updater | `tauri-plugin-updater` **2.14.0** | `@tauri-apps/plugin-updater` **2.14.0** | MIT OR Apache-2.0 |
| process | `tauri-plugin-process` **2.4.0** | `@tauri-apps/plugin-process` **2.4.0** | MIT OR Apache-2.0 |
| dialog | `tauri-plugin-dialog` **2.8.3** | `@tauri-apps/plugin-dialog` **2.8.3** | MIT OR Apache-2.0 |
| fs | `tauri-plugin-fs` **2.7.1** | `@tauri-apps/plugin-fs` **2.7.1** | MIT OR Apache-2.0 |
| opener | `tauri-plugin-opener` **2.7.2** | `@tauri-apps/plugin-opener` **2.7.2** | MIT OR Apache-2.0 |
| shell | `tauri-plugin-shell` **2.5.0** | `@tauri-apps/plugin-shell` **2.5.0** | MIT OR Apache-2.0 |
| os | `tauri-plugin-os` **2.4.0** | `@tauri-apps/plugin-os` **2.4.0** | MIT OR Apache-2.0 |
| http | `tauri-plugin-http` **2.8.3** | `@tauri-apps/plugin-http` **2.8.3** | MIT OR Apache-2.0 |
| log | `tauri-plugin-log` **2.10.1** | `@tauri-apps/plugin-log` **2.10.1** | MIT OR Apache-2.0 |
| single-instance | `tauri-plugin-single-instance` **2.5.4** | **kein npm-Paket** (reines Rust-Plugin, keine JS-API) | MIT OR Apache-2.0 |
| window-state | `tauri-plugin-window-state` **2.5.0** | `@tauri-apps/plugin-window-state` **2.5.0** | MIT OR Apache-2.0 |
| deep-link | `tauri-plugin-deep-link` **2.6.2** | `@tauri-apps/plugin-deep-link` **2.6.2** | MIT OR Apache-2.0 |
| WebDriver | `tauri-driver` **2.1.0** | – | Apache-2.0 OR MIT |
| WebView-Schicht | `wry` 0.57.0 (Apache-2.0 OR MIT), `tao` 0.37.1 (nur Apache-2.0) | – | – |
| GitHub Action | `tauri-apps/tauri-action@v1` (Release `action-v1.0.0`, 29.06.2026) [S42] | – | – |

Hinweise:

- **Tauri 3.0.0-alpha.5** (Crate, 14.10.2026) und `@tauri-apps/plugin-updater` 3.0.0-alpha.3 existieren. Nicht verwenden; `max_stable_version` bleibt 2.12.4 (B) [S22][S48].
- `plugin-single-instance` hat laut Doku keine JavaScript-API und braucht keine Capability (B) [S44].
- `plugin-shell`: Die `open`-API ist in das **opener**-Plugin umgezogen (B) [S44]. Für Cypher Studio gilt: Programme (Blender, Krita …) lieber über eigene Rust-Commands mit `std::process::Command` starten, statt dem Webview Shell-Rechte zu geben (siehe Abschnitt 8).
- Standard-Permission-Sets (aus `permissions/default.toml`) [S45]: `updater:default` = check/download/install/download-and-install; `process:default` = **exit + restart** (für Neustart genügt `process:allow-restart`); `dialog:default` = message/save/open; `opener:default` = open-url/reveal-item-in-dir/default-urls; `os:default` = alles außer Hostname; `log:default` = log; `window-state:default` = filename/restore/save; `deep-link:default` = get-current; `http:default` = fetch, aber **ohne** erlaubte Ursprünge.
- Passende Werkzeug-Versionen (Tests/Frontend), 16.10.2026 [S23]: Vite 8.3.4, React 19.3.1, TypeScript 7.0.2, Vitest 5.0.5 (MIT), `@playwright/test` 1.64.1 (Apache-2.0), jsdom 30.1.3, happy-dom 21.0.3, `@wdio/tauri-service` 1.5.0 (MIT), `@axe-core/playwright` 4.14.0 (**MPL-2.0**, nur Dev-Abhängigkeit).
- GitHub-Runner (Oktober 2026) [S25]: `ubuntu-latest` = 24.04; `ubuntu-22.04` und `ubuntu-22.04-arm` verfügbar; `macos-latest` = macOS 26 Apple Silicon (arm64), Intel nur über `macos-26-intel`/`macos-15-intel`; `windows-latest` = Windows Server 2025 (Visual Studio 2026). Offizielle Actions: `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `actions/upload-artifact` v7.0.2, `swatinem/rust-cache` v2.9.2 [S25].

Beispiel `Cargo.toml` (nur die für Cypher Studio relevanten Abhängigkeiten; Versionen aus der Tabelle):

```toml
[dependencies]
tauri = { version = "2.12", features = [] }
tauri-plugin-opener = "2.7"
tauri-plugin-dialog = "2.8"
tauri-plugin-os = "2.4"
tauri-plugin-log = "2.10"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"

# nur Desktop (so empfiehlt es die Doku für Updater/Single-Instance/Window-State)
[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]
tauri-plugin-updater = "2.14"
tauri-plugin-process = "2.4"
tauri-plugin-single-instance = { version = "2.5", features = ["deep-link"] }
tauri-plugin-deep-link = "2.6"
tauri-plugin-window-state = "2.5"
```

`tauri-plugin-single-instance` muss laut Doku als **erstes** Plugin registriert werden, wenn Deep-Links genutzt werden [S44].

---

## 2. Updater mit GitHub Releases

Quellen: [S1] (Doku), [S8]–[S10] (Plugin-Quelltext und Changelog, Stand `v2`-Branch), [S3]–[S6] (tauri-action), [S2] (Doku GitHub-Pipeline).

### 2.1 Signaturschlüssel (nur Beschreibung, nichts erzeugt)

Die Updater-Signatur ist Pflicht und nicht abschaltbar (B) [S1]. Sie ist eine minisign-Signatur über die Update-Datei und hat nichts mit Windows-/Apple-Zertifikaten zu tun.

```sh
# Einmalig auf einem vertrauenswürdigen Rechner (WSL genügt); Passwort setzen!
npm run tauri signer generate -- -w ~/.tauri/cypher-studio.key
#   -w <Pfad>   Schlüssel in Datei schreiben (es entstehen .key und .key.pub)
#   -p <Pass>   Passwort direkt angeben (sonst interaktive Abfrage)
#   --ci        keine Abfragen; ohne -p wird ein LEERES Passwort verwendet (nicht empfohlen)
#   -f          vorhandene Datei überschreiben
```

Quelle der Optionen: Quelltext `tauri-cli/src/signer/generate.rs` [S21] (B).

Umgebungsvariablen beim Bauen (B) [S1][S21]:

| Variable | Bedeutung |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Inhalt **oder Pfad** des privaten Schlüssels (für `tauri build`/`bundle`). Für `tauri signer sign` muss es der Schlüsseltext selbst sein. |
| `TAURI_SIGNING_PRIVATE_KEY_PATH` | Pfad zur Schlüsseldatei (nur für `tauri signer sign`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Passwort (optional, wenn der Schlüssel keins hat) |

Wichtig:

- `.env`-Dateien werden **nicht** gelesen; die Variablen müssen in der Shell/CI gesetzt sein (B) [S1].
- Geht der private Schlüssel oder sein Passwort verloren, kann man **keine Updates mehr für bereits installierte Apps** veröffentlichen (B) [S1]. Zwei Offline-Kopien (Passwortmanager + verschlüsselter Datenträger) anlegen.
- In `tauri.conf.json` gehört der **Inhalt** des öffentlichen Schlüssels (kein Dateipfad) (B) [S1]. Der öffentliche Schlüssel darf ins Repo.
- `.gitignore` des Projekts enthält bereits `*.key` – gut.
- Zur Schlüsselrotation lässt sich der `pubkey` zur Laufzeit in Rust setzen (`Builder::pubkey` / `updater_builder().pubkey(..)`) (B) [S1]. Rotation geht nur über ein Update, das noch mit dem alten Schlüssel signiert ist.

### 2.2 Konfiguration (`tauri.conf.json`)

```jsonc
{
  "bundle": {
    "createUpdaterArtifacts": true      // true = v2-Format; "v1Compatible" nur für Migration (wird in v3 entfernt)
  },
  "plugins": {
    "updater": {
      "pubkey": "<INHALT der cypher-studio.key.pub, eine Zeile Base64>",
      "endpoints": [
        "https://github.com/<OWNER>/<REPO>/releases/latest/download/latest.json"
      ],
      "windows": { "installMode": "passive" },   // passive (Standard) | basicUi | quiet
      "requireSignedVersion": true               // Anti-Downgrade, siehe unten
    }
  }
}
```

Fakten zu den Feldern (B) [S1][S10]:

- `endpoints`: Array; TLS wird im Release-Build erzwungen (`dangerousInsecureTransportProtocol` nur als Ausnahme). Der nächste Endpoint wird nur bei **Nicht-2xx** abgefragt. Platzhalter in der URL: `{{current_version}}`, `{{target}}` (`linux`/`windows`/`darwin`), `{{arch}}` (`x86_64`/`i686`/`aarch64`/`armv7`), seit Plugin 2.10 zusätzlich `{{bundle_type}}` (`appimage`/`deb`/`rpm`/`app`/`msi`/`nsis`). Eigene Platzhalter gibt es nicht.
- `windows.installMode`: `passive` (kleines Fortschrittsfenster ohne Interaktion, Standard, empfohlen), `basicUi` (Nutzer muss klicken), `quiet` (keine Anzeige; funktioniert nur bei Per-User-Installation oder wenn die App selbst Admin-Rechte hat).
- `requireSignedVersion` (Konfigfeld in 2.14.0 vorhanden): Der Update-Endpoint ist nicht signiert, die Signatur deckt nur die Datei ab. Ohne dieses Flag kann ein Angreifer, der den Endpoint fälscht, ein echtes, aber altes Release mit hochgesetzter `version` anbieten (Downgrade). Mit `requireSignedVersion: true` wird die in der Signatur („trusted comment“) hinterlegte Version mit der angekündigten verglichen. Für ein neues Projekt ohne Altreleases ist das gefahrlos einschaltbar; Releases ohne gespeicherte Version werden abgelehnt (B) [S10].
- `allowDowngrades` (Plugin-Konfig, seit 2.12 nicht mehr aus dem Webview setzbar): Standard `false` (B) [S9][S10].

### 2.3 `latest.json`: Format und was tauri-action daraus macht

Dokumentiertes Mindestformat (statische Datei) (B) [S1]:

```json
{
  "version": "0.2.0",
  "notes": "Änderungen …",
  "pub_date": "2026-10-16T18:00:00Z",
  "platforms": {
    "linux-x86_64":   { "signature": "<INHALT der .sig-Datei>", "url": "https://…" },
    "windows-x86_64": { "signature": "<INHALT der .sig-Datei>", "url": "https://…" },
    "darwin-aarch64": { "signature": "<INHALT der .sig-Datei>", "url": "https://…" }
  }
}
```

- Pflicht: `version`, je Plattform `url` und `signature`. `notes` und `pub_date` (RFC 3339) optional. `signature` ist der **Inhalt** der `.sig`-Datei, kein Pfad/URL. `version` darf mit `v` beginnen.
- **Tauri validiert die gesamte Datei, bevor es die Version vergleicht.** Jeder Plattformeintrag muss vollständig sein (B) [S1].
- Dynamischer Server: bei „kein Update“ `204 No Content`, sonst `200` mit `{version, url, signature, pub_date?, notes?}` (B) [S1].

Was **tauri-action 1.0** tatsächlich schreibt (Quelltext `upload-version-json.ts`) (B) [S5]:

- Es liest eine eventuell schon vorhandene `latest.json` des Releases, ergänzt die Plattformen des laufenden Jobs und lädt die Datei neu hoch (löscht das alte Asset). Jeder Matrix-Job macht das einzeln.
- Schlüssel: `{os}-{arch}` (Hauptschlüssel, nur für das bevorzugte Bundle je Plattform) **und** `{os}-{arch}-{bundle}` (z. B. `windows-x86_64-nsis`, `linux-x86_64-appimage`, `darwin-aarch64-app`). Die zweite Form braucht `tauri-plugin-updater` ≥ 2.10.0 und wird vom Plugin zuerst gesucht, dann `{os}-{arch}` (B) [S4][S8].
- Bei `--target universal-apple-darwin` trägt die Action dieselbe `.app.tar.gz` für `darwin-aarch64` **und** `darwin-x86_64` ein (B) [S5].
- Standardmäßig bevorzugt der Hauptschlüssel `windows-x86_64` die **MSI**, falls vorhanden; mit `updaterJsonPreferNsis: true` die NSIS-EXE (B) [S3][S5].
- Die URLs sind `https://api.github.com/repos/<owner>/<repo>/releases/assets/<id>` (Changelog 1.0.0: „use the github url instead of the browser download url“) (B) [S4][S5]. Das Plugin sendet beim Download `Accept: application/octet-stream` (B) [S8]; damit funktioniert der Download bei öffentlichen Repos ohne Token (A). **Aber:** Unauthentifizierte REST-Anfragen sind auf **60 pro Stunde je IP** begrenzt (B) [S41]. Hinter einem Büro-/Uni-NAT oder bei Massenverteilung kann das Updates blockieren. Abhilfe in Abschnitt „Empfehlungen“ (eigener Worker als Update-Endpoint).

Beispielausgabe, wie sie nach einem vollständigen Lauf aussehen sollte (Struktur aus dem Quelltext abgeleitet, (A); Werte erfunden):

```json
{
  "version": "0.2.0",
  "notes": "See the assets to download this version and install.",
  "pub_date": "2026-10-16T18:00:00.000Z",
  "platforms": {
    "windows-x86_64":        { "signature": "dW50…", "url": "https://api.github.com/repos/OWNER/REPO/releases/assets/111" },
    "windows-x86_64-nsis":   { "signature": "dW50…", "url": "https://api.github.com/repos/OWNER/REPO/releases/assets/111" },
    "darwin-aarch64":        { "signature": "dW50…", "url": "https://api.github.com/repos/OWNER/REPO/releases/assets/222" },
    "darwin-aarch64-app":    { "signature": "dW50…", "url": "https://api.github.com/repos/OWNER/REPO/releases/assets/222" },
    "darwin-x86_64":         { "signature": "dW50…", "url": "https://api.github.com/repos/OWNER/REPO/releases/assets/333" },
    "darwin-x86_64-app":     { "signature": "dW50…", "url": "https://api.github.com/repos/OWNER/REPO/releases/assets/333" },
    "linux-x86_64":          { "signature": "dW50…", "url": "https://api.github.com/repos/OWNER/REPO/releases/assets/444" },
    "linux-x86_64-appimage": { "signature": "dW50…", "url": "https://api.github.com/repos/OWNER/REPO/releases/assets/444" },
    "linux-x86_64-deb":      { "signature": "dW50…", "url": "https://api.github.com/repos/OWNER/REPO/releases/assets/555" },
    "linux-x86_64-rpm":      { "signature": "dW50…", "url": "https://api.github.com/repos/OWNER/REPO/releases/assets/666" }
  }
}
```

Ob die Action die `.deb.sig`/`.rpm.sig` zu den `-deb`/`-rpm`-Schlüsseln verarbeitet, habe ich nicht im Lauf geprüft (U) – der Bundler erzeugt die Signaturen für Deb/Rpm jedenfalls (B) [S21]. Der Prüfschritt im Workflow unten prüft deshalb nur die vier Hauptschlüssel hart.

**Race-Gefahr:** Alle Matrix-Jobs lesen/ersetzen dieselbe `latest.json`. Im Quelltext steht dazu: „since all jobs try to upload this file it tends to conflict often“, deshalb wird mindestens einmal wiederholt (B) [S5]. → `retryAttempts: 2` setzen und nach dem Build prüfen, ob alle Plattformen enthalten sind (Workflow unten).

**Entwurf und `latest`:** `releases/latest/download/…` zeigt nur auf veröffentlichte, nicht als Prerelease markierte Releases. Ein Entwurfs-Release liefert den Updater-Nutzern also nichts, bis du ihn veröffentlichst (A; GitHub-Verhalten) (U). tauri-action 1.0 bricht außerdem ab, wenn `releaseDraft: true` gesetzt ist, der Release zum Tag aber schon veröffentlicht wurde (B) [S4].

### 2.4 Was je Bundle-Typ aktualisierbar ist

(B) aus Doku und Quelltext [S1][S8][S9][S21]:

| Plattform | Erst-Installer für Nutzer | Updater-Artefakt (v2, `createUpdaterArtifacts: true`) | Update möglich? | Manifest-Zusatzschlüssel |
|---|---|---|---|---|
| Windows | `*-setup.exe` (NSIS) | dieselbe EXE + `.sig` | **ja**; startet den Installer (`/UPDATE`, `passive`), App wird dabei automatisch beendet; Per-User-Install braucht kein UAC | `-nsis` |
| Windows | `*.msi` | dieselbe MSI + `.sig` | ja (`msiexec /i`); bei Per-Machine UAC | `-msi` |
| macOS | `*.dmg` (nur Erstinstallation) | `*.app.tar.gz` + `.sig` | **ja**; Bundle wird ersetzt (atomarer Tausch auf APFS, Fallback mit Admin-Abfrage per AppleScript) | `-app` (auch für DMG-Installationen) |
| Linux | `*.AppImage` | dieselbe AppImage + `.sig` | **ja**, ohne Root; die Datei wird an Ort und Stelle ersetzt | `-appimage` |
| Linux | `*.deb` | dieselbe `.deb` + `.sig` | **ja seit Plugin 2.10.0**; Installation per `pkexec dpkg -i`, Fallback `zenity`/`kdialog`-Passwortdialog, dann `sudo` im Terminal | `-deb` |
| Linux | `*.rpm` | dieselbe `.rpm` + `.sig` | **ja seit 2.10.0**; `pkexec rpm -U` (gleiche Fallbacks) | `-rpm` |

Details und Stolpersteine:

- Das Plugin erkennt den eigenen Bundle-Typ aus einem Marker, den der Bundler ins Binary schreibt (`__TAURI_BUNDLE_TYPE_VAR_…`). Ohne Marker (z. B. ungebündelte Binärdatei auf Linux) wird der AppImage-Weg versucht (B) [S8][S21]. **Updates nur testen mit gebündelten Artefakten**, nicht mit `target/release/cypher-studio`.
- Die macOS-Installation extrahiert die `.tar.gz` selbst in Rust und setzt **kein** `com.apple.quarantine` (im Plugin-Quelltext gibt es keinen `xattr`-/Quarantäne-Code) (B/A) [S8]. Ein aktualisiertes Bundle wird daher nicht erneut von Gatekeeper abgefangen.
- Läuft die App unter macOS aus dem DMG-Image oder aus `~/Downloads`, startet macOS sie per „App Translocation“ von einem schreibgeschützten Pfad (S) [S30]; der Updater kann dann nicht ersetzen. Die App sollte beim ersten Start erkennen, ob ihr Pfad `/AppTranslocation/` oder `/Volumes/` enthält, und „bitte nach Programme verschieben“ anzeigen (A).
- Windows beendet die App beim Installationsstart selbst (Einschränkung von Windows-Installern); `relaunch()` wird dort nicht mehr erreicht. Der Installer startet die App neu; seit 2.11 gibt es die Option `restartAfterInstall`, um das abzuschalten (B) [S1][S9].
- `check()` und `Updater::check` liefern `None`, wenn kein neueres Release vorliegt (HTTP 204 oder Version nicht höher) (B) [S8].

### 2.5 Update-Ablauf im Frontend

Variante A: direkt aus dem Frontend (aus der Doku übernommen und um Zustände ergänzt). Capability nötig: `updater:default`, `process:allow-restart`.

```ts
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'available'; version: string; notes?: string }
  | { kind: 'downloading'; received: number; total?: number }
  | { kind: 'installing' }
  | { kind: 'error'; message: string };

export async function checkForUpdate(): Promise<Update | null> {
  // timeout in ms; nie beim Start blockieren, nach dem ersten Rendern im Hintergrund aufrufen
  return await check({ timeout: 15_000 });
}

export async function installUpdate(update: Update, onState: (s: UpdateState) => void) {
  let received = 0;
  let total: number | undefined;
  await update.downloadAndInstall((e) => {
    switch (e.event) {
      case 'Started':  total = e.data.contentLength; onState({ kind: 'downloading', received, total }); break;
      case 'Progress': received += e.data.chunkLength; onState({ kind: 'downloading', received, total }); break;
      case 'Finished': onState({ kind: 'installing' }); break;
    }
  });
  await relaunch(); // unter Windows beendet der Installer die App schon vorher
}
```

Variante B (empfohlen für Cypher Studio, passt zum command-zentrierten IPC-Vertrag): Update in **Rust** prüfen/installieren und den Fortschritt über einen `Channel` melden. Die Doku enthält genau dieses Muster (`fetch_update` + `install_update` mit `PendingUpdate`-State und `Channel<DownloadEvent>`) [S1]. Vorteile: Das Frontend braucht dann **keine** Updater-Permissions; Rust kann das Installieren verweigern, solange ein Job läuft (`BusyReason::updateRunning`/`jobRunning` im Vertrag); Endpoints/Kanal (stable/beta) bleiben im Rust-Teil und sind vom Webview nicht veränderbar („For security reasons some APIs are only available for Rust“ [S1]).

Rust-seitig init (Desktop) (B) [S1]:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_process::init())
    .setup(|app| {
        #[cfg(desktop)]
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        Ok(())
    })
```

Weitere Eigenschaften (B) [S1]: `check({proxy, timeout, headers})`; Neustart nicht zwingend direkt nach der Installation (der Nutzer kann Zeitpunkt wählen); Windows: `on_before_exit`-Hook für Aufräumarbeiten vor dem erzwungenen Beenden.

### 2.6 Fertige GitHub-Actions-Vorlage

Entwurf: `.github/workflows/release.yml`. Bauplan: Tag `v*` löst aus → `prepare` prüft Tag = Version → Matrix baut Windows (nur NSIS), macOS arm64 + x64 getrennt (kein Universal), Linux (AppImage/deb/rpm, auf `ubuntu-22.04` wegen glibc) → tauri-action legt den **Entwurfs-Release** an und lädt Installer, `.sig` und `latest.json` hoch → `verify-release` prüft `latest.json` auf Vollständigkeit. Veröffentlichen bleibt manuell.

Nötige Repo-Secrets (selbst anlegen, nichts davon wurde hier erzeugt): `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. `GITHUB_TOKEN` kommt automatisch; Workflow-Berechtigung `contents: write` ist im Workflow gesetzt (bei „Resource not accessible by integration“ unter Settings → Actions → Workflow permissions „Read and write“ einstellen [S2]).

```yaml
name: release

on:
  push:
    tags: ['v*']
  workflow_dispatch:

# Pro Tag nur ein Lauf; laufende Läufe nicht abbrechen (sonst halbfertige Releases)
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: write   # Release anlegen, Assets hochladen

env:
  APP_DIR: apps/desktop   # Ordner mit package.json und src-tauri/ (an das Repo anpassen)

jobs:
  prepare:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.v.outputs.version }}
    steps:
      - uses: actions/checkout@v7
      - id: v
        shell: bash
        run: |
          VERSION="$(jq -r .version "$APP_DIR/src-tauri/tauri.conf.json")"
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          if [ "$GITHUB_REF_TYPE" = "tag" ] && [ "$GITHUB_REF_NAME" != "v$VERSION" ]; then
            echo "::error::Tag $GITHUB_REF_NAME passt nicht zu version $VERSION in tauri.conf.json"
            exit 1
          fi

  build:
    needs: prepare
    name: build (${{ matrix.name }})
    strategy:
      fail-fast: false
      matrix:
        include:
          - name: windows-x64
            os: windows-latest
            args: '--bundles nsis'            # MSI wird nicht gebraucht; NSIS = Per-User ohne Admin
            rust_targets: ''
          - name: macos-arm64
            os: macos-latest                  # = macOS 26, Apple Silicon
            args: '--target aarch64-apple-darwin --bundles app,dmg'
            rust_targets: 'aarch64-apple-darwin'
          - name: macos-x64                   # optional; macOS 27 ist Apple-Silicon-only
            os: macos-latest
            args: '--target x86_64-apple-darwin --bundles app,dmg'
            rust_targets: 'x86_64-apple-darwin'
          - name: linux-x64
            os: ubuntu-22.04                  # älteste Basis -> niedrigste glibc im AppImage
            args: '--bundles appimage,deb,rpm'
            rust_targets: ''
          # - name: linux-arm64               # ARM-Runner nur in öffentlichen Repos kostenlos
          #   os: ubuntu-22.04-arm
          #   args: '--bundles appimage,deb,rpm'
          #   rust_targets: ''
    runs-on: ${{ matrix.os }}
    timeout-minutes: 60
    defaults:
      run:
        shell: bash
    steps:
      - uses: actions/checkout@v7

      - name: Linux-Systempakete
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
            libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf xdg-utils

      - uses: actions/setup-node@v7
        with:
          node-version: lts/*
          cache: npm
          cache-dependency-path: ${{ env.APP_DIR }}/package-lock.json

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.rust_targets }}

      - uses: swatinem/rust-cache@v2
        with:
          workspaces: ${{ env.APP_DIR }}/src-tauri -> target
          key: ${{ matrix.name }}

      - name: Frontend-Abhängigkeiten
        working-directory: ${{ env.APP_DIR }}
        run: npm ci

      - name: Frontend-Tests (Skript "test" muss "vitest run" sein, kein Watch-Modus)
        working-directory: ${{ env.APP_DIR }}
        run: npm test --if-present

      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          projectPath: ${{ env.APP_DIR }}
          tagName: v__VERSION__                  # __VERSION__ wird durch die App-Version ersetzt
          releaseName: 'Cypher Studio v__VERSION__'
          releaseBody: 'Installationshinweise stehen auf der Downloadseite. Unsignierte Vorabversion: Windows SmartScreen und macOS Gatekeeper zeigen Warnungen.'
          releaseDraft: true
          prerelease: false
          retryAttempts: 2                       # latest.json wird von allen Jobs geschrieben (Konflikte)
          updaterJsonPreferNsis: true
          args: ${{ matrix.args }}

  verify-release:
    needs: [prepare, build]
    runs-on: ubuntu-latest
    steps:
      - name: latest.json im Entwurfs-Release prüfen
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAG: v${{ needs.prepare.outputs.version }}
        run: |
          set -euo pipefail
          # Entwürfe sind über /releases/tags/<tag> nicht auffindbar -> Liste durchsuchen
          REL="$(gh api "repos/$GITHUB_REPOSITORY/releases?per_page=30" --jq "map(select(.tag_name==\"$TAG\"))[0]")"
          if [ -z "$REL" ] || [ "$REL" = "null" ]; then echo "::error::Kein Release für $TAG"; exit 1; fi
          ASSET_ID="$(echo "$REL" | jq -r '.assets[] | select(.name=="latest.json") | .id')"
          gh api "repos/$GITHUB_REPOSITORY/releases/assets/$ASSET_ID" -H "Accept: application/octet-stream" > latest.json
          jq . latest.json
          for k in windows-x86_64 darwin-aarch64 darwin-x86_64 linux-x86_64; do
            jq -e --arg k "$k" '.platforms | has($k)' latest.json > /dev/null \
              || { echo "::error::latest.json ohne Plattform $k (Race? Job erneut starten)"; exit 1; }
          done
          jq -e --arg v "${TAG#v}" '.version == $v' latest.json > /dev/null
          echo "Entwurf vollständig. Release prüfen und manuell veröffentlichen."
```

Anmerkungen zur Vorlage:

- Basis ist die offizielle Vorlage aus [S2], angepasst auf: Tag-Trigger, `ubuntu-22.04`-Matrix, Windows nur NSIS, Updater-Schlüssel, `retryAttempts`, `updaterJsonPreferNsis`, Prüfjob. Die Aktionsversionen (`actions/checkout@v7`, `actions/setup-node@v7`, `tauri-action@v1`, `rust-cache@v2`) entsprechen den aktuellen Hauptversionen [S2][S25]. Für Supply-Chain-Härtung später auf Commit-SHAs pinnen (U).
- Ubuntu-Pakete: `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev` stammen aus [S15]; `patchelf`, `xdg-utils` aus dem Workflow in [S2].
- macOS: Die Ad-hoc-Signatur kommt nicht aus dem Workflow, sondern aus einer macOS-spezifischen Konfigdatei. Tauri liest `tauri.macos.conf.json` automatisch und mergt sie per JSON Merge Patch (B) [S7]. Datei `src-tauri/tauri.macos.conf.json`:

  ```json
  { "bundle": { "macOS": { "signingIdentity": "-" } } }
  ```
- Für spätere Zertifikate (Apple/Azure) kommen weitere `env`-Variablen in den tauri-action-Schritt (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` bzw. `bundle.windows.signCommand`) [S12][S13].
- `verify-release` sucht den Entwurf über die Release-Liste, weil Entwürfe nicht über `releases/tags/<tag>` erreichbar sind (U; mit `gh api` im ersten Lauf kontrollieren).
- macOS-Intel-Job: Der Runner `macos-latest` ist arm64 und baut `x86_64-apple-darwin` per Cross-Target (so auch im offiziellen Beispiel [S2]). Alternativ `macos-26-intel` (B) [S25].
- **Universal-Variante**, falls gewünscht: eine Zeile `args: '--target universal-apple-darwin'` mit `targets: 'aarch64-apple-darwin,x86_64-apple-darwin'`; tauri-action trägt dann dieselbe `.app.tar.gz` für beide Architekturen in `latest.json` ein (B) [S5][S6]. Nachteil: doppelt so große Downloads, und das offizielle Beispiel ist auf Signatur+Notarisierung ausgelegt. Für Cypher Studio nicht nötig.

Zusätzlich ein kleiner CI-Workflow (`ci.yml`) für Pull Requests (nicht Teil der Release-Kette):

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
permissions: { contents: read }
env: { APP_DIR: apps/desktop }
jobs:
  frontend:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: apps/desktop } }
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: lts/*, cache: npm, cache-dependency-path: apps/desktop/package-lock.json }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx vitest run
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test           # Vite-Dev-Server + gemocktes IPC, siehe Abschnitt 9
  rust:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v7
      - run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev \
            libayatana-appindicator3-dev librsvg2-dev patchelf
      - uses: dtolnay/rust-toolchain@stable
        with: { components: 'clippy, rustfmt' }
      - uses: swatinem/rust-cache@v2
        with: { workspaces: 'apps/desktop/src-tauri -> target' }
      - run: cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
      - run: cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
      - run: cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

---

## 3. Windows-Build aus Linux (WSL): cargo-xwin + NSIS, Alternative MinGW

Quellen: [S11] (offizieller Leitfaden), [S16][S17] (cargo-xwin/xwin), [S18][S19] (Microsoft-Lizenz), [S20] (webview2-rs/wry), [S21] (Schema/Bundler).

### 3.1 Offizieller Weg (cargo-xwin) und Einschränkungen

Der Leitfaden „Build Windows apps on Linux and macOS“ [S11] (B):

```sh
# Ubuntu 24.04 (WSL)
sudo apt install nsis lld llvm            # NSIS-Compiler (makensis), LLVM-Linker, llvm-rc für Icon/Ressourcen
sudo apt install clang                    # nur nötig, wenn Abhängigkeiten C/C++ im build.rs kompilieren
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin         # aktuell 0.23.1, MIT, braucht Rust >= 1.89
export XWIN_CACHE_DIR=$HOME/.cache/xwin   # optional: SDK-Cache projektübergreifend teilen

npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc
# Ausgabe: target/x86_64-pc-windows-msvc/release/bundle/nsis/*-setup.exe
```

Das passt zu `scripts/wsl-build.sh` im Projekt (nutzt bereits `--runner cargo-xwin … --bundles nsis`). In der WSL ist das schon eingerichtet: `cargo-xwin 0.23.1`, `makensis` (NSIS 3.09), `lld`, `llvm-rc`, `clang`, Rust-Ziel `x86_64-pc-windows-msvc`; der xwin-Cache (CRT + Windows SDK) belegt dort 1,1 GB. `cargo xwin build --help` bietet keine Lizenz-Option an (bestätigt, dass es keine Abfrage gibt).

Einschränkungen (alle B, [S11][S21]):

| Punkt | Stand |
|---|---|
| Installer-Typ | **nur NSIS (`-setup.exe`)**. MSI geht nur auf Windows, weil WiX nur dort läuft. |
| Reifegrad | Offizielle Wortwahl: „is not tested as much“, „only be used as a last resort if local VMs or CI solutions … don't work“. |
| Signierung | Der Standard `signtool.exe` gibt es nur unter Windows. Cross-Compile braucht `bundle.windows.signCommand` mit einem Tool wie `osslsigncode` (Platzhalter `%1` = Binärpfad) [S21]. Für Cloud-Signierer siehe Abschnitt 7. |
| Erster Lauf | lädt CRT + Windows SDK von Microsoft herunter (Cache `XWIN_CACHE_DIR` bzw. projektlokal) und NSIS-Plugins/Tools von GitHub. Danach `cargo xwin cache` für Offline-Builds [S16]. |
| C-Runtime | Standardmäßig statisch eingebunden (`build.windows.staticVCRuntime`, Default `true`) → Nutzer brauchen kein „VC++ Redistributable“ (B) [S21]. |
| Zielarchitekturen | `x86_64-pc-windows-msvc` offiziell dokumentiert; xwin lädt standardmäßig `x86_64,aarch64` (B) [S16]. ARM64-Windows nicht von mir geprüft (U). |
| Testen | Das Ergebnis läuft nur unter Windows. Aus WSL heraus testen heißt: EXE/Installer auf dem Windows-Host ausführen (siehe Abschnitt 5/9), nicht unter Wine (WebView2 funktioniert dort nicht zuverlässig, (U)). |

### 3.2 Welche Lizenz man mit xwin akzeptiert

- cargo-xwin sagt: „By using this software you are consented to accept the license at https://go.microsoft.com/fwlink/?LinkId=2086102“ (B) [S16]. Es gibt **keinen** Bestätigungsdialog; die Zustimmung ist mit der Nutzung unterstellt. (`xwin` selbst hat `--accept-license` bzw. `XWIN_ACCEPT_LICENSE=1` [S17].)
- Der Link leitet auf `visualstudio.microsoft.com/license-terms/mlt031519/` und von dort auf das Dokument **„Microsoft Software License Terms – Microsoft Visual Studio 2019 Remote Debugger, Stand-alone Profiler, IntelliTrace, Snapshot Debugger, other Debuggers and Build Tools“** (EULA-ID `VS_2019_DiagnosticBuildTools_ENU.1033`) (B) [S18]. Ich habe den Volltext gelesen. Die für uns relevanten Klauseln:
  - *Installation and use rights*: Nutzung „solely with Visual Studio Community, Visual Studio Professional, and Visual Studio Enterprise, to develop and test your applications“.
  - *Build Devices and Visual Studio Build Tools*: Dateien dürfen auf eigene Build-Rechner (auch VMs/Container) kopiert und dort „solely to compile, build, and verify applications developed by using the software“ genutzt werden.
  - Verboten u. a.: „share, publish, rent, or lease the software“ und „provide the software as a stand-alone offering or combine it with any of your applications for others to use“.
- Einordnung (A, **kein Rechtsrat**): Die Klauseln sind für „Build Tools ohne Windows und ohne Visual Studio“ nicht eindeutig. Das Rust-Projekt diskutiert dieselbe Unklarheit seit 2022 ohne finale Auflösung (Microsoft hatte eine Klarstellung für das Bauen von Open-Source-Abhängigkeiten angekündigt) (B) [S19]. Praktisch: Dein fertiges Programm gehört dir; xwin lädt CRT/SDK direkt von Microsoft auf den Entwicklerrechner und Cypher Studio verteilt davon nichts weiter. Das Risiko liegt in der Auslegung der Nutzungsrechte, nicht in der Weitergabe.
- Konsequenz: **Release-Builds für Windows auf dem GitHub-Runner `windows-latest`** (dort sind die Visual-Studio-Build-Tools Teil der von Microsoft/GitHub bereitgestellten Umgebung; MSI wäre möglich, Signierung leichter); cargo-xwin in der WSL nur für lokale Entwicklung und Schnelltests.
- Für das separat lizenzierte Windows SDK existiert ein eigener EULA-Text (nicht gelesen); xwin lädt es mit.

### 3.3 Alternative `x86_64-pc-windows-gnu` (mingw-w64)

Befund (alle B):

- Tauri: „Since Tauri officially only supports the MSVC Windows target …“ [S11].
- wry-Doku: „Targeting *-pc-windows-gnu works now, but it has some limitations“ – Verweis auf webview2-rs [S20]. Die Einschränkung dort: Standardmäßig wird `WebView2LoaderStatic.lib` (statisch, MSVC-Format) gelinkt und keine DLL mitgeliefert; „this doesn't work with the `*-pc-windows-gnu` targets … For the `gnu` targets, it will link against the import lib for `WebView2Loader.dll` instead, and you will need to place this DLL next to your executable or in your `$PATH`“ [S20].
- Der Quelltext von `webview2-com-sys` bestätigt das: `#[cfg_attr(target_env = "msvc", link(name = "WebView2LoaderStatic", kind = "static"))]` und `#[cfg_attr(not(target_env = "msvc"), link(name = "WebView2Loader.dll"))]` [S20].

Folgen für Cypher Studio (A):

- Der Tauri-Bundler legt die `WebView2Loader.dll` nicht von selbst neben die EXE; man müsste sie als Ressource ins NSIS-Paket aufnehmen und bei jeder WebView2-SDK-Aktualisierung nachziehen.
- Zusätzlich hängen GNU-Builds typischerweise an `libgcc_s_seh-1.dll`/`libwinpthread-1.dll`, sofern nicht statisch gelinkt wird (U).
- Der Tauri-Bundler (NSIS-Template, Ressourcenkompilierung, Icon-Einbettung) wird offiziell nur mit MSVC-Toolchains getestet (A).
- Ob ein GNU-Build „zuverlässig“ läuft, ist damit nicht belegt; belegt ist nur, dass er unterstützt-mit-Einschränkungen und nicht der Standardpfad ist. Ich habe keinen GNU-Build ausgeführt.

### 3.4 Empfehlung (Begründung)

| Zweck | Weg | Warum |
|---|---|---|
| Release-Artefakte Windows | `windows-latest` (MSVC) in GitHub Actions | offizieller Hauptpfad, Lizenzlage unproblematisch, später MSI und Signierung möglich, identisch zu dem, was Tauri testet |
| Lokale Windows-Builds ohne Windows-Toolchain | `cargo-xwin` + NSIS in der WSL (vorhanden) | offiziell dokumentiert, schnell, kein Eingriff in den Windows-Rechner; Lizenzhinweis oben beachten |
| MinGW/GNU | nicht verwenden | zusätzliche DLL-Pflicht, Randpfad, kein Gewinn |

---

## 4. Linux-Bundles (Ubuntu 24.04): Pakete, AppImage, deb, rpm, Test in WSL

Quellen: [S14] (AppImage/Debian/RPM-Doku), [S15] (Voraussetzungen), [S21] (Bundler-Quelltext), [S40] (FUSE), [S39] (WSLg, Linux-Grafik), [S46] (Paketnamen).

### 4.1 apt-Pakete (Ubuntu 24.04 „noble“)

Alle genannten Pakete existieren in noble (Seite `packages.ubuntu.com/noble/<paket>` abgerufen) (B) [S46].

```sh
# Bauen (offizielle Liste [S15] + patchelf/xdg-utils aus dem Workflow [S2])
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf xdg-utils

# Windows-Cross-Build (Abschnitt 3)
sudo apt install -y nsis lld llvm clang

# Tests/Kopflos (Abschnitt 4.4, 9)
sudo apt install -y xvfb dbus-x11 webkit2gtk-driver imagemagick xdotool libgl1-mesa-dri

# AppImage ausführen (Ubuntu 24.04: libfuse2 heißt libfuse2t64) [S40]
sudo apt install -y libfuse2t64

# Pakete prüfen
sudo apt install -y rpm          # nur zum Inspizieren: rpm -qpi / -qpl / -qpR
```

- Laufzeit-Abhängigkeiten, die der Bundler ins `.deb` schreibt: `libwebkit2gtk-4.1-0` und `libgtk-3-0`, bei Tray-Nutzung zusätzlich `libappindicator3-1` (B) [S14]. Weitere über `bundle.linux.deb.depends` / `bundle.linux.rpm.depends` (B) [S21].
- WebKitGTK 4.1 gibt es in Ubuntu 22.04, 24.04 und Debian 12 (B) [S14].

### 4.2 Wie die Bundles entstehen

- **.deb und .rpm baut der Tauri-Bundler selbst in Rust** (Crates `ar`, `tar`, `flate2` bzw. `rpm`); es werden weder `dpkg-deb` noch `rpmbuild` benötigt (B) [S21]. Beides entsteht deshalb auch auf Ubuntu.
- **AppImage:** Der Bundler lädt beim Bauen `linuxdeploy` (als AppImage) und `AppRun` von `github.com/tauri-apps/binary-releases` und setzt `APPIMAGE_EXTRACT_AND_RUN=1`. Zum **Bauen** wird daher kein FUSE benötigt (B) [S21]. Das Bauen braucht Internet.
- **glibc-Basis (wichtig):** „you must build your Tauri application using the oldest base system you intend to support that also provides … WebKitGTK 4.1 packages. Ubuntu 22.04 and Debian 12 are suitable baseline examples.“ Ein Build auf neuerer Basis hebt die geforderte glibc an (Fehlerbild: `GLIBC_2.33 not found`) (B) [S14]. → Release-AppImages in CI auf `ubuntu-22.04` bauen (so in der Vorlage). Die AppImage aus der WSL (24.04, glibc 2.39) nur lokal testen.
- Größe: AppImage wächst von 2–6 MB auf „70+ MB“ (B) [S14].
- ARM64-AppImages nur auf ARM-Hardware/Runnern (linuxdeploy kann nicht cross-compilen); seit August 2025 gibt es `ubuntu-22.04-arm`/`ubuntu-24.04-arm` für öffentliche Repos (B) [S14].
- Medienwiedergabe in der WebView (GStreamer) nur falls nötig: `bundle.linux.appimage.bundleMediaFramework`; Plugins aus dem `ugly`-Paket sind lizenzrechtlich heikel (B) [S14].

### 4.3 Eigenheiten des Updaters auf Linux

Siehe Abschnitt 2.4: AppImage wird selbst ersetzt (braucht Schreibrechte auf die Datei, Temp-Verzeichnis auf gleichem Mount, notfalls Cache oder AppImage-Ordner), deb/rpm per `pkexec` mit Passwortdialog (B) [S8][S9].

### 4.4 Installer-Test in der WSL

WSLg (Windows 11 bzw. Windows 10 ≥ 19044, nur WSL 2, vGPU-Treiber des GPU-Herstellers empfohlen) zeigt Linux-GUI-Fenster direkt auf dem Windows-Desktop (B) [S39]. Fehlerdiagnose bei „cannot open display“: Wiki-Seite im WSLg-Repo [S39]. Die Befehle unten sind übliche Muster (U), in diesem Lauf nicht ausgeführt:

```sh
# --- GUI über WSLg ---------------------------------------------------------
echo "$DISPLAY / $WAYLAND_DISPLAY"        # unter WSLg meist ":0" und "wayland-0"
chmod +x Cypher-Studio_0.1.0_amd64.AppImage
./Cypher-Studio_0.1.0_amd64.AppImage                         # braucht libfuse2t64
./Cypher-Studio_0.1.0_amd64.AppImage --appimage-extract-and-run   # ohne FUSE [S40]
# leeres/weißes Fenster oder Absturz beim Skalieren:
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Cypher-Studio*.AppImage       # offizielle Tauri-Hilfe [S39]
# letzte Stufe: WEBKIT_DISABLE_COMPOSITING_MODE=1 (schaltet beschleunigtes Compositing ab) [S39]

# --- .deb / .rpm prüfen ------------------------------------------------------
dpkg -I  cypher-studio_0.1.0_amd64.deb        # Metadaten, Abhängigkeiten
dpkg -c  cypher-studio_0.1.0_amd64.deb        # Inhalt
sudo apt install ./cypher-studio_0.1.0_amd64.deb   # echte Installation inkl. Abhängigkeiten
desktop-file-validate /usr/share/applications/cypher-studio.desktop   # (Paket desktop-file-utils)
sudo apt remove cypher-studio
rpm -qpi cypher-studio-0.1.0-1.x86_64.rpm; rpm -qpR cypher-studio-0.1.0-1.x86_64.rpm   # nur Inspektion

# --- Kopflos (Xvfb) + Screenshot -----------------------------------------------
dbus-run-session -- xvfb-run -a -s "-screen 0 1440x900x24" bash -c '
  ./cypher-studio & APP=$!
  sleep 10
  import -window root /tmp/cypher-linux.png        # ImageMagick
  kill $APP'
```

Hinweise (A/U):

- Tauri-Single-Instance und Deep-Link nutzen D-Bus; deshalb `dbus-run-session` vor `xvfb-run`.
- Im Kopfmodus ohne GPU sind Software-Rendering-Hilfen üblich (`LIBGL_ALWAYS_SOFTWARE=1`, Paket `libgl1-mesa-dri`); die Tauri-Doku nennt nur die `WEBKIT_*`-Variablen [S39]. Unbedingte Overrides im Produktivcode nur setzen, wenn die App nachweislich betroffen ist (Doku-Warnung [S39]).
- **Screenshot nur des Webview-Inhalts** (ohne Fensterrahmen) geht sauberer über WebDriver (`browser.saveScreenshot()` in WebdriverIO) – siehe Abschnitt 9.
- `xvfb-run` ist genau das Muster der offiziellen CI-Anleitung für `tauri-driver` („run it through `xvfb-run` … to have a fake display server“) (B) [S38].
- Der Windows-Installer lässt sich in der WSL nicht ausführen (siehe 5/9).

---

## 5. Windows ohne Signatur

Quellen: [S11], [S12], [S26]–[S28].

### 5.1 SmartScreen-Verhalten bei unsigniertem NSIS-Setup

Mechanik (B) [S26]: SmartScreen prüft heruntergeladene Dateien gegen eine Liste bekannter Schadsoftware und gegen eine Liste „well known and downloaded frequently“ Dateien; ist die Datei nicht darauf, „shows a warning, advising caution“. Reputation hängt an Datei, Zertifikat und URL; ohne Reputation gilt etwas als höheres Risiko und zeigt eine Warnung. Auch Drittbrowser und Mail-Clients werden einbezogen. Die Tauri-Doku sagt es so: Signierung ist „not required to execute your application“; Nutzer können die Warnung ignorieren oder Browser-Downloads meiden (B) [S12]. Seit 2024 geben auch EV-Zertifikate keine sofortige Reputation mehr; jede neue Version kann eine Warnung zeigen, wiederholtes Signieren mit demselben Zertifikat hilft (B) [S12].

Ablauf für den Nutzer (deutsche Windows-Oberfläche), Wortlaut aus Anleitungsseiten (S) [S28]:

1. Fenster mit dem Titel **„Der Computer wurde durch Windows geschützt“**. Text (ältere Fassung): „Von Windows Defender SmartScreen wurde der Start einer unbekannten App verhindert.“ In Windows 11 heißt es nach meiner Erinnerung „Microsoft Defender SmartScreen hat den Start einer unbekannten App verhindert. Das Ausführen dieser App stellt u. U. ein Risiko für den PC dar.“ (U, Wortlaut nicht belegt).
2. Auf den Link **„Weitere Informationen“** klicken. Erst dann erscheinen App-Name und „Herausgeber: Unbekannter Herausgeber“ (S) [S28].
3. Es erscheint die Schaltfläche **„Trotzdem ausführen“** (daneben „Nicht ausführen“) (S) [S28].
4. Alternative ohne Dialog: Rechtsklick auf die Datei → Eigenschaften → Allgemein → Sicherheit → Haken **„Zulassen“/Unblock** (S) [S28].
5. Englisch: „Windows protected your PC“ → „More info“ → „Run anyway“ (S) [S28].

Einschränkungen:

- Manche Edge-Versionen können den Download komplett blockieren und bieten dann kein „Run anyway“ (S) [S28]. Der Nutzer muss im Edge-Downloadmenü „Beibehalten“ wählen (U).
- **Smart App Control** (Windows 11, bei sauberer Neuinstallation aktiv bzw. im Bewertungsmodus) ist strenger: „Malware, PUA, and unknown, unsigned code are blocked by default“; im Erzwingungsmodus „Apps cannot be run unless they are recognized by Microsoft's app intelligence services, or they are signed with a trusted certificate“ (B) [S27]. Eine „Trotzdem ausführen“-Option nennt die Microsoft-Seite dafür nicht. Nutzer mit aktivem Smart App Control (Einstellungen → Windows-Sicherheit → App- & Browsersteuerung) kommen an einer unsignierten Setup-EXE ohne Abschalten der Funktion nicht vorbei (A). Das ist ein starkes Argument für spätere Signierung.
- SmartScreen schützt vor Dateien aus dem Internet, ausdrücklich nicht vor Dateien auf internen Pfaden oder Netzwerkfreigaben (B) [S26]. Was als „aus dem Internet“ gilt, entscheidet in der Praxis die Markierung „Mark of the Web“ (NTFS-Zone), die Browser und Mail-Programme setzen; Dateien, die z. B. per PowerShell oder `curl.exe` geladen werden, tragen sie nicht (U, nicht geprüft). Der Tauri-Updater lädt per HTTP-Client direkt und schreibt ebenfalls keine Markierung (A).

### 5.2 WebView2-Bootstrapper-Optionen

(B) [S11], Konfig `bundle.windows.webviewInstallMode`:

| Typ | Internet nötig | Installer größer um | Hinweis |
|---|---|---|---|
| `downloadBootstrapper` | ja | 0 MB | **Standard**, in der Schema-Voreinstellung zusätzlich `silent: true` [S21] |
| `embedBootstrapper` | ja | ca. 1,8 MB | bessere Unterstützung auf Windows 7/MSI |
| `offlineInstaller` | nein | ca. 127 MB | WebView2 komplett im Installer; für Offline-Umgebungen |
| `fixedRuntime` (Doku-Abschnitt „Fixed Version“) | nein | ca. 180 MB | feste WebView2-Version wird mitgeliefert; Patches liegen dann bei dir |
| `skip` | nein | 0 MB | nicht empfohlen: ohne Runtime startet die App nicht |

Windows 10 (ab April 2018) und Windows 11 bringen WebView2 bereits mit (B) [S11][S49]. Der Bootstrapper greift also nur bei seltenen Altsystemen. **Empfehlung: Standard `downloadBootstrapper` beibehalten.** Eine Mindestversion kann man erzwingen, was für Cypher Studio relevant ist, weil der Bildschirm eigene URI-Schemata (`cyfile:`, `cythumb:`, `cyasset:` laut IPC-Vertrag) nutzt – die Doku nennt „custom URI schemes“ ausdrücklich als Beispiel für Funktionen, die neuere WebView2-Versionen brauchen (B) [S11]:

```json
{ "bundle": { "windows": { "minimumWebview2Version": "110.0.1531.0" } } }
```

### 5.3 Installation pro Benutzer ohne Admin

NSIS ist standardmäßig bereits **Per-User** (`installMode: "currentUser"`): kein Administrator nötig, Installation nach `%LOCALAPPDATA%`; `perMachine` (Programme-Ordner, Admin) und `both` (Auswahl, Installer verlangt Admin) sind Alternativen (B) [S11][S21]:

```json
{
  "bundle": {
    "targets": ["nsis", "app", "dmg", "appimage", "deb", "rpm"],
    "windows": {
      "webviewInstallMode": { "type": "downloadBootstrapper" },
      "minimumWebview2Version": "110.0.1531.0",
      "nsis": {
        "installMode": "currentUser",
        "languages": ["German", "English"],
        "displayLanguageSelector": false,
        "compression": "lzma"
      }
    }
  },
  "plugins": { "updater": { "windows": { "installMode": "passive" } } }
}
```

(`languages`/`displayLanguageSelector`/`compression` existieren im Schema [S21]; Wert-Schreibweisen vor Verwendung gegen das Schema prüfen.) Mit Per-User-Install und `passive`-Update erscheint für Installation und Updates **keine UAC-Abfrage**; `quiet` ist nur dort sinnvoll (B) [S1]. Der WebView2-Bootstrapper selbst installiert (falls überhaupt nötig) systemweit und kann UAC auslösen (U).

---

## 6. macOS ohne Apple-Zertifikat

Quellen: [S13] (Tauri-Doku Signierung), [S2] (Hinweis zu GitHub-Releases), [S29] (Apple Support), [S30] (Sequoia-Änderung), [S31] (Quarantäne), [S43], [S8] (Updater).

### 6.1 Gatekeeper-Verhalten (Sequoia 15 / Tahoe 26)

Was Apple selbst sagt [S29] (B): Gatekeeper prüft Entwickler-Signatur, Notarisierung (Apples Malware-Scan, seit Catalina Standard) und ob die Software verändert wurde. Nicht notarisierte Software: „Warnings appear, and the app may be blocked“; veränderte/beschädigte Apps lassen sich nicht öffnen. Der Weg für unbekannte Software in macOS 15 (Sequoia):

1. App öffnen (der Versuch schlägt fehl und merkt sich die App).
2. **Systemeinstellungen → Datenschutz & Sicherheit**, nach unten zum Abschnitt „Sicherheit“ scrollen.
3. Für die blockierte App **„Dennoch öffnen“** (englisch „Open Anyway“) klicken.
4. Im Warnfenster mit „Öffnen“ bestätigen, mit Anmeldepasswort/Touch ID authentifizieren. Danach ist die App als Ausnahme gespeichert.

Die neuere Apple-Hilfeseite (Versionsauswahl bis macOS 27) nennt zusätzlich: Die Schaltfläche „Open Anyway“ steht **etwa eine Stunde** nach dem Öffnungsversuch zur Verfügung; sie erwähnt Control-Klick nicht mehr (B) [S29].

**Rechtsklick → Öffnen funktioniert nicht mehr.** Apple hat den Control-Klick-Override mit Sequoia entfernt; zitiert wird die Apple-Aussage: „In macOS Sequoia, users will no longer be able to Control-click to override Gatekeeper when opening software that isn't signed correctly or notarized. They'll need to visit System Settings > Privacy & Security …“ (S) [S30]. Betaberichte weichen darin ab, ob das Kontextmenü nach einmaliger Freigabe wieder funktioniert (S) [S30] – nicht verlassen. Der Fluss nutzt außerdem „App Translocation“ (die App läuft aus einem versteckten, schreibgeschützten Pfad, wenn sie aus Downloads gestartet wird) (S) [S30].

**Tahoe 26:** Die Apple-Hilfeseite zeigt weiterhin die „Open Anyway“-Route, ohne Tahoe gesondert zu beschreiben; Berichte über strengere Durchsetzung in 26.2/26.5 stammen nur aus Blogs und sind widersprüchlich (S, nicht belegt). Ich behandle Tahoe wie Sequoia (A). **Auf einem echten Mac mit macOS 26 testen, bevor die Anleitung auf die Downloadseite kommt.**

Terminal-Alternative (Entfernen des Quarantäne-Attributs, danach öffnet sich die App ohne Dialog):

```sh
xattr -dr com.apple.quarantine "/Applications/Cypher Studio.app"
# oder gleichwertig mit Backslash: xattr -dr com.apple.quarantine /Applications/Cypher\ Studio.app
```

Eigenschaften (S/A): Der Befehl nimmt Gatekeeper den Anlass zu prüfen; er repariert **keine** ungültige oder fehlende Signatur (Berichte über Apps, die trotz entferntem Attribut „beschädigt“ bleiben, weil die Signatur kaputt ist) (S) [S50]. Das `-r` macht es rekursiv, nötig für das Bundle-Verzeichnis.

### 6.2 Ad-hoc-Signatur (`signingIdentity: "-"`) und „App ist beschädigt“

- Tauri-Doku: „If you do not wish to provide an Apple-authenticated identity, but still wish to sign your application, you can configure an *ad-hoc* signature. This is useful on ARM (Apple Silicon) devices, where code-signing is required for all apps from the Internet.“ Konfiguration: `"signingIdentity": "-"` (B) [S13].
- Warnhinweis derselben Doku: Ad-hoc-Signieren **erspart nicht** das Freigeben unter „Datenschutz & Sicherheit“ (B) [S13].
- GitHub-Hinweis der Tauri-Doku: Ohne Apple-Zertifikat eine Ad-hoc-Identität einrichten, „This can avoid macOS treating Apple Silicon builds downloaded from GitHub releases as damaged“ (B) [S2].
- Technisch läuft `"-"` im Bundler als Pseudo-Identität durch denselben Signierpfad (`Keychain::with_signing_identity`) wie echte Identitäten; ohne Identität wird gar nicht signiert (B) [S21]. Hardened Runtime ist Standard (`hardenedRuntime: true`) (B) [S21]. Achtung: Ist zusätzlich `APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD` gesetzt, vergleicht der Bundler die Identität mit dem Zertifikat und bricht bei `"-"` mit einem Fehler ab; ad-hoc und Zertifikat nie mischen (B) [S21]. Fehlen die Notarisierungs-Variablen, wird die Notarisierung mit einer Warnung übersprungen (B) [S21].
- Meldung **„… ist beschädigt und kann nicht geöffnet werden“** entsteht typischerweise, wenn das Bundle eine ungültige/fehlende Signatur hat und mit Quarantäne-Attribut ankommt; bei Apple Silicon ist eine Signatur für Code aus dem Internet zwingend (B/S) [S13]. Ad-hoc beseitigt diese Klasse von Fehlern und führt zur regulären „nicht verifizierter Entwickler“-Warnung mit „Dennoch öffnen“. (Dass `"-"` den „beschädigt“-Fall für die gebauten Tauri-Bundles vollständig verhindert, ist die Aussage der Tauri-Doku [S2]; ich konnte es ohne Mac nicht selbst nachstellen.)
- Nebenwirkung (U): Eine Ad-hoc-Signatur ist an den Hash des Codes gebunden. Systemfreigaben, die macOS an die Code-Identität knüpft (z. B. Dateizugriff auf bestimmte Ordner, Bedienungshilfen), können nach jedem Update erneut abgefragt werden. Das betrifft Cypher Studio nur, wenn solche Freigaben genutzt werden.
- Die Konfiguration gehört in eine macOS-spezifische Datei, damit Windows/Linux unberührt bleiben (B) [S7]:

  ```jsonc
  // src-tauri/tauri.macos.conf.json  (wird automatisch gemergt)
  { "bundle": { "macOS": { "signingIdentity": "-" } } }
  ```

### 6.3 Updater bei unsignierten macOS-Apps

- Die Update-**Signatur** (minisign) ist unabhängig von Apple-Signierung; der Updater verifiziert die `.app.tar.gz` mit deinem Tauri-Schlüssel (B) [S1][S8].
- Das Plugin entpackt die Datei selbst, tauscht das Bundle (atomar auf APFS, sonst Verschieben mit Wiederherstellung) und braucht bei Schreibschutz Admin-Rechte über einen AppleScript-Dialog („with administrator privileges“) (B) [S8]. Es setzt keine Quarantäne (kein `xattr`-Aufruf im Plugin) → nach einem Update erscheint **keine neue Gatekeeper-Abfrage** (A). Nur die Erstinstallation aus dem DMG braucht „Dennoch öffnen“.
- Vorbedingung: App liegt in `/Applications` (oder einem beschreibbaren Ordner) und läuft nicht aus dem DMG/Translocation (A, siehe 2.4).
- Das neue Bundle ist wieder ad-hoc signiert (anderer Hash); das stört den Update-Vorgang nicht (A).

### 6.4 Wirkung für die Downloadseite

- Quarantäne-Attribut setzen nur Programme, die sich dafür anmelden (Browser, Mail …); `curl` setzt es **nicht**; Dateien ohne dieses Attribut werden von Gatekeeper nicht geprüft (Unit 42: „files lacking the com.apple.quarantine will be excluded from a Gatekeeper check“; Red Canary: Attribut ist Opt-in) (S) [S31]. Die Apple-Seite sagt dagegen nur „checked the first time it's opened, regardless of how it arrived“ [S29] – der Widerspruch ist ungeklärt (U). Ein Terminal-Einzeiler als Alternative zur DMG-Installation ist deshalb möglich, aber vor dem Anbieten auf einem Mac zu testen und aus Sicherheitsgründen nur als zweiter Weg zu präsentieren.
- Apple Silicon braucht in jedem Fall mindestens die Ad-hoc-Signatur, auch ohne Quarantäne (Kernel verlangt eine Signatur für arm64-Code) (U).
- macOS 27 läuft nur noch auf Apple-Silicon-Macs; macOS 26 Tahoe war die letzte Version für Intel; Rosetta 2 bleibt als allgemeines Werkzeug bis macOS 27 (S) [S43]. Ein Intel-Build ist also optional, für Nutzer von Tahoe-Intel-Macs aber noch eine Weile sinnvoll.

---

## 7. Kosten und Optionen der Code-Signierung (nur Information, nichts beantragt)

Quellen: [S32]–[S35], [S12], [S13], [S27].

### 7.1 Apple Developer Program

- **99 USD pro Mitgliedsjahr**, Preise regional abweichend und in lokaler Währung bei der Anmeldung angezeigt; Gebührenbefreiung nur für gemeinnützige Organisationen, anerkannte Bildungseinrichtungen und Behörden (B) [S32].
- Anmeldung als **Einzelperson** (auch Einzelunternehmer) oder **Organisation** (Rechtsträger, D-U-N-S-Nummer, Website, Firmen-E-Mail, vertretungsberechtigt); Apple-Account mit Zwei-Faktor-Authentifizierung nötig (B) [S32]. Für den Namen in der Signatur gilt bei Einzelpersonen der persönliche Name.
- Enthalten: Developer-ID-Zertifikat („Developer ID Application“) und Apples Notarisierung für Verteilung außerhalb des Mac App Store (B) [S32]. Nur der Account Holder kann Developer-ID-Zertifikate erstellen; Notarisierung ist bei Developer-ID-Zertifikaten Pflicht (B) [S13]. Ein kostenloses Konto kann **nicht** notarisieren (B) [S13].
- Tauri-Einbindung: Zertifikat als `.p12` Base64 in `APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, Notarisierung über `APPLE_API_ISSUER`/`APPLE_API_KEY`/`APPLE_API_KEY_PATH` oder `APPLE_ID`/`APPLE_PASSWORD` (App-Passwort)/`APPLE_TEAM_ID`; Signieren erfordert ein Apple-Gerät (CI-Runner `macos-latest` genügt) (B) [S13].

### 7.2 Windows

| Option | Kosten (Stand 16.10.2026) | Voraussetzungen / Bedingungen | Wirkung |
|---|---|---|---|
| **Azure Artifact Signing** (früher Azure Code Signing / Trusted Signing) | **Basic 9,99 USD/Monat** (5.000 Signaturen/Monat), **Premium 99,99 USD/Monat** (100.000), darüber 0,005 USD/Signatur; Rechnung immer voller Monatsbetrag, nicht anteilig (B) [S33] | Bezahltes Azure-Abo (kein Free/Trial/Sponsored); Entra-Tenant; Identitätsprüfung (Organisation: 1–20 Werktage, bis zu 3 Dokumentenrunden). **Öffentliches Vertrauen („Public Trust“) für Organisationen** in USA, Kanada, EU, UK, Australien, Neuseeland, Japan, Südkorea, Singapur, Schweiz, Norwegen, Israel. **Einzelpersonen nur in USA/Kanada.** Organisation = „legal business entity“ mit Geschäftskennung, E-Mail auf eigener Domain, Handelsdokumenten (B) [S33] | Kurzlebige Zertifikate (HSM, FIPS 140-3 L3), von Microsoft vertraut; **kein EV**, „no plan to issue EV“; SmartScreen-Reputation baut sich pro Datei-Hash auf (B) [S33]; Tauri-Anbindung per `artifact-signing-cli` als `signCommand` (B) [S12]; Smart-App-Control-tauglich, weil Zertifikat aus Microsoft-Trusted-Root (A) [S27] |
| **OV-Zertifikat** (klassisch) | grob **220–400 USD/Jahr** je Anbieter (Sectigo/Comodo ab ca. 219, DigiCert ca. 400) (S) [S35] | Seit Juni 2023 muss der private Schlüssel auf FIPS-140-2-Level-2/CC-EAL4+-Hardware liegen (USB-Token oder Cloud-HSM wie SSL.com eSigner, DigiCert KeyLocker); exportierbare `.pfx` werden nicht mehr ausgeliefert (S) [S35]. OV ist für Einzelpersonen verfügbar, EV nur für registrierte Organisationen (S) [S35] | Entfernt SmartScreen-Warnung **nicht** sofort: auch OV/EV bauen Reputation erst durch Downloads auf (B) [S12]. Tauri-Doku-Anleitung für OV gilt nur für vor dem 01.06.2023 erworbene Zertifikate (B) [S12] |
| **Certum Code Signing (Shop-Preise)** | Open-Source-Zertifikat in der Cloud (SimplySign) **49 €**, Standard Cloud 209 €, EV Cloud 379 €; Karten-Varianten: Open Source 69 € (Set) / 25 € (Code), Standard 169 €/139 €, EV 359 €/329 € (B) [S35] | Seit 27.02.2026 max. 459 Tage Gültigkeit je Zertifikat; mehrjährige Pakete enthalten kostenlose Neuausstellungen. Ob Privatpersonen berechtigt sind, nennt die Seite nicht (B) [S35]. Authenticode-Tauglichkeit der Open-Source-Variante und Namensformat nicht von mir geprüft (U) | günstigste kostenpflichtige Option für ein Open-Source-Projekt; Signierung in CI erfordert die Cloud-Anbindung (SimplySign) – Integration mit Tauri-`signCommand` nicht geprüft (U) |
| **SignPath Foundation** | **kostenlos** für Open-Source-Projekte (B) [S34] | siehe Liste unten | Zertifikat ausgestellt auf „SignPath Foundation“ (nicht auf dich), Schlüssel im HSM von SignPath (B) [S34] |

Hinweise zu Azure Artifact Signing (B) [S33]: Es gibt keine eigene Zertifikatsdatei; die Signierung läuft über das SignTool-Plugin/die GitHub Action/den SDK. Die Aufgabe „GbR in der EU“ ist **nicht eindeutig** beantwortbar: Die Quickstart-Seite verlangt „legal business entity“ mit Geschäftskennung (Organisation, im Text auch „DBA“); Einzelpersonen nur in USA/Kanada. Eine reine GbR/ein Einzelunternehmer ohne Handelsregister dürfte weder als Einzelperson (Region) noch sicher als Organisation durchgehen – im Zweifel vorher bei Microsoft nachfragen (A, offen). Eine Händler-Vergleichsseite behauptet, die Einzelentwickler-Anmeldung sei seit März 2026 pausiert; in der offiziellen Doku fand ich dazu nichts (S, ungeprüft).

**SignPath Foundation: Bedingungen** (B) [S34] (Seite `signpath.org/terms`):

- OSI-genehmigte Open-Source-Lizenz **ohne kommerzielle Dual-Lizenzierung** für alle Komponenten (MIT passt); kein proprietärer Code (Systembibliotheken erlaubt); aktiv gepflegt; bereits in der zu signierenden Form veröffentlicht; Funktion auf Download-/Store-Seite beschrieben.
- Kein Malware/PUA; keine Werkzeuge zum Aufspüren/Ausnutzen von Sicherheitslücken oder zum Umgehen von Schutzmaßnahmen.
- Nur eigene Projekte und aus eigenem Quelltext gebaute Binärdateien; das Signierteam muss Entwicklungs- und Wartungsteam inkl. Repo-Eigentum sein; Upstream-Bibliotheken sind von den Maintainern zu signieren (unsignierte Upstream-Binärdateien dürfen enthalten sein).
- Datenschutz: Datenübertragungen offenlegen (Datenschutzerklärung, bei Installation anzeigen, abschaltbar); Systemkonfigurationsänderungen mit Warnung; Installer müssen deinstallierbar sein.
- Alle Teammitglieder mit **Multi-Faktor-Authentifizierung** (SignPath und Quell-Repository); Rollen Author/Reviewer/Approver.
- Auf Homepage/Repository: Seite mit **„Code signing policy“**, Zeile „Free code signing provided by SignPath.io, certificate by SignPath Foundation“, Teamrollen und Mitglieder, Link zur Datenschutzerklärung.
- SignPath-Konfiguration: Metadaten setzen und erzwingen (Produktname = Projektname, Produktversion je Build konsistent). **Builds müssen aus dem Quelltext nachvollziehbar sein** (Build-Skripte und CI-Konfiguration eingecheckt) und **jede Veröffentlichung wird manuell freigegeben**.
- Die GitHub Action `SignPath/github-action-submit-signing-request@v2` lädt ein per `actions/upload-artifact` hochgeladenes Artefakt (`github-artifact-id`), wartet auf die Signierung und lädt das Ergebnis (Eingaben `api-token`, `organization-id`, `project-slug`, `signing-policy-slug`, `artifact-configuration-slug`, `output-artifact-directory` …) (B) [S34]. Antragsformular: `signpath.org/apply` (nichts beantragt).

**Technische Stolpersteine bei Fremd-Signierung mit Tauri** (A, aus dem Verhalten von Bundler und Updater abgeleitet):

1. Die Authenticode-Signatur ändert die Installer-Datei. Die Updater-`.sig` muss **danach** erzeugt werden, sonst schlägt die Signaturprüfung im Updater fehl. Das CLI kann nachträglich signieren: `tauri signer sign -f <Schlüsseldatei|Text> -p <Passwort> --app-version <X.Y.Z> <datei>` (Option `--app-version` bindet die Version in die Signatur; ohne sie lehnen Updater mit `requireSignedVersion` die Signatur ab) (B) [S21].
2. Zu signieren sind die installierte `cypher-studio.exe` **und** der Installer (und der Uninstaller). Smart App Control prüft jede ausgeführte EXE [S27]. Das Tauri-`signCommand` ruft synchron ein Tool auf; SignPath verlangt aber einen GitHub-Artefakt-Upload als Herkunftsnachweis. Skizze (nicht getestet): `tauri build --no-bundle` → EXE hochladen und per SignPath signieren → zurückkopieren → `tauri bundle` (Befehl existiert: „Generate bundles and installers for your app (already built by `tauri build`)“; `--no-sign` überspringt das Updater-Signieren) (B) [S21] → Installer ein zweites Mal signieren lassen → `tauri signer sign` für die `.sig` → `latest.json` selbst erzeugen oder per tauri-action-Option `uploadUpdaterJson: false` und eigenes Skript.
3. Mit Azure Artifact Signing oder einem Cloud-HSM-Zertifikat geht das glatter, weil das Tauri-`signCommand` die Tools direkt aufruft (Beispiel `artifact-signing-cli` in [S12]).

---

## 8. Tauri-Sicherheit: Capabilities, CSP, Asset-Protokoll, Downloads, Crates

Quellen: [S36] (Capabilities, Permissions, Scope, CSP, Asset-Protokoll), [S37] (Channels), [S44]/[S45] (Plugins), [S22] (Crate-Daten), [S47] (rPGP, minisign-verify).

### 8.1 Capabilities/Permissions-Modell (v2)

Aufbau (B) [S36]:

- **Permission** = Freigabe (oder Sperre, `deny-…`) eines Commands/Scopes, z. B. `dialog:allow-open`. Plugins liefern Sets wie `<plugin>:default`.
- **Capability** = JSON-/TOML-Datei in `src-tauri/capabilities/`, die Permissions an Fenster/Webviews (`windows`, `webviews`) und optional Plattformen (`platforms`) bindet. Alle Dateien dort sind standardmäßig aktiv; sobald `app.security.capabilities` in `tauri.conf.json` gesetzt ist, gelten nur die dort genannten. Ist ein Fenster in mehreren Capabilities, werden die Rechte **vereinigt**.
- **Scopes** (Pfad-/URL-Muster mit `allow`/`deny`; `deny` schlägt `allow`) schränken Plugin-Commands feiner ein.
- **Fernzugriff** (Webseiten dürfen Tauri-Commands) ist standardmäßig aus und muss pro Capability mit `remote.urls` freigegeben werden.
- **Eigene Commands:** Standardmäßig sind alle in `invoke_handler` registrierten Commands für **alle** Fenster/Webviews erlaubt. Einschränken über `tauri_build::AppManifest::commands(&[…])` in `build.rs`; danach müssen die erzeugten Permissions (Namensschema `allow-<command-kebab>`, (A)) in einer Capability stehen (B) [S36].

```rust
// src-tauri/build.rs  (aus der Doku [S36])
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["fetch_update", "install_update" /* … */])),
    )
    .unwrap();
}
```

Vorschlag für Cypher Studio (A): Das Frontend bekommt nur Kern-Rechte, `dialog` (Ordner/Datei wählen), `opener` (URLs), `os` (Plattform), `window-state`, `log`, ggf. `process:allow-restart`. **Kein** `fs`, `http`, `shell` – Dateizugriff, Netzwerk und Prozessstart passieren ausschließlich in Rust-Commands mit Validierung:

```jsonc
// src-tauri/capabilities/default.json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "description": "Hauptfenster: Kern, Dialoge, URL-Öffnen, Systeminfo",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:allow-open",
    "opener:default",
    "os:allow-platform",
    "os:allow-arch",
    "log:default",
    "window-state:default",
    "process:allow-restart"
  ]
}
```

Hinweis: Der Pfad des `$schema` und die Namen der Core-Sets stammen aus dem Doku-Beispiel [S36] (`core:path:default`, `core:event:default`, `core:window:default`, `core:app:default`, `core:resources:default`, …); `core:default` fasst die Core-Sets zusammen (U) – nach `tauri dev` gegen `gen/schemas/` prüfen. `opener:default` erlaubt `http(s)`, `mailto:`, `tel:` und „im Ordner anzeigen“ (B) [S45]; weitere Ziele nur über einen Scope.

### 8.2 CSP

(B) [S36] Tauri begrenzt die CSP der Seiten; der Schutz greift **nur, wenn `app.security.csp` gesetzt ist** (aktuell im Projekt `null` → ungeschützt!). Tauri ergänzt beim Build automatisch Hashes für lokale Skripte und Nonces für Styles/externe Skripte. Fremde Inhalte (CDN-Skripte) vermeiden. Bei WebAssembly `'wasm-unsafe-eval'` in `script-src`. Das Doku-Beispiel: `default-src 'self' customprotocol: asset:`, `connect-src ipc: http://ipc.localhost`, `img-src 'self' asset: http://asset.localhost blob: data:`.

Vorschlag für Cypher Studio (A, **gegen die laufende App testen**; Vite-Entwicklungsserver braucht zusätzlich `devCsp` mit `ws://localhost:1420`). Windows liefert Custom-Protokolle als `http://<schema>.localhost` (wie im IPC-Vertrag vermerkt):

```json
{
  "app": {
    "security": {
      "csp": {
        "default-src": "'none'",
        "script-src": "'self'",
        "style-src": "'self'",
        "style-src-attr": "'unsafe-inline'",
        "img-src": "'self' data: blob: cyfile: cythumb: cyasset: http://cyfile.localhost http://cythumb.localhost http://cyasset.localhost",
        "font-src": "'self'",
        "connect-src": "ipc: http://ipc.localhost",
        "worker-src": "'self' blob:",
        "object-src": "'none'",
        "base-uri": "'none'",
        "form-action": "'none'",
        "frame-ancestors": "'none'"
      },
      "freezePrototype": true,
      "assetProtocol": { "enable": false }
    }
  }
}
```

`style-src-attr 'unsafe-inline'` ist nur nötig, wenn React `style={{…}}`-Attribute setzt (Attribute lassen sich nicht per Nonce erlauben) (U). `freezePrototype` (Schema-Feld vorhanden [S21]) härtet gegen Prototype-Pollution, kann aber Bibliotheken stören, die Prototypen verändern (U). Weil `connect-src` nur `ipc:` erlaubt, kann das Webview **keine** eigenen Netzwerkanfragen stellen – Downloads laufen zwangsläufig über Rust.

### 8.3 Asset-Protokoll

(B) [S36] `convertFileSrc` lädt lokale Dateien über das `asset:`-Protokoll in die WebView. Erfordert `app.security.assetProtocol.enable: true` und einen `scope` (Array von Glob-Mustern oder Objekt `{allow, deny, requireLiteralLeadingDot}`); Platzhalter wie `$APPDATA`, `$APPCACHE`, `$RESOURCE`, `$HOME`; aufgelöste Pfade sind absolut, `["*/**"]` greift deshalb unter Linux nicht. Auf Unix gilt `requireLiteralLeadingDot = true`: Wildcards passen nicht auf Pfadteile, die mit `.` beginnen (`.cache`). Für Dateien `**/*` statt `**`. Zur Laufzeit gewählte Ordner brauchen `tauri-plugin-persisted-scope` mit Feature `protocol-asset`. CSP: `asset:` und `http://asset.localhost` in `img-src` ergänzen.

Für Cypher Studio (A): Die eigenen Handle-basierten Schemata (`cyfile:`, `cythumb:` …) sind sicherer als ein großzügiger Asset-Scope, weil Rust jeden Pfad aus einem undurchsichtigen Handle auflöst. Asset-Protokoll deaktiviert lassen; in den Protokoll-Handlern Pfade kanonisieren, Handles prüfen, `Content-Type` selbst setzen, `X-Content-Type-Options: nosniff`, keine Verzeichnisauflistung.

### 8.4 Downloads im Rust-Teil mit Fortschritts-Events (reqwest + Channel)

Warum Channel statt Events: Das Event-System wertet intern JavaScript aus und ist für viele Daten ungeeignet; Channels „are designed to be fast and deliver ordered data“ und werden von Tauri selbst für Download-Fortschritt genutzt (B) [S37]. Im Frontend: `invoke('download', { req, onEvent: new Channel(...) })`.

Abhängigkeiten (siehe 1): `reqwest` mit `stream`-Feature (`bytes_stream`), `futures-util`, `sha2`, `hex`, `tokio` (`fs`, `io-util`), `tokio-util` (CancellationToken). TLS: Das Updater-Plugin nutzt `reqwest` 0.13 mit `rustls-no-provider` und `rustls` (`ring`) (B) [S22]; reqwest 0.13 bringt mit seinem Standard (`default-tls` = `rustls` + aws-lc-rs) einen zweiten Krypto-Provider mit. Einfachste Variante: reqwest-Standard + Feature `stream`. Schlanker: wie das Updater-Plugin `default-features = false, features = ["rustls-no-provider","stream","http2","charset","system-proxy"]` plus `rustls = { version = "0.23", default-features = false, features = ["ring"] }` und beim Start `rustls::crypto::ring::default_provider().install_default().ok();` (A).

Skizze (in der WSL mit `cargo check` übersetzt – Rust 1.99.1 gegen `reqwest 0.13.5` (Features `rustls-no-provider`, `stream`, `http2`, `charset`, `system-proxy`), `sha2 0.11.1`, `tokio 1.x`, `tokio-util 0.7`, `hex 0.4` und das echte `tauri::ipc::Channel` aus `tauri 2.12.4`; **nicht ausgeführt**, Fehlerbehandlung gekürzt; Wegwerf-Crate danach gelöscht):

```rust
use std::{path::PathBuf, time::{Duration, Instant}};
use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tokio::{fs, io::AsyncWriteExt};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "event", content = "data")]
pub enum DownloadEvent {
    Started { total: Option<u64> },
    Progress { received: u64 },
    Verifying,
    Finished { sha256: String },
}

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("Netzwerk: {0}")]  Http(#[from] reqwest::Error),
    #[error("Datei: {0}")]     Io(#[from] std::io::Error),
    #[error("Host nicht erlaubt")] HostNotAllowed,
    #[error("Prüfsumme stimmt nicht")] HashMismatch,
    #[error("Abgebrochen")]    Cancelled,
    #[error("Oberfläche nicht mehr erreichbar")] ChannelClosed,
}
impl Serialize for DownloadError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> { s.serialize_str(&self.to_string()) }
}

const ALLOWED_HOSTS: &[&str] = &["github.com", "objects.githubusercontent.com" /* + Programm-Hersteller laut Katalog */];

pub fn http_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("CypherStudio/", env!("CARGO_PKG_VERSION")))
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))          // Leerlauf, nicht Gesamtdauer
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if a.previous().len() > 5 { return a.error("zu viele Weiterleitungen"); }
            match a.url().host_str() { Some(h) if ALLOWED_HOSTS.contains(&h) => a.follow(), _ => a.stop() }
        }))
        .build()
}

pub async fn download_verified(
    client: &reqwest::Client, url: &str, dest: PathBuf, expected_sha256: &str,
    cancel: &CancellationToken, on_event: &Channel<DownloadEvent>,
) -> Result<(), DownloadError> {
    let host_ok = reqwest::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| ALLOWED_HOSTS.contains(&h))).unwrap_or(false);
    if !host_ok { return Err(DownloadError::HostNotAllowed); }

    let resp = client.get(url).send().await?.error_for_status()?;
    on_event.send(DownloadEvent::Started { total: resp.content_length() }).map_err(|_| DownloadError::ChannelClosed)?;

    let part = dest.with_extension("part");
    let mut file = fs::File::create(&part).await?;
    let mut hasher = Sha256::new();
    let (mut received, mut last) = (0u64, Instant::now());
    let mut stream = resp.bytes_stream();

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                drop(file); let _ = fs::remove_file(&part).await;   // Windows: erst schließen, dann löschen
                return Err(DownloadError::Cancelled);
            }
            next = stream.next() => match next {
                None => break,
                Some(chunk) => {
                    let chunk = chunk?;
                    hasher.update(&chunk);
                    file.write_all(&chunk).await?;
                    received += chunk.len() as u64;
                    if last.elapsed() >= Duration::from_millis(100) {      // Ereignisse drosseln
                        on_event.send(DownloadEvent::Progress { received }).map_err(|_| DownloadError::ChannelClosed)?;
                        last = Instant::now();
                    }
                }
            }
        }
    }
    file.flush().await?; file.sync_all().await?; drop(file);

    on_event.send(DownloadEvent::Verifying).ok();
    let actual = hex::encode(hasher.finalize().as_slice());
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        let _ = fs::remove_file(&part).await;
        return Err(DownloadError::HashMismatch);
    }
    fs::rename(&part, &dest).await?;                                       // atomar im selben Verzeichnis
    on_event.send(DownloadEvent::Finished { sha256: actual }).ok();
    Ok(())
}
```

Sicherheitsregeln dazu (A): nur `https`; Host-Allowlist auch für Weiterleitungen; Prüfsumme **vor** dem Verwenden (SHA-256 aus signiertem Katalog oder vom Hersteller); Datei erst nach erfolgreicher Prüfung unter ihrem Endnamen ablegen; Zielpfad nie aus Webview-Strings bilden, sondern aus Handles; Größenlimit (`Content-Length` und gezählte Bytes); Abbruch und Wiederaufnahme (`Range`) bewusst entscheiden; Zeitlimits setzen.

Archive entpacken (A): immer in ein frisches Temp-Verzeichnis, jeden Eintrag prüfen (keine absoluten Pfade, kein `..`, keine Laufwerksbuchstaben/UNC, keine Windows-reservierten Namen, Symlinks/Hardlinks außerhalb des Ziels ablehnen, Eintrags- und Gesamtgrößenlimit gegen Zip-Bomben), erst danach atomar umbenennen. Der Vertrag enthält dafür bereits `UnsafeEntryReason`.

### 8.5 Empfohlene Crates (Version, Lizenz, Hinweis)

Daten: crates.io-API 16.10.2026 [S22]; Lizenz = SPDX-Feld der jeweils neuesten stabilen Version (B).

| Zweck | Crate | Version | Lizenz | Hinweis |
|---|---|---|---|---|
| HTTP | `reqwest` | 0.13.5 | MIT OR Apache-2.0 | Feature `stream` für `bytes_stream`; TLS-Wahl siehe 8.4 |
| Hash | `sha2` | 0.11.1 | MIT OR Apache-2.0 | RustCrypto, reine Rust-Implementierung; zusammen mit `hex` 0.4.3 |
| ZIP | `zip` | 9.0.4 | MIT | Standard-Features ziehen viele Codecs (aes, bzip2, deflate64, lzma, ppmd, zstd, xz …); `default-features = false, features = ["deflate"]` genügt für normale ZIPs (der Tauri-Bundler macht es so mit zip 8) |
| 7z | `sevenz-rust2` | 0.24.0 | Apache-2.0 | gepflegter Fork (aktiv, Oktober 2026), reines Rust, braucht Rust ≥ 1.93. `sevenz-rust` 0.6.1 (Apache-2.0) wurde zuletzt 2024-07 aktualisiert → meiden |
| XZ/LZMA | `liblzma` | 0.4.8 | MIT OR Apache-2.0 | gepflegter Fork von `xz2` (0.1.7, zuletzt 2022); bindet die C-Bibliothek liblzma (C-Compiler nötig; mit clang für Windows-Cross-Builds okay). Reines Rust: `lzma-rs` 0.3.0 (MIT, „LZMA, LZMA2 and XZ“, zuletzt 2023) |
| TAR | `tar` | 0.4.46 | MIT OR Apache-2.0 | Standard-Feature `xattr`; Kompression separat (`flate2` 1.1.10, `liblzma`/`zstd`) |
| PGP prüfen | `pgp` (rPGP) | 0.21.0 | MIT OR Apache-2.0 | reines Rust, RFC 9580 + v4/v3; README: „low-level building blocks“, schützt nicht vor unsachgemäßer Anwendung (B) [S47]. MSRV 1.88 |
| PGP (nicht empfohlen) | `sequoia-openpgp` | 2.4.2 | **LGPL-2.0-or-later** | LGPL: statisches Linken im Rust-Binary löst Pflichten aus (Lizenztext, Bezug des LGPL-Teils/Relink-Möglichkeit) und braucht ein Krypto-Backend; ohne Not meiden (A, kein Rechtsrat) |
| Signatur eigener Dateien | `minisign-verify` | 0.3.0 | MIT | null Abhängigkeiten, Streaming-Prüfung großer Dateien (B) [S47]; **dieselbe Bibliothek wie im Tauri-Updater**; 0.3 weist nicht-kanonische Ed25519-S-Werte zurück (B) [S9]. Format = Ausgabe von `tauri signer sign`/`minisign`; pro Zweck (Katalog / Artefakt / App-Update) **eigene Schlüssel**, wie im Vertrag (`SignatureSubject`) angelegt |
| Bilder | `image` | 0.25.10 | MIT OR Apache-2.0 | `default-features = false` und nur benötigte Formate wählen (Standard zieht `rayon` + alle Default-Formate) |
| PNG | `png` | 0.18.1 | MIT OR Apache-2.0 | reines Rust; reicht für Vorschaubilder, wenn `image` zu groß ist |
| Pfade | `dirs` 7.0.0 / `directories` 6.0.0 | – | MIT OR Apache-2.0 | beides okay; im Tauri-Teil besser `app.path()` (BaseDirectory) benutzen, `dirs` steckt ohnehin im Updater-Plugin |
| Programme finden | `which` | 8.0.6 | MIT | |
| Systeminfo | `sysinfo` | 0.39.6 | MIT | braucht Rust ≥ 1.95; Features einschränken (`default-features = false, features = ["system","disk"]`) |
| Dateiüberwachung | `notify` | 8.2.0 | **CC0-1.0** | gemeinfreie Widmung, mit MIT vereinbar; Ereignisse sind plattformabhängig → entprellen (U) |
| Fehler | `thiserror` | 2.0.21 | MIT OR Apache-2.0 | |
| Serialisierung | `serde` / `serde_json` | 1.0.229 / 1.0.154 | MIT OR Apache-2.0 | |
| Async | `tokio` | 1.53.3 | MIT | Tauri bringt die Laufzeit mit (`tauri::async_runtime`); eigene Features: `fs`, `io-util`, `sync`, `time`, `macros`. `tokio-util` 0.7.20 (MIT) für `CancellationToken` |
| Sonstiges | `futures-util` 0.3.34, `infer` 0.22.0 (MIT, nutzt auch der Updater), `tempfile` 3.27.0, `semver` 1.0.28, `url` 2.5.8 | | MIT OR Apache-2.0 (infer: MIT) | |
| Lizenz-/Sicherheitsprüfung | `cargo-deny` 0.20.2, `cargo-about` 0.9.2, `cargo-audit` 0.22.2, `cargo-nextest` 0.9.148 | | MIT OR Apache-2.0 (audit: Apache-2.0 OR MIT) | `cargo deny check licenses advisories` in CI; `cargo about` erzeugt die „Drittanbieter“-Seite |

Lizenzbilanz (A): Fast alles MIT/Apache; Sonderfälle sind `notify` (CC0), `tao` (nur Apache-2.0, mit MIT kombinierbar), `sequoia-openpgp` (LGPL, meiden) und das Dev-Werkzeug `@axe-core/playwright` (MPL-2.0, nicht ausgeliefert).

### 8.6 Weiteres zur Härtung

- Isolation-Pattern (`app.security.pattern`) prüft IPC-Nachrichten in einem Sandbox-Frame; sinnvoll bei vielen Frontend-Abhängigkeiten (Konzeptseite „Isolation“ der Doku, nicht im Detail geprüft) (U).
- `deep-link`: statische Schemata nur über die Konfig; Laufzeit-Schemata müssen in der Single-Instance-Callback-Funktion selbst gegen `argv` geprüft werden. Unter Linux (AppImage) und Windows kann `register_all()` die Schemata zur Laufzeit anmelden; unter macOS nur im gebündelten Build (B) [S44].
- `single-instance`: unter Snap/Flatpak braucht es zusätzliche D-Bus-Freigaben (B) [S44].

---

## 9. Testen

Quellen: [S38] (Tests-Doku: Mock-Runtime, Mocking, WebDriver, CI), [S22][S23] (Versionen).

Schichten (A): (1) Geschäftslogik in einem Crate ohne Tauri-Abhängigkeit → schnelle `cargo test`, auch ohne WebKit-Bibliotheken; (2) Tauri-Commands mit Mock-Runtime; (3) Frontend-Einheitstests mit Vitest + `mockIPC`; (4) UI-Tests mit Playwright gegen den Vite-Server mit gemocktem IPC; (5) echte End-to-End-Tests mit WebDriver in der gebauten App.

### 9.1 Rust

- Reine Funktionen (Archivprüfung, Pfad-/Handle-Logik, Hash, Planung) mit `cargo test`; Temp-Verzeichnisse mit `tempfile`; Negativtests für Zip-Slip, Zip-Bomben, kaputte Prüfsumme.
- Tauri-Commands über die Mock-Runtime: Modul `tauri::test` (Feature `test`, als „unstable“ gekennzeichnet): `mock_builder`, `mock_context`, `mock_app`, `noop_assets`, `MockRuntime`, `get_ipc_response`, `assert_ipc_response`, `INVOKE_KEY` (B) [S38]. Unter der Mock-Runtime laufen keine nativen WebView-Bibliotheken (B) [S38].
- **In der WSL geprüft** (Wegwerf-Crates mit `tauri 2.12.4`, Feature `test`, Rust 1.99.1, danach gelöscht): Der Test unten läuft grün und braucht kein Display – sowohl mit `tauri::generate_context!()` als auch mit `mock_context(noop_assets())`. Stolpersteine, die die Doku-Seite nicht nennt:
  1. **Die Anfrage-URL muss zur Plattform passen:** `tauri://localhost` unter Linux/macOS, `http://tauri.localhost` unter Windows (so auch der Kommentar im Quelltext des Moduls [S38]). Mit `http://tauri.localhost` unter Linux wird der Command abgewiesen: `"ping not allowed. Plugin not found"` (mit beiden Kontext-Varianten reproduziert, mit `tauri://localhost` beide grün).
  2. `generate_context!()` braucht `build.rs` mit `tauri_build::build()`, eine `tauri.conf.json` und ein **RGBA-PNG** `icons/icon.png`; ein PNG ohne Alphakanal bricht die Makro-Expansion ab („icon … is not RGBA“). `mock_context(noop_assets())` (so baut `mock_app()`) kommt ohne das aus, lädt dafür aber keine Capabilities – wer die Zugriffsregeln mitprüfen will, nimmt den echten Kontext.

  ```rust
  // src-tauri/src/lib.rs  (Testmodul)
  #[cfg(test)]
  mod tests {
      use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};

      #[tauri::command]
      fn ping() -> &'static str { "pong" }

      fn local_origin() -> &'static str {
          if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" }
      }

      #[test]
      fn ping_returns_pong() {
          let app = mock_builder()
              .invoke_handler(tauri::generate_handler![ping])
              .build(tauri::generate_context!())          // alternativ ohne build.rs: mock_context(noop_assets())
              .expect("app");
          let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
          let res = get_ipc_response(
              &webview,
              tauri::webview::InvokeRequest {
                  cmd: "ping".into(),
                  callback: tauri::ipc::CallbackFn(0),
                  error: tauri::ipc::CallbackFn(1),
                  url: local_origin().parse().unwrap(),
                  body: tauri::ipc::InvokeBody::default(),
                  headers: Default::default(),
                  invoke_key: INVOKE_KEY.to_string(),
              },
          )
          .map(|b| b.deserialize::<String>().unwrap());
          assert_eq!(res.unwrap(), "pong");
      }
  }
  ```

  Die geprüfte Fassung stand in `src/main.rs` mit `#[tauri::command]` außerhalb des Testmoduls; im echten Projekt gehört der Command in den normalen Code und der Test importiert ihn (`use super::ping;`). Cargo-Abschnitt: `[dependencies] tauri = { version = "2.12", features = [] }` plus `[dev-dependencies] tauri = { version = "2.12", features = ["test"] }`.
- Optional `cargo-nextest` 0.9.148 für schnellere Läufe.

### 9.2 Frontend: Vitest + `@tauri-apps/api/mocks`

(B) [S38] `mockIPC` fängt `invoke`-Aufrufe ab, `mockWindows` täuscht Fenster-Labels vor, `clearMocks()` nach jedem Test; Ereignisse nur mit `mockIPC(…, { shouldMockEvents: true })` (seit API 2.7.0; `emitTo` wird nicht unterstützt). jsdom hat kein WebCrypto → Polyfill laut Doku:

```ts
// src/lib/install.test.ts
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { invoke } from '@tauri-apps/api/core';
import { randomFillSync } from 'node:crypto';

beforeAll(() => {
  Object.defineProperty(window, 'crypto', {   // jsdom: kein WebCrypto (Hinweis aus der Doku)
    value: { getRandomValues: (b: Uint8Array) => randomFillSync(b) },
  });
});
afterEach(() => clearMocks());

test('Programmliste kommt aus dem Backend', async () => {
  mockIPC((cmd) => (cmd === 'programs_list' ? [{ id: 'krita', name: 'Krita' }] : undefined));
  const spy = vi.spyOn(window.__TAURI_INTERNALS__, 'invoke');
  await expect(invoke('programs_list')).resolves.toEqual([{ id: 'krita', name: 'Krita' }]);
  expect(spy).toHaveBeenCalledOnce();
});
```

Channels im Mock (A, gegen die installierte API-Version prüfen): `mockIPC` reicht die Argumente roh durch, `args.onEvent` ist dann die `Channel`-Instanz; der Test ruft `args.onEvent.onmessage({ event: 'progress', data: { received: 10 } })` auf, um Fortschritt zu simulieren.

Konfiguration: Vitest 5.0.5 mit `environment: 'jsdom'` (oder `happy-dom`), `@testing-library/react` 16.3.3 für Komponenten.

### 9.3 UI-Tests: Playwright gegen den Vite-Dev-Server mit gemocktem IPC

Idee: Die Oberfläche läuft im normalen Chromium gegen `http://localhost:1420`; ein Schalter installiert die IPC-Mocks (Playwright-Test steuert Antworten pro Test). Tauri selbst bietet dafür auch den „Browser Mode“ des WebdriverIO-Dienstes an (Frontend in Chrome gegen Vite, `invoke()` abgefangen) (B) [S38].

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:1420', viewport: { width: 1280, height: 800 }, trace: 'on-first-retry' },
  webServer: {
    command: 'npm run dev -- --port 1420 --strictPort',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    env: { VITE_MOCK_IPC: '1' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

```ts
// src/main.tsx  (Mock-Zweig wird im Produktions-Build entfernt: Vite ersetzt import.meta.env statisch)
if (import.meta.env.VITE_MOCK_IPC === '1') {
  const { installIpcMocks } = await import('./test/ipc-mocks');
  installIpcMocks();                         // ruft mockIPC(...) mit Fixtures
}
```

```ts
// e2e/start.spec.ts
import { test, expect } from '@playwright/test';
test('Startseite zeigt installierte Programme', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__FIXTURES__ = { programs_list: [{ id: 'blender', name: 'Blender' }] }; });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Blender' })).toBeVisible();
  await expect(page).toHaveScreenshot('start.png');         // Baselines nur auf einer Plattform (Linux-CI) pflegen
});
```

Grenzen (A): Chromium ≈ WebView2 (Windows); die echten Engines unter macOS (WKWebView) und Linux (WebKitGTK) werden damit **nicht** getestet. Für Barrierefreiheitsprüfungen `@axe-core/playwright` (Dev-Abhängigkeit, MPL-2.0).

### 9.4 WebDriver-E2E (`tauri-driver`, WebdriverIO)

(B) [S38]:

- Empfohlen: **WebdriverIO mit `@wdio/tauri-service`** (1.5.0, MIT). Läuft auf **Windows, Linux und macOS**. Standardmäßig startet der Dienst einen **eingebetteten WebDriver-Server in der App** (Rust-Plugin `tauri-plugin-wdio-webdriver`), dafür ist kein externer Treiber nötig – so wird auch macOS unterstützt. Alternativen: offizieller `tauri-driver` (nur Windows/Linux) oder CrabNebulas Fork (für macOS kostenpflichtiger API-Key). `tauri-plugin-wdio` ermöglicht `browser.tauri.execute()`, IPC-Mocking und Log-Erfassung.
- Direkt mit `tauri-driver` (2.1.0, `cargo install tauri-driver --locked`): **nur Windows und Linux**, weil macOS kein WKWebView-Treiberwerkzeug bietet. Linux: `WebKitWebDriver` (Paket `webkit2gtk-driver`); Windows: zur installierten Edge-Version passender `msedgedriver` (sonst hängen Tests; Hilfswerkzeug `msedgedriver-tool`).
- CI auf Linux: „`xvfb-run`“ für ein virtuelles Display; Windows-Runner können direkt laufen (Beispiel-Workflow in [S38]).

Minimale Konfiguration (aus der Doku):

```ts
// wdio.conf.ts
export const config: WebdriverIO.Config = {
  services: [['tauri', { appBinaryPath: './src-tauri/target/release/cypher-studio', driverProvider: 'embedded' }]],
};
```

Einordnung (A): Das Rust-Plugin für den eingebetteten WebDriver gehört nur in Test-Builds (`#[cfg(debug_assertions)]` oder eigenes Cargo-Feature), nicht in ausgelieferte Releases. Die E2E-Tests sind der einzige Weg, WKWebView/WebKitGTK/WebView2 wirklich zu prüfen; sie laufen am besten als eigener CI-Job auf den drei Runnern, nicht lokal auf dem Windows-Rechner.

### 9.5 Lokale Prüfung der Installer ohne Eingriff in den Windows-Rechner

- Linux: WSL (Abschnitt 4.4) inkl. Kopflos-Screenshot.
- Windows: NSIS-Setup nicht auf dem Entwicklerrechner installieren (keine Zustimmung). Stattdessen die ungebündelte `cypher-studio.exe` (Build-Script erzeugt `cypher-studio-portable.exe`) direkt starten (WebView2 ist unter Windows 11 vorhanden), oder den Installer in einer VM/Windows Sandbox testen – die Sandbox ist ein optionales Windows-Feature und wäre eine Systemänderung (nur mit Zustimmung).
- macOS: nur mit einem echten Mac (oder dem `macos-latest`-Runner für Builds und WebDriver-Tests) prüfbar; die Gatekeeper-Anleitung bitte einmal auf einem Mac durchspielen.

---

## Offene Punkte und nicht Verifiziertes

- **Aktualität der Doku-Seite zum Updater:** Sie nennt Deb/Rpm-Updates nicht; die Aussage stützt sich auf Quelltext und Changelog des Plugins (2.10.0) [S8][S9]. Vor dem Einsatz mit einem echten `.deb` testen (Passwortdialog, `pkexec` vorhanden?).
- **tauri-action und Deb/Rpm-Schlüssel in `latest.json`** (`-deb`, `-rpm`): nur vermutet, im Quelltext der Signaturverarbeitung nicht geprüft.
- **macOS Tahoe 26.x:** keine Apple-Primärquelle für Abweichungen gegenüber Sequoia; Aussagen zu strengerer Durchsetzung stammen aus Blogs. Auch ob „beschädigt“-Meldungen mit Ad-hoc-Signatur vollständig verschwinden, ist nur durch die Tauri-Doku gedeckt, nicht selbst nachgestellt.
- **Terminal-Einzeiler ohne Gatekeeper/SmartScreen:** Sekundärquellen und eigene Ableitung; nicht getestet.
- **Skripte in 4.4 und das `gh api`-Verfahren in `verify-release`:** übliche Muster, hier nicht ausgeführt.
- **TypeScript-Beispiele** (Updater-Zustände, Vitest, Playwright, WebdriverIO) und die **Worker-Idee** für den Update-Endpoint: nicht ausgeführt. Geprüft sind nur die Rust-Download-Skizze (`cargo check`) und der Rust-Test (`cargo test`), beide in der WSL.
- **`core:default`, `style-src-attr`, `freezePrototype`, `minimumWebview2Version`-Wert, NSIS-`compression`-Schreibweise:** vor Verwendung gegen Schema und laufende App prüfen.
- **Azure Artifact Signing:** Zulassung einer deutschen GbR/eines Einzelunternehmers bleibt offen. Die Behauptung einer „Pause“ für Einzelentwickler seit März 2026 stammt von einer Händlerseite und wurde in der Microsoft-Doku nicht gefunden.
- **SignPath:** Die Seiten `apply` und die Produktseite nennen weder unterstützte Build-Systeme noch Dateitypen im abrufbaren Text; die Bedingungen oben stammen von `signpath.org/terms`. Ob NSIS-Installer und Tauri-Ablauf reibungslos passen, ist ungeprüft.
- **Certum Open Source:** Preise aus dem Shop, Authenticode-Tauglichkeit und Namensformat nicht bestätigt.
- **xwin/Windows-SDK-Lizenz:** Ich habe das Dokument gelesen, das der Link nennt (VS-2019-Build-Tools-Lizenz); eine rechtliche Bewertung ist das nicht.
- **WebView2 unter Windows 10:** Doku-Aussagen weichen leicht ab („ab April 2018“ vs. „vorinstalliert auf Windows 11“). Der Bootstrapper deckt beides ab.

---

## Quellen (alle abgerufen am 16.10.2026)

Tauri-Dokumentation und -Quelltext

- [S1] Updater-Plugin: https://v2.tauri.app/plugin/updater/ (Quelltext der Seite: https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/plugin/updater.mdx)
- [S2] GitHub-Pipeline: https://v2.tauri.app/distribute/pipelines/github/
- [S3] tauri-action README: https://github.com/tauri-apps/tauri-action (https://github.com/tauri-apps/tauri-action/blob/dev/README.md)
- [S4] tauri-action Changelog: https://github.com/tauri-apps/tauri-action/blob/dev/CHANGELOG.md
- [S5] tauri-action Quelltext: https://github.com/tauri-apps/tauri-action/blob/dev/src/upload-version-json.ts und https://github.com/tauri-apps/tauri-action/blob/dev/src/index.ts
- [S6] tauri-action Beispiel Universal-macOS: https://github.com/tauri-apps/tauri-action/blob/dev/examples/publish-to-auto-release-universal-macos-app-with-signing-certificate.yml
- [S7] Konfigurationsdateien (plattformspezifisch): https://v2.tauri.app/develop/configuration-files/
- [S8] Updater-Plugin-Quelltext: https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs
- [S9] Updater-Plugin-Changelog: https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/CHANGELOG.md
- [S10] Updater-Plugin-Konfiguration: https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/config.rs
- [S11] Windows-Installer (NSIS, Cross-Compile, WebView2): https://v2.tauri.app/distribute/windows-installer/
- [S12] Windows-Signierung: https://v2.tauri.app/distribute/sign/windows/
- [S13] macOS-Signierung (inkl. Ad-hoc): https://v2.tauri.app/distribute/sign/macos/
- [S14] Linux-Bundles: https://v2.tauri.app/distribute/appimage/ , https://v2.tauri.app/distribute/debian/ , https://v2.tauri.app/distribute/rpm/
- [S15] Voraussetzungen: https://v2.tauri.app/start/prerequisites/
- [S21] Tauri-Quelltext/Schema: https://schema.tauri.app/config/2 ; Bundler https://github.com/tauri-apps/tauri/tree/dev/crates/tauri-bundler ; CLI `signer generate/sign` https://github.com/tauri-apps/tauri/tree/dev/crates/tauri-cli/src/signer ; `bundle` https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/bundle.rs ; Plattform-Marker https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-utils/src/platform.rs
- [S36] Sicherheit: https://v2.tauri.app/security/capabilities/ , https://v2.tauri.app/security/csp/ , https://v2.tauri.app/security/asset-protocol/ , https://v2.tauri.app/security/scope/ , https://v2.tauri.app/security/permissions/
- [S37] Channels: https://v2.tauri.app/develop/calling-frontend/#channels
- [S38] Tests: https://v2.tauri.app/develop/tests/ , https://v2.tauri.app/develop/tests/mocking/ , https://v2.tauri.app/develop/tests/webdriver/ , https://v2.tauri.app/develop/tests/webdriver/ci/ , https://v2.tauri.app/develop/tests/webdriver/manual-setup/ , https://docs.rs/tauri/latest/tauri/test/index.html , https://webdriver.io/docs/desktop-testing/tauri
- [S39] Linux-Grafikprobleme und WSLg: https://v2.tauri.app/develop/debug/linux-graphics/ , https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps
- [S44] Plugin-Seiten (Single-Instance, Deep-Link, Opener, Shell, HTTP, Window-State, Process): https://v2.tauri.app/plugin/single-instance/ , https://v2.tauri.app/plugin/deep-linking/ , https://v2.tauri.app/plugin/opener/ , https://v2.tauri.app/plugin/shell/ , https://v2.tauri.app/plugin/http-client/ , https://v2.tauri.app/plugin/window-state/ , https://v2.tauri.app/plugin/process/
- [S45] Standard-Permission-Sets der Plugins: https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/ (je Plugin `<plugin>/permissions/default.toml`: process, updater, dialog, fs, opener, os, log, window-state, deep-link, http, shell)
- [S49] Webview-Versionen: https://v2.tauri.app/reference/webview-versions/

Versionen, Registries, Runner, Pakete

- [S22] crates.io-API (Beispiel): https://crates.io/api/v1/crates/tauri ; alle weiteren Crates analog `…/crates/<name>` und `…/crates/<name>/<version>/dependencies`
- [S23] npm-Registry (Beispiel): https://registry.npmjs.org/@tauri-apps/api/latest ; analog für alle Pakete
- [S24] Rust-Stable-Kanal: https://static.rust-lang.org/dist/channel-rust-stable.toml
- [S25] GitHub-Runner-Images: https://github.com/actions/runner-images
- [S42] GitHub-Releases-API (Versionsstände von tauri-action, Tauri, Plugins, cargo-xwin, Actions): https://api.github.com/repos/tauri-apps/tauri-action/releases/latest und analog für `tauri-apps/tauri`, `tauri-apps/plugins-workspace`, `rust-cross/cargo-xwin`, `actions/checkout`, `actions/setup-node`
- [S48] Tauri-Release-Übersicht (3.0.0-alpha.5): https://github.com/tauri-apps/tauri/releases
- [S40] AppImage und FUSE: https://docs.appimage.org/user-guide/troubleshooting/fuse.html
- [S41] GitHub REST Rate Limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- [S46] Ubuntu-24.04-Paketsuche (Beispiel): https://packages.ubuntu.com/noble/libwebkit2gtk-4.1-dev ; analog für `libfuse2t64`, `libayatana-appindicator3-dev`, `libxdo-dev`, `xvfb`, `webkit2gtk-driver`, `nsis`, `lld`, `llvm`, `imagemagick`, `xdotool`, `patchelf`
- [S47] rPGP und minisign-verify: https://github.com/rpgp/rpgp ; https://github.com/jedisct1/rust-minisign-verify

Cross-Compile und Lizenz

- [S16] cargo-xwin: https://github.com/rust-cross/cargo-xwin
- [S17] xwin: https://github.com/Jake-Shadle/xwin
- [S18] Microsoft-Lizenztext hinter dem xwin-Link: https://go.microsoft.com/fwlink/?LinkId=2086102 → https://visualstudio.microsoft.com/license-terms/mlt031519/ → Dokument https://visualstudio.microsoft.com/wp-content/uploads/2019/03/VS_2019_DiagnosticBuildTools_ENU.1033.docx
- [S19] Diskussion Build-Tools-Lizenz: https://internals.rust-lang.org/t/visual-studio-build-tools-licensing/17097
- [S20] webview2-rs (Cross-Compile, gnu): https://github.com/wravery/webview2-rs#cross-compilation ; https://github.com/wravery/webview2-rs/blob/main/crates/bindings/src/lib.rs ; wry-Hinweis https://v2.tauri.app/release/wry/v0.13.2/ und https://github.com/tauri-apps/wry

Windows und macOS

- [S26] Microsoft Defender SmartScreen: https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/
- [S27] Smart App Control: https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview
- [S28] Wortlaut des SmartScreen-Dialogs (sekundär): https://www.windows-faq.de/2018/02/03/der-computer-wurde-durch-windows-geschuetzt/ , https://www.pctipp.ch/themen/praxis/windows-programm-trotzdem-ausfuehren , https://kb.wisc.edu/hd-cps/144696 (nur über Suchtreffer; beim Direktabruf nicht erreichbar)
- [S29] Apple Support: https://support.apple.com/en-us/102445 und https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac
- [S30] Sequoia entfernt den Control-Klick-Override (sekundär, mit Apple-Zitat): https://thehackernews.com/2024/08/apples-new-macos-sequoia-tightens.html , https://www.cultofmac.com/864843/macos-sequoia-removes-handy-shortcut-bypass-gatekeeper-security/ , https://troz.net/post/2024/sequoia_app_permissions/
- [S31] Quarantäne-Attribut und `curl` (sekundär): https://unit42.paloaltonetworks.com/gatekeeper-bypass-macos , https://redcanary.com/blog/gatekeeper
- [S43] macOS 27 nur Apple Silicon, Tahoe letzte Intel-Version (sekundär): https://www.mactrast.com/2026/06/psa-remember-macos-27-will-be-apple-silicon-only/amp/ , https://512pixels.net/2026/06/wwdc26-macos27-drops-intel-support/
- [S50] Berichte „beschädigt“ trotz entferntem Quarantäne-Attribut (sekundär): https://amm123.mataroa.blog/blog/moderndeck-on-macos-fixing-the-damaged-app-error-the-right-way/ , https://github.com/postmanlabs/postman-app-support/issues/14117

Kosten und Signierdienste

- [S32] Apple Developer Program: https://developer.apple.com/programs/ , https://developer.apple.com/programs/enroll/
- [S33] Azure Artifact Signing: Überblick https://learn.microsoft.com/en-us/azure/artifact-signing/overview ; Quickstart/Voraussetzungen https://learn.microsoft.com/azure/artifact-signing/quickstart (Quelltext: https://github.com/MicrosoftDocs/azure-docs/blob/main/articles/artifact-signing/quickstart.md) ; FAQ https://learn.microsoft.com/en-us/azure/artifact-signing/faq ; Preise https://azure.microsoft.com/en-us/pricing/details/artifact-signing/
- [S34] SignPath Foundation: https://signpath.org/ , https://signpath.org/terms , https://signpath.org/apply ; GitHub Action https://github.com/SignPath/github-action-submit-signing-request
- [S35] Zertifikatspreise: Certum https://shop.certum.eu/code-signing.html ; OV-Preise/Hardwarepflicht (sekundär) https://ssl.com/guide/esigner-pricing-for-code-signing/ , https://sslinsights.com/sectigo-code-signing-certificate-guide/ , https://www.ssldragon.com/ssl-certificates/code-signing/

---

## Empfehlungen für Cypher Studio

1. **Versionen festnageln.** Tauri 2.12.x und die Plugin-Versionen aus Abschnitt 1; Tauri 3 (nur Alpha) nicht anfassen. `Cargo.lock` und `package-lock.json` einchecken, Renovate/Dependabot einschalten. CI mit `dtolnay/rust-toolchain@stable` (aktuell 1.99.1; Mindestversion der Tauri-Crates 1.90, `sysinfo` 1.95, `sevenz-rust2` 1.93).
2. **Updater in Rust, nicht im Webview.** `tauri-plugin-updater` 2.14.0, `bundle.createUpdaterArtifacts: true`, `plugins.updater.requireSignedVersion: true` (Anti-Downgrade, bei einem neuen Projekt ohne Altlasten gefahrlos). Die Befehle `fetch_update`/`install_update` mit `Channel` nach dem Doku-Muster (2.5, Variante B) bauen; so braucht das Frontend keine Updater-Rechte, und der Installationsstart kann blockiert werden, solange ein Job oder Setup läuft (`BusyReason` im IPC-Vertrag). Updates nie ohne Zustimmung installieren, Prüfung im Hintergrund mit Timeout.
3. **Schlüssel.** Updater-Schlüsselpaar **mit Passwort** auf einem vertrauenswürdigen Rechner erzeugen (WSL genügt; `tauri signer generate -w …`), Privatschlüssel und Passwort als GitHub-Secrets (`TAURI_SIGNING_PRIVATE_KEY`, `…_PASSWORD`) sowie zwei Offline-Kopien (Passwortmanager + verschlüsselter Datenträger). Öffentlichen Schlüssel in `tauri.conf.json`. Für den Katalog und die Programm-Artefakte (Vertrag: `SignatureSubject`) **eigene** minisign-Schlüssel verwenden, nicht den Update-Schlüssel. Nichts davon wurde in diesem Lauf erzeugt.
4. **Release-Kette aus 2.6 übernehmen.** Tag `v*` → Entwurfs-Release → `verify-release` → manuelles Veröffentlichen. Linux zwingend auf `ubuntu-22.04` (glibc-Basis), Windows nur NSIS, macOS arm64 als Hauptziel, x64 optional (macOS 27 ist Apple-Silicon-only), **kein** Universal-Binary. Erst mit einem Probe-Tag (`v0.1.0-rc.1`, als Prerelease) üben, danach Update-Rundlauf 0.1.0 → 0.1.1 je Plattform mit **gebündelten** Artefakten testen (nicht mit dem Roh-Binary).
5. **Update-Endpoint.** Start einfach: `https://github.com/<OWNER>/<REPO>/releases/latest/download/latest.json`. Mittelfristig einen eigenen Cloudflare-Worker als Endpoint einsetzen (Edge-Cache; `204` bei „kein Update“; Kanäle stable/beta über `{{target}}`/`{{arch}}`/`{{bundle_type}}`; Umschreiben der `api.github.com/…/releases/assets/<id>`-URLs auf eine eigene Download-Route, weil unauthentifizierte API-Zugriffe auf 60/Stunde/IP begrenzt sind [S41]; GitHub-Token als Worker-Secret). Die Signatur bleibt gültig, weil sie nur die Dateiinhalte deckt.
6. **Stabile Dateinamen für die Downloadseite.** Mit `releaseAssetNamePattern` (Variablen `[version]`, `[platform]`, `[arch]`, `[setup]`, `[ext]` …) einheitliche Asset-Namen erzwingen oder die Release-Liste der GitHub-API (gecacht im Worker) auswerten; beides vor Einsatz mit den `.sig`-/`latest.json`-Verweisen testen (U) [S3]. Leerzeichen im `productName` („Cypher Studio“) werden bei GitHub-Assets zu Punkten; deshalb besser `mainBinaryName: "cypher-studio"` setzen (Feld existiert im Schema [S21]) und nach Dateimustern suchen, nicht nach festen Namen. SHA-256-Summen der Installer auf der Downloadseite anzeigen.
7. **Windows-Releases auf `windows-latest` (MSVC) bauen.** `cargo-xwin` + NSIS in der WSL nur für lokale Entwicklung (wie in `scripts/wsl-build.sh`); GNU/MinGW nicht verwenden (Abschnitt 3). Beim Einsatz von xwin die Microsoft-Lizenz kennen (3.2); das ist die einzige rechtlich unklare Stelle im Aufbau.
8. **Windows ohne Zertifikat (Übergang).** NSIS `currentUser` (kein Admin), `downloadBootstrapper`, `minimumWebview2Version: 110.0.1531.0` wegen der Custom-Protokolle. Auf der Downloadseite die SmartScreen-Schritte („Weitere Informationen“ → „Trotzdem ausführen“) mit Screenshots erklären und Smart App Control erwähnen (dort gibt es für unsignierte Dateien keinen Weg vorbei, außer die Funktion abzuschalten). Ehrlich formulieren: „Ein Klick“ heißt Download + Installer, nicht „ohne Warnung“.
9. **Windows-Signierung planen (vor 1.0 entscheiden).** (a) **SignPath Foundation** zuerst prüfen: kostenlos, MIT-Lizenz erfüllt die OSI-Bedingung; verlangt MFA für alle, „Code signing policy“-Seite mit Pflichtzeile, Datenschutzhinweis, reproduzierbaren CI-Build und manuelle Freigabe je Release; Pipeline-Umbau nötig (7.2, Stolpersteine). (b) Falls zu aufwendig: **Certum Open Source (Cloud) 49 €/Jahr**, vorher klären, ob das Zertifikat Authenticode-fähig ist und sich in CI nutzen lässt. (c) **Azure Artifact Signing** (9,99 USD/Monat) erst, wenn es eine passende Organisation gibt (GmbH/UG mit Geschäftskennung und Domain); als Einzelperson in der EU nicht zulassungsfähig. Keiner der Wege bringt sofortige SmartScreen-Reputation; Smart App Control wird damit aber erfüllt.
10. **macOS.** `signingIdentity: "-"` (ad-hoc) in `tauri.macos.conf.json`; DMG zur Erstinstallation, `.app.tar.gz` fürs Update. Anleitung für die Downloadseite: Öffnungsversuch → Systemeinstellungen → Datenschutz & Sicherheit → „Dennoch öffnen“ → bestätigen/Passwort; Alternative `xattr -dr com.apple.quarantine "/Applications/Cypher Studio.app"`; Hinweis „vorher nach Programme verschieben“ (Translocation, Updater). **Einmal auf einem echten Mac mit macOS 15 und 26 durchspielen.** Apple Developer Program (99 USD/Jahr, Developer ID + Notarisierung) lohnt, sobald macOS-Nutzer relevant sind; es beseitigt alle Gatekeeper-Warnungen.
11. **Downloadseite: Warnungen einplanen.** Je Plattform automatisch den passenden Hinweisblock zeigen. Terminal-Einzeiler (PowerShell/`curl`) umgehen Browser-Markierungen (MotW/Quarantäne), sind aber als Sicherheitsmuster umstritten und für macOS/Windows von mir nicht getestet (6.4, 5.1) – höchstens als zweiter Weg anbieten.
12. **Linux.** AppImage als Hauptformat (aktualisiert sich ohne Root), `.deb`/`.rpm` zusätzlich (Update per `pkexec` mit Passwortdialog). Anleitung: `libfuse2t64` (Ubuntu 24.04) oder `--appimage-extract-and-run`. Deep-Links in AppImage: `register_all()` beim Start. Release-AppImage nie aus der WSL (24.04) bauen.
13. **Capabilities/CSP.** Ein schmales `default.json` (8.1); `AppManifest::commands` für die eigenen Commands; **CSP setzen** (derzeit `csp: null` in `apps/desktop/src-tauri/tauri.conf.json`) nach dem Vorschlag in 8.2 und an der laufenden App testen; Asset-Protokoll aus, eigene Handle-Schemata behalten; keine Plugins `fs`/`http`/`shell` im Webview; `freezePrototype` ausprobieren.
14. **Downloads und Archive** wie in 8.4: Rust-Download mit `Channel`, HTTPS + Host-Allowlist (auch bei Weiterleitungen), SHA-256 vor Verwendung, `.part`-Datei und atomares Umbenennen, Abbruch per `CancellationToken`. Signaturen des Katalogs mit `minisign-verify`, Upstream-PGP-Signaturen mit `pgp` (rPGP). Archivformate: `zip` (reduzierte Features), `tar` + `flate2`/`liblzma`, `sevenz-rust2`; **kein** `sequoia-openpgp` (LGPL). Jeder Archiveintrag wird vor dem Schreiben geprüft (8.4).
15. **Lizenz- und Sicherheitsprüfung automatisieren.** `cargo deny check licenses advisories` und `cargo about` (Drittanbieter-Seite) in CI; `npm audit`/Lizenzprüfung für das Frontend. Bekannte Sonderfälle: `notify` (CC0), `tao` (Apache-2.0), `@axe-core/playwright` (MPL-2.0, nur Dev).
16. **Teststrategie.** Geschäftslogik in ein eigenes Crate ohne Tauri; `cargo test` + `tauri::test` für Commands; Vitest 5 + `mockIPC` für Frontend-Logik; Playwright gegen den Vite-Server mit `VITE_MOCK_IPC=1` für UI-Zustände und Barrierefreiheit (Screenshot-Baselines nur auf einer Plattform pflegen); echte E2E-Tests mit WebdriverIO + `@wdio/tauri-service` (eingebetteter Treiber) als eigener CI-Job auf Windows, macOS und Linux. Das Test-Plugin nur in Test-/Debug-Builds.
17. **WSL-Routine.** `scripts/wsl-build.sh` beibehalten (Spiegelung nach `~/build`, kein Bauen auf `/mnt/c`); ergänzend ein Kopflos-Skript (4.4) mit `dbus-run-session xvfb-run … import -window root`; GUI-Sicht über WSLg; `libfuse2t64` für AppImages; bei leerem Fenster `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
18. **Das vorhandene Projekt anpassen:** `productName` und Fenstertitel stehen noch auf „desktop“ (`tauri.conf.json`), `csp` ist `null`, Updater-/Bundle-Konfiguration fehlt. Als Nächstes die Konfiguration aus 2.2, 5.3 und 8.2 übernehmen und `tauri.macos.conf.json` anlegen.
19. **Vor jeder Aktion mit Nebenwirkung Rückfrage:** Schlüssel erzeugen, GitHub-Secrets setzen, Zertifikate/Konten beantragen (Apple, Azure, SignPath, Certum), Windows Sandbox aktivieren, Installationen auf dem Windows-Rechner. Nichts davon ist hier geschehen; einzige Schreibzugriffe waren diese Datei und Wegwerf-Crates in der WSL (`~/research-scratch`, danach gelöscht; der Cargo-Registry-Cache dort enthält dadurch ein paar zusätzliche Crates).
