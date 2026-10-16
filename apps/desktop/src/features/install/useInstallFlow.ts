import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AppError, Installation, InstallEvent, InstallPhase, InstallPlan } from "@contract";
import { call } from "../../ipc/commands";
import { channel } from "../../ipc/channel";
import { toAppError } from "../../ipc/errors";
import { nowIso } from "../../lib/clock";
import { useJobs } from "../../app/stores";
import { applyDefaultSetup } from "./setupAfter";

/**
 * Ablauf Installieren (ARCHITEKTUR 5.1): Vorschau → Zustimmung → Laden/Prüfen/Entpacken → optional Einrichten.
 * Der Hook hält den Zustand des Dialogs; Fortschritt kommt über den Kanal, Fehler als Ablehnung des Commands.
 */
export interface RunProgress {
  phase: InstallPhase | "setup" | null;
  download: { done: number; total: number; rate: number };
  extract: { done: number; total: number | null };
  verified: boolean;
  verifiedSha: string | null;
  setup: "off" | "pending" | "running" | "done" | "needsYou";
  setupCount: number;
  cancelling: boolean;
  jobId: string | null;
}

export type Stage =
  | { kind: "loading" }
  | { kind: "review"; plan: InstallPlan }
  | { kind: "running"; plan: InstallPlan; progress: RunProgress }
  | { kind: "done"; plan: InstallPlan; installation: Installation; setupCount: number; setupNeedsYou: boolean }
  | { kind: "error"; plan: InstallPlan | null; error: AppError; progress: RunProgress | null };

const EMPTY: RunProgress = {
  phase: null,
  download: { done: 0, total: 0, rate: 0 },
  extract: { done: 0, total: null },
  verified: false,
  verifiedSha: null,
  setup: "off",
  setupCount: 0,
  cancelling: false,
  jobId: null,
};

export interface InstallFlow {
  stage: Stage;
  applySetup: boolean;
  setApplySetup: (value: boolean) => void;
  start: () => void;
  cancel: () => void;
  reload: () => void;
}

export function useInstallFlow(programId: string, version: string | undefined, hasPack: boolean, defaultApplySetup: boolean): InstallFlow {
  const qc = useQueryClient();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [applySetup, setApplySetup] = useState(defaultApplySetup && hasPack);
  const generation = useRef(0);
  const planRef = useRef<InstallPlan | null>(null);
  const progressRef = useRef<RunProgress>(EMPTY);

  const loadPlan = useCallback(() => {
    const gen = ++generation.current;
    setStage({ kind: "loading" });
    call("install_preview", { req: { programId, ...(version ? { version } : {}) } })
      .then((plan) => {
        if (gen !== generation.current) return;
        planRef.current = plan;
        setStage({ kind: "review", plan });
      })
      .catch((e: unknown) => {
        if (gen !== generation.current) return;
        planRef.current = null;
        setStage({ kind: "error", plan: null, error: toAppError(e), progress: null });
      });
  }, [programId, version]);

  useEffect(() => {
    loadPlan();
    return () => {
      generation.current += 1;
    };
  }, [loadPlan]);

  const patch = useCallback((fn: (p: RunProgress) => RunProgress) => {
    progressRef.current = fn(progressRef.current);
    const plan = planRef.current;
    if (plan) setStage((s) => (s.kind === "running" ? { kind: "running", plan, progress: progressRef.current } : s));
  }, []);

  const handleEvent = useCallback(
    (e: InstallEvent) => {
      switch (e.type) {
        case "started":
          useJobs.getState().watch(e.jobId);
          patch((p) => ({ ...p, jobId: e.jobId, download: { ...p.download, total: e.totalBytes } }));
          break;
        case "phase":
          patch((p) => ({ ...p, phase: e.phase }));
          break;
        case "downloadProgress":
          patch((p) => ({ ...p, download: { done: e.downloadedBytes, total: e.totalBytes, rate: e.bytesPerSecond } }));
          break;
        case "resumed":
        case "retrying":
          break;
        case "verified":
          patch((p) => ({ ...p, verified: true, verifiedSha: e.sha256 }));
          break;
        case "extractProgress":
          patch((p) => ({ ...p, extract: { done: e.entriesDone, total: e.entriesTotal } }));
          break;
        case "finished":
          break;
      }
    },
    [patch],
  );

  const runSetup = useCallback(
    async (installation: Installation, plan: InstallPlan): Promise<{ count: number; needsYou: boolean }> => {
      patch((p) => ({ ...p, phase: "setup", setup: "running" }));
      return applyDefaultSetup(plan.programId, installation.id);
    },
    [patch],
  );

  const start = useCallback(() => {
    const plan = planRef.current;
    if (!plan) return;
    progressRef.current = { ...EMPTY, setup: applySetup ? "pending" : "off", download: { done: 0, total: plan.artifact.size, rate: 0 } };
    setStage({ kind: "running", plan, progress: progressRef.current });
    call("install_start", {
      req: {
        planId: plan.planId,
        consent: { planId: plan.planId, sha256: plan.artifact.sha256, licenseSpdx: plan.license.spdx, targetDir: plan.target.dir, acceptedAt: nowIso() },
      },
      onEvent: channel(handleEvent),
    })
      .then(async (installation) => {
        patch((p) => ({ ...p, phase: "register" }));
        let setupCount = 0;
        let setupNeedsYou = false;
        if (applySetup) {
          try {
            const r = await runSetup(installation, plan);
            setupCount = r.count;
            setupNeedsYou = r.needsYou;
          } catch {
            setupNeedsYou = true;
          }
        }
        void qc.invalidateQueries({ queryKey: ["programs_list"] });
        setStage({ kind: "done", plan, installation, setupCount, setupNeedsYou });
        const id = progressRef.current.jobId;
        if (id) setTimeout(() => useJobs.getState().unwatch(id), 1500);
      })
      .catch((e: unknown) => {
        const error = toAppError(e);
        const id = progressRef.current.jobId;
        if (id) setTimeout(() => useJobs.getState().unwatch(id), 1500);
        setStage({ kind: "error", plan, error, progress: progressRef.current });
        void qc.invalidateQueries({ queryKey: ["programs_list"] });
      });
  }, [applySetup, handleEvent, patch, qc, runSetup]);

  const cancel = useCallback(() => {
    const id = progressRef.current.jobId;
    if (!id) return;
    patch((p) => ({ ...p, cancelling: true }));
    void call("job_cancel", { req: { jobId: id } });
  }, [patch]);

  return { stage, applySetup, setApplySetup, start, cancel, reload: loadPlan };
}
