#!/usr/bin/env bash
# Rendert die von build-previews.mjs geschriebenen SVG (Liste: <arbeitsordner>/list.txt, Zeilen "<datei>.svg <Breite>") mit dem echten Inkscape zu PNG.
# Ein Inkscape-Prozess für alle Dateien (Shell-Modus), damit die Schriften nur einmal geladen werden.
# Schriften: die variablen Dateien aus packs/shared/fonts (wie in einer eingerichteten Inkscape-Installation, Profilordner fonts/cypher).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKS="$(cd "$HERE/../../.." && pwd)"
PREVIEW_DIR="$1"
export C1_INKPROFILE="${C1_INKPROFILE:-$HOME/c1work/prof-inkscape-previews}"
rm -rf "$C1_INKPROFILE"
. "$HERE/env-inkscape.sh"
mkdir -p "$INKSCAPE_PROFILE_DIR/fonts/cypher"
cp "$PACKS"/shared/fonts/anybody/*Variable.ttf "$PACKS"/shared/fonts/atkinson-hyperlegible-next/*Variable.ttf "$PACKS"/shared/fonts/martian-mono/*Variable.ttf "$INKSCAPE_PROFILE_DIR/fonts/cypher/"
count=0
: > "$PREVIEW_DIR/shell.txt"
while read -r svg width; do
  [ -z "$svg" ] && continue
  echo "file-open:$PREVIEW_DIR/$svg;export-type:png;export-width:$width;export-filename:$PREVIEW_DIR/${svg%.svg}.png;export-do;file-close" >> "$PREVIEW_DIR/shell.txt"
  count=$((count + 1))
done < "$PREVIEW_DIR/list.txt"
echo "quit" >> "$PREVIEW_DIR/shell.txt"
xvfb-run -a "$IK/AppRun" --shell < "$PREVIEW_DIR/shell.txt" 2>&1 | grep -v "FontInstance::LoadGlyph\|_INKSCAPE_GC" | grep -iE "error|warning|critical" || true
rendered=$(ls "$PREVIEW_DIR"/*.png 2>/dev/null | wc -l)
echo "$count SVG, $rendered PNG gerendert"
