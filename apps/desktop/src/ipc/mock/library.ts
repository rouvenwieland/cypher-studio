/** Bibliothek, Projekte und Vorlagen für den Mock-Modus. */
import type {
  LibraryEntry,
  LibraryFacets,
  LibraryKind,
  LibraryPage,
  LibraryQuery,
  Project,
  TemplateInfo,
} from "@contract";
import { thumbDataUrl, templatePreviewUrl } from "./art";
import { COLLECTIONS, LIBRARY_ROOT } from "./fixtures";
import { mulberry32, pick, shuffle, uuid } from "./rng";

const KIND_WEIGHTS_3104: Record<LibraryKind, number> = {
  image: 1840,
  vector: 412,
  model3d: 96,
  video: 38,
  document: 300,
  palette: 24,
  font: 36,
  audio: 18,
  other: 340,
};

const EXT: Record<LibraryKind, string[]> = {
  image: ["png", "png", "png", "kra", "jpg", "webp"],
  vector: ["svg"],
  model3d: ["blend"],
  video: ["mp4", "kdenlive"],
  document: ["pdf", "md", "txt"],
  palette: ["kpl", "gpl"],
  font: ["ttf", "otf"],
  audio: ["wav", "mp3"],
  other: ["zip", "json"],
};

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  kra: "application/x-krita",
  svg: "image/svg+xml",
  blend: "application/x-blender",
  mp4: "video/mp4",
  kdenlive: "application/x-kdenlive",
  pdf: "application/pdf",
  md: "text/markdown",
  txt: "text/plain",
  kpl: "application/x-krita-palette",
  gpl: "application/x-gimp-palette",
  ttf: "font/ttf",
  otf: "font/otf",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  zip: "application/zip",
  json: "application/json",
};

const OPEN_WITH: Record<string, string> = { kra: "krita", png: "krita", jpg: "krita", webp: "krita", svg: "inkscape", blend: "blender", mp4: "kdenlive", kdenlive: "kdenlive" };
const MOTIFS = ["signal", "rauschen", "poster", "cover", "logo", "muster", "skizze", "drop", "kampagne", "story", "reel", "hoodie", "shirt", "lookbook", "textur", "wellenform"];
const SUFFIX = ["v1", "v2", "v3", "final", "entwurf", "a2", "vorne", "hinten", "2k", "4k", "alt"];
const TAGS = ["entwurf", "druck", "social", "shirt", "hoodie", "logo", "foto", "cover", "archiv", "schrift", "textur"];
const AUTHORS = ["Lena", "Jonas", "Mira", "Tarek", "Ida"];

export const PROJECT_NAMES = [
  ["Herbst-Drop 26", "rauschen", "rauschen_signal_v3.kra", 14, 8],
  ["Mittelwelle-Poster", "mittelwelle", "mittelwelle_poster_a2.svg", 6, 26],
  ["Contenance-Kampagne", "gold-lounge", "gold-lounge_cover_v2.kra", 9, 4 * 24 * 60],
  ["Rauschen Sticker", "rauschen", "rauschen_sticker_final.svg", 4, 6 * 24 * 60],
  ["Merch-Test Hoodie", null, "hoodie_vorne_entwurf.kra", 7, 9 * 24 * 60],
  ["Studio-Intro Reel", "mittelwelle", "intro_reel_v2.kdenlive", 11, 12 * 24 * 60],
  ["Lookbook Winter", "gold-lounge", "lookbook_winter_v1.kra", 23, 20 * 24 * 60],
  ["Konzert-Flyer Oktober", "rauschen", "flyer_oktober_a5.svg", 5, 25 * 24 * 60],
  ["Textil-Farbtest", null, "textilfarben_test.png", 3, 31 * 24 * 60],
  ["Logo-Überarbeitung", null, "logo_cypher_v7.svg", 18, 40 * 24 * 60],
  ["Tour-Teaser", "mittelwelle", "teaser_story_v1.kdenlive", 8, 52 * 24 * 60],
  ["Archiv 2025", null, "archiv_index.txt", 142, 190 * 24 * 60],
] as const;

export function projectsSeed(now: Date): Project[] {
  return PROJECT_NAMES.map(([name, collection, lastFile, fileCount, minutesAgo], i) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const ext = lastFile.split(".").pop() ?? "";
    const when = new Date(now.getTime() - minutesAgo * 60_000).toISOString();
    return {
      id: `proj-${slug}`,
      name,
      collection,
      dir: `${LIBRARY_ROOT}\\Projekte\\${name}`,
      inLibrary: true,
      fileCount,
      lastFile: {
        relPath: `Motive/${lastFile}`,
        modifiedAt: when,
        programId: OPEN_WITH[ext] ?? null,
        module: null,
      },
      createdAt: new Date(now.getTime() - (minutesAgo + 60 * 24 * (20 + i)) * 60_000).toISOString(),
      updatedAt: when,
      missing: false,
    };
  });
}

export function templatesSeed(): TemplateInfo[] {
  const mk = (
    id: string,
    title: string,
    description: string,
    programId: string,
    ext: string,
    folder: TemplateInfo["folder"],
    w: number,
    h: number,
    label: string,
    mm: { w: number; h: number } | null,
    printProfileId: string | null,
    accent: string,
  ): TemplateInfo => ({
    id: `builtin:${id}`,
    title,
    description,
    target: "program",
    programId,
    format: { label, widthPx: w, heightPx: h, dpi: mm ? 300 : null, widthMm: mm?.w ?? null, heightMm: mm?.h ?? null },
    aspect: w / h,
    folder,
    fileExtension: ext,
    printProfileId,
    previewUrl: templatePreviewUrl(w / h, accent),
    source: "builtin",
    requiresSetup: true,
    tags: [],
  });
  return [
    mk("shirt-krita", "Shirt vorne", "Druckfläche für das Unisex-Shirt, 300 dpi.", "krita", ".kra", "Motive", 3898, 5315, "330 × 450 mm", { w: 330, h: 450 }, "shirtigo-tee-front", "#7a7974"),
    mk("hoodie-krita", "Hoodie vorne", "Druckfläche für den Hoodie, es gilt die strengere Höhe.", "krita", ".kra", "Motive", 3898, 3307, "330 × 280 mm", { w: 330, h: 280 }, "shirtigo-hoodie-front", "#7a7974"),
    mk("post-krita", "Post", "Feed-Beitrag 4:5.", "krita", ".kra", "Motive", 1080, 1350, "1080 × 1350", null, null, "#7a7974"),
    mk("story-krita", "Story", "Hochformat 9:16 mit Sicherheitszonen.", "krita", ".kra", "Motive", 1080, 1920, "1080 × 1920", null, null, "#7a7974"),
    mk("reel-kdenlive", "Reel", "Videoprojekt 1080 × 1920 bei 30 fps.", "kdenlive", ".kdenlive", "Video", 1080, 1920, "1080 × 1920", null, null, "#7a7974"),
    mk("poster-inkscape", "Poster A2", "Seite in Millimetern, 300 dpi Export.", "inkscape", ".svg", "Motive", 4961, 7016, "420 × 594 mm", { w: 420, h: 594 }, null, "#7a7974"),
    mk("sticker-inkscape", "Sticker", "Quadrat mit Schnittkontur.", "inkscape", ".svg", "Motive", 1181, 1181, "100 × 100 mm", { w: 100, h: 100 }, null, "#7a7974"),
  ];
}

interface BaseEntry extends Omit<LibraryEntry, "thumbnailUrl"> {
  hasThumb: boolean;
}

export interface LibraryModel {
  entries: BaseEntry[];
}

export function generateLibrary(count: number, now: Date, projects: Project[]): LibraryModel {
  const rnd = mulberry32(2610);
  const total = Object.values(KIND_WEIGHTS_3104).reduce((a, b) => a + b, 0);
  const kinds: LibraryKind[] = [];
  for (const [kind, weight] of Object.entries(KIND_WEIGHTS_3104) as [LibraryKind, number][]) {
    const n = Math.round((weight / total) * count);
    for (let i = 0; i < n; i++) kinds.push(kind);
  }
  while (kinds.length < count) kinds.push("image");
  kinds.length = count;
  const order = shuffle(kinds, rnd);

  // Kollektionen: 610 / 230 / 118 von 3104 (verhältnisgleich)
  const collShare = [610 / 3104, 230 / 3104, 118 / 3104];
  const tagCounts = new Map<string, number>();
  const entries: BaseEntry[] = [];
  for (let i = 0; i < count; i++) {
    const kind = order[i] ?? "image";
    const ext = pick(EXT[kind], rnd);
    const r = rnd();
    let collection: string | null = null;
    if (r < collShare[0]!) collection = "rauschen";
    else if (r < collShare[0]! + collShare[1]!) collection = "mittelwelle";
    else if (r < collShare[0]! + collShare[1]! + collShare[2]!) collection = "gold-lounge";
    const project = rnd() < 0.55 ? pick(projects, rnd) : null;
    const stem = `${collection ?? "cypher"}_${pick(MOTIFS, rnd)}_${pick(SUFFIX, rnd)}`;
    const conflict = rnd() < 0.012;
    const fileName = conflict ? `${stem} (Konfliktkopie Jonas 2026-10-14).${ext}` : `${stem}.${ext}`;
    const folder = project ? `Projekte/${project.name}/Motive` : pick(["Archiv", "Material", "Fotos", "Schriften"], rnd);
    const minutesAgo = Math.floor(Math.pow(rnd(), 2.4) * 400 * 24 * 60) + i / 40;
    const modified = new Date(now.getTime() - minutesAgo * 60_000).toISOString();
    const tags: string[] = [];
    const tagRoll = rnd();
    if (tagRoll < 0.5) tags.push(pick(TAGS, rnd));
    if (tagRoll < 0.18) tags.push(pick(TAGS, rnd));
    if (rnd() < 0.021) tags.push("final");
    const uniqueTags = [...new Set(tags)];
    for (const tg of uniqueTags) tagCounts.set(tg, (tagCounts.get(tg) ?? 0) + 1);
    const isRaster = kind === "image" || kind === "vector";
    const w = isRaster ? pick([1080, 1350, 1920, 2400, 3307, 3898, 4961], rnd) : null;
    const h = isRaster && w ? Math.round(w * pick([0.5625, 0.75, 1, 1.25, 1.41, 1.78], rnd)) : null;
    const hasThumb = kind === "image" || kind === "vector" || kind === "video" || (kind === "model3d" && rnd() < 0.7);
    const size = Math.floor(
      kind === "video" ? 30e6 + rnd() * 400e6 : kind === "model3d" ? 2e6 + rnd() * 90e6 : kind === "font" ? 80e3 + rnd() * 600e3 : kind === "palette" ? 2e3 + rnd() * 20e3 : 80e3 + rnd() * 18e6,
    );
    entries.push({
      id: uuid(rnd),
      kind,
      relPath: `${folder}/${fileName}`,
      fileName,
      mime: MIME[ext] ?? "application/octet-stream",
      size,
      modifiedAt: modified,
      widthPx: w,
      heightPx: h,
      projectId: project && folder.startsWith("Projekte/") ? project.id : null,
      openWith: OPEN_WITH[ext] ?? null,
      meta: {
        title: stem,
        tags: uniqueTags,
        collection,
        author: pick(AUTHORS, rnd),
        status: rnd() < 0.2 ? "approved" : "draft",
        notes: "",
        colors: [],
        printProfileId: null,
        garmentColorIds: [],
        createdAt: modified,
        updatedAt: modified,
      },
      conflict: conflict ? { kind: "syncConflictCopy", originalRelPath: `${folder}/${stem}.${ext}` } : null,
      sidecarMissing: rnd() < 0.3,
      hasThumb,
    });
  }
  return { entries };
}

function accentOf(collection: string | null): string | null {
  return COLLECTIONS.find((c) => c.id === collection)?.hex ?? null;
}

export function toEntry(e: BaseEntry): LibraryEntry {
  const { hasThumb, ...rest } = e;
  return { ...rest, thumbnailUrl: hasThumb ? thumbDataUrl(e.id, e.kind, accentOf(e.meta.collection)) : null };
}

function matches(e: BaseEntry, q: LibraryQuery, skip: "kinds" | "collections" | "tags" | null): boolean {
  if (q.text) {
    const text = q.text.toLowerCase();
    if (!(e.fileName.toLowerCase().includes(text) || e.meta.tags.some((t) => t.includes(text)) || e.relPath.toLowerCase().includes(text))) return false;
  }
  if (skip !== "kinds" && q.kinds?.length && !q.kinds.includes(e.kind)) return false;
  if (skip !== "collections" && q.collections?.length && !(e.meta.collection && q.collections.includes(e.meta.collection))) return false;
  if (skip !== "tags" && q.tags?.length && !q.tags.every((t) => e.meta.tags.includes(t))) return false;
  if (q.status?.length && !q.status.includes(e.meta.status)) return false;
  if (q.projectId && e.projectId !== q.projectId) return false;
  if (q.modifiedAfter && e.modifiedAt < q.modifiedAfter) return false;
  if (q.onlyConflicts && !e.conflict) return false;
  return true;
}

export function queryLibrary(model: LibraryModel, q: LibraryQuery): LibraryPage {
  const sort = q.sort ?? "modifiedDesc";
  const filtered = model.entries.filter((e) => matches(e, q, null));
  filtered.sort((a, b) => {
    switch (sort) {
      case "nameAsc":
        return a.fileName.localeCompare(b.fileName, "de");
      case "kind":
        return a.kind.localeCompare(b.kind) || a.fileName.localeCompare(b.fileName, "de");
      case "sizeDesc":
        return b.size - a.size;
      case "modifiedDesc":
        return b.modifiedAt.localeCompare(a.modifiedAt);
    }
  });
  const offset = q.offset ?? 0;
  const limit = Math.min(q.limit ?? 200, 1000);
  const facets: LibraryFacets = { kinds: {}, collections: {}, tags: {} };
  for (const e of model.entries) {
    if (matches(e, q, "kinds")) facets.kinds[e.kind] = (facets.kinds[e.kind] ?? 0) + 1;
    if (matches(e, q, "collections") && e.meta.collection) facets.collections[e.meta.collection] = (facets.collections[e.meta.collection] ?? 0) + 1;
    if (matches(e, q, "tags")) for (const t of e.meta.tags) facets.tags[t] = (facets.tags[t] ?? 0) + 1;
  }
  return { entries: filtered.slice(offset, offset + limit).map(toEntry), total: filtered.length, offset, facets };
}
