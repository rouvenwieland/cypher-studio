/**
 * Was der eingebaute Katalog (`catalog/catalog.json`) für Windows x64 sagt: die Sollwerte der Suite, unabhängig davon,
 * was die App daraus anzeigt.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./fixtures";

interface Artifact {
  os: string;
  arch: string;
  kind: string;
  url: string;
  size: number;
  sha256: string;
}
interface Release {
  version: string;
  channel: string;
  releasedAt?: string;
  artifacts: Artifact[];
}
interface Program {
  id: string;
  name: string;
  license: { spdx: string; name: string };
  releases: Release[];
}
export interface EmbeddedCatalog {
  sequence: number;
  generatedAt: string;
  expiresAt: string;
  programs: Program[];
}

export function embeddedCatalog(): EmbeddedCatalog {
  return JSON.parse(readFileSync(join(REPO, "catalog", "catalog.json"), "utf8")) as EmbeddedCatalog;
}

const num = (v: string) => v.split(".").map(Number);
function newer(a: string, b: string): boolean {
  const [x, y] = [num(a), num(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

/** Die Fassung, die die App für Windows x64 anbietet: die höchste stabile oder LTS-Fassung mit einem Artefakt dafür. */
export function windowsRelease(id: string): { version: string; channel: string; artifact: Artifact; program: Program } {
  const program = embeddedCatalog().programs.find((p) => p.id === id);
  if (!program) throw new Error(`Programm ${id} fehlt im Katalog`);
  let best: { release: Release; artifact: Artifact } | null = null;
  for (const release of program.releases) {
    if (release.channel === "preview") continue;
    const artifact = release.artifacts.find((a) => a.os === "windows" && a.arch === "x86_64");
    if (artifact && (!best || newer(release.version, best.release.version))) best = { release, artifact };
  }
  if (!best) throw new Error(`Kein Windows-Artefakt für ${id}`);
  return { version: best.release.version, channel: best.release.channel, artifact: best.artifact, program };
}
