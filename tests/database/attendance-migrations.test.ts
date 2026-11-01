import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../db/migrate.mts";
import { openTestDatabase } from "../support/database";
import { readAppliedMigrations } from "../support/migration-ledger";

const baselineMigrations = [
  "0005_public_bookings.sql",
  "0007_email_notifications.sql",
  "0008_owner_manual_appointments.sql",
  "0009_owner_booking_changes.sql",
  "0010_customer_cancellation.sql",
  "0011_customer_replacement.sql",
  "0012_owner_restoration.sql",
];

async function isolatedSchema(pool: Pool) {
  const schema = `attendance_${randomUUID().replaceAll("-", "")}`;
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

async function insertBooking(
  client: PoolClient,
  id: string,
  capability: string,
) {
  await client.query(
    `INSERT INTO bookings (id,shop_id,service_id,barber_id,start_at,end_at,service_name,service_price_usd,service_duration_minutes,barber_name,customer_name,customer_email,whatsapp_opt_in,capability_hash,capability_ciphertext,capability_key_id,recovery_key_hash,recovery_payload_digest,creation_source) VALUES ($1,'shop-a','service-a','barber-a','2026-11-02T10:00Z','2026-11-02T10:30Z','Saved Cut',25,30,'Saved Barber','Ada','ada@example.test',false,$2,'encrypted','test-v1',$2,'digest','public')`,
    [id, capability],
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

describe("attendance migration", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(async () => {
    await database?.pool.end();
  });

  it("preserves existing data and integrity while allowing owner attendance only", async () => {
    const fixture = await isolatedSchema(database.pool);
    const { client } = fixture;
    const ownerId = randomUUID();
    const confirmedId = randomUUID();
    const cancelledId = randomUUID();
    const oldChangeIds = [randomUUID(), randomUUID(), randomUUID()];

    try {
      await applyBaseline(client);
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
      await insertBooking(client, confirmedId, "cap-confirmed");
      await client.query(
        `UPDATE bookings SET status='cancelled', revision=1 WHERE id=$1`,
        [confirmedId],
      );
      await insertBooking(client, cancelledId, "cap-cancelled");
      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES
         ($1,'shop-a',$2::uuid,$3,'owner','move',1,'move-key','move-digest','{}'::jsonb,'{}'::jsonb),
         ($4,'shop-a',$2::uuid,NULL,'customer','cancel',2,'customer-cancel-key','customer-cancel-digest','{}'::jsonb,'{}'::jsonb),
         ($5,'shop-a',$6::uuid,$3,'owner','restore',1,'restore-key','restore-digest','{}'::jsonb,'{}'::jsonb)`,
        [
          oldChangeIds[0],
          confirmedId,
          ownerId,
          oldChangeIds[1],
          oldChangeIds[2],
          cancelledId,
        ],
      );
      const bookingsBefore = (
        await client.query(
          `SELECT id,status,revision FROM bookings ORDER BY id`,
        )
      ).rows;
      const changesBefore = (
        await client.query(
          `SELECT id,booking_id,actor_id,actor_type,kind,applied_revision FROM booking_changes ORDER BY id`,
        )
      ).rows;

      await client.query(
        await readFile("db/migrations/0013_attendance.sql", "utf8"),
      );

      expect(
        (
          await client.query(
            `SELECT id,status,revision FROM bookings ORDER BY id`,
          )
        ).rows,
      ).toEqual(bookingsBefore);
      expect(
        (
          await client.query(
            `SELECT id,booking_id,actor_id,actor_type,kind,applied_revision FROM booking_changes ORDER BY id`,
          )
        ).rows,
      ).toEqual(changesBefore);

      await client.query(
        `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'owner','attendance',3,'attendance-key','attendance-digest','{}'::jsonb,'{}'::jsonb)`,
        [randomUUID(), confirmedId, ownerId],
      );
      await client.query(
        `UPDATE bookings SET status='completed',revision=3 WHERE id=$1`,
        [confirmedId],
      );
      await client.query(
        `UPDATE bookings SET status='no_show',revision=2 WHERE id=$1`,
        [cancelledId],
      );

      for (const [sql, values, constraint] of [
        [
          "UPDATE bookings SET status='unknown' WHERE id=$1",
          [confirmedId],
          "bookings_status_check",
        ],
        [
          "UPDATE bookings SET status='cancelled-ish' WHERE id=$1",
          [confirmedId],
          "bookings_status_check",
        ],
        [
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'owner','unknown',3,'unknown-key','unknown-digest','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), confirmedId, ownerId],
          "booking_changes_kind_check",
        ],
        [
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,'customer','attendance',3,'customer-attendance-key','customer-attendance-digest','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), confirmedId],
          "booking_changes_actor_check",
        ],
      ] as Array<[string, string[], string]>) {
        await expect(client.query(sql, values)).rejects.toMatchObject({
          code: "23514",
          constraint,
        });
      }

      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'owner','attendance',2,'duplicate-revision-key','duplicate-revision','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), confirmedId, ownerId],
        ),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "booking_changes_booking_revision_key",
      });

      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'owner','attendance',4,'attendance-key','duplicate-operation','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), confirmedId, ownerId],
        ),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "booking_changes_shop_operation_key_key",
      });

      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'shop-a',$2,$3,'owner','attendance',3,'foreign-booking-key','foreign-booking','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), randomUUID(), ownerId],
        ),
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "booking_changes_shop_booking_fkey",
      });

      await expect(
        client.query(
          `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,actor_type,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot) VALUES ($1,'missing-shop',$2,$3,'owner','attendance',2,'foreign-shop-key','foreign-shop','{}'::jsonb,'{}'::jsonb)`,
          [randomUUID(), cancelledId, ownerId],
        ),
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "booking_changes_shop_id_fkey",
      });
    } finally {
      await closeSchema(database.pool, fixture);
    }
  });

  it("applies 0013 once through the runner and preserves attendance data on rerun", async () => {
    const schema = `attendance_runner_${randomUUID().replaceAll("-", "")}`;
    const migrationFolder = await mkdtemp(
      join(tmpdir(), "trimtime-attendance-migrations-"),
    );
    const runnerPool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema},public`,
      max: 1,
    });
    const ids = {
      confirmed: randomUUID(),
      cancelled: randomUUID(),
      attendanceChange: randomUUID(),
    };

    try {
      await database.pool.query(`CREATE SCHEMA ${schema}`);
      await runnerPool.query(`
        CREATE TABLE bookings (
          id uuid PRIMARY KEY,
          status text NOT NULL CONSTRAINT bookings_status_check
            CHECK (status IN ('confirmed', 'cancelled'))
        );
        CREATE TABLE booking_changes (
          id uuid PRIMARY KEY,
          booking_id uuid NOT NULL REFERENCES bookings(id),
          kind text NOT NULL CONSTRAINT booking_changes_kind_check
            CHECK (kind IN ('move', 'cancel', 'restore'))
        );
      `);
      await runnerPool.query(
        `INSERT INTO bookings (id,status) VALUES ($1,'confirmed'),($2,'cancelled')`,
        [ids.confirmed, ids.cancelled],
      );
      await runnerPool.query(
        `INSERT INTO booking_changes (id,booking_id,kind) VALUES ($1,$2,'move')`,
        [randomUUID(), ids.confirmed],
      );

      await mkdir(join(migrationFolder, "meta"));
      await writeFile(
        join(migrationFolder, "0013_attendance.sql"),
        await readFile("db/migrations/0013_attendance.sql", "utf8"),
      );
      await writeFile(
        join(migrationFolder, "meta", "_journal.json"),
        JSON.stringify({
          version: "7",
          dialect: "postgresql",
          entries: [
            {
              idx: 0,
              version: "7",
              when: 1793404800000,
              tag: "0013_attendance",
              breakpoints: true,
            },
          ],
        }),
      );

      const ledgerSchema = schema;
      await applyMigrations(runnerPool, migrationFolder, ledgerSchema);

      const bookingsBeforeRerun = (
        await runnerPool.query("SELECT id,status FROM bookings ORDER BY id")
      ).rows;
      const changeBeforeRerun = (
        await runnerPool.query(
          "SELECT id,booking_id,kind FROM booking_changes ORDER BY id",
        )
      ).rows;
      expect(bookingsBeforeRerun).toEqual(
        [
          { id: ids.confirmed, status: "confirmed" },
          { id: ids.cancelled, status: "cancelled" },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      );
      await runnerPool.query(
        "UPDATE bookings SET status='completed' WHERE id=$1",
        [ids.confirmed],
      );
      await runnerPool.query(
        `INSERT INTO booking_changes (id,booking_id,kind) VALUES ($1,$2,'attendance')`,
        [ids.attendanceChange, ids.confirmed],
      );

      // This equivalent sentinel form makes a second application observable:
      // 0013 would replace the definitions with its original forms.
      await runnerPool.query(`
        ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
        ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
          CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show') AND id IS NOT NULL);
        ALTER TABLE booking_changes DROP CONSTRAINT booking_changes_kind_check;
        ALTER TABLE booking_changes ADD CONSTRAINT booking_changes_kind_check
          CHECK (kind IN ('move', 'cancel', 'restore', 'attendance') AND id IS NOT NULL);
      `);
      const constraintsBeforeRerun = (
        await runnerPool.query(
          `SELECT conname, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
           WHERE connamespace = $1::regnamespace
             AND conname IN ('bookings_status_check','booking_changes_kind_check')
           ORDER BY conname`,
          [schema],
        )
      ).rows;
      const ledgerBeforeRerun = await readAppliedMigrations(
        runnerPool,
        ledgerSchema,
      );
      expect(ledgerBeforeRerun).toHaveLength(1);
      expect(ledgerBeforeRerun[0]?.hash).toBe(
        createHash("sha256")
          .update(await readFile("db/migrations/0013_attendance.sql"))
          .digest("hex"),
      );

      await applyMigrations(runnerPool, migrationFolder, ledgerSchema);

      expect(
        (await runnerPool.query("SELECT id,status FROM bookings ORDER BY id"))
          .rows,
      ).toEqual(
        [
          { id: ids.confirmed, status: "completed" },
          { id: ids.cancelled, status: "cancelled" },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      );
      expect(
        (
          await runnerPool.query(
            "SELECT id,booking_id,kind FROM booking_changes ORDER BY id",
          )
        ).rows,
      ).toEqual(
        [
          ...changeBeforeRerun,
          {
            id: ids.attendanceChange,
            booking_id: ids.confirmed,
            kind: "attendance",
          },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      );
      expect(
        (
          await runnerPool.query(
            `SELECT conname, pg_get_constraintdef(oid) AS definition
             FROM pg_constraint
             WHERE connamespace = $1::regnamespace
               AND conname IN ('bookings_status_check','booking_changes_kind_check')
             ORDER BY conname`,
            [schema],
          )
        ).rows,
      ).toEqual(constraintsBeforeRerun);
      expect(await readAppliedMigrations(runnerPool, ledgerSchema)).toEqual(
        ledgerBeforeRerun,
      );
    } finally {
      await runnerPool.end();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await rm(migrationFolder, { recursive: true, force: true });
    }
  });
});
