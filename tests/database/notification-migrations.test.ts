import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDatabase } from "../support/database";

describe("notification migration", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  const schema = `notification_${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    database = await openTestDatabase();
    await database.pool.query(`CREATE SCHEMA ${schema}`);
    const client = await database.pool.connect();
    await client.query(`SET search_path TO ${schema}, public`);
    try {
      await client.query("CREATE TABLE bookings (id uuid PRIMARY KEY)");
      await client.query(`CREATE TABLE notification_work (
        id uuid PRIMARY KEY,
        booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK (kind IN ('customer_confirmation', 'owner_alert')),
        channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
        status text NOT NULL CHECK (status IN ('unavailable', 'not_attempted')),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT notification_work_booking_kind_channel_key UNIQUE (booking_id, kind, channel)
      )`);
      await client.query("INSERT INTO bookings VALUES ($1)", [
        "00000000-0000-4000-8000-000000000001",
      ]);
      await client.query(`INSERT INTO notification_work (id, booking_id, kind, channel, status)
        VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','customer_confirmation','email','unavailable')`);
      await client.query(
        await readFile("db/migrations/0007_email_notifications.sql", "utf8"),
      );
    } finally {
      await client.query("RESET search_path");
      client.release();
    }
  });

  afterAll(async () => {
    await database?.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await database?.pool.end();
  });

  it("preserves unavailable history and enforces work, attempt, and daily budget constraints", async () => {
    const client = await database.pool.connect();
    await client.query(`SET search_path TO ${schema}, public`);
    try {
      expect(
        (await client.query("SELECT status, reason FROM notification_work"))
          .rows,
      ).toEqual([{ status: "unavailable", reason: "legacy_unavailable" }]);
      const workId = "00000000-0000-4000-8000-000000000002";
      const budgetDay = "2026-11-02";
      await client.query(
        "INSERT INTO outbound_budget (day, allocation_count) VALUES ($1, 0)",
        [budgetDay],
      );
      await expect(
        client.query(
          "INSERT INTO outbound_budget (day, allocation_count) VALUES ('2026-11-03', -1)",
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          "INSERT INTO outbound_budget (day, allocation_count) VALUES ('2026-11-04', 101)",
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          "INSERT INTO notification_work (id, booking_id, kind, channel, status) VALUES ($1,$2,'owner_alert','email','not_attempted')",
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        client.query(
          "INSERT INTO notification_work (id, booking_id, kind, channel, status) VALUES ($1,$2,'owner_alert','email','delivered')",
          [randomUUID(), "00000000-0000-4000-8000-000000000001"],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          "INSERT INTO notification_work (id, booking_id, kind, channel, status) VALUES ($1,$2,'customer_confirmation','email','not_attempted')",
          [randomUUID(), "00000000-0000-4000-8000-000000000001"],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await client.query(
        "INSERT INTO notification_attempts (id, work_id, budget_day) VALUES ($1,$2,$3)",
        [randomUUID(), workId, budgetDay],
      );
      await expect(
        client.query(
          "INSERT INTO notification_attempts (id, work_id, budget_day) VALUES ($1,$2,$3)",
          [randomUUID(), workId, budgetDay],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await client.query("RESET search_path");
      client.release();
    }
  });
});
