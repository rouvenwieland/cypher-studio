#!/usr/bin/env node
// Erzeugt die Social-Vorlagen packs/social/<id>/template.json (Schema: packs/schema/social.schema.json = SocialTemplate aus dem IPC-Vertrag,
// mit Dateinamen statt URLs). Die Gestaltung steht hier im Code, damit Änderungen prüfbar sind; die Maße kommen aus packs/shared/formats.json,
// die Farben aus packs/shared/brand/brand.json. preview.png erzeugt packs/tools/authoring/build-previews.mjs (Inkscape).
// Regeln, die die Tests prüfen: Texte und Logo liegen in den Sicherheitszonen, kleinste Schrift ≥ 28 px, Kontrast Text/Grund ≥ 4,5:1, Schriften aus brand.json.
// `--check` schreibt nichts und prüft die eingecheckten Dateien.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKS_DIR, loadBrand } from './gen-palettes.mjs';

export const SOCIAL_DIR = join(PACKS_DIR, 'social');
const brand = loadBrand();
const formats = JSON.parse(readFileSync(join(PACKS_DIR, 'shared', 'formats.json'), 'utf8'));
const pal = Object.fromEntries(brand.palettes[0].colors.map((c) => [c.name, c.hex]));
export const COLORS = {
  ink: pal.Tinte,
  paper: pal.Papier,
  yellow: pal['Empfang-Gelb (Shop)'],
  cobalt: pal['Mittelwelle Kobalt'],
  wave: pal['Mittelwelle Hell'],
  mute: '#5b5a56', // gedämpfte Schrift auf Papier (DESIGN.md, 5,9:1)
};

const fmt = (id) => formats.social.find((f) => f.id === id);

const rect = (x, y, width, height) => ({ x, y, width, height });
const solid = (color) => ({ type: 'solid', color });

function text(id, slot, r, o) {
  return {
    type: 'text', id, slot, rect: r,
    fontFamily: o.font, fontWeight: o.weight, sizePx: o.size, minSizePx: o.min ?? o.size, lineHeight: o.line ?? 1.2,
    letterSpacingEm: o.tracking ?? 0, color: o.color, align: o.align ?? 'left', valign: o.valign ?? 'top',
    transform: o.upper ? 'uppercase' : 'none', maxLines: o.lines ?? 1, defaultText: o.text,
  };
}
const display = (o) => ({ font: 'Anybody', weight: 800, line: 0.9, tracking: -0.01, upper: true, ...o });
const body = (o) => ({ font: 'Atkinson Hyperlegible Next', weight: 400, line: 1.25, ...o });
const mono = (o) => ({ font: 'Martian Mono', weight: 500, line: 1.2, tracking: 0.06, upper: true, ...o });

const shape = (id, r, color, opacity = 1) => ({ type: 'shape', id, rect: r, fill: solid(color), radiusPx: 0, opacity });
const image = (id, slot, r, required = false) => ({ type: 'image', id, slot, rect: r, fit: 'cover', radiusPx: 0, required });
const logo = (id, r, variant) => ({ type: 'logo', id, rect: r, variant });
const grain = (id, opacity, seed) => ({ type: 'grain', id, opacity, seed });

function template(id, formatId, extra) {
  const f = fmt(formatId);
  return {
    formatVersion: 1,
    id,
    title: extra.title,
    description: extra.description,
    tags: extra.tags,
    format: f.format,
    size: { width: f.widthPx, height: f.heightPx },
    background: extra.background,
    layers: extra.layers,
    safeZones: f.safeZones,
    gridCrop: f.gridCrop,
    preview: 'preview.png',
  };
}

const LOGO_W = 224;
const LOGO_H = 97; // Seitenverhältnis der Wortmarke 457 : 197

export function buildAll() {
  const out = [];

  // ---- Drop-Ankündigung (Post 4:5) -------------------------------------------------
  out.push(template('drop-ankuendigung', 'post', {
    title: 'Drop-Ankündigung',
    description: 'Neuer Drop: Kennung, große Überschrift, Motivbild, Datum und Unterzeile auf Tinte.',
    tags: ['drop', 'post', 'ankündigung'],
    background: solid(COLORS.ink),
    layers: [
      shape('balken', rect(72, 72, 120, 12), COLORS.yellow),
      text('kennung', 'kennung', rect(72, 100, 936, 40), mono({ size: 28, color: COLORS.yellow, text: 'Neuer Drop' })),
      text('titel', 'titel', rect(72, 160, 936, 500), display({ size: 160, min: 90, color: COLORS.paper, lines: 3, text: 'Herbst-Drop 26' })),
      image('motiv', 'motiv', rect(72, 690, 936, 440)),
      text('datum', 'datum', rect(72, 1160, 640, 48), mono({ size: 36, color: COLORS.paper, text: '22.10.2026 · 18:00' })),
      text('unterzeile', 'unterzeile', rect(72, 1216, 640, 90), body({ size: 36, min: 30, color: COLORS.paper, lines: 2, text: 'Neue Motive, ab 18 Uhr im Shop.' })),
      logo('logo', rect(784, 1209, LOGO_W, LOGO_H), 'light'),
      grain('korn', 0.06, 7),
    ],
  }));

  // ---- Drop-Ankündigung (Story 9:16) ----------------------------------------------
  out.push(template('drop-ankuendigung-story', 'story', {
    title: 'Drop-Ankündigung (Story)',
    description: 'Wie die Post-Vorlage, im Hochformat 9:16; alles innerhalb der Sicherheitszone für Instagram und TikTok.',
    tags: ['drop', 'story', 'reel', 'ankündigung'],
    background: solid(COLORS.ink),
    layers: [
      shape('balken', rect(120, 300, 120, 12), COLORS.yellow),
      text('kennung', 'kennung', rect(120, 330, 840, 40), mono({ size: 28, color: COLORS.yellow, text: 'Neuer Drop' })),
      text('titel', 'titel', rect(120, 390, 840, 420), display({ size: 150, min: 80, color: COLORS.paper, lines: 3, text: 'Herbst-Drop 26' })),
      image('motiv', 'motiv', rect(120, 830, 840, 250)),
      text('datum', 'datum', rect(120, 1100, 840, 48), mono({ size: 36, color: COLORS.paper, text: '22.10.2026 · 18:00' })),
      text('unterzeile', 'unterzeile', rect(120, 1156, 580, 90), body({ size: 36, min: 30, color: COLORS.paper, lines: 2, text: 'Neue Motive, ab 18 Uhr im Shop.' })),
      logo('logo', rect(736, 1146, LOGO_W, LOGO_H), 'light'),
      grain('korn', 0.06, 11),
    ],
  }));

  // ---- Motiv-Vorstellung (Post 4:5) ------------------------------------------------
  out.push(template('motiv-vorstellung', 'post', {
    title: 'Motiv-Vorstellung',
    description: 'Ein Motiv groß auf Papier: Bild, Schild „Neues Motiv“, Titel und Unterzeile.',
    tags: ['motiv', 'post', 'vorstellung'],
    background: solid(COLORS.paper),
    layers: [
      image('motiv', 'motiv', rect(72, 72, 936, 780)),
      shape('schild', rect(72, 880, 300, 48), COLORS.yellow),
      text('schildtext', 'schild', rect(88, 886, 268, 36), mono({ size: 28, color: COLORS.ink, text: 'Neues Motiv' })),
      text('titel', 'titel', rect(72, 950, 936, 150), display({ size: 100, min: 56, color: COLORS.ink, lines: 2, text: 'Neon Ratte' })),
      text('unterzeile', 'unterzeile', rect(72, 1110, 700, 90), body({ size: 36, min: 30, color: COLORS.mute, lines: 2, text: 'Kollektion Rauschen · Druck vorn' })),
      logo('logo', rect(784, 1226, LOGO_W, LOGO_H), 'dark'),
    ],
  }));

  // ---- Event-Plakat (Story 9:16) ---------------------------------------------------
  out.push(template('event-plakat', 'story', {
    title: 'Event-Plakat',
    description: 'Termin als Plakat im Hochformat: Datum, Titel, Ort, auf Mittelwelle-Kobalt.',
    tags: ['event', 'plakat', 'story', 'termin'],
    background: solid(COLORS.cobalt),
    layers: [
      text('kennung', 'kennung', rect(120, 300, 840, 40), mono({ size: 28, color: COLORS.wave, text: 'Live · Mittelwelle' })),
      text('datum', 'datum', rect(120, 360, 840, 250), display({ size: 230, min: 120, color: COLORS.wave, text: '22.10.' })),
      shape('linie', rect(120, 640, 840, 8), COLORS.wave),
      text('titel', 'titel', rect(120, 680, 840, 330), display({ size: 100, min: 64, color: COLORS.wave, lines: 3, text: 'Elternabend der Kollektion' })),
      text('ort', 'ort', rect(120, 1040, 560, 120), body({ size: 44, min: 32, color: COLORS.wave, lines: 2, text: 'Hinterhof 7 · Einlass 19:00' })),
      logo('logo', rect(736, 1146, LOGO_W, LOGO_H), 'light'),
      grain('korn', 0.05, 23),
    ],
  }));

  // ---- Zitat (Post 4:5) ------------------------------------------------------------
  out.push(template('zitat', 'post', {
    title: 'Zitat',
    description: 'Ein Satz groß auf Papier mit Quelle.',
    tags: ['zitat', 'post', 'text'],
    background: solid(COLORS.paper),
    layers: [
      shape('balken', rect(72, 72, 936, 16), COLORS.yellow),
      text('zitat', 'zitat', rect(72, 140, 936, 800), display({ size: 112, min: 60, color: COLORS.ink, lines: 6, text: 'Rauschen ist auch eine Antwort.' })),
      text('quelle', 'quelle', rect(72, 990, 936, 44), mono({ size: 30, color: COLORS.ink, text: '— Name, Ort' })),
      logo('logo', rect(784, 1226, LOGO_W, LOGO_H), 'dark'),
    ],
  }));

  // ---- Reel-Cover (9:16, Titel im 3:4-Ausschnitt des Profilrasters) ----------------
  out.push(template('reel-cover', 'reel-cover', {
    title: 'Reel-Cover',
    description: 'Titelbild für Reels: Bild füllt das Format, Titel und Kennung liegen im 3:4-Ausschnitt des Profilrasters (y 240 bis 1680).',
    tags: ['reel', 'cover', 'titelbild'],
    background: solid(COLORS.ink),
    layers: [
      image('bild', 'bild', rect(0, 0, 1080, 1920)),
      shape('abdunkelung-oben', rect(0, 0, 1080, 420), COLORS.ink, 0.55),
      shape('abdunkelung', rect(0, 900, 1080, 780), COLORS.ink, 0.62),
      text('kennung', 'kennung', rect(120, 300, 840, 40), mono({ size: 28, color: COLORS.yellow, text: 'Reel 07' })),
      text('titel', 'titel', rect(120, 1100, 840, 420), display({ size: 130, min: 90, color: COLORS.paper, lines: 4, text: 'So entsteht ein Motiv' })),
      logo('logo', rect(736, 1560, LOGO_W, LOGO_H), 'light'),
    ],
  }));

  return out;
}

/** @returns {{ file: string, text: string }[]} */
export function renderAll() {
  return buildAll().map((t) => ({ file: `${t.id}/template.json`, text: `${JSON.stringify(t, null, 2)}\n` }));
}

function main(argv) {
  const files = renderAll();
  if (argv.includes('--check')) {
    let bad = 0;
    for (const { file, text: t } of files) {
      const target = join(SOCIAL_DIR, file);
      if (!existsSync(target) || readFileSync(target, 'utf8') !== t) {
        console.error(`ABWEICHUNG social/${file} (gen-social.mjs ausführen)`);
        bad++;
      }
    }
    const known = new Set(files.map((f) => f.file.split('/')[0]));
    for (const d of existsSync(SOCIAL_DIR) ? readdirSync(SOCIAL_DIR) : []) {
      if (!known.has(d)) {
        console.error(`UNBEKANNT social/${d}`);
        bad++;
      }
    }
    console.log(bad === 0 ? 'Social-Vorlagen stimmen mit dem Generator überein' : `${bad} Abweichung(en)`);
    return bad === 0 ? 0 : 1;
  }
  for (const { file, text: t } of files) {
    const target = join(SOCIAL_DIR, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, t);
    console.log(`geschrieben social/${file}`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
