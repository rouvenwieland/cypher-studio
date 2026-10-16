/** Farbhilfen: Hex lesen und Helligkeit bestimmen (für die Wahl der Hell-/Dunkel-Variante). */
import { MockupEngineError } from "./errors";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Liest `#rgb`, `#rrggbb` oder `#rrggbbaa` (Alpha wird verworfen). Wirft bei ungültigem Wert. */
export function parseHexColor(hex: string): Rgb {
  const value = hex.trim();
  if (!HEX_PATTERN.test(value)) {
    throw new MockupEngineError("invalid-input", `Invalid hex color: "${hex}"`);
  }
  const digits = value.slice(1);
  if (digits.length === 3) {
    const [r = "0", g = "0", b = "0"] = digits;
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) };
  }
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
  };
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative Leuchtdichte nach WCAG/Rec. 709 (0 = schwarz, 1 = weiß). */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
}

/** Kontrastverhältnis nach WCAG (1 bis 21) zwischen zwei Leuchtdichten. */
export function contrastOfLuminance(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}
