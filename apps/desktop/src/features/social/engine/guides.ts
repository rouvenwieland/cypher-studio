/**
 * Sicherheitszonen: Überlappung eines Rechtecks mit den GESPERRTEN Streifen einer Vorlage
 * (`SocialTemplate.safeZones` sind die Bereiche, die Plattform-Oberfläche überdeckt, nicht die freie Fläche).
 * Reine Geometrie, keine UI-Texte.
 */
import type { Rect, Size } from "@contract";
import { hasArea, intersectRect, rectBottom, rectRight, unionRect } from "./geometry";

/** Seite der Leinwand, an der eine Zone liegt (Code, die deutschen Namen schreibt die UI). */
export type ZoneSide = "top" | "bottom" | "left" | "right";

/** Feste Reihenfolge für Ausgaben und Anzeige. */
export const ZONE_SIDES: readonly ZoneSide[] = ["top", "bottom", "left", "right"];

export interface ZoneOverlap {
  /** Index in der Zonenliste der Vorlage. */
  zoneIndex: number;
  side: ZoneSide;
  /**
   * Wie weit das Rechteck in die Zone hineinragt, gemessen von der Innenkante der Zone (zur freien Fläche hin)
   * bis zum am weitesten zum Leinwandrand reichenden Punkt des Rechtecks. Ist zugleich die Strecke, um die das
   * Rechteck verschoben werden müsste, damit es die Zone nicht mehr berührt.
   */
  overlapPx: number;
  /** Schnittfläche von Rechteck und Zone. */
  overlapRect: Rect;
}

export interface SideOverlap {
  side: ZoneSide;
  /** Größte Tiefe aller Zonen dieser Seite. */
  overlapPx: number;
  /** Umschließendes Rechteck aller Schnittflächen dieser Seite. */
  overlapRect: Rect;
  zoneIndices: number[];
}

/**
 * Bestimmt die Seite einer Zone aus ihrer Lage auf der Leinwand: Breite ≥ Höhe heißt waagerechter Streifen
 * (oben oder unten), sonst senkrechter (links oder rechts); gewählt wird die Seite mit dem kleineren Randabstand.
 * Zonen ohne Fläche liefern `null`.
 */
export function classifyZoneSide(zone: Rect, canvas: Size): ZoneSide | null {
  if (!hasArea(zone)) return null;
  if (zone.width >= zone.height) {
    return zone.y <= canvas.height - rectBottom(zone) ? "top" : "bottom";
  }
  return zone.x <= canvas.width - rectRight(zone) ? "left" : "right";
}

function depthIntoZone(side: ZoneSide, zone: Rect, overlap: Rect): number {
  switch (side) {
    case "top":
      return rectBottom(zone) - overlap.y;
    case "bottom":
      return rectBottom(overlap) - zone.y;
    case "left":
      return rectRight(zone) - overlap.x;
    case "right":
      return rectRight(overlap) - zone.x;
  }
}

/**
 * Alle Zonen, in die `rect` hineinragt. Berühren zählt nicht als Überlappen; Zonen ohne Fläche werden übersprungen.
 * Ein Rechteck in einer Ecke liefert mehrere Einträge (je Zone einen).
 */
export function zoneOverlaps(rect: Rect, zones: readonly Rect[], canvas: Size): ZoneOverlap[] {
  const result: ZoneOverlap[] = [];
  zones.forEach((zone, zoneIndex) => {
    const side = classifyZoneSide(zone, canvas);
    if (side === null) return;
    const overlapRect = intersectRect(rect, zone);
    if (overlapRect === null) return;
    result.push({ zoneIndex, side, overlapPx: depthIntoZone(side, zone, overlapRect), overlapRect });
  });
  return result;
}

/** Fasst Überlappungen je Seite zusammen (größte Tiefe, vereinigte Fläche); Ergebnis in Reihenfolge `ZONE_SIDES`. */
export function unionOfZoneSides(overlaps: readonly ZoneOverlap[]): SideOverlap[] {
  const result: SideOverlap[] = [];
  for (const side of ZONE_SIDES) {
    const onSide = overlaps.filter((overlap) => overlap.side === side);
    const [first, ...rest] = onSide;
    if (first === undefined) continue;
    result.push({
      side,
      overlapPx: Math.max(...onSide.map((overlap) => overlap.overlapPx)),
      overlapRect: rest.reduce((acc, overlap) => unionRect(acc, overlap.overlapRect), first.overlapRect),
      zoneIndices: onSide.map((overlap) => overlap.zoneIndex),
    });
  }
  return result;
}
