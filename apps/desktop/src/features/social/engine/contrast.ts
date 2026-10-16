/**
 * Farbkontrast nach WCAG 2.x (sRGB). Reine Rechnung, keine UI-Texte.
 * Werte sind sRGB-Hexfarben der Vorlage; Alphakanäle in Fills werden als deckend behandelt.
 */
import type { Fill, HexColor } from "@contract";
import { assertNever } from "@/lib/assert";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  /** 0 = durchsichtig, 1 = deckend. */
  a: number;
}

/** Mindestkontrast Text/Grund (WCAG AA, normaler Text). CONCEPT 6.6 verlangt ihn für allen Text. */
export const AA_NORMAL = 4.5;
/** Mindestkontrast für großen Text (WCAG AA). */
export const AA_LARGE = 3;

const HEX_PATTERN = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Liest Kurz- oder Langform mit optionalem Alphakanal. Ungültiges ergibt `null`. */
export function parseHexColor(hex: HexColor): Rgba | null {
  const match = HEX_PATTERN.exec(hex.trim());
  const digits = match?.[1];
  if (digits === undefined) return null;
  const expanded = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join("") : digits;
  const channel = (index: number): number => parseInt(expanded.slice(index * 2, index * 2 + 2), 16);
  return {
    r: channel(0),
    g: channel(1),
    b: channel(2),
    a: expanded.length === 8 ? channel(3) / 255 : 1,
  };
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative Leuchtdichte (0 = schwarz, 1 = weiß). */
export function relativeLuminance(color: Rgb): number {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

/** Kontrastverhältnis von 1 bis 21, unabhängig von der Reihenfolge der Farben. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Erfüllt das Paar WCAG AA? Ungültige Farben gelten als nicht erfüllt. */
export function meetsAA(fg: HexColor, bg: HexColor, largeText: boolean): boolean {
  const foreground = parseHexColor(fg);
  const background = parseHexColor(bg);
  if (foreground === null || background === null) return false;
  return contrastRatio(foreground, background) >= (largeText ? AA_LARGE : AA_NORMAL);
}

/** `fg` mit Deckkraft `alpha` über `bg` gelegt. */
export function blendOver(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  const a = Math.min(1, Math.max(0, alpha));
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
  };
}

/**
 * Mögliche Grundfarben einer Fläche: Volltonfarbe → eine Farbe, Verlauf → alle Stopps (der ungünstigste zählt),
 * Bild → `null` (Foto, nicht prüfbar). Konservativ: Es wird nicht geprüft, welcher Teil des Verlaufs unter dem Text liegt.
 */
export function fillColors(fill: Fill): Rgb[] | null {
  switch (fill.type) {
    case "solid": {
      const color = parseHexColor(fill.color);
      return color === null ? null : [color];
    }
    case "linearGradient": {
      const colors = fill.stops.flatMap((stop) => parseHexColor(stop.color) ?? []);
      return colors.length > 0 ? colors : null;
    }
    case "image":
      return null;
    default:
      return assertNever(fill, "Fill");
  }
}

/**
 * Kleinstes Kontrastverhältnis der Textfarbe gegen alle möglichen Grundfarben (= ungünstigster Stopp).
 * Hat die Textfarbe einen Alphakanal, wird sie je Grundfarbe über diese gelegt.
 */
export function worstContrast(foreground: Rgba, backdrop: readonly Rgb[]): number | null {
  if (backdrop.length === 0) return null;
  return Math.min(
    ...backdrop.map((background) =>
      contrastRatio(foreground.a < 1 ? blendOver(foreground, background, foreground.a) : foreground, background),
    ),
  );
}
