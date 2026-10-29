import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../db/migrate.mts";
import { openTestDatabase } from "../support/database";

const migrationsFolder = "tests/fixtures/migrations";

describe("disposable PostgreSQL migrations", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let probeId: number | undefined;

  beforeAll(async () => {
    database = await openTestDatabase();
    await applyMigrations(
      database.pool,
      migrationsFolder,
      "phase00_fixture_migrations",
    );
  });

  afterAll(async () => {
    if (probeId !== undefined)
      await database?.pool.query("DELETE FROM phase00_probe WHERE id = $1", [
        probeId,
      ]);
    await database?.pool.end();
  });

  it("applies fixture DDL and records the migration", async () => {
    const table = await database.pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'phase00_probe' ORDER BY ordinal_position",
    );
    const ledger = await database.pool.query(
      'SELECT hash FROM phase00_fixture_migrations."__drizzle_migrations"',
    );

    expect(table.rows.map((row) => row.column_name)).toEqual(["id", "note"]);
    expect(ledger.rowCount).toBe(1);
  });

  it("keeps fixture data when migrations run again", async () => {
    const id = randomInt(1, 2147483647);
    const inserted = await database.pool.query(
      "INSERT INTO phase00_probe (id, note) VALUES ($1, 'preserved') ON CONFLICT (id) DO NOTHING RETURNING id",
      [id],
    );
    expect(inserted.rowCount).toBe(1);
    probeId = id;
    await applyMigrations(
      database.pool,
      migrationsFolder,
      "phase00_fixture_migrations",
    );

    const result = await database.pool.query(
      "SELECT note FROM phase00_probe WHERE id = $1",
      [id],
    );
    expect(result.rows[0]?.note).toBe("preserved");
  });
});
