/**
 * Reine Rechnungen hinter dem Zeichnen: Zufall mit festem Startwert, Verlaufslinie, Eckenradius,
 * Zeilenraster und Filmkorn. Alles ohne Leinwand und damit unter jsdom testbar.
 */
import type { Rect } from "@contract";

/**
 * mulberry32: kleiner Zufallsgenerator mit festem Startwert (gleicher Seed, gleiche Folge).
 * Liefert Zahlen in [0, 1). Das Korn eines Bildes bleibt damit bei jedem Zeichnen und Export gleich.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GradientLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Start und Ende eines Verlaufs in `rect` für einen Winkel nach CSS-Regel (`linear-gradient`):
 * 0° zeigt nach oben, 90° nach rechts, 180° nach unten. Die Linie läuft durch die Mitte und ist so lang,
 * dass die Ecken genau die Endfarben bekommen.
 */
export function gradientLine(angleDeg: number, rect: Rect): GradientLine {
  const radians = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const half = (Math.abs(rect.width * dx) + Math.abs(rect.height * dy)) / 2;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { x0: cx - dx * half, y0: cy - dy * half, x1: cx + dx * half, y1: cy + dy * half };
}

/** Eckenradius, höchstens die halbe kürzere Seite, nie negativ. */
export function clampRadius(radius: number, width: number, height: number): number {
  return Math.max(0, Math.min(radius, width / 2, height / 2));
}

/** Dicke einer Zeilenlinie: die Hälfte des Abstands, mindestens 1 px. */
export function scanlineThickness(spacingPx: number): number {
  return Math.max(1, Math.round(spacingPx / 2));
}

/** Oberkanten der Zeilenlinien von 0 bis `height`; leer bei Abstand ≤ 0. */
export function scanlineRows(height: number, spacingPx: number): number[] {
  if (!(spacingPx > 0) || !(height > 0)) return [];
  const rows: number[] = [];
  for (let y = 0; y < height; y += spacingPx) rows.push(y);
  return rows;
}

/**
 * Filmkorn: addiert gleichmäßiges, mittelwertfreies Rauschen auf R, G und B (gleicher Wert je Pixel, Alpha bleibt).
 * Die Stärke ist `opacity × 255` je Richtung. Deterministisch über `seed`, Pixel in Zeilenreihenfolge.
 */
export function applyGrain(pixels: Uint8ClampedArray, opacity: number, seed: number): void {
  const amplitude = Math.max(0, opacity) * 255;
  if (amplitude === 0) return;
  const random = mulberry32(seed);
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const delta = (random() * 2 - 1) * amplitude;
    pixels[i] = (pixels[i] ?? 0) + delta;
    pixels[i + 1] = (pixels[i + 1] ?? 0) + delta;
    pixels[i + 2] = (pixels[i + 2] ?? 0) + delta;
  }
}
