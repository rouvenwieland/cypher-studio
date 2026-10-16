// Gemeinsame Hilfen der Browser-Tests.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UA, applyUa, fixture, siteRoot } from '../helpers.mjs';

export const A = process.env.BASE_A ?? 'http://127.0.0.1:8788';
export const B = process.env.BASE_B ?? 'http://127.0.0.1:38789';
// Leistungsmessung läuft gegen scripts/serve.mjs (Brotli wie Cloudflare), siehe tests/run.mjs
export const PERF_A = process.env.PERF_A ?? 'http://127.0.0.1:38790';
export const PERF_B = process.env.PERF_B ?? 'http://127.0.0.1:38791';
export const release = JSON.parse(readFileSync(fixture('release-b.json'), 'utf8'));
export const axePath = join(siteRoot, 'node_modules/axe-core/axe.min.js');

/** Alle Seiten der Site (ohne Dateien). */
export const PAGES = [
  ['start', '/'],
  ['anleitung', '/anleitung/'],
  ['motiv-zu-shirtigo', '/anleitung/motiv-zu-shirtigo/'],
  ['social-und-reels', '/anleitung/social-und-reels/'],
  ['modell-zu-shop', '/anleitung/modell-zu-shop/'],
  ['impressum', '/impressum/'],
  ['datenschutz', '/datenschutz/'],
  ['404', '/gibt-es-nicht/'],
];

/**
 * Neuer Kontext mit Betriebssystem-Kennung (User-Agent und userAgentData wie ein echter Browser).
 * still: kein Suchlauf (Standbild), Standard für alles außer den Suchlauf-Tests.
 */
export async function open(browser, { ua = 'windows', viewport = { width: 1440, height: 900 }, still = true, bypassCSP = false, ...rest } = {}) {
  const mobile = ua === 'android' || ua === 'ios';
  const context = await browser.newContext({
    viewport, userAgent: UA[ua], bypassCSP, deviceScaleFactor: 1,
    isMobile: mobile && viewport.width < 800, hasTouch: mobile, locale: 'de-DE', timezoneId: 'Europe/Berlin', ...rest,
  });
  if (still) await context.addInitScript(() => { window.__cxStill = true; });
  await applyUa(context, ua);
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return context;
}

/** Sammelt Konsolenfehler, Warnungen und Seitenfehler. */
export function watch(page) {
  const log = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
  return log;
}

export async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}
