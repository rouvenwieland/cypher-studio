import type { Rect, Size } from "@contract";

/** Reine Geometrie der Druckvorschau: Millimeter ↔ Bildschirm, Lineale, Lage des Motivs. */

export interface Placement {
  widthMm: number;
  heightMm: number;
  /** linke Kante in mm ab linker Kante der Druckfläche */
  leftMm: number;
  /** obere Kante in mm ab oberer Kante der Druckfläche */
  topMm: number;
}

export function placeMotif(area: Size, plannedWidthMm: number, plannedHeightMm: number, offsetTopMm: number, offsetCenterMm: number): Placement {
  return {
    widthMm: plannedWidthMm,
    heightMm: plannedHeightMm,
    leftMm: (area.width - plannedWidthMm) / 2 + offsetCenterMm,
    topMm: offsetTopMm,
  };
}

/** Standard-Abstand oben: Hinweis des Profils, aber nie so, dass das Motiv aus der Fläche rutscht. */
export function defaultTopOffset(area: Size, motifHeightMm: number, hint: number | null): number {
  const max = Math.max(0, area.height - motifHeightMm);
  return Math.min(hint ?? 0, max);
}

/** Maßstab (px je mm), bei dem die Druckfläche samt Rand ganz in den Ausschnitt passt. */
export function fitScale(viewW: number, viewH: number, area: Size, padding: number): number {
  const w = Math.max(1, viewW - 2 * padding);
  const h = Math.max(1, viewH - 2 * padding);
  return Math.max(0.05, Math.min(w / area.width, h / area.height));
}

export interface Tick {
  mm: number;
  major: boolean;
  label: boolean;
}

/** Strich alle 10 mm, Zahl alle 50 mm; bei kleinem Maßstab nur die Zahlen-Striche. */
export function rulerTicks(lengthMm: number, scale: number): Tick[] {
  const ticks: Tick[] = [];
  const minor = scale >= 0.9;
  for (let mm = 0; mm <= lengthMm + 0.001; mm += 10) {
    const label = mm % 50 === 0;
    if (!minor && !label) continue;
    ticks.push({ mm, major: label, label });
  }
  return ticks;
}

/** Bildpixel-Rechteck (Datei) → Rechteck in mm der Druckfläche. `bounds` ist der zugeschnittene Bereich der Datei. */
export function regionToMm(region: Rect, bounds: Rect, placement: Placement): Rect {
  const sx = placement.widthMm / bounds.width;
  const sy = placement.heightMm / bounds.height;
  return {
    x: placement.leftMm + (region.x - bounds.x) * sx,
    y: placement.topMm + (region.y - bounds.y) * sy,
    width: region.width * sx,
    height: region.height * sy,
  };
}

/** Wertebereich: Zoom-Schritt am Mausrad. */
export function zoomBy(scale: number, deltaY: number, min: number, max: number): number {
  const next = scale * Math.pow(1.0018, -deltaY);
  return Math.min(max, Math.max(min, next));
}

/** Breite in Pixeln, bei der eine Datei 1:1 (100 %) erscheint: Bildpixel je mm der geplanten Breite. */
export function pxPerMmAt100(trimmedWidthPx: number, plannedWidthMm: number): number {
  return trimmedWidthPx / plannedWidthMm;
}

/** Echtgröße: Pixel je mm auf dem Bildschirm (kalibriert oder 96 dpi). */
export function pxPerMmActual(calibration: number | null): number {
  return calibration && calibration > 0 ? calibration : 96 / 25.4;
}

/** Zugeschnittene Höhe in mm aus dem Seitenverhältnis. */
export function heightFor(widthMm: number, trimmed: Size): number {
  return trimmed.width > 0 ? (widthMm * trimmed.height) / trimmed.width : 0;
}
