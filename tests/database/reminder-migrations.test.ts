import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../db/migrate.mts";
import { openTestDatabase } from "../support/database";

const migrationsFolder = "db/migrations";
const journalPath = join(migrationsFolder, "meta/_journal.json");
const priorMigration = "0015_notification_recovery";

type Journal = {
  version: string;
  dialect: string;
  entries: Array<{ idx: number; tag: string; [key: string]: unknown }>;
};

async function createMigrationFixture(databasePool: Pool) {
  const schema = `reminder_${randomUUID().replaceAll("-", "")}`;
  await databasePool.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${schema},public`,
    max: 1,
  });
  return { schema, pool };
}

async function prepareMigrations(
  directory: string,
  schema: string,
  journal: Journal,
) {
  await mkdir(join(directory, "meta"), { recursive: true });
  for (const { tag } of journal.entries) {
    let sql = await readFile(join(migrationsFolder, `${tag}.sql`), "utf8");
    if (tag === "0002_catalog_barbers")
      sql = sql.replaceAll('"public".', `"${schema}".`);
    await writeFile(join(directory, `${tag}.sql`), sql);
  }
  await writeFile(
    join(directory, "meta/_journal.json"),
    JSON.stringify(journal),
  );
}

async function seedBooking(pool: Pool, bookingId: string) {
  const ownerId = randomUUID();
  await pool.query(
    `INSERT INTO "user" (id,name,email) VALUES ($1,'Reminder Fixture Owner',$2)`,
    [ownerId, `${ownerId}@example.test`],
  );
  await pool.query(
    `INSERT INTO shops (id,owner_id,name,subdomain,time_zone,public_contact,address)
     VALUES ('reminder-shop',$1,'Reminder Fixture Shop','reminder-fixture','UTC','owner@example.test','Fixture Address')`,
    [ownerId],
  );
  await pool.query(
    `INSERT INTO services (id,shop_id,name,price_usd,duration_minutes)
     VALUES ('reminder-service','reminder-shop','Saved Cut',25,30)`,
  );
  await pool.query(
    `INSERT INTO barbers (id,shop_id,name)
     VALUES ('reminder-barber','reminder-shop','Saved Barber')`,
  );
  await pool.query(
    `INSERT INTO bookings (
       id,shop_id,service_id,barber_id,status,start_at,end_at,service_name,
       service_price_usd,service_duration_minutes,barber_name,customer_name,
       customer_email,whatsapp_opt_in,capability_hash,capability_ciphertext,
       capability_key_id,recovery_key_hash,recovery_payload_digest,revision
     ) VALUES (
       $1,'reminder-shop','reminder-service','reminder-barber','confirmed',
       '2026-11-05T12:00:00.000Z','2026-11-05T12:30:00.000Z','Saved Cut',
       25,30,'Saved Barber','Ada','ada@example.test',false,'fixture-capability',
       'encrypted-fixture','test-v1','fixture-capability','fixture-digest',0
     )`,
    [bookingId],
  );
  return ownerId;
}

async function insertAdditionalBooking(pool: Pool, bookingId: string) {
  await pool.query(
    `INSERT INTO bookings (
       id,shop_id,service_id,barber_id,status,start_at,end_at,service_name,
       service_price_usd,service_duration_minutes,barber_name,customer_name,
       customer_email,whatsapp_opt_in,capability_hash,capability_ciphertext,
       capability_key_id,recovery_key_hash,recovery_payload_digest,revision
     ) VALUES (
       $1,'reminder-shop','reminder-service','reminder-barber','confirmed',
       '2026-11-06T12:00:00.000Z','2026-11-06T12:30:00.000Z','Saved Cut',
       25,30,'Saved Barber','Bea','bea@example.test',false,'second-capability',
       'encrypted-second','test-v1','second-capability','second-digest',0
     )`,
    [bookingId],
  );
}

async function schemaThrough0015(databasePool: Pool) {
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  const previousIndex = journal.entries.findIndex(
    ({ tag }) => tag === priorMigration,
  );
  if (previousIndex < 0) throw new Error(`Missing migration ${priorMigration}`);
  const previousJournal: Journal = {
    ...journal,
    entries: journal.entries.slice(0, previousIndex + 1),
  };
  const fixture = await createMigrationFixture(databasePool);
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "trimtime-reminders-"),
  );
  const repositoryMigrations = join(temporaryDirectory, "through-0015");
  try {
    await prepareMigrations(
      repositoryMigrations,
      fixture.schema,
      previousJournal,
    );
    await applyMigrations(fixture.pool, repositoryMigrations, fixture.schema);
    return { ...fixture, temporaryDirectory, journal };
  } catch (error) {
    await fixture.pool.end();
    await databasePool.query(`DROP SCHEMA ${fixture.schema} CASCADE`);
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function applyCurrentMigrations(
  fixture: Awaited<ReturnType<typeof schemaThrough0015>>,
) {
  const currentDirectory = join(fixture.temporaryDirectory, "current");
  await prepareMigrations(currentDirectory, fixture.schema, fixture.journal);
  await applyMigrations(fixture.pool, currentDirectory, fixture.schema);
}

async function insertBookingChange(
  pool: Pool,
  values: { id: string; bookingId: string; ownerId: string },
) {
  await pool.query(
    `INSERT INTO booking_changes (
       id,shop_id,booking_id,actor_id,kind,applied_revision,
       operation_key_hash,payload_digest,before_snapshot,after_snapshot
     ) VALUES ($1,'reminder-shop',$2,$3,'move',1,$4,$5,
       '{}'::jsonb,'{}'::jsonb)`,
    [
      values.id,
      values.bookingId,
      values.ownerId,
      `reminder-move-key-${values.id}`,
      `reminder-move-digest-${values.id}`,
    ],
  );
}

describe("schedule reminders migration", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(async () => {
    await database?.pool.end();
  });

  it("accepts a creation reminder for a booking generation", async () => {
    const fixture = await schemaThrough0015(database.pool);
    const bookingId = randomUUID();
    try {
      await seedBooking(fixture.pool, bookingId);
      await applyCurrentMigrations(fixture);
      const dueAt = new Date("2026-11-04T12:00:00.000Z");
      await fixture.pool.query(
        `INSERT INTO notification_work (
           id,booking_id,booking_revision,change_id,kind,channel,status,due_at
         ) VALUES ($1,$2,0,NULL,'customer_reminder','email','not_attempted',$3)`,
        [randomUUID(), bookingId, dueAt],
      );
      const persisted = await fixture.pool.query(
        `SELECT due_at FROM notification_work
         WHERE booking_id=$1 AND kind='customer_reminder'`,
        [bookingId],
      );
      expect(persisted.rows).toEqual([{ due_at: dueAt }]);
    } finally {
      await fixture.pool.end();
      await database.pool.query(`DROP SCHEMA ${fixture.schema} CASCADE`);
      await rm(fixture.temporaryDirectory, { recursive: true, force: true });
    }
  }, 60_000);

  it("enforces reminder linkage and due time while preserving legacy work", async () => {
    const fixture = await schemaThrough0015(database.pool);
    const bookingId = randomUUID();
    const otherBookingId = randomUUID();
    const changeId = randomUUID();
    const otherChangeId = randomUUID();
    try {
      const ownerId = await seedBooking(fixture.pool, bookingId);
      await insertAdditionalBooking(fixture.pool, otherBookingId);
      await applyCurrentMigrations(fixture);
      await insertBookingChange(fixture.pool, {
        id: changeId,
        bookingId,
        ownerId,
      });
      await insertBookingChange(fixture.pool, {
        id: otherChangeId,
        bookingId: otherBookingId,
        ownerId,
      });

      const creationWorkId = randomUUID();
      const linkedWorkId = randomUUID();
      const dueAt = new Date("2026-11-04T12:00:00.000Z");
      await fixture.pool.query(
        `INSERT INTO notification_work (
           id,booking_id,booking_revision,change_id,kind,channel,status,due_at
         ) VALUES ($1,$3,0,NULL,'customer_reminder','email','not_attempted',$5),
                  ($2,$3,1,$4,'customer_reminder','email','not_attempted',$5)`,
        [creationWorkId, linkedWorkId, bookingId, changeId, dueAt],
      );
      await fixture.pool.query(
        `INSERT INTO notification_work (
           id,booking_id,kind,channel,status
         ) VALUES ($1,$2,'customer_confirmation','email','not_attempted')`,
        [randomUUID(), bookingId],
      );

      await expect(
        fixture.pool.query(
          `INSERT INTO notification_work (
             id,booking_id,booking_revision,change_id,kind,channel,status,due_at
           ) VALUES ($1,$2,0,$3,'customer_reminder','email','not_attempted',$4)`,
          [randomUUID(), bookingId, changeId, dueAt],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        fixture.pool.query(
          `INSERT INTO notification_work (
             id,booking_id,booking_revision,change_id,kind,channel,status,due_at
           ) VALUES ($1,$2,2,$3,'customer_reminder','email','not_attempted',$4)`,
          [randomUUID(), bookingId, otherChangeId, dueAt],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        fixture.pool.query(
          `INSERT INTO notification_work (
             id,booking_id,booking_revision,kind,channel,status,due_at
           ) VALUES ($1,$2,1,'customer_reminder','email','not_attempted',$3)`,
          [randomUUID(), bookingId, dueAt],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        fixture.pool.query(
          `INSERT INTO notification_work (
             id,booking_id,kind,channel,status
           ) VALUES ($1,$2,'customer_reminder','email','not_attempted')`,
          [randomUUID(), bookingId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        fixture.pool.query(
          `INSERT INTO notification_work (
             id,booking_id,kind,channel,status,due_at
           ) VALUES ($1,$2,'customer_confirmation','email','not_attempted',$3)`,
          [randomUUID(), bookingId, dueAt],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        fixture.pool.query(
          `INSERT INTO notification_work (
             id,booking_id,booking_revision,change_id,kind,channel,status,due_at
           ) VALUES ($1,$2,0,NULL,'customer_reminder','email','not_attempted',$3)`,
          [randomUUID(), bookingId, dueAt],
        ),
      ).rejects.toMatchObject({ code: "23505" });

      await fixture.pool.query(`DELETE FROM booking_changes WHERE id=$1`, [
        changeId,
      ]);
      const afterChangeDelete = await fixture.pool.query(
        `SELECT id FROM notification_work WHERE id=$1`,
        [linkedWorkId],
      );
      expect(afterChangeDelete.rows).toEqual([]);

      await fixture.pool.query(`DELETE FROM bookings WHERE id=$1`, [bookingId]);
      const afterBookingDelete = await fixture.pool.query(
        `SELECT id FROM notification_work WHERE booking_id=$1`,
        [bookingId],
      );
      expect(afterBookingDelete.rows).toEqual([]);
    } finally {
      await fixture.pool.end();
      await database.pool.query(`DROP SCHEMA ${fixture.schema} CASCADE`);
      await rm(fixture.temporaryDirectory, { recursive: true, force: true });
    }
  }, 60_000);

  it("replays the complete migration chain from zero in an isolated schema", async () => {
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
    const fixture = await createMigrationFixture(database.pool);
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "trimtime-reminder-from-zero-"),
    );
    const repositoryMigrations = join(temporaryDirectory, "repository");
    try {
      await prepareMigrations(repositoryMigrations, fixture.schema, journal);
      await applyMigrations(fixture.pool, repositoryMigrations, fixture.schema);
      const ledger = await fixture.pool.query(
        `SELECT hash FROM ${fixture.schema}.__drizzle_migrations ORDER BY created_at`,
      );
      expect(ledger.rows).toHaveLength(journal.entries.length);
      const columns = await fixture.pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema=$1 AND table_name='notification_work'
           AND column_name='due_at'`,
        [fixture.schema],
      );
      expect(columns.rows).toEqual([{ column_name: "due_at" }]);
      const indexes = await fixture.pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname=$1
           AND indexname='notification_work_customer_reminder_due_idx'`,
        [fixture.schema],
      );
      expect(indexes.rows).toEqual([
        { indexname: "notification_work_customer_reminder_due_idx" },
      ]);
    } finally {
      await fixture.pool.end();
      await database.pool.query(`DROP SCHEMA ${fixture.schema} CASCADE`);
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 60_000);
});
