// Systemerkennung im Browser: je User-Agent der passende Download, Handy ohne Download-Knopf, ohne JavaScript alles gleichrangig.
import { test, expect } from '@playwright/test';
import { A, B, open, release, settle } from './util.mjs';

const file = (os, kind) => release.files.find((f) => f.os === os && f.kind === kind);

const DESKTOP = [
  ['Windows (Chrome)', 'windows', 'windows', file('windows', 'nsis').url],
  ['macOS (Safari)', 'macos', 'macos', file('macos', 'dmg').url],
  ['Linux (Chrome)', 'linux', 'linux', file('linux', 'appimage').url],
  ['Linux (Firefox)', 'linuxFirefox', 'linux', file('linux', 'appimage').url],
];
const MOBILE = [['Android (Pixel)', 'android'], ['iPhone', 'ios'], ['iPad (als Mac gemeldet, mit Touch)', 'ipad']];

for (const [name, ua, os, href] of DESKTOP) {
  test(`Erkennung ${name}: großer Knopf für ${os}, andere klein darunter`, async ({ browser }) => {
    const ctx = await open(browser, { ua });
    const page = await ctx.newPage();
    await page.goto(B + '/');
    await settle(page);
    await expect(page.locator('html')).toHaveAttribute('data-os', os);
    const main = page.locator(`.dl-row[data-os="${os}"] .dl-main`);
    await expect(main).toBeVisible();
    await expect(main).toHaveAttribute('href', href);
    await expect(main).toHaveAttribute('download', '');
    // der erkannte Knopf ist der erste und der größte
    const rows = await page.locator('.dl-row').evaluateAll((els) => els.map((e) => ({
      os: e.dataset.os, y: e.getBoundingClientRect().top, cta: parseFloat(getComputedStyle(e.querySelector('.dl-cta')).fontSize),
    })));
    const mine = rows.find((r) => r.os === os);
    expect(mine.y).toBe(Math.min(...rows.map((r) => r.y)));
    for (const r of rows.filter((x) => x.os !== os)) expect(mine.cta).toBeGreaterThan(r.cta * 1.5);
    // der Name ist der sichtbare Inhalt (WCAG 2.5.3) und nennt System, Version und Größe
    await expect(main).not.toHaveAttribute('aria-label');
    await expect(main).toHaveAccessibleName(/Cypher Studio für .+ laden/);
    await expect(main).toHaveAccessibleName(/Version 0\.4\.0/);
    await expect(main).toHaveAccessibleName(/\d+,\d MB/);
    // nie automatischer Download: ohne Klick kommt keine Datei
    await expect(page.locator('.dl-mobile')).toBeHidden();
    await ctx.close();
  });
}

for (const [name, ua] of MOBILE) {
  for (const [state, base] of [['mit Release', B], ['ohne Release', A]]) {
    test(`Erkennung ${name} (${state}): Hinweis „nur für Computer“, kein Download-Knopf`, async ({ browser }) => {
      const ctx = await open(browser, { ua, viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await page.goto(base + '/');
      await settle(page);
      await expect(page.locator('html')).toHaveAttribute('data-os', /^(android|ios)$/);
      const hint = page.locator('.dl-mobile');
      await expect(hint).toBeVisible();
      await expect(hint).toContainText('Cypher Studio läuft auf Windows, macOS und Linux.');
      await expect(hint).toContainText('nur für Computer');
      await expect(page.locator('.dl-list')).toBeHidden();
      await expect(page.locator('a[download]:visible')).toHaveCount(0);
      await expect(page.locator('.dl-none-in')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Link kopieren' })).toBeVisible();
      await ctx.close();
    });
  }
}

test('Erkennung ChromeOS (nicht unterstützt): alle drei Systeme gleichrangig', async ({ browser }) => {
  const ctx = await open(browser, { ua: 'chromeos' });
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await expect(page.locator('html')).toHaveAttribute('data-os', 'other');
  const ctas = await page.locator('.dl-cta').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  expect(ctas).toHaveLength(3);
  expect(new Set(ctas).size).toBe(1);
  await expect(page.locator('.dl-main:visible')).toHaveCount(3);
  await ctx.close();
});

test('ohne JavaScript: alle drei Systeme gleichrangig, Links funktionieren, Anleitung ist da', async ({ browser }) => {
  const ctx = await open(browser, { ua: 'windows', javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await expect(page.locator('html')).not.toHaveAttribute('data-os', /.+/);
  await expect(page.locator('.dl-main:visible')).toHaveCount(3);
  const ctas = await page.locator('.dl-cta').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  expect(new Set(ctas).size).toBe(1);
  for (const f of release.files.filter((x) => ['nsis', 'dmg', 'appimage'].includes(x.kind))) {
    await expect(page.locator(`a.dl-main[href="${f.url}"]`)).toBeVisible();
  }
  // Kopieren-Knöpfe bleiben ohne Skript verborgen, Befehle und Prüfsummen stehen als Text da
  await expect(page.locator('[data-copy-hash]:visible')).toHaveCount(0);
  await expect(page.locator('.copy:visible')).toHaveCount(0);
  await expect(page.locator('.sum-hash').first()).toContainText(/[0-9a-f]{4} [0-9a-f]{4}/);
  await expect(page.getByText('Get-FileHash')).toBeVisible();
  // Anleitung: Zusammenfassungen sichtbar, aufklappbar ohne Skript
  await expect(page.locator('details.os > summary')).toHaveCount(3);
  await page.locator('details#macos > summary').click();
  await expect(page.locator('details#macos')).toHaveAttribute('open', '');
  await expect(page.locator('#macos').getByText('Dennoch öffnen').first()).toBeVisible();
  // Messspur-Szene zeigt den Endzustand
  await expect(page.locator('.verdict-ok')).toBeVisible();
  await ctx.close();
});

test('Erkennung: erkanntes System ist in der Anleitung aufgeklappt, die anderen zu', async ({ browser }) => {
  for (const [ua, os] of [['windows', 'windows'], ['macos', 'macos'], ['linux', 'linux']]) {
    const ctx = await open(browser, { ua });
    const page = await ctx.newPage();
    await page.goto(B + '/');
    await settle(page);
    for (const id of ['windows', 'macos', 'linux']) {
      if (id === os) await expect(page.locator(`details#${id}`)).toHaveAttribute('open', '');
      else await expect(page.locator(`details#${id}`)).not.toHaveAttribute('open', '');
    }
    await ctx.close();
  }
});
