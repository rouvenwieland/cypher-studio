import { describe, expect, it } from "vitest";
import { adaptWorker, createDefaultWorkerPort, createMockupRenderer, type WorkerPort } from "./client";
import { abortError, MockupEngineError } from "./errors";
import { planRender, type RenderPlan } from "./plan";
import type { WorkerRequest } from "./protocol";
import type { PlanRunner } from "./render2d";
import { GARMENTS, makeInput, makeLayers, makeTemplate } from "./test-fixtures";
import type { MockupImageType } from "./types";

/* ---- Attrappen ---- */

class FakePort implements WorkerPort {
  posted: WorkerRequest[] = [];
  terminated = false;
  throwOnPost = false;
  private messageListener: ((data: unknown) => void) | null = null;
  private failureListener: ((reason: string) => void) | null = null;

  post(message: WorkerRequest): void {
    if (this.throwOnPost) throw new Error("DataCloneError");
    this.posted.push(message);
  }
  onMessage(listener: (data: unknown) => void): void {
    this.messageListener = listener;
  }
  onFailure(listener: (reason: string) => void): void {
    this.failureListener = listener;
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(data: unknown): void {
    this.messageListener?.(data);
  }
  fail(reason: string): void {
    this.failureListener?.(reason);
  }
  get requests(): WorkerRequest[] {
    return this.posted.filter((m) => m.type === "render" || m.type === "export");
  }
}

interface RunnerJob {
  plan: RenderPlan;
  signal: AbortSignal | undefined;
  mime?: MockupImageType;
  quality?: number | null;
  resolve(value: ImageBitmap | Blob): void;
  reject(error: unknown): void;
}

class FakeRunner implements PlanRunner {
  jobs: RunnerJob[] = [];
  invalidated: (string | undefined)[] = [];
  disposed = false;
  /** Simuliert einen Läufer, der trotz Abbruch noch ein Ergebnis liefert. */
  ignoreAbort = false;

  renderBitmap(plan: RenderPlan, signal?: AbortSignal): Promise<ImageBitmap> {
    return new Promise<ImageBitmap>((resolve, reject) => {
      this.jobs.push({ plan, signal, resolve: resolve as RunnerJob["resolve"], reject });
      signal?.addEventListener("abort", () => {
        if (!this.ignoreAbort) reject(abortError());
      });
    });
  }
  renderBlob(plan: RenderPlan, mime: MockupImageType, quality: number | null, signal?: AbortSignal): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      this.jobs.push({ plan, signal, mime, quality, resolve: resolve as RunnerJob["resolve"], reject });
      signal?.addEventListener("abort", () => {
        if (!this.ignoreAbort) reject(abortError());
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

class FakeBitmap {
  closed = false;
  constructor(readonly label: string) {}
  close(): void {
    this.closed = true;
  }
}

function fakeBitmap(label: string): ImageBitmap & FakeBitmap {
  return new FakeBitmap(label) as unknown as ImageBitmap & FakeBitmap;
}

const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

function withWorker() {
  const port = new FakePort();
  const runner = new FakeRunner();
  let runnersCreated = 0;
  const renderer = createMockupRenderer({
    workerFactory: () => port,
    createRunner: () => {
      runnersCreated++;
      return runner;
    },
  });
  return { port, runner, renderer, runnersCreated: () => runnersCreated };
}

function withoutWorker() {
  const runner = new FakeRunner();
  let runnersCreated = 0;
  const renderer = createMockupRenderer({
    workerFactory: () => null,
    createRunner: () => {
      runnersCreated++;
      return runner;
    },
  });
  return { runner, renderer, runnersCreated: () => runnersCreated };
}

const input = makeInput();

async function expectRejection(promise: Promise<unknown>, code: MockupEngineError["code"]): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(MockupEngineError);
  await expect(promise).rejects.toMatchObject({ code });
}

/* ---- Tests ---- */

describe("createMockupRenderer: Betriebsart", () => {
  it("nutzt den Worker, wenn die Fabrik einen liefert", () => {
    const { renderer } = withWorker();
    expect(renderer.mode).toBe("worker");
  });

  it("fällt auf den Hauptthread zurück, wenn kein Worker verfügbar ist oder die Fabrik wirft", () => {
    expect(withoutWorker().renderer.mode).toBe("main");
    const throwing = createMockupRenderer({
      workerFactory: () => {
        throw new Error("CSP");
      },
    });
    expect(throwing.mode).toBe("main");
  });

  it("findet unter jsdom (kein Worker, kein OffscreenCanvas) von selbst den Hauptthread", () => {
    expect(createDefaultWorkerPort()).toBeNull();
    expect(createMockupRenderer().mode).toBe("main");
  });
});

describe("Client mit Worker: render", () => {
  it("sendet den geplanten Plan mit Anfrage-ID und löst bei der Antwort auf", async () => {
    const { port, renderer } = withWorker();
    const promise = renderer.render(input);
    expect(port.requests).toHaveLength(1);
    const request = port.requests[0];
    expect(request).toMatchObject({ type: "render", id: 1 });
    expect(request?.type === "render" && request.plan).toEqual(planRender(input));

    const bitmap = fakeBitmap("a");
    port.emit({ type: "bitmap", id: 1, bitmap });
    await expect(promise).resolves.toBe(bitmap);
    expect(bitmap.closed).toBe(false);
  });

  it("gibt den Faktor an die Planung weiter (Vorschau in halber Auflösung)", () => {
    const { port, renderer } = withWorker();
    void renderer.render(input, { scale: 0.5 }).catch(() => undefined);
    const request = port.requests[0];
    expect(request?.type === "render" && request.plan.output).toEqual({ width: 1200, height: 1500 });
  });

  it("verteilt mehrere gleichzeitige Anfragen über ihre IDs, auch in anderer Reihenfolge", async () => {
    const { port, renderer } = withWorker();
    const first = renderer.render(input);
    const second = renderer.render(makeInput({ colorId: "weiss", garment: GARMENTS.weiss }));
    expect(port.requests.map((r) => (r.type === "render" ? r.id : -1))).toEqual([1, 2]);
    const a = fakeBitmap("a");
    const b = fakeBitmap("b");
    port.emit({ type: "bitmap", id: 2, bitmap: b });
    port.emit({ type: "bitmap", id: 1, bitmap: a });
    await expect(first).resolves.toBe(a);
    await expect(second).resolves.toBe(b);
  });

  it("meldet Fehler des Workers mit Code und Meldung", async () => {
    const { port, renderer } = withWorker();
    const promise = renderer.render(input);
    port.emit({ type: "error", id: 1, code: "layer-load-failed", message: "Ebene fehlt" });
    await expectRejection(promise, "layer-load-failed");
    await expect(promise).rejects.toThrow("Ebene fehlt");
  });

  it("meldet Planungsfehler sofort und sendet nichts", async () => {
    const { port, renderer } = withWorker();
    const onlyLight = makeTemplate({ variants: [{ exposure: "light", layers: makeLayers("l"), colorIds: ["weiss"] }] });
    await expectRejection(renderer.render(makeInput({ template: onlyLight })), "no-variant");
    await expectRejection(renderer.render(makeInput({ colorId: "navy" })), "invalid-input");
    await expectRejection(renderer.render(input, { scale: 0 }), "invalid-input");
    expect(port.posted).toHaveLength(0);
  });

  it("ignoriert unbekannte oder fehlerhafte Antworten", async () => {
    const { port, renderer } = withWorker();
    const promise = renderer.render(input);
    port.emit(null);
    port.emit({ type: "bitmap", id: 1 }); // ohne Bitmap
    port.emit({ type: "bitmap", id: 99, bitmap: fakeBitmap("x") }); // unbekannte ID
    port.emit({ type: "wasAnderes" });
    const bitmap = fakeBitmap("ok");
    port.emit({ type: "bitmap", id: 1, bitmap });
    await expect(promise).resolves.toBe(bitmap);
  });

  it("schließt ein Bitmap, das zu einer unbekannten Anfrage gehört", () => {
    const { port } = withWorker();
    const stray = fakeBitmap("stray");
    port.emit({ type: "bitmap", id: 42, bitmap: stray });
    expect(stray.closed).toBe(true);
  });
});

describe("Client mit Worker: toBlob", () => {
  it("sendet PNG ohne Qualität als Standard", async () => {
    const { port, renderer } = withWorker();
    const promise = renderer.toBlob(input);
    const request = port.requests[0];
    expect(request).toMatchObject({ type: "export", id: 1, mime: "image/png", quality: null });
    expect(request?.type === "export" && request.plan.output).toEqual({ width: 2400, height: 3000 });
    expect(request?.type === "export" && request.plan.steps[0]).toEqual({
      kind: "background",
      fill: { type: "transparent" },
    });
    const blob = new Blob(["png"], { type: "image/png" });
    port.emit({ type: "blob", id: 1, blob });
    await expect(promise).resolves.toBe(blob);
  });

  it("legt JPEG auf einen deckenden Hintergrund und reicht die Qualität durch", () => {
    const { port, renderer } = withWorker();
    void renderer.toBlob(input, "image/jpeg", 0.8).catch(() => undefined);
    const request = port.requests[0];
    expect(request).toMatchObject({ type: "export", mime: "image/jpeg", quality: 0.8 });
    const first = request?.type === "export" ? request.plan.steps[0] : null;
    expect(first).toMatchObject({ kind: "background", fill: { type: "color" } });
  });

  it("exportiert immer in voller Auflösung, unabhängig von einer früheren Vorschau", () => {
    const { port, renderer } = withWorker();
    void renderer.render(input, { scale: 0.5 }).catch(() => undefined);
    void renderer.toBlob(input).catch(() => undefined);
    const request = port.requests[1];
    expect(request?.type === "export" && request.plan.output).toEqual({ width: 2400, height: 3000 });
  });

  it("prüft die Qualität", async () => {
    const { port, renderer } = withWorker();
    await expectRejection(renderer.toBlob(input, "image/jpeg", 1.5), "invalid-input");
    await expectRejection(renderer.toBlob(input, "image/jpeg", Number.NaN), "invalid-input");
    expect(port.posted).toHaveLength(0);
  });

  it("schließt ein Bitmap, das fälschlich auf eine Export-Anfrage kommt, und lehnt ab", async () => {
    const { port, renderer } = withWorker();
    const promise = renderer.toBlob(input);
    const wrong = fakeBitmap("wrong");
    port.emit({ type: "bitmap", id: 1, bitmap: wrong });
    await expectRejection(promise, "worker-failed");
    expect(wrong.closed).toBe(true);
  });
});

describe("Client mit Worker: Abbruch", () => {
  it("lehnt sofort ab, wenn das Signal schon ausgelöst ist, ohne etwas zu senden", async () => {
    const { port, renderer } = withWorker();
    const controller = new AbortController();
    controller.abort();
    await expectRejection(renderer.render(input, { signal: controller.signal }), "aborted");
    await expectRejection(renderer.toBlob(input, "image/png", undefined, { signal: controller.signal }), "aborted");
    expect(port.posted).toHaveLength(0);
  });

  it("lehnt ab, sendet cancel mit der ID und schließt eine spät eintreffende Antwort", async () => {
    const { port, renderer } = withWorker();
    const controller = new AbortController();
    const promise = renderer.render(input, { signal: controller.signal });
    controller.abort();
    await expectRejection(promise, "aborted");
    expect(port.posted).toEqual([expect.objectContaining({ type: "render", id: 1 }), { type: "cancel", id: 1 }]);

    const late = fakeBitmap("late");
    port.emit({ type: "bitmap", id: 1, bitmap: late });
    expect(late.closed).toBe(true);
  });

  it("bricht nur die betroffene Anfrage ab", async () => {
    const { port, renderer } = withWorker();
    const controller = new AbortController();
    const aborted = renderer.render(input, { signal: controller.signal });
    const kept = renderer.render(input);
    controller.abort();
    await expectRejection(aborted, "aborted");
    const bitmap = fakeBitmap("kept");
    port.emit({ type: "bitmap", id: 2, bitmap });
    await expect(kept).resolves.toBe(bitmap);
  });

  it("hängt nach Abschluss keinen Abbruch-Hörer mehr an das Signal", async () => {
    const { port, renderer } = withWorker();
    const controller = new AbortController();
    const promise = renderer.render(input, { signal: controller.signal });
    port.emit({ type: "bitmap", id: 1, bitmap: fakeBitmap("a") });
    await promise;
    controller.abort();
    expect(port.posted.filter((m) => m.type === "cancel")).toHaveLength(0);
  });
});

describe("Client: Rückfall auf den Hauptthread", () => {
  it("rendert ohne Worker über den Läufer und liefert dessen Bitmap", async () => {
    const { renderer, runner, runnersCreated } = withoutWorker();
    expect(runnersCreated()).toBe(0); // der Läufer entsteht erst bei Bedarf
    const promise = renderer.render(input, { scale: 0.5 });
    expect(runnersCreated()).toBe(1);
    expect(runner.jobs).toHaveLength(1);
    expect(runner.jobs[0]?.plan).toEqual(planRender(input, { scale: 0.5 }));
    const bitmap = fakeBitmap("main");
    runner.jobs[0]?.resolve(bitmap);
    await expect(promise).resolves.toBe(bitmap);
  });

  it("exportiert ohne Worker mit Typ und Qualität", async () => {
    const { renderer, runner } = withoutWorker();
    const promise = renderer.toBlob(input, "image/jpeg", 0.5);
    expect(runner.jobs[0]).toMatchObject({ mime: "image/jpeg", quality: 0.5 });
    const blob = new Blob(["j"]);
    runner.jobs[0]?.resolve(blob);
    await expect(promise).resolves.toBe(blob);
  });

  it("bricht einen Hauptthread-Lauf über das Signal ab und schließt ein spätes Bitmap", async () => {
    const { renderer, runner } = withoutWorker();
    runner.ignoreAbort = true;
    const controller = new AbortController();
    const promise = renderer.render(input, { signal: controller.signal });
    controller.abort();
    await expectRejection(promise, "aborted");
    expect(runner.jobs[0]?.signal?.aborted).toBe(true);
    const late = fakeBitmap("late");
    runner.jobs[0]?.resolve(late);
    await flush();
    expect(late.closed).toBe(true);
  });

  it("meldet Fehler des Läufers als MockupEngineError", async () => {
    const { renderer, runner } = withoutWorker();
    const promise = renderer.render(input);
    runner.jobs[0]?.reject(new MockupEngineError("design-load-failed", "Motiv fehlt"));
    await expectRejection(promise, "design-load-failed");
    const other = renderer.render(input);
    runner.jobs[1]?.reject(new Error("unerwartet"));
    await expectRejection(other, "worker-failed");
  });

  it("gibt Fehler weiter, wenn der Läufer gar nicht erst erzeugt werden kann", async () => {
    const renderer = createMockupRenderer({
      workerFactory: () => null,
      createRunner: () => {
        throw new MockupEngineError("canvas-unavailable", "kein Canvas");
      },
    });
    await expectRejection(renderer.render(input), "canvas-unavailable");
  });
});

describe("Client: Ausfall des Workers", () => {
  it("übernimmt bei einem Worker-Fehler alle offenen Anfragen im Hauptthread und bleibt dort", async () => {
    const { port, runner, renderer } = withWorker();
    const a = renderer.render(input);
    const b = renderer.toBlob(input, "image/png");
    expect(port.requests).toHaveLength(2);

    port.fail("Skript konnte nicht geladen werden");
    expect(port.terminated).toBe(true);
    expect(renderer.mode).toBe("main");
    expect(runner.jobs).toHaveLength(2);
    expect(runner.jobs[0]?.plan).toEqual(planRender(input));
    expect(runner.jobs[1]?.mime).toBe("image/png");

    const bitmap = fakeBitmap("fallback");
    const blob = new Blob(["fallback"]);
    runner.jobs[0]?.resolve(bitmap);
    runner.jobs[1]?.resolve(blob);
    await expect(a).resolves.toBe(bitmap);
    await expect(b).resolves.toBe(blob);

    // weitere Anfragen laufen gleich im Hauptthread, dem Worker wird nichts mehr geschickt
    void renderer.render(input).catch(() => undefined);
    expect(runner.jobs).toHaveLength(3);
    expect(port.requests).toHaveLength(2);
    port.fail("zweiter Fehler"); // doppelte Meldung ist harmlos
    expect(runner.jobs).toHaveLength(3);
  });

  it("ignoriert Antworten des ausgefallenen Workers, die doch noch eintreffen", async () => {
    const { port, runner, renderer } = withWorker();
    const promise = renderer.render(input);
    port.fail("Absturz");
    const winner = fakeBitmap("local");
    runner.jobs[0]?.resolve(winner);
    await expect(promise).resolves.toBe(winner);
    const stray = fakeBitmap("stray");
    port.emit({ type: "bitmap", id: 1, bitmap: stray });
    expect(stray.closed).toBe(true);
  });

  it("wechselt auch, wenn der Worker kein 2D-Canvas hat (canvas-unavailable)", async () => {
    const { port, runner, renderer } = withWorker();
    const promise = renderer.render(input);
    port.emit({ type: "error", id: 1, code: "canvas-unavailable", message: "kein OffscreenCanvas" });
    expect(renderer.mode).toBe("main");
    expect(port.terminated).toBe(true);
    const bitmap = fakeBitmap("main");
    runner.jobs[0]?.resolve(bitmap);
    await expect(promise).resolves.toBe(bitmap);
  });

  it("wechselt, wenn das Senden an den Worker scheitert, und bedient die Anfrage im Hauptthread", async () => {
    const { port, runner, renderer } = withWorker();
    port.throwOnPost = true;
    const promise = renderer.render(input);
    expect(renderer.mode).toBe("main");
    expect(runner.jobs).toHaveLength(1);
    const bitmap = fakeBitmap("main");
    runner.jobs[0]?.resolve(bitmap);
    await expect(promise).resolves.toBe(bitmap);
  });

  it("ein abgebrochener Auftrag wird beim Wechsel nicht noch einmal gestartet", async () => {
    const { port, runner, renderer } = withWorker();
    const controller = new AbortController();
    const aborted = renderer.render(input, { signal: controller.signal });
    controller.abort();
    await expectRejection(aborted, "aborted");
    port.fail("Absturz");
    expect(runner.jobs).toHaveLength(0);
  });
});

describe("Client: invalidate und dispose", () => {
  it("meldet Invalidierungen an den Worker und, falls vorhanden, an den Läufer", () => {
    const { port, runner, renderer } = withWorker();
    renderer.invalidate("blob:design-1");
    renderer.invalidate();
    expect(port.posted).toEqual([
      { type: "invalidate", url: "blob:design-1" },
      { type: "invalidate", url: null },
    ]);
    void runner;

    const main = withoutWorker();
    main.renderer.invalidate("x"); // noch kein Läufer: nichts zu tun
    void main.renderer.render(input).catch(() => undefined);
    main.renderer.invalidate("blob:design-1");
    main.renderer.invalidate();
    expect(main.runner.invalidated).toEqual(["blob:design-1", undefined]);
  });

  it("dispose beendet den Worker, lehnt offene Anfragen mit disposed ab und ist idempotent", async () => {
    const { port, renderer } = withWorker();
    const a = renderer.render(input);
    const b = renderer.toBlob(input);
    renderer.dispose();
    renderer.dispose();
    expect(port.terminated).toBe(true);
    await expectRejection(a, "disposed");
    await expectRejection(b, "disposed");
    await expectRejection(renderer.render(input), "disposed");
    await expectRejection(renderer.toBlob(input), "disposed");
    renderer.invalidate("x");
    expect(port.posted.filter((m) => m.type === "invalidate")).toHaveLength(0);
  });

  it("dispose bricht Hauptthread-Läufe ab und beendet den Läufer", async () => {
    const { renderer, runner } = withoutWorker();
    runner.ignoreAbort = true;
    const promise = renderer.render(input);
    renderer.dispose();
    await expectRejection(promise, "disposed");
    expect(runner.jobs[0]?.signal?.aborted).toBe(true);
    expect(runner.disposed).toBe(true);
    const late = fakeBitmap("late");
    runner.jobs[0]?.resolve(late);
    await flush();
    expect(late.closed).toBe(true);
  });
});

describe("adaptWorker", () => {
  it("verbindet Senden, Nachrichten, Fehler und Beenden mit dem echten Worker-Objekt", () => {
    const sent: unknown[] = [];
    const fake: Record<string, unknown> = {
      postMessage: (message: unknown) => sent.push(message),
      terminate: () => {
        fake["terminated"] = true;
      },
    };
    const port = adaptWorker(fake as unknown as Worker);
    const messages: unknown[] = [];
    const failures: string[] = [];
    port.onMessage((data) => messages.push(data));
    port.onFailure((reason) => failures.push(reason));

    port.post({ type: "dispose" });
    expect(sent).toEqual([{ type: "dispose" }]);

    (fake["onmessage"] as (event: { data: unknown }) => void)({ data: { type: "x" } });
    expect(messages).toEqual([{ type: "x" }]);

    let prevented = false;
    (fake["onerror"] as (event: { message: string; preventDefault(): void }) => void)({
      message: "Skript nicht ladbar",
      preventDefault: () => {
        prevented = true;
      },
    });
    (fake["onerror"] as (event: { message: string; preventDefault(): void }) => void)({
      message: "",
      preventDefault: () => undefined,
    });
    (fake["onmessageerror"] as () => void)();
    expect(prevented).toBe(true);
    expect(failures).toEqual(["Skript nicht ladbar", "worker error", "worker message could not be deserialized"]);

    port.terminate();
    expect(fake["terminated"]).toBe(true);
  });
});
