import { Pool } from "pg";
import { getTestDatabaseUrl } from "../../db/test-database-url.mts";
import { verifyOwnedTestDatabase } from "../../db/test-database.mts";

export async function openTestDatabase() {
  verifyOwnedTestDatabase();
  const pool = new Pool({
    connectionString: getTestDatabaseUrl({
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
      DATABASE_URL: process.env.DATABASE_URL,
    }),
    connectionTimeoutMillis: 1_000,
    query_timeout: 2_000,
  });

  try {
    await pool.query("SELECT 1");
    return { pool };
  } catch {
    await pool.end();
    throw new Error(
      "Disposable test database is unreachable; check Docker and pnpm db:test:up.",
    );
  }
}
