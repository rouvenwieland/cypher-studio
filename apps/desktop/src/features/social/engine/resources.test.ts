import { describe, expect, it, vi } from "vitest";
import type { SocialLayout } from "./layout";
import {
  collectResourceUrls,
  disposeBitmaps,
  ensureFonts,
  fontsOfTemplate,
  loadResources,
  type FetchedResponse,
  type FontLoader,
} from "./resources";

const bitmapFor = (url: string): ImageBitmap =>
  ({ width: 1, height: 1, close: vi.fn(), url }) as unknown as ImageBitmap;
const ok = (): FetchedResponse => ({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) });

describe("collectResourceUrls", () => {
  it("sammelt Adressen aus Hintergrund, Bildern, Logos und Bildfüllungen ohne Doppelte", () => {
    const layout: SocialLayout = {
      size: { width: 100, height: 100 },
      background: { type: "image", url: "bg", fit: "cover", crop: null },
      warnings: [],
      layers: [
        {
          type: "image",
          id: "a",
          slot: "a",
          rect: { x: 0, y: 0, width: 1, height: 1 },
          fit: "cover",
          radiusPx: 0,
          url: "foto",
          crop: null,
        },
        {
          type: "image",
          id: "b",
          slot: "b",
          rect: { x: 0, y: 0, width: 1, height: 1 },
          fit: "cover",
          radiusPx: 0,
          url: null,
          crop: null,
        },
        {
          type: "image",
          id: "c",
          slot: "c",
          rect: { x: 0, y: 0, width: 1, height: 1 },
          fit: "cover",
          radiusPx: 0,
          url: "foto",
          crop: null,
        },
        { type: "logo", id: "logo", rect: { x: 0, y: 0, width: 1, height: 1 }, variant: "light", url: "logo" },
        {
          type: "shape",
          id: "s",
          rect: { x: 0, y: 0, width: 1, height: 1 },
          fill: { type: "image", url: "muster", fit: "cover", crop: null },
          radiusPx: 0,
          opacity: 1,
        },
        {
          type: "shape",
          id: "t",
          rect: { x: 0, y: 0, width: 1, height: 1 },
          fill: { type: "solid", color: "#000000" },
          radiusPx: 0,
          opacity: 1,
        },
        { type: "grain", id: "g", opacity: 0.1, seed: 1 },
        { type: "scanlines", id: "z", opacity: 0.1, spacingPx: 4 },
      ],
    };
    expect(collectResourceUrls(layout).sort()).toEqual(["bg", "foto", "logo", "muster"]);
  });

  it("liefert für ein Layout ohne Bilder nichts", () => {
    const layout: SocialLayout = {
      size: { width: 1, height: 1 },
      background: { type: "solid", color: "#000000" },
      layers: [],
      warnings: [],
    };
    expect(collectResourceUrls(layout)).toEqual([]);
  });
});

describe("loadResources", () => {
  it("lädt jede Adresse einmal per fetch und erzeugt ein Bitmap", async () => {
    const fetchImpl = vi.fn((_url: string) => Promise.resolve(ok()));
    const createBitmap = vi.fn((_blob: Blob) => Promise.resolve(bitmapFor("neu")));
    const result = await loadResources(["a", "b", "a"], { fetchImpl, createBitmap });
    expect(fetchImpl.mock.calls.map((call) => call[0]).sort()).toEqual(["a", "b"]);
    expect([...result.bitmaps.keys()].sort()).toEqual(["a", "b"]);
    expect(result.failed).toEqual([]);
  });

  it("übernimmt vorhandene Bitmaps ohne neu zu laden", async () => {
    const known = bitmapFor("a");
    const fetchImpl = vi.fn((_url: string) => Promise.resolve(ok()));
    const createBitmap = vi.fn((_blob: Blob) => Promise.resolve(bitmapFor("neu")));
    const result = await loadResources(["a", "b"], { fetchImpl, createBitmap }, new Map([["a", known]]));
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual(["b"]);
    expect(result.bitmaps.get("a")).toBe(known);
  });

  it("sammelt Fehler, ohne die übrigen Adressen abzubrechen", async () => {
    const fetchImpl = (url: string): Promise<FetchedResponse> => {
      if (url === "netz") return Promise.reject(new Error("offline"));
      if (url === "404") return Promise.resolve({ ok: false, blob: () => Promise.resolve(new Blob()) });
      return Promise.resolve(ok());
    };
    const createBitmap = (blob: Blob): Promise<ImageBitmap> =>
      blob.size === 1 ? Promise.resolve(bitmapFor("ok")) : Promise.reject(new Error("kein Bild"));
    const result = await loadResources(["netz", "404", "gut", "kaputt"], {
      fetchImpl: (url) =>
        url === "kaputt" ? Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob()) }) : fetchImpl(url),
      createBitmap,
    });
    expect([...result.bitmaps.keys()]).toEqual(["gut"]);
    expect(result.failed.sort()).toEqual(["404", "kaputt", "netz"]);
  });

  it("nutzt ohne Angabe fetch und createImageBitmap der Umgebung", async () => {
    const fetchSpy = vi.fn((_url: string) => Promise.resolve(ok()));
    const bitmapSpy = vi.fn((_blob: Blob, _options?: ImageBitmapOptions) => Promise.resolve(bitmapFor("x")));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("createImageBitmap", bitmapSpy);
    try {
      const result = await loadResources(["u"]);
      expect(result.bitmaps.size).toBe(1);
      expect(fetchSpy).toHaveBeenCalledWith("u");
      expect(bitmapSpy.mock.calls[0]?.[1]).toEqual({ imageOrientation: "from-image" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("disposeBitmaps", () => {
  it("gibt jedes Bitmap frei", () => {
    const a = bitmapFor("a");
    const b = bitmapFor("b");
    disposeBitmaps([a, b]);
    expect(a.close).toHaveBeenCalledOnce();
    expect(b.close).toHaveBeenCalledOnce();
  });
});

describe("fontsOfTemplate", () => {
  it("nennt jede Schrift mit Gewicht einmal", () => {
    const text = (id: string, family: string, weight: number) =>
      ({
        type: "text",
        id,
        slot: id,
        rect: { x: 0, y: 0, width: 1, height: 1 },
        fontFamily: family,
        fontWeight: weight,
        sizePx: 10,
        minSizePx: 5,
        lineHeight: 1,
        letterSpacingEm: 0,
        color: "#000000",
        align: "left",
        valign: "top",
        transform: "none",
        maxLines: 1,
        defaultText: "",
      }) as const;
    const fonts = fontsOfTemplate({
      layers: [
        text("a", "Anybody", 800),
        text("b", "Anybody", 800),
        text("c", "Anybody", 400),
        text("d", "Martian Mono", 500),
        { type: "grain", id: "g", opacity: 0, seed: 0 },
      ],
    });
    expect(fonts).toEqual([
      { family: "Anybody", weight: 800 },
      { family: "Anybody", weight: 400 },
      { family: "Martian Mono", weight: 500 },
    ]);
  });
});

describe("ensureFonts", () => {
  it("lädt jede Schrift mit Beispieltext und wartet auf ready", async () => {
    const order: string[] = [];
    const loader: FontLoader = {
      load: vi.fn((font: string, text?: string) => {
        order.push(`load ${font} ${text ?? ""}`);
        return Promise.resolve([]);
      }),
      ready: Promise.resolve().then(() => order.push("ready")),
    };
    await ensureFonts([{ family: "Anybody", weight: 800 }], loader);
    expect(order[0]).toMatch(/^load 800 16px "Anybody", sans-serif .*Ä/);
    expect(order.at(-1)).toBe("ready");
  });

  it("verträgt eine Schrift, die sich nicht laden lässt", async () => {
    const loader: FontLoader = { load: () => Promise.reject(new Error("fehlt")), ready: Promise.resolve() };
    await expect(ensureFonts([{ family: "Nope", weight: 400 }], loader)).resolves.toBeUndefined();
  });

  it("tut ohne Schriftenverwaltung nichts", async () => {
    await expect(ensureFonts([{ family: "Anybody", weight: 800 }], null)).resolves.toBeUndefined();
  });

  it("nimmt ohne Angabe document.fonts, falls vorhanden", async () => {
    const load = vi.fn(() => Promise.resolve([]));
    Object.defineProperty(document, "fonts", { value: { load, ready: Promise.resolve() }, configurable: true });
    try {
      await ensureFonts([{ family: "Anybody", weight: 800 }]);
      expect(load).toHaveBeenCalledOnce();
    } finally {
      Reflect.deleteProperty(document, "fonts");
    }
  });

  it("kommt unter jsdom ohne document.fonts ohne Fehler durch", async () => {
    await expect(ensureFonts([{ family: "Anybody", weight: 800 }])).resolves.toBeUndefined();
  });
});
