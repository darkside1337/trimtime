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
  "0010_customer_cancellation.sql",
  "0011_customer_replacement.sql",
];

async function isolatedSchema(pool: Pool) {
  const schema = `phase12_${randomUUID().replaceAll("-", "")}`;
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

async function applyOwnerRestoration(client: PoolClient) {
  await client.query(
    await readFile("db/migrations/0012_owner_restoration.sql", "utf8"),
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
    startAt: string;
    endAt: string;
    capabilityHash: string;
    revision?: number;
  },
) {
  await client.query(
    `INSERT INTO bookings (id,shop_id,service_id,barber_id,start_at,end_at,service_name,service_price_usd,service_duration_minutes,barber_name,customer_name,customer_email,whatsapp_opt_in,capability_hash,capability_ciphertext,capability_key_id,recovery_key_hash,recovery_payload_digest,creation_source,revision) VALUES ($1,'shop-a','service-a','barber-a',$2,$3,'Saved Cut',25,30,'Saved Barber','Ada','ada@example.test',false,$4,'encrypted-a','test-v1',$4,'digest-a','public',$5)`,
    [
      values.id,
      values.startAt,
      values.endAt,
      values.capabilityHash,
      values.revision ?? 0,
    ],
  );
}

describe("owner restoration migration", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(async () => {
    await database?.pool.end();
  });

  it("preserves existing moves, cancellations, work, and attempts across 0012 upgrade", async () => {
    const fixture = await isolatedSchema(database.pool);
    const { client } = fixture;
    const ownerId = randomUUID();
    const bookingId = randomUUID();
    const ownerMoveChangeId = randomUUID();
    const customerMoveChangeId = randomUUID();
    const customerCancelChangeId = randomUUID();
    const ownerCancelChangeId = randomUUID();
    const attemptId = randomUUID();
    const budgetDay = "2026-10-30";

    try {
      await applyBaseline(client);
      await seedBase(client, ownerId);
      await insertBooking(client, {
        id: bookingId,
        startAt: "2026-11-02T10:00Z",
        endAt: "2026-11-02T10:30Z",
        capabilityHash: "cap-a",
        revision: 4,
      });

      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'owner','move',1,'owner-move-key','owner-move-digest','{}'::jsonb,'{}'::jsonb)`,
        [ownerMoveChangeId, bookingId, ownerId],
      );
      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,NULL,'customer','move',2,'cust-move-key','cust-move-digest','{}'::jsonb,'{}'::jsonb)`,
        [customerMoveChangeId, bookingId],
      );
      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,NULL,'customer','cancel',3,'cust-cancel-key','cust-cancel-digest','{}'::jsonb,'{}'::jsonb)`,
        [customerCancelChangeId, bookingId],
      );
      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'owner','cancel',4,'owner-cancel-key','owner-cancel-digest','{}'::jsonb,'{}'::jsonb)`,
        [ownerCancelChangeId, bookingId, ownerId],
      );

      await client.query(
        `INSERT INTO outbound_budget (day, allocation_count) VALUES ($1, 1)`,
        [budgetDay],
      );

      const workItems = [
        {
          id: randomUUID(),
          bookingId,
          revision: 0,
          changeId: null,
          kind: "customer_confirmation",
          channel: "email",
          status: "captured",
          recipient: "ada@example.test",
        },
        {
          id: randomUUID(),
          bookingId,
          revision: 0,
          changeId: null,
          kind: "owner_alert",
          channel: "email",
          status: "captured",
          recipient: "owner@example.test",
        },
        {
          id: randomUUID(),
          bookingId,
          revision: 1,
          changeId: ownerMoveChangeId,
          kind: "owner_move",
          channel: "email",
          status: "not_attempted",
          recipient: "owner@example.test",
        },
        {
          id: randomUUID(),
          bookingId,
          revision: 2,
          changeId: customerMoveChangeId,
          kind: "customer_move",
          channel: "email",
          status: "not_attempted",
          recipient: "ada@example.test",
        },
        {
          id: randomUUID(),
          bookingId,
          revision: 3,
          changeId: customerCancelChangeId,
          kind: "customer_cancellation",
          channel: "email",
          status: "not_attempted",
          recipient: "ada@example.test",
        },
        {
          id: randomUUID(),
          bookingId,
          revision: 4,
          changeId: ownerCancelChangeId,
          kind: "owner_cancellation",
          channel: "email",
          status: "not_attempted",
          recipient: "owner@example.test",
        },
      ];

      for (const item of workItems) {
        await client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status,recipient) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            item.id,
            item.bookingId,
            item.revision,
            item.changeId,
            item.kind,
            item.channel,
            item.status,
            item.recipient,
          ],
        );
      }

      await client.query(
        `INSERT INTO notification_attempts (id, work_id, budget_day, outcome) VALUES ($1, $2, $3, 'captured')`,
        [attemptId, workItems[0].id, budgetDay],
      );

      const changesBefore = (
        await client.query(
          `SELECT id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot FROM booking_changes ORDER BY applied_revision`,
        )
      ).rows;

      const workBefore = (
        await client.query(
          `SELECT id,booking_id,booking_revision,change_id,kind,channel,status,recipient FROM notification_work ORDER BY booking_revision, kind`,
        )
      ).rows;

      const attemptsBefore = (
        await client.query(
          `SELECT id, work_id, budget_day, outcome FROM notification_attempts ORDER BY id`,
        )
      ).rows;

      await applyOwnerRestoration(client);

      const changesAfter = (
        await client.query(
          `SELECT id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot FROM booking_changes ORDER BY applied_revision`,
        )
      ).rows;

      const workAfter = (
        await client.query(
          `SELECT id,booking_id,booking_revision,change_id,kind,channel,status,recipient FROM notification_work ORDER BY booking_revision, kind`,
        )
      ).rows;

      const attemptsAfter = (
        await client.query(
          `SELECT id, work_id, budget_day, outcome FROM notification_attempts ORDER BY id`,
        )
      ).rows;

      expect(changesAfter).toEqual(changesBefore);
      expect(workAfter).toEqual(workBefore);
      expect(attemptsAfter).toEqual(attemptsBefore);
    } finally {
      await closeSchema(database.pool, fixture);
    }
  });

  it("retrospective: actual pre-0012 constraints reject owner restore and restoration work, then 0012 permits them while actor restrictions remain", async () => {
    const fixture = await isolatedSchema(database.pool);
    const { client } = fixture;
    const ownerId = randomUUID();
    const bookingId = randomUUID();
    const otherBookingId = randomUUID();
    const baselineMoveChangeId = randomUUID();
    const restoreChangeId = randomUUID();

    try {
      await applyBaseline(client);
      await seedBase(client, ownerId);
      await insertBooking(client, {
        id: bookingId,
        startAt: "2026-11-02T10:00Z",
        endAt: "2026-11-02T10:30Z",
        capabilityHash: "cap-a",
        revision: 1,
      });
      await insertBooking(client, {
        id: otherBookingId,
        startAt: "2026-11-02T11:00Z",
        endAt: "2026-11-02T11:30Z",
        capabilityHash: "cap-b",
        revision: 0,
      });

      // Insert an established baseline change for notification work linkage
      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'owner','move',1,'baseline-move-key','digest','{}'::jsonb,'{}'::jsonb)`,
        [baselineMoveChangeId, bookingId, ownerId],
      );

      // --- Retrospective pre-0012 constraint checks on baseline schema ---
      // 1. Pre-0012 booking_changes_kind_check rejects owner restore
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'owner','restore',2,'pre-0012-restore-key','digest','{}'::jsonb,'{}'::jsonb)`,
          [restoreChangeId, bookingId, ownerId],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "booking_changes_kind_check",
      });

      // 2. Pre-0012 notification_work constraints reject customer_restoration work
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status,recipient) VALUES ($1,$2,1,$3,'customer_restoration','email','not_attempted','ada@example.test')`,
          [randomUUID(), bookingId, baselineMoveChangeId],
        ),
      ).rejects.toMatchObject({
        code: "23514",
      });

      // --- Apply 0012 migration ---
      await applyOwnerRestoration(client);

      // --- Post-0012 verification ---
      // 1. Owner restore now succeeds
      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'owner','restore',2,'restore-op-key','restore-digest','{}'::jsonb,'{}'::jsonb)`,
        [restoreChangeId, bookingId, ownerId],
      );

      const restoreRow = (
        await client.query(
          `SELECT id, actor_type, actor_id, kind, applied_revision FROM booking_changes WHERE id=$1`,
          [restoreChangeId],
        )
      ).rows;
      expect(restoreRow).toEqual([
        {
          id: restoreChangeId,
          actor_type: "owner",
          actor_id: ownerId,
          kind: "restore",
          applied_revision: 2,
        },
      ]);

      // 2. Customer restoration email work succeeds
      const restorationEmailWorkId = randomUUID();
      await client.query(
        `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status,recipient) VALUES ($1,$2,2,$3,'customer_restoration','email','not_attempted','ada@example.test')`,
        [restorationEmailWorkId, bookingId, restoreChangeId],
      );

      // 3. Customer restoration whatsapp work succeeds (status unavailable)
      const restorationWhatsappWorkId = randomUUID();
      await client.query(
        `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status,recipient) VALUES ($1,$2,2,$3,'customer_restoration','whatsapp','unavailable','+15550100')`,
        [restorationWhatsappWorkId, bookingId, restoreChangeId],
      );

      const workRows = (
        await client.query(
          `SELECT id, kind, channel, status, booking_revision, change_id FROM notification_work WHERE change_id=$1 ORDER BY channel`,
          [restoreChangeId],
        )
      ).rows;
      expect(workRows).toEqual([
        {
          id: restorationEmailWorkId,
          kind: "customer_restoration",
          channel: "email",
          status: "not_attempted",
          booking_revision: 2,
          change_id: restoreChangeId,
        },
        {
          id: restorationWhatsappWorkId,
          kind: "customer_restoration",
          channel: "whatsapp",
          status: "unavailable",
          booking_revision: 2,
          change_id: restoreChangeId,
        },
      ]);

      // 4. Customer restore rejects
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,NULL,'customer','restore',3,'cust-restore-key','digest','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), bookingId],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      // 5. Customer restore with non-null actor ID rejects
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'customer','restore',3,'cust-restore-key-2','digest','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), bookingId, ownerId],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      // 6. Owner restore with null actor ID rejects
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,NULL,'owner','restore',3,'null-owner-key','digest','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), bookingId],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      // 7. Unknown kind rejects
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'owner','reschedule',3,'unknown-kind-key','digest','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), bookingId, ownerId],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      // 8. Wrong event/booking FK rejects (notification_work change_id points to a change for a different booking)
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status,recipient) VALUES ($1,$2,1,$3,'customer_restoration','email','not_attempted','ada@example.test')`,
          [randomUUID(), otherBookingId, restoreChangeId],
        ),
      ).rejects.toMatchObject({ code: "23503" });

      // 9. Duplicate operation key rejects
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'owner','restore',3,'restore-op-key','different-digest','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), bookingId, ownerId],
        ),
      ).rejects.toMatchObject({ code: "23505" });

      // 10. Duplicate revision rejects
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'owner','restore',2,'another-key','another-digest','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), bookingId, ownerId],
        ),
      ).rejects.toMatchObject({ code: "23505" });

      // 11. Duplicate channel work rejects
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status,recipient) VALUES ($1,$2,2,$3,'customer_restoration','email','not_attempted','ada@example.test')`,
          [randomUUID(), bookingId, restoreChangeId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await closeSchema(database.pool, fixture);
    }
  });
});
