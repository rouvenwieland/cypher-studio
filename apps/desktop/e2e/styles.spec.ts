import { expect, test, type Page } from "@playwright/test";
import { openApp, settle } from "./helpers";

/**
 * Stile gehören zu dem, was auf dem Bildschirm steht: Jede Klasse im DOM braucht eine Regel in den geladenen
 * Stylesheets. Fängt Stile ab, die in der CSS-Datei einer anderen Ansicht liegen und beim direkten Einstieg fehlen
 * (z. B. der Schieberegler der Einstellungen).
 */
/** Klassen, die bewusst nur als Haken oder Zustand dienen (kein eigener Stil nötig). */
const HOOKS = [
  "exp",
  "active",
  "panel",
  "ov",
  "lamp--idle",
  "tile__name",
  "soc__pane--large",
  "rrow__measured",
  "rrow__limit",
  "stable__row",
  "stable__conflict",
  "pc__chip",
  "pc__mark",
  "pc__ruler",
  "cmp__layer--before",
];

async function unstyledClasses(page: Page): Promise<string[]> {
  return page.evaluate((hookList) => {
    const defined = new Set<string>();
    const visit = (rules: CSSRuleList): void => {
      for (const rule of Array.from(rules)) {
        if ("selectorText" in rule && typeof (rule as CSSStyleRule).selectorText === "string") {
          for (const m of (rule as CSSStyleRule).selectorText.matchAll(/\.((?:\\.|[\w-])+)/g))
            defined.add((m[1] ?? "").replace(/\\(.)/g, "$1"));
        }
        if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        visit(sheet.cssRules);
      } catch {
        /* fremdes Stylesheet */
      }
    }
    const used = new Set<string>();
    for (const el of Array.from(document.querySelectorAll("[class]"))) {
      for (const c of Array.from(el.classList)) used.add(c);
    }
    // Bibliotheken setzen eigene Klassen als Haken (cmdk, Radix), die ohne Regel bleiben dürfen
    const hooks = /^(radix-|cmdk-)/;
    return [...used].filter((c) => !defined.has(c) && !hooks.test(c) && !hookList.includes(c)).sort();
  }, HOOKS);
}

interface Screen {
  name: string;
  hash: string;
  scenario?: string;
  pick?: string;
  prep?: (page: Page) => Promise<void>;
}

const SCREENS: Screen[] = [
  { name: "start", hash: "start" },
  { name: "programme", hash: "programme" },
  { name: "programm-detail", hash: "programme/krita" },
  { name: "einrichtung", hash: "programme/krita?tab=einrichtung", scenario: "setupConflicts" },
  {
    name: "installieren",
    hash: "programme",
    prep: async (p) => {
      await p.getByTestId("row-action-blender").click();
      await p.getByTestId("install-confirm").waitFor();
    },
  },
  {
    name: "druck",
    hash: "druck",
    pick: "signal_v3.png",
    prep: async (p) => {
      await p.getByTestId("print-pick").click();
      await p.getByTestId("verdict").getByText("Druckbar mit Hinweisen").waitFor();
      await p.getByTestId("show-ok").click();
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
      await p.getByTestId("mockup-stage").focus();
      await p.keyboard.press("k");
    },
  },
  {
    name: "social",
    hash: "social",
    pick: "signal_v3.png",
    prep: async (p) => {
      await p.getByTestId("tpl-drop-ankuendigung").first().click();
      await p.getByTestId("pick-bild").click();
      await p.getByTestId("focal-picker").waitFor();
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
  { name: "einstellungen-darstellung", hash: "einstellungen/darstellung" },
  { name: "einstellungen-arbeitsflaeche", hash: "einstellungen/arbeitsflaeche" },
  { name: "einstellungen-programme", hash: "einstellungen/programme" },
  { name: "einstellungen-bibliothek", hash: "einstellungen/bibliothek" },
  { name: "einstellungen-profile", hash: "einstellungen/profile" },
  { name: "einstellungen-updates", hash: "einstellungen/updates", scenario: "updateAvailable" },
  { name: "einstellungen-netzwerk", hash: "einstellungen/netzwerk" },
  { name: "einstellungen-tastenkuerzel", hash: "einstellungen/tastenkuerzel" },
  { name: "einstellungen-ueber", hash: "einstellungen/ueber" },
  { name: "erststart", hash: "erststart", scenario: "fresh" },
  {
    name: "erststart-auswahl",
    hash: "erststart",
    scenario: "fresh",
    prep: async (p) => {
      await p.getByTestId("kennung-start").click();
      await p.getByTestId("ob-next").waitFor();
    },
  },
  {
    name: "befehle",
    hash: "start",
    prep: async (p) => {
      await p.keyboard.press("Control+k");
      await p.getByTestId("palette").waitFor();
    },
  },
  {
    name: "hilfe",
    hash: "start",
    prep: async (p) => {
      await p.keyboard.press("F1");
      await p.getByTestId("help-dialog").waitFor();
    },
  },
  {
    name: "auftraege",
    hash: "start",
    scenario: "busy",
    prep: async (p) => {
      await p.keyboard.press("Control+j");
      await p.getByTestId("jobs-popover").waitFor();
    },
  },
];

test.describe("Jede Klasse im DOM hat eine Regel (kein Stil fehlt beim direkten Einstieg)", () => {
  for (const screen of SCREENS) {
    test(screen.name, async ({ page }) => {
      await openApp(page, screen.hash, {
        ...(screen.scenario ? { scenario: screen.scenario } : {}),
        ...(screen.pick ? { pick: screen.pick } : {}),
      });
      if (screen.prep) await screen.prep(page);
      await settle(page, 400);
      expect(await unstyledClasses(page), `Klassen ohne Regel auf „${screen.name}“`).toEqual([]);
    });
  }
});
