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
if [[ "$WHAT" == linux || "$WHAT" == all ]]; then
  npx tauri build --bundles "${2:-deb,rpm,appimage}" "${@:3}"
  find "$DST/target/release/bundle" \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' -o -name '*.sig' \) -newer package.json -exec cp {} "$OUT/" \;
fi
if [[ "$WHAT" == windows || "$WHAT" == all ]]; then
  npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis "${@:3}"
  find "$DST/target/x86_64-pc-windows-msvc/release/bundle/nsis" \( -name '*.exe' -o -name '*.sig' \) -newer package.json -exec cp {} "$OUT/" \;
  # Rohdatei plus Ressourcen für Tests ohne Installation (Tauri sucht Ressourcen neben der .exe)
  rm -rf "$OUT/windows-portable" && mkdir -p "$OUT/windows-portable"
  cp "$DST/target/x86_64-pc-windows-msvc/release/cypher-studio.exe" "$OUT/windows-portable/"
  cp -r "$DST/packs/dist" "$OUT/windows-portable/packs"
fi
if [[ "$WHAT" == e2e ]]; then
  npx tauri build --debug --no-bundle --runner cargo-xwin --target x86_64-pc-windows-msvc --features dev-tools
  rm -rf "$OUT/windows-e2e" && mkdir -p "$OUT/windows-e2e"
  cp "$DST/target/x86_64-pc-windows-msvc/debug/cypher-studio.exe" "$OUT/windows-e2e/"
  cp -r "$DST/packs/dist" "$OUT/windows-e2e/packs"
fi
ls -la "$OUT"
