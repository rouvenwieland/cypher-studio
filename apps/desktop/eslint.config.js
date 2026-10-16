import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const JSX_TEXT = "JSXText[value=/[A-Za-zÄÖÜäöüß]{2,}/]";
const TEXT_ATTRS = "JSXAttribute[name.name=/^(aria-label|aria-description|title|placeholder|alt|aria-valuetext)$/] > Literal";

export default tseslint.config(
  { ignores: ["dist", "dist-mock", "src/ipc/generated", "test-results", "playwright-report", "coverage", "src-tauri"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { projectService: { allowDefaultProject: ["e2e/*.ts", "eslint.config.js"] }, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-syntax": [
        "error",
        { selector: JSX_TEXT, message: "UI-Texte gehören nach src/i18n (BAU-REGELN, ARCHITEKTUR 1.3 Nr. 5)." },
        { selector: TEXT_ATTRS, message: "UI-Texte gehören nach src/i18n (BAU-REGELN, ARCHITEKTUR 1.3 Nr. 5)." },
      ],
    },
  },
  {
    files: ["src/i18n/**", "src/**/*.test.{ts,tsx}", "e2e/**", "src/ipc/mock/**", "src/test-setup.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: ["e2e/**", "src/**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  { files: ["eslint.config.js"], extends: [tseslint.configs.disableTypeChecked] },
);
