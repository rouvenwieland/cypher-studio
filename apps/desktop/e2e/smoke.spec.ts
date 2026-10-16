import { expect, test, type Page } from "@playwright/test";
import { openApp, settle } from "./helpers";

/**
 * Rauchtest je Ansicht (Browser-QA, Phase 1): keine Konsolenfehler und -warnungen, keine fehlgeschlagenen Anfragen,
 * kein Layoutsprung (CLS < 0,1). Eigene Anfragen gehen im Mock nur an die App selbst.
 */
interface Probe {
  problems: string[];
  stop: () => Promise<number>;
}

async function probe(page: Page): Promise<Probe> {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text().slice(0, 240)}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 240)}`));
  page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()}`));
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  return { problems, stop: () => page.evaluate(() => (window as unknown as { __cls: number }).__cls) };
}

interface Screen {
  name: string;
  hash: string;
  pick?: string;
  scenario?: string;
  prep?: (page: Page) => Promise<void>;
}

const SCREENS: Screen[] = [
  { name: "start", hash: "start" },
  { name: "programme", hash: "programme" },
  { name: "programm-detail", hash: "programme/krita" },
  {
    name: "installieren",
    hash: "programme",
    prep: async (p) => {
      await p.getByTestId("row-action-blender").click();
      await p.getByTestId("install-confirm").click();
      await p.getByTestId("install-done").waitFor({ timeout: 30_000 });
    },
  },
  {
    name: "druck",
    hash: "druck",
    pick: "signal_v3.png",
    prep: async (p) => {
      await p.getByTestId("print-pick").click();
      await p.getByTestId("verdict").getByText("Druckbar mit Hinweisen").waitFor();
      await p.keyboard.press("Control+Enter");
      await expect(p.getByTestId("print-output")).toHaveAttribute("data-state", "done");
    },
  },
  { name: "bibliothek", hash: "bibliothek" },
  {
    name: "mockups",
    hash: "mockups",
    pick: "signal_v3.png",
    prep: async (p) => {
      await p.getByTestId("mockup-pick").click();
      await p.locator(`[data-testid="measure-contrast"]:not([data-state="open"])`).waitFor();
      await p.keyboard.press("Control+Enter");
      await expect(p.getByTestId("mockup-output")).toHaveAttribute("data-state", "done");
    },
  },
  {
    name: "social",
    hash: "social",
    pick: "signal_v3.png",
    prep: async (p) => {
      await p.getByTestId("tpl-drop-ankuendigung").first().click();
      await p.getByTestId("pick-bild").click();
      await p.keyboard.press("Control+Enter");
      await expect(p.getByTestId("social-output")).toHaveAttribute("data-state", "done");
    },
  },
  {
    name: "freistellen",
    hash: "freistellen",
    pick: "signal_v3.png",
    prep: async (p) => {
      await p.getByTestId("cutout-pick").click();
      await p.getByTestId("cutout-run").click();
      await p.getByTestId("compare-handle").waitFor();
    },
  },
  { name: "einstellungen", hash: "einstellungen/darstellung" },
  { name: "einstellungen-updates", hash: "einstellungen/updates", scenario: "updateAvailable" },
  { name: "einstellungen-netzwerk", hash: "einstellungen/netzwerk" },
  { name: "erststart", hash: "erststart", scenario: "fresh" },
];

test.describe("Rauchtest: Konsole, Netz, Layoutsprung", () => {
  for (const screen of SCREENS) {
    test(screen.name, async ({ page }) => {
      const pr = await probe(page);
      await openApp(page, screen.hash, {
        ...(screen.scenario ? { scenario: screen.scenario } : {}),
        ...(screen.pick ? { pick: screen.pick } : {}),
      });
      if (screen.prep) await screen.prep(page);
      await settle(page, 500);
      expect(pr.problems, `Konsole und Netz auf „${screen.name}“`).toEqual([]);
      expect(await pr.stop(), "CLS").toBeLessThan(0.1);
    });
  }
});
