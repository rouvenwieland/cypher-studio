// Kleiner lokaler Server für dist/ (ohne Konto, ohne wrangler): verhält sich wie Workers Static Assets
// (Verzeichnis → index.html, /pfad → /pfad/, unbekannt → 404.html mit Status 404), wendet public/_headers an
// und liefert Text komprimiert (Brotli oder gzip) aus wie Cloudflare. Dafür gedacht: Leistungsmessung mit
// echten Übertragungsgrößen (wrangler dev komprimiert nicht) und schnelles Ansehen.
//   node scripts/serve.mjs [--dir dist] [--port 8788]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values: v } = parseArgs({ options: { dir: { type: 'string', default: 'dist' }, port: { type: 'string', default: '8788' } } });
const dir = resolve(root, v.dir);
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const compressible = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt']);
const isFile = async (p) => { try { return (await stat(p)).isFile(); } catch { return false; } };

// _headers: Blöcke "Pfadmuster" + eingerückte "Name: Wert"-Zeilen
async function loadHeaders() {
  const rules = [];
  let current = null;
  for (const line of (await readFile(join(dir, '_headers'), 'utf8').catch(() => '')).split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const re = new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      current = { re, headers: [] };
      rules.push(current);
    } else if (current) {
      const i = line.indexOf(':');
      current.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
  }
  return rules;
}
const rules = await loadHeaders();
const cache = new Map();

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = join(dir, rel);
  if (!file.startsWith(dir)) { res.writeHead(400).end(); return; }
  if (!extname(file) && !url.pathname.endsWith('/') && await isFile(join(file, 'index.html'))) {
    res.writeHead(307, { Location: url.pathname + '/' + url.search }).end(); return;
  }
  if (url.pathname.endsWith('/')) file = join(file, 'index.html');
  let status = 200;
  if (!await isFile(file)) { file = join(dir, '404.html'); status = 404; }
  const ext = extname(file);
  const headers = { 'Content-Type': types[ext] || 'application/octet-stream' };
  const path = status === 404 ? '/404.html' : url.pathname;
  for (const r of rules) if (r.re.test(path)) for (const [k, val] of r.headers) headers[k] = headers[k] ? `${headers[k]}, ${val}` : val;
  let body = await readFile(file);
  const ae = String(req.headers['accept-encoding'] ?? '');
  if (compressible.has(ext)) {
    const enc = /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null;
    if (enc) {
      const key = `${enc}:${file}:${(await stat(file)).mtimeMs}`;
      if (!cache.has(key)) cache.set(key, enc === 'br' ? brotliCompressSync(body) : gzipSync(body, { level: 9 }));
      body = cache.get(key);
      headers['Content-Encoding'] = enc;
      headers.Vary = 'Accept-Encoding';
    }
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(body);
}).listen(Number(v.port), '127.0.0.1', () => console.log(`http://127.0.0.1:${v.port}/  (${dir})`));
