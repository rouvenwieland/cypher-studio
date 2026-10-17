import { expect, test } from "@playwright/test";
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
import { readJpegSize, readPng } from "../support/png";

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/**
 * Social-Generator mit den echten Vorlagen aus dem Paket: Layout in der Oberfläche mit den echten Schriften (über `cyasset`),
 * Export als JPEG und PNG in den Projektordner „Social“ der Bibliothek.
 */
test.describe.serial("Social-Generator (echte Vorlagen)", () => {
  const app = useApp();

  test("Vorbereitung: Bibliothek mit Testordner", async () => {
    const { page, root } = app();
    const { folder } = makeTestFolder(root);
    await skipOnboarding(page);
    await chooseLibrary(app(), folder);
    await createProject(page, "Herbst-Drop E2E");
    await goto(page, "social");
    await expect(page.getByTestId("social-empty")).toBeVisible();
    await expect(page.getByTestId("tpl-drop-ankuendigung").first()).toBeVisible();
    await shotBothThemes(page, "social-leer");
  });

  test("Vorlage wählen, Titel ändern: Bühne, Messung (Zone, Kontrast) und Schrift sind da", async () => {
    const { page } = app();
    await page.getByTestId("tpl-drop-ankuendigung").first().click();
    await expect(page.getByTestId("social-stage")).toBeVisible();
    await page.getByTestId("slot-titel").fill("Neuer Drop");
    await expect(page.getByTestId("measure-contrast")).toContainText(/≥ 4,5:1|Kontrast/);
    await expect(page.getByTestId("font-error")).toHaveCount(0);
    // die Schriften der Marke sind geladen (Anybody über cyasset), nicht die Ersatzschrift
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""));
    });
    expect(fonts.join(",")).toMatch(/Anybody/);
    await expect(page.getByTestId("social-output")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await shotBothThemes(page, "social");
  });

  test("Export als JPEG (Voreinstellung) und als PNG: 1080 × 1350 px im Projektordner Social", async () => {
    const { page, root } = app();
    const out = page.getByTestId("social-output");
    await page.keyboard.press("Control+Enter");
    await expect(out).toHaveAttribute("data-state", "done", { timeout: 60_000 });
    await expect(out).toContainText("1 Datei gespeichert");
    const folder = join(root, "Cypher-Testordner");
    const jpg = walk(folder).filter((f) => /\.jpe?g$/i.test(f));
    expect(jpg).toHaveLength(1);
    expect(jpg[0]).toMatch(/Social/);
    expect(readJpegSize(jpg[0] ?? "")).toEqual({ width: 1080, height: 1350 });
    expect(statSync(jpg[0] ?? "").size).toBeGreaterThan(10_000);

    await page.getByRole("radio", { name: "PNG" }).click();
    await expect(out).toHaveAttribute("data-state", "ready");
    await page.getByTestId("output-action").click();
    await expect(out).toHaveAttribute("data-state", "done", { timeout: 60_000 });
    const png = walk(folder).filter((f) => /social.*\.png$/i.test(f) && !/Notizen/.test(f) && !/Motive|Drops/.test(f));
    expect(png.length).toBeGreaterThanOrEqual(1);
    const facts = readPng(png[png.length - 1] ?? "");
    expect([facts.width, facts.height]).toEqual([1080, 1350]);
    await shotBothThemes(page, "social-exportiert");
  });

  test("Story-Vorlage: 1080 × 1920 px", async () => {
    const { page, root } = app();
    await goto(page, "social");
    await page.getByRole("radio", { name: /^Story/ }).click();
    await page.getByTestId("tpl-drop-ankuendigung-story").first().click();
    await expect(page.getByTestId("social-stage")).toBeVisible();
    await expect(page.getByTestId("social-output")).toContainText(/1080 × 1920/);
    const out = page.getByTestId("social-output");
    await expect(out).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await page.keyboard.press("Control+Enter");
    await expect(out).toHaveAttribute("data-state", "done", { timeout: 60_000 });
    const stories = walk(join(root, "Cypher-Testordner")).filter((f) => /story/i.test(f) && /\.(jpe?g|png)$/i.test(f));
    expect(stories.length).toBeGreaterThanOrEqual(1);
    const file = stories[stories.length - 1] ?? "";
    const size = /\.png$/i.test(file) ? readPng(file) : readJpegSize(file);
    expect([size.width, size.height]).toEqual([1080, 1920]);
  });

  test("keine Konsolenfehler, keine CSP-Verstöße, keine abgelehnten IPC-Aufrufe", async () => {
    await expectClean(app());
  });
});
