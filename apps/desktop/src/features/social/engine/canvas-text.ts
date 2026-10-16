/**
 * Canvas-Textstil: Schriftangabe, Laufweite, Messfunktion und Schrifterkennung.
 * Zeichnen (`draw.ts`) und Messen (`canvasMeasure`) setzen den Stil über dieselbe Funktion,
 * damit gemessene und gezeichnete Breite übereinstimmen.
 */
import { round } from "@/lib/assert";
import type { MeasureFn } from "./textfit";

/** 2D-Kontext einer sichtbaren oder einer Offscreen-Leinwand. */
export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface FontSpec {
  family: string;
  weight: number;
  /** Laufweite in em (CSS `letter-spacing`). */
  letterSpacingEm: number;
}

/** Notnagel, falls die Schrift fehlt (erkannt wird das über `createFontProbe`). */
const GENERIC_FALLBACK = "sans-serif";
/** Zeichenfolge für die Erkennung: breite und schmale Buchstaben, Ziffer, Umlaut. */
const PROBE_TEXT = "mmmmmmmmmmlli0\u00C4";

export function quoteFontFamily(family: string): string {
  return `"${family.replace(/["\\]/g, "\\$&")}"`;
}

/** Wert für `ctx.font`, z. B. `800 230px "Anybody", sans-serif`. */
export function fontShorthand(weight: number, sizePx: number, family: string): string {
  return `${weight} ${round(sizePx, 3)}px ${quoteFontFamily(family)}, ${GENERIC_FALLBACK}`;
}

/** Laufweite in Pixeln für `ctx.letterSpacing`. */
export function letterSpacingValue(letterSpacingEm: number, sizePx: number): string {
  return `${round(letterSpacingEm * sizePx, 3)}px`;
}

/**
 * Setzt Schrift und Laufweite. Kennt die Engine `ctx.letterSpacing` nicht (ältere WebKit-Versionen),
 * entfällt die Laufweite beim Messen UND beim Zeichnen gleichermaßen.
 */
export function applyTextStyle(ctx: Canvas2D, font: FontSpec, sizePx: number): void {
  ctx.font = fontShorthand(font.weight, sizePx, font.family);
  if ("letterSpacing" in ctx) {
    ctx.letterSpacing = letterSpacingValue(font.letterSpacingEm, sizePx);
  }
}

/** Messfunktion für die Layout-Engine auf Basis von `measureText` (ein Kontext, der nur zum Messen dient). */
export function canvasMeasure(ctx: Canvas2D, font: FontSpec): MeasureFn {
  return (text, sizePx) => {
    applyTextStyle(ctx, font, sizePx);
    return ctx.measureText(text).width;
  };
}

/**
 * Erkennt, ob eine Schrift wirklich geladen ist: Fehlt sie, setzt der Browser einen Ersatz ein, und die Breite
 * hängt vom Ersatz ab. Zwei verschiedene Ersatzschriften (monospace und serif) messen dann verschieden.
 */
export function createFontProbe(ctx: Canvas2D): (family: string, weight: number) => boolean {
  const widthWith = (family: string, weight: number, fallback: string): number => {
    ctx.font = `${weight} 72px ${quoteFontFamily(family)}, ${fallback}`;
    return ctx.measureText(PROBE_TEXT).width;
  };
  return (family, weight) => widthWith(family, weight, "monospace") === widthWith(family, weight, "serif");
}

/** Kleiner Hilfskontext zum Messen; `null`, wo es keine Leinwand gibt (Tests unter jsdom). */
export function createScratchContext(): Canvas2D | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(1, 1).getContext("2d");
  if (typeof document !== "undefined") return document.createElement("canvas").getContext("2d");
  return null;
}
