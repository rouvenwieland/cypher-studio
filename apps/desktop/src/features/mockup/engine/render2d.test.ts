import { describe, expect, it } from "vitest";
import { createPixelBuffer, type PixelBuffer } from "./displace";
import { MockupEngineError } from "./errors";
import { designMatrix, designRectMm, identityMatrix, type Matrix2D } from "./geometry";
import type { ImageLoader, LoadedImage } from "./loader";
import { planRender, type RenderPlan } from "./plan";
import { PlanExecutor } from "./render2d";
import type { Drawing2D, RasterSurface, SurfaceFactory } from "./surface";
import { GARMENTS, hex, makeInput, makeLayers, makeTemplate } from "./test-fixtures";

/* ---- Attrappen für Zeichenfläche und Bildlader ---- */

interface Call {
  fn: "drawImage" | "fillRect" | "clearRect";
  op: GlobalCompositeOperation;
  transform: Matrix2D;
  fillStyle: string;
  args: number[];
  source: string | null;
}

class FakeCtx implements Drawing2D {
  calls: Call[] = [];
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  imageSmoothingEnabled = true;
  imageSmoothingQuality: ImageSmoothingQuality = "high";
  transform: Matrix2D = identityMatrix();
  onDraw: (() => void) | null = null;

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.transform = { a, b, c, d, e, f };
  }
  drawImage(image: CanvasImageSource, ...args: number[]): void {
    this.record("drawImage", args, (image as unknown as { label: string }).label);
    this.onDraw?.();
  }
  fillRect(...args: number[]): void {
    this.record("fillRect", args, null);
  }
  clearRect(...args: number[]): void {
    this.record("clearRect", args, null);
  }
  private record(fn: Call["fn"], args: number[], source: string | null): void {
    this.calls.push({
      fn,
      op: this.globalCompositeOperation,
      transform: { ...this.transform },
      fillStyle: typeof this.fillStyle === "string" ? this.fillStyle : "gradient",
      args,
      source,
    });
  }
}

class FakeSurface implements RasterSurface {
  readonly ctx = new FakeCtx();
  readonly source: CanvasImageSource;
  pixels: PixelBuffer;
  reads: number[][] = [];
  writes: { buffer: PixelBuffer; x: number; y: number }[] = [];
  disposed = false;
  bitmaps = 0;
  blobArgs: { type: string; quality: number | null }[] = [];

  constructor(
    readonly index: number,
    readonly width: number,
    readonly height: number,
  ) {
    this.source = { label: `surface#${index}` } as unknown as CanvasImageSource;
    this.pixels = createPixelBuffer(width, height);
  }
  readPixels(x: number, y: number, width: number, height: number): PixelBuffer {
    this.reads.push([x, y, width, height]);
    return { data: new Uint8ClampedArray(this.pixels.data), width: this.pixels.width, height: this.pixels.height };
  }
  writePixels(buffer: PixelBuffer, x: number, y: number): void {
    this.writes.push({ buffer, x, y });
  }
  toBitmap(): Promise<ImageBitmap> {
    this.bitmaps++;
    return Promise.resolve({ label: `bitmap#${this.index}` } as unknown as ImageBitmap);
  }
  toBlob(type: "image/png" | "image/jpeg", quality: number | null): Promise<Blob> {
    this.blobArgs.push({ type, quality });
    return Promise.resolve(new Blob([`blob#${this.index}`], { type }));
  }
  dispose(): void {
    this.disposed = true;
  }
}

class FakeFactory implements SurfaceFactory {
  surfaces: FakeSurface[] = [];
  events: string[] = [];
  onCreate: ((surface: FakeSurface) => void) | null = null;
  create(width: number, height: number): RasterSurface {
    const surface = new FakeSurface(this.surfaces.length, width, height);
    this.surfaces.push(surface);
    this.events.push(`create#${surface.index}`);
    this.onCreate?.(surface);
    return surface;
  }
}

class FakeLoader implements ImageLoader {
  loaded: string[] = [];
  trims = 0;
  invalidated: (string | undefined)[] = [];
  disposed = false;
  sizes = new Map<string, { width: number; height: number }>();
  failing = new Set<string>();
  gate: Promise<void> | null = null;

  load(asset: { url: string; role: string }): Promise<LoadedImage> {
    this.loaded.push(`${asset.role}|${asset.url}`);
    if (this.failing.has(asset.url)) {
      return Promise.reject(new MockupEngineError("layer-load-failed", `cannot load ${asset.url}`));
    }
    const size =
      this.sizes.get(asset.url) ??
      (asset.role === "design" ? { width: 1000, height: 500 } : { width: 1200, height: 1500 });
    const result: LoadedImage = { source: { label: asset.url } as unknown as CanvasImageSource, ...size };
    return this.gate ? this.gate.then(() => result) : Promise.resolve(result);
  }
  trim(): void {
    this.trims++;
  }
  invalidate(url?: string): void {
    this.invalidated.push(url);
  }
  dispose(): void {
    this.disposed = true;
  }
}

function setup(): { factory: FakeFactory; loader: FakeLoader; executor: PlanExecutor } {
  const factory = new FakeFactory();
  const loader = new FakeLoader();
  return { factory, loader, executor: new PlanExecutor({ surfaces: factory, loader }) };
}

const ops = (ctx: FakeCtx): string[] => ctx.calls.map((c) => `${c.fn}:${c.source ?? c.fillStyle}:${c.op}`);

/** Plan mit Ausgabe = Vorlagengröße, damit die Ansichtsmatrix die Identität ist. */
function planOf(overrides: Parameters<typeof makeInput>[0] = {}, options = {}): RenderPlan {
  return planRender(makeInput({ output: { width: 1200, height: 1500 }, ...overrides }), options);
}

const noDisplace = makeTemplate({ displaceStrengthPx: 0 });

/* ---- Tests ---- */

describe("PlanExecutor: Zeichenreihenfolge und Blend-Modi", () => {
  it("zeichnet Stoff, Motiv, Schatten, Licht, Maske auf der Stoffebene und legt sie über den Hintergrund", async () => {
    const { factory, loader, executor } = setup();
    const plan = planOf({ template: noDisplace });
    await executor.renderBitmap(plan);

    const [main, garment] = factory.surfaces;
    expect(factory.surfaces).toHaveLength(2);
    expect(ops(garment!.ctx)).toEqual([
      `fillRect:${GARMENTS.schwarz.textileHex}:source-over`,
      "drawImage:blob:design-1:source-over",
      "drawImage:dark/shade.png:multiply",
      "drawImage:dark/light.png:screen",
      "drawImage:dark/mask.png:destination-in",
    ]);
    // Hauptfläche: erst transparenter Hintergrund, dann Stoffebene darüber
    expect(ops(main!.ctx)).toEqual([`clearRect::source-over`, "drawImage:surface#1:source-over"]);
    expect(loader.loaded.sort()).toEqual(
      ["design|blob:design-1", "layer|dark/light.png", "layer|dark/mask.png", "layer|dark/shade.png"].sort(),
    );
  });

  it("legt Melange per soft-light vor das Motiv", async () => {
    const { factory, executor } = setup();
    await executor.renderBitmap(planOf({ template: noDisplace, colorId: "grau-meliert", garment: GARMENTS.melange }));
    expect(ops(factory.surfaces[1]!.ctx).slice(0, 3)).toEqual([
      `fillRect:${GARMENTS.melange.textileHex}:source-over`,
      "drawImage:light/heather.png:soft-light",
      "drawImage:blob:design-1:source-over",
    ]);
  });

  it("zeichnet Ebenen der Vorlage über die ganze Vorlagenfläche mit der Ansichtsmatrix", async () => {
    const { factory, executor } = setup();
    const plan = planRender(makeInput({ template: noDisplace }), { scale: 0.5 }); // 1200 × 1500 Ausgabe, Faktor 1
    await executor.renderBitmap(plan);
    const shade = factory.surfaces[1]!.ctx.calls.find((c) => c.source === "dark/shade.png")!;
    expect(shade.transform).toEqual(plan.view);
    expect(shade.args).toEqual([0, 0, 1200, 1500]);

    const half = setup();
    const halfPlan = planRender(makeInput({ template: noDisplace, output: { width: 600, height: 750 } }));
    await half.executor.renderBitmap(halfPlan);
    const halfShade = half.factory.surfaces[1]!.ctx.calls.find((c) => c.source === "dark/shade.png")!;
    expect(halfShade.transform).toMatchObject({ a: 0.5, d: 0.5, e: 0, f: 0 });
    expect(halfShade.args).toEqual([0, 0, 1200, 1500]); // Größe der Vorlage, die Matrix verkleinert
  });

  it("setzt das Motiv mit der Matrix aus Quad, Druckfläche und Motivgröße", async () => {
    const { factory, executor } = setup();
    const plan = planOf({ template: noDisplace, placement: { widthMm: 200, offsetTopMm: 30, offsetCenterMm: -15 } });
    await executor.renderBitmap(plan);
    const motifStep = plan.steps.find((s) => s.kind === "motif");
    if (motifStep?.kind !== "motif") throw new Error("motif step missing");
    const size = { width: 1000, height: 500 };
    const expected = designMatrix(
      motifStep.mmMatrix,
      designRectMm(motifStep.printAreaMm, motifStep.placement, size),
      size,
    );
    const draw = factory.surfaces[1]!.ctx.calls.find((c) => c.source === "blob:design-1")!;
    expect(draw.transform).toEqual(expected);
    expect(draw.args).toEqual([0, 0, 1000, 500]);
    expect(draw.transform.e).toBeCloseTo(375, 8);
    expect(draw.transform.f).toBeCloseTo(445, 8);
  });

  it("setzt Blend-Modus und Transformation nach jedem Schritt zurück", async () => {
    const { factory, executor } = setup();
    await executor.renderBitmap(planOf({ template: noDisplace }));
    for (const surface of factory.surfaces.slice(0, 2)) {
      expect(surface.ctx.globalCompositeOperation).toBe("source-over");
      expect(surface.ctx.transform).toEqual(identityMatrix());
    }
  });

  it("füllt den Hintergrund mit Farbe oder zeichnet das Vorlagenbild", async () => {
    const color = setup();
    await color.executor.renderBitmap(
      planOf({ template: noDisplace, background: { kind: "color", hex: hex(228, 245, 49) } }),
    );
    expect(ops(color.factory.surfaces[0]!.ctx)).toEqual([
      "clearRect::source-over",
      `fillRect:${hex(228, 245, 49)}:source-over`,
      "drawImage:surface#1:source-over",
    ]);
    expect(color.factory.surfaces[0]!.ctx.calls[1]!.args).toEqual([0, 0, 1200, 1500]);

    const image = setup();
    await image.executor.renderBitmap(planOf({ template: noDisplace, background: { kind: "template" } }));
    expect(ops(image.factory.surfaces[0]!.ctx)).toEqual([
      "clearRect::source-over",
      "drawImage:dark/background.png:source-over",
      "drawImage:surface#1:source-over",
    ]);
  });

  it("lässt das Motiv bei null Verschiebungsstärke direkt auf die Stoffebene zeichnen (keine Pixelarbeit)", async () => {
    const { factory, executor } = setup();
    await executor.renderBitmap(planOf({ template: noDisplace }));
    expect(factory.surfaces).toHaveLength(2);
    expect(factory.surfaces.every((s) => s.reads.length === 0 && s.writes.length === 0)).toBe(true);
  });
});

describe("PlanExecutor: Verschiebung des Motivs", () => {
  /** Kleine Vorlage mit Stärke 127 px, damit R = 129 genau ein Pixel Versatz bedeutet. */
  const template = makeTemplate({
    canvas: { width: 200, height: 250 },
    displaceStrengthPx: 127,
    printArea: {
      quad: [
        { x: 20, y: 30 },
        { x: 118, y: 30 },
        { x: 118, y: 178 },
        { x: 20, y: 178 },
      ],
    },
  });
  const input = (): ReturnType<typeof makeInput> =>
    makeInput({
      template,
      output: { width: 200, height: 250 },
      placement: { widthMm: 150, offsetTopMm: 20, offsetCenterMm: 0 },
    });

  it("rechnet nur den Ausschnitt um das Motiv: Motiv und Karte in eigene Flächen, Ergebnis zurück auf die Stoffebene", async () => {
    const { factory, loader, executor } = setup();
    loader.sizes.set("blob:design-1", { width: 100, height: 50 });
    loader.sizes.set("dark/displace.png", { width: 200, height: 250 });
    factory.onCreate = (surface) => {
      if (surface.index === 2) {
        // Motivfläche: deckend, jedes Pixel eindeutig
        for (let y = 0; y < surface.height; y++) {
          for (let x = 0; x < surface.width; x++) {
            const i = (y * surface.width + x) * 4;
            surface.pixels.data.set([x % 256, y % 256, (x + y) % 256, 255], i);
          }
        }
      }
      if (surface.index === 3) {
        // Karte: dx = +1 (R = 129), dy = 0
        for (let i = 0; i < surface.pixels.data.length; i += 4) surface.pixels.data.set([129, 128, 128, 255], i);
      }
    };
    await executor.renderBitmap(planRender(input()));

    expect(factory.surfaces).toHaveLength(4); // Haupt, Stoff, Motivausschnitt, Karte
    const [, garment, layer, map] = factory.surfaces;

    // Motiv wird in den Ausschnitt gezeichnet (Matrix um den Ausschnittsursprung verschoben)
    const region = { width: layer!.width, height: layer!.height };
    expect(region.width).toBeLessThanOrEqual(200);
    expect(region.height).toBeLessThanOrEqual(250);
    const designDraw = layer!.ctx.calls[0]!;
    expect(designDraw.source).toBe("blob:design-1");
    expect(designDraw.args).toEqual([0, 0, 100, 50]);

    // Karte: erst neutral füllen, dann die Verschiebungsebene
    expect(map!.ctx.calls[0]).toMatchObject({ fn: "fillRect", fillStyle: "rgb(128, 128, 128)" });
    expect(map!.ctx.calls[1]).toMatchObject({ fn: "drawImage", source: "dark/displace.png", args: [0, 0, 200, 250] });

    // beide Flächen werden ganz gelesen, das Ergebnis einmal zurückgeschrieben
    expect(layer!.reads).toEqual([[0, 0, region.width, region.height]]);
    expect(map!.reads).toEqual([[0, 0, region.width, region.height]]);
    expect(layer!.writes).toHaveLength(1);
    const written = layer!.writes[0]!;
    expect(written).toMatchObject({ x: 0, y: 0 });
    expect(written.buffer.width).toBe(region.width);

    // Wirkung: ein Pixel nach rechts (Stärke 127, R = 129 → dx = 1); Innenpixel ohne Kante bleiben exakt
    const at = (x: number, y: number): number[] =>
      Array.from(written.buffer.data.slice((y * region.width + x) * 4, (y * region.width + x) * 4 + 4));
    expect(at(10, 10)).toEqual([9, 10, 19, 255]);
    expect(at(0, 10)[3]).toBeLessThan(60); // am linken Rand kommt Transparentes nach (Kante nur leicht geglättet)

    // Stoffebene bekommt den Ausschnitt an seiner Position, ohne Transformation
    const compose = garment!.ctx.calls.find((c) => c.source === "surface#2")!;
    expect(compose.transform).toEqual(identityMatrix());
    expect(compose.op).toBe("source-over");
    expect(compose.args).toHaveLength(2);

    // Hilfsflächen sind freigegeben
    expect(layer!.disposed).toBe(true);
    expect(map!.disposed).toBe(true);
  });

  it("zeichnet das Motiv nicht, wenn es ganz außerhalb der Leinwand liegt", async () => {
    const { factory, executor } = setup();
    const outside = makeInput({
      template,
      output: { width: 200, height: 250 },
      placement: { widthMm: 50, offsetTopMm: 100000, offsetCenterMm: 0 },
    });
    await executor.renderBitmap(planRender(outside));
    expect(factory.surfaces).toHaveLength(2);
    expect(factory.surfaces[1]!.ctx.calls.some((c) => c.source === "blob:design-1")).toBe(false);
  });
});

describe("PlanExecutor: Ergebnis, Aufräumen, Fehler", () => {
  it("liefert das Bitmap der Hauptfläche und gibt alle Flächen frei", async () => {
    const { factory, loader, executor } = setup();
    const bitmap = await executor.renderBitmap(planOf({ template: noDisplace }));
    expect((bitmap as unknown as { label: string }).label).toBe("bitmap#0");
    expect(factory.surfaces.map((s) => s.disposed)).toEqual([true, true]);
    expect(factory.surfaces[0]!.bitmaps).toBe(1);
    expect(loader.trims).toBe(1);
  });

  it("kodiert beim Export mit Typ und Qualität", async () => {
    const { factory, executor } = setup();
    const blob = await executor.renderBlob(planOf({ template: noDisplace }, { opaque: true }), "image/jpeg", 0.8);
    expect(blob.type).toBe("image/jpeg");
    expect(factory.surfaces[0]!.blobArgs).toEqual([{ type: "image/jpeg", quality: 0.8 }]);
    expect(factory.surfaces[0]!.ctx.calls[1]).toMatchObject({ fn: "fillRect", fillStyle: "white" }); // JPEG: deckender Hintergrund
    await executor.renderBlob(planOf({ template: noDisplace }), "image/png", null);
    expect(factory.surfaces[2]!.blobArgs).toEqual([{ type: "image/png", quality: null }]);
  });

  it("lehnt Pläne über der Leinwandgrenze ab, bevor etwas geladen wird", async () => {
    const { factory, loader, executor } = setup();
    const plan = planOf({ template: noDisplace });
    plan.output = { width: 3001, height: 100 };
    await expect(executor.renderBitmap(plan)).rejects.toMatchObject({ code: "invalid-input" });
    expect(loader.loaded).toHaveLength(0);
    expect(factory.surfaces).toHaveLength(0);
  });

  it("meldet Ladefehler und räumt trotzdem auf", async () => {
    const { factory, loader, executor } = setup();
    loader.failing.add("dark/shade.png");
    await expect(executor.renderBitmap(planOf({ template: noDisplace }))).rejects.toMatchObject({
      code: "layer-load-failed",
    });
    expect(factory.surfaces).toHaveLength(0); // Laden kommt vor dem Anlegen der Flächen
  });

  it("gibt Flächen frei, wenn das Zeichnen mittendrin scheitert", async () => {
    const { factory, executor } = setup();
    factory.onCreate = (surface) => {
      if (surface.index === 1) {
        surface.ctx.onDraw = () => {
          throw new Error("boom");
        };
      }
    };
    await expect(executor.renderBitmap(planOf({ template: noDisplace }))).rejects.toThrow("boom");
    expect(factory.surfaces.map((s) => s.disposed)).toEqual([true, true]);
  });

  it("bricht ab: vorab, beim Laden und zwischen den Schritten", async () => {
    // vorab
    const a = setup();
    const done = new AbortController();
    done.abort();
    await expect(a.executor.renderBitmap(planOf({ template: noDisplace }), done.signal)).rejects.toMatchObject({
      code: "aborted",
    });
    expect(a.loader.loaded).toHaveLength(0);

    // während die Ebenen laden
    const b = setup();
    let release: () => void = () => undefined;
    b.loader.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loading = new AbortController();
    const pending = b.executor.renderBitmap(planOf({ template: noDisplace }), loading.signal);
    await Promise.resolve();
    loading.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    release();
    expect(b.factory.surfaces).toHaveLength(0);

    // zwischen den Schritten
    const c = setup();
    const midway = new AbortController();
    c.factory.onCreate = (surface) => {
      if (surface.index === 1) {
        surface.ctx.onDraw = () => {
          midway.abort();
        };
      }
    };
    await expect(c.executor.renderBitmap(planOf({ template: noDisplace }), midway.signal)).rejects.toMatchObject({
      code: "aborted",
    });
    expect(c.factory.surfaces.map((s) => s.disposed)).toEqual([true, true]);
    expect(c.factory.surfaces[0]!.bitmaps).toBe(0);
  });
});

describe("PlanExecutor: Läufe nacheinander, Zwischenspeicher, Beenden", () => {
  it("führt gleichzeitige Anfragen nacheinander aus und lässt einen Fehler die nächste nicht blockieren", async () => {
    const { factory, loader, executor } = setup();
    loader.failing.add("fail/shade.png");
    const failing = planOf({
      template: makeTemplate({
        displaceStrengthPx: 0,
        variants: [{ exposure: "dark", layers: makeLayers("fail"), colorIds: ["schwarz"] }],
      }),
    });
    const good = planOf({ template: noDisplace });
    const first = executor.renderBitmap(failing);
    const second = executor.renderBitmap(good);
    const third = executor.renderBitmap(good);
    await expect(first).rejects.toMatchObject({ code: "layer-load-failed" });
    await Promise.all([second, third]);
    // Flächen der zweiten Anfrage (0, 1) werden vor denen der dritten (2, 3) angelegt und freigegeben
    expect(factory.events).toEqual(["create#0", "create#1", "create#2", "create#3"]);
    expect(factory.surfaces[0]!.disposed && factory.surfaces[1]!.disposed).toBe(true);
    expect(loader.trims).toBe(3);
  });

  it("verwirft Zwischenspeicher sofort, wenn nichts läuft, und erst nach dem Lauf, wenn gerade gezeichnet wird", async () => {
    const { loader, executor } = setup();
    executor.invalidate("blob:old");
    expect(loader.invalidated).toEqual(["blob:old"]);

    let release: () => void = () => undefined;
    loader.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = executor.renderBitmap(planOf({ template: noDisplace }));
    await Promise.resolve();
    executor.invalidate("blob:design-1");
    executor.invalidate();
    expect(loader.invalidated).toEqual(["blob:old"]); // noch nichts
    release();
    await running;
    expect(loader.invalidated).toEqual(["blob:old", "blob:design-1", undefined]);
  });

  it("nach dispose scheitern neue Anfragen mit disposed und der Lader wird geschlossen", async () => {
    const { loader, executor } = setup();
    executor.dispose();
    expect(loader.disposed).toBe(true);
    await expect(executor.renderBitmap(planOf({ template: noDisplace }))).rejects.toMatchObject({ code: "disposed" });
  });
});
