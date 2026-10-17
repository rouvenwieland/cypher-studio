import { useEffect, useState, type KeyboardEvent } from "react";
import { Route, Routes, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../../ipc/commands";
import { ellipsizePath, fmtDate } from "../../i18n/format";
import { t } from "../../i18n/de";
import { useMainAction } from "../../app/stores";
import { Notice } from "../../ui/Bits";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { PlainPage } from "../../ui/Frames";
import { useRoving } from "../../ui/useRoving";
import { ProgramDetail } from "./Detail";
import {
  ProgramName,
  ProgressText,
  RowActionButton,
  StatusCell,
  roleOf,
  versionText,
  useProgramActions,
  useProgramRows,
} from "./parts";
import "./programs.css";

const s = t.programs;

function Board() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { query, rows } = useProgramRows();
  const run = useProgramActions();
  const [checking, setChecking] = useState(false);
  const [marks, setMarks] = useState(false);

  const check = () => {
    setChecking(true);
    void Promise.allSettled([call("catalog_refresh"), call("programs_rescan")]).finally(() => {
      setChecking(false);
      void qc.invalidateQueries({ queryKey: ["programs_list"] });
    });
  };

  const roving = useRoving({
    count: rows.length,
    onEnter: (i) => {
      const r = rows[i];
      if (r) void navigate(`/programme/${r.program.id}`);
    },
    onModEnter: (i) => {
      const r = rows[i];
      if (r) run(r);
    },
    onKey: (e: KeyboardEvent<HTMLElement>) => {
      if ((e.key === "u" || e.key === "U") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        check();
      }
    },
  });

  // Strg+Enter überall auf der Tafel: Aktion der gewählten Zeile
  useEffect(() => {
    const set = useMainAction.getState().set;
    set(() => {
      const r = rows[roving.active];
      if (r) run(r);
    });
    return () => set(null);
  }, [rows, roving.active, run]);

  const catalog = query.data?.catalog ?? null;

  return (
    <PlainPage
      title={s.title}
      testId="screen-programs"
      tools={
        <Button onClick={check} disabled={checking} data-testid="check-updates">
          {checking ? s.checking : s.checkUpdates}
        </Button>
      }
    >
      <div className="board">
        {catalog?.expired ? (
          <Notice
            kind="warn"
            title={s.catalogExpired.title}
            actions={
              <Button onClick={check} disabled={checking}>
                {s.catalogExpired.retry}
              </Button>
            }
            testId="catalog-expired"
          >
            {s.catalogExpired.text}
          </Notice>
        ) : null}
        <ul
          className="tafel"
          role="grid"
          aria-label={s.list.label}
          aria-describedby="tafel-hint"
          {...roving.containerProps}
          data-testid="program-list"
        >
          {query.isPending
            ? Array.from({ length: 4 }, (_, i) => <li key={i} className="trow trow--skel" aria-hidden="true" />)
            : rows.map((row, i) => (
                <li
                  key={row.program.id}
                  role="row"
                  className="trow"
                  {...roving.itemProps(i)}
                  onClick={() => void navigate(`/programme/${row.program.id}`)}
                  data-testid={`program-${row.program.id}`}
                >
                  <div className="trow__name" role="gridcell">
                    <ProgramName name={row.program.name} />
                    <span className="t-label">{roleOf(row.program)}</span>
                  </div>
                  <span className="t-data trow__version" role="gridcell">
                    {versionText(row.state)}
                  </span>
                  <div className="trow__status" role="gridcell">
                    <StatusCell row={row} />
                    {row.state.progress !== null ? <ProgressText row={row} /> : null}
                    {row.state.status === "found" && row.state.installation ? (
                      <span className="t-meta trow__found" title={s.foundWhy}>
                        {s.foundHint(
                          row.state.installation.version ?? "—",
                          ellipsizePath(row.state.installation.location, 46),
                        )}
                      </span>
                    ) : null}
                  </div>
                  <div role="gridcell">
                    <RowActionButton row={row} onRun={run} />
                  </div>
                </li>
              ))}
        </ul>
        <p className="sr-only" id="tafel-hint">
          {s.list.selectHint}
        </p>
        <div className="board__foot">
          <p className="t-meta">
            {s.footnote}
            {catalog && !catalog.expired ? (
              <>
                {" "}
                <span data-testid="catalog-line">{s.catalogLine(fmtDate(catalog.generatedAt), catalog.source)}</span>
              </>
            ) : null}
          </p>
          <Button variant="text" small onClick={() => setMarks(true)}>
            {s.trademarks}
          </Button>
        </div>
        {(query.data?.links ?? []).length > 0 ? (
          <div className="board__links">
            <h2 className="t-label">{s.linksTitle}</h2>
            <ul>
              {(query.data?.links ?? []).map((l) => (
                <li key={l.id} className="t-meta">
                  <button
                    type="button"
                    className="linkbtn"
                    onClick={() =>
                      void call("app_open_external", { req: { target: { kind: "catalogLink", linkId: l.id } } })
                    }
                  >
                    {l.name}
                  </button>{" "}
                  <span className="t-mute">{l.note ?? l.description}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <Dialog
        open={marks}
        title={s.trademarkTitle}
        onClose={() => setMarks(false)}
        footer={<Button onClick={() => setMarks(false)}>{t.common.close}</Button>}
      >
        <p className="t-read">{s.trademarkText}</p>
      </Dialog>
    </PlainPage>
  );
}

export default function Programs() {
  return (
    <Routes>
      <Route index element={<Board />} />
      <Route path=":id" element={<ProgramDetail />} />
    </Routes>
  );
}
