import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      // "server-only" is a build-time marker that throws when imported outside
      // an RSC graph; stub it so guard/vm logic can be unit-tested in Node.
      "server-only": resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: [],
  },
});
