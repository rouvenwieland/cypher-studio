import { useEffect, useRef, type ReactNode } from "react";
import { t } from "../i18n/de";
import { useMainAction } from "../app/stores";
import { Button } from "./Button";
import { MessZeile, type MzItem } from "./Bits";

/**
 * Ausgangsleiste (Signatur 2): links die Messzeile des Ergebnisses, rechts genau eine Aktion, immer Strg+Enter.
 * Zustände: bereit · gesperrt (Klick springt zum ersten Fehler) · läuft (echter Fortschritt) · erledigt (Leiste füllt sich).
 */
export type OutputState =
  | { kind: "ready"; label: string; onRun: () => void }
  | { kind: "blocked"; label: string; reason: string; onJump: () => void; forceLabel?: string; onForce?: () => void }
  | { kind: "running"; label: string; progress: number | null; onCancel?: (() => void) | undefined }
  | { kind: "done"; message: ReactNode; announce: string; actions?: ReactNode }
  | { kind: "error"; message: ReactNode; announce: string; actions?: ReactNode };

interface OutputBarProps {
  target?: string | undefined;
  summary: MzItem[];
  state: OutputState;
  /** Weitere Textaktionen links der Hauptaktion (bereit/gesperrt) */
  secondary?: ReactNode;
  testId?: string | undefined;
}

export function OutputBar({ target, summary, state, secondary, testId }: OutputBarProps) {
  const runRef = useRef<(() => void) | null>(null);
  const run = state.kind === "ready" ? state.onRun : state.kind === "blocked" ? state.onJump : null;
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => {
    const set = useMainAction.getState().set;
    set(() => runRef.current?.());
    return () => set(null);
  }, []);

  const lastBucket = useRef(-1);
  let live = "";
  if (state.kind === "done" || state.kind === "error") live = state.announce;
  else if (state.kind === "running" && state.progress !== null) {
    const bucket = Math.floor(state.progress * 10);
    if (bucket !== lastBucket.current) {
      lastBucket.current = bucket;
    }
    live = `${state.label}: ${bucket * 10} %`;
  }

  return (
    <div className="outbar" data-state={state.kind} role="region" aria-label={t.common.region.output} data-region="output" tabIndex={-1} {...(testId ? { "data-testid": testId } : {})}>
      <span className="t-label">{t.common.labels.output}</span>
      {state.kind === "done" || state.kind === "error" ? (
        <>
          <div className="outbar__summary t-data selectable">{state.message}</div>
          <div className="outbar__actions">{state.actions}</div>
        </>
      ) : (
        <>
          <div className="outbar__summary">
            {target ? <span className="outbar__target t-meta">{target}</span> : null}
            <MessZeile items={summary} plain />
          </div>
          <div className="outbar__actions">
            {secondary}
            {state.kind === "blocked" ? <span className="outbar__reason t-meta">{state.reason}</span> : null}
            {state.kind === "blocked" && state.onForce ? (
              <Button variant="text" onClick={state.onForce}>
                {state.forceLabel ?? t.common.retry}
              </Button>
            ) : null}
            {state.kind === "ready" ? (
              <Button variant="action" combo="mod+enter" onClick={state.onRun} data-testid="output-action">
                {state.label}
              </Button>
            ) : null}
            {state.kind === "blocked" ? (
              <Button variant="action" combo="mod+enter" softDisabled onClick={state.onJump} data-testid="output-action">
                {state.label}
              </Button>
            ) : null}
            {state.kind === "running" ? (
              <>
                {state.onCancel ? (
                  <Button variant="text" onClick={state.onCancel} data-testid="output-cancel">
                    {t.common.cancel}
                  </Button>
                ) : null}
                <RunButton label={state.label} progress={state.progress} />
              </>
            ) : null}
          </div>
        </>
      )}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {live}
      </div>
    </div>
  );
}

function RunButton({ label, progress }: { label: string; progress: number | null }) {
  const pct = progress === null ? null : Math.round(progress * 100);
  const text = pct === null ? `${label} ${t.common.working}` : `${label} ${pct} %`;
  return (
    <div
      className="outbar__run"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(pct !== null ? { "aria-valuenow": pct } : {})}
      aria-valuetext={text}
      data-testid="output-run"
    >
      <span className="outbar__run-base">{text}</span>
      {pct !== null ? (
        <span className="outbar__run-fill" style={{ width: `${pct}%` }}>
          <span className="outbar__run-over">{text}</span>
        </span>
      ) : null}
    </div>
  );
}
