import * as Popover from "@radix-ui/react-popover";
import { useQueryClient } from "@tanstack/react-query";
import type { JobInfo, JobRecord } from "@contract";
import { call } from "../ipc/commands";
import { useCmd } from "../ipc/queries";
import { errorText } from "../i18n/errors";
import { fmtTime } from "../i18n/format";
import { t } from "../i18n/de";
import { formatCombo } from "../lib/keys";
import { Bar } from "../ui/Bits";
import { Button } from "../ui/Button";
import { Status } from "../ui/Status";
import type { IconComponent } from "../ui/icons";
import { useJobs, useUi, type Lamp } from "./stores";

function lampWord(lamp: Lamp): string {
  return t.nav.jobsLamp[lamp];
}

function jobLabel(job: JobInfo): string {
  return `${t.jobs.kind[job.kind]} · ${job.subject}`;
}

function ActiveRow({ job }: { job: JobInfo }) {
  const pct = job.progress === null ? null : Math.round(job.progress * 100);
  const phase = job.phase ? (t.jobs.phase[job.phase] ?? job.phase) : null;
  return (
    <li className="jobs__row" data-testid="job-active">
      <div className="jobs__head">
        <strong className="t-strong">{jobLabel(job)}</strong>
        {job.cancellable ? (
          <Button
            variant="text"
            small
            onClick={() => void call("job_cancel", { req: { jobId: job.id } })}
            aria-label={`${t.jobs.cancel}: ${jobLabel(job)}`}
          >
            {t.jobs.cancel}
          </Button>
        ) : null}
      </div>
      {pct === null ? (
        <p className="t-data t-mute">{t.common.working}</p>
      ) : (
        <>
          <Bar value={job.progress ?? 0} label={jobLabel(job)} valueText={`${phase ?? ""} ${pct} %`.trim()} thin />
          <p className="t-data t-mute">
            {phase ? `${phase} · ` : ""}
            {t.jobs.progress(pct)}
          </p>
        </>
      )}
      {job.needsAttention ? <p className="t-meta">{t.jobs.attention}</p> : null}
    </li>
  );
}

function RecentRow({ rec }: { rec: JobRecord }) {
  const kind = rec.outcome === "succeeded" ? "ok" : rec.outcome === "failed" ? "error" : "open";
  const msg = rec.error ? errorText(rec.error) : null;
  return (
    <li className="jobs__row" data-testid="job-recent">
      <div className="jobs__head">
        <strong className="t-strong t-trunc">{jobLabel(rec.info)}</strong>
        <span className="t-data t-mute">{fmtTime(rec.finishedAt)}</span>
      </div>
      <Status kind={kind}>{t.jobs.outcome[rec.outcome]}</Status>
      {msg ? <p className="t-meta t-mute">{msg.title}</p> : null}
    </li>
  );
}

export function JobsPopover({
  narrow,
  lamp,
  count,
  icon: Icon,
}: {
  narrow: boolean;
  lamp: Lamp;
  count: number;
  icon: IconComponent;
}) {
  const open = useUi((s) => s.jobsOpen);
  const setOpen = useUi((s) => s.setJobs);
  const active = useJobs((s) => s.active);
  const finished = useJobs((s) => s.finished);
  const markSeen = useJobs((s) => s.markSeen);
  const recent = useCmd("jobs_recent", undefined, { enabled: open });
  const qc = useQueryClient();

  const merged: JobRecord[] = [...finished];
  for (const r of recent.data ?? []) if (!merged.some((m) => m.info.id === r.info.id)) merged.push(r);
  merged.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          markSeen();
          void qc.invalidateQueries({ queryKey: ["jobs_recent"] });
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="rail__item"
          aria-label={narrow ? `${t.nav.jobs}, ${lampWord(lamp)}` : undefined}
          data-testid="nav-jobs"
          aria-keyshortcuts="Control+J"
        >
          <span className={`lamp lamp--${lamp}`} aria-hidden="true">
            <Icon size={20} />
          </span>
          <span className="rail__label">
            {t.nav.jobs}
            {count > 0 ? <span className="rail__count t-data">{count}</span> : null}
          </span>
          <kbd className="rail__kbd">{formatCombo("mod+j")}</kbd>
          <span className="sr-only">{lampWord(lamp)}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="pop jobs"
          side="right"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          aria-label={t.jobs.popoverLabel}
          data-testid="jobs-popover"
        >
          <h2 className="t-label jobs__title">{t.jobs.active}</h2>
          {active.length === 0 ? (
            <p className="t-meta t-mute jobs__empty">{t.jobs.none}</p>
          ) : (
            <ul className="jobs__list">
              {active.map((j) => (
                <ActiveRow key={j.id} job={j} />
              ))}
            </ul>
          )}
          <h2 className="t-label jobs__title">{t.jobs.recent}</h2>
          {merged.length === 0 ? (
            <p className="t-meta t-mute jobs__empty">{t.jobs.noneRecent}</p>
          ) : (
            <ul className="jobs__list">
              {merged.slice(0, 8).map((r) => (
                <RecentRow key={r.info.id} rec={r} />
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
