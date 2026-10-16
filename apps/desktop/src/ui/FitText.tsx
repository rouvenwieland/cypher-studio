import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clamp } from "../lib/assert";

/**
 * Bandbreite (DESIGN.md type.bandbreite): Ein Wort füllt seine Spalte exakt über Anybodys Breitenachse.
 * Gemessen wird bei wdth 50, 100 und 150 (stückweise linear), dann direkt berechnet – keine Schleife.
 * Reicht die Achse nicht, passt sich die Schriftgröße im erlaubten Bereich an.
 */
interface Measure {
  w50: number;
  w100: number;
  w150: number;
}

const cache = new Map<string, Measure>();

export interface Fit {
  fontSize: number;
  stretch: number;
}

/** Reine Rechnung, getrennt von der Messung (Vitest). */
export function solveFit(target: number, m: Measure, pref: number, min: number, max: number): Fit {
  if (!(target > 0) || !(m.w50 > 0) || !(m.w150 > 0)) return { fontSize: pref, stretch: 100 };
  if (target < m.w50) return { fontSize: clamp((pref * target) / m.w50, min, max), stretch: 50 };
  if (target > m.w150) return { fontSize: clamp((pref * target) / m.w150, min, max), stretch: 150 };
  if (target <= m.w100) {
    const span = m.w100 - m.w50;
    return { fontSize: pref, stretch: span > 0 ? 50 + (50 * (target - m.w50)) / span : 100 };
  }
  const span = m.w150 - m.w100;
  return { fontSize: pref, stretch: span > 0 ? 100 + (50 * (target - m.w100)) / span : 150 };
}

function useFontsReady(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const bump = () => {
      if (alive) setTick((n) => n + 1);
    };
    void document.fonts.load('800 48px "Anybody"').then(bump, bump);
    void document.fonts.ready.then(bump, bump);
    return () => {
      alive = false;
    };
  }, []);
  return tick;
}

interface FitTextProps {
  text: string;
  /** Wunsch-Schriftgröße in px (Versalhöhe ≈ 0,7 × Größe) */
  size: number;
  minSize?: number;
  maxSize?: number;
  weight?: number;
  /** Beim ersten Passen und bei Textwechsel einmal über die Breitenachse einrasten (480 ms) */
  snap?: boolean | undefined;
  className?: string | undefined;
  /** Zugänglicher Name (der Text ist in Versalien gesetzt) */
  label?: string | undefined;
}

export function FitText({
  text,
  size,
  minSize = 12,
  maxSize = 160,
  weight = 800,
  snap,
  className,
  label,
}: FitTextProps) {
  const box = useRef<HTMLSpanElement>(null);
  const span = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const fonts = useFontsReady();
  const snapped = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = span.current;
    if (!el || width <= 0) return;
    const key = `${text}|${size}|${weight}`;
    let m = cache.get(key);
    if (!m || fonts === 0) {
      const prevStretch = el.style.fontStretch;
      const prevSize = el.style.fontSize;
      el.style.fontSize = `${size}px`;
      el.style.fontWeight = String(weight);
      el.style.fontStretch = "50%";
      const w50 = el.offsetWidth;
      el.style.fontStretch = "100%";
      const w100 = el.offsetWidth;
      el.style.fontStretch = "150%";
      const w150 = el.offsetWidth;
      el.style.fontStretch = prevStretch;
      el.style.fontSize = prevSize;
      m = { w50, w100, w150 };
      if (fonts > 0) cache.set(key, m);
    }
    const fit = solveFit(width, m, size, minSize, maxSize);
    el.style.fontSize = `${fit.fontSize.toFixed(2)}px`;
    el.style.fontStretch = `${fit.stretch.toFixed(2)}%`;
    if (snap && fonts > 0 && snapped.current !== text) {
      snapped.current = text;
      const dur =
        Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dur-einrasten")) || 0;
      if (dur > 0 && typeof el.animate === "function") {
        el.animate([{ fontStretch: "50%" }, { fontStretch: `${fit.stretch.toFixed(2)}%` }], {
          duration: dur,
          easing: "cubic-bezier(.16,1,.3,1)",
        });
      }
    }
  }, [text, size, minSize, maxSize, weight, width, fonts, snap]);

  return (
    <span
      ref={box}
      className={className ? `fit ${className}` : "fit"}
      // bis die Schrift da ist, bleibt das Wort unsichtbar (Platz bleibt): so springt nichts von der Ersatzschrift zur Kennung
      style={fonts === 0 ? { visibility: "hidden" } : undefined}
      {...(label ? { role: "img", "aria-label": label } : {})}
    >
      <span
        ref={span}
        className="fit__text"
        aria-hidden={label ? "true" : undefined}
        style={{ fontSize: size, fontWeight: weight }}
      >
        {text}
      </span>
    </span>
  );
}
