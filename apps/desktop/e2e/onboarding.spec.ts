import { expect, test } from "@playwright/test";
import { mockCalls, openApp } from "./helpers";

test.describe("Erststart „In 30 Minuten startklar“ (CONCEPT.md 6.10)", () => {
  test("Neustart leitet in den Erststart; reduzierte Bewegung zeigt sofort Kanal 3", async ({ page }) => {
    await openApp(page, "start", { scenario: "fresh" });
    const k = page.getByTestId("kennung");
    await expect(k).toBeVisible();
    await expect(k).toHaveAttribute("data-channel", "2");
    await expect(k).toHaveAttribute("data-done", "true");
    await expect(k).toContainText("KANAL 3 · CYPHER STUDIO");
    const cypher = await page
      .locator(".kennung__title .fit__text")
      .first()
      .evaluate((e) => Math.round(e.getBoundingClientRect().width));
    const studio = await page
      .locator(".kennung__title .fit__text")
      .nth(1)
      .evaluate((e) => Math.round(e.getBoundingClientRect().width));
    expect(Math.abs(cypher - studio)).toBeLessThanOrEqual(8); // beide Wörter füllen die Breite exakt
  });

  test("Suchlauf schneidet 1 → 2 → 3 im 800-ms-Takt, eine Taste springt zum Ende", async ({ page }) => {
    await openApp(page, "erststart", { scenario: "fresh", reducedMotion: false });
    const k = page.getByTestId("kennung");
    await expect(k).toHaveAttribute("data-channel", "0");
    await expect(k).toHaveAttribute("data-channel", "1", { timeout: 2000 });
    await expect(k).toHaveAttribute("data-channel", "2", { timeout: 2000 });
    await expect(k).toHaveAttribute("data-done", "true", { timeout: 2000 });
    // neuer Lauf: Taste überspringt
    await openApp(page, "erststart", { scenario: "fresh", reducedMotion: false });
    await page.keyboard.press("x");
    await expect(page.getByTestId("kennung")).toHaveAttribute("data-channel", "2");
    await expect(page.getByTestId("kennung-start")).toBeVisible();
  });

  test("Alle Schritte: Auswahl → Ordner → Prüfen → Laden → Einrichten → Probelauf → Startklar", async ({ page }) => {
    await openApp(page, "erststart", { scenario: "fresh", speed: 80 });
    await page.getByTestId("kennung-start").click();
    // 1 Auswahl: Standard Krita + Inkscape
    await expect(page.getByRole("heading", { name: "Was machst du vor allem?" })).toBeVisible();
    await expect(page.getByTestId("ob-program-krita")).toBeChecked();
    await expect(page.getByTestId("ob-program-inkscape")).toBeChecked();
    await expect(page.getByTestId("ob-program-blender")).not.toBeChecked();
    await expect(page.getByTestId("ob-size")).toContainText("Zusammen 302 MB");
    await expect(page.getByTestId("schedule")).toBeVisible();
    await page.getByTestId("ob-next").click();
    // 2 Ordner
    await page.getByTestId("ob-choose-folder").click();
    await page.getByTestId("choose-root-use").click();
    await expect(page.getByTestId("ob-folder")).toContainText("D:\\Sync\\Cypher");
    await page.getByTestId("ob-next").click();
    // 3 Prüfen und zustimmen
    const table = page.getByTestId("ob-review");
    await expect(table).toContainText("download.kde.org");
    await expect(table).toContainText("inkscape.org");
    await expect(table.locator("tbody tr")).toHaveCount(2);
    await page.getByTestId("ob-next").click();
    // 4 Laden (läuft im Hintergrund)
    await expect(page.getByTestId("ob-downloads")).toBeVisible();
    await expect(page.getByTestId("ob-state-krita")).toContainText(/installiert|MB/, { timeout: 30_000 });
    await expect(page.getByTestId("ob-next")).toHaveText(/Weiter/, { timeout: 40_000 });
    await page.getByTestId("ob-next").click();
    // 5 Einrichten
    await expect(page.getByTestId("ob-setup")).toContainText("Bausteine angewendet", { timeout: 20_000 });
    await page.getByTestId("ob-next").click();
    // 6 Probelauf mit dem Probe-Motiv
    await expect(page.getByRole("heading", { name: "Probelauf" })).toBeVisible();
    await expect(page.getByText("Druckbar mit Hinweisen").first()).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("ob-next").click();
    // Startklar
    await expect(page.getByTestId("ready-band")).toContainText("STARTKLAR");
    await expect(page.getByTestId("screen-ready")).toContainText("KRITA");
    await expect(page.getByTestId("screen-ready")).toContainText("VORLAGEN");
    await page.getByTestId("ready-done").click();
    await expect(page.getByTestId("screen-start")).toBeVisible();
    const calls = await mockCalls(page);
    expect(calls.filter((c) => c === "install_start")).toHaveLength(2);
    // Erststart gilt als beendet (der Mock hält Einstellungen nur im Speicher, darum prüfen wir den gespeicherten Stand)
    const lastStatus = await page.evaluate(() => {
      const updates = (window.__CYPHER_MOCK__?.calls() ?? []).filter((c) => c.cmd === "settings_update");
      const args = updates[updates.length - 1]?.args as { req?: { onboarding?: { status?: string } } } | undefined;
      return args?.req?.onboarding?.status;
    });
    expect(lastStatus).toBe("done");
  });

  test("Später weitermachen merkt den Stand: Start zeigt „Einrichtung zu …“", async ({ page }) => {
    await openApp(page, "erststart", { scenario: "fresh" });
    await page.getByTestId("kennung-start").click();
    await page.getByTestId("ob-next").click();
    await page.getByTestId("ob-later").click();
    await expect(page.getByTestId("screen-start")).toBeVisible();
    await expect(page.getByTestId("resume-banner")).toContainText("Einrichtung zu");
  });

  test("Später weitermachen gleich in der Kennung: Start erscheint auch, wenn das Speichern etwas dauert", async ({
    page,
  }) => {
    // Im echten IPC braucht das Speichern der Einstellungen einen Moment; die Weiterleitung in den Erststart darf nicht schneller sein
    await openApp(page, "erststart", { scenario: "fresh", delay: { settings_update: 400 } });
    await page.getByTestId("kennung-later").click();
    await expect(page.getByTestId("screen-start")).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.getByTestId("screen-start")).toBeVisible();
    await expect(page.getByTestId("kennung")).toHaveCount(0);
  });

  test("Ein Programm scheitert: Rest geht weiter, Hinweis nennt den Nachholweg", async ({ page }) => {
    await openApp(page, "erststart", { scenario: "fresh+installNetworkFail", speed: 80 });
    await page.getByTestId("kennung-start").click();
    await page.getByTestId("ob-next").click();
    await page.getByTestId("ob-choose-folder").click();
    await page.getByTestId("choose-root-use").click();
    await page.getByTestId("ob-next").click();
    await page.getByTestId("ob-next").click();
    await expect(page.getByText(/konnte nicht geladen werden/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/später unter Programme nachholen/).first()).toBeVisible();
  });
});
