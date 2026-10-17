import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  SOCIAL_FORMAT_SIZES,
  type FileHandleInfo,
  type HexColor,
  type Point,
  type SocialDocument,
  type SocialFormat,
  type SocialTemplate,
} from "@contract";
import { call, exportSaveImage } from "../../ipc/commands";
import { useCmd } from "../../ipc/queries";
import { toAppError } from "../../ipc/errors";
import { errorText } from "../../i18n/errors";
import { fmtNumber } from "../../i18n/format";
import { t } from "../../i18n/de";
import { useDrops, useToasts } from "../../app/stores";
import { useEffectiveTheme, useSettings } from "../../app/theme";
import { useDebounced } from "../../lib/useDebounced";
import { Notice } from "../../ui/Bits";
import { Button, IconButton } from "../../ui/Button";
import { Bench } from "../../ui/Frames";
import { Field, Segmented, SelectField } from "../../ui/Inputs";
import { GlyphSafeZone, GlyphSurround, IconGrid } from "../../ui/icons";
import { ActionMenu } from "../../ui/Overlays";
import { OutputBar, type OutputState } from "../../ui/OutputBar";
import { StatusGlyph, Verdict } from "../../ui/Status";
import { useInstallUi } from "../install/store";
import {
  BACKGROUND_LAYER_ID,
  MIN_TEXT_CONTRAST,
  MIN_TEXT_PX_AT_REFERENCE,
  REFERENCE_WIDTH_PX,
  checkResolution,
  contrastRatio,
  denormalizeFocal,
  drawSocial,
  normalizeFocal,
  parseHexColor,
  renderSocialToBlob,
  zoneChips,
  type SocialLayout,
  type SocialWarning,
} from "./engine";
import { useSocialLayout, type SocialRender } from "./useSocialLayout";
import "./social.css";

const s = t.social;
type Tab = SocialFormat | "all";
type Content = { texts: Record<string, string>; images: SocialDocument["images"] };
const TAB_ORDER: Tab[] = ["post", "story", "reelCover", "all"];
const DEFAULT_EXPORT: Record<SocialFormat, "png" | "jpeg"> = {
  post: "jpeg",
  postTall: "jpeg",
  story: "png",
  reelCover: "jpeg",
};

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

function textSlots(template: SocialTemplate): { slot: string; defaultText: string; maxLines: number }[] {
  const seen = new Map<string, { slot: string; defaultText: string; maxLines: number }>();
  for (const l of template.layers)
    if (l.type === "text" && !seen.has(l.slot))
      seen.set(l.slot, { slot: l.slot, defaultText: l.defaultText, maxLines: l.maxLines });
  return [...seen.values()];
}

function imageSlots(template: SocialTemplate): { slot: string; required: boolean }[] {
  const out: { slot: string; required: boolean }[] = [];
  for (const l of template.layers)
    if (l.type === "image" && !out.some((x) => x.slot === l.slot)) out.push({ slot: l.slot, required: l.required });
  return out;
}

function SocialCanvas({ layout, bitmaps }: { layout: SocialLayout; bitmaps: ReadonlyMap<string, ImageBitmap> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d", { willReadFrequently: true });
    if (ctx) drawSocial(ctx, layout, bitmaps);
  }, [layout, bitmaps]);
  return (
    <canvas
      ref={ref}
      className="soc__canvas"
      width={layout.size.width}
      height={layout.size.height}
      aria-hidden="true"
    />
  );
}

/** Eine Vorschau mit Überlagerung: Sicherheitszonen (schraffiert, Chip mit Name und Maß), Profilraster. */
function SocialPane({
  template,
  doc,
  assetUrls,
  logoUrls,
  showZones,
  showGrid,
  onRender,
  label,
  large,
}: {
  template: SocialTemplate;
  doc: SocialDocument;
  assetUrls: Record<string, string>;
  logoUrls: Partial<Record<"light" | "dark", string>>;
  showZones: boolean;
  showGrid: boolean;
  onRender: (id: string, r: SocialRender) => void;
  label: string;
  large: boolean;
}) {
  const render = useSocialLayout(template, doc, assetUrls, logoUrls);
  useEffect(() => {
    onRender(template.id, render);
  }, [template.id, render, onRender]);
  const { width, height } = template.size;
  const chips = zoneChips(template.safeZones, template.size);
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  return (
    <figure
      className={large ? "soc__pane soc__pane--large" : "soc__pane"}
      style={{ aspectRatio: `${width} / ${height}` }}
      aria-label={label}
      data-testid={`pane-${template.id}`}
    >
      {render.layout ? (
        <SocialCanvas layout={render.layout} bitmaps={render.bitmaps} />
      ) : (
        <div className="soc__loading" role="status" aria-label={s.loading} />
      )}
      {showZones
        ? chips.map((c) => (
            <div
              key={c.zoneIndex}
              className="soc__zone"
              data-side={c.side}
              style={{
                left: pct(c.rect.x, width),
                top: pct(c.rect.y, height),
                width: pct(c.rect.width, width),
                height: pct(c.rect.height, height),
              }}
            >
              <span className="chip soc__zone-chip">{s.zoneChip(s.zone[c.side], Math.round(c.sizePx))}</span>
            </div>
          ))
        : null}
      {showGrid && template.gridCrop ? (
        <div
          className="soc__grid"
          style={{
            left: pct(template.gridCrop.x, width),
            top: pct(template.gridCrop.y, height),
            width: pct(template.gridCrop.width, width),
            height: pct(template.gridCrop.height, height),
          }}
        >
          <span className="chip soc__zone-chip">
            {s.gridChip(Math.round(template.gridCrop.width), Math.round(template.gridCrop.height))}
          </span>
        </div>
      ) : null}
    </figure>
  );
}

function TemplateThumb({
  template,
  assetUrls,
  logoUrls,
}: {
  template: SocialTemplate;
  assetUrls: Record<string, string>;
  logoUrls: Partial<Record<"light" | "dark", string>>;
}) {
  const doc = useMemo<SocialDocument>(
    () => ({
      templateId: template.id,
      format: template.format,
      texts: {},
      images: {},
      colorOverrides: {},
      exportFormat: "png",
    }),
    [template],
  );
  const render = useSocialLayout(template, doc, assetUrls, logoUrls);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d", { willReadFrequently: true });
    if (ctx && render.layout) drawSocial(ctx, render.layout, render.bitmaps);
  }, [render]);
  return (
    <canvas
      ref={ref}
      className="soc__thumb"
      width={template.size.width}
      height={template.size.height}
      style={{ aspectRatio: `${template.size.width} / ${template.size.height}` }}
      aria-hidden="true"
    />
  );
}

export default function Social() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const push = useToasts((st) => st.push);
  const openInstall = useInstallUi((st) => st.open);
  const settings = useSettings();
  const theme = useEffectiveTheme(settings.data?.ui);
  const templates = useCmd("social_templates_list", undefined, { staleTime: 60_000 });
  const brand = useCmd("brand_get", undefined, { staleTime: 60_000 });
  const projects = useCmd("projects_list", undefined, { retry: false });
  const programs = useCmd("programs_list", undefined, { staleTime: 30_000 });
  const all = useMemo(() => templates.data ?? [], [templates.data]);

  const [tab, setTab] = useState<Tab>("post");
  const [chosen, setChosen] = useState<Partial<Record<SocialFormat, string>>>({});
  const [content, setContent] = useState<Content>({ texts: {}, images: {} });
  const [world, setWorld] = useState<string | null>(null);
  const [exportFormats, setExportFormats] = useState<Partial<Record<string, "png" | "jpeg">>>({});
  const [projectId, setProjectId] = useState("");
  const [zones, setZones] = useState(true);
  const [grid, setGrid] = useState(true);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [exp, setExp] = useState<
    | { kind: "idle" }
    | { kind: "running"; done: number; total: number }
    | { kind: "done"; files: FileHandleInfo[] }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [saved, setSaved] = useState(false);
  const renders = useRef(new Map<string, SocialRender>());
  const [renderTick, setRenderTick] = useState(0);
  const lastDrop = useRef(useDrops.getState().serial);

  const onRender = useCallback((id: string, r: SocialRender) => {
    if (renders.current.get(id) !== r) {
      renders.current.set(id, r);
      setRenderTick((n) => n + 1);
    }
  }, []);

  const logoUrls = useMemo(() => {
    const out: Partial<Record<"light" | "dark", string>> = {};
    for (const l of brand.data?.logos ?? []) out[l.variant] = l.url;
    return out;
  }, [brand.data]);

  useEffect(() => {
    const first = projects.data?.[0];
    if (first && !projectId) setProjectId(first.id);
  }, [projects.data, projectId]);

  const formatOf = (tabId: Tab): SocialFormat[] =>
    tabId === "all" ? (["post", "story", "reelCover"] as SocialFormat[]) : [tabId];
  const templatesOfFormat = (f: SocialFormat) => all.filter((x) => x.format === f);
  const activeTemplates = formatOf(tab)
    .map((f) => all.find((x) => x.id === chosen[f]))
    .filter((x): x is SocialTemplate => x !== undefined);
  const current = activeTemplates[0];

  const worlds = useMemo(() => {
    // Papier und Tinte kommen aus der Palette der Marke, nicht aus dem Code
    const colors = (brand.data?.palettes ?? []).flatMap((p) => p.colors);
    const ink = colors.find((c) => c.name === "Tinte")?.hex;
    const paper = colors.find((c) => c.name === "Papier")?.hex;
    const inkRgb = ink ? parseHexColor(ink) : null;
    const paperRgb = paper ? parseHexColor(paper) : null;
    if (!ink || !paper || !inkRgb || !paperRgb) return [];
    const list: { id: string; name: string; bg: HexColor; fg: HexColor }[] = [
      { id: "paper", name: s.world.paper, bg: paper, fg: ink },
      { id: "ink", name: s.world.ink, bg: ink, fg: paper },
    ];
    for (const c of brand.data?.collections ?? []) {
      const bg = parseHexColor(c.hex);
      if (!bg) continue;
      list.push({
        id: c.id,
        name: c.name,
        bg: c.hex,
        fg: contrastRatio(bg, inkRgb) >= contrastRatio(bg, paperRgb) ? ink : paper,
      });
    }
    return list;
  }, [brand.data]);

  const docFor = useCallback(
    (template: SocialTemplate): SocialDocument => {
      const w = worlds.find((x) => x.id === world);
      const colorOverrides: Record<string, HexColor> = {};
      if (w) {
        colorOverrides[BACKGROUND_LAYER_ID] = w.bg;
        for (const l of template.layers) if (l.type === "text") colorOverrides[l.id] = w.fg;
      }
      return {
        templateId: template.id,
        format: template.format,
        texts: content.texts,
        images: content.images,
        colorOverrides,
        exportFormat: exportFormats[template.id] ?? DEFAULT_EXPORT[template.format],
      };
    },
    [content, world, worlds, exportFormats],
  );

  // Ein Dokument je Vorlage, nur neu gebaut, wenn sich der Inhalt ändert (sonst rechnet jede Vorschau bei jedem Zeichnen neu)
  const docs = useMemo(() => new Map(all.map((tpl) => [tpl.id, docFor(tpl)])), [all, docFor]);

  // Dokument je Vorlage laden und speichern (entprellt 1 s, ARCHITEKTUR 5.5)
  const relPathOf = (tpl: SocialTemplate) => `Social/${tpl.id}.social.json`;
  const loadedFor = useRef<string>("");
  useEffect(() => {
    if (!current || !projectId) return;
    const key = `${projectId}:${current.id}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    void call("project_read_document", { req: { projectId, relPath: relPathOf(current) } })
      .then((d) => {
        if (d && d.module === "social") {
          const data = d.data as SocialDocument;
          setContent({ texts: data.texts, images: data.images });
        }
      })
      .catch(() => undefined);
  }, [current, projectId]);
  const debouncedContent = useDebounced(content, 1000);
  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    if (!current || !projectId) return;
    void call("project_write_document", {
      req: {
        projectId,
        relPath: relPathOf(current),
        document: { schemaVersion: 1, module: "social", data: docFor(current) },
      },
    })
      .then(() => setSaved(true))
      .catch(() => undefined);
    // nur bei geändertem Inhalt speichern
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedContent]);
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(id);
  }, [saved]);

  const setText = (slot: string, value: string) => {
    setExp({ kind: "idle" });
    setContent((c) => ({ ...c, texts: { ...c.texts, [slot]: value } }));
  };

  const pickImage = useCallback(
    async (slot: string, preset?: FileHandleInfo) => {
      try {
        const handle = preset ?? (await call("file_pick", { req: { purpose: "socialImage" } }))[0];
        if (!handle?.url) return;
        let relPath = `Motive/${handle.name}`;
        let url = handle.url;
        if (projectId) {
          const asset = await call("project_add_asset", { req: { projectId, handleId: handle.id, folder: "Motive" } });
          relPath = asset.relPath;
          url = asset.handle.url ?? handle.url;
        }
        const bmp = await createImageBitmap(await (await fetch(url)).blob());
        const focal: Point = { x: bmp.width / 2, y: bmp.height / 2 };
        bmp.close();
        setAssetUrls((m) => ({ ...m, [relPath]: url }));
        setContent((c) => ({ ...c, images: { ...c.images, [slot]: { relPath, focal } } }));
        setExp({ kind: "idle" });
      } catch (e) {
        push({ kind: "error", text: errorText(toAppError(e)).text });
      }
    },
    [projectId, push],
  );

  // Datei gezogen: erster Bild-Slot der gewählten Vorlage
  const dropSerial = useDrops((st) => st.serial);
  useEffect(() => {
    if (dropSerial === lastDrop.current) return;
    lastDrop.current = dropSerial;
    const h = useDrops.getState().handles[0];
    const slot = current ? imageSlots(current)[0]?.slot : undefined;
    if (h && slot) void pickImage(slot, h);
  }, [dropSerial, current, pickImage]);

  const setFocal = (slot: string, e: React.MouseEvent<HTMLElement>, size: { width: number; height: number }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const norm = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
    setContent((c) => {
      const cur = c.images[slot];
      if (!cur) return c;
      return { ...c, images: { ...c.images, [slot]: { ...cur, focal: denormalizeFocal(size, norm) } } };
    });
  };

  // Messung der gewählten Vorlage
  const currentRender = current ? renders.current.get(current.id) : undefined;
  const layout = currentRender?.layout ?? null;
  void renderTick;
  const warnings: SocialWarning[] = layout?.warnings ?? [];
  const fontMissing = warnings.find((w) => w.kind === "fontMissing");

  const warningText = (w: SocialWarning): string => {
    const formatName = s.formats[current?.format ?? "post"];
    switch (w.kind) {
      case "textInZone":
        return s.warn.textInZone(Math.round(w.overlapPx), s.zone[w.side], formatName);
      case "imageInZone":
        return s.warn.imageInZone(Math.round(w.overlapPx), s.zone[w.side], formatName);
      case "lowContrast":
        return s.warn.lowContrast(fmtNumber(w.ratio, 2));
      case "smallText":
        return s.warn.smallText(Math.round(w.sizePx), Math.round(w.minPx));
      case "lowResImage":
        return s.warn.lowResImage(Math.round(w.widthPx), Math.round(w.neededPx));
      case "textTruncated":
        return s.warn.textTruncated;
      case "missingRequiredImage":
        return s.warn.missingRequiredImage(s.content.slots[w.slot] ?? w.slot);
      case "fontMissing":
        return s.warn.fontMissing(w.family);
    }
  };

  const measureRows = useMemo(() => {
    if (!layout) return [];
    const zoneHits = warnings.filter(
      (w): w is Extract<SocialWarning, { kind: "textInZone" | "imageInZone" }> =>
        w.kind === "textInZone" || w.kind === "imageInZone",
    );
    const contrast = warnings.find(
      (w): w is Extract<SocialWarning, { kind: "lowContrast" }> => w.kind === "lowContrast",
    );
    const texts = layout.layers.filter((l) => l.type === "text" && l.lines.length > 0);
    const minPx = texts.reduce<number | null>(
      (m, l) => (l.type === "text" && (m === null || l.fontSizePx < m) ? l.fontSizePx : m),
      null,
    );
    const need = Math.round(MIN_TEXT_PX_AT_REFERENCE * (layout.size.width / REFERENCE_WIDTH_PX));
    const img = layout.layers.find((l) => l.type === "image" && l.crop !== null);
    const res = img && img.type === "image" && img.crop ? checkResolution(img.crop) : null;
    return [
      {
        id: "zone",
        ok: zoneHits.length === 0,
        label: s.measure.zone,
        lines: zoneHits.length === 0 ? [s.measure.zoneOk] : zoneHits.map(warningText),
      },
      {
        id: "contrast",
        ok: !contrast,
        label: s.measure.contrast,
        lines: [contrast ? s.measure.contrastBad(fmtNumber(contrast.ratio, 2)) : s.measure.contrastOk],
      },
      {
        id: "small",
        ok: minPx === null || minPx >= need,
        label: s.measure.smallest,
        lines: [minPx === null ? "—" : s.measure.smallestValue(Math.round(minPx), need)],
      },
      {
        id: "image",
        ok: res === null || res.sufficient,
        label: s.measure.image,
        lines: [
          res === null
            ? s.measure.imageNone
            : res.sufficient
              ? s.measure.imageOk(Math.round(res.availablePx))
              : s.measure.imageLow(Math.round(res.availablePx), Math.round(res.neededPx)),
        ],
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);
  const otherWarnings = warnings.filter(
    (w) => w.kind === "textTruncated" || w.kind === "missingRequiredImage" || w.kind === "fontMissing",
  );

  // Export
  const exportTargets = activeTemplates;
  const exportAll = useCallback(async () => {
    if (exportTargets.length === 0 || !projectId) return;
    setExp({ kind: "running", done: 0, total: exportTargets.length });
    const files: FileHandleInfo[] = [];
    try {
      for (const [i, tpl] of exportTargets.entries()) {
        const r = renders.current.get(tpl.id);
        if (!r?.layout) throw new Error("not-ready");
        const format = exportFormats[tpl.id] ?? DEFAULT_EXPORT[tpl.format];
        const blob = await renderSocialToBlob(r.layout, r.bitmaps, { format });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const projectName = projects.data?.find((p) => p.id === projectId)?.name ?? "projekt";
        const fileName = `${slug(projectName)}_${tpl.id}_${tpl.size.width}x${tpl.size.height}.${format === "png" ? "png" : "jpg"}`;
        const h = await exportSaveImage(bytes, {
          fileName,
          format,
          destination: { kind: "project", projectId, folder: "Export/Social" },
        });
        if (h) files.push(h);
        setExp({ kind: "running", done: i + 1, total: exportTargets.length });
      }
      setExp({ kind: "done", files });
      void qc.invalidateQueries({ queryKey: ["library_query"] });
    } catch (e) {
      setExp({
        kind: "error",
        message: e instanceof Error && e.message === "not-ready" ? s.loading : errorText(toAppError(e)).text,
      });
    }
  }, [exportTargets, projectId, exportFormats, projects.data, qc]);

  const summary = exportTargets.map((tpl) => {
    const f = exportFormats[tpl.id] ?? DEFAULT_EXPORT[tpl.format];
    return {
      label: s.formats[tpl.format],
      value: `${f === "png" ? "PNG" : "JPG"} ${tpl.size.width} × ${tpl.size.height}`,
    };
  });
  if (summary.length > 0) summary.push({ label: "sRGB", value: s.output.colorSpace });

  let state: OutputState;
  const label = tab === "all" ? s.output.labelAll : s.output.labelOne;
  if (exp.kind === "running") state = { kind: "running", label: s.output.exporting, progress: exp.done / exp.total };
  else if (exp.kind === "done") {
    const first = exp.files[0];
    state = {
      kind: "done",
      message: (
        <span className="soc__saved">
          <span>{s.output.saved(exp.files.length)}</span>
          <span className="t-mute">{exp.files.map((f) => f.name).join(" · ")}</span>
        </span>
      ),
      announce: s.output.announce(exp.files.length),
      actions: first ? (
        <Button
          onClick={() => void call("app_reveal", { req: { target: { kind: "fileHandle", handleId: first.id } } })}
        >
          {s.output.reveal}
        </Button>
      ) : null,
    };
  } else if (exp.kind === "error")
    state = {
      kind: "error",
      message: `${s.output.failed}: ${exp.message}`,
      announce: s.output.failed,
      actions: <Button onClick={() => setExp({ kind: "idle" })}>{s.output.again}</Button>,
    };
  else if (exportTargets.length === 0)
    state = {
      kind: "blocked",
      label,
      reason: s.output.needTemplate,
      onJump: () => document.querySelector<HTMLElement>('[data-testid^="tpl-"]')?.focus(),
    };
  else if (!projectId)
    state = { kind: "blocked", label, reason: s.output.needProject, onJump: () => void navigate("/start?neu=1") };
  else state = { kind: "ready", label, onRun: () => void exportAll() };

  const surround = settings.data?.ui.surround[theme === "ink" ? "ink" : "paper"] ?? "light";
  const surroundAttr = surround === "light" ? "hell" : surround === "mid" ? "mittel" : "dunkel";

  const onPreviewKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!(settings.data?.ui.singleKeyShortcuts ?? true)) return;
    if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      setZones((z) => !z);
    } else if (e.key === "g" || e.key === "G") {
      e.preventDefault();
      setGrid((g) => !g);
    }
  };

  const kdenlive = programs.data?.programs.find((p) => p.id === "kdenlive");
  const createKdenlive = () => {
    if (!projectId) return;
    if (!kdenlive || kdenlive.installations.length === 0) {
      push({
        kind: "info",
        text: s.output.kdenliveMissing,
        actionLabel: t.programs.actions.install,
        onAction: () => openInstall({ programId: "kdenlive" }),
      });
      return;
    }
    void call("project_new_file", {
      req: {
        projectId,
        templateId: "builtin:reel-kdenlive",
        fileName: `${slug(projects.data?.find((p) => p.id === projectId)?.name ?? "reel")}_reel`,
      },
    })
      .then((f) => call("project_open_file", { req: { projectId, relPath: f.ref.relPath } }))
      .then(() => push({ kind: "info", text: s.output.kdenliveDone }))
      .catch((e: unknown) => push({ kind: "error", text: errorText(toAppError(e)).text }));
  };

  const tabs = (
    <Segmented
      label={s.formatsLabel}
      value={tab}
      onChange={(v) => {
        setTab(v);
        setExp({ kind: "idle" });
      }}
      options={TAB_ORDER.map((id) => ({ value: id, label: `${s.formats[id]}${s.ratio[id] ? ` ${s.ratio[id]}` : ""}` }))}
    />
  );

  // Vorlagenliste des aktuellen Formats (Inspektor und Leerzustand)
  const formatForList = tab === "all" ? "post" : tab;
  const listTemplates = tab === "all" ? all : templatesOfFormat(formatForList);

  const templateList = (large: boolean): ReactNode => (
    <ul className={large ? "soc__tpls soc__tpls--large" : "soc__tpls"} aria-label={s.templates.label}>
      {listTemplates.map((tpl) => (
        <li key={tpl.id}>
          <button
            type="button"
            className="soc__tpl"
            aria-pressed={chosen[tpl.format] === tpl.id}
            onClick={() => {
              setChosen((c) => ({ ...c, [tpl.format]: tpl.id }));
              if (tab !== "all" && tab !== tpl.format) setTab(tpl.format);
              setExp({ kind: "idle" });
            }}
            data-testid={`tpl-${tpl.id}`}
          >
            <TemplateThumb template={tpl} assetUrls={assetUrls} logoUrls={logoUrls} />
            <span className="t-strong t-meta">{tpl.title}</span>
            <span className="t-data t-mute">{`${tpl.size.width} × ${tpl.size.height}`}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  const preview =
    activeTemplates.length === 0 ? (
      <div className="soc__empty" data-testid="social-empty">
        <p className="t-section">
          {templates.isPending ? s.loading : listTemplates.length === 0 ? s.empty.none : s.empty.title}
        </p>
        {listTemplates.length > 0 ? <p className="t-read">{s.empty.text}</p> : null}
        {templateList(true)}
      </div>
    ) : (
      <div
        className="soc__stage"
        tabIndex={0}
        data-autofocus
        onKeyDown={onPreviewKey}
        aria-label={s.title}
        role="group"
        data-testid="social-stage"
      >
        <div className="soc__tools" role="toolbar" aria-label={s.tools.group}>
          <IconButton
            icon={GlyphSafeZone}
            label={s.tools.zones}
            combo="s"
            pressed={zones}
            onClick={() => setZones((z) => !z)}
            data-testid="tool-zones"
          />
          <IconButton
            icon={IconGrid}
            label={s.tools.grid}
            combo="g"
            pressed={grid}
            onClick={() => setGrid((g) => !g)}
            data-testid="tool-grid"
            disabled={!activeTemplates.some((x) => x.gridCrop)}
          />
        </div>
        <div className={tab === "all" ? "soc__row soc__row--all" : "soc__row"}>
          {activeTemplates.map((tpl) => (
            <SocialPane
              key={tpl.id}
              template={tpl}
              doc={docs.get(tpl.id) ?? docFor(tpl)}
              assetUrls={assetUrls}
              logoUrls={logoUrls}
              showZones={zones}
              showGrid={grid}
              onRender={onRender}
              label={`${s.formats[tpl.format]}: ${tpl.title}`}
              large={tab !== "all"}
            />
          ))}
        </div>
      </div>
    );

  const slotsT = current ? textSlots(current) : [];
  const slotsI = current ? imageSlots(current) : [];
  const projectsList = projects.data ?? [];

  void GlyphSurround;
  void SOCIAL_FORMAT_SIZES;

  return (
    <Bench
      title={s.title}
      testId="screen-social"
      surround={surroundAttr}
      tools={
        <>
          {tabs}
          <ActionMenu entries={[{ id: "kdenlive", label: s.output.kdenlive, onSelect: createKdenlive }]} />
        </>
      }
      context={current ? <span className="t-data">{current.title}</span> : null}
      previewLabel={s.title}
      preview={preview}
      inspectorTitle={s.measure.title}
      inspector={
        <>
          {fontMissing && fontMissing.kind === "fontMissing" ? (
            <div className="section">
              <Notice
                kind="error"
                title={s.fontError.title(fontMissing.family)}
                actions={<Button onClick={() => void navigate("/programme")}>{s.warn.installFonts}</Button>}
                testId="font-error"
              >
                {s.fontError.text}
              </Notice>
            </div>
          ) : null}
          {current ? (
            <div className="section stack" data-testid="social-measure">
              <Verdict
                kind={warnings.length > 0 ? "warn" : "ok"}
                word={warnings.length > 0 ? s.verdict.warn : s.verdict.ok}
                count={warnings.length > 0 ? s.measure.count(warnings.length) : s.measure.summaryNone}
                testId="social-verdict"
              />
              <ul className="mlist">
                {measureRows.map((r) => (
                  <li key={r.id} className="mrow" data-state={r.ok ? "ok" : "warn"} data-testid={`measure-${r.id}`}>
                    <span className={r.ok ? "mrow__g mrow__g--ok" : "mrow__g mrow__g--warn"}>
                      <StatusGlyph kind={r.ok ? "ok" : "warn"} />
                    </span>
                    <span className="t-strong">{r.label}</span>
                    {r.lines.map((l, i) => (
                      <span key={i} className={r.ok ? "t-data mrow__line" : "t-meta mrow__line"}>
                        {l}
                      </span>
                    ))}
                  </li>
                ))}
                {otherWarnings.map((w, i) => (
                  <li key={`o${i}`} className="mrow" data-state="warn">
                    <span className="mrow__g mrow__g--warn">
                      <StatusGlyph kind="warn" />
                    </span>
                    <span className="t-meta">{warningText(w)}</span>
                  </li>
                ))}
              </ul>
              {warnings.length > 0 ? <p className="t-meta t-mute">{s.warn.exportAnyway}</p> : null}
            </div>
          ) : null}
          {current ? (
            <div className="section stack">
              <h3 className="t-section">{s.templates.title}</h3>
              {templateList(false)}
            </div>
          ) : null}
          {current ? (
            <>
              <div className="section stack stack--loose" data-testid="social-content">
                <div className="cluster">
                  <h3 className="t-section">{s.content.title}</h3>
                  {saved ? (
                    <span className="t-meta status status--ok" role="status">
                      {s.content.saved}
                    </span>
                  ) : null}
                </div>
                {projectsList.length === 0 ? (
                  <p className="t-meta t-mute">{s.content.noProject}</p>
                ) : (
                  <SelectField
                    label={s.content.projectLabel}
                    value={projectId}
                    onChange={setProjectId}
                    options={projectsList.map((p) => ({ value: p.id, label: p.name }))}
                  />
                )}
                {slotsT.map((sl) => (
                  <Field
                    key={sl.slot}
                    label={s.content.slots[sl.slot] ?? s.content.slotFallback(sl.slot)}
                    htmlFor={`slot-${sl.slot}`}
                  >
                    <input
                      id={`slot-${sl.slot}`}
                      className="input"
                      value={content.texts[sl.slot] ?? sl.defaultText}
                      onChange={(e) => setText(sl.slot, e.target.value)}
                      data-testid={`slot-${sl.slot}`}
                      maxLength={160}
                    />
                  </Field>
                ))}
                {slotsI.map((sl) => {
                  const img = content.images[sl.slot];
                  const url = img ? assetUrls[img.relPath] : undefined;
                  return (
                    <div key={sl.slot} className="stack">
                      <span className="t-label">
                        {s.content.slots[sl.slot] ?? sl.slot}
                        {sl.required ? ` · ${s.content.required}` : ""}
                      </span>
                      {url && img ? (
                        <>
                          <FocalPicker url={url} focal={img.focal} onPick={(e, size) => setFocal(sl.slot, e, size)} />
                          <p className="t-meta t-mute">{s.content.focalHelp}</p>
                        </>
                      ) : null}
                      <div className="cluster">
                        <Button onClick={() => void pickImage(sl.slot)} data-testid={`pick-${sl.slot}`}>
                          {img ? s.content.changeImage : s.content.chooseImage}
                        </Button>
                        {img ? (
                          <Button
                            variant="text"
                            onClick={() => setContent((c) => ({ ...c, images: { ...c.images, [sl.slot]: null } }))}
                          >
                            {s.content.removeImage}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="section stack">
                <h3 className="t-section">{s.world.title}</h3>
                <Segmented
                  label={s.world.label}
                  value={world ?? ""}
                  onChange={(v) => setWorld(v || null)}
                  options={worlds.map((w) => ({ value: w.id, label: w.name }))}
                />
                <p className="t-meta t-mute">{s.world.help}</p>
              </div>
              <div className="section stack">
                <h3 className="t-section">{s.export.title}</h3>
                <Field label={s.export.format}>
                  <Segmented
                    label={s.export.format}
                    value={exportFormats[current.id] ?? DEFAULT_EXPORT[current.format]}
                    onChange={(v) => {
                      setExportFormats((m) => ({ ...m, [current.id]: v }));
                      setExp({ kind: "idle" });
                    }}
                    options={[
                      { value: "png", label: s.export.png },
                      { value: "jpeg", label: s.export.jpeg },
                    ]}
                  />
                </Field>
                <p className="t-meta t-mute">{s.export.help}</p>
              </div>
            </>
          ) : (
            <p className="section t-meta t-mute">{s.empty.inspector}</p>
          )}
        </>
      }
      output={
        <OutputBar
          target={s.output.target}
          summary={summary.length > 0 ? summary : [{ label: s.output.target, value: "—" }]}
          state={state}
          testId="social-output"
        />
      }
    />
  );
}

function FocalPicker({
  url,
  focal,
  onPick,
}: {
  url: string;
  focal: Point;
  onPick: (e: React.MouseEvent<HTMLElement>, size: { width: number; height: number }) => void;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const norm = size ? normalizeFocal(size, focal) : { x: 0.5, y: 0.5 };
  return (
    <div
      className="focal"
      role="button"
      tabIndex={0}
      aria-label={s.content.focal}
      onClick={(e) => size && onPick(e, size)}
      onKeyDown={(e) => {
        if (!size) return;
        if (e.key === "Enter" || e.key === " ") e.preventDefault();
      }}
      data-testid="focal-picker"
    >
      <img
        src={url}
        alt=""
        onLoad={(e) => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
      />
      <span className="focal__mark" style={{ left: `${norm.x * 100}%`, top: `${norm.y * 100}%` }} aria-hidden="true" />
    </div>
  );
}

void MIN_TEXT_CONTRAST;
