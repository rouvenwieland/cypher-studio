/**
 * Reine Rechteck-Geometrie der Social-Engine.
 * Alle Werte sind Pixel der Vorlage (Ursprung oben links, y wächst nach unten).
 */
import type { Rect } from "@contract";

/** Toleranz gegen Gleitkomma-Rauschen: Maße unterhalb davon gelten als „null“. */
export const EPS = 1e-6;

export function rectRight(rect: Rect): number {
  return rect.x + rect.width;
}

export function rectBottom(rect: Rect): number {
  return rect.y + rect.height;
}

/** Schnittfläche zweier Rechtecke; `null`, wenn sie sich nur berühren oder nicht treffen (Fläche muss > 0 sein). */
export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(rectRight(a), rectRight(b));
  const y1 = Math.min(rectBottom(a), rectBottom(b));
  if (x1 - x0 <= EPS || y1 - y0 <= EPS) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return intersectRect(a, b) !== null;
}

/** Kleinstes Rechteck, das beide umschließt. */
export function unionRect(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(rectRight(a), rectRight(b));
  const y1 = Math.max(rectBottom(a), rectBottom(b));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Liegt `inner` vollständig in `outer` (mit Toleranz)? */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    rectRight(inner) <= rectRight(outer) + EPS &&
    rectBottom(inner) <= rectBottom(outer) + EPS
  );
}

export function hasArea(rect: Rect): boolean {
  return rect.width > EPS && rect.height > EPS;
}
