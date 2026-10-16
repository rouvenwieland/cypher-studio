import { useCallback, useEffect, useState, type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { SOCIAL_GUIDES, type ScanEvent, type Settings, type SettingsPatch, type UpdateEvent } from "@contract";
import { call } from "../../ipc/commands";
import { channel } from "../../ipc/channel";
import { useCmd } from "../../ipc/queries";
import { toAppError } from "../../ipc/errors";
import { errorText } from "../../i18n/errors";
import { fmtBytes, fmtDate, fmtDateTime, fmtRelative } from "../../i18n/format";
import { t } from "../../i18n/de";
import { useJobs, useToasts, useUi, useUpdate } from "../../app/stores";
import { useSettings } from "../../app/theme";
import { Bar, Facts, Notice } from "../../ui/Bits";
import { Button, IconButton } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { PlainPage } from "../../ui/Frames";
import { Checkbox, Field, Segmented, SelectField, Slider } from "../../ui/Inputs";
import { IconMinus, IconPlus } from "../../ui/icons";
import { useInstallUi } from "../install/store";
import { useChooseRoot } from "../library/ChooseRoot";
import "./settings.css";

const s = t.settings;
type SectionKey = keyof typeof s.sections;
const ORDER: SectionKey[] = [
  "darstellung",
  "arbeitsflaeche",
  "programme",
  "bibliothek",
  "profile",
  "updates",
  "netzwerk",
  "kuerzel",
  "ueber",
];

/** Einstellung ändern: sofort im Zwischenspeicher, dann über den Command speichern (Rust prüft und liefert die gültige Fassung). */
function useUpdateSettings() {
  const qc = useQueryClient();
  const push = useToasts((st) => st.push);
  return useCallback(
    (patch: SettingsPatch) => {
      qc.setQueryData<Settings>(["settings_get"], (old) => (old ? mergeSettings(old, patch) : old));
      void call("settings_update", { req: patch })
        .then((next) => qc.setQueryData(["settings_get"], next))
        .catch((e: unknown) => {
          push({ kind: "error", text: errorText(toAppError(e)).text });
          void qc.invalidateQueries({ queryKey: ["settings_get"] });
        });
    },
    [qc, push],
  );
}

function mergeSettings(old: Settings, p: SettingsPatch): Settings {
  return {
    ...old,
    updates: { ...old.updates, ...(p.updates?.frequency ? { frequency: p.updates.frequency } : {}) },
    catalog: {
      ...old.catalog,
      ...(p.catalog?.autoRefresh !== undefined ? { autoRefresh: p.catalog.autoRefresh } : {}),
    },
    downloads: {
      ...old.downloads,
      ...(p.downloads?.keepCache !== undefined ? { keepCache: p.downloads.keepCache } : {}),
      ...(p.downloads?.maxParallel !== undefined ? { maxParallel: p.downloads.maxParallel } : {}),
    },
    linux: {
      ...old.linux,
      ...(p.linux?.appImageMode ? { appImageMode: p.linux.appImageMode } : {}),
      ...(p.linux?.graphicsCompat !== undefined ? { graphicsCompat: p.linux.graphicsCompat } : {}),
    },
    profile: {
      ...old.profile,
      ...(p.profile?.displayName !== undefined ? { displayName: p.profile.displayName } : {}),
    },
    ui: { ...old.ui, ...p.ui },
  };
}

function Row({ label, children, help }: { label: string; children: ReactNode; help?: ReactNode }) {
  return (
    <div className="srow">
      <Field label={label}>
        {children}
        {help ? <p className="t-meta t-mute">{help}</p> : null}
      </Field>
    </div>
  );
}

function Appearance({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const a = s.appearance;
  const ui = settings.ui;
  return (
    <div className="stack stack--loose">
      <Row label={a.theme} help={a.themeHelp}>
        <Segmented
          label={a.theme}
          value={ui.theme}
          onChange={(theme) => update({ ui: { theme } })}
          options={(["system", "paper", "ink"] as const).map((v) => ({ value: v, label: a.themeOptions[v] }))}
        />
      </Row>
      <Row label={a.density} help={a.densityHelp}>
        <Segmented
          label={a.density}
          value={ui.density}
          onChange={(density) => update({ ui: { density } })}
          options={(["compact", "normal", "large"] as const).map((v) => ({ value: v, label: a.densityOptions[v] }))}
        />
      </Row>
      <Row label={a.motion} help={a.motionHelp}>
        <Segmented
          label={a.motion}
          value={ui.motion}
          onChange={(motion) => update({ ui: { motion } })}
          options={(["system", "reduced", "full"] as const).map((v) => ({ value: v, label: a.motionOptions[v] }))}
        />
      </Row>
      <Row label={a.zoom} help={a.zoomHelp}>
        <div className="zoomrow">
          <IconButton
            icon={IconMinus}
            label={a.zoomOut}
            onClick={() => update({ ui: { zoomPercent: Math.max(50, ui.zoomPercent - 10) } })}
          />
          <div className="zoomrow__slider">
            <Slider
              value={ui.zoomPercent}
              min={50}
              max={200}
              step={10}
              onChange={(v) => update({ ui: { zoomPercent: v } })}
              label={a.zoom}
              valueText={a.zoomValue(ui.zoomPercent)}
            />
          </div>
          <IconButton
            icon={IconPlus}
            label={a.zoomIn}
            onClick={() => update({ ui: { zoomPercent: Math.min(200, ui.zoomPercent + 10) } })}
          />
          <span className="t-data zoomrow__val" data-testid="zoom-value">
            {a.zoomValue(ui.zoomPercent)}
          </span>
          <Button small onClick={() => update({ ui: { zoomPercent: 100 } })}>
            {a.zoomReset}
          </Button>
        </div>
      </Row>
    </div>
  );
}

function Workspace({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const w = s.workspace;
  const ui = settings.ui;
  const [px, setPx] = useState(() => (ui.calibrationPxPerMm ? ui.calibrationPxPerMm * 100 : (96 / 25.4) * 100));
  const surroundOptions = (["light", "mid", "dark"] as const).map((v) => ({ value: v, label: w.surroundOptions[v] }));
  return (
    <div className="stack stack--loose">
      <Row label={w.surround} help={w.surroundHelp}>
        <div className="stack">
          <span className="t-meta">{w.surroundPaper}</span>
          <Segmented
            label={w.surroundPaper}
            value={ui.surround.paper}
            onChange={(paper) => update({ ui: { surround: { ...ui.surround, paper } } })}
            options={surroundOptions}
          />
          <span className="t-meta">{w.surroundInk}</span>
          <Segmented
            label={w.surroundInk}
            value={ui.surround.ink}
            onChange={(ink) => update({ ui: { surround: { ...ui.surround, ink } } })}
            options={surroundOptions}
          />
        </div>
      </Row>
      <Row label={w.measureColor} help={w.measureHelp}>
        <Segmented
          label={w.measureColor}
          value={ui.measureColor}
          onChange={(measureColor) => update({ ui: { measureColor } })}
          options={(["cyan", "magenta", "ink", "paper"] as const).map((v) => ({
            value: v,
            label: w.measureOptions[v],
          }))}
        />
      </Row>
      <Row label={w.calibrate} help={w.calibrateHelp}>
        <div className="stack">
          <div
            className="calib"
            style={{ width: px }}
            role="img"
            aria-label={w.calibrateValue(px)}
            data-testid="calib-bar"
          >
            <span className="calib__label t-data">{t.common.hundredMm}</span>
          </div>
          <Slider
            value={Math.round(px)}
            min={200}
            max={600}
            step={1}
            onChange={setPx}
            label={w.calibrateSlider}
            valueText={w.calibrateValue(px)}
          />
          <p className="t-data">{w.calibrateValue(px)}</p>
          <div className="cluster">
            <Button onClick={() => update({ ui: { calibrationPxPerMm: px / 100 } })} data-testid="calib-save">
              {w.calibrateSave}
            </Button>
            <Button
              variant="text"
              onClick={() => {
                setPx((96 / 25.4) * 100);
                update({ ui: { calibrationPxPerMm: null } });
              }}
            >
              {w.calibrateReset}
            </Button>
          </div>
          <p className="t-meta t-mute">
            {ui.calibrationPxPerMm ? w.calibrated(ui.calibrationPxPerMm) : w.notCalibrated}
          </p>
        </div>
      </Row>
    </div>
  );
}

function ProgramsSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const push = useToasts((st) => st.push);
  const catalog = useCmd("catalog_status", undefined);
  const info = useCmd("app_info", undefined, { staleTime: 60_000 });
  const p = s.programs;
  const [busy, setBusy] = useState<"refresh" | "rescan" | null>(null);
  const c = catalog.data;
  return (
    <div className="stack stack--loose">
      <Row label={p.dir} help={p.dirHelp}>
        <div className="cluster">
          <span className="t-data selectable">{settings.programsDir}</span>
          <Button
            onClick={() =>
              void call("settings_choose_dir", { req: { which: "programsDir" } }).then(() =>
                qc.invalidateQueries({ queryKey: ["settings_get"] }),
              )
            }
          >
            {p.change}
          </Button>
        </div>
      </Row>
      <Row label={p.manifest}>
        {c ? (
          <Facts
            rows={[
              { label: p.manifestRows.source, value: <span className="t-data selectable">{c.sourceUrl ?? "—"}</span> },
              { label: p.manifestRows.sequence, value: <span className="t-data">{c.sequence}</span> },
              { label: p.manifestRows.origin, value: p.origin[c.source] },
              {
                label: p.manifestRows.checked,
                value: <span className="t-data">{c.lastCheckAt ? fmtDateTime(c.lastCheckAt) : "—"}</span>,
              },
              { label: p.manifestRows.expires, value: <span className="t-data">{fmtDate(c.expiresAt)}</span> },
            ]}
          />
        ) : null}
        {c?.lastError ? (
          <Notice kind="warn" title={errorText(c.lastError).title}>
            {errorText(c.lastError).text}
          </Notice>
        ) : null}
        <div className="cluster">
          <Button
            disabled={busy !== null}
            onClick={() => {
              setBusy("refresh");
              void call("catalog_refresh")
                .then(() => push({ kind: "info", text: p.refreshed }))
                .catch((e: unknown) => push({ kind: "error", text: errorText(toAppError(e)).text }))
                .finally(() => {
                  setBusy(null);
                  void qc.invalidateQueries({ queryKey: ["catalog_status"] });
                });
            }}
          >
            {p.refresh}
          </Button>
          <Button
            disabled={busy !== null}
            onClick={() => {
              setBusy("rescan");
              void call("programs_rescan")
                .then(() => push({ kind: "info", text: p.rescanned }))
                .finally(() => setBusy(null));
            }}
          >
            {busy === "rescan" ? p.rescanBusy : p.rescan}
          </Button>
        </div>
      </Row>
      <Row label={p.parallel}>
        <Segmented
          label={p.parallel}
          value={String(settings.downloads.maxParallel)}
          onChange={(v) => update({ downloads: { maxParallel: Number(v) as 1 | 2 | 3 } })}
          options={["1", "2", "3"].map((v) => ({ value: v, label: v }))}
        />
      </Row>
      <Checkbox
        checked={settings.downloads.keepCache}
        onChange={(keepCache) => update({ downloads: { keepCache } })}
        describedBy="keepcache-help"
      >
        {p.keepCache}
      </Checkbox>
      <p className="t-meta t-mute" id="keepcache-help">
        {p.keepCacheHelp}
      </p>
      {info.data?.os === "linux" ? (
        <div className="stack">
          <h3 className="t-section">{p.linux}</h3>
          <SelectField
            label={p.appImageMode}
            value={settings.linux.appImageMode}
            onChange={(v) => update({ linux: { appImageMode: v as Settings["linux"]["appImageMode"] } })}
            options={(["auto", "extract", "direct"] as const).map((v) => ({ value: v, label: p.appImageOptions[v] }))}
          />
          <Checkbox
            checked={settings.linux.graphicsCompat}
            onChange={(graphicsCompat) => update({ linux: { graphicsCompat } })}
          >
            {p.graphicsCompat}
          </Checkbox>
        </div>
      ) : null}
    </div>
  );
}

function LibrarySection({ settings }: { settings: Settings }) {
  const l = s.library;
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const push = useToasts((st) => st.push);
  const choose = useChooseRoot();
  const [name, setName] = useState(settings.profile.displayName);
  const [scanning, setScanning] = useState(false);
  return (
    <div className="stack stack--loose">
      <Row label={l.folder} help={l.sync}>
        <div className="cluster">
          <span className="t-data selectable">{settings.libraryRoot ?? l.none}</span>
          <Button onClick={choose.start}>{settings.libraryRoot ? l.change : l.choose}</Button>
        </div>
      </Row>
      <Row label={l.projectsDir}>
        <div className="cluster">
          <span className="t-data selectable">{settings.projectsDir}</span>
          <Button
            onClick={() =>
              void call("settings_choose_dir", { req: { which: "projectsDir" } }).then(() =>
                qc.invalidateQueries({ queryKey: ["settings_get"] }),
              )
            }
          >
            {s.programs.change}
          </Button>
        </div>
      </Row>
      <Row label={l.thumbs} help={l.thumbsHelp}>
        <div className="cluster">
          <Button
            disabled={scanning || !settings.libraryRoot}
            onClick={() => {
              setScanning(true);
              void call("library_scan", { onEvent: channel<ScanEvent>(() => undefined) }).finally(() =>
                setScanning(false),
              );
            }}
          >
            {scanning ? l.rebuilding : l.rebuild}
          </Button>
          <Button
            onClick={() => void call("library_thumbnails_clear").then(() => push({ kind: "info", text: l.cleared }))}
          >
            {l.clear}
          </Button>
        </div>
      </Row>
      <Row label={l.displayName} help={l.displayNameHelp}>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => update({ profile: { displayName: name } })}
          aria-label={l.displayName}
          maxLength={60}
        />
      </Row>
      <p className="t-meta t-mute">{l.packsHelp}</p>
      {choose.dialog}
    </div>
  );
}

function ProfilesSection() {
  const p = s.profiles;
  const profiles = useCmd("print_profiles_list", undefined, { staleTime: 60_000 });
  const g = SOCIAL_GUIDES;
  return (
    <div className="stack stack--loose">
      <p className="t-read">{p.help}</p>
      <section>
        <h3 className="t-section">{p.print}</h3>
        <table className="stable stable--plain" data-testid="profiles-table">
          <caption className="sr-only">{p.print}</caption>
          <thead>
            <tr>
              <th scope="col" className="t-label">
                {p.columns.profile}
              </th>
              <th scope="col" className="t-label">
                {p.columns.area}
              </th>
              <th scope="col" className="t-label">
                {p.columns.safe}
              </th>
              <th scope="col" className="t-label">
                {p.columns.dpi}
              </th>
              <th scope="col" className="t-label">
                {p.columns.checked}
              </th>
            </tr>
          </thead>
          <tbody>
            {(profiles.data ?? []).map((x) => (
              <tr key={x.id}>
                <td>
                  <span className="t-strong">{x.title}</span>
                  {x.assumption ? <span className="t-label"> · {p.assumption}</span> : null}
                </td>
                <td className="t-data">{`${x.printAreaMm.width} × ${x.printAreaMm.height} mm`}</td>
                <td className="t-data">{x.safeAreaMm ? `${x.safeAreaMm.width} × ${x.safeAreaMm.height} mm` : "—"}</td>
                <td className="t-data">{`${x.targetDpi} dpi`}</td>
                <td className="t-data">{x.source.checkedAt ? fmtDate(x.source.checkedAt) : p.checkedAt(null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h3 className="t-section">{p.social}</h3>
        <table className="stable stable--plain">
          <caption className="sr-only">{p.social}</caption>
          <tbody>
            {(
              [
                [
                  p.socialRows.conservative,
                  `${p.socialValue.top} ${g.verticalConservative.top} · ${p.socialValue.bottom} ${g.verticalConservative.bottom} · ${p.socialValue.left}/${p.socialValue.right} ${g.verticalConservative.left} px`,
                ],
                [
                  p.socialRows.instagram,
                  `${p.socialValue.top} ${g.instagramVertical.top} · ${p.socialValue.bottom} ${g.instagramVertical.bottom} · ${p.socialValue.left}/${p.socialValue.right} ${g.instagramVertical.left} px`,
                ],
                [
                  p.socialRows.coverGrid,
                  `${g.reelCoverGridBox.width} × ${g.reelCoverGridBox.height} px, ab y ${g.reelCoverGridBox.y}`,
                ],
                [p.socialRows.postKeep, `x ${g.postGridKeepX.from}–${g.postGridKeepX.to} px`],
              ] as const
            ).map(([label, value]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="t-data">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="t-meta t-mute">{p.socialNote}</p>
      </section>
      <div>
        <Button onClick={() => void call("app_reveal", { req: { target: { kind: "printProfiles" } } })}>
          {p.openFolder}
        </Button>
      </div>
    </div>
  );
}

function UpdatesSection({ settings }: { settings: Settings }) {
  const u = s.updates;
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const programs = useCmd("programs_list", undefined);
  const jobs = useJobs((st) => st.active);
  const available = useUpdate((st) => st.available);
  const setAvailable = useUpdate((st) => st.set);
  const openInstall = useInstallUi((st) => st.open);
  const [checking, setChecking] = useState(false);
  const [offline, setOffline] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState<"signature" | "replace" | null>(null);
  const info = useCmd("app_info", undefined, { staleTime: 60_000 });
  const version = info.data?.appVersion ?? "0.4.0";

  const check = useCallback(() => {
    setChecking(true);
    setOffline(false);
    call("app_update_check")
      .then((r) => {
        setAvailable(r.available ? r : null);
        void qc.invalidateQueries({ queryKey: ["settings_get"] });
        void qc.invalidateQueries({ queryKey: ["app_update_check"] });
      })
      .catch(() => setOffline(true))
      .finally(() => setChecking(false));
  }, [qc, setAvailable]);

  useEffect(() => {
    if (params.get("check") === "1") {
      setParams({}, { replace: true });
      check();
    }
  }, [params, setParams, check]);

  const install = () => {
    setProgress(0);
    setFailed(null);
    call("app_update_install", {
      onEvent: channel<UpdateEvent>((e) => {
        if (e.type === "progress") setProgress(e.contentLength ? e.downloadedBytes / e.contentLength : null);
      }),
    })
      .catch((e: unknown) => {
        const err = toAppError(e);
        if (err.kind === "signatureInvalid") setFailed("signature");
        else setFailed("replace");
      })
      .finally(() => setProgress((p) => (p === 1 ? p : null)));
  };

  const pending = (programs.data?.programs ?? []).filter((p) => p.updateAvailable && p.latest);
  const last = settings.updates.lastCheckAt;
  return (
    <div className="stack stack--loose">
      <div className="stack">
        <p className="t-section" data-testid="app-version-line">
          {available?.available && available.version
            ? u.available(available.version)
            : last
              ? u.current(version, fmtRelative(last))
              : `Cypher Studio ${version} · ${u.never}`}
        </p>
        <div className="cluster">
          <Button onClick={check} disabled={checking} data-testid="update-check">
            {checking ? u.checking : u.check}
          </Button>
          {last ? <span className="t-data t-mute">{u.lastCheck(fmtRelative(last))}</span> : null}
        </div>
        {offline ? <Notice kind="warn" title={u.offline} /> : null}
      </div>
      {available?.available ? (
        <div className="stack" data-testid="update-available">
          <h3 className="t-section">{u.notes}</h3>
          <pre className="notes t-meta selectable">{available.notes ?? ""}</pre>
          {progress !== null ? (
            <Bar value={progress} label={u.installing} valueText={`${Math.round(progress * 100)} %`} />
          ) : null}
          {jobs.length > 0 ? <p className="t-meta">{u.restartWhenDone(jobs.length)}</p> : null}
          <div className="cluster">
            <Button variant="action" onClick={install} disabled={progress !== null} data-testid="update-install">
              {jobs.length > 0 ? u.restartLater : u.install}
            </Button>
          </div>
        </div>
      ) : null}
      {failed === "signature" ? (
        <Notice kind="error" title={u.signatureInvalid} testId="update-signature-error" />
      ) : null}
      {failed === "replace" ? (
        <Notice
          kind="warn"
          title={u.cannotReplace}
          actions={
            <Button
              onClick={() =>
                void call("app_open_external", { req: { target: { kind: "appPage", page: "downloads" } } })
              }
            >
              {u.website}
            </Button>
          }
        />
      ) : null}
      <Row label={u.frequency} help={u.signed}>
        <Segmented
          label={u.frequency}
          value={settings.updates.frequency}
          onChange={(frequency) => update({ updates: { frequency } })}
          options={(["daily", "weekly", "never"] as const).map((v) => ({ value: v, label: u.frequencyOptions[v] }))}
        />
      </Row>
      <section className="stack">
        <h3 className="t-section">{u.programsTitle}</h3>
        {pending.length === 0 ? (
          <p className="t-meta t-mute">{u.programsNone}</p>
        ) : (
          <>
            <ul className="ilist">
              {pending.map((p) => (
                <li key={p.id} className="ilist__row">
                  <span className="t-data">
                    {u.programLine(
                      p.name,
                      p.installations.find((i) => i.kind === "cypher")?.version ?? "—",
                      p.latest?.version ?? "—",
                    )}
                  </span>
                  <Button
                    small
                    onClick={() => openInstall({ programId: p.id, ...(p.latest ? { version: p.latest.version } : {}) })}
                  >
                    {t.programs.actions.update}
                  </Button>
                </li>
              ))}
            </ul>
            <div>
              <Button
                onClick={() =>
                  useInstallUi
                    .getState()
                    .openQueue(
                      pending.map((p) => ({ programId: p.id, ...(p.latest ? { version: p.latest.version } : {}) })),
                    )
                }
                data-testid="update-all"
              >
                {u.programsAll}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function NetworkSection({ settings }: { settings: Settings }) {
  const n = s.network;
  const update = useUpdateSettings();
  const info = useCmd("network_info", undefined);
  return (
    <div className="stack stack--loose">
      <p className="t-read">{n.intro}</p>
      <section>
        <h3 className="t-section">{n.title}</h3>
        <table className="stable stable--plain" data-testid="network-table">
          <caption className="sr-only">{n.title}</caption>
          <thead>
            <tr>
              <th scope="col" className="t-label">
                {n.columns.purpose}
              </th>
              <th scope="col" className="t-label">
                {n.columns.host}
              </th>
              <th scope="col" className="t-label">
                {n.columns.when}
              </th>
              <th scope="col" className="t-label">
                {n.columns.on}
              </th>
            </tr>
          </thead>
          <tbody>
            {(info.data?.endpoints ?? []).map((e, i) => (
              <tr key={`${e.host}-${i}`}>
                <td>{n.purpose[e.purpose]}</td>
                <td>
                  <span className="t-data selectable">{e.host}</span>
                  <span className="facts__sub t-data selectable">{e.urlPattern}</span>
                </td>
                <td>{n.when[e.when]}</td>
                <td>{e.enabled ? t.common.yes : t.common.no}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <Checkbox checked={settings.catalog.autoRefresh} onChange={(autoRefresh) => update({ catalog: { autoRefresh } })}>
        {n.autoRefresh}
      </Checkbox>
      <p className="t-meta">
        {n.telemetry}: <strong>{n.telemetryOff}</strong>
      </p>
      <section>
        <h3 className="t-section">{n.recent}</h3>
        {(info.data?.recent ?? []).length === 0 ? (
          <p className="t-meta t-mute">{n.recentNone}</p>
        ) : (
          <table className="stable stable--plain">
            <caption className="sr-only">{n.recent}</caption>
            <thead>
              <tr>
                <th scope="col" className="t-label">
                  {n.recentColumns.at}
                </th>
                <th scope="col" className="t-label">
                  {n.recentColumns.host}
                </th>
                <th scope="col" className="t-label">
                  {n.recentColumns.purpose}
                </th>
                <th scope="col" className="t-label">
                  {n.recentColumns.status}
                </th>
                <th scope="col" className="t-label">
                  {n.recentColumns.bytes}
                </th>
              </tr>
            </thead>
            <tbody>
              {(info.data?.recent ?? []).slice(0, 12).map((r, i) => (
                <tr key={`${r.at}-${i}`}>
                  <td className="t-data">{fmtDateTime(r.at)}</td>
                  <td className="t-data">{r.host}</td>
                  <td>{n.purpose[r.purpose]}</td>
                  <td className="t-data">{r.status ?? n.noNetwork}</td>
                  <td className="t-data">{fmtBytes(r.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ShortcutsSection({ settings }: { settings: Settings }) {
  const k = s.shortcuts;
  const update = useUpdateSettings();
  return (
    <div className="stack stack--loose">
      <p className="t-read">{k.intro}</p>
      <Checkbox
        checked={settings.ui.singleKeyShortcuts}
        onChange={(v) => update({ ui: { singleKeyShortcuts: v } })}
        describedBy="singlekeys-help"
      >
        {k.singleKeys}
      </Checkbox>
      <p className="t-meta t-mute" id="singlekeys-help">
        {k.singleKeysHelp}
      </p>
      <div>
        <Button onClick={() => useUi.getState().setHelp(true)} data-testid="open-help-button">
          {k.openHelp}
        </Button>
      </div>
    </div>
  );
}

function AboutSection() {
  const a = s.about;
  const info = useCmd("app_info", undefined);
  const push = useToasts((st) => st.push);
  const [license, setLicense] = useState<{ name: string; text: string } | null>(null);
  const [brands, setBrands] = useState(false);
  const showLicense = (name: string, file: string) => {
    void fetch(`/fonts/${file}`)
      .then((r) => r.text())
      .then((text) => setLicense({ name, text }))
      .catch(() => setLicense({ name, text: a.fontsLicense }));
  };
  const d = info.data;
  return (
    <div className="stack stack--loose">
      {d ? (
        <Facts
          rows={[
            { label: a.version, value: <span className="t-data">{`${d.appVersion} (${d.buildChannel})`}</span> },
            { label: a.system, value: <span className="t-data">{`${d.osVersion} · ${d.os} ${d.arch}`}</span> },
            { label: a.dataDir, value: <span className="t-data selectable">{d.dataDir}</span> },
            { label: a.logsDir, value: <span className="t-data selectable">{d.logsDir}</span> },
          ]}
        />
      ) : null}
      <div className="cluster">
        <Button onClick={() => void call("app_reveal", { req: { target: { kind: "logs" } } })}>{a.showFolder}</Button>
        <Button
          onClick={() =>
            void call("diagnostics_export").then((h) => {
              if (h) push({ kind: "info", text: a.diagnoseDone(h.name) });
            })
          }
        >
          {a.diagnose}
        </Button>
      </div>
      <p className="t-meta t-mute">{a.diagnoseHelp}</p>
      <section className="stack">
        <h3 className="t-section">{a.licensesTitle}</h3>
        <ul className="ilist">
          {a.licenses.map(([name, lic]) => (
            <li key={name} className="ilist__row">
              <span className="t-meta">{name}</span>
              <span className="t-data">{lic}</span>
            </li>
          ))}
        </ul>
        <h3 className="t-section">{a.fonts}</h3>
        <ul className="ilist">
          {a.fontsList.map(([name, file]) => (
            <li key={name} className="ilist__row">
              <span className="t-meta">{name}</span>
              <span className="cluster">
                <span className="t-data">{a.fontsLicense}</span>
                <Button variant="text" small onClick={() => showLicense(name, file)}>
                  {a.showLicense}
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <div className="cluster">
          <Button
            onClick={() => void call("app_open_external", { req: { target: { kind: "appPage", page: "sourceCode" } } })}
          >
            {a.sourceCode}
          </Button>
          <Button
            onClick={() => void call("app_open_external", { req: { target: { kind: "appPage", page: "thirdParty" } } })}
          >
            {a.thirdParty}
          </Button>
          <Button onClick={() => setBrands(true)}>{a.brands}</Button>
        </div>
      </section>
      <Dialog
        open={license !== null}
        title={license?.name ?? ""}
        onClose={() => setLicense(null)}
        wide
        footer={<Button onClick={() => setLicense(null)}>{t.common.close}</Button>}
      >
        <pre className="notes t-data selectable">{license?.text}</pre>
      </Dialog>
      <Dialog
        open={brands}
        title={t.programs.trademarkTitle}
        onClose={() => setBrands(false)}
        footer={<Button onClick={() => setBrands(false)}>{t.common.close}</Button>}
      >
        <p className="t-read">{t.programs.trademarkText}</p>
      </Dialog>
    </div>
  );
}

function Content() {
  const settings = useSettings();
  const navigate = useNavigate();
  if (settings.isPending)
    return (
      <p className="t-meta t-mute" role="status">
        {t.common.loading}
      </p>
    );
  if (!settings.data) return null;
  const st = settings.data;
  void navigate;
  return (
    <Routes>
      <Route index element={<Navigate to="darstellung" replace />} />
      <Route path="darstellung" element={<Appearance settings={st} />} />
      <Route path="arbeitsflaeche" element={<Workspace settings={st} />} />
      <Route path="programme" element={<ProgramsSection settings={st} />} />
      <Route path="bibliothek" element={<LibrarySection settings={st} />} />
      <Route path="profile" element={<ProfilesSection />} />
      <Route path="updates" element={<UpdatesSection settings={st} />} />
      <Route path="netzwerk" element={<NetworkSection settings={st} />} />
      <Route path="kuerzel" element={<ShortcutsSection settings={st} />} />
      <Route path="ueber" element={<AboutSection />} />
      <Route path="*" element={<Navigate to="darstellung" replace />} />
    </Routes>
  );
}

export default function SettingsPage() {
  return (
    <PlainPage title={s.title} testId="screen-settings" flush>
      <div className="settings">
        <nav className="settings__nav" aria-label={s.navLabel}>
          <ul>
            {ORDER.map((key) => (
              <li key={key}>
                <NavLink
                  to={`/einstellungen/${key}`}
                  className={({ isActive }) => (isActive ? "snav snav--on" : "snav")}
                  data-testid={`settings-nav-${key}`}
                >
                  {s.sections[key]}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <section className="settings__content" aria-label={s.title}>
          <Content />
        </section>
      </div>
    </PlainPage>
  );
}
