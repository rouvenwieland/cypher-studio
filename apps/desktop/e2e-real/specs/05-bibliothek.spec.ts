import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectClean, goto, makeTestFolder, shotBothThemes, skipOnboarding, useApp } from "../support/helpers";
import { makePng } from "../support/png";

/**
 * Bibliothek mit einem Testordner: Ordnerwahl über den beantworteten Dialog, Einlesen, Vorschaubilder über `cythumb`,
 * Suche, Filter, Tags (Begleitdateien im Ordner), Überwachung (neue und gelöschte Dateien erscheinen und verschwinden).
 */
test.describe.serial("Bibliothek (Testordner)", () => {
  const app = useApp();
  let folder = "";
  let files: string[] = [];
  /** vier Bilddateien und die Textdatei: die Bibliothek führt jede Datei (die Textdatei als „Sonstiges“) */
  const total = () => files.length + 1;

  test("Ordner wählen: Zusammenfassung nennt die Dateien, danach zeigt die Bibliothek genau sie", async () => {
    const { page, root } = app();
    ({ folder, files } = makeTestFolder(root));
    await skipOnboarding(page);
    await goto(page, "bibliothek");
    await expect(page.getByTestId("library-empty")).toContainText("Noch kein gemeinsamer Ordner");
    app().answerDialog([folder]);
    await page.getByTestId("choose-folder").click();
    const dialog = page.getByTestId("choose-root-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Dateien|Datei/);
    await shotBothThemes(page, "bibliothek-ordner-waehlen");
    await page.getByTestId("choose-root-use").click();
    await expect(page.getByTestId("library-count")).toContainText(`${total()} von ${total()}`, {
      timeout: 30_000,
    });
    expect(existsSync(join(folder, ".cypher")), "Begleitordner im Bibliotheksordner").toBe(true);
  });

  test("Vorschaubilder kommen über cythumb: jede Zelle trägt ein geladenes Bild", async () => {
    const { page } = app();
    await expect
      .poll(
        async () =>
          page
            .locator('[data-testid^="cell-"] img')
            .evaluateAll((imgs) => (imgs as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth > 0).length),
        { timeout: 30_000 },
      )
      .toBe(files.length);
    const sources = await page
      .locator('[data-testid^="cell-"] img')
      .evaluateAll((imgs) => (imgs as HTMLImageElement[]).map((i) => i.currentSrc));
    for (const src of sources) expect(src).toMatch(/^https?:\/\/cythumb\.localhost\/|^cythumb:/);
    await shotBothThemes(page, "bibliothek");
  });

  test("Suche und Filter: ein Treffer für „rauschen“, Filter lösen bringt alle zurück", async () => {
    const { page } = app();
    await page.getByTestId("library-search").fill("rauschen");
    await expect(page.getByTestId("library-count")).toContainText(`1 von ${total()}`);
    await page.getByTestId("library-search").fill("gibt-es-nicht-xyz");
    await expect(page.getByTestId("library-nomatch")).toBeVisible();
    await page.getByRole("button", { name: "Filter lösen" }).click();
    await expect(page.getByTestId("library-count")).toContainText(`${total()} von ${total()}`);
    await page
      .getByTestId("library-filters")
      .getByLabel(/Vektor/)
      .check();
    await expect(page.getByTestId("library-count")).toContainText(`1 von ${total()}`);
    await page.getByTestId("filters-clear").click();
  });

  test("Tag setzen: erscheint im Inspektor und steht danach in der Begleitdatei im Ordner", async () => {
    const { page } = app();
    await page.getByTestId("library-search").fill("signal");
    // erst klicken, wenn die Suche (mit Verzögerung) die Liste ersetzt hat; sonst setzt der Wechsel die Auswahl zurück
    await expect(page.getByTestId("library-count")).toContainText(`1 von ${total()}`);
    await page.getByTestId("cell-0").click();
    await expect(page.getByTestId("entry-inspector")).toBeVisible();
    await page.getByTestId("tag-input").fill("e2e-getaggt");
    await page.getByTestId("tag-add").click();
    await expect(page.getByTestId("entry-inspector")).toContainText("e2e-getaggt");
    await expect(page.getByTestId("entry-inspector").getByText("Gespeichert")).toBeVisible();
    const sidecar = join(folder, ".cypher", "meta", "Motive", "signal_v2.png.json");
    await expect.poll(() => existsSync(sidecar), { timeout: 10_000 }).toBe(true);
    expect(readFileSync(sidecar, "utf8")).toContain("e2e-getaggt");
    await page.getByTestId("library-search").fill("");
  });

  test("Überwachung: eine neue Datei erscheint von selbst, eine gelöschte verschwindet", async () => {
    const { page } = app();
    const added = join(folder, "Motive", "neu_dazu.png");
    writeFileSync(
      added,
      makePng(64, 64, () => [200, 20, 20, 255]),
    );
    await expect(page.getByTestId("library-count")).toContainText(`${total() + 1} von ${total() + 1}`, {
      timeout: 30_000,
    });
    rmSync(added);
    await expect(page.getByTestId("library-count")).toContainText(`${total()} von ${total()}`, {
      timeout: 30_000,
    });
  });

  test("keine Konsolenfehler, keine CSP-Verstöße, keine abgelehnten IPC-Aufrufe", async () => {
    await expectClean(app());
  });
});
