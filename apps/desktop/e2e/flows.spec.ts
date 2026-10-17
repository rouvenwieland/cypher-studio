import { expect, test } from "@playwright/test";
import { mockCalls, openApp } from "./helpers";

test.describe("Start (CONCEPT.md 6.1)", () => {
  test("Projekte, Programme, Vorlagen in echten Seitenverhältnissen", async ({ page }) => {
    await openApp(page, "start");
    await expect(page.getByTestId("project-proj-herbst-drop-26")).toContainText("Herbst-Drop 26");
    await expect(page.getByTestId("project-proj-herbst-drop-26")).toContainText("Rauschen");
    await expect(page.getByTestId("project-proj-herbst-drop-26")).toContainText("heute 14:32");
    await expect(page.getByTestId("start-programs")).toContainText("5.3.3 → 5.3.4.1");
    const boxes = await page.locator('button[data-testid^="template-"] .tile__img').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return [Math.round(r.width), Math.round(r.height)];
      }),
    );
    expect(boxes.length).toBe(7);
    for (const [, h] of boxes) expect(h).toBe(112);
    const shirt = boxes[0];
    const story = boxes[3];
    expect(shirt && Math.abs((shirt[0] ?? 0) / (shirt[1] ?? 1) - 330 / 450) < 0.02).toBe(true);
    expect(story && Math.abs((story[0] ?? 0) / (story[1] ?? 1) - 1080 / 1920) < 0.02).toBe(true);
  });

  test("Kein Ordner: Leerzustand nennt den nächsten Schritt, Vorlagen bleiben voll", async ({ page }) => {
    await openApp(page, "start", { scenario: "libraryEmpty" });
    await expect(page.getByTestId("projects-empty-nofolder")).toContainText(
      "Wähle den Ordner, den ihr teilt, dann erscheinen hier eure Projekte.",
    );
    await expect(page.locator('button[data-testid^="template-"]')).toHaveCount(7);
  });

  test("Projektliste per Tastatur: Pfeile wählen, Enter öffnet die Bibliothek", async ({ page }) => {
    await openApp(page, "start");
    await page.getByTestId("project-proj-herbst-drop-26").focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("project-proj-mittelwelle-poster")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("screen-library")).toBeVisible();
    await expect(page.getByTestId("filter-chips")).toContainText("Mittelwelle-Poster");
  });

  test("Strg+Enter auf einem Projekt startet die letzte Datei im Programm", async ({ page }) => {
    await openApp(page, "start");
    await page.getByTestId("project-proj-herbst-drop-26").focus();
    await page.keyboard.press("Control+Enter");
    await expect.poll(async () => (await mockCalls(page)).includes("project_open_last")).toBe(true);
  });

  test("Vorlage: Popover legt die Datei im Projekt an und öffnet das Programm", async ({ page }) => {
    await openApp(page, "start");
    await page.getByTestId("template-shirt-krita").click();
    const pop = page.getByTestId("template-popover");
    await expect(pop).toBeVisible();
    await expect(pop.getByRole("textbox", { name: "Dateiname" })).toHaveValue("herbst-drop-26_shirt-vorne");
    await page.getByTestId("template-create").click();
    await expect
      .poll(
        async () => (await mockCalls(page)).filter((c) => c === "project_new_file" || c === "project_open_file").length,
      )
      .toBe(2);
  });

  test("Neues Projekt: Strg+N, Name Pflicht, Anlegen führt in die Bibliothek", async ({ page }) => {
    await openApp(page, "start");
    await page.keyboard.press("Control+n");
    const dialog = page.getByTestId("new-project-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("new-project-create").click();
    await expect(dialog.getByText("Gib dem Projekt einen Namen")).toBeVisible();
    await page.getByTestId("new-project-name").fill("Winter-Drop 26");
    await page.getByTestId("new-project-create").click();
    await expect(page.getByTestId("screen-library")).toBeVisible();
    await expect(page.getByTestId("filter-chips")).toContainText("Winter-Drop 26");
  });

  test("Erststart nicht beendet: Zeile „Einrichtung zu 60 %“ mit Weitermachen", async ({ page }) => {
    await openApp(page, "start", { scenario: "onboardingPartial" });
    await expect(page.getByTestId("resume-banner")).toContainText("Einrichtung zu 67 %");
    await page.getByTestId("resume-onboarding").click();
    await expect(page.getByTestId("screen-onboarding")).toBeVisible();
  });
});

test.describe("Programme (CONCEPT.md 6.2)", () => {
  test("Tafel: vier Zeilen, Bandbreite-Namen füllen exakt die Spalte", async ({ page }) => {
    await openApp(page, "programme");
    const rows = page.locator('[data-testid^="program-"][role="row"]');
    await expect(rows).toHaveCount(4);
    const widths = await page
      .locator(".trow__name .fit__text")
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    const col = await page
      .locator(".trow__name .fit")
      .first()
      .evaluate((e) => Math.round(e.getBoundingClientRect().width));
    for (const w of widths) expect(Math.abs(w - col)).toBeLessThanOrEqual(6);
    await expect(page.getByTestId("program-krita")).toContainText("Update verfügbar");
    await expect(page.getByTestId("program-inkscape")).toContainText("eingerichtet");
    await expect(page.getByTestId("program-blender")).toContainText("nicht installiert");
  });

  test("Tastatur: Pfeile wählen, Enter öffnet das Detail, Esc/Zurück kehrt zurück", async ({ page }) => {
    await openApp(page, "programme");
    await page.getByTestId("program-krita").focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("program-inkscape")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("screen-program-detail")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Programme");
    await page.getByRole("button", { name: "Zurück zu den Programmen" }).click();
    await expect(page.getByTestId("screen-programs")).toBeVisible();
  });

  test("Strg+Enter auf der Tafel führt die Zeilenaktion aus (Starten)", async ({ page }) => {
    await openApp(page, "programme");
    await page.getByTestId("program-inkscape").focus();
    await page.keyboard.press("Control+Enter");
    await expect.poll(async () => (await mockCalls(page)).includes("program_launch")).toBe(true);
  });

  test("Manifest nicht erreichbar: Hinweis, installierte Programme laufen weiter", async ({ page }) => {
    await openApp(page, "programme", { scenario: "offline" });
    await expect(page.getByTestId("manifest-error")).toContainText("Keine Verbindung zum Cypher-Manifest");
    await expect(page.getByTestId("program-inkscape")).toContainText("eingerichtet");
  });

  test("Deinstallieren nennt, was gelöscht wird und was bleibt", async ({ page }) => {
    await openApp(page, "programme/krita");
    await page.getByRole("button", { name: "Weitere Aktionen" }).click();
    await page.getByRole("menuitem", { name: /Deinstallieren/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Deine Krita-Dateien und die Einrichtung bleiben.");
    await page.getByTestId("remove-confirm").click();
    await expect.poll(async () => (await mockCalls(page)).includes("installation_remove")).toBe(true);
  });
});

test.describe("Einrichtung (CONCEPT.md 6.3)", () => {
  test("Teilweise: vier Bausteine mit Status, Konflikt braucht Wahl, Anwenden, Rückgängig", async ({ page }) => {
    await openApp(page, "programme/krita?tab=einrichtung", { scenario: "setupConflicts" });
    await expect(page.getByTestId("setup-summary")).toContainText("teilweise (1 von 3)");
    await expect(page.getByTestId("setup-row-palette")).toContainText("aktuell");
    await expect(page.getByTestId("setup-row-fonts")).toContainText("veraltet");
    await expect(page.getByTestId("setup-row-templates")).toContainText("neu");
    await expect(page.getByTestId("setup-row-workspace")).toContainText("von dir geändert");
    await page.getByTestId("setup-row-workspace").getByRole("checkbox").check();
    await expect(page.getByRole("radio", { name: /Daneben ablegen als cypher-2026-10\.kws/ })).toBeChecked();
    await expect(page.getByTestId("setup-running")).toBeVisible();
    const out = page.getByTestId("setup-output");
    await expect(out).toHaveAttribute("data-state", "ready");
    await page.getByTestId("output-action").click();
    await expect(out).toHaveAttribute("data-state", "done", { timeout: 20_000 });
    await expect(out).toContainText(/Angewendet \d\d:\d\d/);
    await expect(out).toContainText("Krita neu starten");
    await page.getByTestId("setup-undo").click();
    await expect(page.getByTestId("setup-row-fonts")).toContainText("veraltet", { timeout: 10_000 });
  });

  test("Gesperrte Datei wird je Zeile gemeldet", async ({ page }) => {
    await openApp(page, "programme/krita?tab=einrichtung", { scenario: "setupLocked" });
    await page.getByTestId("output-action").click();
    await expect(page.getByTestId("setup-failure")).toContainText(
      "ist von Krita gesperrt. Schließe Krita und wende erneut an.",
    );
  });

  test("Nicht installiert: „Erst installieren, dann einrichten.“", async ({ page }) => {
    await openApp(page, "programme/blender?tab=einrichtung");
    await expect(page.getByTestId("setup-empty")).toContainText("Erst installieren, dann einrichten.");
    await expect(page.getByRole("button", { name: "Blender installieren" })).toBeVisible();
  });
});
