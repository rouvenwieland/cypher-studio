import { test, type Page } from "@playwright/test";
import { expectNoModerateViolations, openApp, settle } from "./helpers";

/** axe (WCAG 2.2 AA) je Bildschirm und Thema: 0 Verstöße (DESIGN.md Vertrag „Kontrast“). */
interface Screen {
  name: string;
  hash: string;
  scenario?: string;
  pick?: string;
  prep?: (page: Page) => Promise<void>;
}

const SCREENS: Screen[] = [
  { name: "start", hash: "start" },
  { name: "start-leer", hash: "start", scenario: "libraryEmpty" },
  { name: "programme", hash: "programme" },
  { name: "programm-detail", hash: "programme/krita" },
  {
    name: "einrichtung",
    hash: "programme/krita?tab=einrichtung",
    scenario: "setupConflicts",
    prep: async (p) => {
      await p.getByTestId("setup-row-workspace").getByRole("checkbox").check();
    },
  },
  { name: "druck-leer", hash: "druck" },
  {
    name: "druck-datei",
    hash: "druck",
    pick: "signal_v3.png",
    prep: async (p) => {
      await p.getByTestId("print-pick").click();
      await p.getByTestId("verdict").getByText("Druckbar mit Hinweisen").waitFor();
      await p.getByTestId("show-ok").click();
    },
  },
  {
    name: "druck-fehler",
    hash: "druck",
    pick: "kleines_motiv.png",
    prep: async (p) => {
      await p.getByTestId("print-pick").click();
      await p.getByTestId("verdict").getByText("Nicht druckbar").waitFor();
      await p.getByTestId("check-resolution").getByRole("button").first().click();
    },
  },
  { name: "bibliothek", hash: "bibliothek" },
  {
    name: "bibliothek-auswahl",
    hash: "bibliothek",
    prep: async (p) => {
      await p.getByTestId("cell-0").click();
      await p.getByTestId("cell-1").click({ modifiers: ["Control"] });
    },
  },
  { name: "freistellen", hash: "freistellen" },
  { name: "mockups-leer", hash: "mockups" },
  {
    name: "mockups-motiv",
    hash: "mockups",
    pick: "signal_v3.png",
    prep: async (p) => {
      await p.getByTestId("mockup-pick").click();
      await p.locator(`[data-testid="measure-contrast"]:not([data-state="open"])`).waitFor();
      await p.getByRole("checkbox", { name: "Weiß" }).check();
    },
  },
  {
    name: "mockups-kontaktbogen",
    hash: "mockups",
    pick: "signal_v3.png",
    prep: async (p) => {
      await p.getByTestId("mockup-pick").click();
      await p.getByTestId("mockup-stage").focus();
      await p.keyboard.press("k");
      await p.getByTestId("contact-sheet").locator("canvas").nth(5).waitFor({ timeout: 15_000 });
    },
  },
  {
    name: "freistellen-ergebnis",
    hash: "freistellen",
    pick: "signal_v3.png",
    prep: async (p) => {
      await p.getByTestId("cutout-pick").click();
      await p.getByTestId("cutout-run").click();
      await p.getByTestId("compare-handle").waitFor();
    },
  },
  {
    name: "social-bild",
    hash: "social",
    pick: "signal_v3.png",
    prep: async (p) => {
      await p.getByTestId("tpl-neues-motiv").first().click();
      await p.getByTestId("pick-bild").click();
      await p.getByTestId("focal-picker").waitFor();
    },
  },
  { name: "social", hash: "social" },
  {
    name: "social-vorlage",
    hash: "social",
    prep: async (p) => {
      await p.getByTestId("tpl-drop-ankuendigung").first().click();
      await settle(p, 800);
    },
  },
  { name: "einstellungen-darstellung", hash: "einstellungen/darstellung" },
  { name: "einstellungen-arbeitsflaeche", hash: "einstellungen/arbeitsflaeche" },
  { name: "einstellungen-programme", hash: "einstellungen/programme" },
  { name: "einstellungen-profile", hash: "einstellungen/profile" },
  { name: "einstellungen-updates", hash: "einstellungen/updates", scenario: "updateAvailable" },
  { name: "einstellungen-netzwerk", hash: "einstellungen/netzwerk" },
  { name: "einstellungen-ueber", hash: "einstellungen/ueber" },
  {
    name: "install-dialog",
    hash: "programme",
    prep: async (p) => {
      await p.getByTestId("row-action-blender").click();
      await p.getByTestId("install-confirm").waitFor();
    },
  },
  {
    name: "install-fehler",
    hash: "programme",
    scenario: "installChecksumFail",
    prep: async (p) => {
      await p.getByTestId("row-action-blender").click();
      await p.getByTestId("install-confirm").click();
      await p.getByTestId("checksum-error").waitFor({ timeout: 30_000 });
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
  { name: "erststart-kennung", hash: "erststart", scenario: "fresh" },
  {
    name: "erststart-auswahl",
    hash: "erststart",
    scenario: "fresh",
    prep: async (p) => {
      await p.getByTestId("kennung-start").click();
      await p.getByTestId("ob-next").waitFor();
    },
  },
];

for (const theme of ["light", "dark"] as const) {
  test.describe(`axe · Thema ${theme === "light" ? "Papier" : "Tinte"}`, () => {
    for (const screen of SCREENS) {
      test(screen.name, async ({ page }) => {
        await openApp(page, screen.hash, {
          theme,
          ...(screen.scenario ? { scenario: screen.scenario } : {}),
          ...(screen.pick ? { pick: screen.pick } : {}),
        });
        if (screen.prep) await screen.prep(page);
        await settle(page, 400);
        await expectNoModerateViolations(page, `${screen.name} (${theme})`);
      });
    }
  });
}
