import { create } from "zustand";
import type { FileHandleInfo, JobInfo, JobRecord, UpdateCheck } from "@contract";

/* ---------- Meldungen ---------- */

export interface Toast {
  id: number;
  kind: "info" | "error";
  text: string;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => number;
  dismiss: (id: number) => void;
}

let toastId = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...toast, id }] }));
    // Fehler bleiben bis zum Schließen, Info 6 s (CONCEPT.md 4 „Meldungen“)
    if (toast.kind === "info")
      toastTimers.set(
        id,
        setTimeout(() => get().dismiss(id), 6000),
      );
    return id;
  },
  dismiss: (id) => {
    const timer = toastTimers.get(id);
    if (timer) clearTimeout(timer);
    toastTimers.delete(id);
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },
}));

/* ---------- Hauptaktion (Strg+Enter) ---------- */

interface MainActionState {
  run: (() => void) | null;
  set: (run: (() => void) | null) => void;
}

export const useMainAction = create<MainActionState>((set) => ({ run: null, set: (run) => set({ run }) }));

/* ---------- Oberflächen-Zustand ---------- */

interface UiState {
  paletteOpen: boolean;
  helpOpen: boolean;
  jobsOpen: boolean;
  setPalette: (open: boolean) => void;
  setHelp: (open: boolean) => void;
  setJobs: (open: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  paletteOpen: false,
  helpOpen: false,
  jobsOpen: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setHelp: (helpOpen) => set({ helpOpen }),
  setJobs: (jobsOpen) => set({ jobsOpen }),
}));

/* ---------- Aufträge ---------- */

interface JobsState {
  active: JobInfo[];
  /** Aufträge, die in dieser Sitzung endeten, neueste zuerst (Ergänzung zu jobs_recent) */
  finished: JobRecord[];
  /** IDs, die ein geöffneter Dialog selbst begleitet (keine Meldung bei Ende) */
  watched: Set<string>;
  unseenFailures: number;
  setActive: (active: JobInfo[]) => void;
  addFinished: (record: JobRecord) => void;
  watch: (id: string) => void;
  unwatch: (id: string) => void;
  markSeen: () => void;
}

/** Eigene Aufträge antworten in Ausgangsleiste oder Dialog, nicht als Meldung (CONCEPT.md 4 „Meldungen“). */
export function watchJobBriefly(id: string, ms = 5000): void {
  useJobs.getState().watch(id);
  setTimeout(() => useJobs.getState().unwatch(id), ms);
}

export const useJobs = create<JobsState>((set) => ({
  active: [],
  finished: [],
  watched: new Set(),
  unseenFailures: 0,
  setActive: (active) => set({ active }),
  addFinished: (record) =>
    set((s) => ({
      finished: [record, ...s.finished.filter((r) => r.info.id !== record.info.id)].slice(0, 50),
      unseenFailures: s.unseenFailures + (record.outcome === "failed" ? 1 : 0),
    })),
  watch: (id) => set((s) => ({ watched: new Set(s.watched).add(id) })),
  unwatch: (id) =>
    set((s) => {
      const next = new Set(s.watched);
      next.delete(id);
      return { watched: next };
    }),
  markSeen: () => set({ unseenFailures: 0 }),
}));

/** Lampe der Rail: Cyan läuft · Bernstein braucht dich · Rot gescheitert (Form + Wort stehen daneben). */
export type Lamp = "idle" | "running" | "attention" | "failed";

export function lampOf(active: JobInfo[], unseenFailures: number): Lamp {
  if (active.some((j) => j.needsAttention)) return "attention";
  if (unseenFailures > 0) return "failed";
  if (active.length > 0) return "running";
  return "idle";
}

/* ---------- Dateien (ziehen) ---------- */

interface DropState {
  serial: number;
  handles: FileHandleInfo[];
  push: (handles: FileHandleInfo[]) => void;
}

export const useDrops = create<DropState>((set) => ({
  serial: 0,
  handles: [],
  push: (handles) => set((s) => ({ serial: s.serial + 1, handles })),
}));

/* ---------- App-Update ---------- */

interface UpdateState {
  available: UpdateCheck | null;
  set: (u: UpdateCheck | null) => void;
}

export const useUpdate = create<UpdateState>((set) => ({ available: null, set: (available) => set({ available }) }));

/* ---------- Schließen mit laufenden Aufträgen ---------- */

interface CloseState {
  pending: JobInfo[] | null;
  set: (jobs: JobInfo[] | null) => void;
}

export const useCloseRequest = create<CloseState>((set) => ({ pending: null, set: (pending) => set({ pending }) }));
