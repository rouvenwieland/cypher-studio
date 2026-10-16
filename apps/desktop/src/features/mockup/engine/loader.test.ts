import { afterEach, describe, expect, it, vi } from "vitest";
import { BitmapLoader } from "./loader";
import type { AssetRole } from "./plan";

interface FakeBitmap {
  width: number;
  height: number;
  closed: boolean;
  close(): void;
}

function bitmap(width = 10, height = 10): FakeBitmap {
  const state: FakeBitmap = {
    width,
    height,
    closed: false,
    close() {
      state.closed = true;
    },
  };
  return state;
}

function setup(maxBytes = 1000) {
  const decoded: { url: string; role: AssetRole; bitmap: FakeBitmap }[] = [];
  const fetched: string[] = [];
  const loader = new BitmapLoader({
    maxBytes,
    fetchBlob: (url) => {
      fetched.push(url);
      return Promise.resolve(new Blob([url]));
    },
    decode: async (blob, role) => {
      const url = await blob.text();
      const made = bitmap();
      decoded.push({ url, role, bitmap: made });
      return made;
    },
  });
  return { loader, decoded, fetched };
}

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BitmapLoader: Laden und Teilen", () => {
  it("lädt ein Bild einmal, auch bei gleichzeitigen Anfragen", async () => {
    const { loader, fetched } = setup();
    const [a, b] = await Promise.all([
      loader.load({ url: "x.png", role: "layer" }),
      loader.load({ url: "x.png", role: "layer" }),
    ]);
    expect(a).toBe(b);
    expect(fetched).toEqual(["x.png"]);
    expect(await loader.load({ url: "x.png", role: "layer" })).toBe(a);
    expect(fetched).toHaveLength(1);
    expect(a).toMatchObject({ width: 10, height: 10 });
  });

  it("trennt gleiche URLs nach Rolle (unterschiedliche Dekodierung)", async () => {
    const { loader, decoded } = setup();
    await loader.load({ url: "x.png", role: "layer" });
    await loader.load({ url: "x.png", role: "design" });
    expect(decoded.map((d) => d.role)).toEqual(["layer", "design"]);
    expect(loader.size).toBe(2);
  });

  it("merkt sich Fehler nicht und meldet je nach Rolle den passenden Code", async () => {
    let attempts = 0;
    const loader = new BitmapLoader({
      fetchBlob: () => {
        attempts++;
        return attempts === 1 ? Promise.reject(new Error("HTTP 404")) : Promise.resolve(new Blob(["ok"]));
      },
      decode: () => Promise.resolve(bitmap()),
    });
    await expect(loader.load({ url: "a.png", role: "design" })).rejects.toMatchObject({
      code: "design-load-failed",
      message: expect.stringContaining("HTTP 404") as string,
    });
    expect(loader.size).toBe(0);
    await expect(loader.load({ url: "a.png", role: "design" })).resolves.toMatchObject({ width: 10 });

    const broken = new BitmapLoader({
      fetchBlob: () => Promise.reject(new Error("tot")),
      decode: () => Promise.reject(new Error("unreachable")),
    });
    await expect(broken.load({ url: "b.png", role: "layer" })).rejects.toMatchObject({ code: "layer-load-failed" });
    await expect(broken.load({ url: "b.png", role: "background" })).rejects.toMatchObject({
      code: "layer-load-failed",
    });
  });

  it("fängt auch synchron werfende Abholer und Dekodierfehler ab", async () => {
    const throwing = new BitmapLoader({
      fetchBlob: () => {
        throw new Error("sofort");
      },
    });
    await expect(throwing.load({ url: "a.png", role: "layer" })).rejects.toMatchObject({ code: "layer-load-failed" });
    const undecodable = new BitmapLoader({
      fetchBlob: () => Promise.resolve(new Blob(["x"])),
      decode: () => Promise.reject(new Error("kein Bild")),
    });
    await expect(undecodable.load({ url: "a.png", role: "design" })).rejects.toMatchObject({
      code: "design-load-failed",
    });
  });
});

describe("BitmapLoader: Standard-Abholer und -Dekodierer", () => {
  it("liest per fetch, prüft den Status und dekodiert Datenebenen ohne Farbumrechnung", async () => {
    const calls: { options: unknown }[] = [];
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(
        url.includes("missing")
          ? { ok: false, status: 404 }
          : { ok: true, status: 200, blob: () => Promise.resolve(new Blob(["bild"])) },
      ),
    );
    vi.stubGlobal("createImageBitmap", (_blob: Blob, options?: unknown) => {
      calls.push({ options });
      return Promise.resolve(bitmap());
    });
    const loader = new BitmapLoader();
    await loader.load({ url: "cyasset://t/mask.png", role: "layer" });
    await loader.load({ url: "cyfile://motif.png", role: "design" });
    await loader.load({ url: "cyasset://t/bg.png", role: "background" });
    expect(calls[0]?.options).toEqual({ colorSpaceConversion: "none" });
    expect(calls[1]?.options).toBeUndefined();
    expect(calls[2]?.options).toBeUndefined();
    await expect(loader.load({ url: "cyasset://t/missing.png", role: "layer" })).rejects.toMatchObject({
      code: "layer-load-failed",
      message: expect.stringContaining("HTTP 404") as string,
    });
  });

  it("liest Datenebenen ohne Optionen neu, wenn die WebView die Option ablehnt", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["bild"])) }),
    );
    vi.stubGlobal("createImageBitmap", (_blob: Blob, options?: unknown) => {
      calls.push(options);
      return options ? Promise.reject(new TypeError("colorSpaceConversion")) : Promise.resolve(bitmap());
    });
    const loader = new BitmapLoader();
    await expect(loader.load({ url: "cyasset://t/mask.png", role: "layer" })).resolves.toMatchObject({ width: 10 });
    expect(calls).toEqual([{ colorSpaceConversion: "none" }, undefined]);

    // ein wirklich defektes Bild scheitert auch im zweiten Versuch
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("kein Bild")));
    await expect(loader.load({ url: "cyasset://t/broken.png", role: "layer" })).rejects.toMatchObject({
      code: "layer-load-failed",
    });
  });
});

describe("BitmapLoader: Zwischenspeicher", () => {
  it("kürzt nach letzter Nutzung (LRU) auf das Byte-Budget und schließt verdrängte Bitmaps", async () => {
    const { loader, decoded } = setup(1000); // jedes Bitmap 400 Byte
    await loader.load({ url: "a", role: "layer" });
    await loader.load({ url: "b", role: "layer" });
    await loader.load({ url: "c", role: "layer" });
    await loader.load({ url: "a", role: "layer" }); // a wird wieder „neu“
    expect(loader.cachedBytes).toBe(1200);
    loader.trim();
    expect(loader.cachedBytes).toBe(800);
    const closed = decoded.filter((d) => d.bitmap.closed).map((d) => d.url);
    expect(closed).toEqual(["b"]);
    // a und c bleiben ohne neuen Abruf verfügbar
    const before = decoded.length;
    await loader.load({ url: "a", role: "layer" });
    await loader.load({ url: "c", role: "layer" });
    expect(decoded).toHaveLength(before);
  });

  it("verdrängt nichts, was noch lädt, und tut nichts unter dem Budget", async () => {
    const { loader, decoded } = setup(10_000);
    await loader.load({ url: "a", role: "layer" });
    loader.trim();
    expect(decoded[0]?.bitmap.closed).toBe(false);

    let release: () => void = () => undefined;
    const slow = new BitmapLoader({
      maxBytes: 0,
      fetchBlob: () =>
        new Promise<Blob>((resolve) => {
          release = () => {
            resolve(new Blob(["z"]));
          };
        }),
      decode: () => Promise.resolve(bitmap()),
    });
    const pending = slow.load({ url: "z", role: "layer" });
    slow.trim(); // noch im Laden: bleibt
    expect(slow.size).toBe(1);
    await tick();
    release();
    await pending;
    slow.trim();
    expect(slow.size).toBe(0);
  });

  it("invalidate verwirft eine URL (alle Rollen) oder alles und lädt danach neu", async () => {
    const { loader, decoded, fetched } = setup();
    await loader.load({ url: "a", role: "layer" });
    await loader.load({ url: "a", role: "design" });
    await loader.load({ url: "b", role: "layer" });
    loader.invalidate("a");
    expect(decoded.filter((d) => d.url === "a").every((d) => d.bitmap.closed)).toBe(true);
    expect(decoded.find((d) => d.url === "b")?.bitmap.closed).toBe(false);
    expect(loader.size).toBe(1);
    await loader.load({ url: "a", role: "layer" });
    expect(fetched.filter((u) => u === "a")).toHaveLength(3);
    loader.invalidate();
    expect(loader.size).toBe(0);
    expect(decoded.every((d) => d.bitmap.closed)).toBe(true);
  });

  it("schließt ein Bild, das während des Ladens verworfen wurde, und meldet disposed", async () => {
    let release: () => void = () => undefined;
    const made = bitmap();
    const loader = new BitmapLoader({
      fetchBlob: () =>
        new Promise<Blob>((resolve) => {
          release = () => {
            resolve(new Blob(["x"]));
          };
        }),
      decode: () => Promise.resolve(made),
    });
    const pending = loader.load({ url: "a", role: "layer" });
    loader.invalidate("a");
    await tick();
    release();
    await expect(pending).rejects.toMatchObject({ code: "disposed" });
    expect(made.closed).toBe(true);
    expect(loader.size).toBe(0);
  });

  it("dispose schließt alles; danach schlagen Anfragen mit disposed fehl", async () => {
    const { loader, decoded } = setup();
    await loader.load({ url: "a", role: "layer" });
    loader.dispose();
    expect(decoded[0]?.bitmap.closed).toBe(true);
    await expect(loader.load({ url: "a", role: "layer" })).rejects.toMatchObject({ code: "disposed" });
  });
});
