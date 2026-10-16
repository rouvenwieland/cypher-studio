// axe-core (WCAG 2.2 AA + Best Practice) auf jeder Seite, in beiden Zuständen, bei 375 und 1440 px, mit allen Anleitungen aufgeklappt.
// Hinweis: axe deckt nur einen Teil von WCAG ab; Tastatur und Fokus prüft interaction.spec.mjs, die Bewertung am Bildschirm steht im Bericht.
import { test, expect } from '@playwright/test';
import { A, B, PAGES, axePath, open, settle } from './util.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function axe(page) {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async (tags) => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} :: ${(n.failureSummary || '').split('\n').slice(0, 3).join(' | ').slice(0, 220)}`) }));
  }, TAGS);
}

for (const [state, base] of [['A', A], ['B', B]]) {
  for (const width of [375, 1440]) {
    for (const [name, path] of PAGES) {
      test(`axe ${name} · Zustand ${state} · ${width} px`, async ({ browser }) => {
        // bypassCSP nur hier: die echte CSP verbietet das Einspritzen von axe (gewollt), sie wird in security.spec.mjs geprüft
        const ctx = await open(browser, { viewport: { width, height: width === 375 ? 740 : 900 }, bypassCSP: true, ua: width === 375 ? 'android' : 'windows' });
        const page = await ctx.newPage();
        await page.goto(base + path);
        await settle(page);
        await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
        const v = await axe(page);
        expect(v, JSON.stringify(v, null, 1)).toEqual([]);
        await ctx.close();
      });
    }
  }
}

for (const os of ['windows', 'macos', 'linux']) {
  test(`axe Startseite mit erkanntem System ${os} (großer Knopf) · B`, async ({ browser }) => {
    const ctx = await open(browser, { ua: os, bypassCSP: true });
    const page = await ctx.newPage();
    await page.goto(B + '/');
    await settle(page);
    const v = await axe(page);
    expect(v, JSON.stringify(v, null, 1)).toEqual([]);
    await ctx.close();
  });
}

test('axe Messspur-Szene mitten im Ablauf und am Ende (scroll-gesteuert)', async ({ browser }) => {
  const ctx = await open(browser, { bypassCSP: true });
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await settle(page);
  for (const p of [0.15, 0.5, 0.75, 1.05]) {
    await page.evaluate((frac) => {
      const t = document.querySelector('.scene-track');
      window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY + frac * (t.offsetHeight - innerHeight));
    }, p);
    await page.waitForTimeout(250);
    const v = await axe(page);
    expect(v, `p=${p}: ${JSON.stringify(v, null, 1)}`).toEqual([]);
  }
  await ctx.close();
});

test('axe mit reduzierter Bewegung', async ({ browser }) => {
  // forcedColors wird von Playwright nur als Medienmerkmal emuliert, nicht als echtes Kontrastdesign: dafür gibt es keine aussagekräftige axe-Prüfung
  const ctx = await open(browser, { bypassCSP: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await settle(page);
  const v = await axe(page);
  expect(v, JSON.stringify(v, null, 1)).toEqual([]);
  await ctx.close();
});
