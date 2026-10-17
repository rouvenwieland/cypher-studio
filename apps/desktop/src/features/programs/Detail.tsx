import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ProgramOverview } from "@contract";
import { call } from "../../ipc/commands";
import { useCmd } from "../../ipc/queries";
import { toAppError } from "../../ipc/errors";
import { errorText } from "../../i18n/errors";
import { fmtBytes, fmtRelative, fmtDateTime } from "../../i18n/format";
import { t } from "../../i18n/de";
import { useJobs, useMainAction, useToasts } from "../../app/stores";
import { useEffect } from "react";
import { EmptyState, MessZeile, Notice } from "../../ui/Bits";
import { Button, IconButton } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { FitText } from "../../ui/FitText";
import { PlainPage } from "../../ui/Frames";
import { IconBack } from "../../ui/icons";
import { ActionMenu, Tabs, type MenuEntry } from "../../ui/Overlays";
import { useInstallUi } from "../install/store";
import { deriveProgramState } from "./state";
import { useRemovals } from "./removal";
import { roleOf, StatusCell } from "./parts";
import { useSetupTab } from "./setupTab";

const d = t.programs.detail;

function Overview({ p }: { p: ProgramOverview }) {
  const library = useCmd("library_query", { req: { limit: 60, sort: "modifiedDesc" as const } }, { retry: false });
  const files = (library.data?.entries ?? []).filter((e) => e.openWith === p.id).slice(0, 5);
  const setPreferred = (installationId: string) =>
    void call("program_set_preferred", { req: { programId: p.id, installationId } });
  return (
    <div className="stack stack--loose ov">
      <p className="t-read">{d.useCase[p.id] ?? p.description}</p>
      {p.updateAvailable && p.latest ? (
        <Notice
          kind="warn"
          title={d.updateRow(p.installations.find((i) => i.kind === "cypher")?.version ?? "—", p.latest.version)}
          role="status"
        />
      ) : null}
      <section>
        <h2 className="t-section ov__h">{d.installations}</h2>
        {p.installations.length === 0 ? (
          <p className="t-meta t-mute">{d.notInstalled}</p>
        ) : (
          <ul className="ilist">
            {p.installations.map((i) => (
              <li key={i.id} className="ilist__row" data-testid={`installation-${i.id}`}>
                <div className="ilist__main">
                  <span className="t-strong">
                    {d.kind[i.kind]} · <span className="t-data">{i.version ?? "—"}</span>
                  </span>
                  <span className="t-data selectable t-trunc" title={i.location}>
                    {i.location}
                  </span>
                  {i.problems.map((pr, idx) => (
                    <span key={idx} className="t-meta status status--warn">
                      {pr.kind === "staleCatalogVersion"
                        ? d.problems.staleCatalogVersion(pr.latest)
                        : pr.kind === "endOfSupportSoon"
                          ? d.problems.endOfSupportSoon(pr.until)
                          : pr.kind === "fuseMissing"
                            ? d.problems.fuseMissing
                            : pr.kind === "setupNotSupported"
                              ? d.problems.setupNotSupported
                              : d.problems[pr.kind]}
                    </span>
                  ))}
                </div>
                {i.id === p.preferredInstallationId ? (
                  <span className="t-label">{d.preferred}</span>
                ) : p.installations.length > 1 ? (
                  <Button small variant="text" onClick={() => setPreferred(i.id)}>
                    {d.makePreferred}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="t-section ov__h">{d.lastFiles}</h2>
        {files.length === 0 ? (
          <p className="t-meta t-mute">{d.noFiles}</p>
        ) : (
          <ul className="ilist">
            {files.map((f) => (
              <li key={f.id} className="ilist__row">
                <span className="t-meta t-trunc selectable">{f.fileName}</span>
                <span className="t-data t-mute">{fmtRelative(f.modifiedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function History({ p }: { p: ProgramOverview }) {
  const packId = p.setup?.packId ?? "";
  const scope = p.setup?.scopes[0];
  const history = useCmd("setup_history", { req: { packId, scopeId: scope?.scopeId ?? "" } }, { enabled: !!scope });
  const qc = useQueryClient();
  const push = useToasts((st) => st.push);
  const recs = history.data ?? [];
  return (
    <div className="stack stack--loose">
      <h2 className="t-section">{d.history.title}</h2>
      {recs.length === 0 ? (
        <p className="t-meta t-mute">{d.history.empty}</p>
      ) : (
        <ul className="ilist" data-testid="history-list">
          {recs.map((r) => (
            <li key={r.setupId} className="ilist__row">
              <div className="ilist__main">
                <span className="t-strong">
                  {r.status === "undone"
                    ? d.history.setupUndone
                    : r.status === "partial"
                      ? d.history.setupPartial
                      : d.history.setupApplied}
                </span>
                <span className="t-data t-mute">
                  {fmtDateTime(r.appliedAt)} · {r.packVersion} · {d.history.files(r.filesWritten)} ·{" "}
                  {d.history.backups(r.backupsTaken)}
                </span>
              </div>
              {r.undoAvailable ? (
                <Button
                  small
                  onClick={() =>
                    void call("setup_undo", { req: { setupId: r.setupId } })
                      .then(() => {
                        void qc.invalidateQueries();
                      })
                      .catch((e: unknown) => push({ kind: "error", text: errorText(toAppError(e)).title }))
                  }
                >
                  {d.history.restore}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="t-meta t-mute">{d.history.installs}</p>
    </div>
  );
}

export function ProgramDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const push = useToasts((st) => st.push);
  const openInstall = useInstallUi((st) => st.open);
  const jobs = useJobs((st) => st.active);
  const removals = useRemovals((st) => st.programIds);
  const query = useCmd("programs_list", undefined);
  const program = query.data?.programs.find((p) => p.id === id);
  const tab = params.get("tab") === "einrichtung" ? "setup" : params.get("tab") === "verlauf" ? "history" : "overview";
  const setup = useSetupTab(program, tab === "setup");
  const [removing, setRemoving] = useState(false);
  const state = program ? deriveProgramState(program, jobs, removals) : null;
  const inst = state?.installation ?? null;

  const launch = () => {
    if (!program || state?.status === "removing") return;
    if (state?.action === "install" || state?.action === "update") {
      openInstall({
        programId: program.id,
        ...(state.action === "update" && program.latest ? { version: program.latest.version } : {}),
      });
      return;
    }
    void call("program_launch", { req: { programId: program.id, ...(inst ? { installationId: inst.id } : {}) } })
      .then(() => push({ kind: "info", text: t.programs.launchedToast(program.name) }))
      .catch((e: unknown) => push({ kind: "error", text: errorText(toAppError(e)).text }));
  };

  // Strg+Enter: Hauptaktion (auf dem Einrichtungs-Tab die Ausgangs-Aktion der Leiste)
  useEffect(() => {
    if (tab === "setup" && setup.output) return;
    const set = useMainAction.getState().set;
    set(launch);
    return () => set(null);
  });

  if (query.isPending) {
    return (
      <PlainPage title={t.programs.title} testId="screen-program-detail">
        {null}
      </PlainPage>
    );
  }
  if (!program || !state) {
    return (
      <PlainPage title={t.programs.title} testId="screen-program-detail">
        <EmptyState actions={<Button onClick={() => void navigate("/programme")}>{d.back}</Button>}>
          {t.programs.detail.notFound}
        </EmptyState>
      </PlainPage>
    );
  }

  const unpacked = program.latest?.downloadSize ?? 0;
  const menu: MenuEntry[] = [
    ...(inst
      ? [
          {
            id: "reveal",
            label: d.menuReveal,
            onSelect: () =>
              void call("app_reveal", { req: { target: { kind: "installation" as const, installationId: inst.id } } }),
          },
        ]
      : []),
    {
      id: "home",
      label: d.menuHomepage,
      onSelect: () =>
        void call("app_open_external", {
          req: { target: { kind: "programPage", programId: program.id, page: "homepage" } },
        }),
    },
    {
      id: "notes",
      label: d.menuReleaseNotes,
      onSelect: () =>
        void call("app_open_external", {
          req: { target: { kind: "programPage", programId: program.id, page: "releaseNotes" } },
        }),
    },
    {
      id: "license",
      label: d.menuLicense,
      onSelect: () =>
        void call("app_open_external", {
          req: { target: { kind: "programPage", programId: program.id, page: "license" } },
        }),
    },
    ...(inst
      ? [
          {
            id: "remove",
            label: inst.managedByCypher ? d.menuRemove : d.menuForget,
            separatorBefore: true,
            onSelect: () => setRemoving(true),
          },
        ]
      : []),
  ];
  const actionText =
    state.action === "install"
      ? t.programs.actions.install
      : state.action === "update"
        ? t.programs.actions.update
        : state.action === "cancel"
          ? t.programs.actions.cancel
          : t.programs.actions.launch;
  const measure = [
    {
      label: t.common.labels.version,
      value: state.versionLabel === "—" ? (program.latest?.version ?? "—") : state.versionLabel,
    },
    { label: t.common.labels.size, value: unpacked ? fmtBytes(unpacked) : "—" },
    { label: t.common.labels.license, value: program.license.spdx },
    {
      label: t.common.labels.checksum,
      value: inst?.verified ? t.programs.status.checksumOk : "—",
    },
    ...(inst
      ? [
          {
            label: t.common.labels.target,
            newLine: true,
            value: <span title={inst.location}>{inst.location.replace(/\\[^\\]+$/, "")}</span>,
          },
        ]
      : []),
  ];

  return (
    <PlainPage
      title={t.programs.title}
      context={`/ ${program.name}`}
      testId="screen-program-detail"
      output={tab === "setup" ? setup.output : undefined}
      tools={
        <>
          <Button
            variant="action"
            combo="mod+enter"
            onClick={launch}
            disabled={state.status === "removing"}
            data-testid="detail-action"
          >
            {actionText}
          </Button>
          <ActionMenu entries={menu} />
        </>
      }
    >
      <div className="detail">
        <div className="detail__back">
          <IconButton
            icon={IconBack}
            label={d.back}
            bare
            onClick={() => void navigate("/programme")}
            combo="alt+left"
          />
        </div>
        <div className="detail__kennung">
          <FitText text={program.name.toUpperCase()} size={120} minSize={40} maxSize={150} label={program.name} snap />
        </div>
        <div className="detail__role cluster">
          <span className="t-label">{roleOf(program)}</span>
          <StatusCell row={{ program, state }} />
        </div>
        <MessZeile items={measure} label={program.name} />
        <Tabs
          label={d.tabsLabel}
          value={tab}
          onChange={(v) =>
            setParams(v === "overview" ? {} : { tab: v === "setup" ? "einrichtung" : "verlauf" }, { replace: true })
          }
          tabs={[
            { id: "overview", label: d.tabs.overview, content: <Overview p={program} /> },
            { id: "setup", label: d.tabs.setup, content: setup.body },
            { id: "history", label: d.tabs.history, content: <History p={program} /> },
          ]}
        />
      </div>
      <Dialog
        open={removing}
        title={inst ? d.menuRemove.replace(" …", "") : ""}
        onClose={() => setRemoving(false)}
        footer={
          <>
            <Button onClick={() => setRemoving(false)}>{t.common.cancel}</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!inst) return;
                // Der Dialog schließt sofort; die Zeile zeigt „wird deinstalliert …“, bis die Liste neu geladen ist
                const programId = program.id;
                useRemovals.getState().begin(programId);
                setRemoving(false);
                void call("installation_remove", {
                  req: { installationId: inst.id, mode: inst.managedByCypher ? "deleteFiles" : "forget" },
                })
                  .then(() => {
                    push({ kind: "info", text: t.programs.remove.done(program.name) });
                  })
                  .catch((e: unknown) => push({ kind: "error", text: errorText(toAppError(e)).text }))
                  .finally(() => {
                    void qc
                      .invalidateQueries({ queryKey: ["programs_list"] })
                      .finally(() => useRemovals.getState().end(programId));
                  });
              }}
              data-testid="remove-confirm"
            >
              {t.programs.remove.confirm}
            </Button>
          </>
        }
      >
        {inst ? (
          <p className="t-read">
            {t.programs.remove.text(
              inst.location,
              fmtBytes(program.latest?.downloadSize ? program.latest.downloadSize * 3 : 0),
              program.name,
            )}
          </p>
        ) : null}
      </Dialog>
    </PlainPage>
  );
}
