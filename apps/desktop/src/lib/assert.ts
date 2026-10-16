/** Für erschöpfende `switch`-Anweisungen über getaggte Unions (BAU-REGELN „Qualität“). */
export function assertNever(value: never, context = "Wert"): never {
  throw new Error(`${context} nicht behandelt: ${JSON.stringify(value)}`);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rundet auf `digits` Nachkommastellen (ohne Gleitkomma-Rauschen). */
export function round(value: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
