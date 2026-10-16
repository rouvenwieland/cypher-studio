// PNG-Hilfen ohne Abhängigkeiten: Kopfdaten und pHYs lesen (Prüfungen), RGBA kodieren (Probe-Motiv, Platzhalter).
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @typedef {{
 *   width: number, height: number, bitDepth: number, colorType: number, interlace: number,
 *   hasAlpha: boolean, phys: { xPpm: number, yPpm: number, unit: number } | null,
 *   dpi: { x: number, y: number } | null, chunks: string[]
 * }} PngInfo
 */

/** Liest Kopf, pHYs und Chunk-Folge; prüft Signatur und alle CRCs. @param {Uint8Array} bytes @returns {PngInfo} */
export function readPngInfo(bytes) {
  const buf = Buffer.from(bytes);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('PNG: Signatur fehlt');
  let pos = 8;
  const chunks = [];
  let ihdr = null;
  let phys = null;
  let hasTrns = false;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    const crc = buf.readUInt32BE(pos + 8 + len);
    if ((crc32(buf.subarray(pos + 4, pos + 8 + len)) >>> 0) !== crc) throw new Error(`PNG: CRC von ${type} stimmt nicht`);
    chunks.push(type);
    if (type === 'IHDR') ihdr = data;
    if (type === 'pHYs') phys = { xPpm: data.readUInt32BE(0), yPpm: data.readUInt32BE(4), unit: data[8] };
    if (type === 'tRNS') hasTrns = true;
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('PNG: IHDR fehlt');
  if (chunks.at(-1) !== 'IEND') throw new Error('PNG: IEND fehlt');
  const colorType = ihdr[9];
  return {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth: ihdr[8],
    colorType,
    interlace: ihdr[12],
    hasAlpha: colorType === 4 || colorType === 6 || hasTrns,
    phys,
    dpi: phys && phys.unit === 1 ? { x: Math.round((phys.xPpm * 25.4) / 1000) / 1, y: Math.round((phys.yPpm * 25.4) / 1000) / 1 } : null,
    chunks,
  };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * Kodiert 8-Bit-RGBA (nicht verschachtelt). Filter 0, damit die Ausgabe einfach und reproduzierbar bleibt.
 * @param {number} width @param {number} height @param {Uint8Array} rgba Länge width*height*4
 * @param {{ dpi?: number }} [opts] mit `dpi` wird pHYs (Pixel je Meter) geschrieben
 */
export function encodePngRgba(width, height, rgba, opts = {}) {
  if (rgba.length !== width * height * 4) throw new Error('PNG: Pixelzahl passt nicht zu Breite × Höhe');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const parts = [SIGNATURE, chunk('IHDR', ihdr)];
  if (opts.dpi) {
    const ppm = Math.round((opts.dpi / 25.4) * 1000);
    const phys = Buffer.alloc(9);
    phys.writeUInt32BE(ppm, 0);
    phys.writeUInt32BE(ppm, 4);
    phys[8] = 1;
    parts.push(chunk('pHYs', phys));
  }
  parts.push(chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/**
 * Dekodiert 8-Bit-RGBA oder -RGB ohne Verschachtelung (reicht für die Pixelprüfungen in den Tests).
 * @param {Uint8Array} bytes @returns {{ width: number, height: number, rgba: Uint8Array }}
 */
export function decodePngRgba(bytes) {
  const info = readPngInfo(bytes);
  if (info.bitDepth !== 8 || info.interlace !== 0 || (info.colorType !== 6 && info.colorType !== 2)) {
    throw new Error(`PNG: nur 8 Bit RGB/RGBA ohne Verschachtelung unterstützt (Typ ${info.colorType}, Tiefe ${info.bitDepth})`);
  }
  const buf = Buffer.from(bytes);
  const idat = [];
  for (let pos = 8; pos + 12 <= buf.length; ) {
    const len = buf.readUInt32BE(pos);
    if (buf.toString('latin1', pos + 4, pos + 8) === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const bpp = info.colorType === 6 ? 4 : 3;
  const stride = info.width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(info.width * info.height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < info.height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`PNG: unbekannter Filter ${filter}`);
      line[x] = (line[x] + add) & 0xff;
    }
    for (let x = 0; x < info.width; x++) {
      const o = (y * info.width + x) * 4;
      out[o] = line[x * bpp];
      out[o + 1] = line[x * bpp + 1];
      out[o + 2] = line[x * bpp + 2];
      out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { width: info.width, height: info.height, rgba: out };
}
