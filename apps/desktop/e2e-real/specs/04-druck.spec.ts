import { expect, test } from "@playwright/test";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { expectClean, goto, shotBothThemes, skipOnboarding, useApp } from "../support/helpers";
import { REPO } from "../support/fixtures";
import { readPng } from "../support/png";

const SAMPLE = join(REPO, "packs", "samples", "probe-motiv.png");

/**
 * Druckprüfer mit der echten Probe-Motiv-PNG aus dem Paket: Analyse in Rust, Bericht in der Oberfläche, Export als
 * Druckdatei (Zuschnitt, 300 dpi, eingebettetes Farbprofil) und erneute Prüfung der Ausgabe.
 */
test.describe.serial("Druckprüfer (echte PNG)", () => {
  const app = useApp();
  const source = readPng(SAMPLE);

  test("Probe-Motiv wählen: Urteil, Regeln mit Messwert, Maße stimmen mit der Datei überein", async () => {
    const { page, answerDialog } = app();
    await skipOnboarding(page);
    await goto(page, "druck");
    await expect(page.getByTestId("print-empty")).toBeVisible();
    answerDialog([SAMPLE]);
    await page.getByTestId("print-pick").click();
    await expect(page.getByTestId("print-file")).toContainText("probe-motiv.png");
    await expect(page.getByTestId("verdict")).toContainText(/Druckbar|Nicht druckbar/, { timeout: 30_000 });
    await expect(page.getByTestId("report-loading")).toHaveCount(0);
    const out = page.getByTestId("print-output");
    // Das Probe-Motiv hat absichtlich etwa 2 % Halbtransparenz: der Bericht nennt es als Fehler und sperrt den Export
    await expect(out).toHaveAttribute("data-state", "blocked");
    await expect(out).toContainText(/Zuerst beheben: Halbtransparenz/);
    await expect(out).toContainText(/\d+ × \d+ px/);
    await expect(out).toContainText("300 dpi");
    await expect(page.getByTestId("verdict")).toContainText("Nicht druckbar");
    await expect(page.getByTestId("check-semi")).toHaveAttribute("data-state", "error");
    await page.getByTestId("show-ok").click();
    for (const id of ["resolution", "fit", "semi", "strokes"])
      await expect(page.getByTestId(`check-${id}`)).toBeVisible();
    await expect(page.getByTestId("print-canvas")).toBeVisible();
    await shotBothThemes(page, "druck");
  });

  test("Export: eine PNG in der gewählten Datei, Pixelmaße, 300 dpi (pHYs), Farbprofil eingebettet", async () => {
    const { page, answerDialog, outDir } = app();
    const target = join(outDir, "probe-motiv_export.png");
    const out = page.getByTestId("print-output");
    // Beheben: Halbtransparenz wird beim Export hart gerechnet; danach ist der Export frei
    await page.getByTestId("check-semi").getByRole("button").first().click();
    await page.getByTestId("fix-semiTransparency").click();
    await expect(page.getByTestId("check-semi")).toContainText("wird beim Export behoben");
    await expect(out).toHaveAttribute("data-state", "ready");
    // Was die Leiste verspricht, schreibt Rust auch (ohne „Vergrößern erlauben“ nie mehr Pixel als das Motiv hat)
    const promised = /(\d+) × (\d+) px/.exec(await out.innerText());
    expect(promised, "Maße in der Ausgangsleiste").toBeTruthy();
    const [promisedW, promisedH] = [Number(promised?.[1]), Number(promised?.[2])];
    answerDialog([target]);
    await page.getByTestId("print-canvas").focus();
    await page.keyboard.press("Control+Enter");
    await expect(out).toHaveAttribute("data-state", "done", { timeout: 60_000 });
    expect(existsSync(target)).toBe(true);
    expect(statSync(target).size).toBeGreaterThan(10_000);
    const png = readPng(target);
    expect(png.bitDepth).toBe(8);
    expect(png.width).toBeGreaterThan(0);
    expect(png.height).toBeGreaterThan(0);
    // Zuschnitt auf das Motiv, nie hochgerechnet: genau die Maße aus der Leiste, nicht größer als die Quelle
    expect([png.width, png.height]).toEqual([promisedW, promisedH]);
    expect(png.width).toBeLessThanOrEqual(source.width);
    expect(png.height).toBeLessThanOrEqual(source.height);
    expect(png.pixelsPerMeter).toEqual({ x: 11811, y: 11811 });
    expect(png.dpi).toBe(300);
    expect(png.profileName, "eingebettetes Farbprofil (iCCP)").toBeTruthy();
    expect(png.profileBytes).toBeGreaterThan(200);
    // die Leiste nennt, was geschrieben wurde
    await expect(out).toContainText("Gespeichert:");
    await expect(out).toContainText("probe-motiv_export.png");
    await shotBothThemes(page, "druck-exportiert");
  });

  test("keine Konsolenfehler, keine CSP-Verstöße, keine abgelehnten IPC-Aufrufe", async () => {
    await expectClean(app());
  });
});
