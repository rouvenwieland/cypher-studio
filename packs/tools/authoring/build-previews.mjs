#!/usr/bin/env node
// Erzeugt alle preview.png der Projekt- und Social-Vorlagen (packs/projects/*/preview.png, packs/social/*/preview.png) mit dem echten Inkscape 1.4.4 in der WSL.
//   1. Dieses Skript schreibt je Vorlage eine SVG nach packs/tools/authoring/previews/.work/ (nicht eingecheckt),
//   2. ruft packs/tools/authoring/wsl/render-previews.sh auf (Inkscape exportiert PNG, Schriften aus dem Paket),
//   3. kopiert die PNG an ihren Platz.
// Social-Vorschauen zeichnen die Vorlage selbst (Standardtexte, Bildplatzhalter schraffiert); Projektvorlagen zeigen das Format mit Hilfslinien.
// Aufruf (Windows, Node 24):  node packs/tools/authoring/build-previews.mjs
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PACKS = join(here, '..', '..');
const WORK = join(here, 'previews', '.work');

const INK = '#0d0d0d';
const PAPER = '#efeee9';
const CYAN = '#00d4d8';
const DEEP = '#00676b';
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const n = (v) => Math.round(v * 100) / 100;

const FONT_STYLE = {
  Anybody: (w) => `font-family:Anybody;font-variation-settings:'wght' ${w},'wdth' 100;font-weight:${w}`,
  'Atkinson Hyperlegible Next': (w) => `font-family:'Atkinson Hyperlegible Next';font-variation-settings:'wght' ${w};font-weight:${w}`,
  'Martian Mono': (w) => `font-family:'Martian Mono';font-variation-settings:'wght' ${w},'wdth' 100;font-weight:${w}`,
};

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Social-Vorlage als SVG (volle Größe; der Export verkleinert). */
function socialSvg(t) {
  const { width: W, height: H } = t.size;
  const defs = [];
  const body = [];
  const fill = (f, id) => {
    if (f.type === 'solid') return f.color;
    if (f.type === 'linearGradient') {
      const rad = (f.angleDeg * Math.PI) / 180;
      const x2 = n(0.5 + Math.sin(rad) / 2);
      const y2 = n(0.5 - Math.cos(rad) / 2);
      defs.push(`<linearGradient id="g-${id}" x1="${n(1 - x2)}" y1="${n(1 - y2)}" x2="${x2}" y2="${y2}">${f.stops.map((s) => `<stop offset="${s.at}" stop-color="${s.color}"/>`).join('')}</linearGradient>`);
      return `url(#g-${id})`;
    }
    return '#7a7974';
  };
  body.push(`<rect width="${W}" height="${H}" fill="${fill(t.background, 'bg')}"/>`);
  for (const l of t.layers) {
    const r = l.rect;
    if (l.type === 'shape') {
      body.push(`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="${l.radiusPx}" fill="${fill(l.fill, l.id)}" opacity="${l.opacity}"/>`);
    } else if (l.type === 'image') {
      defs.push(`<pattern id="h-${l.id}" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="24" height="24" fill="#6a6a66"/><rect width="12" height="24" fill="#5c5c58"/></pattern>`);
      body.push(`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="url(#h-${l.id})"/>`);
      const fs = Math.min(48, r.height / 6);
      body.push(`<text x="${r.x + r.width / 2}" y="${r.y + r.height / 2 + fs / 3}" text-anchor="middle" style="${FONT_STYLE['Martian Mono'](500)};font-size:${fs}px;fill:#efeee9;letter-spacing:2px">${l.slot === 'bild' ? 'BILD' : `BILD · ${esc(l.slot).toUpperCase()}`}</text>`);
    } else if (l.type === 'text') {
      const content = l.transform === 'uppercase' ? l.defaultText.toLocaleUpperCase('de-DE') : l.defaultText;
      defs.push(`<rect id="f-${l.id}" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"/>`);
      const style = `${FONT_STYLE[l.fontFamily](l.fontWeight)};font-size:${l.sizePx}px;line-height:${l.lineHeight};letter-spacing:${n(l.letterSpacingEm * l.sizePx)}px;fill:${l.color};text-align:${l.align};text-anchor:${l.align === 'center' ? 'middle' : l.align === 'right' ? 'end' : 'start'};shape-inside:url(#f-${l.id})`;
      body.push(`<text xml:space="preserve" style="${style}"><tspan>${esc(content)}</tspan></text>`);
    } else if (l.type === 'logo') {
      const file = l.variant === 'light' ? 'cypher-kollektiv-hell.svg' : 'cypher-kollektiv-dunkel.svg';
      body.push(`<image x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" preserveAspectRatio="xMidYMid meet" xlink:href="../../../../shared/brand/logos/${file}"/>`); // relativ zu .work, damit auch Inkscape in der WSL die Datei findet
    } else if (l.type === 'scanlines') {
      body.push(`<g opacity="${l.opacity}">${Array.from({ length: Math.floor(H / l.spacingPx) }, (_, i) => `<rect y="${i * l.spacingPx}" width="${W}" height="1" fill="#000"/>`).join('')}</g>`);
    }
    // grain: im Editor zufällig gezeichnet, in der Vorschau weggelassen
  }
  return svgDoc(W, H, defs.join(''), body.join(''));
}

function svgDoc(W, H, defs, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>\n`;
}

/** Format-Karte: Papierfläche in echtem Seitenverhältnis, Hilfslinien in Tiefcyan, Beschriftung. */
function formatSvg(t, formats) {
  const f = t.format;
  const aspect = f.widthPx / f.heightPx;
  const W = 360; // feste Kachel; die Formatfläche liegt darin in echtem Seitenverhältnis
  const H = 480;
  const programLabel = { krita: 'KRITA', inkscape: 'INKSCAPE', kdenlive: 'KDENLIVE' }[t.programId] ?? 'STUDIO';
  const body = [];
  const defs = [];
  body.push(`<rect width="${W}" height="${H}" fill="${INK}"/>`);
  const pad = 22;
  const areaW = W - 2 * pad;
  const areaH = H - 64 - 56;
  const fw = Math.round(Math.min(areaW, areaH * aspect));
  const fh = Math.round(Math.min(areaH, areaW / aspect));
  const fx = pad + Math.round((areaW - fw) / 2);
  const fy = 64 + Math.round((areaH - fh) / 2);
  defs.push('<pattern id="schach" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#e7e6e0"/><rect width="10" height="10" fill="#d6d6d6"/><rect x="10" y="10" width="10" height="10" fill="#d6d6d6"/></pattern>');
  const transparent = t.programId !== 'kdenlive' && t.tags.some((x) => ['shirt', 'hoodie', 'druck', 'sticker'].includes(x));
  body.push(`<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="${transparent ? 'url(#schach)' : '#e7e6e0'}"/>`);
  const guide = (x1, y1, x2, y2) => body.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${DEEP}" stroke-width="2" stroke-dasharray="8 6"/>`);
  const entry = formats.print.find((p) => t.printProfileId && p.profileId === t.printProfileId) ?? null;
  if (entry) {
    const sx = fw / entry.widthMm;
    const sy = fh / entry.heightMm;
    for (const g of entry.guidesMm.vertical) guide(fx + g.at * sx, fy, fx + g.at * sx, fy + fh);
    for (const g of entry.guidesMm.horizontal) guide(fx, fy + g.at * sy, fx + fw, fy + g.at * sy);
  } else if (t.id.startsWith('poster')) {
    const p = formats.poster;
    const sx = fw / p.widthMm;
    const sy = fh / p.heightMm;
    guide(fx + p.bleedMm * sx, fy, fx + p.bleedMm * sx, fy + fh);
    guide(fx + (p.widthMm - p.bleedMm) * sx, fy, fx + (p.widthMm - p.bleedMm) * sx, fy + fh);
    guide(fx, fy + p.bleedMm * sy, fx + fw, fy + p.bleedMm * sy);
    guide(fx, fy + (p.heightMm - p.bleedMm) * sy, fx + fw, fy + (p.heightMm - p.bleedMm) * sy);
  } else if (t.target === 'program' && formats.social.some((s) => t.id.startsWith(`${s.id}-`))) {
    const s = formats.social.find((x) => t.id.startsWith(`${x.id}-`));
    for (const g of s.guidesPx.vertical) guide(fx + (g.at / s.widthPx) * fw, fy, fx + (g.at / s.widthPx) * fw, fy + fh);
    for (const g of s.guidesPx.horizontal) guide(fx, fy + (g.at / s.heightPx) * fh, fx + fw, fy + (g.at / s.heightPx) * fh);
  } else if (t.programId === 'kdenlive') {
    ['Untertitel', 'Titel', 'Video', 'Originalton', 'Musik'].forEach((name, i) => {
      const step = Math.round((fh - 32) / 5);
      const y = fy + 16 + i * step;
      body.push(`<rect x="${fx + 10}" y="${y}" width="${fw - 20}" height="${step - 10}" fill="${i < 3 ? '#cfcec7' : '#bdbcb4'}"/>`);
      body.push(`<text x="${fx + 18}" y="${y + 28}" style="${FONT_STYLE['Atkinson Hyperlegible Next'](700)};font-size:19px;fill:${INK}">${name}</text>`);
    });
  } else {
    const sc = fx + fw / 2;
    guide(sc, fy, sc, fy + fh);
  }
  const shortTitle = t.title.replace(/ \((Krita|Inkscape|Kdenlive)\)/, '').toUpperCase();
  body.push(`<text x="${pad}" y="40" style="${FONT_STYLE.Anybody(800)};font-size:${shortTitle.length > 14 ? 24 : 30}px;fill:${PAPER}">${esc(shortTitle)}</text>`);
  body.push(`<text x="${pad}" y="${H - 38}" style="${FONT_STYLE['Martian Mono'](500)};font-size:19px;fill:${CYAN}">${esc(f.label)}${f.dpi ? ` · ${f.dpi} dpi` : ''}</text>`);
  body.push(`<text x="${pad}" y="${H - 14}" style="${FONT_STYLE['Martian Mono'](500)};font-size:19px;fill:${PAPER}">${programLabel}</text>`);
  return svgDoc(W, H, defs.join(''), body.join(''));
}

function collect() {
  const formats = readJson(join(PACKS, 'shared', 'formats.json'));
  const jobs = [];
  for (const dir of readdirSync(join(PACKS, 'social')).sort()) {
    const file = join(PACKS, 'social', dir, 'template.json');
    if (!existsSync(file)) continue;
    const t = readJson(file);
    jobs.push({ key: `social-${t.id}`, svg: socialSvg(t), width: Math.round(t.size.width / 2), targets: [join(PACKS, 'social', dir, 'preview.png'), join(PACKS, 'projects', `social-${t.id}`, 'preview.png')] });
  }
  for (const dir of readdirSync(join(PACKS, 'projects')).sort()) {
    const file = join(PACKS, 'projects', dir, 'template.json');
    if (!existsSync(file) || dir.startsWith('social-')) continue;
    const t = readJson(file);
    const svg = formatSvg(t, formats);
    const width = Number(/viewBox="0 0 (\d+) /.exec(svg)?.[1] ?? 400);
    jobs.push({ key: `projekt-${t.id}`, svg, width, targets: [join(PACKS, 'projects', dir, 'preview.png')] });
  }
  return jobs;
}

function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const jobs = collect();
  const list = [];
  for (const j of jobs) {
    writeFileSync(join(WORK, `${j.key}.svg`), j.svg);
    list.push(`${j.key}.svg ${j.width}`);
  }
  writeFileSync(join(WORK, 'list.txt'), `${list.join('\n')}\n`);
  const wslWork = `/mnt/${WORK[0].toLowerCase()}${WORK.slice(2).replaceAll('\\', '/')}`;
  const wslScript = `/mnt/${PACKS[0].toLowerCase()}${PACKS.slice(2).replaceAll('\\', '/')}/tools/authoring/wsl/render-previews.sh`;
  const res = spawnSync('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-l', wslScript, wslWork], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  process.stdout.write(res.stdout ?? '');
  if (res.status !== 0) {
    process.stderr.write(res.stderr ?? '');
    process.exit(res.status ?? 1);
  }
  for (const j of jobs) {
    const png = join(WORK, `${j.key}.png`);
    if (!existsSync(png)) throw new Error(`Vorschau fehlt: ${j.key}`);
    for (const target of j.targets) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(png, target);
    }
  }
  console.log(`${jobs.length} Vorschauen geschrieben`);
}

main();
