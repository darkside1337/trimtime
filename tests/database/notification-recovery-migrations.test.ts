import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../db/migrate.mts";
import { openTestDatabase } from "../support/database";

const migrationsDirectory = "db/migrations";
const journalPath = join(migrationsDirectory, "meta/_journal.json");
const recoveryMigration = "0015_notification_recovery";
const budgetDay = "2026-11-02";
const failureAt = new Date("2026-11-02T08:00:00.000Z");

type Journal = {
  version: string;
  dialect: string;
  entries: Array<{ idx: number; tag: string; [key: string]: unknown }>;
};

type MigrationFixture = {
  schema: string;
  pool: Pool;
};

function freshSchemaName(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

async function createMigrationFixture(
  databasePool: Pool,
  prefix: string,
): Promise<MigrationFixture> {
  const schema = freshSchemaName(prefix);
  await databasePool.query(`CREATE SCHEMA ${schema}`);
  try {
    return {
      schema,
      pool: new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        options: `-c search_path=${schema},public`,
        max: 1,
      }),
    };
  } catch (error) {
    await databasePool.query(`DROP SCHEMA ${schema} CASCADE`);
    throw error;
  }
}

async function createMigrationFixtures(
  databasePool: Pool,
  createFixture = createMigrationFixture,
) {
  const created: MigrationFixture[] = [];
  try {
    created.push(await createFixture(databasePool, "notification_upgrade"));
    created.push(await createFixture(databasePool, "notification_zero"));
    return { upgrade: created[0], fromZero: created[1] };
  } catch (error) {
    for (const fixture of created) {
      await fixture.pool.end();
      await databasePool.query(`DROP SCHEMA ${fixture.schema} CASCADE`);
    }
    throw error;
  }
}

async function prepareRepositoryMigrations(
  directory: string,
  schema: string,
  journal: Journal,
) {
  await mkdir(join(directory, "meta"), { recursive: true });
  for (const { tag } of journal.entries) {
    let sql = await readFile(join(migrationsDirectory, `${tag}.sql`), "utf8");
    // Migration 0002 hard-codes public-qualified references. Point those
    // historical foreign keys at this isolated replay schema.
    if (tag === "0002_catalog_barbers")
      sql = sql.replaceAll('"public".', `"${schema}".`);
    await writeFile(join(directory, `${tag}.sql`), sql);
  }
  await writeFile(
    join(directory, "meta/_journal.json"),
    JSON.stringify(journal),
  );
}

async function insertHistoricalFixtures(client: PoolClient) {
  const ownerId = randomUUID();
  const bookingIds = [randomUUID(), randomUUID()];
  const changeIds = [randomUUID(), randomUUID()];
  const workIds = {
    transient: randomUUID(),
    permanent: randomUUID(),
    whatsapp: randomUUID(),
    captured: randomUUID(),
  };
  const attemptIds = {
    transient: randomUUID(),
    permanent: randomUUID(),
    whatsapp: randomUUID(),
    captured: randomUUID(),
  };

  await client.query(
    `INSERT INTO "user" (id,name,email) VALUES ($1,'Migration Fixture Owner',$2)`,
    [ownerId, `${ownerId}@example.test`],
  );
  await client.query(
    `INSERT INTO shops (id,owner_id,name,subdomain,time_zone,public_contact,address)
     VALUES ('migration-shop',$1,'Migration Fixture Shop','migration-fixture','UTC','owner@example.test','Fixture Address')`,
    [ownerId],
  );
  await client.query(
    `INSERT INTO services (id,shop_id,name,price_usd,duration_minutes)
     VALUES ('migration-service','migration-shop','Saved Cut',25,30)`,
  );
  await client.query(
    `INSERT INTO barbers (id,shop_id,name)
     VALUES ('migration-barber','migration-shop','Saved Barber')`,
  );

  for (const [index, bookingId] of bookingIds.entries()) {
    const revision = index + 1;
    await client.query(
      `INSERT INTO bookings (
         id,shop_id,service_id,barber_id,status,start_at,end_at,service_name,
         service_price_usd,service_duration_minutes,barber_name,customer_name,
         customer_email,whatsapp_opt_in,capability_hash,capability_ciphertext,
         capability_key_id,recovery_key_hash,recovery_payload_digest,revision
       ) VALUES (
         $1,'migration-shop','migration-service','migration-barber',
         '${index === 0 ? "confirmed" : "cancelled"}',
         $2::timestamptz,$3::timestamptz,'Saved Cut',25,30,'Saved Barber','Ada',
         $4,false,$5,'encrypted-fixture','test-v1',$5,'fixture-digest',$6
       )`,
      [
        bookingId,
        `2026-11-03T${String(index + 9).padStart(2, "0")}:00:00.000Z`,
        `2026-11-03T${String(index + 9).padStart(2, "0")}:30:00.000Z`,
        `ada-${index}@example.test`,
        `fixture-capability-${index}`,
        revision,
      ],
    );
    await client.query(
      `INSERT INTO booking_changes (
         id,shop_id,booking_id,actor_id,kind,applied_revision,
         operation_key_hash,payload_digest,before_snapshot,after_snapshot
       ) VALUES (
         $1,'migration-shop',$2,$3,'${index === 0 ? "move" : "cancel"}',
         $4,$5,$6,'{}'::jsonb,'{}'::jsonb
       )`,
      [
        changeIds[index],
        bookingId,
        ownerId,
        revision,
        `fixture-operation-${index}`,
        `fixture-payload-${index}`,
      ],
    );
  }

  await client.query(
    `INSERT INTO outbound_budget (day,allocation_count) VALUES ($1,4)`,
    [budgetDay],
  );
  await client.query(
    `INSERT INTO notification_work (
       id,booking_id,booking_revision,change_id,kind,channel,status,recipient,
       reason,updated_at
     ) VALUES
       ($1,$5,0,NULL,'customer_confirmation','email','failed','ada-0@example.test','transient_rejection',$6),
       ($2,$5,0,NULL,'owner_alert','email','failed','owner@example.test','permanent_rejection',$6),
       ($3,$5,1,$8,'customer_move','whatsapp','failed','+15555550123','transient_rejection',$6),
       ($4,$7,1,$9,'customer_cancellation','email','captured','ada-1@example.test',NULL,$6)`,
    [
      workIds.transient,
      workIds.permanent,
      workIds.whatsapp,
      workIds.captured,
      bookingIds[0],
      failureAt,
      bookingIds[1],
      changeIds[0],
      changeIds[1],
    ],
  );
  await client.query(
    `INSERT INTO notification_attempts (
       id,work_id,budget_day,invoked_at,outcome,capture_id
     ) VALUES
       ($1,$2,$3,$4,'failed',NULL),
       ($5,$6,$3,$4,'failed',NULL),
       ($7,$8,$3,$4,'failed',NULL),
       ($9,$10,$3,$4,'captured','mailpit-capture-fixture')`,
    [
      attemptIds.transient,
      workIds.transient,
      budgetDay,
      failureAt,
      attemptIds.permanent,
      workIds.permanent,
      attemptIds.whatsapp,
      workIds.whatsapp,
      attemptIds.captured,
      workIds.captured,
    ],
  );

  return { bookingIds, changeIds, workIds, attemptIds, ownerId };
}

async function preservedRows(client: PoolClient) {
  const work = await client.query(
    `SELECT id,booking_id,booking_revision,change_id,kind,channel,status,
            recipient,content_identity,reason,created_at,updated_at,
            claimed_at,claim_id
     FROM notification_work ORDER BY id`,
  );
  const attempts = await client.query(
    `SELECT id,work_id,budget_day,reserved_at,invoked_at,outcome,capture_id
     FROM notification_attempts ORDER BY id`,
  );
  const bookings = await client.query(
    `SELECT id,shop_id,service_id,barber_id,status,revision,customer_email,
            capability_hash,recovery_key_hash
     FROM bookings ORDER BY id`,
  );
  const changes = await client.query(
    `SELECT id,shop_id,booking_id,actor_id,kind,applied_revision,
            operation_key_hash,payload_digest,before_snapshot,after_snapshot
     FROM booking_changes ORDER BY id`,
  );
  const budgets = await client.query(
    `SELECT day,allocation_count FROM outbound_budget ORDER BY day`,
  );
  return {
    work: work.rows,
    attempts: attempts.rows,
    bookings: bookings.rows,
    changes: changes.rows,
    budgets: budgets.rows,
  };
}

async function expectRecoveryConstraints(client: PoolClient) {
  const columns = await client.query(
    `SELECT table_name,column_name FROM information_schema.columns
     WHERE table_schema=current_schema()
       AND (table_name,column_name) IN (
         ('notification_attempts','attempt_number'),
         ('notification_attempts','reason'),
         ('notification_attempts','finished_at'),
         ('notification_work','next_attempt_at')
       ) ORDER BY table_name,column_name`,
  );
  expect(columns.rows).toEqual([
    { table_name: "notification_attempts", column_name: "attempt_number" },
    { table_name: "notification_attempts", column_name: "finished_at" },
    { table_name: "notification_attempts", column_name: "reason" },
    { table_name: "notification_work", column_name: "next_attempt_at" },
  ]);

  const index = await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname=current_schema()
       AND indexname='notification_work_next_attempt_at_idx'`,
  );
  expect(index.rows).toHaveLength(1);

  await client.query(
    `INSERT INTO outbound_budget (day,allocation_count) VALUES ($1,0)
     ON CONFLICT (day) DO NOTHING`,
    [budgetDay],
  );
  const seeded = await insertConstraintProbeRows(client);
  for (const attemptNumber of [1, 2, 3]) {
    await client.query(
      `INSERT INTO notification_attempts (id,work_id,budget_day,attempt_number)
       VALUES ($1,$2,$3,$4)`,
      [randomUUID(), seeded.workId, budgetDay, attemptNumber],
    );
  }
  await expect(
    client.query(
      `INSERT INTO notification_attempts (id,work_id,budget_day,attempt_number)
       VALUES ($1,$2,$3,2)`,
      [randomUUID(), seeded.workId, budgetDay],
    ),
  ).rejects.toMatchObject({ code: "23505" });

  for (const attemptNumber of [0, 4]) {
    await expect(
      client.query(
        `INSERT INTO notification_attempts (id,work_id,budget_day,attempt_number)
         VALUES ($1,$2,$3,$4)`,
        [randomUUID(), seeded.workId, budgetDay, attemptNumber],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  }
  await expect(
    client.query(
      `INSERT INTO notification_attempts (id,work_id,budget_day,attempt_number)
       VALUES ($1,$2,$3,1)`,
      [randomUUID(), randomUUID(), budgetDay],
    ),
  ).rejects.toMatchObject({ code: "23503" });
  await expect(
    client.query(
      `INSERT INTO notification_attempts (id,work_id,budget_day,attempt_number)
       VALUES ($1,$2,'2026-12-31',1)`,
      [randomUUID(), seeded.budgetForeignKeyWorkId],
    ),
  ).rejects.toMatchObject({ code: "23503" });
  await expect(
    client.query(
      `INSERT INTO outbound_budget (day,allocation_count) VALUES ('2026-11-03',-1)`,
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    client.query(
      `INSERT INTO outbound_budget (day,allocation_count) VALUES ('2026-11-04',101)`,
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    client.query(
      `INSERT INTO notification_work (
         id,booking_id,booking_revision,kind,channel,status
       ) VALUES ($1,$2,0,'customer_confirmation','email','failed')`,
      [randomUUID(), seeded.bookingId],
    ),
  ).rejects.toMatchObject({ code: "23505" });
}

async function insertConstraintProbeRows(client: PoolClient) {
  const booking = await client.query<{ id: string }>(
    `SELECT booking.id FROM bookings AS booking
     WHERE NOT EXISTS (
       SELECT 1 FROM notification_work AS work
       WHERE work.booking_id=booking.id
         AND work.booking_revision=0
         AND work.kind='customer_confirmation'
         AND work.channel='email'
     )
     ORDER BY booking.id LIMIT 1`,
  );
  const bookingId = booking.rows[0].id;
  const workId = randomUUID();
  const budgetForeignKeyWorkId = randomUUID();
  await client.query(
    `INSERT INTO notification_work (
       id,booking_id,booking_revision,kind,channel,status
     ) VALUES ($1,$2,0,'customer_confirmation','email','failed')`,
    [workId, bookingId],
  );
  await client.query(
    `INSERT INTO notification_work (
       id,booking_id,booking_revision,kind,channel,status
     ) VALUES ($1,$2,0,'owner_alert','whatsapp','failed')`,
    [budgetForeignKeyWorkId, bookingId],
  );
  return { bookingId, workId, budgetForeignKeyWorkId };
}

describe("notification recovery migration", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(async () => {
    await database?.pool.end();
  });

  it("cleans the first owned schema when the next migration fixture fails to set up", async () => {
    let createdSchema: string | undefined;
    let calls = 0;
    await expect(
      createMigrationFixtures(database.pool, async (pool, prefix) => {
        calls += 1;
        if (calls === 2) throw new Error("deterministic fixture setup failure");
        const fixture = await createMigrationFixture(pool, prefix);
        createdSchema = fixture.schema;
        return fixture;
      }),
    ).rejects.toThrow("deterministic fixture setup failure");
    const schema = await database.pool.query(
      "SELECT to_regnamespace($1) AS schema",
      [createdSchema],
    );
    expect(schema.rows[0].schema).toBeNull();
  });

  it("upgrades populated historical data and replays the repository chain from zero", async () => {
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
    const recoveryIndex = journal.entries.findIndex(
      ({ tag }) => tag === recoveryMigration,
    );
    expect(recoveryIndex).toBeGreaterThan(0);
    expect(journal.entries[recoveryIndex - 1]?.tag).toBe(
      "0014_shop_creation_rate_limit",
    );

    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "trimtime-notification-recovery-"),
    );
    let upgradeFixture: MigrationFixture | undefined;
    let fromZeroFixture: MigrationFixture | undefined;
    const upgradeMigrations = join(temporaryDirectory, "upgrade");
    const fullChainMigrations = join(temporaryDirectory, "from-zero");

    try {
      const fixtures = await createMigrationFixtures(database.pool);
      upgradeFixture = fixtures.upgrade;
      fromZeroFixture = fixtures.fromZero;
      const beforeRecoveryJournal: Journal = {
        ...journal,
        entries: journal.entries.slice(0, recoveryIndex),
      };
      await prepareRepositoryMigrations(
        upgradeMigrations,
        upgradeFixture.schema,
        journal,
      );
      await writeFile(
        join(upgradeMigrations, "meta/_journal.json"),
        JSON.stringify(beforeRecoveryJournal),
      );
      await applyMigrations(
        upgradeFixture.pool,
        upgradeMigrations,
        upgradeFixture.schema,
      );

      const seedClient = await upgradeFixture.pool.connect();
      let fixtureIds: Awaited<ReturnType<typeof insertHistoricalFixtures>>;
      let before: Awaited<ReturnType<typeof preservedRows>>;
      try {
        fixtureIds = await insertHistoricalFixtures(seedClient);
        before = await preservedRows(seedClient);
      } finally {
        seedClient.release();
      }

      await writeFile(
        join(upgradeMigrations, "meta/_journal.json"),
        JSON.stringify(journal),
      );
      await applyMigrations(
        upgradeFixture.pool,
        upgradeMigrations,
        upgradeFixture.schema,
      );
      await applyMigrations(
        upgradeFixture.pool,
        upgradeMigrations,
        upgradeFixture.schema,
      );

      const client = await upgradeFixture.pool.connect();
      try {
        expect(await preservedRows(client)).toEqual(before);
        const attempts = await client.query(
          `SELECT id,work_id,attempt_number,reason,finished_at,capture_id,outcome
           FROM notification_attempts ORDER BY id`,
        );
        expect(attempts.rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: fixtureIds.attemptIds.transient,
              work_id: fixtureIds.workIds.transient,
              attempt_number: 1,
              reason: "transient_rejection",
              finished_at: failureAt,
              outcome: "failed",
            }),
            expect.objectContaining({
              id: fixtureIds.attemptIds.permanent,
              work_id: fixtureIds.workIds.permanent,
              attempt_number: 1,
              reason: "permanent_rejection",
              finished_at: failureAt,
              outcome: "failed",
            }),
            expect.objectContaining({
              id: fixtureIds.attemptIds.whatsapp,
              work_id: fixtureIds.workIds.whatsapp,
              attempt_number: 1,
              reason: "transient_rejection",
              finished_at: failureAt,
              outcome: "failed",
            }),
            expect.objectContaining({
              id: fixtureIds.attemptIds.captured,
              work_id: fixtureIds.workIds.captured,
              attempt_number: 1,
              reason: null,
              finished_at: null,
              capture_id: "mailpit-capture-fixture",
              outcome: "captured",
            }),
          ]),
        );
        const retryTimes = await client.query(
          `SELECT id,next_attempt_at FROM notification_work ORDER BY id`,
        );
        expect(retryTimes.rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: fixtureIds.workIds.transient,
              next_attempt_at: new Date("2026-11-02T08:10:00.000Z"),
            }),
            expect.objectContaining({
              id: fixtureIds.workIds.permanent,
              next_attempt_at: null,
            }),
            expect.objectContaining({
              id: fixtureIds.workIds.whatsapp,
              next_attempt_at: null,
            }),
            expect.objectContaining({
              id: fixtureIds.workIds.captured,
              next_attempt_at: null,
            }),
          ]),
        );
        await expectRecoveryConstraints(client);
      } finally {
        client.release();
      }

      await prepareRepositoryMigrations(
        fullChainMigrations,
        fromZeroFixture.schema,
        journal,
      );
      await applyMigrations(
        fromZeroFixture.pool,
        fullChainMigrations,
        fromZeroFixture.schema,
      );
      const fromZeroClient = await fromZeroFixture.pool.connect();
      try {
        const ledger = await fromZeroClient.query(
          `SELECT hash FROM ${fromZeroFixture.schema}.__drizzle_migrations ORDER BY created_at`,
        );
        expect(ledger.rows).toHaveLength(journal.entries.length);
        await insertHistoricalFixtures(fromZeroClient);
        await expectRecoveryConstraints(fromZeroClient);
      } finally {
        fromZeroClient.release();
      }
    } finally {
      await upgradeFixture?.pool.end();
      await fromZeroFixture?.pool.end();
      if (upgradeFixture)
        await database.pool.query(
          `DROP SCHEMA ${upgradeFixture.schema} CASCADE`,
        );
      if (fromZeroFixture)
        await database.pool.query(
          `DROP SCHEMA ${fromZeroFixture.schema} CASCADE`,
        );
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 30_000);
});
