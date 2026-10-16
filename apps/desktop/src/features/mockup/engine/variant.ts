/**
 * Wahl der Vorlagen-Variante (hell/dunkel) für eine Textilfarbe.
 * 1. Variante, deren `colorIds` die Farbe enthält.
 * 2. Sonst Rückfall über die Helligkeit der realen Textilfarbe (`textileHex`).
 * 3. Passt nichts, ist das ein Fehler (`no-variant`): reines Multiplizieren auf der falschen Aufnahme sähe falsch aus.
 */
import type { GarmentColor, GarmentColorId, MockupTemplate } from "@contract";
import { parseHexColor, relativeLuminance } from "./color";
import { MockupEngineError } from "./errors";

export type TemplateVariant = MockupTemplate["variants"][number];
export type Exposure = TemplateVariant["exposure"];

/** Unterhalb dieser Leuchtdichte gilt eine Textilfarbe als dunkel (etwa mittleres Grau, L* ≈ 50). */
export const DARK_LUMINANCE_THRESHOLD = 0.18;

export interface VariantSelection {
  variant: TemplateVariant;
  /** Position in `template.variants`. */
  index: number;
  /** `color-id`: Farbe war in `colorIds` eingetragen; `luminance`: Rückfall über die Helligkeit. */
  reason: "color-id" | "luminance";
}

export function exposureForHex(hex: string): Exposure {
  return relativeLuminance(parseHexColor(hex)) < DARK_LUMINANCE_THRESHOLD ? "dark" : "light";
}

export function selectVariant(
  template: MockupTemplate,
  colorId: GarmentColorId,
  garment: GarmentColor,
): VariantSelection {
  const byId = template.variants.findIndex((v) => v.colorIds.includes(colorId));
  const exact = template.variants[byId];
  if (exact) return { variant: exact, index: byId, reason: "color-id" };

  const exposure = exposureForHex(garment.textileHex);
  const byExposure = template.variants.findIndex((v) => v.exposure === exposure);
  const fallback = template.variants[byExposure];
  if (fallback) return { variant: fallback, index: byExposure, reason: "luminance" };

  throw new MockupEngineError(
    "no-variant",
    `Template "${template.id}" has no variant for color "${colorId}" and no "${exposure}" variant to fall back to`,
  );
}
