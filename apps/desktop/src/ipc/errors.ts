import type { AppError, AppErrorKind } from "@contract";

/** Vollständigkeit wird vom Compiler geprüft: jede `AppError.kind` steht genau einmal hier. */
const KIND_FLAGS: Record<AppErrorKind, true> = {
  notFound: true,
  invalidInput: true,
  planExpired: true,
  consentMismatch: true,
  busy: true,
  cancelled: true,
  io: true,
  permissionDenied: true,
  diskFull: true,
  network: true,
  httpStatus: true,
  hostNotAllowed: true,
  insecureUrl: true,
  checksumMismatch: true,
  sizeMismatch: true,
  signatureInvalid: true,
  catalogRollback: true,
  catalogIncompatible: true,
  unsupportedPlatform: true,
  archiveInvalid: true,
  archiveUnsafeEntry: true,
  archiveTooLarge: true,
  installVerificationFailed: true,
  launchFailed: true,
  setupConflict: true,
  setupUnsupported: true,
  imageDecode: true,
  imageTooLarge: true,
  unsupportedFormat: true,
  libraryNotConfigured: true,
  libraryRootInvalid: true,
  packInvalid: true,
  updateFailed: true,
  internal: true,
};

export const APP_ERROR_KINDS = Object.keys(KIND_FLAGS) as AppErrorKind[]; // Schlüssel eines Record<AppErrorKind, …>

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  const kind = (value as { kind: unknown }).kind; // schmale Prüfung auf Objekt mit `kind`, danach gegen die Liste
  return typeof kind === "string" && Object.prototype.hasOwnProperty.call(KIND_FLAGS, kind);
}

/** Jede Ablehnung eines Commands wird zu einer `AppError`; Unbekanntes wird zu `internal`. */
export function toAppError(raw: unknown): AppError {
  if (isAppError(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isAppError(parsed)) return parsed;
    } catch {
      /* kein JSON: als Text weiter */
    }
    return { kind: "internal", message: raw, correlationId: "unbekannt" };
  }
  if (raw instanceof Error) return { kind: "internal", message: raw.message, correlationId: "unbekannt" };
  return { kind: "internal", message: "Unbekannter Fehler", correlationId: "unbekannt" };
}

export function isCancelled(error: unknown): boolean {
  return isAppError(error) && error.kind === "cancelled";
}
