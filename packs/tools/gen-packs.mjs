#!/usr/bin/env node
// Erzeugt die pack.json der Einrichtungspakete krita, inkscape, kdenlive und fonts (ARCHITEKTUR 4.4, Schema packs/schema/pack.schema.json)
// aus den Dateien im Repo. Zielwurzeln (root) sind Namen aus setup/roots.rs; welcher Ordner dahintersteckt, je Betriebssystem und Installationsart
// (ARCHITEKTUR 7.4), entscheidet allein der Rust-Kern. `sha256` fügt build.mjs ein. Paket blender gehört Team C2 und wird hier nicht erzeugt.
// `--check` schreibt nichts und prüft die eingecheckten Dateien.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKS_DIR, loadBrand } from './gen-palettes.mjs';
import { readFontInfo } from './lib/ttf.mjs';

const brand = loadBrand();
const formats = JSON.parse(readFileSync(join(PACKS_DIR, 'shared', 'formats.json'), 'utf8'));
const FONT_FAMILIES = ['Anybody', 'Atkinson Hyperlegible Next', 'Martian Mono'];

const ls = (dir) => readdirSync(join(PACKS_DIR, dir)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'datei';

/** Hilfsklasse: sammelt Dateien (mit eindeutiger id) und Bausteine. */
class PackBuilder {
  constructor(meta) {
    this.meta = meta;
    this.files = [];
    this.components = [];
    this.actions = [];
    this.ids = new Set();
  }

  file(prefix, src, root, rel, extra = {}) {
    let id = `${prefix}-${slug(basename(src))}`;
    for (let i = 2; this.ids.has(id); i++) id = `${prefix}-${slug(basename(src))}-${i}`;
    this.ids.add(id);
    this.files.push({ id, src, root, rel, ...extra });
    return id;
  }

  component(def) {
    this.components.push(def);
  }

  toJSON() {
    return {
      $schema: '../schema/pack.schema.json',
      formatVersion: 1,
      ...this.meta,
      components: this.components,
      files: this.files,
      actions: this.actions,
    };
  }
}

const allColors = brand.palettes[0].colors.map((c) => c.hex);
const formatLabels = [
  ...formats.print.map((p) => `${p.label} ${p.widthMm} × ${p.heightMm} mm`),
  `${formats.poster.label} ${formats.poster.widthMm} × ${formats.poster.heightMm} mm`,
  ...formats.social.map((s) => `${s.label} ${s.widthPx} × ${s.heightPx}`),
];
const variableFonts = () => ['anybody', 'atkinson-hyperlegible-next', 'martian-mono'].flatMap((d) => ls(`shared/fonts/${d}`).filter((f) => f.endsWith('-Variable.ttf')).map((f) => `../shared/fonts/${d}/${f}`));
const staticFonts = () => ['anybody', 'atkinson-hyperlegible-next', 'martian-mono'].flatMap((d) => ls(`shared/fonts/${d}/static`).map((f) => `../shared/fonts/${d}/static/${f}`));
const FONT_PREVIEW = { colors: [], formats: [], fonts: FONT_FAMILIES };

function krita() {
  const b = new PackBuilder({
    id: 'krita', programId: 'krita', version: '1.0.0', title: 'Cypher-Einrichtung für Krita',
    description: 'Paletten, Arbeitsfläche, Vorlagen und Schriften des Cypher Kollektivs für Krita 5.',
    programVersions: '>=5.2, <6', requiresPacks: [], requiresProgramClosed: false,
  });
  const palette = b.file('bundle', 'bundles/cypher.bundle', 'kritaResources', 'bundles/cypher.bundle');
  b.component({ id: 'palette', kind: 'bundle', label: 'Paletten „Cypher Kollektionen“ (17 Farben) und „Cypher Textil (Druckfarben)“', optional: false, files: [palette], preview: { colors: allColors, formats: [], fonts: [] } });
  const tpl = [];
  const base = 'templates/Cypher'; // relativ zum Paketordner packs/krita
  tpl.push(b.file('vorlage', `${base}/.directory`, 'kritaResources', 'templates/Cypher/.directory'));
  for (const f of ls(`krita/${base}`).filter((n) => n.endsWith('.desktop'))) tpl.push(b.file('vorlage', `${base}/${f}`, 'kritaResources', `templates/Cypher/${f}`));
  for (const f of ls(`krita/${base}/.source`)) tpl.push(b.file('vorlage', `${base}/.source/${f}`, 'kritaResources', `templates/Cypher/.source/${f}`));
  for (const f of ls(`krita/${base}/.icon`)) tpl.push(b.file('vorlage', `${base}/.icon/${f}`, 'kritaResources', `templates/Cypher/.icon/${f}`));
  b.component({ id: 'templates', kind: 'templates', label: 'Vorlagen: Shirt, Hoodie, Poster, Sticker, Post, Story, Reel-Cover', optional: false, files: tpl, preview: { colors: [], formats: formatLabels, fonts: [] } });
  const fonts = variableFonts().map((src) => b.file('schrift', src, 'kritaResources', `fonts/cypher/${basename(src)}`));
  b.component({ id: 'fonts', kind: 'fonts', label: 'Schriften Anybody, Atkinson Hyperlegible Next und Martian Mono', optional: false, files: fonts, preview: FONT_PREVIEW });
  const ws = b.file('bundle', 'bundles/cypher-arbeitsflaeche.bundle', 'kritaResources', 'bundles/cypher-arbeitsflaeche.bundle');
  b.component({ id: 'workspace', kind: 'workspace', label: 'Arbeitsfläche „Cypher Druck“', optional: true, defaultSelected: false, files: [ws], preview: { colors: [], formats: [], fonts: [] } });
  // Ausweichweg: lose Dateien statt Bundle (Krita registriert beides beim Start; nie zusammen anwenden)
  const loosePal = ls('shared/palettes').filter((f) => f.endsWith('.kpl')).map((f) => b.file('lose', `../shared/palettes/${f}`, 'kritaResources', `palettes/${f}`));
  b.component({ id: 'palette-lose', kind: 'palette', label: 'Paletten als lose Dateien (Ausweichweg, falls das Bundle nicht erscheint)', optional: true, defaultSelected: false, fallbackFor: 'palette', files: loosePal, preview: { colors: allColors, formats: [], fonts: [] } });
  const looseWs = ls('krita/workspaces').filter((f) => f.endsWith('.kws')).map((f) => b.file('lose', `workspaces/${f}`, 'kritaResources', `workspaces/${f}`));
  b.component({ id: 'workspace-lose', kind: 'workspace', label: 'Arbeitsfläche als lose Datei (Ausweichweg)', optional: true, defaultSelected: false, fallbackFor: 'workspace', files: looseWs, preview: { colors: [], formats: [], fonts: [] } });
  return b;
}

function inkscape() {
  const b = new PackBuilder({
    id: 'inkscape', programId: 'inkscape', version: '1.0.0', title: 'Cypher-Einrichtung für Inkscape',
    description: 'Paletten, Vorlagen (mit Export-Hinweis 300 dpi) und Schriften des Cypher Kollektivs für Inkscape 1.4.',
    programVersions: '>=1.3, <1.5', requiresPacks: [], requiresProgramClosed: false,
  });
  const pal = ls('shared/palettes').filter((f) => f.endsWith('.gpl')).map((f) => b.file('palette', `../shared/palettes/${f}`, 'inkscapeProfile', `palettes/${f}`));
  b.component({ id: 'palette', kind: 'palette', label: 'Paletten „Cypher Kollektionen“ (17 Farben) und „Cypher Textil (Druckfarben)“', optional: false, files: pal, preview: { colors: allColors, formats: [], fonts: [] } });
  const tpl = ls('inkscape/templates').map((f) => b.file('vorlage', `templates/${f}`, 'inkscapeProfile', `templates/${f}`));
  b.component({ id: 'templates', kind: 'templates', label: 'Vorlagen mit Hilfslinien: Shirt, Hoodie (in mm, Export 300 dpi), Poster, Sticker, Post, Story, Reel-Cover', optional: false, files: tpl, preview: { colors: [], formats: formatLabels, fonts: [] } });
  const fonts = variableFonts().map((src) => b.file('schrift', src, 'inkscapeProfile', `fonts/cypher/${basename(src)}`));
  b.component({ id: 'fonts', kind: 'fonts', label: 'Schriften Anybody, Atkinson Hyperlegible Next und Martian Mono', optional: false, files: fonts, preview: FONT_PREVIEW });
  return b;
}

function kdenlive() {
  const b = new PackBuilder({
    id: 'kdenlive', programId: 'kdenlive', version: '1.0.0', title: 'Cypher-Einrichtung für Kdenlive',
    description: 'Titelvorlagen und Projektprofile (1080 × 1920 und 1080 × 1350 bei 30 fps) des Cypher Kollektivs für Kdenlive. Die Schriften kommen aus dem Paket „fonts“.',
    programVersions: '>=26.04, <27', requiresPacks: ['fonts'], requiresProgramClosed: false,
  });
  const titles = ls('kdenlive/titles').map((f) => b.file('titel', `titles/${f}`, 'kdenliveData', `titles/${f}`));
  b.component({ id: 'titles', kind: 'titles', label: 'Titelvorlagen: Bauchbinde, Titelkarte, Reel-Hook, Untertitel-Stil (9:16 und 4:5)', optional: false, files: titles, preview: { colors: [], formats: ['1080 × 1920', '1080 × 1350'], fonts: FONT_FAMILIES } });
  const profiles = ls('kdenlive/profiles').map((f) => b.file('profil', `profiles/${f}`, 'kdenliveData', `profiles/${f}`));
  b.component({ id: 'video-profiles', kind: 'videoProfiles', label: 'Projektprofile „Cypher Reel 9:16“ (1080 × 1920) und „Cypher Reel 4:5“ (1080 × 1350), je 30 fps', optional: false, files: profiles, preview: { colors: [], formats: ['1080 × 1920 · 30 fps', '1080 × 1350 · 30 fps'], fonts: [] } });
  return b;
}

function fonts() {
  const b = new PackBuilder({
    id: 'fonts', programId: null, version: '1.0.0', title: 'Cypher-Schriften für das Benutzerprofil',
    description: 'Anybody, Atkinson Hyperlegible Next und Martian Mono als statische Schnitte im Benutzer-Schriftordner des Betriebssystems (ohne Administratorrechte), für Kdenlive und andere Programme ohne eigenen Schriftordner.',
    requiresPacks: [], requiresProgramClosed: false,
  });
  const ids = [];
  for (const src of staticFonts()) {
    const id = b.file('schrift', src, 'userFonts', basename(src));
    ids.push(id);
    const info = readFontInfo(readFileSync(join(PACKS_DIR, 'fonts', src)));
    b.actions.push({ type: 'installFont', file: id, displayName: `${info.fullName} (TrueType)` });
  }
  b.component({ id: 'fonts', kind: 'fonts', label: 'Schriften Anybody, Atkinson Hyperlegible Next und Martian Mono (statische Schnitte)', optional: false, files: ids, preview: FONT_PREVIEW });
  return b;
}

/** @returns {{ file: string, text: string }[]} */
export function renderAll() {
  return [krita(), inkscape(), kdenlive(), fonts()].map((b) => ({ file: `${b.meta.id}/pack.json`, text: `${JSON.stringify(b, null, 2)}\n` }));
}

function main(argv) {
  const files = renderAll();
  let bad = 0;
  for (const { file, text } of files) {
    const target = join(PACKS_DIR, file);
    if (argv.includes('--check')) {
      if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
        console.error(`ABWEICHUNG ${file} (gen-packs.mjs ausführen)`);
        bad++;
      }
    } else {
      writeFileSync(target, text);
      console.log(`geschrieben ${file}`);
    }
  }
  if (argv.includes('--check')) console.log(bad === 0 ? 'pack.json stimmen mit den Dateien überein' : `${bad} Abweichung(en)`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
