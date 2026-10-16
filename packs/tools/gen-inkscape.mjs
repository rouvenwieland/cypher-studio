#!/usr/bin/env node
// Erzeugt die Inkscape-1.4-Vorlagen packs/inkscape/templates/*.svg aus packs/shared/formats.json (eine Quelle für alle Maße).
//   Druckvorlagen: Seite in mm (1 Benutzereinheit = 1 mm), Hilfslinien für Mitte, ideale Breite und sichere Fläche, transparenter Grund
//     (pageopacity 0, Schachbrett), Export-Hinweis 300 dpi (inkscape:export-xdpi/-ydpi).
//   Social-Vorlagen: Seite in px, Hilfslinien, Ebene "Sicherheitszonen" gesperrt und ausgeblendet (wird so nie mitexportiert).
// Template-Info nach den mitgelieferten Inkscape-Vorlagen (inkscape:templateinfo mit name, label, author, shortdesc, date, keywords, category, priority).
// Gelesene Eigenschaft: Hilfslinien liegen in der Datei y-aufwärts (Position = Höhe − Abstand von oben), geprüft mit Inkscape 1.4.4 (object-to-guides).
// `--check` schreibt nichts und prüft die eingecheckten Dateien.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKS_DIR } from './gen-palettes.mjs';

export const TEMPLATE_DIR = join(PACKS_DIR, 'inkscape', 'templates');
const DATE = '2026-10-16';
const GUIDE_COLOR = 'rgb(0,103,107)'; // Tiefcyan (DESIGN.md), lesbar auf hellem Grund
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const num = (n) => String(Math.round(n * 1000) / 1000);

export function loadFormats() {
  return JSON.parse(readFileSync(join(PACKS_DIR, 'shared', 'formats.json'), 'utf8'));
}

/** Hilfslinie: vertical bei x, horizontal bei y (beide gemessen von links bzw. oben). */
function guide(id, kind, at, name, height) {
  const position = kind === 'vertical' ? `${num(at)},0` : `0,${num(height - at)}`;
  const orientation = kind === 'vertical' ? '1,0' : '0,1';
  return `    <sodipodi:guide position="${position}" orientation="${orientation}" inkscape:label="${esc(name)}" inkscape:locked="false" inkscape:color="${GUIDE_COLOR}" id="${id}" />`;
}

function templateInfo({ name, label, shortdesc, keywords, priority }) {
  return [
    '  <inkscape:templateinfo>',
    `    <inkscape:name>${esc(name)}</inkscape:name>`,
    `    <inkscape:label>${esc(label)}</inkscape:label>`,
    '    <inkscape:author>Cypher Kollektiv</inkscape:author>',
    `    <inkscape:shortdesc>${esc(shortdesc)}</inkscape:shortdesc>`,
    `    <inkscape:date>${DATE}</inkscape:date>`,
    `    <inkscape:keywords>${esc(keywords)}</inkscape:keywords>`,
    '    <inkscape:category>Cypher</inkscape:category>',
    `    <inkscape:priority>${priority}</inkscape:priority>`,
    '  </inkscape:templateinfo>',
  ].join('\n');
}

function svgDocument({ file, width, height, unit, dpi, info, guides, layers }) {
  const w = unit === 'mm' ? `${width}mm` : `${width}`;
  const h = unit === 'mm' ? `${height}mm` : `${height}`;
  return `${[
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<svg width="${w}" height="${h}" viewBox="0 0 ${width} ${height}" version="1.1" id="svg1" sodipodi:docname="${file}"`,
    `   inkscape:version="1.4.4" inkscape:export-xdpi="${dpi}" inkscape:export-ydpi="${dpi}"`,
    '   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"',
    '   xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg">',
    info,
    '  <sodipodi:namedview id="namedview1" pagecolor="#ffffff" bordercolor="#000000" borderopacity="0.25" inkscape:showpageshadow="2"',
    `     inkscape:pageopacity="0" inkscape:pagecheckerboard="1" inkscape:deskcolor="#d1d1d1" inkscape:document-units="${unit}" showguides="true"`,
    '     inkscape:current-layer="layer-motiv">',
    guides.join('\n'),
    '  </sodipodi:namedview>',
    '  <defs id="defs1" />',
    layers,
    '</svg>',
  ].join('\n')}\n`;
}

const motivLayer = '  <g inkscape:label="Motiv" inkscape:groupmode="layer" id="layer-motiv" />';

function printTemplate(fmt) {
  const guides = [];
  fmt.guidesMm.vertical.forEach((g, i) => guides.push(guide(`guide-v${i + 1}`, 'vertical', g.at, g.name, fmt.heightMm)));
  fmt.guidesMm.horizontal.forEach((g, i) => guides.push(guide(`guide-h${i + 1}`, 'horizontal', g.at, g.name, fmt.heightMm)));
  const file = `cypher-${fmt.id}.svg`;
  return {
    file,
    text: svgDocument({
      file,
      width: fmt.widthMm,
      height: fmt.heightMm,
      unit: 'mm',
      dpi: 300,
      info: templateInfo({
        name: `Cypher ${fmt.label}`,
        label: `${fmt.widthMm} × ${fmt.heightMm} mm`,
        shortdesc: `Druckfläche ${fmt.widthMm} × ${fmt.heightMm} mm (${fmt.widthPx} × ${fmt.heightPx} px bei 300 dpi), transparent; Hilfslinien: Mitte, ideale Breite, sichere Fläche.`,
        keywords: `Cypher Shirtigo Druck ${fmt.garment === 'tee' ? 'Shirt' : 'Hoodie'} ${fmt.label}`,
        priority: 10,
      }),
      guides,
      layers: motivLayer,
    }),
  };
}

function posterTemplate(p) {
  const { bleedMm: b, safeInsetMm: s, widthMm: w, heightMm: h } = p;
  const guides = [
    guide('guide-v1', 'vertical', b, 'Endformat links', h),
    guide('guide-v2', 'vertical', b + s, 'Sicherheitsabstand links', h),
    guide('guide-v3', 'vertical', w / 2, 'Mitte', h),
    guide('guide-v4', 'vertical', w - b - s, 'Sicherheitsabstand rechts', h),
    guide('guide-v5', 'vertical', w - b, 'Endformat rechts', h),
    guide('guide-h1', 'horizontal', b, 'Endformat oben', h),
    guide('guide-h2', 'horizontal', b + s, 'Sicherheitsabstand oben', h),
    guide('guide-h3', 'horizontal', h - b - s, 'Sicherheitsabstand unten', h),
    guide('guide-h4', 'horizontal', h - b, 'Endformat unten', h),
  ];
  const file = `cypher-${p.id}.svg`;
  return {
    file,
    text: svgDocument({
      file, width: w, height: h, unit: 'mm', dpi: 300,
      info: templateInfo({
        name: `Cypher ${p.label}`,
        label: `${w} × ${h} mm`,
        shortdesc: `Endformat ${p.trimMm.width} × ${p.trimMm.height} mm plus ${b} mm Anschnitt (${p.widthPx} × ${p.heightPx} px bei 300 dpi); Hilfslinien: Endformat und ${s} mm Sicherheitsabstand.`,
        keywords: 'Cypher Poster A2 Druck Anschnitt',
        priority: 20,
      }),
      guides,
      layers: motivLayer,
    }),
  };
}

function stickerTemplate(s) {
  const file = `cypher-${s.id}.svg`;
  return {
    file,
    text: svgDocument({
      file, width: s.widthMm, height: s.heightMm, unit: 'mm', dpi: 300,
      info: templateInfo({
        name: `Cypher ${s.label}`,
        label: `${s.widthMm} × ${s.heightMm} mm`,
        shortdesc: `Quadratische Fläche ${s.widthMm} × ${s.heightMm} mm (${s.widthPx} × ${s.heightPx} px bei 300 dpi); Shirtigo druckt keine Sticker, nur als Datei.`,
        keywords: 'Cypher Sticker Aufkleber 1:1',
        priority: 21,
      }),
      guides: [guide('guide-v1', 'vertical', s.widthMm / 2, 'Mitte', s.heightMm), guide('guide-h1', 'horizontal', s.heightMm / 2, 'Mitte', s.heightMm)],
      layers: motivLayer,
    }),
  };
}

function zonesLayer(fmt) {
  const { widthPx: w, heightPx: h } = fmt;
  const holes = fmt.safeZones.map((r) => `M${r.x},${r.y} V${r.y + r.height} H${r.x + r.width} V${r.y} Z`).join(' ');
  const outlines = fmt.safeZones
    .map((r, i) => `    <rect x="${r.x + 2}" y="${r.y + 2}" width="${r.width - 4}" height="${r.height - 4}" fill="none" stroke="#00d4d8" stroke-width="4" stroke-dasharray="16 8" id="zone-rand-${i + 1}" />`)
    .join('\n');
  return [
    '  <g inkscape:label="Sicherheitszonen (nicht exportieren)" inkscape:groupmode="layer" id="layer-zonen" sodipodi:insensitive="true" style="display:none">',
    `    <path d="M0,0 H${w} V${h} H0 Z ${holes}" fill="#0d0d0d" fill-opacity="0.44" fill-rule="evenodd" id="zone-schatten" />`,
    outlines,
    `    <text x="24" y="38" style="font-family:'Martian Mono';font-weight:500;font-size:20px;fill:#efeee9" id="zone-text">SICHERHEITSZONE - Ebene ausblenden, bevor du exportierst</text>`,
    '  </g>',
  ].join('\n');
}

function socialTemplate(fmt) {
  const guides = [];
  fmt.guidesPx.vertical.forEach((g, i) => guides.push(guide(`guide-v${i + 1}`, 'vertical', g.at, g.name, fmt.heightPx)));
  fmt.guidesPx.horizontal.forEach((g, i) => guides.push(guide(`guide-h${i + 1}`, 'horizontal', g.at, g.name, fmt.heightPx)));
  const file = `cypher-${fmt.id}.svg`;
  return {
    file,
    text: svgDocument({
      file, width: fmt.widthPx, height: fmt.heightPx, unit: 'px', dpi: 96,
      info: templateInfo({
        name: `Cypher ${fmt.label}`,
        label: `${fmt.widthPx} × ${fmt.heightPx} px`,
        shortdesc: `${fmt.widthPx} × ${fmt.heightPx} px mit Hilfslinien und gesperrter, ausgeblendeter Ebene für die Sicherheitszonen (wird nicht exportiert).`,
        keywords: `Cypher Social Instagram TikTok ${fmt.label}`,
        priority: 30,
      }),
      guides,
      layers: `${motivLayer}\n${zonesLayer(fmt)}`,
    }),
  };
}

/** @returns {{ file: string, text: string }[]} */
export function renderAll(formats = loadFormats()) {
  return [
    ...formats.print.map(printTemplate),
    posterTemplate(formats.poster),
    stickerTemplate(formats.sticker),
    ...formats.social.map(socialTemplate),
  ];
}

function main(argv) {
  const files = renderAll();
  if (argv.includes('--check')) {
    let bad = 0;
    for (const { file, text } of files) {
      const target = join(TEMPLATE_DIR, file);
      if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
        console.error(`ABWEICHUNG inkscape/templates/${file} (gen-inkscape.mjs ausführen)`);
        bad++;
      }
    }
    const known = new Set(files.map((f) => f.file));
    for (const f of existsSync(TEMPLATE_DIR) ? readdirSync(TEMPLATE_DIR) : []) {
      if (!known.has(f)) {
        console.error(`UNBEKANNT inkscape/templates/${f}`);
        bad++;
      }
    }
    console.log(bad === 0 ? 'Inkscape-Vorlagen stimmen mit formats.json überein' : `${bad} Abweichung(en)`);
    return bad === 0 ? 0 : 1;
  }
  mkdirSync(TEMPLATE_DIR, { recursive: true });
  for (const { file, text } of files) {
    writeFileSync(join(TEMPLATE_DIR, file), text);
    console.log(`geschrieben inkscape/templates/${file}`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
