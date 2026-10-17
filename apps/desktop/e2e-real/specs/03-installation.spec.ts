import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expandHome, expectClean, goto, shotBothThemes, skipOnboarding, useApp } from "../support/helpers";
import { FIXTURE_VERSION, startFixtures, type Fixtures } from "../support/fixtures";
import { checksumShort, fmtBytes } from "../../src/i18n/format";

interface ProgramsView {
  programs: { id: string; installations: { id: string; kind: string; version: string | null; location: string }[] }[];
}

/**
 * Installation gegen einen LOKALEN Test-Server (BAU-REGELN 9): kleine Fixture-Zips statt echter Programme. Der Katalog
 * ist der echte, um zwei Fixture-Versionen ergänzt und mit einem Testschlüssel signiert (liegt im Katalog-Zwischenspeicher
 * der App, der Schlüssel kommt über `CYPHER_DEV_TRUST_KEY`). Erkennung und Einrichtung sehen nur den Wegwerf-Ordner.
 */
test.describe.serial("Installation (lokaler Test-Server)", () => {
  let fx: Fixtures;
  test.beforeAll(async () => {
    fx = await startFixtures();
  });
  test.afterAll(async () => {
    await fx.close();
  });
  const app = useApp(() => ({ fixtures: fx }));

  const programs = (): Promise<ProgramsView> =>
    app().page.evaluate(() =>
      (
        window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<ProgramsView> } }
      ).__TAURI_INTERNALS__.invoke("programs_list"),
    );

  test("der signierte Test-Katalog gilt: Fixture-Version steht in der Tafel, Herkunft ist der Zwischenspeicher", async () => {
    const { page } = app();
    await skipOnboarding(page);
    await goto(page, "programme");
    await expect(page.getByTestId("program-krita")).toContainText(`${FIXTURE_VERSION.krita} verfügbar`);
    await expect(page.getByTestId("program-inkscape")).toContainText(`${FIXTURE_VERSION.inkscape} verfügbar`);
    await expect(page.getByTestId("catalog-expired")).toHaveCount(0);
    await expect(page.getByTestId("catalog-line")).toContainText("zuletzt online geladen");
    // In der getrennten Umgebung ist nichts installiert
    const view = await programs();
    expect(view.programs.flatMap((p) => p.installations)).toEqual([]);
  });

  test("Übersicht vor dem Laden: sechs Angaben mit den Werten des Katalogs", async () => {
    const { page, root } = app();
    await page.getByTestId("row-action-krita").click();
    const dialog = page.getByTestId("install-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: /Krita installieren/i })).toBeFocused();
    for (const label of ["Quelle", "Version", "Größe", "Lizenz", "Prüfsumme", "Zielordner"]) {
      await expect(dialog.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(dialog).toContainText(new URL(fx.origin).hostname);
    await expect(dialog).toContainText(FIXTURE_VERSION.krita);
    await expect(dialog).toContainText("GPL-3.0-or-later");
    await expect(page.getByTestId("checksum-short")).toContainText(checksumShort(fx.kritaSha256));
    // der Zielordner liegt im Wegwerf-Ordner (die Anzeige kürzt den Heimatordner zu „~“)
    await expect(dialog).toContainText(join(basename(root), "data", "programs", "krita", FIXTURE_VERSION.krita));
    await expect(page.getByTestId("install-consent")).toBeVisible();
    await shotBothThemes(page, "installieren-testserver");
    expect(fx.hits.get("/krita-fixture.zip") ?? 0).toBe(0); // ohne Zustimmung wird nichts geladen
  });

  test("Installieren: Laden, Prüfen, Entpacken, Eintragen; die Datei ist da, die Summe stimmt", async () => {
    const { page, dataDir } = app();
    const dialog = page.getByTestId("install-dialog");
    // Einrichtung kommt in einem eigenen Test dran
    const setupBox = dialog.getByRole("checkbox").first();
    if (await setupBox.isChecked()) await setupBox.uncheck();
    await page.getByTestId("install-confirm").click();
    await expect(dialog.getByTestId("install-done")).toBeVisible({ timeout: 60_000 });
    await expect(
      dialog.getByRole("heading", { name: new RegExp(`Krita ${FIXTURE_VERSION.krita} installiert`) }),
    ).toBeVisible();
    await expect(dialog.getByTestId("phase-verify")).toHaveText("Prüfsumme stimmt");
    expect(fx.hits.get("/krita-fixture.zip") ?? 0).toBeGreaterThan(0);

    const view = await programs();
    const krita = view.programs.find((p) => p.id === "krita");
    expect(krita?.installations).toHaveLength(1);
    const inst = krita?.installations[0];
    expect(inst?.kind).toBe("cypher");
    expect(inst?.version).toBe(FIXTURE_VERSION.krita);
    // `location` ist die Startdatei der Installation
    const exe = expandHome(inst?.location ?? "");
    expect(exe.endsWith(join("5.9.9", "bin", "krita.exe"))).toBe(true);
    expect(exe.startsWith(dataDir)).toBe(true);
    expect(existsSync(exe)).toBe(true);
    expect(createHash("sha256").update(readFileSync(exe)).digest("hex")).toBe(fx.kritaExeSha256);
    // Zwischenordner aufgeräumt
    const staging = join(dataDir, "programs", ".staging");
    expect(!existsSync(staging) || readdirSync(staging).length === 0).toBe(true);
    await shotBothThemes(page, "installieren-fertig");
    await page.getByTestId("install-close").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("program-krita")).toContainText("installiert");
    await expect(page.getByTestId("program-krita")).toContainText(FIXTURE_VERSION.krita);
  });

  test("Prüfsumme falsch: Sicherheitswarnung, beide Summen, nichts installiert, nichts ausgeführt", async () => {
    const { page, dataDir } = app();
    await goto(page, "programme");
    await page.getByTestId("row-action-inkscape").click();
    await page.getByTestId("install-confirm").click();
    const err = page.getByTestId("checksum-error");
    await expect(err).toBeVisible({ timeout: 60_000 });
    await expect(err.getByText("Prüfsumme stimmt nicht. Die Datei wurde verworfen.")).toBeVisible();
    await expect(err.getByText("Es wurde nichts installiert und nichts ausgeführt.")).toBeVisible();
    await expect(err.getByTestId("checksum-diff")).toContainText(/von 16 Blöcken weich/);
    await expect(page.getByTestId("install-retry")).toHaveText("Erneut laden und prüfen");
    await shotBothThemes(page, "installieren-pruefsumme");
    expect(fx.hits.get("/inkscape-fixture.zip") ?? 0).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Schließen" }).first().click();
    await expect(page.getByTestId("program-inkscape")).toContainText("nicht installiert");
    const programsDir = join(dataDir, "programs");
    const names = existsSync(programsDir) ? readdirSync(programsDir).filter((n) => !n.startsWith(".")) : [];
    expect(names.some((n) => /inkscape/i.test(n))).toBe(false);
    // die verworfene Datei liegt nicht im Download-Zwischenspeicher
    const downloads = join(app().root, "cache", "downloads");
    const left = existsSync(downloads) ? readdirSync(downloads).filter((n) => /inkscape/i.test(n)) : [];
    expect(left).toEqual([]);
    void fmtBytes;
  });

  test("keine Konsolenfehler, keine CSP-Verstöße; abgelehnt wurde nur die Installation mit falscher Prüfsumme", async () => {
    await expectClean(app(), { ipc: ["install_start"] });
  });
});
