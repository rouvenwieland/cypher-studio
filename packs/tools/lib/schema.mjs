// Kleiner JSON-Schema-Prüfer (Teilmenge von Draft 2020-12) ohne Abhängigkeiten.
// Unterstützt genau die Schlüsselwörter, die die Schemas in packs/schema/ benutzen. Ein unbekanntes
// Schlüsselwort ist ein Fehler (so fällt ein Tippfehler im Schema auf, statt still ignoriert zu werden).
// Die Tests vergleichen das Verhalten mit Ajv (devDependency, nur in packs/tools/package.json).

const ANNOTATIONS = new Set(['$schema', '$id', '$comment', '$defs', 'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'format']);
const KEYWORDS = new Set([
  '$ref', 'type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'patternProperties',
  'items', 'prefixItems', 'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minProperties', 'maxProperties',
  'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'propertyNames',
]);

/** @param {unknown} v */
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

/** @param {string} want @param {unknown} v */
function isType(want, v) {
  const t = typeOf(v);
  if (want === 'number') return t === 'number' || t === 'integer';
  return want === t;
}

/** JSON-Gleichheit (für enum, const, uniqueItems). */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

export class SchemaRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this.byId = new Map();
  }

  /** Registriert ein Schema unter seiner `$id` und prüft dabei seine Schlüsselwörter. */
  add(schema) {
    if (typeof schema.$id !== 'string') throw new Error('Schema ohne $id');
    checkKeywords(schema, schema.$id);
    this.byId.set(schema.$id, schema);
    return this;
  }

  /**
   * Prüft `data` gegen das Schema mit der `$id`.
   * @returns {{ valid: boolean, errors: { path: string, message: string }[] }}
   */
  validate(id, data) {
    const root = this.byId.get(id);
    if (!root) throw new Error(`Schema ${id} unbekannt`);
    const errors = [];
    this.#check(root, root, data, '', errors);
    return { valid: errors.length === 0, errors };
  }

  #resolve(ref, base) {
    const [file, frag = ''] = ref.split('#');
    let doc = base;
    if (file) {
      const id = new URL(file, base.$id).href;
      doc = this.byId.get(id);
      if (!doc) throw new Error(`$ref ${ref}: Schema ${id} unbekannt`);
    }
    let node = doc;
    for (const seg of frag.split('/').filter(Boolean)) {
      node = node?.[seg.replaceAll('~1', '/').replaceAll('~0', '~')];
      if (node === undefined) throw new Error(`$ref ${ref} nicht auflösbar`);
    }
    return { node, doc };
  }

  /** @returns {boolean} true, wenn ohne Fehler */
  #check(schema, doc, value, path, errors) {
    if (schema === true) return true;
    if (schema === false) {
      errors.push({ path, message: 'nicht erlaubt' });
      return false;
    }
    const before = errors.length;
    const fail = (message) => errors.push({ path, message });
    if (schema.$ref !== undefined) {
      const { node, doc: d } = this.#resolve(schema.$ref, doc);
      this.#check(node, d, value, path, errors);
    }
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((t) => isType(t, value))) fail(`Typ ${typeOf(value)} statt ${types.join('|')}`);
    }
    if (schema.enum !== undefined && !schema.enum.some((e) => deepEqual(e, value))) {
      fail(`Wert ${JSON.stringify(value)} nicht in ${JSON.stringify(schema.enum)}`);
    }
    if (schema.const !== undefined && !deepEqual(schema.const, value)) fail(`Wert muss ${JSON.stringify(schema.const)} sein`);

    if (typeof value === 'string') {
      const len = [...value].length;
      if (schema.minLength !== undefined && len < schema.minLength) fail(`kürzer als ${schema.minLength} Zeichen`);
      if (schema.maxLength !== undefined && len > schema.maxLength) fail(`länger als ${schema.maxLength} Zeichen`);
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) fail(`passt nicht auf ${schema.pattern}`);
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) fail(`kleiner als ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) fail(`größer als ${schema.maximum}`);
      if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fail(`nicht größer als ${schema.exclusiveMinimum}`);
      if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) fail(`nicht kleiner als ${schema.exclusiveMaximum}`);
      if (schema.multipleOf !== undefined && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-9) {
        fail(`kein Vielfaches von ${schema.multipleOf}`);
      }
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) fail(`weniger als ${schema.minItems} Einträge`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`mehr als ${schema.maxItems} Einträge`);
      if (schema.uniqueItems) {
        for (let i = 0; i < value.length; i++) {
          for (let j = i + 1; j < value.length; j++) if (deepEqual(value[i], value[j])) fail(`Einträge ${i} und ${j} sind gleich`);
        }
      }
      const prefix = schema.prefixItems ?? [];
      value.forEach((item, i) => {
        if (i < prefix.length) this.#check(prefix[i], doc, item, `${path}/${i}`, errors);
        else if (schema.items !== undefined) this.#check(schema.items, doc, item, `${path}/${i}`, errors);
      });
    }
    if (typeOf(value) === 'object') {
      const keys = Object.keys(value);
      for (const req of schema.required ?? []) if (!Object.hasOwn(value, req)) fail(`Pflichtfeld ${req} fehlt`);
      if (schema.minProperties !== undefined && keys.length < schema.minProperties) fail(`weniger als ${schema.minProperties} Felder`);
      if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) fail(`mehr als ${schema.maxProperties} Felder`);
      const patterns = Object.entries(schema.patternProperties ?? {}).map(([p, s]) => [new RegExp(p, 'u'), s]);
      for (const key of keys) {
        const sub = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
        let matched = false;
        if (schema.properties && Object.hasOwn(schema.properties, key)) {
          matched = true;
          this.#check(schema.properties[key], doc, value[key], sub, errors);
        }
        for (const [re, s] of patterns) {
          if (re.test(key)) {
            matched = true;
            this.#check(s, doc, value[key], sub, errors);
          }
        }
        if (!matched && schema.additionalProperties !== undefined) {
          if (schema.additionalProperties === false) errors.push({ path: sub, message: 'unbekanntes Feld' });
          else this.#check(schema.additionalProperties, doc, value[key], sub, errors);
        }
        if (schema.propertyNames !== undefined) this.#check(schema.propertyNames, doc, key, sub, errors);
      }
    }
    if (schema.allOf) for (const s of schema.allOf) this.#check(s, doc, value, path, errors);
    if (schema.anyOf) {
      const results = schema.anyOf.map((s) => this.#try(s, doc, value, path));
      if (!results.some((r) => r.length === 0)) fail(`keine Alternative von anyOf passt (${summarize(results)})`);
    }
    if (schema.oneOf) {
      const results = schema.oneOf.map((s) => this.#try(s, doc, value, path));
      const hits = results.filter((r) => r.length === 0).length;
      if (hits === 0) fail(`keine Alternative von oneOf passt (${summarize(results)})`);
      else if (hits > 1) fail(`${hits} Alternativen von oneOf passen (genau eine erlaubt)`);
    }
    if (schema.not !== undefined && this.#try(schema.not, doc, value, path).length === 0) fail('darf nicht passen (not)');
    if (schema.if !== undefined) {
      const ok = this.#try(schema.if, doc, value, path).length === 0;
      if (ok && schema.then !== undefined) this.#check(schema.then, doc, value, path, errors);
      if (!ok && schema.else !== undefined) this.#check(schema.else, doc, value, path, errors);
    }
    return errors.length === before;
  }

  #try(schema, doc, value, path) {
    const errors = [];
    this.#check(schema, doc, value, path, errors);
    return errors;
  }
}

function summarize(results) {
  return results.map((r) => r[0]?.message ?? 'ok').join(' | ');
}

function checkKeywords(node, where) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n, i) => checkKeywords(n, `${where}[${i}]`));
    return;
  }
  for (const key of Object.keys(node)) {
    if (!KEYWORDS.has(key) && !ANNOTATIONS.has(key)) throw new Error(`Unbekanntes Schema-Schlüsselwort "${key}" bei ${where}`);
  }
  for (const [key, val] of Object.entries(node)) {
    if (['properties', 'patternProperties', '$defs'].includes(key)) {
      for (const [k, v] of Object.entries(val)) checkKeywords(v, `${where}/${key}/${k}`);
    } else if (['items', 'additionalProperties', 'not', 'if', 'then', 'else', 'propertyNames'].includes(key)) {
      checkKeywords(val, `${where}/${key}`);
    } else if (['oneOf', 'anyOf', 'allOf', 'prefixItems'].includes(key)) {
      val.forEach((v, i) => checkKeywords(v, `${where}/${key}/${i}`));
    }
  }
}

/** Formatiert Fehler für die Konsole. */
export function formatErrors(errors) {
  return errors.map((e) => `  ${e.path || '/'}: ${e.message}`).join('\n');
}
