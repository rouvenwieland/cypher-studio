/**
 * ALLE sichtbaren Texte der App (de-DE, Du-Form). Komponenten enthalten keine Textliterale (ESLint-Regel).
 * Aufgeteilt in Dateien unter ./de/, hier zusammengeführt.
 */
import { common, nav } from "./de/common";
import { cutout } from "./de/cutout";
import { install, programs, setup } from "./de/programs";
import { library } from "./de/library";
import { mockup } from "./de/mockup";
import { onboarding } from "./de/onboarding";
import { print } from "./de/print";
import { settings } from "./de/settings";
import { social } from "./de/social";
import { jobsText, shell } from "./de/shell";
import { start } from "./de/start";

export const de = {
  common,
  nav,
  shell,
  jobs: jobsText,
  start,
  programs,
  install,
  setup,
  library,
  print,
  settings,
  onboarding,
  cutout,
  mockup,
  social,
} as const;

export const t = de;
export type Texts = typeof de;
