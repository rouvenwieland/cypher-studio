/**
 * Geometrie der Mockup-Engine: reine Funktionen ohne DOM.
 *
 * Koordinaten der Druckfläche: Ursprung oben links, x nach rechts, y nach unten, Einheit mm.
 * Das Quad der Vorlage (oben links, oben rechts, unten rechts, unten links) ist ein Parallelogramm;
 * `unten rechts` wird für die Abbildung nicht gebraucht (ergibt sich aus den anderen drei Ecken).
 */
import type { Point, Quad, Rect, Size } from "@contract";
import { MockupEngineError } from "./errors";

/** Affine Matrix wie bei `CanvasRenderingContext2D.setTransform(a, b, c, d, e, f)`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Matrix2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** Lage des Motivs auf der Druckfläche (wie Shirtigo). */
export interface Placement {
  widthMm: number;
  /** Abstand von der Oberkante der Druckfläche zur Oberkante des Motivs. */
  offsetTopMm: number;
  /** 0 = mittig, negativ = nach links, positiv = nach rechts (Abstand der Motivmitte zur Mitte der Druckfläche). */
  offsetCenterMm: number;
}

/** Ganzzahliger Ausschnitt in Pixeln. */
export type PixelRect = Rect;

/** Mindestwert für den Sinus des Winkels zwischen Breiten- und Höhenachse (ca. 3°), darunter ist das Quad entartet. */
const MIN_AXIS_SINE = 0.05;

/** `-0` zu `0` normalisieren (stabile JSON-Rundreise und Vergleiche). */
function clean(value: number): number {
  return value === 0 ? 0 : value;
}

export function identityMatrix(): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/** `outer ∘ inner`: erst `inner`, dann `outer` anwenden. */
export function multiplyMatrix(outer: Matrix2D, inner: Matrix2D): Matrix2D {
  return {
    a: clean(outer.a * inner.a + outer.c * inner.b),
    b: clean(outer.b * inner.a + outer.d * inner.b),
    c: clean(outer.a * inner.c + outer.c * inner.d),
    d: clean(outer.b * inner.c + outer.d * inner.d),
    e: clean(outer.a * inner.e + outer.c * inner.f + outer.e),
    f: clean(outer.b * inner.e + outer.d * inner.f + outer.f),
  };
}

export function translateMatrix(x: number, y: number): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, e: clean(x), f: clean(y) };
}

export function scaleMatrix(sx: number, sy: number = sx): Matrix2D {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

export function applyMatrix(m: Matrix2D, p: Point): Point {
  return { x: clean(m.a * p.x + m.c * p.y + m.e), y: clean(m.b * p.x + m.d * p.y + m.f) };
}

/** Mittlerer Längenmaßstab der Matrix (Wurzel aus dem Betrag der Determinante). */
export function matrixScale(m: Matrix2D): number {
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
}

function assertPositiveSize(size: Size, name: string): void {
  if (!(Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0)) {
    throw new MockupEngineError("invalid-input", `${name} must have finite positive width and height`);
  }
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Koordinatensystem der Druckfläche im Bild der Vorlage. */
export interface QuadFrame {
  /** Oben links der Druckfläche in Pixeln der Vorlage. */
  origin: Point;
  /** Einheitsvektor entlang der Breite (oben links → oben rechts). */
  ex: Point;
  /** Einheitsvektor entlang der Höhe (oben links → unten links); bei Schieflage nicht senkrecht zu `ex`. */
  ey: Point;
  /** Pixel je mm, aus Quad-Breite / Breite der Druckfläche; gilt in beiden Achsen, damit das Motiv nie verzerrt wird. */
  pxPerMm: number;
  /** Länge der oberen Quad-Kante in Pixeln. */
  widthPx: number;
  /** Länge der linken Quad-Kante in Pixeln. */
  heightPx: number;
  /** Abweichung vom rechten Winkel zwischen den Achsen in Grad (0 = rechtwinklig). */
  skewDeg: number;
  /** Relative Abweichung des Quad-Seitenverhältnisses von dem der Druckfläche (0 = passt exakt). */
  aspectDeviation: number;
}

/**
 * Baut das Koordinatensystem der Druckfläche aus dem Quad.
 * Wirft `invalid-quad` bei nicht endlichen Ecken, Länge 0, entarteter oder gespiegelter Anordnung.
 */
export function quadFrame(quad: Quad, printAreaMm: Size): QuadFrame {
  assertPositiveSize(printAreaMm, "printAreaMm");
  const [tl, tr, br, bl] = quad;
  if (![tl, tr, br, bl].every(isFinitePoint)) {
    throw new MockupEngineError("invalid-quad", "Quad corners must be finite numbers");
  }
  const ux = tr.x - tl.x;
  const uy = tr.y - tl.y;
  const vx = bl.x - tl.x;
  const vy = bl.y - tl.y;
  const widthPx = Math.hypot(ux, uy);
  const heightPx = Math.hypot(vx, vy);
  if (!(widthPx > 0) || !(heightPx > 0)) {
    throw new MockupEngineError("invalid-quad", "Quad edges must have a length greater than zero");
  }
  const ex = { x: ux / widthPx, y: uy / widthPx };
  const ey = { x: vx / heightPx, y: vy / heightPx };
  // Kreuzprodukt > 0: Achsen laufen im Bild (y nach unten) im Uhrzeigersinn, also nicht gespiegelt.
  const sine = ex.x * ey.y - ex.y * ey.x;
  if (sine < MIN_AXIS_SINE) {
    throw new MockupEngineError(
      "invalid-quad",
      "Quad is degenerate or mirrored (expected order: top left, top right, bottom right, bottom left)",
    );
  }
  const cosine = Math.max(-1, Math.min(1, ex.x * ey.x + ex.y * ey.y));
  const angleDeg = (Math.acos(cosine) * 180) / Math.PI;
  const quadAspect = widthPx / heightPx;
  const printAspect = printAreaMm.width / printAreaMm.height;
  return {
    origin: { x: tl.x, y: tl.y },
    ex,
    ey,
    pxPerMm: widthPx / printAreaMm.width,
    widthPx,
    heightPx,
    skewDeg: Math.abs(90 - angleDeg),
    aspectDeviation: Math.abs(quadAspect / printAspect - 1),
  };
}

/** Abstand der Ecke unten rechts von der Position, die ein exaktes Parallelogramm hätte (Pixel). */
export function parallelogramDeviationPx(quad: Quad): number {
  const [tl, tr, br, bl] = quad;
  const ideal = { x: tr.x + bl.x - tl.x, y: tr.y + bl.y - tl.y };
  return Math.hypot(br.x - ideal.x, br.y - ideal.y);
}

/** Matrix mm (Druckfläche, Ursprung oben links) → Pixel der Vorlage. */
export function mmToTemplateMatrix(frame: QuadFrame): Matrix2D {
  const s = frame.pxPerMm;
  return {
    a: clean(frame.ex.x * s),
    b: clean(frame.ex.y * s),
    c: clean(frame.ey.x * s),
    d: clean(frame.ey.y * s),
    e: clean(frame.origin.x),
    f: clean(frame.origin.y),
  };
}

/** Punkt der Druckfläche (mm) → Pixel der Vorlage. */
export function mmToTemplatePx(frame: QuadFrame, mm: Point): Point {
  return applyMatrix(mmToTemplateMatrix(frame), mm);
}

/**
 * Rechteck des Motivs auf der Druckfläche in mm (Ursprung oben links der Druckfläche).
 * Höhe aus dem Seitenverhältnis des Motivs (`designSize` in Pixeln).
 */
export function designRectMm(printAreaMm: Size, placement: Placement, designSize: Size): Rect {
  assertPositiveSize(printAreaMm, "printAreaMm");
  assertPositiveSize(designSize, "designSize");
  if (!(Number.isFinite(placement.widthMm) && placement.widthMm > 0)) {
    throw new MockupEngineError("invalid-input", "placement.widthMm must be a finite number greater than zero");
  }
  if (!(Number.isFinite(placement.offsetTopMm) && Number.isFinite(placement.offsetCenterMm))) {
    throw new MockupEngineError("invalid-input", "placement offsets must be finite numbers");
  }
  const height = (placement.widthMm * designSize.height) / designSize.width;
  return {
    x: printAreaMm.width / 2 + placement.offsetCenterMm - placement.widthMm / 2,
    y: placement.offsetTopMm,
    width: placement.widthMm,
    height,
  };
}

/**
 * Matrix Motivpixel → Zielpixel für `setTransform`.
 * `mmMatrix` bildet mm der Druckfläche auf Zielpixel ab (Vorlage oder Ausgabe); das Seitenverhältnis des Motivs bleibt erhalten.
 */
export function designMatrix(mmMatrix: Matrix2D, rectMm: Rect, designSize: Size): Matrix2D {
  assertPositiveSize(designSize, "designSize");
  const toMm = multiplyMatrix(
    translateMatrix(rectMm.x, rectMm.y),
    scaleMatrix(rectMm.width / designSize.width, rectMm.height / designSize.height),
  );
  return multiplyMatrix(mmMatrix, toMm);
}

/** Komplette Abbildung Motivpixel → Pixel der Vorlage aus Quad, Druckfläche und Lage. */
export function placementMatrix(quad: Quad, printAreaMm: Size, placement: Placement, designSize: Size): Matrix2D {
  const frame = quadFrame(quad, printAreaMm);
  return designMatrix(mmToTemplateMatrix(frame), designRectMm(printAreaMm, placement, designSize), designSize);
}

/** Umschließendes Rechteck des transformierten Rechtecks `(0, 0, size.width, size.height)`. */
export function transformedBounds(m: Matrix2D, size: Size): Rect {
  const corners = [
    applyMatrix(m, { x: 0, y: 0 }),
    applyMatrix(m, { x: size.width, y: 0 }),
    applyMatrix(m, { x: size.width, y: size.height }),
    applyMatrix(m, { x: 0, y: size.height }),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/**
 * Ganzzahliger Ausschnitt der Leinwand, den ein transformiertes Motiv samt Rand (`marginPx`) belegt.
 * `null`, wenn nichts davon auf der Leinwand liegt.
 */
export function motifRegion(m: Matrix2D, designSize: Size, marginPx: number, canvas: Size): PixelRect | null {
  const bounds = transformedBounds(m, designSize);
  const x0 = Math.max(0, Math.floor(bounds.x - marginPx));
  const y0 = Math.max(0, Math.floor(bounds.y - marginPx));
  const x1 = Math.min(canvas.width, Math.ceil(bounds.x + bounds.width + marginPx));
  const y1 = Math.min(canvas.height, Math.ceil(bounds.y + bounds.height + marginPx));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Einpassen von `source` in `target` (größtmöglich, zentriert, Seitenverhältnis bleibt): Matrix Quellpixel → Zielpixel. */
export function fitMatrix(source: Size, target: Size): Matrix2D {
  assertPositiveSize(source, "source");
  assertPositiveSize(target, "target");
  const k = Math.min(target.width / source.width, target.height / source.height);
  return {
    a: k,
    b: 0,
    c: 0,
    d: k,
    e: clean((target.width - source.width * k) / 2),
    f: clean((target.height - source.height * k) / 2),
  };
}
