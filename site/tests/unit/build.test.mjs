// Der Bau: beide Zustände, signierte Systeme, Prüfung (CSP, noindex, Links), Dateien mit Hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { lintDist } from '../../scripts/lib/lint.mjs';
import { fixture, siteRoot } from '../helpers.mjs';
import { readJson } from '../../scripts/lib/release.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'cs-build-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

function build(name, releasePath) {
  const out = join(tmp, name);
  const args = [join(siteRoot, 'scripts/build.mjs'), '--out', out, '--quiet'];
  if (releasePath) args.push('--release', releasePath);
  execFileSync(process.execPath, args, { encoding: 'utf8' });
  return out;
}
const read = (out, p) => readFileSync(join(out, p), 'utf8');

const a = build('a', fixture('release-a.json')); // Zustand A aus der Fixture, unabhängig vom echten public/release.json
const b = build('b', fixture('release-b.json'));
const signedPath = join(tmp, 'release-signed.json');
writeFileSync(signedPath, JSON.stringify({ ...readJson(fixture('release-b.json')), signed: { windows: true, macos: true } }));
const s = build('s', signedPath);

test('Zustand A: keine toten Knöpfe, ehrlicher Hinweis, Anleitung bleibt', () => {
  const html = read(a, 'index.html');
  assert.match(html, /Die erste Version erscheint in Kürze\./);
  assert.doesNotMatch(html, /<a[^>]*\sdownload[\s>=]/);
  assert.doesNotMatch(html, /\.exe"/);
  assert.match(html, /Sobald die erste Version erscheint/);
  assert.match(html, /id="windows"/);
  assert.match(html, /Weitere Informationen/);
  // Platzhalter-Dateinamen mit VERSION
  assert.match(html, /Cypher-Studio_VERSION_x64-setup\.exe/);
});

test('Zustand B: echte Links, Größen, Prüfsummen in Vierergruppen', () => {
  const html = read(b, 'index.html');
  const rel = readJson(fixture('release-b.json'));
  for (const f of rel.files) {
    assert.ok(html.includes(`href="${f.url}"`), `Link ${f.url}`);
    assert.ok(html.includes(`data-copy-hash="${f.sha256}"`), `Prüfsumme ${f.name}`);
  }
  assert.doesNotMatch(html, /Die erste Version erscheint in Kürze/);
  assert.match(html, /Cypher Studio für Windows laden/);
  assert.match(html, /Version 0\.4\.0/);
  assert.match(html, /Get-FileHash \.\\Cypher-Studio_0\.4\.0_x64-setup\.exe -Algorithm SHA256/);
  assert.equal((html.match(/class="grp"/g) ?? []).length, 5 * 16);
});

test('signierte Systeme: die Warnungs-Schritte entfallen', () => {
  const html = read(s, 'index.html');
  assert.doesNotMatch(html, /Auf „Weitere Informationen“ klicken/);
  assert.doesNotMatch(html, /Dennoch öffnen/);
  assert.doesNotMatch(html, /Warum dein System warnt/);
  assert.match(html, /Signiert · öffnet ohne Warnung/);
  assert.match(html, /Beglaubigt · öffnet ohne Warnung/);
  // unverändert bleibt: Setup öffnen, Installation abschließen
  assert.match(html, /Setup-Datei öffnen/);
});

test('alle Seiten: noindex, ein h1, keine Platzhalter, kein Inline-Code', () => {
  for (const out of [a, b]) {
    for (const p of ['index.html', 'anleitung/index.html', 'anleitung/motiv-zu-shirtigo/index.html', 'anleitung/social-und-reels/index.html', 'anleitung/modell-zu-shop/index.html', 'impressum/index.html', 'datenschutz/index.html', '404.html']) {
      const html = read(out, p);
      assert.match(html, /<meta name="robots" content="noindex, nofollow">/, p);
      assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, p);
      assert.doesNotMatch(html, /\{\{|@@install@@|undefined|\[object/, p);
      assert.doesNotMatch(html, /\sstyle=|<style|\son\w+=/, p);
    }
  }
});

test('Dateien mit Inhalts-Hash, Schriften lokal, keine fremden Adressen', () => {
  const html = read(a, 'index.html');
  assert.match(html, /\/assets\/css\/site\.[0-9a-f]{10}\.css/);
  assert.match(html, /\/assets\/js\/boot\.[0-9a-f]{10}\.js/);
  const hosts = new Set([...html.matchAll(/(?:href|src)="(https?:\/\/[^"/]+)/g)].map((m) => m[1]));
  // erlaubt: nur Verweise (Links), nie geladene Ressourcen
  const loaded = [...html.matchAll(/<(?:link rel="(?:stylesheet|preload|icon)"|script)[^>]*(?:href|src)="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(loaded, [], `geladene Fremdquellen: ${[...hosts].join(', ')}`);
  const css = read(a, readdirSync(join(a, 'assets/css')).map((f) => `assets/css/${f}`)[0]);
  assert.doesNotMatch(css, /https?:\/\//);
  assert.doesNotMatch(css, /\{\{/);
  assert.ok(readdirSync(join(a, 'assets/fonts')).filter((f) => f.endsWith('.woff2')).length === 3);
  assert.ok(readdirSync(join(a, 'assets/fonts')).filter((f) => f.endsWith('OFL.txt')).length === 3, 'OFL-Texte liegen bei den Schriften');
});

test('Bau liefert robots, Header, Favicon, Platzhalterordner und kein Punkt-Datei-Müll', () => {
  for (const f of ['robots.txt', '_headers', 'favicon.svg', 'release.json']) assert.ok(existsSync(join(a, f)), f);
  assert.ok(!existsSync(join(a, 'releases/.gitkeep')));
  const hdr = read(a, '_headers');
  assert.match(hdr, /X-Robots-Tag: noindex, nofollow/);
  assert.match(hdr, /Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'/);
  assert.doesNotMatch(hdr, /unsafe-inline|unsafe-eval/);
});

test('die Prüfung findet Inline-CSS, Inline-Skript, kaputte Links und Anker, fehlendes noindex', () => {
  const bad = build('bad');
  const p = join(bad, 'index.html');
  const html = readFileSync(p, 'utf8')
    .replace('<body', '<body style="color:red"')
    .replace('</body>', '<script>alert(1)</script><a href="/gibt-es-nicht/">x</a><a href="#nirgends">y</a><a href="/anleitung/#nirgends">z</a></body>')
    .replace('<meta name="robots" content="noindex, nofollow">', '');
  writeFileSync(p, html);
  const { problems } = lintDist(bad);
  const text = problems.join(' | ');
  for (const needle of ['style-Attribut', 'Inline-Skript', '/gibt-es-nicht/', 'Anker #nirgends', 'Anker /anleitung/#nirgends', 'noindex-Meta fehlt']) {
    assert.ok(text.includes(needle), `nicht gemeldet: ${needle} in ${text}`);
  }
  // ein sauberer Bau meldet nichts
  assert.deepEqual(lintDist(a).problems, []);
  assert.deepEqual(lintDist(b).problems, []);
});

test('zu große Datei im gebauten Ordner wird gemeldet (24 MiB)', () => {
  const big = build('big');
  writeFileSync(join(big, 'releases-test.bin'), Buffer.alloc(25 * 1024 * 1024));
  assert.match(lintDist(big).problems.join(' | '), /größer als 24 MiB/);
});
