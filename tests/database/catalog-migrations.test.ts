import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../db/migrate.mts";
import { openTestDatabase } from "../support/database";

describe("catalog migrations", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;

  beforeAll(async () => {
    database = await openTestDatabase();
    await applyMigrations(database.pool, "db/migrations");
  });

  afterAll(async () => {
    await database?.pool.end();
  });

  it("adds shop-scoped catalog tables and reruns without changing the existing tables", async () => {
    const before = await database.pool.query(
      "SELECT count(*)::int AS count FROM shops",
    );
    await applyMigrations(database.pool, "db/migrations");
    const [tables, keys, ledger, after] = await Promise.all([
      database.pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(ARRAY['shops', 'services', 'barbers', 'barber_services']) ORDER BY table_name",
      ),
      database.pool.query(
        "SELECT conname FROM pg_constraint WHERE conname IN ('services_shop_id_id_key', 'barbers_shop_id_id_key', 'barber_services_barber_fkey', 'barber_services_service_fkey') ORDER BY conname",
      ),
      database.pool.query(
        'SELECT count(*)::int AS count FROM drizzle."__drizzle_migrations"',
      ),
      database.pool.query("SELECT count(*)::int AS count FROM shops"),
    ]);

    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
      "barber_services",
      "barbers",
      "services",
      "shops",
    ]);
    expect(keys.rows.map(({ conname }) => conname)).toEqual([
      "barber_services_barber_fkey",
      "barber_services_service_fkey",
      "barbers_shop_id_id_key",
      "services_shop_id_id_key",
    ]);
    expect(ledger.rows[0].count).toBe(12);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
});
