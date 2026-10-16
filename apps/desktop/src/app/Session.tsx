import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { bridgeEvents } from "../ipc/events";
import { useCmd } from "../ipc/queries";
import { CloseDialog, HelpDialog, Toasts } from "./Overlays";
import { useGlobalShortcuts } from "./shortcuts";
import { useJobs, useUpdate } from "./stores";
import { useApplyUi, useSettings } from "./theme";

/**
 * Alles, was für die ganze Sitzung gilt (auch im Erststart ohne Rail): Thema anwenden, Kürzel, Ereignisse, Aufträge,
 * Update-Prüfung, Meldungen, Hilfe.
 */
export function Session() {
  const qc = useQueryClient();
  const settings = useSettings();
  useApplyUi(settings.data);
  useGlobalShortcuts();

  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    void bridgeEvents(qc).then((un) => {
      if (cancelled) un();
      else off = un;
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [qc]);

  const jobs = useCmd("jobs_active", undefined);
  useEffect(() => {
    if (jobs.data) useJobs.getState().setActive(jobs.data);
  }, [jobs.data]);

  const update = useCmd("app_update_check", undefined, { staleTime: 5 * 60_000, retry: false });
  useEffect(() => {
    if (update.data?.available) useUpdate.getState().set(update.data);
  }, [update.data]);

  return (
    <>
      <Toasts />
      <HelpDialog />
      <CloseDialog />
    </>
  );
}
