import { describe, expect, it } from "vitest";
import {
  createPixelBuffer,
  displaceImage,
  displacementFromChannel,
  gaussKernel3,
  softenAlphaEdges,
  type PixelBuffer,
} from "./displace";
import { MockupEngineError } from "./errors";

type Rgba = readonly [number, number, number, number];

/** Puffer aus einer Funktion (x, y) → RGBA. */
function make(width: number, height: number, fn: (x: number, y: number) => Rgba): PixelBuffer {
  const buffer = createPixelBuffer(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fn(x, y);
      const i = (y * width + x) * 4;
      buffer.data[i] = r;
      buffer.data[i + 1] = g;
      buffer.data[i + 2] = b;
      buffer.data[i + 3] = a;
    }
  }
  return buffer;
}

function px(buffer: PixelBuffer, x: number, y: number): [number, number, number, number] {
  const i = (y * buffer.width + x) * 4;
  return [buffer.data[i] ?? -1, buffer.data[i + 1] ?? -1, buffer.data[i + 2] ?? -1, buffer.data[i + 3] ?? -1];
}

/** Karte mit konstantem R (dx) und G (dy), deckend. */
function constantMap(width: number, height: number, r: number, g: number): PixelBuffer {
  return make(width, height, () => [r, g, 128, 255]);
}

/** Bild mit eindeutigen, deckenden Pixeln, damit Versätze eindeutig erkennbar sind. */
function distinct(width: number, height: number): PixelBuffer {
  return make(width, height, (x, y) => [(x * 40 + 10) % 256, (y * 50 + 20) % 256, (x * 7 + y * 11) % 256, 255]);
}

function expectNear(actual: readonly number[], expected: readonly number[], tolerance = 1): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => {
    expect(Math.abs(value - (expected[i] ?? 0)), `Kanal ${i}: ${value} vs ${expected[i]}`).toBeLessThanOrEqual(
      tolerance,
    );
  });
}

describe("displacementFromChannel", () => {
  it("rechnet (wert − 128) / 127 × stärke und begrenzt auf ±Stärke", () => {
    expect(displacementFromChannel(128, 10)).toBe(0);
    expect(displacementFromChannel(255, 10)).toBeCloseTo(10, 12);
    expect(displacementFromChannel(129, 127)).toBeCloseTo(1, 12);
    expect(displacementFromChannel(0, 10)).toBe(-10); // −128/127 wird auf −1 begrenzt
    expect(displacementFromChannel(1, 127)).toBeCloseTo(-127, 12);
  });
});

describe("displaceImage: Nullverschiebung", () => {
  it("ist die Identität, auch an harten Alpha-Kanten und bei transparenten Pixeln", () => {
    const src = make(6, 5, (x, y) => [x * 40, y * 50, 99, x < 3 ? 255 : y < 2 ? 0 : 128]);
    const out = displaceImage(src, constantMap(6, 5, 128, 128), 20);
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
    expect(out).not.toBe(src);
    expect(out.data).not.toBe(src.data);
  });

  it("ist die Identität bei Stärke 0, egal was die Karte sagt", () => {
    const src = distinct(5, 4);
    const out = displaceImage(src, constantMap(5, 4, 255, 0), 0);
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
  });

  it("behandelt Kartenpixel mit Alpha 0 als neutral (nicht als Ausschlag nach links oben)", () => {
    const src = distinct(4, 4);
    const emptyMap = make(4, 4, () => [0, 0, 0, 0]);
    expect(Array.from(displaceImage(src, emptyMap, 30).data)).toEqual(Array.from(src.data));
  });

  it("verändert die Eingaben nicht", () => {
    const src = distinct(5, 5);
    const map = constantMap(5, 5, 160, 100);
    const srcCopy = Array.from(src.data);
    const mapCopy = Array.from(map.data);
    displaceImage(src, map, 3);
    expect(Array.from(src.data)).toEqual(srcCopy);
    expect(Array.from(map.data)).toEqual(mapCopy);
  });
});

describe("displaceImage: konstante Verschiebung", () => {
  it("dx = +1 verschiebt das Bild um ein Pixel nach rechts (Abtastung bei x − dx)", () => {
    const src = distinct(6, 4);
    const out = displaceImage(src, constantMap(6, 4, 129, 128), 127, { edgeSigma: 0 }); // (129 − 128) / 127 × 127 = 1
    for (let y = 0; y < 4; y++) {
      expect(px(out, 0, y)).toEqual([0, 0, 0, 0]); // kommt von außerhalb: transparent
      for (let x = 1; x < 6; x++) expect(px(out, x, y)).toEqual(px(src, x - 1, y));
    }
  });

  it("dy = −1 (G = 127) verschiebt das Bild um ein Pixel nach oben", () => {
    const src = distinct(4, 6);
    const out = displaceImage(src, constantMap(4, 6, 128, 127), 127, { edgeSigma: 0 });
    for (let x = 0; x < 4; x++) {
      expect(px(out, x, 5)).toEqual([0, 0, 0, 0]);
      for (let y = 0; y < 5; y++) expect(px(out, x, y)).toEqual(px(src, x, y + 1));
    }
  });

  it("verschiebt um mehrere Pixel und in beide Richtungen zugleich", () => {
    const src = distinct(10, 10);
    // strength 127, R = 128 + 3 → dx = 3; G = 128 − 2 → dy = −2
    const out = displaceImage(src, constantMap(10, 10, 131, 126), 127, { edgeSigma: 0 });
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const sx = x - 3;
        const sy = y + 2;
        const inside = sx >= 0 && sy < 10;
        expect(px(out, x, y)).toEqual(inside ? px(src, sx, sy) : [0, 0, 0, 0]);
      }
    }
  });

  it("mischt bei halben Pixeln bilinear (deckend: Mittelwert der Nachbarn)", () => {
    const src = make(4, 1, (x) => [x * 80, 0, 0, 255]); // 0, 80, 160, 240
    const out = displaceImage(src, constantMap(4, 1, 129, 128), 63.5, { edgeSigma: 0 }); // dx = 0,5
    expectNear(px(out, 1, 0), [40, 0, 0, 255]);
    expectNear(px(out, 2, 0), [120, 0, 0, 255]);
    expectNear(px(out, 3, 0), [200, 0, 0, 255]);
  });

  it("liefert an der Bildkante nur den Anteil, der innerhalb liegt (Alpha), mit unveränderter Farbe", () => {
    const src = make(4, 1, () => [200, 100, 50, 255]);
    const out = displaceImage(src, constantMap(4, 1, 129, 128), 63.5, { edgeSigma: 0 });
    // x = 0 tastet bei −0,5 ab: halb außerhalb → halbes Alpha, Farbe bleibt
    expectNear(px(out, 0, 0), [200, 100, 50, 128]);
    expectNear(px(out, 1, 0), [200, 100, 50, 255]);
  });

  it("tastet auch bei Verschiebung nach außen sicher ab (alles weg)", () => {
    const src = distinct(4, 4);
    const out = displaceImage(src, constantMap(4, 4, 255, 128), 100, { edgeSigma: 0 }); // dx = 100
    expect(Array.from(out.data).every((v) => v === 0)).toBe(true);
  });
});

describe("displaceImage: Alpha-Säume", () => {
  it("interpoliert vormultipliziert: Farbe am Rand bleibt rein, nur das Alpha fällt ab (keine dunklen Säume)", () => {
    // links deckendes Rot, rechts völlig transparent mit RGB 0 (so liefert getImageData transparente Pixel)
    const src = make(6, 1, (x) => (x < 3 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
    const out = displaceImage(src, constantMap(6, 1, 129, 128), 63.5, { edgeSigma: 0 }); // dx = 0,5
    const seam = px(out, 3, 0); // mischt Rot (x = 2) mit Transparent (x = 3)
    expectNear(seam, [255, 0, 0, 128]);
    // naive Interpolation ohne Vormultiplizieren ergäbe ein dunkles Rot (≈ 128)
    expect(seam[0]).toBeGreaterThanOrEqual(254);
  });

  it("gewichtet die Farbe zweier halbtransparenter Nachbarn nach ihrem Alpha", () => {
    const src = make(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 85])); // Rot deckend, Blau 1/3
    const out = displaceImage(src, constantMap(2, 1, 129, 128), 63.5, { edgeSigma: 0 });
    // x = 1 tastet bei 0,5 ab: je halb Rot (Alpha 255) und Blau (Alpha 85); Farbanteile 255·0,5 : 85·0,5 = 3 : 1
    const p = px(out, 1, 0);
    expectNear([p[0], p[2], p[3]], [191, 64, 170]);
  });
});

describe("displaceImage: Kantenglättung", () => {
  it("glättet die Alpha-Kante nach der Verschiebung, ohne die Farbe zu verändern", () => {
    const src = make(12, 12, (x, y) => (x >= 3 && x < 9 && y >= 3 && y < 9 ? [10, 200, 30, 255] : [0, 0, 0, 0]));
    const map = constantMap(12, 12, 129, 128);
    const hard = displaceImage(src, map, 127, { edgeSigma: 0 });
    const soft = displaceImage(src, map, 127);
    const hardAlphas = new Set<number>();
    const softAlphas = new Set<number>();
    for (let i = 3; i < hard.data.length; i += 4) {
      hardAlphas.add(hard.data[i] ?? 0);
      softAlphas.add(soft.data[i] ?? 0);
    }
    expect([...hardAlphas].sort()).toEqual([0, 255]);
    expect(softAlphas.size).toBeGreaterThan(2);
    for (let i = 0; i < soft.data.length; i += 4) {
      if ((soft.data[i + 3] ?? 0) > 0)
        expectNear([soft.data[i] ?? 0, soft.data[i + 1] ?? 0, soft.data[i + 2] ?? 0], [10, 200, 30]);
    }
  });

  it("kommt mit einer ungleichmäßigen Karte ohne ungültige Werte zurecht", () => {
    const src = make(40, 30, (x, y) => [x * 6, y * 8, 120, (x + y) % 7 === 0 ? 0 : 255]);
    const map = make(40, 30, (x, y) => [
      128 + Math.round(Math.sin(y / 3) * 20),
      128 + Math.round(Math.cos(x / 4) * 20),
      128,
      255,
    ]);
    const out = displaceImage(src, map, 6);
    expect(out.data).toHaveLength(src.data.length);
    expect(out.width).toBe(40);
    expect(out.height).toBe(30);
    // Mittelwert des Alpha bleibt in der Größenordnung des Originals
    const mean = (b: PixelBuffer): number => {
      let sum = 0;
      for (let i = 3; i < b.data.length; i += 4) sum += b.data[i] ?? 0;
      return sum / (b.data.length / 4);
    };
    expect(Math.abs(mean(out) - mean(src))).toBeLessThan(25);
  });
});

describe("gaussKernel3", () => {
  it("summiert zu 1 und hat bei σ = 0,5 die Mitte bei etwa 0,62", () => {
    const k = gaussKernel3(0.5);
    expect(k.center + 4 * k.edge + 4 * k.corner).toBeCloseTo(1, 12);
    expect(k.center).toBeCloseTo(0.619, 3);
    expect(k.edge).toBeCloseTo(0.0838, 3);
    expect(k.corner).toBeCloseTo(0.0113, 3);
  });
});

describe("softenAlphaEdges", () => {
  const block = (): PixelBuffer =>
    make(9, 9, (x, y) => (x >= 2 && x <= 6 && y >= 2 && y <= 6 ? [220, 40, 40, 255] : [0, 0, 0, 0]));

  it("lässt Flächen mit gleichem Alpha bit-genau unverändert (Inneres, Hintergrund)", () => {
    const out = softenAlphaEdges(block());
    expect(px(out, 4, 4)).toEqual([220, 40, 40, 255]);
    expect(px(out, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(px(out, 8, 8)).toEqual([0, 0, 0, 0]);
  });

  it("weicht die Kante auf: innen etwas weniger, außen etwas mehr Alpha, Farbe unverändert", () => {
    const out = softenAlphaEdges(block());
    const k = gaussKernel3(0.5);
    // mitten an der linken Kante: Pixel innen (x = 2) hat 3 Nachbarn außen (zwei Ecken, eine Kante)
    const inside = px(out, 2, 4);
    expect(inside[3]).toBeCloseTo(255 * (1 - (2 * k.corner + k.edge)), 0);
    expectNear([inside[0], inside[1], inside[2]], [220, 40, 40]);
    // Pixel außen (x = 1) bekommt dieselbe Menge Alpha
    const outside = px(out, 1, 4);
    expect(outside[3]).toBeCloseTo(255 * (2 * k.corner + k.edge), 0);
    expectNear([outside[0], outside[1], outside[2]], [220, 40, 40]); // keine dunkle Randfarbe
    // eine Ecke verliert mehr als eine gerade Kante
    expect(px(out, 2, 2)[3]).toBeLessThan(inside[3]);
  });

  it("wirkt nur auf den Rand und lässt Farbdetails im deckenden Inneren unberührt", () => {
    const detailed = make(9, 9, (x, y) =>
      x >= 2 && x <= 6 && y >= 2 && y <= 6 ? [x * 30, y * 30, (x + y) * 10, 255] : [0, 0, 0, 0],
    );
    const out = softenAlphaEdges(detailed);
    for (let y = 3; y <= 5; y++) {
      for (let x = 3; x <= 5; x++) expect(px(out, x, y)).toEqual(px(detailed, x, y));
    }
  });

  it("wiederholt den Bildrand: ein vollflächiges Motiv wird am Rand nicht ausgeblendet", () => {
    const full = make(5, 5, () => [10, 20, 30, 255]);
    expect(Array.from(softenAlphaEdges(full).data)).toEqual(Array.from(full.data));
  });

  it("ändert nichts bei σ = 0 und gibt immer einen neuen Puffer zurück", () => {
    const src = block();
    const out = softenAlphaEdges(src, 0);
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
    expect(out.data).not.toBe(src.data);
  });
});

/** Unoptimierte Vergleichsrechnung (Definition aus ARCHITEKTUR 5.4), um die schnellen Pfade abzusichern. */
function referenceDisplace(src: PixelBuffer, map: PixelBuffer, strengthPx: number): PixelBuffer {
  const { width, height } = src;
  const out = createPixelBuffer(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dx = displacementFromChannel(map.data[i] ?? 128, strengthPx);
      const dy = displacementFromChannel(map.data[i + 1] ?? 128, strengthPx);
      const sx = x - dx;
      const sy = y - dy;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      let a = 0;
      const c = [0, 0, 0];
      for (const [ox, oy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const xi = x0 + ox;
        const yi = y0 + oy;
        if (xi < 0 || yi < 0 || xi >= width || yi >= height) continue;
        const w = (ox ? sx - x0 : 1 - (sx - x0)) * (oy ? sy - y0 : 1 - (sy - y0));
        const j = (yi * width + xi) * 4;
        const wa = w * (src.data[j + 3] ?? 0);
        a += wa;
        for (let k = 0; k < 3; k++) c[k] = (c[k] ?? 0) + wa * (src.data[j + k] ?? 0);
      }
      if (a > 0) out.data.set([(c[0] ?? 0) / a, (c[1] ?? 0) / a, (c[2] ?? 0) / a, a], i);
    }
  }
  return out;
}

describe("Abgleich mit der unoptimierten Rechnung", () => {
  const src = make(37, 29, (x, y) => [
    (x * 13) % 256,
    (y * 29) % 256,
    (x * y) % 256,
    (x + 2 * y) % 5 === 0 ? 0 : 255 - ((x * y) % 90),
  ]);
  const map = make(37, 29, (x, y) => [100 + ((x * 7 + y * 3) % 60), 90 + ((x * 5 + y * 11) % 80), 128, 255]);

  it("liefert für Innen- und Randpixel dasselbe Ergebnis wie die Definition (ohne Glättung)", () => {
    for (const strength of [0.7, 4, 9.3]) {
      const fast = displaceImage(src, map, strength, { edgeSigma: 0 });
      const reference = referenceDisplace(src, map, strength);
      let maxDiff = 0;
      for (let i = 0; i < fast.data.length; i++)
        maxDiff = Math.max(maxDiff, Math.abs((fast.data[i] ?? 0) - (reference.data[i] ?? 0)));
      expect(maxDiff, `Stärke ${strength}`).toBeLessThanOrEqual(1);
    }
  });

  it("glättet Innen- und Randpixel gleich (schneller Pfad gegen allgemeinen Pfad)", () => {
    // Referenz: Rand-Pfad für alle Pixel, erzwungen über 3×3-Ausschnitte, die nie im Inneren liegen
    const soft = softenAlphaEdges(src, 0.5);
    const padded = make(src.width + 2, src.height + 2, (x, y) => {
      const sx = Math.min(src.width - 1, Math.max(0, x - 1));
      const sy = Math.min(src.height - 1, Math.max(0, y - 1));
      const i = (sy * src.width + sx) * 4;
      return [src.data[i] ?? 0, src.data[i + 1] ?? 0, src.data[i + 2] ?? 0, src.data[i + 3] ?? 0];
    });
    const softPadded = softenAlphaEdges(padded, 0.5);
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        expect(px(soft, x, y), `${x},${y}`).toEqual(px(softPadded, x + 1, y + 1));
      }
    }
  });
});

describe("Eingabeprüfung", () => {
  it("wirft invalid-input bei unterschiedlichen Größen, falscher Datenlänge und unendlicher Stärke", () => {
    const a = distinct(4, 4);
    const b = distinct(4, 5);
    const broken: PixelBuffer = { data: new Uint8ClampedArray(10), width: 4, height: 4 };
    const check = (fn: () => unknown): void => {
      try {
        fn();
      } catch (error) {
        expect(error).toBeInstanceOf(MockupEngineError);
        expect((error as MockupEngineError).code).toBe("invalid-input");
        return;
      }
      throw new Error("expected an error");
    };
    check(() => displaceImage(a, b, 1));
    check(() => displaceImage(broken, a, 1));
    check(() => displaceImage(a, broken, 1));
    check(() => displaceImage(a, a, Number.POSITIVE_INFINITY));
    check(() => softenAlphaEdges(broken));
  });
});
