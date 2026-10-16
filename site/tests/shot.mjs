// Einzelschuss für die Arbeit am Entwurf: node tests/shot.mjs <pfad> <breite>x<höhe> <datei.png> [--full] [--ua windows|macos|linux|android|ios] [--scroll <px>] [--at <selektor> [--plus <px>]] [--dark]
// Läuft gegen BASE (Standard http://127.0.0.1:8788) ohne Suchlauf (Standbild).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { UA, applyUa } from './helpers.mjs';

const [, , path = '/', size = '1440x900', out = 'shots/tmp.png', ...rest] = process.argv;
const [w, h] = size.split('x').map(Number);
const full = rest.includes('--full');
const uaKey = rest.includes('--ua') ? rest[rest.indexOf('--ua') + 1] : 'windows';
const scroll = rest.includes('--scroll') ? Number(rest[rest.indexOf('--scroll') + 1]) : 0;
const at = rest.includes('--at') ? rest[rest.indexOf('--at') + 1] : null;
const plus = rest.includes('--plus') ? Number(rest[rest.indexOf('--plus') + 1]) : 0;
const base = process.env.BASE || 'http://127.0.0.1:8788';

mkdirSync(dirname(out), { recursive: true });
const browser = await chromium.launch();
const mobile = uaKey === 'android' || uaKey === 'ios';
const ctx = await browser.newContext({
  viewport: { width: w, height: h }, deviceScaleFactor: 1, userAgent: UA[uaKey], isMobile: mobile && w < 800, hasTouch: mobile,
  colorScheme: rest.includes('--dark') ? 'dark' : 'light',
});
await ctx.addInitScript(() => { window.__cxStill = true; });
await applyUa(ctx, uaKey);
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base + path, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
if (at) { await page.evaluate(([sel, p]) => { const el = document.querySelector(sel); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + p); }, [at, plus]); await page.waitForTimeout(400); }
if (scroll) { await page.evaluate((y) => window.scrollTo(0, y), scroll); await page.waitForTimeout(300); }
await page.waitForTimeout(250);
await page.screenshot({ path: out, fullPage: full });
console.log(`${out} (${w}x${h}${full ? ', ganze Seite' : ''}, ${uaKey})${errors.length ? '\nKonsole: ' + errors.join(' | ') : ''}`);
await browser.close();
