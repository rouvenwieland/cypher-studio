import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Settings, SettingsPatch } from "@contract";
import { call } from "../../ipc/commands";
import { useCmd } from "../../ipc/queries";
import { errorText } from "../../i18n/errors";
import { checksumShort, fmtBytes, fmtCount, fmtMegabytes, fmtNumber } from "../../i18n/format";
import { t } from "../../i18n/de";
import { useDrops, useMainAction } from "../../app/stores";
import { useSettings } from "../../app/theme";
import { Bar, Notice } from "../../ui/Bits";
import { Button } from "../../ui/Button";
import { FitText } from "../../ui/FitText";
import { Checkbox } from "../../ui/Inputs";
import { GlyphOk, GlyphOpen, IconClose } from "../../ui/icons";
import { Status } from "../../ui/Status";
import { Verdict } from "../../ui/Status";
import { useDocumentTitle } from "../../ui/Frames";
import { useChooseRoot } from "../library/ChooseRoot";
import { summarize, evaluateChecks } from "../printcheck/rules";
import { useBatch } from "./useBatch";
import { Kennung } from "./Kennung";
import "./onboarding.css";

const o = t.onboarding;

function Scale({ step, downloadMin, needle }: { step: number; downloadMin: number; needle: number }) {
  const total = 30;
  const pct = (m: number) => `${(Math.min(total, m) / total) * 100}%`;
  const dl = 5;
  const setupStart = dl + downloadMin;
  const segments: { id: number; from: number; to: number; row: number }[] = [
    { id: 1, from: 0, to: 1, row: 0 },
    { id: 2, from: 1, to: 3, row: 0 },
    { id: 3, from: 3, to: 5, row: 0 },
    { id: 4, from: dl, to: setupStart, row: 1 },
    { id: 5, from: setupStart, to: setupStart + 3, row: 0 },
    { id: 6, from: setupStart + 3, to: setupStart + 8, row: 0 },
  ];
  return (
    <div className="scale" role="group" aria-label={o.schedule.label} data-testid="schedule">
      <div className="scale__ticks" aria-hidden="true">
        {[0, 5, 10, 15, 20, 25, 30].map((m) => (
          <span key={m} className="scale__tick t-data" style={{ left: pct(m) }}>
            {m}
          </span>
        ))}
      </div>
      <div className="scale__tracks">
        {segments.map((s) => {
          const done = s.id < step || (s.id === 4 && step > 4);
          const current = s.id === step;
          return (
            <span
              key={s.id}
              className={["scale__seg", done ? "scale__seg--done" : "", current ? "scale__seg--now" : "", s.row === 1 ? "scale__seg--dl" : ""].filter(Boolean).join(" ")}
              style={{ left: pct(s.from), width: `calc(${pct(s.to - s.from)} - 2px)` }}
              title={o.schedule.steps[s.id - 1] ?? ""}
            >
              <span className="scale__seg-label t-label">{s.id === 4 ? o.schedule.downloadTrack : `${s.id}`}</span>
            </span>
          );
        })}
        <span className="scale__needle" style={{ left: pct(needle) }} aria-hidden="true" />
      </div>
    </div>
  );
}

export default function Onboarding() {
  useDocumentTitle(o.title);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const settings = useSettings();
  const programs = useCmd("programs_list", undefined);
  const status = useCmd("library_status", undefined);
  const samples = useCmd("samples_list", undefined);
  const [step, setStep] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [applySetup, setApplySetup] = useState(true);
  const [folderChosen, setFolderChosen] = useState<string | null>(null);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const batch = useBatch(applySetup);
  const started = useRef(false);
  const { items } = batch;

  // Stand aus den Einstellungen übernehmen
  const loaded = useRef(false);
  useEffect(() => {
    const st = settings.data;
    if (!st || loaded.current) return;
    loaded.current = true;
    setSelected(st.onboarding.selectedPrograms);
    setApplySetup(st.onboarding.applySetup);
    setStep(st.onboarding.status === "inProgress" && st.onboarding.step > 0 ? Math.min(3, st.onboarding.step) : 0);
  }, [settings.data]);

  const save = useCallback(
    (patch: NonNullable<SettingsPatch["onboarding"]>) => {
      void call("settings_update", { req: { onboarding: patch } }).then((next: Settings) => qc.setQueryData(["settings_get"], next));
    },
    [qc],
  );
  const go = useCallback(
    (next: number) => {
      setStep(next);
      save({ status: "inProgress", step: next, selectedPrograms: selected, applySetup });
    },
    [save, selected, applySetup],
  );

  const choose = useChooseRoot(() => setFolderChosen(status.data?.root ?? null));
  useEffect(() => {
    if (status.data?.root) setFolderChosen(status.data.root);
  }, [status.data?.root]);

  const catalog = programs.data?.programs ?? [];
  const chosen = catalog.filter((p) => selected.includes(p.id));
  const totalBytes = chosen.reduce((n, p) => n + (p.latest?.downloadSize ?? 0), 0);

  // Prüfungsanzeigen holen, sobald Schritt 3 erreicht ist
  useEffect(() => {
    if (step === 3 && items.length === 0 && chosen.length > 0 && !batch.previewing) void batch.preview(chosen.map((p) => ({ id: p.id, name: p.name })));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur beim Betreten des Schritts
  }, [step]);

  // Probelauf: Probe-Motiv analysieren
  const sample = samples.data?.[0];
  const profile = useCmd("print_profiles_list", undefined, { staleTime: 60_000 });
  const sampleReport = useCmd(
    "printcheck_analyze",
    { req: { handleId: sample?.handle.id ?? "", profileId: profile.data?.[0]?.id ?? "", garmentColorId: "schwarz" } },
    { enabled: step === 6 && !!sample && !!profile.data?.[0] },
  );
  const sampleChecks = useMemo(() => (sampleReport.data && profile.data?.[0] ? evaluateChecks(sampleReport.data, profile.data[0]) : []), [sampleReport.data, profile.data]);
  const sampleSum = summarize(sampleChecks);

  const finish = useCallback(
    (to: string) => {
      save({ status: "done", step: 6, selectedPrograms: selected, applySetup });
      void qc.invalidateQueries({ queryKey: ["settings_get"] });
      void navigate(to, { replace: true });
    },
    [navigate, qc, save, selected, applySetup],
  );

  const later = () => {
    save({ status: "inProgress", step: Math.min(step ?? 0, 6), selectedPrograms: selected, applySetup });
    void qc.invalidateQueries({ queryKey: ["settings_get"] });
    void navigate("/start", { replace: true });
  };

  // Fortschritt und Zeit
  const dlBytes = items.reduce((n, it) => n + it.downloaded, 0);
  const dlTotal = items.reduce((n, it) => n + (it.plan?.artifact.size ?? 0), 0);
  const earliest = items.reduce<number | null>((m, it) => (it.startedAt !== null && (m === null || it.startedAt < m) ? it.startedAt : m), null);
  const elapsedS = earliest ? (Date.now() - earliest) / 1000 : 0;
  const rate = elapsedS > 4 ? dlBytes / elapsedS : 0;
  const downloadMin = rate > 0 && dlTotal > 0 ? Math.max(1, Math.round((dlTotal - dlBytes) / rate / 60) + 2) : Math.max(6, Math.round(totalBytes / (1024 * 1024 * 40)) + 8);
  const stepNow = step ?? 0;
  const base = [0, 0, 1, 3, 5, 5 + downloadMin, 5 + downloadMin + 3][Math.max(0, Math.min(6, stepNow))] ?? 0;
  const frac = stepNow === 4 && dlTotal > 0 ? (dlBytes / dlTotal) * downloadMin : 0;
  const needle = base + frac;
  const remaining = Math.max(1, Math.round(5 + downloadMin + 8 - needle));

  // Strg+Enter / Enter je Schritt
  const primary = useRef<(() => void) | null>(null);
  useEffect(() => {
    useMainAction.getState().set(() => primary.current?.());
    return () => useMainAction.getState().set(null);
  }, []);

  if (step === null || !settings.data) return <div className="ob" aria-busy="true" />;
  if (step === 0) {
    primary.current = () => go(1);
    return <Kennung version={"0.4.0"} onStart={() => go(1)} onLater={later} />;
  }
  if (step >= 7) {
    primary.current = () => finish("/start");
    return <ReadyBand onDone={() => finish("/start")} items={items} folder={folderChosen} templates={4} />;
  }

  let content: ReactNode = null;
  let nextLabel: string = o.next;
  let nextDisabled = false;
  let onNext: () => void = () => go(step + 1);
  let showBack = step > 1 && step < 4;
  const toggleProgram = (id: string, on: boolean) => setSelected((cur) => (on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id)));

  if (step === 1) {
    content = (
      <>
        <h1 className="ob__title t-title">{o.step1.title}</h1>
        <p className="t-read">{o.step1.help}</p>
        <ul className="ob__rows" aria-label={o.step1.group}>
          {catalog.map((p) => (
            <li key={p.id} className={selected.includes(p.id) ? "obrow obrow--on" : "obrow"}>
              <label className="obrow__label">
                <input type="checkbox" className="check__box" checked={selected.includes(p.id)} onChange={(e) => toggleProgram(p.id, e.target.checked)} data-testid={`ob-program-${p.id}`} />
                <span className="obrow__text">
                  <span className="t-strong">{o.step1.rows[p.id] ?? p.name}</span>
                  <span className="t-data t-mute">{p.latest ? fmtBytes(p.latest.downloadSize) : ""}</span>
                </span>
                <span className="obrow__name">
                  <FitText text={p.name.toUpperCase()} size={44} minSize={20} maxSize={56} label={p.name} />
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="t-meta" data-testid="ob-size">
          {selected.length === 0 ? o.step1.none : o.step1.sizeLine(fmtBytes(totalBytes))}
        </p>
      </>
    );
  } else if (step === 2) {
    content = (
      <>
        <h1 className="ob__title t-title">{o.step2.title}</h1>
        <p className="t-read">{o.step2.help}</p>
        {folderChosen ? (
          <div className="stack">
            <p className="t-data selectable" data-testid="ob-folder">
              {o.step2.chosen(folderChosen)}
            </p>
            {status.data?.configured ? <p className="t-meta">{o.step2.summary(fmtCount(status.data.entryCount), fmtCount(status.data.projectCount))}</p> : null}
            <div>
              <Button onClick={choose.start}>{o.step2.change}</Button>
            </div>
          </div>
        ) : (
          <div className="cluster">
            <Button variant="action" onClick={choose.start} data-testid="ob-choose-folder">
              {o.step2.choose}
            </Button>
            <Button variant="text" onClick={() => go(3)}>
              {o.step2.later}
            </Button>
          </div>
        )}
        {!folderChosen ? <p className="t-meta t-mute">{o.step2.noFolder}</p> : null}
        {choose.dialog}
      </>
    );
    nextDisabled = false;
  } else if (step === 3) {
    const ready = items.length > 0 && items.every((it) => it.plan || it.planError);
    nextLabel = o.step3.all;
    nextDisabled = !ready || items.every((it) => !it.plan);
    onNext = () => {
      if (started.current) return;
      started.current = true;
      batch.startAll();
      go(4);
    };
    if (chosen.length === 0) {
      content = (
        <>
          <h1 className="ob__title t-title">{o.step3.title}</h1>
          <p className="t-read">{o.step3.nothing}</p>
        </>
      );
      nextLabel = o.next;
      nextDisabled = false;
      onNext = () => go(6);
    } else {
      content = (
        <>
          <h1 className="ob__title t-title">{o.step3.title}</h1>
          <p className="t-read">{o.step3.help}</p>
          {batch.previewing && !ready ? <p className="t-meta" role="status">{o.step3.loading}</p> : null}
          <table className="stable" data-testid="ob-review">
            <caption className="sr-only">{o.step3.title}</caption>
            <thead>
              <tr>
                <th scope="col" className="t-label">{o.step3.columns.program}</th>
                <th scope="col" className="t-label">{o.step3.columns.source}</th>
                <th scope="col" className="t-label">{o.step3.columns.version}</th>
                <th scope="col" className="t-label">{o.step3.columns.size}</th>
                <th scope="col" className="t-label">{o.step3.columns.license}</th>
                <th scope="col" className="t-label">{o.step3.columns.checksum}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const open = openRows.has(it.programId);
                return (
                  <FragmentRow
                    key={it.programId}
                    cells={
                      it.plan ? (
                        <>
                          <td className="t-strong">{it.name}</td>
                          <td className="t-data">{it.plan.source.host}</td>
                          <td className="t-data">{it.plan.version}</td>
                          <td className="t-data">{fmtBytes(it.plan.artifact.size)}</td>
                          <td className="t-data">{it.plan.license.spdx}</td>
                          <td className="t-data">
                            {checksumShort(it.plan.artifact.sha256)}{" "}
                            <button
                              type="button"
                              className="linkbtn"
                              aria-expanded={open}
                              onClick={() =>
                                setOpenRows((cur) => {
                                  const n = new Set(cur);
                                  if (n.has(it.programId)) n.delete(it.programId);
                                  else n.add(it.programId);
                                  return n;
                                })
                              }
                            >
                              {open ? o.step3.hideDetails : o.step3.details}
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="t-strong">{it.name}</td>
                          <td colSpan={5}>
                            {it.planError ? <span className="field__error t-meta">{o.step3.failed(it.name)}</span> : <span className="t-meta t-mute">{t.common.loading}</span>}
                          </td>
                        </>
                      )
                    }
                    detail={open && it.plan ? <span className="t-data selectable">{`${it.plan.target.dir} · ${it.plan.artifact.sha256}`}</span> : null}
                  />
                );
              })}
            </tbody>
          </table>
          <Checkbox checked={applySetup} onChange={setApplySetup}>
            {o.step3.afterSetup}
          </Checkbox>
        </>
      );
    }
  } else if (step === 4) {
    const failedItems = items.filter((it) => it.state === "failed");
    nextLabel = batch.settled ? o.next : o.step4.cont;
    showBack = false;
    onNext = () => go(5);
    content = (
      <>
        <h1 className="ob__title t-title">{o.step4.title}</h1>
        <p className="t-read">{o.step4.help}</p>
        <ul className="ob__rows" data-testid="ob-downloads">
          {items.map((it) => (
            <li key={it.programId} className="obrow" data-state={it.state}>
              <div className="obrow__label">
                <span className="obrow__name obrow__name--small">
                  <FitText text={it.name.toUpperCase()} size={30} minSize={16} maxSize={36} label={it.name} />
                </span>
                <span className="obrow__text">
                  {it.state === "running" ? <Bar value={it.progress} label={it.name} valueText={`${Math.round(it.progress * 100)} %`} thin /> : null}
                  <span className="t-data t-mute" data-testid={`ob-state-${it.programId}`}>
                    {it.state === "pending" ? o.step4.queued : it.state === "running" ? `${fmtMegabytes(it.downloaded)} / ${it.plan ? fmtBytes(it.plan.artifact.size) : ""}` : o.step4[it.state === "done" ? "done" : it.state === "cancelled" ? "cancelled" : "failed"]}
                  </span>
                </span>
                <span className="obrow__status">
                  {it.state === "done" ? <Status kind="ok">{o.step4.done}</Status> : it.state === "failed" ? <Status kind="error">{o.step4.failed}</Status> : it.state === "running" ? <Status kind="plain">{o.step4.running}</Status> : <Status kind="open">{o.step4.queued}</Status>}
                </span>
              </div>
            </li>
          ))}
        </ul>
        {failedItems.map((it) => (
          <Notice key={it.programId} kind="warn" title={o.step4.failedLine(it.name)} role="status">
            {it.error ? errorText(it.error).text : null}
          </Notice>
        ))}
        {batch.settled ? <p className="t-meta status status--ok">{o.step4.allDone}</p> : null}
      </>
    );
  } else if (step === 5) {
    content = (
      <>
        <h1 className="ob__title t-title">{o.step5.title}</h1>
        <p className="t-read">{o.step5.help}</p>
        {items.length === 0 ? <p className="t-meta t-mute">{o.step5.none}</p> : null}
        <ul className="ob__rows" data-testid="ob-setup">
          {items.map((it) => (
            <li key={it.programId} className="obrow">
              <div className="obrow__label">
                <span className="obrow__name obrow__name--small">
                  <FitText text={it.name.toUpperCase()} size={30} minSize={16} maxSize={36} label={it.name} />
                </span>
                <span className="obrow__text t-meta">
                  {it.setup === "off" ? o.step5.off : it.setup === "done" ? o.step5.applied(it.setupCount) : it.setup === "needsYou" ? o.step5.needsYou : it.state === "done" ? o.step5.applied(it.setupCount) : o.step5.pending}
                </span>
                <span className="obrow__status">
                  {it.setup === "done" ? <Status kind="ok">{t.setup.status.current}</Status> : it.setup === "needsYou" ? <Status kind="warn">{o.step5.needsYou}</Status> : it.state === "failed" ? <Status kind="error">{o.step4.failed}</Status> : <Status kind="open">{o.step5.pending}</Status>}
                  {it.setup === "needsYou" ? (
                    <Button
                      small
                      onClick={() => {
                        save({ status: "inProgress", step: 5 });
                        void navigate(`/programme/${it.programId}?tab=einrichtung`);
                      }}
                    >
                      {o.step5.toProgram}
                    </Button>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </>
    );
  } else {
    nextLabel = o.next;
    showBack = false;
    onNext = () => go(7);
    content = (
      <>
        <h1 className="ob__title t-title">{o.step6.title}</h1>
        <p className="t-read">{o.step6.help}</p>
        <div className="probe">
          <div className="probe__img">{sample?.handle.url ? <img src={sample.handle.url} alt={o.step6.sample} /> : null}</div>
          <div className="stack">
            {sampleReport.data ? (
              <Verdict kind={sampleSum.verdict === "ok" ? "ok" : sampleSum.verdict === "warning" ? "warn" : "error"} word={sampleSum.verdict === "ok" ? t.print.verdict.ok : sampleSum.verdict === "warning" ? t.print.verdict.warning : t.print.verdict.error} count={o.step6.result(t.print.verdict[sampleSum.verdict], sampleSum.warnings)} />
            ) : (
              <p className="t-meta" role="status">
                {o.step6.loading}
              </p>
            )}
            <ol className="probe__notes t-read">
              <li>{o.step6.explainVerdict}</li>
              <li>{o.step6.explainRule}</li>
              <li>{o.step6.explainFix}</li>
            </ol>
          </div>
        </div>
      </>
    );
  }

  primary.current = nextDisabled ? null : onNext;
  const isLast = step === 6;

  return (
    <div className="ob" data-step={step} data-testid="screen-onboarding">
      <header className="ob__head">
        <span className="ob__brand">
          <FitText text="CYPHER STUDIO" size={20} minSize={12} maxSize={22} label={t.nav.brandName} />
        </span>
        <div className="ob__scale">
          <Scale step={step} downloadMin={downloadMin} needle={needle} />
          <p className="t-data ob__remaining" data-testid="ob-remaining">
            {step >= 4 && dlTotal > 0 ? o.schedule.remaining(remaining) : o.schedule.estimating}
          </p>
        </div>
        <Button variant="text" onClick={later} data-testid="ob-later">
          <IconClose size={14} />
          {o.later}
        </Button>
      </header>
      <main className="ob__main" id="main" data-region="preview" tabIndex={-1} aria-label={o.schedule.stepOf(step)}>
        <div className="ob__content">{content}</div>
      </main>
      <footer className="ob__foot">
        <p className="t-label">{o.schedule.stepOf(step)}</p>
        <div className="cluster">
          {showBack ? (
            <Button onClick={() => go(step - 1)} data-testid="ob-back">
              {o.back}
            </Button>
          ) : null}
          {isLast ? (
            <>
              <Button
                onClick={() => {
                  if (sample) useDrops.getState().push([sample.handle]);
                  finish("/druck");
                }}
                data-testid="ob-open-print"
              >
                {o.step6.open}
              </Button>
              <Button variant="text" onClick={() => go(7)} data-testid="ob-skip-probe">
                {o.step6.skip}
              </Button>
            </>
          ) : null}
          <Button variant="action" combo="mod+enter" onClick={onNext} disabled={nextDisabled} data-testid="ob-next">
            {nextLabel}
          </Button>
        </div>
      </footer>
    </div>
  );
}

function FragmentRow({ cells, detail }: { cells: ReactNode; detail: ReactNode }) {
  return (
    <>
      <tr>{cells}</tr>
      {detail ? (
        <tr className="stable__extra">
          <td colSpan={6}>{detail}</td>
        </tr>
      ) : null}
    </>
  );
}

/** Startklar-Band (lauter Moment 2): Schnitt auf das Band in Cyan, einmal von links gefüllt (240 ms). */
export function ReadyBand({ onDone, items, folder, templates }: { onDone: () => void; items: ReturnType<typeof useBatch>["items"]; folder: string | null; templates: number }) {
  const r = o.ready;
  useDocumentTitle(r.word);
  return (
    <div className="ob ob--ready" data-testid="screen-ready">
      <main className="ready" id="main" data-region="preview" tabIndex={-1} aria-label={r.label}>
        <div className="ready__band" data-testid="ready-band">
          <h1 className="ready__word">
            <FitText text={r.word} size={180} minSize={48} maxSize={320} label={r.word} />
          </h1>
        </div>
        <div className="ready__sum">
          <div className="mz">
            {items.map((it) => (
              <span key={it.programId} className="mz__item">
                <span className="mz__value">{it.state === "done" ? (it.setup === "done" ? r.installed(it.name, it.installation?.version ?? "") : r.installedPlain(it.name, it.installation?.version ?? "")) : r.missing(it.name)}</span>
              </span>
            ))}
            {folder ? (
              <span className="mz__item">
                <span className="mz__value">{`${r.folder} ${folder}`}</span>
              </span>
            ) : null}
            <span className="mz__item">
              <span className="mz__value">{r.templates(templates)}</span>
            </span>
          </div>
          <div>
            <Button variant="action" combo="enter" onClick={onDone} data-testid="ready-done" data-autofocus>
              {r.toStart}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

void GlyphOk;
void GlyphOpen;
void fmtNumber;
