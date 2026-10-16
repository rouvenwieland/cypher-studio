import { describe, expect, it } from "vitest";
import { abortError, MockupEngineError } from "./errors";
import { planRender, type RenderPlan } from "./plan";
import { isWorkerRequest, isWorkerResponse, type WorkerResponse } from "./protocol";
import type { PlanRunner } from "./render2d";
import { makeInput } from "./test-fixtures";
import type { MockupImageType } from "./types";
import { createWorkerHandler } from "./worker-core";

interface Job {
  kind: "bitmap" | "blob";
  plan: RenderPlan;
  signal: AbortSignal | undefined;
  mime?: MockupImageType;
  quality?: number | null;
  resolve(value: ImageBitmap | Blob): void;
  reject(error: unknown): void;
}

class FakeRunner implements PlanRunner {
  jobs: Job[] = [];
  invalidated: (string | undefined)[] = [];
  disposed = false;

  renderBitmap(plan: RenderPlan, signal?: AbortSignal): Promise<ImageBitmap> {
    return new Promise<ImageBitmap>((resolve, reject) => {
      this.jobs.push({ kind: "bitmap", plan, signal, resolve: resolve as Job["resolve"], reject });
      signal?.addEventListener("abort", () => {
        reject(abortError());
      });
    });
  }
  renderBlob(plan: RenderPlan, mime: MockupImageType, quality: number | null, signal?: AbortSignal): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      this.jobs.push({ kind: "blob", plan, signal, mime, quality, resolve: resolve as Job["resolve"], reject });
      signal?.addEventListener("abort", () => {
        reject(abortError());
      });
    });
  }
  invalidate(url?: string): void {
    this.invalidated.push(url);
  }
  dispose(): void {
    this.disposed = true;
  }
}

const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

function setup() {
  const runner = new FakeRunner();
  const posted: { message: WorkerResponse; transfer: Transferable[] }[] = [];
  const handle = createWorkerHandler({ post: (message, transfer) => posted.push({ message, transfer }) }, runner);
  return { runner, posted, handle };
}

const plan = planRender(makeInput());
const fakeBitmap = { label: "bitmap", close: () => undefined } as unknown as ImageBitmap;

describe("Protokoll: Prüfung der Nachrichten", () => {
  it("erkennt gültige Anfragen", () => {
    expect(isWorkerRequest({ type: "render", id: 1, plan })).toBe(true);
    expect(isWorkerRequest({ type: "export", id: 2, plan, mime: "image/png", quality: null })).toBe(true);
    expect(isWorkerRequest({ type: "export", id: 2, plan, mime: "image/jpeg", quality: 0.9 })).toBe(true);
    expect(isWorkerRequest({ type: "cancel", id: 3 })).toBe(true);
    expect(isWorkerRequest({ type: "invalidate", url: null })).toBe(true);
    expect(isWorkerRequest({ type: "invalidate", url: "blob:x" })).toBe(true);
    expect(isWorkerRequest({ type: "dispose" })).toBe(true);
  });

  it("verwirft ungültige Anfragen", () => {
    const bad: unknown[] = [
      null,
      undefined,
      "render",
      42,
      {},
      { type: "unbekannt" },
      { type: "render", id: "1", plan },
      { type: "render", id: 1.5, plan },
      { type: "render", id: 1 },
      { type: "render", id: 1, plan: { steps: [] } },
      { type: "export", id: 1, plan, mime: "image/gif", quality: null },
      { type: "export", id: 1, plan, mime: "image/png" },
      { type: "cancel" },
      { type: "invalidate", url: 5 },
    ];
    for (const message of bad) expect(isWorkerRequest(message), JSON.stringify(message)).toBe(false);
  });

  it("erkennt gültige und ungültige Antworten", () => {
    expect(isWorkerResponse({ type: "bitmap", id: 1, bitmap: fakeBitmap })).toBe(true);
    expect(isWorkerResponse({ type: "blob", id: 1, blob: new Blob(["x"]) })).toBe(true);
    expect(isWorkerResponse({ type: "error", id: 1, code: "aborted", message: "m" })).toBe(true);
    expect(isWorkerResponse({ type: "error", id: 1, code: "erfunden", message: "m" })).toBe(false);
    expect(isWorkerResponse({ type: "error", id: 1, code: "aborted" })).toBe(false);
    expect(isWorkerResponse({ type: "bitmap", id: 1 })).toBe(false);
    expect(isWorkerResponse({ type: "blob", id: "1", blob: {} })).toBe(false);
    expect(isWorkerResponse(null)).toBe(false);
    expect(isWorkerResponse({ type: "other" })).toBe(false);
  });
});

describe("Worker: Nachrichtenverarbeitung", () => {
  it("ignoriert Nachrichten, die keine gültige Anfrage sind", () => {
    const { handle, runner, posted } = setup();
    for (const junk of [null, "x", { type: "render" }, { type: "render", id: 1 }, { type: "?" }]) handle(junk);
    expect(runner.jobs).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });

  it("render: ruft den Läufer mit Plan und Signal auf und überträgt das Bitmap in der Antwort", async () => {
    const { handle, runner, posted } = setup();
    handle({ type: "render", id: 7, plan });
    expect(runner.jobs).toHaveLength(1);
    expect(runner.jobs[0]?.plan).toBe(plan);
    expect(runner.jobs[0]?.signal?.aborted).toBe(false);
    runner.jobs[0]?.resolve(fakeBitmap);
    await flush();
    expect(posted).toEqual([{ message: { type: "bitmap", id: 7, bitmap: fakeBitmap }, transfer: [fakeBitmap] }]);
  });

  it("export: reicht Typ und Qualität weiter und sendet den Blob ohne Übertragungsliste", async () => {
    const { handle, runner, posted } = setup();
    handle({ type: "export", id: 8, plan, mime: "image/jpeg", quality: 0.7 });
    expect(runner.jobs[0]).toMatchObject({ kind: "blob", mime: "image/jpeg", quality: 0.7 });
    const blob = new Blob(["x"], { type: "image/jpeg" });
    runner.jobs[0]?.resolve(blob);
    await flush();
    expect(posted).toEqual([{ message: { type: "blob", id: 8, blob }, transfer: [] }]);
  });

  it("meldet Fehler mit Code und Meldung; fremde Fehler werden zu worker-failed", async () => {
    const { handle, runner, posted } = setup();
    handle({ type: "render", id: 1, plan });
    handle({ type: "render", id: 2, plan });
    runner.jobs[0]?.reject(new MockupEngineError("layer-load-failed", "Ebene fehlt"));
    runner.jobs[1]?.reject(new TypeError("kaputt"));
    await flush();
    expect(posted.map((p) => p.message)).toEqual([
      { type: "error", id: 1, code: "layer-load-failed", message: "Ebene fehlt" },
      { type: "error", id: 2, code: "worker-failed", message: "kaputt" },
    ]);
  });

  it("cancel bricht die Anfrage ab und sendet keine Antwort; unbekannte IDs sind harmlos", async () => {
    const { handle, runner, posted } = setup();
    handle({ type: "render", id: 4, plan });
    handle({ type: "render", id: 5, plan });
    handle({ type: "cancel", id: 4 });
    handle({ type: "cancel", id: 999 });
    expect(runner.jobs[0]?.signal?.aborted).toBe(true);
    expect(runner.jobs[1]?.signal?.aborted).toBe(false);
    await flush();
    expect(posted).toHaveLength(0);
    runner.jobs[1]?.resolve(fakeBitmap);
    await flush();
    expect(posted.map((p) => p.message.type)).toEqual(["bitmap"]);
    handle({ type: "cancel", id: 5 }); // schon fertig: nichts passiert
    expect(runner.jobs[1]?.signal?.aborted).toBe(false);
  });

  it("invalidate leitet die URL (oder alle) an den Läufer", () => {
    const { handle, runner } = setup();
    handle({ type: "invalidate", url: "blob:a" });
    handle({ type: "invalidate", url: null });
    expect(runner.invalidated).toEqual(["blob:a", undefined]);
  });

  it("dispose bricht alles ab und beendet den Läufer", async () => {
    const { handle, runner, posted } = setup();
    handle({ type: "render", id: 1, plan });
    handle({ type: "export", id: 2, plan, mime: "image/png", quality: null });
    handle({ type: "dispose" });
    expect(runner.jobs.every((j) => j.signal?.aborted)).toBe(true);
    expect(runner.disposed).toBe(true);
    await flush();
    expect(posted).toHaveLength(0);
  });
});
