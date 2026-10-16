import { useMemo } from "react";
import { keepPreviousData, useQueries } from "@tanstack/react-query";
import type { AppError, LibraryEntry, LibraryFacets, LibraryPage, LibraryQuery } from "@contract";
import { call } from "../../ipc/commands";

export const PAGE_SIZE = 200;

export type LibraryFilters = Omit<LibraryQuery, "offset" | "limit">;

export interface LibraryData {
  total: number;
  facets: LibraryFacets | null;
  /** Eintrag an Position i, falls seine Seite schon geladen ist */
  at: (index: number) => LibraryEntry | undefined;
  loadedCount: number;
  isPending: boolean;
  isFetching: boolean;
  error: AppError | null;
  /** Alle geladenen Einträge in Reihenfolge (für Bereichsauswahl und „Alle auswählen“) */
  loaded: () => LibraryEntry[];
}

/**
 * Wahlfreier Zugriff auf das Bibliotheksraster: Es werden nur die Seiten (je 200 Einträge) geladen, die sichtbar sind
 * (virtualisiert, ARCHITEKTUR 3.2 `library_query`: Standard 200, höchstens 1000).
 */
export function useLibraryPages(filters: LibraryFilters, visiblePages: number[]): LibraryData {
  const pages = useMemo(() => [...new Set([0, ...visiblePages])].sort((a, b) => a - b), [visiblePages]);
  const results = useQueries({
    queries: pages.map((pg) => ({
      queryKey: ["library_query", { ...filters, offset: pg * PAGE_SIZE, limit: PAGE_SIZE }] as const,
      queryFn: () => call("library_query", { req: { ...filters, offset: pg * PAGE_SIZE, limit: PAGE_SIZE } }),
      staleTime: 10_000,
      retry: false,
      ...(pg === 0 ? { placeholderData: keepPreviousData } : {}),
    })),
  });

  const first = results[0];
  const firstData: LibraryPage | undefined = first?.data;
  const byPage = new Map<number, LibraryEntry[]>();
  results.forEach((r, i) => {
    const pg = pages[i];
    if (pg !== undefined && r.data) byPage.set(pg, r.data.entries);
  });
  return {
    total: firstData?.total ?? 0,
    facets: firstData?.facets ?? null,
    at: (index) => byPage.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE],
    loadedCount: [...byPage.values()].reduce((n, p) => n + p.length, 0),
    isPending: first?.isPending ?? true,
    isFetching: results.some((r) => r.isFetching),
    error: (first?.error as AppError | null) ?? null, // TanStack liefert den Fehler unserer queryFn: immer AppError (call() wirft nur AppError)
    loaded: () => [...byPage.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, entries]) => entries),
  };
}
