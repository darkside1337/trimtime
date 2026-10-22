import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../db/migrate.mts";
import { openTestDatabase } from "../support/database";

describe("product and fixture migration ledgers", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;

  beforeAll(async () => {
    database = await openTestDatabase();
    await applyMigrations(database.pool, "db/migrations");
    await applyMigrations(
      database.pool,
      "tests/fixtures/migrations",
      "phase00_fixture_migrations",
    );
  });

  afterAll(async () => {
    await database?.pool.end();
  });

  it("keeps fixture data while each ledger reruns independently", async () => {
    await database.pool.query(
      "INSERT INTO phase00_probe (id, note) VALUES (101, 'separate-ledger') ON CONFLICT (id) DO UPDATE SET note = EXCLUDED.note",
    );
    await applyMigrations(database.pool, "db/migrations");
    await applyMigrations(
      database.pool,
      "tests/fixtures/migrations",
      "phase00_fixture_migrations",
    );

    const [fixture, product] = await Promise.all([
      database.pool.query("SELECT note FROM phase00_probe WHERE id = 101"),
      database.pool.query(
        'SELECT count(*)::int AS count FROM drizzle."__drizzle_migrations"',
      ),
    ]);
    const fixtureLedger = await database.pool.query(
      'SELECT count(*)::int AS count FROM phase00_fixture_migrations."__drizzle_migrations"',
    );

    expect(fixture.rows[0]?.note).toBe("separate-ledger");
    expect(product.rows[0]?.count).toBe(3);
    expect(fixtureLedger.rows[0]?.count).toBe(1);
  });
});
