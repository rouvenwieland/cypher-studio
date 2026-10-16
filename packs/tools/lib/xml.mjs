// Minimaler XML-Parser: prüft Wohlgeformtheit (Tags, Attribute, Entitäten, CDATA, Kommentare) und liefert einen einfachen Baum.
// Gedacht für die Paketprüfung (.svg, .kdenlivetitle, Krita-Manifeste, MLT-Projektdateien). Kein Validieren gegen DTD/Schema,
// keine Namensräume (Präfixe bleiben Teil des Namens), keine externen Entitäten (bewusst: nichts nachladen).

/**
 * @typedef {{ name: string, attrs: Record<string, string>, children: XmlElement[], text: string, line: number }} XmlElement
 */

const NAME_START = /[A-Za-z_:À-￿]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-·À-￿]/;

class XmlError extends Error {
  constructor(message, line) {
    super(`XML Zeile ${line}: ${message}`);
    this.line = line;
  }
}

/** Entitäten auflösen; unbekannte Entitäten sind ein Fehler. */
function decode(text, line) {
  return text.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) throw new XmlError(`ungültige Zeichenreferenz ${m}`, line);
      return String.fromCodePoint(code);
    }
    const table = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (!(ref in table)) throw new XmlError(`unbekannte Entität ${m}`, line);
    return table[ref];
  });
}

/**
 * @param {string} source
 * @returns {XmlElement} Wurzelelement
 */
export function parseXml(source) {
  let i = 0;
  let line = 1;
  const n = source.length;
  if (source.charCodeAt(0) === 0xfeff) i = 1;
  const advance = (to) => {
    for (; i < to; i++) if (source[i] === '\n') line++;
  };
  const fail = (m) => {
    throw new XmlError(m, line);
  };
  /** @type {XmlElement[]} */
  const stack = [];
  /** @type {XmlElement | null} */
  let root = null;
  let seenDoctype = false;

  while (i < n) {
    if (source[i] !== '<') {
      const next = source.indexOf('<', i);
      const end = next < 0 ? n : next;
      const raw = source.slice(i, end);
      if (stack.length === 0) {
        if (raw.trim() !== '') fail('Text außerhalb des Wurzelelements');
      } else {
        if (raw.includes(']]>')) fail('"]]>" im Text nicht erlaubt');
        stack[stack.length - 1].text += decode(raw, line);
      }
      advance(end);
      continue;
    }
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      if (end < 0) fail('Kommentar nicht geschlossen');
      if (source.slice(i + 4, end).includes('--')) fail('"--" im Kommentar nicht erlaubt');
      advance(end + 3);
      continue;
    }
    if (source.startsWith('<![CDATA[', i)) {
      if (stack.length === 0) fail('CDATA außerhalb des Wurzelelements');
      const end = source.indexOf(']]>', i + 9);
      if (end < 0) fail('CDATA nicht geschlossen');
      stack[stack.length - 1].text += source.slice(i + 9, end);
      advance(end + 3);
      continue;
    }
    if (source.startsWith('<?', i)) {
      const end = source.indexOf('?>', i + 2);
      if (end < 0) fail('Verarbeitungsanweisung nicht geschlossen');
      advance(end + 2);
      continue;
    }
    if (source.startsWith('<!DOCTYPE', i)) {
      if (seenDoctype || root) fail('DOCTYPE an falscher Stelle');
      seenDoctype = true;
      let depth = 0;
      let j = i + 9;
      for (; j < n; j++) {
        if (source[j] === '[') depth++;
        else if (source[j] === ']') depth--;
        else if (source[j] === '>' && depth <= 0) break;
      }
      if (j >= n) fail('DOCTYPE nicht geschlossen');
      advance(j + 1);
      continue;
    }
    if (source.startsWith('</', i)) {
      let j = i + 2;
      while (j < n && NAME_CHAR.test(source[j])) j++;
      const name = source.slice(i + 2, j);
      while (j < n && /\s/.test(source[j])) j++;
      if (source[j] !== '>') fail(`Endtag </${name}> nicht korrekt abgeschlossen`);
      const top = stack.pop();
      if (!top) fail(`unerwartetes Endtag </${name}>`);
      if (top.name !== name) fail(`Endtag </${name}> passt nicht zu <${top.name}> (Zeile ${top.line})`);
      advance(j + 1);
      continue;
    }
    // Starttag
    let j = i + 1;
    if (!NAME_START.test(source[j] ?? '')) fail('ungültiger Tag-Name');
    while (j < n && NAME_CHAR.test(source[j])) j++;
    const name = source.slice(i + 1, j);
    /** @type {Record<string, string>} */
    const attrs = {};
    for (;;) {
      const ws = j;
      while (j < n && /\s/.test(source[j])) j++;
      if (source[j] === '>' || (source[j] === '/' && source[j + 1] === '>')) break;
      if (j === ws) fail(`Leerraum vor Attribut in <${name}> fehlt`);
      if (!NAME_START.test(source[j] ?? '')) fail(`ungültiges Attribut in <${name}>`);
      const aStart = j;
      while (j < n && NAME_CHAR.test(source[j])) j++;
      const aName = source.slice(aStart, j);
      while (j < n && /\s/.test(source[j])) j++;
      if (source[j] !== '=') fail(`Attribut ${aName} ohne "="`);
      j++;
      while (j < n && /\s/.test(source[j])) j++;
      const q = source[j];
      if (q !== '"' && q !== "'") fail(`Attribut ${aName} ohne Anführungszeichen`);
      const vEnd = source.indexOf(q, j + 1);
      if (vEnd < 0) fail(`Attribut ${aName} nicht geschlossen`);
      const rawVal = source.slice(j + 1, vEnd);
      if (rawVal.includes('<')) fail(`"<" in Attribut ${aName} nicht erlaubt`);
      if (Object.hasOwn(attrs, aName)) fail(`Attribut ${aName} doppelt in <${name}>`);
      attrs[aName] = decode(rawVal, line);
      j = vEnd + 1;
    }
    /** @type {XmlElement} */
    const el = { name, attrs, children: [], text: '', line };
    if (stack.length === 0) {
      if (root) fail('mehr als ein Wurzelelement');
      root = el;
    } else {
      stack[stack.length - 1].children.push(el);
    }
    if (source[j] === '/') {
      advance(j + 2);
    } else {
      stack.push(el);
      advance(j + 1);
    }
  }
  if (stack.length > 0) fail(`<${stack[stack.length - 1].name}> (Zeile ${stack[stack.length - 1].line}) nicht geschlossen`);
  if (!root) fail('kein Wurzelelement');
  return root;
}

/** Alle Nachfahren (inklusive Wurzel) mit dem Namen. */
export function findAll(el, name, out = []) {
  if (el.name === name) out.push(el);
  for (const c of el.children) findAll(c, name, out);
  return out;
}
