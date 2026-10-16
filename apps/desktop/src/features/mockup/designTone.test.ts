import { describe, expect, it } from "vitest";
import { contrastOfLuminance } from "./engine/color";
import { LOW_CONTRAST, lowContrastShare, summarizePixels } from "./designTone";

/** Baut ein RGBA-Raster aus (r, g, b, a)-Tupeln. */
function px(...p: [number, number, number, number][]): Uint8ClampedArray {
  return new Uint8ClampedArray(p.flat());
}

describe("contrastOfLuminance", () => {
  it("liefert 21 für Schwarz auf Weiß und 1 für Gleiches", () => {
    expect(contrastOfLuminance(0, 1)).toBeCloseTo(21, 5);
    expect(contrastOfLuminance(1, 0)).toBeCloseTo(21, 5);
    expect(contrastOfLuminance(0.4, 0.4)).toBe(1);
  });
});

describe("summarizePixels", () => {
  it("zählt Transparenz und überspringt unsichtbare Pixel", () => {
    const s = summarizePixels(px([255, 255, 255, 255], [0, 0, 0, 0], [0, 0, 0, 255], [10, 10, 10, 100]));
    expect(s.luminances.length).toBe(2);
    expect(s.transparentShare).toBeCloseTo(0.5, 5);
  });

  it("meldet 0 Transparenz bei vollflächigem Bild", () => {
    const s = summarizePixels(px([200, 10, 10, 255], [10, 200, 10, 255]));
    expect(s.transparentShare).toBe(0);
  });

  it("verkraftet ein leeres Raster", () => {
    const s = summarizePixels(new Uint8ClampedArray(0));
    expect(s.luminances.length).toBe(0);
    expect(s.transparentShare).toBe(0);
  });
});

describe("lowContrastShare", () => {
  const white = summarizePixels(px([255, 255, 255, 255], [250, 250, 250, 255], [0, 0, 0, 255], [20, 20, 20, 255]));

  it("meldet helle Motivpixel auf weißem Shirt als kaum abgehoben", () => {
    expect(lowContrastShare(white, "#ffffff")).toBeCloseTo(0.5, 5);
  });

  it("meldet dunkle Motivpixel auf schwarzem Shirt als kaum abgehoben", () => {
    expect(lowContrastShare(white, "#000000")).toBeCloseTo(0.5, 5);
  });

  it("liefert 0 ohne sichtbare Pixel", () => {
    expect(lowContrastShare(summarizePixels(px([0, 0, 0, 0])), "#ffffff")).toBe(0);
  });

  it("nutzt die Schwelle für kaum abgehoben", () => {
    expect(LOW_CONTRAST).toBeGreaterThan(1);
  });
});
