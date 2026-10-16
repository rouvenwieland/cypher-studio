/**
 * Prozedurale Bilder für den Mock-Modus: Motive, Platzhalter-Vorlage (Shirt) und Vorschaubilder.
 * Alles entsteht im Browser (Canvas bzw. SVG), es werden keine fremden Bilder oder Logos verwendet.
 */
import { hashString, mulberry32 } from "./rng";

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D nicht verfügbar");
  return [canvas, ctx];
}

function toBlobUrl(canvas: HTMLCanvasElement, type = "image/png"): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(URL.createObjectURL(blob));
        else reject(new Error("Bild konnte nicht erzeugt werden"));
      },
      type,
      0.92,
    );
  });
}

async function ensureFonts(): Promise<void> {
  try {
    await Promise.all([document.fonts.load('800 100px "Anybody"'), document.fonts.load('500 40px "Martian Mono"')]);
  } catch {
    /* Schriften optional: ohne sie bleibt die Systemschrift */
  }
}

export type MotifKind = "signal" | "logo" | "flat" | "wave";

const cache = new Map<string, Promise<string>>();

/** Transparentes Motiv (PNG) im Stil der Kollektion „Rauschen“: Testbild-Kreise, Zeilen, Schriftzug. */
export function motifUrl(kind: MotifKind): Promise<string> {
  const hit = cache.get(`motif:${kind}`);
  if (hit) return hit;
  const made = (async () => {
    await ensureFonts();
    const w = kind === "logo" ? 1400 : 1100;
    const h = kind === "logo" ? 460 : 1224;
    const [canvas, ctx] = canvasOf(w, h);
    ctx.clearRect(0, 0, w, h);
    const yellow = "#e4f531";
    const paper = "#efeee9";
    if (kind === "logo") {
      ctx.fillStyle = yellow;
      ctx.font = '800 330px "Anybody", "Arial Black", sans-serif';
      ctx.textBaseline = "alphabetic";
      ctx.fillText("RAUSCHEN", 20, 330);
      ctx.fillStyle = paper;
      ctx.fillRect(24, 372, w - 48, 14);
      ctx.fillRect(24, 410, (w - 48) * 0.62, 14);
    } else if (kind === "signal" || kind === "wave") {
      const cx = w / 2;
      const cy = h * 0.46;
      ctx.lineWidth = 6;
      for (let i = 0; i < 6; i++) {
        ctx.strokeStyle = i % 2 === 0 ? yellow : paper;
        ctx.beginPath();
        ctx.arc(cx, cy, 120 + i * 78, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = yellow;
      for (let y = cy - 150; y < cy + 150; y += 22) {
        const half = Math.sqrt(Math.max(0, 150 * 150 - (y - cy) * (y - cy)));
        ctx.fillRect(cx - half, y, half * 2, 8);
      }
      // sehr dünne Linie (Hinweis „Linienstärke“)
      ctx.strokeStyle = paper;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(60, h * 0.46);
      ctx.lineTo(w - 60, h * 0.46);
      ctx.stroke();
      // weicher Verlauf unten (Halbtransparenz)
      const g = ctx.createLinearGradient(0, h * 0.78, 0, h * 0.96);
      g.addColorStop(0, "rgba(228,245,49,0.9)");
      g.addColorStop(1, "rgba(228,245,49,0)");
      ctx.fillStyle = g;
      ctx.fillRect(w * 0.12, h * 0.78, w * 0.76, h * 0.18);
      ctx.fillStyle = paper;
      ctx.font = '800 150px "Anybody", "Arial Black", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("SIGNAL", cx, h * 0.92);
    } else {
      ctx.fillStyle = yellow;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#0d0d0d";
      ctx.font = '800 280px "Anybody", "Arial Black", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("FLAT", w / 2, h / 2);
    }
    return toBlobUrl(canvas);
  })();
  cache.set(`motif:${kind}`, made);
  return made;
}

/** Schraffur-Overlay für „Problemstellen“ (Druckprüfer). */
export function overlayUrl(): Promise<string> {
  const hit = cache.get("overlay");
  if (hit) return hit;
  const made = (async () => {
    const [canvas, ctx] = canvasOf(550, 612);
    ctx.strokeStyle = "rgba(245,183,0,0.9)";
    ctx.lineWidth = 3;
    for (let x = -612; x < 550; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, 612);
      ctx.lineTo(x + 612, 0);
      ctx.stroke();
    }
    return toBlobUrl(canvas);
  })();
  cache.set("overlay", made);
  return made;
}

/** Platzhalter-Shirt (nur Silhouette, Vorderseite) als Ebenen für die Mockup-Engine. */
export interface TeeLayers {
  mask: string;
  shade: string;
  light: string;
  displace: string;
  heather: string;
  background: string;
}

export const TEE_CANVAS = { width: 1200, height: 1500 } as const;
export const TEE_QUAD = {
  tl: { x: 360, y: 430 },
  tr: { x: 840, y: 430 },
  br: { x: 840, y: 1085 },
  bl: { x: 360, y: 1085 },
} as const;

function teePath(ctx: CanvasRenderingContext2D): void {
  const w = TEE_CANVAS.width;
  ctx.beginPath();
  ctx.moveTo(w * 0.36, 150);
  ctx.bezierCurveTo(w * 0.42, 215, w * 0.58, 215, w * 0.64, 150);
  ctx.lineTo(w * 0.86, 250);
  ctx.lineTo(w * 0.99, 520);
  ctx.lineTo(w * 0.84, 580);
  ctx.lineTo(w * 0.76, 470);
  ctx.lineTo(w * 0.77, 1370);
  ctx.bezierCurveTo(w * 0.6, 1395, w * 0.4, 1395, w * 0.23, 1370);
  ctx.lineTo(w * 0.24, 470);
  ctx.lineTo(w * 0.16, 580);
  ctx.lineTo(w * 0.01, 520);
  ctx.lineTo(w * 0.14, 250);
  ctx.closePath();
}

let teePromise: Promise<TeeLayers> | null = null;

export function teeLayers(): Promise<TeeLayers> {
  teePromise ??= buildTee();
  return teePromise;
}

async function buildTee(): Promise<TeeLayers> {
  const { width: w, height: h } = TEE_CANVAS;
  const rnd = mulberry32(7);
  // Maske: Alpha = Stoff
  const [mask, mctx] = canvasOf(w, h);
  mctx.fillStyle = "#000";
  teePath(mctx);
  mctx.fill();
  // Schatten (multiply): weiß = unverändert
  const [shade, sctx] = canvasOf(w, h);
  sctx.fillStyle = "#fff";
  sctx.fillRect(0, 0, w, h);
  // Falten: lange, schmale, weiche Bänder statt Flecken
  for (let i = 0; i < 6; i++) {
    const x = w * (0.3 + rnd() * 0.4);
    const y = 700 + rnd() * 400;
    sctx.save();
    sctx.translate(x, y);
    sctx.rotate((rnd() - 0.5) * 0.7);
    sctx.scale(1, 6);
    const fold = sctx.createRadialGradient(0, 0, 0, 0, 0, 70);
    const a = 0.06 + rnd() * 0.06;
    fold.addColorStop(0, `rgba(0,0,0,${a.toFixed(3)})`);
    fold.addColorStop(1, "rgba(0,0,0,0)");
    sctx.fillStyle = fold;
    sctx.fillRect(-70, -70, 140, 140);
    sctx.restore();
  }
  const hem = sctx.createLinearGradient(0, 1100, 0, 1400);
  hem.addColorStop(0, "rgba(0,0,0,0)");
  hem.addColorStop(1, "rgba(0,0,0,0.12)");
  sctx.fillStyle = hem;
  sctx.fillRect(0, 1100, w, 300);
  const edge = sctx.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, "rgba(0,0,0,0.22)");
  edge.addColorStop(0.2, "rgba(0,0,0,0)");
  edge.addColorStop(0.8, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(0,0,0,0.22)");
  sctx.fillStyle = edge;
  sctx.fillRect(0, 0, w, h);
  // Licht (screen): schwarz = unverändert
  const [light, lctx] = canvasOf(w, h);
  lctx.fillStyle = "#000";
  lctx.fillRect(0, 0, w, h);
  const lg = lctx.createRadialGradient(w * 0.42, 520, 20, w * 0.42, 520, 420);
  lg.addColorStop(0, "rgba(255,255,255,0.32)");
  lg.addColorStop(1, "rgba(255,255,255,0)");
  lctx.fillStyle = lg;
  lctx.fillRect(0, 0, w, h);
  // Verschiebung: R = dx, G = dy, 128 = 0
  const [displace, dctx] = canvasOf(w, h);
  const img = dctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      img.data[i] = 128 + Math.round(Math.sin(y / 38 + x / 210) * 14);
      img.data[i + 1] = 128 + Math.round(Math.cos(x / 52 + y / 160) * 10);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  dctx.putImageData(img, 0, 0);
  // Melange (soft-light)
  const [heather, hctx] = canvasOf(w, h);
  const himg = hctx.createImageData(w, h);
  for (let i = 0; i < himg.data.length; i += 4) {
    const v = 128 + Math.round((rnd() - 0.5) * 70);
    himg.data[i] = v;
    himg.data[i + 1] = v;
    himg.data[i + 2] = v;
    himg.data[i + 3] = 255;
  }
  hctx.putImageData(himg, 0, 0);
  // Hintergrund der Vorlage
  const [bg, bctx] = canvasOf(w, h);
  const bgGrad = bctx.createLinearGradient(0, 0, 0, h);
  bgGrad.addColorStop(0, "#d9d9d9");
  bgGrad.addColorStop(1, "#c4c4c4");
  bctx.fillStyle = bgGrad;
  bctx.fillRect(0, 0, w, h);
  return {
    mask: await toBlobUrl(mask),
    shade: await toBlobUrl(shade),
    light: await toBlobUrl(light),
    displace: await toBlobUrl(displace),
    heather: await toBlobUrl(heather),
    background: await toBlobUrl(bg),
  };
}

/** Vorschaubild der Bibliothek als SVG (Daten-URL). Form nach Dateiart, Farbe nach Kollektion. */
export function thumbDataUrl(seedText: string, kind: string, accent: string | null, size = 160): string {
  const rnd = mulberry32(hashString(seedText));
  const w = size;
  const h = Math.round(size * (kind === "video" ? 0.5625 : 0.75 + rnd() * 0.5));
  const ink = "#1c1c1c";
  const paper = "#e8e7e2";
  const col = accent ?? "#9a9a96";
  let body = "";
  if (kind === "vector") {
    for (let i = 0; i < 5; i++) {
      const p = () => (rnd() * w).toFixed(0);
      const q = () => (rnd() * h).toFixed(0);
      body += `<path d="M${p()} ${q()} C ${p()} ${q()}, ${p()} ${q()}, ${p()} ${q()}" fill="none" stroke="${i % 2 ? ink : col}" stroke-width="${i === 0 ? 3 : 1.5}"/>`;
    }
  } else if (kind === "model3d") {
    const x = w * 0.5;
    const y = h * 0.5;
    const r = Math.min(w, h) * 0.3;
    body += `<path d="M${x} ${y - r} L${x + r} ${y - r / 2} L${x + r} ${y + r / 2} L${x} ${y + r} L${x - r} ${y + r / 2} L${x - r} ${y - r / 2} Z M${x} ${y} L${x} ${y + r} M${x} ${y} L${x + r} ${y - r / 2} M${x} ${y} L${x - r} ${y - r / 2}" fill="none" stroke="${ink}" stroke-width="1.5"/>`;
    body += `<path d="M${x} ${y - r} L${x + r} ${y - r / 2} L${x} ${y} L${x - r} ${y - r / 2} Z" fill="${col}" opacity="0.85"/>`;
  } else if (kind === "video") {
    body += `<rect x="0" y="${h * 0.62}" width="${w}" height="${h * 0.38}" fill="${ink}" opacity="0.14"/><path d="M${w * 0.44} ${h * 0.3} L${w * 0.62} ${h * 0.46} L${w * 0.44} ${h * 0.62} Z" fill="${col}"/>`;
  } else {
    const bands = 5 + Math.floor(rnd() * 5);
    for (let i = 0; i < bands; i++) {
      const y = (h / bands) * i;
      body += `<rect x="0" y="${y.toFixed(1)}" width="${w}" height="${(h / bands / 2).toFixed(1)}" fill="${i % 3 === 0 ? col : ink}" opacity="${(0.12 + rnd() * 0.5).toFixed(2)}"/>`;
    }
    body += `<circle cx="${(w * (0.3 + rnd() * 0.4)).toFixed(0)}" cy="${(h * (0.3 + rnd() * 0.4)).toFixed(0)}" r="${(Math.min(w, h) * (0.16 + rnd() * 0.16)).toFixed(0)}" fill="none" stroke="${col}" stroke-width="3"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${paper}"/>${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Vorlagenbild (Formatleiste) – Seitenverhältnis exakt, Höhe 112. */
export function templatePreviewUrl(aspect: number, accent: string): string {
  const h = 112;
  const w = Math.round(h * aspect);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#d6d6d6"/><rect x="${w * 0.2}" y="${h * 0.2}" width="${w * 0.6}" height="${h * 0.6}" fill="none" stroke="${accent}" stroke-width="2"/><path d="M${w * 0.2} ${h * 0.5} H${w * 0.8}" stroke="#202020" stroke-width="1"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
