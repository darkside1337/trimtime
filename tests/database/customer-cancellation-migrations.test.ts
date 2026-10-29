import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDatabase } from "../support/database";

const baselineMigrations = [
  "0005_public_bookings.sql",
  "0007_email_notifications.sql",
  "0008_owner_manual_appointments.sql",
  "0009_owner_booking_changes.sql",
];

async function isolatedSchema(pool: Pool) {
  const schema = `phase10_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE SCHEMA ${schema}`);
  for (const [table, ddl] of Object.entries({
    shops: `id text PRIMARY KEY`,
    user: `id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE`,
    services: `id text PRIMARY KEY, shop_id text NOT NULL REFERENCES ${schema}.shops(id), UNIQUE(shop_id,id)`,
    barbers: `id text PRIMARY KEY, shop_id text NOT NULL REFERENCES ${schema}.shops(id), UNIQUE(shop_id,id)`,
    occupied_intervals: `id uuid PRIMARY KEY`,
  }))
    await pool.query(`CREATE TABLE ${schema}.${table} (${ddl})`);
  const client = await pool.connect();
  await client.query(`SET search_path TO ${schema}, public`);
  return { schema, client };
}

async function applyBaseline(client: PoolClient) {
  for (const migration of baselineMigrations)
    await client.query(await readFile(`db/migrations/${migration}`, "utf8"));
}

async function applyCustomerCancellation(client: PoolClient) {
  await client.query(
    await readFile("db/migrations/0010_customer_cancellation.sql", "utf8"),
  );
}

async function closeSchema(
  pool: Pool,
  fixture: Awaited<ReturnType<typeof isolatedSchema>>,
) {
  await fixture.client.query("RESET search_path");
  fixture.client.release();
  await pool.query(`DROP SCHEMA IF EXISTS ${fixture.schema} CASCADE`);
}

async function seedBase(client: PoolClient, ownerId: string) {
  await client.query(
    `INSERT INTO "user" (id,name,email) VALUES ($1,'Owner',$2)`,
    [ownerId, `${ownerId}@example.test`],
  );
  await client.query(`INSERT INTO shops (id) VALUES ('shop-a')`);
  await client.query(
    `INSERT INTO services (id,shop_id) VALUES ('service-a','shop-a')`,
  );
  await client.query(
    `INSERT INTO barbers (id,shop_id) VALUES ('barber-a','shop-a')`,
  );
}

async function insertBooking(
  client: PoolClient,
  values: {
    id: string;
    occupancyId?: string;
    creationSource?: "public" | "owner";
    customerEmail?: string | null;
    startAt: string;
    endAt: string;
    capabilityHash: string;
  },
) {
  await client.query(
    `INSERT INTO bookings (id,shop_id,service_id,barber_id,occupancy_id,start_at,end_at,service_name,service_price_usd,service_duration_minutes,barber_name,customer_name,customer_email,whatsapp_opt_in,capability_hash,capability_ciphertext,capability_key_id,recovery_key_hash,recovery_payload_digest,creation_source) VALUES ($1,'shop-a','service-a','barber-a',$2,$3,$4,'Saved Cut',25,30,'Saved Barber','Ada',$5,false,$6,'encrypted-a','test-v1',$7,'digest-a',$8)`,
    [
      values.id,
      values.occupancyId ?? null,
      values.startAt,
      values.endAt,
      values.customerEmail === undefined
        ? "ada@example.test"
        : values.customerEmail,
      values.capabilityHash,
      values.capabilityHash,
      values.creationSource ?? "public",
    ],
  );
}

describe("customer cancellation migration", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(async () => {
    await database?.pool.end();
  });

  it("upgrades populated owner history and notification evidence in place", async () => {
    const fixture = await isolatedSchema(database.pool);
    const { client } = fixture;
    const ownerId = randomUUID();
    const bookingId = randomUUID();
    const contactlessBookingId = randomUUID();
    const occupancyId = randomUUID();
    const confirmationWorkId = randomUUID();
    const ownerAlertWorkId = randomUUID();
    const attemptId = randomUUID();
    const moveChangeId = randomUUID();
    const cancelChangeId = randomUUID();
    let upgradeError: unknown;
    try {
      await applyBaseline(client);
      await seedBase(client, ownerId);
      await client.query(`INSERT INTO occupied_intervals (id) VALUES ($1)`, [
        occupancyId,
      ]);
      await insertBooking(client, {
        id: bookingId,
        occupancyId,
        startAt: "2026-11-02T10:00Z",
        endAt: "2026-11-02T10:30Z",
        capabilityHash: "cap-a",
      });
      await insertBooking(client, {
        id: contactlessBookingId,
        creationSource: "owner",
        customerEmail: null,
        startAt: "2026-11-02T11:00Z",
        endAt: "2026-11-02T11:30Z",
        capabilityHash: "cap-owner",
      });
      await client.query(
        `INSERT INTO notification_work (id,booking_id,kind,channel,status,recipient) VALUES ($1,$2,'customer_confirmation','email','captured','ada@example.test')`,
        [confirmationWorkId, bookingId],
      );
      await client.query(
        `INSERT INTO notification_work (id,booking_id,kind,channel,status,recipient) VALUES ($1,$2,'owner_alert','email','failed',$3)`,
        [ownerAlertWorkId, bookingId, `${ownerId}@example.test`],
      );
      await client.query(
        `INSERT INTO outbound_budget (day,allocation_count) VALUES ('2026-11-02',1)`,
      );
      await client.query(
        `INSERT INTO notification_attempts (id,work_id,budget_day,invoked_at,outcome,capture_id) VALUES ($1,$2,'2026-11-02',now(),'captured','capture-a')`,
        [attemptId, confirmationWorkId],
      );
      for (const [changeId, revision, kind, operationKey] of [
        [moveChangeId, 1, "move", "move-key"],
        [cancelChangeId, 2, "cancel", "cancel-key"],
      ] as const) {
        await client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,$4,$5,$6,$7,'{"status":"confirmed"}'::jsonb,'{"status":"cancelled"}'::jsonb)`,
          [
            changeId,
            bookingId,
            ownerId,
            kind,
            revision,
            operationKey,
            `digest-${revision}`,
          ],
        );
        await client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status,recipient) VALUES ($1,$2,$3,$4,$5,'email','accepted','ada@example.test')`,
          [
            randomUUID(),
            bookingId,
            revision,
            changeId,
            kind === "move" ? "customer_move" : "customer_cancellation",
          ],
        );
      }
      await client.query(`UPDATE bookings SET revision=2 WHERE id=$1`, [
        bookingId,
      ]);

      const bookingsBefore = (
        await client.query(
          `SELECT id,revision,status,start_at,end_at,service_name,service_price_usd,customer_email,creation_source,capability_hash,capability_ciphertext,capability_revoked_at FROM bookings ORDER BY id`,
        )
      ).rows;
      const changesBefore = (
        await client.query(
          `SELECT id,shop_id,booking_id,actor_id,kind,applied_revision,committed_at,operation_key_hash,payload_digest,before_snapshot,after_snapshot FROM booking_changes ORDER BY applied_revision`,
        )
      ).rows;
      const workBefore = (
        await client.query(
          `SELECT id,booking_id,booking_revision,change_id,kind,channel,status,recipient,content_identity,reason,created_at,updated_at,claimed_at,claim_id FROM notification_work ORDER BY kind,booking_revision`,
        )
      ).rows;
      const attemptsBefore = (
        await client.query(
          `SELECT id,work_id,budget_day,outcome,capture_id FROM notification_attempts ORDER BY id`,
        )
      ).rows;
      const budgetBefore = (
        await client.query(
          `SELECT day,allocation_count FROM outbound_budget ORDER BY day`,
        )
      ).rows;

      try {
        await applyCustomerCancellation(client);
      } catch (error) {
        upgradeError = error;
        throw error;
      }

      expect(upgradeError).toBeUndefined();
      expect(
        (
          await client.query(
            `SELECT id,revision,status,start_at,end_at,service_name,service_price_usd,customer_email,creation_source,capability_hash,capability_ciphertext,capability_revoked_at FROM bookings ORDER BY id`,
          )
        ).rows,
      ).toEqual(bookingsBefore);
      expect(
        (
          await client.query(
            `SELECT id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,committed_at,operation_key_hash,payload_digest,before_snapshot,after_snapshot FROM booking_changes ORDER BY applied_revision`,
          )
        ).rows,
      ).toEqual(changesBefore.map((row) => ({ ...row, actor_type: "owner" })));
      expect(
        (
          await client.query(
            `SELECT id,booking_id,booking_revision,change_id,kind,channel,status,recipient,content_identity,reason,created_at,updated_at,claimed_at,claim_id FROM notification_work ORDER BY kind,booking_revision`,
          )
        ).rows,
      ).toEqual(workBefore);
      expect(
        (
          await client.query(
            `SELECT id,work_id,budget_day,outcome,capture_id FROM notification_attempts ORDER BY id`,
          )
        ).rows,
      ).toEqual(attemptsBefore);
      expect(
        (
          await client.query(
            `SELECT day,allocation_count FROM outbound_budget ORDER BY day`,
          )
        ).rows,
      ).toEqual(budgetBefore);
    } finally {
      await closeSchema(database.pool, fixture);
    }
  });

  it("preserves creation counters and permits customer change link counters", async () => {
    const fixture = await isolatedSchema(database.pool);
    const { client } = fixture;
    const existingEventId = randomUUID();
    const customerEventId = randomUUID();
    try {
      await applyBaseline(client);
      await client.query(
        `INSERT INTO public_rate_keys (scope,key_hash) VALUES ('create_email_shop','email-hash')`,
      );
      await client.query(
        `INSERT INTO public_rate_events (id,scope,key_hash) VALUES ($1,'create_email_shop','email-hash')`,
        [existingEventId],
      );

      await applyCustomerCancellation(client);

      expect(
        (
          await client.query(
            `SELECT scope,key_hash FROM public_rate_keys ORDER BY scope,key_hash`,
          )
        ).rows,
      ).toEqual([{ scope: "create_email_shop", key_hash: "email-hash" }]);
      expect(
        (
          await client.query(
            `SELECT id,scope,key_hash FROM public_rate_events ORDER BY id`,
          )
        ).rows,
      ).toEqual([
        {
          id: existingEventId,
          scope: "create_email_shop",
          key_hash: "email-hash",
        },
      ]);

      await client.query(
        `INSERT INTO public_rate_keys (scope,key_hash) VALUES ('customer_change_link','link-hash')`,
      );
      await client.query(
        `INSERT INTO public_rate_events (id,scope,key_hash) VALUES ($1,'customer_change_link','link-hash')`,
        [customerEventId],
      );
      expect(
        (
          await client.query(
            `SELECT scope,key_hash FROM public_rate_keys ORDER BY scope,key_hash`,
          )
        ).rows,
      ).toEqual([
        { scope: "create_email_shop", key_hash: "email-hash" },
        { scope: "customer_change_link", key_hash: "link-hash" },
      ]);

      await expect(
        client.query(
          `INSERT INTO public_rate_keys (scope,key_hash) VALUES ('invalid_link_ip','ip-hash')`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await closeSchema(database.pool, fixture);
    }
  });

  it("accepts customer attribution and owner cancellation work while rejecting contradictions", async () => {
    const fixture = await isolatedSchema(database.pool);
    const { client } = fixture;
    const ownerId = randomUUID();
    const bookingId = randomUUID();
    const otherBookingId = randomUUID();
    const moveChangeId = randomUUID();
    const cancelChangeId = randomUUID();
    const otherChangeId = randomUUID();
    try {
      await applyBaseline(client);
      await applyCustomerCancellation(client);
      await seedBase(client, ownerId);
      await insertBooking(client, {
        id: bookingId,
        startAt: "2026-11-02T10:00Z",
        endAt: "2026-11-02T10:30Z",
        capabilityHash: "cap-a",
      });
      await insertBooking(client, {
        id: otherBookingId,
        startAt: "2026-11-02T11:00Z",
        endAt: "2026-11-02T11:30Z",
        capabilityHash: "cap-b",
      });
      await client.query(`UPDATE bookings SET revision=2 WHERE id=$1`, [
        bookingId,
      ]);

      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'move',1,'owner-key','owner-digest','{}','{}')`,
        [moveChangeId, bookingId, ownerId],
      );
      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,NULL,'customer','cancel',2,'customer-key','customer-digest','{}','{}')`,
        [cancelChangeId, bookingId],
      );
      const actors = (
        await client.query(
          `SELECT actor_id,actor_type,kind FROM booking_changes WHERE booking_id=$1 ORDER BY applied_revision`,
          [bookingId],
        )
      ).rows;
      expect(actors).toEqual([
        { actor_id: ownerId, actor_type: "owner", kind: "move" },
        { actor_id: null, actor_type: "customer", kind: "cancel" },
      ]);

      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'customer','cancel',3,'mixed-key','digest','{}','{}')`,
          [randomUUID(), bookingId, ownerId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,NULL,'owner','cancel',3,'missing-actor-key','digest','{}','{}')`,
          [randomUUID(), bookingId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,NULL,'customer','move',3,'customer-move-key','digest','{}','{}')`,
          [randomUUID(), bookingId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,NULL,'system','cancel',3,'system-key','digest','{}','{}')`,
          [randomUUID(), bookingId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,NULL,'customer','cancel',2,'other-customer-key','digest','{}','{}')`,
          [randomUUID(), bookingId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'cancel',3,'owner-key','other-digest','{}','{}')`,
          [randomUUID(), bookingId, ownerId],
        ),
      ).rejects.toMatchObject({ code: "23505" });

      await client.query(
        `INSERT INTO notification_work (id,booking_id,kind,channel,status,recipient) VALUES ($1,$2,'owner_alert','email','captured','owner@example.test')`,
        [randomUUID(), bookingId],
      );
      await client.query(
        `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status,recipient) VALUES ($1,$2,2,$3,'owner_cancellation','email','not_attempted','owner@example.test')`,
        [randomUUID(), bookingId, cancelChangeId],
      );
      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'cancel',1,'other-key','digest','{}','{}')`,
        [otherChangeId, otherBookingId, ownerId],
      );
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status) VALUES ($1,$2,3,$3,'owner_cancellation','email','not_attempted')`,
          [randomUUID(), bookingId, otherChangeId],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status) VALUES ($1,$2,0,$3,'owner_cancellation','email','not_attempted')`,
          [randomUUID(), bookingId, cancelChangeId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status) VALUES ($1,$2,2,$3,'owner_cancellation','whatsapp','unavailable')`,
          [randomUUID(), bookingId, cancelChangeId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status) VALUES ($1,$2,2,NULL,'owner_cancellation','email','not_attempted')`,
          [randomUUID(), bookingId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status) VALUES ($1,$2,2,$3,'owner_cancellation','email','accepted')`,
          [randomUUID(), bookingId, cancelChangeId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status) VALUES ($1,$2,2,$3,'booking_reminder','email','not_attempted')`,
          [randomUUID(), bookingId, cancelChangeId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status) VALUES ($1,$2,1,NULL,'customer_move','email','not_attempted')`,
          [randomUUID(), bookingId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await closeSchema(database.pool, fixture);
    }
  });
});
