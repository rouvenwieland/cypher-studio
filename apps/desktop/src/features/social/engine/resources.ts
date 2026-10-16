/**
 * Ressourcen für das Zeichnen: Bilder und Logos als `ImageBitmap` laden, Schriften bereitstellen.
 * Alles Umgebungsabhängige (fetch, createImageBitmap, FontFaceSet) ist austauschbar und damit testbar.
 */
import type { SocialTemplate } from "@contract";
import { fontShorthand, type FontSpec } from "./canvas-text";
import type { PlacedFill, SocialLayout } from "./layout";

/** Antwort, soweit `loadResources` sie braucht. */
export interface FetchedResponse {
  ok: boolean;
  blob(): Promise<Blob>;
}

export interface LoadDeps {
  fetchImpl?: (url: string) => Promise<FetchedResponse>;
  createBitmap?: (blob: Blob) => Promise<ImageBitmap>;
}

export interface LoadedResources {
  bitmaps: Map<string, ImageBitmap>;
  /** Adressen, die sich nicht laden ließen (Netzfehler, kein Bild). */
  failed: string[];
}

function fillUrl(fill: PlacedFill): string | null {
  return fill.type === "image" ? fill.url : null;
}

/** Alle Adressen, die das Layout zum Zeichnen braucht (ohne Doppelte). */
export function collectResourceUrls(layout: SocialLayout): string[] {
  const urls = new Set<string>();
  const add = (url: string | null): void => {
    if (url !== null) urls.add(url);
  };
  add(fillUrl(layout.background));
  for (const layer of layout.layers) {
    switch (layer.type) {
      case "image":
      case "logo":
        add(layer.url);
        break;
      case "shape":
        add(fillUrl(layer.fill));
        break;
      case "text":
      case "grain":
      case "scanlines":
        break;
    }
  }
  return [...urls];
}

/**
 * Lädt die Adressen per fetch → createImageBitmap. Bereits in `existing` vorhandene werden übernommen,
 * statt neu geladen. Ein Fehler bei einer Adresse bricht die anderen nicht ab, sie landet in `failed`.
 */
export async function loadResources(
  urls: readonly string[],
  deps: LoadDeps = {},
  existing: ReadonlyMap<string, ImageBitmap> = new Map(),
): Promise<LoadedResources> {
  const fetchImpl = deps.fetchImpl ?? ((url: string) => fetch(url));
  const createBitmap =
    deps.createBitmap ?? ((blob: Blob) => createImageBitmap(blob, { imageOrientation: "from-image" }));
  const bitmaps = new Map<string, ImageBitmap>();
  const failed: string[] = [];

  await Promise.all(
    [...new Set(urls)].map(async (url) => {
      const known = existing.get(url);
      if (known !== undefined) {
        bitmaps.set(url, known);
        return;
      }
      try {
        const response = await fetchImpl(url);
        if (!response.ok) throw new Error(`HTTP status not ok: ${url}`);
        bitmaps.set(url, await createBitmap(await response.blob()));
      } catch {
        failed.push(url);
      }
    }),
  );
  return { bitmaps, failed };
}

/** Gibt die Bitmaps frei, die nicht mehr gebraucht werden. */
export function disposeBitmaps(bitmaps: Iterable<ImageBitmap>): void {
  for (const bitmap of bitmaps) bitmap.close();
}

/** Schriften, die eine Vorlage zum Zeichnen braucht (Familie und Gewicht, ohne Doppelte). */
export function fontsOfTemplate(template: Pick<SocialTemplate, "layers">): Pick<FontSpec, "family" | "weight">[] {
  const seen = new Map<string, Pick<FontSpec, "family" | "weight">>();
  for (const layer of template.layers) {
    if (layer.type !== "text") continue;
    seen.set(`${layer.fontWeight}|${layer.fontFamily}`, { family: layer.fontFamily, weight: layer.fontWeight });
  }
  return [...seen.values()];
}

/** Teil von `FontFaceSet`, den `ensureFonts` braucht. */
export interface FontLoader {
  load(font: string, text?: string): Promise<unknown>;
  ready: Promise<unknown>;
}

/** Text mit Umlauten, ß und Ziffern: Schriften mit `unicode-range` laden so auch ihre Teilsätze. */
const FONT_SAMPLE = "AaÄäÖöÜüß0123456789";

function defaultFontLoader(): FontLoader | null {
  if (typeof document !== "undefined" && "fonts" in document) return document.fonts;
  const scope = globalThis as unknown as { fonts?: FontLoader };
  return scope.fonts ?? null;
}

/**
 * Wartet, bis die Schriften geladen sind (im Fenster `document.fonts`, im Worker `self.fonts`). Ein Fehler beim
 * Laden einer Schrift bricht nicht ab; ob sie danach da ist, prüft `createFontProbe` (Warnung `fontMissing`).
 */
export async function ensureFonts(
  fonts: readonly Pick<FontSpec, "family" | "weight">[],
  loader: FontLoader | null = defaultFontLoader(),
): Promise<void> {
  if (loader === null) return;
  await Promise.all(
    fonts.map((font) => loader.load(fontShorthand(font.weight, 16, font.family), FONT_SAMPLE).catch(() => [])),
  );
  await loader.ready;
}
