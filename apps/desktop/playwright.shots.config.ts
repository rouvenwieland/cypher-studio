import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Bildschirmfotos nach docs/shots/ (npm run shots); die Fotos gehören nicht zum normalen Lauf. */
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: "**/shots.spec.ts",
  timeout: 90_000,
  workers: 3,
});
