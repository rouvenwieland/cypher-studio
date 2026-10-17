import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expandHome, expectClean, goto, shotBothThemes, skipOnboarding, useApp } from "../support/helpers";
import { FIXTURE_VERSION, REPO, startFixtures, type Fixtures } from "../support/fixtures";

interface PlanView {
  planId: string;
  components: {
    id: string;
    optional: boolean;
    status: string;
    operations: { kind: string; target: string; sourceId: string; bytes: number }[];
  }[];
  conflicts: unknown[];
}

/**
 * Einrichtung gegen einen Test-Profilordner: Krita wird aus der Fixture installiert (lokaler Test-Server), die Vorschau der
 * Einrichtung nennt Ziele, die alle im Wegwerf-Ordner liegen, und das Anwenden und Zurücknehmen schreibt nur dort. Die Schriften
 * werden in dieser getrennten Umgebung nicht beim Betriebssystem angemeldet.
 */
test.describe.serial("Einrichtung (Vorschau, Anwenden und Zurücknehmen im Testprofil)", () => {
  let fx: Fixtures;
  test.beforeAll(async () => {
    fx = await startFixtures();
  });
  test.afterAll(async () => {
    await fx.close();
  });
  const app = useApp(() => ({ fixtures: fx }));

  const invoke = async <T>(cmd: string, args?: unknown): Promise<T> => {
    const result = await app().page.evaluate(
      ([c, a]) =>
        (
          window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } }
        ).__TAURI_INTERNALS__.invoke(c, a),
      [cmd, args] as const,
    );
    return result as T;
  };

  test("Krita aus der Fixture installieren, ohne gleich einzurichten", async () => {
    const { page } = app();
    await skipOnboarding(page);
    await goto(page, "programme");
    await page.getByTestId("row-action-krita").click();
    const dialog = page.getByTestId("install-dialog");
    const setupBox = dialog.getByRole("checkbox").first();
    if (await setupBox.isChecked()) await setupBox.uncheck();
    await page.getByTestId("install-confirm").click();
    await expect(dialog.getByTestId("install-done")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("install-close").click();
    await expect(page.getByTestId("program-krita")).toContainText(FIXTURE_VERSION.krita);
  });

  test("Einrichtung öffnen: Bausteine zeigen ihren Zustand, noch nichts ist eingerichtet", async () => {
    const { page } = app();
    await goto(page, "programme/krita?tab=einrichtung");
    await expect(page.getByTestId("setup-tab")).toBeVisible();
    await expect(page.getByTestId("setup-row-palette")).toHaveAttribute("data-status", "new");
    await expect(page.getByTestId("setup-row-templates")).toHaveAttribute("data-status", "new");
    await expect(page.getByTestId("setup-output")).toHaveAttribute("data-state", "ready");
    await shotBothThemes(page, "einrichtung");
  });

  const kritaPlan = async (): Promise<PlanView> => {
    const view = await invoke<{ programs: { id: string; setup: { scopes: { scopeId: string }[] } | null }[] }>(
      "programs_list",
    );
    const scope = view.programs.find((p) => p.id === "krita")?.setup?.scopes[0];
    expect(scope, "Krita hat einen Einrichtungsbereich").toBeTruthy();
    return invoke<PlanView>("setup_preview", { req: { packId: "krita", scopeId: scope?.scopeId } });
  };
  const targetsOf = (plan: PlanView, status?: string) =>
    plan.components
      .filter((c) => (status ? c.status === status : true))
      .flatMap((c) => c.operations.map((o) => expandHome(o.target)));

  test("Vorschau: jedes Ziel liegt im Testprofil, nichts außerhalb, nichts wird geschrieben", async () => {
    const { root } = app();
    const plan = await kritaPlan();
    const targets = targetsOf(plan);
    expect(targets.length).toBeGreaterThan(10);
    const profile = join(root, "home").toLowerCase();
    for (const target of targets) {
      expect(target.toLowerCase().startsWith(profile), `Ziel ${target} liegt im Testprofil`).toBe(true);
      expect(existsSync(target), `Ziel ${target} vor dem Anwenden`).toBe(false);
    }
    expect(plan.components.find((c) => c.id === "templates")?.operations.some((o) => /\.kra$/.test(o.target))).toBe(
      true,
    );
  });

  test("Anwenden schreibt die Dateien ins Testprofil; sie stimmen mit dem Paket überein; Rückgängig räumt auf", async () => {
    const { page } = app();
    const out = page.getByTestId("setup-output");
    await page.getByTestId("output-action").click();
    await expect(out).toHaveAttribute("data-state", "done", { timeout: 90_000 });
    await expect(out).toContainText(/Einrichtung angewendet: \d+ Bausteine/);
    // nach dem Anwenden sind alle Pflichtbausteine aktuell (die Ausweichwege „lose Dateien“ bleiben wahlfrei)
    const plan = await kritaPlan();
    expect(plan.components.filter((c) => !c.optional && c.status !== "current").map((c) => c.id)).toEqual([]);
    const written = targetsOf({ ...plan, components: plan.components.filter((c) => !c.optional) });
    expect(written.length).toBeGreaterThan(10);
    for (const file of written) expect(existsSync(file), file).toBe(true);
    // eine Vorlage im Testprofil ist byte-gleich mit der Projektvorlage im Paket (das Paket enthält sie nur einmal)
    const packKra = readFileSync(join(REPO, "packs", "projects", "shirt-front-krita", "files", "shirt-front.kra"));
    const hashes = new Set(
      written.filter((f) => f.endsWith(".kra")).map((f) => createHash("sha256").update(readFileSync(f)).digest("hex")),
    );
    expect(hashes.has(createHash("sha256").update(packKra).digest("hex"))).toBe(true);
    await shotBothThemes(page, "einrichtung-angewendet");
    await page.getByTestId("setup-undo").click();
    await expect(page.getByTestId("setup-row-palette")).toHaveAttribute("data-status", "new", { timeout: 30_000 });
    for (const file of written) expect(existsSync(file), `${file} nach Rückgängig`).toBe(false);
  });

  test("keine Konsolenfehler, keine CSP-Verstöße, keine abgelehnten IPC-Aufrufe", async () => {
    await expectClean(app());
  });
});
