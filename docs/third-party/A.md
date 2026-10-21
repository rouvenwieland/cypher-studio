# Drittanbieter-Abhängigkeiten Zone A (Rust-Kern, Tauri-Schicht, CLI)

Jede direkte Abhängigkeit mit Version (aufgelöst in `Cargo.lock`), Lizenz und Zweck. `THIRD_PARTY.md` führt der Hauptchat zusammen;
`cargo deny check` prüft Lizenzen und Advisories (`deny.toml`). Stand: Phase 1 und 2.

## Ausgeliefert: cypher-core (und damit App und CLI)

| Crate | Version | Lizenz | Zweck |
|---|---|---|---|
| `serde`, `serde_json` | 1.0 | MIT OR Apache-2.0 | Serialisierung des Vertrags, Katalog, Zustand |
| `thiserror` | 2.0 | MIT OR Apache-2.0 | Fehlertypen |
| `ts-rs` | 12.0 | MIT | TypeScript-Typen des IPC-Vertrags erzeugen (Build und Test; zur Laufzeit ohne Wirkung) |
| `tokio`, `tokio-util` | 1.53 / 0.7 | MIT | Async-Laufzeit, `CancellationToken` |
| `futures-util` | 0.3 | MIT OR Apache-2.0 | Streams beim Download |
| `reqwest` | 0.13 | MIT OR Apache-2.0 | HTTP-Client (nur `rustls`, kein OpenSSL); Hostliste fest eingebaut |
| `rustls` | 0.23 | Apache-2.0 OR ISC OR MIT | TLS (Anbieter `ring`) |
| `url` | 2.5 | MIT OR Apache-2.0 | URLs parsen und prüfen |
| `sha2`, `hex` | 0.11 / 0.4 | MIT OR Apache-2.0 | SHA-256 aus dem signierten Katalog prüfen |
| `minisign-verify` | 0.3 | MIT | Katalog- und App-Signatur (minisign) prüfen |
| `directories` | 6.0 | MIT OR Apache-2.0 | Standardordner je Betriebssystem |
| `tempfile` | 3.27 | MIT OR Apache-2.0 | atomares Schreiben (Temp-Datei, dann Umbenennen) |
| `fs4` | 1.1 | MIT OR Apache-2.0 | Sperrdatei, freier Speicherplatz |
| `walkdir`, `globset` | 2.5 / 0.4 | Unlicense OR MIT | Ordner durchlaufen, Muster |
| `which` | 8.0 | MIT | Programme im PATH finden (Erkennung) |
| `sysinfo` | 0.38 | MIT | Betriebssystem, Architektur, Speicher |
| `infer` | 0.19 | MIT | Dateityp aus dem Inhalt (Handles) |
| `uuid`, `time`, `arc-swap`, `semver`, `tracing` | 1 / 0.3 / 1 / 1 / 0.1 | MIT OR Apache-2.0 | IDs, Zeitstempel, Katalog-Austausch ohne Sperre, Versionen, Logging |
| `zip` | 9.0 | MIT | ZIP entpacken (nur `deflate`) |
| `tar`, `flate2`, `liblzma` | 0.4 / 1.1 / 0.4 | MIT OR Apache-2.0 | `tar.xz`, `tar.gz` entpacken |
| `sevenz-rust2` | 0.24 | Apache-2.0 | 7z und 7z-SFX entpacken (Inkscape, Kdenlive) |
| `plist` | 1.10 | MIT | `Info.plist` der macOS-Programme lesen |
| `unicode-normalization` | 0.1 | MIT OR Apache-2.0 | Dateinamen für den Zip-Slip-Vergleich normalisieren (NFC) |
| `base64` | 0.22 | MIT OR Apache-2.0 | Schlüsseldateien im Katalog |
| `image` | 0.25 | MIT OR Apache-2.0 | JPEG, TIFF, WebP dekodieren (PNG läuft direkt über `png`) |
| `png` | 0.18 | MIT OR Apache-2.0 | PNG lesen und schreiben (`pHYs`, `iCCP`) |
| `tiff` | 0.11 | MIT | TIFF-Tags lesen (Auflösung, ICC-Profil); dieselbe Version wie in `image` |
| `fast_image_resize` | 5.5 | MIT OR Apache-2.0 | Skalieren (Lanczos3, vormultipliziertes Alpha) |
| `moxcms` | 0.9 | BSD-3-Clause OR Apache-2.0 | Farbprofile (sRGB, Adobe RGB, Display P3 erzeugen und umrechnen) |
| `winreg` (nur Windows) | 0.55 | MIT | Registrierung lesen (Erkennung installierter Programme) |
| `windows-sys` (nur Windows) | 0.61 | MIT OR Apache-2.0 | `AddFontResourceW`, `SendMessageTimeoutW`: Schriften des Benutzerprofils anmelden (einziger `unsafe`-Ort, zwei Aufrufe) |
| `pgp` (rPGP) | 0.21 | MIT OR Apache-2.0 | OpenPGP-Signatur der Krita- und Inkscape-AppImage prüfen (nur Prüfen, ohne `bzip2`) |
| `notify` | 8.2 | CC0-1.0 | Ordnerüberwachung der Bibliothek (entprellt); `inotify` (ISC) und `notify-types` kommen mit |
| `resvg` (mit `usvg`, `tiny-skia`, `fontdb`) | 0.48 / 0.12 / 0.24 | Apache-2.0 OR MIT / BSD-3-Clause / MIT | SVG-Vorschaubilder der Bibliothek, nur gerastert; Markenschriften werden aus den Paketen geladen, keine System-Schriften |

## Ausgeliefert: cypher-cli

| Crate | Version | Lizenz | Zweck |
|---|---|---|---|
| `clap` | 4.6 | MIT OR Apache-2.0 | Kommandozeile |
| `minisign` | 0.9 | MIT | Katalog signieren (`catalog sign`, nur mit Entwicklungsschlüssel) |
| `tracing-subscriber` | 0.3 | MIT | Warnungen des Kerns auf die Fehlerausgabe |

## Ausgeliefert: src-tauri

| Crate | Version | Lizenz | Zweck |
|---|---|---|---|
| `tauri`, `tauri-build` | 2.12 / 2.7 | Apache-2.0 OR MIT | App-Rahmen, Commands, Capabilities |
| `tauri-plugin-dialog` | 2.8 | Apache-2.0 OR MIT | native Dialoge (nur aus Rust benutzt) |
| `tauri-plugin-opener` | 2.7 | Apache-2.0 OR MIT | URL öffnen, im Ordner zeigen |
| `tauri-plugin-updater` | 2.14 | Apache-2.0 OR MIT | App-Update (minisign-signiert) |
| `tauri-plugin-process` | 2.4 | Apache-2.0 OR MIT | Neustart nach Update |
| `tauri-plugin-single-instance` | 2.5 | Apache-2.0 OR MIT | nur eine Instanz |
| `tauri-plugin-window-state` | 2.5 | Apache-2.0 OR MIT | Fenstergröße merken |
| `tracing`, `tracing-subscriber`, `tracing-appender` | 0.1 / 0.3 / 0.2 | MIT | Protokoll in Dateien (`<data>/logs`, täglich, 7 Tage); kein Netz, keine Telemetrie |
| `time` | 0.3 | MIT OR Apache-2.0 | Fälligkeit der Update-Prüfung |

## Nur Entwicklung und Tests

| Crate | Version | Lizenz | Zweck |
|---|---|---|---|
| `pretty_assertions` | 1.4 | MIT OR Apache-2.0 | lesbare Testvergleiche |
| `proptest` | 1.12 | MIT OR Apache-2.0 | Eigenschaftstests (Pfadprüfung) |
| `axum` | 0.8 | MIT | lokaler Test-Server (Range, Weiterleitungen, Abbrüche) |
| `minisign` | 0.9 | MIT | Testschlüssel, Testsignaturen |
| `jsonschema` | 0.58 (ohne Standard-Features) | MIT | Katalog gegen das JSON-Schema prüfen |
| `sevenz-rust2` (mit `compress`) | 0.24 | Apache-2.0 | 7z-Testarchive erzeugen |
| `rand`, `rand_chacha` | 0.8 / 0.3 | MIT OR Apache-2.0 | Testschlüssel für die PGP-Prüfung (dieselbe `rand_core`-Version wie rPGP) |
| `tempfile`, `sha2`, `zip`, `image`, `png` (in `cypher-cli`, `src-tauri`) | wie oben | wie oben | Testdaten der Kommandozeilen- und Tauri-Tests (keine Auslieferung) |

Schriften, Bilder und Profile: keine Fremddateien im Repository. Die ICC-Profile (sRGB, Adobe RGB 1998, Display P3) werden zur Laufzeit
von `moxcms` erzeugt; der Name „Adobe RGB (1998)“ bezeichnet nur den Farbraum, den Shirtigo für den Upload empfiehlt.
