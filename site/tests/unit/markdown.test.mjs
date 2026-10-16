// Markdown-Pipeline: Kopfdaten, Container, Schritte, Zeichnungen, Platzhalter, Verbote.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontMatter, renderMarkdown, slugify } from '../../src/templates/markdown.mjs';

const tokens = { version: '0.4.0', file: { windows: 'Cypher-Studio_0.4.0_x64-setup.exe' } };

test('Kopfdaten werden getrennt', () => {
  const { data, body } = parseFrontMatter('---\ntitel: Eins\nreihenfolge: 2\n---\n## A\n');
  assert.equal(data.titel, 'Eins');
  assert.equal(data.reihenfolge, '2');
  assert.equal(body.trim(), '## A');
});

test('Überschriften bekommen deutsche IDs, doppelte werden nummeriert', () => {
  assert.equal(slugify('Das erste Motiv – Größe & Ärger'), 'das-erste-motiv-groesse-aerger');
  const { html, headings } = renderMarkdown('## Prüfen\n\n## Prüfen\n', { tokens });
  assert.deepEqual(headings.map((h) => h.id), ['pruefen', 'pruefen-2']);
  assert.match(html, /<h2 id="pruefen">/);
});

test('Platzhalter werden ersetzt, unbekannte brechen ab', () => {
  const { html } = renderMarkdown('Datei `{{file.windows}}` in {{version}}.', { tokens });
  assert.match(html, /Cypher-Studio_0\.4\.0_x64-setup\.exe/);
  assert.match(html, /in 0\.4\.0\./);
  assert.throws(() => renderMarkdown('{{file.amiga}}', { tokens }), /Unbekannter Platzhalter/);
});

const steps = [
  ':::::schritte',
  '::::schritt Erster', 'Text A', '::::',
  '::::schritt-unsigned Zweiter', 'Text B', '::::',
  '::::schritt Dritter', 'Text C', '::::',
  ':::::',
].join('\n');

test('Schritte sind eine Liste mit Überschriften je Schritt', () => {
  const { html } = renderMarkdown(steps, { tokens, stepLevel: 4 });
  assert.match(html, /<ol class="steps">/);
  assert.equal((html.match(/<li class="step">/g) ?? []).length, 3);
  assert.match(html, /<h4 class="step-t">Zweiter<\/h4>/);
});

test('signiertes System: unsignierte Schritte entfallen', () => {
  const { html } = renderMarkdown(steps, { tokens, signed: true });
  assert.equal((html.match(/<li class="step">/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Zweiter/);
});

test('Hinweisboxen: hinweis, achtung, tipp, auch verschachtelt im Schritt', () => {
  const nested = ':::::schritte\n::::schritt X\nText\n\n:::achtung\nVorsicht\n:::\n::::\n:::::\n';
  const { html } = renderMarkdown(nested, { tokens });
  assert.match(html, /<aside class="note note-warn" role="note">/);
  assert.match(html, /Vorsicht/);
  const t = renderMarkdown(':::tipp\nT\n:::\n\n:::hinweis\nH\n:::\n', { tokens }).html;
  assert.match(t, /note-tip/);
  assert.match(t, /class="note"/);
  assert.throws(() => renderMarkdown(':::unbekannt\nx\n:::\n', { tokens }), /Unbekannter Container/);
});

test('Zeichnungen als Abbildung mit Bilddatei, nicht in einem Absatz', () => {
  const { html } = renderMarkdown('![Beschreibung](svg:win-datei)', { tokens });
  assert.match(html, /^<figure class="fig"><img class="draw" src="\/assets\/img\/win-datei\.svg" alt="Beschreibung" width="420" height="236" loading="lazy"/);
  assert.match(html, /<figcaption aria-hidden="true">Beschreibung<\/figcaption>/);
  assert.doesNotMatch(html, /<svg/);
  assert.doesNotMatch(html, /<p><figure/);
  assert.throws(() => renderMarkdown('![x](svg:gibt-es-nicht)', { tokens }));
  assert.throws(() => renderMarkdown('![x](https://example.org/a.png)', { tokens }), /nur als svg/);
});

test('Codeblöcke: escaped, mit Kopieren-Knopf (ohne Skript versteckt)', () => {
  const { html } = renderMarkdown('```sh\necho "<a>" && ls\n```', { tokens });
  assert.match(html, /<code>echo &quot;&lt;a&gt;&quot; &amp;&amp; ls<\/code>/);
  assert.match(html, /<button type="button" class="copy" data-copy hidden/);
});

test('rohes HTML ist verboten, kbd erlaubt, externe Links mit noopener', () => {
  assert.throws(() => renderMarkdown('<script>alert(1)</script>', { tokens }), /Rohes HTML/);
  assert.throws(() => renderMarkdown('Text <b>fett</b>', { tokens }), /Rohes HTML/);
  const { html } = renderMarkdown('Drücke <kbd>Strg</kbd> und [Link](https://example.org/).', { tokens });
  assert.match(html, /<kbd>Strg<\/kbd>/);
  assert.match(html, /rel="noopener noreferrer"/);
});
