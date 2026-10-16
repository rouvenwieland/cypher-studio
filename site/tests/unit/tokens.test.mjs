// Die Farben der Seite stimmen mit docs/tokens.css (Familie, Kanal 3) überein, und alle Textpaare erfüllen WCAG AA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { siteRoot } from '../helpers.mjs';

const site = readFileSync(join(siteRoot, 'src/css/site.css'), 'utf8');
const tokens = readFileSync(join(siteRoot, '../docs/tokens.css'), 'utf8');
const escapeRe = (s) => s.replace(/[-]/g, '\\-');
const val = (css, name) => new RegExp(`${escapeRe(name)}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();

// Name auf der Seite → Name in docs/tokens.css
const mapping = {
  '--ink': '--c-ink', '--paper': '--c-paper', '--c-news': '--c-news', '--c-shop': '--c-shop',
  '--cyan': '--c-studio', '--cyan-deep': '--c-studio-deep',
  '--panel': '--panel', '--field': '--field', '--line': '--line', '--control': '--control', '--mute': '--mute',
  '--umfeld': '--surround-hell', '--ok': '--ok-surface', '--warn': '--warn-surface',
  '--textil': '--c-textil-schwarz', '--rauschen': '--c-rauschen',
};
for (const [mine, theirs] of Object.entries(mapping)) {
  test(`Token ${mine} entspricht docs/tokens.css ${theirs}`, () => {
    const a = val(site, mine);
    const b = val(tokens, theirs);
    assert.ok(a && b, `Wert fehlt: ${mine}=${a} ${theirs}=${b}`);
    assert.equal(a, b);
  });
}

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const t = (n) => val(site, n);

const pairs = [
  ['Tinte auf Cyan (Kennung, Lead)', t('--ink'), t('--cyan'), 4.5],
  ['Tinte auf Orange (Suchlauf)', t('--ink'), t('--c-news'), 4.5],
  ['Tinte auf Gelb (Suchlauf)', t('--ink'), t('--c-shop'), 4.5],
  ['Papier auf Tinte (Download-Balken)', t('--paper'), t('--ink'), 4.5],
  ['Cyan auf Tinte (Beschriftung im Balken)', t('--cyan'), t('--ink'), 4.5],
  ['Tiefcyan auf Papier (Messfarbe)', t('--cyan-deep'), t('--paper'), 4.5],
  ['Tiefcyan auf Umfeld hell (Lineal)', t('--cyan-deep'), t('--umfeld'), 4.5],
  ['Papier auf Tiefcyan (Maß-Chip)', t('--paper'), t('--cyan-deep'), 4.5],
  ['Stumm auf Papier', t('--mute'), t('--paper'), 4.5],
  ['Stumm auf Panel', t('--mute'), t('--panel'), 4.5],
  ['Stumm auf Feld', t('--mute'), t('--field'), 4.5],
  ['Tinte auf Grün (Urteil)', t('--ink'), t('--ok'), 4.5],
  ['Tinte auf Bernstein (Achtung)', t('--ink'), t('--warn'), 4.5],
  ['Rauschen-Gelb auf Textil Schwarz (Motiv)', t('--rauschen'), t('--textil'), 4.5],
  ['Steuerkante auf Papier (Bedienelemente)', t('--control'), t('--paper'), 3],
];
for (const [name, fg, bg, min] of pairs) {
  test(`Kontrast ${name} mindestens ${min}:1`, () => {
    const r = ratio(fg, bg);
    assert.ok(r >= min, `${name}: ${r.toFixed(2)}:1 (${fg} auf ${bg})`);
  });
}

test('keine Farbwerte außerhalb der Token-Zeilen im CSS (außer den Grautönen der Terminal-Zeichnung)', () => {
  const body = site.replace(/:root\s*\{[\s\S]*?\n\}/, '');
  const stray = [...body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
  const allowed = new Set(['#2e2e2b', '#a3a29d', '#5d5c58', '#3a3a38', '#00d4d8', '#0d0d0d']); // die beiden letzten: initial-value von @property muss ein Literal sein
  assert.deepEqual(stray.filter((c) => !allowed.has(c)), []);
});
