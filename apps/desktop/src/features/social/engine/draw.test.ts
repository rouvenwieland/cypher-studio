import { describe, expect, it } from "vitest";
import { gradientLine } from "./draw-math";
import { drawSocial, pathRoundedRect, type BitmapMap } from "./draw";
import type { PlacedLayer, PlacedText, SocialLayout } from "./layout";
import type { Canvas2D } from "./canvas-text";

interface Call {
  method: string;
  args: unknown[];
}

interface Recorder {
  ctx: Canvas2D;
  calls: Call[];
  /** Zuletzt gesetzter Wert einer Eigenschaft. */
  prop(name: string): unknown;
  methods(name: string): unknown[][];
}

/** Zeichenkontext, der alle Aufrufe und Zuweisungen aufzeichnet. Es wird nichts gezeichnet. */
function createRecorder(options: { letterSpacing: boolean } = { letterSpacing: true }): Recorder {
  const calls: Call[] = [];
  const props = new Map<string, unknown>();
  const handler: ProxyHandler<object> = {
    get(_target, key) {
      if (typeof key !== "string") return undefined;
      if (props.has(key)) return props.get(key);
      if (key === "measureText") return (text: string) => ({ width: text.length * 10 });
      if (key === "createLinearGradient") {
        return (...args: unknown[]) => {
          const gradient = {
            stops: [] as unknown[][],
            addColorStop: (...stop: unknown[]) => gradient.stops.push(stop),
          };
          calls.push({ method: key, args });
          calls.push({ method: "gradient", args: [gradient] });
          return gradient;
        };
      }
      if (key === "getImageData") {
        return (...args: unknown[]) => {
          calls.push({ method: key, args });
          const [, , width, height] = args as [number, number, number, number];
          return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(128) };
        };
      }
      return (...args: unknown[]) => {
        calls.push({ method: key, args });
      };
    },
    set(_target, key, value) {
      if (typeof key === "string") {
        calls.push({ method: `set ${key}`, args: [value] });
        props.set(key, value);
      }
      return true;
    },
    has(_target, key) {
      return key === "letterSpacing" ? options.letterSpacing : typeof key === "string" && props.has(key);
    },
  };
  return {
    ctx: new Proxy({}, handler) as unknown as Canvas2D,
    calls,
    prop: (name) => props.get(name),
    methods: (name) => calls.filter((call) => call.method === name).map((call) => call.args),
  };
}

const bitmap = (width: number, height: number): ImageBitmap => ({ width, height, close: () => undefined });

function layout(
  layers: PlacedLayer[],
  background: SocialLayout["background"] = { type: "solid", color: "#101010" },
): SocialLayout {
  return { size: { width: 100, height: 200 }, background, layers, warnings: [] };
}

function text(extra: Partial<PlacedText> = {}): PlacedText {
  return {
    type: "text",
    id: "titel",
    slot: "titel",
    rect: { x: 10, y: 20, width: 80, height: 60 },
    fontFamily: "Anybody",
    fontWeight: 800,
    fontSizePx: 40,
    letterSpacingEm: -0.05,
    color: "#eeeeee",
    align: "center",
    valign: "middle",
    lineHeightPx: 36,
    lines: [
      { text: "EINS", x: 50, y: 38, width: 80 },
      { text: "ZWEI", x: 50, y: 74, width: 80 },
    ],
    bounds: { x: 10, y: 20, width: 80, height: 72 },
    truncated: false,
    overflowsHeight: false,
    ...extra,
  };
}

const empty: BitmapMap = new Map();

describe("drawSocial: Grundablauf", () => {
  it("löscht, füllt den Hintergrund und lässt save/restore ausgeglichen", () => {
    const rec = createRecorder();
    drawSocial(rec.ctx, layout([text()]), empty);
    expect(rec.methods("clearRect")).toEqual([[0, 0, 100, 200]]);
    expect(rec.methods("setTransform")).toEqual([[1, 0, 0, 1, 0, 0]]);
    expect(rec.methods("save").length).toBe(rec.methods("restore").length);
    expect(rec.prop("globalCompositeOperation")).toBe("source-over");
    // Hintergrund: Farbe gesetzt, dann Rechteck über die ganze Leinwand gefüllt
    const names = rec.calls.map((call) => call.method);
    expect(names.indexOf("clearRect")).toBeLessThan(names.indexOf("fill"));
    expect(rec.methods("rect")).toContainEqual([0, 0, 100, 200]);
    expect(rec.calls.find((call) => call.method === "set fillStyle")?.args).toEqual(["#101010"]);
  });

  it("zeichnet einen Verlaufshintergrund mit Endpunkten aus dem Winkel", () => {
    const rec = createRecorder();
    const background: SocialLayout["background"] = {
      type: "linearGradient",
      angleDeg: 90,
      stops: [
        { at: 0, color: "#000000" },
        { at: 2, color: "#ffffff" },
      ],
    };
    drawSocial(rec.ctx, layout([], background), empty);
    const line = gradientLine(90, { x: 0, y: 0, width: 100, height: 200 });
    expect(rec.methods("createLinearGradient")).toEqual([[line.x0, line.y0, line.x1, line.y1]]);
    const gradient = rec.calls.find((call) => call.method === "gradient")?.args[0] as { stops: unknown[][] };
    // Stopp-Lage wird auf 0 … 1 begrenzt
    expect(gradient.stops).toEqual([
      [0, "#000000"],
      [1, "#ffffff"],
    ]);
  });

  it("zeichnet einen Bild-Hintergrund mit berechnetem Zuschnitt, wenn das Layout keinen hat", () => {
    const rec = createRecorder();
    const map: BitmapMap = new Map([["bg", bitmap(200, 200)]]);
    drawSocial(rec.ctx, layout([], { type: "image", url: "bg", fit: "cover", crop: null }), map);
    // 100 × 200 aus 200 × 200: Höhe voll, Breite 100 aus der Mitte
    expect(rec.methods("drawImage")).toEqual([[map.get("bg"), 50, 0, 100, 200, 0, 0, 100, 200]]);
  });

  it("überspringt einen Bild-Hintergrund, dessen Bitmap fehlt", () => {
    const rec = createRecorder();
    drawSocial(rec.ctx, layout([], { type: "image", url: "fehlt", fit: "cover", crop: null }), empty);
    expect(rec.methods("drawImage")).toEqual([]);
  });

  it("zeichnet die Ebenen in der Reihenfolge der Liste", () => {
    const rec = createRecorder();
    const shape: PlacedLayer = {
      type: "shape",
      id: "balken",
      rect: { x: 0, y: 0, width: 10, height: 10 },
      fill: { type: "solid", color: "#e4f531" },
      radiusPx: 0,
      opacity: 1,
    };
    drawSocial(rec.ctx, layout([shape, text()]), empty);
    const names = rec.calls.map((call) => call.method);
    const lastFill = names.lastIndexOf("fill");
    expect(lastFill).toBeGreaterThan(-1);
    expect(lastFill).toBeLessThan(names.indexOf("fillText"));
  });
});

describe("drawSocial: Bild", () => {
  const layer = (extra: Partial<Extract<PlacedLayer, { type: "image" }>> = {}): PlacedLayer => ({
    type: "image",
    id: "bild",
    slot: "bild",
    rect: { x: 10, y: 20, width: 80, height: 60 },
    fit: "cover",
    radiusPx: 0,
    url: "u",
    crop: { src: { x: 1, y: 2, width: 3, height: 4 }, dst: { x: 10, y: 20, width: 80, height: 60 }, scale: 20 },
    ...extra,
  });

  it("beschneidet auf das Zielrechteck und zeichnet den Ausschnitt", () => {
    const rec = createRecorder();
    const map: BitmapMap = new Map([["u", bitmap(10, 10)]]);
    drawSocial(rec.ctx, layout([layer()]), map);
    expect(rec.methods("clip")).toHaveLength(1);
    expect(rec.methods("drawImage")).toEqual([[map.get("u"), 1, 2, 3, 4, 10, 20, 80, 60]]);
    expect(rec.prop("imageSmoothingQuality")).toBe("high");
  });

  it("rundet die Ecken über arcTo", () => {
    const rec = createRecorder();
    const map: BitmapMap = new Map([["u", bitmap(10, 10)]]);
    drawSocial(rec.ctx, layout([layer({ radiusPx: 12 })]), map);
    expect(rec.methods("arcTo")).toHaveLength(4);
    expect(rec.methods("arcTo")[0]).toEqual([90, 20, 90, 80, 12]);
  });

  it("zeichnet nichts ohne Adresse oder ohne geladenes Bitmap", () => {
    const rec = createRecorder();
    drawSocial(rec.ctx, layout([layer({ url: null }), layer({ url: "fehlt" })]), new Map([["u", bitmap(10, 10)]]));
    expect(rec.methods("drawImage")).toEqual([]);
  });

  it("berechnet fehlenden Zuschnitt aus dem Bitmap (contain)", () => {
    const rec = createRecorder();
    const map: BitmapMap = new Map([["u", bitmap(100, 50)]]);
    drawSocial(
      rec.ctx,
      layout([layer({ fit: "contain", crop: null, rect: { x: 0, y: 0, width: 200, height: 200 } })]),
      map,
    );
    expect(rec.methods("drawImage")).toEqual([[map.get("u"), 0, 0, 100, 50, 0, 50, 200, 100]]);
  });

  it("zeichnet ein Logo eingepasst (contain) in sein Rechteck", () => {
    const rec = createRecorder();
    const map: BitmapMap = new Map([["logo", bitmap(400, 100)]]);
    const logo: PlacedLayer = {
      type: "logo",
      id: "logo",
      rect: { x: 10, y: 10, width: 100, height: 100 },
      variant: "light",
      url: "logo",
    };
    drawSocial(rec.ctx, layout([logo, { ...logo, url: null }, { ...logo, url: "fehlt" }]), map);
    expect(rec.methods("drawImage")).toEqual([[map.get("logo"), 0, 0, 400, 100, 10, 47.5, 100, 25]]);
  });
});

describe("drawSocial: Text", () => {
  it("setzt Schrift, Ausrichtung, Grundlinie Mitte, Farbe und zeichnet jede Zeile an ihrer Stelle", () => {
    const rec = createRecorder();
    drawSocial(rec.ctx, layout([text()]), empty);
    expect(rec.prop("font")).toBe('800 40px "Anybody", sans-serif');
    expect(rec.prop("textAlign")).toBe("center");
    expect(rec.prop("textBaseline")).toBe("middle");
    expect(rec.prop("letterSpacing")).toBe("-2px");
    expect(rec.calls.filter((call) => call.method === "set fillStyle").map((call) => call.args[0])).toContain(
      "#eeeeee",
    );
    expect(rec.methods("fillText")).toEqual([
      ["EINS", 50, 38],
      ["ZWEI", 50, 74],
    ]);
  });

  it("lässt die Laufweite weg, wenn die Engine sie nicht kennt", () => {
    const rec = createRecorder({ letterSpacing: false });
    drawSocial(rec.ctx, layout([text()]), empty);
    expect(rec.prop("letterSpacing")).toBeUndefined();
    expect(rec.methods("fillText")).toHaveLength(2);
  });

  it("zeichnet leeren Text nicht", () => {
    const rec = createRecorder();
    drawSocial(rec.ctx, layout([text({ lines: [], bounds: null })]), empty);
    expect(rec.methods("fillText")).toEqual([]);
  });
});

describe("drawSocial: Form, Korn, Zeilen", () => {
  it("füllt Formen mit Deckkraft, Radius und Verlauf", () => {
    const rec = createRecorder();
    const shape: PlacedLayer = {
      type: "shape",
      id: "karte",
      rect: { x: 0, y: 0, width: 50, height: 20 },
      fill: {
        type: "linearGradient",
        angleDeg: 180,
        stops: [
          { at: 0, color: "#111111" },
          { at: 1, color: "#222222" },
        ],
      },
      radiusPx: 6,
      opacity: 0.4,
    };
    drawSocial(rec.ctx, layout([shape]), empty);
    expect(rec.calls.filter((call) => call.method === "set globalAlpha").map((call) => call.args[0])).toEqual([1, 0.4]);
    expect(rec.methods("arcTo")).toHaveLength(4);
    const line = gradientLine(180, shape.rect);
    expect(rec.methods("createLinearGradient")).toContainEqual([line.x0, line.y0, line.x1, line.y1]);
  });

  it("zeichnet Bildfüllungen von Formen mit Radius", () => {
    const rec = createRecorder();
    const map: BitmapMap = new Map([["f", bitmap(40, 40)]]);
    const shape: PlacedLayer = {
      type: "shape",
      id: "karte",
      rect: { x: 5, y: 5, width: 40, height: 40 },
      fill: { type: "image", url: "f", fit: "cover", crop: null },
      radiusPx: 8,
      opacity: 1,
    };
    drawSocial(rec.ctx, layout([shape]), map);
    expect(rec.methods("drawImage")).toEqual([[map.get("f"), 0, 0, 40, 40, 5, 5, 40, 40]]);
    expect(rec.methods("clip")).toHaveLength(1);
  });

  it("legt Korn deterministisch über das Bild", () => {
    const run = () => {
      const rec = createRecorder();
      drawSocial(rec.ctx, layout([{ type: "grain", id: "korn", opacity: 0.1, seed: 12 }]), empty);
      return rec;
    };
    const first = run();
    expect(first.methods("getImageData")).toEqual([[0, 0, 100, 200]]);
    const put = first.methods("putImageData");
    expect(put).toHaveLength(1);
    const data = (put[0]?.[0] as { data: Uint8ClampedArray }).data;
    expect(data.some((value) => value !== 128)).toBe(true);
    const again = (run().methods("putImageData")[0]?.[0] as { data: Uint8ClampedArray }).data;
    expect(Array.from(again)).toEqual(Array.from(data));
  });

  it("zeichnet Zeilen mit Abstand, Dicke und Deckkraft", () => {
    const rec = createRecorder();
    drawSocial(rec.ctx, layout([{ type: "scanlines", id: "zeilen", opacity: 0.06, spacingPx: 50 }]), empty);
    expect(rec.methods("fillRect")).toEqual([
      [0, 0, 100, 25],
      [0, 50, 100, 25],
      [0, 100, 100, 25],
      [0, 150, 100, 25],
    ]);
    expect(rec.prop("globalAlpha")).toBe(0.06);
  });
});

describe("pathRoundedRect", () => {
  it("nimmt bei Radius 0 ein einfaches Rechteck", () => {
    const rec = createRecorder();
    pathRoundedRect(rec.ctx, { x: 1, y: 2, width: 3, height: 4 }, 0);
    expect(rec.methods("rect")).toEqual([[1, 2, 3, 4]]);
    expect(rec.methods("arcTo")).toEqual([]);
  });

  it("begrenzt den Radius auf die halbe kürzere Seite und schließt den Pfad", () => {
    const rec = createRecorder();
    pathRoundedRect(rec.ctx, { x: 0, y: 0, width: 100, height: 20 }, 50);
    expect(rec.methods("arcTo").map((args) => args[4])).toEqual([10, 10, 10, 10]);
    expect(rec.methods("closePath")).toHaveLength(1);
  });
});
