/**
 * Laden und Zwischenspeichern der Bilder (Vorlagen-Ebenen, Hintergrund, Motiv).
 * `fetch(url)` → `createImageBitmap`. Die Protokolle (cyasset:, cyfile:) senden CORS-Header, Blob-URLs gehen auch.
 * Der Zwischenspeicher hält die Bitmaps nach letzter Nutzung (LRU) bis zu einem Byte-Budget.
 */
import { MockupEngineError } from "./errors";
import type { AssetRole, PlanAsset } from "./plan";

export interface LoadedImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

export interface ImageLoader {
  /** Bild laden (oder aus dem Zwischenspeicher liefern). Gleichzeitige Anfragen teilen sich ein Laden. */
  load(asset: PlanAsset): Promise<LoadedImage>;
  /** Auf das Byte-Budget kürzen (am besten zwischen zwei Renderläufen aufrufen, nie währenddessen). */
  trim(): void;
  /** Alle Einträge einer URL (oder alle) verwerfen. */
  invalidate(url?: string): void;
  dispose(): void;
}

export interface BitmapLoaderOptions {
  /** Standard: `fetch(url)` und `blob()`; wirft bei HTTP-Fehler. */
  fetchBlob?: (url: string) => Promise<Blob>;
  /** Standard: `createImageBitmap`; Datenebenen ohne Farbumrechnung. */
  decode?: (blob: Blob, role: AssetRole) => Promise<ImageBitmap>;
  /** Höchstmenge zwischengespeicherter Bitmaps in Byte (Standard 512 MiB). */
  maxBytes?: number;
}

export const DEFAULT_CACHE_BYTES = 512 * 1024 * 1024;

async function defaultFetchBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.blob();
}

async function defaultDecode(blob: Blob, role: AssetRole): Promise<ImageBitmap> {
  if (role !== "layer") return createImageBitmap(blob);
  // Datenebenen (Maske, Schatten, Verschiebung …) tragen Werte, keine Farben: ohne Profilumrechnung lesen.
  try {
    return await createImageBitmap(blob, { colorSpaceConversion: "none" });
  } catch {
    // Manche WebViews lehnen die Option ab: dann mit den Standardeinstellungen lesen (scheitert ein defektes Bild, scheitert es hier erneut).
    return createImageBitmap(blob);
  }
}

interface Entry {
  id: number;
  url: string;
  promise: Promise<LoadedImage>;
  bitmap: ImageBitmap | null;
  bytes: number;
}

export class BitmapLoader implements ImageLoader {
  private readonly entries = new Map<string, Entry>(); // Einfügereihenfolge = LRU (älteste zuerst)
  private readonly fetchBlob: (url: string) => Promise<Blob>;
  private readonly decode: (blob: Blob, role: AssetRole) => Promise<ImageBitmap>;
  private readonly maxBytes: number;
  private disposed = false;
  private counter = 0;

  constructor(options: BitmapLoaderOptions = {}) {
    this.fetchBlob = options.fetchBlob ?? defaultFetchBlob;
    this.decode = options.decode ?? defaultDecode;
    this.maxBytes = options.maxBytes ?? DEFAULT_CACHE_BYTES;
  }

  /** Aktuell zwischengespeicherte Bytes (nur fertig geladene Bilder). */
  get cachedBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.bytes;
    return total;
  }

  get size(): number {
    return this.entries.size;
  }

  load(asset: PlanAsset): Promise<LoadedImage> {
    if (this.disposed) return Promise.reject(new MockupEngineError("disposed", "Image loader was disposed"));
    const key = `${asset.role}|${asset.url}`;
    const hit = this.entries.get(key);
    if (hit) {
      // als zuletzt genutzt ans Ende setzen
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.promise;
    }
    const id = ++this.counter;
    const promise = Promise.resolve()
      .then(() => this.fetchBlob(asset.url))
      .then((blob) => this.decode(blob, asset.role))
      .then((bitmap) => {
        const entry = this.entries.get(key);
        if (this.disposed || entry?.id !== id) {
          bitmap.close(); // inzwischen verworfen
          throw new MockupEngineError("disposed", "Image was discarded while loading");
        }
        entry.bitmap = bitmap;
        entry.bytes = bitmap.width * bitmap.height * 4;
        return { source: bitmap, width: bitmap.width, height: bitmap.height } satisfies LoadedImage;
      })
      .catch((error: unknown) => {
        if (this.entries.get(key)?.id === id) this.entries.delete(key); // Fehler nicht zwischenspeichern
        if (error instanceof MockupEngineError) throw error;
        const code = asset.role === "design" ? "design-load-failed" : "layer-load-failed";
        const reason = error instanceof Error ? error.message : String(error);
        throw new MockupEngineError(code, `Could not load ${asset.role} image: ${reason}`, { cause: error });
      });
    this.entries.set(key, { id, url: asset.url, promise, bitmap: null, bytes: 0 });
    return promise;
  }

  trim(): void {
    let total = this.cachedBytes;
    for (const [key, entry] of this.entries) {
      if (total <= this.maxBytes) break;
      if (entry.bitmap === null) continue; // noch im Laden
      total -= entry.bytes;
      entry.bitmap.close();
      this.entries.delete(key);
    }
  }

  invalidate(url?: string): void {
    for (const [key, entry] of this.entries) {
      if (url !== undefined && entry.url !== url) continue;
      entry.bitmap?.close();
      this.entries.delete(key);
    }
  }

  dispose(): void {
    this.invalidate();
    this.disposed = true;
  }
}
