// Minimaler TrueType/OpenType-Leser (nur Tabellenverzeichnis, name, OS/2, fvar): Familien-, Schnitt- und Vollnamen für die Windows-Anmeldung
// der Schriften sowie die Prüfung "statisch oder variabel", Gewichtsklasse und "Reserved Font Name" im Urheberrechtseintrag.
// Ändert oder instanziiert nichts; die Schriftdateien bleiben byteidentisch zum Upstream.

/**
 * @typedef {{
 *   copyright: string, family: string, subfamily: string, fullName: string, postScriptName: string,
 *   typographicFamily: string | null, typographicSubfamily: string | null,
 *   weightClass: number | null, widthClass: number | null, italicAngle: number, isVariable: boolean, axes: string[], hasReservedFontName: boolean
 * }} FontInfo
 */

/** @param {Uint8Array} bytes @returns {FontInfo} */
export function readFontInfo(bytes) {
  const buf = Buffer.from(bytes);
  const tag = buf.toString('latin1', 0, 4);
  if (!['\u0000\u0001\u0000\u0000', 'OTTO', 'true'].includes(tag)) throw new Error('Keine TrueType/OpenType-Datei (sfnt-Kennung fehlt)');
  const numTables = buf.readUInt16BE(4);
  /** @type {Record<string, { offset: number, length: number }>} */
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    tables[buf.toString('latin1', rec, rec + 4)] = { offset: buf.readUInt32BE(rec + 8), length: buf.readUInt32BE(rec + 12) };
  }
  if (!tables.name) throw new Error('Tabelle "name" fehlt');
  const nameOff = tables.name.offset;
  const count = buf.readUInt16BE(nameOff + 2);
  const storage = nameOff + buf.readUInt16BE(nameOff + 4);
  /** @type {Map<number, string>} */
  const names = new Map();
  for (let i = 0; i < count; i++) {
    const rec = nameOff + 6 + i * 12;
    const platform = buf.readUInt16BE(rec);
    const encoding = buf.readUInt16BE(rec + 2);
    const language = buf.readUInt16BE(rec + 4);
    const id = buf.readUInt16BE(rec + 6);
    const length = buf.readUInt16BE(rec + 8);
    const offset = storage + buf.readUInt16BE(rec + 10);
    let text;
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      const raw = Buffer.from(buf.subarray(offset, offset + length));
      for (let k = 0; k + 1 < raw.length; k += 2) {
        const hi = raw[k];
        raw[k] = raw[k + 1];
        raw[k + 1] = hi;
      }
      text = raw.toString('utf16le');
      if (language !== 0x409 && names.has(id)) continue; // Englisch (US) bevorzugen
    } else if (platform === 1 && encoding === 0 && !names.has(id)) {
      text = buf.toString('latin1', offset, offset + length);
    } else continue;
    names.set(id, text);
  }
  const weightClass = tables['OS/2'] ? buf.readUInt16BE(tables['OS/2'].offset + 4) : null;
  const widthClass = tables['OS/2'] ? buf.readUInt16BE(tables['OS/2'].offset + 6) : null;
  const italicAngle = tables.post ? buf.readInt32BE(tables.post.offset + 4) / 65536 : 0;
  const axes = [];
  if (tables.fvar) {
    const off = tables.fvar.offset;
    const axesOffset = buf.readUInt16BE(off + 4);
    const axisCount = buf.readUInt16BE(off + 8);
    const axisSize = buf.readUInt16BE(off + 10);
    for (let i = 0; i < axisCount; i++) axes.push(buf.toString('latin1', off + axesOffset + i * axisSize, off + axesOffset + i * axisSize + 4));
  }
  const copyright = names.get(0) ?? '';
  return {
    copyright,
    family: names.get(1) ?? '',
    subfamily: names.get(2) ?? '',
    fullName: names.get(4) ?? '',
    postScriptName: names.get(6) ?? '',
    typographicFamily: names.get(16) ?? null,
    typographicSubfamily: names.get(17) ?? null,
    weightClass,
    widthClass,
    italicAngle,
    isVariable: Boolean(tables.fvar),
    axes,
    hasReservedFontName: /reserved font name/i.test(copyright),
  };
}
