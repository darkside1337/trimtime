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
    fileParallelism: true,
    maxWorkers: 3,
    passWithNoTests: false,
  },
});
