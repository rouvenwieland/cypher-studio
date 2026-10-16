import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import type { FileHandleInfo, GarmentColor, HexColor, MockupDocument, MockupTemplate, Size } from "@contract";
import { call, exportSaveImage } from "../../ipc/commands";
import { useCmd } from "../../ipc/queries";
import { toAppError } from "../../ipc/errors";
import { errorText } from "../../i18n/errors";
import { ellipsizePath, fmtNumber } from "../../i18n/format";
import { t } from "../../i18n/de";
import { useDrops, useToasts } from "../../app/stores";
import { useEffectiveTheme, useSettings } from "../../app/theme";
import { useDebounced } from "../../lib/useDebounced";
import { Notice } from "../../ui/Bits";
import { Button, IconButton } from "../../ui/Button";
import { Bench } from "../../ui/Frames";
import { Checkbox, Field, Segmented, SelectField, SwatchGroup } from "../../ui/Inputs";
import { GlyphSurround, IconGrid } from "../../ui/icons";
import { OutputBar, type OutputState } from "../../ui/OutputBar";
import { StatusGlyph } from "../../ui/Status";
import { LOW_SHARE_WARN, lowContrastShare, sampleDesign, type DesignSample } from "./designTone";
import {
  createMockupRenderer,
  isAbortError,
  isMockupEngineError,
  type MockupRenderInput,
  type MockupRendererHandle,
} from "./engine";
import "./mockup.css";

const m = t.mockup;
const OUT_SIZES: Record<string, { size: Size; name: string }> = {
  shop: { size: { width: 2000, height: 2500 }, name: "Shop 4:5" },
  post: { size: { width: 1080, height: 1350 }, name: "Post 4:5" },
  story: { size: { width: 1080, height: 1920 }, name: "Story 9:16" },
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

function BitmapCanvas({ bitmap, label }: { bitmap: ImageBitmap | null; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || !bitmap) return;
    c.getContext("2d")?.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  // Größe schon beim ersten Zeichnen setzen (sonst stünde kurz die Standardgröße 300 × 150 im Layout)
  return (
    <canvas
      ref={ref}
      className="mock__canvas"
      role="img"
      aria-label={label}
      {...(bitmap ? { width: bitmap.width, height: bitmap.height } : {})}
    />
  );
}

export default function Mockup() {
  const navigate = useNavigate();
  const push = useToasts((s) => s.push);
  const settings = useSettings();
  const theme = useEffectiveTheme(settings.data?.ui);
  const templates = useCmd("mockup_templates_list", undefined, { staleTime: 60_000 });
  const brand = useCmd("brand_get", undefined, { staleTime: 60_000 });
  const profiles = useCmd("print_profiles_list", undefined, { staleTime: 60_000 });
  const projects = useCmd("projects_list", undefined, { retry: false });

  const [product, setProduct] = useState<"tee" | "hoodie">("tee");
  const [view, setView] = useState<"front" | "back">("front");
  const [colorId, setColorId] = useState("schwarz");
  const [exportColors, setExportColors] = useState<string[]>(["schwarz"]);
  const [design, setDesign] = useState<{ handle: FileHandleInfo; url: string; relPath: string | null } | null>(null);
  const [widthMm, setWidthMm] = useState(280);
  const [topMm, setTopMm] = useState(60);
  const [centerMm, setCenterMm] = useState(0);
  const [stage, setStage] = useState("transparent");
  const [outId, setOutId] = useState("shop");
  const [contact, setContact] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [contactBitmaps, setContactBitmaps] = useState<Record<string, ImageBitmap>>({});
  const [renderError, setRenderError] = useState<string | null>(null);
  const [sample, setSample] = useState<DesignSample | null>(null);
  const [dismissedAlpha, setDismissedAlpha] = useState(false);
  const [exp, setExp] = useState<
    | { kind: "idle" }
    | { kind: "running"; done: number; total: number }
    | { kind: "done"; files: FileHandleInfo[] }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const rendererRef = useRef<MockupRendererHandle | null>(null);
  const lastDrop = useRef(useDrops.getState().serial);

  const all = useMemo(() => templates.data ?? [], [templates.data]);
  const products = new Set(all.map((x) => x.product));
  const template: MockupTemplate | undefined =
    all.find((x) => x.product === product && x.view === view) ?? all.find((x) => x.product === product) ?? all[0];
  const profile = profiles.data?.find((p) => p.id === template?.printProfileId);
  const garments = useMemo(() => {
    const ids = new Set(template?.variants.flatMap((v) => v.colorIds) ?? []);
    return (brand.data?.garmentColors ?? []).filter((g) => ids.has(g.id));
  }, [template, brand.data]);
  const garment: GarmentColor | undefined = garments.find((g) => g.id === colorId) ?? garments[0];

  useEffect(() => {
    if (garments.length > 0 && !garments.some((g) => g.id === colorId)) setColorId(garments[0]?.id ?? "");
  }, [garments, colorId]);
  useEffect(() => {
    const first = projects.data?.[0];
    if (first && !projectId) setProjectId(first.id);
  }, [projects.data, projectId]);

  // Renderer: ein Worker je Bildschirm
  useEffect(() => {
    const r = createMockupRenderer();
    rendererRef.current = r;
    return () => {
      r.dispose();
      rendererRef.current = null;
    };
  }, []);

  const paperHex = brand.data?.palettes.flatMap((p) => p.colors).find((c) => c.name === "Papier")?.hex;
  const stages = useMemo(() => {
    const out: { id: string; label: string; bg: MockupDocument["background"] }[] = [
      { id: "transparent", label: m.stage.options.transparent, bg: { kind: "transparent" } },
      ...(paperHex
        ? [{ id: "paper", label: m.stage.options.paper, bg: { kind: "color" as const, hex: paperHex } }]
        : []),
      { id: "template", label: m.stage.options.template, bg: { kind: "template" } },
    ];
    for (const c of brand.data?.collections ?? []) {
      const key = c.id === "gold-lounge" ? "gold" : c.id;
      const label = (m.stage.options as Record<string, string>)[key] ?? c.name;
      out.push({ id: c.id, label, bg: { kind: "color", hex: c.hex } });
    }
    return out;
  }, [brand.data, paperHex]);
  const background = useMemo(
    () => stages.find((x) => x.id === stage)?.bg ?? { kind: "transparent" as const },
    [stages, stage],
  );
  const out = OUT_SIZES[outId] ?? OUT_SIZES["shop"];
  if (!out) throw new Error("Ausgabegröße fehlt");

  const inputFor = useCallback(
    (g: GarmentColor): MockupRenderInput | null => {
      if (!template || !profile) return null;
      return {
        template,
        colorId: g.id,
        garment: g,
        printAreaMm: profile.printAreaMm,
        designUrl: design?.url ?? null,
        placement: { widthMm, offsetTopMm: topMm, offsetCenterMm: centerMm },
        background,
        output: out.size,
      };
    },
    [template, profile, design, widthMm, topMm, centerMm, background, out.size],
  );

  // Vorschau in halber Auflösung, entprellt
  const previewKey = useDebounced(
    JSON.stringify([template?.id, garment?.id, design?.url, widthMm, topMm, centerMm, background, outId]),
    60,
  );
  useEffect(() => {
    const r = rendererRef.current;
    const input = garment ? inputFor(garment) : null;
    if (!r || !input) return;
    const ctl = new AbortController();
    setRenderError(null);
    r.render(input, { scale: 0.5, signal: ctl.signal })
      .then((bmp) => {
        if (ctl.signal.aborted) {
          bmp.close();
          return;
        }
        setBitmap((prev) => {
          prev?.close();
          return bmp;
        });
      })
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        setRenderError(isMockupEngineError(e) ? m.errors[e.code] : errorText(toAppError(e)).text);
      });
    return () => ctl.abort();
    // previewKey bündelt alle Eingaben der Vorschau
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, inputFor]);

  // Kontaktbogen: alle Textilfarben, Feld für Feld (echtes Rendern)
  useEffect(() => {
    if (!contact) return;
    const r = rendererRef.current;
    if (!r || !template) return;
    const ctl = new AbortController();
    setContactBitmaps({});
    void (async () => {
      for (const g of garments) {
        const input = inputFor(g);
        if (!input || ctl.signal.aborted) return;
        try {
          const bmp = await r.render(input, { scale: 0.25, signal: ctl.signal });
          if (ctl.signal.aborted) {
            bmp.close();
            return;
          }
          setContactBitmaps((cur) => ({ ...cur, [g.id]: bmp }));
        } catch {
          return;
        }
      }
    })();
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact, previewKey, garments]);

  // Motiv wählen, ziehen
  const setDesignFromHandle = useCallback(
    async (handle: FileHandleInfo) => {
      if (!handle.url) return;
      let relPath: string | null = null;
      let url = handle.url;
      if (projectId) {
        try {
          const asset = await call("project_add_asset", { req: { projectId, handleId: handle.id, folder: "Motive" } });
          relPath = asset.relPath;
          url = asset.handle.url ?? handle.url;
        } catch {
          /* Motiv bleibt trotzdem nutzbar */
        }
      }
      setDesign({ handle, url, relPath });
      setExp({ kind: "idle" });
      setDismissedAlpha(false);
      setSample(null);
      void sampleDesign(url)
        .then(setSample)
        .catch(() => setSample(null));
    },
    [projectId],
  );
  const pickDesign = useCallback(() => {
    void call("file_pick", { req: { purpose: "mockupDesign" } })
      .then((hs) => {
        if (hs[0]) void setDesignFromHandle(hs[0]);
      })
      .catch((e: unknown) => push({ kind: "error", text: errorText(toAppError(e)).title }));
  }, [push, setDesignFromHandle]);
  useEffect(() => {
    window.addEventListener("cypher:open-file", pickDesign);
    return () => window.removeEventListener("cypher:open-file", pickDesign);
  }, [pickDesign]);
  const dropSerial = useDrops((s) => s.serial);
  useEffect(() => {
    const s = useDrops.getState();
    if (s.serial > 0 && !design && s.handles[0]) void setDesignFromHandle(s.handles[0]);
    // nur beim Einstieg
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (dropSerial === lastDrop.current) return;
    lastDrop.current = dropSerial;
    const h = useDrops.getState().handles[0];
    if (h) void setDesignFromHandle(h);
  }, [dropSerial, setDesignFromHandle]);

  // Dokument im Projekt ablegen (entprellt)
  const saveKey = useDebounced(
    JSON.stringify([template?.id, colorId, design?.relPath, widthMm, topMm, centerMm, stage, outId]),
    1000,
  );
  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    if (!template || !projectId || !design?.relPath) return;
    const doc: MockupDocument = {
      templateId: template.id,
      colorId,
      design: { relPath: design.relPath },
      placement: { widthMm, offsetTopMm: topMm, offsetCenterMm: centerMm },
      background,
      exportSizePx: out.size,
    };
    void call("project_write_document", {
      req: {
        projectId,
        relPath: `Mockups/${slug(design.handle.name)}.mockup.json`,
        document: { schemaVersion: 1, module: "mockup", data: doc },
      },
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveKey]);

  const noAlpha = sample !== null && sample.transparentShare < 0.01;
  const lowIds = new Set(
    sample ? garments.filter((g) => lowContrastShare(sample, g.hex) >= LOW_SHARE_WARN).map((g) => g.id) : [],
  );
  const watched = garments.filter((g) => g.id === garment?.id || exportColors.includes(g.id));
  const lowWatched = watched.filter((g) => lowIds.has(g.id));
  const lowContrast = lowWatched.length > 0;
  const areaWidth = profile?.printAreaMm.width ?? 330;
  const hasHoodie = products.has("hoodie");
  const hoodieMissing = !hasHoodie && !templates.isPending;
  // Die drei Messzeilen stehen immer da (offen, bis gemessen ist), damit der Inspektor nicht springt, wenn das Motiv kommt
  const waiting = design ? m.measure.measuring : m.measure.noDesign;
  const measureRows: { id: string; state: "ok" | "warn" | "open"; label: string; line: string }[] = [];
  if (design && profile) {
    const over = widthMm > areaWidth;
    measureRows.push({
      id: "width",
      state: over ? "warn" : "ok",
      label: m.measure.width,
      line: over ? m.measure.exceeds : m.measure.widthLine(fmtNumber(widthMm, 0), fmtNumber(areaWidth, 0)),
    });
  } else {
    measureRows.push({ id: "width", state: "open", label: m.measure.width, line: waiting });
  }
  if (design && sample) {
    measureRows.push({
      id: "alpha",
      state: noAlpha ? "warn" : "ok",
      label: m.measure.background,
      line: noAlpha ? m.measure.noAlpha : m.measure.alphaOk,
    });
    measureRows.push({
      id: "contrast",
      state: lowContrast ? "warn" : "ok",
      label: m.measure.contrast,
      line: lowContrast ? m.measure.contrastLow(lowWatched.map((g) => g.name).join(", ")) : m.measure.contrastOk,
    });
  } else {
    measureRows.push({ id: "alpha", state: "open", label: m.measure.background, line: waiting });
    measureRows.push({ id: "contrast", state: "open", label: m.measure.contrast, line: waiting });
  }
  if (hoodieMissing) measureRows.push({ id: "hoodie", state: "warn", label: m.product.hoodie, line: m.measure.hoodie });
  const targets = exportColors.filter((id) => garments.some((g) => g.id === id));
  const doExport = useCallback(async () => {
    const r = rendererRef.current;
    if (!r || !projectId || targets.length === 0) return;
    setExp({ kind: "running", done: 0, total: targets.length });
    const files: FileHandleInfo[] = [];
    try {
      for (const [i, id] of targets.entries()) {
        const g = garments.find((x) => x.id === id);
        const input = g ? inputFor(g) : null;
        if (!g || !input) continue;
        const blob = await r.toBlob(input, "image/png");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const base = design ? slug(design.handle.name.replace(/\.[^.]+$/, "")) : "mockup";
        const h = await exportSaveImage(bytes, {
          fileName: `${base}_${template?.product ?? "tee"}-${g.id}_mockup.png`,
          format: "png",
          destination: { kind: "project", projectId, folder: "Mockups" },
        });
        if (h) files.push(h);
        setExp({ kind: "running", done: i + 1, total: targets.length });
      }
      setExp({ kind: "done", files });
    } catch (e) {
      setExp({ kind: "error", message: isMockupEngineError(e) ? m.errors[e.code] : errorText(toAppError(e)).text });
    }
  }, [projectId, targets, garments, inputFor, design, template]);

  let state: OutputState;
  const summaryCount = targets.length;
  if (exp.kind === "running") state = { kind: "running", label: m.output.exporting, progress: exp.done / exp.total };
  else if (exp.kind === "done") {
    const first = exp.files[0];
    const folder = first ? ellipsizePath(first.displayPath.replace(/[\\/][^\\/]+$/, ""), 60) : "";
    state = {
      kind: "done",
      message: m.output.saved(exp.files.length, folder),
      announce: m.output.announce(exp.files.length),
      actions: (
        <>
          {first ? (
            <Button
              onClick={() => void call("app_reveal", { req: { target: { kind: "fileHandle", handleId: first.id } } })}
            >
              {m.output.reveal}
            </Button>
          ) : null}
          {first ? (
            <Button
              onClick={() => {
                useDrops.getState().push([first]);
                void navigate("/social");
              }}
              data-testid="mockup-to-social"
            >
              {m.output.toSocial}
            </Button>
          ) : null}
        </>
      ),
    };
  } else if (exp.kind === "error")
    state = {
      kind: "error",
      message: `${m.output.failed}: ${exp.message}`,
      announce: m.output.failed,
      actions: <Button onClick={() => setExp({ kind: "idle" })}>{m.output.again}</Button>,
    };
  else if (!design) state = { kind: "blocked", label: m.output.label, reason: m.output.needDesign, onJump: pickDesign };
  else if (targets.length === 0)
    state = { kind: "blocked", label: m.output.label, reason: m.output.needColor, onJump: () => undefined };
  else if (!projectId)
    state = {
      kind: "blocked",
      label: m.output.label,
      reason: m.output.needProject,
      onJump: () => void navigate("/start?neu=1"),
    };
  else state = { kind: "ready", label: m.output.label, onRun: () => void doExport() };

  const surround = settings.data?.ui.surround[theme === "ink" ? "ink" : "paper"] ?? "light";
  const surroundAttr = surround === "light" ? "hell" : surround === "mid" ? "mittel" : "dunkel";
  const setUi = (patch: Record<string, unknown>) => void call("settings_update", { req: { ui: patch } });
  const cycleSurround = () => {
    const order = ["light", "mid", "dark"] as const;
    const next = order[(order.indexOf(surround) + 1) % order.length] ?? "light";
    const key = theme === "ink" ? "ink" : "paper";
    setUi({ surround: { ...(settings.data?.ui.surround ?? { paper: "light", ink: "dark" }), [key]: next } });
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !(settings.data?.ui.singleKeyShortcuts ?? true)) return;
    if (e.key === "k" || e.key === "K") {
      e.preventDefault();
      setContact((c) => !c);
    } else if (e.key === "u" || e.key === "U") {
      e.preventDefault();
      cycleSurround();
    }
  };

  const views = new Set(all.filter((x) => x.product === product).map((x) => x.view));
  const presets = profile?.widthPresets ?? [];

  const toggleExport = (id: string, on: boolean) => {
    setExp({ kind: "idle" });
    setExportColors((cur) => (on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id)));
  };

  const preview = !template ? (
    <div className="mock__empty">
      <p className="t-read">{templates.isPending ? m.loading : m.empty.noTemplates}</p>
    </div>
  ) : (
    <div
      className="mock__stage"
      tabIndex={0}
      data-autofocus
      onKeyDown={onKey}
      role="group"
      aria-label={m.title}
      data-testid="mockup-stage"
    >
      <div className="mock__tools" role="toolbar" aria-label={m.tools.group}>
        <IconButton
          icon={IconGrid}
          label={m.contact.toggle}
          combo="k"
          pressed={contact}
          onClick={() => setContact((c) => !c)}
          data-testid="tool-contact"
        />
        <IconButton icon={GlyphSurround} label={m.tools.surround} combo="u" onClick={cycleSurround} />
      </div>
      {contact ? (
        <ul className="mock__contact" aria-label={m.contact.label} data-testid="contact-sheet">
          {garments.map((g) => (
            <li key={g.id} className="mock__tile" data-testid={`contact-${g.id}`}>
              <div className="mock__tile-img">
                {contactBitmaps[g.id] ? (
                  <BitmapCanvas bitmap={contactBitmaps[g.id] ?? null} label={g.name} />
                ) : (
                  <span className="t-data t-mute">{m.contact.rendering}</span>
                )}
              </div>
              <span className="t-meta t-strong">
                {g.name}
                {lowIds.has(g.id) ? (
                  <span className="mock__low">
                    <StatusGlyph kind="warn" /> {m.contact.lowContrast}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mock__shirt">
          {renderError ? (
            <Notice kind="error" title={renderError} role="alert" />
          ) : bitmap ? (
            <BitmapCanvas bitmap={bitmap} label={`${template.title}, ${garment?.name ?? ""}`} />
          ) : (
            <div className="mock__loading" role="status" aria-label={m.loading} />
          )}
          {!design ? (
            <div className="mock__hint" data-testid="mockup-empty">
              <p className="t-read">{m.design.none}</p>
              <Button variant="action" onClick={pickDesign} data-testid="mockup-pick">
                {m.design.choose}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );

  return (
    <Bench
      title={m.title}
      testId="screen-mockup"
      surround={surroundAttr}
      context={design ? <span className="t-data">{design.handle.name}</span> : null}
      tools={
        <Segmented
          label={m.product.label}
          value={product}
          onChange={(v) => setProduct(v)}
          options={[
            { value: "tee", label: m.product.tee },
            {
              value: "hoodie",
              label: m.product.hoodie,
              disabled: !hasHoodie,
              ...(!hasHoodie ? { title: m.product.hoodieMissing } : {}),
            },
          ]}
        />
      }
      previewLabel={m.title}
      preview={preview}
      inspectorTitle={m.measure.title}
      inspector={
        <>
          <div className="section stack" data-testid="mockup-measure">
            <ul className="mlist">
              {measureRows.map((r) => (
                <li key={r.id} className="mrow" data-state={r.state} data-testid={`measure-${r.id}`}>
                  <span className={`mrow__g mrow__g--${r.state}`}>
                    <StatusGlyph kind={r.state} />
                  </span>
                  <span className="t-strong">{r.label}</span>
                  <span className="t-data mrow__line">{r.line}</span>
                </li>
              ))}
            </ul>
            <p className="t-meta t-mute">
              {design ? `${m.measure.altLabel}: ${m.measure.altText(design.handle.name)}` : m.measure.empty}
            </p>
          </div>
          <div className="section stack stack--loose">
            <h3 className="t-section">{m.design.title}</h3>
            <div className="cluster">
              <Button onClick={pickDesign} data-testid="mockup-pick-side">
                {design ? m.design.change : m.design.choose}
              </Button>
            </div>
            {noAlpha && !dismissedAlpha ? (
              <Notice
                kind="warn"
                title={m.design.noAlphaTitle}
                testId="mockup-noalpha"
                actions={
                  <>
                    <Button
                      onClick={() => {
                        if (design) useDrops.getState().push([design.handle]);
                        void navigate("/freistellen");
                      }}
                    >
                      {m.design.cutout}
                    </Button>
                    <Button variant="text" onClick={() => setDismissedAlpha(true)}>
                      {m.design.showAnyway}
                    </Button>
                  </>
                }
              />
            ) : null}
          </div>
          <div className="section stack stack--loose">
            <h3 className="t-section">{m.color.title}</h3>
            {views.size > 1 ? (
              <Field label={m.view.label}>
                <Segmented
                  label={m.view.label}
                  value={view}
                  onChange={setView}
                  options={[
                    { value: "front", label: m.view.front, disabled: !views.has("front") },
                    { value: "back", label: m.view.back, disabled: !views.has("back") },
                  ]}
                />
              </Field>
            ) : null}
            <SwatchGroup
              label={m.color.label}
              value={garment?.id ?? ""}
              onChange={(id) => {
                setColorId(id);
                setExp({ kind: "idle" });
              }}
              options={garments.map((g) => ({ value: g.id, name: g.name, color: g.hex, on: g.textOnGarment }))}
            />
            <p className="t-meta" data-testid="mockup-color-name">
              {garment?.name}
              {garment?.providerColorName ? <span className="t-mute"> · {garment.providerColorName}</span> : null}
            </p>
            <fieldset className="mock__export">
              <legend className="t-label">{m.color.export}</legend>
              {garments.map((g) => (
                <Checkbox key={g.id} checked={exportColors.includes(g.id)} onChange={(on) => toggleExport(g.id, on)}>
                  {g.name}
                </Checkbox>
              ))}
            </fieldset>
          </div>
          <div className="section stack stack--loose">
            <h3 className="t-section">{m.placement.title}</h3>
            {presets.length > 0 ? (
              <Field label={m.placement.presetLabel}>
                <Segmented
                  label={m.placement.presetLabel}
                  value={presets.find((p) => Math.abs(p.widthMm - widthMm) < 0.5)?.id ?? ""}
                  onChange={(id) => {
                    const p = presets.find((x) => x.id === id);
                    if (p) setWidthMm(p.widthMm);
                  }}
                  options={presets.map((p) => ({ value: p.id, label: p.label }))}
                />
              </Field>
            ) : null}
            <MmField
              label={m.placement.width}
              value={widthMm}
              min={20}
              max={Math.round(areaWidth + 40)}
              onChange={setWidthMm}
              testId="mockup-width"
            />
            <MmField label={m.placement.top} value={topMm} min={0} max={450} onChange={setTopMm} />
            <MmField label={m.placement.center} value={centerMm} min={-120} max={120} onChange={setCenterMm} />
            <p className="t-meta t-mute">{m.placement.help}</p>
            <SelectField
              label={m.stage.label}
              value={stage}
              onChange={setStage}
              options={stages.map((x) => ({ value: x.id, label: x.label }))}
            />
            <SelectField
              label={m.size.label}
              value={outId}
              onChange={setOutId}
              options={[
                { value: "shop", label: m.size.shop },
                { value: "post", label: m.size.post },
                { value: "story", label: m.size.story },
              ]}
            />
            {projects.data && projects.data.length > 0 ? (
              <SelectField
                label={m.output.project}
                value={projectId}
                onChange={setProjectId}
                options={projects.data.map((p) => ({ value: p.id, label: p.name }))}
              />
            ) : null}
          </div>
        </>
      }
      output={
        <OutputBar
          target={m.output.target}
          summary={[
            { label: m.output.target, value: m.output.images(summaryCount) },
            { label: m.output.format, value: m.output.format },
            { label: m.size.label, value: m.output.sizeLine(out.size.width, out.size.height, out.name) },
          ]}
          state={state}
          testId="mockup-output"
        />
      }
    />
  );
}

function MmField({
  label,
  value,
  min,
  max,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  testId?: string;
}) {
  const [text, setText] = useState(String(value));
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setText(String(Math.round(value * 10) / 10).replace(".", ","));
  }
  return (
    <Field label={label} htmlFor={`mm-${label}`}>
      <div className="input-group">
        <input
          id={`mm-${label}`}
          className="input input--mono"
          inputMode="decimal"
          value={text}
          data-testid={testId}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number.parseFloat(e.target.value.replace(",", "."));
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
          }}
          onBlur={() => setText(String(Math.round(value * 10) / 10).replace(".", ","))}
        />
        <span className="input-group__unit">{t.common.unitMm}</span>
      </div>
    </Field>
  );
}

void ({} as HexColor);
