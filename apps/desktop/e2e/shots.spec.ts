import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import { openApp, settle } from "./helpers";

/**
 * Bildschirmfotos aller Hauptansichten nach docs/shots/ (1280 × 800 und 1100 × 700, Papier und Tinte).
 * Aufruf: `npm run shots`. Der Mock liefert feste Daten und eine feste Uhr, die Bilder sind also reproduzierbar.
 */
const OUT = fileURLToPath(new URL("../../../docs/shots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

interface Shot {
  name: string;
  hash: string;
  scenario?: string;
  pick?: string;
  prep?: (page: Page) => Promise<void>;
}

const SHOTS: Shot[] = [
  { name: "start", hash: "start" },
  { name: "start-leer", hash: "start", scenario: "libraryEmpty" },
  { name: "programme", hash: "programme" },
  { name: "programm-detail", hash: "programme/krita" },
  {
    name: "installieren",
    hash: "programme",
    prep: async (p) => {
      await p.getByTestId("row-action-blender").click();
      await p.getByTestId("install-confirm").waitFor();
    },
  },
  {
    name: "installieren-pruefsumme",
    hash: "programme",
    scenario: "installChecksumFail",
    prep: async (p) => {
      await p.getByTestId("row-action-blender").click();
      await p.getByTestId("install-confirm").click();
      await p.getByTestId("checksum-error").waitFor({ timeout: 30_000 });
    },
  },
  { name: "druck-leer", hash: "druck" },
  {
    name: "druck-hinweise",
    hash: "druck",
    pick: "signal_v3.png",
    prep: async (p) => {
      await p.getByTestId("print-pick").click();
      await p.getByTestId("verdict").getByText("Druckbar mit Hinweisen").waitFor();
    },
  },
  {
    name: "druck-fehler",
    hash: "druck",
    pick: "kleines_motiv.png",
    prep: async (p) => {
      await p.getByTestId("print-pick").click();
      await p.getByTestId("verdict").getByText("Nicht druckbar").waitFor();
    },
  },
  { name: "bibliothek", hash: "bibliothek" },
  { name: "mockups-leer", hash: "mockups" },
  {
    name: "mockups-motiv",
    hash: "mockups",
    pick: "signal_v3.png",
    prep: async (p) => {
      await p.getByTestId("mockup-pick").click();
      await p.locator(`[data-testid="measure-contrast"]:not([data-state="open"])`).waitFor();
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
      await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    },
  },
  {
    name: "social-vorlage",
    hash: "social",
    pick: "signal_v3.png",
    prep: async (p) => {
      await p.getByTestId("tpl-drop-ankuendigung").first().click();
      await p.getByTestId("pick-bild").click();
      await p.getByTestId("focal-picker").waitFor();
      await p.evaluate(() => document.querySelector(".inspector__body")?.scrollTo(0, 0));
    },
  },
  {
    name: "social-story",
    hash: "social",
    prep: async (p) => {
      await p.getByRole("radio", { name: /^Story/ }).click();
      await p.getByTestId("tpl-termin-story").first().click();
      await p.getByTestId("measure-zone").waitFor();
    },
  },
  { name: "freistellen-leer", hash: "freistellen" },
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
  { name: "einstellungen", hash: "einstellungen/darstellung" },
  { name: "einstellungen-updates", hash: "einstellungen/updates", scenario: "updateAvailable" },
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
  {
    name: "befehle",
    hash: "start",
    prep: async (p) => {
      await p.keyboard.press("Control+k");
      await p.getByTestId("palette").waitFor();
    },
  },
];

const SIZES = [
  { w: 1280, h: 800 },
  { w: 1100, h: 700 },
];

for (const theme of ["light", "dark"] as const) {
  for (const size of SIZES) {
    test.describe(`Fotos ${size.w}x${size.h} ${theme === "light" ? "Papier" : "Tinte"}`, () => {
      test.use({ viewport: { width: size.w, height: size.h } });
      for (const shot of SHOTS) {
        test(shot.name, async ({ page }) => {
          await openApp(page, shot.hash, {
            theme,
            speed: 40,
            ...(shot.scenario ? { scenario: shot.scenario } : {}),
            ...(shot.pick ? { pick: shot.pick } : {}),
          });
          if (shot.prep) await shot.prep(page);
          await settle(page, 700);
          await page.screenshot({
            path: `${OUT}${shot.name}_${size.w}x${size.h}_${theme === "light" ? "papier" : "tinte"}.png`,
            animations: "disabled",
            caret: "hide",
          });
        });
      }
    });
  }
}
