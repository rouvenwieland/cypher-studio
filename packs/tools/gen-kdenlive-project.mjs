#!/usr/bin/env node
// Erzeugt packs/projects/reel-kdenlive/files/reel.kdenlive (Kdenlive-Projektvorlage "Reel", 1080 × 1920, 30 fps) aus
// packs/tools/authoring/kdenlive/reel-base.kdenlive. Die Basisdatei hat das echte Kdenlive 26.08.2 geschrieben (neues Projekt mit dem
// Cypher-Profil, drei Videospuren und zwei Tonspuren, per xvfb bedient: packs/tools/authoring/wsl/capture-kdenlive-project.sh).
// Dieses Skript entfernt nur Rechnerspezifisches und benennt die Spuren; es erfindet keine Kdenlive-Strukturen.
// `--check` schreibt nichts und prüft die eingecheckte Datei.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKS_DIR } from './gen-palettes.mjs';

const BASE = join(PACKS_DIR, 'tools', 'authoring', 'kdenlive', 'reel-base.kdenlive');
export const PROJECT_PATH = join(PACKS_DIR, 'projects', 'reel-kdenlive', 'files', 'reel.kdenlive');
export const PROFILE_NAME = 'cypher_reel_1080x1920_30';

/** Spuren in MLT-Reihenfolge von unten nach oben: A2, A1, V1, V2, V3. */
const TRACK_NAMES = ['Musik', 'Originalton', 'Video', 'Titel', 'Untertitel'];

export function renderProject() {
  let xml = readFileSync(BASE, 'utf8');
  const must = (cond, what) => {
    if (!cond) throw new Error(`Basisdatei hat sich geändert: ${what} nicht gefunden`);
  };
  must(/<mlt [^>]*root="[^"]*"/.test(xml), 'mlt root');
  xml = xml.replace(/(<mlt [^>]*?)root="[^"]*"/, '$1root=""');
  must(/kdenlive:docproperties\.browserurl">[^<]*</.test(xml), 'browserurl');
  xml = xml.replace(/<property name="kdenlive:docproperties\.browserurl">[^<]*<\/property>/, '<property name="kdenlive:docproperties.browserurl"/>');
  must(/kdenlive:docproperties\.profile">[^<]*</.test(xml), 'profile');
  xml = xml.replace(/(<property name="kdenlive:docproperties\.profile">)[^<]*(<\/property>)/, `$1${PROFILE_NAME}$2`);
  must(xml.includes('<property name="kdenlive:clipname">Sequence 1</property>'), 'Sequenzname');
  xml = xml.replace('<property name="kdenlive:clipname">Sequence 1</property>', '<property name="kdenlive:clipname">Reel</property>');
  TRACK_NAMES.forEach((name, i) => {
    const re = new RegExp(`(<tractor id="tractor${i}"[^>]*>\\n)`);
    must(re.test(xml), `tractor${i}`);
    xml = xml.replace(re, `$1  <property name="kdenlive:track_name">${name}</property>\n`);
  });
  return xml;
}

function main(argv) {
  const xml = renderProject();
  if (argv.includes('--check')) {
    if (!existsSync(PROJECT_PATH) || readFileSync(PROJECT_PATH, 'utf8') !== xml) {
      console.error('ABWEICHUNG packs/projects/reel-kdenlive/files/reel.kdenlive (gen-kdenlive-project.mjs ausführen)');
      return 1;
    }
    console.log('reel.kdenlive stimmt mit der Basisdatei überein');
    return 0;
  }
  mkdirSync(dirname(PROJECT_PATH), { recursive: true });
  writeFileSync(PROJECT_PATH, xml);
  console.log(`geschrieben projects/reel-kdenlive/files/reel.kdenlive (${xml.length} Zeichen)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
