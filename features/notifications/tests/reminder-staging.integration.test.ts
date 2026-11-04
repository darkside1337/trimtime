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

describe("transactional reminder staging", () => {
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
  let replaceCustomerBooking: typeof import("@/features/bookings/mutations").replaceCustomerBooking;
  let cancelOwnerBooking: typeof import("@/features/bookings/mutations").cancelOwnerBooking;
  let restoreOwnerBooking: typeof import("@/features/bookings/mutations").restoreOwnerBooking;
  const ownerIds: string[] = [];
  const rateKeys = createRateKeyTracker();
  const week = Array.from({ length: 7 }, () => ({
    working: [{ start: 540, end: 1020 }],
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
    vi.setSystemTime(new Date("2026-11-02T08:59:59.999Z"));
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
    createOwnerBooking = mutations.createOwnerBooking;
    moveOwnerBooking = mutations.moveOwnerBooking;
    cancelOwnerBooking = mutations.cancelOwnerBooking;
    restoreOwnerBooking = mutations.restoreOwnerBooking;
    replaceCustomerBooking = (context, input) => {
      trackCustomerChangeRateKey(rateKeys, context, input);
      return mutations.replaceCustomerBooking(context, input);
    };
    const { pool } = await import("@/db");
    pool.options.max = 8;
    closeAppPool = () => pool.end();
  });

  afterEach(async () => {
    process.env.EMAIL_MODE = "mailpit";
    vi.setSystemTime(new Date("2026-11-02T08:59:59.999Z"));
    if (ownerIds.length) {
      await database.pool.query(
        'DELETE FROM "shops" WHERE owner_id = ANY($1::text[])',
        [ownerIds],
      );
      const helpers = (await testAuth.$context).test;
      await Promise.all(ownerIds.map((id) => helpers.deleteUser(id)));
      ownerIds.length = 0;
    }
    await rateKeys.deleteAll(database.pool);
  });

  afterAll(async () => {
    vi.useRealTimers();
    await database?.pool.query(
      'DELETE FROM "shops" WHERE owner_id = ANY($1::text[])',
      [ownerIds],
    );
    await rateKeys.deleteAll(database.pool);
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
    return {
      context,
      shopId: shop.data.id,
      barberId: barber.data.id,
      serviceId: service.data.id,
    };
  }

  it("creates only reminders with more than 24 elapsed hours remaining", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(
        ids.serviceId,
        ids.barberId,
        "ada@example.test",
        { startAt: "2026-11-03T09:00:00.000Z" },
      ),
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const rows = await database.pool.query(
      "SELECT kind, channel, status, reason, booking_revision, change_id, due_at::text AS due_at FROM notification_work WHERE booking_id=$1 AND kind='customer_reminder' ORDER BY channel",
      [created.data.bookingId],
    );
    expect(rows.rows).toEqual([
      {
        kind: "customer_reminder",
        channel: "email",
        status: "not_attempted",
        reason: null,
        booking_revision: 0,
        change_id: null,
        due_at: "2026-11-02 09:00:00+00",
      },
    ]);

    vi.setSystemTime(new Date("2026-11-02T10:00:00.000Z"));
    const equalBoundary = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(
        ids.serviceId,
        ids.barberId,
        "equal@example.test",
        { startAt: "2026-11-03T10:00:00.000Z" },
      ),
    );
    expect(equalBoundary.success).toBe(true);
    if (!equalBoundary.success) return;
    vi.setSystemTime(new Date("2026-11-02T11:00:00.001Z"));
    const belowBoundary = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(
        ids.serviceId,
        ids.barberId,
        "below@example.test",
        { startAt: "2026-11-03T11:00:00.000Z" },
      ),
    );
    expect(belowBoundary.success).toBe(true);
    if (!belowBoundary.success) return;
    const boundaryCounts = await database.pool.query(
      `SELECT count(*) FILTER (WHERE kind='customer_reminder')::int AS reminders
       FROM notification_work WHERE booking_id=ANY($1::uuid[])`,
      [[equalBoundary.data.bookingId, belowBoundary.data.bookingId]],
    );
    expect(boundaryCounts.rows).toEqual([{ reminders: 0 }]);

    vi.setSystemTime(new Date("2026-11-02T08:59:59.999Z"));
    const ownerIds = await fixture();
    const ownerCreated = await createOwnerBooking(ownerIds.context, {
      serviceId: ownerIds.serviceId,
      barberId: ownerIds.barberId,
      startAt: "2026-11-04T09:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: {
        name: "Manual Guest",
        phone: "+15551234567",
        whatsappOptIn: true,
      },
      recoveryKey: randomBytes(32).toString("base64url"),
    });
    expect(ownerCreated.success).toBe(true);
    if (!ownerCreated.success) return;
    const ownerReminder = await database.pool.query(
      `SELECT channel,status,reason,booking_revision,change_id,due_at::text AS due_at
       FROM notification_work WHERE booking_id=$1 AND kind='customer_reminder' ORDER BY channel`,
      [ownerCreated.data.bookingId],
    );
    expect(ownerReminder.rows).toEqual([
      {
        channel: "email",
        status: "skipped",
        reason: "recipient_missing",
        booking_revision: 0,
        change_id: null,
        due_at: "2026-11-03 09:00:00+00",
      },
      {
        channel: "whatsapp",
        status: "unavailable",
        reason: "channel_unavailable",
        booking_revision: 0,
        change_id: null,
        due_at: "2026-11-03 09:00:00+00",
      },
    ]);
    const ownerSelfAlerts = await database.pool.query(
      "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1 AND kind='owner_alert'",
      [ownerCreated.data.bookingId],
    );
    expect(ownerSelfAlerts.rows).toEqual([{ count: 0 }]);
  });

  it("stages fresh customer and owner move generations and suppresses old pending work", async () => {
    const ownerIds = await fixture();
    const ownerCreated = await createPublicBooking(
      { shopId: ownerIds.shopId },
      notificationBookingInput(
        ownerIds.serviceId,
        ownerIds.barberId,
        "owner-move@example.test",
        { startAt: "2026-11-03T09:00:00.000Z" },
      ),
    );
    expect(ownerCreated.success).toBe(true);
    if (!ownerCreated.success) return;
    const moved = await moveOwnerBooking(ownerIds.context, {
      bookingId: ownerCreated.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: ownerIds.serviceId,
      barberId: ownerIds.barberId,
      startAt: "2026-11-05T09:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
    });
    if (!moved.success)
      throw new Error(`Owner move failed: ${JSON.stringify(moved)}`);

    const customerIds = await fixture();
    const customerCreated = await createPublicBooking(
      { shopId: customerIds.shopId },
      notificationBookingInput(
        customerIds.serviceId,
        customerIds.barberId,
        "customer-move@example.test",
        { startAt: "2026-11-03T09:00:00.000Z" },
      ),
    );
    expect(customerCreated.success).toBe(true);
    if (!customerCreated.success) return;
    const replaced = await replaceCustomerBooking(
      { shopId: customerIds.shopId },
      {
        token: customerCreated.data.manageUrl.split("/manage/")[1],
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
        confirmed: true,
        serviceId: customerIds.serviceId,
        barberId: customerIds.barberId,
        startAt: "2026-11-05T09:00:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
      },
    );
    expect(replaced.success).toBe(true);
    if (!replaced.success) return;

    const result = await database.pool.query(
      `SELECT kind,channel,status,reason,booking_revision,change_id,due_at::text AS due_at
       FROM notification_work WHERE booking_id=ANY($1::uuid[]) AND kind='customer_reminder'
       ORDER BY booking_id,booking_revision,channel`,
      [[ownerCreated.data.bookingId, customerCreated.data.bookingId]],
    );
    expect(result.rows).toHaveLength(4);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "suppressed",
          reason: "superseded",
          booking_revision: 0,
          due_at: "2026-11-02 09:00:00+00",
        }),
        expect.objectContaining({
          status: "not_attempted",
          reason: null,
          booking_revision: 1,
          due_at: "2026-11-04 09:00:00+00",
        }),
      ]),
    );
    expect(
      result.rows.filter(
        (row) => row.booking_revision === 1 && row.status === "not_attempted",
      ),
    ).toHaveLength(2);
    expect(
      result.rows
        .filter((row) => row.booking_revision === 1)
        .every((row) => row.change_id !== null),
    ).toBe(true);
    const ownerAlerts = await database.pool.query(
      "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=ANY($1::uuid[]) AND kind='owner_alert'",
      [[ownerCreated.data.bookingId, customerCreated.data.bookingId]],
    );
    expect(ownerAlerts.rows[0].count).toBe(2);
  });

  it("keeps a captured prior reminder and stages restoration as a new generation", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(
        ids.serviceId,
        ids.barberId,
        "restored@example.test",
        { startAt: "2026-11-03T09:00:00.000Z" },
      ),
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    await database.pool.query(
      "UPDATE notification_work SET status='captured' WHERE booking_id=$1 AND kind='customer_reminder' AND channel='email'",
      [created.data.bookingId],
    );
    const cancelled = await cancelOwnerBooking(ids.context, {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    });
    expect(cancelled.success).toBe(true);
    if (!cancelled.success) return;
    const restored = await restoreOwnerBooking(ids.context, {
      bookingId: created.data.bookingId,
      expectedRevision: 1,
      operationKey: randomBytes(32).toString("base64url"),
    });
    expect(restored.success).toBe(true);
    if (!restored.success) return;

    const reminders = await database.pool.query(
      `SELECT status,booking_revision,change_id,due_at::text AS due_at FROM notification_work
       WHERE booking_id=$1 AND kind='customer_reminder' AND channel='email' ORDER BY booking_revision`,
      [created.data.bookingId],
    );
    expect(reminders.rows).toEqual([
      {
        status: "captured",
        booking_revision: 0,
        change_id: null,
        due_at: "2026-11-02 09:00:00+00",
      },
      {
        status: "not_attempted",
        booking_revision: 2,
        change_id: restored.data.operation.id,
        due_at: "2026-11-02 09:00:00+00",
      },
    ]);
  });

  it("replays the original move receipt without adding reminder work", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(
        ids.serviceId,
        ids.barberId,
        "replay@example.test",
        { startAt: "2026-11-03T09:00:00.000Z" },
      ),
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const operationKey = randomBytes(32).toString("base64url");
    const input = {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey,
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-05T09:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
    };
    const first = await moveOwnerBooking(ids.context, input);
    expect(first.success).toBe(true);
    if (!first.success) return;
    const replay = await moveOwnerBooking(ids.context, input);
    expect(replay).toEqual(first);
    const result = await database.pool.query(
      `SELECT booking_revision,status,reason,change_id,due_at::text AS due_at FROM notification_work
       WHERE booking_id=$1 AND kind='customer_reminder' AND channel='email' ORDER BY booking_revision`,
      [created.data.bookingId],
    );
    expect(result.rows).toEqual([
      {
        booking_revision: 0,
        status: "suppressed",
        reason: "superseded",
        change_id: null,
        due_at: "2026-11-02 09:00:00+00",
      },
      {
        booking_revision: 1,
        status: "not_attempted",
        reason: null,
        change_id: first.data.operation.id,
        due_at: "2026-11-04 09:00:00+00",
      },
    ]);
  });

  it("applies the strict 24 hour boundary to owner creation", async () => {
    const ids = await fixture();
    const cases = [
      {
        now: "2026-11-02T08:59:59.999Z",
        startAt: "2026-11-03T09:00:00.000Z",
        dueAt: "2026-11-02 09:00:00+00",
        count: 2,
      },
      {
        now: "2026-11-02T10:00:00.000Z",
        startAt: "2026-11-03T10:00:00.000Z",
        dueAt: null,
        count: 0,
      },
      {
        now: "2026-11-02T11:00:00.001Z",
        startAt: "2026-11-03T11:00:00.000Z",
        dueAt: null,
        count: 0,
      },
    ];
    for (const [index, item] of cases.entries()) {
      vi.setSystemTime(new Date(item.now));
      const created = await createOwnerBooking(ids.context, {
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        startAt: item.startAt,
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
        contact: {
          name: "Manual Guest",
          phone: "+15551234567",
          whatsappOptIn: true,
        },
        recoveryKey: randomBytes(32).toString("base64url"),
      });
      expect(
        created.success,
        `owner creation case ${index}: ${JSON.stringify(created)}`,
      ).toBe(true);
      if (!created.success) return;
      const rows = await database.pool.query(
        `SELECT channel,status,due_at::text AS due_at FROM notification_work
         WHERE booking_id=$1 AND kind='customer_reminder' ORDER BY channel`,
        [created.data.bookingId],
      );
      expect(rows.rows).toHaveLength(item.count);
      expect(rows.rows.map((row) => row.due_at)).toEqual(
        item.dueAt ? [item.dueAt, item.dueAt] : [],
      );
      if (item.dueAt)
        expect(rows.rows.map((row) => row.status)).toEqual([
          "skipped",
          "unavailable",
        ]);
    }
  });

  it("applies the strict 24 hour boundary to customer replacement", async () => {
    for (const item of [
      {
        now: "2026-11-02T08:59:59.999Z",
        startAt: "2026-11-03T09:00:00.000Z",
        dueAt: "2026-11-02 09:00:00+00",
      },
      {
        now: "2026-11-02T09:00:00.000Z",
        startAt: "2026-11-03T09:00:00.000Z",
        dueAt: null,
      },
      {
        now: "2026-11-02T09:00:00.001Z",
        startAt: "2026-11-03T09:00:00.000Z",
        dueAt: null,
      },
    ]) {
      vi.setSystemTime(new Date(item.now));
      const ids = await fixture();
      const created = await createPublicBooking(
        { shopId: ids.shopId },
        notificationBookingInput(
          ids.serviceId,
          ids.barberId,
          "replace-boundary@example.test",
          { startAt: "2026-11-10T09:00:00.000Z" },
        ),
      );
      expect(created.success).toBe(true);
      if (!created.success) return;
      const replaced = await replaceCustomerBooking(
        { shopId: ids.shopId },
        {
          token: created.data.manageUrl.split("/manage/")[1],
          expectedRevision: 0,
          operationKey: randomBytes(32).toString("base64url"),
          confirmed: true,
          serviceId: ids.serviceId,
          barberId: ids.barberId,
          startAt: item.startAt,
          reviewedOffer: {
            name: "Cut",
            priceUsd: "25.00",
            durationMinutes: "30",
          },
        },
      );
      expect(replaced.success).toBe(true);
      if (!replaced.success) return;
      const rows = await database.pool.query(
        `SELECT booking_revision,status,due_at::text AS due_at FROM notification_work
         WHERE booking_id=$1 AND kind='customer_reminder' AND booking_revision=1 ORDER BY channel`,
        [created.data.bookingId],
      );
      expect(rows.rows).toHaveLength(item.dueAt ? 1 : 0);
      expect(rows.rows.map((row) => row.due_at)).toEqual(
        item.dueAt ? [item.dueAt] : [],
      );
      if (item.dueAt)
        expect(rows.rows[0]).toMatchObject({
          booking_revision: 1,
          status: "not_attempted",
        });
    }
  });

  it("applies the strict 24 hour boundary to owner moves", async () => {
    for (const item of [
      {
        now: "2026-11-02T08:59:59.999Z",
        startAt: "2026-11-03T09:00:00.000Z",
        dueAt: "2026-11-02 09:00:00+00",
      },
      {
        now: "2026-11-02T09:00:00.000Z",
        startAt: "2026-11-03T09:00:00.000Z",
        dueAt: null,
      },
      {
        now: "2026-11-02T09:00:00.001Z",
        startAt: "2026-11-03T09:00:00.000Z",
        dueAt: null,
      },
    ]) {
      vi.setSystemTime(new Date(item.now));
      const ids = await fixture();
      const created = await createPublicBooking(
        { shopId: ids.shopId },
        notificationBookingInput(
          ids.serviceId,
          ids.barberId,
          "move-boundary@example.test",
          { startAt: "2026-11-10T09:00:00.000Z" },
        ),
      );
      expect(created.success).toBe(true);
      if (!created.success) return;
      const moved = await moveOwnerBooking(ids.context, {
        bookingId: created.data.bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        startAt: item.startAt,
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
      });
      expect(moved.success).toBe(true);
      if (!moved.success) return;
      const rows = await database.pool.query(
        `SELECT booking_revision,status,due_at::text AS due_at FROM notification_work
         WHERE booking_id=$1 AND kind='customer_reminder' AND booking_revision=1 ORDER BY channel`,
        [created.data.bookingId],
      );
      expect(rows.rows).toHaveLength(item.dueAt ? 1 : 0);
      expect(rows.rows.map((row) => row.due_at)).toEqual(
        item.dueAt ? [item.dueAt] : [],
      );
      if (item.dueAt)
        expect(rows.rows[0]).toMatchObject({
          booking_revision: 1,
          status: "not_attempted",
        });
    }
  });

  it("applies the strict 24 hour boundary to owner restoration", async () => {
    for (const item of [
      {
        now: "2026-11-02T08:59:59.999Z",
        startAt: "2026-11-03T09:00:00.000Z",
        dueAt: "2026-11-02 09:00:00+00",
      },
      {
        now: "2026-11-02T09:00:00.000Z",
        startAt: "2026-11-03T09:00:00.000Z",
        dueAt: null,
      },
      {
        now: "2026-11-02T09:00:00.001Z",
        startAt: "2026-11-03T09:00:00.000Z",
        dueAt: null,
      },
    ]) {
      vi.setSystemTime(new Date(item.now));
      const ids = await fixture();
      const created = await createPublicBooking(
        { shopId: ids.shopId },
        notificationBookingInput(
          ids.serviceId,
          ids.barberId,
          "restore-boundary@example.test",
          { startAt: item.startAt },
        ),
      );
      expect(created.success).toBe(true);
      if (!created.success) return;
      const cancelled = await cancelOwnerBooking(ids.context, {
        bookingId: created.data.bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
      });
      expect(cancelled.success).toBe(true);
      if (!cancelled.success) return;
      const restored = await restoreOwnerBooking(ids.context, {
        bookingId: created.data.bookingId,
        expectedRevision: 1,
        operationKey: randomBytes(32).toString("base64url"),
      });
      expect(restored.success).toBe(true);
      if (!restored.success) return;
      const rows = await database.pool.query(
        `SELECT booking_revision,status,due_at::text AS due_at FROM notification_work
         WHERE booking_id=$1 AND kind='customer_reminder' AND booking_revision=2 ORDER BY channel`,
        [created.data.bookingId],
      );
      expect(rows.rows).toHaveLength(item.dueAt ? 1 : 0);
      expect(rows.rows.map((row) => row.due_at)).toEqual(
        item.dueAt ? [item.dueAt] : [],
      );
      if (item.dueAt)
        expect(rows.rows[0]).toMatchObject({
          booking_revision: 2,
          status: "not_attempted",
        });
    }
  });

  it("rolls back an owner move event and reminder staging failure", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(
        ids.serviceId,
        ids.barberId,
        "rollback@example.test",
        { startAt: "2026-11-03T09:00:00.000Z" },
      ),
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    await database.pool.query(`
      CREATE FUNCTION phase15_fail_reminder_stage() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.booking_id = '${created.data.bookingId}'::uuid AND NEW.kind = 'customer_reminder' THEN
          IF NOT EXISTS (SELECT 1 FROM booking_changes WHERE booking_id = NEW.booking_id) THEN
            RAISE EXCEPTION 'owner move event was not written before reminder staging';
          END IF;
          RAISE EXCEPTION 'forced reminder staging failure';
        END IF;
        RETURN NEW;
      END $$
    `);
    await database.pool.query(`
      CREATE TRIGGER phase15_fail_reminder_stage_trigger BEFORE INSERT ON notification_work
      FOR EACH ROW EXECUTE FUNCTION phase15_fail_reminder_stage()
    `);
    try {
      const result = await moveOwnerBooking(ids.context, {
        bookingId: created.data.bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        startAt: "2026-11-05T09:00:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
      });
      expect(result).toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE" },
      });
      const persisted = await database.pool.query(
        `SELECT b.start_at::text AS start_at, b.status, b.revision,
                (SELECT count(*)::int FROM occupied_intervals WHERE id=b.occupancy_id AND start_at='2026-11-03T09:00:00Z') AS occupancy,
                (SELECT count(*)::int FROM booking_changes WHERE booking_id=b.id) AS changes,
                (SELECT count(*)::int FROM notification_work WHERE booking_id=b.id) AS work,
                (SELECT count(*)::int FROM notification_work WHERE booking_id=b.id AND kind='customer_reminder' AND status='not_attempted') AS pending_reminders,
                (SELECT string_agg(kind || ':' || channel || ':' || status, ',' ORDER BY kind)
                 FROM notification_work WHERE booking_id=b.id) AS prior_work_state
         FROM bookings b WHERE b.id=$1`,
        [created.data.bookingId],
      );
      expect(persisted.rows).toEqual([
        {
          start_at: "2026-11-03 09:00:00+00",
          status: "confirmed",
          revision: 0,
          occupancy: 1,
          changes: 0,
          work: 3,
          pending_reminders: 1,
          prior_work_state:
            "customer_confirmation:email:not_attempted,customer_reminder:email:not_attempted,owner_alert:email:not_attempted",
        },
      ]);
    } finally {
      await database.pool.query(
        "DROP TRIGGER IF EXISTS phase15_fail_reminder_stage_trigger ON notification_work",
      );
      await database.pool.query(
        "DROP FUNCTION IF EXISTS phase15_fail_reminder_stage()",
      );
    }
  });

  it("leaves no reminder work for unavailable, conflicting, or unauthorized mutations", async () => {
    const ids = await fixture();
    const existing = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(
        ids.serviceId,
        ids.barberId,
        "existing@example.test",
        { startAt: "2026-11-03T09:00:00.000Z" },
      ),
    );
    expect(existing.success).toBe(true);
    if (!existing.success) return;
    const unavailable = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(
        ids.serviceId,
        ids.barberId,
        "unavailable@example.test",
        { startAt: "2026-11-03T19:00:00.000Z" },
      ),
    );
    expect(unavailable).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    const conflict = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(
        ids.serviceId,
        ids.barberId,
        "conflict@example.test",
        { startAt: "2026-11-03T09:00:00.000Z" },
      ),
    );
    expect(conflict).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    const unauthorized = await replaceCustomerBooking(
      { shopId: ids.shopId },
      {
        token: "invalid-capability",
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
        confirmed: true,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        startAt: "2026-11-05T09:00:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
      },
    );
    expect(unauthorized).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE" },
    });
    const reminders = await database.pool.query(
      "SELECT booking_revision,status,due_at::text AS due_at FROM notification_work WHERE booking_id=$1 AND kind='customer_reminder' AND channel='email' ORDER BY booking_revision",
      [existing.data.bookingId],
    );
    expect(reminders.rows).toEqual([
      {
        booking_revision: 0,
        status: "not_attempted",
        due_at: "2026-11-02 09:00:00+00",
      },
    ]);
  });

  it("suppresses a pending reminder when its booking is cancelled", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(
        ids.serviceId,
        ids.barberId,
        "cancelled@example.test",
        { startAt: "2026-11-03T09:00:00.000Z" },
      ),
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const cancelled = await cancelOwnerBooking(ids.context, {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    });
    expect(cancelled.success).toBe(true);
    if (!cancelled.success) return;
    const reminder = await database.pool.query(
      `SELECT status,reason,next_attempt_at,due_at::text AS due_at,
              (SELECT count(*)::int FROM notification_attempts a WHERE a.work_id=w.id) AS attempts
       FROM notification_work w WHERE booking_id=$1 AND kind='customer_reminder' AND channel='email'`,
      [created.data.bookingId],
    );
    expect(reminder.rows).toEqual([
      {
        status: "suppressed",
        reason: "superseded",
        next_attempt_at: null,
        due_at: "2026-11-02 09:00:00+00",
        attempts: 0,
      },
    ]);
  });
});
