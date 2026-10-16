#!/usr/bin/env bash
# Erfasst den Docker-Zustand der Arbeitsfläche "Cypher Druck" in einer echten Krita-Sitzung (xvfb) und legt ihn als
# packs/tools/authoring/krita/gui_plugin/cypher-druck.state.json ab. Danach: node packs/tools/gen-krita-workspace.mjs
# Der erste Start eines frischen Profils dauert ca. 1 Minute (Krita importiert seine Standard-Ressourcen).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKS="$(cd "$HERE/../../.." && pwd)"
export C1_PROFILE="${C1_PROFILE:-$HOME/c1work/prof-krita-gui}"
. "$HERE/env-krita.sh"
rm -rf "$XDG_DATA_HOME/krita/pykrita/cypher_ws"
mkdir -p "$XDG_DATA_HOME/krita/pykrita"
cp -r "$PACKS/tools/authoring/krita/gui_plugin/cypher_ws" "$PACKS/tools/authoring/krita/gui_plugin/cypher_ws.desktop" "$XDG_DATA_HOME/krita/pykrita/"
printf '[python]\nenable_cypher_ws=true\n[General]\nHideSplashScreen=true\nShowWelcomePage=false\n' > "$XDG_CONFIG_HOME/kritarc"
export CYPHER_WS_OUT=/tmp/cypher-ws.json CYPHER_WS_MODE=arrange CYPHER_WS_DELAY=8000
rm -f /tmp/cypher-ws.json /tmp/cypher-ws.json.log
xvfb-run -a -s "-screen 0 1920x1200x24" bash -c '
  "$0/usr/bin/krita" --nosplash > /tmp/krita-gui.out 2>&1 &
  KP=$!
  for i in $(seq 1 120); do
    sleep 5
    [ -f /tmp/cypher-ws.json ] && break
    kill -0 $KP 2>/dev/null || break
  done
  sleep 2; kill $KP 2>/dev/null || true
' "$KR"
[ -f /tmp/cypher-ws.json ] || { echo "Kein Zustand erfasst (siehe /tmp/cypher-ws.json.log und /tmp/krita-gui.out)"; exit 1; }
cp /tmp/cypher-ws.json "$PACKS/tools/authoring/krita/gui_plugin/cypher-druck.state.json"
echo "Zustand gespeichert: $(wc -c < /tmp/cypher-ws.json) Bytes"
