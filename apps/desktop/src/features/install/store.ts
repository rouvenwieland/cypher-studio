import { create } from "zustand";

export interface InstallRequest {
  programId: string;
  version?: string | undefined;
}

interface InstallUi {
  request: InstallRequest | null;
  queue: InstallRequest[];
  open: (request: InstallRequest) => void;
  /** Mehrere nacheinander (Einstellungen → „Alle aktualisieren“): Nach dem Schließen folgt der nächste Dialog */
  openQueue: (requests: InstallRequest[]) => void;
  close: () => void;
}

/** Der Installationsdialog gehört der ganzen App (Start, Programme, Erststart); er wird einmal in der Shell eingehängt. */
export const useInstallUi = create<InstallUi>((set) => ({
  request: null,
  queue: [],
  open: (request) => set({ request, queue: [] }),
  openQueue: (requests) => set({ request: requests[0] ?? null, queue: requests.slice(1) }),
  close: () => set((s) => ({ request: s.queue[0] ?? null, queue: s.queue.slice(1) })),
}));
