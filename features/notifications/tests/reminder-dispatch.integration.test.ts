import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
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
import type { MailpitTransportResult } from "../mailpit";
import { notificationContentIdentity } from "../content-identity";

describe("schedule-aware reminder dispatch", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let testAuth: typeof import("@/tests/support/auth").testAuth;
  let createShop: typeof import("@/features/shops/mutations").createShop;
  let saveBarber: typeof import("@/features/barbers/mutations").saveBarber;
  let saveService: typeof import("@/features/catalog/mutations").saveService;
  let saveShopSchedule: typeof import("@/features/availability/mutations").saveShopSchedule;
  let setOwnShopPublication: typeof import("@/features/shops/mutations").setOwnShopPublication;
  let createPublicBooking: typeof import("@/features/bookings/mutations").createPublicBooking;
  let moveOwnerBooking: typeof import("@/features/bookings/mutations").moveOwnerBooking;
  let dispatchNotificationWork: typeof import("../dispatch").dispatchNotificationWork;
  let dispatchInitialBookingNotifications: typeof import("../dispatch").dispatchInitialBookingNotifications;
  let processNotificationRetries: typeof import("../retry-worker").processNotificationRetries;
  let closeAppPool: (() => Promise<void>) | undefined;
  const ownerIds: string[] = [];
  const budgetDays = new Set<string>();
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
    vi.setSystemTime(new Date("2026-10-31T08:00:00.000Z"));
    ({ testAuth } = await import("@/tests/support/auth"));
    ({ createShop, setOwnShopPublication } =
      await import("@/features/shops/mutations"));
    ({ saveBarber } = await import("@/features/barbers/mutations"));
    ({ saveService } = await import("@/features/catalog/mutations"));
    ({ saveShopSchedule } = await import("@/features/availability/mutations"));
    ({ createPublicBooking, moveOwnerBooking } =
      await import("@/features/bookings/mutations"));
    ({ dispatchNotificationWork, dispatchInitialBookingNotifications } =
      await import("../dispatch"));
    ({ processNotificationRetries } = await import("../retry-worker"));
    const { pool } = await import("@/db");
    pool.options.max = 8;
    closeAppPool = () => pool.end();
  });

  afterEach(async () => {
    vi.setSystemTime(new Date("2026-10-31T08:00:00.000Z"));
    if (ownerIds.length) {
      const allocations = await database.pool.query(
        `SELECT a.budget_day::text AS day,count(*)::int AS count
         FROM notification_attempts a JOIN notification_work w ON w.id=a.work_id
         JOIN bookings b ON b.id=w.booking_id JOIN shops s ON s.id=b.shop_id
         WHERE s.owner_id=ANY($1::text[]) GROUP BY a.budget_day`,
        [ownerIds],
      );
      await database.pool.query(
        "DELETE FROM shops WHERE owner_id=ANY($1::text[])",
        [ownerIds],
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
      await Promise.all(ownerIds.map((id) => helpers.deleteUser(id)));
      ownerIds.length = 0;
    }
    for (const day of budgetDays) {
      await database.pool.query(
        `DELETE FROM outbound_budget WHERE day=$1
         AND NOT EXISTS (SELECT 1 FROM notification_attempts WHERE budget_day=$1)`,
        [day],
      );
    }
    budgetDays.clear();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await closeAppPool?.();
    await database?.pool.end();
  });

  async function fixture() {
    const helpers = (await testAuth.$context).test;
    const owner = await helpers.saveUser(
      helpers.createUser({
        email: `reminder-${randomUUID()}@example.test`,
        name: "Reminder Owner",
      }),
    );
    ownerIds.push(owner.id);
    const context = { userId: owner.id };
    const shop = await createShop(
      context,
      shopInput({
        subdomain: `reminder-${randomUUID().slice(0, 8)}`,
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
    const reminder = await database.pool.query(
      `SELECT id,due_at FROM notification_work
       WHERE booking_id=$1 AND kind='customer_reminder' AND channel='email'`,
      [result.data.bookingId],
    );
    if (reminder.rowCount !== 1)
      throw new Error("Reminder work fixture is unavailable.");
    return {
      bookingId: result.data.bookingId,
      shopId: shop.data.id,
      ownerId: owner.id,
      context,
      serviceId: service.data.id,
      barberId: barber.data.id,
      workId: reminder.rows[0].id as string,
      dueAt: reminder.rows[0].due_at as Date,
    };
  }

  async function shiftScheduleTo(
    created: Awaited<ReturnType<typeof fixture>>,
    startAt: string,
  ) {
    const start = new Date(startAt);
    const end = new Date(start.getTime() + 30 * 60_000);
    const booking = await database.pool.query(
      `SELECT b.id,b.occupancy_id AS "occupancyId",b.start_at AS "startAt",
        b.end_at AS "endAt",b.service_name AS "serviceName",
        b.service_price_usd AS "servicePriceUsd",
        b.service_duration_minutes AS "serviceDurationMinutes",
        b.barber_name AS "barberName",b.customer_name AS "customerName",
        b.customer_email AS "customerEmail",b.customer_phone AS "customerPhone"
       FROM bookings b WHERE b.id=$1`,
      [created.bookingId],
    );
    const saved = booking.rows[0];
    await database.pool.query(
      "UPDATE bookings SET start_at=$2,end_at=$3 WHERE id=$1",
      [created.bookingId, start, end],
    );
    await database.pool.query(
      "UPDATE occupied_intervals SET start_at=$2,end_at=$3 WHERE id=$1",
      [saved.occupancyId, start, end],
    );
    const contentIdentity = notificationContentIdentity({
      id: created.bookingId,
      startAt: start,
      endAt: end,
      serviceName: saved.serviceName,
      servicePriceUsd: saved.servicePriceUsd,
      serviceDurationMinutes: saved.serviceDurationMinutes,
      barberName: saved.barberName,
      customerName: saved.customerName,
      customerEmail: saved.customerEmail,
      customerPhone: saved.customerPhone,
    });
    const dueAt = new Date(start.getTime() - 24 * 60 * 60_000);
    await database.pool.query(
      "UPDATE notification_work SET due_at=$2,content_identity=$3 WHERE id=$1",
      [created.workId, dueAt, contentIdentity],
    );
    return { dueAt, startAt: start };
  }

  async function claimBudgetDay(day: string, allocationCount: number) {
    const claimed = await database.pool.query(
      `INSERT INTO outbound_budget (day,allocation_count) VALUES ($1,$2)
       ON CONFLICT (day) DO NOTHING RETURNING day::text`,
      [day, allocationCount],
    );
    if (!claimed.rowCount)
      throw new Error(
        `Refusing to reuse an unowned outbound budget day: ${day}`,
      );
    budgetDays.add(day);
  }

  function adjacentDays(year: number) {
    const offset =
      Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 8), 16) % 300;
    const first = Date.UTC(year, 0, 1) + offset * 24 * 60 * 60_000;
    return [
      new Date(first).toISOString().slice(0, 10),
      new Date(first + 24 * 60 * 60_000).toISOString().slice(0, 10),
    ] as const;
  }

  function capturedSend() {
    return vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
        onAccepted?: (captureId: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        await input.onAccepted?.("reminder-local-capture");
        return {
          status: "captured",
          reason: null,
          captureId: "reminder-local-capture",
          invoked: true,
        };
      },
    );
  }

  function transientFailureSend() {
    return vi.fn(
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
  }

  it("dispatches at due equality and suppresses at appointment start equality", async () => {
    const due = await fixture();
    const dueSend = capturedSend();
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));

    const dueResult = await dispatchNotificationWork(
      due.bookingId,
      due.workId,
      true,
      {
        now: () => new Date(),
        send: dueSend,
      },
    );

    expect(dueResult).toBe("attempted");
    expect(dueSend).toHaveBeenCalledOnce();
    const dueEvidence = await database.pool.query(
      `SELECT w.status,w.due_at,a.attempt_number,a.outcome,a.capture_id
       FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=$1`,
      [due.workId],
    );
    expect(dueEvidence.rows).toEqual([
      {
        status: "captured",
        due_at: new Date("2026-11-01T10:00:00.000Z"),
        attempt_number: 1,
        outcome: "captured",
        capture_id: "reminder-local-capture",
      },
    ]);

    vi.setSystemTime(new Date("2026-10-31T08:00:00.000Z"));
    const atStart = await fixture();
    const startSend = capturedSend();
    vi.setSystemTime(new Date("2026-11-02T10:00:00.000Z"));

    const startResult = await dispatchNotificationWork(
      atStart.bookingId,
      atStart.workId,
      true,
      { now: () => new Date(), send: startSend },
    );

    expect(startResult).toBe("suppressed");
    expect(startSend).not.toHaveBeenCalled();
    const startEvidence = await database.pool.query(
      `SELECT w.status,w.reason,count(a.id)::int AS attempts
       FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=$1 GROUP BY w.id`,
      [atStart.workId],
    );
    expect(startEvidence.rows).toEqual([
      {
        status: "suppressed",
        reason: "work_no_longer_eligible",
        attempts: 0,
      },
    ]);
  });

  it("rechecks appointment start at the final authorization clock sample", async () => {
    const created = await fixture();
    const send = capturedSend();
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-11-02T09:59:59.999Z"))
      .mockReturnValueOnce(new Date("2026-11-02T09:59:59.999Z"))
      .mockReturnValueOnce(new Date("2026-11-02T10:00:00.000Z"));

    const result = await dispatchNotificationWork(
      created.bookingId,
      created.workId,
      true,
      { now, send },
    );

    expect(result).toBe("suppressed");
    expect(send).not.toHaveBeenCalled();
    const evidence = await database.pool.query(
      `SELECT w.status,w.reason,count(a.id)::int AS attempts
       FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=$1 GROUP BY w.id`,
      [created.workId],
    );
    expect(evidence.rows).toEqual([
      {
        status: "suppressed",
        reason: "work_no_longer_eligible",
        attempts: 0,
      },
    ]);
  });

  it.each([
    ["available", 17],
    ["exhausted", 100],
  ] as const)(
    "does not reserve or send when the %s budget lock lasts until appointment start",
    async (_budgetState, allocationCount) => {
      const created = await fixture();
      const [oldDay, newDay] = adjacentDays(2040);
      await shiftScheduleTo(created, `${newDay}T10:00:00.000Z`);
      await claimBudgetDay(oldDay, allocationCount);
      await claimBudgetDay(newDay, 0);
      const dayBefore = await database.pool.query(
        "SELECT allocation_count FROM outbound_budget WHERE day=$1",
        [oldDay],
      );
      const startDayBefore = await database.pool.query(
        "SELECT allocation_count FROM outbound_budget WHERE day=$1",
        [newDay],
      );
      const baselineStartDay = Number(
        startDayBefore.rows[0]?.allocation_count ?? 0,
      );

      const blocker = await database.pool.connect();
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT day FROM outbound_budget WHERE day=$1 FOR UPDATE",
        [oldDay],
      );

      let now = new Date(`${oldDay}T10:00:00.000Z`);
      const send = capturedSend();
      const dispatch = dispatchNotificationWork(
        created.bookingId,
        created.workId,
        true,
        { now: () => new Date(now), send },
      );

      try {
        const deadline = performance.now() + 5_000;
        let blocked = false;
        let attempts = 0;
        while (performance.now() < deadline && attempts < 250) {
          attempts++;
          const contention = await database.pool.query(
            `SELECT 1 FROM pg_stat_activity
           WHERE wait_event_type='Lock'
             AND query ILIKE '%outbound_budget%'
             AND cardinality(pg_blocking_pids(pid)) > 0 LIMIT 1`,
          );
          if (contention.rowCount) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
        now = new Date(`${newDay}T10:00:00.000Z`);
      } finally {
        await blocker.query("COMMIT");
        blocker.release();
      }

      expect(await dispatch).toBe("suppressed");
      expect(send).not.toHaveBeenCalled();
      const evidence = await database.pool.query(
        `SELECT w.status,w.reason,count(a.id)::int AS attempts
       FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=$1 GROUP BY w.id`,
        [created.workId],
      );
      expect(evidence.rows).toEqual([
        {
          status: "suppressed",
          reason: "work_no_longer_eligible",
          attempts: 0,
        },
      ]);
      const dayAfter = await database.pool.query(
        "SELECT allocation_count FROM outbound_budget WHERE day=$1",
        [oldDay],
      );
      const startDayAfter = await database.pool.query(
        "SELECT allocation_count FROM outbound_budget WHERE day=$1",
        [newDay],
      );
      expect(dayAfter.rows).toEqual(dayBefore.rows);
      expect(Number(startDayAfter.rows[0]?.allocation_count ?? 0)).toBe(
        baselineStartDay,
      );
    },
  );

  it.each([
    ["available", 17],
    ["exhausted", 100],
  ] as const)(
    "authorizes a due reminder on the new UTC day after the %s budget row lock crosses midnight",
    async (_budgetState, allocationCount) => {
      const created = await fixture();
      const [oldDay, newDay] = adjacentDays(2041);
      await shiftScheduleTo(created, `${newDay}T10:00:00.000Z`);
      await claimBudgetDay(oldDay, allocationCount);
      await claimBudgetDay(newDay, 7);
      const send = capturedSend();
      let now = new Date(`${oldDay}T23:59:59.000Z`);

      const blocker = await database.pool.connect();
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT day FROM outbound_budget WHERE day=$1 FOR UPDATE",
        [oldDay],
      );
      const dispatch = dispatchNotificationWork(
        created.bookingId,
        created.workId,
        true,
        { now: () => new Date(now), send },
      );

      try {
        const deadline = performance.now() + 5_000;
        let blocked = false;
        let attempts = 0;
        while (performance.now() < deadline && attempts < 250) {
          attempts++;
          const contention = await database.pool.query(
            `SELECT 1 FROM pg_stat_activity
             WHERE wait_event_type='Lock'
               AND query ILIKE '%outbound_budget%'
               AND cardinality(pg_blocking_pids(pid)) > 0 LIMIT 1`,
          );
          if (contention.rowCount) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
        now = new Date(`${newDay}T00:00:01.000Z`);
      } finally {
        await blocker.query("COMMIT");
        blocker.release();
      }

      expect(await dispatch).toBe("attempted");
      expect(send).toHaveBeenCalledOnce();
      const evidence = await database.pool.query(
        `SELECT w.status,w.reason,a.attempt_number,a.budget_day::text AS "budgetDay"
         FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
         WHERE w.id=$1`,
        [created.workId],
      );
      expect(evidence.rows).toEqual([
        {
          status: "captured",
          reason: null,
          attempt_number: 1,
          budgetDay: newDay,
        },
      ]);
      const budgets = await database.pool.query(
        "SELECT day::text,allocation_count FROM outbound_budget WHERE day=ANY($1::date[]) ORDER BY day",
        [[oldDay, newDay]],
      );
      expect(budgets.rows).toEqual([
        { day: oldDay, allocation_count: allocationCount },
        { day: newDay, allocation_count: 8 },
      ]);
    },
  );

  it("authorizes an existing confirmation on the new UTC day after its budget row lock crosses midnight", async () => {
    const created = await fixture();
    const [oldDay, newDay] = adjacentDays(2042);
    await shiftScheduleTo(created, `${newDay}T10:00:00.000Z`);
    await claimBudgetDay(oldDay, 23);
    await claimBudgetDay(newDay, 4);
    const confirmation = await database.pool.query(
      `SELECT id FROM notification_work
       WHERE booking_id=$1 AND kind='customer_confirmation' AND channel='email'`,
      [created.bookingId],
    );
    expect(confirmation.rowCount).toBe(1);
    const booking = await database.pool.query(
      `SELECT id,start_at AS "startAt",end_at AS "endAt",
        service_name AS "serviceName",service_price_usd AS "servicePriceUsd",
        service_duration_minutes AS "serviceDurationMinutes",barber_name AS "barberName",
        customer_name AS "customerName",customer_email AS "customerEmail",
        customer_phone AS "customerPhone"
       FROM bookings WHERE id=$1`,
      [created.bookingId],
    );
    const savedBooking = booking.rows[0];
    const contentIdentity = notificationContentIdentity({
      id: savedBooking.id,
      startAt: savedBooking.startAt,
      endAt: savedBooking.endAt,
      serviceName: savedBooking.serviceName,
      servicePriceUsd: savedBooking.servicePriceUsd,
      serviceDurationMinutes: savedBooking.serviceDurationMinutes,
      barberName: savedBooking.barberName,
      customerName: savedBooking.customerName,
      customerEmail: savedBooking.customerEmail,
      customerPhone: savedBooking.customerPhone,
    });
    await database.pool.query(
      "UPDATE notification_work SET content_identity=$2 WHERE id=$1",
      [confirmation.rows[0].id, contentIdentity],
    );
    const send = capturedSend();
    let now = new Date(`${oldDay}T23:59:59.000Z`);

    const blocker = await database.pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT day FROM outbound_budget WHERE day=$1 FOR UPDATE",
      [oldDay],
    );
    const dispatch = dispatchNotificationWork(
      created.bookingId,
      confirmation.rows[0].id as string,
      true,
      { now: () => new Date(now), send },
    );

    try {
      const deadline = performance.now() + 5_000;
      let blocked = false;
      let attempts = 0;
      while (performance.now() < deadline && attempts < 250) {
        attempts++;
        const contention = await database.pool.query(
          `SELECT 1 FROM pg_stat_activity
           WHERE wait_event_type='Lock'
             AND query ILIKE '%outbound_budget%'
             AND cardinality(pg_blocking_pids(pid)) > 0 LIMIT 1`,
        );
        if (contention.rowCount) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      now = new Date(`${newDay}T00:00:01.000Z`);
    } finally {
      await blocker.query("COMMIT");
      blocker.release();
    }

    expect(await dispatch).toBe("attempted");
    expect(send).toHaveBeenCalledOnce();
    const attempt = await database.pool.query(
      `SELECT a.budget_day::text AS "budgetDay",a.attempt_number,w.status
       FROM notification_attempts a JOIN notification_work w ON w.id=a.work_id
       WHERE w.id=$1`,
      [confirmation.rows[0].id],
    );
    expect(attempt.rows).toEqual([
      { budgetDay: newDay, attempt_number: 1, status: "captured" },
    ]);
    const budgets = await database.pool.query(
      "SELECT day::text,allocation_count FROM outbound_budget WHERE day=ANY($1::date[]) ORDER BY day",
      [[oldDay, newDay]],
    );
    expect(budgets.rows).toEqual([
      { day: oldDay, allocation_count: 23 },
      { day: newDay, allocation_count: 5 },
    ]);
  });

  it("keeps a future reminder pending when direct initial dispatch runs early", async () => {
    const created = await fixture();
    const beforeBudget = await database.pool.query(
      "SELECT allocation_count FROM outbound_budget WHERE day='2026-10-31'",
    );
    if (!beforeBudget.rows.length) budgetDays.add("2026-10-31");
    const beforeCount = Number(beforeBudget.rows[0]?.allocation_count ?? 0);
    const send = capturedSend();

    await dispatchInitialBookingNotifications(created.bookingId, {
      now: () => new Date(),
      send,
    });

    expect(send).toHaveBeenCalledTimes(2);
    const reminder = await database.pool.query(
      `SELECT w.status,w.due_at,count(a.id)::int AS attempts
       FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=$1 GROUP BY w.id`,
      [created.workId],
    );
    expect(reminder.rows).toEqual([
      {
        status: "not_attempted",
        due_at: new Date("2026-11-01T10:00:00.000Z"),
        attempts: 0,
      },
    ]);
    const afterBudget = await database.pool.query(
      "SELECT allocation_count FROM outbound_budget WHERE day='2026-10-31'",
    );
    expect(
      Number(afterBudget.rows[0]?.allocation_count ?? 0) - beforeCount,
    ).toBe(2);
  });

  it("selects due reminders after excluding older future reminders before the limit", async () => {
    const fixtures = [];
    for (let index = 0; index < 6; index++) fixtures.push(await fixture());
    const reminderIds = fixtures.map((row) => row.workId);
    await database.pool.query(
      `UPDATE notification_work SET status='captured'
       WHERE booking_id=ANY($1::uuid[]) AND kind IN ('customer_confirmation','owner_alert')`,
      [fixtures.map((row) => row.bookingId)],
    );
    for (const [index, row] of fixtures.entries()) {
      await database.pool.query(
        `UPDATE notification_work SET created_at=$2,due_at=$3 WHERE id=$1`,
        [
          row.workId,
          new Date(
            `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
          ),
          index === fixtures.length - 1
            ? new Date("2026-11-01T10:00:00.000Z")
            : new Date("2026-11-01T10:10:00.000Z"),
        ],
      );
    }
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
    vi.stubEnv("NODE_ENV", "production");
    const send = capturedSend();
    let result;
    try {
      result = await processNotificationRetries({
        now: () => new Date(),
        send,
      });
    } finally {
      vi.unstubAllEnvs();
    }

    expect(result).toMatchObject({ processed: 1, attempted: 1 });
    expect(send).toHaveBeenCalledOnce();
    const states = await database.pool.query(
      `SELECT id,status FROM notification_work WHERE id=ANY($1::uuid[]) ORDER BY id`,
      [reminderIds],
    );
    expect(states.rows.filter((row) => row.status === "captured")).toHaveLength(
      1,
    );
    expect(
      states.rows.filter((row) => row.status === "not_attempted"),
    ).toHaveLength(5);
  });

  it("retries before start while keeping due time separate, then suppresses at start", async () => {
    const retryable = await fixture();
    const firstFailure = transientFailureSend();
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
    await dispatchNotificationWork(
      retryable.bookingId,
      retryable.workId,
      true,
      {
        now: () => new Date(),
        send: firstFailure,
      },
    );
    const retrySchedule = await database.pool.query(
      "SELECT due_at,next_attempt_at FROM notification_work WHERE id=$1",
      [retryable.workId],
    );
    expect(retrySchedule.rows).toEqual([
      {
        due_at: new Date("2026-11-01T10:00:00.000Z"),
        next_attempt_at: new Date("2026-11-01T10:10:00.000Z"),
      },
    ]);

    const successfulRetry = capturedSend();
    vi.setSystemTime(new Date("2026-11-01T10:10:00.000Z"));
    const retryResult = await dispatchNotificationWork(
      retryable.bookingId,
      retryable.workId,
      true,
      { now: () => new Date(), send: successfulRetry },
    );
    expect(retryResult).toBe("attempted");
    expect(successfulRetry).toHaveBeenCalledOnce();

    vi.setSystemTime(new Date("2026-10-31T08:00:00.000Z"));
    const atStart = await fixture();
    const failedAtDue = transientFailureSend();
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
    await dispatchNotificationWork(atStart.bookingId, atStart.workId, true, {
      now: () => new Date(),
      send: failedAtDue,
    });
    const afterStartSend = capturedSend();
    vi.setSystemTime(new Date("2026-11-02T10:00:00.000Z"));
    const afterStartResult = await dispatchNotificationWork(
      atStart.bookingId,
      atStart.workId,
      true,
      { now: () => new Date(), send: afterStartSend },
    );
    expect(afterStartResult).toBe("suppressed");
    expect(afterStartSend).not.toHaveBeenCalled();
    const attempts = await database.pool.query(
      `SELECT w.status,w.due_at,w.next_attempt_at,count(a.id)::int AS attempts
       FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=$1 GROUP BY w.id`,
      [atStart.workId],
    );
    expect(attempts.rows).toEqual([
      {
        status: "suppressed",
        due_at: new Date("2026-11-01T10:00:00.000Z"),
        next_attempt_at: null,
        attempts: 1,
      },
    ]);
  });

  it("stops a transient reminder after the third automatic attempt", async () => {
    const created = await fixture();
    const reject = transientFailureSend();
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
    expect(
      await dispatchNotificationWork(created.bookingId, created.workId, true, {
        now: () => new Date(),
        send: reject,
      }),
    ).toBe("attempted");
    vi.setSystemTime(new Date("2026-11-01T10:10:00.000Z"));
    await dispatchNotificationWork(created.bookingId, created.workId, true, {
      now: () => new Date(),
      send: reject,
    });
    vi.setSystemTime(new Date("2026-11-01T10:30:00.000Z"));
    await dispatchNotificationWork(created.bookingId, created.workId, true, {
      now: () => new Date(),
      send: reject,
    });
    vi.setSystemTime(new Date("2026-11-01T10:50:00.000Z"));
    const afterCap = await dispatchNotificationWork(
      created.bookingId,
      created.workId,
      true,
      { now: () => new Date(), send: reject },
    );
    const evidence = await database.pool.query(
      `SELECT w.status,w.due_at,w.next_attempt_at,
        array_agg(a.attempt_number ORDER BY a.attempt_number) AS attempts
       FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=$1 GROUP BY w.id`,
      [created.workId],
    );

    expect(afterCap).toBe("skipped");
    expect(reject).toHaveBeenCalledTimes(3);
    expect(evidence.rows).toEqual([
      {
        status: "failed",
        due_at: new Date("2026-11-01T10:00:00.000Z"),
        next_attempt_at: null,
        attempts: [1, 2, 3],
      },
    ]);
  });

  it.each([
    ["permanent rejection", "failed", "permanent_rejection"],
    ["unknown transport outcome", "unknown", "transport_interrupted"],
  ] as const)(
    "does not retry a reminder after %s",
    async (_label, status, reason) => {
      const created = await fixture();
      vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
      const terminalSend = vi.fn(
        async (input: {
          onInvoked: () => Promise<void>;
        }): Promise<MailpitTransportResult> => {
          await input.onInvoked();
          return { status, reason, captureId: null, invoked: true };
        },
      );
      await dispatchNotificationWork(created.bookingId, created.workId, true, {
        now: () => new Date(),
        send: terminalSend,
      });
      vi.setSystemTime(new Date("2026-11-01T10:30:00.000Z"));
      const afterTerminal = await dispatchNotificationWork(
        created.bookingId,
        created.workId,
        true,
        { now: () => new Date(), send: terminalSend },
      );
      const evidence = await database.pool.query(
        `SELECT w.status,w.reason,w.next_attempt_at,
          count(a.id)::int AS attempts FROM notification_work w
         LEFT JOIN notification_attempts a ON a.work_id=w.id
         WHERE w.id=$1 GROUP BY w.id`,
        [created.workId],
      );

      expect(afterTerminal).toBe("skipped");
      expect(terminalSend).toHaveBeenCalledOnce();
      expect(evidence.rows).toEqual([
        { status, reason, next_attempt_at: null, attempts: 1 },
      ]);
    },
  );

  it("allows only one concurrent worker to reserve the same reminder", async () => {
    const created = await fixture();
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
    let entered!: () => void;
    const sendEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
        onAccepted?: (captureId: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        entered();
        await barrier;
        await input.onAccepted?.("single-worker-capture");
        return {
          status: "captured",
          reason: null,
          captureId: "single-worker-capture",
          invoked: true,
        };
      },
    );
    const dependencies = { now: () => new Date(), send };
    const first = dispatchNotificationWork(
      created.bookingId,
      created.workId,
      true,
      dependencies,
    );
    await sendEntered;
    const second = await dispatchNotificationWork(
      created.bookingId,
      created.workId,
      true,
      dependencies,
    );
    release();
    const firstResult = await first;

    expect(firstResult).toBe("attempted");
    expect(second).toBe("skipped");
    expect(send).toHaveBeenCalledOnce();
    const evidence = await database.pool.query(
      `SELECT w.status,count(a.id)::int AS attempts
       FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=$1 GROUP BY w.id`,
      [created.workId],
    );
    expect(evidence.rows).toEqual([{ status: "captured", attempts: 1 }]);
  });

  it("keeps a delayed old-generation capture attached to its original work", async () => {
    const created = await fixture();
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
    let entered!: () => void;
    const sendEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
        onAccepted?: (captureId: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        entered();
        await barrier;
        await input.onAccepted?.("delayed-old-generation-capture");
        return {
          status: "captured",
          reason: null,
          captureId: "delayed-old-generation-capture",
          invoked: true,
        };
      },
    );
    const oldDispatch = dispatchNotificationWork(
      created.bookingId,
      created.workId,
      true,
      { now: () => new Date(), send },
    );
    await sendEntered;
    const moved = await moveOwnerBooking(created.context, {
      bookingId: created.bookingId,
      expectedRevision: 0,
      operationKey: randomUUID()
        .replaceAll("-", "")
        .padEnd(43, "a")
        .slice(0, 43),
      serviceId: created.serviceId,
      barberId: created.barberId,
      startAt: "2026-11-02T11:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
    });
    expect(moved.success).toBe(true);
    release();
    expect(await oldDispatch).toBe("attempted");

    const work = await database.pool.query(
      `SELECT booking_revision,status,due_at FROM notification_work
       WHERE booking_id=$1 AND kind='customer_reminder' ORDER BY booking_revision`,
      [created.bookingId],
    );
    expect(work.rows).toEqual([
      {
        booking_revision: 0,
        status: "captured",
        due_at: new Date("2026-11-01T10:00:00.000Z"),
      },
      {
        booking_revision: 1,
        status: "not_attempted",
        due_at: new Date("2026-11-01T11:00:00.000Z"),
      },
    ]);
    const booking = await database.pool.query(
      "SELECT revision,start_at FROM bookings WHERE id=$1",
      [created.bookingId],
    );
    expect(booking.rows).toEqual([
      { revision: 1, start_at: new Date("2026-11-02T11:00:00.000Z") },
    ]);
  });

  it("serializes competing reminders against the final shared budget allocation", async () => {
    const first = await fixture();
    const second = await fixture();
    await shiftScheduleTo(first, "2040-01-02T10:00:00.000Z");
    await shiftScheduleTo(second, "2040-01-02T10:00:00.000Z");
    await claimBudgetDay("2040-01-01", 99);
    vi.setSystemTime(new Date("2040-01-01T10:00:00.000Z"));
    const send = capturedSend();

    const results = await Promise.all([
      dispatchNotificationWork(first.bookingId, first.workId, true, {
        now: () => new Date(),
        send,
      }),
      dispatchNotificationWork(second.bookingId, second.workId, true, {
        now: () => new Date(),
        send,
      }),
    ]);

    expect(results.sort()).toEqual(["attempted", "skipped"]);
    expect(send).toHaveBeenCalledOnce();
    const budget = await database.pool.query(
      "SELECT allocation_count FROM outbound_budget WHERE day='2040-01-01'",
    );
    expect(budget.rows).toEqual([{ allocation_count: 100 }]);
    const work = await database.pool.query(
      `SELECT w.status,count(a.id)::int AS attempts FROM notification_work w
       LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=ANY($1::uuid[]) GROUP BY w.id ORDER BY w.status`,
      [[first.workId, second.workId]],
    );
    expect(work.rows).toEqual([
      { status: "captured", attempts: 1 },
      { status: "skipped", attempts: 0 },
    ]);
  });

  it("does not replay a terminal budget skip after UTC rollover", async () => {
    const created = await fixture();
    await shiftScheduleTo(created, "2040-01-02T10:00:00.000Z");
    await claimBudgetDay("2040-01-01", 100);
    vi.setSystemTime(new Date("2040-01-01T10:00:00.000Z"));
    const send = capturedSend();
    const firstResult = await dispatchNotificationWork(
      created.bookingId,
      created.workId,
      true,
      { now: () => new Date(), send },
    );
    expect(firstResult).toBe("skipped");
    expect(send).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2040-01-02T00:00:00.000Z"));
    const nextDayResult = await dispatchNotificationWork(
      created.bookingId,
      created.workId,
      true,
      { now: () => new Date(), send },
    );
    expect(nextDayResult).toBe("skipped");
    const work = await database.pool.query(
      `SELECT w.status,w.reason,count(a.id)::int AS attempts
       FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=$1 GROUP BY w.id`,
      [created.workId],
    );
    expect(work.rows).toEqual([
      {
        status: "skipped",
        reason: "daily_budget_exhausted",
        attempts: 0,
      },
    ]);
  });

  it("continues to process an eligible reminder after the shop is unpublished", async () => {
    const created = await fixture();
    const result = await setOwnShopPublication(created.context, {
      published: false,
      expectedPublished: true,
    });
    expect(result.success).toBe(true);
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
    const send = capturedSend();

    const dispatched = await dispatchNotificationWork(
      created.bookingId,
      created.workId,
      true,
      { now: () => new Date(), send },
    );

    expect(dispatched).toBe("attempted");
    expect(send).toHaveBeenCalledOnce();
  });

  it("rechecks a mutation that acquires the shop lock before dispatch authorization", async () => {
    const created = await fixture();
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
    const lockClient = await database.pool.connect();
    await lockClient.query("BEGIN");
    await lockClient.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
      created.shopId,
    ]);
    const mutation = moveOwnerBooking(created.context, {
      bookingId: created.bookingId,
      expectedRevision: 0,
      operationKey: randomUUID()
        .replaceAll("-", "")
        .padEnd(43, "a")
        .slice(0, 43),
      serviceId: created.serviceId,
      barberId: created.barberId,
      startAt: "2026-11-02T11:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
    });
    const waitForLockWaiters = async (count: number) => {
      await vi.waitFor(
        async () => {
          const waiting = await database.pool.query(
            `SELECT count(*)::int AS count FROM pg_stat_activity
           WHERE datname=current_database() AND pid<>pg_backend_pid()
             AND wait_event_type='Lock'`,
          );
          expect(waiting.rows[0].count).toBeGreaterThanOrEqual(count);
        },
        { timeout: 10_000, interval: 25 },
      );
    };
    try {
      await waitForLockWaiters(1);
      const send = capturedSend();
      const dispatch = dispatchNotificationWork(
        created.bookingId,
        created.workId,
        true,
        { now: () => new Date(), send },
      );
      await waitForLockWaiters(2);
      await lockClient.query("COMMIT");
      const [moved, dispatchResult] = await Promise.all([mutation, dispatch]);

      expect(moved.success).toBe(true);
      expect(dispatchResult).toBe("skipped");
      expect(send).not.toHaveBeenCalled();
      const state = await database.pool.query(
        `SELECT b.revision,b.start_at,w.status,count(a.id)::int AS attempts
         FROM bookings b JOIN notification_work w ON w.booking_id=b.id
         LEFT JOIN notification_attempts a ON a.work_id=w.id
         WHERE b.id=$1 AND w.id=$2 GROUP BY b.id,w.id`,
        [created.bookingId, created.workId],
      );
      expect(state.rows).toEqual([
        {
          revision: 1,
          start_at: new Date("2026-11-02T11:00:00.000Z"),
          status: "suppressed",
          attempts: 0,
        },
      ]);
    } finally {
      await lockClient.query("ROLLBACK").catch(() => undefined);
      lockClient.release();
    }
  });

  it("fences a stale reminder claim as unknown and preserves its attempt", async () => {
    const created = await fixture();
    await database.pool.query(
      `UPDATE notification_work SET status='captured'
       WHERE booking_id=$1 AND kind IN ('customer_confirmation','owner_alert')`,
      [created.bookingId],
    );
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
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
        onAccepted?: (captureId: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        entered();
        await barrier;
        await input.onAccepted?.("late-reminder-capture");
        return {
          status: "captured",
          reason: null,
          captureId: "late-reminder-capture",
          invoked: true,
        };
      },
    );
    const inFlight = dispatchNotificationWork(
      created.bookingId,
      created.workId,
      true,
      { now: () => new Date(), send: lateSend },
    );
    await sendEntered;
    await database.pool.query(
      "UPDATE notification_work SET claimed_at=$2 WHERE id=$1",
      [created.workId, new Date("2026-11-01T10:00:00.000Z")],
    );
    vi.setSystemTime(new Date("2026-11-01T10:00:30.001Z"));
    const recovered = await processNotificationRetries({
      now: () => new Date(),
    });
    release();
    await inFlight;

    expect(recovered.recoveredUnknown).toBe(1);
    expect(lateSend).toHaveBeenCalledOnce();
    const evidence = await database.pool.query(
      `SELECT w.status,w.reason,a.id AS "attemptId",a.outcome,
        a.reason AS "attemptReason",a.capture_id AS "captureId",a.invoked_at
       FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=$1`,
      [created.workId],
    );
    expect(evidence.rows).toEqual([
      {
        status: "unknown",
        reason: "dispatch_interrupted",
        attemptId: expect.any(String),
        outcome: "unknown",
        attemptReason: "dispatch_interrupted",
        captureId: null,
        invoked_at: new Date("2026-11-01T10:00:00.000Z"),
      },
    ]);
  });

  it("reconciles a known reminder capture after start without changing its attempt identity", async () => {
    const created = await fixture();
    await database.pool.query(
      `UPDATE notification_work SET status='captured'
       WHERE booking_id=$1 AND kind IN ('customer_confirmation','owner_alert')`,
      [created.bookingId],
    );
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
    const acceptedSend = vi.fn(
      async (input: {
        onInvoked: () => Promise<void>;
        onAccepted?: (captureId: string) => Promise<void>;
      }): Promise<MailpitTransportResult> => {
        await input.onInvoked();
        await input.onAccepted?.("known-reminder-capture");
        return {
          status: "accepted",
          reason: "capture_verification_unavailable",
          captureId: "known-reminder-capture",
          invoked: true,
        };
      },
    );
    await dispatchNotificationWork(created.bookingId, created.workId, true, {
      now: () => new Date(),
      send: acceptedSend,
    });
    const before = await database.pool.query(
      `SELECT a.id,a.attempt_number,a.budget_day::text AS "budgetDay",a.capture_id,w.recipient
       FROM notification_attempts a JOIN notification_work w ON w.id=a.work_id
       WHERE a.work_id=$1`,
      [created.workId],
    );
    vi.setSystemTime(new Date("2026-11-02T10:00:00.000Z"));
    const verified = vi.fn(async () => null);
    const summary = await processNotificationRetries({
      now: () => new Date(),
      verifyCapture: verified,
    });
    const after = await database.pool.query(
      `SELECT w.status,a.id,a.attempt_number,a.budget_day::text AS "budgetDay",
        a.outcome,a.capture_id FROM notification_work w
       JOIN notification_attempts a ON a.work_id=w.id WHERE w.id=$1`,
      [created.workId],
    );
    const booking = await database.pool.query(
      "SELECT status,revision FROM bookings WHERE id=$1",
      [created.bookingId],
    );

    expect(summary.reconciled).toBe(1);
    expect(verified).toHaveBeenCalledWith({
      origin: "http://127.0.0.1:8025",
      captureId: "known-reminder-capture",
      recipient: before.rows[0].recipient,
      attemptId: before.rows[0].id,
    });
    expect(after.rows).toEqual([
      {
        status: "captured",
        id: before.rows[0].id,
        attempt_number: 1,
        budgetDay: before.rows[0].budgetDay,
        outcome: "captured",
        capture_id: "known-reminder-capture",
      },
    ]);
    expect(booking.rows).toEqual([{ status: "confirmed", revision: 0 }]);
  });
});
