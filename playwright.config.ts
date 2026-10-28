import { defineConfig, devices } from "@playwright/test";

const allDevices =
  process.env.TRIMTIME_E2E_ALL_DEVICES === "1" ||
  process.env.TRIMTIME_E2E_EMAIL_MODE?.startsWith("mailpit-");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: process.env.TRIMTIME_E2E_EMAIL_MODE?.startsWith("mailpit-") ? 1 : 4,
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
      grep: allDevices ? undefined : /@device/,
      use: { ...devices["iPad Mini"], browserName: "chromium" },
    },
    {
      name: "phone-chromium",
      grep: allDevices ? undefined : /@device/,
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
      command:
        process.env.TRIMTIME_E2E_SERVER === "dev"
          ? "node_modules/.bin/next dev --hostname 0.0.0.0 --port 3100"
          : "node_modules/.bin/next start --hostname 0.0.0.0 --port 3100",
      url: "http://localhost:3100",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
