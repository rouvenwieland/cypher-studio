#!/usr/bin/env bash
# Smoke-Test Kdenlive 26.08.2 (echtes Programm): Schriften, Profile und Titel wie nach der Einrichtung ablegen und jeden Titel mit melt (Kdenlive-MLT)
# in einem passenden Projektprofil rendern. Ausgabe: $CYPHER_OUT/<titel>.png (RGBA) und smoke-kdenlive.log (Befehle und Ausgaben).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKS="$(cd "$HERE/../../.." && pwd)"
export CYPHER_OUT="${CYPHER_OUT:-/tmp/cypher-smoke/kdenlive}"
export C1_KDPROFILE="${C1_KDPROFILE:-$HOME/c1work/prof-kdenlive-smoke}"
rm -rf "$C1_KDPROFILE" "$CYPHER_OUT"; mkdir -p "$CYPHER_OUT"
. "$HERE/env-kdenlive.sh"
mkdir -p "$XDG_DATA_HOME/kdenlive/titles" "$XDG_DATA_HOME/kdenlive/profiles" "$XDG_DATA_HOME/fonts/cypher"
cp "$PACKS"/shared/fonts/*/static/*.ttf "$XDG_DATA_HOME/fonts/cypher/"
fc-cache -f "$XDG_DATA_HOME/fonts" > /dev/null 2>&1
cp "$PACKS"/kdenlive/profiles/* "$XDG_DATA_HOME/kdenlive/profiles/"
cp "$PACKS"/kdenlive/titles/*.kdenlivetitle "$XDG_DATA_HOME/kdenlive/titles/"
LOG="$CYPHER_OUT/smoke-kdenlive.log"
{
  echo "\$ melt --version"; melt --version 2>&1 | head -1
  echo "\$ fc-list | grep -c cypher  (statische Schriften sichtbar)"; fc-list | grep -c "fonts/cypher"
  for f in "$XDG_DATA_HOME"/kdenlive/titles/*.kdenlivetitle; do
    name="$(basename "$f" .kdenlivetitle)"
    case "$name" in *9x16) prof=cypher_reel_1080x1920_30 ;; *) prof=cypher_reel_1080x1350_30 ;; esac
    out="$CYPHER_OUT/${name// /_}.png"
    echo "\$ melt -profile $prof \"kdenlivetitle:titles/$name.kdenlivetitle\" out=0 -consumer avformat:$(basename "$out") vframes=1 vcodec=png"
    melt -profile "$XDG_DATA_HOME/kdenlive/profiles/$prof" "kdenlivetitle:$f" out=0 -consumer "avformat:$CYPHER_OUT/frame-%d.png" vframes=1 vcodec=png pix_fmt=rgba 2>&1 | grep -v "^$" | head -5
    mv "$CYPHER_OUT/frame-1.png" "$out" 2>/dev/null
    file "$out" | sed "s#$CYPHER_OUT/##"
    convert "$out" -background "#8a8a8a" -flatten "${out%.png}-flach.png" 2>/dev/null
  done
} > "$LOG" 2>&1
cat "$LOG"
