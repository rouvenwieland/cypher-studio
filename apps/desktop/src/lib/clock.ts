/**
 * Zeitquelle der App. Im Mock-Modus wird sie auf einen festen Zeitpunkt gesetzt (Screenshots, Tests),
 * sonst liefert sie die Systemzeit.
 */
let offsetMs = 0;

export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

export function nowIso(): string {
  return now().toISOString();
}

/** Setzt die App-Zeit so, dass `now()` jetzt `target` liefert und von dort weiterläuft. */
export function setClockTo(target: Date): void {
  offsetMs = target.getTime() - Date.now();
}

export function resetClock(): void {
  offsetMs = 0;
}
