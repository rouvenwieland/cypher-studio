/**
 * Renderplan: geordnete, serialisierbare Liste von Zeichenschritten (reine Daten, kein DOM).
 *
 * Reihenfolge nach ARCHITEKTUR 5.4:
 *   background → fabric → structure (heather, texture) → motif → shade → light → mask → composite
 *
 * Die Schritte zwischen `fabric` und `mask` laufen auf einer eigenen Stoffebene. Die Maske (`destination-in`) wird
 * einmal am Ende auf diese Ebene angewandt statt gleich nach dem Füllen: multiply/screen/soft-light zeichnen sonst
 * über transparenten Flächen die Quellebene unverändert (Schatten und Melange würden außerhalb des Shirts erscheinen),
 * und ein Motiv, das über den Rand ragt, wird so ebenfalls beschnitten. Innerhalb der Maske ist das Ergebnis identisch.
 * Der Plan liegt in Pixeln der Ausgabe; `view` bildet Pixel der Vorlage darauf ab.
 */
import type { Size } from "@contract";
import { parseHexColor } from "./color";
import { MockupEngineError } from "./errors";
import {
  fitMatrix,
  matrixScale,
  mmToTemplateMatrix,
  multiplyMatrix,
  quadFrame,
  type Matrix2D,
  type Placement,
} from "./geometry";
import type { MockupRenderInput } from "./types";
import { selectVariant, type Exposure, type VariantSelection } from "./variant";

/** Obergrenze der Leinwand (≈ 11 MP, unter den Canvas-Grenzen von WKWebView). */
export const MAX_CANVAS_PX: Readonly<Size> = Object.freeze({ width: 3000, height: 3750 });

/** JPEG kennt kein Alpha: transparente Hintergründe werden beim JPEG-Export auf diese Farbe gesetzt. */
export const OPAQUE_FALLBACK_COLOR = "white";

/**
 * `layer`: Datenebene der Vorlage (Maske, Schatten, Licht, Verschiebung, Struktur), wird ohne Farbumrechnung gelesen.
 * `background`: Hintergrundbild der Vorlage. `design`: Motiv des Nutzers.
 */
export type AssetRole = "layer" | "background" | "design";

export interface PlanAsset {
  url: string;
  role: AssetRole;
}

export type BlendMode = "multiply" | "screen" | "soft-light";

export type BackgroundFill =
  { type: "transparent" } | { type: "color"; color: string } | { type: "image"; url: string };

export interface MotifDisplacement {
  url: string;
  /** Maximale Verschiebung in Pixeln der Ausgabe. */
  strengthPx: number;
}

export type RenderStep =
  | { kind: "background"; fill: BackgroundFill }
  /** Stoffebene: ganze Fläche mit der Textilfarbe füllen. */
  | { kind: "fabric"; color: string }
  /** Struktur der Stoffebene per soft-light (Melange, Gewebe). */
  | { kind: "structure"; layer: "heather" | "texture"; url: string; blend: "soft-light" }
  /**
   * Motiv; Größe und Lage ergeben sich erst mit den Pixelmaßen des geladenen Bildes:
   * `designRectMm(printAreaMm, placement, designSize)` und `designMatrix(mmMatrix, …)`.
   */
  | {
      kind: "motif";
      url: string;
      placement: Placement;
      printAreaMm: Size;
      /** Druckfläche in mm (Ursprung oben links) → Pixel der Ausgabe. */
      mmMatrix: Matrix2D;
      displace: MotifDisplacement | null;
    }
  /** Schatten über Stoff und Motiv (Falten wirken auf den Druck). */
  | { kind: "shade"; url: string; blend: "multiply" }
  | { kind: "light"; url: string; blend: "screen" }
  /** Stoffebene auf die Textilfläche beschneiden (`destination-in`). */
  | { kind: "mask"; url: string }
  /** Stoffebene über den Hintergrund legen (`source-over`). */
  | { kind: "composite" };

export interface RenderPlan {
  template: { id: string; size: Size };
  /** Pixelmaße des Ergebnisses (nach Skalierung und Begrenzung auf `MAX_CANVAS_PX`). */
  output: Size;
  /** `true`, wenn die gewünschte Größe die Grenzen überschritt und verkleinert wurde. */
  clamped: boolean;
  /** Pixel der Vorlage → Pixel der Ausgabe (einpassen, zentrieren). */
  view: Matrix2D;
  exposure: Exposure;
  variantIndex: number;
  variantReason: VariantSelection["reason"];
  /** Alle benötigten Bilder ohne Doppelte, zum Vorladen. */
  assets: PlanAsset[];
  steps: RenderStep[];
}

export interface PlanOptions {
  /** Faktor auf `input.output` (Standard 1, Vorschau 0,5). */
  scale?: number | undefined;
  /** Transparenten Hintergrund auf Weiß setzen (für JPEG). */
  opaque?: boolean | undefined;
}

/** Zielgröße = gewünschte Größe × Faktor, bei Überschreitung proportional auf die Grenzen verkleinert. */
export function limitOutput(
  requested: Size,
  scale: number,
  max: Size = MAX_CANVAS_PX,
): { size: Size; clamped: boolean } {
  let width = requested.width * scale;
  let height = requested.height * scale;
  const factor = Math.min(1, max.width / width, max.height / height);
  const clamped = factor < 1;
  if (clamped) {
    width *= factor;
    height *= factor;
  }
  const round = clamped ? Math.floor : Math.round;
  return { size: { width: Math.max(1, round(width)), height: Math.max(1, round(height)) }, clamped };
}

function assertFinitePositive(value: number, name: string): void {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new MockupEngineError("invalid-input", `${name} must be a finite number greater than zero`);
  }
}

function checkedColor(hex: string): string {
  parseHexColor(hex); // wirft bei ungültigem Wert
  return hex.trim();
}

export function planRender(input: MockupRenderInput, options: PlanOptions = {}): RenderPlan {
  const { template, garment } = input;
  const scale = options.scale ?? 1;
  assertFinitePositive(scale, "scale");
  assertFinitePositive(input.output.width, "output.width");
  assertFinitePositive(input.output.height, "output.height");
  assertFinitePositive(template.canvas.width, "template.canvas.width");
  assertFinitePositive(template.canvas.height, "template.canvas.height");
  if (garment.id !== input.colorId) {
    throw new MockupEngineError(
      "invalid-input",
      `garment.id "${garment.id}" does not match colorId "${input.colorId}"`,
    );
  }

  const selection = selectVariant(template, input.colorId, garment);
  const layers = selection.variant.layers;
  const { size: output, clamped } = limitOutput(input.output, scale);
  const view = fitMatrix(template.canvas, output);
  const steps: RenderStep[] = [];

  // 1. Hintergrund
  let fill: BackgroundFill;
  switch (input.background.kind) {
    case "transparent":
      fill = { type: "transparent" };
      break;
    case "color":
      fill = { type: "color", color: checkedColor(input.background.hex) };
      break;
    case "template":
      fill = layers.background === null ? { type: "transparent" } : { type: "image", url: layers.background };
      break;
  }
  if (fill.type === "transparent" && options.opaque === true) fill = { type: "color", color: OPAQUE_FALLBACK_COLOR };
  steps.push({ kind: "background", fill });

  // 2. Stoff
  steps.push({ kind: "fabric", color: checkedColor(garment.textileHex) });

  // 3. Struktur (Melange nur bei melierter Farbe; Gewebe, wenn die Vorlage es mitbringt)
  if (garment.heather && layers.heather !== null) {
    steps.push({ kind: "structure", layer: "heather", url: layers.heather, blend: "soft-light" });
  }
  if (layers.texture !== null) {
    steps.push({ kind: "structure", layer: "texture", url: layers.texture, blend: "soft-light" });
  }

  // 4. Motiv
  if (input.designUrl !== null) {
    const frame = quadFrame(template.printArea.quad, input.printAreaMm);
    assertFinitePositive(input.placement.widthMm, "placement.widthMm");
    if (!(Number.isFinite(input.placement.offsetTopMm) && Number.isFinite(input.placement.offsetCenterMm))) {
      throw new MockupEngineError("invalid-input", "placement offsets must be finite numbers");
    }
    const strength = Number.isFinite(template.displaceStrengthPx) ? Math.max(0, template.displaceStrengthPx) : 0;
    steps.push({
      kind: "motif",
      url: input.designUrl,
      placement: {
        widthMm: input.placement.widthMm,
        offsetTopMm: input.placement.offsetTopMm,
        offsetCenterMm: input.placement.offsetCenterMm,
      },
      printAreaMm: { width: input.printAreaMm.width, height: input.printAreaMm.height },
      mmMatrix: multiplyMatrix(view, mmToTemplateMatrix(frame)),
      displace:
        layers.displace !== null && strength > 0
          ? { url: layers.displace, strengthPx: strength * matrixScale(view) }
          : null,
    });
  }

  // 5. Schatten und Licht, dann Beschnitt und Zusammenfügen
  steps.push({ kind: "shade", url: layers.shade, blend: "multiply" });
  steps.push({ kind: "light", url: layers.light, blend: "screen" });
  steps.push({ kind: "mask", url: layers.mask });
  steps.push({ kind: "composite" });

  return {
    template: { id: template.id, size: { width: template.canvas.width, height: template.canvas.height } },
    output,
    clamped,
    view,
    exposure: selection.variant.exposure,
    variantIndex: selection.index,
    variantReason: selection.reason,
    assets: collectAssets(steps),
    steps,
  };
}

function collectAssets(steps: readonly RenderStep[]): PlanAsset[] {
  const seen = new Set<string>();
  const assets: PlanAsset[] = [];
  const add = (url: string, role: AssetRole): void => {
    const key = `${role}|${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    assets.push({ url, role });
  };
  for (const step of steps) {
    switch (step.kind) {
      case "background":
        if (step.fill.type === "image") add(step.fill.url, "background");
        break;
      case "fabric":
      case "composite":
        break;
      case "structure":
      case "shade":
      case "light":
      case "mask":
        add(step.url, "layer");
        break;
      case "motif":
        add(step.url, "design");
        if (step.displace) add(step.displace.url, "layer");
        break;
    }
  }
  return assets;
}
