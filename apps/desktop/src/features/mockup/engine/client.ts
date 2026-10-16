/**
 * Client der Mockup-Engine: plant im Hauptthread (Eingaben prüfen, Fehler sofort melden), lässt den Plan im Web Worker
 * ausführen und fällt auf den Hauptthread zurück, wenn Worker oder OffscreenCanvas fehlen oder der Worker ausfällt.
 * Anfragen tragen eine ID und lassen sich über ein `AbortSignal` abbrechen.
 */
import { abortError, isAbortError, MockupEngineError, toEngineError } from "./errors";
import { planRender, type PlanOptions, type RenderPlan } from "./plan";
import { isWorkerResponse, type WorkerRequest } from "./protocol";
import { PlanExecutor, type PlanRunner } from "./render2d";
import { supportsOffscreen2d } from "./surface";
import type { MockupImageType, MockupRenderInput, MockupRenderOptions, MockupRenderer, RendererMode } from "./types";

/** Schmale Sicht auf einen Worker; erlaubt einen Fake-Worker in Tests. */
export interface WorkerPort {
  post(message: WorkerRequest): void;
  onMessage(listener: (data: unknown) => void): void;
  /** Wird aufgerufen, wenn der Worker nicht starten konnte oder ausfiel (Skript nicht ladbar, CSP, Absturz). */
  onFailure(listener: (reason: string) => void): void;
  terminate(): void;
}

export interface CreateMockupRendererOptions {
  /** Erzeugt den Worker-Anschluss oder `null`, wenn keiner nutzbar ist. Standard: Modul-Worker aus `worker.ts`. */
  workerFactory?: (() => WorkerPort | null) | undefined;
  /** Erzeugt die Ausführung für den Hauptthread-Rückfall. Standard: `PlanExecutor`. */
  createRunner?: (() => PlanRunner) | undefined;
}

export type MockupRendererHandle = MockupRenderer & { readonly mode: RendererMode };

export function adaptWorker(worker: Worker): WorkerPort {
  return {
    post(message) {
      worker.postMessage(message);
    },
    onMessage(listener) {
      worker.onmessage = (event: MessageEvent<unknown>) => {
        listener(event.data);
      };
    },
    onFailure(listener) {
      worker.onerror = (event) => {
        event.preventDefault();
        listener(event.message || "worker error");
      };
      worker.onmessageerror = () => {
        listener("worker message could not be deserialized");
      };
    },
    terminate() {
      worker.terminate();
    },
  };
}

/** Modul-Worker erzeugen; `null`, wenn Worker, OffscreenCanvas oder createImageBitmap fehlen. */
export function createDefaultWorkerPort(): WorkerPort | null {
  if (typeof Worker === "undefined" || typeof createImageBitmap === "undefined" || !supportsOffscreen2d()) return null;
  try {
    // Schreibweise ist für Vite wörtlich nötig (Worker wird beim Bauen gebündelt, worker-src 'self' blob:).
    return adaptWorker(new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }));
  } catch {
    return null;
  }
}

type Job =
  | { kind: "bitmap"; plan: RenderPlan }
  | { kind: "blob"; plan: RenderPlan; mime: MockupImageType; quality: number | null };

interface Pending {
  id: number;
  job: Job;
  onBitmap(bitmap: ImageBitmap): void;
  onBlob(blob: Blob): void;
  onError(error: unknown): void;
  /** Bricht einen Lauf im Hauptthread ab. */
  local: AbortController;
  detach(): void;
}

function planOptions(scale: number | undefined, opaque: boolean): PlanOptions {
  return { scale, opaque };
}

class Client implements MockupRendererHandle {
  private worker: WorkerPort | null;
  private runner: PlanRunner | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private disposed = false;

  constructor(private readonly options: CreateMockupRendererOptions) {
    const factory = options.workerFactory ?? createDefaultWorkerPort;
    let port: WorkerPort | null = null;
    try {
      port = factory();
    } catch {
      port = null;
    }
    this.worker = port;
    if (port) {
      port.onMessage((data) => {
        this.handleMessage(data);
      });
      port.onFailure(() => {
        if (this.worker === port) this.failOver();
      });
    }
  }

  get mode(): RendererMode {
    return this.worker ? "worker" : "main";
  }

  render(input: MockupRenderInput, opts: MockupRenderOptions = {}): Promise<ImageBitmap> {
    return new Promise<ImageBitmap>((resolve, reject) => {
      const plan = planRender(input, planOptions(opts.scale, false));
      this.enqueue({ kind: "bitmap", plan }, opts.signal, {
        onBitmap: resolve,
        onBlob: () => {
          reject(new MockupEngineError("worker-failed", "Unexpected blob result for a bitmap request"));
        },
        onError: reject,
      });
    });
  }

  toBlob(
    input: MockupRenderInput,
    type: MockupImageType = "image/png",
    quality?: number,
    opts: { signal?: AbortSignal | undefined } = {},
  ): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      if (quality !== undefined && !(Number.isFinite(quality) && quality >= 0 && quality <= 1)) {
        throw new MockupEngineError("invalid-input", "quality must be a number between 0 and 1");
      }
      const plan = planRender(input, planOptions(1, type === "image/jpeg"));
      this.enqueue({ kind: "blob", plan, mime: type, quality: quality ?? null }, opts.signal, {
        onBitmap: (bitmap) => {
          bitmap.close();
          reject(new MockupEngineError("worker-failed", "Unexpected bitmap result for an export request"));
        },
        onBlob: resolve,
        onError: reject,
      });
    });
  }

  invalidate(url?: string): void {
    if (this.disposed) return;
    this.postSafely({ type: "invalidate", url: url ?? null });
    this.runner?.invalidate(url);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    const open = [...this.pending.values()];
    this.pending.clear();
    for (const p of open) {
      p.detach();
      p.local.abort();
      p.onError(new MockupEngineError("disposed", "Renderer was disposed"));
    }
    this.runner?.dispose();
    this.runner = null;
  }

  private enqueue(
    job: Job,
    signal: AbortSignal | undefined,
    handlers: Pick<Pending, "onBitmap" | "onBlob" | "onError">,
  ): void {
    if (this.disposed) {
      handlers.onError(new MockupEngineError("disposed", "Renderer was disposed"));
      return;
    }
    if (signal?.aborted) {
      handlers.onError(abortError());
      return;
    }
    const id = this.nextId++;
    const local = new AbortController();
    const onAbort = (): void => {
      if (!this.pending.delete(id)) return;
      local.abort();
      this.postSafely({ type: "cancel", id });
      handlers.onError(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const pending: Pending = {
      id,
      job,
      ...handlers,
      local,
      detach: () => {
        signal?.removeEventListener("abort", onAbort);
      },
    };
    this.pending.set(id, pending);
    this.dispatch(pending);
  }

  private dispatch(pending: Pending): void {
    const worker = this.worker;
    if (!worker) {
      this.runLocal(pending);
      return;
    }
    const { id, job } = pending;
    const request: WorkerRequest =
      job.kind === "bitmap"
        ? { type: "render", id, plan: job.plan }
        : { type: "export", id, plan: job.plan, mime: job.mime, quality: job.quality };
    try {
      worker.post(request);
    } catch {
      this.failOver(); // spielt auch diese Anfrage im Hauptthread ab
    }
  }

  private postSafely(request: WorkerRequest): void {
    try {
      this.worker?.post(request);
    } catch {
      /* Worker ist weg: nichts abzubrechen */
    }
  }

  /** Worker aufgeben und alle offenen Anfragen im Hauptthread neu ausführen (Pläne sind reine Daten). */
  private failOver(): void {
    const worker = this.worker;
    if (!worker) return;
    this.worker = null;
    worker.terminate();
    for (const pending of [...this.pending.values()]) this.runLocal(pending);
  }

  private getRunner(): PlanRunner {
    this.runner ??= (this.options.createRunner ?? (() => new PlanExecutor()))();
    return this.runner;
  }

  /** Nimmt die Anfrage aus der Warteschlange; `false`, wenn sie schon erledigt (z. B. abgebrochen) war. */
  private take(pending: Pending): boolean {
    if (this.pending.get(pending.id) !== pending) return false;
    this.pending.delete(pending.id);
    pending.detach();
    return true;
  }

  private runLocal(pending: Pending): void {
    const { job, local } = pending;
    try {
      const runner = this.getRunner();
      if (job.kind === "bitmap") {
        runner.renderBitmap(job.plan, local.signal).then(
          (bitmap) => {
            if (this.take(pending)) pending.onBitmap(bitmap);
            else bitmap.close();
          },
          (error: unknown) => {
            this.fail(pending, error);
          },
        );
      } else {
        runner.renderBlob(job.plan, job.mime, job.quality, local.signal).then(
          (blob) => {
            if (this.take(pending)) pending.onBlob(blob);
          },
          (error: unknown) => {
            this.fail(pending, error);
          },
        );
      }
    } catch (error) {
      this.fail(pending, error);
    }
  }

  private fail(pending: Pending, error: unknown): void {
    if (!this.take(pending)) return;
    pending.onError(isAbortError(error) ? abortError() : toEngineError(error, "worker-failed"));
  }

  private handleMessage(data: unknown): void {
    if (!isWorkerResponse(data)) return;
    switch (data.type) {
      case "bitmap": {
        const pending = this.pending.get(data.id);
        if (pending && this.take(pending)) pending.onBitmap(data.bitmap);
        else data.bitmap.close(); // Anfrage war schon abgebrochen: Speicher freigeben
        break;
      }
      case "blob": {
        const pending = this.pending.get(data.id);
        if (pending && this.take(pending)) pending.onBlob(data.blob);
        break;
      }
      case "error": {
        const pending = this.pending.get(data.id);
        if (!pending) break;
        if (data.code === "canvas-unavailable" && this.worker) {
          this.failOver(); // Worker kann nicht zeichnen: Hauptthread übernimmt alles
          break;
        }
        if (this.take(pending)) pending.onError(new MockupEngineError(data.code, data.message));
        break;
      }
    }
  }
}

/** Erzeugt den Mockup-Renderer. Pro Fenster genügt einer; am Ende `dispose()`. */
export function createMockupRenderer(options: CreateMockupRendererOptions = {}): MockupRendererHandle {
  return new Client(options);
}
