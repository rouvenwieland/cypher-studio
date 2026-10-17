import { defineConfig } from "@playwright/test";

/**
 * E2E-Suite gegen die ECHTE App (Windows-Debug-Build mit dem Feature `dev-tools`, WebView2), gesteuert über das
 * Chrome-DevTools-Protokoll. Jede Datei startet ihre App selbst in einem Wegwerf-Datenordner (`e2e-real/support/launch.ts`)
 * und löscht ihn danach. Ein Fenster zur Zeit: nur eine App-Instanz läuft, Dateien nacheinander.
 *
 *   npm run e2e:real                 (Build vorher: wsl-build.sh e2e, siehe docs/BAUEN.md)
 *   CYPHER_E2E_EXE=<pfad>            anderer Build
 *   CYPHER_E2E_TMP=<ordner>          Wegwerf-Ordner statt des Temp-Ordners
 */
export default defineConfig({
  testDir: "e2e-real/specs",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/real",
  use: { trace: "off", screenshot: "only-on-failure" },
});
