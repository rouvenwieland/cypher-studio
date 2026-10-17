import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expectClean, goto, reloadApp, shotBothThemes, skipOnboarding, useApp } from "../support/helpers";
import { embeddedCatalog } from "../support/catalogInfo";

const TABS = [
  "darstellung",
  "arbeitsflaeche",
  "programme",
  "bibliothek",
  "profile",
  "updates",
  "netzwerk",
  "kuerzel",
  "ueber",
];

/** Einstellungen in der echten App: alle Bereiche öffnen, ändern, auf der Platte nachsehen, Neustart-Verhalten. */
test.describe.serial("Einstellungen", () => {
  const app = useApp();

  test("alle neun Bereiche öffnen ohne Fehler und zeigen Inhalt", async () => {
    const { page } = app();
    await skipOnboarding(page);
    for (const tab of TABS) {
      await goto(page, `einstellungen/${tab}`);
      await expect(page.getByTestId(`settings-nav-${tab}`)).toHaveAttribute("aria-current", "page");
      await expect(page.locator(".settings__content")).not.toBeEmpty();
    }
  });

  test("Darstellung: Tinte setzt das Thema und wird in settings.json geschrieben", async () => {
    const { page, root } = app();
    await goto(page, "einstellungen/darstellung");
    await page.getByRole("radio", { name: "Tinte" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const file = join(root, "config", "settings.json");
    await expect.poll(() => existsSync(file), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => JSON.parse(readFileSync(file, "utf8")).ui?.theme ?? null, { timeout: 10_000 }).toBe("ink");
    await shotBothThemes(page, "einstellungen");
    await page.getByRole("radio", { name: "Papier" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("Programme: Katalog nennt Herkunft eingebaut, Fassung, Ablauf; kein Wort „Manifest“", async () => {
    const { page } = app();
    await goto(page, "einstellungen/programme");
    const cat = embeddedCatalog();
    await expect(page.getByText("in der App eingebaut")).toBeVisible();
    await expect(page.locator(".settings__content")).toContainText(String(cat.sequence));
    await expect(page.locator("body")).not.toContainText("Manifest");
    // Programm-Katalog jetzt prüfen: ohne veröffentlichte Quelle scheitert der Abruf ruhig, der eingebaute Katalog gilt weiter
    await page.getByRole("button", { name: "Programm-Katalog jetzt prüfen" }).click();
    await expect(page.getByTestId("catalog-expired")).toHaveCount(0);
    await expect(page.locator(".settings__content")).toContainText("in der App eingebaut");
  });

  test("Netzwerk und Daten: jede Adresse steht in der Liste, keine Telemetrie", async () => {
    const { page } = app();
    await goto(page, "einstellungen/netzwerk");
    const table = page.getByTestId("network-table");
    for (const host of ["studio.cypherxcypher.de", "download.kde.org", "inkscape.org", "download.blender.org"]) {
      await expect(table).toContainText(host);
    }
    await expect(table).not.toContainText("cypher-kollektiv");
    await expect(page.getByText("aus, es gibt keine")).toBeVisible();
  });

  test("Über: die echte Version von App und Vertrag", async () => {
    const { page } = app();
    await goto(page, "einstellungen/ueber");
    await expect(page.getByText("0.1.0 (dev)")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("0.4.0");
    const info = await page.evaluate(() =>
      (
        window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }
      ).__TAURI_INTERNALS__.invoke("app_info", {}),
    );
    expect(info).toMatchObject({ appVersion: "0.1.0", contractVersion: "0.3.0", os: "windows" });
    await shotBothThemes(page, "einstellungen-ueber");
  });

  test("Einstellung überlebt einen Neustart der Seite (settings.json wird wieder gelesen)", async () => {
    const { page, root } = app();
    await goto(page, "einstellungen/darstellung");
    await page.getByRole("radio", { name: "Groß" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "large");
    // erst neu laden, wenn Rust gespeichert hat (sonst bricht das Neuladen die laufende Anfrage ab)
    await expect
      .poll(() => JSON.parse(readFileSync(join(root, "config", "settings.json"), "utf8")).ui?.density ?? null, {
        timeout: 10_000,
      })
      .toBe("large");
    await reloadApp(app());
    await expect(page.locator("html")).toHaveAttribute("data-density", "large");
  });

  test("keine Konsolenfehler, keine CSP-Verstöße, keine abgelehnten IPC-Aufrufe", async () => {
    await expectClean(app(), { ipc: ["catalog_refresh"] });
  });
});
