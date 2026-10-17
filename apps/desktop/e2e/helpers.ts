import { expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export interface OpenOptions {
  scenario?: string;
  theme?: "light" | "dark";
  /** Geschwindigkeit der Mock-Aufträge (1 = echt, 40 = schnell) */
  speed?: number;
  /** Beispieldatei, die der Dateidialog liefert */
  pick?: string;
  reducedMotion?: boolean;
  /** Künstliche Antwortzeit je Command in ms (für die Laden-Zustände) */
  latency?: number;
}

/** Öffnet die App im Mock-Modus bei einer Adresse (Hash-Router). */
export async function openApp(page: Page, hash: string, opts: OpenOptions = {}): Promise<void> {
  const { scenario = "default", theme = "light", speed = 40, pick, reducedMotion = true, latency = 0 } = opts;
  await page.emulateMedia({ colorScheme: theme, reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  await page.addInitScript(
    ([sc, sp, pk, lat]) => {
      window.__CYPHER_SCENARIO__ = sc;
      window.__CYPHER_MOCK_SPEED__ = Number(sp);
      if (pk) window.__CYPHER_PICK__ = pk;
      if (Number(lat) > 0) window.__CYPHER_MOCK_LATENCY__ = Number(lat);
      try {
        localStorage.clear();
      } catch {
        /* ignorieren */
      }
    },
    [scenario, String(speed), pick ?? "", String(latency)] as const,
  );
  await page.goto(`/#/${hash.replace(/^\//, "")}`);
  await page.waitForSelector('[data-testid^="screen-"], [data-testid="kennung"]', { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
}

export async function settle(page: Page, ms = 250): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

export function mockCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window.__CYPHER_MOCK__?.calls() ?? []).map((c) => c.cmd));
}

/** Axe (WCAG 2.2 AA): keine schweren Verstöße (serious, critical). */
export async function expectNoSevereViolations(page: Page, context = ""): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const severe = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const text = severe
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(" "))
          .join(" | ")}`,
    )
    .join("\n");
  expect(severe, `axe ${context}:\n${text}`).toEqual([]);
}

export async function expectNoModerateViolations(page: Page, context = ""): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const text = results.violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(" "))
          .join(" | ")}`,
    )
    .join("\n");
  expect(results.violations, `axe ${context}:\n${text}`).toEqual([]);
}

export function focusedTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
}

export async function pressUntilFocus(page: Page, locator: Locator, key = "Tab", max = 60): Promise<number> {
  for (let i = 0; i < max; i++) {
    if (await locator.evaluate((el) => el === document.activeElement)) return i;
    await page.keyboard.press(key);
  }
  throw new Error("Fokus erreicht das Element nicht");
}
