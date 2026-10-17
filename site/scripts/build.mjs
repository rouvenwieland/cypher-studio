// Baut die Seite nach dist/ (oder --out): Schriften/CSS/JS mit Inhalts-Hash, Markdown → HTML, Seiten,
// danach eine Prüfung (CSP ohne Inline-Code, noindex, Links, 24-MiB-Grenze). Keine Laufzeitabhängigkeit außer marked.
//
//   node scripts/build.mjs [--release public/release.json] [--out dist] [--no-check]
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRelease, readJson } from './lib/release.mjs';
import { lintDist } from './lib/lint.mjs';
import { drawingFile, drawingNames, readTokens } from '../src/templates/drawfile.mjs';
import { parseFrontMatter, renderMarkdown } from '../src/templates/markdown.mjs';
import { esc } from '../src/templates/layout.mjs';
import { home } from '../src/templates/home.mjs';
import { datenschutz, docPage, impressum, notFound } from '../src/templates/doc.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

const { values: v } = parseArgs({
  options: { release: { type: 'string' }, out: { type: 'string' }, 'no-check': { type: 'boolean' }, quiet: { type: 'boolean' } },
});
const out = resolve(root, v.out ?? 'dist');
const release = loadRelease(resolve(root, v.release ?? 'public/release.json'));
const config = readJson(join(root, 'site.config.json'));

const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);
const write = (rel, data) => {
  const p = join(out, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
};

// ── 1. Ordner leeren, public/ kopieren (ohne Schriften und Punktdateien) ────────────────────
// Inhalt leeren, den Ordner selbst behalten: unter Windows hält "wrangler dev" ein Handle darauf
function clean(dir) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { clean(p); try { rmSync(p, { recursive: true, force: true }); } catch { /* beobachtet: bleibt leer stehen */ } } else rmSync(p, { force: true });
  }
}
clean(out);
mkdirSync(out, { recursive: true });
cpSync(join(root, 'public'), out, {
  recursive: true,
  filter: (src) => {
    const rel = relative(join(root, 'public'), src);
    if (rel === 'fonts' || rel.startsWith(`fonts${sep}`)) return false;
    return !rel.split(sep).some((part) => part.startsWith('.'));
  },
});

// ── 1b. Signierter Programm-Katalog für die App (ARCHITEKTUR 5.8): /catalog/v1/catalog.json(+.minisig) ──
{
  const catDir = resolve(root, '..', 'catalog');
  for (const f of ['catalog.json', 'catalog.json.minisig']) {
    const src = join(catDir, f);
    if (!existsSync(src)) throw new Error(`Katalog fehlt: ${src}`);
    write(`catalog/v1/${f}`, readFileSync(src));
  }
}

// ── 2. Inhaltsgehashte Assets ──────────────────────────────────────────────────────────────
const assets = {};
for (const f of readdirSync(join(root, 'public/fonts'))) {
  const buf = readFileSync(join(root, 'public/fonts', f));
  if (f.endsWith('.woff2')) {
    const name = f.replace(/\.woff2$/, `.${hash(buf)}.woff2`);
    write(`assets/fonts/${name}`, buf);
    assets[`fonts/${f}`] = `/assets/fonts/${name}`;
  } else {
    write(`assets/fonts/${f}`, buf); // OFL-Texte
  }
}
/** Nur Kommentare entfernen und Leerraum verdichten (Leerzeichen in calc() bleiben als Einzelzeichen erhalten). */
const minifyCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/ ?([{};]) ?/g, '$1').trim();
let css = readFileSync(join(root, 'src/css/site.css'), 'utf8');
css = css.replace(/\{\{font:([a-z-]+)\}\}/g, (_, n) => {
  const url = assets[`fonts/${n}.woff2`];
  if (!url) throw new Error(`Schrift ${n} fehlt in public/fonts`);
  return url;
});
css = minifyCss(css);
{
  const name = `site.${hash(css)}.css`;
  write(`assets/css/${name}`, css);
  assets['css/site.css'] = `/assets/css/${name}`;
}
for (const n of ['boot', 'site']) {
  const buf = readFileSync(join(root, `src/js/${n}.js`));
  const name = `${n}.${hash(buf)}.js`;
  write(`assets/js/${name}`, buf);
  assets[`js/${n}.js`] = `/assets/js/${name}`;
}

// ── 3. Platzhalter für Markdown ────────────────────────────────────────────────────────────
const version = release.state === 'released' ? release.version : 'VERSION';
const fileOf = (os, kind) => (release.state === 'released' ? release.files.find((f) => f.os === os && f.kind === kind)?.name : undefined);
const pattern = (key) => config.filePatterns[key].replace('{version}', version);
const fileTokens = {
  windows: fileOf('windows', 'nsis') ?? pattern('windows'),
  macos: fileOf('macos', 'dmg') ?? pattern('macos'),
  'linux-appimage': fileOf('linux', 'appimage') ?? pattern('linux-appimage'),
  'linux-deb': fileOf('linux', 'deb') ?? pattern('linux-deb'),
  'linux-rpm': fileOf('linux', 'rpm') ?? pattern('linux-rpm'),
};
const tokens = { version, file: fileTokens };

// ── 4. Installationsblöcke (aus content/install/*.md), gleich auf Startseite und in der Anleitung ─
// Zeichnungen als SVG-Dateien mit Hash im Namen (Farben aus den Tokens der CSS-Quelle)
const drawTokens = readTokens(readFileSync(join(root, 'src/css/site.css'), 'utf8'));
for (const n of drawingNames) {
  const svg = drawingFile(n, drawTokens);
  const name = `${n}.${hash(svg)}.svg`;
  write(`assets/img/${name}`, svg);
  assets[`img/${n}.svg`] = `/assets/img/${name}`;
}
const imageUrl = (n) => assets[`img/${n}.svg`];

const OS_ORDER = ['windows', 'macos', 'linux'];
function installBlocks() {
  return OS_ORDER.map((os) => {
    const src = readFileSync(join(root, `content/install/${os}.md`), 'utf8');
    const { data, body } = parseFrontMatter(src);
    const signed = release.state === 'released' && release.signed?.[os] === true;
    const { html } = renderMarkdown(body, { tokens, signed, idPrefix: `${os}-`, stepLevel: 4, imageUrl });
    const kurz = signed ? data.kurzSigniert : data.kurz;
    return `<details class="os" id="${os}" name="os-install" data-os="${os}">
        <summary class="os-s"><h3 class="os-n">${esc(data.titel)}</h3><span class="os-k">${esc(kurz)}</span><span class="os-chev" aria-hidden="true"></span></summary>
        <div class="os-b">
          <p class="os-req"><span class="lbl">Voraussetzung</span> ${esc(config.requirements[os])}</p>
${html}
        </div>
      </details>`;
  }).join('\n      ');
}

// ── 5. Anleitungsseiten (content/*.md) ─────────────────────────────────────────────────────
const docs = readdirSync(join(root, 'content'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => {
    const slug = f.replace(/\.md$/, '');
    const { data, body } = parseFrontMatter(readFileSync(join(root, 'content', f), 'utf8'));
    for (const k of ['titel', 'beschreibung', 'lead', 'reihenfolge']) if (!data[k]) throw new Error(`content/${f}: Kopfdatum "${k}" fehlt`);
    const path = slug === 'anleitung' ? '/anleitung/' : `/anleitung/${slug}/`;
    return { slug, path, ...data, order: Number(data.reihenfolge), body };
  })
  .sort((a, b) => a.order - b.order);

const ctx = {
  release,
  config,
  assets,
  fileName: (key) => fileTokens[key],
  imageUrl,
  installBlocks: installBlocks(),
};

for (const d of docs) {
  const { html, headings } = renderMarkdown(d.body, { tokens, stepLevel: 3, imageUrl });
  d.html = html.replace('<p>@@install@@</p>', `<div class="os-list os-list-doc">\n      ${ctx.installBlocks}\n    </div>`);
  d.headings = headings;
  if (d.html.includes('@@install@@')) throw new Error(`${d.slug}: @@install@@ steht nicht allein in einem Absatz`);
}

// ── 6. Seiten schreiben ────────────────────────────────────────────────────────────────────
write('index.html', home(ctx));
for (const d of docs) write(`${d.path.slice(1)}index.html`, docPage(d, docs, ctx));
write('impressum/index.html', impressum(ctx));
write('datenschutz/index.html', datenschutz(ctx));
write('404.html', notFound(ctx));

if (!v.quiet) console.log(`gebaut: ${out} (Zustand ${release.state}${release.state === 'released' ? ` ${release.version}` : ''}, ${docs.length} Anleitungsseiten)`);

// ── 7. Prüfung ─────────────────────────────────────────────────────────────────────────────
if (!v['no-check']) {
  const { problems, fileCount, pageCount } = lintDist(out);
  if (problems.length) {
    console.error(['Prüfung fehlgeschlagen (' + problems.length + '):', ...problems.map((p) => '- ' + p)].join('\n'));
    process.exit(1);
  }
  if (!v.quiet) console.log(`Prüfung ok: ${pageCount} Seiten, ${fileCount} Dateien`);
}
