// Strichzeichnungen als eigenständige SVG-Dateien (für <img>): Die Zeichnungen in drawings.mjs benutzen Klassen,
// hier werden daraus Darstellungsattribute mit den echten Farben der Tokens. Gründe: Als Bilddateien liegen die
// Zeichnungen nicht im HTML (die Startseite ist über 20 KB kleiner, ~750 Elemente weniger beim Parsen, Bilder laden
// träge), und Darstellungsattribute funktionieren auch unter der strengen CSP ohne <style>.
// Schriften: SVG als Bild kann keine Webschriften der Seite nutzen, die Beschriftung fällt auf Systemschriften zurück.
import { drawings } from './drawings.mjs';

const SANS = "Atkinson Hyperlegible Next, Segoe UI, system-ui, -apple-system, sans-serif";
const MONO = "Martian Mono, Cascadia Mono, Consolas, ui-monospace, Menlo, monospace";

/** Attribute je Klasse; Farben aus den Tokens (siehe site.css :root). */
function classAttrs(t) {
  const hair = { 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' };
  return {
    dl: { fill: 'none', stroke: t.ink, ...hair },
    dp: { fill: t.field, stroke: t.ink, ...hair },
    dh: { fill: t.cyan, stroke: t.ink, ...hair },
    dg: { fill: t.line, stroke: 'none' },
    dbar: { fill: t.line, stroke: t.ink, ...hair },
    dx: { fill: t.ink, stroke: t.ink, ...hair },
    dk: { fill: 'none', stroke: t.ink, 'stroke-dasharray': '3 3', ...hair },
    dt: { fill: t.ink, 'font-family': SANS, 'font-size': 11.5, 'font-weight': 600 },
    dm: { fill: t.ink, 'font-family': MONO, 'font-size': 9.5 },
    dterm: { fill: t.ink, stroke: t.ink },
    dtbar: { fill: '#2e2e2b' },
    dtd: { fill: '#a3a29d' },
    dtm: { fill: t.paper, 'font-family': MONO, 'font-size': 10.5 },
    dtc: { fill: t.cyan, 'font-family': MONO, 'font-size': 10.5 },
    dtd2: { fill: '#a3a29d', 'font-family': MONO, 'font-size': 10.5 },
    dink: { fill: t.ink, stroke: t.ink },
    dink2: { fill: t.ink },
    dgi: { fill: '#5d5c58' },
    dumf: { fill: t.umfeld, stroke: t.ink, ...hair },
    dpaper: { fill: t.paper, stroke: 'none' },
    dmess: { fill: 'none', stroke: t.cyanDeep, 'stroke-dasharray': '4 3', ...hair },
    dpanel: { fill: t.panel, stroke: t.ink, ...hair },
    dok: { fill: t.ok, stroke: t.ink, ...hair },
    dhatch: { fill: t.ink, 'fill-opacity': 0.13, stroke: t.ink, 'stroke-dasharray': '2 3', ...hair },
  };
}

const attrString = (o) => Object.entries(o).map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`).join(' ');

/** Liest die Farb-Tokens aus dem :root-Block des Stylesheets (eine Quelle für Seite und Zeichnungen). */
export function readTokens(css) {
  const get = (name) => {
    const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    if (!m) throw new Error(`Token ${name} nicht gefunden`);
    return m[1];
  };
  return {
    ink: get('--ink'), paper: get('--paper'), cyan: get('--cyan'), cyanDeep: get('--cyan-deep'), panel: get('--panel'),
    field: get('--field'), line: get('--line'), umfeld: get('--umfeld'), ok: get('--ok'),
  };
}

export const drawingNames = Object.keys(drawings);

/** Standalone-SVG: Größe aus dem viewBox, Hintergrund in Panel-Farbe, Klassen → Attribute. */
export function drawingFile(name, tokens) {
  const src = drawings[name];
  if (!src) throw new Error(`Unbekannte Zeichnung: ${name}`);
  const vb = /viewBox="([^"]+)"/.exec(src)[1];
  const [, , w, h] = vb.split(/\s+/).map(Number);
  const attrs = classAttrs(tokens);
  const inner = src.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/ class="([a-z0-9]+)"/g, (all, c) => {
    if (!attrs[c]) throw new Error(`Zeichnung ${name}: Klasse ${c} ohne Attribute`);
    return ` ${attrString(attrs[c])}`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${tokens.panel}"/>${inner}</svg>\n`;
}

export function drawingSize(name) {
  const [, , w, h] = /viewBox="([^"]+)"/.exec(drawings[name])[1].split(/\s+/).map(Number);
  return { w, h };
}
