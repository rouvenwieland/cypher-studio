#!/usr/bin/env node
// Erzeugt packs/krita/workspaces/cypher-druck.kws (Krita-Arbeitsfläche) aus dem Docker-Zustand, den eine echte Krita-Sitzung geliefert hat
// (packs/tools/authoring/krita/gui_plugin/cypher-druck.state.json = QMainWindow::saveState() als Base64; erzeugt mit
// packs/tools/authoring/wsl/capture-workspace.sh). Format laut mitgelieferten Arbeitsflächen von Krita 5.3:
//   <Workspace version="1" name=…><state>Base64</state><settings>Mixerfarben</settings><image>Vorschau-PNG als Base64</image></Workspace>
// Die Mixerfarben der Arbeitsfläche sind die Cypher-Farben (Digital-Mixer-Docker, falls eingeblendet).
// `--check` schreibt nichts und prüft die eingecheckte Datei.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePngRgba } from './lib/png.mjs';
import { PACKS_DIR, hexToRgb, loadBrand } from './gen-palettes.mjs';

const STATE_PATH = join(PACKS_DIR, 'tools', 'authoring', 'krita', 'gui_plugin', 'cypher-druck.state.json');
export const WORKSPACE_PATH = join(PACKS_DIR, 'krita', 'workspaces', 'cypher-druck.kws');
export const WORKSPACE_NAME = 'Cypher Druck';

/** Vorschaubild 256 × 142 (wie bei Krita): Schaubild der Anordnung. */
export function renderPreview(brand) {
  const w = 256;
  const h = 142;
  const rgba = new Uint8Array(w * h * 4);
  const fill = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgba.set([r, g, b, 255], (y * w + x) * 4);
  };
  const ink = [13, 13, 13];
  const paper = [239, 238, 233];
  const mid = [122, 121, 116];
  fill(0, 0, w, h, paper);
  fill(0, 0, w, 8, ink); // Titelzeile
  fill(2, 10, 14, h - 2, ink); // Werkzeugleiste
  fill(18, 14, 178, h - 6, [214, 214, 214]); // Leinwand
  fill(70, 30, 126, 120, [255, 255, 255]);
  // rechte Docker: Übersicht, Palette mit Farben, Ebenen
  fill(184, 12, w - 4, 40, mid);
  fill(184, 44, w - 4, 84, paper);
  const colors = brand.palettes[0].colors.map((c) => hexToRgb(c.hex));
  colors.slice(0, 12).forEach((c, i) => {
    const x = 187 + (i % 6) * 12;
    const y = 47 + Math.floor(i / 6) * 12;
    fill(x, y, x + 10, y + 10, c);
  });
  fill(184, 88, w - 4, h - 6, mid);
  for (let i = 0; i < 4; i++) fill(188, 92 + i * 10, w - 8, 98 + i * 10, paper);
  return encodePngRgba(w, h, rgba);
}

function colorParam(name, hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => (v / 255).toString());
  return `        <param name="${name}" type="color"><![CDATA[<!DOCTYPE color>\n<color>\n <RGB r="${r}" b="${b}" space="sRGB-elle-V2-srgbtrc.icc" g="${g}"/>\n</color>\n]]></param>\n`;
}

export function renderWorkspace(brand = loadBrand()) {
  const state = JSON.parse(readFileSync(STATE_PATH, 'utf8')).state;
  const pal = Object.fromEntries(brand.palettes[0].colors.map((c) => [c.name, c.hex]));
  const mixer = [pal['Studio-Cyan'], pal['Empfang-Gelb (Shop)'], pal['Zeitzeichen-Orange (News)'], pal['Mittelwelle Kobalt'], pal['Gold-Lounge Gold'], pal['Papier']];
  let settings = colorParam('digital-mixergradient_from', pal['Tinte']) + colorParam('digital-mixergradient_to', pal['Papier']);
  mixer.forEach((hex, i) => {
    settings += colorParam(`digital-mixermixer_${i}`, hex);
  });
  const image = renderPreview(brand).toString('base64');
  return `<Workspace version="1" name="${WORKSPACE_NAME}">\n    <state><![CDATA[${state}]]></state>\n    <settings>\n${settings}    </settings>\n    <image><![CDATA[${image}]]></image>\n</Workspace>\n`;
}

function main(argv) {
  const text = renderWorkspace();
  if (argv.includes('--check')) {
    if (!existsSync(WORKSPACE_PATH) || readFileSync(WORKSPACE_PATH, 'utf8') !== text) {
      console.error('ABWEICHUNG packs/krita/workspaces/cypher-druck.kws (gen-krita-workspace.mjs ausführen)');
      return 1;
    }
    console.log('cypher-druck.kws stimmt mit den Quellen überein');
    return 0;
  }
  mkdirSync(dirname(WORKSPACE_PATH), { recursive: true });
  writeFileSync(WORKSPACE_PATH, text);
  console.log(`geschrieben krita/workspaces/cypher-druck.kws (${text.length} Zeichen)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
