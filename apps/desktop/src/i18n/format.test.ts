import { describe, expect, it } from "vitest";
import {
  checksumGroups,
  checksumShort,
  ellipsizeMiddle,
  ellipsizePath,
  fmtBytes,
  fmtCount,
  fmtDate,
  fmtPercent,
  fmtPx,
  fmtRelative,
  fmtRemaining,
  fmtTime,
} from "./format";

const TZ = "Europe/Berlin";

describe("Zahlenformate (DESIGN.md Typografie)", () => {
  it("Mengen mit Punkt, Pixelmaße ohne Tausenderpunkt", () => {
    expect(fmtCount(3104)).toBe("3.104");
    expect(fmtCount(5000)).toBe("5.000");
    expect(fmtPx(3898, 5315)).toBe("3898 × 5315 px");
  });
  it("Größen mit Dezimalkomma und ohne überflüssige Null", () => {
    expect(fmtBytes(11.2 * 1024 * 1024)).toBe("11,2 MB");
    expect(fmtBytes(182 * 1024 * 1024)).toBe("182 MB");
    expect(fmtBytes(540 * 1024 * 1024)).toBe("540 MB");
    expect(fmtBytes(41 * 1024 ** 3)).toBe("41 GB");
    expect(fmtBytes(1.2 * 1024 ** 3)).toBe("1,2 GB");
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(-1)).toBe("—");
  });
  it("Anteile als Prozent mit Komma", () => {
    expect(fmtPercent(0.021)).toBe("2,1 %");
    expect(fmtPercent(0.0042, 1)).toBe("0,4 %");
  });
});

describe("Zeit", () => {
  const now = new Date("2026-10-16T12:40:00Z");
  it("Datum und Zeit deutsch", () => {
    expect(fmtDate("2026-10-12T10:00:00Z", TZ)).toBe("12.10.2026");
    expect(fmtTime("2026-10-16T12:32:00Z", TZ)).toBe("14:32");
  });
  it("relative Zeit nur bis gestern", () => {
    expect(fmtRelative("2026-10-16T12:32:00Z", now, TZ)).toBe("heute 14:32");
    expect(fmtRelative("2026-10-15T09:00:00Z", now, TZ)).toBe("gestern");
    expect(fmtRelative("2026-10-12T09:00:00Z", now, TZ)).toBe("12.10.2026");
  });
  it("Restzeit ehrlich gerundet", () => {
    expect(fmtRemaining(20)).toBe("noch unter 1 Min.");
    expect(fmtRemaining(24 * 60)).toBe("noch etwa 24 Min.");
    expect(fmtRemaining(100 * 60)).toBe("noch etwa 1 Std. 40 Min.");
  });
});

describe("Prüfsumme und Pfade", () => {
  const sha = "9f3a1c0e5b7d00001111222233334444555566667777888899aabbbb77b2d4e1";
  it("Vierergruppen", () => {
    expect(checksumGroups(sha)).toHaveLength(16);
    expect(checksumGroups(sha)[0]).toBe("9f3a");
  });
  it("Kurzform mit Anfang und Ende", () => {
    expect(checksumShort(sha)).toBe("9f3a 1c0e … 77b2 d4e1");
  });
  it("Mitte kürzen, Endung bleibt", () => {
    const out = ellipsizeMiddle("rauschen_signal_final_v3.kra", 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith("v3.kra")).toBe(true);
    expect(out).toContain("…");
    expect(ellipsizeMiddle("kurz.png", 20)).toBe("kurz.png");
  });
  it("Pfade behalten Laufwerk und Ende", () => {
    const p = ellipsizePath(
      "C:\\Users\\Lena\\AppData\\Local\\de.cypherxcypher.studio\\data\\programs\\krita\\5.3.1",
      40,
    );
    expect(p.startsWith("C:")).toBe(true);
    expect(p.endsWith("5.3.1")).toBe(true);
    expect(p).toContain("…");
  });
});
