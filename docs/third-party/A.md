# Drittanbieter-Abhängigkeiten Zone A (Rust-Kern, Tauri-Schicht, CLI)

Jede direkte Abhängigkeit mit Version (aufgelöst in `Cargo.lock`), Lizenz und Zweck. `THIRD_PARTY.md` führt der Hauptchat zusammen;
`cargo deny check` prüft Lizenzen und Advisories (`deny.toml`).

## Ausgeliefert (cypher-core, cypher-cli, src-tauri)

| Crate | Lizenz | Zweck |
|---|---|---|
| `tauri`, `tauri-build` 2.12.x | Apache-2.0 OR MIT | App-Rahmen, Commands, Capabilities |
| `tauri-plugin-dialog` | MIT OR Apache-2.0 | native Dialoge (nur aus Rust benutzt) |
| `tauri-plugin-opener` | MIT OR Apache-2.0 | URL öffnen, im Ordner zeigen |
| `tauri-plugin-updater` | MIT OR Apache-2.0 | App-Update (minisign-signiert) |
| `tauri-plugin-process` | MIT OR Apache-2.0 | Neustart nach Update |
| `tauri-plugin-single-instance` | MIT OR Apache-2.0 | nur eine Instanz |
| `tauri-plugin-window-state` | MIT OR Apache-2.0 | Fenstergröße merken |
| `serde`, `serde_json` | MIT OR Apache-2.0 | Serialisierung |
| `thiserror` 2 | MIT OR Apache-2.0 | Fehlertypen |
| `ts-rs` 12 | MIT | TypeScript-Typen des IPC-Vertrags erzeugen (Build/Test, trägt zur Laufzeit nichts bei) |
| `tokio`, `tokio-util` | MIT | Async, `CancellationToken` |

## Nur Entwicklung und Tests

| Crate | Lizenz | Zweck |
|---|---|---|
| `pretty_assertions` | MIT OR Apache-2.0 | lesbare Testvergleiche |
