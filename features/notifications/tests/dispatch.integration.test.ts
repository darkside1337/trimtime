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
import {
  createRateKeyTracker,
  trackCreateEmailRateKey,
  trackCustomerChangeRateKey,
} from "@/tests/support/rate-keys";
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
  let moveOwnerBooking: typeof import("@/features/bookings/mutations").moveOwnerBooking;
  let cancelOwnerBooking: typeof import("@/features/bookings/mutations").cancelOwnerBooking;
  let restoreOwnerBooking: typeof import("@/features/bookings/mutations").restoreOwnerBooking;
  let cancelCustomerBooking: typeof import("@/features/bookings/mutations").cancelCustomerBooking;
  let replaceCustomerBooking: typeof import("@/features/bookings/mutations").replaceCustomerBooking;
  let getManagedBooking: typeof import("@/features/bookings/queries").getManagedBooking;
  let dispatch: typeof import("../dispatch").dispatchInitialBookingNotifications;
  let getActivity: typeof import("../queries").getOwnNotificationActivity;
  const ownerIds: string[] = [];
  const budgetDays = new Set<string>();
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
    vi.setSystemTime(new Date("2026-11-02T08:00:00Z"));
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
    cancelCustomerBooking = (context, input) => {
      trackCustomerChangeRateKey(rateKeys, context, input);
      return mutations.cancelCustomerBooking(context, input);
    };
    replaceCustomerBooking = (context, input) => {
      trackCustomerChangeRateKey(rateKeys, context, input);
      return mutations.replaceCustomerBooking(context, input);
    };
    ({
      createOwnerBooking,
      moveOwnerBooking,
      cancelOwnerBooking,
      restoreOwnerBooking,
    } = mutations);
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
    if (database) await rateKeys.deleteAll(database.pool);
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
    if (database) await rateKeys.deleteAll(database.pool);
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
    return {
      owner,
      context,
      shopId: shop.data.id,
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

  async function ownerCancellation(
    ids: Awaited<ReturnType<typeof fixture>>,
    created: { bookingId: string },
    expectedRevision = 0,
  ) {
    const result = await cancelOwnerBooking(ids.context, {
      bookingId: created.bookingId,
      expectedRevision,
      operationKey: randomBytes(32).toString("base64url"),
    });
    if (!result.success)
      throw new Error(
        `Owner cancellation fixture failed: ${result.error.code}`,
      );
    return result.data;
  }

  async function ownerRestoration(
    ids: Awaited<ReturnType<typeof fixture>>,
    created: { bookingId: string },
    expectedRevision = 1,
  ) {
    const result = await restoreOwnerBooking(ids.context, {
      bookingId: created.bookingId,
      expectedRevision,
      operationKey: randomBytes(32).toString("base64url"),
    });
    if (!result.success)
      throw new Error(`Restoration fixture failed: ${result.error.code}`);
    return result.data;
  }

  async function customerCancellation(
    ids: Awaited<ReturnType<typeof fixture>>,
    created: { bookingId: string; manageUrl: string },
    expectedRevision = 0,
  ) {
    const token = created.manageUrl.split("/manage/")[1];
    const result = await cancelCustomerBooking(
      { shopId: ids.shopId },
      {
        token,
        expectedRevision,
        operationKey: randomBytes(32).toString("base64url"),
        confirmed: true,
      },
    );
    if (!result.success)
      throw new Error(
        `Customer cancellation fixture failed: ${result.error.code}`,
      );
    return result.data;
  }

  async function customerReplacement(
    ids: Awaited<ReturnType<typeof fixture>>,
    created: { bookingId: string; manageUrl: string },
    changes: Record<string, unknown> = {},
    expectedRevision = 0,
  ) {
    const token = created.manageUrl.split("/manage/")[1];
    const result = await replaceCustomerBooking(
      { shopId: ids.shopId },
      {
        token,
        expectedRevision,
        operationKey: randomBytes(32).toString("base64url"),
        confirmed: true,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        startAt: "2026-11-02T11:00:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
        ...changes,
      },
    );
    if (!result.success)
      throw new Error(
        `Customer replacement fixture failed: ${result.error.code}`,
      );
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

  async function cancellationWork(bookingId: string) {
    return (
      await database.pool.query(
        `SELECT kind,status,reason FROM notification_work
         WHERE booking_id=$1 AND kind IN ('customer_cancellation','owner_cancellation')
         ORDER BY kind`,
        [bookingId],
      )
    ).rows;
  }

  async function moveWork(bookingId: string) {
    return (
      await database.pool.query(
        `SELECT kind,status,reason FROM notification_work
         WHERE booking_id=$1 AND kind IN ('customer_move','owner_move')
         ORDER BY kind`,
        [bookingId],
      )
    ).rows;
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
    expect(
      await database.pool.query(
        `SELECT attempt_number FROM notification_attempts WHERE work_id IN
         (SELECT id FROM notification_work WHERE booking_id=$1 AND channel='email')
         ORDER BY attempt_number`,
        [created.bookingId],
      ),
    ).toMatchObject({ rows: [{ attempt_number: 1 }, { attempt_number: 1 }] });
    const token = created.manageUrl.split("/manage/")[1];
    await expect(
      getManagedBooking({ shopId: ids.shopId }, token),
    ).resolves.toMatchObject({ success: true, data: { status: "confirmed" } });
  });

  it("dispatches a committed owner move update with its current saved snapshot and no owner self-alert", async () => {
    const ids = await fixture();
    const created = await booking(ids, "moved@example.test");
    const moved = await moveOwnerBooking(ids.context, {
      bookingId: created.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T11:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
    });
    expect(moved.success).toBe(true);
    const messages: { to: string; subject: string; text: string }[] = [];
    await dispatchTracked(created.bookingId, {
      send: async ({ message, onInvoked }) => {
        messages.push(message);
        await onInvoked();
        return captured;
      },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      to: "moved@example.test",
      subject: "Booking updated — Juniper Barber",
    });
    expect(messages[0].text).toContain(
      "The shop has rescheduled your booking.",
    );
    expect(messages[0].text).toContain("Start: Nov 2, 2026, 11:00 AM UTC");
    expect(messages[0].text).not.toContain(
      "does not confirm a cancellation or reschedule",
    );
    expect(messages[0].text).not.toContain(ids.owner.email);
    const activity = await rows(ids);
    expect(
      activity.find((row) => row.kind === "customer_confirmation"),
    ).toMatchObject({
      status: "suppressed",
      attempt: null,
    });
    expect(activity.find((row) => row.kind === "owner_alert")).toMatchObject({
      status: "suppressed",
      attempt: null,
    });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1 AND kind IN ('owner_alert','owner_cancellation') AND booking_revision>0",
          [created.bookingId],
        )
      ).rows[0].count,
    ).toBe(0);
  });

  it("dispatches an eligible restoration to the customer only with the unchanged capability link", async () => {
    const ids = await fixture();
    const created = await booking(ids, "restored@example.test");
    await ownerCancellation(ids, created);
    const restored = await ownerRestoration(ids, created);
    expect(restored.operation).toMatchObject({ kind: "restore", revision: 2 });

    const messages: { to: string; subject: string; text: string }[] = [];
    await dispatchTracked(created.bookingId, {
      send: async ({ message, onInvoked }) => {
        messages.push(message);
        await onInvoked();
        return captured;
      },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      to: "restored@example.test",
      subject: "Booking restored — Juniper Barber",
    });
    expect(messages[0].text).toContain(
      "The shop has restored your booking. These saved details are retained:",
    );
    expect(messages[0].text).toContain(
      "Service: Cut — $25.00 USD (30 minutes)",
    );
    expect(messages[0].text).toContain("Start: Nov 2, 2026, 10:00 AM UTC");
    expect(messages[0].text).toContain("Contact:");
    expect(messages[0].text).toContain(
      "Fictional TrimTime demo. This message is captured locally in Mailpit; inbox delivery is not enabled.",
    );
    expect(messages[0].text).toContain(
      `Manage your booking: ${created.manageUrl}`,
    );
    expect(messages[0].text).not.toContain(ids.owner.email);

    expect(
      (await rows(ids)).map(({ kind, channel, status }) => ({
        kind,
        channel,
        status,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          kind: "customer_restoration",
          channel: "email",
          status: "captured",
        },
        {
          kind: "customer_cancellation",
          channel: "email",
          status: "suppressed",
        },
      ]),
    );
    expect(
      (await rows(ids)).filter((row) => row.kind !== "customer_restoration"),
    ).toSatisfy((items: { status: string }[]) =>
      items.every((item) => item.status === "suppressed"),
    );
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1 AND kind IN ('owner_alert','owner_cancellation','owner_move') AND booking_revision>0",
          [created.bookingId],
        )
      ).rows[0].count,
    ).toBe(0);
  });

  it("dispatches the current cancellation update and suppresses obsolete creation work", async () => {
    const ids = await fixture();
    const created = await booking(ids, "cancel-update@example.test");
    const moved = await moveOwnerBooking(ids.context, {
      bookingId: created.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T11:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
    });
    expect(moved.success).toBe(true);
    const cancelled = await cancelOwnerBooking(ids.context, {
      bookingId: created.bookingId,
      expectedRevision: 1,
      operationKey: randomBytes(32).toString("base64url"),
    });
    expect(cancelled.success).toBe(true);
    const beforeDispatch = await database.pool.query(
      "SELECT kind,status FROM notification_work WHERE booking_id=$1 ORDER BY kind",
      [created.bookingId],
    );
    expect(beforeDispatch.rows).toEqual([
      { kind: "customer_cancellation", status: "not_attempted" },
      { kind: "customer_confirmation", status: "suppressed" },
      { kind: "customer_move", status: "suppressed" },
      { kind: "owner_alert", status: "suppressed" },
    ]);
    const messages: { to: string; subject: string; text: string }[] = [];
    await dispatchTracked(created.bookingId, {
      send: async ({ message, onInvoked }) => {
        messages.push(message);
        await onInvoked();
        return captured;
      },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      to: "cancel-update@example.test",
      subject: "Booking cancelled — Juniper Barber",
    });
    expect(messages[0].text).toContain("The shop has cancelled your booking.");
    expect(messages[0].text).toContain(
      "Service: Cut — $25.00 USD (30 minutes)",
    );
    expect(messages[0].text).toContain("Start: Nov 2, 2026, 11:00 AM UTC");
    expect(messages[0].text).toContain("Contact:");
    expect(messages[0].text).toContain("Manage your booking:");
    expect(
      (await rows(ids))
        .map(({ kind, status }) => ({ kind, status }))
        .sort((a, b) => a.kind.localeCompare(b.kind)),
    ).toEqual([
      { kind: "customer_cancellation", status: "captured" },
      { kind: "customer_confirmation", status: "suppressed" },
      { kind: "customer_move", status: "suppressed" },
      { kind: "owner_alert", status: "suppressed" },
    ]);
  });

  it("suppresses queued transient failures on supersession while preserving their attempt evidence", async () => {
    const ids = await fixture();
    const created = await booking(ids, "superseded-retry@example.test");
    await dispatchTracked(created.bookingId, {
      now: () => new Date("2026-11-03T12:00:00Z"),
      send: async ({ onInvoked }) => {
        await onInvoked();
        return {
          status: "failed",
          reason: "transient_rejection",
          captureId: null,
          invoked: true,
        };
      },
    });
    const moved = await moveOwnerBooking(ids.context, {
      bookingId: created.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T11:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
    });
    expect(moved.success).toBe(true);
    const obsolete = await database.pool.query(
      `SELECT w.status,w.reason,w.next_attempt_at,a.attempt_number,a.outcome,a.reason AS attempt_reason
       FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.booking_id=$1 AND w.booking_revision=0 ORDER BY w.kind`,
      [created.bookingId],
    );
    expect(obsolete.rows).toHaveLength(2);
    expect(obsolete.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "suppressed",
          reason: "superseded",
          next_attempt_at: null,
          attempt_number: 1,
          outcome: "failed",
          attempt_reason: "transient_rejection",
        }),
      ]),
    );
  });

  it("suppresses old cancellation work and later obsolete restoration work before dispatch", async () => {
    const ids = await fixture();
    const restoredBooking = await booking(
      ids,
      "restored-obsolete@example.test",
    );
    await ownerCancellation(ids, restoredBooking);
    await ownerRestoration(ids, restoredBooking);

    const cancelledAgain = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(
        ids.serviceId,
        ids.barberId,
        "restored-then-cancelled@example.test",
        { startAt: "2026-11-02T11:00:00.000Z" },
      ),
    );
    if (!cancelledAgain.success)
      throw new Error("Second booking fixture failed.");
    const cancelledBooking = cancelledAgain.data;
    await ownerCancellation(ids, cancelledBooking);
    await ownerRestoration(ids, cancelledBooking);
    await ownerCancellation(ids, cancelledBooking, 2);

    const messages: { to: string; subject: string }[] = [];
    const send = async ({
      message,
      onInvoked,
    }: {
      message: { to: string; subject: string };
      onInvoked: () => Promise<void>;
    }) => {
      messages.push({ to: message.to, subject: message.subject });
      await onInvoked();
      return captured;
    };
    await dispatchTracked(restoredBooking.bookingId, { send });
    await dispatchTracked(cancelledBooking.bookingId, { send });

    expect(messages).toEqual([
      {
        to: "restored-obsolete@example.test",
        subject: "Booking restored — Juniper Barber",
      },
      {
        to: "restored-then-cancelled@example.test",
        subject: "Booking cancelled — Juniper Barber",
      },
    ]);

    const work = async (bookingId: string) =>
      (
        await database.pool.query(
          `SELECT kind, booking_revision AS revision, status, reason
           FROM notification_work WHERE booking_id=$1
           ORDER BY booking_revision, kind`,
          [bookingId],
        )
      ).rows;
    expect(await work(restoredBooking.bookingId)).toEqual([
      {
        kind: "customer_confirmation",
        revision: 0,
        status: "suppressed",
        reason: "superseded",
      },
      {
        kind: "owner_alert",
        revision: 0,
        status: "suppressed",
        reason: "superseded",
      },
      {
        kind: "customer_cancellation",
        revision: 1,
        status: "suppressed",
        reason: "superseded",
      },
      {
        kind: "customer_restoration",
        revision: 2,
        status: "captured",
        reason: null,
      },
    ]);
    expect(await work(cancelledBooking.bookingId)).toEqual([
      {
        kind: "customer_confirmation",
        revision: 0,
        status: "suppressed",
        reason: "superseded",
      },
      {
        kind: "owner_alert",
        revision: 0,
        status: "suppressed",
        reason: "superseded",
      },
      {
        kind: "customer_cancellation",
        revision: 1,
        status: "suppressed",
        reason: "superseded",
      },
      {
        kind: "customer_restoration",
        revision: 2,
        status: "suppressed",
        reason: "superseded",
      },
      {
        kind: "customer_cancellation",
        revision: 3,
        status: "captured",
        reason: null,
      },
    ]);
  });

  it("keeps restoration delivery outcomes truthful for missing email, unavailable configuration, WhatsApp consent, revoked capability, and exhausted budget", async () => {
    const missing = await fixture();
    const missingCreated = await createOwnerBooking(missing.context, {
      serviceId: missing.serviceId,
      barberId: missing.barberId,
      startAt: "2026-11-02T10:07:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: { name: "No Email Guest", whatsappOptIn: false },
      recoveryKey: randomBytes(32).toString("base64url"),
    });
    if (!missingCreated.success)
      throw new Error("Missing-email fixture failed.");
    await ownerCancellation(missing, missingCreated.data);
    await ownerRestoration(missing, missingCreated.data);
    let missingCalls = 0;
    await dispatchTracked(missingCreated.data.bookingId, {
      send: async () => {
        missingCalls++;
        return captured;
      },
    });
    expect(missingCalls).toBe(0);
    expect(
      (await rows(missing)).find((row) => row.kind === "customer_restoration"),
    ).toMatchObject({
      status: "skipped",
      reason: "recipient_missing",
      recipient: null,
      attempt: null,
    });

    const unavailable = await fixture();
    const unavailableCreated = await booking(
      unavailable,
      "unavailable-config@example.test",
    );
    await ownerCancellation(unavailable, unavailableCreated);
    process.env.EMAIL_MODE = "disabled";
    await ownerRestoration(unavailable, unavailableCreated);
    process.env.EMAIL_MODE = "mailpit";
    let unavailableCalls = 0;
    await dispatchTracked(unavailableCreated.bookingId, {
      send: async () => {
        unavailableCalls++;
        return captured;
      },
    });
    expect(unavailableCalls).toBe(0);
    expect(
      (await rows(unavailable)).find(
        (row) => row.kind === "customer_restoration",
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "disabled",
      attempt: null,
    });

    const consented = await fixture();
    const consentedCreated = await createPublicBooking(
      { shopId: consented.shopId },
      notificationBookingInput(
        consented.serviceId,
        consented.barberId,
        "whatsapp-restore@example.test",
        {
          contact: {
            name: "Ada Lovelace",
            email: "whatsapp-restore@example.test",
            phone: "+15550101010",
            whatsappOptIn: true,
          },
        },
      ),
    );
    if (!consentedCreated.success) throw new Error("WhatsApp fixture failed.");
    await ownerCancellation(consented, consentedCreated.data);
    await ownerRestoration(consented, consentedCreated.data);
    const consentedCalls: string[] = [];
    await dispatchTracked(consentedCreated.data.bookingId, {
      send: async ({ message, onInvoked }) => {
        consentedCalls.push(message.to);
        await onInvoked();
        return captured;
      },
    });
    expect(consentedCalls).toEqual(["whatsapp-restore@example.test"]);
    const consentedWork = await database.pool.query(
      "SELECT kind,channel,status,reason FROM notification_work WHERE booking_id=$1 AND booking_revision=2 ORDER BY kind,channel",
      [consentedCreated.data.bookingId],
    );
    expect(consentedWork.rows).toEqual([
      {
        kind: "customer_restoration",
        channel: "email",
        status: "captured",
        reason: null,
      },
      {
        kind: "customer_restoration",
        channel: "whatsapp",
        status: "unavailable",
        reason: "channel_unavailable",
      },
    ]);

    const revoked = await fixture();
    const revokedCreated = await booking(
      revoked,
      "revoked-restore@example.test",
    );
    await ownerCancellation(revoked, revokedCreated);
    await ownerRestoration(revoked, revokedCreated);
    await database.pool.query(
      "UPDATE bookings SET capability_revoked_at=now() WHERE id=$1",
      [revokedCreated.bookingId],
    );
    let revokedCalls = 0;
    await dispatchTracked(revokedCreated.bookingId, {
      send: async () => {
        revokedCalls++;
        return captured;
      },
    });
    expect(revokedCalls).toBe(0);
    expect(
      (await rows(revoked)).find((row) => row.kind === "customer_restoration"),
    ).toMatchObject({
      status: "suppressed",
      reason: "work_no_longer_eligible",
      attempt: null,
    });

    const budget = await fixture();
    const budgetCreated = await booking(budget, "budget-restore@example.test");
    await ownerCancellation(budget, budgetCreated);
    await ownerRestoration(budget, budgetCreated);
    await setBudget("2026-11-03", 100);
    let budgetCalls = 0;
    await dispatchTracked(budgetCreated.bookingId, {
      send: async () => {
        budgetCalls++;
        return captured;
      },
    });
    expect(budgetCalls).toBe(0);
    expect(
      (await rows(budget)).find((row) => row.kind === "customer_restoration"),
    ).toMatchObject({
      status: "skipped",
      reason: "daily_budget_exhausted",
      attempt: null,
    });
    expect(
      (
        await database.pool.query(
          "SELECT status,revision FROM bookings WHERE id=$1",
          [budgetCreated.bookingId],
        )
      ).rows[0],
    ).toEqual({ status: "confirmed", revision: 2 });
  });

  it("keeps the restoration committed after an unknown transport outcome without replaying the attempt", async () => {
    const ids = await fixture();
    const created = await booking(ids, "unknown-restore@example.test");
    await ownerCancellation(ids, created);
    await ownerRestoration(ids, created);
    await setBudget("2026-11-03", 0);
    let calls = 0;
    await dispatchTracked(created.bookingId, {
      send: async ({ onInvoked }) => {
        calls++;
        await onInvoked();
        throw new Error("transport interrupted");
      },
    });
    expect(calls).toBe(1);
    expect(
      (await rows(ids)).find((row) => row.kind === "customer_restoration"),
    ).toMatchObject({
      status: "unknown",
      reason: "transport_interrupted",
      attempt: { outcome: "unknown" },
    });
    const attemptCount = async () =>
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM notification_attempts a JOIN notification_work w ON w.id=a.work_id WHERE w.booking_id=$1 AND w.kind='customer_restoration'",
          [created.bookingId],
        )
      ).rows[0].count;
    expect(await attemptCount()).toBe(1);
    expect(
      (
        await database.pool.query(
          "SELECT allocation_count FROM outbound_budget WHERE day=$1",
          ["2026-11-03"],
        )
      ).rows[0].allocation_count,
    ).toBe(1);

    await dispatchTracked(created.bookingId, {
      now: () => new Date("2026-11-04T12:00:00Z"),
      send: async ({ onInvoked }) => {
        calls++;
        await onInvoked();
        return captured;
      },
    });
    expect(calls).toBe(1);
    expect(await attemptCount()).toBe(1);
    expect(
      (await rows(ids)).find((row) => row.kind === "customer_restoration"),
    ).toMatchObject({ status: "unknown", reason: "transport_interrupted" });
    expect(
      (
        await database.pool.query(
          "SELECT status,revision FROM bookings WHERE id=$1",
          [created.bookingId],
        )
      ).rows[0],
    ).toEqual({ status: "confirmed", revision: 2 });
  });

  it("keeps a committed restoration when customer delivery fails and dispatch failure does not undo it", async () => {
    const ids = await fixture();
    const created = await booking(ids, "failed-restore@example.test");
    await ownerCancellation(ids, created);
    await ownerRestoration(ids, created);
    let calls = 0;
    await dispatchTracked(created.bookingId, {
      send: async ({ onInvoked }) => {
        calls++;
        await onInvoked();
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
      (await rows(ids)).find((row) => row.kind === "customer_restoration"),
    ).toMatchObject({
      status: "failed",
      reason: "permanent_rejection",
    });
    expect(
      (
        await database.pool.query(
          "SELECT status,revision FROM bookings WHERE id=$1",
          [created.bookingId],
        )
      ).rows[0],
    ).toEqual({ status: "confirmed", revision: 2 });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1 AND kind IN ('owner_alert','owner_cancellation','owner_move') AND booking_revision>0",
          [created.bookingId],
        )
      ).rows[0].count,
    ).toBe(0);
  });

  it("rejects restoration work with mismatched event, revision, or recipient linkage", async () => {
    const expectDenied = async (bookingId: string) => {
      let calls = 0;
      await dispatchTracked(bookingId, {
        send: async ({ onInvoked }) => {
          calls++;
          await onInvoked();
          return captured;
        },
      });
      expect(calls).toBe(0);
      expect(
        (
          await database.pool.query(
            "SELECT kind,status,reason FROM notification_work WHERE booking_id=$1 AND kind='customer_restoration'",
            [bookingId],
          )
        ).rows,
      ).toEqual([
        {
          kind: "customer_restoration",
          status: "suppressed",
          reason: "work_no_longer_eligible",
        },
      ]);
    };

    const wrongEvent = await fixture();
    const wrongEventBooking = await booking(wrongEvent, "ada@example.test");
    const cancellation = await ownerCancellation(wrongEvent, wrongEventBooking);
    await ownerRestoration(wrongEvent, wrongEventBooking);
    await database.pool.query(
      "UPDATE notification_work SET change_id=$2 WHERE booking_id=$1 AND kind='customer_restoration'",
      [wrongEventBooking.bookingId, cancellation.operation.id],
    );
    await expectDenied(wrongEventBooking.bookingId);

    const wrongRevision = await fixture();
    const wrongRevisionBooking = await booking(
      wrongRevision,
      "ada@example.test",
    );
    await ownerCancellation(wrongRevision, wrongRevisionBooking);
    await ownerRestoration(wrongRevision, wrongRevisionBooking);
    await database.pool.query(
      "UPDATE notification_work SET booking_revision=3 WHERE booking_id=$1 AND kind='customer_restoration'",
      [wrongRevisionBooking.bookingId],
    );
    await expectDenied(wrongRevisionBooking.bookingId);

    const wrongRecipient = await fixture();
    const wrongRecipientBooking = await booking(
      wrongRecipient,
      "ada@example.test",
    );
    await ownerCancellation(wrongRecipient, wrongRecipientBooking);
    await ownerRestoration(wrongRecipient, wrongRecipientBooking);
    await database.pool.query(
      "UPDATE notification_work SET recipient=$2 WHERE booking_id=$1 AND kind='customer_restoration'",
      [wrongRecipientBooking.bookingId, wrongRecipient.owner.email],
    );
    await expectDenied(wrongRecipientBooking.bookingId);
  });

  it("dispatches customer and owner cancellation messages at the cancelled revision", async () => {
    vi.setSystemTime(new Date("2026-11-01T08:00:00Z"));
    const ids = await fixture();
    const created = await booking(ids, "customer-cancel@example.test");
    const receipt = await customerCancellation(ids, created);
    expect(receipt).toMatchObject({
      bookingId: created.bookingId,
      status: "cancelled",
      operation: { revision: 1 },
    });

    const messages: { to: string; subject: string; text: string }[] = [];
    await dispatchTracked(created.bookingId, {
      send: async ({ message, onInvoked }) => {
        messages.push(message);
        await onInvoked();
        return captured;
      },
    });

    expect(messages).toHaveLength(2);
    const token = created.manageUrl.split("/manage/")[1];
    const customer = messages.find(
      (message) => message.to === "customer-cancel@example.test",
    );
    expect(customer).toMatchObject({
      subject: "Booking cancelled — Juniper Barber",
    });
    expect(customer?.text).toContain("You have cancelled your booking.");
    expect(customer?.text).toContain(
      "Your manage link is now read-only because this booking was cancelled.",
    );
    expect(customer?.text).not.toContain(
      "The shop has cancelled your booking.",
    );
    expect(customer?.text).toContain("Service: Cut — $25.00 USD (30 minutes)");
    expect(customer?.text).toContain("Start: Nov 2, 2026, 10:00 AM UTC");

    const owner = messages.find((message) => message.to === ids.owner.email);
    expect(owner).toMatchObject({
      subject: "Customer cancelled — Juniper Barber",
    });
    expect(owner?.text).toContain(
      "The customer has cancelled this appointment. The saved details are retained:",
    );
    expect(owner?.text).toContain(
      "Customer: Ada Lovelace <customer-cancel@example.test>",
    );
    expect(owner?.text).toContain("Service: Cut — $25.00 USD (30 minutes)");
    expect(owner?.text).toContain("Barber: Sam");
    expect(owner?.text).toContain("Start: Nov 2, 2026, 10:00 AM UTC");
    expect(owner?.text).toContain("Booking ID:");
    expect(owner?.text).toContain(
      "Owner activity: http://app.localhost:3100/activity",
    );
    expect(owner?.text).not.toContain("/manage/");
    expect(owner?.text).not.toContain(token);

    expect(
      (await rows(ids))
        .map(({ kind, status }) => ({ kind, status }))
        .sort((a, b) => a.kind.localeCompare(b.kind)),
    ).toEqual([
      { kind: "customer_cancellation", status: "captured" },
      { kind: "customer_confirmation", status: "suppressed" },
      { kind: "customer_reminder", status: "suppressed" },
      { kind: "owner_alert", status: "suppressed" },
      { kind: "owner_cancellation", status: "captured" },
    ]);
    expect(
      (
        await database.pool.query(
          "SELECT status,revision FROM bookings WHERE id=$1",
          [created.bookingId],
        )
      ).rows[0],
    ).toEqual({ status: "cancelled", revision: 1 });
  });

  it("dispatches customer and owner move messages at the replaced revision", async () => {
    vi.setSystemTime(new Date("2026-11-01T08:00:00Z"));
    const ids = await fixture();
    const created = await booking(ids, "customer-move@example.test");
    const receipt = await customerReplacement(ids, created);
    expect(receipt).toMatchObject({
      bookingId: created.bookingId,
      operation: { revision: 1 },
    });

    const messages: { to: string; subject: string; text: string }[] = [];
    await dispatchTracked(created.bookingId, {
      send: async ({ message, onInvoked }) => {
        messages.push(message);
        await onInvoked();
        return captured;
      },
    });

    expect(messages).toHaveLength(2);
    const token = created.manageUrl.split("/manage/")[1];
    const customer = messages.find(
      (message) => message.to === "customer-move@example.test",
    );
    expect(customer).toMatchObject({
      subject: "Booking updated — Juniper Barber",
    });
    expect(customer?.text).toContain("You have rescheduled your booking.");
    expect(customer?.text).toContain(
      "Customer changes require at least 12 hours' notice.",
    );
    expect(customer?.text).not.toContain(
      "The shop has rescheduled your booking.",
    );
    expect(customer?.text).toContain("Service: Cut — $25.00 USD (30 minutes)");
    expect(customer?.text).toContain("Start: Nov 2, 2026, 11:00 AM UTC");

    const owner = messages.find((message) => message.to === ids.owner.email);
    expect(owner).toMatchObject({
      subject: "Customer rescheduled — Juniper Barber",
    });
    expect(owner?.text).toContain(
      "The customer has rescheduled this appointment. The saved details are retained:",
    );
    expect(owner?.text).toContain(
      "Customer: Ada Lovelace <customer-move@example.test>",
    );
    expect(owner?.text).toContain("Service: Cut — $25.00 USD (30 minutes)");
    expect(owner?.text).toContain("Barber: Sam");
    expect(owner?.text).toContain("Start: Nov 2, 2026, 11:00 AM UTC");
    expect(owner?.text).toContain("Booking ID:");
    expect(owner?.text).toContain(
      "Owner activity: http://app.localhost:3100/activity",
    );
    expect(owner?.text).not.toContain("/manage/");
    expect(owner?.text).not.toContain(token);

    expect(
      (await rows(ids))
        .map(({ kind, status }) => ({ kind, status }))
        .sort((a, b) => a.kind.localeCompare(b.kind)),
    ).toEqual([
      { kind: "customer_confirmation", status: "suppressed" },
      { kind: "customer_move", status: "captured" },
      { kind: "customer_reminder", status: "suppressed" },
      { kind: "customer_reminder", status: "suppressed" },
      { kind: "owner_alert", status: "suppressed" },
      { kind: "owner_move", status: "captured" },
    ]);
    expect(
      (
        await database.pool.query(
          "SELECT status,revision FROM bookings WHERE id=$1",
          [created.bookingId],
        )
      ).rows[0],
    ).toEqual({ status: "confirmed", revision: 1 });
  });

  it("rejects replacement work with mismatched actor, event, revision, or recipient linkage", async () => {
    vi.setSystemTime(new Date("2026-11-01T08:00:00Z"));
    const suppressed = [
      {
        kind: "customer_move",
        status: "suppressed",
        reason: "work_no_longer_eligible",
      },
      {
        kind: "owner_move",
        status: "suppressed",
        reason: "work_no_longer_eligible",
      },
    ];
    const expectDenied = async (bookingId: string) => {
      let calls = 0;
      await dispatchTracked(bookingId, {
        send: async ({ onInvoked }) => {
          calls++;
          await onInvoked();
          return captured;
        },
      });
      expect(calls).toBe(0);
      expect(await moveWork(bookingId)).toEqual(suppressed);
    };

    const wrongActor = await fixture();
    const wrongActorBooking = await booking(wrongActor, "ada@example.test");
    const wrongActorReceipt = await customerReplacement(
      wrongActor,
      wrongActorBooking,
    );
    await database.pool.query(
      "UPDATE booking_changes SET actor_type='owner',actor_id=$2 WHERE id=$1",
      [wrongActorReceipt.operation.id, wrongActor.owner.id],
    );
    const wrongActorCalls: string[] = [];
    await dispatchTracked(wrongActorBooking.bookingId, {
      send: async ({ message, onInvoked }) => {
        wrongActorCalls.push(message.to);
        await onInvoked();
        return captured;
      },
    });
    expect(wrongActorCalls).toEqual(["ada@example.test"]);
    expect(await moveWork(wrongActorBooking.bookingId)).toEqual([
      {
        kind: "customer_move",
        status: "captured",
        reason: null,
      },
      {
        kind: "owner_move",
        status: "suppressed",
        reason: "work_no_longer_eligible",
      },
    ]);

    const wrongRevision = await fixture();
    const wrongRevisionBooking = await booking(
      wrongRevision,
      "ada@example.test",
    );
    await customerReplacement(wrongRevision, wrongRevisionBooking);
    await database.pool.query(
      "UPDATE notification_work SET booking_revision=2 WHERE booking_id=$1 AND kind IN ('customer_move','owner_move')",
      [wrongRevisionBooking.bookingId],
    );
    await expectDenied(wrongRevisionBooking.bookingId);

    const wrongRecipient = await fixture();
    const wrongRecipientBooking = await booking(
      wrongRecipient,
      "ada@example.test",
    );
    await customerReplacement(wrongRecipient, wrongRecipientBooking);
    await database.pool.query(
      `UPDATE notification_work SET recipient=CASE kind
         WHEN 'owner_move' THEN 'ada@example.test'
         ELSE $2 END
       WHERE booking_id=$1 AND kind IN ('customer_move','owner_move')`,
      [wrongRecipientBooking.bookingId, wrongRecipient.owner.email],
    );
    await expectDenied(wrongRecipientBooking.bookingId);
  });

  it.each(["rejected", "interrupted"] as const)(
    "keeps the replacement committed and sends owner move work when customer delivery is %s",
    async (outcome) => {
      vi.setSystemTime(new Date("2026-11-01T08:00:00Z"));
      const ids = await fixture();
      const created = await booking(ids, `customer-${outcome}@example.test`);
      await customerReplacement(ids, created);
      const calls: string[] = [];
      await dispatchTracked(created.bookingId, {
        send: async ({ message, onInvoked }) => {
          calls.push(message.to);
          await onInvoked();
          if (message.to === `customer-${outcome}@example.test`) {
            if (outcome === "interrupted")
              throw new Error("transport interrupted");
            return {
              status: "failed",
              reason: "permanent_rejection",
              captureId: null,
              invoked: true,
            };
          }
          return captured;
        },
      });

      expect(calls).toHaveLength(2);
      const activity = await rows(ids);
      const customer = activity.find((row) => row.kind === "customer_move");
      const owner = activity.find((row) => row.kind === "owner_move");
      expect(customer).toMatchObject(
        outcome === "interrupted"
          ? { status: "unknown", reason: "transport_interrupted" }
          : { status: "failed", reason: "permanent_rejection" },
      );
      expect(owner).toMatchObject({
        status: "captured",
        reason: null,
        attempt: { outcome: "captured" },
      });
      expect(
        (
          await database.pool.query(
            "SELECT status,revision FROM bookings WHERE id=$1",
            [created.bookingId],
          )
        ).rows[0],
      ).toEqual({ status: "confirmed", revision: 1 });
    },
  );

  it("rejects cancellation work with mismatched actor, event, revision, or recipient linkage", async () => {
    vi.setSystemTime(new Date("2026-11-01T08:00:00Z"));
    const suppressed = [
      {
        kind: "customer_cancellation",
        status: "suppressed",
        reason: "work_no_longer_eligible",
      },
      {
        kind: "owner_cancellation",
        status: "suppressed",
        reason: "work_no_longer_eligible",
      },
    ];
    const expectDenied = async (bookingId: string) => {
      let calls = 0;
      await dispatchTracked(bookingId, {
        send: async ({ onInvoked }) => {
          calls++;
          await onInvoked();
          return captured;
        },
      });
      expect(calls).toBe(0);
      expect(await cancellationWork(bookingId)).toEqual(suppressed);
    };

    const wrongActor = await fixture();
    const wrongActorBooking = await booking(wrongActor, "ada@example.test");
    const wrongActorReceipt = await customerCancellation(
      wrongActor,
      wrongActorBooking,
    );
    await database.pool.query(
      "UPDATE booking_changes SET actor_type='owner',actor_id=$2 WHERE id=$1",
      [wrongActorReceipt.operation.id, wrongActor.owner.id],
    );
    const wrongActorCalls: string[] = [];
    await dispatchTracked(wrongActorBooking.bookingId, {
      send: async ({ message, onInvoked }) => {
        wrongActorCalls.push(message.to);
        await onInvoked();
        return captured;
      },
    });
    expect(wrongActorCalls).toEqual(["ada@example.test"]);
    expect(await cancellationWork(wrongActorBooking.bookingId)).toEqual([
      {
        kind: "customer_cancellation",
        status: "captured",
        reason: null,
      },
      {
        kind: "owner_cancellation",
        status: "suppressed",
        reason: "work_no_longer_eligible",
      },
    ]);

    const wrongEvent = await fixture();
    const wrongEventBooking = await booking(wrongEvent, "ada@example.test");
    const moved = await moveOwnerBooking(wrongEvent.context, {
      bookingId: wrongEventBooking.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: wrongEvent.serviceId,
      barberId: wrongEvent.barberId,
      startAt: "2026-11-02T11:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
    });
    expect(moved.success).toBe(true);
    if (!moved.success) return;
    await customerCancellation(wrongEvent, wrongEventBooking, 1);
    await database.pool.query(
      "UPDATE notification_work SET change_id=$2 WHERE booking_id=$1 AND kind IN ('customer_cancellation','owner_cancellation')",
      [wrongEventBooking.bookingId, moved.data.operation.id],
    );
    await expectDenied(wrongEventBooking.bookingId);

    const wrongRevision = await fixture();
    const wrongRevisionBooking = await booking(
      wrongRevision,
      "ada@example.test",
    );
    await customerCancellation(wrongRevision, wrongRevisionBooking);
    await database.pool.query(
      "UPDATE notification_work SET booking_revision=2 WHERE booking_id=$1 AND kind IN ('customer_cancellation','owner_cancellation')",
      [wrongRevisionBooking.bookingId],
    );
    await expectDenied(wrongRevisionBooking.bookingId);

    const wrongRecipient = await fixture();
    const wrongRecipientBooking = await booking(
      wrongRecipient,
      "ada@example.test",
    );
    await customerCancellation(wrongRecipient, wrongRecipientBooking);
    await database.pool.query(
      `UPDATE notification_work SET recipient=CASE kind
         WHEN 'owner_cancellation' THEN 'ada@example.test'
         ELSE $2 END
       WHERE booking_id=$1 AND kind IN ('customer_cancellation','owner_cancellation')`,
      [wrongRecipientBooking.bookingId, wrongRecipient.owner.email],
    );
    await expectDenied(wrongRecipientBooking.bookingId);
  });

  it("allocates one cancellation attempt per work item across concurrent dispatches", async () => {
    vi.setSystemTime(new Date("2026-11-01T08:00:00Z"));
    const ids = await fixture();
    const created = await booking(ids, "customer-cancel-race@example.test");
    await customerCancellation(ids, created);
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
    expect(new Set(calls)).toEqual(
      new Set(["customer-cancel-race@example.test", ids.owner.email]),
    );
    expect(
      (
        await database.pool.query(
          `SELECT w.kind,w.status,count(a.id)::int AS attempts
           FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
           WHERE w.booking_id=$1 AND w.kind IN ('customer_cancellation','owner_cancellation')
           GROUP BY w.kind,w.status ORDER BY w.kind`,
          [created.bookingId],
        )
      ).rows,
    ).toEqual([
      { kind: "customer_cancellation", status: "captured", attempts: 1 },
      { kind: "owner_cancellation", status: "captured", attempts: 1 },
    ]);
  });

  it.each(["rejected", "interrupted"] as const)(
    "keeps the cancellation committed and sends owner work when customer delivery is %s",
    async (outcome) => {
      vi.setSystemTime(new Date("2026-11-01T08:00:00Z"));
      const ids = await fixture();
      const created = await booking(ids, `customer-${outcome}@example.test`);
      await customerCancellation(ids, created);
      const calls: string[] = [];
      await dispatchTracked(created.bookingId, {
        send: async ({ message, onInvoked }) => {
          calls.push(message.to);
          await onInvoked();
          if (message.to === `customer-${outcome}@example.test`) {
            if (outcome === "interrupted")
              throw new Error("transport interrupted");
            return {
              status: "failed",
              reason: "permanent_rejection",
              captureId: null,
              invoked: true,
            };
          }
          return captured;
        },
      });

      expect(calls).toHaveLength(2);
      const activity = await rows(ids);
      const customer = activity.find(
        (row) => row.kind === "customer_cancellation",
      );
      const owner = activity.find((row) => row.kind === "owner_cancellation");
      expect(customer).toMatchObject(
        outcome === "interrupted"
          ? { status: "unknown", reason: "transport_interrupted" }
          : { status: "failed", reason: "permanent_rejection" },
      );
      expect(owner).toMatchObject({
        status: "captured",
        reason: null,
        attempt: { outcome: "captured" },
      });
      expect(
        (
          await database.pool.query(
            "SELECT status,revision FROM bookings WHERE id=$1",
            [created.bookingId],
          )
        ).rows[0],
      ).toEqual({ status: "cancelled", revision: 1 });
    },
  );

  it("records cancellation skips when the shared budget is exhausted and spends only the last allocation", async () => {
    vi.setSystemTime(new Date("2026-11-01T08:00:00Z"));
    const exhausted = await fixture();
    const exhaustedBooking = await booking(
      exhausted,
      "budget-exhausted@example.test",
    );
    await customerCancellation(exhausted, exhaustedBooking);
    await setBudget("2026-11-08", 100);
    let exhaustedCalls = 0;
    await dispatchTracked(exhaustedBooking.bookingId, {
      now: () => new Date("2026-11-08T12:00:00Z"),
      send: async () => {
        exhaustedCalls++;
        return captured;
      },
    });
    expect(exhaustedCalls).toBe(0);
    expect(
      (await rows(exhausted))
        .filter((row) => row.kind.endsWith("cancellation"))
        .map(({ kind, status, reason, attempt }) => ({
          kind,
          status,
          reason,
          attempt,
        }))
        .sort((a, b) => a.kind.localeCompare(b.kind)),
    ).toEqual([
      {
        kind: "customer_cancellation",
        status: "skipped",
        reason: "daily_budget_exhausted",
        attempt: null,
      },
      {
        kind: "owner_cancellation",
        status: "skipped",
        reason: "daily_budget_exhausted",
        attempt: null,
      },
    ]);

    const last = await fixture();
    const lastCreated = await createPublicBooking(
      { shopId: last.shopId },
      notificationBookingInput(
        last.serviceId,
        last.barberId,
        "budget-last@example.test",
        {
          startAt: "2026-11-09T10:00:00.000Z",
        },
      ),
    );
    if (!lastCreated.success) throw new Error("Budget booking fixture failed.");
    const lastBooking = lastCreated.data;
    await customerCancellation(last, lastBooking);
    await setBudget("2026-11-10", 99);
    const calls: string[] = [];
    const now = () => new Date("2026-11-10T12:00:00Z");
    await dispatchTracked(lastBooking.bookingId, {
      now,
      send: async ({ message, onInvoked }) => {
        calls.push(message.to);
        await onInvoked();
        return captured;
      },
    });
    expect(calls).toHaveLength(1);
    const capturedKind =
      calls[0] === "budget-last@example.test"
        ? "customer_cancellation"
        : "owner_cancellation";
    const lastStatus = (kind: string) =>
      kind === capturedKind
        ? { kind, status: "captured", reason: null }
        : {
            kind,
            status: "skipped",
            reason: "daily_budget_exhausted",
          };
    expect(
      (await rows(last))
        .filter((row) => row.kind.endsWith("cancellation"))
        .map(({ kind, status, reason }) => ({ kind, status, reason }))
        .sort((a, b) => a.kind.localeCompare(b.kind)),
    ).toEqual([
      lastStatus("customer_cancellation"),
      lastStatus("owner_cancellation"),
    ]);
    expect(
      (
        await database.pool.query(
          "SELECT allocation_count FROM outbound_budget WHERE day=$1",
          ["2026-11-10"],
        )
      ).rows[0].allocation_count,
    ).toBe(100);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM notification_attempts a JOIN notification_work w ON w.id=a.work_id WHERE w.booking_id=$1 AND w.kind IN ('customer_cancellation','owner_cancellation')",
          [lastBooking.bookingId],
        )
      ).rows[0].count,
    ).toBe(1);

    await dispatchTracked(lastBooking.bookingId, {
      now: () => new Date("2026-11-11T00:00:00Z"),
      send: async () => {
        calls.push("replay");
        return captured;
      },
    });
    expect(calls).toHaveLength(1);
  });

  it("keeps an in-flight prior revision attempt on its work after a later move", async () => {
    const ids = await fixture();
    const created = await booking(ids, "inflight-move@example.test");
    const firstMove = await moveOwnerBooking(ids.context, {
      bookingId: created.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T11:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
    });
    expect(firstMove.success).toBe(true);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const dispatched = dispatchTracked(created.bookingId, {
      send: async ({ onInvoked }) => {
        await onInvoked();
        await gate;
        return captured;
      },
    });
    try {
      await vi.waitFor(async () => {
        const state = await database.pool.query(
          "SELECT status FROM notification_work WHERE booking_id=$1 AND kind='customer_move' AND booking_revision=1",
          [created.bookingId],
        );
        expect(state.rows[0]?.status).toBe("sending");
      });
      const secondMove = await moveOwnerBooking(ids.context, {
        bookingId: created.bookingId,
        expectedRevision: 1,
        operationKey: randomBytes(32).toString("base64url"),
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        startAt: "2026-11-02T12:00:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
      });
      expect(secondMove.success).toBe(true);
    } finally {
      release();
    }
    await dispatched;
    const work = await database.pool.query(
      `SELECT w.booking_revision AS revision, w.status, a.outcome, a.capture_id
       FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.booking_id=$1 AND w.kind='customer_move' ORDER BY w.booking_revision`,
      [created.bookingId],
    );
    expect(work.rows).toEqual([
      expect.objectContaining({
        revision: 1,
        status: "captured",
        outcome: "captured",
        capture_id: "local-capture",
      }),
      expect.objectContaining({
        revision: 2,
        status: "not_attempted",
        outcome: null,
        capture_id: null,
      }),
    ]);
  });

  it("sends only the newest update after a move away and back", async () => {
    const ids = await fixture();
    const created = await booking(ids, "move-back@example.test");
    const move = (expectedRevision: number, startAt: string) =>
      moveOwnerBooking(ids.context, {
        bookingId: created.bookingId,
        expectedRevision,
        operationKey: randomBytes(32).toString("base64url"),
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        startAt,
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
      });
    const away = await move(0, "2026-11-02T11:00:00.000Z");
    expect(away.success).toBe(true);
    const back = await move(1, "2026-11-02T10:30:00.000Z");
    expect(back.success).toBe(true);
    const beforeDispatch = await database.pool.query(
      "SELECT booking_revision AS revision,status FROM notification_work WHERE booking_id=$1 AND kind='customer_move' ORDER BY booking_revision",
      [created.bookingId],
    );
    expect(beforeDispatch.rows).toEqual([
      { revision: 1, status: "suppressed" },
      { revision: 2, status: "not_attempted" },
    ]);
    const messages: { to: string; text: string }[] = [];
    await dispatchTracked(created.bookingId, {
      send: async ({ message, onInvoked }) => {
        messages.push(message);
        await onInvoked();
        return captured;
      },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].to).toBe("move-back@example.test");
    expect(messages[0].text).toContain("Start: Nov 2, 2026, 10:30 AM UTC");
    expect(
      (
        await database.pool.query(
          "SELECT booking_revision AS revision,status FROM notification_work WHERE booking_id=$1 AND kind='customer_move' ORDER BY booking_revision",
          [created.bookingId],
        )
      ).rows,
    ).toEqual([
      { revision: 1, status: "suppressed" },
      { revision: 2, status: "captured" },
    ]);
  });

  it("keeps a moved booking committed when the update hits the daily cap and does not replay", async () => {
    const ids = await fixture();
    const created = await booking(ids, "move-budget@example.test");
    const moved = await moveOwnerBooking(ids.context, {
      bookingId: created.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T11:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
    });
    expect(moved.success).toBe(true);
    const day = "2026-11-05";
    await setBudget(day, 100);
    let calls = 0;
    const send = async () => {
      calls++;
      return captured;
    };
    const now = () => new Date(`${day}T12:00:00Z`);
    await dispatchTracked(created.bookingId, { now, send });
    const first = await database.pool.query(
      "SELECT b.status,b.revision,b.start_at,w.status AS work_status,w.reason FROM bookings b JOIN notification_work w ON w.booking_id=b.id AND w.kind='customer_move' AND w.booking_revision=1 WHERE b.id=$1",
      [created.bookingId],
    );
    expect(first.rows[0]).toMatchObject({
      status: "confirmed",
      revision: 1,
      start_at: new Date("2026-11-02T11:00:00Z"),
      work_status: "skipped",
      reason: "daily_budget_exhausted",
    });
    await dispatchTracked(created.bookingId, { now, send });
    expect(calls).toBe(0);
    expect(
      (await rows(ids)).find((item) => item.kind === "customer_move")?.status,
    ).toBe("skipped");
  });

  it("claims one current customer update across concurrent dispatch calls", async () => {
    const ids = await fixture();
    const created = await booking(ids, "move-race@example.test");
    const moved = await moveOwnerBooking(ids.context, {
      bookingId: created.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T11:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
    });
    expect(moved.success).toBe(true);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const send = async ({ onInvoked }: SendInput) => {
      calls++;
      await onInvoked();
      await gate;
      return captured;
    };
    const first = dispatchTracked(created.bookingId, { send });
    try {
      await vi.waitFor(() => expect(calls).toBe(1));
      await dispatchTracked(created.bookingId, { send });
    } finally {
      release();
    }
    await first;
    expect(calls).toBe(1);
    const update = await database.pool.query(
      `SELECT w.status,a.outcome,count(a.id)::int AS attempts
       FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.booking_id=$1 AND w.kind='customer_move' AND w.booking_revision=1
       GROUP BY w.status,a.outcome`,
      [created.bookingId],
    );
    expect(update.rows).toEqual([
      { status: "captured", outcome: "captured", attempts: 1 },
    ]);
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

  it("stores transient rejection completion and retry due time on the failed attempt", async () => {
    const ids = await fixture();
    const created = await booking(ids, "retry-evidence@example.test");
    const finishedAt = new Date("2026-11-03T12:00:00Z");
    await dispatchTracked(created.bookingId, {
      now: () => finishedAt,
      send: async ({ onInvoked }) => {
        await onInvoked();
        return {
          status: "failed",
          reason: "transient_rejection",
          captureId: null,
          invoked: true,
        };
      },
    });
    const result = await database.pool.query(
      `SELECT w.status,w.reason,w.next_attempt_at,a.attempt_number,a.reason AS attempt_reason,a.finished_at
       FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.booking_id=$1 AND w.kind='customer_confirmation' AND w.channel='email'`,
      [created.bookingId],
    );
    expect(result.rows[0]).toMatchObject({
      status: "failed",
      reason: "transient_rejection",
      next_attempt_at: new Date("2026-11-03T12:10:00Z"),
      attempt_number: 1,
      attempt_reason: "transient_rejection",
      finished_at: finishedAt,
    });
  });

  it("does not schedule a retry after permanent rejection or an unknown result", async () => {
    const ids = await fixture();
    const created = await booking(ids, "terminal-retry@example.test");
    await dispatchTracked(created.bookingId, {
      now: () => new Date("2026-11-03T12:00:00Z"),
      send: async ({ message, onInvoked }) => {
        await onInvoked();
        return message.to === "terminal-retry@example.test"
          ? {
              status: "failed",
              reason: "permanent_rejection",
              captureId: null,
              invoked: true,
            }
          : {
              status: "unknown",
              reason: "transport_interrupted",
              captureId: null,
              invoked: true,
            };
      },
    });
    const result = await database.pool.query(
      `SELECT w.status,w.next_attempt_at,a.reason,a.finished_at
       FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.booking_id=$1 AND w.channel='email' ORDER BY w.kind`,
      [created.bookingId],
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.next_attempt_at === null)).toBe(true);
    expect(result.rows.every((row) => row.finished_at instanceof Date)).toBe(
      true,
    );
    expect(result.rows.map((row) => row.status).sort()).toEqual([
      "failed",
      "unknown",
    ]);
  });

  it("persists Mailpit acceptance before capture verification and keeps it on verification failure", async () => {
    const ids = await fixture();
    const created = await booking(ids, "accepted-evidence@example.test");
    await dispatchTracked(created.bookingId, {
      now: () => new Date("2026-11-03T12:00:00Z"),
      send: async ({ onInvoked, onAccepted }) => {
        await onInvoked();
        await onAccepted?.("accepted-capture-id");
        return {
          status: "accepted",
          reason: "capture_verification_unavailable",
          captureId: "accepted-capture-id",
          invoked: true,
        };
      },
    });
    const result = await database.pool.query(
      `SELECT w.status,w.next_attempt_at,a.outcome,a.capture_id,a.reason,a.finished_at
       FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.booking_id=$1 AND w.kind='customer_confirmation' AND w.channel='email'`,
      [created.bookingId],
    );
    expect(result.rows[0]).toMatchObject({
      status: "accepted",
      next_attempt_at: null,
      outcome: "accepted",
      capture_id: "accepted-capture-id",
      reason: "capture_verification_unavailable",
      finished_at: expect.any(Date),
    });
  });

  it("fences invocation and acceptance behind the current work claim lock", async () => {
    const ids = await fixture();
    const created = await booking(ids, "fenced-callbacks@example.test");
    const work = (
      await database.pool.query(
        `SELECT id FROM notification_work WHERE booking_id=$1 AND kind='customer_confirmation' AND channel='email'`,
        [created.bookingId],
      )
    ).rows[0]!;
    const workId = String(work.id);
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    let announceCallbacks!: () => void;
    const callbacksReady = new Promise<void>((resolve) => {
      announceCallbacks = resolve;
    });
    let callbacks:
      | {
          onInvoked: () => Promise<void>;
          onAccepted?: (captureId: string) => Promise<void>;
        }
      | undefined;
    const sending = dispatchTracked(created.bookingId, {
      send: async (input) => {
        if (input.message.to === "fenced-callbacks@example.test") {
          callbacks = input;
          announceCallbacks();
          await sendGate;
          return {
            status: "accepted",
            reason: "capture_verification_unavailable",
            captureId: "late-capture-id",
            invoked: true,
          };
        }
        await input.onInvoked();
        return captured;
      },
    });
    await callbacksReady;
    if (!callbacks) throw new Error("Dispatch callbacks were not exposed.");

    const recovery = await database.pool.connect();
    let recoveryOpen = false;
    try {
      await recovery.query("BEGIN");
      recoveryOpen = true;
      await recovery.query(
        "SELECT id FROM notification_work WHERE id=$1 FOR UPDATE",
        [workId],
      );

      const invoked = callbacks.onInvoked();
      const accepted = callbacks.onAccepted!("late-capture-id");
      await vi.waitFor(async () => {
        const waiting = await database.pool.query(
          `SELECT count(*)::int AS count FROM pg_stat_activity
           WHERE datname=current_database() AND wait_event_type='Lock'
             AND query LIKE '%notification_work%'`,
        );
        expect(waiting.rows[0]?.count).toBe(2);
      });

      await recovery.query("SET LOCAL lock_timeout = '300ms'");
      await recovery.query(
        "SELECT id FROM notification_attempts WHERE work_id=$1 AND attempt_number=1 FOR UPDATE",
        [workId],
      );
      await recovery.query(
        `UPDATE notification_attempts
         SET outcome='unknown',reason='dispatch_interrupted',finished_at=$2
         WHERE work_id=$1 AND attempt_number=1`,
        [workId, new Date("2026-11-03T12:00:31Z")],
      );
      await recovery.query(
        `UPDATE notification_work SET status='unknown',reason='dispatch_interrupted',updated_at=$2
         WHERE id=$1 AND status='sending'`,
        [workId, new Date("2026-11-03T12:00:31Z")],
      );
      await recovery.query("COMMIT");
      recoveryOpen = false;
      await Promise.all([invoked, accepted]);
    } finally {
      if (recoveryOpen) await recovery.query("ROLLBACK");
      recovery.release();
      releaseSend();
    }
    await sending;

    const state = await database.pool.query(
      `SELECT w.status,w.reason,a.outcome,a.reason AS attempt_reason,a.capture_id,a.invoked_at
       FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=$1 AND a.attempt_number=1`,
      [workId],
    );
    expect(state.rows[0]).toMatchObject({
      status: "unknown",
      reason: "dispatch_interrupted",
      outcome: "unknown",
      attempt_reason: "dispatch_interrupted",
      capture_id: null,
    });
    expect(state.rows[0]?.invoked_at).toBeNull();
  });

  it("allows acceptance to commit before a work-then-attempt recovery transaction", async () => {
    const ids = await fixture();
    const created = await booking(ids, "acceptance-first@example.test");
    const work = (
      await database.pool.query(
        `SELECT id FROM notification_work WHERE booking_id=$1 AND kind='customer_confirmation' AND channel='email'`,
        [created.bookingId],
      )
    ).rows[0]!;
    const workId = String(work.id);
    let announceAccepted!: () => void;
    const acceptedReady = new Promise<void>((resolve) => {
      announceAccepted = resolve;
    });
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const sending = dispatchTracked(created.bookingId, {
      send: async (input) => {
        if (input.message.to === "acceptance-first@example.test") {
          await input.onInvoked();
          await input.onAccepted?.("accepted-before-recovery");
          announceAccepted();
          await sendGate;
          return {
            status: "accepted",
            reason: "capture_verification_unavailable",
            captureId: "accepted-before-recovery",
            invoked: true,
          };
        }
        await input.onInvoked();
        return captured;
      },
    });
    try {
      await acceptedReady;
      const accepted = await database.pool.query(
        `SELECT w.status,a.outcome,a.capture_id
         FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
         WHERE w.id=$1 AND a.attempt_number=1`,
        [workId],
      );
      expect(accepted.rows[0]).toMatchObject({
        status: "accepted",
        outcome: "accepted",
        capture_id: "accepted-before-recovery",
      });

      const recovery = await database.pool.connect();
      try {
        await recovery.query("BEGIN");
        await recovery.query(
          "SELECT id FROM notification_work WHERE id=$1 FOR UPDATE",
          [workId],
        );
        await recovery.query(
          "SELECT id FROM notification_attempts WHERE work_id=$1 AND attempt_number=1 FOR UPDATE",
          [workId],
        );
        await recovery.query(
          `UPDATE notification_attempts SET outcome='unknown',reason='dispatch_interrupted'
           WHERE work_id=$1 AND attempt_number=1`,
          [workId],
        );
        await recovery.query(
          `UPDATE notification_work SET status='unknown',reason='dispatch_interrupted'
           WHERE id=$1`,
          [workId],
        );
        await recovery.query("COMMIT");
      } catch (error) {
        await recovery.query("ROLLBACK");
        throw error;
      } finally {
        recovery.release();
      }
    } finally {
      releaseSend();
    }
    await sending;
    const final = await database.pool.query(
      `SELECT w.status,a.outcome,a.capture_id
       FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.id=$1 AND a.attempt_number=1`,
      [workId],
    );
    expect(final.rows[0]).toMatchObject({
      status: "unknown",
      outcome: "unknown",
      capture_id: "accepted-before-recovery",
    });
  });

  it("returns one Activity work row with ordered attempts and the latest compatibility attempt", async () => {
    const ids = await fixture();
    const created = await booking(ids, "attempt-history@example.test");
    const day = "2026-11-03";
    await dispatchTracked(created.bookingId, {
      now: () => new Date(`${day}T12:00:00Z`),
      send: async ({ onInvoked }) => {
        await onInvoked();
        return captured;
      },
    });
    const work = await database.pool.query(
      `SELECT id FROM notification_work WHERE booking_id=$1 AND kind='customer_confirmation' AND channel='email'`,
      [created.bookingId],
    );
    await database.pool.query(
      `INSERT INTO notification_attempts (id,work_id,budget_day,attempt_number,reserved_at,outcome,reason,finished_at)
       VALUES ($1,$2,$3,2,$4,'failed','transient_rejection',$4)`,
      [randomUUID(), work.rows[0]!.id, day, new Date(`${day}T12:10:00Z`)],
    );
    const activity = await getActivity({ userId: ids.owner.id });
    expect(activity.success).toBe(true);
    if (!activity.success) return;
    const customerRows = activity.data.rows.filter(
      (row) =>
        row.bookingId === created.bookingId &&
        row.kind === "customer_confirmation",
    );
    expect(customerRows).toHaveLength(1);
    expect(
      customerRows[0]?.attempts.map((attempt) => attempt.attemptNumber),
    ).toEqual([1, 2]);
    expect(customerRows[0]?.attempt).toMatchObject({
      attemptNumber: 2,
      outcome: "failed",
      reason: "transient_rejection",
    });
  });

  it("projects only the latest expired sending attempt as unknown and preserves prior failure evidence", async () => {
    const ids = await fixture();
    const created = await booking(ids, "expired-history@example.test");
    const work = (
      await database.pool.query(
        `SELECT id FROM notification_work WHERE booking_id=$1 AND kind='customer_confirmation' AND channel='email'`,
        [created.bookingId],
      )
    ).rows[0]!;
    const workId = String(work.id);
    const budgetDay = "2026-11-03";
    await setBudget(budgetDay, 2);
    await database.pool.query(
      `INSERT INTO notification_attempts
         (id,work_id,budget_day,attempt_number,reserved_at,invoked_at,outcome,reason,finished_at)
       VALUES ($1,$2,$3,1,$4,$4,'failed','transient_rejection',$5),
              ($6,$2,$3,2,$7,$7,NULL,NULL,NULL)`,
      [
        randomUUID(),
        workId,
        budgetDay,
        new Date("2026-11-03T08:00:00Z"),
        new Date("2026-11-03T08:00:02Z"),
        randomUUID(),
        new Date("2026-11-03T08:10:00Z"),
      ],
    );
    await database.pool.query(
      `UPDATE notification_work
       SET status='sending',reason=NULL,claim_id=$2,claimed_at=$3
       WHERE id=$1`,
      [workId, randomUUID(), new Date("2026-11-03T08:10:00Z")],
    );

    const activity = await getActivity(
      ids.context,
      new Date("2026-11-03T08:10:31Z"),
    );
    expect(activity.success).toBe(true);
    if (!activity.success) return;
    const customerRows = activity.data.rows.filter((row) => row.id === workId);
    expect(customerRows).toHaveLength(1);
    expect(customerRows[0]).toMatchObject({
      status: "unknown",
      reason: "dispatch_interrupted",
      attempts: [
        {
          attemptNumber: 1,
          outcome: "failed",
          reason: "transient_rejection",
          finishedAt: "2026-11-03T08:00:02.000Z",
        },
        {
          attemptNumber: 2,
          outcome: "unknown",
          reason: null,
          finishedAt: null,
        },
      ],
      attempt: { attemptNumber: 2, outcome: "unknown" },
    });
    expect(
      await database.pool.query(
        "SELECT count(*)::int AS count FROM notification_work WHERE id=$1",
        [workId],
      ),
    ).toMatchObject({ rows: [{ count: 1 }] });
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
