import { expect, test } from "@playwright/test";
import { mockCalls, openApp } from "./helpers";

test.describe("Programm installieren (CONCEPT.md 6.2, DESIGN.md Vertrag „Vertrauen“)", () => {
  test("Die Übersicht vor dem Laden zeigt die sechs Felder und verlangt eine ausdrückliche Aktion", async ({
    page,
  }) => {
    await openApp(page, "programme");
    await page.getByTestId("row-action-blender").click();
    const dialog = page.getByTestId("install-dialog");
    await expect(dialog).toBeVisible();
    for (const label of ["Quelle", "Version", "Größe", "Lizenz", "Prüfsumme", "Zielordner"]) {
      await expect(dialog.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(dialog.getByText("download.blender.org")).toBeVisible();
    await expect(dialog.getByText("offizielle Quelle")).toBeVisible();
    await expect(dialog.getByText("GPL-3.0-or-later", { exact: false }).first()).toBeVisible();
    await expect(dialog.getByTestId("checksum-short")).toContainText(
      /SHA-256 [0-9a-f]{4} [0-9a-f]{4} … [0-9a-f]{4} [0-9a-f]{4}/,
    );
    await expect(dialog.getByText("ohne Administratorrechte")).toBeVisible();
    // ohne Zustimmung wird nichts geladen
    expect(await mockCalls(page)).not.toContain("install_start");
    // Fokus startet auf der Überschrift
    await expect(dialog.getByRole("heading", { name: /Blender installieren/i })).toBeFocused();
  });

  test("Alle 64 Zeichen der Prüfsumme lassen sich zeigen und kopieren", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openApp(page, "programme");
    await page.getByTestId("row-action-blender").click();
    const dialog = page.getByTestId("install-dialog");
    await dialog.getByRole("button", { name: "Alle 64 Zeichen zeigen" }).click();
    await expect(dialog.getByRole("group", { name: "Prüfsumme" }).locator(".sum__g")).toHaveCount(16);
  });

  test("Installieren: Laden → Prüfen → Installieren → Einrichten, danach Ergebnis und Starten", async ({ page }) => {
    await openApp(page, "programme", { speed: 6 });
    await page.getByTestId("row-action-blender").click();
    await page.getByTestId("install-confirm").click();
    const dialog = page.getByTestId("install-dialog");
    await expect(dialog.getByTestId("phase-download")).toContainText(/MB/);
    // Esc schließt während des Laufs nicht
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("install-done")).toBeVisible({ timeout: 40_000 });
    await expect(dialog.getByRole("heading", { name: /Blender 5\.2\.2 installiert/i })).toBeVisible();
    await expect(dialog.getByTestId("phase-verify")).toHaveText("Prüfsumme stimmt");
    await expect(dialog.getByTestId("phase-setup")).toContainText("Bausteine angewendet");
    await page.getByTestId("install-launch").click();
    await expect(dialog).toBeHidden();
    const calls = await mockCalls(page);
    expect(calls).toEqual(
      expect.arrayContaining(["install_preview", "install_start", "setup_preview", "setup_apply", "program_launch"]),
    );
    await expect(page.getByTestId("program-blender")).toContainText("eingerichtet");
  });

  test("Abbrechen löscht Teildateien und sagt es", async ({ page }) => {
    await openApp(page, "programme", { speed: 4 });
    await page.getByTestId("row-action-blender").click();
    await page.getByTestId("install-confirm").click();
    const dialog = page.getByTestId("install-dialog");
    await expect(dialog.getByTestId("phase-download")).toContainText(/MB/);
    await dialog.getByTestId("install-cancel").click();
    await expect(dialog.getByText("Abgebrochen.")).toBeVisible();
    await expect(dialog.getByText("Teildateien wurden gelöscht")).toBeVisible();
    await dialog.getByRole("button", { name: "Schließen" }).first().click();
    await expect(page.getByTestId("program-blender")).toContainText("nicht installiert");
  });

  test("Prüfsumme falsch: Sicherheitswarnung, beide Summen, nichts installiert", async ({ page }) => {
    await openApp(page, "programme", { scenario: "installChecksumFail" });
    await page.getByTestId("row-action-blender").click();
    await page.getByTestId("install-confirm").click();
    const err = page.getByTestId("checksum-error");
    await expect(err).toBeVisible({ timeout: 30_000 });
    await expect(err.getByText("Prüfsumme stimmt nicht. Die Datei wurde verworfen.")).toBeVisible();
    await expect(err.getByText("Es wurde nichts installiert und nichts ausgeführt.")).toBeVisible();
    await expect(err.getByTestId("checksum-diff")).toContainText(/von 16 Blöcken weich/);
    await expect(err.getByRole("group", { name: "Erwartet" })).toBeVisible();
    await expect(err.getByRole("group", { name: "Berechnet" })).toBeVisible();
    await expect(err.locator(".sum__g--diff").first()).toBeVisible();
    const retry = page.getByTestId("install-retry");
    await expect(retry).toHaveText("Erneut laden und prüfen");
    await expect(retry).toBeFocused();
    await page.getByRole("button", { name: "Schließen" }).first().click();
    await expect(page.getByTestId("program-blender")).toContainText("nicht installiert");
  });

  test("Netz weg: Fehler nennt Host und Stand, Nichts ist installiert", async ({ page }) => {
    await openApp(page, "programme", { scenario: "installNetworkFail", speed: 40 });
    await page.getByTestId("row-action-blender").click();
    await page.getByTestId("install-confirm").click();
    const dialog = page.getByTestId("install-dialog");
    await expect(dialog.getByText(/Verbindung zu download\.blender\.org abgebrochen bei \d+ von 380 MB\./)).toBeVisible(
      { timeout: 30_000 },
    );
    await expect(dialog.getByText(/Nichts ist installiert/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Jetzt erneut" })).toBeVisible();
  });

  test("Im Hintergrund weiter: Dialog schließt, Auftrag läuft in den Aufträgen", async ({ page }) => {
    await openApp(page, "programme", { speed: 3 });
    await page.getByTestId("row-action-blender").click();
    await page.getByTestId("install-confirm").click();
    await page.getByTestId("install-background").click();
    await expect(page.getByTestId("install-dialog")).toBeHidden();
    await expect(page.getByTestId("program-blender")).toContainText(/lädt \d+ %|wird geprüft|wird installiert/);
    await page.keyboard.press("Control+j");
    await expect(page.getByTestId("jobs-popover").getByTestId("job-active")).toHaveCount(1);
    await page.keyboard.press("Escape");
  });

  test("Aktualisieren zeigt den Ersatz der alten Version", async ({ page }) => {
    await openApp(page, "programme");
    await page.getByTestId("row-action-krita").click();
    const dialog = page.getByTestId("install-dialog");
    await expect(dialog.getByRole("heading", { name: /Krita aktualisieren/i })).toBeVisible();
    await expect(dialog.getByText(/Ersetzt Krita 5\.3\.3/)).toBeVisible();
    await expect(dialog.getByText("vom Kollektiv festgeschrieben", { exact: false })).toBeVisible();
  });
});
