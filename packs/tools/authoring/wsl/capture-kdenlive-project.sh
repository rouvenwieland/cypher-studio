#!/usr/bin/env bash
# Legt in einer echten Kdenlive-Sitzung (xvfb, per xdotool bedient) ein neues Projekt mit dem Profil "Cypher Reel 9:16" an (drei Videospuren, zwei Tonspuren)
# und speichert es als packs/tools/authoring/kdenlive/reel-base.kdenlive. Danach: node packs/tools/gen-kdenlive-project.mjs
# Voraussetzung: apt-get install xdotool x11-utils imagemagick. Bildschirmkoordinaten gelten für Kdenlive 26.08.2 bei 1280 × 800 (Standardfenster).
# Jeder Lauf nutzt ein frisches Profil (ein abgebrochener Lauf lässt Kdenlive beim nächsten Start sonst hängen).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKS="$(cd "$HERE/../../.." && pwd)"
export C1_KDPROFILE="${C1_KDPROFILE:-$HOME/c1work/prof-kdenlive-capture}"
rm -rf "$C1_KDPROFILE"
. "$HERE/env-kdenlive.sh"
mkdir -p "$XDG_DATA_HOME/kdenlive/profiles"
cp "$PACKS"/kdenlive/profiles/* "$XDG_DATA_HOME/kdenlive/profiles/"
export PACKS
timeout 300 xvfb-run -a -s "-screen 0 1920x1200x24" bash -c '
  rm -f /tmp/cypher-reel-capture.kdenlive
  "$this_dir/usr/bin/kdenlive" --no-welcome > /tmp/kdenlive-capture.out 2>&1 &
  KP=$!
  for i in $(seq 1 60); do
    xwininfo -root -tree 2>/dev/null | grep "— Kdenlive" | grep -v Splash | grep -q 1280x800 && break
    sleep 2
  done
  sleep 5
  WID=$(xdotool search --name "Untitled" | head -1); xdotool windowfocus "$WID"; sleep 1
  xdotool mousemove 53 52 click 1; sleep 5                                  # Neu
  xdotool mousemove 408 192 click 1; sleep 1; xdotool type --delay 80 "Cypher Reel 9"; sleep 3
  xdotool mousemove 500 248 click 1; sleep 2                                # Profil wählen
  xdotool mousemove 466 481 click 1; xdotool key ctrl+a; xdotool type "3"   # drei Videospuren
  sleep 1; xdotool mousemove 794 685 click 1; sleep 8                       # OK
  xdotool mousemove 20 13 click 1; sleep 2; xdotool mousemove 68 193 click 1; sleep 3   # Datei > Speichern unter
  xdotool type --delay 40 "/tmp/cypher-reel-capture.kdenlive"; sleep 1; xdotool key Return; sleep 6
  kill $KP 2>/dev/null
'
[ -s /tmp/cypher-reel-capture.kdenlive ] || { echo "Projekt wurde nicht gespeichert"; exit 1; }
mkdir -p "$PACKS/tools/authoring/kdenlive"
cp /tmp/cypher-reel-capture.kdenlive "${CYPHER_CAPTURE_OUT:-$PACKS/tools/authoring/kdenlive/reel-base.kdenlive}"
echo "gespeichert: $(wc -c < /tmp/cypher-reel-capture.kdenlive) Bytes"
