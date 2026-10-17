/**
 * Misst das Motiv, bevor es auf dem Shirt liegt: Gibt es Transparenz, und wie viel vom sichtbaren Motiv
 * hebt sich von der gewählten Textilfarbe kaum ab? Rein rechnerisch (WCAG-Kontrast), auf 64 × 64 verkleinert.
 */
import { contrastOfLuminance, parseHexColor, relativeLuminance } from "./engine/color";

/** Pixel mit weniger Kontrast als dieser Wert zum Textil gelten als „hebt sich kaum ab“. */
export const LOW_CONTRAST = 1.6;
/** Ab diesem Anteil kaum abgehobener Pixel warnt die Messung. */
export const LOW_SHARE_WARN = 0.5;

const SIZE = 64;

export interface DesignSample {
  /** Luminanz (0 bis 1) jedes deutlich sichtbaren Pixels. */
  luminances: Float32Array;
  /** Anteil der Pixel mit Transparenz (Alpha unter 250), 0 bis 1. */
  transparentShare: number;
  /** Breite durch Höhe des Motivs (für die Passung auf die Druckfläche) */
  aspect: number;
}

/** Fasst RGBA-Pixel zu Leuchtdichten der sichtbaren Pixel und dem Transparenzanteil zusammen. */
export function summarizePixels(rgba: Uint8ClampedArray, aspect = 1): DesignSample {
  const total = rgba.length / 4;
  const lum = new Float32Array(total);
  let n = 0;
  let transparent = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] ?? 0;
    if (a < 250) transparent += 1;
    if (a < 128) continue;
    lum[n] = relativeLuminance({ r: rgba[i] ?? 0, g: rgba[i + 1] ?? 0, b: rgba[i + 2] ?? 0 });
    n += 1;
  }
  return { luminances: lum.slice(0, n), transparentShare: total === 0 ? 0 : transparent / total, aspect };
}

/** Anteil (0 bis 1) der sichtbaren Pixel, deren Kontrast zur Textilfarbe unter `LOW_CONTRAST` liegt. */
export function lowContrastShare(sample: DesignSample, garmentHex: string): number {
  if (sample.luminances.length === 0) return 0;
  const garment = relativeLuminance(parseHexColor(garmentHex));
  let low = 0;
  for (const l of sample.luminances) {
    if (contrastOfLuminance(l, garment) < LOW_CONTRAST) low += 1;
  }
  return low / sample.luminances.length;
}

/** Lädt das Motiv (gleiche Quelle wie die Engine) und liest ein verkleinertes Raster. */
export async function sampleDesign(url: string, signal?: AbortSignal): Promise<DesignSample> {
  const res = await fetch(url, signal ? { signal } : undefined);
  const bmp = await createImageBitmap(await res.blob());
  try {
    const scale = Math.min(1, SIZE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Kein 2D-Kontext");
    ctx.drawImage(bmp, 0, 0, w, h);
    return summarizePixels(ctx.getImageData(0, 0, w, h).data, bmp.width / Math.max(1, bmp.height));
  } finally {
    bmp.close();
  }
}
