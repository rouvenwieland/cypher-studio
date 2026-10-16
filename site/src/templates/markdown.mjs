// Markdown → HTML für die Anleitungsseiten. Baut auf `marked` (MIT) auf, ergänzt um:
//  - Kopfdaten (--- titel: … ---)
//  - Container  :::hinweis … :::   :::achtung   :::tipp   und die Schrittfolge
//      :::::schritte
//      ::::schritt Titel          (zählt automatisch; "schritt-unsigned" entfällt, sobald das System signiert ist)
//      ::::
//      :::::
//  - Zeichnungen  ![Beschreibung](svg:name)  → Inline-SVG aus drawings.mjs
//  - Platzhalter {{version}}, {{file.windows}} … (echter Dateiname oder Muster)
//  - Codeblöcke mit Kopieren-Knopf (das Skript blendet ihn ein, ohne Skript bleibt der Block lesbar)
import { Marked } from 'marked';
import { drawing } from './drawings.mjs';
import { esc } from './layout.mjs';

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseFrontMatter(src) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src.replace(/\r\n/g, '\n'));
  if (!m) return { data: {}, body: src.replace(/\r\n/g, '\n') };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return { data, body: src.replace(/\r\n/g, '\n').slice(m[0].length) };
}

const NOTE = {
  hinweis: { cls: 'note', label: 'Hinweis' },
  achtung: { cls: 'note note-warn', label: 'Achtung' },
  tipp: { cls: 'note note-tip', label: 'Tipp' },
};

/**
 * @param {string} src            Markdown (ohne Kopfdaten)
 * @param {object} opts
 * @param {object} opts.tokens    Platzhalter: { version, file: { windows, macos, … } }
 * @param {boolean} [opts.signed] System ist signiert → "schritt-unsigned"/"unsigned" entfallen
 * @param {string} [opts.idPrefix] Präfix für Überschrift-IDs (eingebettete Blöcke)
 * @param {number} [opts.baseLevel] Ebene, auf die „##“ gesetzt wird (Standard 2)
 * @param {number} [opts.stepLevel] Überschriftenebene der Schrittüberschriften (Standard 3)
 * @returns {{ html: string, headings: {level:number,id:string,text:string}[] }}
 */
export function renderMarkdown(src, opts = {}) {
  const { tokens = {}, signed = false, idPrefix = '', baseLevel = 2, stepLevel = 3 } = opts;
  const headings = [];
  const used = new Map();

  const fill = (text) =>
    text.replace(/\{\{\s*([a-z.-]+)\s*\}\}/g, (all, key) => {
      const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), tokens);
      if (v == null) throw new Error(`Unbekannter Platzhalter ${all}`);
      return String(v);
    });

  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    extensions: [
      {
        name: 'container',
        level: 'block',
        start(s) { return s.match(/^:{3,}[a-z]/m)?.index; },
        tokenizer(s) {
          const open = /^(:{3,})([a-z-]+)[ \t]*([^\n]*)\n/.exec(s);
          if (!open) return undefined;
          const fence = open[1];
          const close = new RegExp(`^${fence}[ \\t]*(?:\\n|$)`, 'm');
          const rest = s.slice(open[0].length);
          const cm = close.exec(rest);
          if (!cm) return undefined;
          const inner = rest.slice(0, cm.index);
          const raw = s.slice(0, open[0].length + cm.index + cm[0].length);
          const token = { type: 'container', raw, kind: open[2], arg: open[3].trim(), tokens: [] };
          this.lexer.blockTokens(inner, token.tokens);
          return token;
        },
        renderer(t) {
          const body = this.parser.parse(t.tokens);
          if (t.kind === 'schritte') return `<ol class="steps">\n${body}</ol>\n`;
          if (t.kind === 'schritt' || t.kind === 'schritt-unsigned') {
            if (t.kind === 'schritt-unsigned' && signed) return '';
            return `<li class="step"><h${stepLevel} class="step-t">${esc(t.arg)}</h${stepLevel}>\n<div class="step-b">\n${body}</div></li>\n`;
          }
          if (t.kind === 'unsigned') return signed ? '' : body;
          const n = NOTE[t.kind];
          if (n) return `<aside class="${n.cls}" role="note"><p class="note-l lbl">${n.label}</p>\n${body}</aside>\n`;
          throw new Error(`Unbekannter Container :::${t.kind}`);
        },
      },
    ],
    renderer: {
      heading(t) {
        const text = this.parser.parseInline(t.tokens);
        const plain = t.text;
        const level = Math.min(6, t.depth + baseLevel - 2);
        let id = idPrefix + slugify(plain);
        const n = (used.get(id) ?? 0) + 1;
        used.set(id, n);
        if (n > 1) id += `-${n}`;
        headings.push({ level, id, text: plain });
        return `<h${level} id="${id}">${text}</h${level}>\n`;
      },
      code(t) {
        const lang = (t.lang ?? '').trim();
        const text = t.text;
        return `<div class="code"><pre tabindex="0"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(text)}</code></pre><button type="button" class="copy" data-copy hidden aria-label="Befehl kopieren">Kopieren</button></div>\n`;
      },
      paragraph(t) {
        // Ein Absatz, der nur aus einer Zeichnung besteht, wird zur Abbildung (kein <figure> in <p>)
        if (t.tokens.length === 1 && t.tokens[0].type === 'image') return `${this.parser.parseInline(t.tokens)}\n`;
        return `<p>${this.parser.parseInline(t.tokens)}</p>\n`;
      },
      image(t) {
        const href = t.href ?? '';
        if (href.startsWith('svg:')) {
          const name = href.slice(4);
          return `<figure class="fig">${drawing(name)}<figcaption>${esc(t.text)}</figcaption></figure>`;
        }
        throw new Error(`Bilder nur als svg:name erlaubt, gefunden: ${href}`);
      },
      link(t) {
        const inner = this.parser.parseInline(t.tokens);
        const href = t.href;
        const ext = /^https?:/.test(href);
        return `<a href="${esc(href)}"${ext ? ' rel="noopener noreferrer"' : ''}>${inner}</a>`;
      },
      html(t) {
        // Erlaubt ist nur <kbd> für Tastenkürzel; alles andere gehört nicht in die Inhalte (CSP, Wartbarkeit).
        if (/^<\/?kbd>$/.test(t.text.trim())) return t.text.trim();
        throw new Error(`Rohes HTML ist in den Inhalten nicht erlaubt: ${t.text.slice(0, 40)}`);
      },
    },
  });

  const html = marked.parse(fill(src));
  return { html, headings };
}
