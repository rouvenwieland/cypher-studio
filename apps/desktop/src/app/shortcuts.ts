import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../ipc/commands";
import { isMacPlatform } from "../lib/platform";
import { isTextEntry, matchesCombo } from "../lib/keys";
import { clamp } from "../lib/assert";
import { MODULES, SETTINGS_PATH } from "./modules";
import { useMainAction, useUi } from "./stores";
import { useSettings } from "./theme";

const REGION_SELECTOR = "[data-region]";
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** F6: nächster Bereich in Lesereihenfolge (Rail → Vorschau → Messung → Ausgang), Umschalt+F6 rückwärts. */
export function cycleRegion(back: boolean): void {
  const regions = [...document.querySelectorAll<HTMLElement>(REGION_SELECTOR)].filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
  if (regions.length === 0) return;
  const active = document.activeElement;
  let index = regions.findIndex((r) => r === active || r.contains(active));
  if (index < 0) index = back ? 0 : -1;
  const next = regions[(index + (back ? -1 : 1) + regions.length) % regions.length];
  if (!next) return;
  const first = next.querySelector<HTMLElement>(`[data-autofocus], ${FOCUSABLE}`);
  (first ?? next).focus();
}

export function useGlobalShortcuts(): void {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const settings = useSettings();
  const zoom = settings.data?.ui.zoomPercent ?? 100;

  useEffect(() => {
    const mac = isMacPlatform();
    const setZoom = (value: number) => {
      void call("settings_update", { req: { ui: { zoomPercent: clamp(value, 50, 200) } } }).then(() => qc.invalidateQueries({ queryKey: ["settings_get"] }));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      // Im Erststart (Vollfenster ohne Rail) gelten nur Hilfe, Fokuswechsel, Zoom und die Hauptaktion
      const intro = window.location.hash.startsWith("#/erststart");
      if (intro && !(e.key === "F6" || e.key === "F1" || e.key === "?" || matchesCombo(e, "mod+enter", mac) || matchesCombo(e, "mod+=", mac) || matchesCombo(e, "mod+plus", mac) || matchesCombo(e, "mod+-", mac) || matchesCombo(e, "mod+0", mac))) return;
      for (const m of MODULES) {
        if (matchesCombo(e, `mod+${m.digit}`, mac)) {
          e.preventDefault();
          void navigate(m.path);
          return;
        }
      }
      if (matchesCombo(e, "mod+k", mac)) {
        e.preventDefault();
        const ui = useUi.getState();
        ui.setPalette(!ui.paletteOpen);
      } else if (matchesCombo(e, "mod+enter", mac)) {
        const run = useMainAction.getState().run;
        if (run) {
          e.preventDefault();
          run();
        }
      } else if (matchesCombo(e, "mod+j", mac)) {
        e.preventDefault();
        const ui = useUi.getState();
        ui.setJobs(!ui.jobsOpen);
      } else if (matchesCombo(e, "mod+,", mac)) {
        e.preventDefault();
        void navigate(SETTINGS_PATH);
      } else if (matchesCombo(e, "mod+n", mac)) {
        e.preventDefault();
        void navigate("/start?neu=1");
      } else if (matchesCombo(e, "mod+o", mac)) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("cypher:open-file"));
      } else if (matchesCombo(e, "mod+=", mac) || matchesCombo(e, "mod+plus", mac)) {
        e.preventDefault();
        setZoom(zoom + 10);
      } else if (matchesCombo(e, "mod+-", mac)) {
        e.preventDefault();
        setZoom(zoom - 10);
      } else if (matchesCombo(e, "mod+0", mac)) {
        e.preventDefault();
        setZoom(100);
      } else if (e.key === "F6") {
        e.preventDefault();
        cycleRegion(e.shiftKey);
      } else if (e.key === "F1" || (e.key === "?" && !isTextEntry(e.target) && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        useUi.getState().setHelp(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, qc, zoom]);
}
