import { describe, expect, it, vi } from "vitest";
import type { Canvas2D } from "./canvas-text";
import type { SocialLayout } from "./layout";
import { JPEG_QUALITY, createDefaultTarget, renderSocialToBlob, type RenderTarget } from "./render";

interface Call {
  method: string;
  args: unknown[];
}

function fakeTarget(): { target: RenderTarget; calls: Call[]; encode: ReturnType<typeof vi.fn> } {
  const calls: Call[] = [];
  const props = new Map<string, unknown>();
  const ctx = new Proxy(
    {},
    {
      get: (_target, key) =>
        typeof key !== "string"
          ? undefined
          : props.has(key)
            ? props.get(key)
            : (...args: unknown[]) => void calls.push({ method: key, args }),
      set: (_target, key, value) => {
        if (typeof key === "string") {
          calls.push({ method: `set ${key}`, args: [value] });
          props.set(key, value);
        }
        return true;
      },
    },
  ) as unknown as Canvas2D;
  const encode = vi.fn((mime: string) => Promise.resolve(new Blob(["bild"], { type: mime })));
  return { target: { ctx, encode }, calls, encode };
}

const layout: SocialLayout = {
  size: { width: 1080, height: 1350 },
  background: { type: "solid", color: "#0d0d0d" },
  layers: [],
  warnings: [],
};

describe("renderSocialToBlob", () => {
  it("rendert in Zielgröße und kodiert PNG ohne Qualitätsangabe", async () => {
    const { target, encode, calls } = fakeTarget();
    const factory = vi.fn(() => target);
    const blob = await renderSocialToBlob(layout, new Map(), { format: "png", createTarget: factory });
    expect(factory).toHaveBeenCalledWith({ width: 1080, height: 1350 });
    expect(encode).toHaveBeenCalledWith("image/png", undefined);
    expect(blob.type).toBe("image/png");
    expect(calls.some((call) => call.method === "clearRect" && call.args.join() === "0,0,1080,1350")).toBe(true);
    // Kein weißer Untergrund bei PNG
    expect(
      calls.some((call) => call.method === "set globalCompositeOperation" && call.args[0] === "destination-over"),
    ).toBe(false);
  });

  it("kodiert JPEG mit Qualität 0,90 und füllt den Rest hinter dem Bild weiß", async () => {
    const { target, encode, calls } = fakeTarget();
    const blob = await renderSocialToBlob(layout, new Map(), { format: "jpeg", createTarget: () => target });
    expect(JPEG_QUALITY).toBe(0.9);
    expect(encode).toHaveBeenCalledWith("image/jpeg", 0.9);
    expect(blob.type).toBe("image/jpeg");
    const names = calls.map((call) => `${call.method}:${String(call.args[0])}`);
    const matte = names.indexOf("set globalCompositeOperation:destination-over");
    expect(matte).toBeGreaterThan(-1);
    expect(names.indexOf("set fillStyle:white")).toBeGreaterThan(matte);
    expect(calls.filter((call) => call.method === "fillRect").at(-1)?.args).toEqual([0, 0, 1080, 1350]);
  });

  it("nimmt eine eigene JPEG-Qualität", async () => {
    const { target, encode } = fakeTarget();
    await renderSocialToBlob(layout, new Map(), { format: "jpeg", quality: 0.5, createTarget: () => target });
    expect(encode).toHaveBeenCalledWith("image/jpeg", 0.5);
  });
});

describe("createDefaultTarget", () => {
  it("nutzt OffscreenCanvas und reicht Typ und Qualität an convertToBlob", async () => {
    const convertToBlob = vi.fn((_options: ImageEncodeOptions) => Promise.resolve(new Blob(["x"])));
    const getContext = vi.fn(() => ({ marker: true }));
    const constructed: number[][] = [];
    const original = globalThis.OffscreenCanvas;
    globalThis.OffscreenCanvas = class {
      constructor(width: number, height: number) {
        constructed.push([width, height]);
      }
      getContext = getContext;
      convertToBlob = convertToBlob;
    } as unknown as typeof OffscreenCanvas;
    try {
      const target = createDefaultTarget({ width: 10, height: 20 });
      expect(constructed).toEqual([[10, 20]]);
      expect(getContext).toHaveBeenCalledWith("2d", { colorSpace: "srgb", alpha: true });
      await target.encode("image/png", undefined);
      await target.encode("image/jpeg", 0.9);
      expect(convertToBlob.mock.calls.map((call) => call[0])).toEqual([
        { type: "image/png" },
        { type: "image/jpeg", quality: 0.9 },
      ]);
    } finally {
      if (original === undefined) {
        // @ts-expect-error Ausgangszustand wiederherstellen
        delete globalThis.OffscreenCanvas;
      } else {
        globalThis.OffscreenCanvas = original;
      }
    }
  });

  it("fällt auf ein Canvas-Element zurück und kodiert über toBlob", async () => {
    const original = globalThis.OffscreenCanvas;
    // @ts-expect-error Offscreen-Unterstützung für diesen Test entfernen
    delete globalThis.OffscreenCanvas;
    const toBlob = vi.fn((callback: BlobCallback, _type?: string, _quality?: number) => callback(new Blob(["x"])));
    const fakeCanvas = { width: 0, height: 0, getContext: vi.fn(() => ({ marker: true })), toBlob };
    const create = vi.spyOn(document, "createElement").mockReturnValue(fakeCanvas as unknown as HTMLElement);
    try {
      const target = createDefaultTarget({ width: 30, height: 40 });
      expect([fakeCanvas.width, fakeCanvas.height]).toEqual([30, 40]);
      await target.encode("image/jpeg", 0.9);
      expect(toBlob.mock.calls[0]?.slice(1)).toEqual(["image/jpeg", 0.9]);
    } finally {
      create.mockRestore();
      if (original !== undefined) globalThis.OffscreenCanvas = original;
    }
  });

  it("meldet fehlenden Kontext und fehlgeschlagene Kodierung", async () => {
    const original = globalThis.OffscreenCanvas;
    // @ts-expect-error Offscreen-Unterstützung für diesen Test entfernen
    delete globalThis.OffscreenCanvas;
    const failing = { width: 0, height: 0, getContext: () => null, toBlob: vi.fn() };
    const create = vi.spyOn(document, "createElement").mockReturnValue(failing as unknown as HTMLElement);
    try {
      expect(() => createDefaultTarget({ width: 1, height: 1 })).toThrow();
      const noBlob = {
        width: 0,
        height: 0,
        getContext: () => ({}),
        toBlob: (callback: BlobCallback) => callback(null),
      };
      create.mockReturnValue(noBlob as unknown as HTMLElement);
      const target = createDefaultTarget({ width: 1, height: 1 });
      await expect(target.encode("image/png", undefined)).rejects.toThrow();
    } finally {
      create.mockRestore();
      if (original !== undefined) globalThis.OffscreenCanvas = original;
    }
  });
});
