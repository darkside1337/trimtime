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
    globalSetup: "./tests/support/database-global-setup.ts",
    include: [
      "tests/database/**/*.test.ts",
      "features/**/tests/*.integration.test.ts",
      "server/tests/*.integration.test.ts",
    ],
    // Database integration files share global fixtures and allocations; run
    // them one at a time so production-selector coverage cannot overlap them.
    fileParallelism: false,
    maxWorkers: 3,
    passWithNoTests: false,
  },
});
