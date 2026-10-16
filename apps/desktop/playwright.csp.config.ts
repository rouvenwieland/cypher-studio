import { defineConfig, devices } from "@playwright/test";

/**
 * CSP-Test (ARCHITEKTUR 6.2 und 8): Produktions-Build im Mock-Modus, ausgeliefert mit der Produktions-CSP
 * aus src-tauri/tauri.conf.json (siehe vite.config.ts, `CYPHER_CSP_TEST`). Jede Verletzung lässt den Test scheitern.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/csp.spec.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:4175",
    viewport: { width: 1280, height: 800 },
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium-csp", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command:
      "npx vite build --mode mock --outDir dist-mock && npx vite preview --outDir dist-mock --port 4175 --strictPort",
    url: "http://localhost:4175",
    reuseExistingServer: false,
    timeout: 180_000,
    env: { CYPHER_CSP_TEST: "1" },
  },
});
