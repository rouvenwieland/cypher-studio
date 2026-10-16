#!/usr/bin/env node
// Erzeugt packs/samples/probe-motiv.png: das Probe-Motiv für den Erststart (CONCEPT 6.10). Es ist absichtlich nicht ganz sauber: ein
// durchscheinender Streifen (Alpha 128) macht 2,1 % der sichtbaren Pixel aus, sonst ist alles in Ordnung (280 × 360 mm bei 300 dpi, 300 dpi im pHYs-Block,
// transparenter Rand, keine Geisterpixel, keine weiche Kante). So zeigt der Druckprüfer genau einen Hinweis „Halbtransparenz“ (Warnung ab 0,1 %).
// Inhalt: „Rauschen“ aus großen Zellen in den Kanal- und Kollektionsfarben (Papier, Empfang-Gelb, Zeitzeichen-Orange, Studio-Cyan), mit Löchern;
// der Streifen liegt ohne Berührung zu transparenten Löchern mitten im Motiv. Deterministisch (feste Zufallsfolge).
// `--check` schreibt nichts und prüft die eingecheckte Datei.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePngRgba } from './lib/png.mjs';
import { PACKS_DIR, hexToRgb } from './gen-palettes.mjs';

export const PROBE_PATH = join(PACKS_DIR, 'samples', 'probe-motiv.png');
export const PROBE = { width: 3307, height: 4252, dpi: 300, targetSemiShare: 0.021, bandAlpha: 128 };
const MARGIN = 60;
const CELL = 64;
const COLORS = ['#efeee9', '#e4f531', '#ff4f12', '#00d4d8'].map(hexToRgb);

/** Einfache, feste Zufallsfolge (mulberry32), damit die Datei bei jedem Lauf gleich ist. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function renderProbe() {
  const { width: W, height: H } = PROBE;
  const rgba = new Uint8Array(W * H * 4);
  const rand = rng(2026);
  const cols = Math.floor((W - 2 * MARGIN) / CELL);
  const rows = Math.floor((H - 2 * MARGIN) / CELL);
  const x0 = Math.floor((W - cols * CELL) / 2);
  const y0 = Math.floor((H - rows * CELL) / 2);
  const bandRow0 = Math.floor(rows / 2) - 3; // Streifen in der Mitte; Zellen darum bleiben vollständig deckend (keine Löcher)
  let visible = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const protectedRow = r >= bandRow0 - 1 && r <= bandRow0 + 7;
      const centerBlock = r > rows * 0.2 && r < rows * 0.8 && c > cols * 0.2 && c < cols * 0.8;
      const hole = !protectedRow && rand() < (centerBlock ? 0.12 : 0.3);
      const color = COLORS[Math.floor(rand() * COLORS.length)];
      if (hole) continue;
      for (let y = y0 + r * CELL; y < y0 + (r + 1) * CELL; y++) {
        for (let x = x0 + c * CELL; x < x0 + (c + 1) * CELL; x++) {
          rgba.set([color[0], color[1], color[2], 255], (y * W + x) * 4);
          visible++;
        }
      }
    }
  }
  // Durchscheinender Streifen: Breite so, dass Fläche / sichtbare Pixel möglichst nahe 2,1 % liegt (ganze Zeilen)
  const bandX0 = x0 + 6 * CELL;
  const bandW = (cols - 12) * CELL;
  const rowsNeeded = Math.max(1, Math.round((PROBE.targetSemiShare * visible) / bandW));
  const bandY0 = y0 + (bandRow0 + 1) * CELL;
  const ink = hexToRgb('#0d0d0d');
  let band = 0;
  for (let y = bandY0; y < bandY0 + rowsNeeded; y++) {
    for (let x = bandX0; x < bandX0 + bandW; x++) {
      const o = (y * W + x) * 4;
      if (rgba[o + 3] !== 255) throw new Error('Streifen liegt über einem Loch');
      rgba.set([ink[0], ink[1], ink[2], PROBE.bandAlpha], o);
      band++;
    }
  }
  return { png: encodePngRgba(W, H, rgba, { dpi: PROBE.dpi }), visible, band, share: band / visible };
}

function main(argv) {
  const { png, share, band, visible } = renderProbe();
  if (argv.includes('--check')) {
    if (!existsSync(PROBE_PATH) || !readFileSync(PROBE_PATH).equals(png)) {
      console.error('ABWEICHUNG packs/samples/probe-motiv.png (gen-probe-motif.mjs ausführen)');
      return 1;
    }
    console.log('probe-motiv.png stimmt mit dem Generator überein');
    return 0;
  }
  mkdirSync(dirname(PROBE_PATH), { recursive: true });
  writeFileSync(PROBE_PATH, png);
  console.log(`geschrieben samples/probe-motiv.png (${png.length} Bytes, Halbtransparenz ${band} von ${visible} sichtbaren Pixeln = ${(share * 100).toFixed(2)} %)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
