/**
 * Mock-Modus (ARCHITEKTUR 8.3): ersetzt das Tauri-IPC durch Fixture-Handler, wenn die App im Browser läuft
 * (Entwicklung, Playwright). Szenario: `window.__CYPHER_SCENARIO__` oder `?scenario=…`.
 * Test-Zugriff: `window.__CYPHER_MOCK__` (Ereignisse senden, Aufrufe lesen, Zustand zurücksetzen).
 */
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { EXPORT_IMAGE_HEADERS, type ExportImageMeta, type FileHandleInfo } from "@contract";
import { setClockTo } from "../../lib/clock";
import { handlers, registerBlobHandle } from "./handlers";
import { SCENARIOS, db, finishJob, newId, resetDb, startJob } from "./state";
import { toAppError } from "../errors";

interface MockApi {
  emit: (name: string, payload: unknown) => Promise<void>;
  calls: () => { cmd: string; args: unknown }[];
  scenario: () => string;
  reset: (scenario?: string) => void;
  exports: { meta: ExportImageMeta; bytes: number; url: string }[];
}

declare global {
  interface Window {
    __CYPHER_MOCK__?: MockApi;
    __CYPHER_SCENARIO__?: string;
    __CYPHER_MOCK_SPEED__?: number;
    __CYPHER_PICK__?: string;
    __CYPHER_MOCK_LATENCY__?: number;
    /** Antwortzeit einzelner Commands in ms (auch der „sofortigen“): macht Wettläufe mit dem echten, langsameren IPC sichtbar */
    __CYPHER_MOCK_DELAY__?: Record<string, number>;
  }
}

/** Diese Commands antworten auch bei künstlicher Antwortzeit sofort (Einstellungen und Marke tragen das Gerüst). */
const INSTANT = new Set(["settings_get", "settings_update", "app_info", "brand_get", "jobs_active", "jobs_recent"]);

/** Szenario aus `window.__CYPHER_SCENARIO__` oder `?scenario=`; mehrere mit „+“ kombinierbar. */
function readScenario(): string {
  const fromWindow = window.__CYPHER_SCENARIO__;
  const fromUrl = new URLSearchParams(window.location.search).get("scenario");
  const wanted = fromWindow ?? fromUrl ?? "default";
  return wanted.split("+").every((p) => (SCENARIOS as readonly string[]).includes(p)) ? wanted : "default";
}

function seedBusy(): void {
  const job = startJob("install", "Kdenlive", "kdenlive");
  job.info = { ...job.info, progress: 0.64, phase: "download" };
  const timer = setInterval(() => {
    if (job.cancelled) {
      clearInterval(timer);
      finishJob(job, "cancelled", null, { kind: "none" });
    }
  }, 300);
  const second = startJob("libraryScan", "Gemeinsamer Ordner", null);
  second.info = { ...second.info, progress: 0.4, phase: "scan" };
}

export function installMock(): void {
  const params = new URLSearchParams(window.location.search);
  const speedParam = Number(params.get("speed"));
  if (speedParam > 0) window.__CYPHER_MOCK_SPEED__ = speedParam;
  if (params.get("clock") !== "real") setClockTo(new Date("2026-10-16T12:40:00Z"));
  const scenario = readScenario();
  resetDb(scenario);
  const exports: MockApi["exports"] = [];
  let lastMeta: ExportImageMeta | null = null;

  // Eigener Ereignisbus: Das mitgelieferte Mock meldet Abmeldungen nicht richtig zurück (args.id statt eventId).
  const listeners = new Map<string, Set<number>>();
  const runCallback = (id: number, data: unknown) =>
    (
      window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } }
    ).__TAURI_INTERNALS__.runCallback(id, data);

  mockIPC(
    async (cmd, payload) => {
      if (cmd === "plugin:event|listen") {
        const a = payload as unknown as { event: string; handler: number };
        const set = listeners.get(a.event) ?? new Set<number>();
        set.add(a.handler);
        listeners.set(a.event, set);
        return a.handler;
      }
      if (cmd === "plugin:event|unlisten") {
        const a = payload as unknown as { event: string; eventId: number };
        listeners.get(a.event)?.delete(a.eventId);
        return undefined;
      }
      if (cmd === "plugin:event|emit") {
        const a = payload as unknown as { event: string; payload: unknown };
        for (const id of [...(listeners.get(a.event) ?? [])])
          runCallback(id, { event: a.event, id, payload: a.payload });
        return undefined;
      }
      if (cmd.startsWith("plugin:")) return undefined;
      if (cmd === "export_save_image") {
        const body = payload as unknown as Uint8Array;
        const meta = lastMeta ?? {
          fileName: "export.png",
          format: "png" as const,
          destination: { kind: "dialog" as const },
        };
        const dir =
          meta.destination.kind === "project"
            ? `D:\\Sync\\Cypher\\Projekte\\Herbst-Drop 26\\${meta.destination.folder.replace("/", "\\")}`
            : meta.destination.kind === "library"
              ? `D:\\Sync\\Cypher\\${meta.destination.subfolder}`
              : "C:\\Users\\Lena\\Desktop";
        const blob = new Blob([body.slice().buffer], { type: meta.format === "png" ? "image/png" : "image/jpeg" });
        const url = URL.createObjectURL(blob);
        exports.push({ meta, bytes: body.byteLength, url });
        const handle: FileHandleInfo = {
          id: `fh-${newId().slice(0, 8)}`,
          name: meta.fileName,
          displayPath: `${dir}\\${meta.fileName}`,
          size: body.byteLength,
          mime: blob.type,
          url,
          source: "export",
        };
        db.handles.set(handle.id, handle);
        void emit("library:changed", { reason: "import", changedCount: 1 });
        return handle;
      }
      const handler = (handlers as Record<string, ((args: unknown) => unknown) | undefined>)[cmd];
      db.calls.push({ cmd, args: payload });
      if (!handler)
        throw { kind: "internal", message: `Mock: Command „${cmd}“ ist nicht bekannt`, correlationId: "mock" };
      // Künstliche Antwortzeit (nur für Fotos der Laden-Zustände): `window.__CYPHER_MOCK_LATENCY__` in ms
      const latency = window.__CYPHER_MOCK_LATENCY__ ?? 0;
      if (latency > 0 && !INSTANT.has(cmd)) await new Promise((r) => setTimeout(r, latency));
      const delay = window.__CYPHER_MOCK_DELAY__?.[cmd] ?? 0;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      try {
        return await handler(payload ?? {});
      } catch (error) {
        throw toAppError(error);
      }
    },
    { shouldMockEvents: false },
  );

  // Kopfzeilen des RAW-Commands abgreifen (mockIPC reicht `options` nicht an den Handler weiter)
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: unknown, options?: { headers?: Record<string, string> }) => Promise<unknown>;
      };
    }
  ).__TAURI_INTERNALS__;
  const original = internals.invoke.bind(internals);
  internals.invoke = (cmd, args, options) => {
    if (cmd === "export_save_image") {
      const raw = options?.headers?.[EXPORT_IMAGE_HEADERS.meta];
      if (raw) lastMeta = JSON.parse(decodeURIComponent(raw)) as ExportImageMeta;
    }
    return original(cmd, args, options);
  };

  if (db.flags.has("busy")) seedBusy();

  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    void (async () => {
      const handles: FileHandleInfo[] = [];
      for (const file of files) {
        const url = URL.createObjectURL(file);
        const bmp = await createImageBitmap(file).catch(() => null);
        handles.push(registerBlobHandle(file, url, bmp?.width ?? 2000, bmp?.height ?? 2000));
      }
      await emit("files:dropped", { handles, position: { x: e.clientX, y: e.clientY } });
    })();
  });

  window.__CYPHER_MOCK__ = {
    emit: (name, payload) => emit(name, payload),
    calls: () => db.calls,
    scenario: () => [...db.flags].join("+"),
    reset: (next) => {
      resetDb(next ?? scenario);
    },
    exports,
  };
}
