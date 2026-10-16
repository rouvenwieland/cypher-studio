#!/usr/bin/env bash
# Smoke-Test der Reel-Projektvorlage mit dem echten Kdenlive 26.08.2: (1) melt lädt die Projektdatei und rendert ein Bild im Profil 1080 × 1920,
# (2) Kdenlive öffnet die Datei in der Oberfläche (xvfb): Fenstertitel, Profil und Spurnamen werden als Bildschirmfoto festgehalten.
# Ausgabe: $CYPHER_OUT/reel-melt.png, reel-gui.png, smoke-kdenlive-project.log
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKS="$(cd "$HERE/../../.." && pwd)"
export CYPHER_OUT="${CYPHER_OUT:-/tmp/cypher-smoke/kdenlive-project}"
export C1_KDPROFILE="${C1_KDPROFILE:-$HOME/c1work/prof-kdenlive-project}"
rm -rf "$C1_KDPROFILE" "$CYPHER_OUT"; mkdir -p "$CYPHER_OUT"
. "$HERE/env-kdenlive.sh"
mkdir -p "$XDG_DATA_HOME/kdenlive/profiles" "$XDG_DATA_HOME/kdenlive/titles" "$XDG_DATA_HOME/fonts/cypher"
cp "$PACKS"/kdenlive/profiles/* "$XDG_DATA_HOME/kdenlive/profiles/"
cp "$PACKS"/kdenlive/titles/*.kdenlivetitle "$XDG_DATA_HOME/kdenlive/titles/"
cp "$PACKS"/shared/fonts/*/static/*.ttf "$XDG_DATA_HOME/fonts/cypher/"; fc-cache -f "$XDG_DATA_HOME/fonts" > /dev/null 2>&1
PROJECT="$CYPHER_OUT/reel.kdenlive"
cp "$PACKS/projects/reel-kdenlive/files/reel.kdenlive" "$PROJECT"
LOG="$CYPHER_OUT/smoke-kdenlive-project.log"
{
  echo "\$ melt reel.kdenlive out=0 -consumer avformat:reel-melt.png vframes=1 vcodec=png"
  melt "$PROJECT" out=0 -consumer "avformat:$CYPHER_OUT/frame-%d.png" vframes=1 vcodec=png pix_fmt=rgba 2>&1 | grep -v "^$" | head -8
  mv "$CYPHER_OUT/frame-1.png" "$CYPHER_OUT/reel-melt.png" 2>/dev/null
  file "$CYPHER_OUT/reel-melt.png" | sed "s#$CYPHER_OUT/##"
  echo "\$ kdenlive reel.kdenlive  (xvfb, Bildschirmfoto nach dem Laden)"
  export CYPHER_OUT PROJECT this_dir
  xvfb-run -a -s "-screen 0 1920x1200x24" bash -c '
    "$this_dir/usr/bin/kdenlive" --no-welcome "$PROJECT" > "$CYPHER_OUT/kdenlive-gui.out" 2>&1 &
    KP=$!
    for i in $(seq 1 90); do
      xwininfo -root -tree 2>/dev/null | grep "— Kdenlive" | grep -v Splash | grep -q 1280x800 && break
      sleep 2
    done
    sleep 8
    xwininfo -root -tree 2>/dev/null | grep -E "^\s+0x" | grep "— Kdenlive" | grep -v Splash | sed "s/^ *//"
    import -window root "$CYPHER_OUT/reel-gui.png"
    kill $KP 2>/dev/null
  '
} > "$LOG" 2>&1
cat "$LOG"
