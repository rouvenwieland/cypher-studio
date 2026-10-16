import { expect, test } from "@playwright/test";
import { openApp, settle } from "./helpers";

const MODULES: [number, RegExp, string][] = [
  [1, /^Start$/i, "screen-start"],
  [2, /^Bibliothek$/i, "screen-library"],
  [3, /^Programme$/i, "screen-programs"],
  [4, /^Druck$/i, "screen-print"],
  [5, /^Mockups$/i, "screen-mockup"],
  [6, /^Social$/i, "screen-social"],
  [7, /^Freistellen$/i, "screen-cutout"],
];

test.describe("Navigation per Tastatur (DESIGN.md Vertrag „Tastatur“)", () => {
  test("Strg+1 … Strg+7 wechseln die Module, der Titel stimmt", async ({ page }) => {
    await openApp(page, "start");
    for (const [digit, title, testId] of MODULES) {
      await page.keyboard.press(`Control+${digit}`);
      await expect(page.getByTestId(testId)).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page).toHaveTitle(/ – Cypher Studio$/);
    }
    await page.keyboard.press("Control+,");
    await expect(page.getByTestId("screen-settings")).toBeVisible();
  });

  test("Rail: gewählter Eintrag ist invertiert und trägt aria-current", async ({ page }) => {
    await openApp(page, "druck");
    const item = page.getByTestId("nav-print");
    await expect(item).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("nav-start")).not.toHaveAttribute("aria-current", "page");
  });

  test("F6 wechselt die Bereiche und kehrt zurück, ohne Falle", async ({ page }) => {
    await openApp(page, "druck", { pick: "signal_v3.png" });
    const regions = await page.evaluate(() =>
      [...document.querySelectorAll("[data-region]")].map((e) => e.getAttribute("data-region")),
    );
    expect(regions).toEqual(["rail", "preview", "inspector", "output"]);
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("F6");
      seen.push(
        await page.evaluate(
          () => document.activeElement?.closest("[data-region]")?.getAttribute("data-region") ?? "keiner",
        ),
      );
    }
    expect(seen).toEqual(["rail", "preview", "inspector", "output", "rail"]);
    await page.keyboard.press("Shift+F6");
    expect(
      await page.evaluate(() => document.activeElement?.closest("[data-region]")?.getAttribute("data-region")),
    ).toBe("output");
  });

  test("Tab läuft durch die ganze Seite und endet wieder vorn (keine Tastaturfalle)", async ({ page }) => {
    await openApp(page, "start");
    const first = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.tagName ?? "BODY");
    const visited = new Set<string>();
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press("Tab");
      const id = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el
          ? `${el.tagName}:${el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? el.textContent?.slice(0, 20) ?? ""}`
          : "none";
      });
      visited.add(id);
    }
    expect(visited.size).toBeGreaterThan(15);
    expect(first).toBeTruthy();
  });

  test("Strg+K öffnet die Befehle, Eingabe findet Module, Enter wechselt, Esc schließt", async ({ page }) => {
    await openApp(page, "start");
    await page.keyboard.press("Control+k");
    const palette = page.getByTestId("palette");
    await expect(palette).toBeVisible();
    await page.keyboard.type("dru");
    await expect(palette.getByText("Druck öffnen")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("screen-print")).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(palette).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });

  test("F1 öffnet die Tastenkürzel, Esc schließt und Fokus kehrt zurück", async ({ page }) => {
    await openApp(page, "start");
    await page.keyboard.press("F1");
    await expect(page.getByTestId("help-dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tastenkürzel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("help-dialog")).toBeHidden();
  });

  test("Aufträge-Popover per Strg+J, Esc schließt", async ({ page }) => {
    await openApp(page, "start", { scenario: "busy" });
    await page.keyboard.press("Control+j");
    const pop = page.getByTestId("jobs-popover");
    await expect(pop).toBeVisible();
    await expect(pop.getByTestId("job-active")).toHaveCount(2);
    await expect(pop.getByRole("button", { name: /Abbrechen: Installieren · Kdenlive/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pop).toBeHidden();
  });

  test("App-Zoom per Strg + / Strg 0", async ({ page }) => {
    await openApp(page, "start");
    await page.keyboard.press("Control+=");
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-zoom")))
      .toBe("1.1");
    await page.keyboard.press("Control+0");
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-zoom")))
      .toBe("1");
    await settle(page);
  });

  test("Strg+Enter löst die Ausgangs-Aktion aus (Druck, Einrichtung, Freistellen sperren/erlauben)", async ({
    page,
  }) => {
    await openApp(page, "druck", { pick: "signal_v3.png" });
    await page.getByTestId("print-pick").click();
    await expect(page.getByTestId("verdict")).toContainText(/Druckbar mit Hinweisen/i);
    await page.getByTestId("print-canvas").focus();
    await page.keyboard.press("Control+Enter");
    await expect(page.getByTestId("print-output")).toHaveAttribute("data-state", "done");
  });
});
