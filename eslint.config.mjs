import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local-only / non-source directories:
    ".backup/**",
    ".claude/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    // Existing code has many `any`s and unused vars. Keep them visible as
    // warnings so `npm run lint` can gate PRs on real errors; tighten these
    // back to "error" as the backlog is paid down.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      // React Compiler rules introduced by eslint-plugin-react-hooks v7.
      // Existing components predate them; surface as warnings for now.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
    },
  },
]);

export default eslintConfig;
