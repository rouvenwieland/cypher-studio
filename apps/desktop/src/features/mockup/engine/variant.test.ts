import { describe, expect, it } from "vitest";
import { parseHexColor, relativeLuminance } from "./color";
import { MockupEngineError } from "./errors";
import { GARMENTS, hex, makeGarment, makeLayers, makeTemplate } from "./test-fixtures";
import { DARK_LUMINANCE_THRESHOLD, exposureForHex, selectVariant } from "./variant";

describe("parseHexColor", () => {
  it("liest kurze, lange und achtstellige Werte", () => {
    expect(parseHexColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor("#141210")).toEqual({ r: 20, g: 18, b: 16 });
    expect(parseHexColor("  #FF8000cc ")).toEqual({ r: 255, g: 128, b: 0 });
  });

  it("wirft bei ungültigen Werten", () => {
    for (const bad of ["", "red", "#12", "#12345", "#gggggg", "141210"]) {
      expect(() => parseHexColor(bad), bad).toThrowError(MockupEngineError);
    }
  });
});

describe("relativeLuminance", () => {
  it("ist 0 für Schwarz und 1 für Weiß", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10);
  });
});

describe("exposureForHex", () => {
  it("ordnet Schwarz und Navy als dunkel, Weiß, Sand und mittleres Grau als hell ein", () => {
    expect(exposureForHex(GARMENTS.schwarz.textileHex)).toBe("dark");
    expect(exposureForHex(GARMENTS.navy.textileHex)).toBe("dark");
    expect(exposureForHex(GARMENTS.weinrot.textileHex)).toBe("dark");
    expect(exposureForHex(GARMENTS.weiss.textileHex)).toBe("light");
    expect(exposureForHex(GARMENTS.sand.textileHex)).toBe("light");
    expect(exposureForHex(GARMENTS.melange.textileHex)).toBe("light");
  });

  it("nutzt die Schwelle als scharfe Grenze", () => {
    // Grau mit Leuchtdichte knapp unter bzw. über der Schwelle suchen
    let darkest = 255;
    for (let v = 0; v <= 255; v++) {
      if (exposureForHex(hex(v, v, v)) === "light") {
        darkest = v;
        break;
      }
    }
    expect(relativeLuminance({ r: darkest, g: darkest, b: darkest })).toBeGreaterThanOrEqual(DARK_LUMINANCE_THRESHOLD);
    expect(relativeLuminance({ r: darkest - 1, g: darkest - 1, b: darkest - 1 })).toBeLessThan(
      DARK_LUMINANCE_THRESHOLD,
    );
  });
});

describe("selectVariant", () => {
  const template = makeTemplate();

  it("wählt die Variante, die die Farbe in colorIds führt", () => {
    const dark = selectVariant(template, "schwarz", GARMENTS.schwarz);
    expect(dark.index).toBe(1);
    expect(dark.variant.exposure).toBe("dark");
    expect(dark.reason).toBe("color-id");
    const light = selectVariant(template, "grau-meliert", GARMENTS.melange);
    expect(light.index).toBe(0);
    expect(light.reason).toBe("color-id");
  });

  it("bevorzugt den Eintrag in colorIds vor der Helligkeit (hellere Farbe in der Dunkel-Variante)", () => {
    const custom = makeTemplate({
      variants: [
        { exposure: "light", layers: makeLayers("l"), colorIds: ["weiss"] },
        { exposure: "dark", layers: makeLayers("d"), colorIds: ["sand"] },
      ],
    });
    expect(selectVariant(custom, "sand", GARMENTS.sand).variant.exposure).toBe("dark");
  });

  it("fällt bei unbekannter Farbe auf die Helligkeit zurück", () => {
    const dark = selectVariant(template, "weinrot", GARMENTS.weinrot);
    expect(dark.variant.exposure).toBe("dark");
    expect(dark.reason).toBe("luminance");
    const light = selectVariant(template, "gelb", GARMENTS.gelb);
    expect(light.variant.exposure).toBe("light");
    expect(light.reason).toBe("luminance");
  });

  it("wirft no-variant, wenn die passende Belichtung fehlt", () => {
    const onlyLight = makeTemplate({
      variants: [{ exposure: "light", layers: makeLayers("l"), colorIds: ["weiss"] }],
    });
    expect(() => selectVariant(onlyLight, "weinrot", GARMENTS.weinrot)).toThrowError(
      expect.objectContaining({ code: "no-variant" }) as Error,
    );
    const none = makeTemplate({ variants: [] });
    expect(() => selectVariant(none, "schwarz", GARMENTS.schwarz)).toThrowError(MockupEngineError);
  });

  it("wirft invalid-input bei ungültigem textileHex im Rückfall", () => {
    const broken = makeGarment("kaputt", "kein-hex");
    expect(() => selectVariant(template, "kaputt", broken)).toThrowError(
      expect.objectContaining({ code: "invalid-input" }) as Error,
    );
  });
});
