import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { QueryClient } from "@tanstack/react-query";
import type { CommandName, EventMap, EventName } from "@contract";
import { useCloseRequest, useDrops, useJobs, useToasts, useUpdate } from "../app/stores";
import { t } from "../i18n/de";

/** Ein Ereignis, typisiert nach dem Vertrag (EventMap). */
export function onEvent<K extends EventName>(name: K, handler: (payload: EventMap[K]) => void): Promise<UnlistenFn> {
  return listen<EventMap[K]>(name, (event) => handler(event.payload));
}

/**
 * Invalidiert Abfragen so, dass keine Antwort gewinnt, die älter ist als das Ereignis. TanStack Query ersetzt eine laufende
 * Abfrage ohne Daten nicht, sondern hängt die Invalidierung an sie an: Kommt ein Ereignis, während die erste Abfrage noch
 * läuft (z. B. die Bibliothek direkt nach der Ordnerwahl, bevor das Einlesen fertig ist), bliebe deren veraltete Antwort
 * stehen. Läuft also beim Ereignis schon eine Abfrage, wird nach ihrem Ende noch einmal geladen.
 */
export function invalidateFresh(qc: QueryClient, ...names: CommandName[]): void {
  for (const name of names) {
    const filter = { queryKey: [name] };
    const wasFetching = qc.isFetching(filter) > 0;
    void qc.invalidateQueries(filter);
    if (!wasFetching) continue;
    const timer = setTimeout(() => off(), 60_000);
    const off = qc.getQueryCache().subscribe(() => {
      if (qc.isFetching(filter) > 0) return;
      off();
      clearTimeout(timer);
      void qc.invalidateQueries(filter);
    });
  }
}

/**
 * Frontend-Regel (ARCHITEKTUR 3.5): Ereignisse invalidieren nur, Daten kommen immer über Commands.
 * Ausnahme: Fortschritt der Aufträge (≤ 2/s) landet direkt im Speicher, damit nicht ständig neu geladen wird.
 */
export async function bridgeEvents(qc: QueryClient): Promise<() => void> {
  const invalidate = (...names: CommandName[]) => invalidateFresh(qc, ...names);
  const handles: UnlistenFn[] = [];
  handles.push(
    await onEvent("catalog:updated", () => invalidate("catalog_status", "programs_list")),
    await onEvent("programs:changed", () =>
      invalidate("programs_list", "setup_packs_list", "setup_status", "setup_history", "setup_preview"),
    ),
    await onEvent("library:changed", () =>
      invalidate("library_status", "library_query", "library_get", "projects_list"),
    ),
    await onEvent("projects:changed", () => invalidate("projects_list", "library_query")),
    await onEvent("files:dropped", (p) => useDrops.getState().push(p.handles)),
    await onEvent("update:available", (u) => useUpdate.getState().set(u)),
    await onEvent("app:closeRequested", (p) => useCloseRequest.getState().set(p.activeJobs)),
    await onEvent("jobs:changed", (p) => {
      const jobs = useJobs.getState();
      jobs.setActive(p.active);
      if (p.finished) {
        jobs.addFinished(p.finished);
        invalidate("jobs_recent");
        const rec = p.finished;
        // Nur fertige Hintergrundarbeit meldet sich; was ein offener Dialog begleitet, antwortet dort
        if (!jobs.watched.has(rec.info.id) && rec.outcome !== "cancelled") {
          useToasts.getState().push({
            kind: rec.outcome === "failed" ? "error" : "info",
            text: rec.outcome === "failed" ? t.jobs.toastFailed(rec.info.subject) : t.jobs.toastDone(rec.info.subject),
          });
        }
      }
    }),
  );
  return () => {
    for (const un of handles) {
      try {
        un();
      } catch {
        /* Mock-Modus kennt nicht alle Abmeldungen */
      }
    }
  };
}
