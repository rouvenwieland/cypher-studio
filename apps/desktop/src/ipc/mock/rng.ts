/** Deterministischer Zufall für Fixtures (gleiche Eingabe, gleiche Daten: stabile Screenshots). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 64 Hexzeichen, aus einem Text abgeleitet (Platzhalter-Prüfsumme in Fixtures, kein echter SHA-256). */
export function fakeSha256(text: string): string {
  const rnd = mulberry32(hashString(text));
  let out = "";
  while (out.length < 64)
    out += Math.floor(rnd() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  return out.slice(0, 64);
}

export function uuid(rnd: () => number = Math.random): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(rnd() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

export function pick<T>(items: readonly T[], rnd: () => number): T {
  const item = items[Math.floor(rnd() * items.length)];
  if (item === undefined) throw new Error("pick: leere Liste");
  return item;
}

export function shuffle<T>(items: readonly T[], rnd: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
