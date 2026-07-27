import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Data-fetching and polling effects intentionally update local state after
    // starting an async request; this project does not use render-time fetches.
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  {
    files: ["server.js"],
    // The custom Next.js/noVNC entrypoint runs as CommonJS under Node.
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
