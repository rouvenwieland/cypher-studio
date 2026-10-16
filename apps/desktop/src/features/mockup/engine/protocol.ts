/**
 * Nachrichtenprotokoll zwischen Client (Hauptthread) und Worker.
 * Anfragen tragen eine ID; Antworten nennen dieselbe ID. `cancel` bricht eine laufende Anfrage ab.
 */
import { isMockupErrorCode, type MockupErrorCode } from "./errors";
import type { RenderPlan } from "./plan";
import type { MockupImageType } from "./types";

export type WorkerRequest =
  | { type: "render"; id: number; plan: RenderPlan }
  | { type: "export"; id: number; plan: RenderPlan; mime: MockupImageType; quality: number | null }
  | { type: "cancel"; id: number }
  | { type: "invalidate"; url: string | null }
  | { type: "dispose" };

export type WorkerResponse =
  /** Das Bitmap wird übertragen (nicht kopiert). */
  | { type: "bitmap"; id: number; bitmap: ImageBitmap }
  | { type: "blob"; id: number; blob: Blob }
  | { type: "error"; id: number; code: MockupErrorCode; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isPlanLike(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value["steps"]) && isRecord(value["output"]) && isRecord(value["view"]);
}

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!isRecord(value)) return false;
  switch (value["type"]) {
    case "render":
      return isId(value["id"]) && isPlanLike(value["plan"]);
    case "export":
      return (
        isId(value["id"]) &&
        isPlanLike(value["plan"]) &&
        (value["mime"] === "image/png" || value["mime"] === "image/jpeg") &&
        (value["quality"] === null || typeof value["quality"] === "number")
      );
    case "cancel":
      return isId(value["id"]);
    case "invalidate":
      return value["url"] === null || typeof value["url"] === "string";
    case "dispose":
      return true;
    default:
      return false;
  }
}

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!isRecord(value)) return false;
  switch (value["type"]) {
    case "bitmap":
      return isId(value["id"]) && isRecord(value["bitmap"]);
    case "blob":
      return isId(value["id"]) && isRecord(value["blob"]);
    case "error":
      return isId(value["id"]) && isMockupErrorCode(value["code"]) && typeof value["message"] === "string";
    default:
      return false;
  }
}
