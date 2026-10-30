import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export async function applyMigrations(
  pool: Pool,
  migrationsFolder: string,
  migrationsSchema?: string,
): Promise<void> {
  // Serialize applications per ledger. Parallel suites (and deploy runs) can
  // otherwise race while creating the ledger or reading its last entry.
  const lockKey = `trimtime:migrations:${migrationsSchema ?? "drizzle"}`;
  const client = await pool.connect();
  let locked = false;
  let destroyClient = false;

  try {
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
        lockKey,
      ]);
    } catch (error) {
      // A timed-out acquisition may still be running on the server.
      destroyClient = true;
      throw error;
    }
    locked = true;
    await migrate(drizzle(client), { migrationsFolder, migrationsSchema });
  } finally {
    try {
      if (locked) {
        const result = await client.query<{ unlocked: boolean }>(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
          [lockKey],
        );
        if (!result.rows[0]?.unlocked)
          throw new Error("Migration advisory lock was not held on release.");
      }
    } catch (error) {
      destroyClient = true;
      throw error;
    } finally {
      client.release(destroyClient);
    }
  }
}
