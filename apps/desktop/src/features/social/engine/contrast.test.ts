import { describe, expect, it } from "vitest";
import {
  blendOver,
  contrastRatio,
  fillColors,
  meetsAA,
  parseHexColor,
  relativeLuminance,
  worstContrast,
} from "./contrast";

const white = { r: 255, g: 255, b: 255 };
const black = { r: 0, g: 0, b: 0 };

describe("parseHexColor", () => {
  it("liest Kurz- und Langform, mit oder ohne Raute, in beliebiger Schreibweise", () => {
    expect(parseHexColor("#0d0d0d")).toEqual({ r: 13, g: 13, b: 13, a: 1 });
    expect(parseHexColor("E4F531")).toEqual({ r: 228, g: 245, b: 49, a: 1 });
    expect(parseHexColor("#f80")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
  });

  it("liest den Alphakanal in Kurz- und Langform", () => {
    expect(parseHexColor("#ff000080")?.a).toBeCloseTo(128 / 255, 10);
    expect(parseHexColor("#f008")?.a).toBeCloseTo(136 / 255, 10);
  });

  it("liefert null für Ungültiges", () => {
    for (const bad of ["", "#12", "#12345", "#1234567", "#ggg", "rot", "#12 456"]) {
      expect(parseHexColor(bad)).toBeNull();
    }
  });
});

describe("Kontrast", () => {
  it("kennt die Eckwerte der Leuchtdichte", () => {
    expect(relativeLuminance(white)).toBeCloseTo(1, 10);
    expect(relativeLuminance(black)).toBe(0);
  });

  it("gibt Schwarz auf Weiß 21:1, gleiche Farben 1:1, unabhängig von der Reihenfolge", () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 10);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 10);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 10);
  });

  it("trifft die bekannten Grenzwerte: #767676 auf Weiß besteht, #777777 nicht", () => {
    const grey = (hex: string) => parseHexColor(hex) ?? black;
    expect(contrastRatio(grey("#767676"), white)).toBeCloseTo(4.54, 2);
    expect(contrastRatio(grey("#777777"), white)).toBeCloseTo(4.48, 2);
    expect(meetsAA("#767676", "#ffffff", false)).toBe(true);
    expect(meetsAA("#777777", "#ffffff", false)).toBe(false);
  });

  it("senkt die Schwelle für großen Text auf 3:1", () => {
    expect(meetsAA("#949494", "#ffffff", false)).toBe(false);
    expect(meetsAA("#949494", "#ffffff", true)).toBe(true);
    expect(meetsAA("#aaaaaa", "#ffffff", true)).toBe(false);
  });

  it("behandelt ungültige Farben als nicht erfüllt", () => {
    expect(meetsAA("kaputt", "#ffffff", false)).toBe(false);
    expect(meetsAA("#000000", "", true)).toBe(false);
  });

  it("besteht das Markenpaar Papier auf Tinte", () => {
    expect(meetsAA("#efeee9", "#0d0d0d", false)).toBe(true);
  });
});

describe("blendOver", () => {
  it("mischt nach Deckkraft und begrenzt sie auf 0 … 1", () => {
    expect(blendOver(black, white, 0.5)).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
    expect(blendOver(black, white, 2)).toEqual(black);
    expect(blendOver(black, white, -1)).toEqual(white);
  });
});

describe("fillColors", () => {
  it("liefert bei Vollton die Farbe", () => {
    expect(fillColors({ type: "solid", color: "#ff0000" })).toEqual([{ r: 255, g: 0, b: 0, a: 1 }]);
    expect(fillColors({ type: "solid", color: "kaputt" })).toBeNull();
  });

  it("liefert bei Verlauf alle Stopps und überspringt ungültige", () => {
    const colors = fillColors({
      type: "linearGradient",
      angleDeg: 90,
      stops: [
        { at: 0, color: "#000000" },
        { at: 0.5, color: "kaputt" },
        { at: 1, color: "#ffffff" },
      ],
    });
    expect(colors).toHaveLength(2);
    expect(fillColors({ type: "linearGradient", angleDeg: 0, stops: [] })).toBeNull();
  });

  it("liefert bei Bild null (nicht prüfbar)", () => {
    expect(fillColors({ type: "image", url: "cyasset:bild", fit: "cover" })).toBeNull();
  });
});

describe("worstContrast", () => {
  it("nimmt den ungünstigsten Grund", () => {
    const fg = { r: 255, g: 255, b: 255, a: 1 };
    const worst = worstContrast(fg, [black, { r: 200, g: 200, b: 200 }]);
    expect(worst).toBeCloseTo(contrastRatio(fg, { r: 200, g: 200, b: 200 }), 10);
  });

  it("legt Text mit Alphakanal über den Grund", () => {
    const half = { r: 0, g: 0, b: 0, a: 0.5 };
    expect(worstContrast(half, [white])).toBeCloseTo(contrastRatio({ r: 127.5, g: 127.5, b: 127.5 }, white), 10);
  });

  it("liefert null ohne Grund", () => {
    expect(worstContrast({ r: 0, g: 0, b: 0, a: 1 }, [])).toBeNull();
  });
});
