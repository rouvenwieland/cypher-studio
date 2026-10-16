/**
 * Daten für die Messspur der UI: welche gesperrten Streifen es gibt und wie breit sie sind.
 * Die deutschen Namen („Bildunterschrift“ usw.) und das Aussehen (Schraffur, Cyan-Chip) bestimmt die UI.
 */
import type { Rect, Size } from "@contract";
import { classifyZoneSide, type ZoneSide } from "./guides";

export interface ZoneChip {
  /** Index in `template.safeZones`. */
  zoneIndex: number;
  /** Code der Seite: die UI übersetzt ihn in einen Namen. */
  side: ZoneSide;
  /** Tiefe des Streifens in Pixeln der Vorlage (Höhe bei oben/unten, Breite bei links/rechts). */
  sizePx: number;
  rect: Rect;
}

/** Ein Chip je Zone mit Fläche, in der Reihenfolge der Zonen. Zonen ohne Fläche entfallen. */
export function zoneChips(zones: readonly Rect[], size: Size): ZoneChip[] {
  const chips: ZoneChip[] = [];
  zones.forEach((rect, zoneIndex) => {
    const side = classifyZoneSide(rect, size);
    if (side === null) return;
    chips.push({ zoneIndex, side, sizePx: side === "top" || side === "bottom" ? rect.height : rect.width, rect });
  });
  return chips;
}
