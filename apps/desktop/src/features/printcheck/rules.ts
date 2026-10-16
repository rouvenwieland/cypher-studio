import type { Finding, PrintProfile, PrintReport, PrintRuleId, Severity } from "@contract";
import { fmtBytes, fmtNumber, fmtPercent } from "../../i18n/format";
import { t } from "../../i18n/de";

/**
 * Prüfpunkte des Berichts: Der Vertrag liefert nur Befunde (Verstöße). Aus ihnen und dem Profil bauen wir die
 * Zeilen „Regel · Messwert · Grenze“ (CONCEPT.md 6.4). Erfüllte Regeln erscheinen einzeln in mute.
 */
export type CheckId = "format" | "size" | "resolution" | "fit" | "alphaBg" | "semi" | "ghost" | "strokes" | "color" | "fileSize" | "contrast";

export const CHECK_ORDER: readonly CheckId[] = ["format", "size", "resolution", "fit", "alphaBg", "semi", "ghost", "strokes", "color", "fileSize", "contrast"];

export const CHECK_RULES: Record<CheckId, readonly PrintRuleId[]> = {
  format: ["format.unreadable", "format.notUploadable", "format.jpegNoAlpha", "format.animated", "format.interlaced", "format.bitDepth16", "format.indexed"],
  size: ["size.belowMinPixels", "size.aboveMaxPixels"],
  resolution: ["resolution.tooLow", "resolution.belowTarget", "resolution.metadataMismatch", "resolution.upscaleNeeded"],
  fit: ["layout.empty", "layout.exceedsPrintArea", "layout.exceedsSafeArea", "layout.touchesEdge"],
  alphaBg: ["alpha.missing", "alpha.opaqueBackground"],
  semi: ["alpha.semiTransparent"],
  ghost: ["alpha.ghostPixels"],
  strokes: ["detail.thinLines"],
  color: ["color.cmyk", "color.noProfile", "color.unsupportedProfile", "color.profileDiffers", "color.grayscale", "color.nearBlack"],
  fileSize: ["file.tooLarge"],
  contrast: ["contrast.lowOnGarment"],
};

export type CheckState = "error" | "warning" | "info" | "ok" | "open";

export interface CheckResult {
  id: CheckId;
  state: CheckState;
  title: string;
  findings: Finding[];
  measured: string;
  limit: string;
  notCheckedWhy: string | null;
}

const RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

function worst(findings: Finding[]): Severity | null {
  let w: Severity | null = null;
  for (const f of findings) if (w === null || RANK[f.severity] > RANK[w]) w = f.severity;
  return w;
}

const MM_PER_INCH = 25.4;

export function evaluateChecks(report: PrintReport, profile: PrintProfile): CheckResult[] {
  const c = t.print.checks;
  const v = t.print.values;
  const strokeMm = report.minStrokePx === null ? null : (report.minStrokePx / profile.targetDpi) * MM_PER_INCH;
  const fmtLabel = report.file.format === "jpeg" ? "JPEG" : report.file.format.toUpperCase();
  const semiShare = report.alpha.semiAreaShareOfVisible;
  const colorLabel = v.colorProfile[report.color.profile];
  const strokeMinMm = (profile.strokes.warnBelowPx / profile.targetDpi) * MM_PER_INCH;

  const base: Record<CheckId, { title: string; measured: string; limit: string }> = {
    format: { title: c.format.title, measured: fmtLabel, limit: c.format.limit },
    size: { title: c.size.title, measured: `${report.file.widthPx} × ${report.file.heightPx} px`, limit: c.size.limit(profile.minPxPerSide, profile.maxPxPerSide) },
    resolution: { title: c.resolution.title, measured: v.atWidth(Math.round(report.placement.effectiveDpi), Math.round(report.placement.plannedWidthMm)), limit: c.resolution.limit(profile.targetDpi) },
    fit: {
      title: c.fit.title,
      measured: `${fmtNumber(report.placement.plannedWidthMm, 1)} × ${fmtNumber(report.placement.plannedHeightMm, 1)} mm`,
      limit: c.fit.limit(profile.printAreaMm.width, profile.printAreaMm.height),
    },
    alphaBg: { title: c.alphaBg.title, measured: report.alpha.present ? v.alphaPresent : v.alphaMissing, limit: c.alphaBg.limit },
    semi: { title: c.semi.title, measured: report.alpha.present ? fmtPercent(semiShare, 1) : "—", limit: c.semi.limit(fmtPercent(profile.alpha.warnShare, 1)) },
    ghost: { title: c.ghost.title, measured: v.pixels(report.alpha.ghostPixelCount), limit: c.ghost.limit },
    strokes: { title: c.strokes.title, measured: strokeMm === null ? "—" : `${fmtNumber(strokeMm, 1)} mm`, limit: c.strokes.limit(fmtNumber(strokeMinMm, 1)) },
    color: { title: c.color.title, measured: colorLabel, limit: c.color.limit },
    fileSize: { title: c.fileSize.title, measured: fmtBytes(report.file.fileBytes), limit: c.fileSize.limit(fmtBytes(profile.warnFileBytes), fmtBytes(profile.maxFileBytes)) },
    contrast: { title: c.contrast.title, measured: report.garment ? v.contrastFine : "—", limit: c.contrast.limit },
  };

  return CHECK_ORDER.map((id) => {
    const rules = CHECK_RULES[id];
    const findings = report.findings.filter((f) => rules.includes(f.ruleId));
    const sev = worst(findings);
    let state: CheckState = sev === null ? "ok" : sev;
    let notCheckedWhy: string | null = null;
    if (id === "strokes" && report.minStrokePx === null && sev === null) {
      state = "open";
      notCheckedWhy = t.print.report.notCheckedWhy.strokes;
    }
    if (id === "contrast" && !report.garment && sev === null) state = "open";
    return { id, state, findings, notCheckedWhy, ...base[id] };
  });
}

export interface CheckSummary {
  errors: number;
  warnings: number;
  infos: number;
  unchecked: number;
  satisfied: number;
  verdict: "ok" | "warning" | "error";
}

export function summarize(results: CheckResult[]): CheckSummary {
  const errors = results.filter((r) => r.state === "error").length;
  const warnings = results.filter((r) => r.state === "warning").length;
  const infos = results.filter((r) => r.state === "info").length;
  const unchecked = results.filter((r) => r.state === "open").length;
  const satisfied = results.filter((r) => r.state === "ok" || r.state === "info").length;
  const verdict = errors > 0 ? "error" : warnings > 0 || unchecked > 0 ? "warning" : "ok";
  return { errors, warnings, infos, unchecked, satisfied, verdict };
}

/** Reihenfolge im Bericht: Fehler, Hinweise, Info, nicht geprüft, erfüllt (letzte Gruppe eingeklappt). */
export function sortChecks(results: CheckResult[]): CheckResult[] {
  const order: Record<CheckState, number> = { error: 0, warning: 1, info: 2, open: 3, ok: 4 };
  return [...results].sort((a, b) => order[a.state] - order[b.state] || CHECK_ORDER.indexOf(a.id) - CHECK_ORDER.indexOf(b.id));
}
