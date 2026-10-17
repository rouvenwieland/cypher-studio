import { describe, expect, it } from "vitest";
import { de } from "./de";

/** Alle festen Zeichenketten der Texte mit ihrem Pfad (Funktionen werden nicht aufgerufen). */
function strings(node: unknown, path: string[] = []): { path: string; text: string }[] {
  if (typeof node === "string") return [{ path: path.join("."), text: node }];
  if (node && typeof node === "object") return Object.entries(node).flatMap(([k, v]) => strings(v, [...path, k]));
  return [];
}

const all = strings(de);

describe("Texte (Review-Befunde: kein Entwicklertext, kein Jargon, keine Doppelsätze)", () => {
  it("enthält keinen Entwicklertext und keinen Jargon für Einsteiger", () => {
    const banned = /Alt-Text|Prüfungsanzeige|Spiegel|Manifest/;
    const hits = all.filter((s) => banned.test(s.text)).map((s) => `${s.path}: ${s.text}`);
    expect(hits).toEqual([]);
  });

  it("wiederholt keinen Satz innerhalb desselben Bereichs unter zwei Schlüsseln", () => {
    const dupes: string[] = [];
    const byArea = new Map<string, { path: string; text: string }[]>();
    for (const s of all) {
      const area = s.path.split(".")[0] ?? "";
      byArea.set(area, [...(byArea.get(area) ?? []), s]);
    }
    for (const [area, list] of byArea) {
      for (const a of list) {
        for (const b of list) {
          if (a.path === b.path || a.text.length < 28) continue;
          // ein längerer Text, der einen anderen (≥ 28 Zeichen) vollständig enthält, ist ein Doppelsatz
          if (b.text.length > a.text.length && b.text.includes(a.text))
            dupes.push(`${area}: „${a.text}“ steckt in ${b.path}`);
        }
      }
    }
    expect(dupes).toEqual([]);
  });

  it("zeigt Grenzen nie mit demselben Vergleichszeichen wie den Messwert (kein „0,4 % ≤ 0,1 %“)", () => {
    const limits = Object.values(de.print.checks).map((c) => c.limit);
    for (const limit of limits) {
      const text =
        typeof limit === "function" ? (limit as (...a: never[]) => string)(...([1, 2, 3] as never[])) : limit;
      // jede Grenze beginnt mit einem Wort („erlaubt“, „nötig“) oder ist ein Wert ohne Operator am Anfang
      expect(text).not.toMatch(/^\s*[≤≥]/);
    }
  });
});
