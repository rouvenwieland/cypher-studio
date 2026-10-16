import { invoke } from "@tauri-apps/api/core";
import {
  EXPORT_IMAGE_HEADERS,
  type CommandArgs,
  type CommandName,
  type CommandResult,
  type ExportImageMeta,
  type FileHandleInfo,
} from "@contract";
import { toAppError } from "./errors";

/** Commands ohne Argumente (`NoArgs = Record<string, never>`) brauchen keinen zweiten Parameter. */
type ArgsTuple<K extends CommandName> = string extends keyof CommandArgs<K> ? [] : [args: CommandArgs<K>];

/** Typisierter Aufruf (ARCHITEKTUR 3.7 Nr. 6). Jede Ablehnung wird zu einer `AppError`. */
export async function call<K extends CommandName>(cmd: K, ...rest: ArgsTuple<K>): Promise<CommandResult<K>> {
  try {
    const args = (rest[0] ?? {}) as Record<string, unknown>; // Vertrag: alle Argumente sind Objekte
    return await invoke<CommandResult<K>>(cmd, args); // Ergebnistyp steht im Vertrag (Commands[K].result)
  } catch (raw) {
    throw toAppError(raw);
  }
}

/** RAW-Command `export_save_image`: Körper = Bilddaten, Metadaten als Header (Vertrag Abschnitt 7). */
export async function exportSaveImage(body: Uint8Array, meta: ExportImageMeta): Promise<FileHandleInfo | null> {
  try {
    const headers = { [EXPORT_IMAGE_HEADERS.meta]: encodeURIComponent(JSON.stringify(meta)) };
    return await invoke<FileHandleInfo | null>("export_save_image", body, { headers }); // Ergebnis laut RawCommands
  } catch (raw) {
    throw toAppError(raw);
  }
}
