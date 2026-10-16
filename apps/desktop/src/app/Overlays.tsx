import { useEffect, useRef } from "react";
import { Command } from "cmdk";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../ipc/commands";
import { useCmd } from "../ipc/queries";
import { t } from "../i18n/de";
import { errorText } from "../i18n/errors";
import { formatCombo } from "../lib/keys";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { IconClose, IconSearch } from "../ui/icons";
import { MODULES, SETTINGS_PATH } from "./modules";
import { useCloseRequest, useToasts, useUi } from "./stores";
import { useSettings } from "./theme";
import { isAppError } from "../ipc/errors";

/* ---------- Toasts ---------- */

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <section className="toasts" aria-label={t.shell.toasts}>
      {toasts.map((toast) => (
        <div key={toast.id} className={toast.kind === "error" ? "toast toast--error" : "toast"} role={toast.kind === "error" ? "alert" : "status"}>
          <span>{toast.text}</span>
          {toast.actionLabel && toast.onAction ? (
            <Button variant="text" small onClick={toast.onAction}>
              {toast.actionLabel}
            </Button>
          ) : null}
          <IconButton icon={IconClose} label={t.common.close} bare onClick={() => dismiss(toast.id)} />
        </div>
      ))}
    </section>
  );
}

/* ---------- Befehlspalette (cmdk in nativem <dialog>) ---------- */

export function Palette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const ref = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const settings = useSettings();
  const programs = useCmd("programs_list", undefined, { enabled: open });
  const projects = useCmd("projects_list", undefined, { enabled: open, retry: false });
  const push = useToasts((s) => s.push);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClose = () => setOpen(false);
    el.addEventListener("close", onClose);
    return () => el.removeEventListener("close", onClose);
  }, [setOpen]);

  const run = (fn: () => void | Promise<void>) => {
    setOpen(false);
    void Promise.resolve(fn()).catch((error: unknown) => {
      if (isAppError(error)) push({ kind: "error", text: errorText(error).title });
    });
  };
  const setUi = (patch: Record<string, unknown>) =>
    call("settings_update", { req: { ui: patch } }).then(() => qc.invalidateQueries({ queryKey: ["settings_get"] }));
  const surround = settings.data?.ui.surround;
  const dark = document.documentElement.getAttribute("data-theme") === "dark" || (document.documentElement.getAttribute("data-theme") !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const setSurround = (v: "light" | "mid" | "dark") => setUi({ surround: dark ? { paper: surround?.paper ?? "light", ink: v } : { paper: v, ink: surround?.ink ?? "dark" } });
  const p = t.shell.palette;

  return (
    <dialog ref={ref} className="dialog palette" aria-label={p.title} data-testid="palette">
      {open ? (
        <Command label={p.title} loop className="palette__cmd">
          <div className="palette__input">
            <IconSearch size={16} />
            <Command.Input autoFocus placeholder={p.placeholder} aria-label={p.title} className="palette__field" />
            <kbd className="kbd">{formatCombo("esc")}</kbd>
          </div>
          <Command.List className="palette__list">
            <Command.Empty className="palette__empty t-meta">{p.empty}</Command.Empty>
            <Command.Group heading={p.groups.modules}>
              {MODULES.map((m) => (
                <Command.Item key={m.id} value={`${m.name} ${p.openModule(m.name)}`} onSelect={() => run(() => void navigate(m.path))} className="palette__item">
                  <m.icon size={16} />
                  <span>{p.openModule(m.name)}</span>
                  <kbd className="kbd">{formatCombo(`mod+${m.digit}`)}</kbd>
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading={p.groups.actions}>
              <Command.Item value={p.checkUpdates} className="palette__item" onSelect={() => run(() => void navigate(`${SETTINGS_PATH}/updates?check=1`))}>
                <span>{p.checkUpdates}</span>
              </Command.Item>
              <Command.Item value={p.newProject} className="palette__item" onSelect={() => run(() => void navigate("/start?neu=1"))}>
                <span>{p.newProject}</span>
                <kbd className="kbd">{formatCombo("mod+n")}</kbd>
              </Command.Item>
              <Command.Item value={p.openFile} className="palette__item" onSelect={() => run(() => { window.dispatchEvent(new CustomEvent("cypher:open-file")); })}>
                <span>{p.openFile}</span>
                <kbd className="kbd">{formatCombo("mod+o")}</kbd>
              </Command.Item>
              <Command.Item value={p.surround.hell} className="palette__item" onSelect={() => run(() => setSurround("light"))}>
                <span>{p.surround.hell}</span>
              </Command.Item>
              <Command.Item value={p.surround.mittel} className="palette__item" onSelect={() => run(() => setSurround("mid"))}>
                <span>{p.surround.mittel}</span>
              </Command.Item>
              <Command.Item value={p.surround.dunkel} className="palette__item" onSelect={() => run(() => setSurround("dark"))}>
                <span>{p.surround.dunkel}</span>
              </Command.Item>
              <Command.Item value={p.theme.system} className="palette__item" onSelect={() => run(() => setUi({ theme: "system" }))}>
                <span>{p.theme.system}</span>
              </Command.Item>
              <Command.Item value={p.theme.paper} className="palette__item" onSelect={() => run(() => setUi({ theme: "paper" }))}>
                <span>{p.theme.paper}</span>
              </Command.Item>
              <Command.Item value={p.theme.ink} className="palette__item" onSelect={() => run(() => setUi({ theme: "ink" }))}>
                <span>{p.theme.ink}</span>
              </Command.Item>
              <Command.Item value={p.shortcuts} className="palette__item" onSelect={() => run(() => useUi.getState().setHelp(true))}>
                <span>{p.shortcuts}</span>
                <kbd className="kbd">F1</kbd>
              </Command.Item>
              <Command.Item value={p.jobs} className="palette__item" onSelect={() => run(() => useUi.getState().setJobs(true))}>
                <span>{p.jobs}</span>
                <kbd className="kbd">{formatCombo("mod+j")}</kbd>
              </Command.Item>
              {(programs.data?.programs ?? [])
                .filter((pr) => pr.installations.length > 0)
                .map((pr) => (
                  <Command.Item key={pr.id} value={p.launch(pr.name)} className="palette__item" onSelect={() => run(() => void call("program_launch", { req: { programId: pr.id } }))}>
                    <span>{p.launch(pr.name)}</span>
                  </Command.Item>
                ))}
            </Command.Group>
            {(projects.data ?? []).length > 0 ? (
              <Command.Group heading={p.groups.recent}>
                {(projects.data ?? [])
                  .filter((pr) => pr.lastFile)
                  .slice(0, 6)
                  .map((pr) => (
                    <Command.Item key={pr.id} value={`${pr.name} ${pr.lastFile?.relPath ?? ""}`} className="palette__item" onSelect={() => run(() => void navigate(`/bibliothek?projekt=${encodeURIComponent(pr.id)}`))}>
                      <span className="t-trunc">{pr.lastFile?.relPath.split("/").pop()}</span>
                      <span className="t-mute t-meta">{pr.name}</span>
                    </Command.Item>
                  ))}
              </Command.Group>
            ) : null}
          </Command.List>
        </Command>
      ) : null}
    </dialog>
  );
}

/* ---------- Tastenkürzel-Hilfe ---------- */

export function HelpDialog() {
  const open = useUi((s) => s.helpOpen);
  const setOpen = useUi((s) => s.setHelp);
  const h = t.shell.help;
  const groups: { title: string; rows: { keys: string; text: string }[] }[] = [
    {
      title: h.groups.global,
      rows: [
        { keys: `${formatCombo("mod+1")} … ${formatCombo("mod+7")}`, text: h.keys.modules },
        { keys: formatCombo("mod+k"), text: h.keys.palette },
        { keys: formatCombo("mod+enter"), text: h.keys.main },
        { keys: formatCombo("mod+o"), text: h.keys.openFile },
        { keys: formatCombo("mod+n"), text: h.keys.newProject },
        { keys: formatCombo("mod+j"), text: h.keys.jobs },
        { keys: formatCombo("mod+,"), text: h.keys.settings },
        { keys: "F6", text: h.keys.regions },
        { keys: `${formatCombo("shift")}+F6`, text: h.keys.regionsBack },
        { keys: "F1  ?", text: h.keys.help },
        { keys: `${formatCombo("mod+=")}  ${formatCombo("mod+-")}  ${formatCombo("mod+0")}`, text: h.keys.zoom },
        { keys: "Esc", text: h.keys.esc },
      ],
    },
    {
      title: h.groups.preview,
      rows: [
        { keys: "0", text: h.keys.fit },
        { keys: "1", text: h.keys.full },
        { keys: "E", text: h.keys.actual },
        { keys: "U", text: h.keys.surround },
        { keys: "G", text: h.keys.grid },
        { keys: "S", text: h.keys.zones },
        { keys: "P", text: h.keys.marks },
        { keys: "M", text: h.keys.measureColor },
        { keys: h.keysLabel.pan, text: h.keys.pan },
      ],
    },
    {
      title: h.groups.library,
      rows: [
        { keys: formatCombo("space"), text: h.keys.quick },
        { keys: formatCombo("enter"), text: h.keys.openWith },
        { keys: "T", text: h.keys.tags },
      ],
    },
    { title: h.groups.mockup, rows: [{ keys: "K", text: h.keys.contact }] },
    { title: h.groups.onboarding, rows: [{ keys: formatCombo("enter"), text: h.keys.skip }] },
  ];
  return (
    <Dialog open={open} title={h.title} onClose={() => setOpen(false)} wide testId="help-dialog" footer={<Button onClick={() => setOpen(false)}>{t.common.close}</Button>}>
      <p className="t-read help__intro">{h.intro}</p>
      {groups.map((g) => (
        <section key={g.title} className="help__group">
          <h3 className="t-label">{g.title}</h3>
          <dl className="help__rows">
            {g.rows.map((r) => (
              <div key={r.text} className="help__row">
                <dt className="t-meta">{r.text}</dt>
                <dd>
                  <kbd className="kbd help__kbd">{r.keys}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Dialog>
  );
}

/* ---------- Beenden mit laufenden Aufträgen ---------- */

export function CloseDialog() {
  const pending = useCloseRequest((s) => s.pending);
  const set = useCloseRequest((s) => s.set);
  const c = t.shell.closing;
  return (
    <Dialog
      open={pending !== null}
      title={c.title}
      onClose={() => set(null)}
      testId="close-dialog"
      footer={
        <>
          <Button onClick={() => set(null)}>{c.keep}</Button>
          <Button
            variant="danger"
            onClick={() => {
              set(null);
              void call("app_close", { req: { force: true } });
            }}
          >
            {c.quit}
          </Button>
        </>
      }
    >
      <p className="t-read">{c.text(pending?.length ?? 0)}</p>
      <ul className="stack">
        {(pending ?? []).map((j) => (
          <li key={j.id} className="t-data">
            {t.jobs.kind[j.kind]} · {j.subject}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
