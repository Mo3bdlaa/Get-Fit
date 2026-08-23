import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // One process, one module registry, one PGlite instance. Booting the WASM
    // Postgres and migrating it costs ~5s; paying that per file put the suite
    // over the Stop hook's budget. Files run sequentially and every database
    // test truncates in `beforeEach`, which is what keeps them isolated.
    pool: "forks",
    maxWorkers: 1,
    isolate: false,
  },
});
