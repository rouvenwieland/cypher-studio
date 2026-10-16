import { describe, expect, it } from "vitest";
import { applyGrain, clampRadius, gradientLine, mulberry32, scanlineRows, scanlineThickness } from "./draw-math";

/** Unabhängige Nachbildung der Referenzfassung von mulberry32 (Tommy Ettinger, gemeinfrei). */
function reference(seed: number): () => number {
  let a = seed;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("mulberry32", () => {
  it("liefert dieselbe Folge wie die Referenzfassung", () => {
    for (const seed of [0, 1, 12, 4, 123456789, 4294967295]) {
      const ours = mulberry32(seed);
      const theirs = reference(seed);
      for (let i = 0; i < 50; i += 1) expect(ours()).toBe(theirs());
    }
  });

  it("ist bei gleichem Seed gleich und bei anderem Seed verschieden", () => {
    const a = Array.from({ length: 5 }, mulberry32(12));
    const b = Array.from({ length: 5 }, mulberry32(12));
    const c = Array.from({ length: 5 }, mulberry32(13));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("bleibt in [0, 1) und ist ungefähr gleichverteilt", () => {
    const random = mulberry32(99);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      sum += value;
    }
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
  });
});

describe("gradientLine", () => {
  const rect = { x: 0, y: 0, width: 200, height: 100 };

  it("läuft bei 180° von oben nach unten", () => {
    const line = gradientLine(180, rect);
    expect(line.x0).toBeCloseTo(100, 8);
    expect(line.x1).toBeCloseTo(100, 8);
    expect(line.y0).toBeCloseTo(0, 8);
    expect(line.y1).toBeCloseTo(100, 8);
  });

  it("läuft bei 0° von unten nach oben und bei 90° von links nach rechts", () => {
    const up = gradientLine(0, rect);
    expect([up.y0, up.y1].map((v) => Math.round(v))).toEqual([100, 0]);
    const right = gradientLine(90, rect);
    expect([right.x0, right.x1].map((v) => Math.round(v))).toEqual([0, 200]);
    expect(right.y0).toBeCloseTo(50, 8);
  });

  it("legt bei 45° die Ecken auf die Endfarben (CSS-Regel)", () => {
    const line = gradientLine(45, rect);
    // Länge = |w·sin| + |h·cos| = (200 + 100) / √2
    const length = Math.hypot(line.x1 - line.x0, line.y1 - line.y0);
    expect(length).toBeCloseTo(300 / Math.SQRT2, 8);
    // Mittelpunkt der Linie = Mittelpunkt des Rechtecks
    expect((line.x0 + line.x1) / 2).toBeCloseTo(100, 8);
    expect((line.y0 + line.y1) / 2).toBeCloseTo(50, 8);
    // Die untere linke Ecke liegt auf der Startlinie (Projektion = 0), die obere rechte auf der Endlinie
    const dx = (line.x1 - line.x0) / length;
    const dy = (line.y1 - line.y0) / length;
    const project = (x: number, y: number) => (x - line.x0) * dx + (y - line.y0) * dy;
    expect(project(0, 100)).toBeCloseTo(0, 8);
    expect(project(200, 0)).toBeCloseTo(length, 8);
  });

  it("berücksichtigt den Versatz des Rechtecks", () => {
    const line = gradientLine(90, { x: 50, y: 20, width: 100, height: 40 });
    expect(Math.round(line.x0)).toBe(50);
    expect(Math.round(line.x1)).toBe(150);
    expect(line.y0).toBeCloseTo(40, 8);
  });
});

describe("clampRadius", () => {
  it("begrenzt auf die halbe kürzere Seite und nie unter 0", () => {
    expect(clampRadius(10, 100, 100)).toBe(10);
    expect(clampRadius(80, 100, 40)).toBe(20);
    expect(clampRadius(-5, 100, 100)).toBe(0);
    expect(clampRadius(5, 0, 100)).toBe(0);
  });
});

describe("Zeilenraster", () => {
  it("setzt die Zeilen im Abstand und dick wie die Hälfte (mindestens 1 px)", () => {
    expect(scanlineRows(20, 6)).toEqual([0, 6, 12, 18]);
    expect(scanlineThickness(6)).toBe(3);
    expect(scanlineThickness(1)).toBe(1);
    expect(scanlineThickness(0)).toBe(1);
  });

  it("liefert nichts bei ungültigem Abstand oder Höhe", () => {
    expect(scanlineRows(100, 0)).toEqual([]);
    expect(scanlineRows(100, -3)).toEqual([]);
    expect(scanlineRows(0, 6)).toEqual([]);
    expect(scanlineRows(100, Number.NaN)).toEqual([]);
  });
});

describe("applyGrain", () => {
  function flat(value: number, pixels: number): Uint8ClampedArray {
    const data = new Uint8ClampedArray(pixels * 4);
    for (let i = 0; i < data.length; i += 4) data.set([value, value, value, 255], i);
    return data;
  }

  it("ist deterministisch über den Seed", () => {
    const a = flat(128, 400);
    const b = flat(128, 400);
    const c = flat(128, 400);
    applyGrain(a, 0.1, 12);
    applyGrain(b, 0.1, 12);
    applyGrain(c, 0.1, 13);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it("verschiebt R, G, B gleich, lässt Alpha unberührt und bleibt in ±opacity·255", () => {
    const data = flat(128, 1000);
    applyGrain(data, 0.08, 4);
    const limit = Math.ceil(0.08 * 255);
    let moved = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r = 0, g = 0, b = 0, a = 0] = data.subarray(i, i + 4);
      expect(g).toBe(r);
      expect(b).toBe(r);
      expect(a).toBe(255);
      expect(Math.abs(r - 128)).toBeLessThanOrEqual(limit);
      if (r !== 128) moved += 1;
    }
    expect(moved).toBeGreaterThan(900);
  });

  it("bleibt im Mittel neutral", () => {
    const data = flat(128, 20000);
    applyGrain(data, 0.1, 1);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] ?? 0;
    expect(sum / 20000).toBeGreaterThan(127);
    expect(sum / 20000).toBeLessThan(129);
  });

  it("begrenzt an Schwarz und Weiß", () => {
    const dark = flat(0, 500);
    applyGrain(dark, 1, 3);
    const light = flat(255, 500);
    applyGrain(light, 1, 3);
    expect(Math.min(...dark)).toBe(0);
    expect(Math.max(...light)).toBe(255);
  });

  it("tut bei Stärke 0 nichts", () => {
    const data = flat(77, 10);
    applyGrain(data, 0, 5);
    expect(Array.from(data.filter((_, index) => index % 4 === 0))).toEqual(Array(10).fill(77));
  });
});
