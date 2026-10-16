#!/usr/bin/env node
// Erzeugt aus packs/shared/brand/brand.json die Paletten-Dateien:
//   packs/shared/palettes/<id>.gpl   GIMP-Palette (Inkscape und Krita lesen sie)
//   packs/shared/palettes/<id>.kpl   Krita-Palette (ZIP mit colorset.xml)
// Deterministisch: gleiche brand.json → bytegleiche Dateien. `--check` schreibt nichts und meldet Abweichungen (Exit 1).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from './lib/zip.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const PACKS_DIR = join(here, '..');
export const PALETTE_DIR = join(PACKS_DIR, 'shared', 'palettes');

/** Gruppen je Palette (Anzahl der Farben nacheinander); die Summe muss die Farbzahl ergeben. */
export const GROUPS = {
  'cypher-kollektionen': [
    ['Marke und Kanäle', 5],
    ['Kollektionen', 6],
    ['Textil', 6],
  ],
  'cypher-textil-druck': [['Druckfarben des Textils', 6]],
};
const COLUMNS = 6;
/** Name des eingebauten Standardprofils von Krita (sRGB, 8 Bit); wird nicht ins ZIP gelegt. */
const KRITA_SRGB = 'sRGB-elle-V2-srgbtrc.icc';

/** @param {string} hex "#rrggbb" @returns {[number, number, number]} */
export function hexToRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex);
  if (!m) throw new Error(`Ungültige Farbe ${hex}`);
  return [Number.parseInt(m[1], 16), Number.parseInt(m[2], 16), Number.parseInt(m[3], 16)];
}

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const slug = (s) =>
  s
    .toLowerCase()
    .replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('ß', 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** GIMP-Palette (UTF-8, LF). Name im Kopf, danach "R G B<TAB>Name". */
export function renderGpl(palette) {
  const lines = ['GIMP Palette', `Name: ${palette.name}`, `Columns: ${COLUMNS}`, '#', '# Cypher Kollektiv · erzeugt aus packs/shared/brand/brand.json (nicht von Hand ändern)'];
  for (const c of palette.colors) {
    const [r, g, b] = hexToRgb(c.hex);
    lines.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${c.name}`);
  }
  return `${lines.join('\n')}\n`;
}

/** colorset.xml einer Krita-Palette (Format 2.0 mit Gruppen). */
export function renderColorsetXml(palette) {
  const groups = GROUPS[palette.id] ?? [[palette.name, palette.colors.length]];
  const total = groups.reduce((n, g) => n + g[1], 0);
  if (total !== palette.colors.length) throw new Error(`Palette ${palette.id}: Gruppen (${total}) passen nicht zu ${palette.colors.length} Farben`);
  const out = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const rowsOf = (n) => Math.ceil(n / COLUMNS);
  out.push(`<ColorSet version="2.0" name="${esc(palette.name)}" comment="Cypher Kollektiv" columns="${COLUMNS}" rows="${rowsOf(groups[0][1])}" readonly="false">`);
  let index = 0;
  groups.forEach(([groupName, count], gi) => {
    if (gi > 0) {
      // Weitere Gruppen: eigenes Element (die erste Gruppe liegt auf der Wurzel, wie Krita es schreibt)
      out.push(` <Group name="${esc(groupName)}" rows="${rowsOf(count)}">`);
    }
    for (let k = 0; k < count; k++, index++) {
      const c = palette.colors[index];
      const [r, g, b] = hexToRgb(c.hex);
      const pad = gi > 0 ? '  ' : ' ';
      out.push(`${pad}<ColorSetEntry name="${esc(c.name)}" id="${esc(slug(c.name))}" spot="false" bitdepth="U8">`);
      out.push(`${pad} <RGB r="${(r / 255).toFixed(7)}" g="${(g / 255).toFixed(7)}" b="${(b / 255).toFixed(7)}" space="${KRITA_SRGB}"/>`);
      out.push(`${pad} <Position row="${Math.floor(k / COLUMNS)}" column="${k % COLUMNS}"/>`);
      out.push(`${pad}</ColorSetEntry>`);
    }
    if (gi > 0) out.push(' </Group>');
  });
  out.push('</ColorSet>');
  return `${out.join('\n')}\n`;
}

export function renderProfilesXml() {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<Profiles>\n</Profiles>\n';
}

/** Krita-Palette (.kpl): ZIP, `mimetype` zuerst und unkomprimiert. */
export function renderKpl(palette) {
  return writeZip([
    { name: 'mimetype', data: 'application/x-krita-palette', store: true },
    { name: 'colorset.xml', data: renderColorsetXml(palette) },
    { name: 'profiles.xml', data: renderProfilesXml() },
  ]);
}

export function loadBrand() {
  return JSON.parse(readFileSync(join(PACKS_DIR, 'shared', 'brand', 'brand.json'), 'utf8'));
}

/** @returns {{ file: string, data: Buffer | string }[]} alle erzeugten Dateien (Pfad relativ zu packs/) */
export function renderAll(brand = loadBrand()) {
  const files = [];
  for (const palette of brand.palettes) {
    files.push({ file: `shared/palettes/${palette.id}.gpl`, data: renderGpl(palette) });
    files.push({ file: `shared/palettes/${palette.id}.kpl`, data: renderKpl(palette) });
  }
  return files;
}

function main(argv) {
  const check = argv.includes('--check');
  let bad = 0;
  for (const { file, data } of renderAll()) {
    const target = join(PACKS_DIR, file);
    const want = Buffer.from(data);
    if (check) {
      if (!existsSync(target) || !readFileSync(target).equals(want)) {
        console.error(`ABWEICHUNG ${file} (gen-palettes.mjs ausführen)`);
        bad++;
      }
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, want);
      console.log(`geschrieben ${file} (${want.length} Bytes)`);
    }
  }
  if (check) console.log(bad === 0 ? 'Paletten stimmen mit brand.json überein' : `${bad} Abweichung(en)`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
