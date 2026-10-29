import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDatabase } from "../support/database";

describe("dated availability migration", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  const schema = `phase04_${randomUUID().replaceAll("-", "")}`;
  const migrationFile = "db/migrations/0004_dated_availability.sql";

  beforeAll(async () => {
    database = await openTestDatabase();
    await database.pool.query(`CREATE SCHEMA ${schema}`);
    await database.pool.query(
      `CREATE TABLE ${schema}.shops (id text PRIMARY KEY)`,
    );
    await database.pool.query(
      `CREATE TABLE ${schema}.barbers (id text PRIMARY KEY, shop_id text NOT NULL REFERENCES ${schema}.shops(id) ON DELETE CASCADE, UNIQUE(shop_id, id))`,
    );
    await database.pool.query(
      `INSERT INTO ${schema}.shops VALUES ('shop-a'), ('shop-b')`,
    );
    await database.pool.query(
      `INSERT INTO ${schema}.barbers VALUES ('barber-a', 'shop-a'), ('barber-b', 'shop-a'), ('barber-c', 'shop-b')`,
    );
  });

  afterAll(async () => {
    await database?.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await database?.pool.end();
  });

  it("preserves rows and enforces scope, retained revisions, and same-barber half-open conflicts", async () => {
    const client = await database.pool.connect();
    await client.query(`SET search_path TO ${schema}, public`);
    try {
      await client.query(await readFile(migrationFile, "utf8"));
      expect(
        (await client.query("SELECT id FROM shops ORDER BY id")).rows.map(
          (row) => row.id,
        ),
      ).toContain("shop-a");
      await expect(
        client.query(
          "INSERT INTO barber_date_schedules VALUES ('shop-b','barber-a','2026-11-02',NULL,false,1)",
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        client.query(
          "INSERT INTO occupied_intervals VALUES ($1,'shop-a','barber-a','2026-11-02 10:00Z','2026-11-02 10:00Z')",
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          "INSERT INTO occupied_intervals VALUES ($1,'shop-a','barber-a','2026-11-02 10:00:00.4Z','2026-11-02 10:15Z')",
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          "INSERT INTO occupied_intervals VALUES ($1,'shop-a','barber-a','2026-11-02 10:00Z','infinity')",
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query(
        "INSERT INTO shop_date_schedules VALUES ('shop-a','2026-11-02',NULL,true,2)",
      );
      await client.query(
        "UPDATE shop_date_schedules SET closed=false WHERE shop_id='shop-a' AND date='2026-11-02'",
      );
      expect(
        (
          await client.query(
            "SELECT revision, closed FROM shop_date_schedules WHERE shop_id='shop-a'",
          )
        ).rows,
      ).toEqual([{ revision: 2, closed: false }]);
      const first = randomUUID();
      await client.query(
        "INSERT INTO occupied_intervals VALUES ($1,'shop-a','barber-a','2026-11-02 10:00Z','2026-11-02 10:15Z')",
        [first],
      );
      await expect(
        client.query(
          "INSERT INTO occupied_intervals VALUES ($1,'shop-a','barber-a','2026-11-02 10:14Z','2026-11-02 10:30Z')",
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "23P01" });
      await client.query(
        "INSERT INTO occupied_intervals VALUES ($1,'shop-a','barber-a','2026-11-02 10:15Z','2026-11-02 10:30Z')",
        [randomUUID()],
      );
      await client.query(
        "INSERT INTO occupied_intervals VALUES ($1,'shop-a','barber-b','2026-11-02 10:00Z','2026-11-02 10:15Z')",
        [randomUUID()],
      );
      await client.query("INSERT INTO time_blocks VALUES ($1,'preserved')", [
        first,
      ]);
      await client.query("DELETE FROM shops WHERE id='shop-a'");
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id='shop-a'",
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      await client.query("RESET search_path");
      client.release();
    }
  });

  it("enforces overlapping reservations across independent SQL transactions", async () => {
    const first = await database.pool.connect();
    const second = await database.pool.connect();
    await first.query(`SET search_path TO ${schema}, public`);
    await second.query(`SET search_path TO ${schema}, public`);
    const secondPid = Number(
      (await second.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid,
    );
    await database.pool.query(
      `INSERT INTO ${schema}.shops VALUES ('shop-a') ON CONFLICT DO NOTHING`,
    );
    await database.pool.query(
      `INSERT INTO ${schema}.barbers VALUES ('barber-a', 'shop-a') ON CONFLICT DO NOTHING`,
    );

    async function waitUntilBlocked(pid: number) {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        const result = await database.pool.query(
          "SELECT pg_blocking_pids($1) AS blockers",
          [pid],
        );
        if (result.rows[0]?.blockers.length) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("The overlapping reservation was not blocked in time.");
    }

    async function insert(client: typeof first, id: string, start: string) {
      await client.query(
        "INSERT INTO occupied_intervals VALUES ($1,'shop-a','barber-a',$2::timestamptz,$3::timestamptz)",
        [id, start, new Date(Date.parse(start) + 15 * 60_000).toISOString()],
      );
    }

    try {
      await first.query("BEGIN");
      await insert(first, randomUUID(), "2026-11-02T12:00:00Z");
      await second.query("BEGIN");
      const conflict = insert(second, randomUUID(), "2026-11-02T12:05:00Z");
      await waitUntilBlocked(secondPid);
      await first.query("COMMIT");
      await expect(conflict).rejects.toMatchObject({ code: "23P01" });
      await second.query("ROLLBACK");

      await first.query("BEGIN");
      await insert(first, randomUUID(), "2026-11-02T13:00:00Z");
      await second.query("BEGIN");
      const released = insert(second, randomUUID(), "2026-11-02T13:05:00Z");
      await waitUntilBlocked(secondPid);
      await first.query("ROLLBACK");
      await released;
      await second.query("COMMIT");
    } finally {
      await first.query("ROLLBACK").catch(() => undefined);
      await second.query("ROLLBACK").catch(() => undefined);
      await first.query("RESET search_path");
      await second.query("RESET search_path");
      first.release();
      second.release();
    }
  });
});
