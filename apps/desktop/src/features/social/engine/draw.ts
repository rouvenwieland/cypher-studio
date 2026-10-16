/**
 * Zeichnet eine aufgelöste Social-Vorlage (`SocialLayout`) auf eine 2D-Leinwand in sRGB.
 * Dünn und ohne eigene Entscheidungen: Positionen, Zuschnitte und Farben kommen fertig aus `layoutSocial`.
 * Hilfslinien werden hier nie gezeichnet (nur im Editor, siehe `guides-overlay.ts`).
 * Bilder und Logos kommen als `ImageBitmap` je Adresse von außen (`resources.ts`).
 */
import type { Rect } from "@contract";
import { assertNever, clamp } from "@/lib/assert";
import { applyTextStyle, type Canvas2D } from "./canvas-text";
import { applyGrain, clampRadius, gradientLine, scanlineRows, scanlineThickness } from "./draw-math";
import { centerFocal, focalToCrop, type ImageCrop } from "./focal";
import type { PlacedFill, PlacedImage, PlacedLayer, PlacedLogo, PlacedText, SocialLayout } from "./layout";

/** Geladene Bilder je Adresse. */
export type BitmapMap = ReadonlyMap<string, ImageBitmap>;

type PathContext = Pick<Canvas2D, "beginPath" | "moveTo" | "arcTo" | "closePath" | "rect">;

/** Pfad eines Rechtecks mit gerundeten Ecken (ohne `roundRect`, das ältere WebViews nicht kennen). */
export function pathRoundedRect(ctx: PathContext, rect: Rect, radius: number): void {
  const r = clampRadius(radius, rect.width, rect.height);
  ctx.beginPath();
  if (r <= 0) {
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    return;
  }
  const { x, y, width: w, height: h } = rect;
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBitmap(ctx: Canvas2D, bitmap: ImageBitmap, crop: ImageCrop, radiusPx: number): void {
  ctx.save();
  pathRoundedRect(ctx, crop.dst, radiusPx);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    bitmap,
    crop.src.x,
    crop.src.y,
    crop.src.width,
    crop.src.height,
    crop.dst.x,
    crop.dst.y,
    crop.dst.width,
    crop.dst.height,
  );
  ctx.restore();
}

/** Zuschnitt aus dem Layout; fehlt er (Größe war beim Layout noch unbekannt), wird er aus dem Bitmap berechnet. */
function cropFor(bitmap: ImageBitmap, rect: Rect, fit: PlacedImage["fit"], given: ImageCrop | null): ImageCrop | null {
  if (given !== null) return given;
  const size = { width: bitmap.width, height: bitmap.height };
  return focalToCrop(size, rect, centerFocal(size), fit);
}

function drawFill(ctx: Canvas2D, fill: PlacedFill, rect: Rect, radiusPx: number, bitmaps: BitmapMap): void {
  switch (fill.type) {
    case "solid":
      ctx.fillStyle = fill.color;
      pathRoundedRect(ctx, rect, radiusPx);
      ctx.fill();
      return;
    case "linearGradient": {
      const line = gradientLine(fill.angleDeg, rect);
      const gradient = ctx.createLinearGradient(line.x0, line.y0, line.x1, line.y1);
      for (const stop of fill.stops) gradient.addColorStop(clamp(stop.at, 0, 1), stop.color);
      ctx.fillStyle = gradient;
      pathRoundedRect(ctx, rect, radiusPx);
      ctx.fill();
      return;
    }
    case "image": {
      const bitmap = bitmaps.get(fill.url);
      if (bitmap === undefined) return;
      const crop = cropFor(bitmap, rect, fill.fit, fill.crop);
      if (crop !== null) drawBitmap(ctx, bitmap, crop, radiusPx);
      return;
    }
    default:
      assertNever(fill, "PlacedFill");
  }
}

function drawImageLayer(ctx: Canvas2D, layer: PlacedImage, bitmaps: BitmapMap): void {
  if (layer.url === null) return;
  const bitmap = bitmaps.get(layer.url);
  if (bitmap === undefined) return;
  const crop = cropFor(bitmap, layer.rect, layer.fit, layer.crop);
  if (crop !== null) drawBitmap(ctx, bitmap, crop, layer.radiusPx);
}

function drawLogo(ctx: Canvas2D, layer: PlacedLogo, bitmaps: BitmapMap): void {
  if (layer.url === null) return;
  const bitmap = bitmaps.get(layer.url);
  if (bitmap === undefined) return;
  const crop = cropFor(bitmap, layer.rect, "contain", null);
  if (crop !== null) drawBitmap(ctx, bitmap, crop, 0);
}

function drawTextLayer(ctx: Canvas2D, layer: PlacedText): void {
  if (layer.lines.length === 0) return;
  applyTextStyle(
    ctx,
    { family: layer.fontFamily, weight: layer.fontWeight, letterSpacingEm: layer.letterSpacingEm },
    layer.fontSizePx,
  );
  ctx.fillStyle = layer.color;
  ctx.textAlign = layer.align;
  ctx.textBaseline = "middle";
  for (const line of layer.lines) ctx.fillText(line.text, line.x, line.y);
}

function drawLayer(ctx: Canvas2D, layer: PlacedLayer, size: SocialLayout["size"], bitmaps: BitmapMap): void {
  switch (layer.type) {
    case "image":
      drawImageLayer(ctx, layer, bitmaps);
      return;
    case "text":
      drawTextLayer(ctx, layer);
      return;
    case "shape":
      ctx.globalAlpha = clamp(layer.opacity, 0, 1);
      drawFill(ctx, layer.fill, layer.rect, layer.radiusPx, bitmaps);
      return;
    case "logo":
      drawLogo(ctx, layer, bitmaps);
      return;
    case "grain": {
      const pixels = ctx.getImageData(0, 0, size.width, size.height);
      applyGrain(pixels.data, layer.opacity, layer.seed);
      ctx.putImageData(pixels, 0, 0);
      return;
    }
    case "scanlines": {
      ctx.globalAlpha = clamp(layer.opacity, 0, 1);
      ctx.fillStyle = "black";
      const thickness = scanlineThickness(layer.spacingPx);
      for (const y of scanlineRows(size.height, layer.spacingPx)) ctx.fillRect(0, y, size.width, thickness);
      return;
    }
    default:
      assertNever(layer, "PlacedLayer");
  }
}

/**
 * Zeichnet Hintergrund und Ebenen in Reihenfolge (unten zuerst) auf `ctx`. Die Leinwand sollte
 * `layout.size` groß sein. Jede Ebene läuft in eigenem save/restore; vorhandener Inhalt wird gelöscht.
 */
export function drawSocial(ctx: Canvas2D, layout: SocialLayout, bitmaps: BitmapMap): void {
  const { width, height } = layout.size;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, width, height);

  ctx.save();
  drawFill(ctx, layout.background, { x: 0, y: 0, width, height }, 0, bitmaps);
  ctx.restore();

  for (const layer of layout.layers) {
    ctx.save();
    drawLayer(ctx, layer, layout.size, bitmaps);
    ctx.restore();
  }
  ctx.restore();
}
