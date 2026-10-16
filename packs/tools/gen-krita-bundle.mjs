#!/usr/bin/env node
// Erzeugt zwei Krita-Ressourcen-Bundles (ZIP) deterministisch:
//   packs/krita/bundles/cypher.bundle                  Paletten aus packs/shared/palettes/*.kpl (gen-palettes.mjs)
//   packs/krita/bundles/cypher-arbeitsflaeche.bundle   Arbeitsflächen aus packs/krita/workspaces/*.kws (gen-krita-workspace.mjs)
// Getrennt, damit die Arbeitsfläche in der Einrichtung abwählbar bleibt.
// Format nach Krita 5.3 (KisResourceBundle, Quelltext): mimetype, META-INF/manifest.xml mit md5sum je Ressource, meta.xml, preview.png,
// je Ressourcentyp ein Ordner. Beide Dateien werden zusätzlich mit dem echten Krita geladen (packs/tools/authoring/krita/verify_resources.py).
// `--check` schreibt nichts und prüft, ob die eingecheckten Dateien dem Ergebnis entsprechen.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from './lib/zip.mjs';
import { encodePngRgba } from './lib/png.mjs';
import { PACKS_DIR, hexToRgb, loadBrand, renderKpl } from './gen-palettes.mjs';

const BUNDLE_DIR = join(PACKS_DIR, 'krita', 'bundles');
const WORKSPACE_DIR = join(PACKS_DIR, 'krita', 'workspaces');
const TAG = 'Cypher';

export const BUNDLES = [
  { file: 'cypher.bundle', title: 'Cypher', description: 'Paletten „Cypher Kollektionen“ (17 Farben der Marke, Kanäle, Kollektionen und Textilfarben) und „Cypher Textil (Druckfarben)“ des Cypher Kollektivs.' },
  { file: 'cypher-arbeitsflaeche.bundle', title: 'Cypher Arbeitsfläche', description: 'Arbeitsfläche „Cypher Druck“ des Cypher Kollektivs: Werkzeugleiste, Übersicht, Palette, Ebenen, Pinsel und Werkzeugeinstellungen.' },
];

const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Vorschaubild 256 × 256: die Farben der ersten Palette als Raster (6 Spalten). */
export function renderPreview(brand) {
  const size = 256;
  const colors = brand.palettes[0].colors.map((c) => hexToRgb(c.hex));
  const cols = 6;
  const rows = Math.ceil(colors.length / cols);
  const rgba = new Uint8Array(size * size * 4);
  const cw = Math.floor(size / cols);
  const ch = Math.floor(size / rows);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const col = Math.min(Math.floor(x / cw), cols - 1);
      const row = Math.min(Math.floor(y / ch), rows - 1);
      const idx = row * cols + col;
      const edge = x % cw < 2 || y % ch < 2;
      const c = idx < colors.length && !edge ? colors[idx] : [239, 238, 233];
      const o = (y * size + x) * 4;
      rgba[o] = c[0];
      rgba[o + 1] = c[1];
      rgba[o + 2] = c[2];
      rgba[o + 3] = 255;
    }
  }
  return encodePngRgba(size, size, rgba);
}

/** @returns {{ type: string, path: string, data: Buffer }[]} Ressourcen des Bundles */
export function collectResources(file, brand = loadBrand()) {
  const res = [];
  if (file === 'cypher.bundle') {
    for (const palette of brand.palettes) res.push({ type: 'palettes', path: `palettes/${palette.id}.kpl`, data: renderKpl(palette) });
  } else if (file === 'cypher-arbeitsflaeche.bundle') {
    for (const f of existsSync(WORKSPACE_DIR) ? readdirSync(WORKSPACE_DIR).filter((n) => n.endsWith('.kws')).sort() : []) {
      res.push({ type: 'workspaces', path: `workspaces/${f}`, data: readFileSync(join(WORKSPACE_DIR, f)) });
    }
  } else throw new Error(`Unbekanntes Bundle ${file}`);
  return res;
}

export function renderManifest(resources) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">',
    ' <manifest:file-entry manifest:media-type="application/x-krita-resourcebundle" manifest:full-path="/"/>',
  ];
  for (const r of resources) {
    lines.push(` <manifest:file-entry manifest:media-type="${r.type}" manifest:full-path="${esc(r.path)}" manifest:md5sum="${md5(r.data)}">`);
    lines.push('  <manifest:tags>');
    lines.push(`   <manifest:tag>${TAG}</manifest:tag>`);
    lines.push('  </manifest:tags>');
    lines.push(' </manifest:file-entry>');
  }
  lines.push('</manifest:manifest>');
  return `${lines.join('\n')}\n`;
}

export function renderMeta(spec) {
  return `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<meta:meta>',
    ' <meta:generator>Cypher Studio (packs/tools/gen-krita-bundle.mjs)</meta:generator>',
    ' <meta:bundle-version>1</meta:bundle-version>',
    ' <dc:author>Cypher Kollektiv</dc:author>',
    ` <dc:title>${esc(spec.title)}</dc:title>`,
    ` <dc:description>${esc(spec.description)}</dc:description>`,
    ' <meta:initial-creator>Cypher Kollektiv</meta:initial-creator>',
    ' <dc:creator>Cypher Kollektiv</dc:creator>',
    ' <meta:creation-date>2026-10-16T00:00:00Z</meta:creation-date>',
    ' <meta:dc-date>2026-10-16T00:00:00</meta:dc-date>',
    ' <meta:meta-userdefined meta:name="email" meta:value=""/>',
    ' <meta:meta-userdefined meta:name="license" meta:value="MIT (Paletten und Arbeitsfläche); Marke: siehe LICENSE-BRAND.md"/>',
    ' <meta:meta-userdefined meta:name="website" meta:value="https://studio.cypherxcypher.de"/>',
    '</meta:meta>',
  ].join('\n')}\n`;
}

export function renderBundle(spec, brand = loadBrand()) {
  const resources = collectResources(spec.file, brand);
  if (resources.length === 0) throw new Error(`Bundle ${spec.file} hat keine Ressourcen`);
  return writeZip([
    { name: 'mimetype', data: 'application/x-krita-resourcebundle', store: true },
    { name: 'META-INF/manifest.xml', data: renderManifest(resources) },
    { name: 'meta.xml', data: renderMeta(spec) },
    { name: 'preview.png', data: renderPreview(brand) },
    ...resources.map((r) => ({ name: r.path, data: r.data })),
  ]);
}

function main(argv) {
  const check = argv.includes('--check');
  let bad = 0;
  for (const spec of BUNDLES) {
    const target = join(BUNDLE_DIR, spec.file);
    const data = renderBundle(spec);
    if (check) {
      if (!existsSync(target) || !readFileSync(target).equals(data)) {
        console.error(`ABWEICHUNG packs/krita/bundles/${spec.file} (gen-krita-bundle.mjs ausführen)`);
        bad++;
      }
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
      console.log(`geschrieben krita/bundles/${spec.file} (${data.length} Bytes)`);
    }
  }
  if (check) console.log(bad === 0 ? 'Krita-Bundles stimmen mit den Quellen überein' : `${bad} Abweichung(en)`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
