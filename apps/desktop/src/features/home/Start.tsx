import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { call } from "../../ipc/commands";
import { useCmd } from "../../ipc/queries";
import { fmtCount } from "../../i18n/format";
import { t } from "../../i18n/de";
import { useDrops, useToasts } from "../../app/stores";
import { useSettings } from "../../app/theme";
import { ONBOARDING_PATH } from "../../app/modules";
import { Button } from "../../ui/Button";
import { PlainPage } from "../../ui/Frames";
import { useRoving } from "../../ui/useRoving";
import { useChooseRoot } from "../library/ChooseRoot";
import {
  ProgramName,
  RowActionButton,
  StatusCell,
  useProgramActions,
  useProgramRows,
  ProgressText,
  roleOf,
  versionText,
} from "../programs/parts";
import { NewProjectDialog } from "./NewProjectDialog";
import { ProjectsPanel } from "./ProjectsPanel";
import { TemplateStrip } from "./TemplateStrip";
import "./start.css";

const s = t.start;

function ProgramsPanel() {
  const navigate = useNavigate();
  const { query, rows } = useProgramRows();
  const run = useProgramActions();
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
  });
  return (
    <section className="panel" aria-labelledby="start-programs">
      <div className="panel__head">
        <h2 className="t-section" id="start-programs">
          {s.programs.title}
        </h2>
        <Button variant="text" small onClick={() => void navigate("/programme")}>
          {s.programs.all}
        </Button>
      </div>
      {query.isPending ? (
        <div className="skel" role="status" aria-label={t.common.loading}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skel__row skel__row--prog" />
          ))}
        </div>
      ) : (
        <ul
          className="pl"
          role="grid"
          aria-label={s.programs.title}
          {...roving.containerProps}
          data-testid="start-programs"
        >
          {rows.map((row, i) => (
            <li
              key={row.program.id}
              role="row"
              className="pl__row"
              {...roving.itemProps(i)}
              onClick={() => void navigate(`/programme/${row.program.id}`)}
              data-testid={`start-program-${row.program.id}`}
            >
              <div className="pl__name" role="gridcell">
                <ProgramName name={row.program.name} size={34} maxSize={44} />
                <span className="t-label">{roleOf(row.program)}</span>
              </div>
              <div className="pl__state" role="gridcell">
                <span className="t-data t-trunc">{versionText(row.state)}</span>
                <StatusCell row={row} />
                {row.state.progress !== null ? <ProgressText row={row} /> : null}
              </div>
              <div role="gridcell">
                <RowActionButton row={row} onRun={run} small />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FolderPanel() {
  const status = useCmd("library_status", undefined);
  const projects = useCmd("projects_list", undefined, { retry: false });
  const choose = useChooseRoot();
  const f = s.folder;
  return (
    <section className="panel" aria-labelledby="start-folder">
      <div className="panel__head">
        <h2 className="t-section" id="start-folder">
          {f.title}
        </h2>
      </div>
      <div className="stack">
        {status.isPending ? (
          <div className="skel" role="status" aria-label={t.common.loading}>
            <div className="skel__row" />
          </div>
        ) : status.data?.configured && status.data.root ? (
          <>
            <p className="t-data selectable">
              {projects.isError
                ? f.unreachable(status.data.root)
                : f.summary(status.data.root, fmtCount(status.data.entryCount))}
            </p>
            <div>
              <Button onClick={choose.start}>{f.change}</Button>
            </div>
          </>
        ) : (
          // die Einladung „Ordner wählen“ steht links bei den Projekten, hier nur der Zustand
          <p className="t-meta t-mute">{f.none}</p>
        )}
      </div>
      {choose.dialog}
    </section>
  );
}

export default function Start() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const settings = useSettings();
  const push = useToasts((st) => st.push);
  const [newOpen, setNewOpen] = useState(params.get("neu") === "1");

  useEffect(() => {
    if (params.get("neu") === "1") {
      setNewOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => {
    const onOpen = () => {
      void call("file_pick", { req: { purpose: "openAny" } })
        .then((handles) => {
          if (handles.length === 0) return;
          useDrops.getState().push(handles);
          void navigate("/druck");
        })
        .catch(() => push({ kind: "error", text: s.openFileFailed }));
    };
    window.addEventListener("cypher:open-file", onOpen);
    return () => window.removeEventListener("cypher:open-file", onOpen);
  }, [navigate, push]);

  const ob = settings.data?.onboarding;
  const partial = ob && (ob.status === "inProgress" || ob.status === "skipped");
  const pct = ob ? Math.round((ob.step / 6) * 100) : 0;
  const minutes = ob ? Math.max(2, (6 - ob.step) * 4) : 0;

  return (
    <PlainPage
      title={s.title}
      testId="screen-start"
      tools={
        <>
          <Button onClick={() => setNewOpen(true)} combo="mod+n" data-testid="new-project">
            {s.newProject}
          </Button>
          <Button
            onClick={() => window.dispatchEvent(new CustomEvent("cypher:open-file"))}
            combo="mod+o"
            data-testid="open-file"
          >
            {s.openFile}
          </Button>
        </>
      }
    >
      {partial ? (
        <div className="resume" role="status" data-testid="resume-banner">
          <span className="t-data">{s.onboarding.banner(pct, minutes)}</span>
          <Button small onClick={() => void navigate(ONBOARDING_PATH)} data-testid="resume-onboarding">
            {s.onboarding.resume}
          </Button>
        </div>
      ) : null}
      <div className="start">
        <div className="start__projects">
          <ProjectsPanel onCreate={() => setNewOpen(true)} />
        </div>
        <div className="start__side">
          <ProgramsPanel />
          <FolderPanel />
        </div>
        <div className="start__templates">
          <TemplateStrip onNewProject={() => setNewOpen(true)} />
        </div>
      </div>
      <NewProjectDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </PlainPage>
  );
}
