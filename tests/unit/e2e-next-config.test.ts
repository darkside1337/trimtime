import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each(["start", "dev"])(
  "isolates %s E2E output and TypeScript config",
  async (server) => {
    vi.stubEnv("TRIMTIME_E2E_RUN", "1");
    vi.stubEnv("TRIMTIME_E2E_SERVER", server);
    vi.stubEnv("MARKETING_ORIGIN", "http://localhost:3100");
    vi.stubEnv("APP_ORIGIN", "http://app.localhost:3100");
    const { default: config } = await import("../../next.config");
    expect(config.distDir).toBe(".trimtime-e2e/next");
    expect(config.typescript?.tsconfigPath).toBe(".trimtime-e2e/tsconfig.json");
  },
);
