import { describe, expect, it } from "vitest";
import type { Rect, Size, SocialDocument, SocialLayer, SocialTemplate } from "@contract";
import { socialTemplates } from "@/ipc/mock/social";
import { contrastRatio, parseHexColor } from "./contrast";
import { BACKGROUND_LAYER_ID, layoutSocial, type LayoutContext, type PlacedText, type SocialWarning } from "./layout";
import type { MeasureFn } from "./textfit";

type TextLayer = Extract<SocialLayer, { type: "text" }>;

/** Jedes Zeichen ist 0,5 em breit. */
const mono: MeasureFn = (text, size) => text.length * size * 0.5;

function makeCtx(
  sizes: Record<string, Size> = {},
  extra: { isFontAvailable?: (family: string, weight: number) => boolean } = {},
): LayoutContext {
  return {
    measureFor: () => mono,
    assetUrl: (relPath) => `asset:${relPath}`,
    logoUrl: (variant) => `logo:${variant}`,
    imageSize: (url) => sizes[url] ?? null,
    ...extra,
  };
}

function makeTemplate(layers: SocialLayer[], extra: Partial<SocialTemplate> = {}): SocialTemplate {
  return {
    id: "t",
    title: "T",
    format: "post",
    size: { width: 1080, height: 1350 },
    background: { type: "solid", color: "#0d0d0d" },
    layers,
    safeZones: [],
    gridCrop: null,
    previewUrl: null,
    ...extra,
  };
}

function makeDoc(extra: Partial<SocialDocument> = {}): SocialDocument {
  return { templateId: "t", format: "post", texts: {}, images: {}, colorOverrides: {}, exportFormat: "png", ...extra };
}

function makeText(extra: Partial<TextLayer> = {}): TextLayer {
  return {
    type: "text",
    id: "titel",
    slot: "titel",
    rect: { x: 60, y: 850, width: 960, height: 290 },
    fontFamily: "Anybody",
    fontWeight: 800,
    sizePx: 230,
    minSizePx: 90,
    lineHeight: 0.92,
    letterSpacingEm: -0.01,
    color: "#efeee9",
    align: "left",
    valign: "bottom",
    transform: "uppercase",
    maxLines: 2,
    defaultText: "Rauschen Drop",
    ...extra,
  };
}

function placedText(
  template: SocialTemplate,
  doc: SocialDocument,
  ctx: LayoutContext = makeCtx(),
  index = 0,
): PlacedText {
  const layer = layoutSocial(template, doc, ctx).layers[index];
  if (layer?.type !== "text") throw new Error("Textebene erwartet");
  return layer;
}

function kinds(warnings: SocialWarning[]): string[] {
  return warnings.map((warning) => warning.kind);
}

const TOP_ZONE: Rect = { x: 0, y: 0, width: 1080, height: 270 };

describe("layoutSocial: Aufbau", () => {
  it("liefert genau eine Ebene je Vorlagenebene in gleicher Reihenfolge", () => {
    const layers: SocialLayer[] = [
      {
        type: "image",
        id: "bild",
        slot: "bild",
        rect: { x: 0, y: 0, width: 1080, height: 780 },
        fit: "cover",
        radiusPx: 0,
        required: false,
      },
      {
        type: "shape",
        id: "balken",
        rect: { x: 60, y: 818, width: 140, height: 12 },
        fill: { type: "solid", color: "#e4f531" },
        radiusPx: 0,
        opacity: 1,
      },
      makeText(),
      { type: "logo", id: "logo", rect: { x: 800, y: 1226, width: 220, height: 60 }, variant: "light" },
      { type: "grain", id: "korn", opacity: 0.08, seed: 12 },
      { type: "scanlines", id: "zeilen", opacity: 0.06, spacingPx: 6 },
    ];
    const result = layoutSocial(makeTemplate(layers), makeDoc(), makeCtx());
    expect(result.layers.map((layer) => [layer.type, layer.id])).toEqual([
      ["image", "bild"],
      ["shape", "balken"],
      ["text", "titel"],
      ["logo", "logo"],
      ["grain", "korn"],
      ["scanlines", "zeilen"],
    ]);
    expect(result.size).toEqual({ width: 1080, height: 1350 });
    expect(result.background).toEqual({ type: "solid", color: "#0d0d0d" });
    expect(result.layers.at(-2)).toEqual({ type: "grain", id: "korn", opacity: 0.08, seed: 12 });
    expect(result.layers.at(-1)).toEqual({ type: "scanlines", id: "zeilen", opacity: 0.06, spacingPx: 6 });
  });

  it("löst Logo-Adressen über den Kontext auf", () => {
    const layer: SocialLayer = {
      type: "logo",
      id: "logo",
      rect: { x: 0, y: 0, width: 10, height: 10 },
      variant: "dark",
    };
    expect(layoutSocial(makeTemplate([layer]), makeDoc(), makeCtx()).layers[0]).toMatchObject({ url: "logo:dark" });
    const without = { ...makeCtx(), logoUrl: () => null };
    expect(layoutSocial(makeTemplate([layer]), makeDoc(), without).layers[0]).toMatchObject({ url: null });
  });

  it("übernimmt Verlauf und überschreibt Volltonhintergrund per Farbwahl", () => {
    const gradient = makeTemplate([], {
      background: {
        type: "linearGradient",
        angleDeg: 180,
        stops: [
          { at: 0, color: "#000000" },
          { at: 1, color: "#ffffff" },
        ],
      },
    });
    expect(
      layoutSocial(gradient, makeDoc({ colorOverrides: { [BACKGROUND_LAYER_ID]: "#ff0000" } }), makeCtx()).background,
    ).toMatchObject({
      type: "linearGradient",
      angleDeg: 180,
    });
    expect(
      layoutSocial(makeTemplate([]), makeDoc({ colorOverrides: { [BACKGROUND_LAYER_ID]: "#ff0000" } }), makeCtx())
        .background,
    ).toEqual({
      type: "solid",
      color: "#ff0000",
    });
  });

  it("berechnet für Bild-Hintergrund den Zuschnitt, sobald die Größe bekannt ist", () => {
    const template = makeTemplate([], { background: { type: "image", url: "cyasset:bg", fit: "cover" } });
    expect(layoutSocial(template, makeDoc(), makeCtx()).background).toEqual({
      type: "image",
      url: "cyasset:bg",
      fit: "cover",
      crop: null,
    });
    const known = layoutSocial(
      template,
      makeDoc(),
      makeCtx({ "cyasset:bg": { width: 2160, height: 2700 } }),
    ).background;
    expect(known).toMatchObject({
      type: "image",
      crop: { dst: { x: 0, y: 0, width: 1080, height: 1350 }, scale: 0.5 },
    });
  });

  it("färbt Vollton-Formen per Farbwahl um", () => {
    const shape: SocialLayer = {
      type: "shape",
      id: "balken",
      rect: { x: 0, y: 0, width: 10, height: 10 },
      fill: { type: "solid", color: "#e4f531" },
      radiusPx: 2,
      opacity: 0.5,
    };
    const result = layoutSocial(makeTemplate([shape]), makeDoc({ colorOverrides: { balken: "#112233" } }), makeCtx());
    expect(result.layers[0]).toMatchObject({
      type: "shape",
      fill: { type: "solid", color: "#112233" },
      radiusPx: 2,
      opacity: 0.5,
    });
  });
});

describe("layoutSocial: Text", () => {
  it("setzt Versalien, wählt die größte passende Größe und richtet unten aus", () => {
    const text = placedText(makeTemplate([makeText()]), makeDoc());
    expect(text.lines.map((line) => line.text)).toEqual(["RAUSCHEN", "DROP"]);
    expect(text.fontSizePx).toBe(157);
    expect(text.lineHeightPx).toBeCloseTo(144.44, 2);
    expect(text.truncated).toBe(false);
    expect(text.overflowsHeight).toBe(false);
    // Block endet am unteren Rand des Rechtecks: 850 + 290
    const last = text.lines[1];
    expect((last?.y ?? 0) + text.lineHeightPx / 2).toBeCloseTo(1140, 8);
    expect(text.lines[0]?.y).toBeCloseTo(850 + 290 - 2 * 144.44 + 72.22, 6);
    expect(text.lines[0]).toMatchObject({ x: 60, width: 8 * 0.5 * 157 });
    expect(text.bounds).toMatchObject({ x: 60, width: 628 });
    expect(text.color).toBe("#efeee9");
    expect(text.fontFamily).toBe("Anybody");
  });

  it("nimmt Text aus dem Dokument vor dem Vorgabetext und Farbe aus der Farbwahl", () => {
    const template = makeTemplate([makeText({ transform: "none" })]);
    const text = placedText(template, makeDoc({ texts: { titel: "Neu" }, colorOverrides: { titel: "#123456" } }));
    expect(text.lines.map((line) => line.text)).toEqual(["Neu"]);
    expect(text.color).toBe("#123456");
    expect(text.fontSizePx).toBe(230);
  });

  it("richtet oben, Mitte und unten sowie links, Mitte und rechts aus", () => {
    const base = {
      transform: "none",
      maxLines: 1,
      sizePx: 100,
      minSizePx: 100,
      lineHeight: 1,
      defaultText: "Hi",
      rect: { x: 100, y: 200, width: 400, height: 300 },
    } as const;
    const at = (extra: Partial<TextLayer>) => placedText(makeTemplate([makeText({ ...base, ...extra })]), makeDoc());

    expect(at({ valign: "top" }).lines[0]?.y).toBeCloseTo(250, 8);
    expect(at({ valign: "middle" }).lines[0]?.y).toBeCloseTo(350, 8);
    expect(at({ valign: "bottom" }).lines[0]?.y).toBeCloseTo(450, 8);

    expect(at({ align: "left" }).lines[0]?.x).toBe(100);
    expect(at({ align: "center" }).lines[0]?.x).toBe(300);
    expect(at({ align: "right" }).lines[0]?.x).toBe(500);

    // Begrenzung: 2 Zeichen × 50 px = 100 px breit
    expect(at({ align: "left" }).bounds).toMatchObject({ x: 100, width: 100 });
    expect(at({ align: "center" }).bounds).toMatchObject({ x: 250, width: 100 });
    expect(at({ align: "right" }).bounds).toMatchObject({ x: 400, width: 100 });
  });

  it("liefert für leeren Text keine Zeilen, keine Begrenzung und keine Textwarnungen", () => {
    const template = makeTemplate([makeText()], { safeZones: [{ x: 0, y: 0, width: 1080, height: 1350 }] });
    const result = layoutSocial(template, makeDoc({ texts: { titel: "" } }), makeCtx());
    expect(result.layers[0]).toMatchObject({ lines: [], bounds: null });
    expect(result.warnings).toEqual([]);
  });

  it("reicht Schrift, Gewicht und Laufweite an die Messfunktion weiter", () => {
    const seen: unknown[] = [];
    const ctx: LayoutContext = {
      ...makeCtx(),
      measureFor: (font) => {
        seen.push(font);
        return mono;
      },
    };
    layoutSocial(makeTemplate([makeText()]), makeDoc(), ctx);
    expect(seen).toEqual([{ family: "Anybody", weight: 800, letterSpacingEm: -0.01 }]);
  });

  it("meldet fehlende Schriften einmal je Familie", () => {
    const layers = [makeText({ id: "a" }), makeText({ id: "b" }), makeText({ id: "c", fontFamily: "Martian Mono" })];
    const ctx = makeCtx({}, { isFontAvailable: (family) => family !== "Anybody" });
    const warnings = layoutSocial(makeTemplate(layers), makeDoc(), ctx).warnings.filter(
      (warning) => warning.kind === "fontMissing",
    );
    expect(warnings).toEqual([{ kind: "fontMissing", family: "Anybody" }]);
  });

  it("meldet keine fehlenden Schriften, wenn der Kontext die Prüfung nicht anbietet", () => {
    expect(kinds(layoutSocial(makeTemplate([makeText()]), makeDoc(), makeCtx()).warnings)).not.toContain("fontMissing");
  });

  it("meldet gekürzten Text", () => {
    const layer = makeText({
      transform: "none",
      minSizePx: 90,
      rect: { x: 0, y: 900, width: 400, height: 300 },
      defaultText: "Eins zwei drei vier fuenf sechs sieben acht",
    });
    const text = placedText(makeTemplate([layer]), makeDoc());
    expect(text.truncated).toBe(true);
    expect(text.lines.at(-1)?.text.endsWith("…")).toBe(true);
    const warnings = layoutSocial(makeTemplate([layer]), makeDoc(), makeCtx()).warnings;
    expect(warnings).toContainEqual({ kind: "textTruncated", layerId: "titel" });
  });
});

describe("layoutSocial: kleinste Schrift", () => {
  const layer = makeText({
    transform: "none",
    maxLines: 1,
    sizePx: 60,
    minSizePx: 10,
    rect: { x: 0, y: 0, width: 200, height: 300 },
    defaultText: "Rauschen Drop Frei",
  });

  it("warnt unter 28 px bei 1080 px Breite", () => {
    // 18 Zeichen × 0,5 em ≤ 200 → 22 px
    const warnings = layoutSocial(makeTemplate([layer]), makeDoc(), makeCtx()).warnings;
    expect(warnings).toEqual([{ kind: "smallText", layerId: "titel", sizePx: 22, minPx: 28 }]);
  });

  it("skaliert die Grenze mit der Breite der Vorlage", () => {
    const half = makeTemplate([layer], { size: { width: 540, height: 675 } });
    expect(kinds(layoutSocial(half, makeDoc(), makeCtx()).warnings)).toEqual([]);
    const small = makeTemplate([{ ...layer, minSizePx: 5, rect: { ...layer.rect, width: 100 } }], {
      size: { width: 540, height: 675 },
    });
    expect(layoutSocial(small, makeDoc(), makeCtx()).warnings).toEqual([
      { kind: "smallText", layerId: "titel", sizePx: 11, minPx: 14 },
    ]);
  });

  it("warnt nicht bei genau 28 px", () => {
    const exact = makeText({ transform: "none", maxLines: 1, sizePx: 28, minSizePx: 28, defaultText: "Hi" });
    expect(layoutSocial(makeTemplate([exact]), makeDoc(), makeCtx()).warnings).toEqual([]);
  });
});

describe("layoutSocial: Kontrast", () => {
  const plain = {
    transform: "none",
    maxLines: 1,
    sizePx: 60,
    minSizePx: 60,
    defaultText: "Hi",
    valign: "top",
  } as const;
  const rectAt = (x = 100, y = 100): Rect => ({ x, y, width: 300, height: 80 });

  it("warnt bei zu geringem Kontrast und nennt das Verhältnis (abgerundet)", () => {
    const template = makeTemplate([makeText({ ...plain, color: "#777777", rect: rectAt() })], {
      background: { type: "solid", color: "#ffffff" },
    });
    const warnings = layoutSocial(template, makeDoc(), makeCtx()).warnings;
    expect(warnings).toEqual([{ kind: "lowContrast", layerId: "titel", ratio: 4.47 }]);
  });

  it("warnt nicht ab 4,5:1", () => {
    const template = makeTemplate([makeText({ ...plain, color: "#767676", rect: rectAt() })], {
      background: { type: "solid", color: "#ffffff" },
    });
    expect(layoutSocial(template, makeDoc(), makeCtx()).warnings).toEqual([]);
  });

  it("prüft die Farbwahl statt der Vorlagenfarbe", () => {
    const template = makeTemplate([makeText({ ...plain, color: "#000000", rect: rectAt() })], {
      background: { type: "solid", color: "#ffffff" },
    });
    const warnings = layoutSocial(template, makeDoc({ colorOverrides: { titel: "#eeeeee" } }), makeCtx()).warnings;
    expect(warnings[0]).toMatchObject({ kind: "lowContrast" });
  });

  it("nimmt bei Verlauf den ungünstigsten Stopp", () => {
    const template = makeTemplate([makeText({ ...plain, color: "#888888", rect: rectAt() })], {
      background: {
        type: "linearGradient",
        angleDeg: 180,
        stops: [
          { at: 0, color: "#000000" },
          { at: 1, color: "#999999" },
        ],
      },
    });
    const fg = parseHexColor("#888888");
    const worst = Math.min(
      contrastRatio(fg ?? { r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 0 }),
      contrastRatio(fg ?? { r: 0, g: 0, b: 0 }, { r: 153, g: 153, b: 153 }),
    );
    const warning = layoutSocial(template, makeDoc(), makeCtx()).warnings[0];
    expect(warning).toMatchObject({ kind: "lowContrast" });
    expect(warning && "ratio" in warning ? warning.ratio : 0).toBeCloseTo(worst, 1);
  });

  it("prüft gegen die Fläche unter dem Text, nicht gegen den Hintergrund", () => {
    const shape: SocialLayer = {
      type: "shape",
      id: "karte",
      rect: { x: 50, y: 50, width: 500, height: 200 },
      fill: { type: "solid", color: "#000000" },
      radiusPx: 0,
      opacity: 1,
    };
    const text = makeText({ ...plain, color: "#ffffff", rect: rectAt() });
    const template = makeTemplate([shape, text], { background: { type: "solid", color: "#ffffff" } });
    expect(layoutSocial(template, makeDoc(), makeCtx()).warnings).toEqual([]);
  });

  it("nimmt bei teilweise überdecktem Text beide Gründe und warnt", () => {
    const shape: SocialLayer = {
      type: "shape",
      id: "karte",
      rect: { x: 0, y: 0, width: 200, height: 400 },
      fill: { type: "solid", color: "#000000" },
      radiusPx: 0,
      opacity: 1,
    };
    // „Hello“ ist 150 px breit und reicht von x = 100 über die Kante der Karte bei x = 200 hinaus
    const text = makeText({ ...plain, defaultText: "Hello", color: "#ffffff", rect: rectAt() });
    const template = makeTemplate([shape, text], { background: { type: "solid", color: "#ffffff" } });
    expect(layoutSocial(template, makeDoc(), makeCtx()).warnings).toEqual([
      { kind: "lowContrast", layerId: "titel", ratio: 1 },
    ]);
  });

  it("mischt halbtransparente Flächen mit dem Grund darunter", () => {
    const shape: SocialLayer = {
      type: "shape",
      id: "schleier",
      rect: { x: 0, y: 0, width: 1080, height: 1350 },
      fill: { type: "solid", color: "#000000" },
      radiusPx: 0,
      opacity: 0.5,
    };
    const text = makeText({ ...plain, color: "#ffffff", rect: rectAt() });
    // Weiß auf 50 % Schwarz über Weiß = Mittelgrau (127,5): Kontrast knapp unter 4
    const template = makeTemplate([shape, text], { background: { type: "solid", color: "#ffffff" } });
    const warning = layoutSocial(template, makeDoc(), makeCtx()).warnings[0];
    expect(warning).toMatchObject({ kind: "lowContrast" });
    expect(warning && "ratio" in warning ? warning.ratio : 0).toBeCloseTo(3.99, 1);
  });

  it("prüft nicht, wenn ein Foto unter dem Text liegt", () => {
    const image: SocialLayer = {
      type: "image",
      id: "bild",
      slot: "bild",
      rect: { x: 0, y: 0, width: 1080, height: 780 },
      fit: "cover",
      radiusPx: 0,
      required: false,
    };
    const text = makeText({ ...plain, color: "#ffffff", rect: rectAt() });
    const template = makeTemplate([image, text], { background: { type: "solid", color: "#ffffff" } });
    const doc = makeDoc({ images: { bild: { relPath: "Motive/a.jpg", focal: { x: 500, y: 500 } } } });
    const warnings = layoutSocial(
      template,
      doc,
      makeCtx({ "asset:Motive/a.jpg": { width: 2000, height: 2000 } }),
    ).warnings;
    expect(warnings).toEqual([]);
  });

  it("prüft nicht gegen Bild-Hintergrund und ungültige Farben", () => {
    const text = makeText({ ...plain, color: "#ffffff", rect: rectAt() });
    const image = makeTemplate([text], { background: { type: "image", url: "cyasset:bg", fit: "cover" } });
    expect(layoutSocial(image, makeDoc(), makeCtx()).warnings).toEqual([]);
    const broken = makeTemplate([makeText({ ...plain, color: "kaputt", rect: rectAt() })], {
      background: { type: "solid", color: "#ffffff" },
    });
    expect(layoutSocial(broken, makeDoc(), makeCtx()).warnings).toEqual([]);
  });

  it("ignoriert Formen, die den Text nicht berühren", () => {
    const shape: SocialLayer = {
      type: "shape",
      id: "karte",
      rect: { x: 800, y: 800, width: 100, height: 100 },
      fill: { type: "solid", color: "#ffffff" },
      radiusPx: 0,
      opacity: 1,
    };
    const text = makeText({ ...plain, color: "#ffffff", rect: rectAt() });
    const template = makeTemplate([shape, text], { background: { type: "solid", color: "#000000" } });
    expect(layoutSocial(template, makeDoc(), makeCtx()).warnings).toEqual([]);
  });
});

describe("layoutSocial: Sicherheitszonen", () => {
  const fixed = {
    transform: "none",
    maxLines: 1,
    sizePx: 100,
    minSizePx: 100,
    lineHeight: 1,
    defaultText: "Hi",
    valign: "top",
  } as const;

  it("meldet Text, der in eine Zone ragt, mit Seite und Tiefe (38 px)", () => {
    const layer = makeText({ ...fixed, rect: { x: 60, y: 232, width: 600, height: 300 } });
    const template = makeTemplate([layer], { safeZones: [TOP_ZONE] });
    expect(layoutSocial(template, makeDoc(), makeCtx()).warnings).toEqual([
      { kind: "textInZone", layerId: "titel", side: "top", overlapPx: 38 },
    ]);
  });

  it("misst am sichtbaren Textkasten, nicht am Rechteck der Ebene", () => {
    // Rechteck beginnt in der Zone, der unten ausgerichtete Text liegt aber darunter
    const layer = makeText({ ...fixed, valign: "bottom", rect: { x: 60, y: 100, width: 600, height: 500 } });
    const template = makeTemplate([layer], { safeZones: [TOP_ZONE] });
    expect(layoutSocial(template, makeDoc(), makeCtx()).warnings).toEqual([]);
  });

  it("meldet alle betroffenen Seiten, je Seite einmal", () => {
    const layer = makeText({
      ...fixed,
      maxLines: 3,
      defaultText: "Aa Bb Cc",
      sizePx: 100,
      minSizePx: 100,
      rect: { x: 100, y: 250, width: 120, height: 400 },
    });
    const zones: Rect[] = [TOP_ZONE, { x: 0, y: 270, width: 120, height: 900 }];
    const warnings = layoutSocial(makeTemplate([layer], { safeZones: zones }), makeDoc(), makeCtx()).warnings;
    expect(warnings.map((warning) => warning.kind === "textInZone" && warning.side)).toEqual(["top", "left"]);
  });

  it("lässt Text in der freien Fläche in Ruhe", () => {
    const layer = makeText({ ...fixed, rect: { x: 200, y: 400, width: 600, height: 300 } });
    expect(layoutSocial(makeTemplate([layer], { safeZones: [TOP_ZONE] }), makeDoc(), makeCtx()).warnings).toEqual([]);
  });
});

describe("layoutSocial: Bilder", () => {
  const image = (extra: Partial<Extract<SocialLayer, { type: "image" }>> = {}): SocialLayer => ({
    type: "image",
    id: "bild",
    slot: "bild",
    rect: { x: 0, y: 0, width: 1080, height: 780 },
    fit: "cover",
    radiusPx: 12,
    required: false,
    ...extra,
  });
  const docWith = (relPath = "Motive/a.jpg") => makeDoc({ images: { bild: { relPath, focal: { x: 1000, y: 500 } } } });

  it("meldet ein fehlendes Pflicht-Bild einmal je Slot, Optionales nicht", () => {
    const layers = [
      image({ required: true }),
      image({ id: "bild2", required: true }),
      image({ id: "bild3", slot: "andere", required: false }),
    ];
    const result = layoutSocial(makeTemplate(layers), makeDoc(), makeCtx());
    expect(result.warnings).toEqual([{ kind: "missingRequiredImage", slot: "bild" }]);
    expect(result.layers[0]).toMatchObject({ type: "image", url: null, crop: null });
    const nullEntry = layoutSocial(
      makeTemplate([image({ required: true })]),
      makeDoc({ images: { bild: null } }),
      makeCtx(),
    );
    expect(nullEntry.warnings).toEqual([{ kind: "missingRequiredImage", slot: "bild" }]);
  });

  it("löst die Adresse auf und berechnet den Zuschnitt um den Fokuspunkt", () => {
    const ctx = makeCtx({ "asset:Motive/a.jpg": { width: 2000, height: 1000 } });
    const placed = layoutSocial(makeTemplate([image()]), docWith(), ctx).layers[0];
    expect(placed).toMatchObject({ type: "image", url: "asset:Motive/a.jpg", radiusPx: 12, fit: "cover" });
    expect(placed?.type === "image" ? placed.crop?.src.x : null).toBeCloseTo(1000 - 1080 / 0.78 / 2, 8);
  });

  it("lässt den Zuschnitt offen, solange die Bildgröße unbekannt ist, und warnt dann nicht", () => {
    const result = layoutSocial(makeTemplate([image({ required: true })]), docWith(), makeCtx());
    expect(result.layers[0]).toMatchObject({ url: "asset:Motive/a.jpg", crop: null });
    expect(result.warnings).toEqual([]);
  });

  it("warnt bei zu geringer Auflösung mit verfügbarer und benötigter Breite", () => {
    const ctx = makeCtx({ "asset:Motive/a.jpg": { width: 800, height: 600 } });
    expect(layoutSocial(makeTemplate([image()]), docWith(), ctx).warnings).toEqual([
      { kind: "lowResImage", layerId: "bild", widthPx: 800, neededPx: 1080 },
    ]);
  });

  it("warnt nicht bei ausreichender Auflösung", () => {
    const ctx = makeCtx({ "asset:Motive/a.jpg": { width: 3000, height: 2000 } });
    expect(layoutSocial(makeTemplate([image()]), docWith(), ctx).warnings).toEqual([]);
  });

  it("bewertet bei contain die gezeichnete Breite", () => {
    const layer = image({ fit: "contain", rect: { x: 90, y: 90, width: 900, height: 900 } });
    const ctx = makeCtx({ "asset:Motive/a.jpg": { width: 800, height: 400 } });
    expect(layoutSocial(makeTemplate([layer]), docWith(), ctx).warnings).toEqual([
      { kind: "lowResImage", layerId: "bild", widthPx: 800, neededPx: 900 },
    ]);
  });

  it("meldet Pflicht-Bilder in der Zone, optionale nicht", () => {
    const ctx = makeCtx({ "asset:Motive/a.jpg": { width: 3000, height: 2000 } });
    const zones = [TOP_ZONE];
    const required = layoutSocial(
      makeTemplate([image({ required: true })], { safeZones: zones }),
      docWith(),
      ctx,
    ).warnings;
    expect(required).toEqual([{ kind: "imageInZone", layerId: "bild", side: "top", overlapPx: 270 }]);
    const optional = layoutSocial(makeTemplate([image()], { safeZones: zones }), docWith(), ctx).warnings;
    expect(optional).toEqual([]);
  });
});

describe("layoutSocial: mitgelieferte Beispielvorlagen", () => {
  it("setzt jede Vorlage ohne Fehler und mit stimmigen Zeilen um", () => {
    for (const template of socialTemplates()) {
      const result = layoutSocial(template, makeDoc({ templateId: template.id, format: template.format }), makeCtx());
      expect(result.layers).toHaveLength(template.layers.length);
      result.layers.forEach((placed, index) => {
        expect(placed.id).toBe(template.layers[index]?.id);
        if (placed.type !== "text") return;
        expect(placed.lines.length).toBeGreaterThan(0);
        expect(placed.fontSizePx).toBeGreaterThan(0);
        for (const line of placed.lines) expect(line.width).toBeLessThanOrEqual(placed.rect.width + 1e-6);
      });
    }
  });

  it("meldet bei „Neues Motiv“ das fehlende Pflicht-Bild", () => {
    const template = socialTemplates().find((entry) => entry.id === "neues-motiv");
    expect(template).toBeDefined();
    if (template === undefined) return;
    const result = layoutSocial(template, makeDoc({ templateId: template.id }), makeCtx());
    expect(result.warnings).toContainEqual({ kind: "missingRequiredImage", slot: "bild" });
  });
});
