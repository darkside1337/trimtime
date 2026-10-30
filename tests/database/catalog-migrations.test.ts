import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../db/migrate.mts";
import { openTestDatabase } from "../support/database";
import {
  readAppliedMigrations,
  readExpectedMigrations,
  withExpectedTags,
} from "../support/migration-ledger";

const migrationsFolder = "db/migrations";

describe("catalog migrations", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let sentinelOwnerId: string | undefined;

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(async () => {
    if (sentinelOwnerId)
      await database?.pool.query('DELETE FROM "user" WHERE id = $1', [
        sentinelOwnerId,
      ]);
    await database?.pool.end();
  });

  it("adds shop-scoped catalog tables and reruns without changing data or the ledger", async () => {
    const expected = await readExpectedMigrations(migrationsFolder);
    const ownerId = randomUUID();
    const shopId = randomUUID();
    sentinelOwnerId = ownerId;
    await database.pool.query(
      'INSERT INTO "user" (id,name,email) VALUES ($1,$2,$3)',
      [
        ownerId,
        "Catalog Ledger Owner",
        `catalog-ledger-${ownerId}@example.test`,
      ],
    );
    await database.pool.query(
      "INSERT INTO shops (id,owner_id,name,subdomain,time_zone,public_contact,address,published) VALUES ($1,$2,'Ledger Shop',$3,'UTC','Call 555-0100','1 Ledger Road',false)",
      [shopId, ownerId, `ledger-${shopId.slice(0, 8)}`],
    );

    const [ledgerBefore, shopBefore] = await Promise.all([
      readAppliedMigrations(database.pool, "drizzle"),
      database.pool.query(
        "SELECT id, name, subdomain, published FROM shops WHERE id = $1",
        [shopId],
      ),
    ]);

    await applyMigrations(database.pool, migrationsFolder);

    const [tables, keys, ledgerAfter, shopAfter] = await Promise.all([
      database.pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(ARRAY['shops', 'services', 'barbers', 'barber_services']) ORDER BY table_name",
      ),
      database.pool.query(
        "SELECT conname FROM pg_constraint WHERE conname IN ('services_shop_id_id_key', 'barbers_shop_id_id_key', 'barber_services_barber_fkey', 'barber_services_service_fkey') ORDER BY conname",
      ),
      readAppliedMigrations(database.pool, "drizzle"),
      database.pool.query(
        "SELECT id, name, subdomain, published FROM shops WHERE id = $1",
        [shopId],
      ),
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
    expect(new Set(ledgerBefore.map(({ id }) => id)).size).toBe(
      ledgerBefore.length,
    );
    expect(withExpectedTags(ledgerBefore, expected)).toEqual(expected);
    expect(ledgerAfter).toEqual(ledgerBefore);
    expect(shopAfter.rows).toEqual(shopBefore.rows);
  });
});
