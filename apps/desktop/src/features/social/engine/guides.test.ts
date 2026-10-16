import { describe, expect, it } from "vitest";
import type { Rect, Size } from "@contract";
import { classifyZoneSide, unionOfZoneSides, zoneOverlaps } from "./guides";
import { zoneChips } from "./guides-overlay";

const story: Size = { width: 1080, height: 1920 };

/** Vier gesperrte Streifen wie in den Vorlagen (konservativ: 270 / 672 / 120 / 120). */
const zones: Rect[] = [
  { x: 0, y: 0, width: 1080, height: 270 },
  { x: 0, y: 1248, width: 1080, height: 672 },
  { x: 0, y: 270, width: 120, height: 978 },
  { x: 960, y: 270, width: 120, height: 978 },
];

describe("classifyZoneSide", () => {
  it("erkennt die vier Streifen", () => {
    expect(zones.map((zone) => classifyZoneSide(zone, story))).toEqual(["top", "bottom", "left", "right"]);
  });

  it("liefert null für Zonen ohne Fläche", () => {
    expect(classifyZoneSide({ x: 0, y: 270, width: 0, height: 978 }, story)).toBeNull();
    expect(classifyZoneSide({ x: 0, y: 0, width: 100, height: 0 }, story)).toBeNull();
    expect(classifyZoneSide({ x: 0, y: 0, width: -5, height: 10 }, story)).toBeNull();
  });

  it("nimmt bei einer Zone, die beide Ränder gleich berührt, oben bzw. links", () => {
    expect(classifyZoneSide({ x: 0, y: 0, width: 1000, height: 1000 }, { width: 1000, height: 1000 })).toBe("top");
    expect(classifyZoneSide({ x: 0, y: 0, width: 100, height: 1920 }, story)).toBe("left");
  });

  it("leitet die Seite einer eckennahen quadratischen Zone aus dem Randabstand ab", () => {
    expect(classifyZoneSide({ x: 900, y: 1700, width: 100, height: 100 }, story)).toBe("bottom");
    expect(classifyZoneSide({ x: 20, y: 20, width: 100, height: 100 }, story)).toBe("top");
  });
});

describe("zoneOverlaps", () => {
  it("meldet nichts für ein Rechteck in der freien Fläche", () => {
    expect(zoneOverlaps({ x: 200, y: 400, width: 600, height: 500 }, zones, story)).toEqual([]);
  });

  it("zählt Berühren nicht als Überlappen", () => {
    expect(zoneOverlaps({ x: 120, y: 270, width: 840, height: 978 }, zones, story)).toEqual([]);
  });

  it("misst die Tiefe in der oberen Zone (38 px wie im Designbeispiel)", () => {
    const result = zoneOverlaps({ x: 200, y: 232, width: 600, height: 100 }, zones, story);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ zoneIndex: 0, side: "top", overlapPx: 38 });
    expect(result[0]?.overlapRect).toEqual({ x: 200, y: 232, width: 600, height: 38 });
  });

  it("misst die Tiefe in der unteren Zone", () => {
    const result = zoneOverlaps({ x: 200, y: 1200, width: 600, height: 100 }, zones, story);
    expect(result).toEqual([
      { zoneIndex: 1, side: "bottom", overlapPx: 52, overlapRect: { x: 200, y: 1248, width: 600, height: 52 } },
    ]);
  });

  it("misst links und rechts", () => {
    const left = zoneOverlaps({ x: 100, y: 500, width: 300, height: 100 }, zones, story);
    expect(left).toMatchObject([{ side: "left", overlapPx: 20 }]);
    const right = zoneOverlaps({ x: 600, y: 500, width: 400, height: 100 }, zones, story);
    expect(right).toMatchObject([{ side: "right", overlapPx: 40 }]);
  });

  it("misst bei einem Rechteck ganz in der Zone bis zum Rand (Verschiebung zum Verlassen)", () => {
    const result = zoneOverlaps({ x: 300, y: 100, width: 200, height: 50 }, zones, story);
    expect(result).toMatchObject([{ side: "top", overlapPx: 170 }]);
    const bottom = zoneOverlaps({ x: 300, y: 1500, width: 200, height: 50 }, zones, story);
    expect(bottom).toMatchObject([{ side: "bottom", overlapPx: 302 }]);
  });

  it("liefert in einer Ecke einen Eintrag je betroffener Zone", () => {
    const result = zoneOverlaps({ x: 100, y: 250, width: 50, height: 50 }, zones, story);
    expect(result.map((overlap) => [overlap.side, overlap.overlapPx])).toEqual([
      ["top", 20],
      ["left", 20],
    ]);
  });

  it("ignoriert Rechtecke außerhalb der Leinwand und leere Rechtecke", () => {
    expect(zoneOverlaps({ x: 3000, y: 3000, width: 100, height: 100 }, zones, story)).toEqual([]);
    expect(zoneOverlaps({ x: 200, y: 100, width: 0, height: 100 }, zones, story)).toEqual([]);
  });

  it("überspringt Zonen ohne Fläche", () => {
    const withEmpty: Rect[] = [{ x: 0, y: 270, width: 0, height: 978 }, ...zones];
    const result = zoneOverlaps({ x: 0, y: 500, width: 50, height: 50 }, withEmpty, story);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ zoneIndex: 3, side: "left", overlapPx: 120 });
  });

  it("verträgt eine leere Zonenliste", () => {
    expect(zoneOverlaps({ x: 0, y: 0, width: 1080, height: 1920 }, [], story)).toEqual([]);
  });

  it("ignoriert Rauschen unterhalb der Toleranz", () => {
    expect(zoneOverlaps({ x: 200, y: 270 - 1e-9, width: 600, height: 100 }, zones, story)).toEqual([]);
  });
});

describe("unionOfZoneSides", () => {
  it("fasst Zonen derselben Seite zusammen (größte Tiefe, vereinigte Fläche)", () => {
    const strips: Rect[] = [
      { x: 0, y: 0, width: 1080, height: 100 },
      { x: 0, y: 100, width: 1080, height: 100 },
    ];
    // Beide Streifen liegen oben; der zweite ist nach unten verschoben.
    const overlaps = zoneOverlaps({ x: 100, y: 50, width: 200, height: 100 }, strips, { width: 1080, height: 2000 });
    const merged = unionOfZoneSides(overlaps);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ side: "top", zoneIndices: [0, 1] });
    expect(merged[0]?.overlapPx).toBe(Math.max(...overlaps.map((overlap) => overlap.overlapPx)));
    expect(merged[0]?.overlapRect).toEqual({ x: 100, y: 50, width: 200, height: 100 });
  });

  it("sortiert nach oben, unten, links, rechts", () => {
    const rect: Rect = { x: 100, y: 250, width: 900, height: 1100 };
    const merged = unionOfZoneSides(zoneOverlaps(rect, zones, story));
    expect(merged.map((entry) => entry.side)).toEqual(["top", "bottom", "left", "right"]);
  });

  it("liefert für keine Überlappung eine leere Liste", () => {
    expect(unionOfZoneSides([])).toEqual([]);
  });
});

describe("zoneChips", () => {
  it("liefert Seite und Tiefe je Zone", () => {
    const chips = zoneChips(zones, story);
    expect(chips.map((chip) => [chip.zoneIndex, chip.side, chip.sizePx])).toEqual([
      [0, "top", 270],
      [1, "bottom", 672],
      [2, "left", 120],
      [3, "right", 120],
    ]);
    expect(chips[0]?.rect).toEqual(zones[0]);
  });

  it("lässt Zonen ohne Fläche weg und behält die Indizes der übrigen", () => {
    const chips = zoneChips([{ x: 0, y: 0, width: 0, height: 100 }, zones[1] as Rect], story);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ zoneIndex: 1, side: "bottom", sizePx: 672 });
  });

  it("liefert für keine Zonen eine leere Liste", () => {
    expect(zoneChips([], story)).toEqual([]);
  });
});
