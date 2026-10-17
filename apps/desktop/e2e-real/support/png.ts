/** PNG-Chunks lesen (Maße, Auflösung, Farbprofil) für die Prüfung der Exporte. */
import { readFileSync } from "node:fs";
import { crc32, deflateSync, inflateSync } from "node:zlib";

export interface PngFacts {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** pHYs in Pixel je Meter (Einheit Meter), sonst null */
  pixelsPerMeter: { x: number; y: number } | null;
  dpi: number | null;
  /** Name des eingebetteten Profils (iCCP), sonst null */
  profileName: string | null;
  /** Länge des entpackten Profils in Bytes */
  profileBytes: number;
  hasSrgb: boolean;
  chunks: string[];
}

export function readPng(path: string): PngFacts {
  const buf = readFileSync(path);
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: kein PNG`);
  let pos = 8;
  const facts: PngFacts = {
    width: 0,
    height: 0,
    bitDepth: 0,
    colorType: 0,
    pixelsPerMeter: null,
    dpi: null,
    profileName: null,
    profileBytes: 0,
    hasSrgb: false,
    chunks: [],
  };
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    facts.chunks.push(type);
    if (type === "IHDR") {
      facts.width = data.readUInt32BE(0);
      facts.height = data.readUInt32BE(4);
      facts.bitDepth = data[8] ?? 0;
      facts.colorType = data[9] ?? 0;
    } else if (type === "pHYs" && data[8] === 1) {
      const x = data.readUInt32BE(0);
      const y = data.readUInt32BE(4);
      facts.pixelsPerMeter = { x, y };
      facts.dpi = Math.round(x * 0.0254);
    } else if (type === "iCCP") {
      const end = data.indexOf(0);
      facts.profileName = data.toString("latin1", 0, end);
      facts.profileBytes = inflateSync(data.subarray(end + 2)).length;
    } else if (type === "sRGB") {
      facts.hasSrgb = true;
    }
    pos += 12 + len;
  }
  return facts;
}

/** Kleines RGBA-PNG aus einer Pixelfunktion (Testdateien für die Bibliothek). */
export function makePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], row + 1 + x * 4);
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Breite und Höhe einer JPEG-Datei aus dem SOF-Marker. */
export function readJpegSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error(`${path}: kein JPEG`);
  let pos = 2;
  while (pos + 9 < buf.length) {
    if (buf[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = buf[pos + 1] ?? 0;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(pos + 5), width: buf.readUInt16BE(pos + 7) };
    }
    pos += 2 + buf.readUInt16BE(pos + 2);
  }
  throw new Error(`${path}: keine Bildgröße gefunden`);
}
