import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectClean, goto, shotBothThemes, useApp } from "../support/helpers";
import { windowsRelease } from "../support/catalogInfo";
import { fmtBytes } from "../../src/i18n/format";

/**
 * Erststart in der echten App: Kennung mit der echten Version, Auswahl mit den Größen des Katalogs, Ordnerwahl über einen
 * beantworteten (nicht angezeigten) nativen Dialog, Übersicht vor dem Laden. Es wird nichts geladen: der Ablauf endet mit
 * „Später weitermachen“, bevor der Download beginnt.
 */
test.describe.serial("Erststart", () => {
  const app = useApp();

  test("Kennung zeigt die echte Version der App, nicht eine feste Zahl", async () => {
    const { page } = app();
    const kennung = page.getByTestId("kennung");
    await expect(kennung).toBeVisible();
    await expect(kennung).toHaveAttribute("data-done", "true", { timeout: 10_000 });
    const info = await page.evaluate(() =>
      (
        window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<{ appVersion: string }> } }
      ).__TAURI_INTERNALS__.invoke("app_info"),
    );
    expect(info.appVersion).toBe("0.1.0");
    await expect(kennung).toContainText(`KANAL 3 · CYPHER STUDIO ${info.appVersion} · BERLIN`);
    await expect(kennung).not.toContainText("0.4.0");
    await shotBothThemes(page, "erststart");
  });

  test("„Später weitermachen“ gleich in der Kennung führt zur Startseite und bleibt dort", async () => {
    const { page } = app();
    await page.getByTestId("kennung-later").click();
    await expect(page.getByTestId("screen-start")).toBeVisible();
    await page.waitForTimeout(1500); // die Hülle darf nicht in den Erststart zurückschicken, auch wenn das Speichern etwas dauert
    await expect(page.getByTestId("screen-start")).toBeVisible();
    const status = await page.evaluate(() =>
      (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (c: string) => Promise<{ onboarding: { status: string } }> };
        }
      ).__TAURI_INTERNALS__.invoke("settings_get"),
    );
    expect(status.onboarding.status).toBe("inProgress");
    await goto(page, "erststart");
    await expect(page.getByTestId("kennung")).toBeVisible();
  });

  test("Auswahl: Standard Krita und Inkscape, Größen aus dem eingebauten Katalog", async () => {
    const { page } = app();
    await page.getByTestId("kennung-start").click();
    await expect(page.getByRole("heading", { name: "Was machst du vor allem?" })).toBeVisible();
    await expect(page.getByTestId("ob-program-krita")).toBeChecked();
    await expect(page.getByTestId("ob-program-inkscape")).toBeChecked();
    await expect(page.getByTestId("ob-program-blender")).not.toBeChecked();
    const krita = windowsRelease("krita").artifact.size;
    const inkscape = windowsRelease("inkscape").artifact.size;
    await expect(page.getByTestId("ob-size")).toContainText(`Zusammen ${fmtBytes(krita + inkscape)}`);
    await expect(page.getByTestId("schedule")).toBeVisible();
    await shotBothThemes(page, "erststart-auswahl");
  });

  test("Ordner wählen über den beantworteten Dialog, Übersicht nennt die echten Quellen", async () => {
    const { page, root, answerDialog } = app();
    await page.getByTestId("ob-next").click();
    const folder = join(root, "Cypher-Ordner");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "hallo.txt"), "Testordner");
    answerDialog([folder]);
    await page.getByTestId("ob-choose-folder").click();
    await page.getByTestId("choose-root-use").click();
    await expect(page.getByTestId("ob-folder")).toContainText("Cypher-Ordner");
    await page.getByTestId("ob-next").click();
    const table = page.getByTestId("ob-review");
    const kritaHost = new URL(windowsRelease("krita").artifact.url).host;
    const inkscapeHost = new URL(windowsRelease("inkscape").artifact.url).host;
    await expect(table).toContainText(kritaHost);
    await expect(table).toContainText(inkscapeHost);
    await expect(table.locator("tbody tr")).toHaveCount(2);
    await shotBothThemes(page, "erststart-ordner-pruefen");
  });

  test("Später weitermachen: nichts wurde geladen, die Hauptansichten sind erreichbar", async () => {
    const { page, dataDir } = app();
    await page.getByText("Später weitermachen").first().click();
    await expect(page.getByTestId("screen-start")).toBeVisible();
    // Keine Programmordner, kein Download-Zwischenspeicher
    const { existsSync, readdirSync } = await import("node:fs");
    const programs = join(dataDir, "programs");
    expect(!existsSync(programs) || readdirSync(programs).filter((n) => !n.startsWith(".")).length === 0).toBe(true);
  });

  test("keine Konsolenfehler, keine CSP-Verstöße, keine abgelehnten IPC-Aufrufe", async () => {
    await expectClean(app());
  });
});
