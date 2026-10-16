/**
 * Textsatz für Social-Bilder: Zeilenumbruch an Wortgrenzen und größte passende Schriftgröße.
 *
 * Die Breite eines Textes liefert eine eingespeiste Messfunktion (`MeasureFn`). Zur Laufzeit ist das
 * `measureText` der Leinwand (siehe `canvas-text.ts`), in Tests eine feste Zeichenbreite.
 */
import type { SocialLayer } from "@contract";
import { assertNever } from "@/lib/assert";
import { EPS } from "./geometry";

/** Breite des Textes in Pixeln bei der gegebenen Schriftgröße (Schrift, Gewicht und Laufweite sind schon eingebunden). */
export type MeasureFn = (text: string, fontSizePx: number) => number;

export type SocialTextLayer = Extract<SocialLayer, { type: "text" }>;

export interface WrapOptions {
  fontSizePx: number;
}

export interface WrapResult {
  lines: string[];
  /** Mindestens ein Wort war breiter als die Zeile und wurde mitten im Wort getrennt. */
  brokeWord: boolean;
}

const SOFT_HYPHEN = "\u{AD}";
const ELLIPSIS = "…";
/** Nach diesen Zeichen darf umbrochen werden (Bindestrich, Gedankenstriche, Schrägstrich). */
const BREAK_AFTER = new Set(["-", "\u{2010}", "\u{2013}", "\u{2014}", "/"]);
/** Umbrechbare Leerzeichen; geschützte Leerzeichen (U+00A0, U+202F, U+2007) bleiben bewusst draußen. */
const BREAKABLE_SPACE = /^[ \t\f\v\u{1680}\u{2000}-\u{2006}\u{2008}-\u{200A}\u{205F}\u{3000}]+$/u;
/** Satzzeichen, die vor einer Kürzung am Zeilenende abfallen. */
const TRAILING_JUNK = /[\s,;:\-\u{2010}\u{2013}\u{2014}/]+$/u;

const WORD_SEGMENTER = new Intl.Segmenter("de", { granularity: "word" });
const GRAPHEME_SEGMENTER = new Intl.Segmenter("de", { granularity: "grapheme" });

/** Art der Stelle NACH einem Atom. */
type JoinKind = "space" | "soft" | "after" | "free";

/** Unteilbares Textstück zwischen zwei möglichen Umbruchstellen. */
interface Atom {
  text: string;
  join: JoinKind | null;
}

function graphemesOf(text: string): string[] {
  return Array.from(GRAPHEME_SEGMENTER.segment(text), (segment) => segment.segment);
}

/**
 * Zerlegt einen Absatz in Atome. Umbruchstellen: nach Leerzeichen, nach Bindestrich/Schrägstrich vor einem Wort,
 * an weichen Trennstrichen (werden entfernt, beim Umbruch hängt `wrapText` ein „-“ an) und zwischen Wörtern
 * von Schriften ohne Leerzeichen (CJK). Satzzeichen bleiben am Nachbarwort kleben.
 */
function toAtoms(paragraph: string): Atom[] {
  const atoms: Atom[] = [];
  let current = "";
  let previousWasWord = false;

  const close = (join: JoinKind): void => {
    if (current !== "") {
      atoms.push({ text: current, join });
      current = "";
    } else if (join === "space") {
      const last = atoms.at(-1);
      if (last !== undefined) last.join = "space";
    }
  };

  const segments = Array.from(WORD_SEGMENTER.segment(paragraph));
  segments.forEach((segment, index) => {
    const text = segment.segment;
    const isWord = segment.isWordLike === true;
    if (BREAKABLE_SPACE.test(text)) {
      close("space");
      previousWasWord = false;
      return;
    }
    text.split(SOFT_HYPHEN).forEach((part, partIndex) => {
      if (partIndex > 0) {
        close("soft");
        previousWasWord = false;
      }
      if (part === "") return;
      if (BREAK_AFTER.has(part) && current !== "") {
        current += part;
        const next = segments[index + 1];
        if (next?.isWordLike === true && !/^\d/u.test(next.segment)) close("after");
        previousWasWord = false;
        return;
      }
      if (isWord && previousWasWord) close("free");
      current += part;
      previousWasWord = isWord;
    });
  });

  if (current !== "") atoms.push({ text: current, join: null });
  const last = atoms.at(-1);
  if (last !== undefined) last.join = null;
  return atoms;
}

/** Bricht ein zu langes Atom am letzten passenden Graphem. Mindestens ein Graphem pro Zeile (Abbruchgarantie). */
function splitToFit(text: string, maxWidth: number, measure: MeasureFn, fontSizePx: number): [string, string] {
  const graphemes = graphemesOf(text);
  let taken = 0;
  let piece = "";
  for (const grapheme of graphemes) {
    const candidate = piece + grapheme;
    if (taken > 0 && measure(candidate, fontSizePx) > maxWidth + EPS) break;
    piece = candidate;
    taken += 1;
  }
  return [piece, graphemes.slice(taken).join("")];
}

function wrapParagraph(paragraph: string, maxWidth: number, measure: MeasureFn, fontSizePx: number): WrapResult {
  const atoms = toAtoms(paragraph);
  const lines: string[] = [];
  let brokeWord = false;
  let start = 0;

  while (start < atoms.length) {
    let best = -1;
    let bestText = "";
    let text = "";
    for (let k = start; k < atoms.length; k += 1) {
      const atom = atoms[k];
      const previous = atoms[k - 1];
      if (atom === undefined) break;
      text =
        k === start || previous === undefined ? atom.text : text + (previous.join === "space" ? " " : "") + atom.text;
      if (measure(text, fontSizePx) > maxWidth + EPS) break;
      const shown = atom.join === "soft" ? `${text}-` : text;
      if (atom.join !== "soft" || measure(shown, fontSizePx) <= maxWidth + EPS) {
        best = k;
        bestText = shown;
      }
    }

    if (best >= start) {
      lines.push(bestText);
      start = best + 1;
      continue;
    }

    // Schon das erste Atom passt nicht (oder nur ohne Trennstrich): mitten im Wort trennen.
    const atom = atoms[start];
    if (atom === undefined) break;
    const [piece, rest] = splitToFit(atom.text, maxWidth, measure, fontSizePx);
    lines.push(piece);
    brokeWord = true;
    if (rest === "") start += 1;
    else atoms[start] = { text: rest, join: atom.join };
  }

  return { lines, brokeWord };
}

/**
 * Bricht `text` in Zeilen der Breite `maxWidth`. Explizite Zeilenumbrüche bleiben erhalten, Leerzeichenfolgen
 * werden zu einem Leerzeichen, Leerraum an Zeilenanfang und -ende entfällt. Leerer Text ergibt keine Zeilen.
 */
export function wrapText(text: string, maxWidth: number, measure: MeasureFn, opts: WrapOptions): WrapResult {
  const trimmed = text.trim();
  if (trimmed === "") return { lines: [], brokeWord: false };
  const width = Math.max(0, maxWidth);
  const lines: string[] = [];
  let brokeWord = false;
  for (const paragraph of trimmed.split(/\r\n|\r|\n/)) {
    const wrapped = wrapParagraph(paragraph, width, measure, opts.fontSizePx);
    if (wrapped.lines.length === 0) lines.push("");
    else lines.push(...wrapped.lines);
    brokeWord ||= wrapped.brokeWord;
  }
  return { lines, brokeWord };
}

/** Wendet die Schreibweise der Ebene an. „uppercase“ nach deutschen Regeln (ß wird „SS“). */
export function applyTextTransform(text: string, transform: SocialTextLayer["transform"]): string {
  switch (transform) {
    case "none":
      return text;
    case "uppercase":
      return text.toLocaleUpperCase("de-DE");
    default:
      return assertNever(transform, "Text-Transform");
  }
}

export type FitLayer = Pick<SocialTextLayer, "rect" | "sizePx" | "minSizePx" | "lineHeight" | "maxLines" | "transform">;

export interface FitResult {
  /** Zeilen nach Schreibweise und Umbruch; bei Kürzung endet die letzte mit „…“. */
  lines: string[];
  fontSizePx: number;
  /** Zeilenhöhe in Pixeln (`lineHeight × fontSizePx`). */
  lineHeightPx: number;
  /** Text wurde bei der kleinsten Schrift noch gekürzt. */
  truncated: boolean;
  /** Schon der Mindestumfang (eine Zeile) ist höher als das Rechteck. */
  overflowsHeight: boolean;
}

/** Kürzt `line` wortweise (zuletzt zeichenweise), bis `line + „…“` in die Breite passt. */
function ellipsize(line: string, maxWidth: number, measure: MeasureFn, fontSizePx: number): string {
  let head = line.replace(TRAILING_JUNK, "");
  for (;;) {
    if (head === "") return ELLIPSIS;
    const candidate = head + ELLIPSIS;
    if (measure(candidate, fontSizePx) <= maxWidth + EPS) return candidate;
    const cut = head.lastIndexOf(" ");
    if (cut > 0) {
      head = head.slice(0, cut);
    } else {
      head = graphemesOf(head).slice(0, -1).join("");
    }
    head = head.replace(TRAILING_JUNK, "");
  }
}

/**
 * Sucht die größte Schriftgröße zwischen `minSizePx` und `sizePx` (Schritt 1 px, ausgehend von `minSizePx`), bei der
 * der Text höchstens `maxLines` Zeilen braucht, in die Höhe des Rechtecks passt und kein Wort zerreißt.
 * Passt er auch bei `minSizePx` nicht, wird dort gekürzt (letzte Zeile mit „…“).
 */
export function fitText(layer: FitLayer, text: string, measure: MeasureFn): FitResult {
  const content = applyTextTransform(text, layer.transform);
  const maxLines = Math.max(1, Math.floor(layer.maxLines));
  const maxSize = Math.max(layer.sizePx, 1);
  const minSize = Math.min(Math.max(layer.minSizePx, 1), maxSize);
  const lineFactor = layer.lineHeight > 0 ? layer.lineHeight : 1;
  const { width, height } = layer.rect;

  const attempts = new Map<number, WrapResult>();
  const wrapAt = (size: number): WrapResult => {
    const cached = attempts.get(size);
    if (cached !== undefined) return cached;
    const result = wrapText(content, width, measure, { fontSizePx: size });
    attempts.set(size, result);
    return result;
  };
  const fitsAt = (size: number): boolean => {
    const { lines, brokeWord } = wrapAt(size);
    return !brokeWord && lines.length <= maxLines && lines.length * size * lineFactor <= height + EPS;
  };
  const result = (size: number, lines: string[], truncated: boolean, overflowsHeight: boolean): FitResult => ({
    lines,
    fontSizePx: size,
    lineHeightPx: size * lineFactor,
    truncated,
    overflowsHeight,
  });

  if (fitsAt(maxSize)) return result(maxSize, wrapAt(maxSize).lines, false, false);

  // Ganzzahlige Schritte unterhalb von maxSize, Raster beginnt bei minSize.
  const steps = Math.ceil(maxSize - minSize - EPS);
  if (steps > 0 && fitsAt(minSize)) {
    let low = 0;
    let high = steps - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (fitsAt(minSize + mid)) low = mid;
      else high = mid - 1;
    }
    const size = minSize + low;
    return result(size, wrapAt(size).lines, false, false);
  }

  // Auch die kleinste Schrift reicht nicht: dort kürzen.
  const lineBox = minSize * lineFactor;
  const byHeight = Math.floor((height + EPS) / lineBox);
  const allowed = Math.max(1, Math.min(maxLines, byHeight));
  const overflowsHeight = allowed * lineBox > height + EPS;
  const { lines } = wrapAt(minSize);
  if (lines.length <= allowed) return result(minSize, lines, false, overflowsHeight);
  const kept = lines.slice(0, allowed);
  const lastIndex = kept.length - 1;
  kept[lastIndex] = ellipsize(kept[lastIndex] ?? "", width, measure, minSize);
  return result(minSize, kept, true, overflowsHeight);
}
