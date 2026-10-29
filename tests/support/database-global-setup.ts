import { applyMigrations } from "../../db/migrate.mts";
import { openTestDatabase } from "./database";

/**
 * Prepare the owned disposable database once, before any database test file
 * starts. `openTestDatabase` verifies the container ownership and reads only
 * `TEST_DATABASE_URL`, so a direct Vitest invocation cannot fall back to an
 * application database.
 *
 * Individual files remain free to apply migrations deliberately (reruns,
 * isolated schemas, separate ledgers); this hook only removes the shared
 * prerequisite work from every suite.
 */
export default async function setup() {
  const { pool } = await openTestDatabase();

  try {
    await applyMigrations(pool, "db/migrations");
  } finally {
    await pool.end();
  }
}
