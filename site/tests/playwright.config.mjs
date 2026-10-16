import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: '../test-results',
  timeout: 90_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    // Die Seite setzt keine Cookies und fragt nichts außer ihren eigenen Dateien an; Tests prüfen das.
    trace: 'off',
  },
  // Leistungsmessung läuft für sich allein, wenn kein anderer Test den Rechner belastet
  projects: [
    { name: 'funktion', testIgnore: /perf.spec/ },
    { name: 'leistung', testMatch: /perf.spec/, dependencies: ['funktion'] },
  ],
});
