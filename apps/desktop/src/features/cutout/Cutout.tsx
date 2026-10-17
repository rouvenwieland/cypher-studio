import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { AppError, BgRemoveEvent, BgRemoveMethod, FileHandleInfo, PrintReport } from "@contract";
import { call, exportSaveImage } from "../../ipc/commands";
import { channel } from "../../ipc/channel";
import { useCmd } from "../../ipc/queries";
import { toAppError } from "../../ipc/errors";
import { errorText } from "../../i18n/errors";
import { ellipsizePath, fmtBytes, fmtNumber, fmtPercent, fmtPx } from "../../i18n/format";
import { t } from "../../i18n/de";
import { useDrops, useToasts, watchJobBriefly } from "../../app/stores";
import { useEffectiveTheme, useSettings } from "../../app/theme";
import { Notice } from "../../ui/Bits";
import { Button } from "../../ui/Button";
import { Bench } from "../../ui/Frames";
import { Checkbox, Field, Segmented, SelectField, Slider } from "../../ui/Inputs";
import { MessZeile } from "../../ui/Bits";
import { OutputBar, type OutputState } from "../../ui/OutputBar";
import { useInstallUi } from "../install/store";
import { CompareView } from "./CompareView";
import "./cutout.css";

const c = t.cutout;
type Backdrop = "checker" | "garment" | "paper" | "ink";
const STAGES = ["load", "infer", "compose", "encode"] as const;

export default function Cutout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const openInstall = useInstallUi((s) => s.open);
  const settings = useSettings();
  const theme = useEffectiveTheme(settings.data?.ui);
  const status = useCmd("bgremove_status", undefined);
  const brand = useCmd("brand_get", undefined, { staleTime: 60_000 });
  const profiles = useCmd("print_profiles_list", undefined, { staleTime: 60_000 });
  const [handle, setHandle] = useState<FileHandleInfo | null>(null);
  const [kind, setKind] = useState<"colorKey" | "model">("colorKey");
  const [tolerance, setTolerance] = useState(24);
  const [sampleFrom, setSampleFrom] = useState<"corners" | "border">("corners");
  const [refine, setRefine] = useState(true);
  const [backdrop, setBackdrop] = useState<Backdrop>("checker");
  const [garmentId, setGarmentId] = useState("schwarz");
  const [running, setRunning] = useState<number | null>(null);
  const [result, setResult] = useState<FileHandleInfo | null>(null);
  const [report, setReport] = useState<PrintReport | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<FileHandleInfo | null>(null);
  const lastDrop = useRef(useDrops.getState().serial);

  const model = status.data?.models[0];
  const modelReady = !!model?.installed;
  const garments = brand.data?.garmentColors ?? [];
  const garment = garments.find((g) => g.id === garmentId) ?? garments[0];

  // Datei aus dem Ziehen oder aus der Bibliothek
  const dropSerial = useDrops((s) => s.serial);
  useEffect(() => {
    const s = useDrops.getState();
    if (s.serial > 0 && !handle && s.handles[0]) {
      setHandle(s.handles[0]);
      lastDrop.current = s.serial;
    }
    // nur beim Einstieg
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (dropSerial === lastDrop.current) return;
    lastDrop.current = dropSerial;
    const first = useDrops.getState().handles[0];
    if (first) reset(first);
  }, [dropSerial]);

  function reset(h: FileHandleInfo | null) {
    setHandle(h);
    setResult(null);
    setReport(null);
    setSaved(null);
    setError(null);
  }

  const pick = useCallback(() => {
    void call("file_pick", { req: { purpose: "bgremove" } })
      .then((hs) => {
        if (hs[0]) reset(hs[0]);
      })
      .catch((e: unknown) => push({ kind: "error", text: errorText(toAppError(e)).title }));
  }, [push]);
  useEffect(() => {
    window.addEventListener("cypher:open-file", pick);
    return () => window.removeEventListener("cypher:open-file", pick);
  }, [pick]);

  const run = () => {
    if (!handle) return;
    const method: BgRemoveMethod =
      kind === "colorKey"
        ? { kind: "colorKey", tolerance, sample: sampleFrom }
        : { kind: "model", modelId: model?.id ?? "", refineEdges: refine };
    setRunning(0);
    setError(null);
    setSaved(null);
    call("bgremove_run", {
      req: { handleId: handle.id, method },
      onEvent: channel<BgRemoveEvent>((e) => {
        if (e.type === "started") watchJobBriefly(e.jobId);
        if (e.type === "stage") setRunning(STAGES.indexOf(e.stage) + 1);
      }),
    })
      .then(async (out) => {
        setResult(out);
        const profile = profiles.data?.[0];
        if (profile) {
          try {
            setReport(
              await call("printcheck_analyze", {
                req: { handleId: out.id, profileId: profile.id, garmentColorId: garmentId },
              }),
            );
          } catch {
            setReport(null);
          }
        }
        if (backdrop === "checker") setBackdrop("garment");
      })
      .catch((e: unknown) => setError(toAppError(e)))
      .finally(() => setRunning(null));
  };

  const save = async () => {
    if (!result?.url) return;
    setSaving(true);
    try {
      const bytes = new Uint8Array(await (await fetch(result.url)).arrayBuffer());
      const handleOut = await exportSaveImage(bytes, {
        fileName: result.name,
        format: "png",
        destination: { kind: "library", subfolder: "Export" },
      });
      if (handleOut) setSaved(handleOut);
      void qc.invalidateQueries({ queryKey: ["library_query"] });
    } catch (e) {
      push({ kind: "error", text: errorText(toAppError(e)).text });
    } finally {
      setSaving(false);
    }
  };

  const semiLimit = profiles.data?.[0]?.alpha.warnShare ?? 0.001;
  const modelUsable = status.data?.modelFeature === true;
  const methodNeedsModel = kind === "model" && !modelReady;
  const canRun = !!handle && running === null && !(kind === "model" && (!modelUsable || !modelReady));

  const surround = settings.data?.ui.surround[theme === "ink" ? "ink" : "paper"] ?? "light";
  const surroundAttr = surround === "light" ? "hell" : surround === "mid" ? "mittel" : "dunkel";

  let state: OutputState;
  if (saving) state = { kind: "running", label: c.output.saving, progress: null };
  else if (saved) {
    state = {
      kind: "done",
      message: c.output.saved(ellipsizePath(saved.displayPath, 78)),
      announce: c.output.announce(saved.name),
      actions: (
        <>
          <Button
            onClick={() => {
              useDrops.getState().push([saved]);
              void navigate("/druck");
            }}
            data-testid="cutout-to-print"
          >
            {c.output.toPrint}
          </Button>
          <Button
            onClick={() => void call("app_reveal", { req: { target: { kind: "fileHandle", handleId: saved.id } } })}
          >
            {c.output.reveal}
          </Button>
        </>
      ),
    };
  } else if (!handle) state = { kind: "blocked", label: c.output.label, reason: c.output.needFile, onJump: pick };
  else if (!result) state = { kind: "blocked", label: c.output.label, reason: c.output.needRun, onJump: run };
  else state = { kind: "ready", label: c.output.label, onRun: () => void save() };

  const summary = report
    ? [
        { label: c.output.format, value: c.output.target },
        { label: c.output.dims, value: fmtPx(report.file.widthPx, report.file.heightPx) },
      ]
    : [
        { label: c.output.format, value: c.output.target },
        { label: c.output.dims, value: c.output.pending },
      ];

  const stageName =
    running !== null && running > 0
      ? c.run.stages[STAGES[Math.min(running, STAGES.length) - 1] ?? "load"]
      : c.run.running;

  return (
    <Bench
      title={c.title}
      testId="screen-cutout"
      surround={surroundAttr}
      context={handle ? <span className="t-data">{handle.name}</span> : null}
      preview={
        handle?.url ? (
          <div className="cut" style={{ ["--cmp-garment" as string]: garment?.hex ?? "var(--c-ink)" }}>
            <CompareView beforeUrl={handle.url} afterUrl={result?.url ?? null} backdrop={backdrop} alt={handle.name} />
            <div className="cut__bg">
              <Segmented
                label={c.background.label}
                value={backdrop}
                onChange={setBackdrop}
                options={[
                  { value: "checker", label: c.background.checker },
                  { value: "garment", label: c.background.garment },
                  { value: "paper", label: c.background.paper },
                  { value: "ink", label: c.background.ink },
                ]}
              />
            </div>
          </div>
        ) : (
          <div className="cut cut--empty" data-testid="cutout-empty">
            <div className="cut__empty">
              <p className="t-section">{c.empty.drop}</p>
              <p className="t-read">{c.empty.local}</p>
              <Button variant="primary" combo="mod+o" onClick={pick} data-testid="cutout-pick">
                {c.empty.choose}
              </Button>
            </div>
          </div>
        )
      }
      inspector={
        <>
          <div className="section stack">
            <h3 className="t-section">{c.method.title}</h3>
            <Segmented
              label={c.method.title}
              value={kind}
              onChange={setKind}
              options={[
                { value: "colorKey", label: c.method.colorKey },
                { value: "model", label: c.method.model },
              ]}
            />
            <p className="t-meta t-mute">{kind === "colorKey" ? c.method.colorKeyHelp : c.method.modelHelp}</p>
            {kind === "colorKey" ? (
              <>
                <Field label={`${c.method.tolerance} · ${c.method.toleranceValue(tolerance)}`}>
                  <Slider
                    value={tolerance}
                    min={0}
                    max={100}
                    step={1}
                    onChange={setTolerance}
                    label={c.method.tolerance}
                    valueText={c.method.toleranceValue(tolerance)}
                  />
                </Field>
                <SelectField
                  label={c.method.sample}
                  value={sampleFrom}
                  onChange={(v) => setSampleFrom(v as "corners" | "border")}
                  options={[
                    { value: "corners", label: c.method.sampleOptions.corners },
                    { value: "border", label: c.method.sampleOptions.border },
                  ]}
                />
              </>
            ) : (
              <>
                {methodNeedsModel ? (
                  <Notice
                    kind={modelUsable ? "info" : "warn"}
                    title={
                      modelUsable ? c.method.modelMissing(model ? fmtBytes(model.size) : "") : c.method.modelUnavailable
                    }
                    actions={
                      modelUsable && model ? (
                        <Button
                          variant="primary"
                          onClick={() => openInstall({ programId: model.id, modelId: model.id })}
                          data-testid="model-load"
                        >
                          {c.method.modelLoad}
                        </Button>
                      ) : null
                    }
                  >
                    {model?.notice ?? null}
                  </Notice>
                ) : null}
                <Checkbox checked={refine} onChange={setRefine} describedBy="refine-help">
                  {c.method.refine}
                </Checkbox>
                <p className="t-meta t-mute" id="refine-help">
                  {c.method.refineHelp}
                </p>
              </>
            )}
            <div className="stack">
              <Button
                variant={result ? "default" : "primary"}
                onClick={run}
                disabled={!canRun}
                data-testid="cutout-run"
              >
                {running !== null ? stageName : result ? c.run.again : c.run.start}
              </Button>
              {running !== null ? (
                <p className="t-data t-mute" role="status">
                  {stageName}
                </p>
              ) : null}
            </div>
            {error ? (
              <Notice
                kind="error"
                title={
                  error.kind === "imageTooLarge"
                    ? c.errors.memory(error.widthPx, error.heightPx)
                    : errorText(error).title
                }
              >
                {error.kind === "imageTooLarge" ? null : errorText(error).text}
              </Notice>
            ) : null}
          </div>
          <div className="section stack">
            <h3 className="t-section">{c.measure.title}</h3>
            {report ? (
              <div className="stack" data-testid="cutout-measure">
                <MessZeile
                  stacked
                  items={[
                    { label: c.measure.semi, value: fmtPercent(report.alpha.semiAreaShareOfVisible, 1) },
                    {
                      label: c.measure.soft,
                      value: `${fmtNumber(Math.max(0.1, (report.placement.effectiveDpi > 0 ? 25.4 / report.placement.effectiveDpi : 0.085) * 4), 1)} ${t.common.unitMm}`,
                    },
                    { label: c.measure.size, value: fmtPx(report.file.widthPx, report.file.heightPx) },
                  ]}
                />
                <p className="t-meta">
                  {report.alpha.semiAreaShareOfVisible > semiLimit
                    ? c.measure.semiHint(fmtPercent(semiLimit, 1))
                    : c.measure.semiOk}
                </p>
                {result ? <p className="t-meta t-mute">{c.run.done}</p> : null}
              </div>
            ) : (
              <p className="t-meta t-mute">{c.measure.none}</p>
            )}
          </div>
          {garments.length > 0 && backdrop === "garment" ? (
            <div className="section">
              <SelectField
                label={c.background.garment}
                value={garment?.id ?? ""}
                onChange={setGarmentId}
                options={garments.map((g) => ({ value: g.id, label: g.name }))}
              />
            </div>
          ) : null}
        </>
      }
      output={<OutputBar target={c.title} summary={summary} state={state} testId="cutout-output" />}
    />
  );
}
