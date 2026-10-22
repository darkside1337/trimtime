import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDatabase } from "../support/database";

describe("recurring schedule migration", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  const schema = `phase03_${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    database = await openTestDatabase();
    await database.pool.query(`CREATE SCHEMA ${schema}`);
    await database.pool.query(
      `CREATE TABLE ${schema}.shops (id text PRIMARY KEY)`,
    );
    await database.pool.query(
      `CREATE TABLE ${schema}.barbers (id text PRIMARY KEY, shop_id text NOT NULL REFERENCES ${schema}.shops(id), UNIQUE(shop_id, id))`,
    );
    await database.pool.query(
      `INSERT INTO ${schema}.shops VALUES ('shop-a'), ('shop-b')`,
    );
    await database.pool.query(
      `INSERT INTO ${schema}.barbers VALUES ('barber-a', 'shop-a')`,
    );
  });

  afterAll(async () => {
    await database?.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await database?.pool.end();
  });

  it("adds empty schedule storage without changing existing rows and rejects mixed-shop references", async () => {
    const client = await database.pool.connect();
    await expect(
      client.query(`SELECT * FROM ${schema}.shop_schedules`),
    ).rejects.toMatchObject({ code: "42P01" });
    const migration = await readFile(
      "db/migrations/0003_recurring_schedules.sql",
      "utf8",
    );
    await client.query(`SET search_path TO ${schema}`);
    try {
      await client.query(migration);
      const shops = await client.query(
        `SELECT * FROM ${schema}.shops ORDER BY id`,
      );
      expect(shops.rows).toEqual([{ id: "shop-a" }, { id: "shop-b" }]);
      const week = JSON.stringify(
        Array.from({ length: 7 }, () => ({ working: [], breaks: [] })),
      );
      await expect(
        client.query(
          `INSERT INTO ${schema}.barber_schedules VALUES ('shop-b', 'barber-a', $1::jsonb, 1)`,
          [week],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        client.query(
          `INSERT INTO ${schema}.shop_schedules VALUES ('shop-a', '[]'::jsonb, 1)`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("RESET search_path");
      client.release();
    }
  });
});
