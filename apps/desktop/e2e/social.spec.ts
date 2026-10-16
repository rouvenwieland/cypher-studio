import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

interface ExportInfo {
  name: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
}

/** Liest die vom Mock gespeicherten Exporte samt tatsächlicher Bildgröße. */
async function exportsOf(page: Page): Promise<ExportInfo[]> {
  return page.evaluate(async () => {
    const out: ExportInfo[] = [];
    for (const e of window.__CYPHER_MOCK__?.exports ?? []) {
      const bmp = await createImageBitmap(await (await fetch(e.url)).blob());
      out.push({ name: e.meta.fileName, format: e.meta.format, width: bmp.width, height: bmp.height, bytes: e.bytes });
      bmp.close();
    }
    return out;
  });
}

test.describe("Social-Generator (CONCEPT.md 6.6)", () => {
  test("Leerer Zustand: Vorlagen zur Wahl, Ausgang gesperrt", async ({ page }) => {
    await openApp(page, "social");
    await expect(page.getByTestId("social-empty")).toContainText("Wähle eine Vorlage");
    await expect(page.getByTestId("tpl-drop-ankuendigung").first()).toBeVisible();
    const out = page.getByTestId("social-output");
    await expect(out).toHaveAttribute("data-state", "blocked");
    await expect(out).toContainText("Erst eine Vorlage wählen");
  });

  test("Vorlage wählen, Text ändern, exportieren: JPEG als Voreinstellung, PNG umschaltbar, 1080 × 1350", async ({
    page,
  }) => {
    await openApp(page, "social");
    await page.getByTestId("tpl-drop-ankuendigung").first().click();
    await expect(page.getByTestId("social-stage")).toBeVisible();
    await page.getByTestId("slot-titel").fill("Neuer Drop");
    await expect(page.getByTestId("measure-contrast")).toContainText("≥ 4,5:1");
    const out = page.getByTestId("social-output");
    await expect(out).toHaveAttribute("data-state", "ready");
    await page.keyboard.press("Control+Enter");
    await expect(out).toHaveAttribute("data-state", "done");
    await expect(out).toContainText("1 Datei gespeichert");
    const files = await exportsOf(page);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ format: "jpeg", width: 1080, height: 1350 });
    expect(files[0]?.bytes).toBeGreaterThan(10_000);
    // PNG umschalten und erneut exportieren
    await page.getByRole("radio", { name: "PNG" }).click();
    await expect(out).toHaveAttribute("data-state", "ready");
    await page.getByTestId("output-action").click();
    await expect.poll(async () => (await exportsOf(page)).length).toBe(2);
    expect((await exportsOf(page))[1]).toMatchObject({ format: "png", width: 1080, height: 1350 });
  });

  test("Story-Vorlage verletzt die Sicherheitszone: Messung warnt, Export bleibt möglich", async ({ page }) => {
    await openApp(page, "social");
    await page.getByRole("radio", { name: /^Story/ }).click();
    await page.getByTestId("tpl-termin-story").first().click();
    await expect(page.getByTestId("measure-zone")).toHaveAttribute("data-state", "warn");
    await expect(page.getByTestId("social-measure")).toContainText("Export trotzdem möglich");
    const out = page.getByTestId("social-output");
    await expect(out).toHaveAttribute("data-state", "ready");
    await page.keyboard.press("Control+Enter");
    await expect(out).toHaveAttribute("data-state", "done");
    const files = await exportsOf(page);
    expect(files[0]).toMatchObject({ width: 1080, height: 1920 });
  });

  test("Pflichtbild fehlt: Messung warnt, Bild wählen setzt Fokuspunkt und löst die Warnung", async ({ page }) => {
    await openApp(page, "social", { pick: "signal_v3.png" });
    await page.getByTestId("tpl-neues-motiv").first().click();
    await expect(page.getByTestId("social-measure")).toContainText("fehlt ein Bild");
    await expect(page.getByTestId("measure-image")).toContainText("kein Bild");
    await page.getByTestId("pick-bild").click();
    await expect(page.getByTestId("focal-picker")).toBeVisible();
    await expect(page.getByTestId("social-measure")).not.toContainText("fehlt ein Bild");
    await expect(page.getByTestId("measure-image")).toContainText("px breit");
  });

  test("Sicherheitszonen mit Taste S ein- und ausblenden", async ({ page }) => {
    await openApp(page, "social");
    await page.getByRole("radio", { name: /^Story/ }).click();
    await page.getByTestId("tpl-zitat-story").first().click();
    const tool = page.getByTestId("tool-zones");
    const before = await tool.getAttribute("aria-pressed");
    await page.getByTestId("social-stage").focus();
    await page.keyboard.press("s");
    await expect(tool).not.toHaveAttribute("aria-pressed", before ?? "false");
    await page.keyboard.press("s");
    await expect(tool).toHaveAttribute("aria-pressed", before ?? "false");
  });

  test("Tab „Alle“ zeigt alle gewählten Formate nebeneinander", async ({ page }) => {
    await openApp(page, "social");
    await page.getByTestId("tpl-drop-ankuendigung").first().click();
    await page.getByRole("radio", { name: /^Story/ }).click();
    await page.getByTestId("tpl-zitat-story").first().click();
    await page.getByRole("radio", { name: "Alle" }).click();
    await expect(page.locator('[data-testid^="pane-"]')).toHaveCount(2);
    const out = page.getByTestId("social-output");
    await expect(out).toContainText("1080 × 1350");
    await expect(out).toContainText("1080 × 1920");
    await expect(page.getByTestId("output-action")).toContainText("Alle exportieren");
    await page.getByTestId("output-action").click();
    await expect(out).toHaveAttribute("data-state", "done");
    await expect(out).toContainText("2 Dateien gespeichert");
  });
});
