/** Social-Vorlagen für den Mock-Modus (die echten liefert Team C unter packs/social/). Zonen = gesperrte Streifen. */
import { SOCIAL_FORMAT_SIZES, SOCIAL_GUIDES, type Rect, type SocialLayer, type SocialTemplate } from "@contract";

function strips(size: { width: number; height: number }, g: { top: number; bottom: number; left: number; right: number }): Rect[] {
  return [
    { x: 0, y: 0, width: size.width, height: g.top },
    { x: 0, y: size.height - g.bottom, width: size.width, height: g.bottom },
    { x: 0, y: g.top, width: g.left, height: size.height - g.top - g.bottom },
    { x: size.width - g.right, y: g.top, width: g.right, height: size.height - g.top - g.bottom },
  ];
}

const TEXT_BASE = {
  fontFamily: "Anybody",
  fontWeight: 800,
  letterSpacingEm: -0.01,
  lineHeight: 0.92,
  align: "left" as const,
  valign: "bottom" as const,
  transform: "uppercase" as const,
};

function text(
  id: string,
  slot: string,
  rect: Rect,
  sizePx: number,
  minSizePx: number,
  color: string,
  defaultText: string,
  extra: Partial<Extract<SocialLayer, { type: "text" }>> = {},
): SocialLayer {
  return { type: "text", id, slot, rect, sizePx, minSizePx, color, defaultText, maxLines: 2, ...TEXT_BASE, ...extra };
}

export function socialTemplates(): SocialTemplate[] {
  const post = SOCIAL_FORMAT_SIZES.post;
  const story = SOCIAL_FORMAT_SIZES.story;
  const cover = SOCIAL_FORMAT_SIZES.reelCover;
  const storyZones = strips(story, SOCIAL_GUIDES.verticalConservative);
  return [
    {
      id: "drop-ankuendigung",
      title: "Drop-Ankündigung",
      format: "post",
      size: post,
      background: { type: "solid", color: "#0d0d0d" },
      layers: [
        { type: "image", id: "bild", slot: "bild", rect: { x: 0, y: 0, width: 1080, height: 780 }, fit: "cover", radiusPx: 0, required: false },
        { type: "shape", id: "balken", rect: { x: 60, y: 818, width: 140, height: 12 }, fill: { type: "solid", color: "#e4f531" }, radiusPx: 0, opacity: 1 },
        text("titel", "titel", { x: 60, y: 850, width: 960, height: 290 }, 230, 90, "#efeee9", "Rauschen Drop"),
        text("unterzeile", "unterzeile", { x: 60, y: 1150, width: 960, height: 90 }, 44, 28, "#efeee9", "Neue Motive, begrenzte Auflage", { fontFamily: "Atkinson Hyperlegible Next", fontWeight: 600, transform: "none", lineHeight: 1.15, letterSpacingEm: 0, valign: "top" }),
        text("datum", "datum", { x: 60, y: 1252, width: 700, height: 48 }, 34, 28, "#e4f531", "Fr 23.10. · 18:00", { fontFamily: "Martian Mono", fontWeight: 500, transform: "none", maxLines: 1, letterSpacingEm: 0.02, valign: "middle" }),
        { type: "logo", id: "logo", rect: { x: 800, y: 1226, width: 220, height: 60 }, variant: "light" },
        { type: "grain", id: "korn", opacity: 0.08, seed: 12 },
      ],
      safeZones: [],
      gridCrop: { x: 34, y: 0, width: 1012, height: 1350 },
      previewUrl: null,
    },
    {
      id: "neues-motiv",
      title: "Neues Motiv",
      format: "post",
      size: post,
      background: { type: "solid", color: "#e4f531" },
      layers: [
        { type: "image", id: "bild", slot: "bild", rect: { x: 90, y: 90, width: 900, height: 900 }, fit: "contain", radiusPx: 0, required: true },
        text("titel", "titel", { x: 60, y: 1010, width: 960, height: 240 }, 190, 80, "#0b0b0a", "Neues Motiv", { color: "#0b0b0a" }),
        { type: "scanlines", id: "zeilen", opacity: 0.06, spacingPx: 6 },
      ],
      safeZones: [],
      gridCrop: { x: 34, y: 0, width: 1012, height: 1350 },
      previewUrl: null,
    },
    {
      id: "termin-story",
      title: "Termin",
      format: "story",
      size: story,
      background: { type: "solid", color: "#1f2bd0" },
      layers: [
        text("titel", "titel", { x: 120, y: 700, width: 840, height: 520 }, 260, 100, "#f3f4f7", "Release Party", { maxLines: 3 }),
        text("datum", "datum", { x: 120, y: 1260, width: 840, height: 70 }, 54, 34, "#f3f4f7", "Sa 31.10. · 21:00", { fontFamily: "Martian Mono", fontWeight: 500, transform: "none", maxLines: 1, valign: "middle", letterSpacingEm: 0.02 }),
        text("ort", "unterzeile", { x: 120, y: 1340, width: 840, height: 120 }, 44, 30, "#f3f4f7", "Berlin · Ort folgt", { fontFamily: "Atkinson Hyperlegible Next", fontWeight: 600, transform: "none", valign: "top", letterSpacingEm: 0, lineHeight: 1.2 }),
        { type: "grain", id: "korn", opacity: 0.1, seed: 4 },
      ],
      safeZones: storyZones,
      gridCrop: null,
      previewUrl: null,
    },
    {
      id: "zitat-story",
      title: "Zitat",
      format: "story",
      size: story,
      background: { type: "solid", color: "#efeee9" },
      layers: [
        text("zitat", "titel", { x: 120, y: 520, width: 840, height: 800 }, 120, 52, "#0d0d0d", "Wir senden, was sonst keiner sendet.", { fontFamily: "Atkinson Hyperlegible Next", fontWeight: 700, transform: "none", lineHeight: 1.08, letterSpacingEm: -0.01, maxLines: 6, valign: "middle" }),
        text("quelle", "unterzeile", { x: 120, y: 1360, width: 840, height: 60 }, 40, 28, "#2f2f2d", "Cypher Kollektiv", { fontFamily: "Martian Mono", fontWeight: 500, transform: "none", maxLines: 1, valign: "middle", letterSpacingEm: 0.02 }),
      ],
      safeZones: storyZones,
      gridCrop: null,
      previewUrl: null,
    },
    {
      id: "reel-cover",
      title: "Reel-Cover",
      format: "reelCover",
      size: cover,
      background: { type: "solid", color: "#0d0d0d" },
      layers: [
        { type: "image", id: "bild", slot: "bild", rect: { x: 0, y: 240, width: 1080, height: 1440 }, fit: "cover", radiusPx: 0, required: false },
        text("titel", "titel", { x: 90, y: 1180, width: 900, height: 360 }, 240, 90, "#efeee9", "Reel Titel", { maxLines: 3 }),
      ],
      safeZones: strips(cover, { top: 220, bottom: 420, left: 0, right: 120 }),
      gridCrop: SOCIAL_GUIDES.reelCoverGridBox,
      previewUrl: null,
    },
  ];
}
