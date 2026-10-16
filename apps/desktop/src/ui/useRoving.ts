import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { clamp } from "../lib/assert";

interface RovingOptions {
  count: number;
  /** Spalten bei Rastern: Pfeil auf/ab springt um eine Zeile */
  columns?: number;
  horizontal?: boolean;
  onEnter?: (index: number) => void;
  onModEnter?: (index: number) => void;
  /** Wird bei jedem Wechsel der Auswahl durch Tastatur gerufen */
  onMove?: (index: number) => void;
  onKey?: (event: KeyboardEvent<HTMLElement>, index: number) => void;
}

/**
 * Listen und Raster mit einer Tab-Stelle (roving tabindex): Pfeiltasten wählen, Enter öffnet, Strg+Enter führt die Hauptaktion aus.
 * Die Auswahl bleibt beim Verlassen der Liste erhalten.
 */
export function useRoving({ count, columns = 1, horizontal = false, onEnter, onModEnter, onMove, onKey }: RovingOptions) {
  const [active, setActiveState] = useState(0);
  const root = useRef<HTMLElement | null>(null);
  const index = clamp(active, 0, Math.max(0, count - 1));

  const focusItem = useCallback((i: number) => {
    const el = root.current?.querySelector<HTMLElement>(`[data-roving-index="${i}"]`);
    el?.focus();
    el?.scrollIntoView({ block: "nearest" });
  }, []);

  const move = useCallback(
    (next: number) => {
      const target = clamp(next, 0, Math.max(0, count - 1));
      setActiveState(target);
      onMove?.(target);
      // nach dem Rendern fokussieren (virtualisierte Listen brauchen den Frame)
      requestAnimationFrame(() => focusItem(target));
    },
    [count, focusItem, onMove],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    const holder = target.closest<HTMLElement>("[data-roving-index]");
    if (!holder) return;
    const i = Number(holder.dataset["rovingIndex"]);
    if (!Number.isFinite(i)) return;
    onKey?.(e, i);
    if (e.defaultPrevented) return;
    const mod = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case "ArrowDown":
        if (horizontal && columns === 1) return;
        e.preventDefault();
        move(i + columns);
        break;
      case "ArrowUp":
        if (horizontal && columns === 1) return;
        e.preventDefault();
        move(i - columns);
        break;
      case "ArrowRight":
        if (!horizontal && columns === 1) return;
        e.preventDefault();
        move(i + 1);
        break;
      case "ArrowLeft":
        if (!horizontal && columns === 1) return;
        e.preventDefault();
        move(i - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(count - 1);
        break;
      case "Enter":
        if (mod && onModEnter) {
          e.preventDefault();
          onModEnter(i);
        } else if (!mod && onEnter) {
          e.preventDefault();
          onEnter(i);
        }
        break;
      default:
        break;
    }
  };

  return {
    active: index,
    setActive: setActiveState,
    containerProps: {
      ref: (el: HTMLElement | null) => {
        root.current = el;
      },
      onKeyDown,
    },
    itemProps: (i: number) => ({
      "data-roving-index": i,
      tabIndex: i === index ? 0 : -1,
      "aria-selected": i === index,
      onFocus: () => setActiveState(i),
    }),
    focusItem,
  };
}
