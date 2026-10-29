import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDatabase } from "../support/database";

describe("manual booking migration", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  const schema = `phase08_${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    database = await openTestDatabase();
    await database.pool.query(`CREATE SCHEMA ${schema}`);
    await database.pool.query(
      `CREATE TABLE ${schema}.shops (id text PRIMARY KEY)`,
    );
    await database.pool.query(
      `CREATE TABLE ${schema}.services (id text PRIMARY KEY, shop_id text NOT NULL REFERENCES ${schema}.shops(id), UNIQUE(shop_id,id))`,
    );
    await database.pool.query(
      `CREATE TABLE ${schema}.barbers (id text PRIMARY KEY, shop_id text NOT NULL REFERENCES ${schema}.shops(id), UNIQUE(shop_id,id))`,
    );
    await database.pool.query(
      `CREATE TABLE ${schema}.occupied_intervals (id uuid PRIMARY KEY)`,
    );
    await database.pool.query(`INSERT INTO ${schema}.shops VALUES ('shop-a')`);
    await database.pool.query(
      `INSERT INTO ${schema}.services VALUES ('service-a','shop-a')`,
    );
    await database.pool.query(
      `INSERT INTO ${schema}.barbers VALUES ('barber-a','shop-a')`,
    );
  });

  afterAll(async () => {
    await database?.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await database?.pool.end();
  });

  it("preserves public records and allows NULL owner records without relaxing constraints", async () => {
    const client = await database.pool.connect();
    await client.query(`SET search_path TO ${schema}, public`);
    try {
      await client.query(
        await readFile("db/migrations/0005_public_bookings.sql", "utf8"),
      );
      await client.query(
        await readFile("db/migrations/0007_email_notifications.sql", "utf8"),
      );
      const occupancyId = randomUUID();
      const publicBookingId = randomUUID();
      await client.query("INSERT INTO occupied_intervals (id) VALUES ($1)", [
        occupancyId,
      ]);
      await client.query(
        `INSERT INTO bookings (
        id,shop_id,service_id,barber_id,occupancy_id,start_at,end_at,service_name,service_price_usd,
        service_duration_minutes,barber_name,customer_name,customer_email,whatsapp_opt_in,
        capability_hash,capability_ciphertext,capability_key_id,recovery_key_hash,recovery_payload_digest
      ) VALUES ($1,'shop-a','service-a','barber-a',$2,'2026-11-02T10:00Z','2026-11-02T10:30Z','Saved Cut',25,30,'Saved Barber','Ada','ada@example.test',false,'cap-a','encrypted-a','key-a','recovery-a','digest-a')`,
        [publicBookingId, occupancyId],
      );
      await client.query(
        "INSERT INTO notification_work (id,booking_id,kind,channel,status,recipient) VALUES ($1,$2,'customer_confirmation','email','not_attempted','ada@example.test')",
        [randomUUID(), publicBookingId],
      );
      await client.query(
        await readFile(
          "db/migrations/0008_owner_manual_appointments.sql",
          "utf8",
        ),
      );

      expect(
        (
          await client.query(
            "SELECT id,customer_email,occupancy_id,capability_hash,service_name,creation_source FROM bookings WHERE id=$1",
            [publicBookingId],
          )
        ).rows[0],
      ).toEqual({
        id: publicBookingId,
        customer_email: "ada@example.test",
        occupancy_id: occupancyId,
        capability_hash: "cap-a",
        service_name: "Saved Cut",
        creation_source: "public",
      });
      const ownerId = randomUUID();
      await client.query(
        `INSERT INTO bookings (
        id,shop_id,service_id,barber_id,start_at,end_at,service_name,service_price_usd,
        service_duration_minutes,barber_name,customer_name,customer_email,whatsapp_opt_in,
        capability_hash,capability_ciphertext,capability_key_id,recovery_key_hash,recovery_payload_digest,creation_source
      ) VALUES ($1,'shop-a','service-a','barber-a','2026-11-02T11:00Z','2026-11-02T11:30Z','Cut',25,30,'Barber','Walk-in',NULL,false,'cap-b','encrypted-b','key-a','recovery-b','digest-b','owner')`,
        [ownerId],
      );
      expect(
        (
          await client.query(
            "SELECT customer_email,creation_source FROM bookings WHERE id=$1",
            [ownerId],
          )
        ).rows[0],
      ).toEqual({ customer_email: null, creation_source: "owner" });
      await expect(
        client.query(
          `UPDATE bookings SET creation_source='invalid' WHERE id=$1`,
          [ownerId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(`UPDATE bookings SET service_id='foreign' WHERE id=$1`, [
          ownerId,
        ]),
      ).rejects.toMatchObject({ code: "23503" });
      const recoveryConstraint = await client.query(
        "SELECT conname FROM pg_constraint WHERE conname='bookings_shop_recovery_key_key' AND connamespace=current_schema()::regnamespace",
      );
      expect(recoveryConstraint.rows).toHaveLength(1);
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1",
            [publicBookingId],
          )
        ).rows[0].count,
      ).toBe(1);
    } finally {
      await client.query("RESET search_path");
      client.release();
    }
  });
});
