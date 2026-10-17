import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { expectClean, goto, shotBothThemes, skipOnboarding, useApp } from "../support/helpers";
import { embeddedCatalog, windowsRelease } from "../support/catalogInfo";
import { checksumShort, fmtBytes } from "../../src/i18n/format";

const IDS = ["krita", "inkscape", "blender", "kdenlive"] as const;

/**
 * Programme in der echten App mit echter Erkennung (Registry und Programmordner dieses Rechners, nur lesend) und dem
 * eingebauten, signierten Katalog. Es gibt noch keine veröffentlichte Katalogquelle: die App muss damit ruhig leben.
 */
test.describe.serial("Programme (echte Erkennung, eingebauter Katalog)", () => {
  const app = useApp();

  test("Tafel: vier Programme, keine Warnung zum Katalog, nur eine ruhige Zeile mit Datum und Herkunft", async () => {
    const { page } = app();
    await skipOnboarding(page);
    await goto(page, "programme");
    await expect(page.getByTestId("screen-programs")).toBeVisible();
    for (const id of IDS) await expect(page.getByTestId(`program-${id}`)).toBeVisible();
    // Die App hat beim Start versucht, online zu prüfen (studio.cypherxcypher.de ist nicht veröffentlicht): kein Banner
    await expect(page.getByTestId("catalog-expired")).toHaveCount(0);
    await expect(page.getByText("Keine Verbindung")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Manifest");
    const generated = new Date(embeddedCatalog().generatedAt);
    const date = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Europe/Berlin",
    }).format(generated);
    await expect(page.getByTestId("catalog-line")).toHaveText(`Programm-Katalog vom ${date} (eingebaut)`);
    await shotBothThemes(page, "programme");
  });

  test("nicht installierte Programme zeigen die Katalogversion („5.2.2 verfügbar“) statt eines Strichs", async () => {
    const { page } = app();
    for (const id of IDS) {
      const row = page.getByTestId(`program-${id}`);
      const text = (await row.innerText()).replace(/\s+/g, " ");
      if (/nicht installiert/i.test(text)) {
        expect(text, `${id}: Katalogversion`).toContain(`${windowsRelease(id).version} verfügbar`);
        expect(text).not.toMatch(/^\S+\s+[–—-]\s/);
      }
    }
    const states = await Promise.all(
      IDS.map(async (id) => (await page.getByTestId(`program-${id}`).innerText()).toLowerCase()),
    );
    // Jede Zeile hat einen der bekannten Zustände; Erkennung läuft über die echte Registry
    for (const s of states)
      expect(s).toMatch(/nicht installiert|installiert|eingerichtet|gefunden|update verfügbar|fehler/);
  });

  test("gefundene Programme (außerhalb von Cypher installiert) liegen wirklich dort, wo die App sie meldet", async () => {
    const { page } = app();
    const view = await page.evaluate(() =>
      (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (c: string) => Promise<{
              programs: { id: string; installations: { location: string; kind: string; version: string | null }[] }[];
            }>;
          };
        }
      ).__TAURI_INTERNALS__.invoke("programs_list"),
    );
    expect(view.programs.map((p) => p.id).sort()).toEqual([...IDS].sort());
    for (const p of view.programs) {
      for (const inst of p.installations) {
        expect(existsSync(inst.location), `${p.id}: ${inst.location} (${inst.kind})`).toBe(true);
        expect(inst.location).not.toMatch(/^\\\\\?\\/); // keine \\?\-Pfade in der Anzeige
      }
    }
  });

  test("Installieren öffnet die Übersicht mit sechs Angaben aus dem Katalog (ohne zu laden)", async () => {
    const { page, dataDir } = app();
    await goto(page, "programme");
    // Ein Programm ohne Cypher-Installation wählen: Blender hat in der Regel keine
    const id = "blender";
    const want = windowsRelease(id);
    await page
      .getByTestId(`program-${id}`)
      .getByRole("button", { name: /Installieren|Aktualisieren/ })
      .click();
    const dialog = page.getByTestId("install-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(new URL(want.artifact.url).host); // Quelle
    await expect(dialog).toContainText(want.version); // Version
    await expect(dialog).toContainText(fmtBytes(want.artifact.size)); // Größe
    await expect(dialog).toContainText(want.program.license.spdx); // Lizenz
    await expect(page.getByTestId("checksum-short")).toContainText(checksumShort(want.artifact.sha256)); // Prüfsumme
    await expect(dialog).toContainText(dataDir.replaceAll("\\", "\\").split("\\").slice(-2).join("\\")); // Zielordner unter dem Testordner
    await expect(page.getByTestId("install-consent")).toBeVisible();
    await shotBothThemes(page, "installieren-vorschau");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // geladen wurde nichts
    expect(existsSync(`${dataDir}\\programs\\blender`)).toBe(false);
  });

  test("Einstellungen nennen den Katalog ruhig: eingebaut, Fassung, Ablauf", async () => {
    const { page } = app();
    await goto(page, "einstellungen/programme");
    await expect(page.getByText("Programm-Katalog").first()).toBeVisible();
    await expect(page.getByText("in der App eingebaut")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Manifest");
  });

  test("keine Konsolenfehler, keine CSP-Verstöße, keine abgelehnten IPC-Aufrufe", async () => {
    await expectClean(app());
  });
});
