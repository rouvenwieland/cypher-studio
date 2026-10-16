// Messspur-Szene: scroll-gesteuert (CSS scroll-driven animations), Endzustand bei reduzierter Bewegung und auf dem Handy.
import { test, expect } from '@playwright/test';
import { B, open, settle } from './util.mjs';

// Die Zahlen stehen als registrierte Eigenschaften (@property, integer) im Element; der Zähler zeigt sie als Text
const MAP = { '.mc-n-w': '--mm-w', '.mc-n-h': '--mm-h', '.mc-n-mw': '--mm-mw', '.mc-n-mh': '--mm-mh' };
const content = (page, sel) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s)).getPropertyValue(p).trim(), [sel, MAP[sel]]);
const scrollPin = (page, frac) => page.evaluate((f) => {
  const t = document.querySelector('.scene-track');
  window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY + f * (t.offsetHeight - innerHeight));
}, frac);
const opacity = (page, sel) => page.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)).opacity), sel);

test('Desktop: Lineale zählen am Scrollweg bis 330 und 450 mm, Maßchip bis 280,0 × 312,0, am Ende DRUCKBEREIT', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await settle(page);
  const supported = await page.evaluate(() => CSS.supports('animation-timeline', 'view()'));
  test.skip(!supported, 'Browser ohne scroll-driven animations: Endzustand-Fallback, siehe nächster Test');

  // Anfang der festen Phase: alles bei 0
  await scrollPin(page, 0);
  await page.waitForTimeout(250);
  expect(await content(page, '.mc-n-w')).toBe('0');
  expect(await opacity(page, '.verdict-ok')).toBe(0);
  // noch nicht gemessene Regeln stehen gedämpft (Stumm-Farbe, 5,5:1), erfüllte in Tinte
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.rule.r1')).color)).toBe('rgb(91, 90, 86)');

  // Mitte: die Zahl wächst monoton mit dem Scrollen
  const seen = [];
  for (const f of [0.1, 0.18, 0.26, 0.34]) {
    await scrollPin(page, f);
    await page.waitForTimeout(200);
    seen.push(parseInt((await content(page, '.mc-n-h')).replace(/\D/g, ''), 10));
  }
  expect(seen[0]).toBeLessThan(seen[seen.length - 1]);
  expect([...seen].sort((a, b) => a - b)).toEqual(seen);

  // Ende: alle Zahlen fertig, Urteil sichtbar, Regeln abgehakt
  await scrollPin(page, 1);
  await page.waitForTimeout(300);
  expect(await content(page, '.mc-n-w')).toBe('330');
  expect(await content(page, '.mc-n-h')).toBe('450');
  expect(await content(page, '.mc-n-mw')).toBe('280');
  expect(await content(page, '.mc-n-mh')).toBe('312');
  expect(await opacity(page, '.verdict-ok')).toBe(1);
  expect(await opacity(page, '.verdict-wait')).toBe(0);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.rule.r8')).color)).toBe('rgb(13, 13, 13)');
  expect(await opacity(page, '.rule.r8 .r-v')).toBe(1);
  await expect(page.locator('.verdict-ok')).toContainText('Druckbereit');
  await expect(page.locator('.verdict-ok')).toContainText('13 Regeln erfüllt');
  await ctx.close();
});

test('Desktop: die Bühne bleibt während der Szene stehen (sticky), danach läuft die Seite weiter', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await settle(page);
  const supported = await page.evaluate(() => CSS.supports('animation-timeline', 'view()'));
  test.skip(!supported, 'ohne scroll-driven animations gibt es keine feste Phase');
  const tops = [];
  for (const f of [0.1, 0.4, 0.8]) {
    await scrollPin(page, f);
    await page.waitForTimeout(150);
    tops.push(Math.round(await page.evaluate(() => document.querySelector('.scene-pin').getBoundingClientRect().top)));
  }
  expect(new Set(tops).size).toBe(1);
  expect(tops[0]).toBe(0);
  await ctx.close();
});

test('reduzierte Bewegung: Szene ist sofort im Endzustand, nichts klebt, nichts wird animiert', async ({ browser }) => {
  const ctx = await open(browser, { reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await settle(page);
  const pos = await page.evaluate(() => getComputedStyle(document.querySelector('.scene-pin')).position);
  expect(pos).toBe('static');
  await page.evaluate(() => document.querySelector('.scene').scrollIntoView());
  await page.waitForTimeout(200);
  expect(await content(page, '.mc-n-w')).toBe('330');
  expect(await content(page, '.mc-n-mh')).toBe('312');
  expect(await opacity(page, '.verdict-ok')).toBe(1);
  await expect(page.locator('.verdict-wait')).toBeHidden();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await ctx.close();
});

test('Handy: Szene ist statisch im Endzustand, Bühne und Messung untereinander', async ({ browser }) => {
  const ctx = await open(browser, { ua: 'android', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await settle(page);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.scene-pin')).position)).toBe('static');
  expect(await content(page, '.mc-n-w')).toBe('330');
  await expect(page.locator('.verdict-ok')).toBeVisible();
  const [s, m] = await Promise.all([page.locator('.stage').boundingBox(), page.locator('.mess').boundingBox()]);
  expect(m.y).toBeGreaterThan(s.y + s.height - 2);
  await ctx.close();
});

test('ohne Unterstützung für scroll-gesteuerte Animationen bleibt der Endzustand (Fallback per @supports)', async ({ browser }) => {
  // Wir simulieren den Browser ohne die Funktion, indem wir die @supports-Regel entfernen (Firefox-Verhalten).
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await settle(page);
  const css = await page.evaluate(() => [...document.styleSheets[0].cssRules].filter((r) => r.constructor.name === 'CSSSupportsRule' && /animation-timeline/.test(r.conditionText)).length);
  expect(css).toBeGreaterThan(0);
  await page.evaluate(() => {
    const sheet = document.styleSheets[0];
    for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
      const r = sheet.cssRules[i];
      if (r.constructor.name === 'CSSSupportsRule' && /animation-timeline/.test(r.conditionText)) sheet.deleteRule(i);
    }
  });
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.scene-pin')).position)).toBe('static');
  expect(await content(page, '.mc-n-w')).toBe('330');
  expect(await opacity(page, '.verdict-ok')).toBe(1);
  await ctx.close();
});
