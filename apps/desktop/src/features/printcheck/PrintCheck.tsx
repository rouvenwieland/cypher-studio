import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AppError,
  FileHandleInfo,
  Finding,
  PrintExportEvent,
  PrintExportOptions,
  PrintExportResult,
} from "@contract";
import { call } from "../../ipc/commands";
import { channel } from "../../ipc/channel";
import { useCmd } from "../../ipc/queries";
import { toAppError } from "../../ipc/errors";
import { errorText } from "../../i18n/errors";
import { ellipsizePath, fmtBytes, fmtNumber, fmtPx } from "../../i18n/format";
import { t } from "../../i18n/de";
import { useDrops, useToasts, watchJobBriefly } from "../../app/stores";
import { useEffectiveTheme, useSettings } from "../../app/theme";
import { Notice } from "../../ui/Bits";
import { Button, IconButton } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Bench } from "../../ui/Frames";
import { SelectField } from "../../ui/Inputs";
import {
  IconActualSize,
  IconExternal,
  IconFit,
  IconGrid,
  IconClose,
  GlyphMeasure,
  GlyphPrintArea,
  GlyphSafeZone,
  GlyphSurround,
  IconSearch,
} from "../../ui/icons";
import { OutputBar, type OutputState } from "../../ui/OutputBar";
import { PrintCanvas, type CanvasKey, type ViewState } from "./PrintCanvas";
import { ExportSection, GarmentSection, ReportSection, SizeSection, VerdictBlock } from "./PrintInspector";
import { evaluateChecks, exportSize, summarize, withQueuedFixes, type CheckResult } from "./rules";
import { defaultTopOffset, heightFor, pxPerMmActual } from "./geometry";
import { useDebounced } from "../../lib/useDebounced";
import "./printcheck.css";

const p = t.print;
type Surround = "light" | "mid" | "dark";
const SURROUND_CYCLE: Surround[] = ["light", "mid", "dark"];
const MEASURE_CYCLE = ["cyan", "magenta", "ink", "paper"] as const;

type ExportState =
  | { kind: "idle" }
  | { kind: "running"; stage: number }
  | { kind: "done"; result: PrintExportResult }
  | { kind: "error"; error: AppError };

const STAGES = ["decode", "analyze", "fix", "resample", "colorConvert", "encode", "verify"] as const;

const DEFAULT_OPTIONS = (widthMm: number): PrintExportOptions => ({
  mode: "trimmed",
  plannedWidthMm: widthMm,
  offsetTopMm: 0,
  offsetCenterMm: 0,
  allowUpscale: false,
  colorProfile: "adobeRgb",
  fixes: { cleanGhostPixels: true, semiTransparency: "keep", nearBlackToPureBlack: false },
  writePlacementJson: true,
  destination: { kind: "dialog" },
});

export default function PrintCheck() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const settings = useSettings();
  const profiles = useCmd("print_profiles_list", undefined, { staleTime: 60_000 });
  const brand = useCmd("brand_get", undefined, { staleTime: 60_000 });
  const projects = useCmd("projects_list", undefined, { retry: false });
  const ui = settings.data?.ui;
  const theme = useEffectiveTheme(ui);

  const [handle, setHandle] = useState<FileHandleInfo | null>(null);
  const [profileId, setProfileId] = useState<string>("");
  const [garmentId, setGarmentId] = useState("schwarz");
  const [technique, setTechnique] = useState<"dtg" | "dtf">("dtg");
  const [width, setWidth] = useState<number | null>(null);
  const [offsetTop, setOffsetTop] = useState<number | null>(null);
  const [options, setOptions] = useState<PrintExportOptions>(DEFAULT_OPTIONS(280));
  const [projectId, setProjectId] = useState("");
  const [view, setView] = useState<ViewState>({ scale: null, panX: 0, panY: 0 });
  const [grid, setGrid] = useState(false);
  const [safe, setSafe] = useState(true);
  const [marks, setMarks] = useState(true);
  const [exp, setExp] = useState<ExportState>({ kind: "idle" });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fixed, setFixed] = useState<Set<string>>(new Set());
  const [force, setForce] = useState(false);
  const headRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const profile = profiles.data?.find((x) => x.id === profileId) ?? profiles.data?.[0];
  const garments = brand.data?.garmentColors ?? [];
  const garment = garments.find((g) => g.id === garmentId) ?? garments[0];

  // Profil-Standard setzen
  useEffect(() => {
    if (profile && !profileId) setProfileId(profile.id);
  }, [profile, profileId]);
  const widthMm = width ?? profile?.defaultWidthMm ?? 280;
  const debouncedWidth = useDebounced(widthMm, 160);

  // Datei kommt über Ziehen, Dialog oder Bibliothek
  const dropSerial = useDrops((s) => s.serial);
  const dropped = useDrops((s) => s.handles);
  const lastDrop = useRef(dropSerial);
  useEffect(() => {
    if (dropSerial === lastDrop.current) return;
    lastDrop.current = dropSerial;
    const first = dropped.find((h) => h.url !== null || h.mime.startsWith("image/")) ?? dropped[0];
    if (first) {
      setHandle(first);
      setExp({ kind: "idle" });
    }
  }, [dropSerial, dropped]);
  // Datei, die vor dem Wechsel hierher gezogen wurde
  useEffect(() => {
    const s = useDrops.getState();
    if (s.serial > 0 && s.handles[0] && !handle) {
      setHandle(s.handles[0]);
      lastDrop.current = s.serial;
    }
    // nur beim Einstieg
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = useCallback(() => {
    void call("file_pick", { req: { purpose: "printcheck" } })
      .then((hs) => {
        const h = hs[0];
        if (h) {
          setHandle(h);
          setExp({ kind: "idle" });
          setFixed(new Set());
          setExpanded(null);
          setView({ scale: null, panX: 0, panY: 0 });
        }
      })
      .catch((e: unknown) => push({ kind: "error", text: errorText(toAppError(e)).title }));
  }, [push]);

  useEffect(() => {
    window.addEventListener("cypher:open-file", pick);
    return () => window.removeEventListener("cypher:open-file", pick);
  }, [pick]);

  const analysisEnabled = !!handle && !!profile && !!garment;
  const analysis = useCmd(
    "printcheck_analyze",
    {
      req: {
        handleId: handle?.id ?? "",
        profileId: profile?.id ?? "",
        garmentColorId: garment?.id ?? "schwarz",
        technique,
        plannedWidthMm: debouncedWidth,
      },
    },
    { enabled: analysisEnabled, keepPrevious: true, retry: false },
  );
  const report = analysis.data;
  const analyzing = analysis.isFetching && (!report || report.file.name !== handle?.name);

  const checks: CheckResult[] = useMemo(
    () => (report && profile ? withQueuedFixes(evaluateChecks(report, profile), fixed) : []),
    [report, profile, fixed],
  );
  const sum = useMemo(() => summarize(checks), [checks]);

  // Standardabstand oben, sobald die Höhe bekannt ist
  const motifHeight = report?.placement.plannedHeightMm ?? heightFor(widthMm, { width: 1, height: 1.1 });
  const topMm =
    offsetTop ?? (profile ? defaultTopOffset(profile.printAreaMm, motifHeight, profile.topMarginHintMm) : 0);

  // Zustände zurücksetzen, wenn sich etwas ändert
  const resetKey = `${handle?.id}|${profile?.id}|${garmentId}|${technique}|${Math.round(widthMm * 10)}|${JSON.stringify(options)}`;
  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (lastKey.current !== resetKey) {
      lastKey.current = resetKey;
      setExp((s) => (s.kind === "running" ? s : { kind: "idle" }));
    }
  }, [resetKey]);

  // Ergebnis ansagen
  const announce = report && !analyzing ? p.verdict.announce(sum.warnings, sum.errors) : "";

  const surroundKey = theme === "ink" ? "ink" : "paper";
  const surround: Surround = ui?.surround[surroundKey] ?? (theme === "ink" ? "dark" : "light");
  const setUi = (patch: Record<string, unknown>) =>
    void call("settings_update", { req: { ui: patch } }).then(() =>
      qc.invalidateQueries({ queryKey: ["settings_get"] }),
    );
  const cycleSurround = () => {
    const next = SURROUND_CYCLE[(SURROUND_CYCLE.indexOf(surround) + 1) % SURROUND_CYCLE.length] ?? "light";
    setUi({ surround: { ...(ui?.surround ?? { paper: "light", ink: "dark" }), [surroundKey]: next } });
  };
  const cycleMeasure = () => {
    const cur = ui?.measureColor ?? "cyan";
    setUi({ measureColor: MEASURE_CYCLE[(MEASURE_CYCLE.indexOf(cur) + 1) % MEASURE_CYCLE.length] ?? "cyan" });
  };

  const setActual = () => {
    setView({ scale: pxPerMmActual(ui?.calibrationPxPerMm ?? null), panX: 0, panY: 0 });
  };
  const setFull = () => {
    if (report) setView({ scale: report.trimmedPx ? report.trimmedPx.width / widthMm : 1, panX: 0, panY: 0 });
  };
  const onKey = (k: CanvasKey) => {
    switch (k) {
      case "fit":
        setView({ scale: null, panX: 0, panY: 0 });
        break;
      case "full":
        setFull();
        break;
      case "actual":
        setActual();
        break;
      case "surround":
        cycleSurround();
        break;
      case "grid":
        setGrid((g) => !g);
        break;
      case "zones":
        setSafe((s) => !s);
        break;
      case "marks":
        setMarks((m) => !m);
        break;
      case "measure":
        cycleMeasure();
        break;
    }
  };

  const onFix = (f: Finding) => {
    if (!f.fix) return;
    setOptions((o) => {
      switch (f.fix) {
        case "cleanGhostPixels":
          return { ...o, fixes: { ...o.fixes, cleanGhostPixels: true } };
        case "semiTransparency":
          return { ...o, fixes: { ...o.fixes, semiTransparency: "threshold" } };
        case "nearBlackToPureBlack":
          return { ...o, fixes: { ...o.fixes, nearBlackToPureBlack: true } };
        case "colorProfile":
          return { ...o, colorProfile: "adobeRgb" };
        case null:
          return o;
      }
    });
    setFixed((s) => new Set(s).add(f.fix ?? ""));
  };

  const doExport = useCallback(() => {
    if (!handle || !profile) return;
    setExp({ kind: "running", stage: 0 });
    const opts: PrintExportOptions = { ...options, plannedWidthMm: widthMm, offsetTopMm: topMm };
    call("printcheck_export", {
      req: { handleId: handle.id, profileId: profile.id, garmentColorId: garmentId, technique, options: opts },
      onEvent: channel<PrintExportEvent>((e) => {
        if (e.type === "started") watchJobBriefly(e.jobId);
        if (e.type === "stage") setExp({ kind: "running", stage: STAGES.indexOf(e.stage) + 1 });
      }),
    })
      .then((result) => setExp({ kind: "done", result }))
      .catch((e: unknown) => {
        const err = toAppError(e);
        setExp(err.kind === "cancelled" ? { kind: "idle" } : { kind: "error", error: err });
      });
  }, [handle, profile, options, widthMm, topMm, garmentId, technique]);

  // Standardziel: erstes Projekt
  useEffect(() => {
    const first = projects.data?.[0];
    if (first && !projectId) {
      setProjectId(first.id);
      setOptions((o) =>
        o.destination.kind === "dialog" ? { ...o, destination: { kind: "project", projectId: first.id } } : o,
      );
    }
  }, [projects.data, projectId]);

  const jumpToFirstError = () => {
    const first = checks.find((c) => c.state === "error");
    if (!first) return;
    setExpanded(first.id);
    requestAnimationFrame(() => {
      const el = headRefs.current[first.id];
      el?.scrollIntoView({ block: "nearest" });
      el?.focus();
    });
  };

  // Ausgangsleiste: genau die Maße, die Rust schreibt (ohne „Vergrößern erlauben“ bleibt es bei der Breite des Motivs)
  const { outW, outH } = exportSize(widthMm, report?.trimmedPx ?? null, options.allowUpscale);
  const estBytes = report
    ? Math.round(report.file.fileBytes * Math.min(1.5, Math.max(0.2, (outW / (report.trimmedPx?.width || 1)) ** 2)))
    : 0;
  const summary = report
    ? [
        { label: p.output.format, value: "PNG" },
        { label: p.output.dims, value: fmtPx(outW, outH) },
        { label: p.output.dpi, value: "300 dpi" },
        {
          label: p.output.profile,
          value: options.colorProfile === "adobeRgb" ? p.values.colorProfile.adobeRgb : p.values.colorProfile.srgb,
        },
        { label: p.output.size, value: `${p.output.estimated} ${fmtBytes(estBytes)}` },
      ]
    : [{ label: p.output.format, value: "—" }];

  let state: OutputState;
  if (exp.kind === "running") {
    state = { kind: "running", label: p.output.exporting, progress: exp.stage / STAGES.length };
  } else if (exp.kind === "done") {
    const r = exp.result;
    state = {
      kind: "done",
      message: p.output.saved(ellipsizePath(r.output.displayPath, 78)),
      announce: p.output.announceSaved(r.output.name),
      actions: (
        <>
          <Button
            onClick={() => void call("app_reveal", { req: { target: { kind: "fileHandle", handleId: r.output.id } } })}
            data-testid="reveal-output"
          >
            {p.output.reveal}
          </Button>
          <Button
            icon={IconExternal}
            onClick={() =>
              void call("app_open_external", { req: { target: { kind: "catalogLink", linkId: "shirtigo" } } })
            }
          >
            {p.output.openShirtigo}
          </Button>
        </>
      ),
    };
  } else if (exp.kind === "error") {
    state = {
      kind: "error",
      message: `${p.output.failed}: ${errorText(exp.error).text}`,
      announce: p.output.failed,
      actions: <Button onClick={() => setExp({ kind: "idle" })}>{p.output.again}</Button>,
    };
  } else if (!handle) {
    state = { kind: "blocked", label: p.output.label, reason: p.output.needFile, onJump: pick };
  } else if (!report || analyzing) {
    state = { kind: "blocked", label: p.output.label, reason: p.output.pending, onJump: () => undefined };
  } else if (sum.errors > 0) {
    state = {
      kind: "blocked",
      label: p.output.label,
      reason: p.output.errorsFirst(sum.errors, checks.find((c) => c.state === "error")?.title ?? ""),
      onJump: jumpToFirstError,
      forceLabel: p.forceExport,
      onForce: () => setForce(true),
    };
  } else {
    state = { kind: "ready", label: p.output.label, onRun: doExport };
  }

  const surroundAttr = surround === "light" ? "hell" : surround === "mid" ? "mittel" : "dunkel";
  const unreadable = analysis.isError ? analysis.error : null;
  const summaryText =
    report && handle
      ? p.preview.summary(
          handle.name,
          fmtNumber(report.placement.plannedWidthMm, 1),
          fmtNumber(report.placement.plannedHeightMm, 1),
          profile?.printAreaMm.width ?? 0,
          profile?.printAreaMm.height ?? 0,
        )
      : p.empty.areaLabel(profile?.printAreaMm.width ?? 0, profile?.printAreaMm.height ?? 0);
  const measure = ui?.measureColor ?? "cyan";

  const toolbar = (
    <div className="pc__tools" role="toolbar" aria-label={p.preview.tools.group}>
      <IconButton icon={IconFit} label={p.preview.tools.fit} combo="0" onClick={() => onKey("fit")} />
      <IconButton
        icon={IconSearch}
        label={p.preview.tools.full}
        combo="1"
        onClick={() => onKey("full")}
        disabled={!report}
      />
      <IconButton icon={IconActualSize} label={p.preview.tools.actual} combo="e" onClick={() => onKey("actual")} />
      <span className="pc__sep" aria-hidden="true" />
      <IconButton
        icon={GlyphSurround}
        label={`${p.preview.tools.surround} (${p.preview.surround[surroundAttr]})`}
        combo="u"
        onClick={() => onKey("surround")}
        data-testid="tool-surround"
      />
      <IconButton
        icon={IconGrid}
        label={p.preview.tools.grid}
        combo="g"
        onClick={() => onKey("grid")}
        pressed={grid}
        data-testid="tool-grid"
      />
      <IconButton
        icon={GlyphSafeZone}
        label={p.preview.tools.zones}
        combo="s"
        onClick={() => onKey("zones")}
        pressed={safe}
        disabled={!profile?.safeAreaMm}
        data-testid="tool-zones"
      />
      <IconButton
        icon={GlyphPrintArea}
        label={p.preview.tools.marks}
        combo="p"
        onClick={() => onKey("marks")}
        pressed={marks}
        data-testid="tool-marks"
      />
      <IconButton
        icon={GlyphMeasure}
        label={`${p.preview.tools.measureColor} (${p.preview.measureColors[measure]})`}
        combo="m"
        onClick={() => onKey("measure")}
      />
    </div>
  );

  const emptyOverlay = !handle ? (
    <div className="pc__empty" data-testid="print-empty">
      <p className="t-section">{p.empty.drop}</p>
      <div className="cluster">
        <Button variant="primary" combo="mod+o" onClick={pick} data-testid="print-pick">
          {p.empty.choose}
        </Button>
      </div>
      <p className="t-meta">
        {p.empty.orLibrary}{" "}
        <button type="button" className="linkbtn" onClick={() => void navigate("/bibliothek")}>
          {p.empty.library}
        </button>
      </p>
    </div>
  ) : unreadable ? (
    <div className="pc__empty" data-testid="print-unreadable">
      <Notice
        kind="error"
        title={
          unreadable.kind === "unsupportedFormat"
            ? p.errors.unsupportedFormat(handle.name, unreadable.format)
            : p.errors.unreadable(handle.name, errorText(unreadable).text)
        }
        actions={
          <>
            <Button onClick={pick}>{p.empty.choose}</Button>
            <Button variant="text" onClick={() => setHandle(null)}>
              {t.common.cancel}
            </Button>
          </>
        }
      >
        {errorText(unreadable).safe}
      </Notice>
    </div>
  ) : null;

  const tools = (
    <>
      {profile ? (
        <div className="print-profile">
          <SelectField
            label={p.profileLabel}
            hideLabel
            value={profile.id}
            onChange={(v) => {
              setProfileId(v);
              const next = profiles.data?.find((x) => x.id === v);
              if (next) {
                setWidth(next.defaultWidthMm);
                setOffsetTop(null);
                setOptions((o) => ({ ...o, plannedWidthMm: next.defaultWidthMm }));
              }
            }}
            options={(profiles.data ?? []).map((x) => ({
              value: x.id,
              label: p.profileOption(x.title, x.printAreaMm.width, x.printAreaMm.height),
            }))}
            data-testid="print-profile"
          />
        </div>
      ) : null}
    </>
  );

  const context = handle ? (
    <span className="chipfile" data-testid="print-file">
      <span className="t-data">{handle.name}</span>
      {report ? <span className="t-mute">{` · ${fmtPx(report.file.widthPx, report.file.heightPx)}`}</span> : null}
      <IconButton
        icon={IconClose}
        label={p.removeFile(handle.name)}
        bare
        onClick={() => {
          setHandle(null);
          setFixed(new Set());
          setExpanded(null);
        }}
      />
    </span>
  ) : null;

  return (
    <>
      <Bench
        title={p.title}
        testId="screen-print"
        context={context}
        tools={tools}
        surround={surroundAttr}
        previewLabel={p.preview.label}
        previewNote={p.preview.disclaimer}
        preview={
          <>
            {profile && garment ? (
              <PrintCanvas
                profile={profile}
                garment={garment}
                handle={handle}
                report={unreadable ? undefined : report}
                plannedWidthMm={widthMm}
                offsetTopMm={topMm}
                offsetCenterMm={0}
                showGrid={grid}
                showSafe={safe}
                showMarks={marks}
                view={view}
                onView={setView}
                summary={summaryText}
                singleKeys={ui?.singleKeyShortcuts ?? true}
                onKey={onKey}
              />
            ) : null}
            {emptyOverlay}
            {toolbar}
            <div className="sr-only" aria-live="polite" data-testid="print-live">
              {announce}
            </div>
          </>
        }
        inspector={
          <>
            <div className="section">
              <VerdictBlock
                report={unreadable ? undefined : report}
                checks={checks}
                hasFile={!!handle}
                loading={analyzing}
              />
            </div>
            {profile && garment ? (
              <>
                {handle && !unreadable ? (
                  <div className="section">
                    <ReportSection
                      report={report}
                      checks={checks}
                      profile={profile}
                      loading={analyzing}
                      expandedId={expanded}
                      setExpandedId={setExpanded}
                      onFix={onFix}
                      fixed={fixed}
                      headRefs={headRefs}
                    />
                  </div>
                ) : null}
                <div className="section">
                  <GarmentSection garments={garments} value={garment.id} onChange={setGarmentId} />
                </div>
                <div className="section">
                  <SizeSection
                    profile={profile}
                    widthMm={widthMm}
                    onWidth={(v) => {
                      setWidth(v);
                      setOptions((o) => ({ ...o, plannedWidthMm: v }));
                    }}
                    technique={technique}
                    onTechnique={setTechnique}
                    report={report}
                    offsetTop={topMm}
                    onOffsetTop={setOffsetTop}
                  />
                </div>
                <div className="section">
                  <ExportSection
                    options={options}
                    onChange={setOptions}
                    projects={projects.data ?? []}
                    projectId={projectId}
                    onProject={setProjectId}
                  />
                </div>
                {profile.assumption ? <p className="section t-meta t-mute">{p.assumption}</p> : null}
              </>
            ) : null}
          </>
        }
        output={<OutputBar target={p.output.target} summary={summary} state={state} testId="print-output" />}
      />
      <ForceDialog
        open={force}
        errors={sum.errors}
        onCancel={() => setForce(false)}
        onConfirm={() => {
          setForce(false);
          doExport();
        }}
      />
    </>
  );
}

export function ForceDialog({
  open,
  errors,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  errors: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      title={p.force.title}
      onClose={onCancel}
      testId="force-dialog"
      footer={
        <>
          <Button onClick={onCancel}>{t.common.cancel}</Button>
          <Button variant="danger" onClick={onConfirm} data-testid="force-confirm">
            {p.force.confirm}
          </Button>
        </>
      }
    >
      <p className="t-read">{p.force.text(errors)}</p>
    </Dialog>
  );
}
