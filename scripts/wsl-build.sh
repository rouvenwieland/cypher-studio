#!/usr/bin/env bash
# Baut Cypher Studio in der WSL (Ubuntu 24.04): Linux nativ und Windows per Cross-Compile (cargo-xwin, NSIS).
# Aufruf aus Windows:  wsl -d Ubuntu -- bash /mnt/c/Users/<du>/Code/cypher-studio/scripts/wsl-build.sh [linux|windows|all] [bundles]
# Der Quellbaum wird nach ~/build/cypher-studio gespiegelt, damit node_modules (Linux) und target/ nicht mit Windows kollidieren.
set -euo pipefail
WHAT="${1:-all}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST="$HOME/build/cypher-studio"
export PATH="$HOME/.local/node/bin:$HOME/.cargo/bin:$PATH"
mkdir -p "$DST"
rsync -a --delete \
  --exclude node_modules --exclude target --exclude dist --exclude .git \
  --exclude test-results --exclude playwright-report --exclude .wrangler \
  "$SRC/" "$DST/"
cd "$DST/apps/desktop"
npm ci --no-fund --no-audit --loglevel=error
OUT="$SRC/dist-builds"
mkdir -p "$OUT"
if [[ "$WHAT" == linux || "$WHAT" == all ]]; then
  npx tauri build --bundles "${2:-deb,rpm,appimage}" "${@:3}"
  find src-tauri/target/release/bundle \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' -o -name '*.sig' \) -newer package.json -exec cp {} "$OUT/" \;
fi
if [[ "$WHAT" == windows || "$WHAT" == all ]]; then
  npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis "${@:3}"
  find src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis \( -name '*.exe' -o -name '*.sig' \) -exec cp {} "$OUT/" \;
  cp src-tauri/target/x86_64-pc-windows-msvc/release/cypher-studio.exe "$OUT/cypher-studio-portable.exe" 2>/dev/null || true
fi
ls -la "$OUT"
