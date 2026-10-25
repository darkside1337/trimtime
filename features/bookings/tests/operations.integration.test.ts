import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
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

describe("public booking operations", () => {
  afterEach(() => vi.setSystemTime(new Date("2026-11-02T08:00:00Z")));
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let appPool: Pool;
  let closeAppPool: (() => Promise<void>) | undefined;
  let testAuth: typeof import("@/tests/support/auth").testAuth;
  let createShop: typeof import("@/features/shops/mutations").createShop;
  let readOwnerContext: typeof import("@/server/owner-context").readOwnerContext;
  let saveBarber: typeof import("@/features/barbers/mutations").saveBarber;
  let archiveBarber: typeof import("@/features/barbers/mutations").archiveBarber;
  let saveService: typeof import("@/features/catalog/mutations").saveService;
  let archiveService: typeof import("@/features/catalog/mutations").archiveService;
  let saveShopSchedule: typeof import("@/features/availability/mutations").saveShopSchedule;
  let saveShopDateSchedule: typeof import("@/features/availability/mutations").saveShopDateSchedule;
  let createTimeBlock: typeof import("@/features/availability/mutations").createTimeBlock;
  let setOwnShopPublication: typeof import("@/features/shops/mutations").setOwnShopPublication;
  let updateOwnShop: typeof import("@/features/shops/mutations").updateOwnShop;
  let createPublicBooking: typeof import("../mutations").createPublicBooking;
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
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T08:00:00Z"));
    await applyMigrations(database.pool, "db/migrations");
    ({ testAuth } = await import("@/tests/support/auth"));
    ({ readOwnerContext } = await import("@/server/owner-context"));
    ({ createShop, setOwnShopPublication, updateOwnShop } =
      await import("@/features/shops/mutations"));
    ({ saveBarber } = await import("@/features/barbers/mutations"));
    ({ archiveBarber } = await import("@/features/barbers/mutations"));
    ({ saveService, archiveService } =
      await import("@/features/catalog/mutations"));
    ({ saveShopSchedule, saveShopDateSchedule, createTimeBlock } =
      await import("@/features/availability/mutations"));
    ({ createPublicBooking } = await import("../mutations"));
    ({ pool: appPool } = await import("@/db"));
    appPool.options.max = 5;
    closeAppPool = () => appPool.end();
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
        email: `booking-${randomUUID()}@example.test`,
        name: "Booking Owner",
      }),
    );
    ownerIds.push(owner.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: owner.id })).headers,
    );
    const shop = await createShop(
      context,
      shopInput({
        subdomain: `booking-${randomUUID().slice(0, 8)}`,
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
    const publication = await setOwnShopPublication(context, {
      published: true,
      expectedPublished: false,
    });
    if (!publication.success) throw new Error("Published shop fixture failed.");
    const row = (
      await database.pool.query("SELECT id FROM shops WHERE owner_id=$1", [
        owner.id,
      ])
    ).rows[0];
    return {
      shopId: row.id as string,
      serviceId: service.data.id,
      barberId: barber.data.id,
      context,
    };
  }

  function input(
    ids: Awaited<ReturnType<typeof fixture>>,
    changes: Record<string, unknown> = {},
  ) {
    return {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T10:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: {
        name: "Ada Lovelace",
        email: "ada@example.test",
        whatsappOptIn: false,
      },
      recoveryKey: randomBytes(32).toString("base64url"),
      ...changes,
    };
  }

  it("atomically saves a booking, occupancy, first zone lock, link, and truthful work records", async () => {
    const ids = await fixture();
    const payload = input(ids);
    const context = { shopId: ids.shopId };
    const [created, duplicate] = await Promise.all([
      createPublicBooking(context, payload),
      createPublicBooking(context, payload),
    ]);
    expect(created).toMatchObject({
      success: true,
      data: {
        booking: {
          service: { name: "Cut", priceUsd: "25.00", durationMinutes: 30 },
          barber: { name: "Sam" },
          customer: { email: "ada@example.test" },
        },
        notifications: { email: "unavailable", whatsapp: "unavailable" },
      },
    });
    if (!created.success) return;
    expect(duplicate).toEqual(created);
    expect(created.data.manageUrl).toContain("/manage/");
    const persisted = await database.pool.query(
      "SELECT b.occupancy_id, s.time_zone_locked_at, (SELECT count(*)::int FROM notification_work w WHERE w.booking_id=b.id) AS work_count, (SELECT count(*)::int FROM bookings WHERE id=b.id) AS booking_count FROM bookings b JOIN shops s ON s.id=b.shop_id WHERE b.id=$1",
      [created.data.bookingId],
    );
    expect(persisted.rows[0]).toMatchObject({
      work_count: 2,
      booking_count: 1,
    });
    expect(persisted.rows[0].occupancy_id).toBeTruthy();
    expect(persisted.rows[0].time_zone_locked_at).toBeTruthy();
    await expect(
      updateOwnShop(ids.context, {
        name: "Juniper Barber",
        publicContact: "Call 202-555-0142",
        timeZone: "America/New_York",
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "TIME_ZONE_LOCKED" },
    });

    await saveService(ids.context, {
      id: ids.serviceId,
      name: "Updated Cut",
      priceUsd: "30",
      durationMinutes: "45",
      offered: true,
      barberIds: [ids.barberId],
    });
    expect(
      (
        await database.pool.query(
          "SELECT service_name, service_price_usd, service_duration_minutes FROM bookings WHERE id=$1",
          [created.data.bookingId],
        )
      ).rows[0],
    ).toEqual({
      service_name: "Cut",
      service_price_usd: "25.00",
      service_duration_minutes: 30,
    });
    await expect(
      createPublicBooking(context, {
        ...payload,
        recoveryKey: randomBytes(32).toString("base64url"),
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "STALE_OFFER" },
    });

    const recovered = await createPublicBooking(context, payload);
    expect(recovered).toEqual(created);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS n FROM bookings WHERE shop_id=$1",
          [ids.shopId],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it("enforces one winner per barber while allowing independent capacity and adjacency", async () => {
    const ids = await fixture();
    const secondBarber = await saveBarber(ids.context, {
      name: "Lee",
      serviceIds: [ids.serviceId],
    });
    expect(secondBarber.success).toBe(true);
    if (!secondBarber.success) return;

    const competitor = (email: string) =>
      createPublicBooking(
        {
          shopId: ids.shopId,
        },
        input(ids, {
          contact: { name: "Customer", email, whatsappOptIn: false },
        }),
      );
    const [first, competing] = await Promise.all([
      competitor("first@example.test"),
      competitor("second@example.test"),
    ]);
    expect([first, competing].filter((result) => result.success)).toHaveLength(
      1,
    );
    expect(
      [first, competing].filter((result) => !result.success),
    ).toMatchObject([
      { success: false, error: { code: "UNAVAILABLE_INTERVAL" } },
    ]);

    const otherBarber = await createPublicBooking(
      {
        shopId: ids.shopId,
      },
      input(ids, {
        barberId: secondBarber.data.id,
        contact: {
          name: "Customer",
          email: "third@example.test",
          whatsappOptIn: false,
        },
      }),
    );
    expect(otherBarber).toMatchObject({ success: true });

    const adjacent = await createPublicBooking(
      {
        shopId: ids.shopId,
      },
      input(ids, {
        startAt: "2026-11-02T10:30:00.000Z",
        contact: {
          name: "Customer",
          email: "fourth@example.test",
          whatsappOptIn: false,
        },
      }),
    );
    expect(adjacent.success).toBe(true);
  });

  it("enforces the normalized email/shop quota and drops events at the exact rolling-hour boundary", async () => {
    const ids = await fixture();
    const base = input(ids);
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(
        createPublicBooking(
          { shopId: ids.shopId },
          {
            ...base,
            recoveryKey: randomBytes(32).toString("base64url"),
            reviewedOffer: { ...base.reviewedOffer, name: "Old Cut" },
            contact: { ...base.contact, email: " ADA@EXAMPLE.TEST " },
          },
        ),
      ).resolves.toMatchObject({
        success: false,
        error: { code: "STALE_OFFER" },
      });
    }
    await expect(
      createPublicBooking(
        {
          shopId: ids.shopId,
        },
        { ...base, recoveryKey: randomBytes(32).toString("base64url") },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "RATE_LIMITED" },
    });
    vi.setSystemTime(new Date("2026-11-02T09:00:00Z"));
    await expect(
      createPublicBooking(
        {
          shopId: ids.shopId,
        },
        { ...base, recoveryKey: randomBytes(32).toString("base64url") },
      ),
    ).resolves.toMatchObject({ success: true });
  });

  it("rolls back schedule, assignment, and barber-retirement edits that invalidate a protected booking", async () => {
    const ids = await fixture();
    const booking = await createPublicBooking(
      {
        shopId: ids.shopId,
      },
      input(ids),
    );
    expect(booking.success).toBe(true);
    if (!booking.success) return;

    const changedHours = await saveShopSchedule(ids.context, {
      week: Array.from({ length: 7 }, (_, index) => ({
        working: index === 0 ? [{ start: 720, end: 1020 }] : [],
        breaks: [],
      })),
      revision: 1,
    });
    expect(changedHours).toMatchObject({
      success: false,
      error: { code: "BOOKING_CONFLICT" },
    });
    await expect(
      saveShopDateSchedule(ids.context, {
        date: "2026-11-02",
        timeZone: "UTC",
        override: null,
        closed: true,
        revision: 0,
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "BOOKING_CONFLICT" },
    });
    await expect(
      createTimeBlock(ids.context, {
        barberId: ids.barberId,
        date: "2026-11-02",
        timeZone: "UTC",
        start: "2026-11-02T10:00:00Z",
        end: "2026-11-02T10:30:00Z",
        note: "",
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "BOOKING_CONFLICT" },
    });

    const removed = await saveService(ids.context, {
      id: ids.serviceId,
      name: "Cut",
      priceUsd: "25",
      durationMinutes: "30",
      offered: true,
      barberIds: [],
    });
    expect(removed).toMatchObject({
      success: false,
      error: { code: "BOOKING_CONFLICT" },
    });
    await expect(
      archiveService(ids.context, ids.serviceId),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "BOOKING_CONFLICT" },
    });
    const archived = await archiveBarber(ids.context, ids.barberId);
    expect(archived).toMatchObject({
      success: false,
      error: { code: "BOOKING_CONFLICT" },
    });

    const state = (
      await database.pool.query(
        "SELECT s.archived, (SELECT count(*)::int FROM barber_services WHERE shop_id=s.shop_id AND service_id=$1 AND barber_id=$2) AS assignment_count, (SELECT revision FROM shop_schedules WHERE shop_id=s.shop_id) AS revision FROM barbers s WHERE s.id=$2",
        [ids.serviceId, ids.barberId],
      )
    ).rows[0];
    expect(state).toMatchObject({
      archived: false,
      assignment_count: 1,
      revision: 1,
    });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS n FROM shop_date_schedules WHERE shop_id=$1",
          [ids.shopId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("serializes a booking against a conflicting hours edit", async () => {
    const ids = await fixture();
    const [booking, hours] = await Promise.all([
      createPublicBooking(
        {
          shopId: ids.shopId,
        },
        input(ids),
      ),
      saveShopSchedule(ids.context, {
        week: Array.from({ length: 7 }, (_, index) => ({
          working: index === 0 ? [{ start: 720, end: 1020 }] : [],
          breaks: [],
        })),
        revision: 1,
      }),
    ]);
    expect(booking.success && hours.success).toBe(false);
    const persisted = await database.pool.query(
      "SELECT b.id, s.week->0 AS monday FROM bookings b JOIN shop_schedules s ON s.shop_id=b.shop_id WHERE b.shop_id=$1",
      [ids.shopId],
    );
    if (persisted.rows.length)
      expect(persisted.rows[0].monday.working[0].start).toBe(540);
    else expect(persisted.rows.length).toBe(0);
  });
});
