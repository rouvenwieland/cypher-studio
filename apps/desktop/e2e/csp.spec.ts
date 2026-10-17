import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/** Sammelt jede Verletzung der Content Security Policy (Ereignis und Konsolenmeldung). */
async function watchCsp(page: Page): Promise<string[]> {
  const found: string[] = [];
  page.on("console", (m) => {
    const text = m.text();
    if (/Content Security Policy|Refused to/i.test(text)) found.push(`console: ${text.slice(0, 240)}`);
  });
  page.on("pageerror", (e) => found.push(`pageerror: ${e.message.slice(0, 240)}`));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp?: string[] }).__csp = [
        ...((window as unknown as { __csp?: string[] }).__csp ?? []),
        `${e.violatedDirective}: ${e.blockedURI}`,
      ];
    });
  });
  return found;
}

async function violations(page: Page, found: string[]): Promise<string[]> {
  const events = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  return [...found, ...events.map((e) => `event: ${e}`)];
}

test.describe("Produktions-CSP (ARCHITEKTUR 6.2)", () => {
  test("Der Server liefert die strenge Richtlinie ohne unsafe-inline für Skripte und Stile", async ({ request }) => {
    const res = await request.get("/");
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'self'(;|$)/);
    expect(csp).toMatch(/style-src 'self';/);
    expect(csp).not.toMatch(/(script|style)-src[^;]*unsafe-eval/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  test("Hauptabläufe laufen ohne eine einzige Verletzung", async ({ page }) => {
    const found = await watchCsp(page);
    await openApp(page, "start", { pick: "signal_v3.png" });
    await expect(page.getByTestId("screen-start")).toBeVisible();

    // Programme und Einrichtung
    await page.getByTestId("nav-programs").click();
    await expect(page.getByTestId("screen-programs")).toBeVisible();
    await page.getByTestId("row-action-blender").click();
    await expect(page.getByTestId("install-confirm")).toBeVisible();
    await page.keyboard.press("Escape");

    // Druckprüfer mit Datei
    await page.getByTestId("nav-print").click();
    await page.getByTestId("print-pick").click();
    await expect(page.getByTestId("verdict")).toBeVisible();

    // Mockups (Worker, OffscreenCanvas) mit Export
    await page.getByTestId("nav-mockup").click();
    await page.getByTestId("mockup-pick").click();
    await expect(page.getByTestId("mockup-output")).toHaveAttribute("data-state", "ready");
    await page.getByTestId("output-action").click();
    await expect(page.getByTestId("mockup-output")).toHaveAttribute("data-state", "done");

    // Social mit Export
    await page.getByTestId("nav-social").click();
    await page.getByTestId("tpl-drop-ankuendigung").first().click();
    await expect(page.getByTestId("social-output")).toHaveAttribute("data-state", "ready");
    await page.getByTestId("output-action").click();
    await expect(page.getByTestId("social-output")).toHaveAttribute("data-state", "done");

    // Freistellen
    await page.getByTestId("nav-cutout").click();
    await page.getByTestId("cutout-pick").click();
    await page.getByTestId("cutout-run").click();
    await expect(page.getByTestId("compare-handle")).toBeVisible();

    // Bibliothek, Einstellungen, Befehlspalette, Aufträge
    await page.getByTestId("nav-library").click();
    await expect(page.getByTestId("screen-library")).toBeVisible();
    await page.keyboard.press("Control+,");
    await expect(page.getByTestId("screen-settings")).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.locator("[cmdk-input]")).toBeFocused();
    await page.keyboard.press("Escape");

    expect(await violations(page, found)).toEqual([]);
  });

  test("Menüs, Popover und Dialoge öffnen und schließen ohne Verletzung (kein <style> von Radix)", async ({ page }) => {
    // Befund aus der echten Installationsprobe: das „…“-Menü schrieb über react-remove-scroll ein <style>-Element
    const found = await watchCsp(page);
    await openApp(page, "programme/krita");

    // Aktionsmenü im Programmdetail, Deinstallieren-Dialog (nativer <dialog>) und Abbrechen
    await page.getByRole("button", { name: "Weitere Aktionen" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.getByRole("menuitem", { name: /Deinstallieren/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Menü noch einmal öffnen und mit Escape schließen
    await page.getByRole("button", { name: "Weitere Aktionen" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    // Aufträge-Popover in der Leiste und Befehlspalette
    await page.getByTestId("nav-jobs").click();
    await expect(page.getByTestId("jobs-popover")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await expect(page.locator("[cmdk-input]")).toBeFocused();
    await page.keyboard.press("Escape");

    // Bibliothek: Menü eines Eintrags
    await page.getByTestId("nav-library").click();
    await expect(page.getByTestId("screen-library")).toBeVisible();

    // das Seitenelement der Scroll-Sperre darf nie angelegt worden sein
    expect(await page.locator("style").count()).toBe(0);
    expect(await page.locator("body[data-scroll-locked]").count()).toBe(0);
    expect(await violations(page, found)).toEqual([]);
  });

  test("Gegenprobe: ein eingefügtes Inline-Skript wird blockiert und gemeldet", async ({ page }) => {
    const found = await watchCsp(page);
    await openApp(page, "start");
    await page.evaluate(() => {
      const s = document.createElement("script");
      s.textContent = "window.__eingeschleust = 1";
      document.head.append(s);
    });
    expect(
      await page.evaluate(() => (window as unknown as { __eingeschleust?: number }).__eingeschleust),
    ).toBeUndefined();
    expect((await violations(page, found)).length).toBeGreaterThan(0);
  });
});
