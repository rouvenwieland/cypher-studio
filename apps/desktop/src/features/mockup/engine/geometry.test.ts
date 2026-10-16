import { describe, expect, it } from "vitest";
import type { Point, Quad } from "@contract";
import {
  applyMatrix,
  designMatrix,
  designRectMm,
  fitMatrix,
  identityMatrix,
  matrixScale,
  mmToTemplateMatrix,
  mmToTemplatePx,
  motifRegion,
  multiplyMatrix,
  parallelogramDeviationPx,
  placementMatrix,
  quadFrame,
  scaleMatrix,
  transformedBounds,
  translateMatrix,
} from "./geometry";
import { MockupEngineError } from "./errors";

const PRINT_AREA = { width: 330, height: 450 };

/** Achsenparalleles Quad, 1,5 Pixel je mm. */
const STRAIGHT_QUAD: Quad = [
  { x: 300, y: 400 },
  { x: 795, y: 400 },
  { x: 795, y: 1075 },
  { x: 300, y: 1075 },
];

/** Parallelogramm mit Schieflage: 100 × 100 mm bei 2 px/mm, die linke Kante neigt sich um ca. 11,5° nach rechts. */
function skewedQuad(): { quad: Quad; area: { width: number; height: number } } {
  const ey = { x: 0.2, y: Math.sqrt(1 - 0.04) };
  const tl = { x: 100, y: 100 };
  const tr = { x: 300, y: 100 };
  const bl = { x: tl.x + ey.x * 200, y: tl.y + ey.y * 200 };
  const br = { x: tr.x + ey.x * 200, y: tr.y + ey.y * 200 };
  return { quad: [tl, tr, br, bl], area: { width: 100, height: 100 } };
}

function expectPoint(actual: Point, expected: Point, digits = 6): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

function expectEngineError(fn: () => unknown, code: MockupEngineError["code"]): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MockupEngineError);
    expect((error as MockupEngineError).code).toBe(code);
    return;
  }
  throw new Error("expected an error");
}

describe("quadFrame", () => {
  it("liest Ursprung, Achsen und Pixel je mm aus einem geraden Quad", () => {
    const frame = quadFrame(STRAIGHT_QUAD, PRINT_AREA);
    expectPoint(frame.origin, { x: 300, y: 400 });
    expectPoint(frame.ex, { x: 1, y: 0 });
    expectPoint(frame.ey, { x: 0, y: 1 });
    expect(frame.pxPerMm).toBeCloseTo(1.5, 10);
    expect(frame.widthPx).toBeCloseTo(495, 10);
    expect(frame.heightPx).toBeCloseTo(675, 10);
    expect(frame.skewDeg).toBeCloseTo(0, 8);
    expect(frame.aspectDeviation).toBeCloseTo(0, 8);
  });

  it("meldet die Abweichung des Seitenverhältnisses (Platzhalter-Shirt 480 × 750 zu 330 × 450)", () => {
    const quad: Quad = [
      { x: 360, y: 430 },
      { x: 840, y: 430 },
      { x: 840, y: 1180 },
      { x: 360, y: 1180 },
    ];
    const frame = quadFrame(quad, PRINT_AREA);
    expect(frame.pxPerMm).toBeCloseTo(480 / 330, 10);
    expect(frame.aspectDeviation).toBeCloseTo(1 - 0.64 / (330 / 450), 6);
  });

  it("erkennt die Schieflage eines Parallelogramms", () => {
    const { quad, area } = skewedQuad();
    const frame = quadFrame(quad, area);
    expect(frame.pxPerMm).toBeCloseTo(2, 10);
    expect(frame.skewDeg).toBeCloseTo(90 - (Math.acos(0.2) * 180) / Math.PI, 6);
    expect(frame.skewDeg).toBeGreaterThan(11);
    expectPoint(frame.ey, { x: 0.2, y: Math.sqrt(0.96) });
  });

  it("bildet die vier Ecken der Druckfläche auf die Ecken des schiefen Quads ab", () => {
    const { quad, area } = skewedQuad();
    const frame = quadFrame(quad, area);
    const [tl, tr, br, bl] = quad;
    expectPoint(mmToTemplatePx(frame, { x: 0, y: 0 }), tl);
    expectPoint(mmToTemplatePx(frame, { x: area.width, y: 0 }), tr);
    expectPoint(mmToTemplatePx(frame, { x: area.width, y: area.height }), br);
    expectPoint(mmToTemplatePx(frame, { x: 0, y: area.height }), bl);
  });

  it("liefert dieselbe Abbildung als Matrix", () => {
    const { quad, area } = skewedQuad();
    const frame = quadFrame(quad, area);
    const m = mmToTemplateMatrix(frame);
    expectPoint(applyMatrix(m, { x: 50, y: 25 }), mmToTemplatePx(frame, { x: 50, y: 25 }));
    expect(m.c).toBeGreaterThan(0); // Höhenachse neigt sich nach rechts
  });

  it("wirft bei entarteten, gespiegelten oder ungültigen Quads", () => {
    const [tl, tr, br, bl] = STRAIGHT_QUAD;
    expectEngineError(() => quadFrame([tl, tl, br, bl], PRINT_AREA), "invalid-quad"); // Breite 0
    expectEngineError(() => quadFrame([tl, tr, br, tl], PRINT_AREA), "invalid-quad"); // Höhe 0
    expectEngineError(
      () =>
        quadFrame(
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
            { x: 5, y: 0 },
          ],
          PRINT_AREA,
        ),
      "invalid-quad",
    ); // alle auf einer Linie
    expectEngineError(() => quadFrame([tr, tl, bl, br], PRINT_AREA), "invalid-quad"); // links/rechts vertauscht (gespiegelt)
    expectEngineError(() => quadFrame([{ x: Number.NaN, y: 0 }, tr, br, bl], PRINT_AREA), "invalid-quad");
    expectEngineError(() => quadFrame(STRAIGHT_QUAD, { width: 0, height: 450 }), "invalid-input");
    expectEngineError(
      () => quadFrame(STRAIGHT_QUAD, { width: 330, height: Number.POSITIVE_INFINITY }),
      "invalid-input",
    );
  });
});

describe("parallelogramDeviationPx", () => {
  it("ist 0 bei einem exakten Parallelogramm und misst die Abweichung der vierten Ecke", () => {
    expect(parallelogramDeviationPx(STRAIGHT_QUAD)).toBe(0);
    expect(parallelogramDeviationPx(skewedQuad().quad)).toBeCloseTo(0, 8);
    const [tl, tr, br, bl] = STRAIGHT_QUAD;
    expect(parallelogramDeviationPx([tl, tr, { x: br.x + 3, y: br.y + 4 }, bl])).toBeCloseTo(5, 10);
  });
});

describe("designRectMm", () => {
  const design = { width: 1100, height: 1224 };

  it("setzt das Motiv bei offsetCenter 0 mittig und leitet die Höhe aus dem Seitenverhältnis ab", () => {
    const rect = designRectMm(PRINT_AREA, { widthMm: 220, offsetTopMm: 40, offsetCenterMm: 0 }, design);
    expect(rect.x).toBeCloseTo(55, 10);
    expect(rect.y).toBe(40);
    expect(rect.width).toBe(220);
    expect(rect.height).toBeCloseTo((220 * 1224) / 1100, 10);
  });

  it("verschiebt nach links (negativ) und rechts (positiv)", () => {
    const left = designRectMm(PRINT_AREA, { widthMm: 220, offsetTopMm: 0, offsetCenterMm: -20 }, design);
    const right = designRectMm(PRINT_AREA, { widthMm: 220, offsetTopMm: 0, offsetCenterMm: 20 }, design);
    expect(left.x).toBeCloseTo(35, 10);
    expect(right.x).toBeCloseTo(75, 10);
  });

  it("wirft bei ungültiger Breite, Versatz oder Motivgröße", () => {
    const ok = { widthMm: 100, offsetTopMm: 0, offsetCenterMm: 0 };
    expectEngineError(() => designRectMm(PRINT_AREA, { ...ok, widthMm: 0 }, design), "invalid-input");
    expectEngineError(() => designRectMm(PRINT_AREA, { ...ok, widthMm: -5 }, design), "invalid-input");
    expectEngineError(() => designRectMm(PRINT_AREA, { ...ok, offsetTopMm: Number.NaN }, design), "invalid-input");
    expectEngineError(() => designRectMm(PRINT_AREA, ok, { width: 0, height: 10 }), "invalid-input");
  });
});

describe("designMatrix und placementMatrix", () => {
  const design = { width: 1100, height: 1224 };
  const placement = { widthMm: 220, offsetTopMm: 40, offsetCenterMm: 0 };

  it("bildet das Motiv im geraden Quad auf die erwarteten Pixel ab (Seitenverhältnis bleibt erhalten)", () => {
    const m = placementMatrix(STRAIGHT_QUAD, PRINT_AREA, placement, design);
    expect(m.a).toBeCloseTo(0.3, 10);
    expect(m.d).toBeCloseTo(0.3, 10);
    expect(m.b).toBe(0);
    expect(m.c).toBe(0);
    expectPoint(applyMatrix(m, { x: 0, y: 0 }), { x: 300 + 1.5 * 55, y: 400 + 1.5 * 40 });
    expectPoint(applyMatrix(m, { x: 1100, y: 1224 }), { x: 300 + 1.5 * 275, y: 400 + 1.5 * (40 + 244.8) });
  });

  it("folgt bei Schieflage den schiefen Achsen: Motivecken liegen auf den Ecken des Teilparallelogramms", () => {
    const { quad, area } = skewedQuad();
    const frame = quadFrame(quad, area);
    const p = { widthMm: 50, offsetTopMm: 10, offsetCenterMm: -10 };
    const size = { width: 400, height: 200 };
    const m = placementMatrix(quad, area, p, size);
    const rect = designRectMm(area, p, size);
    expectPoint(applyMatrix(m, { x: 0, y: 0 }), mmToTemplatePx(frame, { x: rect.x, y: rect.y }));
    expectPoint(applyMatrix(m, { x: size.width, y: 0 }), mmToTemplatePx(frame, { x: rect.x + rect.width, y: rect.y }));
    expectPoint(
      applyMatrix(m, { x: 0, y: size.height }),
      mmToTemplatePx(frame, { x: rect.x, y: rect.y + rect.height }),
    );
    expectPoint(
      applyMatrix(m, { x: size.width, y: size.height }),
      mmToTemplatePx(frame, { x: rect.x + rect.width, y: rect.y + rect.height }),
    );
    // Scherung steckt in c: die Motivhöhe läuft entlang der geneigten Achse
    expect(m.c).toBeGreaterThan(0);
    expect(m.b).toBe(0);
    // gleiche Pixelgröße je Motivpixel in beiden Achsen: Motiv wird nicht verzerrt
    expect(Math.hypot(m.a, m.b)).toBeCloseTo(Math.hypot(m.c, m.d), 8);
  });

  it("setzt designMatrix aus mm-Matrix und Motivrechteck zusammen", () => {
    const frame = quadFrame(STRAIGHT_QUAD, PRINT_AREA);
    const rect = designRectMm(PRINT_AREA, placement, design);
    expect(designMatrix(mmToTemplateMatrix(frame), rect, design)).toEqual(
      placementMatrix(STRAIGHT_QUAD, PRINT_AREA, placement, design),
    );
  });
});

describe("Matrixhilfen", () => {
  it("multipliziert in der Reihenfolge außen ∘ innen", () => {
    const m = multiplyMatrix(translateMatrix(10, 20), scaleMatrix(2));
    expect(applyMatrix(m, { x: 3, y: 4 })).toEqual({ x: 16, y: 28 }); // erst skalieren, dann verschieben
    expect(multiplyMatrix(identityMatrix(), m)).toEqual(m);
    expect(multiplyMatrix(m, identityMatrix())).toEqual(m);
  });

  it("normalisiert -0 zu 0", () => {
    const m = multiplyMatrix(scaleMatrix(1), translateMatrix(-0, -0));
    expect(Object.is(m.e, 0)).toBe(true);
    expect(Object.is(m.f, 0)).toBe(true);
  });

  it("gibt den Längenmaßstab zurück", () => {
    expect(matrixScale(scaleMatrix(0.5))).toBeCloseTo(0.5, 12);
    expect(matrixScale(multiplyMatrix(translateMatrix(5, 5), scaleMatrix(3)))).toBeCloseTo(3, 12);
  });
});

describe("fitMatrix", () => {
  it("skaliert gleichmäßig bei gleichem Seitenverhältnis", () => {
    expect(fitMatrix({ width: 1200, height: 1500 }, { width: 600, height: 750 })).toEqual({
      a: 0.5,
      b: 0,
      c: 0,
      d: 0.5,
      e: 0,
      f: 0,
    });
  });

  it("zentriert bei abweichendem Seitenverhältnis", () => {
    const m = fitMatrix({ width: 1200, height: 1500 }, { width: 1000, height: 1000 });
    expect(m.a).toBeCloseTo(1000 / 1500, 12);
    expect(m.e).toBeCloseTo((1000 - 1200 * (1000 / 1500)) / 2, 10);
    expect(m.f).toBe(0);
  });

  it("wirft bei leeren Größen", () => {
    expectEngineError(() => fitMatrix({ width: 0, height: 10 }, { width: 5, height: 5 }), "invalid-input");
  });
});

describe("transformedBounds und motifRegion", () => {
  it("umschließt auch ein gescheertes Motiv", () => {
    const m = { a: 1, b: 0, c: 0.5, d: 1, e: 10, f: 20 };
    const b = transformedBounds(m, { width: 100, height: 40 });
    expect(b).toEqual({ x: 10, y: 20, width: 120, height: 40 });
  });

  it("rundet nach außen, fügt den Rand hinzu und beschneidet an der Leinwand", () => {
    const m = translateMatrix(10.4, 20.6);
    const region = motifRegion(m, { width: 100, height: 50 }, 3, { width: 200, height: 70 });
    // x: 10,4 − 3 = 7,4 → 7 bis 110,4 + 3 = 113,4 → 114; y: 17,6 → 17 bis min(70, 73,6)
    expect(region).toEqual({ x: 7, y: 17, width: 107, height: 53 });
  });

  it("liefert null, wenn das Motiv außerhalb der Leinwand liegt", () => {
    expect(
      motifRegion(translateMatrix(500, 500), { width: 10, height: 10 }, 2, { width: 100, height: 100 }),
    ).toBeNull();
    expect(motifRegion(translateMatrix(-50, 0), { width: 10, height: 10 }, 2, { width: 100, height: 100 })).toBeNull();
  });
});
