import { create } from "zustand";

/**
 * Programme, die gerade deinstalliert werden. Das Löschen eines großen Ordners (Blender: 1,5 GB) dauert einige Sekunden;
 * solange zeigt die Zeile „wird deinstalliert …“ statt „installiert“. Die Kennung bleibt gesetzt, bis die Liste neu
 * geladen ist, damit der alte Zustand nicht kurz zurückkehrt.
 */
interface RemovalState {
  programIds: readonly string[];
  begin: (programId: string) => void;
  end: (programId: string) => void;
}

export const useRemovals = create<RemovalState>((set) => ({
  programIds: [],
  begin: (programId) =>
    set((s) => (s.programIds.includes(programId) ? s : { programIds: [...s.programIds, programId] })),
  end: (programId) => set((s) => ({ programIds: s.programIds.filter((id) => id !== programId) })),
}));
