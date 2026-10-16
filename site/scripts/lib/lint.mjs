// Prüfung des gebauten Ordners: CSP ohne Inline-Code, noindex, ein h1, Links und Anker, 24-MiB-Grenze.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { MAX_FILE_BYTES } from './release.mjs';

/** @returns {{problems: string[], fileCount: number, pageCount: number}} */
export function lintDist(out) {
  const problems = [];
  const files = [];
  (function walk(dir) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  })(out);
  const rel = (p) => '/' + relative(out, p).split(sep).join('/');

  for (const p of files) {
    if (statSync(p).size > MAX_FILE_BYTES) problems.push(`${rel(p)} ist größer als 24 MiB (Workers Static Assets: 25 MiB je Datei)`);
  }

  const htmlFiles = files.filter((p) => p.endsWith('.html'));
  const idsOf = new Map();
  const pages = new Map();
  for (const p of htmlFiles) {
    const html = readFileSync(p, 'utf8');
    pages.set(p, html);
    idsOf.set(p, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  const resolveTarget = (href) => {
    const clean = href.split('#')[0].split('?')[0];
    if (!clean) return null;
    const direct = join(out, clean);
    if (clean.endsWith('/')) return join(direct, 'index.html');
    return direct;
  };

  for (const [p, html] of pages) {
    const name = rel(p);
    if (/\sstyle\s*=/.test(html)) problems.push(`${name}: style-Attribut (CSP erlaubt kein Inline-CSS)`);
    if (/<style[\s>]/i.test(html)) problems.push(`${name}: <style>-Element (CSP)`);
    if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(html)) problems.push(`${name}: Inline-Skript (CSP)`);
    if (/\son[a-z]+\s*=\s*["']/i.test(html)) problems.push(`${name}: Ereignis-Attribut (CSP)`);
    if (/javascript:/i.test(html)) problems.push(`${name}: javascript:-Link`);
    if (!/<meta name="robots" content="noindex, nofollow">/.test(html)) problems.push(`${name}: noindex-Meta fehlt`);
    const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
    if (h1 !== 1) problems.push(`${name}: ${h1} h1-Elemente`);
    if (!/<html lang="de">/.test(html)) problems.push(`${name}: lang="de" fehlt`);
    const ids = idsOf.get(p);
    const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const dup = all.filter((id, i) => all.indexOf(id) !== i);
    if (dup.length) problems.push(`${name}: doppelte IDs ${[...new Set(dup)].join(', ')}`);

    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|data:)/.test(href)) continue;
      if (href.startsWith('#')) {
        if (href !== '#' && !ids.has(href.slice(1))) problems.push(`${name}: Anker ${href} gibt es nicht`);
        continue;
      }
      if (!href.startsWith('/')) { problems.push(`${name}: relativer Link ${href}`); continue; }
      const target = resolveTarget(href);
      if (target && !existsSync(target)) {
        // Dateien unter /releases/ liegen erst beim Deploy dort (siehe site.yml), dürfen hier fehlen
        if (href.startsWith('/releases/')) continue;
        problems.push(`${name}: Ziel ${href} gibt es nicht`);
      }
      const frag = href.split('#')[1];
      if (frag && target && existsSync(target)) {
        const tIds = idsOf.get(target);
        if (tIds && !tIds.has(frag)) problems.push(`${name}: Anker ${href} gibt es nicht`);
      }
    }
  }
  return { problems, fileCount: files.length, pageCount: htmlFiles.length };
}
