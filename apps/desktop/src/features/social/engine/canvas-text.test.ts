import { describe, expect, it, vi } from "vitest";
import {
  applyTextStyle,
  canvasMeasure,
  createFontProbe,
  createScratchContext,
  fontShorthand,
  letterSpacingValue,
  quoteFontFamily,
  type Canvas2D,
} from "./canvas-text";

const font = { family: "Anybody", weight: 800, letterSpacingEm: 0.02 };

/** Minimaler Kontext: `font` wird gespeichert, `measureText` rechnet 0,5 px je Zeichen und Schriftpunkt. */
function fakeContext(withLetterSpacing: boolean): Canvas2D & { letterSpacing?: string } {
  const ctx: { font: string; letterSpacing?: string; measureText(text: string): { width: number } } = {
    font: "",
    measureText(text) {
      const size = /(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? "0";
      return { width: text.length * Number(size) * 0.5 };
    },
  };
  if (withLetterSpacing) ctx.letterSpacing = "0px";
  return ctx as unknown as Canvas2D & { letterSpacing?: string };
}

describe("Schriftangabe", () => {
  it("setzt Namen mit Leerzeichen in Anführungszeichen und schützt Sonderzeichen", () => {
    expect(quoteFontFamily("Atkinson Hyperlegible Next")).toBe('"Atkinson Hyperlegible Next"');
    expect(quoteFontFamily('Ev"il\\Name')).toBe('"Ev\\"il\\\\Name"');
  });

  it("baut den ctx.font-Wert mit Ersatzschrift", () => {
    expect(fontShorthand(800, 230, "Anybody")).toBe('800 230px "Anybody", sans-serif');
    expect(fontShorthand(600, 33.33333, "Martian Mono")).toBe('600 33.333px "Martian Mono", sans-serif');
  });

  it("rechnet die Laufweite von em in Pixel", () => {
    expect(letterSpacingValue(-0.01, 230)).toBe("-2.3px");
    expect(letterSpacingValue(0, 100)).toBe("0px");
  });
});

describe("applyTextStyle", () => {
  it("setzt Schrift und Laufweite, wenn die Engine letterSpacing kennt", () => {
    const ctx = fakeContext(true);
    applyTextStyle(ctx, font, 100);
    expect(ctx.font).toBe('800 100px "Anybody", sans-serif');
    expect(ctx.letterSpacing).toBe("2px");
  });

  it("lässt die Laufweite weg, wenn die Engine sie nicht kennt", () => {
    const ctx = fakeContext(false);
    applyTextStyle(ctx, font, 100);
    expect(ctx.font).toBe('800 100px "Anybody", sans-serif');
    expect("letterSpacing" in ctx).toBe(false);
  });
});

describe("canvasMeasure", () => {
  it("setzt den Stil für die Größe und liefert die gemessene Breite", () => {
    const ctx = fakeContext(true);
    const measure = canvasMeasure(ctx, font);
    expect(measure("abcd", 100)).toBe(200);
    expect(measure("abcd", 50)).toBe(100);
    expect(ctx.letterSpacing).toBe("1px");
  });
});

describe("createFontProbe", () => {
  /** Geladene Schrift misst unabhängig vom Ersatz gleich, sonst bestimmt der Ersatz die Breite. */
  function probeContext(loaded: string[]): Canvas2D {
    const ctx = {
      font: "",
      measureText() {
        const family = /"([^"]+)"/.exec(this.font)?.[1] ?? "";
        if (loaded.includes(family)) return { width: 500 };
        return { width: this.font.includes("monospace") ? 400 : 480 };
      },
    };
    return ctx as unknown as Canvas2D;
  }

  it("erkennt geladene und fehlende Schriften", () => {
    const probe = createFontProbe(probeContext(["Anybody"]));
    expect(probe("Anybody", 800)).toBe(true);
    expect(probe("Martian Mono", 500)).toBe(false);
  });
});

describe("createScratchContext", () => {
  it("meldet unter jsdom keinen Kontext (keine Leinwand)", () => {
    const original = globalThis.OffscreenCanvas;
    // @ts-expect-error Offscreen-Unterstützung für diesen Test entfernen
    delete globalThis.OffscreenCanvas;
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { value: undefined, configurable: true });
    try {
      expect(createScratchContext()).toBeNull();
    } finally {
      if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
      if (original !== undefined) globalThis.OffscreenCanvas = original;
    }
  });

  it("fällt ohne OffscreenCanvas auf ein Canvas-Element zurück", () => {
    const original = globalThis.OffscreenCanvas;
    // @ts-expect-error Offscreen-Unterstützung für diesen Test entfernen
    delete globalThis.OffscreenCanvas;
    const create = vi
      .spyOn(document, "createElement")
      .mockReturnValue({ getContext: () => ({ kind: "dom" }) } as unknown as HTMLElement);
    try {
      expect(createScratchContext()).toEqual({ kind: "dom" });
      expect(create).toHaveBeenCalledWith("canvas");
    } finally {
      create.mockRestore();
      if (original !== undefined) globalThis.OffscreenCanvas = original;
    }
  });

  it("nimmt OffscreenCanvas, wenn vorhanden", () => {
    const fake = { getContext: (kind: string) => ({ kind }) };
    const original = globalThis.OffscreenCanvas;
    globalThis.OffscreenCanvas = class {
      getContext(kind: string) {
        return fake.getContext(kind);
      }
    } as unknown as typeof OffscreenCanvas;
    try {
      expect(createScratchContext()).toEqual({ kind: "2d" });
    } finally {
      if (original === undefined) {
        // @ts-expect-error Ausgangszustand wiederherstellen
        delete globalThis.OffscreenCanvas;
      } else {
        globalThis.OffscreenCanvas = original;
      }
    }
  });
});
