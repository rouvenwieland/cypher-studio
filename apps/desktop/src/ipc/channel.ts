import { Channel } from "@tauri-apps/api/core";

/** Kanal für Fortschrittsereignisse (ARCHITEKTUR 3.4). Fehler kommen nie über den Kanal, sondern als Ablehnung des Commands. */
export function channel<E>(onEvent: (event: E) => void): Channel<E> {
  const ch = new Channel<E>();
  ch.onmessage = onEvent;
  return ch;
}
