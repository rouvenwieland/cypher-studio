/** Testdaten für die Engine-Tests (nicht Teil der Laufzeit). Farben werden gebaut statt als Literale geschrieben. */
import type { GarmentColor, MockupLayerSet, MockupTemplate } from "@contract";
import type { MockupRenderInput } from "./types";

export function hex(r: number, g: number, b: number): string {
  const part = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function makeLayers(prefix: string, overrides: Partial<MockupLayerSet> = {}): MockupLayerSet {
  return {
    mask: `${prefix}/mask.png`,
    shade: `${prefix}/shade.png`,
    light: `${prefix}/light.png`,
    displace: `${prefix}/displace.png`,
    texture: null,
    heather: `${prefix}/heather.png`,
    background: `${prefix}/background.png`,
    ...overrides,
  };
}

/** Vorlage 1200 × 1500; Quad 495 × 675 px für eine Druckfläche von 330 × 450 mm (1,5 px je mm). */
export function makeTemplate(overrides: Partial<MockupTemplate> = {}): MockupTemplate {
  return {
    id: "tee-front",
    title: "Tee",
    product: "tee",
    view: "front",
    canvas: { width: 1200, height: 1500 },
    printProfileId: "shirtigo-tee-front",
    printArea: {
      quad: [
        { x: 300, y: 400 },
        { x: 795, y: 400 },
        { x: 795, y: 1075 },
        { x: 300, y: 1075 },
      ],
    },
    displaceStrengthPx: 12,
    variants: [
      { exposure: "light", layers: makeLayers("light"), colorIds: ["weiss", "grau-meliert", "sand"] },
      { exposure: "dark", layers: makeLayers("dark", { heather: null }), colorIds: ["schwarz", "navy"] },
    ],
    ...overrides,
  };
}

export function makeGarment(id: string, textileHex: string, overrides: Partial<GarmentColor> = {}): GarmentColor {
  return {
    id,
    name: id,
    hex: textileHex,
    textileHex,
    providerColorName: null,
    heather: false,
    underbase: true,
    textOnGarment: hex(255, 255, 255),
    ...overrides,
  };
}

export const GARMENTS = {
  schwarz: makeGarment("schwarz", hex(20, 18, 16)),
  weiss: makeGarment("weiss", hex(255, 255, 255), { underbase: false }),
  melange: makeGarment("grau-meliert", hex(138, 138, 138), { heather: true }),
  navy: makeGarment("navy", hex(31, 42, 68)),
  sand: makeGarment("sand", hex(194, 178, 128)),
  /** Nicht in den Varianten eingetragen, dunkel. */
  weinrot: makeGarment("weinrot", hex(90, 20, 30)),
  /** Nicht in den Varianten eingetragen, hell. */
  gelb: makeGarment("gelb", hex(240, 220, 40)),
} as const;

export function makeInput(overrides: Partial<MockupRenderInput> = {}): MockupRenderInput {
  return {
    template: makeTemplate(),
    colorId: "schwarz",
    garment: GARMENTS.schwarz,
    printAreaMm: { width: 330, height: 450 },
    designUrl: "blob:design-1",
    placement: { widthMm: 220, offsetTopMm: 40, offsetCenterMm: 0 },
    background: { kind: "transparent" },
    output: { width: 2400, height: 3000 },
    ...overrides,
  };
}
