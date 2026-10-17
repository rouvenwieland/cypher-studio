/** Installationsplan und Simulation von Laden, Prüfen, Entpacken (Mock-Modus). */
import type {
  AppError,
  InstallConsent,
  InstallEvent,
  Installation,
  InstallNote,
  InstallPlan,
  InstallStartReq,
} from "@contract";
import { now, nowIso } from "../../lib/clock";
import {
  db,
  finishJob,
  iso,
  makeInstallation,
  newId,
  progressJob,
  sleepScaled,
  startJob,
  catalogProgram,
  type ActiveJob,
} from "./state";
import { GIB, MIB, PROGRAMS_DIR, fakeSha } from "./fixtures";
import { emit } from "@tauri-apps/api/event";

export function makePlan(programId: string, version?: string): InstallPlan {
  const p = catalogProgram(programId);
  if (!p) throw { kind: "notFound", entity: "program", id: programId } satisfies AppError;
  const v = version ?? p.latest;
  const installs = db.installations[p.id] ?? [];
  const replaces = installs.find((i) => i.kind === "cypher" && i.version !== v) ?? null;
  const existing = installs.filter((i) => i.kind !== "cypher");
  const notes: InstallNote[] = [];
  if (p.downloadSize > 300 * MIB) notes.push({ kind: "largeDownload", bytes: p.downloadSize });
  const plan: InstallPlan = {
    planId: newId(),
    programId: p.id,
    programName: p.name,
    version: v,
    channel: p.channel,
    source: {
      label: p.hostLabel,
      host: p.host,
      url: `https://${p.host}${p.urlPath(v)}`,
      mirrorRedirects: p.mirrorRedirects,
    },
    artifact: {
      kind: p.fileName(v).endsWith(".7z") ? "7z" : p.fileName(v).endsWith(".exe") ? "exeInstaller" : "zip",
      fileName: p.fileName(v),
      size: p.downloadSize,
      sha256: fakeSha(`${p.id}-${v}`),
      checksumSource: `https://${p.host}${p.urlPath(v)}.sha256`,
      checksumOrigin: p.id === "krita" ? "cypherPinned" : "upstream",
      signature: null,
    },
    license: p.license,
    target: {
      dir: `${PROGRAMS_DIR}\\${p.id}\\${v}`,
      requiredBytes: p.downloadSize + p.unpackedSize,
      availableBytes: 212 * GIB,
      portable: true,
      needsAdmin: false,
    },
    replaces,
    existing,
    notes,
    createdAt: nowIso(),
    expiresAt: iso(10),
  };
  db.plans.set(plan.planId, plan);
  return plan;
}

export function checkConsent(plan: InstallPlan, consent: InstallConsent): void {
  if (
    consent.planId !== plan.planId ||
    consent.sha256 !== plan.artifact.sha256 ||
    consent.licenseSpdx !== plan.license.spdx ||
    consent.targetDir !== plan.target.dir
  ) {
    throw { kind: "consentMismatch", planId: plan.planId } satisfies AppError;
  }
}

function cancelled(): AppError {
  return { kind: "cancelled" };
}

/** Eine Phase mit festem Zeitbedarf (ms bei Geschwindigkeit 1). */
async function phase(job: ActiveJob, ms: number, from: number, to: number, name: string, step = 120): Promise<void> {
  const steps = Math.max(1, Math.round(ms / step));
  for (let i = 1; i <= steps; i++) {
    if (job.cancelled) throw cancelled();
    await sleepScaled(step);
    progressJob(job, from + ((to - from) * i) / steps, name);
  }
}

export async function runInstall(req: InstallStartReq, onEvent: (event: InstallEvent) => void): Promise<Installation> {
  const plan = db.plans.get(req.planId);
  if (!plan) throw { kind: "planExpired", planId: req.planId } satisfies AppError;
  if (new Date(plan.expiresAt).getTime() < now().getTime())
    throw { kind: "planExpired", planId: req.planId } satisfies AppError;
  checkConsent(plan, req.consent);
  const p = catalogProgram(plan.programId);
  if (!p) throw { kind: "notFound", entity: "program", id: plan.programId } satisfies AppError;
  for (const j of db.jobs.values()) {
    if (j.programId === p.id) throw { kind: "busy", reason: "jobRunning", jobId: j.info.id } satisfies AppError;
  }
  db.plans.delete(plan.planId);
  const job = startJob("install", p.name, p.id);
  const total = plan.artifact.size;
  onEvent({ type: "started", jobId: job.info.id, totalBytes: total });
  try {
    onEvent({ type: "phase", phase: "download" });
    const rate = 14 * MIB;
    let done = 0;
    const failAt = db.flags.has("installNetworkFail") ? 0.4 : null;
    while (done < total) {
      if (job.cancelled) throw cancelled();
      await sleepScaled(100);
      const chunk = Math.min(total - done, rate * 0.1 * (0.85 + Math.random() * 0.3));
      done += chunk;
      onEvent({
        type: "downloadProgress",
        downloadedBytes: Math.round(done),
        totalBytes: total,
        bytesPerSecond: Math.round(rate),
      });
      progressJob(job, (done / total) * 0.7, "download");
      if (failAt !== null && done / total > failAt) {
        throw {
          kind: "network",
          host: plan.source.host,
          message: `Verbindung zu ${plan.source.host} abgebrochen bei ${Math.round(done / MIB)} von ${Math.round(total / MIB)} MB`,
          retryable: true,
        } satisfies AppError;
      }
    }
    onEvent({ type: "phase", phase: "verifyChecksum" });
    await phase(job, 900, 0.7, 0.78, "verifyChecksum");
    if (db.flags.has("installChecksumFail")) {
      const actual = fakeSha(`manipuliert-${plan.artifact.sha256}`);
      throw {
        kind: "checksumMismatch",
        file: plan.artifact.fileName,
        expected: plan.artifact.sha256,
        actual: actual.slice(0, 20) + plan.artifact.sha256.slice(20, 44) + actual.slice(44),
      } satisfies AppError;
    }
    onEvent({ type: "verified", sha256: plan.artifact.sha256, signatureChecked: false });
    onEvent({ type: "phase", phase: "extract" });
    const entries = 1840;
    for (let i = 1; i <= 12; i++) {
      if (job.cancelled) throw cancelled();
      await sleepScaled(110);
      onEvent({
        type: "extractProgress",
        entriesDone: Math.round((entries * i) / 12),
        entriesTotal: entries,
        bytesWritten: Math.round((p.unpackedSize * i) / 12),
      });
      progressJob(job, 0.78 + (0.16 * i) / 12, "extract");
    }
    onEvent({ type: "phase", phase: "checkContent" });
    await phase(job, 400, 0.94, 0.97, "checkContent");
    onEvent({ type: "phase", phase: "register" });
    await phase(job, 300, 0.97, 1, "register");
    const list = (db.installations[p.id] ?? []).filter((i) => !(i.kind === "cypher"));
    const installation = makeInstallation(p, plan.version);
    installation.installedAt = nowIso();
    db.installations[p.id] = [installation, ...list];
    db.preferred[p.id] = installation.id;
    // nach Aktualisierung: bisherige Einrichtung bleibt, Bausteine werden „veraltet“
    if (plan.replaces) {
      const st = db.setup[p.pack.packId];
      if (st)
        for (const id of Object.keys(st.components))
          if (st.components[id] === "current") st.components[id] = "outdated";
    }
    onEvent({ type: "finished", installation });
    finishJob(job, "succeeded", null, { kind: "installation", installationId: installation.id });
    void emit("programs:changed", { reason: "installed" });
    return installation;
  } catch (error) {
    const isErr = typeof error === "object" && error !== null && "kind" in error;
    const appError: AppError = isErr
      ? (error as AppError)
      : { kind: "internal", message: "Unbekannter Fehler in der Simulation", correlationId: "mock" };
    finishJob(
      job,
      appError.kind === "cancelled" ? "cancelled" : "failed",
      appError.kind === "cancelled" ? null : appError,
      { kind: "none" },
    );
    throw appError;
  }
}
