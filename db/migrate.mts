import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export async function applyMigrations(
  pool: Pool,
  migrationsFolder: string,
  migrationsSchema?: string,
): Promise<void> {
  await migrate(drizzle(pool), { migrationsFolder, migrationsSchema });
}
