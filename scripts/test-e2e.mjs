import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { applyMigrations } from "../db/migrate.mts";
import { verifyOwnedTestDatabase } from "../db/test-database.mts";

process.loadEnvFile(".env.test");
const databaseUrl = verifyOwnedTestDatabase();
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  MIGRATION_DATABASE_URL: databaseUrl,
  PGOPTIONS: "-c lock_timeout=1000",
  BETTER_AUTH_URL: "http://app.localhost:3100",
  APP_ORIGIN: "http://app.localhost:3100",
  MARKETING_ORIGIN: "http://localhost:3100",
  BETTER_AUTH_SECRET: "e2e-only-secret-that-is-long-enough-for-better-auth",
  GOOGLE_CLIENT_ID: "e2e-google-client",
  GOOGLE_CLIENT_SECRET: "e2e-google-secret",
};
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  await applyMigrations(pool, "db/migrations");
  execFileSync("pnpm", ["build"], { stdio: "inherit", env });
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  execFileSync("node_modules/.bin/playwright", ["test", ...args], {
    stdio: "inherit",
    env,
  });
} finally {
  await pool.end();
}
