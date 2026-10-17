import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { launchApp, type LaunchOptions, type RunningApp } from "./launch";
import { makePng } from "./png";

/** Gemeinsamer Zustand einer Datei: eine App für alle Tests der Datei (`describe.serial`). */
export function useApp(options: LaunchOptions | (() => LaunchOptions | Promise<LaunchOptions>) = {}): () => RunningApp {
  let app: RunningApp | null = null;
  test.beforeAll(async () => {
    app = await launchApp(typeof options === "function" ? await options() : options);
  });
  test.afterAll(async () => {
    await app?.stop();
    app = null;
  });
  return () => {
    if (!app) throw new Error("App läuft nicht");
    return app;
  };
}

/**
 * Befehle, die zurzeit scheitern dürfen, weil studio.cypherxcypher.de noch nicht veröffentlicht ist: Die Prüfung auf eine neue
 * App-Version geht dorthin (`app_update_check` → `updateFailed`), die Oberfläche behandelt das still. Entfällt mit der Veröffentlichung.
 */
const KNOWN_UNPUBLISHED = ["app_update_check"];

export interface CleanOptions {
  /** Befehle, deren Ablehnung in diesem Lauf gewollt war (z. B. `install_start` bei falscher Prüfsumme) */
  ipc?: string[];
  /** Muster für erwartete Konsolenmeldungen */
  console?: RegExp[];
}

/**
 * Tauri meldet nach einem Neuladen Antworten an Rückrufe der alten Seite. Die Suite lädt JEDE App direkt nach dem Start
 * neu (launch.ts: Prüfhaken vom ersten Augenblick an), und Start-Abfragen mit Netz (Katalog, Update-Prüfung) antworten
 * manchmal erst danach. Das ist eine Folge des Neuladens im Test, kein Fehler der App (dort gibt es kein Neuladen), und ist
 * die einzige tolerierte Meldung; alle anderen Warnungen und Fehler bleiben verboten.
 */
const RELOAD_ARTIFACT = /^\[TAURI\] Couldn't find callback id \d+\. This might happen when the app is reloaded/;

/**
 * Letzter Test jeder Datei: keine Konsolenfehler, keine Seitenfehler, keine CSP-Verstöße, keine fehlgeschlagenen
 * Anfragen und keine abgelehnten IPC-Aufrufe außer den ausdrücklich erwarteten.
 */
export async function expectClean(app: RunningApp, allow: CleanOptions = {}): Promise<void> {
  await app.takeIpcErrors();
  const csp = await app.page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  const d = app.diagnostics;
  const allowConsole = [...(allow.console ?? []), RELOAD_ARTIFACT];
  const consoleHits = d.console.filter((m) => !allowConsole.some((re) => re.test(m.text)));
  const ipc = d.ipcErrors.filter((e) => ![...KNOWN_UNPUBLISHED, ...(allow.ipc ?? [])].includes(e.cmd));
  expect(consoleHits, "Konsolenfehler und -warnungen").toEqual([]);
  expect(d.pageErrors, "Seitenfehler").toEqual([]);
  expect([...csp, ...d.csp], "CSP-Verstöße").toEqual([]);
  expect(d.failedRequests, "fehlgeschlagene Anfragen").toEqual([]);
  expect(
    ipc.map((e) => `${e.cmd}: ${JSON.stringify(e.error)}`),
    "abgelehnte IPC-Aufrufe",
  ).toEqual([]);
}

/** Ordner für Fotos der echten App; nur gesetzt, wenn die Suite Fotos machen soll (`CYPHER_E2E_SHOTS=<ordner>`). */
export function shotsDir(): string | null {
  const dir = process.env["CYPHER_E2E_SHOTS"];
  if (!dir) return null;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Foto in beiden Themen (Papier und Tinte), danach wieder im Ausgangsthema. */
export async function shotBothThemes(page: Page, name: string): Promise<void> {
  const dir = shotsDir();
  if (!dir) return;
  await page.evaluate(() => document.fonts.ready);
  // saubere Fotos: Zeiger weg (keine Kurzinfo), Meldungen abgewartet
  await page.mouse.move(2, 2);
  for (let i = 0; i < 40 && (await page.locator(".toast").count()) > 0; i++) await page.waitForTimeout(250);
  for (const [attr, label] of [
    ["light", "papier"],
    ["dark", "tinte"],
  ] as const) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), attr);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(dir, `${name}_${label}.png`) });
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
}

export async function goto(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = `#/${h.replace(/^\//, "")}`;
  }, hash);
}

/** Erststart überspringen: Kennung → erster Schritt → „Später weitermachen“ (der Stand „begonnen“ ist dann gespeichert). */
export async function skipOnboarding(page: Page): Promise<void> {
  if (await page.getByTestId("kennung").count()) {
    await page.getByTestId("kennung-start").click();
    await page.getByTestId("ob-later").click();
    await expect(page.getByTestId("screen-start")).toBeVisible();
  }
}

/** Ordner mit ein paar kleinen Testdateien (Bilder, Vektor, Text) für die Bibliothek und die Module. */
export function makeTestFolder(root: string): { folder: string; files: string[] } {
  const folder = join(root, "Cypher-Testordner");
  const write = (rel: string, data: Buffer | string) => {
    const path = join(folder, ...rel.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    return rel;
  };
  const stripes = (r: number, g: number, b: number) =>
    makePng(96, 96, (x, y) => ((x + y) % 24 < 12 ? [r, g, b, 255] : [255, 255, 255, 0]));
  const files = [
    write("Motive/rauschen_v1.png", stripes(228, 245, 49)),
    write("Motive/signal_v2.png", stripes(31, 43, 208)),
    write("Drops/herbst/welle.png", stripes(0, 160, 200)),
    write(
      "Vektor/logo.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#1f2bd0"/></svg>',
    ),
  ];
  write("Notizen.txt", "Das ist keine Bilddatei.");
  return { folder, files };
}

/** Bibliotheksordner über die Oberfläche wählen (der native Dialog wird beantwortet, nicht gezeigt). */
export async function chooseLibrary(app: RunningApp, folder: string): Promise<void> {
  const { page } = app;
  await goto(page, "bibliothek");
  app.answerDialog([folder]);
  await page.getByTestId("choose-folder").click();
  await page.getByTestId("choose-root-use").click();
  await expect(page.getByTestId("library-count")).toBeVisible({ timeout: 30_000 });
}

/** Die App zeigt den Heimatordner des Benutzers als „~“; für Dateiprüfungen wieder ausschreiben. */
export function expandHome(displayPath: string): string {
  return displayPath.startsWith("~") ? join(homedir(), displayPath.slice(1)) : displayPath;
}

/** Neues Projekt über die Oberfläche anlegen (Start → „Neues Projekt“); danach steht die Bibliothek mit dem Projekt offen. */
export async function createProject(page: Page, name: string): Promise<void> {
  await goto(page, "start?neu=1");
  await expect(page.getByTestId("new-project-dialog")).toBeVisible();
  await page.getByTestId("new-project-name").fill(name);
  await page.getByTestId("new-project-create").click();
  await expect(page.getByTestId("screen-library")).toBeVisible({ timeout: 30_000 });
}

/**
 * Seite neu laden (wie F5). Das Neuladen bricht laufende IPC-Anfragen ab („IPC custom protocol failed“, „Couldn't find callback
 * id“); diese Meldungen sind kein Fehler der App und zählen nicht.
 */
export async function reloadApp(app: RunningApp): Promise<void> {
  const { page, diagnostics } = app;
  // Laufende Aufträge (Scan, Export, Download) senden über ihren Fortschrittskanal weiter; nach einem Neuladen gehören diese
  // Kanäle zur alten Seite und Tauri warnt bei jeder Nachricht. In der App gibt es kein Neuladen; der Test wartet deshalb,
  // bis kein Auftrag mehr läuft (höchstens 30 s), statt die Warnungen pauschal zu erlauben.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const active = await page.evaluate(async () => {
      const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke(cmd: string): Promise<unknown[]> } })
        .__TAURI_INTERNALS__;
      return (await internals.invoke("jobs_active")).length;
    });
    if (active === 0) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('[data-testid^="screen-"], [data-testid="kennung"]');
  await page.waitForTimeout(800);
  diagnostics.console.length = 0;
  diagnostics.pageErrors.length = 0;
  diagnostics.failedRequests.length = 0;
}
