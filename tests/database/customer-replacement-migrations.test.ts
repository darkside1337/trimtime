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
];

async function isolatedSchema(pool: Pool) {
  const schema = `phase11_${randomUUID().replaceAll("-", "")}`;
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

async function applyCustomerReplacement(client: PoolClient) {
  await client.query(
    await readFile("db/migrations/0011_customer_replacement.sql", "utf8"),
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
  },
) {
  await client.query(
    `INSERT INTO bookings (id,shop_id,service_id,barber_id,start_at,end_at,service_name,service_price_usd,service_duration_minutes,barber_name,customer_name,customer_email,whatsapp_opt_in,capability_hash,capability_ciphertext,capability_key_id,recovery_key_hash,recovery_payload_digest,creation_source) VALUES ($1,'shop-a','service-a','barber-a',$2,$3,'Saved Cut',25,30,'Saved Barber','Ada','ada@example.test',false,$4,'encrypted-a','test-v1',$4,'digest-a','public')`,
    [values.id, values.startAt, values.endAt, values.capabilityHash],
  );
}

describe("customer replacement migration", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(async () => {
    await database?.pool.end();
  });

  it("preserves existing owner changes and customer cancellations", async () => {
    const fixture = await isolatedSchema(database.pool);
    const { client } = fixture;
    const ownerId = randomUUID();
    const bookingId = randomUUID();
    const ownerMoveChangeId = randomUUID();
    const customerCancelChangeId = randomUUID();
    try {
      await applyBaseline(client);
      await seedBase(client, ownerId);
      await insertBooking(client, {
        id: bookingId,
        startAt: "2026-11-02T10:00Z",
        endAt: "2026-11-02T10:30Z",
        capabilityHash: "cap-a",
      });

      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'owner','move',1,'owner-key','owner-digest','{}'::jsonb,'{}'::jsonb)`,
        [ownerMoveChangeId, bookingId, ownerId],
      );
      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,NULL,'customer','cancel',2,'cancel-key','cancel-digest','{}'::jsonb,'{}'::jsonb)`,
        [customerCancelChangeId, bookingId],
      );

      const changesBefore = (
        await client.query(
          `SELECT id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot FROM booking_changes ORDER BY applied_revision`,
        )
      ).rows;

      await applyCustomerReplacement(client);

      const changesAfter = (
        await client.query(
          `SELECT id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot FROM booking_changes ORDER BY applied_revision`,
        )
      ).rows;

      expect(changesAfter).toEqual(changesBefore);
    } finally {
      await closeSchema(database.pool, fixture);
    }
  });

  it("permits customer actor with null actor ID for kind move and preserves owner restrictions", async () => {
    const fixture = await isolatedSchema(database.pool);
    const { client } = fixture;
    const ownerId = randomUUID();
    const bookingId = randomUUID();
    const customerMoveChangeId = randomUUID();
    try {
      await applyBaseline(client);
      await applyCustomerReplacement(client);
      await seedBase(client, ownerId);
      await insertBooking(client, {
        id: bookingId,
        startAt: "2026-11-02T10:00Z",
        endAt: "2026-11-02T10:30Z",
        capabilityHash: "cap-a",
      });

      // Customer move with null actor ID succeeds
      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,NULL,'customer','move',1,'customer-move-key','customer-digest','{}'::jsonb,'{}'::jsonb)`,
        [customerMoveChangeId, bookingId],
      );

      const actors = (
        await client.query(
          `SELECT actor_id,actor_type,kind FROM booking_changes WHERE id=$1`,
          [customerMoveChangeId],
        )
      ).rows;
      expect(actors).toEqual([
        { actor_id: null, actor_type: "customer", kind: "move" },
      ]);

      // Customer move with non-null actor ID rejects
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'customer','move',2,'invalid-key-1','digest','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), bookingId, ownerId],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      // Customer cancel with non-null actor ID rejects
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'customer','cancel',3,'invalid-key-2','digest','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), bookingId, ownerId],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      // Owner move with null actor ID rejects
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,NULL,'owner','move',4,'invalid-key-3','digest','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), bookingId],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      // Owner cancel with null actor ID rejects
      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,NULL,'owner','cancel',5,'invalid-key-4','digest','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), bookingId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await closeSchema(database.pool, fixture);
    }
  });

  it("preserves existing notification work and permits owner_move with change linkage", async () => {
    const fixture = await isolatedSchema(database.pool);
    const { client } = fixture;
    const ownerId = randomUUID();
    const bookingId = randomUUID();
    const moveChangeId = randomUUID();
    const cancelChangeId = randomUUID();
    try {
      await applyBaseline(client);
      await seedBase(client, ownerId);
      await insertBooking(client, {
        id: bookingId,
        startAt: "2026-11-02T10:00Z",
        endAt: "2026-11-02T10:30Z",
        capabilityHash: "cap-a",
      });

      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'owner','move',1,'move-key','move-digest','{}'::jsonb,'{}'::jsonb)`,
        [moveChangeId, bookingId, ownerId],
      );
      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,NULL,'customer','cancel',2,'cancel-key','cancel-digest','{}'::jsonb,'{}'::jsonb)`,
        [cancelChangeId, bookingId],
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
          changeId: moveChangeId,
          kind: "customer_move",
          channel: "email",
          status: "not_attempted",
          recipient: "ada@example.test",
        },
        {
          id: randomUUID(),
          bookingId,
          revision: 2,
          changeId: cancelChangeId,
          kind: "customer_cancellation",
          channel: "email",
          status: "not_attempted",
          recipient: "ada@example.test",
        },
        {
          id: randomUUID(),
          bookingId,
          revision: 2,
          changeId: cancelChangeId,
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

      const workBefore = (
        await client.query(
          `SELECT id,booking_id,booking_revision,change_id,kind,channel,status,recipient FROM notification_work ORDER BY booking_revision, kind`,
        )
      ).rows;

      await applyCustomerReplacement(client);

      const workAfter = (
        await client.query(
          `SELECT id,booking_id,booking_revision,change_id,kind,channel,status,recipient FROM notification_work ORDER BY booking_revision, kind`,
        )
      ).rows;

      expect(workAfter).toEqual(workBefore);

      // owner_move with revision > 0, change_id not null, channel email succeeds
      const ownerMoveWorkId = randomUUID();
      await client.query(
        `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status,recipient) VALUES ($1,$2,1,$3,'owner_move','email','not_attempted','owner@example.test')`,
        [ownerMoveWorkId, bookingId, moveChangeId],
      );

      const inserted = (
        await client.query(
          `SELECT id,kind,channel,status,booking_revision FROM notification_work WHERE id=$1`,
          [ownerMoveWorkId],
        )
      ).rows;
      expect(inserted).toEqual([
        {
          id: ownerMoveWorkId,
          kind: "owner_move",
          channel: "email",
          status: "not_attempted",
          booking_revision: 1,
        },
      ]);

      // owner_move with revision 0 rejects
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status,recipient) VALUES ($1,$2,0,$3,'owner_move','email','not_attempted','owner@example.test')`,
          [randomUUID(), bookingId, moveChangeId],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      // owner_move with change_id NULL rejects
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status,recipient) VALUES ($1,$2,1,NULL,'owner_move','email','not_attempted','owner@example.test')`,
          [randomUUID(), bookingId],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      // owner_move with channel whatsapp rejects
      await expect(
        client.query(
          `INSERT INTO notification_work (id,booking_id,booking_revision,change_id,kind,channel,status,recipient) VALUES ($1,$2,1,$3,'owner_move','whatsapp','unavailable','+15550100')`,
          [randomUUID(), bookingId, moveChangeId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await closeSchema(database.pool, fixture);
    }
  });
});
