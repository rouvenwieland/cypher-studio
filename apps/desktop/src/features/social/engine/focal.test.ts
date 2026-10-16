import { describe, expect, it } from "vitest";
import { centerFocal, checkResolution, denormalizeFocal, focalToCrop, normalizeFocal } from "./focal";

describe("focalToCrop (cover)", () => {
  const image = { width: 2000, height: 1000 };
  const rect = { x: 0, y: 0, width: 1080, height: 780 };

  it("füllt das Ziel ganz und zentriert den Ausschnitt um den Fokuspunkt", () => {
    const crop = focalToCrop(image, rect, { x: 1000, y: 500 }, "cover");
    expect(crop).not.toBeNull();
    expect(crop?.dst).toEqual(rect);
    expect(crop?.scale).toBeCloseTo(0.78, 10);
    expect(crop?.src.width).toBeCloseTo(1080 / 0.78, 8);
    expect(crop?.src.height).toBeCloseTo(1000, 8);
    expect(crop?.src.x).toBeCloseTo(1000 - 1080 / 0.78 / 2, 8);
    expect(crop?.src.y).toBe(0);
  });

  it("hält den Ausschnitt im Bild, wenn der Fokuspunkt am Rand liegt", () => {
    const left = focalToCrop(image, rect, { x: 0, y: 0 }, "cover");
    expect(left?.src.x).toBe(0);
    const right = focalToCrop(image, rect, { x: 2000, y: 1000 }, "cover");
    expect(right?.src.x).toBeCloseTo(2000 - 1080 / 0.78, 8);
    expect((right?.src.x ?? 0) + (right?.src.width ?? 0)).toBeCloseTo(2000, 8);
  });

  it("schneidet bei hohem Bild oben und unten ab", () => {
    const tall = { width: 1000, height: 3000 };
    const target = { x: 10, y: 20, width: 500, height: 500 };
    const top = focalToCrop(tall, target, { x: 500, y: 100 }, "cover");
    expect(top?.src).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
    const middle = focalToCrop(tall, target, { x: 500, y: 1500 }, "cover");
    expect(middle?.src.y).toBeCloseTo(1000, 8);
    expect(middle?.dst).toEqual(target);
    expect(middle?.scale).toBeCloseTo(0.5, 10);
  });

  it("nimmt ohne gültigen Fokuspunkt die Bildmitte", () => {
    const crop = focalToCrop(image, rect, { x: Number.NaN, y: Number.NaN }, "cover");
    expect(crop?.src.x).toBeCloseTo(1000 - 1080 / 0.78 / 2, 8);
  });

  it("passt ein Bild, das genau das Seitenverhältnis hat, ohne Beschnitt ein", () => {
    const crop = focalToCrop({ width: 540, height: 390 }, rect, { x: 0, y: 0 }, "cover");
    expect(crop?.src).toEqual({ x: 0, y: 0, width: 540, height: 390 });
    expect(crop?.scale).toBe(2);
  });
});

describe("focalToCrop (contain)", () => {
  it("zeigt das ganze Bild mittig, ohne Beschnitt", () => {
    const crop = focalToCrop(
      { width: 1000, height: 500 },
      { x: 90, y: 90, width: 900, height: 900 },
      { x: 0, y: 0 },
      "contain",
    );
    expect(crop?.src).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
    expect(crop?.dst).toEqual({ x: 90, y: 315, width: 900, height: 450 });
    expect(crop?.scale).toBeCloseTo(0.9, 10);
  });

  it("zentriert auch hohe Bilder waagerecht", () => {
    const crop = focalToCrop(
      { width: 500, height: 1000 },
      { x: 0, y: 0, width: 400, height: 400 },
      { x: 0, y: 0 },
      "contain",
    );
    expect(crop?.dst).toEqual({ x: 100, y: 0, width: 200, height: 400 });
  });
});

describe("focalToCrop (ungültige Eingaben)", () => {
  it("liefert null bei Bild oder Ziel ohne Fläche", () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(focalToCrop({ width: 0, height: 100 }, rect, { x: 0, y: 0 }, "cover")).toBeNull();
    expect(focalToCrop({ width: 100, height: 100 }, { ...rect, height: 0 }, { x: 0, y: 0 }, "contain")).toBeNull();
  });
});

describe("Fokuspunkt umrechnen", () => {
  const size = { width: 2000, height: 1000 };

  it("rechnet Bildpixel nach 0 … 1 und zurück", () => {
    expect(normalizeFocal(size, { x: 500, y: 250 })).toEqual({ x: 0.25, y: 0.25 });
    expect(denormalizeFocal(size, { x: 0.25, y: 0.75 })).toEqual({ x: 500, y: 750 });
  });

  it("begrenzt auf das Bild", () => {
    expect(normalizeFocal(size, { x: -10, y: 5000 })).toEqual({ x: 0, y: 1 });
    expect(denormalizeFocal(size, { x: 2, y: -1 })).toEqual({ x: 2000, y: 0 });
  });

  it("nimmt bei Größe 0 die Mitte", () => {
    expect(normalizeFocal({ width: 0, height: 0 }, { x: 5, y: 5 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it("kennt die Bildmitte", () => {
    expect(centerFocal(size)).toEqual({ x: 1000, y: 500 });
  });
});

describe("checkResolution", () => {
  it("verlangt mindestens ein Quellpixel je Zielpixel", () => {
    const rect = { x: 0, y: 0, width: 1080, height: 780 };
    const good = focalToCrop({ width: 3000, height: 2000 }, rect, { x: 1500, y: 1000 }, "cover");
    expect(good && checkResolution(good).sufficient).toBe(true);

    const poor = focalToCrop({ width: 800, height: 600 }, rect, { x: 400, y: 300 }, "cover");
    expect(poor).not.toBeNull();
    if (poor === null) return;
    const check = checkResolution(poor);
    expect(check.sufficient).toBe(false);
    expect(check.availablePx).toBeLessThan(check.neededPx);
    expect(check.neededPx).toBe(1080);
    expect(check.sourcePerTarget).toBeLessThan(1);
  });

  it("lässt genau 1:1 gelten", () => {
    const crop = focalToCrop(
      { width: 1080, height: 1080 },
      { x: 0, y: 0, width: 1080, height: 780 },
      { x: 540, y: 540 },
      "cover",
    );
    expect(crop && checkResolution(crop)).toMatchObject({ sufficient: true, availablePx: 1080, neededPx: 1080 });
  });

  it("bewertet bei contain die tatsächlich gezeichnete Breite", () => {
    const crop = focalToCrop(
      { width: 900, height: 450 },
      { x: 0, y: 0, width: 1000, height: 1000 },
      { x: 0, y: 0 },
      "contain",
    );
    expect(crop && checkResolution(crop)).toMatchObject({ sufficient: false, availablePx: 900, neededPx: 1000 });
  });
});
