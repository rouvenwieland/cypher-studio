#!/usr/bin/env node
// Erzeugt die Kdenlive-Titelvorlagen (.kdenlivetitle) im Cypher-Stil nach packs/kdenlive/titles/:
//   Bauchbinde, Titelkarte, Reel-Hook, Untertitel-Stil, je für 1080 × 1920 (9:16) und 1080 × 1350 (4:5).
// Format wie bei den mitgelieferten Vorlagen von Kdenlive 26.08 (XML mit QGraphicsTextItem/QGraphicsRectItem), Schriften als statische Schnitte
// (Familienname = Namenseintrag 1 der Schrift, z. B. "Anybody ExtraBold", damit Qt sie unter Windows und Linux findet; Gewicht 400 = normal, 700 = fett).
// Hilfswerte: Sicherheitsrand seitlich 120 px (9:16) bzw. 60 px (4:5), unten frei ab y = 1248 (9:16, Plattform-Oberfläche).
// Geprüft mit `melt kdenlivetitle:<datei>` aus dem echten Kdenlive (packs/tools/authoring/wsl/smoke-kdenlive.sh).
// `--check` schreibt nichts und prüft die eingecheckten Dateien.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKS_DIR, hexToRgb } from './gen-palettes.mjs';

export const TITLE_DIR = join(PACKS_DIR, 'kdenlive', 'titles');
const INK = '#0d0d0d';
const PAPER = '#efeee9';
const MUTE = '#5b5a56';
const YELLOW = '#e4f531'; // Empfang-Gelb (Rauschen), Akzent der Titel
const FPS_OUT = 149; // 5 s bei 30 fps

const rgba = (hex, alpha = 255) => `${hexToRgb(hex).join(',')},${alpha}`;
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const FONT = {
  display: 'Anybody ExtraBold',
  hook: 'Anybody UltraCondensed Black',
  text: 'Atkinson Hyperlegible Next',
  mono: 'Martian Mono',
};

let z = 0;
function text({ x, y, w, h, font, size, weight = 400, color = INK, outline = 0, outlineColor = INK, align = 'left', text: t, lineSpacing = 0, letterSpacing = 0 }) {
  const alignment = { left: 1, right: 2, center: 4 }[align];
  return [
    `  <item type="QGraphicsTextItem" z-index="${z++}">`,
    `   <position x="${x}" y="${y}">`,
    '    <transform>1,0,0,0,1,0,0,0,1</transform>',
    '   </position>',
    `   <content font="${esc(font)}" font-pixel-size="${size}" font-italic="0" font-underline="0" font-weight="${weight}" font-color="${rgba(color)}" font-outline-color="${rgba(outlineColor)}" font-outline="${outline}" letter-spacing="${letterSpacing}" line-spacing="${lineSpacing}" alignment="${alignment}" box-width="${w}" box-height="${h}">${esc(t)}</content>`,
    '  </item>',
  ].join('\n');
}

function rect({ x, y, w, h, color, alpha = 255 }) {
  return [
    `  <item type="QGraphicsRectItem" z-index="${z++}">`,
    `   <position x="${x}" y="${y}">`,
    '    <transform>1,0,0,0,1,0,0,0,1</transform>',
    '   </position>',
    `   <content pencolor="0,0,0,0" rect="0,0,${w},${h}" penwidth="0" brushcolor="${rgba(color, alpha)}"/>`,
    '  </item>',
  ].join('\n');
}

function title({ width, height, items, background = '0,0,0,0' }) {
  z = 0;
  const body = items().join('\n');
  return `${[
    `<kdenlivetitle LC_NUMERIC="C" width="${width}" height="${height}" out="${FPS_OUT}">`,
    body,
    ` <startviewport rect="0,0,${width},${height}"/>`,
    ` <endviewport rect="0,0,${width},${height}"/>`,
    ` <background color="${background}"/>`,
    '</kdenlivetitle>',
  ].join('\n')}\n`;
}

const SIZES = [
  { id: '9x16', width: 1080, height: 1920, margin: 120 },
  { id: '4x5', width: 1080, height: 1350, margin: 60 },
];

const LAYOUTS = {
  /** Bauchbinde: Papierbalken mit Akzentstreifen, Name groß, Rolle klein. */
  Bauchbinde: ({ width, height, margin }) =>
    title({
      width,
      height,
      items: () => {
        const w = width - 2 * margin;
        const y = height === 1920 ? 1010 : 930;
        return [
          rect({ x: margin, y, w, h: 156, color: PAPER }),
          rect({ x: margin, y, w: 20, h: 156, color: YELLOW }),
          text({ x: margin + 44, y: y + 12, w: w - 64, h: 90, font: FONT.display, size: 66, color: INK, text: 'NAME NACHNAME' }),
          text({ x: margin + 44, y: y + 98, w: w - 64, h: 48, font: FONT.text, size: 36, color: MUTE, text: 'Rolle im Kollektiv · Kollektion' }),
        ];
      },
    }),
  /** Titelkarte: Tinte als Grund, Kennung in Mono, Titel in Anybody UltraCondensed, Akzentlinie, Untertitel. */
  Titelkarte: ({ width, height, margin }) =>
    title({
      width,
      height,
      background: rgba(INK),
      items: () => {
        const w = width - 2 * margin;
        const top = height === 1920 ? 520 : 330;
        return [
          text({ x: margin, y: top, w, h: 48, font: FONT.mono, size: 32, color: YELLOW, text: 'CYPHER KOLLEKTIV' }),
          text({ x: margin, y: top + 70, w, h: 520, font: FONT.hook, size: 250, color: PAPER, lineSpacing: -30, text: 'TITEL DER\nFOLGE' }),
          rect({ x: margin, y: top + 560, w: 160, h: 16, color: YELLOW }),
          text({ x: margin, y: top + 610, w, h: 56, font: FONT.text, size: 44, color: PAPER, text: 'Untertitel oder Datum' }),
        ];
      },
    }),
  /** Reel-Hook: transparenter Grund, große Kopfzeile mit Tinten-Kontur, Gelbstreifen hinter Zeile zwei. */
  'Reel-Hook': ({ width, height, margin }) =>
    title({
      width,
      height,
      items: () => {
        const w = width - 2 * margin;
        const top = height === 1920 ? 520 : 330;
        return [
          rect({ x: margin - 20, y: top + 226, w: w + 40, h: 178, color: YELLOW }),
          text({ x: margin, y: top, w, h: 230, font: FONT.hook, size: 230, color: PAPER, outline: 8, outlineColor: INK, text: 'DAS HAST DU' }),
          text({ x: margin, y: top + 232, w, h: 170, font: FONT.hook, size: 150, color: INK, text: 'NOCH NIE GESEHEN' }),
        ];
      },
    }),
  /** Untertitel-Stil: halbdurchsichtiger Tintenkasten, Text in Atkinson Hyperlegible Next Bold, zentriert, über der Bedienzone. */
  'Untertitel-Stil': ({ width, height, margin }) =>
    title({
      width,
      height,
      items: () => {
        const w = width - 2 * margin;
        const y = height === 1920 ? 1050 : 960;
        return [
          rect({ x: margin, y, w, h: 184, color: INK, alpha: 200 }),
          text({ x: margin + 24, y: y + 22, w: w - 48, h: 140, font: FONT.text, size: 54, weight: 700, color: PAPER, align: 'center', lineSpacing: 4, text: 'Untertitel in zwei Zeilen,\nlesbar auf jedem Bild' }),
        ];
      },
    }),
};

/** @returns {{ file: string, text: string }[]} */
export function renderAll() {
  const out = [];
  for (const [name, build] of Object.entries(LAYOUTS)) {
    for (const size of SIZES) out.push({ file: `Cypher ${name} ${size.id}.kdenlivetitle`, text: build(size) });
  }
  return out;
}

function main(argv) {
  const files = renderAll();
  if (argv.includes('--check')) {
    let bad = 0;
    for (const { file, text: t } of files) {
      const target = join(TITLE_DIR, file);
      if (!existsSync(target) || readFileSync(target, 'utf8') !== t) {
        console.error(`ABWEICHUNG kdenlive/titles/${file} (gen-kdenlive-titles.mjs ausführen)`);
        bad++;
      }
    }
    const known = new Set(files.map((f) => f.file));
    for (const f of existsSync(TITLE_DIR) ? readdirSync(TITLE_DIR) : []) {
      if (!known.has(f)) {
        console.error(`UNBEKANNT kdenlive/titles/${f}`);
        bad++;
      }
    }
    console.log(bad === 0 ? 'Kdenlive-Titel stimmen mit dem Generator überein' : `${bad} Abweichung(en)`);
    return bad === 0 ? 0 : 1;
  }
  mkdirSync(TITLE_DIR, { recursive: true });
  for (const { file, text: t } of files) {
    writeFileSync(join(TITLE_DIR, file), t);
    console.log(`geschrieben kdenlive/titles/${file}`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
