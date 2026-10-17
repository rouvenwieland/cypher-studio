// validate.mjs: der echte Baum ist gültig, und gezielt eingebaute Fehler werden gefunden (Negativtests auf einer Kopie, die nach jedem Test
// in den Ausgangszustand zurückgesetzt wird).
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { PACKS_DIR } from '../gen-palettes.mjs';
import { readZip, writeZip } from '../lib/zip.mjs';
import { validate } from '../validate.mjs';

/** Kopie des Quellbaums ohne dist, node_modules, Arbeitsdateien und die Pakete von Team C2 (blender, mockups). */
let copy;
before(() => {
  copy = mkdtempSync(join(tmpdir(), 'cypher-packs-'));
  cpSync(PACKS_DIR, copy, { recursive: true, filter: (src) => !/[\\/](dist|node_modules|\.work|blender|mockups)([\\/]|$)/.test(src.slice(PACKS_DIR.length)) });
});
after(() => rmSync(copy, { recursive: true, force: true }));

/**
 * Wendet Änderungen an, validiert, stellt alles wieder her und gibt die Fehler zurück.
 * `mutate` bekommt { read, write, edit, editJson, remove, editZip }.
 */
function withMutation(mutate, opts = {}) {
  /** @type {Map<string, Buffer | null>} */
  const originals = new Map();
  const abs = (rel) => join(copy, rel);
  const remember = (rel) => {
    if (!originals.has(rel)) originals.set(rel, existsSync(abs(rel)) ? readFileSync(abs(rel)) : null);
  };
  const api = {
    read: (rel) => readFileSync(abs(rel)),
    write(rel, data) {
      remember(rel);
      mkdirSync(dirname(abs(rel)), { recursive: true });
      writeFileSync(abs(rel), data);
    },
    edit(rel, fn) {
      api.write(rel, fn(readFileSync(abs(rel), 'utf8')));
    },
    editJson(rel, fn) {
      const data = JSON.parse(readFileSync(abs(rel), 'utf8'));
      fn(data);
      api.write(rel, `${JSON.stringify(data, null, 2)}\n`);
    },
    remove(rel) {
      remember(rel);
      rmSync(abs(rel));
    },
    editZip(rel, fn) {
      const entries = readZip(readFileSync(abs(rel))).map((e) => ({ name: e.name, data: e.data, store: e.method === 0 }));
      api.write(rel, writeZip(fn(entries)));
    },
  };
  try {
    mutate(api);
    return validate({ packsDir: copy, ...opts }).errors;
  } finally {
    for (const [rel, data] of originals) {
      if (data === null) rmSync(abs(rel), { force: true });
      else writeFileSync(abs(rel), data);
    }
  }
}
const has = (errors, text) => assert.ok(errors.some((e) => e.includes(text)), `Fehler mit "${text}" erwartet, bekommen:\n${errors.slice(0, 6).join('\n') || '(keine)'}`);

test('der Quellbaum ist gültig (alle Pakete, Vorlagen, Schriften, erzeugte Dateien)', () => {
  const res = validate();
  assert.deepEqual(res.errors, []);
  assert.ok(res.checks > 1500, `nur ${res.checks} Prüfungen`);
});

test('die Kopie ist ebenfalls gültig (Grundlage der Negativtests)', () => {
  assert.deepEqual(validate({ packsDir: copy }).errors, []);
});

test('Palette: geänderte Marken-Farbe fällt bei Paletten und Paketen auf', () => {
  const errors = withMutation((m) => m.editJson('shared/brand/brand.json', (b) => { b.palettes[0].colors[4].hex = '#00d5d8'; }));
  has(errors, '[paletten]');
});

test('Marke: falsche Anzahl Farben, falscher Cyan-Wert, Logo mit Text statt Pfaden', () => {
  has(withMutation((m) => m.editJson('shared/brand/brand.json', (b) => { b.palettes[0].colors.pop(); })), '17 Farben');
  has(withMutation((m) => m.editJson('shared/brand/brand.json', (b) => { b.channels.find((c) => c.id === 'studio').surface = '#00d4d9'; })), 'Studio-Cyan');
  has(withMutation((m) => m.edit('shared/brand/logos/cypher-kollektiv-hell.svg', (s) => s.replace('</svg>', '<text>x</text></svg>'))), 'Text muss zu Pfaden');
});

test('Schriften: falsche Prüfsumme, kaputte Datei, fehlende OFL-Datei', () => {
  has(withMutation((m) => m.write('shared/fonts/martian-mono/static/MartianMono-Bold.ttf', 'kaputt')), 'Prüfsumme stimmt nicht');
  has(withMutation((m) => m.write('shared/fonts/martian-mono/static/MartianMono-Bold.ttf', 'kaputt')), 'keine gültige Schriftdatei');
  has(withMutation((m) => m.remove('shared/fonts/anybody/OFL.txt')), 'OFL.txt');
});

test('Schriften: kursive Datei unter aufrechtem Namen wird erkannt (Upstream-Fehler bei Anybody)', () => {
  has(withMutation((m) => m.write('shared/fonts/anybody/Anybody-Variable.ttf', m.read('shared/fonts/anybody/Anybody-Italic-Variable.ttf'))), 'Schräglage');
});

test('Paket: Pfad mit .., doppeltes Ziel, falsche Wurzel, unbekannte Datei, unbekanntes Paket', () => {
  has(withMutation((m) => m.editJson('krita/pack.json', (p) => { p.files[0].rel = '../außen.bundle'; })), 'pack.schema.json');
  has(withMutation((m) => m.editJson('krita/pack.json', (p) => { p.files[1].rel = p.files[0].rel; })), 'doppelt');
  has(withMutation((m) => m.editJson('krita/pack.json', (p) => { p.files[0].root = 'inkscapeProfile'; })), 'nutzt Wurzel');
  has(withMutation((m) => m.editJson('inkscape/pack.json', (p) => { p.components[0].files.push('gibt-es-nicht'); })), 'unbekannte Datei');
  has(withMutation((m) => m.editJson('kdenlive/pack.json', (p) => { p.requiresPacks = ['gibt-es-nicht']; })), 'unbekanntes Paket');
  has(withMutation((m) => m.editJson('fonts/pack.json', (p) => { p.actions[0].displayName = 'Falsch (TrueType)'; })), 'Anzeigename');
});

test('Paket: Ausweichbaustein muss abgewählt und optional sein', () => {
  has(withMutation((m) => m.editJson('krita/pack.json', (p) => { p.components.find((c) => c.fallbackFor).optional = false; })), 'Ausweichbaustein');
});

test('Krita: falsche Leinwand und ungesperrte Ebene der Sicherheitszonen', () => {
  const kra = (rel, from, to) => (m) => m.editZip(rel, (es) => es.map((e) => (e.name === 'maindoc.xml' ? { ...e, data: e.data.toString().replace(from, to) } : e)));
  has(withMutation(kra('krita/templates/Cypher/.source/cypher-shirt-front.kra', 'width="3898"', 'width="3897"')), '3897');
  has(withMutation(kra('krita/templates/Cypher/.source/cypher-story.kra', 'locked="1"', 'locked="0"')), 'nicht gesperrt');
  has(withMutation(kra('krita/templates/Cypher/.source/cypher-hoodie-back.kra', 'x-res="300"', 'x-res="72"')), 'Auflösung');
});

test('Krita-Bundle: falsche md5sum', () => {
  has(withMutation((m) => m.editZip('krita/bundles/cypher.bundle', (es) => es.map((e) => (e.name === 'META-INF/manifest.xml' ? { ...e, data: e.data.toString().replace(/md5sum="[0-9a-f]{32}"/, 'md5sum="00000000000000000000000000000000"') } : e)))), 'md5sum');
});

test('Inkscape: Seitengröße, Export-Hinweis und sichtbare Sicherheitsebene', () => {
  has(withMutation((m) => m.edit('inkscape/templates/cypher-hoodie-front.svg', (s) => s.replace('height="280mm"', 'height="281mm"'))), 'Seitengröße');
  has(withMutation((m) => m.edit('inkscape/templates/cypher-shirt-front.svg', (s) => s.replaceAll('inkscape:export-xdpi="300"', 'inkscape:export-xdpi="96"'))), 'Export-Hinweis');
  has(withMutation((m) => m.edit('inkscape/templates/cypher-story.svg', (s) => s.replace(' style="display:none"', ''))), 'gesperrt und ausgeblendet');
});

test('Kdenlive: kaputtes XML, falsche Schrift, falsches Profil, Rechnerpfade im Projekt', () => {
  const title = 'kdenlive/titles/Cypher Bauchbinde 9x16.kdenlivetitle';
  has(withMutation((m) => m.edit(title, (s) => s.replace('</kdenlivetitle>', ''))), 'XML Zeile');
  has(withMutation((m) => m.edit(title, (s) => s.replace('Anybody ExtraBold', 'Arial'))), 'keine statische Cypher-Schrift');
  has(withMutation((m) => m.edit('kdenlive/profiles/cypher_reel_1080x1920_30', (s) => s.replace('frame_rate_num=30', 'frame_rate_num=25'))), 'Maße/Bildrate');
  has(withMutation((m) => m.edit('projects/reel-kdenlive/files/reel.kdenlive', (s) => s.replace('<property name="kdenlive:docproperties.browserurl"/>', '<property name="kdenlive:docproperties.browserurl">/home/nevuor/</property>'))), 'rechnerspezifische Pfade');
});

test('Social: zu wenig Kontrast, Schrift außerhalb der Marke, Text außerhalb der Sicherheitszone, zu kleine Schrift', () => {
  has(withMutation((m) => m.editJson('social/drop-ankuendigung/template.json', (t) => { t.layers.find((l) => l.id === 'titel').color = '#1a1a1a'; })), 'Kontrast');
  has(withMutation((m) => m.editJson('social/zitat/template.json', (t) => { t.layers.find((l) => l.id === 'zitat').fontFamily = 'Arial'; })), 'steht nicht in brand.json');
  has(withMutation((m) => m.editJson('social/event-plakat/template.json', (t) => { t.layers.find((l) => l.id === 'titel').rect.x = 10; })), 'Sicherheitszone');
  has(withMutation((m) => m.editJson('social/motiv-vorstellung/template.json', (t) => { t.layers.find((l) => l.id === 'titel').minSizePx = 20; })), 'kleinste Schrift');
});

test('Projektvorlage: Vorlagendatei fehlt, Maße passen nicht, unbekannte Social-Vorlage', () => {
  has(withMutation((m) => m.remove('projects/shirt-front-krita/files/shirt-front.kra')), 'Vorlagendatei');
  has(withMutation((m) => m.editJson('projects/hoodie-front-krita/template.json', (t) => { t.format.heightPx = 3300; })), 'passen nicht');
  has(withMutation((m) => m.editJson('projects/social-zitat/template.json', (t) => { t.socialTemplateId = 'gibt-es-nicht'; })), 'Social-Vorlage');
});

test('Formate: falsche Maße in formats.json werden gegen die Pflichtwerte gefunden', () => {
  has(withMutation((m) => m.editJson('shared/formats.json', (f) => { f.print[0].widthPx = 3897; })), 'erwartet 3898');
  has(withMutation((m) => m.editJson('shared/formats.json', (f) => { f.socialGuides.verticalConservative.bottom = 600; })), 'konservative Sicherheitszone');
});

test('Mockup (Team C2): Schemaverstoß ist ein Hinweis, mit strict ein Fehler', () => {
  const tpl = { id: 'tee-front', title: 'x', product: 'tee', view: 'front', canvas: { width: 2000, height: 2500 }, printProfileId: 'shirtigo-tee-front', printArea: { quad: [[0, 0], [1, 0], [1, 1], [0, 1]] }, displaceStrengthPx: 1, variants: [] };
  const target = join(copy, 'mockups/tee-front/template.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(tpl));
  try {
    const soft = validate({ packsDir: copy });
    assert.deepEqual(soft.errors, []);
    assert.ok(soft.warnings.some((w) => w.includes('fremdes-mockup')));
    assert.ok(validate({ packsDir: copy, strict: true }).errors.some((e) => e.includes('mockup.schema.json')));
  } finally {
    rmSync(join(copy, 'mockups'), { recursive: true, force: true });
  }
});

test('Mockup: byte-gleiche Ebenen in mehreren Vorlagen werden gemeldet, eine gemeinsame unter common nicht', () => {
  const layers = (heather) => ({ mask: 'mask.png', shade: 'shade.png', light: 'light.png', displace: null, texture: null, heather, background: null });
  const tpl = (id, heather) => ({
    id, title: id, product: 'tee', view: 'front', canvas: { width: 2000, height: 2500 }, printProfileId: 'shirtigo-tee-front',
    printArea: { quad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }, displaceStrengthPx: 1,
    variants: [{ exposure: 'light', layers: layers(heather), colorIds: ['weiss'] }],
  });
  const write = (rel, data) => {
    mkdirSync(dirname(join(copy, rel)), { recursive: true });
    writeFileSync(join(copy, rel), data);
  };
  const duplicates = () => validate({ packsDir: copy, strict: true }).errors.filter((e) => e.includes('byte-gleiche Ebene'));
  try {
    for (const id of ['tee-front', 'tee-back']) {
      for (const f of ['mask', 'shade', 'light']) write(`mockups/${id}/${f}.png`, `${id}-${f}`);
      write(`mockups/${id}/template.json`, JSON.stringify(tpl(id, 'heather.png')));
      write(`mockups/${id}/heather.png`, 'gleiche-melange');
    }
    assert.equal(duplicates().length, 1, 'zwei Vorlagen mit eigener, byte-gleicher heather.png');
    rmSync(join(copy, 'mockups/tee-front/heather.png'));
    rmSync(join(copy, 'mockups/tee-back/heather.png'));
    write('mockups/common/heather.png', 'gleiche-melange');
    for (const id of ['tee-front', 'tee-back']) write(`mockups/${id}/template.json`, JSON.stringify(tpl(id, '../common/heather.png')));
    assert.deepEqual(duplicates(), [], 'einmal unter mockups/common, beide verweisen darauf');
  } finally {
    rmSync(join(copy, 'mockups'), { recursive: true, force: true });
  }
});
