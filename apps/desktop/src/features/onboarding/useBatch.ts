import { useCallback, useRef, useState } from "react";
import type { AppError, Installation, InstallEvent, InstallPlan } from "@contract";
import { call } from "../../ipc/commands";
import { channel } from "../../ipc/channel";
import { toAppError } from "../../ipc/errors";
import { nowIso } from "../../lib/clock";
import { watchJobBriefly } from "../../app/stores";
import { applyDefaultSetup } from "../install/setupAfter";

export type BatchState = "pending" | "running" | "done" | "failed" | "cancelled";

export interface BatchItem {
  programId: string;
  name: string;
  plan: InstallPlan | null;
  planError: AppError | null;
  state: BatchState;
  progress: number;
  phase: string | null;
  installation: Installation | null;
  error: AppError | null;
  setup: "off" | "pending" | "running" | "done" | "needsYou";
  setupCount: number;
  jobId: string | null;
  startedAt: number | null;
  downloaded: number;
}

/**
 * Mehrere Programme nacheinander prüfen und gemeinsam laden (Erststart, Schritte 3–5).
 * Jedes Programm bekommt seine eigene Prüfungsanzeige; die Zustimmung gilt je Plan (ARCHITEKTUR 5.1).
 */
export function useBatch(applySetup: boolean) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const itemsRef = useRef<BatchItem[]>([]);

  const patch = useCallback((programId: string, fn: (item: BatchItem) => BatchItem) => {
    itemsRef.current = itemsRef.current.map((it) => (it.programId === programId ? fn(it) : it));
    setItems(itemsRef.current);
  }, []);

  const preview = useCallback(
    async (programs: { id: string; name: string }[]) => {
      setPreviewing(true);
      itemsRef.current = programs.map((p) => ({
        programId: p.id,
        name: p.name,
        plan: null,
        planError: null,
        state: "pending",
        progress: 0,
        phase: null,
        installation: null,
        error: null,
        setup: applySetup ? ("pending" as const) : ("off" as const),
        setupCount: 0,
        jobId: null,
        startedAt: null,
        downloaded: 0,
      }));
      setItems(itemsRef.current);
      await Promise.all(
        programs.map(async (p) => {
          try {
            const plan = await call("install_preview", { req: { programId: p.id } });
            patch(p.id, (it) => ({ ...it, plan }));
          } catch (e) {
            patch(p.id, (it) => ({ ...it, planError: toAppError(e) }));
          }
        }),
      );
      setPreviewing(false);
    },
    [applySetup, patch],
  );

  const runOne = useCallback(
    async (item: BatchItem) => {
      const plan = item.plan;
      if (!plan) return;
      patch(item.programId, (it) => ({ ...it, state: "running", startedAt: Date.now() }));
      const onEvent = (e: InstallEvent) => {
        switch (e.type) {
          case "started":
            watchJobBriefly(e.jobId, 600_000);
            patch(item.programId, (it) => ({ ...it, jobId: e.jobId }));
            break;
          case "phase":
            patch(item.programId, (it) => ({ ...it, phase: e.phase }));
            break;
          case "downloadProgress":
            patch(item.programId, (it) => ({
              ...it,
              progress: (e.downloadedBytes / e.totalBytes) * 0.8,
              downloaded: e.downloadedBytes,
            }));
            break;
          case "extractProgress":
            patch(item.programId, (it) => ({
              ...it,
              progress: 0.8 + (e.entriesTotal ? (e.entriesDone / e.entriesTotal) * 0.2 : 0),
            }));
            break;
          default:
            break;
        }
      };
      try {
        const installation = await call("install_start", {
          req: {
            planId: plan.planId,
            consent: {
              planId: plan.planId,
              sha256: plan.artifact.sha256,
              licenseSpdx: plan.license.spdx,
              targetDir: plan.target.dir,
              acceptedAt: nowIso(),
            },
          },
          onEvent: channel<InstallEvent>(onEvent),
        });
        patch(item.programId, (it) => ({ ...it, state: "done", progress: 1, installation }));
        if (applySetup) {
          patch(item.programId, (it) => ({ ...it, setup: "running" }));
          try {
            const r = await applyDefaultSetup(item.programId, installation.id);
            patch(item.programId, (it) => ({ ...it, setup: r.needsYou ? "needsYou" : "done", setupCount: r.count }));
          } catch {
            patch(item.programId, (it) => ({ ...it, setup: "needsYou" }));
          }
        }
      } catch (e) {
        const error = toAppError(e);
        patch(item.programId, (it) => ({ ...it, state: error.kind === "cancelled" ? "cancelled" : "failed", error }));
      }
    },
    [applySetup, patch],
  );

  /** Alle Programme gleichzeitig starten; der Kern ordnet die Downloads nach `downloads.maxParallel`. */
  const startAll = useCallback(() => {
    const todo = itemsRef.current.filter((it) => it.plan && it.state === "pending");
    for (const it of todo) void runOne(it);
  }, [runOne]);

  const cancelAll = useCallback(() => {
    for (const it of itemsRef.current)
      if (it.jobId && it.state === "running") void call("job_cancel", { req: { jobId: it.jobId } });
  }, []);

  const settled =
    items.length > 0 &&
    items.every(
      (it) =>
        it.state === "done" || it.state === "failed" || it.state === "cancelled" || (!it.plan && it.planError !== null),
    );
  const running = items.some((it) => it.state === "running");
  return { items, previewing, preview, startAll, cancelAll, settled, running };
}
