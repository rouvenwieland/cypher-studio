#!/usr/bin/env bash
# Testmatrix für packs/blender: Blender 5.2 LTS und 4.5 LTS (Linux, in der WSL).
#   Einheiten- und Export-Tests (run.py), Extension als ZIP bauen/prüfen/installieren/aktivieren,
#   App-Template reproduzierbar bauen und per --app-template laden, GLB mit dem Khronos-Validator prüfen.
# Aufruf (PowerShell):  wsl -d Ubuntu -- bash /mnt/c/Users/Nevuor/Code/cypher-studio/packs/blender/tests/run_matrix.sh
# Umgebung (optional): BLENDER_52, BLENDER_45, NODE, GLTF_VALIDATOR_DIR (Ordner mit node_modules/gltf-validator)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
PACK=$(dirname "$HERE")
BL52=${BLENDER_52:-$HOME/apps/blender-5.2.2-linux-x64/blender}
BL45=${BLENDER_45:-$HOME/apps/blender-4.5.14-linux-x64/blender}
NODE=${NODE:-$HOME/.local/node/bin/node}
export GLTF_VALIDATOR_DIR=${GLTF_VALIDATOR_DIR:-$HOME/tools/gltf-validator}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
fail=0

step() { printf '\n== %s\n' "$*"; }
check() { # check <Beschreibung> <Befehl...>
  local what=$1; shift
  if "$@" > "$WORK/last.log" 2>&1; then
    printf '  ok      %s\n' "$what"
  else
    printf '  FEHLER  %s\n' "$what"; sed 's/^/          /' "$WORK/last.log" | tail -25; fail=1
  fi
}

for bl in "$BL52" "$BL45"; do
  ver=$("$bl" --version 2>/dev/null | head -1)
  tag=$(echo "$ver" | grep -oE '[0-9]+\.[0-9]+' | head -1)
  step "$ver"
  RES="$WORK/res-$tag"; mkdir -p "$RES"
  export BLENDER_USER_RESOURCES="$RES"

  # 1. Einheiten-, Prüf-, Export- und Startszenen-Tests
  mkdir -p "$WORK/keep-$tag"
  "$bl" -b --factory-startup --python-exit-code 1 -P "$HERE/run.py" -- --keep "$WORK/keep-$tag" > "$WORK/run-$tag.log" 2>&1
  rc=$?
  grep -E "^  (ok|FEHLER)|Tests bestanden|Fehlgeschlagen" "$WORK/run-$tag.log"
  if [ $rc -ne 0 ]; then fail=1; grep -B2 -A12 "Traceback" "$WORK/run-$tag.log" | head -60; fi

  # 2. Extension: validieren, bauen, installieren, aktivieren
  mkdir -p "$WORK/zip-$tag"
  check "Extension validiert (extension validate)" "$bl" --command extension validate "$PACK/cypher_export"
  check "Extension gebaut (extension build)" "$bl" --command extension build --source-dir "$PACK/cypher_export" --output-dir "$WORK/zip-$tag"
  ZIP=$(ls "$WORK/zip-$tag"/cypher_export-*.zip 2>/dev/null | head -1)
  if [ -n "$ZIP" ]; then
    check "ZIP enthält budgets.json und LICENSE" bash -c "unzip -l '$ZIP' | grep -q budgets.json && unzip -l '$ZIP' | grep -q LICENSE && ! unzip -l '$ZIP' | grep -q __pycache__"
    check "Extension installiert (install-file -r user_default)" "$bl" --command extension install-file -r user_default -e "$ZIP"
    mkdir -p "$WORK/bibliothek-$tag/3D"
    check "Extension aktiv, Asset-Bibliothek folgt der Einrichtung" "$bl" -b --python-exit-code 1 -P "$HERE/check_installed.py" -- "$WORK/bibliothek-$tag/3D"
  fi

  # 3. App-Template: reproduzierbar bauen, installieren, per --app-template laden
  TPL="$RES/scripts/startup/bl_app_templates_user/cypher_ps2"
  mkdir -p "$TPL"
  check "startup.blend gebaut" "$bl" -b --factory-startup --python-exit-code 1 -P "$PACK/app_template/cypher_ps2/build_startup.py" -- --out "$TPL/startup.blend" --fingerprint "$WORK/fp-$tag-1.json"
  check "zweiter Bau liefert denselben Fingerabdruck" bash -c "'$bl' -b --factory-startup --python-exit-code 1 -P '$PACK/app_template/cypher_ps2/build_startup.py' -- --out '$WORK/zweit.blend' --fingerprint '$WORK/fp-$tag-2.json' && cmp '$WORK/fp-$tag-1.json' '$WORK/fp-$tag-2.json'"
  cp "$PACK/app_template/cypher_ps2/__init__.py" "$TPL/__init__.py"
  check "Template per --app-template geladen" "$bl" -b --app-template cypher_ps2 --python-exit-code 1 -P "$HERE/check_template.py"

  # 4. glTF-Validator
  if [ -x "$NODE" ] && [ -d "$GLTF_VALIDATOR_DIR/node_modules/gltf-validator" ]; then
    mapfile -t glbs < <(find "$WORK/keep-$tag" -name '*.glb' | sort)
    if [ ${#glbs[@]} -gt 0 ]; then
      check "glTF-Validator: ${#glbs[@]} GLB ohne Fehler" "$NODE" "$HERE/validate_gltf.mjs" "${glbs[@]}"
      "$NODE" "$HERE/validate_gltf.mjs" "${glbs[@]}" 2>&1 | grep -E "validator" | head -3
    fi
  else
    echo "  übersprungen: glTF-Validator nicht gefunden (npm install gltf-validator in $GLTF_VALIDATOR_DIR)"
  fi
done

printf '\n'
if [ $fail -eq 0 ]; then echo "Alle Prüfungen bestanden."; else echo "Es gab Fehler."; fi
exit $fail
