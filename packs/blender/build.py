#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Baut die Build-Ergebnisse des Blender-Pakets (nicht eingecheckt):

  app_template/cypher_ps2/startup.blend   aus build_startup.py (reproduzierbar, Fingerabdruck in startup.json)
  dist/cypher_export-<version>.zip        Blender-Extension (blender --command extension build)

Aufruf:  python packs/blender/build.py [--blender PFAD]      (Standard: Umgebungsvariable BLENDER, sonst `blender`)
Danach kann packs/tools/build.mjs das Paket packen (pack.json verweist auf beide Dateien).
"""

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run(cmd):
    print("+", " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--blender", default=os.environ.get("BLENDER") or shutil.which("blender"), help="Pfad zu blender (4.5 LTS oder neuer)")
    args = ap.parse_args()
    if not args.blender:
        sys.exit("Blender nicht gefunden: --blender angeben oder BLENDER setzen.")
    blender = Path(args.blender)

    tpl = HERE / "app_template" / "cypher_ps2"
    startup = tpl / "startup.blend"
    run([blender, "-b", "--factory-startup", "--python-exit-code", "1", "-P", tpl / "build_startup.py", "--", "--out", startup, "--fingerprint", tpl / "startup.json"])

    ext = HERE / "cypher_export"
    version = tomllib.loads((ext / "blender_manifest.toml").read_text(encoding="utf-8"))["version"]
    dist = HERE / "dist"
    dist.mkdir(exist_ok=True)
    for old in dist.glob("cypher_export-*.zip"):
        old.unlink()
    run([blender, "--command", "extension", "validate", ext])
    run([blender, "--command", "extension", "build", "--source-dir", ext, "--output-dir", dist])

    for path in (startup, dist / f"cypher_export-{version}.zip"):
        print(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(HERE)}  ({path.stat().st_size} B)")


if __name__ == "__main__":
    main()
