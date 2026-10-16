import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import type { TemplateInfo } from "@contract";
import { call } from "../../ipc/commands";
import { useCmd } from "../../ipc/queries";
import { toAppError } from "../../ipc/errors";
import { errorText } from "../../i18n/errors";
import { t } from "../../i18n/de";
import { useToasts } from "../../app/stores";
import { Button } from "../../ui/Button";
import { Field, SelectField } from "../../ui/Inputs";
import { Pop } from "../../ui/Overlays";
import { useRoving } from "../../ui/useRoving";
import { useInstallUi } from "../install/store";

const s = t.start.templates;

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Ziel der Vorlage: Programm oder eigenes Modul; als Wort für das Etikett und als ganzer Satz für den Namen. */
function targetOf(tpl: TemplateInfo, programName: (id: string) => string): string {
  if (tpl.target === "program" && tpl.programId) return programName(tpl.programId);
  return tpl.target === "mockup" ? s.opensInModule.mockup : s.opensInModule.social;
}

function CreatePopover({ tpl, programName, onClose, onNewProject }: { tpl: TemplateInfo; programName: string; onClose: () => void; onNewProject: () => void }) {
  const navigate = useNavigate();
  const projects = useCmd("projects_list", undefined, { retry: false });
  const push = useToasts((st) => st.push);
  const openInstall = useInstallUi((st) => st.open);
  const list = projects.data ?? [];
  const [projectId, setProjectId] = useState<string>("");
  const effectiveProject = projectId || list[0]?.id || "";
  const project = list.find((p) => p.id === effectiveProject);
  const [fileName, setFileName] = useState<string | null>(null);
  const name = fileName ?? `${slug(project?.name ?? "projekt")}_${slug(tpl.title)}`;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const create = (e?: FormEvent) => {
    e?.preventDefault();
    if (!project || busy || !name.trim()) return;
    setBusy(true);
    setProblem(null);
    call("project_new_file", { req: { projectId: project.id, templateId: tpl.id, fileName: name.trim() } })
      .then((file) => call("project_open_file", { req: { projectId: project.id, relPath: file.ref.relPath } }))
      .then((res) => {
        onClose();
        if (res.outcome.kind === "programMissing") {
          push({ kind: "info", text: s.programMissing(programName), actionLabel: s.install(programName), onAction: () => openInstall({ programId: res.outcome.kind === "programMissing" ? res.outcome.programId : "" }) });
        } else if (res.outcome.kind === "module") {
          void navigate(res.outcome.module === "mockup" ? "/mockups" : "/social");
        } else {
          push({ kind: "info", text: s.popover.created(name) });
        }
      })
      .catch((err: unknown) => setProblem(errorText(toAppError(err)).text))
      .finally(() => setBusy(false));
  };

  if (!projects.isPending && list.length === 0) {
    return (
      <div className="stack">
        <p className="t-meta">{s.popover.needsProject}</p>
        <Button
          variant="action"
          onClick={() => {
            onClose();
            onNewProject();
          }}
        >
          {s.popover.noProject}
        </Button>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={create} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); create(); } }} data-testid="template-popover">
      <h3 className="t-section">{s.popover.title(tpl.title)}</h3>
      <Field label={s.popover.fileName}>
        <input className="input input--mono" value={name} onChange={(e) => setFileName(e.target.value)} aria-label={s.popover.fileName} data-autofocus />
      </Field>
      <SelectField label={s.popover.project} value={effectiveProject} onChange={setProjectId} options={list.map((p) => ({ value: p.id, label: p.name }))} />
      {problem ? <p className="field__error t-meta" role="alert">{problem}</p> : null}
      <Button variant="action" type="submit" combo="mod+enter" disabled={busy || !project} data-testid="template-create">
        {tpl.programId ? s.popover.create(programName) : s.popover.createPlain}
      </Button>
    </form>
  );
}

export function TemplateStrip({ onNewProject }: { onNewProject: () => void }) {
  const templates = useCmd("templates_list", undefined);
  const programs = useCmd("programs_list", undefined);
  const [openId, setOpenId] = useState<string | null>(null);
  const items = templates.data ?? [];
  const programName = (id: string) => programs.data?.programs.find((p) => p.id === id)?.name ?? id;
  const roving = useRoving({ count: items.length, horizontal: true, onEnter: (i) => { const tpl = items[i]; if (tpl) setOpenId(tpl.id); } });

  return (
    <section className="panel" aria-labelledby="start-templates">
      <div className="panel__head">
        <h2 className="t-section" id="start-templates">
          {s.title}
        </h2>
      </div>
      {templates.isPending ? (
        <div className="skel skel--strip" role="status" aria-label={t.common.loading} />
      ) : (
        <ul className="tstrip" role="listbox" aria-label={s.label} aria-orientation="horizontal" aria-describedby="templates-hint" {...roving.containerProps} data-testid="template-strip">
          {items.map((tpl, i) => (
            <li key={tpl.id} role="presentation">
              <Pop
                open={openId === tpl.id}
                onOpenChange={(o) => setOpenId(o ? tpl.id : null)}
                label={s.popover.title(tpl.title)}
                side="top"
                trigger={
                  <button
                    type="button"
                    role="option"
                    className="tile"
                    {...roving.itemProps(i)}
                    onClick={() => setOpenId(openId === tpl.id ? null : tpl.id)}
                    data-testid={`template-${tpl.id.replace("builtin:", "")}`}
                    aria-label={`${tpl.title}, ${tpl.format.label}, ${s.opensIn(targetOf(tpl, programName))}`}
                  >
                    <span className="tile__img" style={{ width: Math.round(112 * tpl.aspect) }}>
                      {tpl.previewUrl ? <img src={tpl.previewUrl} alt="" width={Math.round(112 * tpl.aspect)} height={112} /> : null}
                    </span>
                    <span className="tile__name t-strong">{tpl.title}</span>
                    <span className="t-data">{tpl.format.label}</span>
                    <span className="t-label tile__opens" title={s.opensIn(targetOf(tpl, programName))}>{targetOf(tpl, programName).toUpperCase()}</span>
                  </button>
                }
              >
                <CreatePopover tpl={tpl} programName={tpl.programId ? programName(tpl.programId) : ""} onClose={() => setOpenId(null)} onNewProject={onNewProject} />
              </Pop>
            </li>
          ))}
        </ul>
      )}
      <p className="sr-only" id="templates-hint">
        {s.hint}
      </p>
    </section>
  );
}
