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

describe("notification work", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let closeAppPool: (() => Promise<void>) | undefined;
  let testAuth: typeof import("@/tests/support/auth").testAuth;
  let createShop: typeof import("@/features/shops/mutations").createShop;
  let saveBarber: typeof import("@/features/barbers/mutations").saveBarber;
  let saveService: typeof import("@/features/catalog/mutations").saveService;
  let saveShopSchedule: typeof import("@/features/availability/mutations").saveShopSchedule;
  let setOwnShopPublication: typeof import("@/features/shops/mutations").setOwnShopPublication;
  let createPublicBooking: typeof import("@/features/bookings/mutations").createPublicBooking;
  let getOwnNotificationActivity: typeof import("../queries").getOwnNotificationActivity;
  const ownerIds: string[] = [];
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
    ({ getOwnNotificationActivity } = await import("../queries"));
    const { pool: appPool } = await import("@/db");
    appPool.options.max = 5;
    closeAppPool = () => appPool.end();
  });

  afterEach(() => {
    process.env.EMAIL_MODE = "mailpit";
    vi.setSystemTime(new Date("2026-11-02T08:00:00Z"));
  });

  afterAll(async () => {
    vi.useRealTimers();
    await database?.pool.query(
      'DELETE FROM "shops" WHERE owner_id = ANY($1::text[])',
      [ownerIds],
    );
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
        email: `notification-${randomUUID()}@example.test`,
        name: "Notification Owner",
      }),
    );
    ownerIds.push(owner.id);
    const context = { userId: owner.id };
    const shop = await createShop(
      context,
      shopInput({
        subdomain: `notify-${randomUUID().slice(0, 8)}`,
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
    const id = (
      await database.pool.query("SELECT id FROM shops WHERE owner_id=$1", [
        owner.id,
      ])
    ).rows[0].id as string;
    return {
      context,
      owner,
      shopId: id,
      barberId: barber.data.id,
      serviceId: service.data.id,
    };
  }

  it("shows exactly the two local email work items with recipients and no capability", async () => {
    const ids = await fixture();
    const result = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(ids.serviceId, ids.barberId, "ada@example.test"),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    const activity = await getOwnNotificationActivity(ids.context);
    expect(activity.success).toBe(true);
    if (!activity.success) return;
    expect(activity.data.rows).toHaveLength(2);
    expect(activity.data.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "customer_confirmation",
          channel: "email",
          status: "not_attempted",
          recipient: "ada@example.test",
          attempt: null,
        }),
        expect.objectContaining({
          kind: "owner_alert",
          channel: "email",
          status: "not_attempted",
          recipient: ids.owner.email,
          attempt: null,
        }),
      ]),
    );
    expect(JSON.stringify(activity)).not.toContain(
      result.data.manageUrl.split("/manage/")[1],
    );
    expect(JSON.stringify(activity)).not.toContain("ciphertext");
  });

  it("returns the same work after an identical recovery request", async () => {
    const ids = await fixture();
    const payload = notificationBookingInput(
      ids.serviceId,
      ids.barberId,
      "ada@example.test",
    );
    const created = await createPublicBooking({ shopId: ids.shopId }, payload);
    expect(created.success).toBe(true);
    if (!created.success) return;
    const before = await getOwnNotificationActivity(ids.context);
    const recovered = await createPublicBooking(
      { shopId: ids.shopId },
      payload,
    );
    expect(recovered).toEqual(created);
    expect(await getOwnNotificationActivity(ids.context)).toEqual(before);
  });

  it("records disabled local mode as unavailable with a reason", async () => {
    process.env.EMAIL_MODE = "disabled";
    const ids = await fixture();
    const result = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(
        ids.serviceId,
        ids.barberId,
        "disabled@example.test",
      ),
    );
    process.env.EMAIL_MODE = "mailpit";
    expect(result.success).toBe(true);
    if (!result.success) return;
    const activity = await getOwnNotificationActivity(ids.context);
    expect(activity.success).toBe(true);
    if (!activity.success) return;
    expect(activity.data.rows).toHaveLength(2);
    expect(
      activity.data.rows.every(
        (row) => row.status === "unavailable" && row.reason === "disabled",
      ),
    ).toBe(true);
  });

  it("rejects null context and scopes activity to the owning user", async () => {
    expect(await getOwnNotificationActivity(null)).toMatchObject({
      success: false,
      error: { code: "UNAUTHORIZED" },
    });
    const first = await fixture();
    const second = await fixture();
    const create = async (
      ids: Awaited<ReturnType<typeof fixture>>,
      email: string,
    ) =>
      createPublicBooking(
        { shopId: ids.shopId },
        notificationBookingInput(ids.serviceId, ids.barberId, email),
      );
    await create(first, "first@example.test");
    const secondBooking = await create(second, "second@example.test");
    expect(secondBooking.success).toBe(true);
    const firstActivity = await getOwnNotificationActivity(first.context);
    const secondActivity = await getOwnNotificationActivity(second.context);
    expect(
      firstActivity.success &&
        firstActivity.data.rows.map((row) => row.recipient),
    ).toEqual(
      expect.arrayContaining(["first@example.test", first.owner.email]),
    );
    expect(
      secondActivity.success &&
        secondActivity.data.rows.map((row) => row.recipient),
    ).toEqual(
      expect.arrayContaining(["second@example.test", second.owner.email]),
    );
    expect(
      secondActivity.success &&
        secondActivity.data.rows.some(
          (row) => row.recipient === "first@example.test",
        ),
    ).toBe(false);
  });

  it("commits no work for a rejected stale offer", async () => {
    const ids = await fixture();
    const rejected = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(
        ids.serviceId,
        ids.barberId,
        "rejected@example.test",
        {
          reviewedOffer: {
            name: "Old Cut",
            priceUsd: "25.00",
            durationMinutes: "30",
          },
        },
      ),
    );
    expect(rejected).toMatchObject({
      success: false,
      error: { code: "STALE_OFFER" },
    });
    const activity = await getOwnNotificationActivity(ids.context);
    expect(activity.success && activity.data.rows).toEqual([]);
  });

  it("commits no work for invalid input or a foreign-shop selection", async () => {
    const first = await fixture();
    const second = await fixture();
    const invalid = await createPublicBooking(
      { shopId: first.shopId },
      { invalid: true },
    );
    expect(invalid).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    const foreign = await createPublicBooking(
      { shopId: first.shopId },
      notificationBookingInput(
        second.serviceId,
        second.barberId,
        "foreign@example.test",
      ),
    );
    expect(foreign).toMatchObject({
      success: false,
      error: { code: "STALE_OFFER" },
    });
    const firstActivity = await getOwnNotificationActivity(first.context);
    expect(firstActivity.success && firstActivity.data.rows).toEqual([]);
  });

  it("adds no work when another booking already occupies the requested slot", async () => {
    const ids = await fixture();
    const first = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(
        ids.serviceId,
        ids.barberId,
        "first-slot@example.test",
      ),
    );
    expect(first.success).toBe(true);
    const before = await getOwnNotificationActivity(ids.context);
    const second = await createPublicBooking(
      { shopId: ids.shopId },
      notificationBookingInput(
        ids.serviceId,
        ids.barberId,
        "second-slot@example.test",
      ),
    );
    expect(second).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    expect(await getOwnNotificationActivity(ids.context)).toEqual(before);
  });
});
