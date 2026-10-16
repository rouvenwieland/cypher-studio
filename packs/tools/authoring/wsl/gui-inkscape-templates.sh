#!/usr/bin/env bash
# Prüft in der echten Inkscape-Oberfläche (xvfb): Dialog "Neu aus Vorlage" zeigt die Cypher-Vorlagen (Kategorie "Cypher"); Bildschirmfoto nach $CYPHER_OUT.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKS="$(cd "$HERE/../../.." && pwd)"
export CYPHER_OUT="${1:-/tmp/cypher-smoke/inkscape-gui}"
mkdir -p "$CYPHER_OUT"
export C1_INKPROFILE="$HOME/c1work/prof-inkscape-gui"
rm -rf "$C1_INKPROFILE"
. "$HERE/env-inkscape.sh"
mkdir -p "$INKSCAPE_PROFILE_DIR/templates" "$INKSCAPE_PROFILE_DIR/palettes" "$INKSCAPE_PROFILE_DIR/fonts/cypher"
cp "$PACKS"/inkscape/templates/*.svg "$INKSCAPE_PROFILE_DIR/templates/"
cp "$PACKS"/shared/palettes/*.gpl "$INKSCAPE_PROFILE_DIR/palettes/"
cp "$PACKS"/shared/fonts/anybody/*Variable.ttf "$PACKS"/shared/fonts/atkinson-hyperlegible-next/*Variable.ttf "$PACKS"/shared/fonts/martian-mono/*Variable.ttf "$INKSCAPE_PROFILE_DIR/fonts/cypher/"
export CYPHER_OUT IK INKSCAPE_PROFILE_DIR XDG_CACHE_HOME FONTCONFIG_FILE
timeout 200 xvfb-run -a -s "-screen 0 1920x1200x24" bash -c '
  "$IK/AppRun" > "$CYPHER_OUT/inkscape-gui.out" 2>&1 &
  KP=$!
  for i in $(seq 1 60); do
    xdotool mousemove 678 837 click 1; sleep 4       # Kategorie "Cypher"
  import -window root "$CYPHER_OUT/03-cypher.png"
  xwininfo -root -tree 2>/dev/null | grep -E "Inkscape\"" | grep -q . && break
    sleep 2
  done
  sleep 8
  WID=$(xdotool search --name "Inkscape" | head -1); xdotool windowfocus "$WID" 2>/dev/null; sleep 1
  import -window root "$CYPHER_OUT/01-start.png"
  xdotool mousemove 1258 930 click 1; sleep 5      # Willkommensdialog: "Save"
  xdotool mousemove 1258 930 click 1; sleep 4      # "Thanks!"
  import -window root "$CYPHER_OUT/02-zeit-zum-zeichnen.png"
  xwininfo -root -tree 2>/dev/null | grep -E "^\s+0x" | grep -v "has no name" | sed "s/^ *//" | head -6 > "$CYPHER_OUT/fenster.txt"
  kill $KP 2>/dev/null
'
cat "$CYPHER_OUT/fenster.txt"
