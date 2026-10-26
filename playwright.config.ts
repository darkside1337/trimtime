import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: process.env.TRIMTIME_E2E_EMAIL_MODE === "mailpit-double" ? 1 : 8,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "tablet-chromium",
      use: { ...devices["iPad Mini"], browserName: "chromium" },
    },
    {
      name: "phone-chromium",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: [
    ...(process.env.TRIMTIME_E2E_EMAIL_MODE === "mailpit-double"
      ? [
          {
            command: "node tests/support/mailpit-double.mjs",
            url: "http://127.0.0.1:8027/healthz",
            reuseExistingServer: false,
            timeout: 10_000,
          },
        ]
      : []),
    {
      stdout: "pipe",
      command: "node_modules/.bin/next start --hostname 0.0.0.0 --port 3100",
      url: "http://localhost:3100",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
