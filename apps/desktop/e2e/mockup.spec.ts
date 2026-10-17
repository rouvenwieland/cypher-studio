import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

async function exportsOf(page: Page) {
  return page.evaluate(() =>
    (window.__CYPHER_MOCK__?.exports ?? []).map((e) => ({
      name: e.meta.fileName,
      format: e.meta.format,
      destination: e.meta.destination,
      bytes: e.bytes,
    })),
  );
}

test.describe("Mockups (CONCEPT.md 6.5)", () => {
  test("Leerer Zustand: echtes Shirt aus dem Paket sichtbar, Motiv wählen, Ausgang gesperrt", async ({ page }) => {
    await openApp(page, "mockups");
    await expect(page.getByTestId("mockup-empty")).toContainText("Motiv aus der Bibliothek wählen");
    await expect(page.locator(".mock__canvas")).toBeVisible();
    const out = page.getByTestId("mockup-output");
    await expect(out).toHaveAttribute("data-state", "blocked");
    await expect(out).toContainText("Erst ein Motiv wählen");
    await expect(page.getByRole("radio", { name: "Hoodie" })).toBeEnabled();
    await expect(page.getByTestId("measure-hoodie")).toHaveCount(0);
  });

  test("Hoodie und Rückseite kommen aus dem Paket: eigene Druckfläche, Motiv passt sich an", async ({ page }) => {
    await openApp(page, "mockups", { pick: "signal_v3.png" });
    await page.getByTestId("mockup-pick").click();
    await expect(page.getByTestId("measure-width")).toContainText("von 330 mm Druckfläche");
    await page.getByRole("radio", { name: "Hoodie" }).click();
    // Hoodie vorne: Druckfläche 330 × 280 mm, das hohe Motiv wird kleiner als beim Shirt (kein Überstand)
    await expect(page.getByTestId("measure-width")).toHaveAttribute("data-state", "ok");
    await expect(page.getByTestId("mockup-width")).not.toHaveValue("280");
    await page.getByRole("radio", { name: "hinten" }).click();
    await expect(page.locator(".mock__canvas")).toHaveAttribute("aria-label", /Hoodie hinten/);
    await expect(page.getByTestId("measure-width")).toContainText("330 mm Druckfläche");
  });

  test("Dunkles Textil auf dunklem Umfeld: das Umfeld wird mittel, damit eine Kontur bleibt", async ({ page }) => {
    await openApp(page, "mockups", { pick: "signal_v3.png", theme: "dark" });
    await page.getByTestId("mockup-pick").click();
    await expect(page.locator("[data-umfeld]").first()).toHaveAttribute("data-umfeld", "mittel");
    await page.getByRole("radio", { name: "Weiß" }).click();
    await expect(page.locator("[data-umfeld]").first()).toHaveAttribute("data-umfeld", "dunkel");
  });

  test("Motiv wählen: Shirt zeigt das Motiv, Messung nennt Breite, Hintergrund und Kontrast", async ({ page }) => {
    await openApp(page, "mockups", { pick: "signal_v3.png" });
    await page.getByTestId("mockup-pick").click();
    await expect(page.getByTestId("mockup-empty")).toHaveCount(0);
    await expect(page.getByTestId("measure-width")).toContainText("280 mm von 330 mm Druckfläche");
    await expect(page.getByTestId("measure-alpha")).toContainText("transparent");
    await expect(page.getByTestId("measure-contrast")).toContainText("ausreichend");
    const out = page.getByTestId("mockup-output");
    await expect(out).toHaveAttribute("data-state", "ready");
    await expect(out).toContainText("1 Bild");
    await expect(out).toContainText("2000 × 2500 px");
    // die Vorschau trägt das Motiv: Im Brustbereich des schwarzen Shirts gibt es helle Pixel (ohne Motiv bleibt er dunkel)
    const brightest = () =>
      page.locator(".mock__canvas").evaluate((c: HTMLCanvasElement) => {
        const ctx = c.getContext("2d");
        if (!ctx) return 0;
        const d = ctx.getImageData(
          Math.round(c.width * 0.35),
          Math.round(c.height * 0.4),
          Math.round(c.width * 0.3),
          Math.round(c.height * 0.3),
        ).data;
        let max = 0;
        for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0);
        return max;
      });
    await expect.poll(brightest, { timeout: 15_000 }).toBeGreaterThan(150);
  });

  test("Export: ein PNG im Projektordner Mockups, Ausgangsleiste meldet es, Social-Weiterleitung", async ({ page }) => {
    await openApp(page, "mockups", { pick: "signal_v3.png" });
    await page.getByTestId("mockup-pick").click();
    await expect(page.getByTestId("mockup-output")).toHaveAttribute("data-state", "ready");
    await page.keyboard.press("Control+Enter");
    const out = page.getByTestId("mockup-output");
    await expect(out).toHaveAttribute("data-state", "done");
    await expect(out).toContainText("1 Mockup gespeichert");
    const files = await exportsOf(page);
    expect(files).toHaveLength(1);
    expect(files[0]?.format).toBe("png");
    expect(files[0]?.name).toMatch(/signal-v3_tee-schwarz_mockup\.png$/);
    expect(files[0]?.destination).toMatchObject({ kind: "project", folder: "Mockups" });
    expect(files[0]?.bytes).toBeGreaterThan(5_000);
    await page.getByTestId("mockup-to-social").click();
    await expect(page.getByTestId("screen-social")).toBeVisible();
  });

  test("Mehrere Farben exportieren: ein Bild je Farbe", async ({ page }) => {
    await openApp(page, "mockups", { pick: "signal_v3.png" });
    await page.getByTestId("mockup-pick").click();
    await page.getByRole("checkbox", { name: "Weiß" }).check();
    await page.getByRole("checkbox", { name: "Navy" }).check();
    const out = page.getByTestId("mockup-output");
    await expect(out).toContainText("3 Bilder");
    await page.getByTestId("output-action").click();
    await expect(out).toHaveAttribute("data-state", "done");
    await expect(out).toContainText("3 Mockups gespeichert");
    const names = (await exportsOf(page)).map((f) => f.name);
    expect(names.sort()).toEqual(
      ["signal-v3_tee-navy_mockup.png", "signal-v3_tee-schwarz_mockup.png", "signal-v3_tee-weiss_mockup.png"].sort(),
    );
  });

  test("Kontaktbogen (Taste K): alle Textilfarben, geringer Kontrast wird benannt", async ({ page }) => {
    await openApp(page, "mockups", { pick: "signal_v3.png" });
    await page.getByTestId("mockup-pick").click();
    await page.getByTestId("mockup-stage").focus();
    await page.keyboard.press("k");
    const sheet = page.getByTestId("contact-sheet");
    await expect(sheet.getByRole("listitem")).toHaveCount(6);
    await expect(sheet.locator("canvas")).toHaveCount(6, { timeout: 15_000 });
    await expect(page.getByTestId("contact-weiss")).toContainText("Kontrast gering");
    await expect(page.getByTestId("contact-schwarz")).not.toContainText("Kontrast gering");
    await expect(page.getByTestId("measure-contrast")).toContainText("ausreichend");
    // Weiß zum Export vormerken, dann nennt die Messung die Farbe
    await page.getByRole("checkbox", { name: "Weiß" }).check();
    await expect(page.getByTestId("measure-contrast")).toContainText("heben sich kaum ab auf Weiß");
    await page.getByTestId("mockup-stage").focus();
    await page.keyboard.press("k");
    await expect(sheet).toHaveCount(0);
  });

  test("Motivbreite per Tastatur: Messung folgt, zu breit warnt", async ({ page }) => {
    await openApp(page, "mockups", { pick: "signal_v3.png" });
    await page.getByTestId("mockup-pick").click();
    await page.getByTestId("mockup-width").fill("150");
    await expect(page.getByTestId("measure-width")).toContainText("150 mm von 330 mm");
    await page.getByTestId("mockup-width").fill("360");
    await expect(page.getByTestId("measure-width")).toContainText("ragt über die Druckfläche");
    await expect(page.getByTestId("measure-width")).toHaveAttribute("data-state", "warn");
  });

  test("Motiv ohne Transparenz: Warnung mit Weg zum Freistellen", async ({ page }) => {
    await openApp(page, "mockups", { pick: "schriftzug_foto.jpg" });
    await page.getByTestId("mockup-pick").click();
    await expect(page.getByTestId("mockup-noalpha")).toContainText("Kasten");
    await expect(page.getByTestId("measure-alpha")).toHaveAttribute("data-state", "warn");
    await page.getByTestId("mockup-noalpha").getByRole("button", { name: "Freistellen" }).click();
    await expect(page.getByTestId("screen-cutout")).toBeVisible();
  });
});
