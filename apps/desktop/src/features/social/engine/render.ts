/**
 * Export: zeichnet das Layout auf eine neue Leinwand in Zielgröße und kodiert PNG (Grafik/Text)
 * oder JPEG mit Qualität 0,90 (Fotos). Die Leinwand ist austauschbar, damit der Ablauf ohne Browser testbar bleibt.
 */
import type { Size } from "@contract";
import type { Canvas2D } from "./canvas-text";
import { drawSocial, type BitmapMap } from "./draw";
import type { SocialLayout } from "./layout";

export type ExportFormat = "png" | "jpeg";

/** JPEG-Qualität laut ARCHITEKTUR 5.5. */
export const JPEG_QUALITY = 0.9;
/** Untergrund für JPEG, das keine Transparenz kennt. */
const JPEG_MATTE = "white";

export interface RenderTarget {
  ctx: Canvas2D;
  encode(mime: "image/png" | "image/jpeg", quality: number | undefined): Promise<Blob>;
}

export type RenderTargetFactory = (size: Size) => RenderTarget;

export interface RenderOptions {
  format: ExportFormat;
  /** Nur für JPEG; Standard 0,90. */
  quality?: number;
  /** Eigene Leinwand (Tests); Standard: OffscreenCanvas, sonst ein Canvas-Element. */
  createTarget?: RenderTargetFactory;
}

/** Leinwand in Zielgröße, sRGB, mit Alphakanal. */
export function createDefaultTarget(size: Size): RenderTarget {
  const settings: CanvasRenderingContext2DSettings = { colorSpace: "srgb", alpha: true };
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext("2d", settings);
    if (ctx === null) throw new Error("No 2D context available");
    return {
      ctx,
      encode: (mime, quality) => canvas.convertToBlob(quality === undefined ? { type: mime } : { type: mime, quality }),
    };
  }
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", settings);
  if (ctx === null) throw new Error("No 2D context available");
  return {
    ctx,
    encode: (mime, quality) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob === null ? reject(new Error("Image could not be encoded")) : resolve(blob)),
          mime,
          quality,
        );
      }),
  };
}

/** Rendert `layout` in voller Zielgröße und liefert die Bilddatei. */
export async function renderSocialToBlob(
  layout: SocialLayout,
  bitmaps: BitmapMap,
  options: RenderOptions,
): Promise<Blob> {
  const target = (options.createTarget ?? createDefaultTarget)(layout.size);
  drawSocial(target.ctx, layout, bitmaps);
  if (options.format === "jpeg") {
    // JPEG kann keine Transparenz: Rest hinter dem Gezeichneten auffüllen.
    target.ctx.save();
    target.ctx.globalCompositeOperation = "destination-over";
    target.ctx.fillStyle = JPEG_MATTE;
    target.ctx.fillRect(0, 0, layout.size.width, layout.size.height);
    target.ctx.restore();
    return target.encode("image/jpeg", options.quality ?? JPEG_QUALITY);
  }
  return target.encode("image/png", undefined);
}
