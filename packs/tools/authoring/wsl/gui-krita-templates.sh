#!/usr/bin/env bash
# Prüft in der echten Krita-Oberfläche (xvfb), dass die Einrichtung greift: Vorlagen unter "Cypher" im Dialog "Neues Bild", Paletten im Palette-Docker
# und die Arbeitsfläche im Menü. Legt Bildschirmfotos nach $CYPHER_OUT. Aufruf: gui-krita-templates.sh [Ausgabeordner]
# Bedienung per xdotool (Koordinaten gelten für Krita 5.3.4.1 bei 1280 x 800); Hinweis: Ein frisches Profil braucht beim ersten Start ca. 1 Minute.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKS="$(cd "$HERE/../../.." && pwd)"
export CYPHER_OUT="${1:-/tmp/cypher-smoke/krita-gui}"
mkdir -p "$CYPHER_OUT"
export C1_PROFILE="$HOME/c1work/prof-krita-gui3"
rm -rf "$C1_PROFILE"
. "$HERE/env-krita.sh"
# Einrichtung nachstellen: Zielordner = kritaResources (Linux: ~/.local/share/krita)
RES="$XDG_DATA_HOME/krita"
mkdir -p "$RES/templates/Cypher" "$RES/bundles" "$RES/fonts/cypher"
cp -r "$PACKS/krita/templates/Cypher/." "$RES/templates/Cypher/"
cp "$PACKS"/krita/bundles/*.bundle "$RES/bundles/"
cp "$PACKS"/shared/fonts/anybody/*Variable.ttf "$PACKS"/shared/fonts/atkinson-hyperlegible-next/*Variable.ttf "$PACKS"/shared/fonts/martian-mono/*Variable.ttf "$RES/fonts/cypher/"
printf '[General]\nHideSplashScreen=true\nShowWelcomePage=false\n' > "$XDG_CONFIG_HOME/kritarc"
export CYPHER_OUT KR
timeout 400 xvfb-run -a -s "-screen 0 1920x1200x24" bash -c '
  "$KR/usr/bin/krita" --nosplash > "$CYPHER_OUT/krita-gui.out" 2>&1 &
  KP=$!
  for i in $(seq 1 150); do
    xwininfo -root -tree 2>/dev/null | grep -E "^\s+0x[0-9a-f]+ \"Krita" | grep -vi splash | grep -q . && break
    sleep 2
  done
  sleep 10
  WID=$(xdotool search --name "Krita" | head -1); xdotool windowfocus "$WID" 2>/dev/null; sleep 1
  import -window root "$CYPHER_OUT/01-start.png"
  xdotool mousemove 450 372 click 1; sleep 8   # Link "New Image" der Startseite
  import -window root "$CYPHER_OUT/02-neu.png"
  xdotool mousemove 712 399 click 1; sleep 3                                  # Gruppe "Cypher"
  import -window root "$CYPHER_OUT/03-cypher.png"
  xdotool mousemove 1000 417 click 1; sleep 2; xdotool mousemove 1190 826 click 1; sleep 12   # "Hoodie vorne", "Use This Template"
  import -window root "$CYPHER_OUT/04-vorlage-geoeffnet.png"
  xwininfo -root -tree 2>/dev/null | grep -E "^\s+0x" | grep -v "has no name" | sed "s/^ *//" | head -6 > "$CYPHER_OUT/fenster.txt"
  kill $KP 2>/dev/null
'
cat "$CYPHER_OUT/fenster.txt"
