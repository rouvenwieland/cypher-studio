import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { securityRestrictions, securityRules } from "./eslint.security.js";

const JSX_TEXT = "JSXText[value=/[A-Za-zÄÖÜäöüß]{2,}/]";
const TEXT_ATTRS =
  "JSXAttribute[name.name=/^(aria-label|aria-description|title|placeholder|alt|aria-valuetext)$/] > Literal[value=/[^ ]/]";

export default tseslint.config(
  { ignores: ["dist", "dist-mock", "src/ipc/generated", "test-results", "playwright-report", "coverage", "src-tauri"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { project: ["./tsconfig.json", "./tsconfig.node.json"], tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-explicit-any": "error",
      // ein `default` zählt als erschöpfend (z. B. allgemeiner Fehlertext für alle übrigen AppError-Arten)
      "@typescript-eslint/switch-exhaustiveness-check": ["error", { considerDefaultExhaustiveForUnions: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/consistent-type-imports": "error",
      ...securityRules,
      "no-restricted-syntax": [
        "error",
        { selector: JSX_TEXT, message: "UI-Texte gehören nach src/i18n (BAU-REGELN, ARCHITEKTUR 1.3 Nr. 5)." },
        { selector: TEXT_ATTRS, message: "UI-Texte gehören nach src/i18n (BAU-REGELN, ARCHITEKTUR 1.3 Nr. 5)." },
        ...securityRestrictions,
      ],
    },
  },
  {
    // Texte und Tests dürfen Text enthalten; die Sicherheitsregeln gelten auch dort
    files: ["src/i18n/**", "src/**/*.test.{ts,tsx}", "e2e/**", "e2e-real/**", "src/ipc/mock/**", "src/test-setup.ts"],
    rules: { "no-restricted-syntax": ["error", ...securityRestrictions] },
  },
  {
    files: ["e2e/**", "e2e-real/**", "src/**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    // Das IPC lehnt mit schlichten `AppError`-Objekten ab (Vertrag, wie Tauri es tut), nicht mit `Error`.
    files: ["src/ipc/**"],
    rules: { "@typescript-eslint/only-throw-error": "off" },
  },
  { files: ["eslint.config.js"], extends: [tseslint.configs.disableTypeChecked] },
);
