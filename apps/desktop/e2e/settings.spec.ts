import { expect, test } from "@playwright/test";
import { mockCalls, openApp } from "./helpers";

test.describe("Einstellungen und Updates (CONCEPT.md 6.9)", () => {
  test("Thema: Papier/Tinte setzen data-theme, System entfernt es", async ({ page }) => {
    await openApp(page, "einstellungen/darstellung");
    await page.getByRole("radio", { name: "Tinte" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("radio", { name: "Papier" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("radio", { name: "System" }).first().click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  });

  test("Dichte Groß vergrößert Zeilen und Ziele auf 44 px", async ({ page }) => {
    await openApp(page, "einstellungen/darstellung");
    await page.getByRole("radio", { name: "Groß" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "large");
    const h = await page
      .getByRole("radio", { name: "Kompakt" })
      .evaluate((e) => Math.round(e.getBoundingClientRect().height));
    expect(h).toBeGreaterThanOrEqual(42);
    const btn = await page
      .getByRole("button", { name: "Vergrößern" })
      .evaluate((e) => Math.round(e.getBoundingClientRect().width));
    expect(btn).toBeGreaterThanOrEqual(44);
  });

  test("Bewegung „Reduziert“ setzt alle Dauern auf 0", async ({ page }) => {
    await openApp(page, "einstellungen/darstellung", { reducedMotion: false });
    await page.getByRole("radio", { name: "Reduziert" }).click();
    const durations = await page.evaluate(() =>
      ["--dur-ui", "--dur-fuellung", "--dur-einrasten", "--dur-suchlauf-takt"].map((n) =>
        getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
      ),
    );
    expect(durations).toEqual(["0ms", "0ms", "0ms", "0ms"]);
  });

  test("App-Zoom wirkt auf das Gerüst", async ({ page }) => {
    await openApp(page, "einstellungen/darstellung");
    await page.getByRole("button", { name: "Vergrößern" }).click();
    await expect(page.getByTestId("zoom-value")).toHaveText("110 %");
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-zoom")))
      .toBe("1.1");
  });

  test("Netzwerk und Daten: jede Adresse steht in der Liste, keine Telemetrie", async ({ page }) => {
    await openApp(page, "einstellungen/netzwerk");
    const table = page.getByTestId("network-table");
    for (const host of [
      "studio.cypherxcypher.de",
      "download.kde.org",
      "inkscape.org",
      "download.blender.org",
      "huggingface.co",
    ]) {
      await expect(table).toContainText(host);
    }
    await expect(page.getByText("aus, es gibt keine")).toBeVisible();
  });

  test("Updates: verfügbar zeigt Neuigkeiten und Aktualisieren, Fortschritt kommt", async ({ page }) => {
    await openApp(page, "einstellungen/updates", { scenario: "updateAvailable", speed: 10 });
    await expect(page.getByTestId("app-version-line")).toContainText("Version 0.2.0 ist verfügbar");
    await expect(page.getByTestId("update-available")).toContainText("Kontaktbogen");
    await expect(page.getByTestId("rail-update")).toContainText("Update 0.2.0 bereit");
    await page.getByTestId("update-install").click();
    await expect.poll(async () => (await mockCalls(page)).includes("app_update_install")).toBe(true);
  });

  test("Updates: alle Programme aktuell", async ({ page }) => {
    await openApp(page, "einstellungen/updates", { scenario: "allInstalled" });
    await expect(page.getByText("Alle Programme sind aktuell.")).toBeVisible();
  });

  test("Updates: „Alle aktualisieren“ öffnet die Übersichten nacheinander", async ({ page }) => {
    await openApp(page, "einstellungen/updates");
    await page.getByTestId("update-all").click();
    await expect(page.getByTestId("install-dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Krita aktualisieren/i })).toBeVisible();
  });

  test("Profile: Druckprofile und Social-Hilfslinien mit Quelle und Datum", async ({ page }) => {
    await openApp(page, "einstellungen/profile");
    const t = page.getByTestId("profiles-table");
    await expect(t).toContainText("Unisex-Shirt · vorne");
    await expect(t).toContainText("330 × 450 mm");
    await expect(t).toContainText("280 × 360 mm");
    await expect(t).toContainText("16.10.2026");
    await expect(page.getByText("Richtwerte, Stand 10/2026.")).toBeVisible();
  });

  test("Über: Version, Lizenzen, OFL-Texte der Schriften", async ({ page }) => {
    await openApp(page, "einstellungen/ueber");
    await expect(page.getByText("0.1.0 (dev)")).toBeVisible();
    await page.getByRole("button", { name: "Lizenztext" }).first().click();
    await expect(page.getByRole("dialog")).toContainText("SIL Open Font License");
  });

  test("Tastenkürzel: Einzeltasten lassen sich abschalten", async ({ page }) => {
    await openApp(page, "einstellungen/kuerzel");
    await page.getByRole("checkbox", { name: /Einzeltasten in der Vorschau erlauben/ }).uncheck();
    await page.keyboard.press("Control+4"); // ohne Neuladen, der Mock hält die Einstellung nur im Speicher
    await page.getByTestId("print-pick").click();
    await page.getByTestId("print-canvas").focus();
    await page.keyboard.press("g");
    await expect(page.getByTestId("tool-grid")).toHaveAttribute("aria-pressed", "false");
  });
});
