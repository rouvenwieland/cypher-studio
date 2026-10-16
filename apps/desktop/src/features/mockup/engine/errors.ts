/**
 * Fehlertypen der Mockup-Engine.
 * Die Meldungen sind für Entwickler (englisch); die Oberfläche übersetzt den `code` über src/i18n.
 */

export const MOCKUP_ERROR_CODES = [
  "invalid-input",
  "invalid-quad",
  "no-variant",
  "canvas-unavailable",
  "layer-load-failed",
  "design-load-failed",
  "encode-failed",
  "worker-failed",
  "aborted",
  "disposed",
] as const;

export type MockupErrorCode = (typeof MOCKUP_ERROR_CODES)[number];

export class MockupEngineError extends Error {
  readonly code: MockupErrorCode;

  constructor(code: MockupErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MockupEngineError";
    this.code = code;
  }
}

export function isMockupErrorCode(value: unknown): value is MockupErrorCode {
  return typeof value === "string" && (MOCKUP_ERROR_CODES as readonly string[]).includes(value);
}

export function isMockupEngineError(value: unknown): value is MockupEngineError {
  return value instanceof MockupEngineError;
}

/** Ob der Fehler ein Abbruch durch den Nutzer bzw. das Signal ist (auch DOM-`AbortError`). */
export function isAbortError(value: unknown): boolean {
  if (value instanceof MockupEngineError) return value.code === "aborted";
  return value instanceof Error && value.name === "AbortError";
}

export function abortError(): MockupEngineError {
  return new MockupEngineError("aborted", "Render request was aborted");
}

/** Beliebigen Fehler in einen `MockupEngineError` umwandeln (vorhandene bleiben unverändert). */
export function toEngineError(error: unknown, fallbackCode: MockupErrorCode): MockupEngineError {
  if (error instanceof MockupEngineError) return error;
  if (isAbortError(error)) return abortError();
  const message = error instanceof Error ? error.message : String(error);
  return new MockupEngineError(fallbackCode, message, { cause: error });
}
