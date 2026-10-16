import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AppError, LibraryRootCandidate } from "@contract";
import { call } from "../../ipc/commands";
import { toAppError } from "../../ipc/errors";
import { errorText } from "../../i18n/errors";
import { fmtBytes, fmtCount } from "../../i18n/format";
import { t } from "../../i18n/de";
import { useToasts } from "../../app/stores";
import { Notice } from "../../ui/Bits";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Checkbox } from "../../ui/Inputs";

const c = t.library.chooseRoot;

/**
 * Ordner wählen (ARCHITEKTUR 5.9): nativer Ordnerdialog → Zusammenfassung → „Diesen Ordner nutzen“.
 * Der Dialog dient Start, Bibliothek, Einstellungen und Erststart gemeinsam.
 */
export function useChooseRoot(onDone?: () => void) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [candidate, setCandidate] = useState<LibraryRootCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [initialize, setInitialize] = useState(true);

  const start = () => {
    setBusy(true);
    setError(null);
    call("library_choose_root")
      .then((cand) => {
        if (cand) {
          setCandidate(cand);
          setInitialize(!cand.initialized);
        }
      })
      .catch((e: unknown) => {
        const err = toAppError(e);
        setError(err);
        push({ kind: "error", text: errorText(err).title });
      })
      .finally(() => setBusy(false));
  };

  const use = () => {
    if (!candidate) return;
    setBusy(true);
    call("library_use_root", {
      req: { candidateId: candidate.candidateId, initialize: initialize || !candidate.initialized },
    })
      .then(async () => {
        await qc.invalidateQueries();
        push({ kind: "info", text: c.done(candidate.path) });
        setCandidate(null);
        onDone?.();
      })
      .catch((e: unknown) => setError(toAppError(e)))
      .finally(() => setBusy(false));
  };

  const dialog = (
    <Dialog
      open={candidate !== null}
      title={c.title}
      onClose={() => setCandidate(null)}
      testId="choose-root-dialog"
      footer={
        <>
          <Button onClick={() => setCandidate(null)}>{t.common.cancel}</Button>
          <Button
            variant="action"
            combo="mod+enter"
            onClick={use}
            disabled={
              busy ||
              (candidate?.problems.some(
                (p) => p === "notWritable" || p === "insideAppData" || p === "systemDirectory",
              ) ??
                false)
            }
            data-testid="choose-root-use"
          >
            {c.use}
          </Button>
        </>
      }
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          use();
        }
      }}
    >
      {candidate ? (
        <div className="stack stack--loose">
          <p className="t-data selectable">{candidate.path}</p>
          <p className="t-section">
            {c.summary(fmtCount(candidate.fileCount), fmtBytes(candidate.totalBytes), fmtCount(candidate.projectCount))}
          </p>
          <p className="t-meta">{c.sync(candidate.syncTool)}</p>
          {candidate.problems.map((p) => (
            <Notice key={p} kind={p === "veryLarge" ? "warn" : "error"} title={c.problems[p]} />
          ))}
          {!candidate.initialized ? (
            <Checkbox checked={initialize} onChange={setInitialize}>
              {c.initialize}
            </Checkbox>
          ) : null}
          {error ? (
            <Notice kind="error" title={errorText(error).title}>
              {errorText(error).text}
            </Notice>
          ) : null}
          <p className="t-meta t-mute">{c.hint}</p>
        </div>
      ) : null}
    </Dialog>
  );

  return { start, busy, error, dialog };
}
