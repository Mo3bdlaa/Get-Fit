import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * `eslint-config-next` currently fails to patch ESLint 9.39 (its @rushstack
 * patch throws on load), so the rules that matter here are wired directly:
 * TypeScript correctness plus the React Hooks rules.
 */
export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "src/types/next.d.ts",
      "data/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Type-aware rules, for one reason above all: `no-floating-promises` and
  // `no-misused-promises` are what catch a missing `await` on the async
  // Postgres driver. `tsc` is happy to let a `Promise<boolean>` be truthy.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["src/**/*.{ts,tsx}", "tests/**/*.ts", "e2e/**/*.ts"],
  })),
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.ts", "e2e/**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
