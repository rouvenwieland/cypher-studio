#!/usr/bin/env bash
# Smoke-Test aller Pakete mit den echten Programmen in der WSL (Krita 5.3.4.1, Inkscape 1.4.4, Kdenlive 26.08.2, je AppImage):
#   Krita:    Vorlagen frisch erzeugen (Python-API), alle .kra im Programm öffnen (Maße, dpi, Ebenen, Hilfslinien), Paletten und Arbeitsfläche aus
#             den Bundles und aus losen Dateien laden (Ressourcenverwaltung von Krita)
#   Inkscape: Profil wie nach der Einrichtung anlegen, jede Vorlage öffnen und als PNG exportieren (Pixelmaße, Alpha, Pixelgröße je dpi)
#   Kdenlive: Schriften, Profile, Titel; jeden Titel mit melt rendern; Reel-Projekt mit melt laden und in der Oberfläche öffnen
# Ausgabe: $CYPHER_SMOKE_OUT (Standard ~/c1work/smoke-out) mit smoke.md (Befehle und Ausgaben) und den erzeugten Dateien.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKS="$(cd "$HERE/../../.." && pwd)"
OUT="${CYPHER_SMOKE_OUT:-$HOME/c1work/smoke-out}"
rm -rf "$OUT"; mkdir -p "$OUT"
MD="$OUT/smoke.md"
sec() { printf '\n## %s\n' "$1" >> "$MD"; }
# Befehl anzeigen und ausführen; Ausgabe (gekürzt) in einen Codeblock
step() {
  local title="$1"; shift
  printf '\n### %s\n\n```\n$ %s\n' "$title" "$*" >> "$MD"
  "$@" 2>&1 | grep -v "_INKSCAPE_GC\|FontInstance::LoadGlyph\|krita.db.migration\|Fontconfig error" | cut -c1-400 | head -${CYPHER_SMOKE_LINES:-60} >> "$MD"
  printf '```\n' >> "$MD"
}
printf '# Smoke-Test Team C1 (echte Programme in der WSL)\n\nStand: %s · Ubuntu 24.04 (WSL2) · Quelle der Programme: offizielle AppImages, Prüfsumme/Signatur geprüft (setup-apps.sh)\n' "$(date +%d.%m.%Y)" > "$MD"

sec "0. Programme"
step "Prüfsummen und Signaturen (setup-apps.sh, idempotent; Wiederholung: C1_SKIP_VERIFY=1)" bash "$HERE/setup-apps.sh"

sec "1. Krita 5.3.4.1"
export CYPHER_PACKS="$PACKS"
export C1_PROFILE="$HOME/c1work/prof-smoke-krita"; rm -rf "$C1_PROFILE"
export CYPHER_OUT="$OUT/krita-neu/Cypher" CYPHER_LOG="$OUT/krita-build.log"
step "Vorlagen frisch erzeugen (kritarunner, Python-API von Krita)" bash "$HERE/run-krita.sh" build_kra main
export CYPHER_DIR="$OUT/krita-neu/Cypher" CYPHER_LOG="$OUT/krita-verify-neu.log"
step "frisch erzeugte .kra im Programm öffnen und messen" bash "$HERE/run-krita.sh" verify_kra main
export CYPHER_DIR="$PACKS/krita/templates/Cypher" CYPHER_LOG="$OUT/krita-verify-repo.log"
step "eingecheckte .kra im Programm öffnen und messen" bash "$HERE/run-krita.sh" verify_kra main
# Ressourcen: Bundles
export C1_PROFILE="$HOME/c1work/prof-smoke-krita-bundle"; rm -rf "$C1_PROFILE"
. "$HERE/env-krita.sh"
mkdir -p "$XDG_DATA_HOME/kritarunner/bundles"; cp "$PACKS"/krita/bundles/*.bundle "$XDG_DATA_HOME/kritarunner/bundles/"
export CYPHER_LOG="$OUT/krita-resources-bundle.log"
step "Paletten und Arbeitsfläche aus den Bundles laden (cypher.bundle, cypher-arbeitsflaeche.bundle)" bash "$HERE/run-krita.sh" verify_resources main
# Ressourcen: lose Dateien (Ausweichweg)
export C1_PROFILE="$HOME/c1work/prof-smoke-krita-lose"; rm -rf "$C1_PROFILE"
. "$HERE/env-krita.sh"
mkdir -p "$XDG_DATA_HOME/kritarunner/palettes" "$XDG_DATA_HOME/kritarunner/workspaces"
cp "$PACKS"/shared/palettes/*.kpl "$XDG_DATA_HOME/kritarunner/palettes/"; cp "$PACKS"/krita/workspaces/*.kws "$XDG_DATA_HOME/kritarunner/workspaces/"
export CYPHER_LOG="$OUT/krita-resources-lose.log"
step "Paletten und Arbeitsfläche als lose Dateien laden (Ausweichweg)" bash "$HERE/run-krita.sh" verify_resources main

sec "2. Inkscape 1.4.4"
export CYPHER_OUT="$OUT/inkscape"
step "Profil einrichten, Vorlagen exportieren" bash "$HERE/smoke-inkscape.sh"

sec "3. Kdenlive 26.08.2"
export CYPHER_OUT="$OUT/kdenlive"
step "Titel mit melt rendern" bash "$HERE/smoke-kdenlive.sh"
export CYPHER_OUT="$OUT/kdenlive-project"
step "Reel-Projekt laden und öffnen" bash "$HERE/smoke-kdenlive-project.sh"
printf '\nFERTIG\n' >> "$MD"
echo "Smoke-Test abgeschlossen: $MD"
