import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { applyMigrations } from "../db/migrate.mts";
import { verifyOwnedTestDatabase } from "../db/test-database.mts";
import { resolve } from "node:path";

process.loadEnvFile(".env.test");
process.env.TRIMTIME_E2E_NOW ??= "2026-10-31T12:00:00Z";
const databaseUrl = verifyOwnedTestDatabase();
const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: databaseUrl,
  MIGRATION_DATABASE_URL: databaseUrl,
  PGOPTIONS: "-c lock_timeout=1000",
  BETTER_AUTH_URL: "http://app.localhost:3100",
  APP_ORIGIN: "http://app.localhost:3100",
  MARKETING_ORIGIN: "http://localhost:3100",
  BETTER_AUTH_SECRET: "e2e-only-secret-that-is-long-enough-for-better-auth",
  BOOKING_CAPABILITY_KEY_ID: "e2e-v1",
  BOOKING_CAPABILITY_ENCRYPTION_KEY:
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  GOOGLE_CLIENT_ID: "e2e-google-client",
  GOOGLE_CLIENT_SECRET: "e2e-google-secret",
  EMAIL_MODE:
    process.env.TRIMTIME_E2E_EMAIL_MODE === "mailpit-double"
      ? "mailpit"
      : "unavailable",
};
if (process.env.TRIMTIME_E2E_EMAIL_MODE === "mailpit-double") {
  env.MAILPIT_ORIGIN = "http://127.0.0.1:8027";
} else {
  delete env.MAILPIT_ORIGIN;
}
if (process.env.TRIMTIME_E2E_NOW) {
  const preload = resolve("tests/support/fixed-clock.mjs");
  const check = `${process.env.TRIMTIME_E2E_NOW}`;
  if (Number.isNaN(Date.parse(check)) || !check.endsWith("Z")) {
    throw new Error("TRIMTIME_E2E_NOW must be a UTC ISO instant ending in Z.");
  }
  execFileSync(process.execPath, ["--import", preload, "--eval", ""], {
    stdio: "inherit",
    env: { ...env, TRIMTIME_E2E_NOW: check },
  });
  env.TRIMTIME_E2E_NOW = check;
  env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--import=${preload}`]
    .filter(Boolean)
    .join(" ");
}
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  await applyMigrations(pool, "db/migrations");
  execFileSync("pnpm", ["build"], { stdio: "inherit", env });
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "node_modules/@playwright/test/cli.js",
      "test",
      ...args,
    ],
    {
      stdio: "inherit",
      env,
    },
  );
} finally {
  await pool.end();
}
