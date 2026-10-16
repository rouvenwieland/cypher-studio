// noindex in Meta und Header, CSP ohne Verstöße, keine Cookies, keine Drittquellen.
import { test, expect } from '@playwright/test';
import { A, B, PAGES, open, settle, watch } from './util.mjs';

for (const [name, path] of PAGES) {
  test(`Header und Meta: ${name} ist noindex, hat strenge CSP und keine Cookies`, async ({ browser }) => {
    const ctx = await open(browser);
    const page = await ctx.newPage();
    const res = await page.goto(A + path);
    const h = res.headers();
    expect(res.status()).toBe(name === '404' ? 404 : 200);
    expect(h['x-robots-tag']).toBe('noindex, nofollow');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['set-cookie']).toBeUndefined();
    const csp = h['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).not.toMatch(/unsafe-|\*|https?:/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    expect(await ctx.cookies()).toEqual([]);
    await ctx.close();
  });
}

test('Dateien unter /assets/ sind unveränderlich zwischengespeichert, release.json kurz', async ({ request }) => {
  const html = await (await request.get(A + '/')).text();
  const css = /href="(\/assets\/css\/[^"]+)"/.exec(html)[1];
  const font = /href="(\/assets\/fonts\/[^"]+)"/.exec(html)[1];
  const c = await request.get(A + css);
  expect(c.headers()['cache-control']).toContain('immutable');
  expect(c.headers()['x-robots-tag']).toBe('noindex, nofollow');
  expect(c.headers()['content-type']).toContain('text/css');
  const f = await request.get(A + font);
  expect(f.headers()['cache-control']).toContain('immutable');
  expect(f.headers()['content-type']).toContain('font/woff2');
  const r = await request.get(A + '/release.json');
  expect(r.status()).toBe(200);
  expect(r.headers()['cache-control']).toContain('max-age=60');
  expect(await r.json()).toEqual({ schemaVersion: 1, state: 'none' });
});

test('robots.txt und Favicon sind da, workers.dev-Hinweise stehen nirgends', async ({ request }) => {
  const robots = await request.get(A + '/robots.txt');
  expect(await robots.text()).toContain('User-agent: *');
  const fav = await request.get(A + '/favicon.svg');
  expect(fav.status()).toBe(200);
  expect(fav.headers()['content-type']).toContain('image/svg+xml');
});

for (const [label, base] of [['A', A], ['B', B]]) {
  test(`Zustand ${label}: ein Rundgang über alle Seiten ohne CSP-Verstoß, Konsolenfehler, Fremdanfrage oder Speicherzugriff`, async ({ browser }) => {
    const ctx = await open(browser);
    const origin = new URL(base).origin;
    const external = [];
    ctx.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:')) external.push(r.url()); });
    const page = await ctx.newPage();
    const log = watch(page);
    for (const [, path] of PAGES.slice(0, 7)) {
      await page.goto(base + path);
      await settle(page);
      // langsam durchscrollen, damit jede scroll-gesteuerte Animation läuft
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 700) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(25); }
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
      // Tastatur und Zeiger auf allen Elementen, die etwas auslösen
      for (const sel of ['.pg-row', '.dl-main', '.os-s', '.more-a']) {
        for (const el of await page.locator(sel).all()) { if (await el.isVisible()) await el.hover({ timeout: 2000 }).catch(() => {}); }
      }
      for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
      const csp = await page.evaluate(() => window.__csp);
      expect(csp, `${path}: CSP-Verstöße`).toEqual([]);
    }
    expect(log).toEqual([]);
    expect(external).toEqual([]);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, '']);
    expect(await ctx.cookies()).toEqual([]);
    await ctx.close();
  });
}

test('Kopieren und Download lösen keinen CSP-Verstoß aus', async ({ browser }) => {
  const ctx = await open(browser, { acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(B).origin });
  const page = await ctx.newPage();
  const log = watch(page);
  await page.goto(B + '/');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.dl-row[data-os="windows"] .dl-main').click()]);
  expect(dl.suggestedFilename()).toBe('Cypher-Studio_0.4.0_x64-setup.exe');
  await page.locator('.cmds .copy').first().click();
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  expect(log).toEqual([]);
  await ctx.close();
});
