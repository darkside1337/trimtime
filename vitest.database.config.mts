import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": ".",
      "server-only": "./tests/support/empty-server-only.ts",
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/database/**/*.test.ts",
      "features/**/tests/*.integration.test.ts",
      "server/tests/*.integration.test.ts",
    ],
    fileParallelism: false,
    maxWorkers: 2,
    passWithNoTests: false,
  },
});
