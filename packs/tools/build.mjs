#!/usr/bin/env node
// Baut packs/dist (gitignored) = die Tauri-Ressourcen "packs/" (ARCHITEKTUR 1.1, 4.4): prüft zuerst den Quellbaum (validate.mjs), kopiert dann
//   <id>/pack.json   mit eingetragenen Prüfsummen (`sha256`: Schlüssel = src, Wert = SHA-256 der Quelldatei)
//   alle von den Paketen genannten Dateien an ihrem relativen Ort (../shared/… landet in dist/shared/…)
//   schema/, shared/brand (brand.json, Logos, LICENSE-BRAND.md) samt den dort genannten Schriften, shared/formats.json,
//   projects/, social/, mockups/ (Team C2, ohne Arbeitsdateien), samples/
// und schreibt dist/manifest.json (alle Dateien mit Größe und SHA-256, ohne Zeitstempel: zwei Läufe liefern bytegleiche Ausgabe).
// Danach wird dist mit validate (--dist) geprüft: Prüfsummen vollständig und richtig.
//   node packs/tools/build.mjs [--out <ordner>]   (Standard: packs/dist)
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWN_PACKS, validate } from './validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PACKS = join(here, '..');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sorted = (a) => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

/**
 * @param {{ packsDir?: string, outDir?: string, skipValidate?: boolean }} [opts]
 * @returns {{ outDir: string, files: number, packs: string[], skipped: string[] }}
 */
export function build(opts = {}) {
  const packsDir = opts.packsDir ?? PACKS;
  const outDir = resolve(opts.outDir ?? join(packsDir, 'dist'));
  if (!opts.skipValidate) {
    const res = validate({ packsDir });
    if (res.errors.length) throw new Error(`Quellbaum ist nicht gültig (${res.errors.length} Fehler):\n${res.errors.join('\n')}`);
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  /** @type {Map<string, Buffer>} relativer Zielpfad (mit /) → Inhalt */
  const out = new Map();
  const put = (rel, data) => out.set(rel.replaceAll('\\', '/'), Buffer.from(data));
  const copyFromSource = (relFromPacks) => put(relFromPacks, readFileSync(join(packsDir, relFromPacks)));

  const packs = [];
  const skipped = [];
  const packDirs = readdirSync(packsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(packsDir, d.name, 'pack.json'))).map((d) => d.name);
  for (const id of sorted(packDirs)) {
    const pack = JSON.parse(readFileSync(join(packsDir, id, 'pack.json'), 'utf8'));
    const missing = pack.files.filter((f) => !existsSync(join(packsDir, id, f.src)));
    if (missing.length) {
      if (OWN_PACKS.includes(id)) throw new Error(`Paket ${id}: Quellen fehlen: ${missing.map((m) => m.src).join(', ')}`);
      skipped.push(`${id} (Quellen fehlen: ${missing.length})`);
      continue;
    }
    const sums = {};
    for (const f of pack.files) {
      const abs = resolve(packsDir, id, f.src);
      const data = readFileSync(abs);
      sums[f.src] = sha256(data);
      put(relative(packsDir, abs), data);
    }
    const actionZips = pack.actions.filter((a) => a.type === 'blenderExtensionInstall').map((a) => a.zip);
    for (const z of actionZips) if (existsSync(join(packsDir, id, z))) put(join(id, z), readFileSync(join(packsDir, id, z)));
    pack.sha256 = Object.fromEntries(sorted(Object.keys(sums)).map((k) => [k, sums[k]]));
    put(`${id}/pack.json`, `${JSON.stringify(pack, null, 2)}\n`);
    packs.push(id);
  }

  for (const f of walk(join(packsDir, 'schema'))) copyFromSource(relative(packsDir, f));
  for (const f of ['shared/formats.json', 'shared/brand/brand.json', 'shared/brand/LICENSE-BRAND.md']) copyFromSource(f);
  for (const f of walk(join(packsDir, 'shared', 'brand', 'logos'))) copyFromSource(relative(packsDir, f));
  const brand = JSON.parse(readFileSync(join(packsDir, 'shared', 'brand', 'brand.json'), 'utf8'));
  for (const font of brand.fonts) for (const f of font.files) copyFromSource(f.file);
  for (const dir of ['projects', 'social', 'samples']) for (const f of walk(join(packsDir, dir))) copyFromSource(relative(packsDir, f));
  for (const f of walk(join(packsDir, 'mockups'))) {
    const rel = relative(packsDir, f).replaceAll('\\', '/');
    if (!rel.split('/').some((p) => p.startsWith('_') || p.startsWith('.'))) copyFromSource(rel);
  }

  const manifest = { formatVersion: 1, packs: sorted(packs), files: [] };
  for (const rel of sorted(out.keys())) {
    const data = out.get(rel);
    const target = join(outDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    manifest.files.push({ path: rel, size: data.length, sha256: sha256(data) });
  }
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // Gegenprobe: dist selbst prüfen (Prüfsummen vollständig und richtig; Paketdateien vorhanden)
  if (!opts.skipValidate && outDir === join(packsDir, 'dist')) {
    const res = validate({ packsDir, dist: true, skipGenerated: true });
    if (res.errors.length) throw new Error(`dist ist nicht gültig:\n${res.errors.join('\n')}`);
  }
  return { outDir, files: manifest.files.length, packs: manifest.packs, skipped };
}

function main(argv) {
  const i = argv.indexOf('--out');
  const result = build({ outDir: i >= 0 ? argv[i + 1] : undefined });
  console.log(`dist gebaut: ${result.files} Dateien, Pakete: ${result.packs.join(', ')}${result.skipped.length ? `; übersprungen: ${result.skipped.join(', ')}` : ''}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
