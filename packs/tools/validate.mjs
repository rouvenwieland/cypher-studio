#!/usr/bin/env node
// Prüft alle Pakete unter packs/ (ARCHITEKTUR 8.6). Keine Laufzeit-Abhängigkeiten.
//   node packs/tools/validate.mjs            Quellbaum prüfen
//   node packs/tools/validate.mjs --dist     zusätzlich packs/dist (Ergebnis von build.mjs) prüfen
//   node packs/tools/validate.mjs --strict   Befunde in Paketen und Mockups anderer Teams (C2) als Fehler zählen
// Geprüft wird: Schemas (pack, template, mockup, social, brand), Dateiexistenz und Zielwurzeln, Prüfsummen der Schriften (SHA256SUMS),
// OFL-Text je Schrift und kein "Reserved Font Name", Schriftdaten (statisch/variabel, Schräglage), Paletten und alle erzeugten Dateien
// (Generatoren erzeugen bytegleich), Krita-Dateien (.kra Maße/dpi/Ebenen/Hilfslinien, .kpl, .bundle mit md5sum, .kws), Inkscape-Vorlagen,
// Kdenlive-Titel/Profile/Projekt, Social-Vorlagen (Sicherheitszonen, Mindestschrift, Kontrast), Projektvorlagen und Mockup-Vorlagen (Schema).
// Ausgabe: Fehler (Exit 1) und Hinweise. Programmierschnittstelle: validate({ packsDir, dist }).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SchemaRegistry, formatErrors } from './lib/schema.mjs';
import { findAll, parseXml } from './lib/xml.mjs';
import { readZip } from './lib/zip.mjs';
import { readPngInfo } from './lib/png.mjs';
import { readFontInfo } from './lib/ttf.mjs';
import { contrast } from './lib/color.mjs';
import * as palettes from './gen-palettes.mjs';
import * as bundles from './gen-krita-bundle.mjs';
import * as workspace from './gen-krita-workspace.mjs';
import * as inkscape from './gen-inkscape.mjs';
import * as titles from './gen-kdenlive-titles.mjs';
import * as project from './gen-kdenlive-project.mjs';
import * as social from './gen-social.mjs';
import * as templates from './gen-templates.mjs';
import * as packsGen from './gen-packs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PACKS_DIR = join(here, '..');
const SCHEMA_BASE = 'https://studio.cypherxcypher.de/schemas/';

/** Pflichtmaße aus ARCHITEKTUR 4.7 und vorgaben.md (unabhängig von formats.json, damit ein Tippfehler dort auffällt). */
export const REQUIRED_PRINT_PX = {
  'shirt-front': [3898, 5315],
  'shirt-back': [3898, 5315],
  'hoodie-front': [3898, 3307],
  'hoodie-back': [3898, 4606],
};
export const REQUIRED_POSTER_PX = [5031, 7087];
export const REQUIRED_SOCIAL_PX = { post: [1080, 1350], story: [1080, 1920], 'reel-cover': [1080, 1920] };

/** Zielwurzeln, die ein Paket je Programm benutzen darf. */
const ROOTS_BY_PROGRAM = {
  krita: ['kritaResources'],
  inkscape: ['inkscapeProfile'],
  blender: ['blenderConfig', 'blenderScripts', 'blenderExtensions', 'blenderExtensionConfig'],
  kdenlive: ['kdenliveData', 'kdenliveLocalData'],
  null: ['userFonts', 'projectTemplates'],
};

/** Pakete dieses Teams (C1); andere Pakete im Ordner packs/ gehören anderen Teams. */
export const OWN_PACKS = ['krita', 'inkscape', 'kdenlive', 'fonts'];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sorted = (a) => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

class Report {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.checks = 0;
  }

  /** @param {boolean} cond */
  ok(cond, area, message) {
    this.checks++;
    if (!cond) this.errors.push(`[${area}] ${message}`);
    return cond;
  }

  warn(area, message) {
    this.warnings.push(`[${area}] ${message}`);
  }
}

/** Liest Schriftdaten; eine kaputte Datei ist ein Prüfergebnis, kein Absturz. */
function fontInfo(file, r, area) {
  try {
    return readFontInfo(readFileSync(file));
  } catch (e) {
    r.ok(false, area, `${file}: keine gültige Schriftdatei (${e.message})`);
    return null;
  }
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

function loadSchemas(packsDir, r) {
  const reg = new SchemaRegistry();
  const dir = join(packsDir, 'schema');
  for (const f of existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.schema.json')) : []) {
    try {
      const schema = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      r.ok(schema.$id === `${SCHEMA_BASE}${f}`, 'schema', `${f}: $id muss ${SCHEMA_BASE}${f} sein`);
      reg.add(schema);
    } catch (e) {
      r.ok(false, 'schema', `${f}: ${e.message}`);
    }
  }
  for (const need of ['common', 'pack', 'template', 'mockup', 'social', 'brand']) {
    r.ok(reg.byId.has(`${SCHEMA_BASE}${need}.schema.json`), 'schema', `${need}.schema.json fehlt`);
  }
  return reg;
}

function validateJson(reg, r, area, schemaName, file, data) {
  const res = reg.validate(`${SCHEMA_BASE}${schemaName}.schema.json`, data);
  r.ok(res.valid, area, `${file} entspricht ${schemaName}.schema.json nicht:\n${formatErrors(res.errors)}`);
  return res.valid;
}

function readJson(file, r, area) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    r.ok(false, area, `${file}: kein gültiges JSON (${e.message})`);
    return null;
  }
}

/** Vergleicht erwartete (erzeugte) Dateien mit dem Stand im Baum. */
function compareGenerated(r, packsDir, area, items) {
  for (const { file, data } of items) {
    const target = join(packsDir, file);
    const want = Buffer.from(data);
    r.ok(existsSync(target) && readFileSync(target).equals(want), area, `${file} weicht vom Generator ab (Generator ausführen)`);
  }
}

function unknownFiles(r, packsDir, area, dir, known, filter = () => true) {
  for (const f of walk(join(packsDir, dir))) {
    const rel = relative(packsDir, f).replaceAll('\\', '/');
    if (filter(rel)) r.ok(known.has(rel), area, `${rel} ist unbekannt (nicht vom Generator erzeugt)`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
function checkFonts(packsDir, r) {
  const dir = join(packsDir, 'shared', 'fonts');
  const sums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8').split('\n').filter(Boolean);
  const listed = new Set();
  for (const line of sums) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!r.ok(Boolean(m), 'schriften', `SHA256SUMS: Zeile nicht lesbar: ${line}`)) continue;
    listed.add(m[2]);
    const file = join(dir, m[2]);
    if (r.ok(existsSync(file), 'schriften', `SHA256SUMS nennt fehlende Datei ${m[2]}`)) r.ok(sha256(readFileSync(file)) === m[1], 'schriften', `${m[2]}: Prüfsumme stimmt nicht`);
  }
  const files = walk(dir).filter((f) => /\.(ttf|otf)$/i.test(f) || f.endsWith('OFL.txt'));
  for (const f of files) {
    const rel = relative(dir, f).replaceAll('\\', '/');
    r.ok(listed.has(rel), 'schriften', `${rel} fehlt in SHA256SUMS`);
  }
  const families = new Set();
  for (const f of walk(dir).filter((x) => x.endsWith('.ttf'))) {
    const rel = relative(dir, f).replaceAll('\\', '/');
    const family = rel.split('/')[0];
    families.add(family);
    const info = fontInfo(f, r, 'schriften');
    if (!info) continue;
    r.ok(!info.hasReservedFontName, 'schriften', `${rel}: Urheberrechtseintrag nennt einen Reserved Font Name (nichts verändern oder umbenennen)`);
    const name = rel.split('/').at(-1);
    const italic = /Italic/.test(name);
    r.ok(italic ? info.italicAngle < 0 : info.italicAngle === 0, 'schriften', `${rel}: Schräglage ${info.italicAngle}° passt nicht zum Namen (${italic ? 'kursiv' : 'aufrecht'})`);
    const variable = /-Variable\.ttf$/.test(name);
    r.ok(info.isVariable === variable, 'schriften', `${rel}: ${variable ? 'variabel' : 'statisch'} erwartet`);
    if (!variable) {
      const m = /-(Thin|ExtraLight|Light|Regular|Italic|Medium|SemiBold|Bold|BoldItalic|ExtraBold|Black)\.ttf$/.exec(name);
      const weights = { Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Italic: 400, Medium: 500, SemiBold: 600, Bold: 700, BoldItalic: 700, ExtraBold: 800, Black: 900 };
      if (r.ok(Boolean(m), 'schriften', `${rel}: Schnittname im Dateinamen nicht erkannt`)) r.ok(info.weightClass === weights[m[1]], 'schriften', `${rel}: Gewichtsklasse ${info.weightClass} passt nicht zu ${m[1]}`);
      r.ok(info.axes.length === 0, 'schriften', `${rel}: statische Datei mit Achsen`);
    }
  }
  for (const fam of families) r.ok(existsSync(join(dir, fam, 'OFL.txt')), 'schriften', `${fam}: OFL.txt fehlt`);
  r.ok(existsSync(join(dir, 'QUELLEN.md')), 'schriften', 'QUELLEN.md fehlt');
  return families;
}

function fontNameSets(packsDir, r) {
  /** Familiennamen, die Programme für statische Schnitte nutzen können (Namenseintrag 1 und typografische Familie). */
  const names = new Set();
  for (const f of walk(join(packsDir, 'shared', 'fonts')).filter((x) => x.endsWith('.ttf') && /\/static\/|\\static\\/.test(x))) {
    const info = fontInfo(f, r, 'kdenlive');
    if (!info) continue;
    names.add(info.family);
    if (info.typographicFamily) names.add(info.typographicFamily);
  }
  return names;
}

function checkBrand(packsDir, r, reg) {
  const file = join(packsDir, 'shared', 'brand', 'brand.json');
  const brand = readJson(file, r, 'marke');
  if (!brand) return null;
  if (!validateJson(reg, r, 'marke', 'brand', 'brand.json', brand)) return brand;
  const ids = brand.garmentColors.map((g) => g.id);
  r.ok(JSON.stringify(ids) === JSON.stringify(['schwarz', 'weiss', 'grau-meliert', 'navy', 'sand', 'creme']), 'marke', `Textilfarben: ${ids.join(', ')}`);
  r.ok(brand.collections.map((c) => c.id).join() === 'rauschen,mittelwelle,gold', 'marke', 'Kollektionen müssen rauschen, mittelwelle, gold sein');
  const studio = brand.channels.find((c) => c.id === 'studio');
  r.ok(studio?.surface === '#00d4d8' && studio?.deep === '#00676b', 'marke', 'Studio-Cyan muss #00d4d8 (tief #00676b) sein (DESIGN.md)');
  const kollektionen = brand.palettes.find((p) => p.id === 'cypher-kollektionen');
  r.ok(kollektionen?.colors.length === 17, 'marke', 'Palette cypher-kollektionen braucht 17 Farben (CONCEPT 6.3)');
  for (const p of brand.palettes) {
    const hexes = p.colors.map((c) => c.hex);
    r.ok(new Set(hexes).size === hexes.length, 'marke', `Palette ${p.id}: doppelte Farbwerte`);
    r.ok(new Set(p.colors.map((c) => c.name)).size === p.colors.length, 'marke', `Palette ${p.id}: doppelte Namen`);
  }
  for (const g of brand.garmentColors) {
    const best = contrast(g.hex, '#0d0d0d') >= contrast(g.hex, '#efeee9') ? '#0d0d0d' : '#efeee9';
    r.ok(g.textOnGarment === best, 'marke', `${g.id}: textOnGarment ${g.textOnGarment} sollte ${best} sein (besserer Kontrast)`);
    r.ok(contrast(g.hex, g.textOnGarment) >= 4.5, 'marke', `${g.id}: Kontrast der Hinweisfarbe unter 4,5:1`);
    const cp = kollektionen?.colors.find((c) => c.hex === g.hex);
    r.ok(Boolean(cp), 'marke', `${g.id}: Marken-Hexwert ${g.hex} fehlt in der Palette cypher-kollektionen`);
  }
  r.ok(brand.garmentColors.find((g) => g.id === 'weiss')?.underbase === false && brand.garmentColors.filter((g) => !g.underbase).length === 1, 'marke', 'nur weißes Textil hat keine weiße Unterlage (ARCHITEKTUR 4.8)');
  const druck = brand.palettes.find((p) => p.id === 'cypher-textil-druck');
  r.ok(druck && JSON.stringify(druck.colors.map((c) => c.hex)) === JSON.stringify(brand.garmentColors.map((g) => g.textileHex)), 'marke', 'Palette cypher-textil-druck muss die textileHex-Werte in Reihenfolge enthalten');
  for (const f of brand.fonts.flatMap((x) => x.files)) r.ok(existsSync(join(packsDir, f.file)), 'marke', `Schriftdatei fehlt: ${f.file}`);
  for (const fnt of brand.fonts) {
    for (const f of fnt.files) {
      if (!existsSync(join(packsDir, f.file))) continue;
      const info = fontInfo(join(packsDir, f.file), r, 'marke');
      if (!info) continue;
      const fam = info.typographicFamily ?? info.family;
      r.ok(fam.startsWith(fnt.family), 'marke', `${f.file}: Familie "${fam}" passt nicht zu "${fnt.family}"`);
      r.ok(info.weightClass === f.weight, 'marke', `${f.file}: Gewicht ${info.weightClass} statt ${f.weight} in brand.json`);
      r.ok((info.italicAngle < 0) === (f.style === 'italic'), 'marke', `${f.file}: Stil passt nicht zu brand.json`);
    }
  }
  for (const l of brand.logos) {
    const p = join(packsDir, l.file);
    if (r.ok(existsSync(p), 'marke', `Logo fehlt: ${l.file}`)) {
      try {
        const root = parseXml(readFileSync(p, 'utf8'));
        r.ok(root.name === 'svg' && Boolean(root.attrs.viewBox), 'marke', `${l.file}: SVG mit viewBox erwartet`);
        r.ok(findAll(root, 'text').length === 0, 'marke', `${l.file}: Text muss zu Pfaden umgewandelt sein`);
        r.ok(findAll(root, 'path').length > 0, 'marke', `${l.file}: keine Pfade`);
      } catch (e) {
        r.ok(false, 'marke', `${l.file}: ${e.message}`);
      }
    }
  }
  r.ok(existsSync(join(packsDir, 'shared', 'brand', 'LICENSE-BRAND.md')), 'marke', 'LICENSE-BRAND.md fehlt');
  return brand;
}

function checkFormats(packsDir, r) {
  const f = readJson(join(packsDir, 'shared', 'formats.json'), r, 'formate');
  if (!f) return null;
  for (const [id, [w, h]] of Object.entries(REQUIRED_PRINT_PX)) {
    const e = f.print.find((p) => p.id === id);
    r.ok(e?.widthPx === w && e?.heightPx === h, 'formate', `${id}: ${e?.widthPx}×${e?.heightPx} px, erwartet ${w}×${h} (ARCHITEKTUR 4.7)`);
  }
  for (const p of f.print) {
    r.ok(p.widthPx === Math.round((p.widthMm / 25.4) * f.dpi) && p.heightPx === Math.round((p.heightMm / 25.4) * f.dpi), 'formate', `${p.id}: Pixel passen nicht zu mm bei ${f.dpi} dpi`);
  }
  r.ok(f.poster.widthPx === REQUIRED_POSTER_PX[0] && f.poster.heightPx === REQUIRED_POSTER_PX[1], 'formate', 'Poster A2 mit Anschnitt muss 5031 × 7087 px sein');
  for (const [id, [w, h]] of Object.entries(REQUIRED_SOCIAL_PX)) {
    const e = f.social.find((s) => s.id === id);
    r.ok(e?.widthPx === w && e?.heightPx === h, 'formate', `${id}: ${e?.widthPx}×${e?.heightPx} px, erwartet ${w}×${h}`);
  }
  const reel = f.video.find((v) => v.id === 'reel');
  r.ok(reel?.widthPx === 1080 && reel?.heightPx === 1920 && reel?.fps === 30, 'formate', 'Reel muss 1080 × 1920 bei 30 fps sein');
  const reel45 = f.video.find((v) => v.id === 'reel-45');
  r.ok(reel45?.widthPx === 1080 && reel45?.heightPx === 1350 && reel45?.fps === 30, 'formate', 'Reel 4:5 muss 1080 × 1350 bei 30 fps sein');
  const g = f.socialGuides;
  r.ok(g.verticalConservative.top === 270 && g.verticalConservative.bottom === 672 && g.verticalConservative.left === 120, 'formate', 'konservative Sicherheitszone: oben 270, unten 672, seitlich 120 (A-11)');
  return f;
}

// ---------------------------------------------------------------------------------------------------------------------------------
function checkPack(packsDir, r, reg, dir, { dist }) {
  const packDir = join(packsDir, dir);
  const file = join(packDir, 'pack.json');
  const label = `${dir}/pack.json`;
  const pack = readJson(file, r, 'paket');
  if (!pack || !validateJson(reg, r, 'paket', 'pack', label, pack)) return null;
  r.ok(pack.id === dir, 'paket', `${label}: id "${pack.id}" muss "${dir}" sein`);
  const ids = new Set();
  const targets = new Set();
  const allowed = ROOTS_BY_PROGRAM[String(pack.programId)];
  const byId = new Map();
  for (const f of pack.files) {
    r.ok(!ids.has(f.id), 'paket', `${label}: Datei-ID ${f.id} doppelt`);
    ids.add(f.id);
    byId.set(f.id, f);
    const src = join(packDir, f.src);
    const exists = existsSync(src) && statSync(src).isFile();
    r.ok(exists, 'paket', `${label}: Quelle fehlt: ${f.src}`);
    r.ok(allowed.includes(f.root), 'paket', `${label}: Datei ${f.id} nutzt Wurzel ${f.root}, erlaubt für ${pack.programId ?? 'fonts'}: ${allowed.join(', ')}`);
    const key = `${f.root}:${f.rel}`;
    r.ok(!targets.has(key), 'paket', `${label}: Ziel ${key} doppelt`);
    targets.add(key);
    if (dist && pack.sha256 && exists) r.ok(pack.sha256[f.src] === sha256(readFileSync(src)), 'dist', `${label}: Prüfsumme von ${f.src} stimmt nicht`);
    if (dist) r.ok(Boolean(pack.sha256?.[f.src]), 'dist', `${label}: Prüfsumme für ${f.src} fehlt`);
  }
  const used = new Set();
  const cids = new Set();
  for (const c of pack.components) {
    r.ok(!cids.has(c.id), 'paket', `${label}: Baustein-ID ${c.id} doppelt`);
    cids.add(c.id);
    for (const fid of c.files) {
      r.ok(ids.has(fid), 'paket', `${label}: Baustein ${c.id} nennt unbekannte Datei ${fid}`);
      used.add(fid);
    }
    if (c.fallbackFor) {
      r.ok(c.optional === true && c.defaultSelected !== true, 'paket', `${label}: Ausweichbaustein ${c.id} muss optional und standardmäßig abgewählt sein`);
      r.ok(pack.components.some((x) => x.id === c.fallbackFor), 'paket', `${label}: Ausweichbaustein ${c.id} verweist auf unbekannten Baustein ${c.fallbackFor}`);
    }
  }
  for (const fid of ids) r.ok(used.has(fid), 'paket', `${label}: Datei ${fid} gehört zu keinem Baustein`);
  for (const a of pack.actions) {
    if (a.type === 'installFont') {
      r.ok(byId.get(a.file)?.root === 'userFonts', 'paket', `${label}: installFont ${a.file} braucht eine Datei mit Wurzel userFonts`);
      if (byId.get(a.file) && existsSync(join(packDir, byId.get(a.file).src))) {
        const info = fontInfo(join(packDir, byId.get(a.file).src), r, 'paket');
        if (info) r.ok(a.displayName === `${info.fullName} (TrueType)`, 'paket', `${label}: Anzeigename ${a.displayName} passt nicht zu "${info.fullName} (TrueType)"`);
      }
    }
    if (a.type === 'blenderExtensionInstall') r.ok(pack.programId === 'blender', 'paket', `${label}: blenderExtensionInstall nur im Paket blender`);
  }
  for (const req of pack.requiresPacks) r.ok(existsSync(join(packsDir, req, 'pack.json')), 'paket', `${label}: requiresPacks nennt unbekanntes Paket ${req}`);
  return pack;
}

// ---------------------------------------------------------------------------------------------------------------------------------
function entryText(zip, name) {
  const e = zip.find((x) => x.name === name);
  return e ? e.data.toString('utf8') : null;
}

function checkKrita(packsDir, r, formats) {
  const base = join(packsDir, 'krita', 'templates', 'Cypher');
  const expected = new Map();
  for (const p of formats.print) expected.set(`cypher-${p.id}`, { w: p.widthPx, h: p.heightPx, dpi: 300, layers: 1, vertical: p.guidesMm.vertical.map((g) => (g.at / 25.4) * 300), horizontal: p.guidesMm.horizontal.map((g) => (g.at / 25.4) * 300) });
  expected.set('cypher-poster-a2', { w: formats.poster.widthPx, h: formats.poster.heightPx, dpi: 300, layers: 1, vertical: null, horizontal: null });
  expected.set('cypher-sticker-quadrat', { w: formats.sticker.widthPx, h: formats.sticker.heightPx, dpi: 300, layers: 1, vertical: null, horizontal: null });
  for (const s of formats.social) expected.set(`cypher-${s.id}`, { w: s.widthPx, h: s.heightPx, dpi: 72, layers: 2, vertical: s.guidesPx.vertical.map((g) => g.at), horizontal: s.guidesPx.horizontal.map((g) => g.at) });
  r.ok(existsSync(join(base, '.directory')), 'krita', 'templates/Cypher/.directory fehlt');
  for (const [stem, exp] of expected) {
    const kra = join(base, '.source', `${stem}.kra`);
    if (!r.ok(existsSync(kra), 'krita', `${stem}.kra fehlt`)) continue;
    let zip;
    try {
      zip = readZip(readFileSync(kra));
    } catch (e) {
      r.ok(false, 'krita', `${stem}.kra: ${e.message}`);
      continue;
    }
    r.ok(zip[0]?.name === 'mimetype' && zip[0].method === 0 && zip[0].data.toString() === 'application/x-krita', 'krita', `${stem}.kra: mimetype muss der erste, unkomprimierte Eintrag "application/x-krita" sein`);
    const main = entryText(zip, 'maindoc.xml');
    if (!r.ok(main !== null, 'krita', `${stem}.kra: maindoc.xml fehlt`)) continue;
    const doc = parseXml(main);
    const img = findAll(doc, 'IMAGE')[0];
    r.ok(Number(img.attrs.width) === exp.w && Number(img.attrs.height) === exp.h, 'krita', `${stem}.kra: ${img.attrs.width}×${img.attrs.height} px, erwartet ${exp.w}×${exp.h}`);
    r.ok(Number(img.attrs['x-res']) === exp.dpi && Number(img.attrs['y-res']) === exp.dpi, 'krita', `${stem}.kra: Auflösung ${img.attrs['x-res']} dpi, erwartet ${exp.dpi}`);
    r.ok(img.attrs.colorspacename === 'RGBA', 'krita', `${stem}.kra: Farbraum ${img.attrs.colorspacename}`);
    const layers = findAll(doc, 'layer');
    r.ok(layers.length === exp.layers, 'krita', `${stem}.kra: ${layers.length} Ebenen, erwartet ${exp.layers}`);
    const motiv = layers.find((l) => l.attrs.name === 'Motiv');
    r.ok(Boolean(motiv) && motiv.attrs.locked === '0' && motiv.attrs.visible === '1', 'krita', `${stem}.kra: Ebene "Motiv" fehlt oder ist gesperrt/unsichtbar`);
    if (exp.layers === 2) {
      const zone = layers.find((l) => l.attrs.name.startsWith('Sicherheitszonen'));
      r.ok(Boolean(zone) && zone.attrs.locked === '1', 'krita', `${stem}.kra: Ebene der Sicherheitszonen fehlt oder ist nicht gesperrt`);
    }
    // Hilfslinien: Krita speichert sie in Punkten (1/72 Zoll)
    const pt = 72 / exp.dpi;
    const guides = findAll(doc, 'guides')[0];
    const read = (tag) => (guides ? findAll(guides, tag)[0]?.children.map((c) => Number(c.attrs.value)) ?? [] : []);
    if (exp.vertical) {
      const got = read('verticalGuides').sort((a, b) => a - b);
      const want = exp.vertical.map((v) => v * pt).sort((a, b) => a - b);
      r.ok(got.length === want.length && got.every((v, i) => Math.abs(v - want[i]) < 0.05), 'krita', `${stem}.kra: senkrechte Hilfslinien ${got.map((v) => v.toFixed(2))} statt ${want.map((v) => v.toFixed(2))} pt`);
    }
    if (exp.horizontal) {
      const got = read('horizontalGuides').sort((a, b) => a - b);
      const want = exp.horizontal.map((v) => v * pt).sort((a, b) => a - b);
      r.ok(got.length === want.length && got.every((v, i) => Math.abs(v - want[i]) < 0.05), 'krita', `${stem}.kra: waagrechte Hilfslinien ${got.map((v) => v.toFixed(2))} statt ${want.map((v) => v.toFixed(2))} pt`);
    }
    const png = zip.find((e) => e.name === 'mergedimage.png');
    if (r.ok(Boolean(png), 'krita', `${stem}.kra: mergedimage.png fehlt`)) {
      const info = readPngInfo(png.data);
      r.ok(info.width === exp.w && info.height === exp.h, 'krita', `${stem}.kra: mergedimage.png ${info.width}×${info.height}`);
    }
    const desktop = join(base, `${stem}.desktop`);
    if (r.ok(existsSync(desktop), 'krita', `${stem}.desktop fehlt`)) {
      const text = readFileSync(desktop, 'utf8');
      r.ok(text.includes('Type=Link') && text.includes(`URL=.source/${stem}.kra`) && text.includes(`Icon=.icon/${stem}.png`), 'krita', `${stem}.desktop: Type/URL/Icon falsch`);
      r.ok(/^Name=.+$/m.test(text), 'krita', `${stem}.desktop: Name fehlt`);
    }
    r.ok(existsSync(join(base, '.icon', `${stem}.png`)), 'krita', `${stem}: Symbol .icon/${stem}.png fehlt`);
  }
  for (const f of readdirSync(join(base, '.source'))) r.ok(f.endsWith('.kra') && expected.has(f.replace(/\.kra$/, '')), 'krita', `.source/${f} ist unbekannt (Sicherungsdatei?)`);
}

function checkKpl(packsDir, r, brand) {
  for (const p of brand.palettes) {
    const file = join(packsDir, 'shared', 'palettes', `${p.id}.kpl`);
    if (!r.ok(existsSync(file), 'paletten', `${p.id}.kpl fehlt`)) continue;
    const zip = readZip(readFileSync(file));
    r.ok(zip[0]?.name === 'mimetype' && zip[0].method === 0 && zip[0].data.toString() === 'application/x-krita-palette', 'paletten', `${p.id}.kpl: mimetype falsch`);
    const doc = parseXml(entryText(zip, 'colorset.xml'));
    const entries = findAll(doc, 'ColorSetEntry');
    r.ok(entries.length === p.colors.length, 'paletten', `${p.id}.kpl: ${entries.length} Einträge statt ${p.colors.length}`);
    entries.forEach((e, i) => {
      const c = findAll(e, 'RGB')[0];
      const hex = `#${['r', 'g', 'b'].map((k) => Math.round(Number(c.attrs[k]) * 255).toString(16).padStart(2, '0')).join('')}`;
      const want = p.colors[i];
      r.ok(Boolean(want) && hex === want.hex && e.attrs.name === want.name, 'paletten', `${p.id}.kpl: Eintrag ${i} (${e.attrs.name} ${hex}) passt nicht zur Palette in brand.json`);
    });
    const gpl = readFileSync(join(packsDir, 'shared', 'palettes', `${p.id}.gpl`), 'utf8').split('\n');
    r.ok(gpl[0] === 'GIMP Palette' && gpl[1] === `Name: ${p.name}`, 'paletten', `${p.id}.gpl: Kopf falsch`);
    r.ok(gpl.filter((l) => /^\s*\d+\s+\d+\s+\d+\t/.test(l)).length === p.colors.length, 'paletten', `${p.id}.gpl: Farbzahl falsch`);
  }
}

function checkBundles(packsDir, r) {
  for (const spec of bundles.BUNDLES) {
    const file = join(packsDir, 'krita', 'bundles', spec.file);
    if (!r.ok(existsSync(file), 'bundle', `${spec.file} fehlt`)) continue;
    const zip = readZip(readFileSync(file));
    r.ok(zip[0]?.name === 'mimetype' && zip[0].method === 0 && zip[0].data.toString() === 'application/x-krita-resourcebundle', 'bundle', `${spec.file}: mimetype muss der erste, unkomprimierte Eintrag sein`);
    for (const need of ['META-INF/manifest.xml', 'meta.xml', 'preview.png']) r.ok(zip.some((e) => e.name === need), 'bundle', `${spec.file}: ${need} fehlt`);
    const manifest = parseXml(entryText(zip, 'META-INF/manifest.xml'));
    const entries = manifest.children.filter((c) => c.attrs['manifest:full-path'] !== '/');
    r.ok(manifest.children[0]?.attrs['manifest:full-path'] === '/' && manifest.children[0].attrs['manifest:media-type'] === 'application/x-krita-resourcebundle', 'bundle', `${spec.file}: erster Manifest-Eintrag muss "/" sein`);
    r.ok(entries.length > 0, 'bundle', `${spec.file}: keine Ressourcen`);
    for (const e of entries) {
      const path = e.attrs['manifest:full-path'];
      const data = zip.find((z) => z.name === path)?.data;
      if (!r.ok(Boolean(data), 'bundle', `${spec.file}: ${path} fehlt im Archiv`)) continue;
      r.ok(createHash('md5').update(data).digest('hex') === e.attrs['manifest:md5sum'], 'bundle', `${spec.file}: md5sum von ${path} stimmt nicht`);
      r.ok(path.startsWith(`${e.attrs['manifest:media-type']}/`), 'bundle', `${spec.file}: ${path} liegt nicht im Ordner des Typs ${e.attrs['manifest:media-type']}`);
    }
    for (const z of zip.filter((x) => /^(palettes|workspaces)\//.test(x.name))) r.ok(entries.some((e) => e.attrs['manifest:full-path'] === z.name), 'bundle', `${spec.file}: ${z.name} fehlt im Manifest`);
    const meta = parseXml(entryText(zip, 'meta.xml'));
    r.ok(Boolean(findAll(meta, 'meta:bundle-version')[0]), 'bundle', `${spec.file}: meta:bundle-version fehlt`);
  }
}

function checkWorkspace(packsDir, r) {
  const dir = join(packsDir, 'krita', 'workspaces');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.kws')) : [];
  r.ok(files.length >= 1, 'arbeitsfläche', 'keine .kws-Datei');
  for (const f of files) {
    const doc = parseXml(readFileSync(join(dir, f), 'utf8'));
    r.ok(doc.name === 'Workspace' && doc.attrs.version === '1' && doc.attrs.name === workspace.WORKSPACE_NAME, 'arbeitsfläche', `${f}: Kopf falsch`);
    const state = Buffer.from(findAll(doc, 'state')[0]?.text.trim() ?? '', 'base64');
    r.ok(state.length > 100 && state.readUInt32BE(0) === 0xff, 'arbeitsfläche', `${f}: Docker-Zustand ist kein QMainWindow-Zustand (Magic 0xFF fehlt)`);
    const image = Buffer.from(findAll(doc, 'image')[0]?.text.trim() ?? '', 'base64');
    r.ok(readPngInfo(image).width === 256, 'arbeitsfläche', `${f}: Vorschaubild kein PNG mit 256 px Breite`);
    r.ok(findAll(doc, 'param').length === 8, 'arbeitsfläche', `${f}: 8 Mixerfarben erwartet`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
function checkInkscape(packsDir, r, formats) {
  const dir = join(packsDir, 'inkscape', 'templates');
  const expected = new Map();
  for (const p of formats.print) expected.set(`cypher-${p.id}.svg`, { w: `${p.widthMm}mm`, h: `${p.heightMm}mm`, vb: `0 0 ${p.widthMm} ${p.heightMm}`, dpi: '300', zones: false, guides: p.guidesMm.vertical.length + p.guidesMm.horizontal.length });
  expected.set('cypher-poster-a2.svg', { w: `${formats.poster.widthMm}mm`, h: `${formats.poster.heightMm}mm`, vb: `0 0 ${formats.poster.widthMm} ${formats.poster.heightMm}`, dpi: '300', zones: false, guides: 9 });
  expected.set('cypher-sticker-quadrat.svg', { w: `${formats.sticker.widthMm}mm`, h: `${formats.sticker.heightMm}mm`, vb: `0 0 ${formats.sticker.widthMm} ${formats.sticker.heightMm}`, dpi: '300', zones: false, guides: 2 });
  for (const s of formats.social) expected.set(`cypher-${s.id}.svg`, { w: String(s.widthPx), h: String(s.heightPx), vb: `0 0 ${s.widthPx} ${s.heightPx}`, dpi: '96', zones: true, guides: s.guidesPx.vertical.length + s.guidesPx.horizontal.length });
  for (const [file, exp] of expected) {
    const p = join(dir, file);
    if (!r.ok(existsSync(p), 'inkscape', `${file} fehlt`)) continue;
    let doc;
    try {
      doc = parseXml(readFileSync(p, 'utf8'));
    } catch (e) {
      r.ok(false, 'inkscape', `${file}: ${e.message}`);
      continue;
    }
    r.ok(doc.name === 'svg' && doc.attrs.width === exp.w && doc.attrs.height === exp.h && doc.attrs.viewBox === exp.vb, 'inkscape', `${file}: Seitengröße ${doc.attrs.width}×${doc.attrs.height} (${doc.attrs.viewBox}), erwartet ${exp.w}×${exp.h} (${exp.vb})`);
    r.ok(doc.attrs['inkscape:export-xdpi'] === exp.dpi && doc.attrs['inkscape:export-ydpi'] === exp.dpi, 'inkscape', `${file}: Export-Hinweis ${exp.dpi} dpi fehlt`);
    const info = findAll(doc, 'inkscape:templateinfo')[0];
    if (r.ok(Boolean(info), 'inkscape', `${file}: inkscape:templateinfo fehlt`)) {
      for (const k of ['name', 'label', 'author', 'shortdesc', 'date', 'keywords', 'category', 'priority']) r.ok(findAll(info, `inkscape:${k}`).length === 1, 'inkscape', `${file}: templateinfo ohne ${k}`);
    }
    const view = findAll(doc, 'sodipodi:namedview')[0];
    r.ok(view?.attrs['inkscape:pageopacity'] === '0', 'inkscape', `${file}: Seitengrund muss transparent sein (pageopacity 0)`);
    const guides = findAll(doc, 'sodipodi:guide');
    r.ok(guides.length === exp.guides, 'inkscape', `${file}: ${guides.length} Hilfslinien, erwartet ${exp.guides}`);
    const height = Number(exp.vb.split(' ')[3]);
    const width = Number(exp.vb.split(' ')[2]);
    for (const g of guides) {
      const [x, y] = g.attrs.position.split(',').map(Number);
      r.ok(x >= 0 && x <= width && y >= 0 && y <= height, 'inkscape', `${file}: Hilfslinie ${g.attrs.id} liegt außerhalb der Seite`);
    }
    const layers = findAll(doc, 'g').filter((g) => g.attrs['inkscape:groupmode'] === 'layer');
    r.ok(layers.some((l) => l.attrs['inkscape:label'] === 'Motiv'), 'inkscape', `${file}: Ebene "Motiv" fehlt`);
    const zone = layers.find((l) => l.attrs['inkscape:label']?.startsWith('Sicherheitszonen'));
    if (exp.zones) {
      r.ok(Boolean(zone) && zone.attrs['sodipodi:insensitive'] === 'true' && /display:\s*none/.test(zone.attrs.style ?? ''), 'inkscape', `${file}: Ebene der Sicherheitszonen muss gesperrt und ausgeblendet (nicht exportiert) sein`);
    } else r.ok(!zone, 'inkscape', `${file}: unerwartete Ebene der Sicherheitszonen`);
  }
  for (const f of existsSync(dir) ? readdirSync(dir) : []) r.ok(expected.has(f), 'inkscape', `templates/${f} ist unbekannt`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
function checkKdenlive(packsDir, r, formats) {
  const fontNames = fontNameSets(packsDir, r);
  const dir = join(packsDir, 'kdenlive', 'titles');
  const files = existsSync(dir) ? readdirSync(dir) : [];
  r.ok(files.length === 8, 'kdenlive', `${files.length} Titelvorlagen, erwartet 8 (4 Stile × 9:16 und 4:5)`);
  for (const f of files) {
    let doc;
    try {
      doc = parseXml(readFileSync(join(dir, f), 'utf8'));
    } catch (e) {
      r.ok(false, 'kdenlive', `${f}: ${e.message}`);
      continue;
    }
    const size = f.endsWith('9x16.kdenlivetitle') ? [1080, 1920] : [1080, 1350];
    r.ok(doc.name === 'kdenlivetitle' && Number(doc.attrs.width) === size[0] && Number(doc.attrs.height) === size[1], 'kdenlive', `${f}: Größe ${doc.attrs.width}×${doc.attrs.height}, erwartet ${size.join('×')}`);
    r.ok(Number(doc.attrs.out) > 0, 'kdenlive', `${f}: out fehlt`);
    r.ok(findAll(doc, 'startviewport').length === 1 && findAll(doc, 'endviewport').length === 1 && findAll(doc, 'background').length === 1, 'kdenlive', `${f}: Viewport/Hintergrund fehlen`);
    const zs = new Set();
    for (const item of doc.children.filter((c) => c.name === 'item')) {
      r.ok(['QGraphicsTextItem', 'QGraphicsRectItem'].includes(item.attrs.type), 'kdenlive', `${f}: unbekannter Elementtyp ${item.attrs.type}`);
      r.ok(!zs.has(item.attrs['z-index']), 'kdenlive', `${f}: z-index ${item.attrs['z-index']} doppelt`);
      zs.add(item.attrs['z-index']);
      const content = findAll(item, 'content')[0];
      const pos = findAll(item, 'position')[0];
      r.ok(Boolean(content && pos && findAll(pos, 'transform').length === 1), 'kdenlive', `${f}: Element ohne position/transform/content`);
      if (item.attrs.type === 'QGraphicsTextItem') {
        r.ok(fontNames.has(content.attrs.font), 'kdenlive', `${f}: Schrift "${content.attrs.font}" ist keine statische Cypher-Schrift (${[...fontNames].join(', ')})`);
        r.ok(Number(content.attrs['font-pixel-size']) >= 28, 'kdenlive', `${f}: Schrift unter 28 px`);
        r.ok(/^\d+,\d+,\d+,\d+$/.test(content.attrs['font-color']), 'kdenlive', `${f}: font-color falsch`);
        const x = Number(pos.attrs.x);
        const w = Number(content.attrs['box-width']);
        r.ok(x >= 0 && x + w <= size[0], 'kdenlive', `${f}: Textfeld ragt seitlich aus dem Bild`);
      } else r.ok(/^0,0,\d+,\d+$/.test(content.attrs.rect), 'kdenlive', `${f}: rect falsch`);
    }
  }
  const profDir = join(packsDir, 'kdenlive', 'profiles');
  const want = { cypher_reel_1080x1920_30: ['1080', '1920', '9', '16'], cypher_reel_1080x1350_30: ['1080', '1350', '4', '5'] };
  const have = existsSync(profDir) ? readdirSync(profDir) : [];
  r.ok(JSON.stringify(sorted(have)) === JSON.stringify(sorted(Object.keys(want))), 'kdenlive', `Profile: ${have.join(', ')}`);
  for (const [name, [w, h, an, ad]] of Object.entries(want)) {
    if (!existsSync(join(profDir, name))) continue;
    const text = readFileSync(join(profDir, name), 'utf8');
    r.ok(!text.includes('\r'), 'kdenlive', `${name}: Zeilenenden müssen LF sein`);
    const kv = Object.fromEntries(text.split('\n').filter(Boolean).map((l) => l.split('=')));
    r.ok(kv.width === w && kv.height === h && kv.frame_rate_num === '30' && kv.frame_rate_den === '1' && kv.progressive === '1', 'kdenlive', `${name}: Maße/Bildrate falsch`);
    r.ok(kv.display_aspect_num === an && kv.display_aspect_den === ad && kv.sample_aspect_num === '1' && kv.sample_aspect_den === '1', 'kdenlive', `${name}: Seitenverhältnis falsch`);
    r.ok(kv.colorspace === '709' && Boolean(kv.description), 'kdenlive', `${name}: colorspace/description fehlen`);
    r.ok(Number(w) * Number(ad) === Number(h) * Number(an), 'kdenlive', `${name}: Seitenverhältnis passt nicht zu den Pixeln`);
  }
  const proj = join(packsDir, 'projects', 'reel-kdenlive', 'files', 'reel.kdenlive');
  if (r.ok(existsSync(proj), 'kdenlive', 'reel.kdenlive fehlt')) {
    const text = readFileSync(proj, 'utf8');
    const doc = parseXml(text);
    const prof = findAll(doc, 'profile')[0];
    r.ok(prof.attrs.width === '1080' && prof.attrs.height === '1920' && prof.attrs.frame_rate_num === '30' && prof.attrs.frame_rate_den === '1', 'kdenlive', 'reel.kdenlive: Profil muss 1080 × 1920 bei 30 fps sein');
    r.ok(!/\/home\/|[A-Za-z]:\\|\/Users\//.test(text), 'kdenlive', 'reel.kdenlive enthält rechnerspezifische Pfade');
    const names = findAll(doc, 'property').filter((p) => p.attrs.name === 'kdenlive:track_name').map((p) => p.text);
    r.ok(JSON.stringify(names) === JSON.stringify(['Musik', 'Originalton', 'Video', 'Titel', 'Untertitel']), 'kdenlive', `reel.kdenlive: Spurnamen ${names.join(', ')}`);
    r.ok(formats.video.some((v) => v.id === 'reel'), 'kdenlive', 'formats.json ohne Reel');
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
function rectInside(a, b) {
  return a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
}

function checkSocial(packsDir, r, reg, brand) {
  const dir = join(packsDir, 'social');
  const families = new Set(brand?.fonts.map((f) => f.family) ?? []);
  for (const id of existsSync(dir) ? readdirSync(dir) : []) {
    const file = join(dir, id, 'template.json');
    const t = readJson(file, r, 'social');
    if (!t || !validateJson(reg, r, 'social', 'social', `social/${id}/template.json`, t)) continue;
    r.ok(t.id === id, 'social', `social/${id}: id muss dem Ordnernamen entsprechen`);
    const preview = join(dir, id, t.preview);
    if (r.ok(existsSync(preview), 'social', `social/${id}: ${t.preview} fehlt`)) {
      const info = readPngInfo(readFileSync(preview));
      r.ok(Math.abs(info.width / info.height - t.size.width / t.size.height) < 0.01, 'social', `social/${id}: Vorschau hat ein anderes Seitenverhältnis`);
    }
    const ids = new Set();
    const slots = new Set();
    t.layers.forEach((l) => {
      r.ok(!ids.has(l.id), 'social', `social/${id}: Ebenen-ID ${l.id} doppelt`);
      ids.add(l.id);
      if ('slot' in l) {
        r.ok(!slots.has(l.slot), 'social', `social/${id}: Platzhalter ${l.slot} doppelt`);
        slots.add(l.slot);
      }
    });
    const bgColor = t.background.type === 'solid' ? t.background.color : null;
    t.layers.forEach((l, i) => {
      if (l.type === 'text' || l.type === 'logo') {
        r.ok(t.safeZones.some((z) => rectInside(l.rect, z)), 'social', `social/${id}: ${l.id} liegt nicht in der Sicherheitszone`);
      }
      if (l.type === 'text') {
        r.ok(families.has(l.fontFamily), 'social', `social/${id}: Schrift ${l.fontFamily} steht nicht in brand.json`);
        r.ok(l.minSizePx >= 28 && l.minSizePx <= l.sizePx, 'social', `social/${id}: ${l.id}: kleinste Schrift ${l.minSizePx} px (mindestens 28, höchstens ${l.sizePx})`);
        // Grund unter dem Text: oberstes Rechteck, das das Textfeld ganz enthält, sonst der Seitengrund
        let ground = bgColor;
        for (let j = 0; j < i; j++) {
          const s = t.layers[j];
          if (s.type === 'shape' && s.fill.type === 'solid' && rectInside(l.rect, s.rect)) ground = s.fill.color;
        }
        if (ground) r.ok(contrast(l.color, ground) >= 4.5, 'social', `social/${id}: ${l.id}: Kontrast ${contrast(l.color, ground).toFixed(2)}:1 zwischen ${l.color} und ${ground} (mindestens 4,5:1)`);
      }
      if (l.type === 'logo') r.ok(Boolean(brand?.logos.some((x) => x.variant === l.variant)), 'social', `social/${id}: Logo-Variante ${l.variant} fehlt in brand.json`);
      if (l.type === 'image' || l.type === 'shape') r.ok(l.rect.x >= 0 && l.rect.y >= 0 && l.rect.x + l.rect.width <= t.size.width && l.rect.y + l.rect.height <= t.size.height, 'social', `social/${id}: ${l.id} ragt aus dem Bild`);
    });
    if (t.format === 'reelCover') r.ok(t.gridCrop?.y === 240 && t.gridCrop?.height === 1440, 'social', `social/${id}: gridCrop muss y 240, Höhe 1440 sein (SOCIAL_GUIDES)`);
    if (t.format === 'story' || t.format === 'reelCover') r.ok(t.safeZones.length >= 1, 'social', `social/${id}: Sicherheitszone fehlt`);
  }
}

function checkProjects(packsDir, r, reg, formats) {
  const dir = join(packsDir, 'projects');
  for (const id of existsSync(dir) ? readdirSync(dir) : []) {
    const file = join(dir, id, 'template.json');
    const t = readJson(file, r, 'projekte');
    if (!t || !validateJson(reg, r, 'projekte', 'template', `projects/${id}/template.json`, t)) continue;
    r.ok(t.id === id, 'projekte', `projects/${id}: id muss dem Ordnernamen entsprechen`);
    if (r.ok(existsSync(join(dir, id, t.preview)), 'projekte', `projects/${id}: ${t.preview} fehlt`)) {
      const info = readPngInfo(readFileSync(join(dir, id, t.preview)));
      r.ok(info.width >= 200 && info.height >= 200, 'projekte', `projects/${id}: Vorschau ${info.width}×${info.height} ist zu klein`);
      // Programmvorlagen zeigen eine Format-Karte (3:4); Social-Einträge die Vorlage selbst im Seitenverhältnis des Formats
      if (t.target === 'social') r.ok(Math.abs(info.width / info.height - t.format.widthPx / t.format.heightPx) < 0.01, 'projekte', `projects/${id}: Seitenverhältnis der Vorschau ${info.width}×${info.height} passt nicht zum Format`);
    }
    if (t.target === 'program') {
      const fp = join(dir, id, t.file);
      if (!r.ok(existsSync(fp), 'projekte', `projects/${id}: Vorlagendatei ${t.file} fehlt`)) continue;
      r.ok(t.file.endsWith(t.fileExtension), 'projekte', `projects/${id}: file passt nicht zu fileExtension ${t.fileExtension}`);
      const progExt = { krita: '.kra', inkscape: '.svg', kdenlive: '.kdenlive', blender: '.blend' };
      r.ok(progExt[t.programId] === t.fileExtension, 'projekte', `projects/${id}: Endung ${t.fileExtension} passt nicht zu ${t.programId}`);
      if (t.fileExtension === '.kra') {
        const zip = readZip(readFileSync(fp));
        const img = findAll(parseXml(entryText(zip, 'maindoc.xml')), 'IMAGE')[0];
        r.ok(Number(img.attrs.width) === t.format.widthPx && Number(img.attrs.height) === t.format.heightPx, 'projekte', `projects/${id}: Dateimaße ${img.attrs.width}×${img.attrs.height} passen nicht zum Format`);
        if (t.format.dpi) r.ok(Number(img.attrs['x-res']) === t.format.dpi, 'projekte', `projects/${id}: Auflösung passt nicht`);
      }
      if (t.fileExtension === '.svg') {
        const doc = parseXml(readFileSync(fp, 'utf8'));
        const w = doc.attrs.width;
        if (t.format.widthMm) r.ok(w === `${t.format.widthMm}mm` && doc.attrs.height === `${t.format.heightMm}mm`, 'projekte', `projects/${id}: SVG-Größe ${w} × ${doc.attrs.height} passt nicht zum Format`);
        else r.ok(w === String(t.format.widthPx) && doc.attrs.height === String(t.format.heightPx), 'projekte', `projects/${id}: SVG-Größe ${w} × ${doc.attrs.height} passt nicht zum Format`);
      }
    }
    if (t.target === 'social') r.ok(existsSync(join(packsDir, 'social', t.socialTemplateId, 'template.json')), 'projekte', `projects/${id}: Social-Vorlage ${t.socialTemplateId} fehlt`);
    if (t.target === 'mockup') r.ok(existsSync(join(packsDir, 'mockups', t.mockupTemplateId, 'template.json')), 'projekte', `projects/${id}: Mockup-Vorlage ${t.mockupTemplateId} fehlt`);
    if (t.printProfileId) r.ok(formats.print.some((p) => p.profileId === t.printProfileId), 'projekte', `projects/${id}: unbekanntes Druckprofil ${t.printProfileId}`);
    if (t.format.widthMm) r.ok(t.format.widthPx === Math.round((t.format.widthMm / 25.4) * (t.format.dpi ?? 300)), 'projekte', `projects/${id}: Pixel passen nicht zu mm`);
  }
}

function checkMockups(packsDir, r, reg) {
  const dir = join(packsDir, 'mockups');
  for (const id of existsSync(dir) ? readdirSync(dir) : []) {
    const file = join(dir, id, 'template.json');
    if (!existsSync(file)) continue;
    const t = readJson(file, r, 'mockup');
    if (!t || !validateJson(reg, r, 'mockup', 'mockup', `mockups/${id}/template.json`, t)) continue;
    r.ok(t.id === id, 'mockup', `mockups/${id}: id muss dem Ordnernamen entsprechen`);
    for (const v of t.variants) for (const [k, p] of Object.entries(v.layers)) if (p) r.ok(existsSync(join(dir, id, p)), 'mockup', `mockups/${id}: ${k}-Datei ${p} fehlt`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
/**
 * @param {{ packsDir?: string, dist?: boolean, skipGenerated?: boolean }} [opts]
 * @returns {{ errors: string[], warnings: string[], checks: number }}
 */
export function validate(opts = {}) {
  const packsDir = opts.packsDir ?? DEFAULT_PACKS_DIR;
  const r = new Report();
  const reg = loadSchemas(packsDir, r);
  const brand = checkBrand(packsDir, r, reg);
  const formats = checkFormats(packsDir, r);
  checkFonts(packsDir, r);
  if (brand) checkKpl(packsDir, r, brand);
  if (formats) {
    checkKrita(packsDir, r, formats);
    checkInkscape(packsDir, r, formats);
    checkKdenlive(packsDir, r, formats);
  }
  checkBundles(packsDir, r);
  checkWorkspace(packsDir, r);
  checkSocial(packsDir, r, reg, brand);
  if (formats) checkProjects(packsDir, r, reg, formats);
  {
    // Mockup-Vorlagen liefert Team C2; Befunde sind Hinweise, bis es sie behoben hat (mit strict: Fehler)
    const other = opts.strict ? r : new Report();
    checkMockups(packsDir, other, reg);
    if (!opts.strict) for (const e of other.errors) r.warn('fremdes-mockup', e);
  }

  /** @type {string[]} */
  const packDirs = readdirSync(packsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(packsDir, d.name, 'pack.json'))).map((d) => d.name);
  for (const need of OWN_PACKS) r.ok(packDirs.includes(need), 'paket', `Paket ${need} fehlt`);
  for (const d of packDirs) {
    if (OWN_PACKS.includes(d)) checkPack(packsDir, r, reg, d, { dist: false });
    else {
      // Pakete anderer Teams (blender: Team C2): Befunde nur als Hinweis, bis das Team sein Paket abgeschlossen hat
      const other = new Report();
      checkPack(packsDir, other, reg, d, { dist: false });
      if (opts.strict) for (const e of other.errors) r.errors.push(e);
      else for (const e of other.errors) r.warn('fremdes-paket', e);
    }
  }

  if (!opts.skipGenerated) {
    compareGenerated(r, packsDir, 'erzeugt', palettes.renderAll());
    compareGenerated(r, packsDir, 'erzeugt', bundles.BUNDLES.map((s) => ({ file: `krita/bundles/${s.file}`, data: bundles.renderBundle(s) })));
    compareGenerated(r, packsDir, 'erzeugt', [{ file: 'krita/workspaces/cypher-druck.kws', data: workspace.renderWorkspace() }]);
    compareGenerated(r, packsDir, 'erzeugt', inkscape.renderAll().map((f) => ({ file: `inkscape/templates/${f.file}`, data: f.text })));
    compareGenerated(r, packsDir, 'erzeugt', titles.renderAll().map((f) => ({ file: `kdenlive/titles/${f.file}`, data: f.text })));
    compareGenerated(r, packsDir, 'erzeugt', [{ file: 'projects/reel-kdenlive/files/reel.kdenlive', data: project.renderProject() }]);
    compareGenerated(r, packsDir, 'erzeugt', social.renderAll().map((f) => ({ file: `social/${f.file}`, data: f.text })));
    const tpl = [];
    for (const t of templates.allTemplates()) {
      tpl.push({ file: `projects/${t.id}/template.json`, data: `${JSON.stringify(t.template, null, 2)}\n` });
      if (t.copy) tpl.push({ file: `projects/${t.id}/${t.copy.to}`, data: readFileSync(t.copy.from) });
    }
    compareGenerated(r, packsDir, 'erzeugt', tpl);
    compareGenerated(r, packsDir, 'erzeugt', packsGen.renderAll().map((f) => ({ file: f.file, data: f.text })));
    // Verzeichnisse, die vollständig von Generatoren stammen: keine Fremddateien
    const known = new Set();
    for (const f of inkscape.renderAll()) known.add(`inkscape/templates/${f.file}`);
    for (const f of titles.renderAll()) known.add(`kdenlive/titles/${f.file}`);
    unknownFiles(r, packsDir, 'erzeugt', 'inkscape/templates', known);
    unknownFiles(r, packsDir, 'erzeugt', 'kdenlive/titles', known);
  }

  if (opts.dist) {
    const dist = join(packsDir, 'dist');
    if (r.ok(existsSync(dist), 'dist', 'packs/dist fehlt (build.mjs ausführen)')) {
      const distDirs = readdirSync(dist, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dist, d.name, 'pack.json'))).map((d) => d.name);
      for (const need of OWN_PACKS) r.ok(distDirs.includes(need), 'dist', `dist/${need} fehlt`);
      for (const d of distDirs) checkPack(dist, r, reg, d, { dist: true });
    }
  }
  return { errors: r.errors, warnings: r.warnings, checks: r.checks };
}

function main(argv) {
  const res = validate({ dist: argv.includes('--dist'), strict: argv.includes('--strict') });
  for (const w of res.warnings) console.warn(`HINWEIS ${w}`);
  for (const e of res.errors) console.error(`FEHLER ${e}`);
  console.log(`${res.checks} Prüfungen, ${res.errors.length} Fehler, ${res.warnings.length} Hinweise`);
  return res.errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
