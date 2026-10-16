import { expect, test } from "@playwright/test";
import { mockCalls, openApp } from "./helpers";

test.describe("Bibliothek (CONCEPT.md 6.7)", () => {
  test("zeigt 3.104 Dateien, nur sichtbare Zellen stehen im DOM (virtualisiert)", async ({ page }) => {
    await openApp(page, "bibliothek");
    await expect(page.getByTestId("library-count")).toContainText("3.104 von 3.104 Dateien");
    const cells = await page.locator('[data-testid^="cell-"]').count();
    expect(cells).toBeGreaterThan(3);
    expect(cells).toBeLessThan(60);
    const facets = page.getByTestId("library-filters");
    await expect(facets.getByText("Bild", { exact: true })).toBeVisible();
    await expect(facets).toContainText("1.840");
  });

  test("5.000 Einträge: Scrollen lädt Seiten nach, Gerüst bleibt klein", async ({ page }) => {
    await openApp(page, "bibliothek", { scenario: "library5000" });
    await expect(page.getByTestId("library-count")).toContainText("5.000 von 5.000");
    const grid = page.getByTestId("library-grid");
    await grid.evaluate((el) => el.scrollTo({ top: el.scrollHeight * 0.9 }));
    await expect
      .poll(async () => (await mockCalls(page)).filter((c) => c === "library_query").length)
      .toBeGreaterThan(1);
    await expect
      .poll(async () => page.locator('[data-testid^="cell-"]').first().getAttribute("data-testid"))
      .not.toBe("cell-0");
    expect(await page.locator('[data-testid^="cell-"]').count()).toBeLessThan(80);
  });

  test("Filter: Art und Kollektion, Chips, Filter lösen", async ({ page }) => {
    await openApp(page, "bibliothek");
    await page
      .getByTestId("library-filters")
      .getByLabel(/Vektor/)
      .check();
    await expect(page.getByTestId("library-count")).toContainText(/von 3\.104/);
    await expect(page.getByTestId("filter-chips")).toContainText("Vektor");
    const count = await page.getByTestId("library-count").innerText();
    expect(count.startsWith("412 ")).toBe(true);
    await page
      .getByTestId("library-filters")
      .getByLabel(/Rauschen/)
      .check();
    await expect(page.getByTestId("filter-chips")).toContainText("Rauschen");
    await page.getByTestId("filters-clear").click();
    await expect(page.getByTestId("library-count")).toContainText("3.104 von 3.104");
  });

  test("Filter ohne Treffer: Satz mit den Begriffen und „Filter lösen“", async ({ page }) => {
    await openApp(page, "bibliothek");
    await page.getByTestId("library-search").fill("gibt-es-nicht-xyz");
    await expect(page.getByTestId("library-nomatch")).toContainText("Keine Datei passt zu");
    await page.getByRole("button", { name: "Filter lösen" }).click();
    await expect(page.getByTestId("library-grid")).toBeVisible();
  });

  test("Auswahl: Klick, Strg-Klick, Mehrfach-Leiste mit Tags setzen", async ({ page }) => {
    await openApp(page, "bibliothek");
    await page.getByTestId("cell-0").click();
    await expect(page.getByTestId("entry-inspector")).toBeVisible();
    await page.getByTestId("cell-1").click({ modifiers: ["Control"] });
    const bar = page.getByTestId("multibar");
    await expect(bar).toContainText("2 ausgewählt");
    await bar.getByTestId("bulk-tags").click();
    await page.getByRole("textbox", { name: "Tag hinzufügen" }).fill("final-test");
    await page.getByTestId("bulk-tags-apply").click();
    await expect.poll(async () => (await mockCalls(page)).includes("library_bulk_meta")).toBe(true);
  });

  test("Inspektor: Tag hinzufügen speichert, zeigt „Gespeichert“", async ({ page }) => {
    await openApp(page, "bibliothek");
    await page.getByTestId("cell-0").click();
    await page.getByTestId("tag-input").fill("neu-getaggt");
    await page.getByTestId("tag-add").click();
    await expect(page.getByTestId("entry-inspector").getByText("Gespeichert")).toBeVisible();
    await expect(page.getByTestId("entry-inspector")).toContainText("neu-getaggt");
  });

  test("Tastatur: Pfeile wählen, Leertaste öffnet die Schnellansicht, Esc schließt", async ({ page }) => {
    await openApp(page, "bibliothek");
    await page.getByTestId("cell-0").click();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("cell-1")).toBeFocused();
    await expect(page.getByTestId("cell-1")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[data-testid^="cell-"]:focus')).toHaveCount(1);
    await page.keyboard.press("Space");
    await expect(page.getByTestId("quick-view")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("quick-view")).toBeHidden();
  });

  test("Strg+F fokussiert die Suche", async ({ page }) => {
    await openApp(page, "bibliothek");
    await page.keyboard.press("Control+f");
    await expect(page.getByTestId("library-search")).toBeFocused();
  });

  test("Listenansicht zeigt Spalten", async ({ page }) => {
    await openApp(page, "bibliothek");
    await page.getByRole("radio", { name: "Liste" }).click();
    await expect(page.getByTestId("row-0")).toBeVisible();
    await expect(page.getByTestId("row-0")).toContainText(/MB|KB/);
  });

  test("Kein Ordner: Leerzustand mit Ordner wählen", async ({ page }) => {
    await openApp(page, "bibliothek", { scenario: "libraryEmpty" });
    await expect(page.getByTestId("library-empty")).toContainText("Noch kein gemeinsamer Ordner");
    await page.getByTestId("choose-folder").click();
    const dialog = page.getByTestId("choose-root-dialog");
    await expect(dialog).toContainText("3.104 Dateien");
    await expect(dialog).toContainText("12 Projekte gefunden");
    await expect(dialog).toContainText("Syncthing");
    await page.getByTestId("choose-root-use").click();
    await expect(page.getByTestId("library-count")).toContainText("3.104 von 3.104", { timeout: 10_000 });
  });

  test("Ordner nicht erreichbar: Fehlerzustand mit zwei Wegen", async ({ page }) => {
    await openApp(page, "start", { scenario: "folderLost" });
    await expect(page.getByTestId("projects-error")).toContainText("D:\\Sync\\Cypher ist gerade nicht erreichbar");
    await expect(page.getByTestId("projects-error").getByRole("button", { name: "Erneut versuchen" })).toBeVisible();
    await expect(
      page.getByTestId("projects-error").getByRole("button", { name: "Anderen Ordner wählen" }),
    ).toBeVisible();
  });
});
