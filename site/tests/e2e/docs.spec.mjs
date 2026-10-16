// Anleitungsseiten: Inhalt, Gliederung, Zeichnungen mit Beschreibung, alle Links erreichbar.
import { test, expect } from '@playwright/test';
import { A, B, PAGES, open, settle } from './util.mjs';

const DOCS = [
  ['/anleitung/', 'In 30 Minuten startklar', ['Das brauchst du', 'Installieren', 'Erststart', 'Programme laden', 'Cypher-Einrichtung', 'Das erste Motiv', 'Wenn etwas hakt']],
  ['/anleitung/motiv-zu-shirtigo/', 'Motiv zur Druckdatei zu Shirtigo', ['Motiv anlegen', 'Im Druckprüfer messen', 'Als PNG exportieren', 'Bei Shirtigo hochladen']],
  ['/anleitung/social-und-reels/', 'Social und Reels', ['Die Formate', 'Eine Vorlage wählen', 'Inhalt und Welt', 'Was Cypher Studio misst', 'Exportieren', 'Ein Reel in Kdenlive anlegen']],
  ['/anleitung/modell-zu-shop/', '3D-Modell zum Shop', ['Vorbereiten', 'Nach den Konventionen bauen', 'Prüfen', 'Exportieren', 'Im Shop einsetzen']],
];

for (const [path, title, h2s] of DOCS) {
  test(`${path}: Titel, Gliederung, Inhaltsverzeichnis, Zeichnungen mit Beschreibung`, async ({ browser }) => {
    const ctx = await open(browser);
    const page = await ctx.newPage();
    await page.goto(B + path);
    await settle(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page.locator('.phead-stand')).toContainText('Stand der App: im Bau');
    const heads = await page.locator('.prose > h2').allTextContents();
    expect(heads).toEqual(h2s);
    // Inhaltsverzeichnis führt zu jeder Überschrift
    const toc = page.locator('.toc a');
    expect(await toc.count()).toBe(h2s.length);
    for (let i = 0; i < h2s.length; i++) {
      const href = await toc.nth(i).getAttribute('href');
      await expect(page.locator(href)).toHaveText(h2s[i]);
    }
    // jede Zeichnung hat eine Beschreibung (zugänglicher Name und Bildunterschrift)
    const figs = await page.locator('figure.fig').evaluateAll((els) => els.map((f) => ({
      alt: f.querySelector('img')?.getAttribute('alt') ?? '', cap: f.querySelector('figcaption')?.textContent, hidden: f.querySelector('figcaption')?.getAttribute('aria-hidden'), w: f.querySelector('img')?.getAttribute('width'), h: f.querySelector('img')?.getAttribute('height'), loaded: f.querySelector('img')?.complete,
    })));
    expect(figs.length).toBeGreaterThan(0);
    for (const f of figs) { expect(f.alt.length).toBeGreaterThan(15); expect(f.cap).toBe(f.alt); expect(f.hidden).toBe('true'); expect(Number(f.w)).toBeGreaterThan(0); expect(Number(f.h)).toBeGreaterThan(0); }
    // Überschriftenebenen springen nicht
    const levels = await page.evaluate(() => [...document.querySelectorAll('h1, h2, h3, h4')].map((h) => Number(h.tagName[1])));
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `Sprung in den Überschriften: ${levels.join(',')}`).toBeLessThanOrEqual(1);
    await ctx.close();
  });
}

test('Anleitung „In 30 Minuten“ enthält die Warn-Schritte für alle drei Systeme mit Zeichnungen', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(A + '/anleitung/');
  for (const id of ['windows', 'macos', 'linux']) await expect(page.locator(`details#${id}`)).toBeAttached();
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  await expect(page.locator('#windows')).toContainText('Der Computer wurde durch Windows geschützt');
  await expect(page.locator('#windows')).toContainText('Trotzdem ausführen');
  await expect(page.locator('#windows')).toContainText('Smart App Control');
  await expect(page.locator('#macos')).toContainText('Systemeinstellungen → Datenschutz & Sicherheit');
  await expect(page.locator('#macos')).toContainText('Seit macOS 15 reicht Rechtsklick → Öffnen nicht mehr');
  await expect(page.locator('#linux')).toContainText('chmod +x');
  await expect(page.locator('#linux')).toContainText('libfuse2t64');
  expect(await page.locator('#windows figure.fig').count()).toBe(4);
  expect(await page.locator('#macos figure.fig').count()).toBe(4);
  expect(await page.locator('#linux figure.fig').count()).toBe(2);
  await ctx.close();
});

test('Ablaufseiten nennen die Werte aus dem Konzept (Shirtigo, Social, Blender)', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(A + '/anleitung/motiv-zu-shirtigo/');
  const t1 = await page.locator('.prose').innerText();
  for (const s of ['330 × 450 mm', '300 dpi', 'cypher_<kollektion>_<motiv>_<produkt>-<position>.png', 'Export/Druck/', 'Bildschirm ist kein Farbbeweis', 'Adobe RGB (1998)', 'DRUCKBEREIT'.toLowerCase()]) {
    expect(t1.toLowerCase(), s).toContain(s.toLowerCase());
  }
  await page.goto(A + '/anleitung/social-und-reels/');
  const t2 = await page.locator('.prose').innerText();
  for (const s of ['1080 × 1350', '1080 × 1920', 'Sicherheitszone', 'Reel (H.264, 1080 × 1920)', '4,5 : 1']) expect(t2).toContain(s);
  await page.goto(A + '/anleitung/modell-zu-shop/');
  const t3 = await page.locator('.prose').innerText();
  for (const s of ['Cypher Export', '.glb', '.webp', '500 Dreiecke', '15.000 Dreiecke', 'kein Draco', 'src/assets/rundgang/modelle/', 'lizenz.json']) expect(t3.toLowerCase(), s).toContain(s.toLowerCase());
  await ctx.close();
});

test('Weiter-lesen-Leiste: die anderen Anleitungen und der Download', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(A + '/anleitung/motiv-zu-shirtigo/');
  const links = await page.locator('.more-a').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(links).toEqual(['/anleitung/', '/anleitung/social-und-reels/', '/anleitung/modell-zu-shop/', '/#download']);
  await ctx.close();
});

for (const [label, base] of [['A', A], ['B', B]]) {
  test(`Linkprüfung Zustand ${label}: jeder interne Link (und Anker) auf allen Seiten antwortet`, async ({ browser, request }) => {
    const ctx = await open(browser);
    const page = await ctx.newPage();
    const checked = new Map();
    const bad = [];
    for (const [, path] of PAGES) {
      await page.goto(base + path);
      const links = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
      for (const href of new Set(links)) {
        if (/^(https?:|mailto:)/.test(href)) continue;
        const [pathPart, frag] = href.split('#');
        const target = pathPart || path.replace(/\?.*/, '');
        const key = target;
        if (!checked.has(key)) {
          const r = await request.get(base + target);
          checked.set(key, r.status());
          if (r.status() !== 200) bad.push(`${path} → ${href}: ${r.status()}`);
        }
        if (frag && checked.get(key) === 200) {
          const html = await (await request.get(base + target)).text();
          if (!html.includes(`id="${frag}"`)) bad.push(`${path} → ${href}: Anker fehlt`);
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
    expect(checked.size).toBeGreaterThan(6);
    await ctx.close();
  });
}

test('Verweise auf Fremdseiten öffnen mit noopener, Marken stehen im Fuß jeder Inhaltsseite', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  for (const [, path] of PAGES.slice(0, 5)) {
    await page.goto(B + path);
    const rels = await page.$$eval('a[href^="http"]', (as) => as.map((a) => a.getAttribute('rel') || ''));
    for (const r of rels) expect(r, path).toMatch(/noopener/);
    await expect(page.locator('.foot-brand')).toContainText('Krita, Inkscape, Blender und Kdenlive sind Marken ihrer jeweiligen Inhaber');
    await expect(page.locator('.foot-brand')).toContainText('kein offizielles Produkt dieser Projekte');
  }
  await ctx.close();
});

test('Keine fremden Logos oder Fotos: Bilder sind nur die eigenen Strichzeichnungen (SVG) und das Favicon', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  const imgs = [];
  page.on('response', (r) => { if (r.request().resourceType() === 'image') imgs.push(r.url()); });
  for (const [, path] of PAGES) await page.goto(B + path);
  const own = /\/(favicon\.svg|assets\/img\/[a-z0-9-]+\.[0-9a-f]{10}\.svg)$/;
  expect(imgs.filter((u) => !own.test(u))).toEqual([]);
  // alle <img> der Seiten sind lokale SVG-Dateien mit Hash im Namen
  const srcs = await page.$$eval('img', (els) => els.map((e) => e.getAttribute('src')));
  expect(srcs.every((u) => /^\/assets\/img\/[a-z0-9-]+\.[0-9a-f]{10}\.svg$/.test(u))).toBe(true);
  await ctx.close();
});

test('Impressum und Datenschutz sind als Platzhalter gekennzeichnet und noindex', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(A + '/impressum/');
  await expect(page.locator('.plain-flag')).toHaveText('Platzhalter');
  await expect(page.getByText('GbR ist in Gründung')).toBeVisible();
  await page.goto(A + '/datenschutz/');
  await expect(page.locator('.plain-flag')).toHaveText('Platzhalter');
  await expect(page.getByText('Keine Cookies, kein Tracking')).toBeVisible();
  await ctx.close();
});

test('404: „Kein Signal“ mit Weg zurück', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  const res = await page.goto(A + '/gibt-es-nicht/');
  expect(res.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kein Signal');
  await page.getByRole('link', { name: 'Zurück zur Kennung' }).click();
  await expect(page).toHaveURL(A + '/');
  await ctx.close();
});
