#!/usr/bin/env bash
# Smoke-Test Inkscape 1.4.4 (echtes Programm): Profil wie nach der Einrichtung anlegen (Vorlagen, Paletten, Schriften), jede Vorlage öffnen und als PNG exportieren.
# Ausgabe: $CYPHER_OUT/<vorlage>.png und smoke-inkscape.log (Befehle und Ausgaben). Auswertung der Pixelmaße: packs/tools/tests/live.test.mjs
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKS="$(cd "$HERE/../../.." && pwd)"
export CYPHER_OUT="${CYPHER_OUT:-/tmp/cypher-smoke/inkscape}"
export C1_INKPROFILE="${C1_INKPROFILE:-$HOME/c1work/prof-inkscape-smoke}"
rm -rf "$C1_INKPROFILE" "$CYPHER_OUT"; mkdir -p "$CYPHER_OUT"
. "$HERE/env-inkscape.sh"
mkdir -p "$INKSCAPE_PROFILE_DIR/templates" "$INKSCAPE_PROFILE_DIR/palettes" "$INKSCAPE_PROFILE_DIR/fonts/cypher"
cp "$PACKS"/inkscape/templates/*.svg "$INKSCAPE_PROFILE_DIR/templates/"
cp "$PACKS"/shared/palettes/*.gpl "$INKSCAPE_PROFILE_DIR/palettes/"
cp "$PACKS"/shared/fonts/anybody/*Variable.ttf "$PACKS"/shared/fonts/atkinson-hyperlegible-next/*Variable.ttf "$PACKS"/shared/fonts/martian-mono/*Variable.ttf "$INKSCAPE_PROFILE_DIR/fonts/cypher/"
LOG="$CYPHER_OUT/smoke-inkscape.log"
{
  echo "\$ inkscape --version"; ink --version
  echo "\$ inkscape --user-data-directory"; ink --user-data-directory
  for f in "$INKSCAPE_PROFILE_DIR"/templates/*.svg; do
    name="$(basename "$f" .svg)"
    case "$name" in *shirt*|*hoodie*|*poster*|*sticker*) dpi=300 ;; *) dpi=96 ;; esac
    echo "\$ inkscape templates/$name.svg --export-type=png --export-dpi=$dpi -o $name.png"
    ink "$f" --export-type=png --export-dpi=$dpi --export-filename="$CYPHER_OUT/$name.png"
    file "$CYPHER_OUT/$name.png" | sed "s#$CYPHER_OUT/##"
  done
} > "$LOG" 2>&1
cat "$LOG"
