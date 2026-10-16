/**
 * Verschiebung des Motivs entlang der Stofffalten (Displacement-Map) auf typed arrays.
 * Keine DOM-Abhängigkeit: arbeitet auf { data, width, height } (RGBA, Reihe für Reihe, unvormultipliziert wie `ImageData`).
 *
 * Karte: R = dx, G = dy, 128 = keine Verschiebung. Je Zielpixel wird das Motiv an (x − dx, y − dy) abgetastet.
 * Abtastung bilinear mit vormultipliziertem Alpha, damit an Kanten keine dunklen Säume entstehen.
 */
import { MockupEngineError } from "./errors";

export interface PixelBuffer {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export interface DisplaceOptions {
  /** Sigma der Kantenglättung in Pixeln (Standard 0,5; 0 schaltet sie ab). */
  edgeSigma?: number | undefined;
}

/** Kartenwert, der „keine Verschiebung“ bedeutet. */
export const DISPLACE_NEUTRAL = 128;
/** Abstand von neutral bis zum vollen Ausschlag (255 − 128). */
const DISPLACE_RANGE = 127;
export const DEFAULT_EDGE_SIGMA = 0.5;

export function createPixelBuffer(width: number, height: number): PixelBuffer {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

function assertBuffer(buffer: PixelBuffer, name: string): void {
  const valid =
    Number.isInteger(buffer.width) &&
    Number.isInteger(buffer.height) &&
    buffer.width >= 0 &&
    buffer.height >= 0 &&
    buffer.data.length === buffer.width * buffer.height * 4;
  if (!valid) throw new MockupEngineError("invalid-input", `${name}: data length does not match width × height × 4`);
}

/** Kanalwert → Verschiebung in Pixeln, auf ±Stärke begrenzt: (wert − 128) / 127 × stärke. */
export function displacementFromChannel(value: number, strengthPx: number): number {
  const factor = Math.max(-1, Math.min(1, (value - DISPLACE_NEUTRAL) / DISPLACE_RANGE));
  return factor * strengthPx;
}

/** Tabelle Kanalwert (0–255) → Verschiebung in Pixeln, damit die Schleife nicht je Pixel rechnen muss. */
function displacementTable(strengthPx: number): Float64Array {
  const table = new Float64Array(256);
  for (let v = 0; v < 256; v++) table[v] = displacementFromChannel(v, strengthPx);
  return table;
}

/**
 * Verschiebt `src` gemäß `map` (gleiche Größe) und glättet danach die Alpha-Kanten leicht
 * (nur wenn mindestens ein Pixel verschoben wurde; bei reiner Nullverschiebung ist das Ergebnis die Identität).
 * Liefert einen neuen Puffer; die Eingaben bleiben unverändert.
 * Kartenpixel mit Alpha 0 gelten als neutral (außerhalb der Karte darf nichts springen).
 */
export function displaceImage(
  src: PixelBuffer,
  map: PixelBuffer,
  strengthPx: number,
  options: DisplaceOptions = {},
): PixelBuffer {
  assertBuffer(src, "src");
  assertBuffer(map, "map");
  if (src.width !== map.width || src.height !== map.height) {
    throw new MockupEngineError("invalid-input", "Displacement map must have the same size as the image");
  }
  if (!Number.isFinite(strengthPx)) throw new MockupEngineError("invalid-input", "strengthPx must be finite");

  const { width, height } = src;
  const s = src.data;
  const m = map.data;
  const out = createPixelBuffer(width, height);
  const o = out.data;
  const table = displacementTable(strengthPx);
  const rowStride = width * 4;
  let moved = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let dx = 0;
      let dy = 0;
      if ((m[i + 3] ?? 0) !== 0) {
        dx = table[m[i] ?? DISPLACE_NEUTRAL] ?? 0;
        dy = table[m[i + 1] ?? DISPLACE_NEUTRAL] ?? 0;
      }
      if (dx === 0 && dy === 0) {
        // Keine Verschiebung: Pixel unverändert übernehmen (verlustfrei, auch bei Alpha 0).
        o[i] = s[i] ?? 0;
        o[i + 1] = s[i + 1] ?? 0;
        o[i + 2] = s[i + 2] ?? 0;
        o[i + 3] = s[i + 3] ?? 0;
        continue;
      }
      moved = true;

      const sx = x - dx;
      const sy = y - dy;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      if (x0 >= 0 && y0 >= 0 && x0 + 1 < width && y0 + 1 < height) {
        // Schneller Pfad: alle vier Nachbarn liegen im Bild.
        const j00 = y0 * rowStride + x0 * 4;
        const j10 = j00 + 4;
        const j01 = j00 + rowStride;
        const j11 = j01 + 4;
        // Vormultipliziert summieren: Gewicht × Alpha (× Farbe)
        const a00 = w00 * (s[j00 + 3] ?? 0);
        const a10 = w10 * (s[j10 + 3] ?? 0);
        const a01 = w01 * (s[j01 + 3] ?? 0);
        const a11 = w11 * (s[j11 + 3] ?? 0);
        const accA = a00 + a10 + a01 + a11;
        if (accA > 0) {
          o[i] = (a00 * (s[j00] ?? 0) + a10 * (s[j10] ?? 0) + a01 * (s[j01] ?? 0) + a11 * (s[j11] ?? 0)) / accA;
          o[i + 1] =
            (a00 * (s[j00 + 1] ?? 0) + a10 * (s[j10 + 1] ?? 0) + a01 * (s[j01 + 1] ?? 0) + a11 * (s[j11 + 1] ?? 0)) /
            accA;
          o[i + 2] =
            (a00 * (s[j00 + 2] ?? 0) + a10 * (s[j10 + 2] ?? 0) + a01 * (s[j01 + 2] ?? 0) + a11 * (s[j11 + 2] ?? 0)) /
            accA;
          o[i + 3] = accA;
        }
        continue;
      }

      // Randpfad: Nachbarn außerhalb des Bildes gelten als transparent.
      let accA = 0;
      let accR = 0;
      let accG = 0;
      let accB = 0;
      for (let k = 0; k < 4; k++) {
        const xi = x0 + (k & 1);
        const yi = y0 + (k >> 1);
        if (xi < 0 || yi < 0 || xi >= width || yi >= height) continue;
        const weight = k === 0 ? w00 : k === 1 ? w10 : k === 2 ? w01 : w11;
        if (weight === 0) continue;
        const j = yi * rowStride + xi * 4;
        const wa = weight * (s[j + 3] ?? 0);
        accA += wa;
        accR += wa * (s[j] ?? 0);
        accG += wa * (s[j + 1] ?? 0);
        accB += wa * (s[j + 2] ?? 0);
      }
      if (accA > 0) {
        o[i] = accR / accA;
        o[i + 1] = accG / accA;
        o[i + 2] = accB / accA;
        o[i + 3] = accA;
      }
    }
  }

  // Ohne jede Verschiebung gibt es nichts zu glätten: das Motiv bleibt bit-genau erhalten.
  const sigma = options.edgeSigma ?? DEFAULT_EDGE_SIGMA;
  return moved && sigma > 0 ? softenAlphaEdges(out, sigma) : out;
}

/** Gewichte des 3×3-Gauß-Kerns: Mitte, Kantennachbarn, Eckennachbarn (Summe 1). */
export function gaussKernel3(sigma: number): { center: number; edge: number; corner: number } {
  const twoSigmaSq = 2 * sigma * sigma;
  const edge = Math.exp(-1 / twoSigmaSq);
  const corner = Math.exp(-2 / twoSigmaSq);
  const sum = 1 + 4 * edge + 4 * corner;
  return { center: 1 / sum, edge: edge / sum, corner: corner / sum };
}

/**
 * Glättet nur den Alpha-Rand: Pixel, deren 3×3-Umgebung unterschiedliche Alpha-Werte enthält, werden mit einem
 * Gauß-Kern (Standard σ = 0,5 px) vormultipliziert gemittelt. Fläche mit gleichem Alpha (volle Deckung, volle
 * Transparenz) bleibt bit-genau erhalten, Details im Inneren des Motivs werden nicht weichgezeichnet.
 * Liefert einen neuen Puffer.
 */
export function softenAlphaEdges(buffer: PixelBuffer, sigma: number = DEFAULT_EDGE_SIGMA): PixelBuffer {
  assertBuffer(buffer, "buffer");
  const { width, height, data } = buffer;
  const out: PixelBuffer = { data: new Uint8ClampedArray(data), width, height };
  if (!(sigma > 0) || width === 0 || height === 0) return out;

  const kernel = gaussKernel3(sigma);
  const o = out.data;
  const lastX = width - 1;
  const lastY = height - 1;
  const rowStride = width * 4;

  for (let y = 0; y < height; y++) {
    const interiorRow = y > 0 && y < lastY;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // Kante erkennen: das Alpha der Umgebung (Ränder werden wiederholt) ist nicht überall gleich.
      let isEdge: boolean;
      if (interiorRow && x > 0 && x < lastX) {
        const a = data[i + 3];
        const up = i - rowStride + 3;
        const down = i + rowStride + 3;
        isEdge =
          data[up - 4] !== a ||
          data[up] !== a ||
          data[up + 4] !== a ||
          data[i - 1] !== a ||
          data[i + 7] !== a ||
          data[down - 4] !== a ||
          data[down] !== a ||
          data[down + 4] !== a;
      } else {
        let minA = 255;
        let maxA = 0;
        for (let ky = -1; ky <= 1; ky++) {
          const yy = Math.min(lastY, Math.max(0, y + ky));
          for (let kx = -1; kx <= 1; kx++) {
            const xx = Math.min(lastX, Math.max(0, x + kx));
            const a = data[(yy * width + xx) * 4 + 3] ?? 0;
            if (a < minA) minA = a;
            if (a > maxA) maxA = a;
          }
        }
        isEdge = minA !== maxA;
      }
      if (!isEdge) continue;

      let accA = 0;
      let accR = 0;
      let accG = 0;
      let accB = 0;
      for (let ky = -1; ky <= 1; ky++) {
        const yy = Math.min(lastY, Math.max(0, y + ky));
        for (let kx = -1; kx <= 1; kx++) {
          const xx = Math.min(lastX, Math.max(0, x + kx));
          const weight = kx === 0 && ky === 0 ? kernel.center : kx === 0 || ky === 0 ? kernel.edge : kernel.corner;
          const j = (yy * width + xx) * 4;
          const wa = weight * (data[j + 3] ?? 0);
          accA += wa;
          accR += wa * (data[j] ?? 0);
          accG += wa * (data[j + 1] ?? 0);
          accB += wa * (data[j + 2] ?? 0);
        }
      }
      if (accA > 0) {
        o[i] = accR / accA;
        o[i + 1] = accG / accA;
        o[i + 2] = accB / accA;
        o[i + 3] = accA;
      } else {
        o[i] = 0;
        o[i + 1] = 0;
        o[i + 2] = 0;
        o[i + 3] = 0;
      }
    }
  }
  return out;
}
