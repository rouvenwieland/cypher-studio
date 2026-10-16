import { describe, expect, it } from "vitest";
import { MockupEngineError } from "./errors";
import { applyMatrix, designMatrix, designRectMm } from "./geometry";
import {
  MAX_CANVAS_PX,
  OPAQUE_FALLBACK_COLOR,
  limitOutput,
  planRender,
  type RenderPlan,
  type RenderStep,
} from "./plan";
import { GARMENTS, hex, makeInput, makeLayers, makeTemplate } from "./test-fixtures";

const kinds = (plan: RenderPlan): string[] => plan.steps.map((s) => s.kind);

function step<K extends RenderStep["kind"]>(plan: RenderPlan, kind: K): Extract<RenderStep, { kind: K }> {
  const found = plan.steps.find((s): s is Extract<RenderStep, { kind: K }> => s.kind === kind);
  if (!found) throw new Error(`step ${kind} missing`);
  return found;
}

function expectCode(fn: () => unknown, code: MockupEngineError["code"]): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MockupEngineError);
    expect((error as MockupEngineError).code).toBe(code);
    return;
  }
  throw new Error("expected an error");
}

describe("planRender: Reihenfolge nach ARCHITEKTUR 5.4", () => {
  it("dunkles Shirt mit Motiv: Hintergrund, Stoff, Motiv, Schatten, Licht, Maske, Zusammenfügen", () => {
    const plan = planRender(makeInput());
    expect(kinds(plan)).toEqual(["background", "fabric", "motif", "shade", "light", "mask", "composite"]);
  });

  it("meliertes Shirt: Melange-Struktur steht zwischen Stoff und Motiv", () => {
    const plan = planRender(makeInput({ colorId: "grau-meliert", garment: GARMENTS.melange }));
    expect(kinds(plan)).toEqual(["background", "fabric", "structure", "motif", "shade", "light", "mask", "composite"]);
    const structure = step(plan, "structure");
    expect(structure.layer).toBe("heather");
    expect(structure.url).toBe("light/heather.png");
  });

  it("ohne Motiv entfällt nur der Motivschritt", () => {
    const plan = planRender(makeInput({ designUrl: null }));
    expect(kinds(plan)).toEqual(["background", "fabric", "shade", "light", "mask", "composite"]);
    expect(plan.assets.some((a) => a.role === "design")).toBe(false);
  });

  it("Schatten wirkt über Stoff und Motiv: shade und light liegen nach dem Motiv", () => {
    const order = kinds(planRender(makeInput()));
    expect(order.indexOf("motif")).toBeLessThan(order.indexOf("shade"));
    expect(order.indexOf("shade")).toBeLessThan(order.indexOf("light"));
    expect(order.indexOf("light")).toBeLessThan(order.indexOf("mask"));
    expect(order.at(-1)).toBe("composite");
  });
});

describe("planRender: Blend-Modi und Ebenen", () => {
  it("nutzt multiply für Schatten, screen für Licht, soft-light für Struktur und die Ebenen der gewählten Variante", () => {
    const plan = planRender(makeInput({ colorId: "grau-meliert", garment: GARMENTS.melange }));
    expect(step(plan, "shade")).toEqual({ kind: "shade", url: "light/shade.png", blend: "multiply" });
    expect(step(plan, "light")).toEqual({ kind: "light", url: "light/light.png", blend: "screen" });
    expect(step(plan, "structure").blend).toBe("soft-light");
    expect(step(plan, "mask")).toEqual({ kind: "mask", url: "light/mask.png" });
  });

  it("nimmt für schwarze Textilien die dunkle Aufnahme", () => {
    const plan = planRender(makeInput());
    expect(plan.exposure).toBe("dark");
    expect(plan.variantIndex).toBe(1);
    expect(plan.variantReason).toBe("color-id");
    expect(step(plan, "shade").url).toBe("dark/shade.png");
    expect(step(plan, "mask").url).toBe("dark/mask.png");
  });

  it("wählt für unbekannte Farben über die Helligkeit", () => {
    const wine = planRender(makeInput({ colorId: "weinrot", garment: GARMENTS.weinrot }));
    expect(wine.exposure).toBe("dark");
    expect(wine.variantReason).toBe("luminance");
    const yellow = planRender(makeInput({ colorId: "gelb", garment: GARMENTS.gelb }));
    expect(yellow.exposure).toBe("light");
    expect(yellow.variantReason).toBe("luminance");
  });

  it("füllt den Stoff mit der realen Textilfarbe", () => {
    expect(step(planRender(makeInput()), "fabric").color).toBe(GARMENTS.schwarz.textileHex);
    const sand = planRender(makeInput({ colorId: "sand", garment: GARMENTS.sand }));
    expect(step(sand, "fabric").color).toBe(GARMENTS.sand.textileHex);
  });
});

describe("planRender: Struktur (Melange und Gewebe)", () => {
  const textureLayers = (heather: string | null) => makeLayers("light", { texture: "light/texture.png", heather });

  it("Melange nur, wenn die Farbe meliert ist UND die Vorlage eine Ebene liefert", () => {
    expect(kinds(planRender(makeInput({ colorId: "weiss", garment: GARMENTS.weiss })))).not.toContain("structure");

    const noHeatherLayer = makeTemplate({
      variants: [{ exposure: "light", layers: makeLayers("light", { heather: null }), colorIds: ["grau-meliert"] }],
    });
    expect(
      kinds(planRender(makeInput({ template: noHeatherLayer, colorId: "grau-meliert", garment: GARMENTS.melange }))),
    ).not.toContain("structure");
  });

  it("Gewebe-Ebene gilt für jede Farbe, die Vorlage sie führt", () => {
    const template = makeTemplate({
      variants: [
        { exposure: "light", layers: textureLayers("light/heather.png"), colorIds: ["weiss", "grau-meliert"] },
      ],
    });
    const white = planRender(makeInput({ template, colorId: "weiss", garment: GARMENTS.weiss }));
    const structures = white.steps.filter((s) => s.kind === "structure");
    expect(structures.map((s) => (s.kind === "structure" ? s.layer : ""))).toEqual(["texture"]);
  });

  it("legt bei melierten Farben erst die Melange, dann das Gewebe darüber", () => {
    const template = makeTemplate({
      variants: [{ exposure: "light", layers: textureLayers("light/heather.png"), colorIds: ["grau-meliert"] }],
    });
    const plan = planRender(makeInput({ template, colorId: "grau-meliert", garment: GARMENTS.melange }));
    expect(
      plan.steps.filter((s) => s.kind === "structure").map((s) => (s.kind === "structure" ? s.layer : "")),
    ).toEqual(["heather", "texture"]);
    expect(kinds(plan).slice(0, 4)).toEqual(["background", "fabric", "structure", "structure"]);
  });
});

describe("planRender: Hintergrund", () => {
  it("transparent, Farbe oder Vorlage", () => {
    expect(step(planRender(makeInput()), "background").fill).toEqual({ type: "transparent" });
    const color = planRender(makeInput({ background: { kind: "color", hex: hex(228, 245, 49) } }));
    expect(step(color, "background").fill).toEqual({ type: "color", color: hex(228, 245, 49) });
    const template = planRender(makeInput({ background: { kind: "template" } }));
    expect(step(template, "background").fill).toEqual({ type: "image", url: "dark/background.png" });
    expect(template.assets).toContainEqual({ url: "dark/background.png", role: "background" });
  });

  it("Vorlagen-Hintergrund ohne Ebene wird transparent", () => {
    const template = makeTemplate({
      variants: [{ exposure: "dark", layers: makeLayers("dark", { background: null }), colorIds: ["schwarz"] }],
    });
    expect(step(planRender(makeInput({ template, background: { kind: "template" } })), "background").fill).toEqual({
      type: "transparent",
    });
  });

  it("opaque (JPEG) füllt nur transparente Hintergründe", () => {
    expect(step(planRender(makeInput(), { opaque: true }), "background").fill).toEqual({
      type: "color",
      color: OPAQUE_FALLBACK_COLOR,
    });
    const colored = planRender(makeInput({ background: { kind: "color", hex: hex(1, 2, 3) } }), { opaque: true });
    expect(step(colored, "background").fill).toEqual({ type: "color", color: hex(1, 2, 3) });
    expect(step(planRender(makeInput(), { opaque: false }), "background").fill).toEqual({ type: "transparent" });
  });
});

describe("planRender: Motiv und Verschiebung", () => {
  it("rechnet die Druckfläche (mm) in Pixel der Ausgabe um; Vorlagenmaß = Ausgabemaß ergibt 1,5 px je mm", () => {
    const plan = planRender(makeInput({ output: { width: 1200, height: 1500 } }));
    expect(plan.view).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    const motif = step(plan, "motif");
    expect(motif.mmMatrix).toEqual({ a: 1.5, b: 0, c: 0, d: 1.5, e: 300, f: 400 });
    expect(motif.placement).toEqual({ widthMm: 220, offsetTopMm: 40, offsetCenterMm: 0 });
    expect(motif.printAreaMm).toEqual({ width: 330, height: 450 });
    expect(motif.url).toBe("blob:design-1");
  });

  it("skaliert Matrix und Verschiebungsstärke mit der Vorschau (halbe Auflösung)", () => {
    const plan = planRender(makeInput({ output: { width: 1200, height: 1500 } }), { scale: 0.5 });
    expect(plan.output).toEqual({ width: 600, height: 750 });
    const motif = step(plan, "motif");
    expect(motif.mmMatrix).toEqual({ a: 0.75, b: 0, c: 0, d: 0.75, e: 150, f: 200 });
    expect(motif.displace).toEqual({ url: "dark/displace.png", strengthPx: 6 });
  });

  it("legt das Motiv nach Breite, Abstand oben und Versatz auf die richtigen Ausgabepixel", () => {
    const plan = planRender(
      makeInput({
        output: { width: 1200, height: 1500 },
        placement: { widthMm: 200, offsetTopMm: 30, offsetCenterMm: -15 },
      }),
    );
    const motif = step(plan, "motif");
    const size = { width: 1000, height: 500 }; // 2 : 1
    const m = designMatrix(motif.mmMatrix, designRectMm(motif.printAreaMm, motif.placement, size), size);
    // x: 165 + (−15) − 100 = 50 mm → 300 + 75 = 375; y: 30 mm → 400 + 45 = 445
    const topLeft = applyMatrix(m, { x: 0, y: 0 });
    expect(topLeft.x).toBeCloseTo(375, 8);
    expect(topLeft.y).toBeCloseTo(445, 8);
    // Breite 200 mm = 300 px, Höhe 100 mm = 150 px
    const bottomRight = applyMatrix(m, { x: 1000, y: 500 });
    expect(bottomRight.x).toBeCloseTo(675, 8);
    expect(bottomRight.y).toBeCloseTo(595, 8);
  });

  it("schaltet die Verschiebung ab, wenn Ebene fehlt oder Stärke 0 ist", () => {
    const noMap = makeTemplate({
      variants: [{ exposure: "dark", layers: makeLayers("dark", { displace: null }), colorIds: ["schwarz"] }],
    });
    expect(step(planRender(makeInput({ template: noMap })), "motif").displace).toBeNull();
    const zero = makeTemplate({ displaceStrengthPx: 0 });
    expect(step(planRender(makeInput({ template: zero })), "motif").displace).toBeNull();
    expect(step(planRender(makeInput()), "motif").displace).not.toBeNull();
  });

  it("prüft das Quad nur, wenn ein Motiv gesetzt wird", () => {
    const broken = makeTemplate({
      printArea: {
        quad: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      },
    });
    expect(kinds(planRender(makeInput({ template: broken, designUrl: null })))).not.toContain("motif");
    expectCode(() => planRender(makeInput({ template: broken })), "invalid-quad");
  });
});

describe("planRender: Größen und Grenzen", () => {
  it("übernimmt die Exportgröße, solange sie in die Grenzen passt", () => {
    const plan = planRender(makeInput());
    expect(plan.output).toEqual({ width: 2400, height: 3000 });
    expect(plan.clamped).toBe(false);
    expect(plan.template).toEqual({ id: "tee-front", size: { width: 1200, height: 1500 } });
    expect(plan.view.a).toBe(2);
  });

  it("verkleinert proportional auf höchstens 3000 × 3750 px", () => {
    const plan = planRender(makeInput({ output: { width: 6000, height: 7500 } }));
    expect(plan.output).toEqual({ width: MAX_CANVAS_PX.width, height: MAX_CANVAS_PX.height });
    expect(plan.clamped).toBe(true);
  });

  it("zentriert die Vorlage bei abweichendem Seitenverhältnis des Ausgabeformats", () => {
    const plan = planRender(makeInput({ output: { width: 1000, height: 1000 } }));
    expect(plan.view.a).toBeCloseTo(1000 / 1500, 12);
    expect(plan.view.e).toBeCloseTo(100, 10);
    expect(plan.view.f).toBeCloseTo(0, 10);
  });

  it("limitOutput rundet und lässt mindestens 1 Pixel", () => {
    expect(limitOutput({ width: 3000, height: 3750 }, 1)).toEqual({
      size: { width: 3000, height: 3750 },
      clamped: false,
    });
    expect(limitOutput({ width: 4000, height: 3000 }, 1)).toEqual({
      size: { width: 3000, height: 2250 },
      clamped: true,
    });
    expect(limitOutput({ width: 2400, height: 3000 }, 0.5)).toEqual({
      size: { width: 1200, height: 1500 },
      clamped: false,
    });
    expect(limitOutput({ width: 1001, height: 1501 }, 0.5)).toEqual({
      size: { width: 501, height: 751 },
      clamped: false,
    });
    expect(limitOutput({ width: 1, height: 1 }, 0.01).size).toEqual({ width: 1, height: 1 });
    const huge = limitOutput({ width: 123456, height: 98765 }, 1);
    expect(huge.size.width).toBeLessThanOrEqual(3000);
    expect(huge.size.height).toBeLessThanOrEqual(3750);
  });
});

describe("planRender: Assets und Serialisierung", () => {
  it("listet jedes Bild einmal mit seiner Rolle", () => {
    const plan = planRender(
      makeInput({ colorId: "grau-meliert", garment: GARMENTS.melange, background: { kind: "template" } }),
    );
    expect(plan.assets).toEqual([
      { url: "light/background.png", role: "background" },
      { url: "light/heather.png", role: "layer" },
      { url: "blob:design-1", role: "design" },
      { url: "light/displace.png", role: "layer" },
      { url: "light/shade.png", role: "layer" },
      { url: "light/light.png", role: "layer" },
      { url: "light/mask.png", role: "layer" },
    ]);
  });

  it("dedupliziert gleiche URLs derselben Rolle", () => {
    const shared = makeTemplate({
      variants: [{ exposure: "dark", layers: makeLayers("dark", { shade: "dark/mask.png" }), colorIds: ["schwarz"] }],
    });
    const plan = planRender(makeInput({ template: shared }));
    expect(plan.assets.filter((a) => a.url === "dark/mask.png")).toHaveLength(1);
  });

  it("ist reine Daten: JSON- und structuredClone-Rundreise ergeben denselben Plan", () => {
    const plan = planRender(
      makeInput({ colorId: "grau-meliert", garment: GARMENTS.melange, background: { kind: "template" } }),
      { scale: 0.5 },
    );
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    expect(structuredClone(plan)).toEqual(plan);
  });

  it("ist deterministisch", () => {
    const input = makeInput();
    expect(planRender(input)).toEqual(planRender(input));
  });
});

describe("planRender: Eingabeprüfung", () => {
  it("lehnt unpassende Farbe, Größen, Faktor und Platzierung ab", () => {
    expectCode(() => planRender(makeInput({ colorId: "navy" })), "invalid-input"); // garment.id passt nicht
    expectCode(() => planRender(makeInput(), { scale: 0 }), "invalid-input");
    expectCode(() => planRender(makeInput(), { scale: Number.NaN }), "invalid-input");
    expectCode(() => planRender(makeInput(), { scale: -1 }), "invalid-input");
    expectCode(() => planRender(makeInput({ output: { width: 0, height: 100 } })), "invalid-input");
    expectCode(
      () => planRender(makeInput({ placement: { widthMm: 0, offsetTopMm: 0, offsetCenterMm: 0 } })),
      "invalid-input",
    );
    expectCode(
      () => planRender(makeInput({ placement: { widthMm: 100, offsetTopMm: Number.NaN, offsetCenterMm: 0 } })),
      "invalid-input",
    );
    expectCode(() => planRender(makeInput({ printAreaMm: { width: 0, height: 450 } })), "invalid-input");
    expectCode(() => planRender(makeInput({ background: { kind: "color", hex: "blau" } })), "invalid-input");
  });

  it("meldet no-variant, wenn keine Aufnahme zur Farbe passt", () => {
    const onlyLight = makeTemplate({
      variants: [{ exposure: "light", layers: makeLayers("light"), colorIds: ["weiss"] }],
    });
    expectCode(() => planRender(makeInput({ template: onlyLight })), "no-variant");
  });

  it("lehnt ein Textil mit ungültigem textileHex ab", () => {
    const broken = { ...GARMENTS.schwarz, textileHex: "schwarz" };
    expectCode(() => planRender(makeInput({ garment: broken })), "invalid-input");
  });
});
