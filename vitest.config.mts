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
      "tests/unit/**/*.test.ts",
      "features/**/tests/*.test.ts",
      "server/tests/*.test.ts",
    ],
    exclude: ["**/*.integration.test.ts"],
    maxWorkers: 4,
    passWithNoTests: false,
  },
});
