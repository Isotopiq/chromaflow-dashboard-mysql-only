import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-installer/**",
      "dist-packaged/**",
      "node_modules/**",
      "tests/fixtures/**",
      "tests/integration-test.js",
      "make-icon.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Compiler-era strictness — these patterns (sync draft state, reset
      // selection on page change) are intentional; keep visible as warnings.
      "react-hooks/set-state-in-effect": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["tests/**", "**/*.test.{ts,tsx}"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
