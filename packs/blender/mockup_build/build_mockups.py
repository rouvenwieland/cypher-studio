#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Baut die Mockup-Grundlagen neu (Renderdurchgänge -> Ebenen -> Vorschau) für alle oder einzelne Vorlagen.

    python packs/blender/mockup_build/build_mockups.py [--blender PFAD] [--work ARBEITSORDNER] [--garments tee-front,hoodie-back]
                                                       [--scale 1.0] [--samples 128]

Ergebnis: packs/mockups/<vorlage>/{mask,shade,light,light-dark,displace,heather,preview}.png + template.json.
Rendern dauert je Vorlage mehrere Minuten (Cycles, GPU empfohlen). Der Arbeitsordner (.exr/.npy, Szene) wird nicht eingecheckt.
Voraussetzung: Blender 5.2 LTS (die Skripte nutzen die 5.x-API, z. B. Sheen-Eingänge des Principled BSDF).
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
ALL = ("tee-front", "tee-back", "hoodie-front", "hoodie-back")
PREVIEW_COLORS = {"tee": "grau-meliert,schwarz", "hoodie": "sand,navy"}


def run(cmd):
    print("+", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--blender", default=os.environ.get("BLENDER") or shutil.which("blender"))
    ap.add_argument("--work", default=str(Path.home() / "mock" / "work"))
    ap.add_argument("--out", default=str(REPO / "packs" / "mockups"))
    ap.add_argument("--garments", default=",".join(ALL))
    ap.add_argument("--scale", default="1.0")
    ap.add_argument("--samples", default="128")
    ap.add_argument("--no-gpu", action="store_true", help="Cycles auf der CPU rechnen")
    args = ap.parse_args()
    if not args.blender:
        sys.exit("Blender nicht gefunden: --blender angeben oder BLENDER setzen.")
    base = [args.blender, "-b", "--factory-startup", "--python-exit-code", "1"]
    for gid in args.garments.split(","):
        product = gid.split("-")[0]
        extra = ["--cpu"] if args.no_gpu else []
        run(base + ["-P", HERE / "build_mockup.py", "--", "--garment", gid, "--work", args.work, "--scale", args.scale, "--samples", args.samples, *extra])
        run(base + ["-P", HERE / "maps.py", "--", "--garment", gid, "--work", args.work, "--out", args.out])
        run(base + ["-P", HERE / "preview.py", "--", "--garment", gid, "--mockups", args.out, "--colors", PREVIEW_COLORS[product]])


if __name__ == "__main__":
    main()
