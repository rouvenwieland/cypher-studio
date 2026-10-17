// Sicherheitsreview N15: Die ESLint-Regeln gegen rohes HTML und Text-Ausführung müssen wirklich greifen. Der Test lintet
// kleine Beispiele mit denselben Regeln wie `eslint.config.js` (gemeinsame Quelle: `eslint.security.js`).
import { Linter } from "eslint";
import globals from "globals";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

import { securityRestrictions, securityRules } from "../eslint.security.js";

function lint(code: string): string[] {
  const linter = new Linter();
  const messages = linter.verify(
    code,
    [
      {
        files: ["**/*.tsx"],
        languageOptions: {
          globals: { ...globals.browser },
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: { ...securityRules, "no-restricted-syntax": ["error", ...securityRestrictions] },
      },
    ],
    { filename: "beispiel.tsx" },
  );
  return messages.map((m) => `${m.ruleId ?? "parse"}: ${m.message}`);
}

describe("Sicherheitsregeln des Frontends", () => {
  it("lehnt dangerouslySetInnerHTML ab", () => {
    expect(
      lint(`export const A = (p: { h: string }) => <div dangerouslySetInnerHTML={{ __html: p.h }} />;`),
    ).not.toEqual([]);
    expect(lint(`const props = { dangerouslySetInnerHTML: { __html: "x" } }; export default props;`)).not.toEqual([]);
  });

  it("lehnt rohes HTML über das DOM ab", () => {
    expect(lint(`document.body.innerHTML = "<b>x</b>";`)).not.toEqual([]);
    expect(lint(`el.outerHTML = "x";`)).not.toEqual([]);
    expect(lint(`el.insertAdjacentHTML("beforeend", "x");`)).not.toEqual([]);
    expect(lint(`document.write("x");`)).not.toEqual([]);
    expect(lint(`document.createRange().createContextualFragment("x");`)).not.toEqual([]);
  });

  it("lehnt die Ausführung von Text ab", () => {
    expect(lint(`eval("1+1");`)).not.toEqual([]);
    expect(lint(`new Function("return 1")();`)).not.toEqual([]);
    expect(lint(`setTimeout("alert(1)", 10);`)).not.toEqual([]);
    expect(lint(`const u = "javascript:alert(1)";`)).not.toEqual([]);
  });

  it("lässt gewöhnliche React-Elemente und Textinhalt zu", () => {
    expect(lint(`export const B = (p: { t: string }) => <p>{p.t}</p>;`)).toEqual([]);
    expect(lint(`el.textContent = "x"; const n = el.innerText;`)).toEqual([]);
  });
});
