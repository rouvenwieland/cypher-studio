// Alle Strichzeichnungen auf einer Fläche (zur Sichtprüfung): node tests/gallery.mjs [ausgabe.png]
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drawingFile, drawingNames, readTokens } from '../src/templates/drawfile.mjs';
import { siteRoot } from './helpers.mjs';

const tokens = readTokens(readFileSync(join(siteRoot, 'src/css/site.css'), 'utf8'));
const html = '<style>body{padding:24px;display:grid;grid-template-columns:repeat(3,420px);gap:24px;background:#efeee9} figure{margin:0} figcaption{font:11px monospace;margin-top:4px}</style>' +
  drawingNames.map((k) => `<figure>${drawingFile(k, tokens)}<figcaption>${k}</figcaption></figure>`).join('');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.setContent(html);
await page.waitForTimeout(300);
await page.screenshot({ path: process.argv[2] ?? 'shots/tmp/gallery.png', fullPage: true });
await browser.close();
