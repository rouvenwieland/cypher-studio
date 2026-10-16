import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test.describe("Freistellen (CONCEPT.md 6.8)", () => {
  test("Leerer Zustand: Bild wählen, lokal, Ausgang gesperrt", async ({ page }) => {
    await openApp(page, "freistellen");
    await expect(page.getByTestId("cutout-empty")).toContainText("Läuft auf deinem Rechner");
    const out = page.getByTestId("cutout-output");
    await expect(out).toHaveAttribute("data-state", "blocked");
    await expect(out).toContainText("Erst ein Bild wählen");
    await expect(page.getByTestId("cutout-run")).toBeDisabled();
  });

  test("Farbschlüssel: freistellen, vergleichen, speichern, im Druckprüfer öffnen", async ({ page }) => {
    await openApp(page, "freistellen", { pick: "signal_v3.png" });
    await page.getByTestId("cutout-pick").click();
    await expect(page.getByTestId("compare")).toBeVisible();
    await expect(page.getByTestId("cutout-output")).toContainText("Erst freistellen");
    await page.getByTestId("cutout-run").click();
    await expect(page.getByTestId("compare-handle")).toBeVisible();
    await expect(page.getByTestId("cutout-measure")).toContainText("Halbtransparenz");
    const out = page.getByTestId("cutout-output");
    await expect(out).toHaveAttribute("data-state", "ready");

    // Trennlinie per Tastatur
    const handle = page.getByTestId("compare-handle");
    await handle.focus();
    const before = Number(await handle.getAttribute("aria-valuenow"));
    await page.keyboard.press("ArrowLeft");
    expect(Number(await handle.getAttribute("aria-valuenow"))).toBeLessThan(before);
    await page.keyboard.press("Home");
    await expect(handle).toHaveAttribute("aria-valuenow", "0");

    await page.keyboard.press("Control+Enter");
    await expect(out).toHaveAttribute("data-state", "done");
    const saved = await page.evaluate(() =>
      (window.__CYPHER_MOCK__?.exports ?? []).map((e) => ({
        format: e.meta.format,
        destination: e.meta.destination,
        bytes: e.bytes,
      })),
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ format: "png", destination: { kind: "library" } });
    await page.getByTestId("cutout-to-print").click();
    await expect(page.getByTestId("screen-print")).toBeVisible();
    await expect(page.getByTestId("print-file")).toBeVisible();
  });

  test("Modell ohne Modell-Datei: Hinweis statt stiller Fehler, Freistellen gesperrt", async ({ page }) => {
    await openApp(page, "freistellen", { pick: "signal_v3.png" });
    await page.getByTestId("cutout-pick").click();
    await page.getByRole("radio", { name: "Modell" }).click();
    await expect(page.getByTestId("cutout-run")).toBeDisabled();
    await expect(page.getByText(/Modell|Build enthält keine Modelle/).first()).toBeVisible();
  });

  test("Hintergrund der Vorschau umschalten", async ({ page }) => {
    await openApp(page, "freistellen", { pick: "signal_v3.png" });
    await page.getByTestId("cutout-pick").click();
    await page.getByTestId("cutout-run").click();
    await expect(page.getByTestId("compare-handle")).toBeVisible();
    await page.getByRole("radio", { name: "Papier" }).click();
    await expect(page.getByTestId("compare")).toHaveAttribute("data-backdrop", "paper");
    await page.getByRole("radio", { name: "Schachbrett" }).click();
    await expect(page.getByTestId("compare")).toHaveAttribute("data-backdrop", "checker");
  });
});
