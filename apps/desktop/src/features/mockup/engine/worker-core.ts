/**
 * Nachrichten-Logik des Workers, getrennt vom `self`-Zugriff, damit sie ohne echten Worker testbar ist.
 * `worker.ts` verbindet sie mit dem Worker-Bereich.
 */
import { isAbortError, toEngineError } from "./errors";
import { isWorkerRequest, type WorkerRequest, type WorkerResponse } from "./protocol";
import type { PlanRunner } from "./render2d";

export interface WorkerHost {
  /** Antwort senden; `transfer` enthält übertragbare Objekte (ImageBitmap). */
  post(message: WorkerResponse, transfer: Transferable[]): void;
}

/** Liefert die Funktion, die jede eingehende Nachricht verarbeitet. Unbekannte Nachrichten werden verworfen. */
export function createWorkerHandler(host: WorkerHost, runner: PlanRunner): (data: unknown) => void {
  const running = new Map<number, AbortController>();

  const fail = (id: number, error: unknown): void => {
    const err = toEngineError(error, "worker-failed");
    host.post({ type: "error", id, code: err.code, message: err.message }, []);
  };

  const start = (id: number, job: (signal: AbortSignal) => Promise<WorkerResponse>): void => {
    const controller = new AbortController();
    running.set(id, controller);
    job(controller.signal).then(
      (response) => {
        running.delete(id);
        host.post(response, response.type === "bitmap" ? [response.bitmap] : []);
      },
      (error: unknown) => {
        running.delete(id);
        // Abgebrochene Anfragen sind beim Client längst erledigt: keine Antwort nötig.
        if (!isAbortError(error)) fail(id, error);
      },
    );
  };

  const handle = (request: WorkerRequest): void => {
    switch (request.type) {
      case "render":
        start(request.id, async (signal) => ({
          type: "bitmap",
          id: request.id,
          bitmap: await runner.renderBitmap(request.plan, signal),
        }));
        break;
      case "export":
        start(request.id, async (signal) => ({
          type: "blob",
          id: request.id,
          blob: await runner.renderBlob(request.plan, request.mime, request.quality, signal),
        }));
        break;
      case "cancel":
        running.get(request.id)?.abort();
        break;
      case "invalidate":
        runner.invalidate(request.url ?? undefined);
        break;
      case "dispose":
        for (const controller of running.values()) controller.abort();
        running.clear();
        runner.dispose();
        break;
    }
  };

  return (data) => {
    if (isWorkerRequest(data)) handle(data);
  };
}
