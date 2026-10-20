// Bedienung: Tastatur, sichtbarer Fokus, Download, Sprung zur Anleitung, Kopieren, aufklappbare Anleitung.
import { test, expect } from '@playwright/test';
import { A, B, open, release, settle } from './util.mjs';

test('Tastatur: das erste Tab zeigt „Zum Download springen“, danach der Reihe nach, überall sichtbarer Fokus', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await settle(page);
  const seen = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    seen.push(await page.evaluate(() => {
      const a = document.activeElement;
      const row = a.closest('.pg-row');
      const el = a.matches('.pg-n a') ? row : a;
      const cs = getComputedStyle(el);
      const r = a.getBoundingClientRect();
      return {
        text: (a.getAttribute('aria-label') || a.textContent).trim().replace(/\s+/g, ' ').slice(0, 100),
        ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2,
        inView: r.bottom > 0 && r.top < innerHeight,
      };
    }));
  }
  expect(seen[0].text).toBe('Zum Download springen');
  expect(seen[1].text).toMatch(/Cypher Studio für Windows laden/);
  for (const s of seen) {
    expect(s.ring, `kein Fokusring auf „${s.text}“`).toBe(true);
    expect(s.inView, `Fokus nicht im Bild: „${s.text}“`).toBe(true);
  }
  await ctx.close();
});

test('Skip-Link springt zum Download und wird sichtbar', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await page.keyboard.press('Tab');
  const skip = page.locator('.skip');
  await expect(skip).toBeFocused();
  expect((await skip.boundingBox()).y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#download$/);
  await ctx.close();
});

test('Download starten: Datei kommt mit richtigem Namen, danach springt die Anleitung für das System nach oben', async ({ browser }) => {
  const ctx = await open(browser, { acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await settle(page);
  // erst Linux-Karte zu, Windows offen
  await expect(page.locator('details#windows')).toHaveAttribute('open', '');
  await page.locator('details#windows > summary').click(); // zuklappen
  await expect(page.locator('details#windows')).not.toHaveAttribute('open', '');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.dl-row[data-os="windows"] .dl-main').click()]);
  expect(dl.suggestedFilename()).toBe('Cypher-Studio_0.4.0_x64-setup.exe');
  await expect(page.locator('details#windows')).toHaveAttribute('open', '', { timeout: 3000 });
  await expect(page.locator('details#windows > summary')).toBeFocused();
  // sanftes Scrollen läuft noch: warten, bis die Anleitung oben steht
  await expect.poll(() => page.locator('details#windows').evaluate((e) => e.getBoundingClientRect().top), { timeout: 5000 }).toBeLessThan(120);
  await ctx.close();
});

test('Download startet nie von selbst', async ({ browser }) => {
  const ctx = await open(browser, { acceptDownloads: true });
  const page = await ctx.newPage();
  let started = false;
  page.on('download', () => { started = true; });
  await page.goto(B + '/');
  await settle(page);
  await page.mouse.move(200, 700);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1500);
  expect(started).toBe(false);
  await ctx.close();
});

test('Anleitung ist ein Akkordeon: ein System auf, die anderen zu', async ({ browser }) => {
  const ctx = await open(browser, { ua: 'linux' });
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await settle(page);
  await expect(page.locator('details#linux')).toHaveAttribute('open', '');
  await page.locator('details#macos > summary').click();
  await expect(page.locator('details#macos')).toHaveAttribute('open', '');
  await expect(page.locator('details#linux')).not.toHaveAttribute('open', '');
  // Tastatur: Fokus auf die Zusammenfassung, Leertaste klappt auf
  await page.locator('details#windows > summary').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('details#windows')).toHaveAttribute('open', '');
  await expect(page.locator('details#macos')).not.toHaveAttribute('open', '');
  await ctx.close();
});

test('Sprungmarke #macos klappt die Anleitung auf', async ({ browser }) => {
  const ctx = await open(browser, { ua: 'windows' });
  const page = await ctx.newPage();
  await page.goto(B + '/#macos');
  await settle(page);
  await expect(page.locator('details#macos')).toHaveAttribute('open', '');
  await expect(page.locator('details#windows')).not.toHaveAttribute('open', '');
  await ctx.close();
});

test('signierte Systeme: Seite blendet die Warnungs-Schritte aus (im Bau mit signed=true, Schreibweise der Texte)', async ({ browser }) => {
  // Der Bau mit signed:true ist in tests/unit/build.test.mjs geprüft; hier nur: ohne Signatur sind die Schritte da.
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await expect(page.locator('#windows .step')).toHaveCount(4);
  await expect(page.locator('#macos .step')).toHaveCount(4);
  await expect(page.locator('#linux .step')).toHaveCount(4);
  await expect(page.locator('#windows .step-t').nth(1)).toHaveText('Auf „Weitere Informationen“ klicken');
  await expect(page.locator('#macos')).toContainText('Datenschutz & Sicherheit');
  await expect(page.locator('#macos')).toContainText('Dennoch öffnen');
  await expect(page.locator('#macos')).toContainText('xattr -dr com.apple.quarantine');
  await expect(page.locator('#linux')).toContainText('libfuse2t64');
  await ctx.close();
});

test('Kopieren: Befehle und Prüfsummen landen in der Zwischenablage, Knopf meldet es', async ({ browser }) => {
  const ctx = await open(browser);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(B).origin });
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await settle(page);
  const winCopy = page.locator('.cmds .copy').first();
  await expect(winCopy).toBeVisible();
  await winCopy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Get-FileHash .\\Cypher-Studio_0.4.0_x64-setup.exe -Algorithm SHA256');
  await expect(winCopy).toHaveText('Kopiert');
  await expect(page.locator('p[role="status"].sr')).toHaveText('Kopiert');
  await expect(winCopy).toHaveText('Kopieren', { timeout: 4000 });
  const win = release.files.find((f) => f.os === 'windows');
  await page.locator('.sum', { hasText: win.name }).getByRole('button').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(win.sha256);
  // Befehl aus der Anleitung
  await page.locator('#linux .code').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.locator('details#linux > summary').click();
  await page.locator('#linux .copy').first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('chmod +x Cypher-Studio_0.4.0_amd64.AppImage');
  await ctx.close();
});

test('Handy: „Link kopieren“ legt die Adresse der Seite in die Zwischenablage', async ({ browser }) => {
  const ctx = await open(browser, { ua: 'android', viewport: { width: 390, height: 844 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(A).origin });
  const page = await ctx.newPage();
  await page.goto(A + '/');
  await page.getByRole('button', { name: 'Link kopieren' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://studio.cypherxcypher.de');
  await ctx.close();
});

test('Programm-Stapel: Zeiger und Fokus füllen die Zeile mit Cyan, die Verbindung zur Projektseite ist ein echter Link', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(B + '/');
  await settle(page);
  const row = page.locator('.pg-row[data-p="krita"]');
  await row.scrollIntoViewIfNeeded();
  const fill = () => row.evaluate((e) => new DOMMatrix(getComputedStyle(e, '::before').transform).a);
  expect(await fill()).toBe(0);
  await row.hover();
  await page.waitForTimeout(450);
  expect(await fill()).toBe(1);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(450);
  expect(await fill()).toBe(0);
  const link = row.getByRole('link');
  await link.focus();
  await page.waitForTimeout(450);
  expect(await fill()).toBe(1);
  await expect(link).toHaveAttribute('href', 'https://krita.org/');
  await expect(link).toHaveAttribute('rel', /noopener/);
  // jedes Wort füllt seine Zeile bis auf wenige Pixel
  for (const id of ['krita', 'inkscape', 'blender', 'kdenlive']) {
    const m = await page.locator(`.pg-row[data-p="${id}"]`).evaluate((r) => {
      const range = document.createRange();
      range.selectNodeContents(r.querySelector('.w'));
      return { row: r.clientWidth, word: range.getBoundingClientRect().width };
    });
    expect(Math.abs(m.word - m.row), id).toBeLessThan(m.row * 0.04 + 6);
  }
  await ctx.close();
});

test('Programm-Stapel: Wörter sind Überschriften der Liste (Lesereihenfolge = DOM-Reihenfolge)', async ({ browser }) => {
  const ctx = await open(browser);
  const page = await ctx.newPage();
  await page.goto(B + '/');
  const names = await page.locator('#programme h3').allTextContents();
  expect(names.map((n) => n.replace(/, Projektseite.*/, ''))).toEqual(['Krita', 'Inkscape', 'Blender', 'Kdenlive']);
  await ctx.close();
});
