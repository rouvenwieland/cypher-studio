import { useId, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import type { FileHandleInfo, GarmentColor, PrintProfile, PrintReport } from "@contract";
import { fmtNumber } from "../../i18n/format";
import { t } from "../../i18n/de";
import { useElementSize } from "../../lib/useElementSize";
import { fitScale, placeMotif, regionToMm, rulerTicks, zoomBy, type Placement } from "./geometry";

const RULER = 24;
const PAD = 44;

export interface ViewState {
  /** px je mm; null = einpassen */
  scale: number | null;
  panX: number;
  panY: number;
}

export type CanvasKey = "fit" | "full" | "actual" | "surround" | "grid" | "zones" | "marks" | "measure";

interface Props {
  profile: PrintProfile;
  garment: GarmentColor;
  handle: FileHandleInfo | null;
  report: PrintReport | undefined;
  plannedWidthMm: number;
  offsetTopMm: number;
  offsetCenterMm: number;
  showGrid: boolean;
  showSafe: boolean;
  showMarks: boolean;
  view: ViewState;
  onView: (view: ViewState) => void;
  summary: string;
  /** Einzeltasten (0, 1, E, U, G, S, P, M) nur bei Fokus in der Vorschau, WCAG 2.1.4 */
  singleKeys: boolean;
  onKey: (key: CanvasKey) => void;
}

function Chip({ x, y, text, className }: { x: number; y: number; text: string; className?: string }) {
  const w = text.length * 8.7 + 12;
  return (
    <g className={className ? `pc__chip ${className}` : "pc__chip"} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
      <rect className="pc__chip-bg" width={w} height={18} />
      <text className="pc__chip-text" x={6} y={13}>
        {text}
      </text>
    </g>
  );
}

function Line({ x1, y1, x2, y2, dashed }: { x1: number; y1: number; x2: number; y2: number; dashed?: boolean }) {
  return (
    <>
      <line className="pc__gegen" x1={x1} y1={y1} x2={x2} y2={y2} />
      <line className={dashed ? "pc__mess pc__mess--dash" : "pc__mess"} x1={x1} y1={y1} x2={x2} y2={y2} />
    </>
  );
}

function Frame({ x, y, w, h, dashed }: { x: number; y: number; w: number; h: number; dashed?: boolean }) {
  return (
    <>
      <rect className="pc__gegen pc__frame" x={x} y={y} width={w} height={h} />
      <rect className={dashed ? "pc__mess pc__frame pc__mess--dash" : "pc__mess pc__frame"} x={x} y={y} width={w} height={h} />
    </>
  );
}

export function PrintCanvas(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const size = useElementSize(wrap);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const uid = useId().replace(/:/g, "");
  const area = p.profile.printAreaMm;
  const fit = fitScale(size.width - RULER, size.height - RULER, area, PAD);
  const scale = p.view.scale ?? fit;
  const cx = RULER + (size.width - RULER) / 2 + p.view.panX;
  const cy = RULER + (size.height - RULER) / 2 + p.view.panY;
  const ox = cx - (area.width * scale) / 2;
  const oy = cy - (area.height * scale) / 2;
  const X = (mm: number) => ox + mm * scale;
  const Y = (mm: number) => oy + mm * scale;

  const report = p.report;
  const heightMm = report ? report.placement.plannedHeightMm : p.plannedWidthMm * 1.1;
  const place: Placement = placeMotif(area, p.plannedWidthMm, heightMm, p.offsetTopMm, p.offsetCenterMm);
  const hasMotif = p.handle !== null && p.handle.url !== null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const step = 48;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        p.onView({ ...p.view, panX: p.view.panX + step });
        return;
      case "ArrowRight":
        e.preventDefault();
        p.onView({ ...p.view, panX: p.view.panX - step });
        return;
      case "ArrowUp":
        e.preventDefault();
        p.onView({ ...p.view, panY: p.view.panY + step });
        return;
      case "ArrowDown":
        e.preventDefault();
        p.onView({ ...p.view, panY: p.view.panY - step });
        return;
      case "+":
      case "=":
        e.preventDefault();
        p.onView({ ...p.view, scale: zoomBy(scale, -120, 0.2, 40) });
        return;
      case "-":
        e.preventDefault();
        p.onView({ ...p.view, scale: zoomBy(scale, 120, 0.2, 40) });
        return;
      default:
        break;
    }
    if (!p.singleKeys) return;
    const k = e.key.toLowerCase();
    const map: Record<string, CanvasKey> = { "0": "fit", "1": "full", e: "actual", u: "surround", g: "grid", s: "zones", p: "marks", m: "measure" };
    const hit = map[k];
    if (hit) {
      e.preventDefault();
      p.onKey(hit);
    }
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const next = zoomBy(scale, e.deltaY, 0.2, 40);
    const ratio = next / scale;
    // Zoom um den Zeiger
    p.onView({ scale: next, panX: p.view.panX + (mx - cx) * (1 - ratio), panY: p.view.panY + (my - cy) * (1 - ratio) });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    drag.current = { x: e.clientX, y: e.clientY, panX: p.view.panX, panY: p.view.panY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    p.onView({ ...p.view, panX: d.panX + (e.clientX - d.x), panY: d.panY + (e.clientY - d.y) });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const topTicks = rulerTicks(area.width, scale);
  const leftTicks = rulerTicks(area.height, scale);
  const motifLeft = X(place.leftMm);
  const motifTop = Y(place.topMm);
  const motifW = place.widthMm * scale;
  const motifH = place.heightMm * scale;
  const chipBelow = place.topMm + place.heightMm + 9 < area.height;
  const bounds = report?.bounds ?? null;
  const file = report?.file ?? null;

  return (
    <div
      ref={wrap}
      className="pc"
      tabIndex={0}
      data-autofocus
      data-testid="print-canvas"
      onKeyDown={onKeyDown}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      aria-label={p.summary}
      role="img"
      style={{ ["--pc-garment" as string]: p.garment.hex }}
    >
      {size.width > 0 ? (
        <svg className="pc__svg" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true" focusable="false">
          <defs>
            <pattern id={`${uid}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line className="pc__hatch" x1="0" y1="0" x2="0" y2="7" />
            </pattern>
            <pattern id={`${uid}-cross`} width="8" height="8" patternUnits="userSpaceOnUse">
              <path className="pc__hatch" d="M0 0 8 8M8 0 0 8" />
            </pattern>
            <clipPath id={`${uid}-area`}>
              <rect x={X(0)} y={Y(0)} width={area.width * scale} height={area.height * scale} />
            </clipPath>
          </defs>

          {/* Druckfläche auf der Textilfarbe */}
          <rect className="pc__area" x={X(0)} y={Y(0)} width={area.width * scale} height={area.height * scale} />

          {p.showGrid ? (
            <g clipPath={`url(#${uid}-area)`} className="pc__grid">
              {Array.from({ length: Math.floor(area.width / 10) + 1 }, (_, i) => (
                <line key={`gx${i}`} x1={X(i * 10)} y1={Y(0)} x2={X(i * 10)} y2={Y(area.height)} />
              ))}
              {Array.from({ length: Math.floor(area.height / 10) + 1 }, (_, i) => (
                <line key={`gy${i}`} x1={X(0)} y1={Y(i * 10)} x2={X(area.width)} y2={Y(i * 10)} />
              ))}
            </g>
          ) : null}

          {/* Motiv */}
          {hasMotif && p.handle?.url ? (
            <g clipPath={`url(#${uid}-area)`}>
              {bounds && file ? (
                <svg x={motifLeft} y={motifTop} width={motifW} height={motifH} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} preserveAspectRatio="none" overflow="hidden">
                  <image href={p.handle.url} x={0} y={0} width={file.widthPx} height={file.heightPx} preserveAspectRatio="none" />
                </svg>
              ) : (
                <image className="pc__pending" href={p.handle.url} x={motifLeft} y={motifTop} width={motifW} height={motifH} preserveAspectRatio="xMidYMin meet" />
              )}
            </g>
          ) : null}

          {/* Messspur: Achse, Sicherheitsfläche, Motivrahmen, Maße */}
          <Line x1={X(area.width / 2)} y1={Y(0)} x2={X(area.width / 2)} y2={Y(area.height)} dashed />
          <Frame x={X(0)} y={Y(0)} w={area.width * scale} h={area.height * scale} />
          {p.showSafe && p.profile.safeAreaMm ? (
            <>
              <Frame x={X((area.width - p.profile.safeAreaMm.width) / 2)} y={Y((area.height - p.profile.safeAreaMm.height) / 2)} w={p.profile.safeAreaMm.width * scale} h={p.profile.safeAreaMm.height * scale} dashed />
              <Chip x={X((area.width - p.profile.safeAreaMm.width) / 2)} y={Y((area.height - p.profile.safeAreaMm.height) / 2) - 22} text={t.print.preview.safeChip(p.profile.safeAreaMm.width, p.profile.safeAreaMm.height)} />
            </>
          ) : null}

          {hasMotif && report ? (
            <>
              <Frame x={motifLeft} y={motifTop} w={motifW} h={motifH} />
              <Line x1={motifLeft} y1={motifTop - 8} x2={motifLeft + motifW} y2={motifTop - 8} />
              <Line x1={motifLeft} y1={motifTop - 13} x2={motifLeft} y2={motifTop - 3} />
              <Line x1={motifLeft + motifW} y1={motifTop - 13} x2={motifLeft + motifW} y2={motifTop - 3} />
              <Chip
                x={Math.max(X(0) + 2, motifLeft)}
                y={chipBelow ? motifTop + motifH + 8 : Math.max(Y(0) + 2, motifTop - 32)}
                text={t.print.preview.motifChip(fmtNumber(place.widthMm, 1), fmtNumber(place.heightMm, 1))}
              />
            </>
          ) : null}

          {/* Prüfmarken: Halbtransparenz schraffiert, dünne Linien kreuzschraffiert */}
          {p.showMarks && report && bounds
            ? report.findings
                .filter((f) => f.region !== null)
                .map((f, i) => {
                  if (!f.region) return null;
                  const r = regionToMm(f.region, bounds, place);
                  const cross = f.ruleId === "detail.thinLines";
                  return (
                    <g key={`${f.ruleId}-${i}`} className="pc__mark">
                      <rect x={X(r.x)} y={Y(r.y)} width={Math.max(2, r.width * scale)} height={Math.max(4, r.height * scale)} fill={`url(#${uid}-${cross ? "cross" : "hatch"})`} />
                      <rect className="pc__mark-edge" x={X(r.x)} y={Y(r.y)} width={Math.max(2, r.width * scale)} height={Math.max(4, r.height * scale)} />
                    </g>
                  );
                })
            : null}

          <Chip x={X(0)} y={Y(area.height) + 8} text={t.print.preview.areaChip(area.width, area.height)} />

          {/* Lineale */}
          <g className="pc__ruler">
            <rect className="pc__ruler-bg" x={0} y={0} width={size.width} height={RULER} />
            <rect className="pc__ruler-bg" x={0} y={0} width={RULER} height={size.height} />
            {topTicks.map((tk) => {
              const x = X(tk.mm);
              if (x < RULER + 4 || x > size.width) return null;
              return (
                <g key={`t${tk.mm}`}>
                  <line className="pc__mess" x1={x} y1={tk.major ? RULER - 9 : RULER - 5} x2={x} y2={RULER} />
                  {tk.label ? <text className="pc__ruler-num" x={x + 3} y={11}>{tk.mm}</text> : null}
                </g>
              );
            })}
            {leftTicks.map((tk) => {
              const y = Y(tk.mm);
              if (y < RULER + 4 || y > size.height) return null;
              return (
                <g key={`l${tk.mm}`}>
                  <line className="pc__mess" x1={tk.major ? RULER - 9 : RULER - 5} y1={y} x2={RULER} y2={y} />
                  {tk.label ? (
                    <text className="pc__ruler-num" x={2} y={y - 3}>
                      {tk.mm}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <text className="pc__ruler-unit" x={4} y={RULER - 8}>{t.print.preview.unit}</text>
          </g>
        </svg>
      ) : null}
    </div>
  );
}
