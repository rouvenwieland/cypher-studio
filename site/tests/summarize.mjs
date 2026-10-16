// Kurzfassung eines Playwright-JSON-Berichts: node tests/summarize.mjs <datei.json>
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let pass = 0; const fails = [];
(function walk(suite, path) {
  for (const s of suite.suites ?? []) walk(s, [...path, s.title]);
  for (const sp of suite.specs ?? []) {
    for (const t of sp.tests) {
      const res = t.results.at(-1);
      if (t.status === 'expected') pass++;
      else if (t.status === 'skipped') { /* übersprungen */ }
      else fails.push(`${sp.file}: ${sp.title}\n    ${String(res?.error?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').slice(0, 6).join('\n    ').slice(0, 700)}`);
    }
  }
})(r, []);
console.log(`bestanden ${pass}, fehlgeschlagen ${fails.length}`);
for (const f of fails) console.log('\n✖ ' + f);
