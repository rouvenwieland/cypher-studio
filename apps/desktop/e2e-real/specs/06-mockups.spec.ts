import { expect, test, type Response } from "@playwright/test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  chooseLibrary,
  createProject,
  expectClean,
  goto,
  makeTestFolder,
  shotBothThemes,
  skipOnboarding,
  useApp,
} from "../support/helpers";
import { readPng } from "../support/png";
import { REPO } from "../support/fixtures";

const MOTIF = join(REPO, "packs", "samples", "probe-motiv.png");

/** Alle Dateien unter einem Ordner (für „wo ist der Export gelandet?“). */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/**
 * Mockups mit den echten Vorlagen: Rust liefert Shirt und Hoodie (vorn und hinten, je sechs Textilfarben) samt Ebenen über
 * `cyasset`; der Worker mit OffscreenCanvas setzt das Motiv. Geprüft werden Laden, Zeichnen, Messung und der Export in den
 * Projektordner „Mockups“ der Bibliothek.
 */
test.describe.serial("Mockups (echte Vorlagen über cyasset)", () => {
  const app = useApp();
  const assetResponses: { url: string; status: number }[] = [];

  test("Vorbereitung: Bibliothek mit Testordner", async () => {
    const { page, root } = app();
    page.on("response", (r: Response) => {
      if (/cyasset/.test(r.url())) assetResponses.push({ url: r.url(), status: r.status() });
    });
    const { folder } = makeTestFolder(root);
    await skipOnboarding(page);
    await chooseLibrary(app(), folder);
    await createProject(page, "Herbst-Drop E2E");
    await goto(page, "start");
    await expect(page.getByTestId("projects-list")).toBeVisible();
    await shotBothThemes(page, "start");
  });

  test("alle vier Vorlagen laden und zeichnen ein Textil (Ebenen kommen über cyasset, nichts scheitert)", async () => {
    const { page } = app();
    await goto(page, "mockups");
    await expect(page.getByTestId("screen-mockup")).toBeVisible();
    const canvas = page.locator(".mock__canvas");
    const coverage = () =>
      canvas.evaluate((c: HTMLCanvasElement) => {
        // Kopie lesen, nicht die Leinwand der App (sonst meldet Chrome „willReadFrequently“ wegen unserer Messung)
        const copy = document.createElement("canvas");
        copy.width = c.width;
        copy.height = c.height;
        const ctx = copy.getContext("2d", { willReadFrequently: true });
        if (!ctx) return 0;
        ctx.drawImage(c, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let opaque = 0;
        for (let i = 3; i < d.length; i += 4) if ((d[i] ?? 0) > 128) opaque++;
        return opaque / (d.length / 4);
      });
    for (const [product, view, label] of [
      ["Shirt", "vorn", /Shirt vorne/],
      ["Shirt", "hinten", /Shirt hinten/],
      ["Hoodie", "vorn", /Hoodie vorne/],
      ["Hoodie", "hinten", /Hoodie hinten/],
    ] as const) {
      await page.getByRole("radio", { name: product }).click();
      await page.getByRole("radio", { name: view }).click();
      await expect(canvas).toHaveAttribute("aria-label", label);
      // das Textil deckt 20 bis 75 % der Leinwand (Maske der Vorlage)
      await expect.poll(coverage, { timeout: 20_000, message: `${product} ${view}` }).toBeGreaterThan(0.15);
      expect(await coverage()).toBeLessThan(0.8);
    }
    const bad = assetResponses.filter((r) => r.status !== 200);
    expect(bad, "cyasset-Antworten").toEqual([]);
    expect(assetResponses.length, "Ebenen wurden über cyasset geladen").toBeGreaterThan(10);
    await shotBothThemes(page, "mockups-leer");
  });

  test("Motiv wählen: Messung nennt Breite, Hintergrund und Kontrast; das Motiv ist auf dem Shirt zu sehen", async () => {
    const { page, answerDialog } = app();
    await page.getByRole("radio", { name: "Shirt" }).click();
    await page.getByRole("radio", { name: "vorn" }).click();
    answerDialog([MOTIF]);
    await page.getByTestId("mockup-pick").click();
    await expect(page.getByTestId("mockup-empty")).toHaveCount(0);
    await expect(page.getByTestId("measure-width")).toContainText("mm Druckfläche");
    await expect(page.getByTestId("measure-alpha")).toBeVisible();
    await expect(page.getByTestId("measure-contrast")).toBeVisible();
    const out = page.getByTestId("mockup-output");
    await expect(out).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(out).toContainText("2000 × 2500 px");
    await shotBothThemes(page, "mockups");
  });

  test("Kontaktbogen (K): alle sechs Textilfarben werden mit der echten Vorlage gezeichnet", async () => {
    const { page } = app();
    // Einzeltasten sind standardmäßig an (nur bei Fokus in der Vorschau): K öffnet den Kontaktbogen
    await page.getByTestId("mockup-stage").focus();
    await page.keyboard.press("k");
    const sheet = page.getByTestId("contact-sheet");
    await expect(sheet.getByRole("listitem")).toHaveCount(6);
    await expect(sheet.locator("canvas")).toHaveCount(6, { timeout: 30_000 });
    // die gemeinsame Melange (grau meliert) kommt einmal aus mockups/common und wird von allen Vorlagen benutzt
    const heather = assetResponses.filter((r) => r.url.includes("mockups/common/heather.png"));
    expect(heather.length, "heather.png aus mockups/common").toBeGreaterThan(0);
    expect(heather.every((r) => r.status === 200)).toBe(true);
    expect(assetResponses.filter((r) => r.status !== 200)).toEqual([]);
    await shotBothThemes(page, "mockups-kontaktbogen");
    await page.getByTestId("mockup-stage").focus();
    await page.keyboard.press("k");
    await expect(sheet).toHaveCount(0);
  });

  test("Export in den Projektordner Mockups: PNG 2000 × 2500 px liegt im Bibliotheksordner", async () => {
    const { page, root } = app();
    const out = page.getByTestId("mockup-output");
    await page.getByTestId("mockup-stage").focus();
    await page.keyboard.press("Control+Enter");
    await expect(out).toHaveAttribute("data-state", "done", { timeout: 60_000 });
    await expect(out).toContainText("1 Mockup gespeichert");
    const exported = walk(join(root, "Cypher-Testordner")).filter((f) => /mockup\.png$/i.test(f));
    expect(exported, "exportierte Mockups im Bibliotheksordner").toHaveLength(1);
    const file = exported[0] ?? "";
    expect(file).toMatch(/Mockups/);
    expect(statSync(file).size).toBeGreaterThan(20_000);
    const png = readPng(file);
    expect([png.width, png.height]).toEqual([2000, 2500]);
    await shotBothThemes(page, "mockups-exportiert");
  });

  test("keine Konsolenfehler, keine CSP-Verstöße, keine abgelehnten IPC-Aufrufe", async () => {
    await expectClean(app());
  });
});
