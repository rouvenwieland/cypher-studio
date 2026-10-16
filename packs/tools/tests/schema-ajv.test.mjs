// Gegenprobe: Der eigene Schema-Prüfer (lib/schema.mjs) und Ajv (Draft 2020-12, strict) müssen bei allen Paketdaten und bei Abwandlungen gleich entscheiden.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { PACKS_DIR } from '../gen-palettes.mjs';
import { SchemaRegistry } from '../lib/schema.mjs';

const BASE = 'https://studio.cypherxcypher.de/schemas/';
const schemaDir = join(PACKS_DIR, 'schema');
const names = readdirSync(schemaDir).filter((f) => f.endsWith('.schema.json'));
const schemas = names.map((f) => JSON.parse(readFileSync(join(schemaDir, f), 'utf8')));

const ours = new SchemaRegistry();
for (const s of schemas) ours.add(s);
const ajv = new Ajv2020({ strict: true, allErrors: true });
for (const s of schemas) ajv.addSchema(s);

const json = (...p) => JSON.parse(readFileSync(join(PACKS_DIR, ...p), 'utf8'));

/** @returns {{ schema: string, label: string, data: any }[]} */
function documents() {
  const docs = [{ schema: 'brand', label: 'brand.json', data: json('shared', 'brand', 'brand.json') }];
  for (const d of ['krita', 'inkscape', 'kdenlive', 'fonts', 'blender']) {
    if (existsSync(join(PACKS_DIR, d, 'pack.json'))) docs.push({ schema: 'pack', label: `${d}/pack.json`, data: json(d, 'pack.json') });
  }
  for (const [dir, schema] of [['projects', 'template'], ['social', 'social'], ['mockups', 'mockup']]) {
    for (const id of existsSync(join(PACKS_DIR, dir)) ? readdirSync(join(PACKS_DIR, dir)) : []) {
      const f = join(PACKS_DIR, dir, id, 'template.json');
      if (existsSync(f)) docs.push({ schema, label: `${dir}/${id}`, data: JSON.parse(readFileSync(f, 'utf8')) });
    }
  }
  return docs;
}

function decide(schema, data) {
  const a = ours.validate(`${BASE}${schema}.schema.json`, data).valid;
  const b = ajv.getSchema(`${BASE}${schema}.schema.json`)(data);
  return { a, b: Boolean(b) };
}

test('alle Schemas lassen sich in Ajv (strict) kompilieren', () => {
  assert.deepEqual(names.sort(), ['brand.schema.json', 'common.schema.json', 'mockup.schema.json', 'pack.schema.json', 'social.schema.json', 'template.schema.json']);
  for (const s of schemas) assert.ok(ajv.getSchema(s.$id) || s.$id.endsWith('common.schema.json'), s.$id);
});

test('eigener Prüfer und Ajv stimmen bei allen Paketdaten überein', () => {
  for (const { schema, label, data } of documents()) {
    const { a, b } = decide(schema, data);
    assert.equal(a, b, `${label}: eigener Prüfer ${a}, Ajv ${b}`);
    // Mockups von C2 dürfen vorübergehend ungültig sein; alles andere muss gültig sein
    if (schema !== 'mockup') assert.equal(a, true, `${label} ist ungültig`);
  }
});

/** Abwandlungen: gleiche Daten, ein Fehler eingebaut. Beide Prüfer müssen gleich urteilen (und ungültig melden). */
function mutations(data) {
  const out = [];
  const clone = () => structuredClone(data);
  const paths = [];
  (function walk(v, p) {
    if (v && typeof v === 'object') {
      for (const [k, c] of Object.entries(v)) {
        paths.push([...p, k]);
        walk(c, [...p, k]);
      }
    }
  })(data, []);
  const pick = paths.filter((_, i) => i % Math.max(1, Math.floor(paths.length / 40)) === 0);
  for (const p of pick) {
    const parent = (d) => p.slice(0, -1).reduce((x, k) => x[k], d);
    const key = p.at(-1);
    const a = clone();
    if (Array.isArray(parent(a))) parent(a).splice(Number(key), 1);
    else delete parent(a)[key];
    out.push(a); // Feld entfernt
    const b = clone();
    parent(b)[key] = typeof parent(b)[key] === 'string' ? 42 : 'x'; // falscher Typ
    out.push(b);
    const c = clone();
    if (!Array.isArray(parent(c))) parent(c).__fremd = 1; // unbekanntes Feld
    out.push(c);
  }
  return out;
}

test('eigener Prüfer und Ajv stimmen auch bei fehlerhaften Abwandlungen überein', () => {
  let invalid = 0;
  let total = 0;
  for (const { schema, label, data } of documents().filter((d) => d.schema !== 'mockup')) {
    for (const m of mutations(data)) {
      const { a, b } = decide(schema, m);
      total++;
      if (!a) invalid++;
      assert.equal(a, b, `${label}: Abwandlung wird unterschiedlich beurteilt (eigener ${a}, Ajv ${b})`);
    }
  }
  assert.ok(total > 500, `nur ${total} Abwandlungen`);
  assert.ok(invalid / total > 0.5, `zu wenige Abwandlungen werden abgelehnt (${invalid}/${total})`);
});
