import type { Installation, JobInfo, ProgramOverview } from "@contract";

/**
 * Zustand eines Programms für Tafel und Startseite: reine Ableitung aus Katalog, Installationen und laufenden Aufträgen.
 * Status-Wörter: nicht installiert · wird geladen · wird geprüft · wird installiert · installiert · eingerichtet ·
 * Update verfügbar · gefunden (außerhalb von Studio) · Fehler (CONCEPT.md 6.2).
 */
export type ProgramStatusId =
  | "notInstalled"
  | "downloading"
  | "verifying"
  | "installing"
  | "installed"
  | "setUp"
  | "updateAvailable"
  | "found"
  | "error";

export type ProgramAction = "install" | "update" | "launch" | "cancel";

export interface ProgramRowState {
  status: ProgramStatusId;
  kind: "ok" | "warn" | "error" | "open" | "info" | "plain";
  installedVersion: string | null;
  /** „5.3.1“, „1.4.3 → 1.5.0“, „—“ */
  versionLabel: string;
  /** 0..1 solange etwas läuft, sonst null */
  progress: number | null;
  action: ProgramAction;
  job: JobInfo | null;
  installation: Installation | null;
}

const VERIFY_PHASES = new Set(["verifyChecksum", "verifySignature"]);

export function installJobOf(program: Pick<ProgramOverview, "name">, jobs: readonly JobInfo[]): JobInfo | null {
  return jobs.find((j) => j.kind === "install" && j.subject === program.name) ?? null;
}

export function deriveProgramState(p: ProgramOverview, jobs: readonly JobInfo[]): ProgramRowState {
  const job = installJobOf(p, jobs);
  const installation = p.installations.find((i) => i.id === p.preferredInstallationId) ?? p.installations[0] ?? null;
  const installedVersion = installation?.version ?? null;
  const base = { installedVersion, installation, job };

  if (job) {
    const phase = job.phase;
    const status: ProgramStatusId =
      phase && VERIFY_PHASES.has(phase)
        ? "verifying"
        : phase === "extract" || phase === "checkContent" || phase === "register"
          ? "installing"
          : "downloading";
    return { ...base, status, kind: "plain", versionLabel: "", progress: job.progress, action: "cancel" };
  }
  if (!installation) {
    return { ...base, status: "notInstalled", kind: "open", versionLabel: "—", progress: null, action: "install" };
  }
  const version = installation.version ?? "—";
  if (installation.problems.some((x) => x.kind === "executableMissing")) {
    return { ...base, status: "error", kind: "error", versionLabel: version, progress: null, action: "launch" };
  }
  if (installation.kind !== "cypher") {
    return { ...base, status: "found", kind: "info", versionLabel: version, progress: null, action: "launch" };
  }
  if (p.updateAvailable && p.latest) {
    return {
      ...base,
      status: "updateAvailable",
      kind: "warn",
      versionLabel: `${version} → ${p.latest.version}`,
      progress: null,
      action: "update",
    };
  }
  const applied =
    p.setup?.scopes.some((s) => s.installationIds.includes(installation.id) && s.status === "applied") ?? false;
  return {
    ...base,
    status: applied ? "setUp" : "installed",
    kind: applied ? "ok" : "info",
    versionLabel: version,
    progress: null,
    action: "launch",
  };
}

/** Sortierung der Tafel bleibt fest (Reihenfolge des Katalogs), damit sich nichts verschiebt. */
export function isBusyStatus(s: ProgramStatusId): boolean {
  return s === "downloading" || s === "verifying" || s === "installing";
}
