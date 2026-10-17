import { useCallback, useMemo } from "react";
import type { ProgramOverview } from "@contract";
import { call } from "../../ipc/commands";
import { useCmd } from "../../ipc/queries";
import { isAppError } from "../../ipc/errors";
import { errorText } from "../../i18n/errors";
import { fmtMegabytes, fmtBytes } from "../../i18n/format";
import { t } from "../../i18n/de";
import { useJobs, useToasts } from "../../app/stores";
import { useInstallUi } from "../install/store";
import { FitText } from "../../ui/FitText";
import { Status } from "../../ui/Status";
import { Bar } from "../../ui/Bits";
import { Button } from "../../ui/Button";
import {
  deriveProgramState,
  versionText,
  type ProgramAction,
  type ProgramRowState,
  type ProgramStatusId,
} from "./state";

export interface ProgramRow {
  program: ProgramOverview;
  state: ProgramRowState;
}

/** Programme + laufende Aufträge → Zeilen der Tafel (Reihenfolge des Katalogs bleibt fest). */
export function useProgramRows() {
  const query = useCmd("programs_list", undefined);
  const jobs = useJobs((s) => s.active);
  const rows = useMemo<ProgramRow[]>(
    () => (query.data?.programs ?? []).map((program) => ({ program, state: deriveProgramState(program, jobs) })),
    [query.data, jobs],
  );
  return { query, rows };
}

export { versionText };

export function roleOf(p: ProgramOverview): string {
  return t.programs.roles[p.id] ?? t.programs.categoryRole[p.category];
}

export function statusWord(id: ProgramStatusId): string {
  return t.programs.status[id];
}

export function actionLabel(a: ProgramAction): string {
  switch (a) {
    case "install":
      return t.programs.actions.install;
    case "update":
      return t.programs.actions.update;
    case "launch":
      return t.programs.actions.launch;
    case "cancel":
      return t.programs.actions.cancel;
  }
}

/** Zeilenaktion einer Programmzeile: Installieren, Aktualisieren, Starten, Abbrechen. */
export function useProgramActions() {
  const openInstall = useInstallUi((s) => s.open);
  const push = useToasts((s) => s.push);
  return useCallback(
    (row: ProgramRow) => {
      const { program, state } = row;
      switch (state.action) {
        case "install":
          openInstall({ programId: program.id });
          return;
        case "update":
          openInstall({ programId: program.id, ...(program.latest ? { version: program.latest.version } : {}) });
          return;
        case "cancel":
          if (state.job) void call("job_cancel", { req: { jobId: state.job.id } });
          return;
        case "launch":
          void call("program_launch", {
            req: { programId: program.id, ...(state.installation ? { installationId: state.installation.id } : {}) },
          })
            .then(() => push({ kind: "info", text: t.programs.launchedToast(program.name) }))
            .catch((e: unknown) =>
              push({
                kind: "error",
                text: isAppError(e)
                  ? `${t.programs.launchFailed(program.name)} ${errorText(e).text}`
                  : t.programs.launchFailed(program.name),
              }),
            );
          return;
      }
    },
    [openInstall, push],
  );
}

/** Programmname als Bandbreite: füllt seine Spalte exakt (Versalhöhe ≈ 0,7 × Größe). */
export function ProgramName({ name, size = 51, maxSize = 64 }: { name: string; size?: number; maxSize?: number }) {
  return <FitText text={name.toUpperCase()} size={size} minSize={18} maxSize={maxSize} label={name} />;
}

export function ProgressText({ row }: { row: ProgramRow }) {
  const { state, program } = row;
  if (state.progress === null || state.job === null) return null;
  const pct = Math.round(state.progress * 100);
  const total = program.latest?.downloadSize ?? 0;
  const done = Math.round(total * Math.min(1, state.progress / 0.7));
  return (
    <span className="prog">
      <span className="t-data">
        {state.status === "downloading" && total > 0
          ? t.programs.progress.of(fmtMegabytes(done), fmtBytes(total))
          : t.programs.progress.percent(pct)}
      </span>
      <Bar value={state.progress} label={program.name} valueText={`${statusWord(state.status)} ${pct} %`} thin />
    </span>
  );
}

export function StatusCell({ row }: { row: ProgramRow }) {
  const { state } = row;
  if (state.status === "downloading" || state.status === "verifying" || state.status === "installing") {
    return (
      <span className="status status--fg">
        <span className="phase__run" aria-hidden="true" />
        <span className="status__word">
          {state.status === "downloading" && state.progress !== null
            ? t.programs.progress.loadingPct(Math.round((state.progress / 0.7) * 100))
            : statusWord(state.status)}
        </span>
      </span>
    );
  }
  return <Status kind={state.kind}>{statusWord(state.status)}</Status>;
}

export function RowActionButton({
  row,
  onRun,
  small,
}: {
  row: ProgramRow;
  onRun: (row: ProgramRow) => void;
  small?: boolean;
}) {
  const label = actionLabel(row.state.action);
  return (
    <Button
      small={small}
      variant="default"
      onClick={(e) => {
        e.stopPropagation();
        onRun(row);
      }}
      aria-label={`${label}: ${row.program.name}`}
      data-testid={`row-action-${row.program.id}`}
    >
      {label}
    </Button>
  );
}
