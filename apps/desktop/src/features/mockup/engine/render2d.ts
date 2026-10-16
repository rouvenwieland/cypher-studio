/**
 * Führt einen Renderplan auf 2D-Flächen aus (OffscreenCanvas im Worker, <canvas> im Hauptthread).
 * Die Logik (Reihenfolge, Blend-Modi, Ausschnitt der Verschiebung) hängt nur an `SurfaceFactory` und `ImageLoader`
 * und ist deshalb mit Attrappen testbar; die echte Zeichnung prüft der Browsertest.
 */
import { abortable, throwIfAborted } from "./abort";
import { DISPLACE_NEUTRAL, displaceImage } from "./displace";
import { MockupEngineError } from "./errors";
import { designMatrix, designRectMm, motifRegion, type Matrix2D } from "./geometry";
import { BitmapLoader, type ImageLoader, type LoadedImage } from "./loader";
import { MAX_CANVAS_PX, type AssetRole, type RenderPlan, type RenderStep } from "./plan";
import { canvasSurfaceFactory, type Drawing2D, type RasterSurface, type SurfaceFactory } from "./surface";
import type { MockupImageType } from "./types";

/** Ausführung eines Plans; vom Worker und vom Hauptthread-Rückfall gleichermaßen genutzt. */
export interface PlanRunner {
  renderBitmap(plan: RenderPlan, signal?: AbortSignal): Promise<ImageBitmap>;
  renderBlob(plan: RenderPlan, type: MockupImageType, quality: number | null, signal?: AbortSignal): Promise<Blob>;
  invalidate(url?: string): void;
  dispose(): void;
}

export interface PlanExecutorOptions {
  surfaces?: SurfaceFactory;
  loader?: ImageLoader;
}

const NEUTRAL_MAP_COLOR = `rgb(${DISPLACE_NEUTRAL}, ${DISPLACE_NEUTRAL}, ${DISPLACE_NEUTRAL})`;

function imageKey(role: AssetRole, url: string): string {
  return `${role}|${url}`;
}

function assertOutputWithinLimits(plan: RenderPlan): void {
  const { width, height } = plan.output;
  const valid =
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= 1 &&
    height >= 1 &&
    width <= MAX_CANVAS_PX.width &&
    height <= MAX_CANVAS_PX.height;
  if (!valid) {
    throw new MockupEngineError(
      "invalid-input",
      `Output ${width}×${height} exceeds the canvas limit ${MAX_CANVAS_PX.width}×${MAX_CANVAS_PX.height}`,
    );
  }
}

function setMatrix(ctx: Drawing2D, m: Matrix2D): void {
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
}

/** Der Browser-Ereignisschleife eine Runde geben, damit Abbruch-Nachrichten zwischen den Schritten ankommen. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export class PlanExecutor implements PlanRunner {
  private readonly surfaces: SurfaceFactory;
  private readonly loader: ImageLoader;
  private chain: Promise<unknown> = Promise.resolve();
  private running = 0;
  private deferredInvalidations: (string | undefined)[] = [];
  private disposed = false;

  constructor(options: PlanExecutorOptions = {}) {
    this.surfaces = options.surfaces ?? canvasSurfaceFactory;
    this.loader = options.loader ?? new BitmapLoader();
  }

  renderBitmap(plan: RenderPlan, signal?: AbortSignal): Promise<ImageBitmap> {
    return this.enqueue(async () => {
      const surface = await this.paint(plan, signal);
      try {
        return await surface.toBitmap();
      } finally {
        surface.dispose();
      }
    });
  }

  renderBlob(plan: RenderPlan, type: MockupImageType, quality: number | null, signal?: AbortSignal): Promise<Blob> {
    return this.enqueue(async () => {
      const surface = await this.paint(plan, signal);
      try {
        return await surface.toBlob(type, quality);
      } finally {
        surface.dispose();
      }
    });
  }

  invalidate(url?: string): void {
    if (this.running > 0) {
      // Bitmaps, die gerade gezeichnet werden, nicht schließen: erst nach dem Lauf verwerfen.
      this.deferredInvalidations.push(url);
      return;
    }
    this.loader.invalidate(url);
  }

  dispose(): void {
    this.disposed = true;
    this.deferredInvalidations = [];
    this.loader.dispose();
  }

  /** Läufe nacheinander ausführen (ein Zeichenspeicher, ein Zwischenspeicher), auch wenn einer scheitert. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      if (this.disposed) throw new MockupEngineError("disposed", "Renderer was disposed");
      this.running++;
      try {
        return await job();
      } finally {
        this.running--;
        if (this.running === 0) {
          for (const url of this.deferredInvalidations) this.loader.invalidate(url);
          this.deferredInvalidations = [];
          if (!this.disposed) this.loader.trim();
        }
      }
    };
    const result = this.chain.then(run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  private async loadAssets(plan: RenderPlan, signal: AbortSignal | undefined): Promise<Map<string, LoadedImage>> {
    const loaded = await abortable(Promise.all(plan.assets.map((asset) => this.loader.load(asset))), signal);
    const images = new Map<string, LoadedImage>();
    plan.assets.forEach((asset, index) => {
      const image = loaded[index];
      if (image) images.set(imageKey(asset.role, asset.url), image);
    });
    return images;
  }

  /** Zeichnet den ganzen Plan und liefert die fertige Hauptfläche (Besitz geht an den Aufrufer). */
  private async paint(plan: RenderPlan, signal: AbortSignal | undefined): Promise<RasterSurface> {
    throwIfAborted(signal);
    assertOutputWithinLimits(plan);
    const images = await this.loadAssets(plan, signal);
    throwIfAborted(signal);

    const { width, height } = plan.output;
    const main = this.surfaces.create(width, height);
    let garment: RasterSurface | null = null;
    try {
      garment = this.surfaces.create(width, height);
      let first = true;
      for (const step of plan.steps) {
        if (!first) {
          await yieldToEventLoop();
          throwIfAborted(signal);
        }
        first = false;
        this.applyStep(step, plan, main, garment, images);
      }
      return main;
    } catch (error) {
      main.dispose();
      throw error;
    } finally {
      garment?.dispose();
    }
  }

  private applyStep(
    step: RenderStep,
    plan: RenderPlan,
    main: RasterSurface,
    garment: RasterSurface,
    images: Map<string, LoadedImage>,
  ): void {
    const image = (role: AssetRole, url: string): LoadedImage => {
      const found = images.get(imageKey(role, url));
      if (!found) throw new MockupEngineError("layer-load-failed", `Image was not loaded: ${url}`);
      return found;
    };
    const { width, height } = plan.output;

    switch (step.kind) {
      case "background": {
        const ctx = main.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        ctx.clearRect(0, 0, width, height);
        switch (step.fill.type) {
          case "transparent":
            break;
          case "color":
            ctx.fillStyle = step.fill.color;
            ctx.fillRect(0, 0, width, height);
            break;
          case "image":
            this.drawLayer(ctx, image("background", step.fill.url), plan, "source-over");
            break;
        }
        break;
      }
      case "fabric": {
        const ctx = garment.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = step.color;
        ctx.fillRect(0, 0, width, height);
        break;
      }
      case "structure":
      case "shade":
      case "light":
        this.drawLayer(garment.ctx, image("layer", step.url), plan, step.blend);
        break;
      case "mask":
        this.drawLayer(garment.ctx, image("layer", step.url), plan, "destination-in");
        break;
      case "motif":
        this.drawMotif(
          step,
          plan,
          garment,
          image("design", step.url),
          step.displace ? image("layer", step.displace.url) : null,
        );
        break;
      case "composite": {
        const ctx = main.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(garment.source, 0, 0);
        break;
      }
    }
  }

  /** Ebene der Vorlage mit Blend-Modus über die ganze Vorlagenfläche zeichnen (Pixel der Vorlage → Ausgabe über `view`). */
  private drawLayer(ctx: Drawing2D, image: LoadedImage, plan: RenderPlan, operation: GlobalCompositeOperation): void {
    ctx.globalCompositeOperation = operation;
    setMatrix(ctx, plan.view);
    ctx.drawImage(image.source, 0, 0, plan.template.size.width, plan.template.size.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawMotif(
    step: Extract<RenderStep, { kind: "motif" }>,
    plan: RenderPlan,
    garment: RasterSurface,
    design: LoadedImage,
    displaceMap: LoadedImage | null,
  ): void {
    const designSize = { width: design.width, height: design.height };
    const matrix = designMatrix(step.mmMatrix, designRectMm(step.printAreaMm, step.placement, designSize), designSize);
    const ctx = garment.ctx;
    ctx.globalCompositeOperation = "source-over";

    if (!step.displace || !displaceMap) {
      setMatrix(ctx, matrix);
      ctx.drawImage(design.source, 0, 0, designSize.width, designSize.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }

    // Nur der Ausschnitt um das Motiv (plus Rand für die Verschiebung) wird in Pixel gerechnet.
    const region = motifRegion(matrix, designSize, Math.ceil(step.displace.strengthPx) + 2, plan.output);
    if (!region) return;
    const layer = this.surfaces.create(region.width, region.height);
    let map: RasterSurface | null = null;
    try {
      map = this.surfaces.create(region.width, region.height);
      layer.ctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - region.x, matrix.f - region.y);
      layer.ctx.drawImage(design.source, 0, 0, designSize.width, designSize.height);

      // Außerhalb der Karte neutral (keine Verschiebung), nicht schwarz.
      map.ctx.fillStyle = NEUTRAL_MAP_COLOR;
      map.ctx.fillRect(0, 0, region.width, region.height);
      const v = plan.view;
      map.ctx.setTransform(v.a, v.b, v.c, v.d, v.e - region.x, v.f - region.y);
      map.ctx.drawImage(displaceMap.source, 0, 0, plan.template.size.width, plan.template.size.height);

      const displaced = displaceImage(
        layer.readPixels(0, 0, region.width, region.height),
        map.readPixels(0, 0, region.width, region.height),
        step.displace.strengthPx,
      );
      layer.writePixels(displaced, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer.source, region.x, region.y);
    } finally {
      layer.dispose();
      map?.dispose();
    }
  }
}
