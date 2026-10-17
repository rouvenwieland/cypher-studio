// Echte Installationsprobe unter Windows (nur mit Zustimmung der Person am Rechner!):
// steuert das RELEASE-Programm per CDP, installiert ein Programm aus dem eingebauten Katalog (Standard: Blender),
// prüft Prüfsummen-Anzeige, Einrichtung und Start, deinstalliert es danach über die App wieder.
// Vorher: $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'; Start-Process <...>\cypher-studio.exe
// Aufruf: node scripts/probe-windows-install.mjs [programm-id] [fotoordner]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const require = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const id = process.argv[2] ?? "blender";
const out = process.argv[3] ?? "docs/shots/echt/installation";
mkdirSync(out, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...a);

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find((p) => !p.url().startsWith("devtools"));
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
const shot = async (name) => { await page.screenshot({ path: join(out, `${name}.png`) }); log("Foto", name); };
const go = async (hash) => { await page.evaluate((h) => { window.location.hash = h; }, hash); await page.waitForTimeout(1200); };

try {
  if (page.url().includes("erststart")) {
    await page.getByText("Später weitermachen").first().click();
    await page.waitForTimeout(800);
  }
  await go("#/programme");
  const row = page.getByTestId(`program-${id}`);
  log("Zeile:", (await row.innerText()).replace(/\s+/g, " "));
  await page.getByTestId(`row-action-${id}`).click();
  const dialog = page.getByTestId("install-dialog");
  await dialog.waitFor({ state: "visible" });
  log("Dialog:", (await dialog.innerText()).replace(/\s+/g, " ").slice(0, 600));
  await shot("1-vorschau");
  await page.getByTestId("install-confirm").click();
  log("Zugestimmt, Download läuft …");
  await page.waitForTimeout(8000);
  await shot("2-fortschritt");
  await dialog.getByTestId("install-done").waitFor({ state: "visible", timeout: 30 * 60_000 });
  log("Fertig:", (await dialog.innerText()).replace(/\s+/g, " ").slice(0, 600));
  await shot("3-fertig");
  await page.getByTestId("install-close").click();
  await page.waitForTimeout(1500);
  // Einrichtung, falls nach der Installation angeboten: Vorschau fotografieren
  await shot("4-nach-installation");
  await go("#/programme");
  log("Zeile danach:", (await row.innerText()).replace(/\s+/g, " "));
  await shot("5-programmliste");
  // Starten
  await page.getByTestId(`row-action-${id}`).click();
  await page.waitForTimeout(15000);
  const procs = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${id}.exe`, "/FO", "CSV", "/NH"]).toString();
  log("Prozess nach Start:", procs.trim() || "(keiner)");
  if (procs.includes(`${id}.exe`)) execFileSync("taskkill", ["/IM", `${id}.exe`, "/F"]);
  // Deinstallieren über das Detail-Menü
  await go(`#/programme/${id}`);
  await shot("6-detail");
  const menu = page.getByRole("button", { name: /mehr|weitere|aktionen|menü/i }).first();
  await menu.click();
  await page.getByRole("menuitem", { name: /Deinstallieren/ }).click();
  await page.getByRole("button", { name: "Deinstallieren", exact: true }).click();
  await page.waitForTimeout(5000);
  await go("#/programme");
  log("Zeile nach Deinstallation:", (await row.innerText()).replace(/\s+/g, " "));
  await shot("7-deinstalliert");
} catch (e) {
  log("FEHLER:", e.message);
  await shot("fehler").catch(() => {});
  process.exitCode = 1;
} finally {
  console.log(errors.length ? `Konsolenfehler (${errors.length}):\n${errors.join("\n")}` : "Keine Konsolenfehler.");
  process.exit(process.exitCode ?? 0);
}
