#!/usr/bin/env bash
# Echte Linux-Probe (Meilenstein M1): installiert Blender mit der Kommandozeile `cypher` aus dem signierten Katalog,
# prüft die Prüfsumme gegen die Veröffentlichung von blender.org, entpackt in einen eigenen Ordner, startet
# `blender --version` und zeigt, dass eine veränderte Datei abgewiesen wird (Prüfsumme) und nichts zurückbleibt.
#
# Aufruf (WSL oder Linux):  scripts/probe-linux.sh [--keep] [--program blender] [--skip-run]
#   --keep       Arbeitsordner behalten (Standard: wird gelöscht)
#   --skip-run   das installierte Programm nicht starten (z. B. auf einem Server ohne Grafikbibliotheken)
# Umgebung:  CYPHER=<Pfad zur cypher-Datei> (Standard: cargo build -p cypher-cli), PROBE_DIR=<Arbeitsordner>
# Nichts davon berührt das echte Benutzerprofil: alles liegt unter dem Arbeitsordner (`--data-dir`).
set -euo pipefail

KEEP=0
SKIP_RUN=0
PROGRAM="blender"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --skip-run) SKIP_RUN=1 ;;
    --program) PROGRAM="$2"; shift ;;
    *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
  esac
  shift
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"
[[ "$(uname -s)" == "Linux" ]] || { echo "Die Probe läuft nur unter Linux (WSL genügt)." >&2; exit 2; }
for tool in curl python3 sha256sum; do
  command -v "$tool" >/dev/null || { echo "Fehlt: $tool" >&2; exit 2; }
done

step() { printf '\n== %s\n' "$*"; }
fail() { printf '\nFEHLER: %s\n' "$*" >&2; exit 1; }

# --- Programm bereitstellen --------------------------------------------------------------------
if [[ -z "${CYPHER:-}" ]]; then
  step "cypher bauen"
  (cd "$ROOT" && cargo build -p cypher-cli --quiet)
  CYPHER="${CARGO_TARGET_DIR:-$ROOT/target}/debug/cypher"
fi
[[ -x "$CYPHER" ]] || fail "cypher nicht gefunden: $CYPHER"

WORK="${PROBE_DIR:-$(mktemp -d /tmp/cypher-probe.XXXXXX)}"
mkdir -p "$WORK"
SERVER_PID=""
cleanup() {
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  if [[ "$KEEP" == 0 ]]; then rm -rf "$WORK"; else echo "Arbeitsordner: $WORK"; fi
}
trap cleanup EXIT
DATA="$WORK/data-real"
PACKS="$ROOT/packs/dist"
cy() { "$CYPHER" --packs "$PACKS" "$@"; }

# --- 1. Plan -----------------------------------------------------------------------------------
step "1. Plan für $PROGRAM (kein Download)"
PLAN="$WORK/plan.txt"
if cy --data-dir "$DATA" install "$PROGRAM" >"$PLAN" 2>"$WORK/plan.err"; then
  fail "ohne --yes darf nichts installiert werden"
fi
cat "$PLAN"
SHA="$(sed -n 's/^  SHA-256: *\([0-9a-f]\{64\}\).*/\1/p' "$PLAN")"
URL="$(sed -n 's/^  Quelle: .*\(https:\/\/[^ )]*\).*/\1/p' "$PLAN")"
FILE="$(sed -n 's/^  Datei: *\([^ ]*\) .*/\1/p' "$PLAN")"
[[ -n "$SHA" && -n "$URL" && -n "$FILE" ]] || fail "Plan nicht lesbar"
echo "-> Prüfsumme im Katalog: $SHA"

# --- 2. Prüfsumme gegen die Veröffentlichung des Herstellers ----------------------------------
step "2. Prüfsumme gegen die Veröffentlichung des Herstellers"
CHECK_URL="$(sed -n 's/.*Prüfdatei: \([^)]*\)).*/\1/p' "$PLAN" | head -1)"
if [[ "$CHECK_URL" == https://download.blender.org/* ]]; then
  UPSTREAM="$(curl -fsSL "$CHECK_URL" | grep -F "$FILE" | cut -d' ' -f1 || true)"
  [[ -n "$UPSTREAM" ]] || fail "Prüfsummendatei von blender.org nicht lesbar ($CHECK_URL)"
  [[ "$UPSTREAM" == "$SHA" ]] || fail "Katalog ($SHA) und blender.org ($UPSTREAM) widersprechen sich"
  echo "-> blender.org veröffentlicht dieselbe Prüfsumme ($CHECK_URL)"
else
  echo "-> (nur für blender automatisiert; Prüfdatei: $CHECK_URL)"
fi

# --- 3. Echte Installation ---------------------------------------------------------------------
step "3. Installation (Download, SHA-256, Entpacken, Registrieren)"
cy --data-dir "$DATA" install "$PROGRAM" --yes --keep-download
LAUNCHER="$(cy --data-dir "$DATA" detect --json | python3 -c '
import json, os, sys
view = json.load(sys.stdin)
prog = next(p for p in view["programs"] if p["id"] == sys.argv[1])
inst = next(i for i in prog["installations"] if i["managedByCypher"])
print(os.path.expanduser(inst["location"]))' "$PROGRAM")"
[[ -f "$LAUNCHER" ]] || fail "Startdatei fehlt: $LAUNCHER"
INSTALLED="$(dirname "$LAUNCHER")"
echo "-> installiert in $INSTALLED (Start: $LAUNCHER)"
case "$LAUNCHER" in "$DATA"/*) ;; *) fail "Installation liegt außerhalb des Probe-Ordners: $LAUNCHER" ;; esac

# --- 4. Programm starten -----------------------------------------------------------------------
if [[ "$SKIP_RUN" == 0 && "$PROGRAM" == "blender" ]]; then
  step "4. blender --version"
  BIN="$LAUNCHER"
  [[ -x "$BIN" ]] || fail "Startdatei fehlt oder ist nicht ausführbar: $BIN"
  if ! OUT="$("$BIN" --version 2>&1)"; then
    echo "$OUT" | head -5
    echo "Fehlende Bibliotheken:"; ldd "$BIN" 2>/dev/null | grep 'not found' || true
    fail "blender --version scheitert (siehe oben; ggf. Pakete nachinstallieren oder --skip-run)"
  fi
  echo "$OUT" | head -3
  echo "$OUT" | grep -q '^Blender 5\.' || fail "Unerwartete Versionsausgabe"
fi

# --- 5. Negativtest: veränderte Datei ---------------------------------------------------------
step "5. Negativtest mit veränderter Datei"
# Der Zwischenspeicher benennt geladene Dateien nach ihrer Prüfsumme
CACHED="$(find "$DATA" -name "$SHA*" -type f | head -1)"
[[ -f "$CACHED" ]] || fail "Die geladene Datei wurde nicht behalten (--keep-download)"
echo "$SHA  $CACHED" | sha256sum -c - >/dev/null || fail "Die behaltene Datei hat nicht die Prüfsumme des Katalogs"
mkdir -p "$WORK/serve"
cp "$CACHED" "$WORK/serve/$FILE"
SIZE="$(stat -c %s "$WORK/serve/$FILE")"
# ein Byte in der Mitte umdrehen, Größe bleibt gleich
printf '\xA5' | dd of="$WORK/serve/$FILE" bs=1 seek=$((SIZE / 2)) conv=notrunc status=none
cmp -s "$CACHED" "$WORK/serve/$FILE" && fail "Die Datei wurde nicht verändert"
rm -f "$CACHED"

PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
(cd "$WORK/serve" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
SERVER_PID=$!
for _ in $(seq 1 50); do curl -fsI "http://127.0.0.1:$PORT/$FILE" >/dev/null 2>&1 && break; sleep 0.1; done

# Katalog mit Testschlüssel: derselbe Eintrag, nur die Adresse zeigt auf den lokalen Server mit der veränderten Datei
NEG="$WORK/data-neg"
mkdir -p "$NEG/data/catalog" "$WORK/keys"
cy catalog keygen --out "$WORK/keys" >/dev/null
python3 - "$ROOT/catalog/catalog.json" "$NEG/data/catalog/catalog.json" "$PROGRAM" "$FILE" "http://127.0.0.1:$PORT/$FILE" <<'PY'
import json, sys
src, dst, program, file, url = sys.argv[1:6]
catalog = json.load(open(src, encoding="utf-8"))
catalog["sequence"] += 1000
hit = 0
for p in catalog["programs"]:
    if p["id"] != program:
        continue
    for r in p["releases"]:
        for a in r["artifacts"]:
            if a["fileName"] == file:
                a["url"] = url
                a["checksumSource"] = url.rsplit("/", 1)[0] + "/checksums.txt"
                hit += 1
assert hit, "Artefakt nicht im Katalog gefunden"
json.dump(catalog, open(dst, "w", encoding="utf-8"), indent=2)
PY
cy catalog sign "$NEG/data/catalog/catalog.json" --key "$WORK/keys/catalog-dev.key" >/dev/null

set +e
cy --data-dir "$NEG" --trust-key "$WORK/keys/catalog-dev.pub" --allow-loopback-http install "$PROGRAM" --yes >"$WORK/neg.out" 2>"$WORK/neg.err"
CODE=$?
set -e
tail -4 "$WORK/neg.err"
[[ $CODE -ne 0 ]] || fail "Die veränderte Datei wurde installiert!"
grep -q checksumMismatch "$WORK/neg.err" || fail "Erwartet war checksumMismatch"
if find "$NEG/data/programs" -mindepth 2 -maxdepth 2 2>/dev/null | grep -q .; then
  fail "Nach der Abweisung liegen Reste im Programmordner"
fi
echo "-> abgewiesen (checksumMismatch), nichts installiert, keine Reste"

# --- 6. Druckprüfer auf Linux ------------------------------------------------------------------
step "6. Druckprüfer (Beispielmotiv, Export und erneute Prüfung)"
cy --data-dir "$WORK/data-print" printcheck "$PACKS/samples/probe-motiv.png" --garment schwarz --semi threshold \
  --placement-json --export "$WORK/druck" --fail-on never | tail -8
[[ -s "$WORK/druck.png" ]] || fail "Exportdatei fehlt"

printf '\nPROBE OK: %s %s installiert, geprüft, gestartet; veränderte Datei abgewiesen.\n' "$PROGRAM" "$(basename "$INSTALLED")"
