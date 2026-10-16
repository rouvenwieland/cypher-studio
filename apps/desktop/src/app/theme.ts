import { useEffect, useState } from "react";
import type { Settings, UiPreferences } from "@contract";
import { useCmd } from "../ipc/queries";

const CACHE_KEY = "cypher.ui";

/** Beim Start vor dem ersten Bild anwenden, damit nichts aufblitzt (Browser-Speicher nur als Komfort). */
export function applyCachedUi(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) applyUi(JSON.parse(raw) as UiPreferences);
  } catch {
    /* Speicher kann fehlen oder leer sein: dann gilt der Standard */
  }
  applyViewport();
}

export function applyUi(ui: UiPreferences): void {
  const root = document.documentElement;
  if (ui.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", ui.theme === "paper" ? "light" : "dark");
  root.setAttribute("data-density", ui.density);
  if (ui.motion === "system") root.removeAttribute("data-motion");
  else root.setAttribute("data-motion", ui.motion);
  const measure =
    ui.measureColor === "cyan"
      ? null
      : ui.measureColor === "ink"
        ? "tinte"
        : ui.measureColor === "paper"
          ? "papier"
          : "magenta";
  if (measure) root.setAttribute("data-messfarbe", measure);
  else root.removeAttribute("data-messfarbe");
  root.style.setProperty("--app-zoom", String(ui.zoomPercent / 100));
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(ui));
  } catch {
    /* ignorieren */
  }
  applyViewport();
}

/** Effektive Breite = Fenster / App-Zoom: Rail und Inspektor richten sich nach dem, was wirklich Platz hat. */
export function applyViewport(): void {
  const root = document.documentElement;
  const zoom = Number.parseFloat(getComputedStyle(root).getPropertyValue("--app-zoom")) || 1;
  const w = window.innerWidth / zoom;
  const h = window.innerHeight / zoom;
  root.setAttribute("data-bp", w < 1180 ? "narrow" : w >= 1360 ? "wide" : "std");
  root.setAttribute("data-bh", h < 760 ? "short" : "tall");
}

export function useEffectiveTheme(ui: UiPreferences | undefined): "paper" | "ink" {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  if (ui?.theme === "paper") return "paper";
  if (ui?.theme === "ink") return "ink";
  return dark ? "ink" : "paper";
}

/** Wendet die Oberflächen-Einstellungen an, sobald sie geladen oder geändert sind. */
export function useApplyUi(settings: Settings | undefined): void {
  const ui = settings?.ui;
  useEffect(() => {
    if (ui) applyUi(ui);
  }, [ui]);
  useEffect(() => {
    const on = () => applyViewport();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
}

export function useSettings() {
  return useCmd("settings_get", undefined, { staleTime: 30_000 });
}

export type Breakpoint = "narrow" | "std" | "wide";

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(
    () => (document.documentElement.getAttribute("data-bp") as Breakpoint | null) ?? "std",
  );
  useEffect(() => {
    const read = () => setBp((document.documentElement.getAttribute("data-bp") as Breakpoint | null) ?? "std");
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-bp"] });
    read();
    return () => mo.disconnect();
  }, []);
  return bp;
}
