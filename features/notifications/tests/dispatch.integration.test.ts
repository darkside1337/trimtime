import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { applyMigrations } from "@/db/migrate.mts";
import { openTestDatabase } from "@/tests/support/database";
import { shopInput } from "@/tests/support/shops";
import { notificationBookingInput } from "@/tests/support/notifications";
import type { MailpitTransportResult } from "../mailpit";
import { notificationContentIdentity } from "../content-identity";

const captured: MailpitTransportResult = {
  status: "captured",
  reason: null,
  captureId: "local-capture",
  invoked: true,
};
type SendInput = { message: { to: string }; onInvoked: () => Promise<void> };

describe("initial notification dispatch", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let closeAppPool: (() => Promise<void>) | undefined;
  let testAuth: typeof import("@/tests/support/auth").testAuth;
  let createShop: typeof import("@/features/shops/mutations").createShop;
  let saveBarber: typeof import("@/features/barbers/mutations").saveBarber;
  let saveService: typeof import("@/features/catalog/mutations").saveService;
  let saveShopSchedule: typeof import("@/features/availability/mutations").saveShopSchedule;
  let setOwnShopPublication: typeof import("@/features/shops/mutations").setOwnShopPublication;
  let createPublicBooking: typeof import("@/features/bookings/mutations").createPublicBooking;
  let createOwnerBooking: typeof import("@/features/bookings/mutations").createOwnerBooking;
  let getManagedBooking: typeof import("@/features/bookings/queries").getManagedBooking;
  let dispatch: typeof import("../dispatch").dispatchInitialBookingNotifications;
  let getActivity: typeof import("../queries").getOwnNotificationActivity;
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
    vi.setSystemTime(new Date("2026-11-02T08:00:00Z"));
    await applyMigrations(database.pool, "db/migrations");
    ({ testAuth } = await import("@/tests/support/auth"));
    ({ createShop, setOwnShopPublication } =
      await import("@/features/shops/mutations"));
    ({ saveBarber } = await import("@/features/barbers/mutations"));
    ({ saveService } = await import("@/features/catalog/mutations"));
    ({ saveShopSchedule } = await import("@/features/availability/mutations"));
    ({ createPublicBooking } = await import("@/features/bookings/mutations"));
    ({ createOwnerBooking } = await import("@/features/bookings/mutations"));
    ({ getManagedBooking } = await import("@/features/bookings/queries"));
    ({ dispatchInitialBookingNotifications: dispatch } =
      await import("../dispatch"));
    ({ getOwnNotificationActivity: getActivity } = await import("../queries"));
    const { pool: appPool } = await import("@/db");
    appPool.options.max = 8;
    closeAppPool = () => appPool.end();
  });

  afterEach(async () => {
    process.env.EMAIL_MODE = "mailpit";
    vi.setSystemTime(new Date("2026-11-02T08:00:00Z"));
    if (ownerIds.length) {
      await database.pool.query(
        "DELETE FROM shops WHERE owner_id = ANY($1::text[])",
        [ownerIds],
      );
      const helpers = (await testAuth.$context).test;
      await Promise.all(ownerIds.map((id) => helpers.deleteUser(id)));
      ownerIds.length = 0;
    }
    if (budgetDays.size) {
      await database.pool.query(
        "DELETE FROM outbound_budget WHERE day = ANY($1::date[])",
        [[...budgetDays]],
      );
      budgetDays.clear();
    }
  });

  afterAll(async () => {
    vi.useRealTimers();
    await database?.pool.query(
      'DELETE FROM "shops" WHERE owner_id = ANY($1::text[])',
      [ownerIds],
    );
    if (budgetDays.size) {
      await database?.pool.query(
        "DELETE FROM outbound_budget WHERE day = ANY($1::date[])",
        [[...budgetDays]],
      );
    }
    await Promise.all(
      ownerIds.map((id) =>
        testAuth.$context.then(({ test }) => test.deleteUser(id)),
      ),
    );
    await closeAppPool?.();
    await database?.pool.end();
  });

  async function fixture() {
    const helpers = (await testAuth.$context).test;
    const owner = await helpers.saveUser(
      helpers.createUser({
        email: `dispatch-${randomUUID()}@example.test`,
        name: "Dispatch Owner",
      }),
    );
    ownerIds.push(owner.id);
    const context = { userId: owner.id };
    const shop = await createShop(
      context,
      shopInput({
        subdomain: `send-${randomUUID().slice(0, 8)}`,
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
    const row = (
      await database.pool.query("SELECT id FROM shops WHERE owner_id=$1", [
        owner.id,
      ])
    ).rows[0];
    return {
      owner,
      context,
      shopId: row.id as string,
      barberId: barber.data.id,
      serviceId: service.data.id,
    };
  }

  async function booking(
    ids: Awaited<ReturnType<typeof fixture>>,
    email: string,
  ) {
    const result = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(ids.serviceId, ids.barberId, email),
    );
    if (!result.success)
      throw new Error(`Booking fixture failed: ${result.error.code}`);
    return result.data;
  }

  async function ownerBooking(
    ids: Awaited<ReturnType<typeof fixture>>,
    email: string,
  ) {
    const result = await createOwnerBooking(ids.context, {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T10:07:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: { name: "Manual Guest", email, whatsappOptIn: false },
      recoveryKey: randomUUID()
        .replaceAll("-", "")
        .padEnd(43, "a")
        .slice(0, 43),
    });
    if (!result.success)
      throw new Error(`Owner booking fixture failed: ${result.error.code}`);
    return result.data;
  }

  async function setBudget(day: string, count: number) {
    if (budgetDays.has(day)) {
      await database.pool.query(
        "UPDATE outbound_budget SET allocation_count=$2 WHERE day=$1",
        [day, count],
      );
      return;
    }
    const inserted = await database.pool.query(
      "INSERT INTO outbound_budget (day, allocation_count) VALUES ($1,$2) ON CONFLICT (day) DO NOTHING RETURNING day::text",
      [day, count],
    );
    if (!inserted.rowCount)
      throw new Error(`Refusing to reuse pre-existing budget day ${day}.`);
    budgetDays.add(day);
  }

  async function rows(ids: Awaited<ReturnType<typeof fixture>>) {
    const result = await getActivity(ids.context);
    if (!result.success) throw new Error("Activity query failed.");
    return result.data.rows;
  }

  async function dispatchTracked(
    bookingId: string,
    options: Parameters<typeof dispatch>[1] = {},
  ) {
    const now = options.now?.() ?? new Date("2026-11-03T12:00:00Z");
    const day = now.toISOString().slice(0, 10);
    if (!budgetDays.has(day)) {
      const inserted = await database.pool.query(
        "INSERT INTO outbound_budget (day, allocation_count) VALUES ($1,0) ON CONFLICT (day) DO NOTHING RETURNING day::text",
        [day],
      );
      if (!inserted.rowCount)
        throw new Error(`Refusing to use pre-existing budget day ${day}.`);
      budgetDays.add(day);
    }
    return dispatch(bookingId, { ...options, now: options.now ?? (() => now) });
  }

  it("dispatches customer and owner messages sequentially and persists capture evidence", async () => {
    const ids = await fixture();
    const created = await booking(ids, "ada@example.test");
    const day = "2026-11-03";
    await database.pool.query(
      `INSERT INTO notification_work (id, booking_id, kind, channel, status, recipient, content_identity)
       VALUES ($1,$2,'customer_confirmation','whatsapp','not_attempted','+213555010101','test-only')`,
      [randomUUID(), created.bookingId],
    );
    const calls: string[] = [];
    await dispatchTracked(created.bookingId, {
      now: () => new Date(`${day}T12:00:00Z`),
      send: async ({ message, onInvoked }) => {
        calls.push(message.to);
        await onInvoked();
        return { ...captured, captureId: `capture-${calls.length}` };
      },
    });
    expect(calls).toEqual(["ada@example.test", ids.owner.email]);
    expect(
      (await rows(ids))
        .filter((row) => row.channel === "email")
        .map((row) => row.status),
    ).toEqual(["captured", "captured"]);
    expect(
      (await rows(ids))
        .filter((row) => row.channel === "email")
        .every((row) => row.attempt?.invokedAt && row.attempt.captureId),
    ).toBe(true);
    expect(
      (await rows(ids)).find((row) => row.channel === "whatsapp"),
    ).toMatchObject({
      status: "not_attempted",
      attempt: null,
    });
    expect(created.manageUrl).toContain("/manage/");
    const token = created.manageUrl.split("/manage/")[1];
    await expect(
      getManagedBooking({ shopId: ids.shopId }, token),
    ).resolves.toMatchObject({ success: true, data: { status: "confirmed" } });
  });

  it.each(["captured", "accepted"] as const)(
    "dispatches owner-created email work with %s status and no owner alert",
    async (status) => {
      const ids = await fixture();
      const created = await ownerBooking(ids, `${status}-manual@example.test`);
      const calls: string[] = [];
      await dispatchTracked(created.bookingId, {
        send: async ({ message, onInvoked }) => {
          calls.push(message.to);
          await onInvoked();
          return status === "captured"
            ? captured
            : {
                status: "accepted",
                reason: "capture_verification_unavailable",
                captureId: null,
                invoked: true,
              };
        },
      });
      expect(calls).toEqual([`${status}-manual@example.test`]);
      expect(
        (await rows(ids)).map(({ kind, channel, status: workStatus }) => ({
          kind,
          channel,
          status: workStatus,
        })),
      ).toEqual([{ kind: "customer_confirmation", channel: "email", status }]);
      expect(
        (
          await database.pool.query("SELECT status FROM bookings WHERE id=$1", [
            created.bookingId,
          ])
        ).rows,
      ).toEqual([{ status: "confirmed" }]);
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS count FROM notification_attempts a JOIN notification_work w ON w.id=a.work_id WHERE w.booking_id=$1",
            [created.bookingId],
          )
        ).rows[0].count,
      ).toBe(1);
    },
  );

  it("recovers duplicate owner submissions without allocating a second email attempt", async () => {
    const ids = await fixture();
    const recoveryKey = randomUUID()
      .replaceAll("-", "")
      .padEnd(43, "a")
      .slice(0, 43);
    const payload = {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T10:07:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: {
        name: "Manual Guest",
        email: "duplicate-manual@example.test",
        whatsappOptIn: false,
      },
      recoveryKey,
    };
    const [first, duplicate] = await Promise.all([
      createOwnerBooking(ids.context, payload),
      createOwnerBooking(ids.context, payload),
    ]);
    expect(first.success).toBe(true);
    expect(duplicate).toEqual(first);
    if (!first.success) return;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const send = async ({ onInvoked }: SendInput) => {
      calls++;
      await onInvoked();
      await gate;
      return captured;
    };
    const dispatched = dispatchTracked(first.data.bookingId, { send });
    try {
      await vi.waitFor(async () => {
        expect((await rows(ids))[0].status).toBe("sending");
      });
      await dispatchTracked(first.data.bookingId, { send });
    } finally {
      release();
    }
    await dispatched;
    expect(calls).toBe(1);
    expect((await rows(ids)).map(({ status }) => status)).toEqual(["captured"]);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM notification_attempts a JOIN notification_work w ON w.id=a.work_id WHERE w.booking_id=$1",
          [first.data.bookingId],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM bookings WHERE id=$1",
          [first.data.bookingId],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it.each(["rejected", "interrupted"] as const)(
    "keeps an owner-created booking and truthful work status when email is %s",
    async (outcome) => {
      const ids = await fixture();
      const created = await ownerBooking(ids, `${outcome}-manual@example.test`);
      let calls = 0;
      await dispatchTracked(created.bookingId, {
        send: async ({ onInvoked }) => {
          calls++;
          await onInvoked();
          if (outcome === "interrupted")
            throw new Error("transport interrupted");
          return {
            status: "failed",
            reason: "permanent_rejection",
            captureId: null,
            invoked: true,
          };
        },
      });
      expect(calls).toBe(1);
      expect(
        (await rows(ids)).map(({ status, reason }) => ({ status, reason })),
      ).toEqual([
        outcome === "interrupted"
          ? { status: "unknown", reason: "transport_interrupted" }
          : { status: "failed", reason: "permanent_rejection" },
      ]);
      expect(
        (
          await database.pool.query("SELECT status FROM bookings WHERE id=$1", [
            created.bookingId,
          ])
        ).rows,
      ).toEqual([{ status: "confirmed" }]);
    },
  );

  it("keeps an owner-created booking saved when email budget is exhausted", async () => {
    const ids = await fixture();
    const created = await ownerBooking(ids, "budget-manual@example.test");
    await setBudget("2026-11-03", 100);
    let calls = 0;
    await dispatchTracked(created.bookingId, {
      send: async () => {
        calls++;
        return captured;
      },
    });
    expect(calls).toBe(0);
    expect(
      (await rows(ids)).map(({ status, reason, attempt }) => ({
        status,
        reason,
        attempt,
      })),
    ).toEqual([
      { status: "skipped", reason: "daily_budget_exhausted", attempt: null },
    ]);
    expect(
      (
        await database.pool.query("SELECT status FROM bookings WHERE id=$1", [
          created.bookingId,
        ])
      ).rows,
    ).toEqual([{ status: "confirmed" }]);
  });

  it.each([
    ["customer", "owner"],
    ["owner", "customer"],
  ] as const)(
    "continues to the %s-independent message when the %s message rejects",
    async (failed, succeeding) => {
      const ids = await fixture();
      const created = await booking(ids, `${failed}@example.test`);
      const failRecipient =
        failed === "customer" ? `${failed}@example.test` : ids.owner.email;
      await dispatchTracked(created.bookingId, {
        send: async ({ message, onInvoked }) => {
          await onInvoked();
          return message.to === failRecipient
            ? {
                status: "failed",
                reason: "permanent_rejection",
                captureId: null,
                invoked: true,
              }
            : captured;
        },
      });
      const activity = await rows(ids);
      expect(
        activity.find((row) => row.recipient === failRecipient)?.status,
      ).toBe("failed");
      expect(
        activity.find((row) => row.recipient !== failRecipient)?.status,
      ).toBe("captured");
      const successfulRecipient =
        succeeding === "owner" ? ids.owner.email : `${failed}@example.test`;
      expect(
        activity.find((row) => row.recipient === successfulRecipient)?.status,
      ).toBe("captured");
    },
  );

  it("deduplicates concurrent dispatch calls for the same booking", async () => {
    const ids = await fixture();
    const created = await booking(ids, "race@example.test");
    await setBudget("2026-11-03", 0);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const send = async ({ message, onInvoked }: SendInput) => {
      calls.push(message.to);
      await onInvoked();
      await gate;
      return captured;
    };
    const first = dispatchTracked(created.bookingId, { send });
    const second = dispatchTracked(created.bookingId, { send });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    release();
    await Promise.all([first, second]);
    expect(calls).toHaveLength(2);
    expect(new Set(calls).size).toBe(2);
    expect((await rows(ids)).every((row) => row.status === "captured")).toBe(
      true,
    );
  });

  it("allocates only the last unit across concurrent shops and marks the loser skipped", async () => {
    const first = await fixture();
    const second = await fixture();
    const a = await booking(first, "last-a@example.test");
    const b = await booking(second, "last-b@example.test");
    const day = "2026-11-03";
    await setBudget(day, 99);
    const results: string[] = [];
    let releaseTransport!: () => void;
    const transportGate = new Promise<void>((resolve) => {
      releaseTransport = resolve;
    });
    const send = async ({ onInvoked }: SendInput) => {
      results.push("authorized");
      await onInvoked();
      await transportGate;
      return captured;
    };
    const now = () => new Date(`${day}T12:00:00Z`);
    const dispatches = Promise.all([
      dispatchTracked(a.bookingId, { send, now }),
      dispatchTracked(b.bookingId, { send, now }),
    ]);
    await vi.waitFor(async () => {
      expect(results).toHaveLength(1);
      const state = await database.pool.query(
        "SELECT count(*) FILTER (WHERE status='skipped')::int AS skipped, count(*) FILTER (WHERE status='sending')::int AS sending FROM notification_work WHERE booking_id=ANY($1::uuid[])",
        [[a.bookingId, b.bookingId]],
      );
      expect(state.rows[0]).toMatchObject({ skipped: 2, sending: 1 });
    });
    releaseTransport();
    await dispatches;
    expect(results).toHaveLength(1);
    expect(
      (
        await database.pool.query(
          "SELECT allocation_count FROM outbound_budget WHERE day=$1",
          [day],
        )
      ).rows[0].allocation_count,
    ).toBe(100);
    const all = [...(await rows(first)), ...(await rows(second))];
    expect(all.filter((row) => row.status === "captured")).toHaveLength(1);
    expect(
      all.filter((row) => row.reason === "daily_budget_exhausted"),
    ).toHaveLength(3);
  });

  it("consumes the final two allocations for one booking and skips a third message", async () => {
    const one = await fixture();
    const two = await fixture();
    const a = await booking(one, "two-left@example.test");
    const b = await booking(two, "third@example.test");
    const day = "2026-11-04";
    await setBudget(day, 98);
    const now = () => new Date(`${day}T12:00:00Z`);
    await dispatchTracked(a.bookingId, {
      now,
      send: async ({ onInvoked }) => {
        await onInvoked();
        return captured;
      },
    });
    await dispatchTracked(b.bookingId, {
      now,
      send: async ({ onInvoked }) => {
        await onInvoked();
        return captured;
      },
    });
    expect(
      (
        await database.pool.query(
          "SELECT allocation_count FROM outbound_budget WHERE day=$1",
          [day],
        )
      ).rows[0].allocation_count,
    ).toBe(100);
    expect((await rows(one)).every((row) => row.status === "captured")).toBe(
      true,
    );
    expect(
      (await rows(one)).every((row) => row.attempt?.budgetDay === day),
    ).toBe(true);
    expect((await rows(two)).map((row) => row.status)).toEqual([
      "skipped",
      "skipped",
    ]);
    let replayCalls = 0;
    await dispatchTracked(b.bookingId, {
      now: () => new Date("2026-11-05T00:00:00Z"),
      send: async () => {
        replayCalls++;
        return captured;
      },
    });
    expect(replayCalls).toBe(0);
    expect(
      (await rows(two)).map(({ status, reason }) => ({ status, reason })),
    ).toEqual([
      { status: "skipped", reason: "daily_budget_exhausted" },
      { status: "skipped", reason: "daily_budget_exhausted" },
    ]);
  });

  it("uses literal UTC authorization days immediately before and at midnight", async () => {
    const before = await fixture();
    const at = await fixture();
    const first = await booking(before, "before-midnight@example.test");
    const second = await booking(at, "at-midnight@example.test");
    const day = "2026-11-05";
    const nextDay = "2026-11-06";
    for (const [bookingId, instant] of [
      [first.bookingId, `${day}T23:59:59Z`],
      [second.bookingId, `${nextDay}T00:00:00Z`],
    ] as const) {
      await dispatchTracked(bookingId, {
        now: () => new Date(instant),
        send: async ({ onInvoked }) => {
          await onInvoked();
          return captured;
        },
      });
    }
    expect((await rows(before)).map((row) => row.attempt?.budgetDay)).toEqual([
      day,
      day,
    ]);
    expect((await rows(at)).map((row) => row.attempt?.budgetDay)).toEqual([
      nextDay,
      nextDay,
    ]);
  });

  it("keeps a reservation-only crash unknown in read presentation and refuses another send", async () => {
    const ids = await fixture();
    const created = await booking(ids, "crash@example.test");
    const day = "2026-11-07";
    await setBudget(day, 1);
    const target = (
      await database.pool.query(
        "SELECT id FROM notification_work WHERE booking_id=$1 ORDER BY kind LIMIT 1",
        [created.bookingId],
      )
    ).rows[0].id as string;
    const attemptId = randomUUID();
    const claimId = randomUUID();
    await database.pool.query(
      "INSERT INTO notification_attempts (id,work_id,budget_day,reserved_at) VALUES ($1,$2,$3,$4)",
      [attemptId, target, day, new Date(`${day}T00:00:00Z`)],
    );
    await database.pool.query(
      "UPDATE notification_work SET status='sending',claim_id=$2,claimed_at=$3 WHERE id=$1",
      [target, claimId, new Date(`${day}T00:00:00Z`)],
    );
    const storedBeforeReads = await database.pool.query(
      "SELECT w.status,w.reason,a.outcome,a.invoked_at FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id WHERE w.id=$1",
      [target],
    );
    const atThreshold = await getActivity(
      ids.context,
      new Date(`${day}T00:00:30Z`),
    );
    expect(
      atThreshold.success &&
        atThreshold.data.rows.find((row) => row.id === target)?.status,
    ).toBe("sending");
    expect(
      await database.pool.query(
        "SELECT w.status,w.reason,a.outcome,a.invoked_at FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id WHERE w.id=$1",
        [target],
      ),
    ).toEqual(storedBeforeReads);
    const pastThreshold = await getActivity(
      ids.context,
      new Date(`${day}T00:00:31Z`),
    );
    expect(
      pastThreshold.success &&
        pastThreshold.data.rows.find((row) => row.id === target),
    ).toMatchObject({
      status: "unknown",
      reason: "dispatch_interrupted",
      attempt: { outcome: "unknown", invokedAt: null },
    });
    expect(
      await database.pool.query(
        "SELECT w.status,w.reason,a.outcome,a.invoked_at FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id WHERE w.id=$1",
        [target],
      ),
    ).toEqual(storedBeforeReads);
    let calls = 0;
    await dispatchTracked(created.bookingId, {
      now: () => new Date(`${day}T12:00:00Z`),
      send: async () => {
        calls++;
        return captured;
      },
    });
    const activity = await getActivity(
      ids.context,
      new Date(`${day}T00:00:31Z`),
    );
    expect(
      activity.success && activity.data.rows.find((row) => row.id === target),
    ).toMatchObject({
      status: "unknown",
      reason: "dispatch_interrupted",
      attempt: { outcome: "unknown", invokedAt: null },
    });
    expect(calls).toBe(1); // Only the other eligible initial work item can send.
    await dispatchTracked(created.bookingId, {
      now: () => new Date(`${day}T12:00:00Z`),
      send: async () => {
        calls++;
        return captured;
      },
    });
    expect(calls).toBe(1);
  });

  it("keeps failed or uncertain attempts reserved and does not replay after a later UTC day", async () => {
    const ids = await fixture();
    const created = await booking(ids, "uncertain@example.test");
    const day = "2026-11-08";
    const nextDay = "2026-11-09";
    let calls = 0;
    await dispatchTracked(created.bookingId, {
      now: () => new Date(`${day}T23:59:59Z`),
      send: async () => {
        calls++;
        throw new Error("connection interrupted");
      },
    });
    expect((await rows(ids)).map((row) => row.status)).toEqual([
      "unknown",
      "unknown",
    ]);
    await dispatchTracked(created.bookingId, {
      now: () => new Date(`${nextDay}T00:00:00Z`),
      send: async () => {
        calls++;
        return captured;
      },
    });
    expect(calls).toBe(2);
    expect((await rows(ids)).every((row) => row.status === "unknown")).toBe(
      true,
    );
    expect((await rows(ids)).map((row) => row.attempt?.budgetDay)).toEqual([
      day,
      day,
    ]);
  });

  it("sends valid work after unpublication and suppresses stale content, cancellation, and revoked capability", async () => {
    const publicIds = await fixture();
    const valid = await booking(publicIds, "unpublished@example.test");
    await setOwnShopPublication(publicIds.context, {
      published: false,
      expectedPublished: true,
    });
    let sent = 0;
    await dispatchTracked(valid.bookingId, {
      send: async ({ onInvoked }) => {
        sent++;
        await onInvoked();
        return captured;
      },
    });
    expect(sent).toBe(2);

    const changed = await fixture();
    const changedBooking = await booking(changed, "changed@example.test");
    await database.pool.query(
      "UPDATE bookings SET customer_email='new@example.test' WHERE id=$1",
      [changedBooking.bookingId],
    );
    await dispatchTracked(changedBooking.bookingId, {
      send: async () => {
        sent++;
        return captured;
      },
    });
    expect(
      (await rows(changed)).every((row) => row.status === "suppressed"),
    ).toBe(true);
    expect(sent).toBe(2);
    await database.pool.query(
      "UPDATE bookings SET customer_email='changed@example.test' WHERE id=$1",
      [changedBooking.bookingId],
    );
    await dispatchTracked(changedBooking.bookingId, {
      send: async () => {
        sent++;
        return captured;
      },
    });
    expect(
      (await rows(changed)).every(
        (row) =>
          row.status === "suppressed" &&
          row.reason === "work_no_longer_eligible",
      ),
    ).toBe(true);
    expect(sent).toBe(2);

    const ownerEmail = await fixture();
    const ownerEmailBooking = await booking(
      ownerEmail,
      "owner-email-changed@example.test",
    );
    await database.pool.query('UPDATE "user" SET email=$2 WHERE id=$1', [
      ownerEmail.owner.id,
      `changed-${randomUUID()}@example.test`,
    ]);
    await dispatchTracked(ownerEmailBooking.bookingId, {
      send: async ({ onInvoked }) => {
        sent++;
        await onInvoked();
        return captured;
      },
    });
    expect(
      (await rows(ownerEmail)).find(
        (row) => row.kind === "customer_confirmation",
      )?.status,
    ).toBe("captured");
    expect(
      (await rows(ownerEmail)).find((row) => row.kind === "owner_alert"),
    ).toMatchObject({
      status: "suppressed",
      reason: "work_no_longer_eligible",
    });
    expect(sent).toBe(3);

    const cancelled = await fixture();
    const cancelledBooking = await booking(cancelled, "cancelled@example.test");
    await database.pool.query(
      "UPDATE bookings SET status='cancelled' WHERE id=$1",
      [cancelledBooking.bookingId],
    );
    await dispatchTracked(cancelledBooking.bookingId, {
      send: async () => {
        sent++;
        return captured;
      },
    });
    expect(
      (await rows(cancelled)).every((row) => row.status === "suppressed"),
    ).toBe(true);
    expect(sent).toBe(3);

    const revoked = await fixture();
    const revokedBooking = await booking(revoked, "revoked@example.test");
    await database.pool.query(
      "UPDATE bookings SET capability_revoked_at=NOW() WHERE id=$1",
      [revokedBooking.bookingId],
    );
    await dispatchTracked(revokedBooking.bookingId, {
      send: async () => {
        sent++;
        return captured;
      },
    });
    expect(
      (await rows(revoked)).every((row) => row.status === "suppressed"),
    ).toBe(true);
    expect(sent).toBe(3);

    const expired = await fixture();
    const expiredBooking = await booking(expired, "expired@example.test");
    await dispatch(expiredBooking.bookingId, {
      now: () => new Date("2026-11-10T00:00:00Z"),
      send: async () => {
        sent++;
        return captured;
      },
    });
    expect(
      (await rows(expired)).every((row) => row.status === "suppressed"),
    ).toBe(true);
    expect(sent).toBe(3);

    const deleted = await fixture();
    const deletedBooking = await booking(deleted, "deleted@example.test");
    await database.pool.query("DELETE FROM bookings WHERE id=$1", [
      deletedBooking.bookingId,
    ]);
    await dispatch(deletedBooking.bookingId, {
      send: async () => {
        sent++;
        return captured;
      },
    });
    expect(await rows(deleted)).toEqual([]);
    expect(sent).toBe(3);
  });

  it("does not let a mismatched claim update the stored result and treats post-authorization changes as in flight", async () => {
    const ids = await fixture();
    const created = await booking(ids, "claim@example.test");
    let calls = 0;
    await dispatchTracked(created.bookingId, {
      send: async ({ message, onInvoked }) => {
        calls++;
        await onInvoked();
        if (calls === 1) {
          const row = (
            await database.pool.query(
              "SELECT id FROM notification_work WHERE booking_id=$1 AND recipient=$2",
              [created.bookingId, message.to],
            )
          ).rows[0];
          await database.pool.query(
            "UPDATE notification_work SET claim_id=$2 WHERE id=$1",
            [row.id, randomUUID()],
          );
        }
        return captured;
      },
    });
    const activity = await rows(ids);
    expect(
      activity.find((row) => row.recipient === "claim@example.test")?.status,
    ).toBe("sending");
    expect(
      activity.find((row) => row.recipient === ids.owner.email)?.status,
    ).toBe("captured");

    const changed = await fixture();
    const inFlight = await booking(changed, "inflight@example.test");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sending = dispatchTracked(inFlight.bookingId, {
      send: async ({ onInvoked }) => {
        await onInvoked();
        await gate;
        return captured;
      },
    });
    await vi.waitFor(async () => {
      const sendingCount = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM notification_attempts a JOIN notification_work w ON w.id=a.work_id WHERE w.booking_id=$1 AND w.status='sending'",
          [inFlight.bookingId],
        )
      ).rows[0].count;
      expect(sendingCount).toBeGreaterThan(0);
    });
    await database.pool.query(
      "UPDATE bookings SET status='cancelled' WHERE id=$1",
      [inFlight.bookingId],
    );
    release();
    await sending;
    expect((await rows(changed)).some((row) => row.status === "captured")).toBe(
      true,
    );
  });

  it("does not persist a result when the attempt correlation no longer matches", async () => {
    const ids = await fixture();
    const created = await booking(ids, "attempt-correlation@example.test");
    let first = true;
    let sends = 0;
    await dispatchTracked(created.bookingId, {
      send: async ({ message, onInvoked }) => {
        sends++;
        await onInvoked();
        if (first && message.to === "attempt-correlation@example.test") {
          first = false;
          const work = (
            await database.pool.query(
              "SELECT w.id, a.id AS attempt_id FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id WHERE w.booking_id=$1 AND w.recipient=$2",
              [created.bookingId, message.to],
            )
          ).rows[0];
          await database.pool.query(
            "UPDATE notification_attempts SET id=$2 WHERE id=$1",
            [work.attempt_id, randomUUID()],
          );
        }
        return captured;
      },
    });
    const activity = await rows(ids);
    expect(
      activity.find(
        (row) => row.recipient === "attempt-correlation@example.test",
      )?.status,
    ).toBe("sending");
    expect(
      activity.find(
        (row) => row.recipient === "attempt-correlation@example.test",
      )?.attempt,
    ).toMatchObject({
      invokedAt: expect.any(String),
      outcome: null,
      captureId: null,
    });
    expect(
      activity.find((row) => row.recipient === ids.owner.email)?.status,
    ).toBe("captured");
    await dispatchTracked(created.bookingId, {
      send: async () => {
        sends++;
        return captured;
      },
    });
    expect(sends).toBe(2);
  });

  it("retains the reservation after outcome persistence fails and does not retry", async () => {
    const ids = await fixture();
    const created = await booking(ids, "persistence-failure@example.test");
    const day = "2026-11-03";
    const target = (
      await database.pool.query(
        "SELECT id FROM notification_work WHERE booking_id=$1 AND kind='customer_confirmation' AND channel='email'",
        [created.bookingId],
      )
    ).rows[0].id as string;
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `fail_notification_outcome_${suffix}`;
    const triggerName = `fail_notification_outcome_${suffix}`;
    await database.pool.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.id::text = TG_ARGV[0] AND OLD.status='sending' AND NEW.status IN ('accepted','captured','failed','unknown') THEN
          RAISE EXCEPTION 'test outcome persistence failure';
        END IF;
        RETURN NEW;
      END $$
    `);
    await database.pool.query(
      `CREATE TRIGGER ${triggerName} BEFORE UPDATE OF status ON notification_work
       FOR EACH ROW EXECUTE FUNCTION ${functionName}('${target}')`,
    );
    let sends = 0;
    try {
      await dispatchTracked(created.bookingId, {
        now: () => new Date(`${day}T12:00:00Z`),
        send: async ({ onInvoked }) => {
          sends++;
          await onInvoked();
          return captured;
        },
      });
    } finally {
      await database.pool.query(
        `DROP TRIGGER IF EXISTS ${triggerName} ON notification_work`,
      );
      await database.pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }
    const activity = await rows(ids);
    expect(sends).toBe(2);
    expect(activity.find((row) => row.id === target)).toMatchObject({
      status: "sending",
      attempt: { budgetDay: day, invokedAt: expect.any(String), outcome: null },
    });
    expect(activity.find((row) => row.kind === "owner_alert")?.status).toBe(
      "captured",
    );
    const unknownAfterTimeout = await getActivity(
      ids.context,
      new Date(`${day}T12:00:31Z`),
    );
    expect(
      unknownAfterTimeout.success &&
        unknownAfterTimeout.data.rows.find((row) => row.id === target),
    ).toMatchObject({
      status: "unknown",
      reason: "dispatch_interrupted",
      attempt: {
        budgetDay: day,
        invokedAt: expect.any(String),
        outcome: "unknown",
      },
    });
    await dispatchTracked(created.bookingId, {
      now: () => new Date(`${day}T12:01:00Z`),
      send: async () => {
        sends++;
        return captured;
      },
    });
    expect(sends).toBe(2);
  });

  it("keeps owner notification independent when customer capability ciphertext is invalid", async () => {
    const ids = await fixture();
    const created = await booking(ids, "broken-capability@example.test");
    await database.pool.query(
      "UPDATE bookings SET capability_ciphertext='invalid' WHERE id=$1",
      [created.bookingId],
    );
    const recipients: string[] = [];
    await dispatchTracked(created.bookingId, {
      send: async ({ message, onInvoked }) => {
        recipients.push(message.to);
        await onInvoked();
        return captured;
      },
    });
    const activity = await rows(ids);
    expect(recipients).toEqual([ids.owner.email]);
    expect(
      activity.find(
        (row) => row.recipient === "broken-capability@example.test",
      ),
    ).toMatchObject({
      status: "skipped",
      reason: "capability_unavailable",
      attempt: null,
    });
    expect(
      activity.find((row) => row.recipient === ids.owner.email)?.status,
    ).toBe("captured");
  });

  it("skips a customer render failure without spending budget and still sends the owner alert", async () => {
    const ids = await fixture();
    const created = await booking(ids, "render-failure@example.test");
    const source = (
      await database.pool.query(
        `SELECT id, start_at AS "startAt", end_at AS "endAt", service_name AS "serviceName",
        service_price_usd AS "servicePriceUsd", service_duration_minutes AS "serviceDurationMinutes",
        barber_name AS "barberName", customer_name AS "customerName", customer_phone AS "customerPhone"
       FROM bookings WHERE id=$1`,
        [created.bookingId],
      )
    ).rows[0];
    const identity = notificationContentIdentity({
      ...source,
      customerEmail: "invalid-recipient",
      servicePriceUsd: String(source.servicePriceUsd),
      serviceDurationMinutes: Number(source.serviceDurationMinutes),
    });
    await database.pool.query(
      "UPDATE bookings SET customer_email='invalid-recipient' WHERE id=$1",
      [created.bookingId],
    );
    await database.pool.query(
      `UPDATE notification_work SET content_identity=$2,
        recipient=CASE WHEN kind='customer_confirmation' THEN 'invalid-recipient' ELSE recipient END
       WHERE booking_id=$1`,
      [created.bookingId, identity],
    );
    let sends = 0;
    await dispatchTracked(created.bookingId, {
      send: async ({ onInvoked }) => {
        sends++;
        await onInvoked();
        return captured;
      },
    });
    const activity = await rows(ids);
    expect(sends).toBe(1);
    expect(
      activity.find((row) => row.kind === "customer_confirmation"),
    ).toMatchObject({
      status: "skipped",
      reason: "message_render_failed",
      attempt: null,
    });
    expect(activity.find((row) => row.kind === "owner_alert")?.status).toBe(
      "captured",
    );
  });

  it("skips a NULL customer recipient without stringifying it or allocating an attempt", async () => {
    const ids = await fixture();
    const created = await booking(ids, "missing-recipient@example.test");
    const source = (
      await database.pool.query(
        `SELECT id, start_at AS "startAt", end_at AS "endAt", service_name AS "serviceName",
        service_price_usd AS "servicePriceUsd", service_duration_minutes AS "serviceDurationMinutes",
        barber_name AS "barberName", customer_name AS "customerName", customer_phone AS "customerPhone"
       FROM bookings WHERE id=$1`,
        [created.bookingId],
      )
    ).rows[0];
    const identity = notificationContentIdentity({
      ...source,
      customerEmail: null,
      servicePriceUsd: String(source.servicePriceUsd),
      serviceDurationMinutes: Number(source.serviceDurationMinutes),
    });
    await database.pool.query(
      "UPDATE bookings SET customer_email=NULL WHERE id=$1",
      [created.bookingId],
    );
    await database.pool.query(
      `UPDATE notification_work SET content_identity=$2,
        recipient=CASE WHEN kind='customer_confirmation' THEN NULL ELSE recipient END
       WHERE booking_id=$1`,
      [created.bookingId, identity],
    );
    let sends = 0;
    await dispatchTracked(created.bookingId, {
      send: async ({ onInvoked }) => {
        sends++;
        await onInvoked();
        return captured;
      },
    });
    expect(sends).toBe(1);
    expect(
      (await rows(ids)).find((row) => row.kind === "customer_confirmation"),
    ).toMatchObject({
      status: "skipped",
      reason: "recipient_missing",
      recipient: null,
      attempt: null,
    });
  });

  it("skips a missing owner recipient while the customer confirmation succeeds", async () => {
    const ids = await fixture();
    const created = await booking(ids, "owner-recipient-missing@example.test");
    await database.pool.query(
      "UPDATE notification_work SET recipient=NULL WHERE booking_id=$1 AND kind='owner_alert'",
      [created.bookingId],
    );
    await dispatchTracked(created.bookingId, {
      send: async ({ onInvoked }) => {
        await onInvoked();
        return captured;
      },
    });
    const activity = await rows(ids);
    expect(
      activity.find((row) => row.kind === "customer_confirmation")?.status,
    ).toBe("captured");
    expect(activity.find((row) => row.kind === "owner_alert")).toMatchObject({
      status: "skipped",
      recipient: null,
      reason: "recipient_missing",
      attempt: null,
    });
    expect(activity.filter((row) => row.attempt !== null)).toHaveLength(1);
  });
});
