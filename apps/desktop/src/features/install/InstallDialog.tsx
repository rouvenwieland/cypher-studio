import { useEffect, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import type { AppError, InstallPlan } from "@contract";
import { call } from "../../ipc/commands";
import { useCmd } from "../../ipc/queries";
import { errorText } from "../../i18n/errors";
import { checksumGroups, checksumShort, fmtBytes, fmtDate, fmtMegabytes, fmtRate } from "../../i18n/format";
import { t } from "../../i18n/de";
import { matchesCombo } from "../../lib/keys";
import { useToasts } from "../../app/stores";
import { useSettings } from "../../app/theme";
import { Facts, Notice } from "../../ui/Bits";
import { Bar } from "../../ui/Bits";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { FitText } from "../../ui/FitText";
import { Checkbox } from "../../ui/Inputs";
import { GlyphOk, GlyphOpen, IconCopy, IconExternal } from "../../ui/icons";
import { useInstallFlow, type RunProgress } from "./useInstallFlow";
import { useInstallUi } from "./store";
import "./install.css";

const i = t.install;

function ChecksumGroups({ sha, filled, diffAgainst, label }: { sha: string; filled?: number; diffAgainst?: string; label: string }) {
  const groups = checksumGroups(sha);
  const other = diffAgainst ? checksumGroups(diffAgainst) : null;
  return (
    <div className="sum" role="group" aria-label={label}>
      {groups.map((g, idx) => {
        const diff = other ? other[idx] !== g : false;
        const on = filled === undefined ? false : idx < filled;
        return (
          <span key={idx} className={["sum__g", on ? "sum__g--on" : "", diff ? "sum__g--diff" : ""].filter(Boolean).join(" ")}>
            {g}
          </span>
        );
      })}
    </div>
  );
}

function drive(dir: string): string {
  const m = /^[A-Za-z]:/.exec(dir);
  return m ? m[0] : dir.startsWith("/") ? "/" : "dem Datenträger";
}

function ReviewBody({ plan, applySetup, onApplySetup, hasPack, releasedAt, onChangeTarget, stale }: { plan: InstallPlan; applySetup: boolean; onApplySetup: (v: boolean) => void; hasPack: boolean; releasedAt: string | null; onChangeTarget: () => void; stale: string | null }) {
  const [why, setWhy] = useState(false);
  const [allGroups, setAllGroups] = useState(false);
  const copy = useToasts((s) => s.push);
  const unpacked = Math.max(0, plan.target.requiredBytes - plan.artifact.size);
  const openLicense = () => void call("app_open_external", { req: { target: { kind: "programPage", programId: plan.programId, page: "license" } } });
  return (
    <div className="stack stack--loose">
      <Facts
        rows={[
          {
            label: i.labels.source,
            value: (
              <>
                <span className="t-data selectable">{plan.source.host}</span>{" "}
                <span className="status status--ok">
                  <GlyphOk size={16} />
                  <span className="status__word">{i.official}</span>
                </span>
              </>
            ),
            sub: (
              <>
                <span className="install__path t-data selectable">{new URL(plan.source.url).pathname}</span>
                <button type="button" className="linkbtn" aria-expanded={why} onClick={() => setWhy(!why)}>
                  {i.whyThisSource}
                </button>
                {why ? <span className="install__why">{i.whyThisSourceText(plan.programName, plan.source.mirrorRedirects)}</span> : null}
              </>
            ),
          },
          { label: i.labels.version, value: <span className="t-data">{i.versionLine(plan.version, i.channel[plan.channel], releasedAt ? fmtDate(releasedAt) : null)}</span> },
          { label: i.labels.size, value: <span className="t-data">{i.sizeLine(fmtBytes(plan.artifact.size), fmtBytes(unpacked), drive(plan.target.dir), fmtBytes(plan.target.availableBytes))}</span> },
          {
            label: i.labels.license,
            value: (
              <span className="install__license">
                <span className="t-data">{i.licenseLine(plan.license.spdx, plan.license.name)}</span>
                <button type="button" className="linkbtn" onClick={openLicense}>
                  {i.licenseText} <IconExternal size={12} />
                </button>
              </span>
            ),
          },
          {
            label: i.labels.checksum,
            value: (
              <>
                <span className="t-data selectable" data-testid="checksum-short">
                  {i.checksumHash} {allGroups ? "" : checksumShort(plan.artifact.sha256)}
                </span>
                {allGroups ? <ChecksumGroups sha={plan.artifact.sha256} label={i.labels.checksum} /> : null}
                <span className="install__sub-actions">
                  <button type="button" className="linkbtn" aria-expanded={allGroups} onClick={() => setAllGroups(!allGroups)}>
                    {allGroups ? i.hideAllGroups : i.showAllGroups}
                  </button>
                  <button
                    type="button"
                    className="linkbtn"
                    onClick={() => {
                      void navigator.clipboard?.writeText(plan.artifact.sha256).then(() => copy({ kind: "info", text: t.common.copied }));
                    }}
                  >
                    <IconCopy size={12} /> {i.copyChecksum}
                  </button>
                </span>
              </>
            ),
            sub: i.checksumOrigin[plan.artifact.checksumOrigin],
          },
          {
            label: i.labels.target,
            value: (
              <span className="install__target">
                <span className="t-data selectable">{plan.target.dir}</span>
                <button type="button" className="linkbtn" onClick={onChangeTarget}>
                  {i.targetChange}
                </button>
              </span>
            ),
            sub: i.targetNoAdmin,
          },
        ]}
      />
      {stale ? (
        <Notice kind="info" title={stale} role="status" />
      ) : null}
      {plan.replaces ? <p className="t-meta">{i.notes.replaces(plan.programName, plan.replaces.version ?? "—")}</p> : null}
      {plan.existing.map((e) => (
        <p key={e.id} className="t-meta">
          {i.notes.existing(plan.programName, e.version ?? "—")}
        </p>
      ))}
      {plan.notes.map((n, idx) => (
        <p key={idx} className="t-meta">
          {i.notes.note(n)}
        </p>
      ))}
      {hasPack ? (
        <div className="install__after">
          <span className="t-label">{i.labels.after}</span>
          <Checkbox checked={applySetup} onChange={onApplySetup} describedBy="install-after-hint">
            {i.after}
          </Checkbox>
          <p className="t-meta t-mute" id="install-after-hint">
            {i.afterHint}
          </p>
        </div>
      ) : null}
      <div className="install__consent">
        <span className="t-label">{i.labels.consent}</span>
        <p className="t-read">{i.consentText}</p>
      </div>
    </div>
  );
}

const PHASE_ORDER = ["download", "verify", "install", "setup"] as const;
type PhaseId = (typeof PHASE_ORDER)[number];

function phaseIndex(p: RunProgress): number {
  switch (p.phase) {
    case null:
    case "download":
      return 0;
    case "verifyChecksum":
    case "verifySignature":
      return 1;
    case "extract":
    case "checkContent":
    case "register":
      return 2;
    case "setup":
      return 3;
  }
}

function PhaseList({ progress, allDone, plan }: { progress: RunProgress; allDone: boolean; plan: InstallPlan }) {
  const current = phaseIndex(progress);
  const [fill, setFill] = useState(0);
  const verifying = current === 1 && !progress.verified;
  useEffect(() => {
    if (!verifying) return;
    const total = checksumGroups(plan.artifact.sha256).length;
    const id = setInterval(() => setFill((f) => Math.min(total - 2, f + 1)), 55);
    return () => clearInterval(id);
  }, [verifying, plan.artifact.sha256]);

  const phases: PhaseId[] = PHASE_ORDER.filter((p) => p !== "setup" || progress.setup !== "off");
  return (
    <ol className="phases" aria-label={i.title(plan.programName)}>
      {phases.map((p) => {
        const idx = PHASE_ORDER.indexOf(p);
        const state = allDone ? "done" : idx < current ? "done" : idx === current ? "running" : "pending";
        const total = progress.download.total;
        let detail: string = i.phaseDetail.pending;
        let value: number | null = null;
        if (p === "download") {
          detail = state === "done" ? i.phaseDetail.download(fmtMegabytes(total), fmtBytes(total), null) : i.phaseDetail.download(fmtMegabytes(progress.download.done), fmtBytes(total), progress.download.rate > 0 ? fmtRate(progress.download.rate) : null);
          value = total > 0 ? progress.download.done / total : 0;
          if (state === "done") detail = `${fmtBytes(total)}`;
        } else if (p === "verify") {
          detail = state === "done" || progress.verified ? i.phaseDetail.verifyDone : state === "running" ? i.phaseDetail.verify : i.phaseDetail.pending;
        } else if (p === "install") {
          if (state === "running") {
            detail = progress.phase === "checkContent" ? i.phaseDetail.checkContent : progress.phase === "register" ? i.phaseDetail.register : i.phaseDetail.extract(String(progress.extract.done), progress.extract.total === null ? null : String(progress.extract.total));
            value = progress.extract.total ? progress.extract.done / progress.extract.total : null;
          } else if (state === "done") detail = i.state.done;
        } else {
          detail = state === "done" ? (progress.setup === "needsYou" ? i.phaseDetail.setupNeedsYou : i.phaseDetail.setupDone(progress.setupCount)) : state === "running" ? i.phaseDetail.setup(progress.setupCount) : i.phaseDetail.pending;
        }
        return (
          <li key={p} className="phase" data-state={state} data-phase={p} aria-current={state === "running" ? "step" : undefined}>
            <span className="phase__mark" aria-hidden="true">
              {state === "done" ? <GlyphOk size={16} /> : state === "running" ? <span className="phase__run" /> : <GlyphOpen size={16} />}
            </span>
            <span className="phase__label t-strong">{i.phases[p]}</span>
            <span className="phase__detail t-data" data-testid={`phase-${p}`}>
              {detail}
            </span>
            {state === "running" && value !== null ? (
              <div className="phase__bar">
                <Bar value={value} label={i.phases[p]} valueText={detail} thin />
              </div>
            ) : null}
            {p === "verify" && (state === "running" || state === "done") ? (
              <div className="phase__sum">
                <ChecksumGroups sha={plan.artifact.sha256} filled={state === "done" || progress.verified ? 99 : fill} label={i.labels.checksum} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ChecksumError({ error, plan }: { error: Extract<AppError, { kind: "checksumMismatch" }>; plan: InstallPlan | null }) {
  const c = i.errors.checksum;
  const push = useToasts((s) => s.push);
  return (
    <div className="stack stack--loose" data-testid="checksum-error">
      <Notice
        kind="error"
        title={c.title}
        role="alert"
        actions={
          <Button
            onClick={() => {
              void navigator.clipboard?.writeText(c.detailsText(plan?.programName ?? "", error.file, error.expected, error.actual)).then(() => push({ kind: "info", text: c.copied }));
            }}
            icon={IconCopy}
          >
            {c.copy}
          </Button>
        }
      >
        <strong>{c.safe}</strong>
      </Notice>
      <div className="compare">
        <span className="t-label">{c.expected}</span>
        <ChecksumGroups sha={error.expected} diffAgainst={error.actual} label={c.expected} />
        <span className="t-label">{c.actual}</span>
        <ChecksumGroups sha={error.actual} diffAgainst={error.expected} label={c.actual} />
      </div>
      <p className="t-read">{c.why}</p>
    </div>
  );
}

function ErrorBody({ error, plan, progress }: { error: AppError; plan: InstallPlan | null; progress: RunProgress | null }) {
  const e = i.errors;
  if (error.kind === "checksumMismatch") return <ChecksumError error={error} plan={plan} />;
  const msg = errorText(error);
  switch (error.kind) {
    case "network": {
      const title = progress && progress.download.done > 0 ? e.network.title(error.host, fmtMegabytes(progress.download.done), fmtMegabytes(progress.download.total)) : e.network.titlePlain(error.host);
      return (
        <Notice kind="error" title={title} role="alert">
          {e.network.safe}
        </Notice>
      );
    }
    case "diskFull":
      return (
        <Notice kind="error" title={e.disk.title(drive(error.path), fmtBytes(Math.max(0, error.neededBytes - error.availableBytes)))} role="alert">
          {e.disk.safe}
        </Notice>
      );
    case "busy":
      return error.reason === "programRunning" ? (
        <Notice kind="warn" title={e.running.title(plan?.programName ?? "")} role="alert">
          {e.running.text(plan?.programName ?? "")}
        </Notice>
      ) : (
        <Notice kind="error" title={msg.title} role="alert">
          {msg.text}
        </Notice>
      );
    case "cancelled":
      return (
        <Notice kind="info" title={e.cancelled.title} role="status">
          {e.cancelled.text}
        </Notice>
      );
    case "planExpired":
    case "consentMismatch":
      return (
        <Notice kind="warn" title={e.expiredPlan.title} role="alert">
          {e.expiredPlan.text}
        </Notice>
      );
    default:
      return (
        <Notice kind="error" title={msg.title} role="alert">
          {msg.text} {msg.safe}
        </Notice>
      );
  }
}

export function InstallDialogHost() {
  const request = useInstallUi((s) => s.request);
  if (!request) return null;
  return <InstallDialog key={`${request.programId}:${request.version ?? ""}`} programId={request.programId} version={request.version} />;
}

function InstallDialog({ programId, version }: { programId: string; version: string | undefined }) {
  const close = useInstallUi((s) => s.close);
  const navigate = useNavigate();
  const settings = useSettings();
  const programs = useCmd("programs_list", undefined);
  const program = programs.data?.programs.find((p) => p.id === programId);
  const hasPack = !!program?.setup && program.supportedOnThisPlatform;
  const flow = useInstallFlow(programId, version, hasPack, settings.data?.onboarding.applySetup ?? true);
  const { stage } = flow;
  const name = program?.name ?? stage_plan_name(stage) ?? programId;
  const isUpdate = stage.kind !== "loading" && stage.kind !== "error" ? ("plan" in stage ? stage.plan.replaces !== null : false) : false;

  const running = stage.kind === "running";
  const title = stage.kind === "done" ? i.doneTitle(stage.plan.programName, stage.plan.version) : isUpdate ? i.titleUpdate(name) : i.title(name);

  const changeTarget = () => {
    void call("settings_choose_dir", { req: { which: "programsDir" } }).then(() => flow.reload());
  };
  const launch = () => {
    void call("program_launch", { req: { programId } }).catch(() => undefined);
    close();
  };
  const primary = (): void => {
    if (stage.kind === "review") flow.start();
    else if (stage.kind === "done") launch();
    else if (stage.kind === "error") {
      if (stage.error.kind === "planExpired" || stage.error.kind === "consentMismatch" || stage.error.kind === "busy" || stage.error.kind === "cancelled" || stage.error.kind === "network" || stage.error.kind === "checksumMismatch") flow.reload();
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (matchesCombo(e.nativeEvent, "mod+enter")) {
      e.preventDefault();
      primary();
    }
  };
  const staleNote = program && program.latest && stage.kind === "review" && stage.plan.version !== program.latest.version ? i.errors.stale(program.name, program.latest.version, stage.plan.version) : null;

  let body = null;
  let footer = null;
  if (stage.kind === "loading") {
    body = (
      <p className="t-read" role="status">
        {i.loadingPlan}
      </p>
    );
    footer = <Button onClick={close}>{t.common.cancel}</Button>;
  } else if (stage.kind === "review") {
    body = <ReviewBody plan={stage.plan} applySetup={flow.applySetup} onApplySetup={flow.setApplySetup} hasPack={hasPack} releasedAt={program?.latest?.releasedAt ?? null} onChangeTarget={changeTarget} stale={staleNote} />;
    footer = (
      <>
        <Button onClick={close}>{i.cancel}</Button>
        <Button variant="action" combo="mod+enter" onClick={flow.start} data-testid="install-confirm">
          {isUpdate ? i.consentButtonUpdate : i.consentButton}
        </Button>
      </>
    );
  } else if (stage.kind === "running") {
    body = (
      <div className="stack stack--loose">
        <PhaseList progress={stage.progress} allDone={false} plan={stage.plan} />
        <p className="t-meta t-mute">{i.escHint}</p>
      </div>
    );
    footer = (
      <>
        <Button onClick={close} data-testid="install-background">
          {i.background}
        </Button>
        <Button onClick={flow.cancel} disabled={stage.progress.cancelling || stage.progress.jobId === null} data-testid="install-cancel">
          {stage.progress.cancelling ? i.cancelling : i.cancel}
        </Button>
      </>
    );
  } else if (stage.kind === "done") {
    const done = stage;
    body = (
      <div className="stack stack--loose" data-testid="install-done">
        <FitText text={done.plan.programName} size={96} minSize={40} maxSize={150} snap label={done.plan.programName} />
        <p className="t-read" role="status">
          {i.doneSub}
        </p>
        <PhaseList
          progress={{ phase: null, download: { done: done.plan.artifact.size, total: done.plan.artifact.size, rate: 0 }, extract: { done: 0, total: null }, verified: true, verifiedSha: done.plan.artifact.sha256, setup: done.setupCount > 0 || done.setupNeedsYou ? (done.setupNeedsYou ? "needsYou" : "done") : "off", setupCount: done.setupCount, cancelling: false, jobId: null }}
          allDone
          plan={done.plan}
        />
        {done.setupNeedsYou ? (
          <Notice kind="warn" title={i.phaseDetail.setupNeedsYou} role="status">
            <Button
              onClick={() => {
                close();
                void navigate(`/programme/${programId}?tab=einrichtung`);
              }}
            >
              {i.openSetup}
            </Button>
          </Notice>
        ) : null}
      </div>
    );
    footer = (
      <>
        <Button onClick={close} data-testid="install-close">
          {i.close}
        </Button>
        <Button variant="action" combo="mod+enter" onClick={launch} data-testid="install-launch">
          {i.launchAfter(done.plan.programName)}
        </Button>
      </>
    );
  } else {
    const err = stage;
    const kind = err.error.kind;
    body = <ErrorBody error={err.error} plan={err.plan} progress={err.progress} />;
    footer = (
      <>
        <Button onClick={close}>{i.errors.generic.close}</Button>
        {kind === "network" ? (
          <Button variant="action" onClick={flow.reload}>
            {i.errors.network.now}
          </Button>
        ) : null}
        {kind === "checksumMismatch" ? (
          <Button variant="action" onClick={flow.reload} data-testid="install-mirror">
            {i.errors.checksum.otherMirror}
          </Button>
        ) : null}
        {kind === "diskFull" ? (
          <Button variant="action" onClick={changeTarget}>
            {i.errors.disk.other}
          </Button>
        ) : null}
        {kind === "busy" ? (
          <Button variant="action" onClick={flow.reload}>
            {i.errors.running.retry}
          </Button>
        ) : null}
        {kind === "cancelled" ? (
          <Button variant="action" onClick={flow.reload}>
            {i.errors.cancelled.again}
          </Button>
        ) : null}
        {kind === "planExpired" || kind === "consentMismatch" ? (
          <Button variant="action" onClick={flow.reload}>
            {i.errors.expiredPlan.again}
          </Button>
        ) : null}
        {kind !== "network" && kind !== "checksumMismatch" && kind !== "diskFull" && kind !== "busy" && kind !== "cancelled" && kind !== "planExpired" && kind !== "consentMismatch" ? (
          <Button variant="action" onClick={flow.reload}>
            {i.errors.generic.retry}
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <Dialog open title={title} onClose={close} dismissible={!running} testId="install-dialog" footer={footer} onKeyDown={onKeyDown}>
      {body}
    </Dialog>
  );
}

function stage_plan_name(stage: { kind: string }): string | null {
  return "plan" in stage && stage.plan && typeof (stage.plan as InstallPlan).programName === "string" ? (stage.plan as InstallPlan).programName : null;
}
