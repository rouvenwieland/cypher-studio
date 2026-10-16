/** Eingabe und Ausgabe der Mockup-Engine (öffentliche Typen). */
import type { GarmentColor, GarmentColorId, MockupDocument, MockupTemplate, Size } from "@contract";

export type MockupPlacement = MockupDocument["placement"];
export type MockupBackground = MockupDocument["background"];
export type MockupImageType = "image/png" | "image/jpeg";

/** Wo gerechnet wird: im Web Worker oder (Rückfall) im Hauptthread. */
export type RendererMode = "worker" | "main";

export interface MockupRenderInput {
  template: MockupTemplate;
  colorId: GarmentColorId;
  garment: GarmentColor;
  /** Druckfläche in mm (aus dem Druckprofil), Bezug für das Quad der Vorlage. */
  printAreaMm: Size;
  /** Motiv als URL (cyfile:, Blob-URL …); `null` = Shirt ohne Motiv. */
  designUrl: string | null;
  placement: MockupPlacement;
  background: MockupBackground;
  /** Zielgröße des Ergebnisses in Pixeln (bei `scale` 1). */
  output: Size;
}

export interface MockupRenderOptions {
  /** Faktor auf `output`, z. B. 0,5 für die Vorschau. Standard 1. */
  scale?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface MockupRenderer {
  /** Rendert das Mockup als `ImageBitmap` (Besitz geht an den Aufrufer, `close()` nicht vergessen). */
  render(input: MockupRenderInput, opts?: MockupRenderOptions): Promise<ImageBitmap>;
  /** Rendert in voller Auflösung und kodiert als PNG (Standard) oder JPEG. */
  toBlob(
    input: MockupRenderInput,
    type?: MockupImageType,
    quality?: number,
    opts?: { signal?: AbortSignal | undefined },
  ): Promise<Blob>;
  /** Zwischengespeicherte Ebenen/Motive verwerfen (eine URL oder alle), z. B. wenn sich eine Datei geändert hat. */
  invalidate(url?: string): void;
  /** Worker beenden, Zwischenspeicher leeren, offene Anfragen mit `disposed` abbrechen. */
  dispose(): void;
}
