import { expect, test } from "@playwright/test";
import { mockCalls, openApp } from "./helpers";

test.describe("Druckprüfer (CONCEPT.md 6.4)", () => {
  test("Leerer Zustand: Druckfläche mit Linealen, Datei wählen, Ausgang gesperrt", async ({ page }) => {
    await openApp(page, "druck");
    await expect(page.getByTestId("print-empty")).toContainText("PNG, SVG oder Krita-Datei hierher ziehen");
    await expect(page.getByTestId("verdict")).toContainText(/Keine Datei/i);
    const out = page.getByTestId("print-output");
    await expect(out).toHaveAttribute("data-state", "blocked");
    await expect(out).toContainText("Erst eine Datei wählen");
    await expect(page.getByTestId("print-canvas")).toHaveAttribute("aria-label", /Druckfläche 330 × 450 mm/);
  });

  test("Datei wählen: Urteil, Regeln mit Messwert und Grenze, Ausgangsleiste zeigt das Ergebnis", async ({ page }) => {
    await openApp(page, "druck", { pick: "signal_v3.png" });
    await page.getByTestId("print-pick").click();
    await expect(page.getByTestId("verdict")).toContainText("Druckbar mit Hinweisen");
    await expect(page.getByTestId("verdict")).toContainText("2 Hinweise · 0 Fehler");
    await expect(page.getByTestId("print-file")).toContainText("signal_v3.png");
    await expect(page.getByTestId("check-semi")).toContainText("0,4 %");
    await expect(page.getByTestId("check-strokes")).toContainText("0,6 mm");
    await page.getByTestId("show-ok").click();
    await expect(page.getByTestId("check-resolution")).toContainText("300 dpi bei 280 mm");
    await expect(page.getByTestId("print-live")).toHaveText("Prüfung fertig: 2 Hinweise, 0 Fehler");
    const out = page.getByTestId("print-output");
    await expect(out).toHaveAttribute("data-state", "ready");
    await expect(out).toContainText("PNG");
    await expect(out).toContainText("3307 × 3685 px");
    await expect(out).toContainText("300 dpi");
    await expect(page.getByTestId("output-action")).toContainText("Für Shirtigo exportieren");
  });

  test("Druckbreite ändert Auflösung live und kippt das Urteil", async ({ page }) => {
    await openApp(page, "druck", { pick: "signal_v3.png" });
    await page.getByTestId("print-pick").click();
    await expect(page.getByTestId("verdict")).toContainText("Druckbar mit Hinweisen");
    await page.getByTestId("print-width").fill("330");
    await expect(page.getByTestId("print-dpi")).toContainText("255 dpi");
    await expect(page.getByTestId("check-resolution")).toHaveAttribute("data-state", "warning");
    await page.getByTestId("print-width").fill("500");
    await expect(page.getByTestId("verdict")).toContainText("Nicht druckbar");
    await expect(page.getByTestId("check-fit")).toHaveAttribute("data-state", "error");
    await expect(page.getByTestId("print-output")).toHaveAttribute("data-state", "blocked");
  });

  test("Fehler sperren den Export: „1 Fehler zuerst beheben“ springt zum Fehler, Trotzdem exportieren fragt nach", async ({
    page,
  }) => {
    await openApp(page, "druck", { pick: "kleines_motiv.png" });
    await page.getByTestId("print-pick").click();
    await expect(page.getByTestId("verdict")).toContainText("Nicht druckbar");
    const out = page.getByTestId("print-output");
    await expect(out).toHaveAttribute("data-state", "blocked");
    await expect(out).toContainText(/Fehler zuerst beheben/);
    // gesperrt, aber fokussierbar (aria-disabled): Klick springt zum ersten Fehler
    await page.getByTestId("output-action").click({ force: true });
    await expect(page.getByTestId("check-resolution").getByRole("button").first()).toBeFocused();
    await expect(page.getByTestId("check-resolution")).toContainText("Auflösung zu niedrig");
    await out.getByRole("button", { name: "Trotzdem exportieren …" }).click();
    await expect(page.getByTestId("force-dialog")).toBeVisible();
    await page.getByTestId("force-confirm").click();
    await expect(out).toHaveAttribute("data-state", "done", { timeout: 20_000 });
  });

  test("Nicht lesbare Datei: Erklärung mit dem Format und nächster Schritt", async ({ page }) => {
    await openApp(page, "druck", { pick: "signal.psd" });
    await page.getByTestId("print-pick").click();
    await expect(page.getByTestId("print-unreadable")).toContainText("signal.psd lässt sich nicht öffnen");
    await expect(page.getByTestId("print-unreadable")).toContainText("PSD wird nicht unterstützt");
  });

  test("Export mit Strg+Enter: Fortschritt, Leiste füllt sich, Ergebnis bleibt stehen", async ({ page }) => {
    await openApp(page, "druck", { pick: "signal_v3.png", speed: 5, reducedMotion: false });
    await page.getByTestId("print-pick").click();
    await expect(page.getByTestId("print-output")).toHaveAttribute("data-state", "ready");
    await page.getByTestId("print-canvas").focus();
    await page.keyboard.press("Control+Enter");
    await expect(page.getByTestId("print-output")).toHaveAttribute("data-state", "running");
    const out = page.getByTestId("print-output");
    await expect(out).toHaveAttribute("data-state", "done", { timeout: 20_000 });
    await expect(out).toContainText(/Gespeichert: .*signal_v3_tee-front_280mm_300dpi\.png/);
    await expect(out.getByRole("button", { name: "Im Ordner zeigen" })).toBeVisible();
    await expect(out.getByRole("button", { name: /Shirtigo öffnen/ })).toBeVisible();
    const calls = await mockCalls(page);
    expect(calls).toContain("printcheck_export");
    // Änderung setzt die Leiste zurück
    await page.getByTestId("print-width").fill("260");
    await expect(out).toHaveAttribute("data-state", "ready");
  });

  test("Beheben: Halbtransparenz-Korrektur wird für den Export vorgemerkt", async ({ page }) => {
    await openApp(page, "druck", { pick: "signal_v3.png" });
    await page.getByTestId("print-pick").click();
    await page.getByTestId("check-semi").getByRole("button").first().click();
    await page.getByTestId("fix-semiTransparency").click();
    await expect(page.getByTestId("check-semi")).toContainText("wird beim Export behoben");
    await page.getByTestId("export-settings").locator("summary").click();
    await expect(page.getByRole("combobox", { name: "Halbtransparenz" })).toHaveValue("threshold");
  });

  test("Vorschau: Einzeltasten wirken nur bei Fokus in der Vorschau", async ({ page }) => {
    await openApp(page, "druck", { pick: "signal_v3.png" });
    await page.getByTestId("print-pick").click();
    await expect(page.getByTestId("tool-grid")).toHaveAttribute("aria-pressed", "false");
    // Fokus in einem Textfeld: G tut nichts
    await page.getByTestId("print-width").focus();
    await page.keyboard.type("g");
    await expect(page.getByTestId("tool-grid")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("print-canvas").focus();
    await page.keyboard.press("g");
    await expect(page.getByTestId("tool-grid")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("s");
    await expect(page.getByTestId("tool-zones")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("u");
    await expect(page.getByTestId("print-canvas").locator("xpath=ancestor::main")).toHaveAttribute(
      "data-umfeld",
      "mittel",
    );
  });

  test("Datei per Ziehen (files:dropped) landet in der Prüfung", async ({ page }) => {
    await openApp(page, "druck");
    await page.evaluate(async () => {
      await window.__CYPHER_MOCK__?.emit("files:dropped", {
        handles: [
          {
            id: "fh-drop",
            name: "rauschen_logo.png",
            displayPath: "C:\\Downloads\\rauschen_logo.png",
            size: 100,
            mime: "image/png",
            url: null,
            source: "drop",
          },
        ],
        position: { x: 10, y: 10 },
      });
    });
    await expect(page.getByTestId("print-file")).toContainText("rauschen_logo.png");
  });
});
