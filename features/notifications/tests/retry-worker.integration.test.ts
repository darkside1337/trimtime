import { randomBytes, randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { openTestDatabase } from "@/tests/support/database";
import { shopInput } from "@/tests/support/shops";
import { notificationBookingInput } from "@/tests/support/notifications";
import {
  createRateKeyTracker,
  trackCreateEmailRateKey,
} from "@/tests/support/rate-keys";
import type { MailpitTransportResult } from "../mailpit";

describe("notification retry worker", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let testAuth: typeof import("@/tests/support/auth").testAuth;
  let createShop: typeof import("@/features/shops/mutations").createShop;
  let saveBarber: typeof import("@/features/barbers/mutations").saveBarber;
  let saveService: typeof import("@/features/catalog/mutations").saveService;
  let saveShopSchedule: typeof import("@/features/availability/mutations").saveShopSchedule;
  let setOwnShopPublication: typeof import("@/features/shops/mutations").setOwnShopPublication;
  let createPublicBooking: typeof import("@/features/bookings/mutations").createPublicBooking;
  let moveOwnerBooking: typeof import("@/features/bookings/mutations").moveOwnerBooking;
  let processRetries: typeof import("../retry-worker").processNotificationRetries;
  let dispatchInitial: typeof import("../dispatch").dispatchInitialBookingNotifications;
  let processRetriesForTests: typeof import("../retry-worker.test-support").processNotificationRetriesForTests;
  let closeAppPool: (() => Promise<void>) | undefined;
  const ownerIds: string[] = [];
  const ownedBudgetDays = new Set<string>();
  const rateKeys = createRateKeyTracker();
  const week = Array.from({ length: 7 }, (_, index) => ({
    working: index === 0 ? [{ start: 540, end: 1020 }] : [],
    breaks: [],
  }));

  beforeAll(async () => {
    database = await openTestDatabase();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.BETTER_AUTH_URL = "http://app.localhost:3100";
    process.env.BETTER_AUTH_SECRET =
      "test-secret-that-is-long-enough-for-better-auth";
    process.env.GOOGLE_CLIENT_ID = "test-google-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
    process.env.BOOKING_CAPABILITY_KEY_ID = "test-v1";
    process.env.BOOKING_CAPABILITY_ENCRYPTION_KEY = Buffer.alloc(
      32,
      7,
    ).toString("base64");
    process.env.EMAIL_MODE = "mailpit";
    process.env.APP_ORIGIN = "http://app.localhost:3100";
    process.env.MARKETING_ORIGIN = "http://localhost:3100";
    process.env.MAILPIT_ORIGIN = "http://127.0.0.1:8025";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T08:00:00Z"));
    ({ testAuth } = await import("@/tests/support/auth"));
    ({ createShop, setOwnShopPublication } =
      await import("@/features/shops/mutations"));
    ({ saveBarber } = await import("@/features/barbers/mutations"));
    ({ saveService } = await import("@/features/catalog/mutations"));
    ({ saveShopSchedule } = await import("@/features/availability/mutations"));
    const mutations = await import("@/features/bookings/mutations");
    createPublicBooking = (context, input) => {
      trackCreateEmailRateKey(rateKeys, context, input);
      return mutations.createPublicBooking(context, input);
    };
    ({ moveOwnerBooking } = await import("@/features/bookings/mutations"));
    ({ processNotificationRetries: processRetries } =
      await import("../retry-worker"));
    ({ dispatchInitialBookingNotifications: dispatchInitial } =
      await import("../dispatch"));
    ({ processNotificationRetriesForTests: processRetriesForTests } =
      await import("../retry-worker.test-support"));
    const { pool } = await import("@/db");
    pool.options.max = 8;
    closeAppPool = () => pool.end();
  });

  afterEach(async () => {
    vi.setSystemTime(new Date("2026-10-31T08:00:00Z"));
    await cleanupOwners([...ownerIds]);
    await rateKeys.deleteAll(database.pool);
  });

  async function cleanupOwners(ids: string[]) {
    if (ids.length) {
      const allocations = await database.pool.query(
        `SELECT a.budget_day::text AS day,count(*)::int AS count
         FROM notification_attempts a JOIN notification_work w ON w.id=a.work_id
         JOIN bookings b ON b.id=w.booking_id JOIN shops s ON s.id=b.shop_id
         WHERE s.owner_id=ANY($1::text[]) GROUP BY a.budget_day`,
        [ids],
      );
      await database.pool.query(
        "DELETE FROM shops WHERE owner_id=ANY($1::text[])",
        [ids],
      );
      for (const allocation of allocations.rows as {
        day: string;
        count: number;
      }[]) {
        await database.pool.query(
          "UPDATE outbound_budget SET allocation_count=allocation_count-$2 WHERE day=$1 AND allocation_count >= $2",
          [allocation.day, allocation.count],
        );
      }
      const helpers = (await testAuth.$context).test;
      await Promise.all(ids.map((id) => helpers.deleteUser(id)));
      for (const id of ids) {
        const index = ownerIds.indexOf(id);
        if (index >= 0) ownerIds.splice(index, 1);
      }
    }
    if (ownerIds.length === 0) {
      for (const day of ownedBudgetDays) {
        await database.pool.query(
          `DELETE FROM outbound_budget WHERE day=$1
           AND NOT EXISTS (SELECT 1 FROM notification_attempts WHERE budget_day=$1)`,
          [day],
        );
      }
      ownedBudgetDays.clear();
    }
  }

  afterAll(async () => {
    vi.useRealTimers();
    await closeAppPool?.();
    await database?.pool.end();
  });

  async function fixture() {
    const helpers = (await testAuth.$context).test;
    const owner = await helpers.saveUser(
      helpers.createUser({
        email: `retry-${randomUUID()}@example.test`,
        name: "Retry Owner",
      }),
    );
    ownerIds.push(owner.id);
    const context = { userId: owner.id };
    const shop = await createShop(
      context,
      shopInput({
        subdomain: `retry-${randomUUID().slice(0, 8)}`,
        timeZone: "UTC",
      }),
    );
    if (!shop.success) throw new Error("Shop fixture failed.");
    const barber = await saveBarber(context, { name: "Sam", serviceIds: [] });
    if (!barber.success) throw new Error("Barber fixture failed.");
    const service = await saveService(context, {
      name: "Cut",
      priceUsd: "25",
      durationMinutes: "30",
      offered: true,
      barberIds: [barber.data.id],
    });
    if (!service.success) throw new Error("Service fixture failed.");
    await saveShopSchedule(context, { week, revision: 0 });
    await setOwnShopPublication(context, {
      published: true,
      expectedPublished: false,
    });
    const result = await createPublicBooking(
      { shopId: shop.data.id },
      notificationBookingInput(
        service.data.id,
        barber.data.id,
        `customer-${randomUUID()}@example.test`,
      ),
    );
    if (!result.success)
      throw new Error(`Booking fixture failed: ${result.error.code}`);
    return {
      ...result.data,
      owner,
      context,
      shopId: shop.data.id,
      barberId: barber.data.id,
      serviceId: service.data.id,
    };
  }

  async function setBudget(day: string, count: number) {
    if (ownedBudgetDays.has(day)) {
      const updated = await database.pool.query(
        "UPDATE outbound_budget SET allocation_count=$2 WHERE day=$1 RETURNING day",
        [day, count],
      );
      if (!updated.rowCount)
        throw new Error(`Owned budget day ${day} disappeared.`);
      return;
    }

    const inserted = await database.pool.query(
      "INSERT INTO outbound_budget (day,allocation_count) VALUES ($1,$2) ON CONFLICT (day) DO NOTHING RETURNING day::text",
      [day, count],
    );
    if (!inserted.rowCount)
      throw new Error(`Budget day ${day} is already owned.`);
    ownedBudgetDays.add(day);
  }

  async function reserveAdjacentBudgetDays(): Promise<[string, string]> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = await database.pool.query(
        `SELECT start_day::date::text AS day,
                (start_day::date + 1)::text AS next_day
         FROM generate_series('2026-10-05'::date,'2026-10-31'::date,'1 day') start_day
         WHERE NOT EXISTS (
                 SELECT 1 FROM outbound_budget b WHERE b.day=start_day::date
               )
           AND NOT EXISTS (
                 SELECT 1 FROM outbound_budget b WHERE b.day=start_day::date + 1
               )
         ORDER BY random() LIMIT 1`,
      );
      const days = candidate.rows[0] as
        { day: string; next_day: string } | undefined;
      if (!days)
        throw new Error("No unused adjacent budget days are available.");

      const client = await database.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO outbound_budget (day,allocation_count) VALUES ($1,0)",
          [days.day],
        );
        await client.query(
          "INSERT INTO outbound_budget (day,allocation_count) VALUES ($1,0)",
          [days.next_day],
        );
        await client.query("COMMIT");
        ownedBudgetDays.add(days.day);
        ownedBudgetDays.add(days.next_day);
        return [days.day, days.next_day];
      } catch (error) {
        await client.query("ROLLBACK");
        if ((error as { code?: string }).code !== "23505") throw error;
      } finally {
        client.release();
      }
    }
    throw new Error("Could not reserve adjacent budget days after 20 retries.");
  }

  async function unusedBudgetDay() {
    const [day] = await reserveAdjacentBudgetDays();
    return day;
  }

  async function insertForeignBudgetDay(count: number) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = await database.pool.query(
        `SELECT candidate::date::text AS day
         FROM generate_series('2026-10-05'::date,'2026-11-01'::date,'1 day') candidate
         WHERE NOT EXISTS (SELECT 1 FROM outbound_budget b WHERE b.day=candidate::date)
         ORDER BY random() LIMIT 1`,
      );
      const day = candidate.rows[0]?.day as string | undefined;
      if (!day) throw new Error("No unallocated fixture UTC day is available.");
      try {
        await database.pool.query(
          "INSERT INTO outbound_budget (day,allocation_count) VALUES ($1,$2)",
          [day, count],
        );
        return day;
      } catch (error) {
        if ((error as { code?: string }).code !== "23505") throw error;
      }
    }
    throw new Error(
      "Could not claim a foreign budget fixture after 20 retries.",
    );
  }

  async function candidatesFor(bookingIds: string[]) {
    const result = await database.pool.query(
      `SELECT id,booking_id AS "bookingId",status FROM notification_work
       WHERE booking_id=ANY($1::uuid[]) AND channel='email'
       ORDER BY CASE WHEN kind='customer_confirmation' THEN 0 ELSE 1 END,created_at,id`,
      [bookingIds],
    );
    return result.rows as { id: string; bookingId: string; status: string }[];
  }

  async function processOwned(
    bookingIds: string[],
    injected: Parameters<typeof processRetriesForTests>[0],
  ) {
    return processRetriesForTests(injected, await candidatesFor(bookingIds));
  }

  it("recovers committed never-attempted work through the shared initial-send gate", async () => {
    const created = await fixture();
    const send = vi.fn(
      async (input: {
        message: { to: string };
        onInvoked: () => Promise<void>;
        onAccepted?: (id: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        await input.onAccepted?.("retry-capture");
        return {
          status: "captured",
          reason: null,
          captureId: "retry-capture",
          invoked: true,
        };
      },
    );

    const result = await processOwned([created.bookingId], { send });

    expect(result.attempted).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    const rows = await database.pool.query(
      "SELECT status FROM notification_work WHERE booking_id=$1 AND channel='email' ORDER BY kind",
      [created.bookingId],
    );
    expect(rows.rows.map((row) => row.status)).toEqual([
      "captured",
      "captured",
    ]);
  });

  it("propagates a later database finalization failure after earlier work commits", async () => {
    const created = await fixture();
    const work = await database.pool.query(
      `SELECT id,kind FROM notification_work WHERE booking_id=$1 AND channel='email' ORDER BY kind`,
      [created.bookingId],
    );
    const second = work.rows.find((row) => row.kind === "owner_alert").id;
    await database.pool.query(`
      CREATE FUNCTION reject_retry_finalization() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.id = '${second}' AND OLD.status = 'accepted' AND NEW.status = 'captured' THEN
          RAISE EXCEPTION 'deterministic retry finalization failure';
        END IF;
        RETURN NEW;
      END $$
    `);
    await database.pool.query(`
      CREATE TRIGGER reject_retry_finalization BEFORE UPDATE ON notification_work
      FOR EACH ROW EXECUTE FUNCTION reject_retry_finalization()
    `);
    const send = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
        onAccepted?: (id: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        await input.onAccepted?.("finalize-capture");
        return {
          status: "captured",
          reason: null,
          captureId: "finalize-capture",
          invoked: true,
        };
      },
    );

    try {
      await expect(processOwned([created.bookingId], { send })).rejects.toThrow(
        'Failed query: update "notification_work"',
      );
      const statuses = await database.pool.query(
        "SELECT kind,status FROM notification_work WHERE booking_id=$1 AND channel='email' ORDER BY kind",
        [created.bookingId],
      );
      expect(statuses.rows).toEqual([
        { kind: "customer_confirmation", status: "captured" },
        { kind: "owner_alert", status: "accepted" },
      ]);
    } finally {
      await database.pool.query(
        "DROP TRIGGER IF EXISTS reject_retry_finalization ON notification_work",
      );
      await database.pool.query(
        "DROP FUNCTION IF EXISTS reject_retry_finalization()",
      );
    }
  });

  it("uses unfiltered production candidate selection in the serialized interval", async () => {
    const created = await fixture();
    const send = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
        onAccepted?: (id: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        await input.onAccepted?.("production-selection-capture");
        return {
          status: "captured",
          reason: null,
          captureId: "production-selection-capture",
          invoked: true,
        };
      },
    );
    vi.stubEnv("NODE_ENV", "production");
    let result;
    try {
      result = await processRetries({ send });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(result.attempted).toBeGreaterThanOrEqual(2);
    const rows = await database.pool.query(
      "SELECT status FROM notification_work WHERE booking_id=$1 AND channel='email'",
      [created.bookingId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((row) => row.status === "captured")).toBe(true);
  });

  it("does not overwrite a budget day owned by another allocation", async () => {
    const day = await insertForeignBudgetDay(5);
    try {
      await expect(setBudget(day, 10)).rejects.toThrow(/already owned/);
      const allocation = await database.pool.query(
        "SELECT allocation_count FROM outbound_budget WHERE day=$1",
        [day],
      );
      expect(allocation.rows).toEqual([{ allocation_count: 5 }]);
    } finally {
      await database.pool.query(
        `DELETE FROM outbound_budget WHERE day=$1 AND allocation_count=5
         AND NOT EXISTS (SELECT 1 FROM notification_attempts WHERE budget_day=$1)`,
        [day],
      );
    }
  });

  it("cannot redirect production processing through the test candidate seam", async () => {
    const created = await fixture();
    const candidate = (await candidatesFor([created.bookingId]))[0];
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(processRetriesForTests({}, [candidate])).rejects.toThrow(
        "test-only",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("fixture cleanup preserves another owner's budget allocation", async () => {
    const first = await fixture();
    const otherOwner = await fixture();
    const day = await unusedBudgetDay();
    await setBudget(day, 10);
    vi.setSystemTime(new Date(`${day}T08:00:00.000Z`));
    const send = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
        onAccepted?: (id: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        await input.onAccepted?.("owned-budget-capture");
        return {
          status: "captured",
          reason: null,
          captureId: "owned-budget-capture",
          invoked: true,
        };
      },
    );
    await processOwned([first.bookingId], { send });
    const ownAttempts = await database.pool.query(
      `SELECT count(*)::int AS count FROM notification_attempts a
       JOIN notification_work w ON w.id=a.work_id
       WHERE w.booking_id=$1 AND a.budget_day=$2`,
      [first.bookingId, day],
    );
    expect(ownAttempts.rows[0].count).toBe(2);

    const foreignWork = await database.pool.query(
      `SELECT id FROM notification_work WHERE booking_id=$1
       AND channel='email' AND kind='customer_confirmation'`,
      [otherOwner.bookingId],
    );
    const foreignAttemptId = randomUUID();
    await database.pool.query(
      "UPDATE outbound_budget SET allocation_count=allocation_count+1 WHERE day=$1",
      [day],
    );
    await database.pool.query(
      `INSERT INTO notification_attempts (id,work_id,budget_day,attempt_number)
       VALUES ($1,$2,$3,1)`,
      [foreignAttemptId, foreignWork.rows[0].id, day],
    );

    await cleanupOwners([first.owner.id]);
    const afterCleanup = await database.pool.query(
      `SELECT b.allocation_count,count(a.id)::int AS referenced_attempts
       FROM outbound_budget b LEFT JOIN notification_attempts a ON a.budget_day=b.day
       WHERE b.day=$1 GROUP BY b.day,b.allocation_count`,
      [day],
    );
    expect(afterCleanup.rows).toEqual([
      { allocation_count: 11, referenced_attempts: 1 },
    ]);
  });

  it("sends a due retry and leaves a before-due retry unreserved", async () => {
    const created = await fixture();
    const reject = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        return {
          status: "failed",
          reason: "transient_rejection",
          captureId: null,
          invoked: true,
        };
      },
    );
    await dispatchInitial(created.bookingId, { send: reject });
    const due = new Date("2026-10-31T08:10:00.000Z");
    const before = vi.fn(async (): Promise<MailpitTransportResult> => ({
      status: "captured",
      reason: null,
      captureId: "before-due",
      invoked: true,
    }));

    vi.setSystemTime(new Date(due.getTime() - 1));
    const early = await processOwned([created.bookingId], {
      now: () => new Date(),
      send: before,
    });
    expect(early.attempted).toBe(0);
    expect(before).not.toHaveBeenCalled();
    const attemptsBeforeDue = await database.pool.query(
      "SELECT count(*)::int AS count FROM notification_attempts a JOIN notification_work w ON w.id=a.work_id WHERE w.booking_id=$1",
      [created.bookingId],
    );
    expect(attemptsBeforeDue.rows[0].count).toBe(2);

    vi.setSystemTime(due);
    const succeed = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
        onAccepted?: (id: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        await input.onAccepted?.("due-capture");
        return {
          status: "captured",
          reason: null,
          captureId: "due-capture",
          invoked: true,
        };
      },
    );
    const retried = await processOwned([created.bookingId], {
      now: () => new Date(),
      send: succeed,
    });

    expect(retried.attempted).toBe(2);
    expect(succeed).toHaveBeenCalledTimes(2);
    const outcomes = await database.pool.query(
      "SELECT w.kind,a.attempt_number,a.outcome FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id WHERE w.booking_id=$1 ORDER BY w.kind,a.attempt_number",
      [created.bookingId],
    );
    expect(
      outcomes.rows.filter((row) => row.attempt_number === 2),
    ).toHaveLength(2);
  });

  it("uses the second backoff and never reserves beyond three attempts", async () => {
    const created = await fixture();
    const reject = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        return {
          status: "failed",
          reason: "transient_rejection",
          captureId: null,
          invoked: true,
        };
      },
    );
    await dispatchInitial(created.bookingId, { send: reject });

    vi.setSystemTime(new Date("2026-10-31T08:10:00Z"));
    expect(
      (await processOwned([created.bookingId], { send: reject })).attempted,
    ).toBe(2);
    const scheduled = await database.pool.query(
      "SELECT next_attempt_at FROM notification_work WHERE booking_id=$1 AND channel='email' ORDER BY kind",
      [created.bookingId],
    );
    expect(scheduled.rows).toEqual([
      { next_attempt_at: new Date("2026-10-31T08:30:00Z") },
      { next_attempt_at: new Date("2026-10-31T08:30:00Z") },
    ]);
    vi.setSystemTime(new Date("2026-10-31T08:29:59.999Z"));
    expect(
      (await processOwned([created.bookingId], { send: reject })).attempted,
    ).toBe(0);
    expect(reject).toHaveBeenCalledTimes(4);
    vi.setSystemTime(new Date("2026-10-31T08:30:00Z"));
    expect(
      (await processOwned([created.bookingId], { send: reject })).attempted,
    ).toBe(2);
    const exhausted = await database.pool.query(
      `SELECT w.next_attempt_at,count(a.id)::int AS attempts
       FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.booking_id=$1 GROUP BY w.id ORDER BY w.kind`,
      [created.bookingId],
    );
    expect(exhausted.rows).toEqual([
      { next_attempt_at: null, attempts: 3 },
      { next_attempt_at: null, attempts: 3 },
    ]);

    vi.setSystemTime(new Date("2026-10-31T08:50:00Z"));
    const afterExhaustion = await processOwned([created.bookingId], {
      send: reject,
    });
    expect(afterExhaustion.attempted).toBe(0);
    expect(reject).toHaveBeenCalledTimes(6);
  });

  it("leaves permanent, unknown, and terminal work untouched", async () => {
    const created = await fixture();
    const terminal = vi.fn(
      async (input: {
        message: { to: string };
        onInvoked: () => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        return input.message.to === created.owner.email
          ? {
              status: "unknown",
              reason: "transport_interrupted",
              captureId: null,
              invoked: true,
            }
          : {
              status: "failed",
              reason: "permanent_rejection",
              captureId: null,
              invoked: true,
            };
      },
    );
    await dispatchInitial(created.bookingId, { send: terminal });
    const before = await database.pool.query(
      "SELECT id,status,reason,next_attempt_at FROM notification_work WHERE booking_id=$1 ORDER BY id",
      [created.bookingId],
    );
    const retrySend = vi.fn();

    const result = await processOwned([created.bookingId], { send: retrySend });
    const after = await database.pool.query(
      "SELECT id,status,reason,next_attempt_at FROM notification_work WHERE booking_id=$1 ORDER BY id",
      [created.bookingId],
    );

    expect(result.attempted).toBe(0);
    expect(retrySend).not.toHaveBeenCalled();
    expect(after.rows).toEqual(before.rows);
  });

  it("preserves captured WhatsApp evidence byte-for-byte while processing email retry work", async () => {
    const created = await fixture();
    const reject = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        return {
          status: "failed",
          reason: "transient_rejection",
          captureId: null,
          invoked: true,
        };
      },
    );
    await dispatchInitial(created.bookingId, { send: reject });
    const day = await unusedBudgetDay();
    await setBudget(day, 0);
    const seeded = await database.pool.query(
      `INSERT INTO notification_work
         (id,booking_id,booking_revision,change_id,kind,channel,status,recipient,content_identity,reason,created_at,updated_at)
       SELECT gen_random_uuid(),booking_id,booking_revision,change_id,kind,'whatsapp','captured','+15555550100',content_identity,NULL,created_at,updated_at
       FROM notification_work WHERE booking_id=$1 AND kind='customer_confirmation' AND channel='email'
       RETURNING id`,
      [created.bookingId],
    );
    const whatsappWorkId = seeded.rows[0].id as string;
    await database.pool.query(
      "UPDATE outbound_budget SET allocation_count=allocation_count+1 WHERE day=$1",
      [day],
    );
    await database.pool.query(
      `INSERT INTO notification_attempts
         (id,work_id,budget_day,attempt_number,reserved_at,invoked_at,outcome,capture_id,finished_at)
       VALUES (gen_random_uuid(),$1,$2,1,$3,$3,'captured','seeded-whatsapp-capture',$3)`,
      [whatsappWorkId, day, new Date("2026-10-31T08:00:00Z")],
    );
    const snapshot = async () =>
      (
        await database.pool.query(
          `SELECT to_jsonb(w) AS work,to_jsonb(a) AS attempt
       FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id WHERE w.id=$1`,
          [whatsappWorkId],
        )
      ).rows[0];
    const before = await snapshot();

    vi.setSystemTime(new Date("2026-10-31T08:10:00Z"));
    const retry = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        return {
          status: "captured",
          reason: null,
          captureId: "email-retry-capture",
          invoked: true,
        };
      },
    );
    await processOwned([created.bookingId], { send: retry });

    expect(await snapshot()).toEqual(before);
  });

  it("makes historical transient work eligible while preserving its first attempt", async () => {
    const created = await fixture();
    const reject = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        return {
          status: "failed",
          reason: "transient_rejection",
          captureId: null,
          invoked: true,
        };
      },
    );
    await dispatchInitial(created.bookingId, { send: reject });
    const before = await database.pool.query(
      `SELECT w.id AS work_id,a.id AS attempt_id,a.attempt_number,a.budget_day
       FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.booking_id=$1 ORDER BY w.kind`,
      [created.bookingId],
    );
    await database.pool.query(
      `UPDATE notification_work SET next_attempt_at='2026-10-01T00:10:00Z'
       WHERE booking_id=$1 AND channel='email' AND status='failed'`,
      [created.bookingId],
    );
    await database.pool.query(
      `UPDATE notification_attempts SET finished_at='2026-10-01T00:00:00Z'
       WHERE work_id IN (SELECT id FROM notification_work WHERE booking_id=$1)`,
      [created.bookingId],
    );
    const accept = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        return {
          status: "captured",
          reason: null,
          captureId: "historical-retry",
          invoked: true,
        };
      },
    );

    const result = await processOwned([created.bookingId], { send: accept });

    expect(result.attempted).toBe(2);
    const after = await database.pool.query(
      `SELECT a.id,a.attempt_number,a.budget_day,w.id AS work_id
       FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.booking_id=$1 ORDER BY w.kind,a.attempt_number`,
      [created.bookingId],
    );
    expect(
      after.rows.filter((row) => row.attempt_number === 1).map((row) => row.id),
    ).toEqual(before.rows.map((row) => row.attempt_id));
    expect(
      after.rows
        .filter((row) => row.attempt_number === 1)
        .map((row) => row.budget_day),
    ).toEqual(before.rows.map((row) => row.budget_day));
    expect(after.rows.filter((row) => row.attempt_number === 2)).toHaveLength(
      2,
    );
  });

  it("fences competing workers and a concurrent initial dispatcher to one reservation", async () => {
    const created = await fixture();
    const target = (
      await database.pool.query(
        "SELECT id,booking_id AS \"bookingId\",recipient FROM notification_work WHERE booking_id=$1 AND kind='customer_confirmation' AND channel='email'",
        [created.bookingId],
      )
    ).rows[0] as { id: string; bookingId: string; recipient: string };
    let entered!: () => void;
    const sendEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstSend = vi.fn(
      async (input: {
        message: { to: string };
        onInvoked: () => Promise<void>;
        onAccepted?: (id: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        entered();
        await barrier;
        await input.onInvoked();
        await input.onAccepted?.("race-capture");
        return {
          status: "captured",
          reason: null,
          captureId: "race-capture",
          invoked: true,
        };
      },
    );
    const initialSend = vi.fn(
      async (input: {
        message: { to: string };
        onInvoked: () => Promise<void>;
        onAccepted?: (id: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        await input.onAccepted?.("initial-race-capture");
        return {
          status: "captured",
          reason: null,
          captureId: "initial-race-capture",
          invoked: true,
        };
      },
    );
    const candidate = [
      { id: target.id, bookingId: target.bookingId, status: "not_attempted" },
    ];

    const winner = processRetriesForTests({ send: firstSend }, candidate);
    await sendEntered;
    const otherWorker = processRetriesForTests({ send: vi.fn() }, candidate);
    const initialDispatch = dispatchInitial(created.bookingId, {
      send: initialSend,
    });
    await Promise.all([otherWorker, initialDispatch]);
    release();
    const winnerResult = await winner;

    expect(winnerResult.attempted).toBe(1);
    expect(firstSend).toHaveBeenCalledTimes(1);
    expect(
      initialSend.mock.calls.filter(
        ([input]) => input.message.to === target.recipient,
      ),
    ).toHaveLength(0);
    const attempts = await database.pool.query(
      "SELECT count(*)::int AS count FROM notification_attempts WHERE work_id=$1",
      [target.id],
    );
    expect(attempts.rows[0].count).toBe(1);
  });

  it("shares the global budget across shops, isolates UTC days, and never replays a budget skip", async () => {
    const [day, nextDayText] = await reserveAdjacentBudgetDays();
    vi.setSystemTime(new Date(`${day}T08:00:00.000Z`));
    const first = await fixture();
    const second = await fixture();
    await setBudget(day, 99);
    const targets = await database.pool.query(
      `SELECT w.id,w.booking_id AS "bookingId",w.status
       FROM notification_work w WHERE w.booking_id=ANY($1::uuid[])
         AND w.kind='customer_confirmation' AND w.channel='email' ORDER BY w.booking_id`,
      [[first.bookingId, second.bookingId]],
    );
    const send = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        return {
          status: "captured",
          reason: null,
          captureId: "budget-capture",
          invoked: true,
        };
      },
    );

    let releaseCandidates!: () => void;
    const bothCandidatesReady = new Promise<void>((resolve) => {
      releaseCandidates = resolve;
    });
    let candidateArrivals = 0;
    const candidateBarrier = async () => {
      candidateArrivals += 1;
      if (candidateArrivals === 2) releaseCandidates();
      await bothCandidatesReady;
    };
    const [one, two] = await Promise.all(
      targets.rows.map((candidate) =>
        processRetriesForTests(
          { send },
          [candidate as { id: string; bookingId: string; status: string }],
          candidateBarrier,
        ),
      ),
    );
    expect(one.attempted + two.attempted).toBe(1);
    expect(one.suppressed + two.suppressed).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    const statuses = await database.pool.query(
      `SELECT w.id,w.status,w.reason,count(a.id)::int AS attempts
       FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=ANY($1::uuid[]) GROUP BY w.id ORDER BY w.id`,
      [targets.rows.map((row) => row.id)],
    );
    const skipped = statuses.rows.find((row) => row.status === "skipped");
    const eligible = statuses.rows.find((row) => row.status === "captured");
    const allocation = await database.pool.query(
      "SELECT allocation_count FROM outbound_budget WHERE day=$1",
      [day],
    );
    expect(Number(allocation.rows[0].allocation_count)).toBe(100);
    expect(skipped).toMatchObject({
      reason: "daily_budget_exhausted",
      attempts: 0,
    });
    expect(eligible).toMatchObject({ attempts: 1 });

    const nextBudgetDate = new Date(`${nextDayText}T00:00:00Z`);
    vi.setSystemTime(nextBudgetDate);
    const skippedCandidate = targets.rows.find((row) => row.id === skipped.id);
    expect(skippedCandidate).toBeDefined();
    const replay = await processRetriesForTests({ send }, [
      {
        id: skipped.id as string,
        bookingId: skippedCandidate!.bookingId as string,
        status: "skipped",
      },
    ]);
    expect(replay.attempted).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);

    const nextDayWork = (
      await database.pool.query(
        "SELECT id,booking_id AS \"bookingId\",status FROM notification_work WHERE booking_id=$1 AND kind='owner_alert' AND channel='email'",
        [first.bookingId],
      )
    ).rows[0];
    const nextDay = await processRetriesForTests({ send }, [nextDayWork]);
    expect(nextDay.attempted).toBe(1);
    const nextDayAttempt = await database.pool.query(
      "SELECT budget_day::text AS day FROM notification_attempts WHERE work_id=$1",
      [nextDayWork.id],
    );
    expect(nextDayAttempt.rows).toEqual([{ day: nextDayText }]);
  });

  it("suppresses superseded, changed-recipient, changed-content, and revoked-capability work before allocation", async () => {
    const rejection = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        return {
          status: "failed",
          reason: "transient_rejection",
          captureId: null,
          invoked: true,
        };
      },
    );
    const scenarios = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const created = await fixture();
        await dispatchInitial(created.bookingId, { send: rejection });
        const work = (
          await database.pool.query(
            "SELECT id FROM notification_work WHERE booking_id=$1 AND kind='customer_confirmation' AND channel='email'",
            [created.bookingId],
          )
        ).rows[0];
        return { ...created, workId: work.id as string };
      }),
    );
    const [superseded, changedRecipient, changedContent, revoked] = scenarios;
    const moved = await moveOwnerBooking(superseded.context, {
      bookingId: superseded.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: superseded.serviceId,
      barberId: superseded.barberId,
      startAt: "2026-11-02T11:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
    });
    if (!moved.success)
      throw new Error(`Move fixture failed: ${JSON.stringify(moved)}`);
    await database.pool.query(
      "UPDATE notification_work SET recipient='stale@example.test' WHERE id=$1",
      [changedRecipient.workId],
    );
    await database.pool.query(
      "UPDATE notification_work SET content_identity='stale-content' WHERE id=$1",
      [changedContent.workId],
    );
    await database.pool.query(
      "UPDATE bookings SET capability_revoked_at=$2 WHERE id=$1",
      [revoked.bookingId, new Date("2026-10-31T08:00:00Z")],
    );
    const send = vi.fn();
    const candidates = scenarios.map(({ bookingId, workId }) => ({
      id: workId,
      bookingId,
      status: "failed",
    }));

    vi.setSystemTime(new Date("2026-10-31T08:10:00Z"));
    const result = await processRetriesForTests({ send }, candidates);

    expect(result.attempted).toBe(0);
    expect(result.suppressed).toBe(3);
    expect(send).not.toHaveBeenCalled();
    const states = await database.pool.query(
      `SELECT w.id,w.status,w.next_attempt_at,count(a.id)::int AS attempts FROM notification_work w
       LEFT JOIN notification_attempts a ON a.work_id=w.id WHERE w.id=ANY($1::uuid[])
       GROUP BY w.id,w.next_attempt_at ORDER BY w.id`,
      [scenarios.map(({ workId }) => workId)],
    );
    expect(states.rows).toEqual(
      expect.arrayContaining(
        scenarios.map(({ workId }) =>
          expect.objectContaining({
            id: workId,
            status: "suppressed",
            next_attempt_at: null,
            attempts: 1,
          }),
        ),
      ),
    );
  });

  it("recovers only claims older than thirty seconds and fences late results", async () => {
    const created = await fixture();
    const rows = await database.pool.query(
      `SELECT id,kind FROM notification_work WHERE booking_id=$1 AND channel='email' ORDER BY kind`,
      [created.bookingId],
    );
    const customerWork = rows.rows.find(
      (row) => row.kind === "customer_confirmation",
    ).id as string;
    const ownerWork = rows.rows.find((row) => row.kind === "owner_alert")
      .id as string;
    let entered!: () => void;
    const sendEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lateSend = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
        onAccepted?: (id: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        entered();
        await barrier;
        await input.onAccepted?.("late-capture");
        return {
          status: "captured",
          reason: null,
          captureId: "late-capture",
          invoked: true,
        };
      },
    );
    const initial = dispatchInitial(created.bookingId, { send: lateSend });
    await sendEntered;
    await database.pool.query(
      "UPDATE notification_work SET claimed_at=$2 WHERE id=$1",
      [customerWork, new Date("2026-10-31T08:00:00Z")],
    );
    const budget = await database.pool.query(
      "SELECT budget_day::text AS day FROM notification_attempts WHERE work_id=$1",
      [customerWork],
    );
    await database.pool.query(
      "UPDATE outbound_budget SET allocation_count=allocation_count+1 WHERE day=$1",
      [budget.rows[0].day],
    );
    const ownerClaim = randomUUID();
    const ownerAttempt = randomUUID();
    await database.pool.query(
      "UPDATE notification_work SET status='sending',claim_id=$2,claimed_at=$3 WHERE id=$1",
      [ownerWork, ownerClaim, new Date("2026-10-31T08:00:00Z")],
    );
    await database.pool.query(
      `INSERT INTO notification_attempts (id,work_id,budget_day,attempt_number,reserved_at)
       VALUES ($1,$2,$3,1,$4)`,
      [
        ownerAttempt,
        ownerWork,
        budget.rows[0].day,
        new Date("2026-10-31T08:00:00Z"),
      ],
    );

    vi.setSystemTime(new Date("2026-10-31T08:00:30.000Z"));
    const staleCandidates = [
      { id: customerWork, bookingId: created.bookingId, status: "sending" },
      { id: ownerWork, bookingId: created.bookingId, status: "sending" },
    ];
    const atBoundary = await processRetriesForTests(
      { send: vi.fn() },
      staleCandidates,
    );
    expect(atBoundary.recoveredUnknown).toBe(0);
    expect(
      (
        await database.pool.query(
          "SELECT status FROM notification_work WHERE id=ANY($1::uuid[])",
          [[customerWork, ownerWork]],
        )
      ).rows.map((row) => row.status),
    ).toEqual(["sending", "sending"]);

    vi.setSystemTime(new Date("2026-10-31T08:00:30.001Z"));
    const afterExpiry = await processRetriesForTests(
      { send: vi.fn() },
      staleCandidates,
    );
    expect(afterExpiry.recoveredUnknown).toBe(2);
    const persisted = await database.pool.query(
      `SELECT w.status,w.reason,a.outcome,a.reason AS attempt_reason,a.invoked_at
       FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=ANY($1::uuid[]) ORDER BY w.id,a.attempt_number`,
      [[customerWork, ownerWork]],
    );
    expect(persisted.rows).toHaveLength(2);
    expect(
      persisted.rows.every(
        (row) =>
          row.status === "unknown" &&
          row.reason === "dispatch_interrupted" &&
          row.outcome === "unknown" &&
          row.attempt_reason === "dispatch_interrupted",
      ),
    ).toBe(true);
    expect(
      persisted.rows.filter((row) => row.invoked_at === null),
    ).toHaveLength(1);

    release();
    await initial;
    const afterLateResult = await database.pool.query(
      `SELECT w.status,w.reason,a.outcome,a.capture_id FROM notification_work w
       JOIN notification_attempts a ON a.work_id=w.id WHERE w.id=$1`,
      [customerWork],
    );
    expect(afterLateResult.rows[0]).toMatchObject({
      status: "unknown",
      reason: "dispatch_interrupted",
      outcome: "unknown",
      capture_id: null,
    });
    expect(lateSend).toHaveBeenCalledTimes(1);
  });

  it("reconciles only matching known captures and preserves mismatch, outage, and absent-ID evidence", async () => {
    const first = await fixture();
    const second = await fixture();
    const accept = vi.fn(
      async (input: {
        message: { to: string };
        attemptId: string;
        onInvoked: () => Promise<void>;
        onAccepted?: (id: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        await input.onAccepted?.(`known-${input.message.to}`);
        return {
          status: "accepted",
          reason: "capture_verification_unavailable",
          captureId: `known-${input.message.to}`,
          invoked: true,
        };
      },
    );
    await dispatchInitial(first.bookingId, { send: accept });
    await dispatchInitial(second.bookingId, { send: accept });
    const work = await database.pool.query(
      `SELECT w.id,w.booking_id AS "bookingId",w.recipient,a.id AS "attemptId",a.capture_id
       FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.booking_id=ANY($1::uuid[]) AND w.channel='email' ORDER BY w.created_at,w.kind`,
      [[first.bookingId, second.bookingId]],
    );
    const [match, mismatch, outage, missing] = work.rows;
    await database.pool.query(
      "UPDATE notification_attempts SET capture_id='matching-capture' WHERE id=$1",
      [match.attemptId],
    );
    await database.pool.query(
      "UPDATE notification_attempts SET capture_id='mismatching-capture' WHERE id=$1",
      [mismatch.attemptId],
    );
    await database.pool.query(
      "UPDATE notification_attempts SET capture_id='offline-capture' WHERE id=$1",
      [outage.attemptId],
    );
    await database.pool.query(
      "UPDATE notification_attempts SET capture_id=NULL WHERE id=$1",
      [missing.attemptId],
    );
    const verifyCapture = vi.fn(
      async (input: {
        captureId: string;
        recipient: string;
        attemptId: string;
      }): Promise<string | null> => {
        if (input.captureId === "matching-capture") return null;
        if (input.captureId === "mismatching-capture")
          return "capture_attempt_mismatch";
        return "capture_verification_unavailable";
      },
    );
    const beforeAttempts = await database.pool.query(
      "SELECT count(*)::int AS count FROM notification_attempts WHERE work_id=ANY($1::uuid[])",
      [work.rows.map((row) => row.id)],
    );
    const send = vi.fn();

    const result = await processRetriesForTests(
      { send, verifyCapture },
      work.rows.map((row) => ({
        id: row.id as string,
        bookingId: row.bookingId as string,
        status: "accepted",
      })),
    );

    expect(result.reconciled).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(verifyCapture).toHaveBeenCalledTimes(3);
    const after = await database.pool.query(
      `SELECT w.id,w.status,w.reason,a.outcome,a.reason AS attempt_reason,a.capture_id
       FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=ANY($1::uuid[]) ORDER BY w.id`,
      [work.rows.map((row) => row.id)],
    );
    expect(after.rows.find((row) => row.id === match.id)).toMatchObject({
      status: "captured",
      outcome: "captured",
      attempt_reason: null,
      capture_id: "matching-capture",
    });
    expect(after.rows.find((row) => row.id === mismatch.id)).toMatchObject({
      status: "accepted",
      outcome: "accepted",
      reason: "capture_verification_unavailable",
      attempt_reason: "capture_verification_unavailable",
    });
    expect(after.rows.find((row) => row.id === outage.id)).toMatchObject({
      status: "accepted",
      outcome: "accepted",
      reason: "capture_verification_unavailable",
    });
    expect(after.rows.find((row) => row.id === missing.id)).toMatchObject({
      status: "accepted",
      outcome: "accepted",
      capture_id: null,
    });
    const afterAttempts = await database.pool.query(
      "SELECT count(*)::int AS count FROM notification_attempts WHERE work_id=ANY($1::uuid[])",
      [work.rows.map((row) => row.id)],
    );
    expect(afterAttempts.rows).toEqual(beforeAttempts.rows);
  });

  it("processes the oldest five candidates and keeps earlier commits when a later send fails", async () => {
    const bookings = await Promise.all(
      Array.from({ length: 3 }, () => fixture()),
    );
    const work = await database.pool.query(
      `SELECT w.id,w.booking_id AS "bookingId",w.recipient
       FROM notification_work w WHERE w.booking_id=ANY($1::uuid[]) AND w.channel='email'
       ORDER BY w.id`,
      [bookings.map((booking) => booking.bookingId)],
    );
    for (const [index, row] of work.rows.entries()) {
      await database.pool.query(
        "UPDATE notification_work SET created_at=$2 WHERE id=$1",
        [
          row.id,
          new Date(`2026-10-31T07:00:${String(index).padStart(2, "0")}Z`),
        ],
      );
    }
    const byCreation = await database.pool.query(
      'SELECT id,booking_id AS "bookingId",recipient FROM notification_work WHERE id=ANY($1::uuid[]) ORDER BY created_at,id',
      [work.rows.map((row) => row.id)],
    );
    const failingRecipient = byCreation.rows[2].recipient as string;
    const sent: string[] = [];
    const send = vi.fn(
      async (input: {
        message: { to: string };
        onInvoked: () => Promise<void>;
        onAccepted?: (id: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        sent.push(input.message.to);
        await input.onInvoked();
        if (input.message.to === failingRecipient)
          throw new Error("controlled later item failure");
        await input.onAccepted?.("batch-capture");
        return {
          status: "captured",
          reason: null,
          captureId: "batch-capture",
          invoked: true,
        };
      },
    );

    const result = await processRetriesForTests(
      { send },
      byCreation.rows.map((row) => ({
        id: row.id as string,
        bookingId: row.bookingId as string,
        status: "not_attempted",
      })),
    );

    expect(result.processed).toBe(5);
    expect(result.attempted).toBe(5);
    expect(sent).toEqual(
      byCreation.rows.slice(0, 5).map((row) => row.recipient),
    );
    const states = await database.pool.query(
      `SELECT w.id,w.status,count(a.id)::int AS attempts FROM notification_work w
       LEFT JOIN notification_attempts a ON a.work_id=w.id WHERE w.id=ANY($1::uuid[])
       GROUP BY w.id ORDER BY w.id`,
      [work.rows.map((row) => row.id)],
    );
    expect(states.rows.filter((row) => row.status === "captured")).toHaveLength(
      4,
    );
    expect(states.rows.filter((row) => row.status === "unknown")).toHaveLength(
      1,
    );
    expect(
      states.rows.filter((row) => row.status === "not_attempted"),
    ).toHaveLength(1);
    expect(states.rows.filter((row) => row.attempts === 0)).toHaveLength(1);
  });

  it("preserves booking revision, lifecycle, occupancy, change events, and capability on retry outcomes", async () => {
    const created = await fixture();
    const moved = await moveOwnerBooking(created.context, {
      bookingId: created.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: created.serviceId,
      barberId: created.barberId,
      startAt: "2026-11-02T11:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
    });
    if (!moved.success)
      throw new Error(`Move fixture failed: ${JSON.stringify(moved)}`);
    const initialSend = vi.fn(
      async (input: {
        message: { to: string };
        onInvoked: () => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        return input.message.to === created.owner.email
          ? {
              status: "unknown",
              reason: "transport_interrupted",
              captureId: null,
              invoked: true,
            }
          : {
              status: "failed",
              reason: "transient_rejection",
              captureId: null,
              invoked: true,
            };
      },
    );
    await dispatchInitial(created.bookingId, { send: initialSend });
    const snapshot = async () =>
      (
        await database.pool.query(
          `SELECT to_jsonb(b) AS booking,
         COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.committed_at,c.id)
                   FROM booking_changes c WHERE c.booking_id=b.id),'[]'::jsonb) AS changes,
         (SELECT count(*)::int FROM bookings occupied
          WHERE occupied.barber_id=b.barber_id AND occupied.status IN ('confirmed','completed','no_show')
            AND occupied.start_at < b.end_at AND occupied.end_at > b.start_at) AS occupancy
       FROM bookings b WHERE b.id=$1`,
          [created.bookingId],
        )
      ).rows[0];
    const before = await snapshot();
    vi.setSystemTime(new Date("2026-10-31T08:10:00Z"));
    const retry = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
        onAccepted?: (id: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        await input.onAccepted?.("lifecycle-independent-capture");
        return {
          status: "captured",
          reason: null,
          captureId: "lifecycle-independent-capture",
          invoked: true,
        };
      },
    );

    const result = await processOwned([created.bookingId], { send: retry });

    expect(result.attempted).toBe(1);
    expect(await snapshot()).toEqual(before);
  });
});
