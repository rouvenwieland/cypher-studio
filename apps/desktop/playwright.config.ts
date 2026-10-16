import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright gegen den Vite-Dev-Server (Port 1420) mit gemocktem IPC (ARCHITEKTUR 8.3).
 * Der Produktions-Build mit Produktions-CSP läuft auf Port 4175 (csp.spec.ts).
 */
export default defineConfig({
  testDir: "e2e",
  testIgnore: ["**/csp.spec.ts", "**/shots.spec.ts"],
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: process.env["CI"] ? 2 : 4,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1280, height: 800 },
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  webServer: [
    {
      command: "npx vite --port 1420 --strictPort",
      url: "http://localhost:1420",
      reuseExistingServer: true,
      timeout: 60_000,
      env: { VITE_MOCK_IPC: "1" },
    },
  ],
});
