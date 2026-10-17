// build.mjs: Ergebnis (dist) ist vollständig, jede Paketdatei hat die richtige Prüfsumme, zwei Läufe liefern bytegleiche Ausgabe,
// und die Generatoren sind deterministisch (zweimal erzeugen = gleiche Bytes).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { build } from '../build.mjs';
import { PACKS_DIR } from '../gen-palettes.mjs';
import * as bundles from '../gen-krita-bundle.mjs';
import * as workspace from '../gen-krita-workspace.mjs';
import * as inkscape from '../gen-inkscape.mjs';
import * as palettes from '../gen-palettes.mjs';
import * as packs from '../gen-packs.mjs';
import * as social from '../gen-social.mjs';
import * as titles from '../gen-kdenlive-titles.mjs';

const tmp = [];
after(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));
const sha = (b) => createHash('sha256').update(b).digest('hex');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

test('dist: vollständig, Prüfsummen stimmen, Manifest deckt alle Dateien ab', () => {
  const out = mkdtempSync(join(tmpdir(), 'cypher-dist-'));
  tmp.push(out);
  const res = build({ outDir: out });
  for (const id of ['krita', 'inkscape', 'kdenlive', 'fonts']) assert.ok(res.packs.includes(id), id);
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.formatVersion, 1);
  const listed = new Map(manifest.files.map((f) => [f.path, f]));
  const onDisk = walk(out).map((f) => f.slice(out.length + 1).replaceAll('\\', '/')).filter((f) => f !== 'manifest.json');
  assert.deepEqual([...listed.keys()].sort(), onDisk.sort());
  for (const [path, f] of listed) {
    const data = readFileSync(join(out, path));
    assert.equal(data.length, f.size, path);
    assert.equal(sha(data), f.sha256, path);
  }
  for (const id of res.packs.filter((p) => ['krita', 'inkscape', 'kdenlive', 'fonts'].includes(p))) {
    const pack = JSON.parse(readFileSync(join(out, id, 'pack.json'), 'utf8'));
    assert.deepEqual(Object.keys(pack.sha256).sort(), pack.files.map((f) => f.src).sort(), `${id}: Prüfsummen für alle Dateien`);
    for (const f of pack.files) {
      const file = resolve(out, id, f.src);
      assert.ok(file.startsWith(out), `${id}/${f.src} liegt außerhalb von dist`);
      assert.ok(existsSync(file), `${id}/${f.src} fehlt in dist`);
      assert.equal(sha(readFileSync(file)), pack.sha256[f.src], `${id}/${f.src}`);
    }
  }
  // Rust braucht diese Orte (ARCHITEKTUR 2.14)
  for (const rel of ['shared/brand/brand.json', 'schema/pack.schema.json', 'projects/shirt-front-krita/template.json', 'social/reel-cover/template.json', 'shared/brand/logos/cypher-kollektiv-hell.svg']) {
    assert.ok(existsSync(join(out, rel)), rel);
  }
  assert.ok(!walk(out).some((f) => /[\\/](tools|node_modules)[\\/]/.test(f)), 'Werkzeuge gehören nicht in dist');
});

test('dist: schlank (Risiko R18, .deb/.rpm unter 24 MiB): keine Mockup-Vorschaubilder, die Melange nur einmal, Größenrahmen', () => {
  const out = mkdtempSync(join(tmpdir(), 'cypher-dist-size-'));
  tmp.push(out);
  build({ outDir: out, skipValidate: true });
  const files = walk(out).map((f) => f.slice(out.length + 1).split('\\').join('/'));
  assert.deepEqual(files.filter((f) => /^mockups\/[^/]+\/preview\.png$/.test(f)), [], 'preview.png gehört nicht in dist');
  assert.deepEqual(files.filter((f) => f.startsWith('mockups/') && f.endsWith('heather.png')), ['mockups/common/heather.png']);
  for (const id of ['tee-front', 'tee-back', 'hoodie-front', 'hoodie-back']) {
    const tpl = JSON.parse(readFileSync(join(out, 'mockups', id, 'template.json'), 'utf8'));
    for (const v of tpl.variants) assert.equal(v.layers.heather, '../common/heather.png', id);
  }
  const total = files.reduce((n, f) => n + readFileSync(join(out, f)).length, 0);
  assert.ok(total < 16 * 1024 * 1024, `dist ist ${(total / 1048576).toFixed(1)} MiB, erlaubt sind unter 16 MiB`);
});

test('dist: zwei Läufe liefern bytegleiche Ausgabe', () => {
  const a = mkdtempSync(join(tmpdir(), 'cypher-dist-a-'));
  const b = mkdtempSync(join(tmpdir(), 'cypher-dist-b-'));
  tmp.push(a, b);
  build({ outDir: a, skipValidate: true });
  build({ outDir: b, skipValidate: true });
  const fa = walk(a).map((f) => f.slice(a.length));
  const fb = walk(b).map((f) => f.slice(b.length));
  assert.deepEqual(fa, fb);
  for (const f of fa) assert.ok(readFileSync(join(a, f)).equals(readFileSync(join(b, f))), f);
});

test('dist: Fehler im Quellbaum brechen den Bau ab', () => {
  const out = mkdtempSync(join(tmpdir(), 'cypher-dist-x-'));
  tmp.push(out);
  assert.throws(() => build({ packsDir: join(tmpdir(), 'gibt-es-nicht'), outDir: out }), /ENOENT|Quellbaum/);
});

test('Generatoren sind deterministisch und entsprechen dem Stand im Repo', () => {
  const once = (items) => items.map((i) => Buffer.from(i.data ?? i.text));
  const same = (a, b, label) => a.forEach((x, i) => assert.ok(x.equals(b[i]), `${label}[${i}]`));
  same(once(palettes.renderAll()), once(palettes.renderAll()), 'Paletten');
  same(bundles.BUNDLES.map((s) => bundles.renderBundle(s)), bundles.BUNDLES.map((s) => bundles.renderBundle(s)), 'Bundles');
  assert.equal(workspace.renderWorkspace(), workspace.renderWorkspace());
  same(once(inkscape.renderAll()), once(inkscape.renderAll()), 'Inkscape');
  same(once(titles.renderAll()), once(titles.renderAll()), 'Titel');
  same(once(social.renderAll()), once(social.renderAll()), 'Social');
  same(once(packs.renderAll()), once(packs.renderAll()), 'pack.json');
  for (const f of palettes.renderAll()) assert.ok(readFileSync(join(PACKS_DIR, f.file)).equals(Buffer.from(f.data)), `${f.file} im Repo veraltet`);
});
