import type { ESLint } from "eslint";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import { checkPrefixForBooleanFunctions } from "./eslint-rules/check-prefix-for-boolean-functions.ts";

export default defineConfig({
  files: ["**/*.ts"],
  extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  plugins: {
    local: {
      rules: { "check-prefix-for-boolean-functions": checkPrefixForBooleanFunctions },
    } as unknown as ESLint.Plugin,
  },
  languageOptions: {
    parserOptions: { projectService: true },
  },
  rules: {
    "local/check-prefix-for-boolean-functions": "error",
    "@typescript-eslint/consistent-type-definitions": ["error", "type"],
    "@typescript-eslint/switch-exhaustiveness-check": "error",
    "@typescript-eslint/strict-boolean-expressions": "error",
    eqeqeq: "error",
    "no-param-reassign": "error",
    "no-inline-comments": "error",
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/naming-convention": [
      "error",
      { selector: "default", format: ["camelCase"] },
      { selector: "typeLike", format: ["PascalCase"] },
      {
        selector: "variable",
        modifiers: ["const", "global"],
        format: ["camelCase", "PascalCase", "UPPER_CASE"],
      },
      {
        selector: ["variable", "parameter"],
        types: ["boolean"],
        format: ["PascalCase"],
        prefix: ["is", "has", "should", "can"],
      },
      { selector: "typeProperty", format: ["camelCase"], leadingUnderscore: "allow" },
      { selector: ["objectLiteralProperty", "objectLiteralMethod"], format: null },
    ],
  },
});
