// Die beiden Zustände von release.json: A „noch kein Release“ und B „Release vorhanden“.
import { test, expect } from '@playwright/test';
import { A, B, PAGES, open, release, settle } from './util.mjs';

test('Zustand A: „Die erste Version erscheint in Kürze“, keine toten Knöpfe, Anleitung bleibt', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(A + '/');
  await settle(page);
  await expect(page.getByText('Die erste Version erscheint in Kürze.')).toBeVisible();
  await expect(page.locator('.m-ver')).toContainText('Testbetrieb');
  await expect(page.locator('a[download]')).toHaveCount(0);
  await expect(page.locator('a[href$=".exe"], a[href$=".dmg"], a[href$=".AppImage"]')).toHaveCount(0);
  await expect(page.locator('button[disabled], a[aria-disabled="true"]')).toHaveCount(0);
  await expect(page.locator('.sums-none')).toContainText('Sobald die erste Version erscheint');
  // die Anleitung steht schon bereit und ist erreichbar
  await page.getByRole('link', { name: /Die Anleitung .* steht schon bereit/ }).click();
  await expect(page).toHaveURL(/\/anleitung\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('In 30 Minuten startklar');
  // Anleitung zeigt Dateinamen als Muster mit VERSION
  await expect(page.locator('#windows').first()).toContainText('Cypher-Studio_VERSION_x64-setup.exe');
  await ctx.close();
});

test('Zustand A: Handy sieht dasselbe ehrliche Bild, Befehle zum Prüfen funktionieren schon', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(A + '/#pruefen');
  await expect(page.locator('.cmds .code')).toHaveCount(3);
  await ctx.close();
});

test('Zustand B: echte Links, Größe, Version, Prüfsumme je Datei', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await settle(page);
  await expect(page.locator('.m-ver')).toContainText('Version 0.4.0');
  await expect(page.getByText('Die erste Version erscheint in Kürze')).toHaveCount(0);
  // Windows: Fakten in der Messzeile
  const fact = page.locator('.dl-row[data-os="windows"] .dl-fact');
  await expect(fact).toContainText('0.4.0');
  await expect(fact).toContainText('9,8 MB');
  await expect(fact).toContainText('SHA-256 f18a f273 … fc51 770f');
  // Linux: AppImage groß, daneben .deb und .rpm; AppImage ist größer als 24 MiB und liegt auf GitHub
  const linux = page.locator('.dl-row[data-os="linux"]');
  await expect(linux.locator('a.dl-main')).toHaveAttribute('href', /^https:\/\/github\.com\/example-org\/.*\.AppImage$/);
  await expect(linux.locator('.dl-alt a')).toHaveCount(2);
  await expect(linux.locator('.dl-alt a').nth(0)).toHaveAttribute('href', '/releases/Cypher-Studio_0.4.0_amd64.deb');
  await expect(linux.locator('.dl-alt a').nth(1)).toHaveAttribute('href', '/releases/Cypher-Studio-0.4.0-1.x86_64.rpm');
  // Release-Seite als Rückfall
  await expect(page.getByRole('link', { name: 'Release-Seite' })).toHaveAttribute('href', release.releaseUrl);
  // Prüfsummen: eine Zeile je Datei, 16 Vierergruppen, Knopf zum Kopieren
  const sums = page.locator('.sum');
  await expect(sums).toHaveCount(release.files.length);
  for (const f of release.files) {
    const row = page.locator('.sum', { hasText: f.name });
    await expect(row.locator('.grp')).toHaveCount(16);
    const joined = (await row.locator('.grp').allTextContents()).join('');
    expect(joined).toBe(f.sha256);
    await expect(row.locator('[data-copy-hash]')).toHaveAttribute('data-copy-hash', f.sha256);
  }
  // Prüfbefehle mit echten Dateinamen
  await expect(page.locator('.cmds')).toContainText('Get-FileHash .\\Cypher-Studio_0.4.0_x64-setup.exe -Algorithm SHA256');
  await expect(page.locator('.cmds')).toContainText('shasum -a 256 Cypher-Studio_0.4.0_universal.dmg');
  await expect(page.locator('.cmds')).toContainText('sha256sum Cypher-Studio_0.4.0_amd64.AppImage');
  await ctx.close();
});

test('Zustand B: Anleitungsseiten nennen die echten Dateinamen', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(B + '/anleitung/');
  await expect(page.locator('#windows')).toContainText('Cypher-Studio_0.4.0_x64-setup.exe');
  await expect(page.locator('#linux')).toContainText('chmod +x Cypher-Studio_0.4.0_amd64.AppImage');
  await expect(page.locator('#linux')).toContainText('sudo apt install ./Cypher-Studio_0.4.0_amd64.deb');
  await ctx.close();
});

test('alle Seiten: keine unaufgelösten Platzhalter in beiden Zuständen', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  for (const base of [A, B]) {
    for (const [, path] of PAGES.slice(0, 5)) {
      await page.goto(base + path);
      const text = await page.locator('body').innerText();
      expect(text, `${base}${path}`).not.toMatch(/\{\{|\}\}|@@|undefined|\[object|NaN/);
    }
  }
  await ctx.close();
});
