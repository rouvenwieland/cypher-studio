import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ConflictResolution,
  ProgramOverview,
  SetupComponent,
  SetupComponentStatus,
  SetupEvent,
  SetupRecord,
} from "@contract";
import { call } from "../../ipc/commands";
import { channel } from "../../ipc/channel";
import { useCmd } from "../../ipc/queries";
import { toAppError } from "../../ipc/errors";
import { errorText } from "../../i18n/errors";
import { ellipsizePath, fmtTime } from "../../i18n/format";
import { t } from "../../i18n/de";
import { useToasts, watchJobBriefly } from "../../app/stores";
import { Button } from "../../ui/Button";
import { Notice, EmptyState } from "../../ui/Bits";
import { Checkbox, SelectField } from "../../ui/Inputs";
import { Status, type StatusKind } from "../../ui/Status";
import { OutputBar, type OutputState } from "../../ui/OutputBar";
import { useInstallUi } from "../install/store";

const s = t.setup;

function statusKind(st: SetupComponentStatus): StatusKind {
  switch (st) {
    case "current":
      return "ok";
    case "new":
      return "info";
    case "outdated":
      return "warn";
    case "userModified":
      return "warn";
    case "partial":
      return "warn";
  }
}

function Preview({ c }: { c: SetupComponent }) {
  if (c.preview.colors.length > 0) {
    return (
      <span className="pstrip" role="img" aria-label={`${s.paletteStrip}, ${s.colors(c.preview.colors.length)}`}>
        {c.preview.colors.map((hex, i) => (
          <span key={`${hex}-${i}`} className="pstrip__c" style={{ background: hex }} title={hex} />
        ))}
        <span className="t-data pstrip__n">{s.colors(c.preview.colors.length)}</span>
      </span>
    );
  }
  if (c.preview.fonts.length > 0) return <span className="t-meta">{c.preview.fonts.join(" · ")}</span>;
  if (c.preview.formats.length > 0) return <span className="t-data">{c.preview.formats.join(" · ")}</span>;
  return <span className="t-mute">{t.common.none}</span>;
}

function summaryLabel(plan: { packLabel: string; components: SetupComponent[] }): string {
  const req = plan.components.filter((c) => !c.optional);
  const current = req.filter((c) => c.status === "current").length;
  if (current === req.length) return s.summaryApplied(plan.packLabel);
  if (current === 0) return s.summaryNone(plan.packLabel);
  return s.summaryPartial(plan.packLabel, current, req.length);
}

/**
 * Einrichtung je Programm (CONCEPT.md 6.3): Bausteine als Tabelle, Konflikte pro Zeile, Ausgangsleiste mit Rückgängig.
 * Gibt Inhalt und Ausgangsleiste getrennt zurück, weil die Leiste im Gerüst unter der ganzen Seite liegt.
 */
export function useSetupTab(
  program: ProgramOverview | undefined,
  active: boolean,
): { body: ReactNode; output: ReactNode } {
  const qc = useQueryClient();
  const push = useToasts((st) => st.push);
  const openInstall = useInstallUi((st) => st.open);
  const scopes = useMemo(() => program?.setup?.scopes ?? [], [program]);
  const [scopeId, setScopeId] = useState<string | null>(null);
  const scope = scopes.find((x) => x.scopeId === scopeId) ?? scopes[0];
  const packId = program?.setup?.packId ?? "";
  const enabled = active && !!scope && !!program;
  const planQuery = useCmd(
    "setup_preview",
    { req: { packId, scopeId: scope?.scopeId ?? "" } },
    { enabled, staleTime: 0 },
  );
  const plan = planQuery.data;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({});
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);
  const [done, setDone] = useState<SetupRecord | null>(null);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    if (!plan) return;
    setSelected(new Set(plan.components.filter((c) => c.defaultSelected).map((c) => c.id)));
    setResolutions(Object.fromEntries(plan.conflicts.map((c) => [c.conflictId, "keepBoth"])));
  }, [plan?.planId]); // eslint-disable-line react-hooks/exhaustive-deps -- Auswahl nur beim Eintreffen eines neuen Plans zurücksetzen

  const toggle = (id: string, on: boolean) => {
    setDone(null);
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const apply = useCallback(() => {
    if (!plan || progress) return;
    setProgress({
      index: 0,
      total: plan.components.filter((c) => selected.has(c.id)).reduce((n, c) => n + c.operations.length, 0),
    });
    setDone(null);
    call("setup_apply", {
      req: { planId: plan.planId, components: [...selected], resolutions },
      onEvent: channel<SetupEvent>((e) => {
        if (e.type === "started") watchJobBriefly(e.jobId);
        if (e.type === "step") setProgress({ index: e.index, total: e.total });
      }),
    })
      .then((record) => {
        setDone(record);
        void qc.invalidateQueries({ queryKey: ["programs_list"] });
        void qc.invalidateQueries({ queryKey: ["setup_history"] });
      })
      .catch((e: unknown) => {
        const err = toAppError(e);
        push({ kind: "error", text: errorText(err).title });
        if (err.kind === "planExpired") void planQuery.refetch();
      })
      .finally(() => setProgress(null));
  }, [plan, progress, selected, resolutions, qc, push, planQuery]);

  const undo = (record: SetupRecord) => {
    setUndoing(true);
    call("setup_undo", { req: { setupId: record.setupId } })
      .then((report) => {
        push({
          kind: "info",
          text:
            s.undone(report.restored, report.removed) +
            (report.keptModified.length ? ` ${s.keptModified(report.keptModified.length)}` : ""),
        });
        setDone(null);
        void qc.invalidateQueries({ queryKey: ["programs_list"] });
        void qc.invalidateQueries({ queryKey: ["setup_history"] });
        void planQuery.refetch();
      })
      .catch((e: unknown) => push({ kind: "error", text: errorText(toAppError(e)).title }))
      .finally(() => setUndoing(false));
  };

  if (!program) return { body: null, output: null };
  const installed = program.installations.length > 0;

  if (!installed || scopes.length === 0 || !program.setup) {
    return {
      body: (
        <EmptyState
          testId="setup-empty"
          actions={
            <Button variant="primary" onClick={() => openInstall({ programId: program.id })}>
              {s.installFirst(program.name)}
            </Button>
          }
        >
          {s.needsInstall}
        </EmptyState>
      ),
      output: null,
    };
  }

  const chosen = plan?.components.filter((c) => selected.has(c.id)) ?? [];
  const toApply = chosen.filter((c) => c.status !== "current");
  const newCount = toApply.filter((c) => c.status === "new").length;
  const updCount = toApply.filter(
    (c) => c.status === "outdated" || c.status === "partial" || c.status === "userModified",
  ).length;
  const backups =
    (plan?.previous ? 1 : 0) +
    chosen.filter(
      (c) =>
        c.status === "userModified" &&
        plan?.conflicts.some((cf) => cf.componentId === c.id && resolutions[cf.conflictId] === "overwrite"),
    ).length;

  let state: OutputState;
  if (progress) {
    state = {
      kind: "running",
      label: s.applying,
      progress: progress.total > 0 ? progress.index / progress.total : null,
    };
  } else if (done) {
    const restart = plan?.restartHint ? s.restartHint(program.name) : null;
    state = {
      kind: "done",
      message: s.appliedBar(fmtTime(done.appliedAt), done.backupsTaken > 0, restart),
      announce: s.announceDone(done.components.length),
      actions: (
        <>
          {done.undoAvailable ? (
            <Button onClick={() => undo(done)} disabled={undoing} data-testid="setup-undo">
              {s.undo}
            </Button>
          ) : null}
          <Button combo="mod+enter" onClick={() => void call("program_launch", { req: { programId: program.id } })}>
            {s.launch(program.name)}
          </Button>
        </>
      ),
    };
  } else if (!plan) {
    state = { kind: "blocked", label: s.apply, reason: s.status.compare, onJump: () => undefined };
  } else if (toApply.length === 0) {
    state = { kind: "blocked", label: s.apply, reason: t.setup.status.current, onJump: () => undefined };
  } else {
    state = { kind: "ready", label: s.apply, onRun: apply };
  }

  const summaryItems = [
    { label: t.common.labels.status, value: `${toApply.length} ${toApply.length === 1 ? "Baustein" : "Bausteine"}` },
    ...(newCount > 0 ? [{ label: s.status.new, value: `${newCount} ${s.status.new}` }] : []),
    ...(updCount > 0 ? [{ label: s.status.outdated, value: `${updCount} aktualisiert` }] : []),
    ...(backups > 0 || toApply.some((c) => c.status === "outdated")
      ? [{ label: "Sicherung", value: s.summaryBackup }]
      : []),
  ];

  const failureFor = (c: SetupComponent) => done?.failures.find((f) => c.operations.some((o) => o.target === f.target));

  const body = (
    <div className="setup" data-testid="setup-tab">
      <div className="setup__head">
        <h2 className="t-section">{s.title}</h2>
        <span className="t-data setup__sum" data-testid="setup-summary">
          {plan ? summaryLabel(plan) : s.status.compare}
        </span>
      </div>
      {scopes.length > 1 ? (
        <div className="setup__scope">
          <SelectField
            label={s.scopeLabel}
            value={scope?.scopeId ?? ""}
            onChange={setScopeId}
            options={scopes.map((x) => ({ value: x.scopeId, label: s.scope[x.scopeKind] }))}
          />
        </div>
      ) : null}
      {plan?.programRunning ? (
        <Notice kind="warn" title={s.runningHint(program.name)} role="status" testId="setup-running" />
      ) : null}
      {planQuery.isError ? (
        <Notice
          kind="error"
          title={errorText(planQuery.error).title}
          actions={<Button onClick={() => void planQuery.refetch()}>{t.common.retry}</Button>}
        >
          {errorText(planQuery.error).text}
        </Notice>
      ) : null}
      <table className="stable">
        <caption className="sr-only">{s.title}</caption>
        <thead>
          <tr>
            <th scope="col" className="stable__sel">
              <span className="sr-only">{s.selectAll}</span>
            </th>
            <th scope="col" className="t-label">
              {s.columns.block}
            </th>
            <th scope="col" className="t-label">
              {s.columns.preview}
            </th>
            <th scope="col" className="t-label">
              {s.columns.target}
            </th>
            <th scope="col" className="t-label">
              {s.columns.status}
            </th>
          </tr>
        </thead>
        <tbody>
          {(plan?.components ?? []).map((c) => {
            const conflict = plan?.conflicts.find((cf) => cf.componentId === c.id);
            const fail = failureFor(c);
            const target = c.operations[0]?.target ?? "";
            return (
              <Fragment key={c.id}>
                <tr className="stable__row" data-testid={`setup-row-${c.id}`} data-status={c.status}>
                  <td className="stable__sel">
                    <Checkbox checked={selected.has(c.id)} onChange={(on) => toggle(c.id, on)} describedBy={undefined}>
                      <span className="sr-only">{c.label}</span>
                    </Checkbox>
                  </td>
                  <td>
                    <span className="t-strong">{c.label}</span>
                    {c.optional ? <span className="t-label stable__opt"> {s.optional}</span> : null}
                  </td>
                  <td>
                    <Preview c={c} />
                  </td>
                  <td>
                    <span className="t-data stable__target selectable" title={target}>
                      {ellipsizePath(target, 40)}
                    </span>
                  </td>
                  <td>
                    <Status kind={fail ? "error" : statusKind(c.status)}>
                      {fail ? t.jobs.outcome.failed : s.status[c.status]}
                    </Status>
                  </td>
                </tr>
                {conflict && selected.has(c.id) && c.status === "userModified" ? (
                  <tr className="stable__extra">
                    <td className="stable__conflict" colSpan={5}>
                      <fieldset className="conflict">
                        <legend className="t-label">{s.conflict.choose(c.label)}</legend>
                        {(
                          [
                            ["overwrite", s.conflict.overwrite],
                            ["keepBoth", s.conflict.keepBoth(conflict.keepBothName)],
                            ["skip", s.conflict.skip],
                          ] as [ConflictResolution, string][]
                        ).map(([value, label]) => (
                          <label key={value} className="conflict__opt">
                            <input
                              type="radio"
                              name={`res-${conflict.conflictId}`}
                              className="conflict__radio"
                              checked={(resolutions[conflict.conflictId] ?? "keepBoth") === value}
                              onChange={() => {
                                setDone(null);
                                setResolutions((r) => ({ ...r, [conflict.conflictId]: value }));
                              }}
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                        <p className="t-meta t-mute">{s.conflict.hint}</p>
                      </fieldset>
                    </td>
                  </tr>
                ) : null}
                {fail ? (
                  <tr className="stable__extra">
                    <td className="stable__conflict" colSpan={5}>
                      <p className="field__error t-meta" role="alert" data-testid="setup-failure">
                        {s.lockedFile(fail.target.split(/[\\/]/).filter(Boolean).pop() ?? fail.target, program.name)}
                      </p>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return {
    body,
    output: <OutputBar target={s.title} summary={summaryItems} state={state} testId="setup-output" />,
  };
}
