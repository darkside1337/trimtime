import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../db/migrate.mts";
import { openTestDatabase } from "../support/database";

describe("owner booking changes migration", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  const schema = `phase09_${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    database = await openTestDatabase();
    await applyMigrations(database.pool, "db/migrations");
    await database.pool.query(`CREATE SCHEMA ${schema}`);
    for (const [table, ddl] of Object.entries({
      shops: `id text PRIMARY KEY`,
      user: `id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE`,
      services: `id text PRIMARY KEY, shop_id text NOT NULL REFERENCES ${schema}.shops(id), UNIQUE(shop_id,id)`,
      barbers: `id text PRIMARY KEY, shop_id text NOT NULL REFERENCES ${schema}.shops(id), UNIQUE(shop_id,id)`,
      occupied_intervals: `id uuid PRIMARY KEY`,
    }))
      await database.pool.query(`CREATE TABLE ${schema}.${table} (${ddl})`);
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

  it("backfills revisions and preserves existing notification evidence", async () => {
    const client = await database.pool.connect();
    await client.query(`SET search_path TO ${schema}, public`);
    const bookingId = randomUUID();
    const ownerBookingId = randomUUID();
    const occupancyId = randomUUID();
    const attemptId = randomUUID();
    const workId = randomUUID();
    const actorId = randomUUID();
    try {
      await client.query(
        await readFile("db/migrations/0005_public_bookings.sql", "utf8"),
      );
      await client.query(
        await readFile("db/migrations/0007_email_notifications.sql", "utf8"),
      );
      await client.query(
        await readFile(
          "db/migrations/0008_owner_manual_appointments.sql",
          "utf8",
        ),
      );
      await client.query("INSERT INTO occupied_intervals (id) VALUES ($1)", [
        occupancyId,
      ]);
      await client.query(
        `INSERT INTO bookings (id,shop_id,service_id,barber_id,occupancy_id,start_at,end_at,service_name,service_price_usd,service_duration_minutes,barber_name,customer_name,customer_email,whatsapp_opt_in,capability_hash,capability_ciphertext,capability_key_id,recovery_key_hash,recovery_payload_digest) VALUES ($1,'shop-a','service-a','barber-a',$2,'2026-11-02T10:00Z','2026-11-02T10:30Z','Saved Cut',25,30,'Saved Barber','Ada','ada@example.test',false,'cap-a','encrypted-a','key-a','recovery-a','digest-a')`,
        [bookingId, occupancyId],
      );
      await client.query(
        `INSERT INTO notification_work (id,booking_id,kind,channel,status,recipient) VALUES ($1,$2,'customer_confirmation','email','not_attempted','ada@example.test')`,
        [workId, bookingId],
      );
      await client.query(
        `INSERT INTO outbound_budget (day,allocation_count) VALUES ('2026-11-02',1)`,
      );
      await client.query(
        `INSERT INTO notification_attempts (id,work_id,budget_day,invoked_at,outcome,capture_id) VALUES ($1,$2,'2026-11-02',now(),'captured','capture-a')`,
        [attemptId, workId],
      );
      await client.query(
        `INSERT INTO bookings (id,shop_id,service_id,barber_id,start_at,end_at,service_name,service_price_usd,service_duration_minutes,barber_name,customer_name,customer_email,whatsapp_opt_in,capability_hash,capability_ciphertext,capability_key_id,recovery_key_hash,recovery_payload_digest,creation_source) VALUES ($1,'shop-a','service-a','barber-a','2026-11-02T11:00Z','2026-11-02T11:30Z','Owner Saved Cut',40,30,'Saved Barber','Walk-in',NULL,false,'cap-owner','encrypted-owner','key-owner','recovery-owner','digest-owner','owner')`,
        [ownerBookingId],
      );
      await client.query(
        await readFile("db/migrations/0009_owner_booking_changes.sql", "utf8"),
      );
      await client.query(
        `INSERT INTO "user" (id,name,email) VALUES ($1,'Owner',$2)`,
        [actorId, `${actorId}@example.test`],
      );
      expect(
        (
          await client.query(
            "SELECT revision,creation_source,service_name,service_price_usd,customer_email,capability_hash,capability_ciphertext FROM bookings WHERE id=$1",
            [bookingId],
          )
        ).rows[0],
      ).toMatchObject({
        revision: 0,
        creation_source: "public",
        service_name: "Saved Cut",
        service_price_usd: "25",
        customer_email: "ada@example.test",
        capability_hash: "cap-a",
        capability_ciphertext: "encrypted-a",
      });
      expect(
        (
          await client.query(
            "SELECT revision,creation_source,service_name,service_price_usd,customer_email,capability_hash,capability_ciphertext FROM bookings WHERE id=$1",
            [ownerBookingId],
          )
        ).rows[0],
      ).toMatchObject({
        revision: 0,
        creation_source: "owner",
        service_name: "Owner Saved Cut",
        service_price_usd: "40",
        customer_email: null,
        capability_hash: "cap-owner",
        capability_ciphertext: "encrypted-owner",
      });
      expect(
        (
          await client.query(
            "SELECT booking_revision FROM notification_work WHERE id=$1",
            [workId],
          )
        ).rows[0],
      ).toEqual({ booking_revision: 0 });
      expect(
        (
          await client.query(
            "SELECT outcome,capture_id FROM notification_attempts WHERE id=$1",
            [attemptId],
          )
        ).rows[0],
      ).toEqual({ outcome: "captured", capture_id: "capture-a" });
      const snapshot = {
        status: "confirmed",
        serviceId: "service-a",
        serviceName: "Saved Cut",
        servicePriceUsd: "25.00",
        serviceDurationMinutes: 30,
        barberId: "barber-a",
        barberName: "Saved Barber",
        startAt: "2026-11-02T10:00:00Z",
        endAt: "2026-11-02T10:30:00Z",
      };
      for (const revision of [1, 2]) {
        const changeId = randomUUID();
        await client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'cancel',$4,$5,$6,$7::jsonb,$7::jsonb)`,
          [
            changeId,
            bookingId,
            actorId,
            revision,
            `key-${revision}`,
            `digest-${revision}`,
            JSON.stringify(snapshot),
          ],
        );
        await client.query(`UPDATE bookings SET revision=$2 WHERE id=$1`, [
          bookingId,
          revision,
        ]);
        await client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status,recipient) VALUES ($1,$2,$3,$4,'customer_cancellation','email','unavailable','ada@example.test')`,
          [randomUUID(), bookingId, revision, changeId],
        );
      }
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1",
            [bookingId],
          )
        ).rows[0].count,
      ).toBe(2);
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1 AND kind='customer_cancellation' AND booking_revision IN (1,2) AND change_id IS NOT NULL",
            [bookingId],
          )
        ).rows[0].count,
      ).toBe(2);
      expect(
        (
          await client.query(
            "SELECT allocation_count FROM outbound_budget WHERE day='2026-11-02'",
          )
        ).rows[0],
      ).toEqual({ allocation_count: 1 });
      expect(
        (
          await client.query(
            "SELECT outcome,capture_id FROM notification_attempts WHERE id=$1",
            [attemptId],
          )
        ).rows[0],
      ).toEqual({ outcome: "captured", capture_id: "capture-a" });
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'cancel',3,'key-1','other','{}','{}')`,
          [randomUUID(), bookingId, actorId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'cancel',1,'key-new','other','{}','{}')`,
          [randomUUID(), bookingId, actorId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      const foreignChangeId = randomUUID();
      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'cancel',1,'owner-key','owner-digest','{}','{}')`,
        [foreignChangeId, ownerBookingId, actorId],
      );
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status) VALUES ($1,$2,3,$3,'customer_cancellation','email','unavailable')`,
          [randomUUID(), bookingId, foreignChangeId],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      const revisionOneChange = (
        await client.query(
          "SELECT id FROM booking_changes WHERE booking_id=$1 AND applied_revision=1",
          [bookingId],
        )
      ).rows[0].id;
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status) VALUES ($1,$2,1,$3,'customer_cancellation','email','unavailable')`,
          [randomUUID(), bookingId, revisionOneChange],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        client.query(`UPDATE bookings SET revision=-1 WHERE id=$1`, [
          bookingId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status) VALUES ($1,$2,1,NULL,'customer_move','email','unavailable')`,
          [randomUUID(), bookingId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("RESET search_path");
      client.release();
    }
  });
});
