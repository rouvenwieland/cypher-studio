import { useEffect, useMemo, useRef, useState } from "react";
import type { Size, SocialDocument, SocialTemplate } from "@contract";
import {
  canvasMeasure,
  collectResourceUrls,
  createFontProbe,
  createScratchContext,
  ensureFonts,
  fontsOfTemplate,
  layoutSocial,
  loadResources,
  type LayoutContext,
  type LogoVariant,
  type SocialLayout,
} from "./engine";

export interface SocialRender {
  layout: SocialLayout | null;
  bitmaps: ReadonlyMap<string, ImageBitmap>;
  fontsReady: boolean;
  failed: string[];
}

/**
 * Brücke zur Layout-Engine (ARCHITEKTUR 5.5): Schriften laden → Layout rechnen → fehlende Bilder laden → neu rechnen.
 * Die Engine ist rein; hier liegen nur Canvas-Messung, Bildspeicher und Reihenfolge.
 */
export function useSocialLayout(
  template: SocialTemplate | undefined,
  doc: SocialDocument | null,
  assetUrls: Readonly<Record<string, string>>,
  logoUrls: Partial<Record<LogoVariant, string>>,
): SocialRender {
  const [fontsReadyFor, setFontsReadyFor] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const bitmaps = useRef(new Map<string, ImageBitmap>());
  const failed = useRef<string[]>([]);
  const scratch = useMemo(() => createScratchContext(), []);
  const probe = useMemo(() => (scratch ? createFontProbe(scratch) : undefined), [scratch]);

  const templateId = template?.id ?? null;
  useEffect(() => {
    if (!template) return;
    let alive = true;
    void ensureFonts(fontsOfTemplate(template)).then(() => {
      if (alive) setFontsReadyFor(template.id);
    });
    return () => {
      alive = false;
    };
  }, [template]);

  const fontsReady = fontsReadyFor === templateId && templateId !== null;

  const layout = useMemo(() => {
    if (!template || !doc || !scratch || !fontsReady) return null;
    const sizes = new Map<string, Size>();
    for (const [url, bmp] of bitmaps.current) sizes.set(url, { width: bmp.width, height: bmp.height });
    const ctx: LayoutContext = {
      measureFor: (font) => canvasMeasure(scratch, font),
      assetUrl: (relPath) => assetUrls[relPath] ?? relPath,
      logoUrl: (variant) => logoUrls[variant] ?? null,
      imageSize: (url) => sizes.get(url) ?? null,
      ...(probe ? { isFontAvailable: probe } : {}),
    };
    return layoutSocial(template, doc, ctx);
    // `version` wechselt, sobald Bilder nachgeladen sind
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, doc, scratch, probe, fontsReady, assetUrls, logoUrls, version]);

  // fehlende Bilder nachladen; ein bereits gestarteter Abruf gilt auch dann, wenn sich das Layout inzwischen geändert hat
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!layout) return;
    const missing = collectResourceUrls(layout).filter((u) => !bitmaps.current.has(u) && !failed.current.includes(u));
    if (missing.length === 0) return;
    void loadResources(missing, {}, bitmaps.current).then((res) => {
      for (const [u, b] of res.bitmaps) bitmaps.current.set(u, b);
      failed.current = [...failed.current, ...res.failed];
      if (mounted.current) setVersion((v) => v + 1);
    });
  }, [layout]);

  // Gleiche Eingaben liefern dasselbe Objekt, damit Empfänger nicht bei jedem Zeichnen neu rechnen.
  return useMemo(
    () => ({ layout, bitmaps: bitmaps.current, fontsReady, failed: failed.current }),
    // `version` zeigt an, dass Bitmaps oder Fehler dazugekommen sind
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, fontsReady, version],
  );
}
