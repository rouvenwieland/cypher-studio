import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Collection, Project } from "@contract";
import { call } from "../../ipc/commands";
import { useCmd } from "../../ipc/queries";
import { errorText } from "../../i18n/errors";
import { ellipsizeMiddle, fmtCount, fmtRelative } from "../../i18n/format";
import { t } from "../../i18n/de";
import { useJobs, useToasts } from "../../app/stores";
import { Notice } from "../../ui/Bits";
import { Button } from "../../ui/Button";
import { ActionMenu, type MenuEntry } from "../../ui/Overlays";
import { useRoving } from "../../ui/useRoving";
import { useInstallUi } from "../install/store";
import { useChooseRoot } from "../library/ChooseRoot";

const s = t.start.projects;
const MAX_ROWS = 6;

function CollectionMark({ collection }: { collection: Collection | undefined }) {
  if (!collection) return <span className="t-label">{s.noCollection}</span>;
  return (
    <span className="coll">
      <span className="coll__sw" style={{ background: collection.hex }} aria-hidden="true" />
      <span className="t-label coll__name">{collection.name}</span>
    </span>
  );
}

export function ProjectsPanel({ onCreate }: { onCreate: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const push = useToasts((s2) => s2.push);
  const openInstall = useInstallUi((st) => st.open);
  const status = useCmd("library_status", undefined);
  const projects = useCmd("projects_list", undefined, { retry: false });
  const jobs = useJobs((st) => st.active);
  const choose = useChooseRoot();
  const collections = status.data?.collections ?? [];
  const list = projects.data ?? [];
  const shown = list.slice(0, MAX_ROWS);

  const openProject = (p: Project) => void navigate(`/bibliothek?projekt=${encodeURIComponent(p.id)}`);
  const openLast = (p: Project) => {
    void call("project_open_last", { req: { projectId: p.id } })
      .then((res) => {
        if (res.outcome.kind === "programMissing") openInstall({ programId: res.outcome.programId });
        else if (res.outcome.kind === "module") void navigate(res.outcome.module === "mockup" ? "/mockups" : "/social");
        else push({ kind: "info", text: t.programs.launchedToast(p.lastFile?.relPath.split("/").pop() ?? p.name) });
      })
      .catch((e: unknown) => push({ kind: "error", text: errorText(toApp(e)).title }));
  };
  const roving = useRoving({
    count: shown.length,
    onEnter: (i) => {
      const p = shown[i];
      if (p) openProject(p);
    },
    onModEnter: (i) => {
      const p = shown[i];
      if (p) openLast(p);
    },
  });

  const header = (
    <div className="panel__head">
      <h2 className="t-section">{s.title}</h2>
      {status.data?.root ? (
        <span className="t-data t-mute t-trunc selectable">{s.folderLabel(status.data.root)}</span>
      ) : null}
    </div>
  );

  // Laden
  if (status.isPending || (projects.isPending && status.data?.configured)) {
    return (
      <section aria-labelledby="start-projects" className="panel">
        {header}
        <div className="skel" role="status" aria-label={s.loadingStatus}>
          {Array.from({ length: MAX_ROWS }, (_, i) => (
            <div key={i} className="skel__row" />
          ))}
        </div>
      </section>
    );
  }

  // Leer: kein Ordner
  if (status.data && !status.data.configured) {
    const e = s.empty.noFolder;
    return (
      <section className="panel" data-testid="projects-empty-nofolder">
        {header}
        <div className="empty">
          <p className="t-section">{e.title}</p>
          <p className="t-read">{e.text}</p>
          <Button variant="action" onClick={choose.start} data-testid="choose-folder">
            {e.action}
          </Button>
        </div>
        {choose.dialog}
      </section>
    );
  }

  // Fehler
  if (projects.isError) {
    const err = projects.error;
    const path = status.data?.root ?? "";
    const text =
      err.kind === "permissionDenied"
        ? s.error.permission(path)
        : err.kind === "io"
          ? s.error.unreachable(path)
          : s.error.generic;
    return (
      <section className="panel" data-testid="projects-error">
        {header}
        <Notice
          kind="error"
          title={text}
          actions={
            <>
              <Button onClick={() => void qc.invalidateQueries({ queryKey: ["projects_list"] })}>
                {s.error.retry}
              </Button>
              <Button onClick={choose.start}>{s.error.other}</Button>
            </>
          }
        />
        {choose.dialog}
      </section>
    );
  }

  if (list.length === 0) {
    return (
      <section className="panel" data-testid="projects-empty">
        {header}
        <div className="empty">
          <p className="t-read">{s.empty.noProjects.text(status.data?.root ?? "")}</p>
          <Button variant="action" onClick={onCreate}>
            {s.empty.noProjects.action}
          </Button>
        </div>
      </section>
    );
  }

  const scan = jobs.find((j) => j.kind === "libraryScan");
  const total = status.data?.entryCount ?? 0;

  const menuFor = (p: Project): MenuEntry[] => [
    {
      id: "reveal",
      label: s.menu.reveal,
      onSelect: () => void call("app_reveal", { req: { target: { kind: "project", projectId: p.id } } }),
    },
    ...collections.map((c, idx) => ({
      id: `coll-${c.id}`,
      label: `${s.menu.collection}: ${c.name}`,
      separatorBefore: idx === 0,
      onSelect: () => void call("project_set_collection", { req: { projectId: p.id, collection: c.id } }),
    })),
    {
      id: "coll-none",
      label: `${s.menu.collection}: ${s.noCollection}`,
      onSelect: () => void call("project_set_collection", { req: { projectId: p.id, collection: null } }),
    },
    {
      id: "forget",
      label: s.menu.forget,
      separatorBefore: true,
      onSelect: () => void call("project_forget", { req: { projectId: p.id } }),
    },
  ];

  return (
    <section className="panel" aria-labelledby="start-projects">
      {header}
      {scan ? (
        <p className="panel__note t-data" role="status" data-testid="scan-note">
          {s.scanning(fmtCount(Math.round((scan.progress ?? 0) * total)), fmtCount(total))}
        </p>
      ) : null}
      <ul
        className="plist"
        role="grid"
        aria-label={s.listLabel}
        aria-describedby="projects-hint"
        {...roving.containerProps}
        data-testid="projects-list"
      >
        {shown.map((p, i) => {
          const coll = collections.find((c) => c.id === p.collection);
          const lastName = p.lastFile?.relPath.split("/").pop() ?? null;
          return (
            <li
              key={p.id}
              role="row"
              className="prow"
              {...roving.itemProps(i)}
              onDoubleClick={() => openProject(p)}
              data-testid={`project-${p.id}`}
            >
              <div className="prow__main" role="gridcell">
                <span className="prow__name t-trunc">{p.name}</span>
                {lastName ? (
                  <span className="prow__last t-meta t-trunc" title={lastName}>
                    {s.lastFile(ellipsizeMiddle(lastName, 40))}
                  </span>
                ) : null}
              </div>
              <div role="gridcell">
                <CollectionMark collection={coll} />
              </div>
              <span className="t-data prow__count" role="gridcell">
                {s.files(p.fileCount)}
              </span>
              <span className="t-data prow__time" role="gridcell">
                {fmtRelative(p.updatedAt)}
              </span>
              <span
                className="prow__menu"
                role="gridcell"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <ActionMenu entries={menuFor(p)} label={`${t.common.more}: ${p.name}`} />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="sr-only" id="projects-hint">
        {s.hint}
      </p>
      {list.length > MAX_ROWS ? (
        <p className="panel__more">
          <Button variant="text" onClick={() => void navigate("/bibliothek")}>
            {s.all(list.length)}
          </Button>
        </p>
      ) : null}
      {choose.dialog}
    </section>
  );
}

function toApp(e: unknown) {
  return e && typeof e === "object" && "kind" in e
    ? (e as Parameters<typeof errorText>[0])
    : ({ kind: "internal", message: "Unbekannter Fehler", correlationId: "unbekannt" } as const);
}
