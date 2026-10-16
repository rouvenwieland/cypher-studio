// Suchlauf der Familie: Orange → Gelb → Cyan, einmal, von außen, jede Eingabe bricht ab, nie bei reduzierter Bewegung.
import { test, expect } from '@playwright/test';
import { B, open } from './util.mjs';

/** Zeichnet jede Änderung von data-on mit Zeit und Hintergrundfarbe auf. */
async function record(page) {
  await page.addInitScript(() => {
    window.__rec = [];
    const start = () => {
      const tb = document.querySelector('.tb');
      if (!tb) return;
      const push = () => window.__rec.push([tb.dataset.on ?? '', Math.round(performance.now()), getComputedStyle(tb).backgroundColor]);
      push();
      new MutationObserver(push).observe(tb, { attributes: true, attributeFilter: ['data-on'] });
    };
    document.addEventListener('DOMContentLoaded', start);
  });
}

const ORANGE = 'rgb(255, 79, 18)';
const YELLOW = 'rgb(228, 245, 49)';
const CYAN = 'rgb(0, 212, 216)';

test('von außen: Orange → Gelb → Cyan, jeder Schnitt mindestens 800 ms (WCAG 2.3.1), danach Ruhe', async ({ browser }) => {
  const ctx = await open(browser, { still: false });
  const page = await ctx.newPage();
  await record(page);
  await page.goto(B + '/');
  await page.waitForTimeout(4200);
  const rec = await page.evaluate(() => window.__rec);
  expect(rec.map((r) => r[0])).toEqual(['', 'news', 'shop', '']);
  expect(rec.map((r) => r[2])).toEqual([CYAN, ORANGE, YELLOW, CYAN]);
  // Verweildauer je Schnitt
  const d = [rec[2][1] - rec[1][1], rec[3][1] - rec[2][1]];
  for (const ms of d) expect(ms, `Schnitt dauerte ${ms} ms`).toBeGreaterThanOrEqual(780);
  // höchstens 1,25 Wechsel pro Sekunde (3 Wechsel in mindestens 2,4 s)
  expect(rec[3][1] - rec[1][1]).toBeGreaterThanOrEqual(1560);
  // Kanalbezeichnung wechselt mit
  expect(await page.locator('.m-k[data-ch="studio"]').evaluate((e) => getComputedStyle(e).visibility)).toBe('visible');
  await ctx.close();
});

test('während des Schnitts steht der Kanalname in der Kopfzeile (Kanal 1 News, Kanal 2 Shop)', async ({ browser }) => {
  const ctx = await open(browser, { still: false });
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await expect(page.locator('.tb[data-on="news"] .m-k[data-ch="news"]')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('.m-k[data-ch="studio"]')).toBeHidden();
  await expect(page.locator('.tb[data-on="shop"] .m-k[data-ch="shop"]')).toBeVisible({ timeout: 3000 });
  await ctx.close();
});

test('jede Eingabe bricht ab und stellt Cyan her: Zeigerbewegung, Taste, Scrollen', async ({ browser }) => {
  for (const input of ['mouse', 'key', 'wheel']) {
    const ctx = await open(browser, { still: false });
    const page = await ctx.newPage();
    await record(page);
    await page.goto(B + '/');
    await expect(page.locator('.tb[data-on="news"]')).toBeVisible({ timeout: 3000 });
    if (input === 'mouse') await page.mouse.move(300, 300);
    if (input === 'key') await page.keyboard.press('Tab');
    if (input === 'wheel') await page.mouse.wheel(0, 120);
    await page.waitForTimeout(1800);
    const rec = await page.evaluate(() => window.__rec);
    expect(rec.map((r) => r[0]), input).toEqual(['', 'news', '']);
    expect(rec[rec.length - 1][2]).toBe(CYAN);
    await ctx.close();
  }
});

test('nie bei reduzierter Bewegung', async ({ browser }) => {
  const ctx = await open(browser, { still: false, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await record(page);
  await page.goto(B + '/');
  await page.waitForTimeout(3500);
  expect((await page.evaluate(() => window.__rec)).map((r) => r[0])).toEqual(['']);
  await ctx.close();
});

test('nicht aus der Familie, nicht beim Neuladen, nicht mit Sprungmarke', async ({ browser }) => {
  // aus der Familie (Referrer cypherxcypher.de)
  let ctx = await open(browser, { still: false });
  let page = await ctx.newPage();
  await record(page);
  await page.goto(B + '/', { referer: 'https://news.cypherxcypher.de/' });
  await page.waitForTimeout(3200);
  expect((await page.evaluate(() => window.__rec)).map((r) => r[0])).toEqual(['']);
  await ctx.close();
  // Neuladen
  ctx = await open(browser, { still: false });
  page = await ctx.newPage();
  await page.goto(B + '/');
  await page.waitForTimeout(300);
  await page.reload();
  await record(page);
  await page.reload();
  await page.waitForTimeout(3200);
  expect((await page.evaluate(() => window.__rec)).map((r) => r[0])).toEqual(['']);
  await ctx.close();
  // Sprungmarke (z. B. Link „Zum Download“ aus der Anleitung)
  ctx = await open(browser, { still: false });
  page = await ctx.newPage();
  await record(page);
  await page.goto(B + '/#download');
  await page.waitForTimeout(3200);
  expect((await page.evaluate(() => window.__rec)).map((r) => r[0])).toEqual(['']);
  await ctx.close();
  // fremde Herkunft läuft
  ctx = await open(browser, { still: false });
  page = await ctx.newPage();
  await record(page);
  await page.goto(B + '/', { referer: 'https://example.org/' });
  await page.waitForTimeout(3600);
  expect((await page.evaluate(() => window.__rec)).map((r) => r[0])).toContain('shop');
  await ctx.close();
});

test('der Suchlauf verändert Layout und Lesbarkeit nicht: Kennung und Balken bleiben stehen', async ({ browser }) => {
  const ctx = await open(browser, { still: false });
  const page = await ctx.newPage();
  await page.goto(B + '/');
  const before = await page.locator('.id').boundingBox();
  await expect(page.locator('.tb[data-on="shop"]')).toBeVisible({ timeout: 4000 });
  const during = await page.locator('.id').boundingBox();
  expect(during).toEqual(before);
  // Tinte auf Gelb und Orange bleibt lesbar (Kontrast steht in tokens.test.mjs)
  expect(await page.locator('.id').evaluate((e) => getComputedStyle(e).color)).toBe('rgb(13, 13, 13)');
  await ctx.close();
});
