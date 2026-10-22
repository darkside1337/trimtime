import { Pool } from "pg";
import { applyMigrations } from "../db/migrate.mts";

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "MIGRATION_DATABASE_URL is required; application and test URLs are never used as fallbacks.",
  );
}

const pool = new Pool({ connectionString, max: 1 });
try {
  await applyMigrations(pool, "./db/migrations");
} finally {
  await pool.end();
}
