/** Hilfen für Abbruch-Signale (ohne Abhängigkeit von `AbortSignal.throwIfAborted`). */
import { abortError } from "./errors";

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

/**
 * Wartet auf ein Versprechen, lässt aber das Signal vorrangig gelten.
 * Das zugrunde liegende Versprechen läuft weiter (z. B. Laden einer Ebene in den Cache) und bleibt unberührt.
 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (reason: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      },
    );
  });
}
