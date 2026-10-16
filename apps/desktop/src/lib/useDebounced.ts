import { useEffect, useState } from "react";

/** Verzögert einen Wert, damit Schieberegler und Eingabefelder die Prüfung nicht bei jedem Pixel auslösen. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
