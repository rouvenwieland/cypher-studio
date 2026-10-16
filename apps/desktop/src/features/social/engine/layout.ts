/**
 * Layout-Engine: macht aus Vorlage und Dokument eine vollständig aufgelöste Zeichenliste samt Warnungen.
 * Reine Funktion; alles, was von der Umgebung abhängt (Textbreite, Bildgrößen, Adressen, Schriften),
 * kommt über `LayoutContext`. Warnungen sind Codes und Zahlen, die deutschen Sätze schreibt die UI.
 *
 * Koordinaten: Pixel der Vorlage (`template.size`), Ursprung oben links.
 */
import type { Fill, HexColor, Rect, Size, SocialDocument, SocialLayer, SocialTemplate } from "@contract";
import { assertNever, round } from "@/lib/assert";
import { AA_NORMAL, blendOver, fillColors, parseHexColor, worstContrast, type Rgb } from "./contrast";
import { centerFocal, checkResolution, focalToCrop, type ImageCrop, type ImageFit } from "./focal";
import type { FontSpec } from "./canvas-text";
import { EPS, rectContains, rectsIntersect, unionRect } from "./geometry";
import { unionOfZoneSides, zoneOverlaps, type ZoneSide } from "./guides";
import { fitText, type FitResult, type MeasureFn, type SocialTextLayer } from "./textfit";

/** Bezugsbreite der Mindestschrift (CONCEPT 6.6: kleinste Schrift ≥ 28 px bei 1080 px Breite). */
export const REFERENCE_WIDTH_PX = 1080;
export const MIN_TEXT_PX_AT_REFERENCE = 28;
/** Mindestkontrast Text/Grund (CONCEPT 6.6). */
export const MIN_TEXT_CONTRAST = AA_NORMAL;
/** Schlüssel in `colorOverrides` für die Hintergrundfarbe (nur wirksam bei Volltonhintergrund). */
export const BACKGROUND_LAYER_ID = "background";

export type LogoVariant = Extract<SocialLayer, { type: "logo" }>["variant"];

/** Alles, was die Engine von außen braucht. In Tests mit festen Werten, zur Laufzeit aus Canvas und Projekt. */
export interface LayoutContext {
  /** Messfunktion für eine Schrift (zur Laufzeit `canvasMeasure`, in Tests feste Zeichenbreite). */
  measureFor(font: FontSpec): MeasureFn;
  /** Projekt-Asset (`relPath` aus dem Dokument) → Adresse, unter der das Bild geladen wird. */
  assetUrl(relPath: string): string;
  /** Adresse des Markenlogos der Variante; `null`, wenn die Marke keines hat. */
  logoUrl(variant: LogoVariant): string | null;
  /** Pixelgröße des geladenen Bildes; `null`, solange es nicht geladen ist. */
  imageSize(url: string): Size | null;
  /** Ist die Schrift verfügbar? Fehlt die Funktion, gilt jede Schrift als vorhanden. */
  isFontAvailable?(family: string, weight: number): boolean;
}

export type PlacedFill =
  | { type: "solid"; color: HexColor }
  | { type: "linearGradient"; angleDeg: number; stops: { at: number; color: HexColor }[] }
  | { type: "image"; url: string; fit: ImageFit; crop: ImageCrop | null };

/** Eine Textzeile. `x` ist der Ankerpunkt je Ausrichtung (links, Mitte, rechts), `y` die Mitte der Zeile. */
export interface PlacedTextLine {
  text: string;
  x: number;
  y: number;
  /** Gemessene Breite in Pixeln. */
  width: number;
}

export interface PlacedImage {
  type: "image";
  id: string;
  slot: string;
  rect: Rect;
  fit: ImageFit;
  radiusPx: number;
  /** `null`: Slot ist leer. */
  url: string | null;
  /** `null`: kein Bild oder Bildgröße noch unbekannt. */
  crop: ImageCrop | null;
}

export interface PlacedText {
  type: "text";
  id: string;
  slot: string;
  rect: Rect;
  fontFamily: string;
  fontWeight: number;
  fontSizePx: number;
  letterSpacingEm: number;
  color: HexColor;
  align: SocialTextLayer["align"];
  valign: SocialTextLayer["valign"];
  lineHeightPx: number;
  /** Zeilen nach Schreibweise, Umbruch und Kürzung; gezeichnet mit `textBaseline = "middle"`. */
  lines: PlacedTextLine[];
  /** Umschließendes Rechteck aller Zeilenkästen; `null` bei leerem Text. */
  bounds: Rect | null;
  truncated: boolean;
  overflowsHeight: boolean;
}

export interface PlacedShape {
  type: "shape";
  id: string;
  rect: Rect;
  fill: PlacedFill;
  radiusPx: number;
  opacity: number;
}

export interface PlacedLogo {
  type: "logo";
  id: string;
  rect: Rect;
  variant: LogoVariant;
  url: string | null;
}

export interface PlacedGrain {
  type: "grain";
  id: string;
  opacity: number;
  seed: number;
}

export interface PlacedScanlines {
  type: "scanlines";
  id: string;
  opacity: number;
  spacingPx: number;
}

export type PlacedLayer = PlacedImage | PlacedText | PlacedShape | PlacedLogo | PlacedGrain | PlacedScanlines;

export type SocialWarning =
  | { kind: "textInZone"; layerId: string; side: ZoneSide; overlapPx: number }
  | { kind: "imageInZone"; layerId: string; side: ZoneSide; overlapPx: number }
  | { kind: "lowContrast"; layerId: string; ratio: number }
  | { kind: "smallText"; layerId: string; sizePx: number; minPx: number }
  | { kind: "lowResImage"; layerId: string; widthPx: number; neededPx: number }
  | { kind: "textTruncated"; layerId: string }
  | { kind: "missingRequiredImage"; slot: string }
  | { kind: "fontMissing"; family: string };

export interface SocialLayout {
  size: Size;
  background: PlacedFill;
  /** Genau eine Ebene je Vorlagenebene, gleiche Reihenfolge (unten zuerst). */
  layers: PlacedLayer[];
  warnings: SocialWarning[];
}

/** Mögliche Untergründe für die Kontrastprüfung: Foto (nicht prüfbar) oder Fläche mit Deckkraft. */
type BackdropEntry = { kind: "photo"; rect: Rect } | { kind: "shape"; rect: Rect; fill: Fill; opacity: number };

function withColorOverride(fill: Fill, color: HexColor | undefined): Fill {
  return color !== undefined && fill.type === "solid" ? { type: "solid", color } : fill;
}

function placeFill(fill: Fill, rect: Rect, ctx: LayoutContext): PlacedFill {
  switch (fill.type) {
    case "solid":
      return { type: "solid", color: fill.color };
    case "linearGradient":
      return { type: "linearGradient", angleDeg: fill.angleDeg, stops: fill.stops.map((stop) => ({ ...stop })) };
    case "image": {
      const size = ctx.imageSize(fill.url);
      const crop = size === null ? null : focalToCrop(size, rect, centerFocal(size), fill.fit);
      return { type: "image", url: fill.url, fit: fill.fit, crop };
    }
    default:
      return assertNever(fill, "Fill");
  }
}

/**
 * Mögliche Grundfarben unter `bounds`, von der obersten berührenden Ebene unterhalb von `upTo` abwärts.
 * Deckende Fläche über dem ganzen Text → ihre Farben; halbtransparent → gemischt mit dem, was darunter liegt;
 * nur teilweise unter dem Text → Farben beider Möglichkeiten (der ungünstigere Fall zählt). Foto → `null`.
 */
function backdropColors(
  entries: readonly (BackdropEntry | null)[],
  upTo: number,
  bounds: Rect,
  background: Fill,
): Rgb[] | null {
  for (let index = upTo - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === null || entry === undefined || !rectsIntersect(entry.rect, bounds)) continue;
    if (entry.kind === "photo") return null;
    const own = fillColors(entry.fill);
    if (own === null) return null;
    const covers = rectContains(entry.rect, bounds);
    const opaque = entry.opacity >= 1 - 1e-3;
    if (covers && opaque) return own;
    const below = backdropColors(entries, index, bounds, background);
    if (below === null) return null;
    const mixed = opaque ? own : own.flatMap((color) => below.map((under) => blendOver(color, under, entry.opacity)));
    return covers ? mixed : [...mixed, ...below];
  }
  return fillColors(background);
}

function floorTo2(value: number): number {
  return Math.floor(value * 100 + EPS) / 100;
}

function lineAnchorX(layer: SocialTextLayer): number {
  switch (layer.align) {
    case "left":
      return layer.rect.x;
    case "center":
      return layer.rect.x + layer.rect.width / 2;
    case "right":
      return layer.rect.x + layer.rect.width;
    default:
      return assertNever(layer.align, "align");
  }
}

function lineLeft(align: SocialTextLayer["align"], anchorX: number, width: number): number {
  switch (align) {
    case "left":
      return anchorX;
    case "center":
      return anchorX - width / 2;
    case "right":
      return anchorX - width;
    default:
      return assertNever(align, "align");
  }
}

function blockTop(layer: SocialTextLayer, blockHeight: number): number {
  switch (layer.valign) {
    case "top":
      return layer.rect.y;
    case "middle":
      return layer.rect.y + (layer.rect.height - blockHeight) / 2;
    case "bottom":
      return layer.rect.y + layer.rect.height - blockHeight;
    default:
      return assertNever(layer.valign, "valign");
  }
}

/** Positioniert die Zeilen im Rechteck und liefert dazu die Zeilenkästen (für Zonen- und Kontrastprüfung). */
function positionLines(
  layer: SocialTextLayer,
  fit: FitResult,
  measure: MeasureFn,
): { lines: PlacedTextLine[]; boxes: Rect[] } {
  const top = blockTop(layer, fit.lines.length * fit.lineHeightPx);
  const anchorX = lineAnchorX(layer);
  const lines: PlacedTextLine[] = [];
  const boxes: Rect[] = [];
  fit.lines.forEach((text, index) => {
    const width = measure(text, fit.fontSizePx);
    lines.push({ text, x: anchorX, y: top + (index + 0.5) * fit.lineHeightPx, width });
    boxes.push({
      x: lineLeft(layer.align, anchorX, width),
      y: top + index * fit.lineHeightPx,
      width,
      height: fit.lineHeightPx,
    });
  });
  return { lines, boxes };
}

function zoneWarnings(
  kind: "textInZone" | "imageInZone",
  layerId: string,
  rects: readonly Rect[],
  template: SocialTemplate,
): SocialWarning[] {
  const overlaps = rects.flatMap((rect) => zoneOverlaps(rect, template.safeZones, template.size));
  return unionOfZoneSides(overlaps).map((entry) => ({
    kind,
    layerId,
    side: entry.side,
    overlapPx: round(entry.overlapPx, 2),
  }));
}

/**
 * Berechnet das Layout. Reihenfolge der Warnungen: nach Ebene, innerhalb einer Textebene
 * fontMissing, textTruncated, smallText, lowContrast, textInZone.
 */
export function layoutSocial(template: SocialTemplate, doc: SocialDocument, ctx: LayoutContext): SocialLayout {
  const { size } = template;
  const canvasRect: Rect = { x: 0, y: 0, width: size.width, height: size.height };
  const background = withColorOverride(template.background, doc.colorOverrides[BACKGROUND_LAYER_ID]);
  const minTextPx = (MIN_TEXT_PX_AT_REFERENCE * size.width) / REFERENCE_WIDTH_PX;
  const backdrops: (BackdropEntry | null)[] = [];
  const layers: PlacedLayer[] = [];
  const warnings: SocialWarning[] = [];
  const reportedSlots = new Set<string>();
  const reportedFonts = new Set<string>();

  const placeImage = (layer: Extract<SocialLayer, { type: "image" }>): void => {
    const base = {
      type: "image",
      id: layer.id,
      slot: layer.slot,
      rect: layer.rect,
      fit: layer.fit,
      radiusPx: layer.radiusPx,
    } as const;
    const entry = doc.images[layer.slot];
    if (entry === null || entry === undefined) {
      if (layer.required && !reportedSlots.has(layer.slot)) {
        reportedSlots.add(layer.slot);
        warnings.push({ kind: "missingRequiredImage", slot: layer.slot });
      }
      layers.push({ ...base, url: null, crop: null });
      backdrops.push(null);
      return;
    }
    const url = ctx.assetUrl(entry.relPath);
    const imageSize = ctx.imageSize(url);
    const crop = imageSize === null ? null : focalToCrop(imageSize, layer.rect, entry.focal, layer.fit);
    if (crop !== null) {
      const check = checkResolution(crop);
      if (!check.sufficient) {
        warnings.push({ kind: "lowResImage", layerId: layer.id, widthPx: check.availablePx, neededPx: check.neededPx });
      }
      if (layer.required) warnings.push(...zoneWarnings("imageInZone", layer.id, [crop.dst], template));
    }
    layers.push({ ...base, url, crop });
    backdrops.push({ kind: "photo", rect: crop?.dst ?? layer.rect });
  };

  const placeText = (layer: SocialTextLayer, index: number): void => {
    const color = doc.colorOverrides[layer.id] ?? layer.color;
    const font: FontSpec = {
      family: layer.fontFamily,
      weight: layer.fontWeight,
      letterSpacingEm: layer.letterSpacingEm,
    };
    const measure = ctx.measureFor(font);
    const fit = fitText(layer, doc.texts[layer.slot] ?? layer.defaultText, measure);
    const { lines, boxes } = positionLines(layer, fit, measure);
    const bounds = boxes.length === 0 ? null : boxes.reduce((acc, box) => unionRect(acc, box));

    layers.push({
      type: "text",
      id: layer.id,
      slot: layer.slot,
      rect: layer.rect,
      fontFamily: layer.fontFamily,
      fontWeight: layer.fontWeight,
      fontSizePx: fit.fontSizePx,
      letterSpacingEm: layer.letterSpacingEm,
      color,
      align: layer.align,
      valign: layer.valign,
      lineHeightPx: fit.lineHeightPx,
      lines,
      bounds,
      truncated: fit.truncated,
      overflowsHeight: fit.overflowsHeight,
    });
    backdrops.push(null);

    if (ctx.isFontAvailable !== undefined && !reportedFonts.has(layer.fontFamily)) {
      if (!ctx.isFontAvailable(layer.fontFamily, layer.fontWeight)) {
        reportedFonts.add(layer.fontFamily);
        warnings.push({ kind: "fontMissing", family: layer.fontFamily });
      }
    }
    if (bounds === null) return;
    if (fit.truncated) warnings.push({ kind: "textTruncated", layerId: layer.id });
    if (fit.fontSizePx < minTextPx - EPS) {
      warnings.push({
        kind: "smallText",
        layerId: layer.id,
        sizePx: round(fit.fontSizePx, 2),
        minPx: round(minTextPx, 2),
      });
    }
    const foreground = parseHexColor(color);
    const backdrop = backdropColors(backdrops, index, bounds, background);
    const ratio = foreground === null || backdrop === null ? null : worstContrast(foreground, backdrop);
    if (ratio !== null && ratio < MIN_TEXT_CONTRAST - 1e-9) {
      warnings.push({ kind: "lowContrast", layerId: layer.id, ratio: floorTo2(ratio) });
    }
    warnings.push(...zoneWarnings("textInZone", layer.id, boxes, template));
  };

  template.layers.forEach((layer, index) => {
    switch (layer.type) {
      case "image":
        placeImage(layer);
        break;
      case "text":
        placeText(layer, index);
        break;
      case "shape": {
        const fill = withColorOverride(layer.fill, doc.colorOverrides[layer.id]);
        layers.push({
          type: "shape",
          id: layer.id,
          rect: layer.rect,
          fill: placeFill(fill, layer.rect, ctx),
          radiusPx: layer.radiusPx,
          opacity: layer.opacity,
        });
        backdrops.push({ kind: "shape", rect: layer.rect, fill, opacity: layer.opacity });
        break;
      }
      case "logo":
        layers.push({
          type: "logo",
          id: layer.id,
          rect: layer.rect,
          variant: layer.variant,
          url: ctx.logoUrl(layer.variant),
        });
        backdrops.push(null);
        break;
      case "grain":
        layers.push({ type: "grain", id: layer.id, opacity: layer.opacity, seed: layer.seed });
        backdrops.push(null);
        break;
      case "scanlines":
        layers.push({ type: "scanlines", id: layer.id, opacity: layer.opacity, spacingPx: layer.spacingPx });
        backdrops.push(null);
        break;
      default:
        assertNever(layer, "SocialLayer");
    }
  });

  return { size, background: placeFill(background, canvasRect, ctx), layers, warnings };
}
