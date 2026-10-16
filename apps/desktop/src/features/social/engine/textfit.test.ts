import { describe, expect, it } from "vitest";
import { mulberry32 } from "./draw-math";
import { applyTextTransform, fitText, wrapText, type FitLayer, type MeasureFn } from "./textfit";

/** Jedes Zeichen ist 0,5 em breit (Länge in UTF-16-Einheiten, wie im Layout von Tests üblich). */
const mono: MeasureFn = (text, size) => text.length * size * 0.5;

/** Schriftgröße 10: ein Zeichen = 5 px. `chars` Zeichen passen genau in die Breite. */
function wrap(text: string, chars: number) {
  return wrapText(text, chars * 5, mono, { fontSizePx: 10 });
}

function layer(overrides: Partial<FitLayer> = {}): FitLayer {
  return {
    rect: { x: 0, y: 0, width: 1000, height: 1000 },
    sizePx: 100,
    minSizePx: 20,
    lineHeight: 1,
    maxLines: 2,
    transform: "none",
    ...overrides,
  };
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("wrapText", () => {
  it("lässt kurzen Text in einer Zeile", () => {
    expect(wrap("Hallo Welt", 20)).toEqual({ lines: ["Hallo Welt"], brokeWord: false });
  });

  it("bricht an Leerzeichen", () => {
    expect(wrap("Hallo Welt Test", 11).lines).toEqual(["Hallo Welt", "Test"]);
  });

  it("zählt eine exakt passende Zeile als passend", () => {
    expect(wrap("abcde fghij", 11).lines).toEqual(["abcde fghij"]);
    expect(wrap("abcde fghij", 10).lines).toEqual(["abcde", "fghij"]);
  });

  it("fasst Leerzeichenfolgen zusammen und schneidet Ränder ab", () => {
    expect(wrap("  a   b  ", 20).lines).toEqual(["a b"]);
  });

  it("liefert für leeren Text keine Zeilen", () => {
    expect(wrap("", 10)).toEqual({ lines: [], brokeWord: false });
    expect(wrap("   \n ", 10).lines).toEqual([]);
  });

  it("behält explizite Zeilenumbrüche und Leerzeilen", () => {
    expect(wrap("A\nB", 10).lines).toEqual(["A", "B"]);
    expect(wrap("A\r\n\r\nB", 10).lines).toEqual(["A", "", "B"]);
    expect(wrap("A\n", 10).lines).toEqual(["A"]);
  });

  it("nutzt weiche Trennstriche nur beim Umbruch und hängt dort einen Bindestrich an", () => {
    const text = "Donau\u{AD}dampf\u{AD}schiff";
    expect(wrap(text, 10).lines).toEqual(["Donau-", "dampf-", "schiff"]);
    expect(wrap(text, 10).brokeWord).toBe(false);
  });

  it("zeigt weiche Trennstriche nicht, wenn nicht umgebrochen wird", () => {
    const { lines } = wrap("Do\u{AD}nau\u{AD}", 20);
    expect(lines).toEqual(["Donau"]);
    expect(lines.join("")).not.toContain("\u{AD}");
  });

  it("macht aus weichem Trennstrich vor einem Leerzeichen einen normalen Umbruch ohne Bindestrich", () => {
    expect(wrap("Wort\u{AD} Welt", 20).lines).toEqual(["Wort Welt"]);
    expect(wrap("Wort\u{AD} Welt", 5).lines).toEqual(["Wort", "Welt"]);
  });

  it("bricht nach einem Bindestrich zwischen Wörtern", () => {
    expect(wrap("Zeit-Reise", 5).lines).toEqual(["Zeit-", "Reise"]);
  });

  it("bricht nach einem Schrägstrich", () => {
    expect(wrap("Berlin/Hamburg", 7).lines).toEqual(["Berlin/", "Hamburg"]);
  });

  it("bricht nicht zwischen Bindestrich und Ziffer", () => {
    const result = wrap("2024-2025", 5);
    expect(result.brokeWord).toBe(true);
    expect(result.lines).toEqual(["2024-", "2025"]);
    expect(wrap("2024-2025", 9)).toEqual({ lines: ["2024-2025"], brokeWord: false });
  });

  it("lässt Satzzeichen am Wort und beginnt keine Zeile damit", () => {
    expect(wrap("Hallo, Welt!", 6).lines).toEqual(["Hallo,", "Welt!"]);
    expect(wrap("Wir „senden“ nur", 11).lines).toEqual(["Wir", "„senden“", "nur"]);
  });

  it("trennt nicht an geschützten Leerzeichen", () => {
    expect(wrap("a\u{A0}b c", 3).lines).toEqual(["a\u{A0}b", "c"]);
  });

  it("trennt ein zu langes Wort hart und meldet es", () => {
    const result = wrap("Donaudampfschifffahrt", 10);
    expect(result.lines).toEqual(["Donaudampf", "schifffahr", "t"]);
    expect(result.brokeWord).toBe(true);
  });

  it("trennt hart auch dann, wenn nur noch der Trennstrich nicht passt", () => {
    const result = wrap("Donau\u{AD}dampf", 5);
    expect(result.lines).toEqual(["Donau", "dampf"]);
    expect(result.brokeWord).toBe(true);
  });

  it("zerreißt keine Grapheme beim harten Trennen", () => {
    const family = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}";
    const { lines } = wrapText(`${family}${family}${family}`, 1, () => 1000, { fontSizePx: 10 });
    expect(lines).toEqual([family, family, family]);
    for (const line of lines) expect(LONE_SURROGATE.test(line)).toBe(false);
  });

  it("bricht Schriften ohne Leerzeichen zwischen Wörtern", () => {
    expect(wrap("今日は天気", 2)).toEqual({ lines: ["今日", "は", "天気"], brokeWord: false });
  });

  it("gibt jeder Zeile mindestens ein Zeichen, auch bei Breite 0", () => {
    expect(wrapText("abc", 0, mono, { fontSizePx: 10 }).lines).toEqual(["a", "b", "c"]);
  });

  it("hält bei zufälligen Texten Breite und Inhalt ein", () => {
    const random = mulberry32(7);
    const alphabet = "abcdefghijklmnopqrstuvwxyzäöüß";
    for (let run = 0; run < 200; run += 1) {
      const wordCount = 1 + Math.floor(random() * 12);
      const words = Array.from({ length: wordCount }, () => {
        const length = 1 + Math.floor(random() * 14);
        return Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)] ?? "a").join("");
      });
      const text = words.join(" ");
      const chars = 3 + Math.floor(random() * 20);
      const { lines } = wrap(text, chars);
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(chars);
      expect(lines.join("").replace(/ /g, "")).toBe(text.replace(/ /g, ""));
    }
  });
});

describe("applyTextTransform", () => {
  it("lässt Text bei none unverändert", () => {
    expect(applyTextTransform("Straße", "none")).toBe("Straße");
  });

  it("macht nach deutschen Regeln Versalien (ß wird SS)", () => {
    expect(applyTextTransform("Straße äöü", "uppercase")).toBe("STRASSE ÄÖÜ");
  });
});

describe("fitText", () => {
  it("nimmt die volle Schriftgröße, wenn der Text passt", () => {
    const result = fitText(layer(), "Hi", mono);
    expect(result).toMatchObject({
      lines: ["Hi"],
      fontSizePx: 100,
      lineHeightPx: 100,
      truncated: false,
      overflowsHeight: false,
    });
  });

  it("verkleinert in 1-px-Schritten bis zur größten passenden Größe", () => {
    // 11 Zeichen × 0,5 em = 5,5 em; Breite 440 → höchstens 80 px
    const result = fitText(layer({ rect: { x: 0, y: 0, width: 440, height: 1000 }, maxLines: 1 }), "Hello World", mono);
    expect(result.fontSizePx).toBe(80);
    expect(result.lines).toEqual(["Hello World"]);
  });

  it("bricht lieber um, als zu verkleinern, solange maxLines reicht", () => {
    const result = fitText(layer({ rect: { x: 0, y: 0, width: 440, height: 1000 } }), "Hello World", mono);
    expect(result.fontSizePx).toBe(100);
    expect(result.lines).toEqual(["Hello", "World"]);
  });

  it("beachtet die Höhe des Rechtecks", () => {
    const result = fitText(layer({ rect: { x: 0, y: 0, width: 440, height: 150 }, maxLines: 3 }), "Hello World", mono);
    expect(result.lines.length * result.lineHeightPx).toBeLessThanOrEqual(150);
    expect(result.fontSizePx).toBe(80);
  });

  it("verkleinert statt ein Wort mitten zu trennen", () => {
    // 16 Zeichen = 8 em, Breite 400 → 50 px
    const result = fitText(layer({ rect: { x: 0, y: 0, width: 400, height: 1000 } }), "Donaudampfschiff", mono);
    expect(result.fontSizePx).toBe(50);
    expect(result.lines).toEqual(["Donaudampfschiff"]);
  });

  it("kürzt bei der kleinsten Schrift mit … in der letzten erlaubten Zeile", () => {
    const l = layer({ rect: { x: 0, y: 0, width: 200, height: 1000 }, minSizePx: 40 });
    const result = fitText(l, "Eins zwei drei vier fuenf sechs sieben", mono);
    expect(result.truncated).toBe(true);
    expect(result.fontSizePx).toBe(40);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[1]?.endsWith("…")).toBe(true);
    for (const line of result.lines) expect(mono(line, 40)).toBeLessThanOrEqual(200);
  });

  it("kürzt ein einzelnes Wort zeichenweise und lässt Satzzeichen vor … weg", () => {
    const l = layer({ rect: { x: 0, y: 0, width: 200, height: 1000 }, minSizePx: 40, maxLines: 1 });
    const result = fitText(l, "Donaudampfschifffahrtsgesellschaft", mono);
    expect(result.truncated).toBe(true);
    expect(result.lines).toEqual(["Donaudamp…"]);
    const wide = layer({ rect: { x: 0, y: 0, width: 220, height: 1000 }, minSizePx: 40, maxLines: 1 });
    expect(fitText(wide, "Hallo Welt, und mehr", mono).lines).toEqual(["Hallo Welt…"]);
  });

  it("begrenzt die Zeilen durch die Höhe, wenn sie weniger erlaubt als maxLines", () => {
    // Höhe 45 bei 20 px → 2 Zeilen, obwohl maxLines 5
    const l = layer({ rect: { x: 0, y: 0, width: 100, height: 45 }, minSizePx: 20, sizePx: 20, maxLines: 5 });
    const result = fitText(l, "aaaa bbbb cccc dddd eeee", mono);
    expect(result.lines).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.overflowsHeight).toBe(false);
  });

  it("meldet overflowsHeight, wenn nicht einmal eine Zeile ins Rechteck passt", () => {
    const l = layer({ rect: { x: 0, y: 0, width: 1000, height: 10 }, minSizePx: 20, sizePx: 30 });
    const result = fitText(l, "Hallo", mono);
    expect(result.overflowsHeight).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.lines).toEqual(["Hallo"]);
    expect(result.fontSizePx).toBe(20);
  });

  it("wendet uppercase vor dem Messen an (ß wird SS)", () => {
    // „Strasse“ hat 7 Zeichen, „STRASSE“ aus „Straße“ ebenfalls 7 statt 6
    const result = fitText(
      layer({ transform: "uppercase", maxLines: 1, rect: { x: 0, y: 0, width: 350, height: 1000 } }),
      "Straße",
      mono,
    );
    expect(result.lines).toEqual(["STRASSE"]);
    expect(result.fontSizePx).toBe(100);
    const narrower = fitText(
      layer({ transform: "uppercase", maxLines: 1, rect: { x: 0, y: 0, width: 300, height: 1000 } }),
      "Straße",
      mono,
    );
    expect(narrower.fontSizePx).toBe(85);
  });

  it("liefert für leeren Text keine Zeilen und die volle Größe", () => {
    expect(fitText(layer(), "", mono)).toMatchObject({ lines: [], fontSizePx: 100, truncated: false });
  });

  it("begrenzt eine zu große Mindestgröße auf die Sollgröße", () => {
    const result = fitText(
      layer({ sizePx: 50, minSizePx: 80, rect: { x: 0, y: 0, width: 100, height: 1000 }, maxLines: 1 }),
      "Hallo Welt",
      mono,
    );
    expect(result.fontSizePx).toBe(50);
    expect(result.truncated).toBe(true);
  });

  it("rechnet die Zeilenhöhe mit lineHeight", () => {
    const result = fitText(layer({ lineHeight: 0.92 }), "Hi", mono);
    expect(result.lineHeightPx).toBeCloseTo(92, 10);
  });

  it("ist bei nicht ganzzahligen Grenzen konsistent", () => {
    const l = layer({ sizePx: 100.5, minSizePx: 20.5, rect: { x: 0, y: 0, width: 330.2, height: 1000 }, maxLines: 1 });
    const result = fitText(l, "Hello World", mono);
    // 5,5 em ≤ 330,2 → 60,03; Raster 20,5 + n → 59,5
    expect(result.fontSizePx).toBeCloseTo(59.5, 10);
  });

  it("findet bei zufälligen Fällen dasselbe wie eine lineare Suche", () => {
    const random = mulberry32(42);
    const words = [
      "Rauschen",
      "Drop",
      "Neue",
      "Motive",
      "begrenzte",
      "Auflage",
      "Donaudampfschiff",
      "a",
      "Zeit-Reise",
      "Wir",
    ];
    let shrunk = 0;
    let cut = 0;
    for (let run = 0; run < 300; run += 1) {
      const count = 1 + Math.floor(random() * 7);
      const text = Array.from({ length: count }, () => words[Math.floor(random() * words.length)] ?? "a").join(" ");
      const l = layer({
        rect: { x: 0, y: 0, width: 150 + Math.floor(random() * 900), height: 100 + Math.floor(random() * 500) },
        sizePx: 60 + Math.floor(random() * 200),
        minSizePx: 10 + Math.floor(random() * 50),
        lineHeight: 0.9 + random() * 0.4,
        maxLines: 1 + Math.floor(random() * 4),
      });
      const result = fitText(l, text, mono);

      const minSize = Math.min(l.minSizePx, l.sizePx);
      const fits = (size: number): boolean => {
        const wrapped = wrapText(text, l.rect.width, mono, { fontSizePx: size });
        return (
          !wrapped.brokeWord &&
          wrapped.lines.length <= l.maxLines &&
          wrapped.lines.length * size * l.lineHeight <= l.rect.height + 1e-6
        );
      };
      let expected: number | null = null;
      if (fits(l.sizePx)) expected = l.sizePx;
      else
        for (let size = l.sizePx - 1; size >= minSize; size -= 1) {
          if (fits(size)) {
            expected = size;
            break;
          }
        }
      if (expected === null) {
        cut += 1;
        expect(result.fontSizePx).toBe(minSize);
      } else {
        if (expected < l.sizePx) shrunk += 1;
        expect(result.fontSizePx).toBe(expected);
        expect(result.truncated).toBe(false);
      }
    }
    // Der Test deckt beide Zweige wirklich ab
    expect(shrunk).toBeGreaterThan(30);
    expect(cut).toBeGreaterThan(10);
  });
});
