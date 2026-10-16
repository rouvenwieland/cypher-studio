#!/usr/bin/env bash
# Führt ein Python-Skript mit dem echten Krita aus (kritarunner unter Xvfb). Aufruf:
#   run-krita.sh <modulname> [funktion]     z. B. run-krita.sh build_kra main
# Das Modul wird in packs/tools/authoring/krita gesucht. Umgebung: CYPHER_PACKS, CYPHER_OUT, CYPHER_LOG, C1_PROFILE.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export CYPHER_PACKS="${CYPHER_PACKS:-$(cd "$HERE/../../.." && pwd)}"
export CYPHER_PYTHONPATH="$HERE/../krita"
. "$HERE/env-krita.sh"
mkdir -p "${CYPHER_OUT:-/tmp/cypher-out}"
cd /tmp
timeout "${CYPHER_TIMEOUT:-300}" xvfb-run -a -s "-screen 0 1600x1000x24" "$KR/usr/bin/kritarunner" -s "$1" -f "${2:-main}" > "${CYPHER_RUNNER_OUT:-/tmp/kritarunner.out}" 2>&1
echo "kritarunner beendet mit Code $?"
[ -f "${CYPHER_LOG:-/tmp/cypher-kra.log}" ] && cat "${CYPHER_LOG:-/tmp/cypher-kra.log}"
