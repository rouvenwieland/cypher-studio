// Auswertung des Smoke-Tests mit den echten Programmen (packs/tools/authoring/wsl/smoke-all.sh, nur in der WSL lauffähig).
// Läuft nur, wenn CYPHER_SMOKE_DIR auf dessen Ausgabeordner zeigt (z. B. \\wsl.localhost\Ubuntu\home\<name>\c1work\smoke-out), sonst übersprungen.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PACKS_DIR } from '../gen-palettes.mjs';
import { decodePngRgba, readPngInfo } from '../lib/png.mjs';

const DIR = process.env.CYPHER_SMOKE_DIR;
const live = { skip: DIR ? false : 'CYPHER_SMOKE_DIR nicht gesetzt (Smoke-Test in der WSL: packs/tools/authoring/wsl/smoke-all.sh)' };
const lines = (file) => readFileSync(join(DIR, file), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const EXPECTED = {
  'cypher-shirt-front.kra': [3898, 5315, 300, 1],
  'cypher-shirt-back.kra': [3898, 5315, 300, 1],
  'cypher-hoodie-front.kra': [3898, 3307, 300, 1],
  'cypher-hoodie-back.kra': [3898, 4606, 300, 1],
  'cypher-poster-a2.kra': [5031, 7087, 300, 1],
  'cypher-sticker-quadrat.kra': [945, 945, 300, 1],
  'cypher-post.kra': [1080, 1350, 72, 2],
  'cypher-story.kra': [1080, 1920, 72, 2],
  'cypher-reel-cover.kra': [1080, 1920, 72, 2],
};

for (const which of ['neu', 'repo']) {
  test(`Krita ${which === 'neu' ? '(frisch erzeugt)' : '(eingecheckt)'}: jede Vorlage öffnet im Programm mit richtigen Pixelmaßen, dpi, Ebenen`, live, () => {
    const rows = lines(`krita-verify-${which}.log`);
    assert.ok(rows[0].krita.startsWith('5.3.4.1'), rows[0].krita);
    assert.equal(rows.at(-1).done, true, JSON.stringify(rows.at(-1)));
    const files = rows.filter((r) => r.file);
    assert.deepEqual(files.map((r) => r.file).sort(), Object.keys(EXPECTED).sort());
    for (const r of files) {
      const [w, h, dpi, layerCount] = EXPECTED[r.file];
      assert.deepEqual([r.width, r.height], [w, h], r.file);
      assert.deepEqual([r.xRes, r.yRes], [dpi, dpi], r.file);
      assert.equal(r.colorModel, 'RGBA');
      assert.equal(r.colorDepth, 'U8');
      const layers = r.layers.filter((l) => !l.name.startsWith('decorations'));
      assert.equal(layers.length, layerCount, r.file);
      const motiv = layers.find((l) => l.name === 'Motiv');
      assert.ok(motiv && motiv.empty && !motiv.locked && motiv.visible, `${r.file}: Ebene Motiv leer, ungesperrt, sichtbar`);
      if (layerCount === 2) {
        const zone = layers.find((l) => l.name.startsWith('Sicherheitszonen'));
        assert.ok(zone.locked && !zone.empty, `${r.file}: Zonenebene gesperrt und gefüllt`);
      }
      assert.ok(r.guidesVisible && r.verticalGuides.length > 0, `${r.file}: Hilfslinien sichtbar`);
    }
    // Hilfslinien in Pixeln: 25 mm Rand = 295,28 px, Mitte 165 mm = 1948,82 px, sichere Höhe 360 mm = 4251,97 px
    const shirt = files.find((r) => r.file === 'cypher-shirt-front.kra');
    for (const v of [295.28, 1948.82, 3602.36]) assert.ok(shirt.verticalGuides.some((g) => Math.abs(g - v) < 0.02), `senkrechte Hilfslinie ${v}`);
    assert.ok(shirt.horizontalGuides.some((g) => Math.abs(g - 4251.97) < 0.02));
    const story = files.find((r) => r.file === 'cypher-story.kra');
    assert.deepEqual(story.horizontalGuides, [270, 1248]);
    assert.deepEqual(story.verticalGuides, [120, 540, 960]);
  });
}

const BRAND = JSON.parse(readFileSync(join(PACKS_DIR, 'shared', 'brand', 'brand.json'), 'utf8'));
for (const which of ['bundle', 'lose']) {
  test(`Krita: Paletten und Arbeitsfläche aus ${which === 'bundle' ? 'den Bundles' : 'losen Dateien'} erscheinen in der Ressourcenverwaltung`, live, () => {
    const rows = lines(`krita-resources-${which}.log`);
    assert.equal(rows.at(-1).done, true, JSON.stringify(rows.at(-1)));
    assert.deepEqual(rows[0].workspaces, ['Cypher Druck']);
    for (const pal of BRAND.palettes) {
      const got = rows.find((r) => r.palette === pal.name);
      assert.ok(got, `Palette ${pal.name} fehlt`);
      assert.equal(got.total, pal.colors.length);
      assert.deepEqual(got.entries.map((e) => [e.name, e.hex]), pal.colors.map((c) => [c.name, c.hex]));
    }
  });
}

test('Inkscape 1.4.4: jede Vorlage öffnet und exportiert PNG mit exakten Pixelmaßen, RGBA, ohne Zonenebene', live, () => {
  const exp = {
    'cypher-shirt-front': [3898, 5315, 300],
    'cypher-shirt-back': [3898, 5315, 300],
    'cypher-hoodie-front': [3898, 3307, 300],
    'cypher-hoodie-back': [3898, 4606, 300],
    'cypher-poster-a2': [5031, 7087, 300],
    'cypher-sticker-quadrat': [945, 945, 300],
    'cypher-post': [1080, 1350, 96],
    'cypher-story': [1080, 1920, 96],
    'cypher-reel-cover': [1080, 1920, 96],
  };
  for (const [name, [w, h, dpi]] of Object.entries(exp)) {
    const png = readFileSync(join(DIR, 'inkscape', `${name}.png`));
    const info = readPngInfo(png);
    assert.deepEqual([info.width, info.height], [w, h], name);
    assert.equal(info.colorType, 6, `${name}: RGBA`);
    assert.deepEqual(info.dpi, { x: dpi, y: dpi }, name);
    const { rgba } = decodePngRgba(png);
    let opaque = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) opaque++;
    assert.equal(opaque, 0, `${name}: leere Vorlage exportiert vollständig transparent (Sicherheitszonen nicht mitexportiert)`);
  }
});

test('Kdenlive 26.08.2: Titel rendern in Profilgröße; Reel-Projekt lädt (melt) und öffnet in der Oberfläche', live, () => {
  for (const style of ['Bauchbinde', 'Titelkarte', 'Reel-Hook', 'Untertitel-Stil']) {
    for (const [fmt, w, h] of [['9x16', 1080, 1920], ['4x5', 1080, 1350]]) {
      const png = readFileSync(join(DIR, 'kdenlive', `Cypher_${style}_${fmt}.png`));
      const info = readPngInfo(png);
      assert.deepEqual([info.width, info.height], [w, h], `${style} ${fmt}`);
      const { rgba } = decodePngRgba(png);
      let visible = 0;
      for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) visible++;
      assert.ok(visible > 5000, `${style} ${fmt}: Titel ist sichtbar (${visible} Pixel)`);
      if (style === 'Titelkarte') assert.equal(visible, w * h, 'Titelkarte deckt das ganze Bild');
      else assert.ok(visible < w * h * 0.5, `${style} ${fmt}: transparenter Grund`);
    }
  }
  const melt = readPngInfo(readFileSync(join(DIR, 'kdenlive-project', 'reel-melt.png')));
  assert.deepEqual([melt.width, melt.height], [1080, 1920]);
  const log = readFileSync(join(DIR, 'kdenlive-project', 'smoke-kdenlive-project.log'), 'utf8');
  assert.match(log, /reel \/ Cypher Reel 9:16 \(1080x1920, 30 fps\) — Kdenlive/);
  assert.ok(readPngInfo(readFileSync(join(DIR, 'kdenlive-project', 'reel-gui.png'))).width >= 1280);
  assert.ok(existsSync(join(DIR, 'smoke.md')));
});
