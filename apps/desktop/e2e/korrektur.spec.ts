import { expect, test } from "@playwright/test";
import { openApp, settle } from "./helpers";

/**
 * Korrekturrunde 1 nach dem Finish-Gate-Review (docs/reports/review-ui.md): Jeder behobene Befund bekommt eine Prüfung,
 * damit er nicht wiederkommt. Die Größen sind das Mindestfenster und Windows mit 125 % auf 1366 × 768.
 */
test.describe("Prüfsumme und Installation bei 1024 × 680", () => {
  test.use({ viewport: { width: 1024, height: 680 } });

  test("Zustimmung und „Danach“ stehen im festen Fuß und sind ohne Scrollen sichtbar", async ({ page }) => {
    await openApp(page, "programme");
    await page.getByTestId("row-action-blender").click();
    await page.getByTestId("install-confirm").waitFor();
    const m = await page.evaluate(() => {
      const box = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
      const consent = box("install-consent");
      const confirm = box("install-confirm");
      return {
        vh: window.innerHeight,
        consentBottom: consent?.bottom ?? 9999,
        consentTop: consent?.top ?? -1,
        confirmBottom: confirm?.bottom ?? 9999,
      };
    });
    expect(m.consentTop).toBeGreaterThan(0);
    expect(m.consentBottom).toBeLessThanOrEqual(m.vh);
    expect(m.confirmBottom).toBeLessThanOrEqual(m.vh);
    await expect(page.getByTestId("install-dialog").getByText("Zustimmung", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Mit Cypher-Paletten/ })).toBeVisible();
  });

  test("Prüfsumme falsch: Überschrift nennt die Prüfsumme, Blöcke mit Abstand, ehrlicher Knopf mit Fokus", async ({
    page,
  }) => {
    await openApp(page, "programme", { scenario: "installChecksumFail" });
    await page.getByTestId("row-action-blender").click();
    await page.getByTestId("install-confirm").click();
    const err = page.getByTestId("checksum-error");
    await expect(err).toBeVisible({ timeout: 30_000 });
    await expect(err.getByText(/^Prüfsumme stimmt nicht/)).toBeVisible();
    await expect(err.getByText("Dein Rechner ist nicht betroffen")).toBeVisible();
    await expect(err.getByText(/Erwartet \(aus dem Manifest\)/i)).toBeVisible();
    await expect(err.getByText(/Berechnet \(aus deiner Datei\)/i)).toBeVisible();
    await expect(err.getByTestId("checksum-diff")).toContainText(/von 16 Blöcken weich/);
    const gap = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll(".compare__block")].map((b) => b.getBoundingClientRect());
      return (blocks[1]?.top ?? 0) - (blocks[0]?.bottom ?? 0);
    });
    expect(gap).toBeGreaterThanOrEqual(12);
    const dialog = page.getByTestId("install-dialog");
    await expect(dialog).not.toContainText("Spiegel");
    const retry = dialog.getByTestId("install-retry");
    await expect(retry).toHaveText("Erneut laden und prüfen");
    await expect(retry).toBeFocused();
    // nichts am Dialog ist Cyan außer dem Bestätigen: der Wiederholen-Knopf trägt Tinte
    await expect(retry).toHaveClass(/btn--primary/);
  });
});

test.describe("Texte im Druckbericht und Cyan nur für die Ausgabe", () => {
  test("Messwert und Grenze widersprechen sich nicht: „0,4 % (erlaubt ≤ 0,1 %)“, „0,6 mm (nötig ≥ 0,8 mm)“", async ({
    page,
  }) => {
    await openApp(page, "druck", { pick: "signal_v3.png" });
    await page.getByTestId("print-pick").click();
    await expect(page.getByTestId("verdict")).toContainText("Druckbar mit Hinweisen");
    await expect(page.getByTestId("check-semi")).toContainText(/0,4 %\s*\(erlaubt ≤ 0,1 %\)/);
    await expect(page.getByTestId("check-strokes")).toContainText(/0,6 mm\s*\(nötig ≥ 0,8 mm\)/);
    // Bericht steht direkt unter dem Urteil, vor den Eingaben
    const order = await page.evaluate(() => {
      const y = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().top ?? 0;
      return {
        verdict: y('[data-testid="verdict"]'),
        report: y('[data-testid="check-semi"]'),
        garment: y(".swatches"),
      };
    });
    expect(order.report).toBeGreaterThan(order.verdict);
    expect(order.report).toBeLessThan(order.garment);
  });

  test("Leerer Zustand: kein doppelter Satz, Aufnahme-Knopf in Tinte, nur der gesperrte Ausgang trägt Cyan", async ({
    page,
  }) => {
    await openApp(page, "druck");
    await expect(page.getByTestId("print-empty")).toContainText(/oder\s+aus der Bibliothek wählen/);
    await expect(page.getByTestId("print-empty")).not.toContainText("Aus der Bibliothek wählen");
    await expect(page.getByTestId("print-pick")).toHaveClass(/btn--primary/);
    for (const hash of ["druck", "mockups", "freistellen"]) {
      await openApp(page, hash);
      const cyan = await page.evaluate(
        () => [...document.querySelectorAll(".btn--action")].filter((b) => !b.closest('[data-region="output"]')).length,
      );
      expect(cyan, `Cyan-Knöpfe außerhalb der Ausgangsleiste auf ${hash}`).toBe(0);
    }
  });

  test("Mockups: kein Entwicklertext, Farbname deutsch mit klar beschrifteter Herstellerbezeichnung", async ({
    page,
  }) => {
    await openApp(page, "mockups", { pick: "signal_v3.png" });
    await page.getByTestId("mockup-pick").click();
    const body = page.locator("body");
    await expect(body).not.toContainText("Alt-Text");
    await expect(body).not.toContainText("Vorschlag für den");
    await expect(page.getByTestId("mockup-color-name")).toHaveText("Schwarz · Shirtigo: Black");
  });
});

test.describe("Ausrichtung auf Start, Segmente, Freistellen, Erststart", () => {
  test("Start: Spaltenköpfe fluchten, Projektspalten stehen fest, Programmrolle bricht nicht um", async ({ page }) => {
    for (const size of [
      { width: 1280, height: 800 },
      { width: 1024, height: 680 },
    ]) {
      await page.setViewportSize(size);
      await openApp(page, "start");
      await settle(page, 300);
      const m = await page.evaluate(() => {
        const heads = [...document.querySelectorAll(".panel__head")]
          .slice(0, 2)
          .map((h) => Math.round(h.getBoundingClientRect().bottom));
        const times = [...document.querySelectorAll(".prow__time")].map((e) =>
          Math.round(e.getBoundingClientRect().left),
        );
        const colls = [...document.querySelectorAll(".prow .coll, .prow > [role=gridcell]:nth-child(2) > span")].map(
          (e) => Math.round(e.getBoundingClientRect().left),
        );
        const roles = [...document.querySelectorAll(".pl__name .t-label")].map((e) =>
          Math.round(e.getBoundingClientRect().height),
        );
        return { heads, times, colls, roles };
      });
      expect(Math.abs((m.heads[0] ?? 0) - (m.heads[1] ?? 99))).toBeLessThanOrEqual(1);
      expect(new Set(m.times).size, `Datumsspalte bei ${size.width}`).toBe(1);
      expect(new Set(m.colls).size, `Kollektionsspalte bei ${size.width}`).toBe(1);
      expect(Math.max(...m.roles)).toBeLessThanOrEqual(20);
    }
  });

  test("Start: ohne Ordner steht nur ein „Ordner wählen“ da, in Tinte statt Cyan", async ({ page }) => {
    await openApp(page, "start", { scenario: "libraryEmpty" });
    await expect(page.getByRole("button", { name: "Ordner wählen" })).toHaveCount(1);
    await expect(page.getByTestId("choose-folder")).toHaveClass(/btn--primary/);
    expect(await page.evaluate(() => document.querySelectorAll("main .btn--action").length)).toBe(0);
  });

  test("Start: bei verlorenem Ordner sagt auch die Seitenspalte „nicht erreichbar“", async ({ page }) => {
    await openApp(page, "start", { scenario: "folderLost" });
    await expect(page.getByTestId("projects-error")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("3.104 Dateien");
    await expect(page.locator(".start__side")).toContainText("nicht erreichbar");
  });

  test("Segmentschalter haben keinen leeren Schwanz", async ({ page }) => {
    await openApp(page, "einstellungen/darstellung");
    const m = await page.evaluate(() =>
      [...document.querySelectorAll(".seg")].map((s) => {
        const r = s.getBoundingClientRect();
        const last = s.lastElementChild?.getBoundingClientRect();
        return Math.round(r.right - (last?.right ?? r.right));
      }),
    );
    expect(m.length).toBeGreaterThanOrEqual(3);
    for (const tail of m) expect(tail).toBeLessThanOrEqual(2);
  });

  test("Freistellen: das Bild bleibt in der Bühne (kein Überlauf nach unten)", async ({ page }) => {
    await openApp(page, "freistellen", { pick: "signal_v3.png" });
    await page.getByTestId("cutout-pick").click();
    await page.getByTestId("cutout-run").click();
    await expect(page.getByTestId("compare-handle")).toBeVisible();
    await settle(page, 300);
    const m = await page.evaluate(() => {
      const stage = document.querySelector(".cmp")?.getBoundingClientRect();
      const imgs = [...document.querySelectorAll(".cmp__layer img")].map((i) => i.getBoundingClientRect());
      return {
        stageBottom: stage?.bottom ?? 0,
        stageRight: stage?.right ?? 0,
        imgBottoms: imgs.map((i) => i.bottom),
        imgRights: imgs.map((i) => i.right),
      };
    });
    for (const b of m.imgBottoms) expect(b).toBeLessThanOrEqual(m.stageBottom + 1);
    for (const r of m.imgRights) expect(r).toBeLessThanOrEqual(m.stageRight + 1);
  });

  test("Erststart: Schritte mit Namen und Einheit an der Zeitleiste, der Satz zur Zeit steht nur einmal", async ({
    page,
  }) => {
    await openApp(page, "erststart", { scenario: "fresh" });
    await page.getByTestId("kennung-start").click();
    await expect(page.getByTestId("ob-next")).toBeVisible();
    const schedule = page.getByTestId("schedule");
    for (const name of ["Auswahl", "Ordner", "Prüfen", "Programme laden", "Einrichten", "Probelauf"]) {
      await expect(schedule).toContainText(name);
    }
    await expect(schedule).toContainText("30 Min.");
    const count = await page.evaluate(() => (document.body.innerText.match(/Die Zeit schätzen wir/g) ?? []).length);
    expect(count).toBe(1);
  });

  test("Kennung: das Wort füllt das Fenster, ohne über den Rand zu wachsen (auch bei 1093 und 1100 px)", async ({
    page,
  }) => {
    for (const width of [1024, 1093, 1100, 1280, 1920]) {
      await page.setViewportSize({ width, height: width < 1200 ? 680 : 800 });
      await openApp(page, "erststart", { scenario: "fresh" });
      await expect(page.getByTestId("kennung-start")).toBeVisible();
      await settle(page, 400);
      const m = await page.evaluate(() => {
        const fits = [...document.querySelectorAll(".kennung__title .fit")].map((f) => f.getBoundingClientRect());
        return {
          vw: window.innerWidth,
          rights: fits.map((r) => Math.round(r.right)),
          widths: fits.map((r) => Math.round(r.width)),
        };
      });
      for (const r of m.rights) expect(r, `rechter Rand bei ${width}`).toBeLessThanOrEqual(m.vw);
      for (const w of m.widths) expect(w, `Breite bei ${width}`).toBeGreaterThan(m.vw * 0.8);
      await page.reload();
    }
  });
});
