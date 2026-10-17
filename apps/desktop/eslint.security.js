// Sicherheitsregeln des Frontends (ARCHITEKTUR 6.4, Sicherheitsreview N15). Eine Quelle für `eslint.config.js` und den
// Test `src/security-lint.test.ts`. Das Frontend baut seine Oberfläche nur aus React-Elementen: kein rohes HTML, keine
// dynamische Ausführung von Text.

const MESSAGE = "Kein rohes HTML und keine Text-Ausführung im Frontend (ARCHITEKTUR 6.4). Elemente über React bauen.";

/** Selektoren für `no-restricted-syntax`. */
export const securityRestrictions = [
  { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: MESSAGE },
  { selector: "Property[key.name='dangerouslySetInnerHTML']", message: MESSAGE },
  { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: MESSAGE },
  {
    selector: "CallExpression[callee.property.name=/^(insertAdjacentHTML|createContextualFragment)$/]",
    message: MESSAGE,
  },
  {
    selector: "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
    message: MESSAGE,
  },
];

/** Weitere Regeln gegen die Ausführung von Text als Code. */
export const securityRules = {
  "no-eval": "error",
  "no-new-func": "error",
  "no-implied-eval": "error",
  "no-script-url": "error",
};
