import { describe, expect, it } from "vitest";
import { PRINT_PROFILES } from "../../ipc/mock/fixtures";
import { SAMPLES, analyze } from "../../ipc/mock/printcheck";
import { CHECK_ORDER, evaluateChecks, sortChecks, summarize } from "./rules";
import {
  defaultTopOffset,
  fitScale,
  heightFor,
  placeMotif,
  pxPerMmActual,
  regionToMm,
  rulerTicks,
  zoomBy,
} from "./geometry";

const profile = PRINT_PROFILES[0];
if (!profile) throw new Error("Profil fehlt");

function report(name: string, widthMm = 280, technique: "dtg" | "dtf" = "dtg") {
  const sample = SAMPLES[name];
  if (!sample) throw new Error(name);
  return analyze(
    {
      sample,
      profile: profile as NonNullable<typeof profile>,
      garmentColorId: "schwarz",
      technique,
      plannedWidthMm: widthMm,
    },
    "2026-10-16T12:00:00Z",
  );
}

describe("Prüfpunkte aus Befunden", () => {
  it("bildet jeden Prüfpunkt, in fester Reihenfolge", () => {
    const checks = evaluateChecks(report("signal_v3.png"), profile);
    expect(checks.map((c) => c.id)).toEqual([...CHECK_ORDER]);
  });
  it("Probe-Motiv: 2 Hinweise · 0 Fehler (CONCEPT.md 6.4)", () => {
    const checks = evaluateChecks(report("signal_v3.png"), profile);
    const sum = summarize(checks);
    expect(sum.errors).toBe(0);
    expect(sum.warnings).toBe(2);
    expect(sum.verdict).toBe("warning");
    expect(checks.find((c) => c.id === "semi")?.state).toBe("warning");
    expect(checks.find((c) => c.id === "strokes")?.measured).toBe("0,6 mm");
    expect(checks.find((c) => c.id === "resolution")?.measured).toBe("300 dpi bei 280 mm");
  });
  it("Linienstärke ist „nicht geprüft“, wenn der Kern sie nicht misst", () => {
    const checks = evaluateChecks(report("schriftzug_foto.jpg"), profile);
    const strokes = checks.find((c) => c.id === "strokes");
    expect(strokes?.state).toBe("open");
    expect(strokes?.notCheckedWhy).toBeTruthy();
    expect(summarize(checks).unchecked).toBeGreaterThanOrEqual(1);
  });
  it("Fehler stehen zuerst, erfüllte zuletzt", () => {
    const sorted = sortChecks(evaluateChecks(report("kleines_motiv.png"), profile));
    expect(sorted[0]?.state).toBe("error");
    expect(sorted[sorted.length - 1]?.state).toBe("ok");
    expect(summarize(sorted).verdict).toBe("error");
  });
  it("sauberes Logo: druckbereit, alle Regeln erfüllt oder Info", () => {
    const checks = evaluateChecks(report("rauschen_logo.png"), profile);
    const sum = summarize(checks);
    expect(sum.errors + sum.warnings).toBe(0);
    expect(sum.verdict).toBe("ok");
  });
});

describe("Geometrie der Vorschau", () => {
  const area = { width: 330, height: 450 };
  it("Motiv sitzt mittig, Versatz verschiebt", () => {
    expect(placeMotif(area, 280, 312, 80, 0)).toEqual({ widthMm: 280, heightMm: 312, leftMm: 25, topMm: 80 });
    expect(placeMotif(area, 280, 312, 80, -10).leftMm).toBe(15);
  });
  it("Abstand oben bleibt in der Fläche", () => {
    expect(defaultTopOffset(area, 312, 80)).toBe(80);
    expect(defaultTopOffset(area, 400, 80)).toBe(50);
    expect(defaultTopOffset(area, 312, null)).toBe(0);
  });
  it("Einpassen: ganze Fläche mit Rand sichtbar", () => {
    const s = fitScale(744, 560, area, 44);
    expect(area.width * s).toBeLessThanOrEqual(744 - 88 + 0.01);
    expect(area.height * s).toBeLessThanOrEqual(560 - 88 + 0.01);
  });
  it("Lineale: Strich alle 10 mm, Zahl alle 50 mm", () => {
    const ticks = rulerTicks(330, 1.2);
    expect(ticks.filter((t) => t.label).map((t) => t.mm)).toEqual([0, 50, 100, 150, 200, 250, 300]);
    expect(ticks).toHaveLength(34);
    expect(rulerTicks(330, 0.4).every((t) => t.label)).toBe(true);
  });
  it("Prüfmarken landen in Millimetern der Druckfläche", () => {
    const place = placeMotif(area, 280, 312, 80, 0);
    const r = regionToMm(
      { x: 12, y: 12, width: 3307, height: 3685 },
      { x: 12, y: 12, width: 3307, height: 3685 },
      place,
    );
    expect(r.x).toBeCloseTo(25);
    expect(r.y).toBeCloseTo(80);
    expect(r.width).toBeCloseTo(280);
    expect(r.height).toBeCloseTo(312);
  });
  it("Zoom bleibt in Grenzen, Echtgröße nutzt Kalibrierung", () => {
    expect(zoomBy(1, -100000, 0.2, 40)).toBe(40);
    expect(zoomBy(1, 100000, 0.2, 40)).toBe(0.2);
    expect(pxPerMmActual(null)).toBeCloseTo(3.7795, 3);
    expect(pxPerMmActual(4.2)).toBe(4.2);
    expect(heightFor(280, { width: 3307, height: 3685 })).toBeCloseTo(312, 0);
  });
});
