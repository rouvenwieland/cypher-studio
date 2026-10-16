#!/usr/bin/env node
// Erzeugt die Projektvorlagen packs/projects/<id>/{template.json, files/…} (Schema: packs/schema/template.schema.json, ARCHITEKTUR 4.5)
// aus packs/shared/formats.json und den Programmvorlagen in packs/krita, packs/inkscape (Dateikopien) sowie packs/projects/reel-kdenlive.
// preview.png erzeugt packs/tools/authoring/build-previews.mjs (Inkscape).
// Programmvorlagen: Shirt vorne/hinten, Hoodie vorne/hinten, Poster A2, Sticker, Post, Story, Reel-Cover in Krita (.kra) und Inkscape (.svg);
// Reel in Kdenlive (.kdenlive); je Social-Vorlage ein Eintrag für das Social-Modul (target "social").
// Nicht hier: Mockup-Vorlagen und die Blender-Vorlage (Team C2, packs/mockups und packs/blender).
// `--check` schreibt nichts und prüft die eingecheckten Dateien (Kopien byteweise).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKS_DIR } from './gen-palettes.mjs';
import { buildAll as buildSocial } from './gen-social.mjs';

export const PROJECTS_DIR = join(PACKS_DIR, 'projects');
const formats = JSON.parse(readFileSync(join(PACKS_DIR, 'shared', 'formats.json'), 'utf8'));

const X = ' × ';
const mm = (v) => String(v).replace('.', ',');

/** Programmvorlagen (Krita und Inkscape) als Liste von Beschreibungen. */
function programTemplates() {
  const out = [];
  const entries = [
    ...formats.print.map((p) => ({
      key: p.id, srcId: p.id, title: p.label, folder: 'Motive', profile: p.profileId,
      format: { label: `${p.widthMm}${X}${p.heightMm} mm`, widthPx: p.widthPx, heightPx: p.heightPx, dpi: 300, widthMm: p.widthMm, heightMm: p.heightMm },
      description: (prog) =>
        `Leinwand ${p.widthMm}${X}${p.heightMm} mm (${p.widthPx}${X}${p.heightPx} px, 300 dpi), transparent${prog === 'krita' ? '' : ', Seite in mm'}; Hilfslinien für Mitte, ideale Breite 300 mm${p.safeMm ? ` und ${p.safeMm.assumption ? 'Richtwert der sicheren Fläche' : 'sichere Fläche'} ${p.safeMm.width}${X}${p.safeMm.height} mm` : ''}.`,
      tags: p.tags,
      assumptions: p.safeMm?.assumption ? [`Lage der sicheren Fläche ${p.safeMm.width}${X}${p.safeMm.height} mm (oben mittig) ist eine Annahme bis zum Testdruck.`] : [],
    })),
    {
      key: 'poster-a2', srcId: 'poster-a2', title: formats.poster.label, folder: 'Motive', profile: null,
      format: { label: `${formats.poster.widthMm}${X}${formats.poster.heightMm} mm`, widthPx: formats.poster.widthPx, heightPx: formats.poster.heightPx, dpi: 300, widthMm: formats.poster.widthMm, heightMm: formats.poster.heightMm },
      description: () => `Endformat ${formats.poster.trimMm.width}${X}${formats.poster.trimMm.height} mm plus ${formats.poster.bleedMm} mm Anschnitt (${formats.poster.widthPx}${X}${formats.poster.heightPx} px, 300 dpi); Hilfslinien für Endformat und ${formats.poster.safeInsetMm} mm Sicherheitsabstand.`,
      tags: formats.poster.tags, assumptions: [],
    },
    {
      key: 'sticker', srcId: 'sticker-quadrat', title: formats.sticker.label, folder: 'Motive', profile: null,
      format: { label: `${formats.sticker.widthMm}${X}${formats.sticker.heightMm} mm`, widthPx: formats.sticker.widthPx, heightPx: formats.sticker.heightPx, dpi: 300, widthMm: formats.sticker.widthMm, heightMm: formats.sticker.heightMm },
      description: () => `Quadratische Fläche ${formats.sticker.widthMm}${X}${formats.sticker.heightMm} mm (${formats.sticker.widthPx}${X}${formats.sticker.heightPx} px, 300 dpi); nur als Datei, Shirtigo druckt keine Sticker.`,
      tags: formats.sticker.tags, assumptions: ['Die Größe 80 × 80 mm ist eine Annahme (der Shop nennt keine Stickergröße).'],
    },
    ...formats.social.map((s) => ({
      key: s.id, srcId: s.id, title: s.label, folder: 'Social', profile: null,
      format: { label: `${s.widthPx}${X}${s.heightPx}`, widthPx: s.widthPx, heightPx: s.heightPx, dpi: null, widthMm: null, heightMm: null },
      description: () => `Leinwand ${s.widthPx}${X}${s.heightPx} px mit Hilfslinien und gesperrter Ebene für die Sicherheitszonen (vor dem Export ausblenden).`,
      tags: ['social', s.format === 'reelCover' ? 'reel' : s.format === 'story' ? 'story' : 'post'],
      assumptions: [],
    })),
  ];
  for (const e of entries) {
    for (const [prog, ext, srcDir] of [
      ['krita', '.kra', join(PACKS_DIR, 'krita', 'templates', 'Cypher', '.source')],
      ['inkscape', '.svg', join(PACKS_DIR, 'inkscape', 'templates')],
    ]) {
      out.push({
        id: `${e.key}-${prog}`,
        programId: prog,
        template: {
          formatVersion: 1,
          id: `${e.key}-${prog}`,
          title: `${e.title} (${prog === 'krita' ? 'Krita' : 'Inkscape'})`,
          description: e.description(prog),
          target: 'program',
          programId: prog,
          format: e.format,
          folder: e.folder,
          fileExtension: ext,
          file: `files/${e.key}${ext}`,
          printProfileId: e.profile,
          preview: 'preview.png',
          requiresSetup: false,
          tags: [...e.tags, prog],
          ...(e.assumptions.length ? { assumptions: e.assumptions } : {}),
        },
        copy: { from: join(srcDir, `cypher-${e.srcId}${ext}`), to: `files/${e.key}${ext}` },
      });
    }
  }
  return out;
}

function reelTemplate() {
  const v = formats.video.find((x) => x.id === 'reel');
  return {
    id: 'reel-kdenlive',
    template: {
      formatVersion: 1,
      id: 'reel-kdenlive',
      title: 'Reel (Kdenlive)',
      description: `Kdenlive-Projekt ${v.widthPx}${X}${v.heightPx} (9:16), ${v.fps} fps, drei Videospuren (Video, Titel, Untertitel) und zwei Tonspuren (Originalton, Musik). Braucht das Cypher-Videoprofil aus der Einrichtung.`,
      target: 'program',
      programId: 'kdenlive',
      format: { label: `${v.widthPx}${X}${v.heightPx}`, widthPx: v.widthPx, heightPx: v.heightPx, dpi: null, widthMm: null, heightMm: null },
      folder: 'Video',
      fileExtension: '.kdenlive',
      file: 'files/reel.kdenlive',
      printProfileId: null,
      preview: 'preview.png',
      requiresSetup: true,
      tags: ['reel', 'video', 'kdenlive'],
    },
    copy: null, // reel.kdenlive wird von gen-kdenlive-project.mjs geschrieben
  };
}

function socialEntries() {
  return buildSocial().map((s) => ({
    id: `social-${s.id}`,
    template: {
      formatVersion: 1,
      id: `social-${s.id}`,
      title: s.title,
      description: s.description,
      target: 'social',
      programId: null,
      format: { label: `${s.size.width}${X}${s.size.height}`, widthPx: s.size.width, heightPx: s.size.height, dpi: null, widthMm: null, heightMm: null },
      folder: 'Social',
      fileExtension: '.social.json',
      socialTemplateId: s.id,
      printProfileId: null,
      preview: 'preview.png',
      requiresSetup: false,
      tags: s.tags,
    },
    copy: null,
  }));
}

/** @returns {{ id: string, template: object, copy: { from: string, to: string } | null }[]} */
export function allTemplates() {
  return [...programTemplates(), reelTemplate(), ...socialEntries()];
}

function main(argv) {
  const check = argv.includes('--check');
  let bad = 0;
  const known = new Set();
  for (const t of allTemplates()) {
    known.add(t.id);
    const dir = join(PROJECTS_DIR, t.id);
    const json = `${JSON.stringify(t.template, null, 2)}\n`;
    const jsonPath = join(dir, 'template.json');
    if (check) {
      if (!existsSync(jsonPath) || readFileSync(jsonPath, 'utf8') !== json) {
        console.error(`ABWEICHUNG projects/${t.id}/template.json (gen-templates.mjs ausführen)`);
        bad++;
      }
      if (t.copy && (!existsSync(join(dir, t.copy.to)) || !readFileSync(t.copy.from).equals(readFileSync(join(dir, t.copy.to))))) {
        console.error(`ABWEICHUNG projects/${t.id}/${t.copy.to} (Kopie der Programmvorlage)`);
        bad++;
      }
    } else {
      mkdirSync(join(dir, 'files'), { recursive: true });
      writeFileSync(jsonPath, json);
      if (t.copy) copyFileSync(t.copy.from, join(dir, t.copy.to));
      console.log(`geschrieben projects/${t.id}`);
    }
  }
  if (check) {
    for (const d of existsSync(PROJECTS_DIR) ? readdirSync(PROJECTS_DIR) : []) {
      if (!known.has(d)) {
        console.error(`UNBEKANNT projects/${d}`);
        bad++;
      }
    }
    console.log(bad === 0 ? 'Projektvorlagen stimmen mit dem Generator überein' : `${bad} Abweichung(en)`);
  }
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
