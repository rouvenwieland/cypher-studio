/**
 * Bild in ein Rechteck einpassen (Zuschnitt um den Fokuspunkt) und Auflösung prüfen.
 *
 * Festlegung zum Fokuspunkt: `SocialDocument.images[slot].focal` ist ein Punkt in BILDPIXELN der Originaldatei
 * (Ursprung oben links, 0 … Breite/Höhe des Bildes), nicht normiert. Er wird beim Zuschnitt auf das Bild begrenzt.
 * Die UI rechnet Klicks in der Vorschau mit `denormalizeFocal` um.
 */
import type { Point, Rect, Size } from "@contract";
import { clamp } from "@/lib/assert";
import { EPS, hasArea } from "./geometry";

export type ImageFit = "cover" | "contain";

export interface ImageCrop {
  /** Ausschnitt im Bild (Bildpixel). */
  src: Rect;
  /** Zielfläche auf der Leinwand (Vorlagenpixel). */
  dst: Rect;
  /** Zielpixel je Quellpixel (> 1 heißt vergrößert, also unscharf). */
  scale: number;
}

export interface ResolutionCheck {
  /** Quellpixel je Zielpixel; ≥ 1 ist scharf genug. */
  sourcePerTarget: number;
  /** Verfügbare Quellpixel entlang der Breite des Ausschnitts. */
  availablePx: number;
  /** Benötigte Pixel entlang der Zielbreite. */
  neededPx: number;
  sufficient: boolean;
}

/** Mitte des Bildes, Standard-Fokuspunkt. */
export function centerFocal(imageSize: Size): Point {
  return { x: imageSize.width / 2, y: imageSize.height / 2 };
}

/** Bildpixel → 0 … 1 je Achse (für Schieberegler und Klicks in der Vorschau). */
export function normalizeFocal(imageSize: Size, focal: Point): Point {
  return {
    x: imageSize.width > 0 ? clamp(focal.x / imageSize.width, 0, 1) : 0.5,
    y: imageSize.height > 0 ? clamp(focal.y / imageSize.height, 0, 1) : 0.5,
  };
}

/** 0 … 1 je Achse → Bildpixel. */
export function denormalizeFocal(imageSize: Size, normalized: Point): Point {
  return {
    x: clamp(normalized.x, 0, 1) * imageSize.width,
    y: clamp(normalized.y, 0, 1) * imageSize.height,
  };
}

/**
 * Berechnet Quell- und Zielrechteck für `drawImage`.
 * - `cover`: füllt `rect` ganz, der Ausschnitt ist um den Fokuspunkt zentriert und bleibt im Bild.
 * - `contain`: ganzes Bild, mittig in `rect`, ohne Beschnitt.
 * Gibt `null` zurück, wenn Bild oder Zielfläche keine Fläche haben.
 */
export function focalToCrop(imageSize: Size, rect: Rect, focal: Point, fit: ImageFit): ImageCrop | null {
  if (imageSize.width <= EPS || imageSize.height <= EPS || !hasArea(rect)) return null;

  if (fit === "contain") {
    const scale = Math.min(rect.width / imageSize.width, rect.height / imageSize.height);
    const width = imageSize.width * scale;
    const height = imageSize.height * scale;
    return {
      src: { x: 0, y: 0, width: imageSize.width, height: imageSize.height },
      dst: { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height },
      scale,
    };
  }

  const scale = Math.max(rect.width / imageSize.width, rect.height / imageSize.height);
  const width = rect.width / scale;
  const height = rect.height / scale;
  const fx = Number.isFinite(focal.x) ? focal.x : imageSize.width / 2;
  const fy = Number.isFinite(focal.y) ? focal.y : imageSize.height / 2;
  return {
    src: {
      x: clamp(fx - width / 2, 0, Math.max(0, imageSize.width - width)),
      y: clamp(fy - height / 2, 0, Math.max(0, imageSize.height - height)),
      width,
      height,
    },
    dst: { ...rect },
    scale,
  };
}

/** Prüft, ob der Ausschnitt mindestens so viele Quellpixel hat, wie die Zielfläche Pixel breit ist. */
export function checkResolution(crop: ImageCrop): ResolutionCheck {
  const sourcePerTarget = crop.src.width / crop.dst.width;
  return {
    sourcePerTarget,
    availablePx: Math.floor(crop.src.width + EPS),
    neededPx: Math.ceil(crop.dst.width - EPS),
    sufficient: sourcePerTarget >= 1 - EPS,
  };
}
