/**
 * Zeichenflächen: dünne Hülle um OffscreenCanvas (Worker, Hauptthread) bzw. <canvas> (Rückfall).
 * Der Rest der Engine kennt nur `RasterSurface`; Tests ersetzen die Fabrik durch eine Attrappe.
 */
import { MockupEngineError } from "./errors";
import type { PixelBuffer } from "./displace";
import type { MockupImageType } from "./types";

/** Der Teil des 2D-Kontexts, den die Engine nutzt (erfüllt von Canvas- und Offscreen-Kontext). */
export interface Drawing2D {
  globalCompositeOperation: GlobalCompositeOperation;
  fillStyle: string | CanvasGradient | CanvasPattern;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

export interface RasterSurface {
  readonly width: number;
  readonly height: number;
  readonly ctx: Drawing2D;
  /** Quelle für `drawImage` auf einer anderen Fläche. */
  readonly source: CanvasImageSource;
  readPixels(x: number, y: number, width: number, height: number): PixelBuffer;
  writePixels(buffer: PixelBuffer, x: number, y: number): void;
  /** Inhalt als Bitmap; die Fläche ist danach nicht mehr zu verwenden (bei OffscreenCanvas wird übertragen). */
  toBitmap(): Promise<ImageBitmap>;
  toBlob(type: MockupImageType, quality: number | null): Promise<Blob>;
  /** Speicher der Fläche freigeben. */
  dispose(): void;
}

export interface SurfaceFactory {
  create(width: number, height: number): RasterSurface;
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function isOffscreen(canvas: AnyCanvas): canvas is OffscreenCanvas {
  return typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas;
}

function wrap(canvas: AnyCanvas, ctx: AnyContext): RasterSurface {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return {
    get width() {
      return canvas.width;
    },
    get height() {
      return canvas.height;
    },
    ctx,
    source: canvas,
    readPixels(x, y, width, height) {
      const image = ctx.getImageData(x, y, width, height);
      return { data: image.data, width: image.width, height: image.height };
    },
    writePixels(buffer, x, y) {
      ctx.putImageData(new ImageData(buffer.data, buffer.width, buffer.height), x, y);
    },
    toBitmap() {
      // OffscreenCanvas überträgt den Inhalt ohne Kopie; <canvas> wird kopiert.
      return isOffscreen(canvas) ? Promise.resolve(canvas.transferToImageBitmap()) : createImageBitmap(canvas);
    },
    toBlob(type, quality) {
      const encoderQuality = quality === null ? undefined : quality;
      if (isOffscreen(canvas)) {
        return canvas.convertToBlob(encoderQuality === undefined ? { type } : { type, quality: encoderQuality });
      }
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new MockupEngineError("encode-failed", `Canvas could not encode ${type}`));
          },
          type,
          encoderQuality,
        );
      });
    },
    dispose() {
      // Größe 0 gibt den Zeichenspeicher sofort frei, ohne auf die Speicherbereinigung zu warten.
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

/** Erzeugt eine Fläche: OffscreenCanvas, wenn verfügbar, sonst ein nicht eingehängtes <canvas>. */
export const canvasSurfaceFactory: SurfaceFactory = {
  create(width, height) {
    if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) {
      throw new MockupEngineError("invalid-input", `Invalid surface size ${width}×${height}`);
    }
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (ctx) return wrap(canvas, ctx);
    }
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) return wrap(canvas, ctx);
    }
    throw new MockupEngineError(
      "canvas-unavailable",
      "No 2D canvas available (OffscreenCanvas and <canvas> both failed)",
    );
  },
};

/** Ob im aktuellen Kontext ein OffscreenCanvas mit 2D-Kontext nutzbar ist (Voraussetzung für den Worker-Betrieb). */
export function supportsOffscreen2d(): boolean {
  try {
    return typeof OffscreenCanvas !== "undefined" && new OffscreenCanvas(1, 1).getContext("2d") !== null;
  } catch {
    return false;
  }
}
