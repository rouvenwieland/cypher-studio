#!/usr/bin/env bash
# Baut Cypher Studio in der WSL (Ubuntu 24.04): Linux nativ und Windows per Cross-Compile (cargo-xwin, NSIS).
# Aufruf aus Windows (PowerShell):
#   wsl -d Ubuntu -- bash /mnt/c/Users/<du>/Code/cypher-studio/scripts/wsl-build.sh [linux|windows|all|e2e] [bundles]
# `e2e` baut nur einen Windows-Debug-Build mit eingebettetem Frontend und dem Feature `dev-tools` für die E2E-Suite gegen die echte App
# (`npm run e2e:real` in apps/desktop): dist-builds/windows-e2e/cypher-studio.exe samt packs/. Nie ausliefern.
# Der Quellbaum wird nach ~/build/cypher-studio gespiegelt, damit node_modules (Linux) und target/ nicht mit Windows kollidieren.
# Voraussetzungen in der WSL: Rust (rustup) mit Ziel x86_64-pc-windows-msvc, cargo-xwin, Node 24,
# Blender 5.x (BLENDER=... oder ~/apps/blender-5.*-linux-x64/blender) und die Tauri-Pakete (siehe docs/BAUEN.md).
set -euo pipefail
WHAT="${1:-all}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST="$HOME/build/cypher-studio"
export PATH="$HOME/.local/node/bin:$HOME/.cargo/bin:$PATH"
BLENDER="${BLENDER:-$(ls -d "$HOME"/apps/blender-5.*-linux-x64/blender 2>/dev/null | sort -V | tail -1)}"
# Die WSL-Platte (ext4.vhdx) wächst auf Laufwerk C: mit. Unter 10 GB frei dort wird nicht gebaut (MIN_FREE_GB überschreibt).
if [[ -d /mnt/c ]]; then
  FREE_GB=$(df -BG --output=avail /mnt/c | tail -1 | tr -dc '0-9')
  if (( FREE_GB < ${MIN_FREE_GB:-10} )); then
    echo "Abbruch: auf C: sind nur ${FREE_GB} GB frei (mindestens ${MIN_FREE_GB:-10} GB nötig)." >&2
    exit 3
  fi
fi
mkdir -p "$DST"
rsync -a --delete \
  --exclude node_modules --exclude target --exclude .git \
  --exclude /apps/desktop/dist --exclude /site/dist --exclude /packs/dist --exclude /dist-builds \
  --exclude test-results --exclude playwright-report --exclude .wrangler \
  "$SRC/" "$DST/"
cd "$DST"
echo "== Pakete bauen (Blender: ${BLENDER:-fehlt})"
python3 packs/blender/build.py --blender "$BLENDER"
node packs/tools/build.mjs
du -sh packs/dist
cd "$DST/apps/desktop"
npm ci --no-fund --no-audit --loglevel=error
OUT="$SRC/dist-builds"
mkdir -p "$OUT"
# Updater-Signatur: entweder TAURI_SIGNING_PRIVATE_KEY (+ _PASSWORD) setzen oder CYPHER_KEYS_DIR auf den
# Schlüsselordner zeigen lassen (updater.key + PASSWORT-SICHERN.txt). Ohne Schlüssel entstehen keine Update-Artefakte.
UPDATER_CFG=()
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -n "${CYPHER_KEYS_DIR:-}" && -f "$CYPHER_KEYS_DIR/updater.key" ]]; then
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$CYPHER_KEYS_DIR/updater.key")"
  export TAURI_SIGNING_PRIVATE_KEY
  if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" && -f "$CYPHER_KEYS_DIR/PASSWORT-SICHERN.txt" ]]; then
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(sed -n 's/^Passwort: *//p' "$CYPHER_KEYS_DIR/PASSWORT-SICHERN.txt" | tr -d '\r')"
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    # Passwort neben dem Schlüssel hebt dessen Schutz auf (docs/security/README.md): nach der Sicherung löschen
    echo "WARNUNG: $CYPHER_KEYS_DIR/PASSWORT-SICHERN.txt liegt neben updater.key. Passwort in den Passwortmanager legen und die Datei löschen." >&2
  fi
  # Weder Umgebung noch Datei: das Passwort wird zur Laufzeit abgefragt (nicht angezeigt, nicht in der Prozessliste)
  if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" && -t 0 ]]; then
    read -r -s -p "Passwort des Updater-Schlüssels (leer = Schlüssel ohne Passwort): " TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    echo >&2
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  fi
fi
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  echo "Hinweis: kein Updater-Schlüssel gesetzt – Installer ohne Update-Signaturen."
  UPDATER_CFG=(--config '{"bundle":{"createUpdaterArtifacts":false}}')
fi
if [[ "$WHAT" == linux || "$WHAT" == all ]]; then
  npx tauri build --bundles "${2:-deb,rpm,appimage}" "${UPDATER_CFG[@]}" "${@:3}"
  find "$DST/target/release/bundle" \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' -o -name '*.sig' \) -newer package.json -exec cp {} "$OUT/" \;
fi
if [[ "$WHAT" == windows || "$WHAT" == all ]]; then
  npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis "${UPDATER_CFG[@]}" "${@:3}"
  find "$DST/target/x86_64-pc-windows-msvc/release/bundle/nsis" \( -name '*.exe' -o -name '*.sig' \) -newer package.json -exec cp {} "$OUT/" \;
  # Rohdatei plus Ressourcen für Tests ohne Installation (Tauri sucht Ressourcen neben der .exe)
  rm -rf "$OUT/windows-portable" && mkdir -p "$OUT/windows-portable"
  cp "$DST/target/x86_64-pc-windows-msvc/release/cypher-studio.exe" "$OUT/windows-portable/"
  cp -r "$DST/packs/dist" "$OUT/windows-portable/packs"
fi
if [[ "$WHAT" == e2e ]]; then
  npx tauri build --debug --no-bundle --runner cargo-xwin --target x86_64-pc-windows-msvc --features dev-tools --config '{"bundle":{"createUpdaterArtifacts":false}}'
  rm -rf "$OUT/windows-e2e" && mkdir -p "$OUT/windows-e2e"
  cp "$DST/target/x86_64-pc-windows-msvc/debug/cypher-studio.exe" "$OUT/windows-e2e/"
  cp -r "$DST/packs/dist" "$OUT/windows-e2e/packs"
fi
ls -la "$OUT"
# Aufräumen: die Zwischenstände eines Release-Builds sind 10–20 GB groß und werden beim nächsten Lauf neu erzeugt.
if [[ "${KEEP_TARGET:-0}" != 1 ]]; then
  rm -rf -- "$DST/target" && echo "Build-Zwischenstände gelöscht (KEEP_TARGET=1 behält sie)."
fi
df -h "$HOME" | tail -1
