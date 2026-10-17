import { describe, expect, it } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { invalidateFresh } from "./events";

/** Eine Abfrage, deren Antwort erst nach 40 ms kommt und den Stand zum Zeitpunkt des Starts zeigt (wie ein Einlesen, das noch läuft). */
function slowSource() {
  let value = "alt";
  let calls = 0;
  return {
    set: (v: string) => {
      value = v;
    },
    calls: () => calls,
    queryFn: async () => {
      calls++;
      const snapshot = value;
      await new Promise((r) => setTimeout(r, 40));
      return snapshot;
    },
  };
}

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Ereignisse laden neu, ohne veraltete Antworten stehen zu lassen", () => {
  it("eine einfache Invalidierung lässt die alte Antwort stehen, wenn die erste Abfrage noch läuft (der Fehler im echten Fenster)", async () => {
    const qc = new QueryClient();
    const src = slowSource();
    const observer = new QueryObserver(qc, { queryKey: ["library_query"], queryFn: src.queryFn, retry: false });
    const off = observer.subscribe(() => undefined); // erste Abfrage läuft, noch ohne Daten
    src.set("neu"); // das Einlesen ist fertig, während die erste Antwort noch unterwegs ist
    await qc.invalidateQueries({ queryKey: ["library_query"] });
    await later(150);
    expect(observer.getCurrentResult().data).toBe("alt");
    expect(src.calls()).toBe(1);
    off();
  });

  it("invalidateFresh lädt nach dem Ende der laufenden Abfrage noch einmal und zeigt den neuen Stand", async () => {
    const qc = new QueryClient();
    const src = slowSource();
    const observer = new QueryObserver(qc, { queryKey: ["library_query"], queryFn: src.queryFn, retry: false });
    const off = observer.subscribe(() => undefined);
    src.set("neu");
    invalidateFresh(qc, "library_query");
    await expect.poll(() => observer.getCurrentResult().data, { timeout: 2000 }).toBe("neu");
    expect(src.calls()).toBe(2);
    off();
  });

  it("ohne laufende Abfrage lädt eine Invalidierung genau einmal neu", async () => {
    const qc = new QueryClient();
    const src = slowSource();
    const observer = new QueryObserver(qc, { queryKey: ["x"], queryFn: src.queryFn, retry: false });
    const off = observer.subscribe(() => undefined);
    await expect.poll(() => observer.getCurrentResult().data).toBe("alt");
    src.set("neu");
    invalidateFresh(qc, "x" as never);
    await expect.poll(() => observer.getCurrentResult().data).toBe("neu");
    await later(150);
    expect(src.calls()).toBe(2);
    off();
  });
});
