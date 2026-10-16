import { describe, expect, it } from "vitest";
import { solveFit } from "./FitText";

const m = { w50: 100, w100: 160, w150: 260 };

describe("Bandbreite: Rechnung statt Schleife (DESIGN.md type.bandbreite)", () => {
  it("Wort zwischen den Messungen: nur die Breitenachse ändert sich", () => {
    const fit = solveFit(160, m, 50, 12, 160);
    expect(fit).toEqual({ fontSize: 50, stretch: 100 });
    const lower = solveFit(130, m, 50, 12, 160);
    expect(lower.fontSize).toBe(50);
    expect(lower.stretch).toBeCloseTo(75, 5);
    const upper = solveFit(210, m, 50, 12, 160);
    expect(upper.stretch).toBeCloseTo(125, 5);
  });
  it("zu breit für die Achse: Schrift wächst proportional (bis zur Grenze)", () => {
    const fit = solveFit(520, m, 50, 12, 160);
    expect(fit.stretch).toBe(150);
    expect(fit.fontSize).toBeCloseTo(100, 5);
    expect(solveFit(5200, m, 50, 12, 160).fontSize).toBe(160);
  });
  it("zu schmal für die Achse: Schrift schrumpft (bis zur Grenze)", () => {
    const fit = solveFit(50, m, 50, 12, 160);
    expect(fit.stretch).toBe(50);
    expect(fit.fontSize).toBeCloseTo(25, 5);
    expect(solveFit(1, m, 50, 12, 160).fontSize).toBe(12);
  });
  it("ungültige Messung bleibt unverändert", () => {
    expect(solveFit(0, m, 50, 12, 160)).toEqual({ fontSize: 50, stretch: 100 });
    expect(solveFit(100, { w50: 0, w100: 0, w150: 0 }, 50, 12, 160)).toEqual({ fontSize: 50, stretch: 100 });
  });
});
