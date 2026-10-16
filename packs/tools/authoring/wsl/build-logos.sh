#!/usr/bin/env bash
# Erzeugt die Wortmarken (hell/dunkel) in packs/shared/brand/logos/ aus brand/logo-source.svg mit dem echten Inkscape 1.4.4:
# Text wird zu Pfaden umgewandelt (keine Schrift im Logo nötig), die Seite wird auf die Zeichnung zugeschnitten.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKS="$(cd "$HERE/../../.." && pwd)"
export C1_INKPROFILE="${C1_INKPROFILE:-$HOME/c1work/prof-inkscape-logos}"
rm -rf "$C1_INKPROFILE"
. "$HERE/env-inkscape.sh"
mkdir -p "$INKSCAPE_PROFILE_DIR/fonts/cypher" "$PACKS/shared/brand/logos"
cp "$PACKS"/shared/fonts/anybody/*Variable.ttf "$INKSCAPE_PROFILE_DIR/fonts/cypher/"
for spec in "hell:#efeee9" "dunkel:#0d0d0d"; do
  name="${spec%%:*}"; fill="${spec##*:}"
  sed "s/@FILL@/$fill/" "$PACKS/tools/authoring/brand/logo-source.svg" > "/tmp/logo-$name.svg"
  ink "/tmp/logo-$name.svg" --export-text-to-path --export-plain-svg --actions="select-all;fit-canvas-to-selection" --export-filename="$PACKS/shared/brand/logos/cypher-kollektiv-$name.svg"
  echo "geschrieben shared/brand/logos/cypher-kollektiv-$name.svg"
done
