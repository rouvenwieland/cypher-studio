import { useState } from "react";
import type {
  Finding,
  GarmentColor,
  PrintExportOptions,
  PrintProfile,
  PrintReport,
  PrintTechnique,
  Project,
} from "@contract";
import { findingText } from "../../i18n/findings";
import { fmtNumber } from "../../i18n/format";
import { t } from "../../i18n/de";
import { Button } from "../../ui/Button";
import { Checkbox, Field, Segmented, SelectField, Slider, SwatchGroup } from "../../ui/Inputs";
import { Status, StatusGlyph, Verdict, type StatusKind } from "../../ui/Status";
import { IconRight, IconDown } from "../../ui/icons";
import { summarize, sortChecks, type CheckResult, type CheckState } from "./rules";

const p = t.print;

function stateKind(s: CheckState): StatusKind {
  switch (s) {
    case "error":
      return "error";
    case "warning":
      return "warn";
    case "info":
      return "info";
    case "ok":
      return "ok";
    case "open":
      return "open";
  }
}

function stateWord(s: CheckState): string {
  switch (s) {
    case "error":
      return p.report.severity.error;
    case "warning":
      return p.report.severity.warning;
    case "info":
      return p.report.severity.info;
    case "ok":
      return p.report.severity.ok;
    case "open":
      return p.report.severity.open;
  }
}

/** Urteil: Statusfläche über die ganze Breite (Form + Wort + Zählung). */
export function VerdictBlock({
  report,
  checks,
  hasFile,
  loading,
}: {
  report: PrintReport | undefined;
  checks: CheckResult[];
  hasFile: boolean;
  loading: boolean;
}) {
  if (!hasFile) return <Verdict kind="open" word={p.verdict.none} testId="verdict" />;
  if (!report || loading) {
    return <Verdict kind="open" word={p.verdict.pending} count={p.report.loading} testId="verdict" />;
  }
  const sum = summarize(checks);
  const kind = sum.verdict === "ok" ? "ok" : sum.verdict === "warning" ? "warn" : "error";
  const word = sum.verdict === "ok" ? p.verdict.ok : sum.verdict === "warning" ? p.verdict.warning : p.verdict.error;
  const count =
    sum.verdict === "ok"
      ? p.verdict.countsOk(sum.satisfied)
      : p.verdict.counts(sum.warnings, sum.errors, sum.unchecked);
  return <Verdict kind={kind} word={word} count={count} testId="verdict" />;
}

export function GarmentSection({
  garments,
  value,
  onChange,
}: {
  garments: GarmentColor[];
  value: string;
  onChange: (id: string) => void;
}) {
  const current = garments.find((g) => g.id === value);
  return (
    <div className="stack">
      <h3 className="t-section section__title">{p.garment.title}</h3>
      <SwatchGroup
        label={p.garment.label}
        value={value}
        onChange={onChange}
        options={garments.map((g) => ({ value: g.id, name: g.name, color: g.hex, on: g.textOnGarment }))}
      />
      <p className="t-meta" data-testid="garment-name">
        {current?.name ?? ""}
        {current?.providerColorName ? (
          <span className="t-mute"> · {t.common.shirtigoColor(current.providerColorName)}</span>
        ) : null}
      </p>
    </div>
  );
}

export function SizeSection({
  profile,
  widthMm,
  onWidth,
  technique,
  onTechnique,
  report,
  offsetTop,
  onOffsetTop,
}: {
  profile: PrintProfile;
  widthMm: number;
  onWidth: (mm: number) => void;
  technique: PrintTechnique;
  onTechnique: (t: PrintTechnique) => void;
  report: PrintReport | undefined;
  offsetTop: number;
  onOffsetTop: (mm: number) => void;
}) {
  const [text, setText] = useState(String(widthMm));
  const [lastWidth, setLastWidth] = useState(widthMm);
  if (widthMm !== lastWidth) {
    setLastWidth(widthMm);
    setText(String(Math.round(widthMm * 10) / 10).replace(".", ","));
  }
  const dpi = report ? Math.round(report.placement.effectiveDpi) : null;
  const low = dpi !== null && dpi < profile.targetDpi - 0.5;
  const commit = (raw: string) => {
    const n = Number.parseFloat(raw.replace(",", "."));
    if (Number.isFinite(n) && n > 0) onWidth(Math.min(profile.printAreaMm.width + 100, Math.max(10, n)));
  };
  return (
    <div className="stack stack--loose">
      <h3 className="t-section section__title">{p.size.title}</h3>
      <div className="size-row">
        <Field label={p.size.width} htmlFor="print-width">
          <div className="input-group">
            <input
              id="print-width"
              className="input input--mono"
              inputMode="decimal"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                commit(e.target.value);
              }}
              onBlur={() => setText(String(Math.round(widthMm * 10) / 10).replace(".", ","))}
              data-testid="print-width"
            />
            <span className="input-group__unit">{t.common.unitMm}</span>
          </div>
        </Field>
        <div className="size-dpi t-data" data-testid="print-dpi">
          {dpi === null ? (
            p.report.loading
          ) : (
            <Status kind={low ? "warn" : "ok"}>{p.size.effective(Math.round(widthMm), dpi)}</Status>
          )}
        </div>
      </div>
      <Slider
        value={widthMm}
        min={20}
        max={Math.round(profile.printAreaMm.width)}
        step={1}
        onChange={onWidth}
        label={p.size.slider}
        valueText={`${Math.round(widthMm)} mm`}
      />
      {report && report.placement.maxWidthMmAtTargetDpi > 0 ? (
        <p className="t-meta t-mute">{p.size.maxHint(Math.floor(report.placement.maxWidthMmAtTargetDpi))}</p>
      ) : null}
      {profile.widthPresets.length > 0 ? (
        <Field label={p.size.placement}>
          <Segmented
            label={p.size.placement}
            value={profile.widthPresets.find((x) => Math.abs(x.widthMm - widthMm) < 0.5)?.id ?? ""}
            onChange={(id) => {
              const preset = profile.widthPresets.find((x) => x.id === id);
              if (preset) onWidth(preset.widthMm);
            }}
            options={profile.widthPresets.map((x) => ({ value: x.id, label: x.label }))}
          />
        </Field>
      ) : null}
      <div className="stack">
        <Field label={p.size.technique}>
          <Segmented
            label={p.size.technique}
            value={technique}
            onChange={onTechnique}
            options={profile.techniques.map((x) => ({ value: x, label: p.size.techniques[x] }))}
          />
        </Field>
        <p className="t-meta t-mute">{p.size.techniqueHelp}</p>
      </div>
      <Field label={p.size.offsetTop} htmlFor="print-offset-top">
        <div className="input-group">
          <input
            id="print-offset-top"
            className="input input--mono"
            inputMode="decimal"
            value={String(Math.round(offsetTop * 10) / 10).replace(".", ",")}
            onChange={(e) => {
              const n = Number.parseFloat(e.target.value.replace(",", "."));
              if (Number.isFinite(n)) onOffsetTop(Math.max(0, Math.min(profile.printAreaMm.height, n)));
            }}
          />
          <span className="input-group__unit">{t.common.unitMm}</span>
        </div>
      </Field>
    </div>
  );
}

function CheckRow({
  check,
  expanded,
  onToggle,
  profile,
  onFix,
  fixed,
  headRef,
}: {
  check: CheckResult;
  expanded: boolean;
  onToggle: () => void;
  profile: PrintProfile;
  onFix: (finding: Finding) => void;
  fixed: Set<string>;
  headRef?: (el: HTMLButtonElement | null) => void;
}) {
  const kind = stateKind(check.state);
  const muted = check.state === "ok";
  return (
    <li className={`rrow rrow--${check.state}`} data-testid={`check-${check.id}`} data-state={check.state}>
      <button type="button" className="rrow__head" aria-expanded={expanded} onClick={onToggle} ref={headRef}>
        <span className="rrow__glyph">
          <StatusGlyph kind={kind} />
        </span>
        <span className={muted ? "rrow__title t-mute" : "rrow__title t-strong"}>{check.title}</span>
        <span className="rrow__chev" aria-hidden="true">
          {expanded ? <IconDown size={14} /> : <IconRight size={14} />}
        </span>
        <span className="rrow__vals">
          <span className="t-data rrow__measured">{check.state === "open" ? p.report.notChecked : check.measured}</span>
          <span className="t-data t-mute rrow__limit">({check.limit})</span>
        </span>
        <span className="sr-only">{stateWord(check.state)}</span>
      </button>
      {expanded ? (
        <div className="rrow__more">
          {check.notCheckedWhy ? <p className="t-meta">{check.notCheckedWhy}</p> : null}
          {check.findings.length === 0 && !check.notCheckedWhy ? (
            <p className="t-meta t-mute">{stateWord("ok")}</p>
          ) : null}
          {check.findings.map((f, i) => {
            const msg = findingText(f);
            return (
              <div key={`${f.ruleId}-${i}`} className="rrow__finding">
                <p className="t-strong t-meta">{msg.title}</p>
                <p className="t-meta">{msg.detail}</p>
                {f.fix ? (
                  fixed.has(f.fix) ? (
                    <Status kind="ok">{p.report.fixed}</Status>
                  ) : (
                    <Button small onClick={() => onFix(f)} data-testid={`fix-${f.fix}`}>
                      {p.report.fix}
                    </Button>
                  )
                ) : null}
              </div>
            );
          })}
          {profile.source.urls[0] ? (
            <p className="t-meta t-mute">
              {p.report.source}: <span className="t-data selectable">{profile.source.urls[0]}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ReportSection({
  report,
  checks,
  profile,
  loading,
  expandedId,
  setExpandedId,
  onFix,
  fixed,
  headRefs,
}: {
  report: PrintReport | undefined;
  checks: CheckResult[];
  profile: PrintProfile;
  loading: boolean;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  onFix: (finding: Finding) => void;
  fixed: Set<string>;
  headRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
}) {
  const [showOk, setShowOk] = useState(false);
  if (!report || loading) {
    return (
      <div className="stack" data-testid="report-loading">
        <h3 className="t-section section__title">{p.report.title}</h3>
        <ul className="rlist">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="rrow rrow--skel">
              <span className="rrow__skel" aria-hidden="true">
                {p.report.loading}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const sorted = sortChecks(checks);
  const open = sorted.filter((c) => c.state !== "ok");
  const ok = sorted.filter((c) => c.state === "ok");
  const row = (c: CheckResult) => (
    <CheckRow
      key={c.id}
      check={c}
      expanded={expandedId === c.id}
      onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
      profile={profile}
      onFix={onFix}
      fixed={fixed}
      headRef={(el) => {
        headRefs.current[c.id] = el;
      }}
    />
  );
  return (
    <div className="stack">
      <h3 className="t-section section__title">{p.report.title}</h3>
      <ul className="rlist" data-testid="report-list">
        {open.map(row)}
      </ul>
      {ok.length > 0 ? (
        <div>
          <button
            type="button"
            className="linkbtn rlist__ok"
            aria-expanded={showOk}
            onClick={() => setShowOk(!showOk)}
            data-testid="show-ok"
          >
            {showOk ? <IconDown size={12} /> : <IconRight size={12} />} {p.report.satisfied(ok.length)}
          </button>
          {showOk ? <ul className="rlist">{ok.map(row)}</ul> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ExportSection({
  options,
  onChange,
  projects,
  projectId,
  onProject,
}: {
  options: PrintExportOptions;
  onChange: (o: PrintExportOptions) => void;
  projects: Project[];
  projectId: string;
  onProject: (id: string) => void;
}) {
  const e = p.export;
  const dest = options.destination.kind === "project" ? `project:${projectId}` : options.destination.kind;
  return (
    <details className="exp" data-testid="export-settings">
      <summary className="exp__sum t-section">
        <span className="exp__caret" aria-hidden="true">
          <IconRight size={14} />
        </span>
        {e.title}
      </summary>
      <div className="stack stack--loose exp__body">
        <Field label={e.mode}>
          <Segmented
            label={e.mode}
            value={options.mode}
            onChange={(mode) => onChange({ ...options, mode })}
            options={[
              { value: "trimmed", label: e.modeTrimmed },
              { value: "fullArea", label: e.modeFull },
            ]}
          />
        </Field>
        <p className="t-meta t-mute">{e.modeHelp}</p>
        <fieldset className="exp__fieldset">
          <legend className="t-label">{e.fixes}</legend>
          <Checkbox
            checked={options.fixes.cleanGhostPixels}
            onChange={(v) => onChange({ ...options, fixes: { ...options.fixes, cleanGhostPixels: v } })}
          >
            {e.cleanGhost}
          </Checkbox>
          <SelectField
            label={e.semi}
            value={options.fixes.semiTransparency}
            onChange={(v) =>
              onChange({
                ...options,
                fixes: { ...options.fixes, semiTransparency: v as PrintExportOptions["fixes"]["semiTransparency"] },
              })
            }
            options={[
              { value: "keep", label: e.semiOptions.keep },
              { value: "threshold", label: e.semiOptions.threshold },
              { value: "blendWithGarment", label: e.semiOptions.blendWithGarment },
              { value: "halftone", label: e.semiOptions.halftone, disabled: true },
            ]}
          />
          <Checkbox
            checked={options.fixes.nearBlackToPureBlack}
            onChange={(v) => onChange({ ...options, fixes: { ...options.fixes, nearBlackToPureBlack: v } })}
          >
            {e.nearBlack}
          </Checkbox>
        </fieldset>
        <Field label={e.colorProfile}>
          <Segmented
            label={e.colorProfile}
            value={options.colorProfile}
            onChange={(colorProfile) => onChange({ ...options, colorProfile })}
            options={[
              { value: "adobeRgb", label: t.print.values.colorProfile.adobeRgb },
              { value: "srgb", label: t.print.values.colorProfile.srgb },
            ]}
          />
        </Field>
        <Checkbox
          checked={options.writePlacementJson}
          onChange={(v) => onChange({ ...options, writePlacementJson: v })}
        >
          {e.placementJson}
        </Checkbox>
        <Checkbox checked={options.allowUpscale} onChange={(v) => onChange({ ...options, allowUpscale: v })}>
          {e.upscale}
        </Checkbox>
        <SelectField
          label={e.destination}
          value={dest}
          onChange={(v) => {
            if (v.startsWith("project:")) {
              onProject(v.slice(8));
              onChange({ ...options, destination: { kind: "project", projectId: v.slice(8) } });
            } else if (v === "besideSource") onChange({ ...options, destination: { kind: "besideSource" } });
            else if (v === "library") onChange({ ...options, destination: { kind: "library" } });
            else onChange({ ...options, destination: { kind: "dialog" } });
          }}
          options={[
            ...projects.slice(0, 8).map((pr) => ({ value: `project:${pr.id}`, label: e.destProject(pr.name) })),
            { value: "library", label: e.destLibrary },
            { value: "besideSource", label: e.destBeside },
            { value: "dialog", label: e.destDialog },
          ]}
        />
        <p className="t-meta t-mute">
          {fmtNumber(options.plannedWidthMm, 0)} {t.common.unitMm}
        </p>
      </div>
    </details>
  );
}
