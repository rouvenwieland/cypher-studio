/**
 * Echte Mockup-Vorlagen aus dem Repository (`packs/mockups/<id>/template.json` mit den Ebenen als PNG,
 * Schema `packs/schema/mockup.schema.json`). Im Mock-Modus lädt Vite sie direkt aus dem Repo.
 * In der App liefert Rust dieselben Vorlagen über die Ressourcen und das Protokoll `cyasset:`;
 * die Oberfläche ruft dort nur `mockup_templates_list` (Vertrag), dieser Code ist nicht dabei.
 */
import type { MockupTemplate } from "@contract";

/** Aufbau der Datei `template.json`: wie `MockupTemplate`, aber mit Dateinamen statt Adressen. */
interface TemplateFile {
  id: string;
  title: string;
  product: MockupTemplate["product"];
  view: MockupTemplate["view"];
  canvas: MockupTemplate["canvas"];
  printProfileId: string;
  printArea: MockupTemplate["printArea"];
  displaceStrengthPx: number;
  variants: {
    exposure: "light" | "dark";
    layers: {
      mask: string;
      shade: string;
      light: string;
      displace: string | null;
      texture: string | null;
      heather: string | null;
      background: string | null;
    };
    colorIds: string[];
  }[];
}

const files = import.meta.glob<TemplateFile>("../../../../../packs/mockups/*/template.json", {
  eager: true,
  import: "default",
});
const images = import.meta.glob<string>(
  ["../../../../../packs/mockups/*/*.png", "!../../../../../packs/mockups/*/preview.png"],
  {
    eager: true,
    query: "?url",
    import: "default",
  },
);

function layerUrl(id: string, file: string | null): string | null {
  if (file === null) return null;
  // `../common/heather.png` liegt einmal für alle Vorlagen unter mockups/common (Paketgröße)
  const shared = file.startsWith("../common/");
  const rel = shared ? `common/${file.slice("../common/".length)}` : `${id}/${file}`;
  const key = Object.keys(images).find((k) => k.endsWith(`/mockups/${rel}`));
  const url = key ? images[key] : undefined;
  if (!url) throw new Error(`Ebene fehlt im Paket: ${id}/${file}`);
  return url;
}

const ORDER = ["tee-front", "tee-back", "hoodie-front", "hoodie-back"];

/** Alle Vorlagen des Pakets, in fester Reihenfolge (leer, wenn das Paket nicht im Repository liegt). */
export function packMockupTemplates(): MockupTemplate[] {
  const list = Object.values(files).sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  return list.map((f) => ({
    id: f.id,
    title: f.title,
    product: f.product,
    view: f.view,
    canvas: f.canvas,
    printProfileId: f.printProfileId,
    printArea: f.printArea,
    displaceStrengthPx: f.displaceStrengthPx,
    variants: f.variants.map((v) => {
      const mask = layerUrl(f.id, v.layers.mask);
      const shade = layerUrl(f.id, v.layers.shade);
      const light = layerUrl(f.id, v.layers.light);
      if (!mask || !shade || !light) throw new Error(`Pflichtebene fehlt in ${f.id}`);
      return {
        exposure: v.exposure,
        layers: {
          mask,
          shade,
          light,
          displace: layerUrl(f.id, v.layers.displace),
          texture: layerUrl(f.id, v.layers.texture),
          heather: layerUrl(f.id, v.layers.heather),
          background: layerUrl(f.id, v.layers.background),
        },
        colorIds: v.colorIds,
      };
    }),
  }));
}
