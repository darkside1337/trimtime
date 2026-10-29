import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../db/migrate.mts";
import { openTestDatabase } from "../support/database";
import {
  readAppliedMigrations,
  readExpectedMigrations,
  withExpectedTags,
} from "../support/migration-ledger";

const productMigrations = "db/migrations";
const fixtureMigrations = "tests/fixtures/migrations";

describe("product and fixture migration ledgers", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let probeId: number | undefined;

  beforeAll(async () => {
    database = await openTestDatabase();
    await applyMigrations(
      database.pool,
      fixtureMigrations,
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

  it("keeps each journal's ledger and data intact across independent reruns", async () => {
    const [expectedProduct, expectedFixture, productBefore, fixtureBefore] =
      await Promise.all([
        readExpectedMigrations(productMigrations),
        readExpectedMigrations(fixtureMigrations),
        readAppliedMigrations(database.pool, "drizzle"),
        readAppliedMigrations(database.pool, "phase00_fixture_migrations"),
      ]);

    const id = randomInt(1, 2147483647);
    const inserted = await database.pool.query(
      "INSERT INTO phase00_probe (id, note) VALUES ($1, 'separate-ledger') ON CONFLICT (id) DO NOTHING RETURNING id",
      [id],
    );
    expect(inserted.rowCount).toBe(1);
    probeId = id;

    await applyMigrations(database.pool, productMigrations);
    await applyMigrations(
      database.pool,
      fixtureMigrations,
      "phase00_fixture_migrations",
    );

    const [fixture, productAfter, fixtureAfter, ledgerSchemas] =
      await Promise.all([
        database.pool.query("SELECT note FROM phase00_probe WHERE id = $1", [
          id,
        ]),
        readAppliedMigrations(database.pool, "drizzle"),
        readAppliedMigrations(database.pool, "phase00_fixture_migrations"),
        database.pool.query(
          "SELECT table_schema FROM information_schema.tables WHERE table_name = '__drizzle_migrations' AND table_schema = ANY(ARRAY['drizzle', 'phase00_fixture_migrations']) ORDER BY table_schema",
        ),
      ]);

    expect(withExpectedTags(productBefore, expectedProduct)).toEqual(
      expectedProduct,
    );
    expect(withExpectedTags(fixtureBefore, expectedFixture)).toEqual(
      expectedFixture,
    );
    expect(ledgerSchemas.rows.map(({ table_schema }) => table_schema)).toEqual([
      "drizzle",
      "phase00_fixture_migrations",
    ]);
    expect(fixture.rows[0]?.note).toBe("separate-ledger");
    expect(productAfter).toEqual(productBefore);
    expect(fixtureAfter).toEqual(fixtureBefore);
    expect(withExpectedTags(fixtureAfter, expectedFixture)).toEqual(
      expectedFixture,
    );

    const fixtureHashes = new Set(fixtureAfter.map(({ hash }) => hash));
    expect(productAfter.filter(({ hash }) => fixtureHashes.has(hash))).toEqual(
      [],
    );
  });
});
