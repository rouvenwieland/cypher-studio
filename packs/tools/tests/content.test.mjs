// Inhaltstests mit unabhängig notierten Sollwerten (ARCHITEKTUR 4.7/4.8, CONCEPT 6.3, DESIGN.md, vorgaben.md): Pixelmaße und dpi der Vorlagen,
// Markenfarben, Textilfarben, Paletten, Schriftpaket, Videoprofile. Die Zahlen stehen hier absichtlich noch einmal im Klartext.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PACKS_DIR } from '../gen-palettes.mjs';
import { readPngInfo } from '../lib/png.mjs';
import { readFontInfo } from '../lib/ttf.mjs';
import { findAll, parseXml } from '../lib/xml.mjs';
import { readZip } from '../lib/zip.mjs';

const p = (...a) => join(PACKS_DIR, ...a);
const json = (...a) => JSON.parse(readFileSync(p(...a), 'utf8'));
const mmToPx = (mm, dpi) => Math.round((mm / 25.4) * dpi);

/** [Breite px, Höhe px, dpi, Breite mm | null, Höhe mm | null] je Vorlage. */
const EXPECTED = {
  'shirt-front': [3898, 5315, 300, 330, 450], // Creator 2.0 (ARCHITEKTUR 4.7)
  'shirt-back': [3898, 5315, 300, 330, 450],
  'hoodie-front': [3898, 3307, 300, 330, 280], // Cruiser 2.0
  'hoodie-back': [3898, 4606, 300, 330, 390],
  'poster-a2': [5031, 7087, 300, 426, 600], // 420 × 594 mm plus 3 mm Anschnitt
  'sticker-quadrat': [945, 945, 300, 80, 80],
  post: [1080, 1350, 72, null, null],
  story: [1080, 1920, 72, null, null],
  'reel-cover': [1080, 1920, 72, null, null],
};

test('Pixelmaße: Rechnung mm → px bei 300 dpi', () => {
  assert.equal(mmToPx(330, 300), 3898);
  assert.equal(mmToPx(450, 300), 5315);
  assert.equal(mmToPx(280, 300), 3307);
  assert.equal(mmToPx(390, 300), 4606);
  assert.equal(mmToPx(426, 300), 5031);
  assert.equal(mmToPx(600, 300), 7087);
});

test('Krita-Vorlagen: Pixelmaße, Auflösung, Farbraum, transparente Ebene, Vorschaubild in Originalgröße', () => {
  for (const [id, [w, h, dpi]] of Object.entries(EXPECTED)) {
    const zip = readZip(readFileSync(p('krita', 'templates', 'Cypher', '.source', `cypher-${id}.kra`)));
    const img = findAll(parseXml(zip.find((e) => e.name === 'maindoc.xml').data.toString()), 'IMAGE')[0];
    assert.deepEqual([Number(img.attrs.width), Number(img.attrs.height)], [w, h], id);
    assert.deepEqual([Number(img.attrs['x-res']), Number(img.attrs['y-res'])], [dpi, dpi], `${id}: dpi`);
    assert.equal(img.attrs.colorspacename, 'RGBA');
    assert.match(img.attrs.profile, /sRGB/);
    const merged = readPngInfo(zip.find((e) => e.name === 'mergedimage.png').data);
    assert.deepEqual([merged.width, merged.height], [w, h], `${id}: mergedimage`);
    assert.equal(merged.hasAlpha, true, `${id}: transparenter Grund`);
    assert.ok(zip.find((e) => e.name === 'preview.png'), `${id}: preview.png`);
  }
});

test('Krita: Druckvorlagen haben genau eine Ebene "Motiv", Social-Vorlagen zusätzlich eine gesperrte Zonenebene', () => {
  for (const id of Object.keys(EXPECTED)) {
    const zip = readZip(readFileSync(p('krita', 'templates', 'Cypher', '.source', `cypher-${id}.kra`)));
    const layers = findAll(parseXml(zip.find((e) => e.name === 'maindoc.xml').data.toString()), 'layer');
    const social = ['post', 'story', 'reel-cover'].includes(id);
    assert.equal(layers.length, social ? 2 : 1, id);
    assert.ok(layers.some((l) => l.attrs.name === 'Motiv' && l.attrs.locked === '0'));
    if (social) assert.ok(layers.some((l) => l.attrs.name.startsWith('Sicherheitszonen') && l.attrs.locked === '1'));
  }
});

test('Inkscape-Vorlagen: Seite in mm bzw. px, 300 dpi Export-Hinweis, Pixelmaße rechnerisch exakt', () => {
  for (const [id, [w, h, dpi, wmm, hmm]] of Object.entries(EXPECTED)) {
    const doc = parseXml(readFileSync(p('inkscape', 'templates', `cypher-${id}.svg`), 'utf8'));
    if (wmm) {
      assert.equal(doc.attrs.width, `${wmm}mm`, id);
      assert.equal(doc.attrs.height, `${hmm}mm`, id);
      assert.equal(doc.attrs['inkscape:export-xdpi'], '300');
      assert.equal(mmToPx(wmm, 300), w);
      assert.equal(mmToPx(hmm, 300), h);
    } else {
      assert.deepEqual([Number(doc.attrs.width), Number(doc.attrs.height)], [w, h], id);
      assert.equal(doc.attrs['inkscape:export-xdpi'], '96');
    }
    assert.equal(findAll(doc, 'sodipodi:namedview')[0].attrs['inkscape:pageopacity'], '0');
    assert.equal(dpi === 300 ? 300 : 72, dpi);
  }
});

test('Marke: 17 Farben der Palette in der festgelegten Reihenfolge (CONCEPT 6.3)', () => {
  const brand = json('shared', 'brand', 'brand.json');
  const want = ['#0d0d0d', '#efeee9', '#ff4f12', '#e4f531', '#00d4d8', '#0b0b0a', '#1f2bd0', '#f3f4f7', '#c9a03f', '#a47c2a', '#0d0a05', '#141210', '#f2efe8', '#8c8a86', '#1d2738', '#cdbb9a', '#efe4cc'];
  assert.deepEqual(brand.palettes.find((x) => x.id === 'cypher-kollektionen').colors.map((c) => c.hex), want);
  assert.deepEqual(brand.collections.map((c) => [c.id, c.hex]), [['rauschen', '#0b0b0a'], ['mittelwelle', '#1f2bd0'], ['gold', '#c9a03f']]);
});

test('Marke: Textilfarben nach A-16 / ARCHITEKTUR 4.8', () => {
  const g = Object.fromEntries(json('shared', 'brand', 'brand.json').garmentColors.map((x) => [x.id, x]));
  const want = {
    schwarz: ['#141210', '#201e1f', 'Black', false, true],
    weiss: ['#f2efe8', '#ffffff', 'White', false, false],
    'grau-meliert': ['#8c8a86', '#818381', 'Mid Heather Grey', true, true],
    navy: ['#1d2738', '#2f354a', 'French Navy', false, true],
    sand: ['#cdbb9a', '#d5c9bc', 'Desert Dust', false, true],
    creme: ['#efe4cc', '#fcf0dc', 'Natural Raw', false, true],
  };
  for (const [id, [hex, textile, name, heather, underbase]] of Object.entries(want)) {
    assert.deepEqual([g[id].hex, g[id].textileHex, g[id].providerColorName, g[id].heather, g[id].underbase], [hex, textile, name, heather, underbase], id);
  }
  const channels = Object.fromEntries(json('shared', 'brand', 'brand.json').channels.map((c) => [c.id, c]));
  assert.equal(channels.studio.surface, '#00d4d8');
  assert.equal(channels.studio.deep, '#00676b');
  assert.equal(channels.news.surface, '#ff4f12');
  assert.equal(channels.shop.surface, '#e4f531');
});

test('Paletten: GIMP-Dateien (Inkscape, Krita) und Krita-Palette tragen dieselben 17 Farben mit deutschen Namen', () => {
  const gpl = readFileSync(p('shared', 'palettes', 'cypher-kollektionen.gpl'), 'utf8').split('\n');
  assert.equal(gpl[0], 'GIMP Palette');
  const rows = gpl.filter((l) => /^\s*\d+\s+\d+\s+\d+\t/.test(l)).map((l) => l.trim().split(/\s+/));
  assert.equal(rows.length, 17);
  assert.deepEqual(rows[4].slice(0, 3), ['0', '212', '216']); // Studio-Cyan
  const names = gpl.filter((l) => /^\s*\d+\s+\d+\s+\d+\t/.test(l)).map((l) => l.split('\t')[1]);
  assert.ok(names.includes('Studio-Cyan') && names.includes('Textil Weiß') && names.includes('Gold-Lounge Tiefgold'));
  const kpl = readZip(readFileSync(p('shared', 'palettes', 'cypher-kollektionen.kpl')));
  assert.equal(findAll(parseXml(kpl.find((e) => e.name === 'colorset.xml').data.toString()), 'ColorSetEntry').length, 17);
});

test('Schriftpaket: 20 statische Dateien, Windows-Anzeigenamen, Wurzel userFonts', () => {
  const pack = json('fonts', 'pack.json');
  assert.equal(pack.programId, null);
  assert.equal(pack.files.length, 20);
  assert.ok(pack.files.every((f) => f.root === 'userFonts' && !f.rel.includes('/')));
  assert.equal(pack.actions.length, 20);
  const names = pack.actions.map((a) => a.displayName);
  for (const n of ['Anybody ExtraBold (TrueType)', 'Anybody UltraCondensed Black (TrueType)', 'Atkinson Hyperlegible Next Bold Italic (TrueType)', 'Martian Mono Regular (TrueType)']) assert.ok(names.includes(n), n);
  for (const f of pack.files) {
    const info = readFontInfo(readFileSync(p('fonts', f.src)));
    assert.equal(info.isVariable, false, f.src);
    assert.equal(info.hasReservedFontName, false);
  }
});

test('Kdenlive: Videoprofile 1080 × 1920 und 1080 × 1350 bei 30 fps, Titel in beiden Formaten', () => {
  const read = (n) => Object.fromEntries(readFileSync(p('kdenlive', 'profiles', n), 'utf8').split('\n').filter(Boolean).map((l) => l.split('=')));
  const a = read('cypher_reel_1080x1920_30');
  assert.deepEqual([a.width, a.height, a.frame_rate_num, a.frame_rate_den, a.display_aspect_num, a.display_aspect_den], ['1080', '1920', '30', '1', '9', '16']);
  const b = read('cypher_reel_1080x1350_30');
  assert.deepEqual([b.width, b.height, b.frame_rate_num, b.display_aspect_num, b.display_aspect_den], ['1080', '1350', '30', '4', '5']);
  const titles = readdirSync(p('kdenlive', 'titles'));
  for (const style of ['Bauchbinde', 'Titelkarte', 'Reel-Hook', 'Untertitel-Stil']) {
    assert.ok(titles.includes(`Cypher ${style} 9x16.kdenlivetitle`) && titles.includes(`Cypher ${style} 4x5.kdenlivetitle`), style);
  }
  const proj = parseXml(readFileSync(p('projects', 'reel-kdenlive', 'files', 'reel.kdenlive'), 'utf8'));
  const prof = findAll(proj, 'profile')[0];
  assert.deepEqual([prof.attrs.width, prof.attrs.height, prof.attrs.frame_rate_num], ['1080', '1920', '30']);
});

test('Social-Vorlagen: Maße, Hilfslinien aus SOCIAL_GUIDES, Rasterausschnitt', () => {
  const t = (id) => json('social', id, 'template.json');
  assert.deepEqual(t('drop-ankuendigung').size, { width: 1080, height: 1350 });
  assert.deepEqual(t('drop-ankuendigung-story').size, { width: 1080, height: 1920 });
  assert.deepEqual(t('drop-ankuendigung-story').safeZones, [{ x: 120, y: 270, width: 840, height: 978 }]); // oben 270, unten 672, seitlich 120
  assert.deepEqual(t('reel-cover').gridCrop, { x: 0, y: 240, width: 1080, height: 1440 });
  assert.deepEqual(t('drop-ankuendigung').gridCrop, { x: 34, y: 0, width: 1012, height: 1350 });
  assert.equal(t('reel-cover').format, 'reelCover');
});

test('Projektvorlagen: Liste der mitgelieferten Vorlagen (ARCHITEKTUR 4.5)', () => {
  const ids = readdirSync(p('projects')).sort();
  for (const want of ['shirt-front-krita', 'shirt-front-inkscape', 'hoodie-front-krita', 'hoodie-front-inkscape', 'post-krita', 'story-krita', 'reel-cover-krita', 'poster-a2-inkscape', 'sticker-inkscape', 'reel-kdenlive', 'social-drop-ankuendigung', 'social-motiv-vorstellung', 'social-event-plakat', 'social-reel-cover']) {
    assert.ok(ids.includes(want), want);
  }
  const shirt = json('projects', 'shirt-front-krita', 'template.json');
  assert.deepEqual(shirt.format, { label: '330 × 450 mm', widthPx: 3898, heightPx: 5315, dpi: 300, widthMm: 330, heightMm: 450 });
  assert.equal(shirt.printProfileId, 'shirtigo-tee-front');
  assert.equal(json('projects', 'hoodie-front-krita', 'template.json').printProfileId, 'shirtigo-hoodie-front');
});
