import { describe, expect, it } from "vitest";

/**
 * Gestaltungsregeln als Test (DESIGN.md Vertrag „Thema“, §8): Farben nur aus tokens.css, keine Schatten und kein Glas,
 * keine Textliterale in Komponenten, kein Emoji als Symbol.
 */
/** Alle Quelldateien als Text (Vite liest sie beim Testlauf; kein Dateisystemzugriff nötig). */
const raw = import.meta.glob<string>("/src/**/*.{css,ts,tsx}", { query: "?raw", import: "default", eager: true });
const files = Object.keys(raw).filter((f) => !f.includes("/ipc/generated/"));
const rel = (f: string) => f.replace(/^\/src\//, "");
const read = (f: string) => raw[f] ?? "";
const isTest = (f: string) => /\.test\.tsx?$/.test(f);
const isData = (f: string) => rel(f).startsWith("ipc/mock/") || rel(f).includes("/engine/");

describe("Gestaltungsregeln", () => {
  it("CSS-Dateien enthalten keine Farbwerte außer Tokens", () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => x.endsWith(".css"))) {
      const text = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
      if (/#[0-9a-fA-F]{3,8}\b/.test(text) || /\b(?:rgba?|hsla?|oklch|oklab)\(/.test(text)) bad.push(rel(f));
    }
    expect(bad).toEqual([]);
  });
  it("kein box-shadow, text-shadow, backdrop-filter, border-radius ≠ 0", () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => x.endsWith(".css"))) {
      const text = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
      if (/(?:^|[;{\s])(?:box-shadow|text-shadow|backdrop-filter)\s*:/m.test(text))
        bad.push(`${rel(f)}: Schatten/Glas`);
      for (const m of text.matchAll(/border-radius\s*:\s*([^;]+);/g)) {
        const v = (m[1] ?? "").trim();
        if (v !== "0" && v !== "var(--radius)") bad.push(`${rel(f)}: border-radius ${v}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("keine Hex-Farben in Komponenten-Code (Daten ausgenommen)", () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => /\.tsx?$/.test(x) && !isTest(x) && !isData(x))) {
      const text = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      if (/["'`]#[0-9a-fA-F]{6}\b/.test(text)) bad.push(rel(f));
    }
    expect(bad).toEqual([]);
  });
  it("keine Emoji als Symbole", () => {
    const bad: string[] = [];
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    for (const f of files.filter((x) => /\.(tsx?|css)$/.test(x) && !isTest(x))) {
      if (emoji.test(read(f))) bad.push(rel(f));
    }
    expect(bad).toEqual([]);
  });
  it("keine Adobe-Produktnamen, -Logos oder -Symbole (BAU-REGELN 7); nur der Farbraum „Adobe RGB“ der Druckvorgabe", () => {
    const bad: string[] = [];
    const brand = /photoshop|illustrator|indesign|premiere|lightroom|creative cloud|adobe[ _-]?(logo|icon|font|stock)/i;
    for (const f of files.filter((x) => /\.(tsx?|css)$/.test(x) && !isTest(x) && !x.includes("/ipc/mock/"))) {
      if (brand.test(read(f))) bad.push(rel(f));
    }
    expect(bad).toEqual([]);
  });
  it("tokens.css bleibt kanonisch: nur Verweis über den Alias, keine Kopie", () => {
    const hasCopy = files.some((f) => f.endsWith("tokens.css"));
    expect(hasCopy).toBe(false);
  });
});
