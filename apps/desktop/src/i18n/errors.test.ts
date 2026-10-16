import { describe, expect, it } from "vitest";
import type { AppError, AppErrorKind, PrintRuleId } from "@contract";
import { APP_ERROR_KINDS, isAppError, toAppError } from "../ipc/errors";
import { errorText, isRetryable, isSecurityError } from "./errors";
import { findingText } from "./findings";
import { CHECK_RULES } from "../features/printcheck/rules";

/** Je Fehlerart ein Beispiel; der Typ `Record<AppErrorKind, AppError>` zwingt zur Vollständigkeit. */
const SAMPLES: Record<AppErrorKind, AppError> = {
  notFound: { kind: "notFound", entity: "program", id: "x" },
  invalidInput: { kind: "invalidInput", field: "name", reason: "zu lang" },
  planExpired: { kind: "planExpired", planId: "p" },
  consentMismatch: { kind: "consentMismatch", planId: "p" },
  busy: { kind: "busy", reason: "programRunning", jobId: null },
  cancelled: { kind: "cancelled" },
  io: { kind: "io", op: "write", path: "D:\\x", message: "gesperrt" },
  permissionDenied: { kind: "permissionDenied", path: "D:\\x" },
  diskFull: { kind: "diskFull", path: "C:\\", neededBytes: 1000, availableBytes: 100 },
  network: { kind: "network", host: "download.kde.org", message: "Zeitüberschreitung", retryable: true },
  httpStatus: { kind: "httpStatus", host: "inkscape.org", status: 503 },
  hostNotAllowed: { kind: "hostNotAllowed", host: "evil.example" },
  insecureUrl: { kind: "insecureUrl", url: "http://x" },
  checksumMismatch: { kind: "checksumMismatch", file: "a.zip", expected: "a".repeat(64), actual: "b".repeat(64) },
  sizeMismatch: { kind: "sizeMismatch", file: "a.zip", expected: 10, actual: 9 },
  signatureInvalid: { kind: "signatureInvalid", subject: "appUpdate", reason: "Datei fehlt" },
  catalogRollback: { kind: "catalogRollback", currentSequence: 5, offeredSequence: 4 },
  catalogIncompatible: { kind: "catalogIncompatible", schemaVersion: 3, minAppVersion: "0.6.0" },
  unsupportedPlatform: { kind: "unsupportedPlatform", programId: "krita", os: "linux", arch: "aarch64" },
  archiveInvalid: { kind: "archiveInvalid", reason: "kaputt" },
  archiveUnsafeEntry: { kind: "archiveUnsafeEntry", entry: "../x", reason: "parentTraversal" },
  archiveTooLarge: { kind: "archiveTooLarge", limitBytes: 1024 },
  installVerificationFailed: { kind: "installVerificationFailed", reason: "exe fehlt" },
  launchFailed: { kind: "launchFailed", programId: "krita", reason: "Datei fehlt" },
  setupConflict: { kind: "setupConflict", files: ["a", "b"] },
  setupUnsupported: { kind: "setupUnsupported", packId: "krita", reason: "installKind" },
  imageDecode: { kind: "imageDecode", reason: "kaputt" },
  imageTooLarge: { kind: "imageTooLarge", widthPx: 9000, heightPx: 9000, maxPixels: 64_000_000 },
  unsupportedFormat: { kind: "unsupportedFormat", format: "psd", supported: ["png"] },
  libraryNotConfigured: { kind: "libraryNotConfigured" },
  libraryRootInvalid: { kind: "libraryRootInvalid", reason: "notWritable" },
  packInvalid: { kind: "packInvalid", reason: "Datei fehlt" },
  updateFailed: { kind: "updateFailed", reason: "Datei fehlt" },
  internal: { kind: "internal", message: "Panik", correlationId: "abc" },
};

describe("errorText deckt jede Fehlerart ab (ARCHITEKTUR 8.2)", () => {
  it("kennt alle Arten aus dem Vertrag", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...APP_ERROR_KINDS].sort());
  });
  it.each(Object.values(SAMPLES))("$kind liefert Titel, Text und „was ist sicher“", (e) => {
    const m = errorText(e);
    expect(m.title.length).toBeGreaterThan(3);
    expect(m.text.length).toBeGreaterThan(3);
    expect(m.safe.length).toBeGreaterThan(3);
    expect(`${m.title}${m.text}${m.safe}`).not.toMatch(/undefined|\[object/);
  });
  it("Sicherheitsfehler und Wiederholbarkeit", () => {
    expect(isSecurityError(SAMPLES.checksumMismatch)).toBe(true);
    expect(isSecurityError(SAMPLES.network)).toBe(false);
    expect(isRetryable(SAMPLES.network)).toBe(true);
    expect(isRetryable({ kind: "network", host: "x", message: "", retryable: false })).toBe(false);
  });
});

describe("toAppError", () => {
  it("lässt echte AppError durch", () => {
    expect(toAppError({ kind: "cancelled" })).toEqual({ kind: "cancelled" });
  });
  it("liest JSON-Text", () => {
    expect(toAppError(JSON.stringify({ kind: "busy", reason: "jobRunning", jobId: null })).kind).toBe("busy");
  });
  it("macht aus allem anderen internal", () => {
    expect(toAppError("kaputt").kind).toBe("internal");
    expect(toAppError(new Error("x")).kind).toBe("internal");
    expect(toAppError(undefined).kind).toBe("internal");
    expect(isAppError({ kind: "unbekannt" })).toBe(false);
  });
});

describe("findingText deckt jede Regel ab", () => {
  const ALL: Record<PrintRuleId, true> = {
    "format.unreadable": true,
    "format.notUploadable": true,
    "format.jpegNoAlpha": true,
    "format.animated": true,
    "format.interlaced": true,
    "format.bitDepth16": true,
    "format.indexed": true,
    "size.belowMinPixels": true,
    "size.aboveMaxPixels": true,
    "file.tooLarge": true,
    "resolution.tooLow": true,
    "resolution.belowTarget": true,
    "resolution.metadataMismatch": true,
    "resolution.upscaleNeeded": true,
    "layout.empty": true,
    "layout.exceedsPrintArea": true,
    "layout.exceedsSafeArea": true,
    "layout.touchesEdge": true,
    "color.cmyk": true,
    "color.noProfile": true,
    "color.unsupportedProfile": true,
    "color.profileDiffers": true,
    "color.grayscale": true,
    "color.nearBlack": true,
    "alpha.missing": true,
    "alpha.opaqueBackground": true,
    "alpha.semiTransparent": true,
    "alpha.ghostPixels": true,
    "detail.thinLines": true,
    "contrast.lowOnGarment": true,
  };
  it.each(Object.keys(ALL) as PrintRuleId[])("%s", (id) => {
    const m = findingText({
      ruleId: id,
      params: {
        effectiveDpi: 212,
        targetDpi: 300,
        maxWidthMm: 240,
        sharePercent: 2.1,
        count: 5,
        minStrokeMm: 0.6,
        garment: "Schwarz",
        widthPx: 800,
        heightPx: 600,
        minPx: 1000,
        maxPx: 10500,
        fileBytes: 1e8,
        limitBytes: 5e7,
        dpi: 72,
      },
    });
    expect(m.title.length).toBeGreaterThan(3);
    expect(m.detail.length).toBeGreaterThan(10);
    expect(`${m.title}${m.detail}`).not.toMatch(/undefined|NaN|\[object/);
  });
  it("jede Regel gehört zu genau einem Prüfpunkt", () => {
    const all = Object.values(CHECK_RULES).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(Object.keys(ALL).length);
  });
});
