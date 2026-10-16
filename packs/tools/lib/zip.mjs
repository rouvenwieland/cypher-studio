// Minimaler, deterministischer ZIP-Schreiber und -Leser (nur "stored" und "deflate", kein ZIP64).
// Zweck: Krita-Paletten (.kpl) und Ressourcen-Bundles (.bundle) reproduzierbar erzeugen und in Tests prüfen.
// Keine Laufzeit-Abhängigkeiten: nur node:zlib.
import { crc32 as zlibCrc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/** Feste DOS-Zeit 01.01.1980 00:00:00, damit gleiche Eingaben bytegleiche ZIPs ergeben. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** @param {Uint8Array} data */
export function crc32(data) {
  return zlibCrc32(data) >>> 0;
}

/**
 * @typedef {{ name: string, data: Uint8Array | string, store?: boolean }} ZipEntryInput
 * `store: true` = unkomprimiert (für `mimetype`, muss laut ODF/KoStore der erste Eintrag sein).
 */

/**
 * Schreibt ein ZIP in der Reihenfolge der Einträge. Gleiche Eingaben → gleiche Bytes.
 * @param {ZipEntryInput[]} entries
 * @returns {Buffer}
 */
export function writeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.name)) throw new Error(`ZIP: doppelter Eintrag ${entry.name}`);
    seen.add(entry.name);
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : Buffer.from(entry.data);
    const method = entry.store || raw.length === 0 ? 0 : 8;
    const body = method === 0 ? raw : deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const utf8Flag = /^[\x20-\x7e]*$/.test(entry.name) ? 0 : 0x0800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // Version zum Entpacken
    local.writeUInt16LE(utf8Flag, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBytes, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // erstellt mit Version 2.0, Host FAT/DOS
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(utf8Flag, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30); // Extra
    cd.writeUInt16LE(0, 32); // Kommentar
    cd.writeUInt16LE(0, 34); // Datenträger
    cd.writeUInt16LE(0, 36); // interne Attribute
    cd.writeUInt32LE(0, 38); // externe Attribute
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cdBuf, end]);
}

/**
 * @typedef {{ name: string, method: number, crc: number, size: number, compressedSize: number, data: Buffer }} ZipEntry
 */

/**
 * Liest ein ZIP über das Zentralverzeichnis und prüft CRC-32 sowie Größen.
 * @param {Uint8Array} bytes
 * @returns {ZipEntry[]} Einträge in Zentralverzeichnis-Reihenfolge
 */
export function readZip(bytes) {
  const buf = Buffer.from(bytes);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP: Ende des Zentralverzeichnisses nicht gefunden');
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  /** @type {ZipEntry[]} */
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('ZIP: Zentralverzeichnis beschädigt');
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const size = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP: lokaler Header von ${name} beschädigt`);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`ZIP: Methode ${method} wird nicht unterstützt (${name})`);
    if (data.length !== size) throw new Error(`ZIP: Größe von ${name} stimmt nicht`);
    if (crc32(data) !== crc) throw new Error(`ZIP: CRC von ${name} stimmt nicht`);
    out.push({ name, method, crc, size, compressedSize, data });
  }
  return out;
}
