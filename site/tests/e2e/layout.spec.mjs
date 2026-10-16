// Kein Querscrollen ab 320 px, Trefferflächen, Textumbruch, Bildschirmfotos 375 / 768 / 1440 nach site/shots/.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { siteRoot } from '../helpers.mjs';
import { A, B, PAGES, open, settle } from './util.mjs';

const shots = join(siteRoot, 'shots');
mkdirSync(shots, { recursive: true });

for (const [state, base] of [['A', A], ['B', B]]) {
  for (const width of [320, 375, 768, 1024, 1440]) {
    test(`kein Querscrollen: Zustand ${state} · ${width} px · alle Seiten`, async ({ browser }) => {
      const ctx = await open(browser, { viewport: { width, height: 800 }, ua: width < 800 ? 'android' : 'windows' });
      const page = await ctx.newPage();
      for (const [name, path] of PAGES) {
        await page.goto(base + path);
        await settle(page);
        await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
        const o = await page.evaluate(() => {
          const d = document.documentElement;
          const wide = [...document.querySelectorAll('body *')].filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.right > d.clientWidth + 1 && !e.closest('.tb') && !e.closest('.nosig') && !e.closest('.dh') && !e.closest('pre');
          }).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${e.className && e.className.baseVal === undefined ? e.className : ''}`);
          return { scroll: d.scrollWidth, client: d.clientWidth, wide };
        });
        expect(o.scroll, `${name} bei ${width}: scrollWidth ${o.scroll} > ${o.client}; Übersteher: ${o.wide.join(', ')}`).toBeLessThanOrEqual(o.client);
      }
      await ctx.close();
    });
  }
}

test('Trefferflächen: Bedienelemente auf dem Handy mindestens 44 × 44 px (Fließtext-Links ausgenommen)', async ({ browser }) => {
  const ctx = await open(browser, { viewport: { width: 375, height: 740 }, ua: 'android' });
  const page = await ctx.newPage();
  const small = [];
  for (const [name, path] of PAGES) {
    await page.goto(B + path);
    await settle(page);
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    const s = await page.evaluate(() => [...document.querySelectorAll('a, button, summary')].filter((a) => {
      const cs = getComputedStyle(a);
      const r = a.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || a.closest('[hidden]')) return false;
      if (a.classList.contains('skip')) return false;
      // Links im Fließtext sind von der Zielgröße ausgenommen (WCAG 2.5.8, Ausnahme „Inline“)
      if (cs.display === 'inline' && a.closest('p, li, dd, figcaption, td')) return false;
      return r.height < 44 || r.width < 44;
    }).map((a) => `${a.textContent.trim().replace(/\s+/g, ' ').slice(0, 30)} ${Math.round(a.getBoundingClientRect().width)}x${Math.round(a.getBoundingClientRect().height)}`));
    for (const t of s) small.push(`${name}: ${t}`);
  }
  expect(small, small.join('\n')).toEqual([]);
  await ctx.close();
});

test('Wortbreite: CYPHER und STUDIO füllen die Breite bis auf wenige Pixel (alle Fensterformen)', async ({ browser }) => {
  const sizes = [[1920, 1080], [1440, 900], [1366, 650], [1280, 720], [1024, 768], [768, 1024], [412, 915], [390, 844], [375, 667], [320, 568]];
  for (const [w, h] of sizes) {
    const ctx = await open(browser, { viewport: { width: w, height: h }, ua: w < 800 ? 'android' : 'windows' });
    const page = await ctx.newPage();
    await page.goto(B + '/');
    await settle(page);
    const m = await page.evaluate(() => {
      const wrap = document.querySelector('.tb');
      const cs = getComputedStyle(wrap);
      const inner = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      // sichtbare Breite: Range über den Text (ohne die nachlaufende Buchstabenweite)
      const widthOf = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; };
      return { inner, cypher: widthOf(document.querySelector('.w-cypher')), studio: widthOf(document.querySelector('.w-studio')) };
    });
    expect(Math.abs(m.cypher - m.inner), `CYPHER bei ${w}x${h}: ${m.cypher} von ${m.inner}`).toBeLessThan(m.inner * 0.03 + 8);
    expect(Math.abs(m.studio - m.inner), `STUDIO bei ${w}x${h}: ${m.studio} von ${m.inner}`).toBeLessThan(m.inner * 0.03 + 8);
    await ctx.close();
  }
});

test('Erster Bildschirm: der Download-Balken ist ohne Scrollen zu sehen (gängige Größen)', async ({ browser }) => {
  for (const [w, h, ua] of [[1920, 1080, 'windows'], [1440, 900, 'macos'], [1366, 700, 'windows'], [1280, 720, 'linux'], [1024, 768, 'windows'], [768, 1024, 'windows'], [390, 844, 'android']]) {
    const ctx = await open(browser, { viewport: { width: w, height: h }, ua });
    const page = await ctx.newPage();
    await page.goto(B + '/');
    await settle(page);
    const target = ua === 'android' ? '.dl-mobile-t' : '.dl-row .dl-cta:visible >> nth=0';
    const box = await page.locator(target).first().boundingBox();
    expect(box, `${w}x${h}`).not.toBeNull();
    expect(box.y + box.height, `Balken bei ${w}x${h} unter der Faltkante (${Math.round(box.y + box.height)} > ${h})`).toBeLessThanOrEqual(h);
    await ctx.close();
  }
});

// Bildschirmfotos (Ansicht oben, Standbild ohne Suchlauf)
const SHOTS = [
  ['start-A', A, '/', 'windows'], ['start-B', B, '/', 'windows'], ['anleitung', B, '/anleitung/', 'windows'],
  ['motiv-zu-shirtigo', B, '/anleitung/motiv-zu-shirtigo/', 'windows'], ['social-und-reels', B, '/anleitung/social-und-reels/', 'windows'],
  ['modell-zu-shop', B, '/anleitung/modell-zu-shop/', 'windows'], ['404', A, '/gibt-es-nicht/', 'windows'],
];
for (const [name, base, path, ua] of SHOTS) {
  test(`Bildschirmfotos ${name} bei 375, 768 und 1440 px`, async ({ browser }) => {
    for (const [w, h] of [[375, 740], [768, 1024], [1440, 900]]) {
      const ctx = await open(browser, { viewport: { width: w, height: h }, ua: w === 375 ? 'android' : ua });
      const page = await ctx.newPage();
      await page.goto(base + path);
      await settle(page);
      await page.screenshot({ path: join(shots, `${name}-${w}.png`) });
      await ctx.close();
    }
  });
}

test('Bildschirmfotos: Messspur-Szene (Endzustand 1440, statisch 375), Programme, Anleitung aufgeklappt', async ({ browser }) => {
  const ctx = await open(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await settle(page);
  await page.evaluate(() => { const t = document.querySelector('.scene-track'); window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY + 0.97 * (t.offsetHeight - innerHeight)); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, 'messspur-szene-1440.png') });
  await page.evaluate(() => document.querySelector('#programme').scrollIntoView());
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shots, 'programme-1440.png') });
  await page.evaluate(() => document.querySelector('#installieren .os-list').scrollIntoView());
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shots, 'installieren-1440.png') });
  await ctx.close();
  const m = await open(browser, { viewport: { width: 375, height: 740 }, ua: 'android' });
  const mp = await m.newPage();
  await mp.goto(B + '/');
  await settle(mp);
  await mp.evaluate(() => document.querySelector('#messspur .scene-track').scrollIntoView());
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: join(shots, 'messspur-szene-375.png') });
  await m.close();
});
