// Tests der kleinen Hilfsbibliotheken (ZIP, PNG, XML, TTF, Farbe, Schema-Prüfer).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { contrast, luminance } from '../lib/color.mjs';
import { decodePngRgba, encodePngRgba, readPngInfo } from '../lib/png.mjs';
import { SchemaRegistry } from '../lib/schema.mjs';
import { readFontInfo } from '../lib/ttf.mjs';
import { findAll, parseXml } from '../lib/xml.mjs';
import { crc32, readZip, writeZip } from '../lib/zip.mjs';
import { PACKS_DIR } from '../gen-palettes.mjs';

test('zip: Rundlauf, Reihenfolge, gespeichert/komprimiert, deterministisch', () => {
  const entries = [
    { name: 'mimetype', data: 'application/x-test', store: true },
    { name: 'a/b.txt', data: 'Hallo '.repeat(200) },
    { name: 'leer.bin', data: new Uint8Array(0) },
    { name: 'ü/ß.txt', data: 'Umlaute im Namen' },
  ];
  const zip = writeZip(entries);
  assert.ok(zip.equals(writeZip(entries)), 'gleiche Eingabe, gleiche Bytes');
  const back = readZip(zip);
  assert.deepEqual(back.map((e) => e.name), ['mimetype', 'a/b.txt', 'leer.bin', 'ü/ß.txt']);
  assert.equal(back[0].method, 0);
  assert.equal(back[1].method, 8);
  assert.ok(back[1].compressedSize < back[1].size);
  assert.equal(back[0].data.toString(), 'application/x-test');
  assert.equal(back[3].data.toString(), 'Umlaute im Namen');
});

test('zip: beschädigte Daten und doppelte Einträge werden erkannt', () => {
  const zip = Buffer.from(writeZip([{ name: 'x.txt', data: 'abcdefghij', store: true }]));
  zip[zip.indexOf('abcdefghij')] ^= 0xff; // ein Datenbyte kippen
  assert.throws(() => readZip(zip), /CRC/);
  assert.throws(() => writeZip([{ name: 'a', data: '1' }, { name: 'a', data: '2' }]), /doppelter Eintrag/);
  assert.throws(() => readZip(Buffer.from('kein zip')), /Zentralverzeichnis/);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(readZip(writeZip([{ name: 'r.bin', data: deflateRawSync(Buffer.from('x')) }]))[0].size > 0, true);
});

test('png: kodieren, Kopf und pHYs lesen, dekodieren', () => {
  const rgba = new Uint8Array(4 * 3 * 4);
  for (let i = 0; i < 12; i++) rgba.set([i * 20, 255 - i * 20, 7, i % 2 ? 255 : 0], i * 4);
  const png = encodePngRgba(4, 3, rgba, { dpi: 300 });
  const info = readPngInfo(png);
  assert.deepEqual([info.width, info.height, info.bitDepth, info.colorType, info.hasAlpha], [4, 3, 8, 6, true]);
  assert.deepEqual(info.dpi, { x: 300, y: 300 });
  assert.deepEqual(info.chunks, ['IHDR', 'pHYs', 'IDAT', 'IEND']);
  assert.deepEqual([...decodePngRgba(png).rgba], [...rgba]);
  const broken = Buffer.from(png);
  broken[20] ^= 1;
  assert.throws(() => readPngInfo(broken), /CRC/);
});

test('xml: wohlgeformt, Entitäten, CDATA, Kommentare', () => {
  const doc = parseXml('<?xml version="1.0"?>\n<!-- k -->\n<a x="1 &amp; 2"><b>t&lt;&#65;</b><![CDATA[<roh>]]><c/></a>');
  assert.equal(doc.attrs.x, '1 & 2');
  assert.equal(findAll(doc, 'b')[0].text, 't<A');
  assert.equal(doc.text, '<roh>');
  assert.equal(findAll(doc, 'c').length, 1);
});

test('xml: Fehler werden mit Zeile gemeldet', () => {
  const bad = ['<a><b></a>', '<a x="1" x="2"/>', '<a>&unbekannt;</a>', '<a', '<a></a><b/>', '<a x=1/>', 'text<a/>', '<a>x</b>'];
  for (const s of bad) assert.throws(() => parseXml(s), /XML Zeile \d+/, s);
});

test('ttf: Namen, Gewicht, Achsen und Schräglage der mitgelieferten Schriften', () => {
  const fonts = join(PACKS_DIR, 'shared', 'fonts');
  const v = readFontInfo(readFileSync(join(fonts, 'anybody', 'Anybody-Variable.ttf')));
  assert.equal(v.isVariable, true);
  assert.deepEqual([...v.axes].sort(), ['wdth', 'wght']);
  assert.equal(v.italicAngle, 0);
  const eb = readFontInfo(readFileSync(join(fonts, 'anybody', 'static', 'Anybody-ExtraBold.ttf')));
  assert.equal(eb.family, 'Anybody ExtraBold');
  assert.equal(eb.typographicFamily, 'Anybody');
  assert.equal(eb.typographicSubfamily, 'ExtraBold');
  assert.equal(eb.weightClass, 800);
  assert.equal(eb.italicAngle, 0);
  assert.equal(eb.isVariable, false);
  assert.equal(eb.hasReservedFontName, false);
  const it = readFontInfo(readFileSync(join(fonts, 'atkinson-hyperlegible-next', 'static', 'AtkinsonHyperlegibleNext-Italic.ttf')));
  assert.ok(it.italicAngle < 0);
  assert.throws(() => readFontInfo(Buffer.from('kein Font, aber lang genug fuer den Kopf')), /sfnt/);
});

test('farbe: WCAG-Kontrast', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.ok(Math.abs(luminance('#ffffff') - 1) < 1e-9);
  // Werte aus DESIGN.md: Tinte auf Cyan 10,56:1, Cyan gegen Papier 1,58:1
  assert.ok(Math.abs(contrast('#0d0d0d', '#00d4d8') - 10.56) < 0.05);
  assert.ok(Math.abs(contrast('#00d4d8', '#efeee9') - 1.58) < 0.05);
});

const base = 'https://example.test/schemas/';
function registry(schemas) {
  const reg = new SchemaRegistry();
  for (const [name, s] of Object.entries(schemas)) reg.add({ $id: `${base}${name}.json`, ...s });
  return reg;
}

test('schema-prüfer: Schlüsselwörter', () => {
  const reg = registry({
    t: {
      type: 'object',
      properties: {
        n: { type: 'integer', minimum: 1, maximum: 5 },
        s: { type: 'string', pattern: '^a+$', minLength: 2 },
        e: { enum: ['x', 'y'] },
        arr: { type: 'array', items: { type: 'number' }, minItems: 1, uniqueItems: true },
        o: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        k: { const: 7 },
      },
      required: ['n'],
      additionalProperties: false,
    },
  });
  const ok = (d) => reg.validate(`${base}t.json`, d).valid;
  assert.equal(ok({ n: 3, s: 'aa', e: 'x', arr: [1, 2], o: null, k: 7 }), true);
  assert.equal(ok({}), false); // Pflichtfeld
  assert.equal(ok({ n: 0 }), false);
  assert.equal(ok({ n: 1.5 }), false);
  assert.equal(ok({ n: 1, s: 'a' }), false);
  assert.equal(ok({ n: 1, s: 'ab' }), false);
  assert.equal(ok({ n: 1, e: 'z' }), false);
  assert.equal(ok({ n: 1, arr: [] }), false);
  assert.equal(ok({ n: 1, arr: [1, 1] }), false);
  assert.equal(ok({ n: 1, o: 5 }), false);
  assert.equal(ok({ n: 1, k: 8 }), false);
  assert.equal(ok({ n: 1, fremd: true }), false);
});

test('schema-prüfer: $ref über Dateien, if/then, Tippfehler im Schema', () => {
  const reg = registry({
    common: { $defs: { id: { type: 'string', pattern: '^[a-z]+$' } } },
    t: {
      properties: { id: { $ref: 'common.json#/$defs/id' }, kind: { enum: ['a', 'b'] }, extra: {} },
      if: { properties: { kind: { const: 'a' } }, required: ['kind'] },
      then: { required: ['extra'] },
    },
  });
  const v = (d) => reg.validate(`${base}t.json`, d);
  assert.equal(v({ id: 'abc' }).valid, true);
  assert.equal(v({ id: 'ABC' }).valid, false);
  assert.equal(v({ kind: 'a' }).valid, false);
  assert.equal(v({ kind: 'a', extra: 1 }).valid, true);
  assert.equal(v({ kind: 'b' }).valid, true);
  assert.throws(() => new SchemaRegistry().add({ $id: `${base}x.json`, tpye: 'string' }), /Unbekanntes Schema-Schlüsselwort "tpye"/);
});
