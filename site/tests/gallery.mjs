// Alle Strichzeichnungen auf einer Fläche (zur Sichtprüfung): node tests/gallery.mjs [ausgabe.png]
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { drawings } from '../src/templates/drawings.mjs';
import { siteRoot } from './helpers.mjs';

const dist = join(siteRoot, 'dist/assets');
const css = readFileSync(join(dist, 'css', readdirSync(join(dist, 'css'))[0]), 'utf8')
  .replace(/url\(\/assets\/fonts\/([^)]+)\)/g, (_, f) => `url(${pathToFileURL(join(dist, 'fonts', f)).href})`);
const html = `<style>${css} body{padding:24px;display:grid;grid-template-columns:repeat(3,420px);gap:24px} figure{margin:0} figcaption{font:11px monospace;margin-top:4px}</style>` +
  Object.entries(drawings).map(([k, v]) => `<figure>${v}<figcaption>${k}</figcaption></figure>`).join('');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.setContent(html);
await page.waitForTimeout(500);
await page.screenshot({ path: process.argv[2] ?? 'shots/tmp/gallery.png', fullPage: true });
await browser.close();
