/**
 * Vereinfachtes Regelwerk des Druckprüfers für den Mock-Modus. Es rechnet Auflösung, Maße und Befunde aus einem
 * Bildmodell nach den Regeln aus CONCEPT.md 6.4, damit das Frontend echte Werte statt fester Texte verarbeitet.
 */
import type {
  AppError,
  Finding,
  GarmentColorId,
  PrintProfile,
  PrintReport,
  PrintTechnique,
  Rect,
  Severity,
} from "@contract";
import { GARMENTS } from "./fixtures";
import type { MotifKind } from "./art";

export interface SampleImage {
  name: string;
  format: PrintReport["file"]["format"];
  widthPx: number;
  heightPx: number;
  bitDepth: 8 | 16 | 32;
  channels: PrintReport["file"]["channels"];
  interlaced: boolean;
  animated: boolean;
  fileBytes: number;
  dpi: PrintReport["dpi"];
  color: PrintReport["color"];
  alpha: PrintReport["alpha"];
  margins: { top: number; right: number; bottom: number; left: number };
  minStrokePx: number | null;
  tone: "dark" | "light" | "mixed";
  motif: MotifKind;
  mime: string;
  /** gesetzt = Datei lässt sich nicht lesen */
  unreadable?: AppError;
}

const SRGB = { profile: "srgb", iccDescription: "sRGB IEC61966-2.1", srgbChunk: true } as const;
const ALPHA_CLEAN = {
  present: true,
  transparentShare: 0.42,
  opaqueShare: 0.58,
  semiShareOfVisible: 0.0004,
  semiAreaShareOfVisible: 0.0002,
  ghostPixelCount: 0,
};

export const SAMPLES: Record<string, SampleImage> = {
  "signal_v3.png": {
    name: "signal_v3.png",
    format: "png",
    widthPx: 3331,
    heightPx: 3709,
    bitDepth: 8,
    channels: "rgba",
    interlaced: false,
    animated: false,
    fileBytes: 9_856_000,
    dpi: { x: 300, y: 300, source: "pHYs" },
    color: SRGB,
    alpha: {
      present: true,
      transparentShare: 0.31,
      opaqueShare: 0.64,
      semiShareOfVisible: 0.011,
      semiAreaShareOfVisible: 0.0042,
      ghostPixelCount: 0,
    },
    margins: { top: 12, right: 12, bottom: 12, left: 12 },
    minStrokePx: 7,
    tone: "light",
    motif: "signal",
    mime: "image/png",
  },
  "rauschen_logo.png": {
    name: "rauschen_logo.png",
    format: "png",
    widthPx: 4200,
    heightPx: 1400,
    bitDepth: 8,
    channels: "rgba",
    interlaced: false,
    animated: false,
    fileBytes: 1_480_000,
    dpi: { x: 300, y: 300, source: "pHYs" },
    color: { profile: "adobeRgb", iccDescription: "Adobe RGB (1998)", srgbChunk: false },
    alpha: ALPHA_CLEAN,
    margins: { top: 8, right: 8, bottom: 8, left: 8 },
    minStrokePx: 38,
    tone: "light",
    motif: "logo",
    mime: "image/png",
  },
  "schriftzug_foto.jpg": {
    name: "schriftzug_foto.jpg",
    format: "jpeg",
    widthPx: 3000,
    heightPx: 3000,
    bitDepth: 8,
    channels: "rgb",
    interlaced: false,
    animated: false,
    fileBytes: 2_940_000,
    dpi: { x: 72, y: 72, source: "jfif" },
    color: { profile: "none", iccDescription: null, srgbChunk: false },
    alpha: {
      present: false,
      transparentShare: 0,
      opaqueShare: 1,
      semiShareOfVisible: 0,
      semiAreaShareOfVisible: 0,
      ghostPixelCount: 0,
    },
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    minStrokePx: null,
    tone: "mixed",
    motif: "flat",
    mime: "image/jpeg",
  },
  "kleines_motiv.png": {
    name: "kleines_motiv.png",
    format: "png",
    widthPx: 1200,
    heightPx: 1200,
    bitDepth: 8,
    channels: "rgba",
    interlaced: false,
    animated: false,
    fileBytes: 410_000,
    dpi: { x: 72, y: 72, source: "pHYs" },
    color: SRGB,
    alpha: ALPHA_CLEAN,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    minStrokePx: 12,
    tone: "dark",
    motif: "wave",
    mime: "image/png",
  },
  "scan_16bit.png": {
    name: "scan_16bit.png",
    format: "png",
    widthPx: 5200,
    heightPx: 6100,
    bitDepth: 16,
    channels: "rgba",
    interlaced: false,
    animated: false,
    fileBytes: 53_100_000,
    dpi: { x: 300, y: 300, source: "pHYs" },
    color: SRGB,
    alpha: ALPHA_CLEAN,
    margins: { top: 20, right: 20, bottom: 20, left: 20 },
    minStrokePx: 22,
    tone: "mixed",
    motif: "signal",
    mime: "image/png",
  },
  "signal.psd": {
    name: "signal.psd",
    format: "other",
    widthPx: 0,
    heightPx: 0,
    bitDepth: 16,
    channels: "rgba",
    interlaced: false,
    animated: false,
    fileBytes: 88_000_000,
    dpi: { x: 0, y: 0, source: "none" },
    color: { profile: "none", iccDescription: null, srgbChunk: false },
    alpha: ALPHA_CLEAN,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    minStrokePx: null,
    tone: "mixed",
    motif: "signal",
    mime: "image/vnd.adobe.photoshop",
    unreadable: { kind: "unsupportedFormat", format: "psd", supported: ["png", "jpeg", "tiff", "webp"] },
  },
};

const MM = 25.4;

function worst(a: Severity, b: Severity): Severity {
  const rank: Record<Severity, number> = { info: 0, warning: 1, error: 2 };
  return rank[a] >= rank[b] ? a : b;
}

export interface AnalyzeInput {
  sample: SampleImage;
  profile: PrintProfile;
  garmentColorId: GarmentColorId;
  technique: PrintTechnique;
  plannedWidthMm: number;
  /** Zustand der Datei nach einem Export (Korrekturen angewendet) */
  after?: {
    widthPx: number;
    heightPx: number;
    dpiFromMeta: boolean;
    profile: "adobeRgb" | "srgb";
    semi: boolean;
    ghost: boolean;
  };
}

export function analyze(input: AnalyzeInput, nowIso: string): PrintReport {
  const { sample, profile, technique, plannedWidthMm } = input;
  const garment = GARMENTS.find((g) => g.id === input.garmentColorId) ?? GARMENTS[0];
  const after = input.after;
  const widthPx = after ? after.widthPx : sample.widthPx;
  const heightPx = after ? after.heightPx : sample.heightPx;
  const margins = after ? { top: 0, right: 0, bottom: 0, left: 0 } : sample.margins;
  const trimmed = { width: widthPx - margins.left - margins.right, height: heightPx - margins.top - margins.bottom };
  const plannedHeightMm = plannedWidthMm * (trimmed.height / trimmed.width);
  const effectiveDpi = trimmed.width / (plannedWidthMm / MM);
  const maxWidthMmAtTargetDpi = (trimmed.width / profile.targetDpi) * MM;
  const targetW = Math.round((plannedWidthMm / MM) * profile.targetDpi);
  const targetH = Math.round(targetW * (trimmed.height / trimmed.width));
  const area = profile.printAreaMm;
  const safe = profile.safeAreaMm;
  const fitsPrintArea = plannedWidthMm <= area.width + 0.01 && plannedHeightMm <= area.height + 0.01;
  const fitsSafeArea = safe ? plannedWidthMm <= safe.width + 0.01 && plannedHeightMm <= safe.height + 0.01 : null;

  const alpha = { ...sample.alpha };
  if (after) {
    if (after.semi) alpha.semiAreaShareOfVisible = 0.0002;
    if (after.ghost) alpha.ghostPixelCount = 0;
  }
  const color = after
    ? {
        profile: after.profile,
        iccDescription: after.profile === "adobeRgb" ? "Adobe RGB (1998)" : "sRGB IEC61966-2.1",
        srgbChunk: after.profile === "srgb",
      }
    : sample.color;
  const dpi = after ? { x: 300, y: 300, source: "pHYs" as const } : sample.dpi;
  const fileBytes = after
    ? Math.round(
        sample.fileBytes * Math.min(1.4, (after.widthPx * after.heightPx) / (sample.widthPx * sample.heightPx)),
      )
    : sample.fileBytes;

  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  const region = (r: Rect): Rect => r;

  if (sample.format === "jpeg")
    add({ ruleId: "format.jpegNoAlpha", severity: "warning", params: {}, region: null, fix: null });
  if (sample.bitDepth === 16)
    add({ ruleId: "format.bitDepth16", severity: "warning", params: { bitDepth: 16 }, region: null, fix: null });
  if (!alpha.present) add({ ruleId: "alpha.missing", severity: "error", params: {}, region: null, fix: null });

  const small = Math.min(widthPx, heightPx);
  if (small < profile.minPxPerSide) {
    add({
      ruleId: "size.belowMinPixels",
      severity: Math.max(widthPx, heightPx) < profile.minPxPerSide ? "error" : "warning",
      params: { widthPx, heightPx, minPx: profile.minPxPerSide },
      region: null,
      fix: null,
    });
  }
  if (Math.max(widthPx, heightPx) > profile.maxPxPerSide)
    add({
      ruleId: "size.aboveMaxPixels",
      severity: "error",
      params: { widthPx, heightPx, maxPx: profile.maxPxPerSide },
      region: null,
      fix: null,
    });
  if (fileBytes > profile.maxFileBytes)
    add({
      ruleId: "file.tooLarge",
      severity: "error",
      params: { fileBytes, limitBytes: profile.maxFileBytes },
      region: null,
      fix: null,
    });
  else if (fileBytes > profile.warnFileBytes)
    add({
      ruleId: "file.tooLarge",
      severity: "warning",
      params: { fileBytes, limitBytes: profile.warnFileBytes },
      region: null,
      fix: null,
    });

  if (effectiveDpi < profile.errorBelowDpi)
    add({
      ruleId: "resolution.tooLow",
      severity: "error",
      params: {
        effectiveDpi: Math.round(effectiveDpi),
        targetDpi: profile.targetDpi,
        maxWidthMm: Math.round(maxWidthMmAtTargetDpi),
      },
      region: null,
      fix: null,
    });
  else if (effectiveDpi < profile.targetDpi - 0.5)
    add({
      ruleId: "resolution.belowTarget",
      severity: "warning",
      params: {
        effectiveDpi: Math.round(effectiveDpi),
        targetDpi: profile.targetDpi,
        maxWidthMm: Math.round(maxWidthMmAtTargetDpi),
      },
      region: null,
      fix: null,
    });
  if (dpi.source === "none" || dpi.x !== 300)
    add({ ruleId: "resolution.metadataMismatch", severity: "info", params: { dpi: dpi.x }, region: null, fix: null });

  if (!fitsPrintArea)
    add({
      ruleId: "layout.exceedsPrintArea",
      severity: "error",
      params: {
        widthMm: round1(plannedWidthMm),
        heightMm: round1(plannedHeightMm),
        areaWidthMm: area.width,
        areaHeightMm: area.height,
      },
      region: null,
      fix: null,
    });
  else if (fitsSafeArea === false && safe)
    add({
      ruleId: "layout.exceedsSafeArea",
      severity: "warning",
      params: {
        widthMm: round1(plannedWidthMm),
        heightMm: round1(plannedHeightMm),
        safeWidthMm: safe.width,
        safeHeightMm: safe.height,
      },
      region: null,
      fix: null,
    });
  if (!after && margins.top + margins.left + margins.right + margins.bottom === 0 && alpha.present)
    add({ ruleId: "layout.touchesEdge", severity: "info", params: {}, region: null, fix: null });

  if (color.profile === "cmyk") add({ ruleId: "color.cmyk", severity: "warning", params: {}, region: null, fix: null });
  else if (color.profile === "none" && sample.format !== "other")
    add({ ruleId: "color.noProfile", severity: "info", params: {}, region: null, fix: null });
  else if (color.profile === "srgb")
    add({
      ruleId: "color.profileDiffers",
      severity: "info",
      params: { from: "sRGB", to: "Adobe RGB" },
      region: null,
      fix: "colorProfile",
    });

  if (alpha.present) {
    const share = alpha.semiAreaShareOfVisible;
    if (share > profile.alpha.warnShare) {
      let severity: Severity = share > profile.alpha.errorShare ? "error" : "warning";
      if (garment && !garment.underbase) severity = profile.alpha.severityOnLightGarment;
      if (technique === "dtf") severity = worst(severity, profile.alpha.severityForDtf);
      add({
        ruleId: "alpha.semiTransparent",
        severity,
        params: { share: Math.round(share * 10000) / 10000, sharePercent: round1(share * 100) },
        region: region({
          x: Math.round(widthPx * 0.12),
          y: Math.round(heightPx * 0.78),
          width: Math.round(widthPx * 0.76),
          height: Math.round(heightPx * 0.18),
        }),
        fix: "semiTransparency",
      });
    }
    if (alpha.ghostPixelCount > 0)
      add({
        ruleId: "alpha.ghostPixels",
        severity: "warning",
        params: { count: alpha.ghostPixelCount },
        region: region({ x: 0, y: 0, width: Math.round(widthPx * 0.2), height: Math.round(heightPx * 0.1) }),
        fix: "cleanGhostPixels",
      });
  }
  const minStroke = after ? null : sample.minStrokePx;
  if (minStroke !== null && minStroke < profile.strokes.warnBelowPx) {
    add({
      ruleId: "detail.thinLines",
      severity: minStroke < profile.strokes.criticalBelowPx ? "error" : "warning",
      params: { minStrokePx: minStroke, minStrokeMm: round1((minStroke / profile.targetDpi) * MM) },
      region: region({
        x: Math.round(widthPx * 0.05),
        y: Math.round(heightPx * 0.44),
        width: Math.round(widthPx * 0.9),
        height: Math.round(heightPx * 0.04),
      }),
      fix: null,
    });
  }
  if (
    garment &&
    ((sample.tone === "dark" && (garment.id === "schwarz" || garment.id === "navy")) ||
      (sample.tone === "light" && (garment.id === "weiss" || garment.id === "creme")))
  ) {
    add({
      ruleId: "contrast.lowOnGarment",
      severity: "warning",
      params: { garment: garment.name, sharePercent: 62 },
      region: null,
      fix: null,
    });
  }

  const verdict = findings.some((f) => f.severity === "error")
    ? "error"
    : findings.some((f) => f.severity === "warning")
      ? "warning"
      : "ok";
  return {
    engineVersion: "1.0.0",
    analyzedAt: nowIso,
    file: {
      name: sample.name,
      format: sample.format,
      widthPx,
      heightPx,
      bitDepth: after ? 8 : sample.bitDepth,
      channels: sample.channels,
      interlaced: sample.interlaced,
      animated: sample.animated,
      fileBytes,
    },
    dpi,
    color,
    alpha,
    bounds: { x: margins.left, y: margins.top, width: trimmed.width, height: trimmed.height },
    marginsPx: margins,
    trimmedPx: { width: trimmed.width, height: trimmed.height },
    profileId: profile.id,
    technique,
    garment: garment ? { colorId: garment.id, underbase: garment.underbase } : null,
    placement: {
      plannedWidthMm: round1(plannedWidthMm),
      plannedHeightMm: round1(plannedHeightMm),
      effectiveDpi: Math.round(effectiveDpi * 10) / 10,
      maxWidthMmAtTargetDpi: round1(maxWidthMmAtTargetDpi),
      targetPx: { width: targetW, height: targetH },
      fitsPrintArea,
      fitsSafeArea,
    },
    minStrokePx: minStroke,
    findings,
    verdict,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
