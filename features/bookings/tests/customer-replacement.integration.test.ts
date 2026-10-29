import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
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
import {
  waitForLockCleanup as waitForSharedLockCleanup,
  waitForLockWaiters as waitForSharedLockWaiters,
  type RequestIdentity,
} from "@/tests/support/database-locks";
import {
  createRateKeyTracker,
  trackCreateEmailRateKey,
  trackCustomerChangeRateKey,
} from "@/tests/support/rate-keys";
import { shopInput } from "@/tests/support/shops";
import { decryptCapability, hashSecret } from "../capabilities";

const NOW = "2026-11-01T08:00:00Z";
const START_AT = "2026-11-02T10:00:00.000Z";

describe("customer replacement integration", () => {
  afterEach(() => vi.setSystemTime(new Date(NOW)));
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let appPool: Pool;
  let closeAppPool: (() => Promise<void>) | undefined;
  let testAuth: typeof import("@/tests/support/auth").testAuth;
  let createShop: typeof import("@/features/shops/mutations").createShop;
  let readOwnerContext: typeof import("@/server/owner-context").readOwnerContext;
  let saveBarber: typeof import("@/features/barbers/mutations").saveBarber;
  let saveService: typeof import("@/features/catalog/mutations").saveService;
  let saveShopSchedule: typeof import("@/features/availability/mutations").saveShopSchedule;
  let saveBarberSchedule: typeof import("@/features/availability/mutations").saveBarberSchedule;
  let saveShopDateSchedule: typeof import("@/features/availability/mutations").saveShopDateSchedule;
  let setOwnShopPublication: typeof import("@/features/shops/mutations").setOwnShopPublication;
  let createPublicBooking: typeof import("../mutations").createPublicBooking;
  let createOwnerBooking: typeof import("../mutations").createOwnerBooking;
  let cancelCustomerBooking: typeof import("../mutations").cancelCustomerBooking;
  let moveOwnerBooking: typeof import("../mutations").moveOwnerBooking;
  let replaceCustomerBooking: typeof import("../mutations").replaceCustomerBooking;
  let getManagedBooking: typeof import("../queries").getManagedBooking;
  let getCustomerReplacementChoices: typeof import("../queries").getCustomerReplacementChoices;
  let getCustomerReplacementSlots: typeof import("../queries").getCustomerReplacementSlots;
  const ownerIds: string[] = [];
  const rateKeys = createRateKeyTracker();
  const ownedBudgetDays = new Set<string>();
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
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    await applyMigrations(database.pool, "db/migrations");
    ({ testAuth } = await import("@/tests/support/auth"));
    ({ readOwnerContext } = await import("@/server/owner-context"));
    ({ createShop, setOwnShopPublication } =
      await import("@/features/shops/mutations"));
    ({ saveBarber } = await import("@/features/barbers/mutations"));
    ({ saveService } = await import("@/features/catalog/mutations"));
    ({ saveShopSchedule, saveBarberSchedule, saveShopDateSchedule } =
      await import("@/features/availability/mutations"));
    ({ moveOwnerBooking } = await import("../mutations"));
    const mutations = await import("../mutations");
    createPublicBooking = (context, input) => {
      trackCreateEmailRateKey(rateKeys, context, input);
      return mutations.createPublicBooking(context, input);
    };
    createOwnerBooking = mutations.createOwnerBooking;
    cancelCustomerBooking = (context, input) => {
      trackCustomerChangeRateKey(rateKeys, context, input);
      return mutations.cancelCustomerBooking(context, input);
    };
    replaceCustomerBooking = (context, input) => {
      trackCustomerChangeRateKey(rateKeys, context, input);
      return mutations.replaceCustomerBooking(context, input);
    };
    ({
      getCustomerReplacementChoices,
      getCustomerReplacementSlots,
      getManagedBooking,
    } = await import("../queries"));
    ({ pool: appPool } = await import("@/db"));
    appPool.options.max = 5;
    closeAppPool = () => appPool.end();
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (database) await rateKeys.deleteAll(database.pool);
    await database?.pool.query(
      'DELETE FROM "shops" WHERE owner_id = ANY($1::text[])',
      [ownerIds],
    );
    if (ownedBudgetDays.size)
      await database?.pool.query(
        "DELETE FROM outbound_budget WHERE day = ANY($1::date[])",
        [[...ownedBudgetDays]],
      );
    ownedBudgetDays.clear();
    await Promise.all(
      ownerIds.map((id) =>
        testAuth.$context.then(({ test }) => test.deleteUser(id)),
      ),
    );
    await closeAppPool?.();
    await database?.pool.end();
  });

  async function fixture(
    options: { published?: boolean; timeZone?: string } = {},
  ) {
    const { published = true, timeZone = "UTC" } = options;
    const helpers = (await testAuth.$context).test;
    const owner = await helpers.saveUser(
      helpers.createUser({
        email: `replace-${randomUUID()}@example.test`,
        name: "Replacement Owner",
      }),
    );
    ownerIds.push(owner.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: owner.id })).headers,
    );
    const shop = await createShop(
      context,
      shopInput({
        subdomain: `replace-${randomUUID().slice(0, 8)}`,
        timeZone,
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
    if (published) {
      const publication = await setOwnShopPublication(context, {
        published: true,
        expectedPublished: false,
      });
      if (!publication.success)
        throw new Error("Published shop fixture failed.");
    }
    const row = (
      await database.pool.query("SELECT id FROM shops WHERE owner_id=$1", [
        owner.id,
      ])
    ).rows[0];
    return {
      shopId: row.id as string,
      ownerId: owner.id,
      context,
      serviceId: service.data.id,
      barberId: barber.data.id,
    };
  }

  function bookingInput(
    ids: Awaited<ReturnType<typeof fixture>>,
    changes: Record<string, unknown> = {},
  ) {
    return {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: START_AT,
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

  async function createBooking(
    ids: Awaited<ReturnType<typeof fixture>>,
    changes: Record<string, unknown> = {},
  ) {
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      bookingInput(ids, changes),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const token = new URL(created.data.manageUrl).pathname.split("/").at(-1)!;
    return { ...created.data, token };
  }

  function cancellationInput(
    token: string,
    changes: Record<string, unknown> = {},
  ) {
    return {
      token,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      confirmed: true as const,
      ...changes,
    };
  }

  async function bookingState(bookingId: string, occupancyId: string | null) {
    const row = (
      await database.pool.query(
        `SELECT b.status,b.revision,b.occupancy_id,b.start_at,b.end_at,
          (SELECT count(*)::int FROM occupied_intervals i WHERE i.id=$2) AS original_occupancy,
          (SELECT count(*)::int FROM booking_changes c WHERE c.booking_id=b.id) AS changes,
          (SELECT count(*)::int FROM notification_work w WHERE w.booking_id=b.id) AS work
        FROM bookings b WHERE b.id=$1`,
        [bookingId, occupancyId],
      )
    ).rows[0];
    return row as {
      status: string;
      revision: number;
      occupancy_id: string | null;
      start_at: Date;
      end_at: Date;
      original_occupancy: number;
      changes: number;
      work: number;
    };
  }

  async function rateEventCount(shopId: string, token: string) {
    const keyHash = hashSecret(`${shopId}:${token}`);
    const row = (
      await database.pool.query(
        `SELECT count(*)::int AS count FROM public_rate_events WHERE scope='customer_change_link' AND key_hash=$1`,
        [keyHash],
      )
    ).rows[0];
    return row.count as number;
  }

  async function waitForLockWaiters(
    barrier: PoolClient,
    expected: number,
    expectedIdentities?: RequestIdentity[],
  ) {
    return waitForSharedLockWaiters(
      database.pool,
      barrier,
      expected,
      expectedIdentities,
    );
  }

  async function waitForLockCleanup(barrier: PoolClient) {
    return waitForSharedLockCleanup(database.pool, barrier);
  }

  it("1. valid token returns real choices; no sample services", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);

    const result = await getCustomerReplacementChoices(
      { shopId: ids.shopId },
      booking.token,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.revision).toBe(0);
    expect(result.data.timeZone).toBe("UTC");
    expect(result.data.retainedService).toEqual({
      id: ids.serviceId,
      name: "Cut",
      priceUsd: "25.00",
      durationMinutes: 30,
    });
    expect(result.data.barbers).toEqual([{ id: ids.barberId, name: "Sam" }]);
    expect(result.data.services).toEqual([
      {
        id: ids.serviceId,
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: 30,
        barberIds: [ids.barberId],
        hidden: false,
      },
    ]);

    const serviceNames = result.data.services.map((s) => s.name);
    expect(serviceNames).not.toContain("Classic cut");
    expect(serviceNames).not.toContain("Beard tidy");
    expect(serviceNames).not.toContain("Cut & beard");
  });

  it("2. hide retained Cut and change catalog to $40/60 minutes: retained choice remains saved $25/30 minutes", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);

    const updateServiceResult = await saveService(ids.context, {
      id: ids.serviceId,
      name: "Cut",
      priceUsd: "40",
      durationMinutes: "60",
      offered: false,
      barberIds: [ids.barberId],
    });
    expect(updateServiceResult.success).toBe(true);

    const choicesResult = await getCustomerReplacementChoices(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(choicesResult.success).toBe(true);
    if (!choicesResult.success) return;

    expect(choicesResult.data.retainedService).toEqual({
      id: ids.serviceId,
      name: "Cut",
      priceUsd: "25.00",
      durationMinutes: 30,
    });
    expect(choicesResult.data.services).toEqual([
      {
        id: ids.serviceId,
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: 30,
        barberIds: [ids.barberId],
        hidden: true,
      },
    ]);

    const slotsResult = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );

    expect(slotsResult.success).toBe(true);
    if (!slotsResult.success) return;

    // Check that slots use the retained 30-minute duration, not 60 minutes
    const elevenAm = slotsResult.data.slots.find(
      (s) => s.start === "2026-11-02T11:00:00Z",
    );
    expect(elevenAm).toBeDefined();
    expect(elevenAm?.end).toBe("2026-11-02T11:30:00Z");
  });

  it("3. different service uses current details; wrong-shop, hidden/archived different service and unassigned/archived barber never become selectable", async () => {
    const ids = await fixture();
    const otherShop = await fixture();
    const booking = await createBooking(ids);

    // 1. Different offered service in same shop: Shave $35/45 min
    const shave = await saveService(ids.context, {
      name: "Shave",
      priceUsd: "35",
      durationMinutes: "45",
      offered: true,
      barberIds: [ids.barberId],
    });
    expect(shave.success).toBe(true);
    if (!shave.success) return;

    // 2. Active barber Alex in same shop, but only assigned to Cut, not Shave
    const alexBarber = await saveBarber(ids.context, {
      name: "Alex",
      serviceIds: [ids.serviceId],
    });
    expect(alexBarber.success).toBe(true);
    if (!alexBarber.success) return;

    // 3. Hidden different service in same shop
    const hiddenService = await saveService(ids.context, {
      name: "Secret Service",
      priceUsd: "50",
      durationMinutes: "45",
      offered: false,
      barberIds: [ids.barberId],
    });
    expect(hiddenService.success).toBe(true);
    if (!hiddenService.success) return;

    // 4. Archived different service in same shop
    const archivedServiceId = randomUUID();
    await database.pool.query(
      `INSERT INTO services (id, shop_id, name, price_usd, duration_minutes, offered, archived)
       VALUES ($1, $2, 'Old Service', '50.00', '45', true, true)`,
      [archivedServiceId, ids.shopId],
    );
    await database.pool.query(
      `INSERT INTO barber_services (shop_id, barber_id, service_id)
       VALUES ($1, $2, $3)`,
      [ids.shopId, ids.barberId, archivedServiceId],
    );

    // 5. Archived barber in same shop
    const archivedBarberId = randomUUID();
    await database.pool.query(
      `INSERT INTO barbers (id, shop_id, name, archived)
       VALUES ($1, $2, 'Archived Bob', true)`,
      [archivedBarberId, ids.shopId],
    );
    await database.pool.query(
      `INSERT INTO barber_services (shop_id, barber_id, service_id)
       VALUES ($1, $2, $3)`,
      [ids.shopId, archivedBarberId, shave.data.id],
    );

    // Assert choices
    const choicesResult = await getCustomerReplacementChoices(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(choicesResult.success).toBe(true);
    if (!choicesResult.success) return;

    // Different service uses current details
    const shaveChoice = choicesResult.data.services.find(
      (s) => s.id === shave.data.id,
    );
    expect(shaveChoice).toEqual({
      id: shave.data.id,
      name: "Shave",
      priceUsd: "35.00",
      durationMinutes: 45,
      barberIds: [ids.barberId],
      hidden: false,
    });

    // Wrong-shop service, hidden different service, and archived different service are not in choices
    const serviceIds = choicesResult.data.services.map((s) => s.id);
    expect(serviceIds).not.toContain(otherShop.serviceId);
    expect(serviceIds).not.toContain(hiddenService.data.id);
    expect(serviceIds).not.toContain(archivedServiceId);

    // Active barber Alex is in barbers list, but unassigned to Shave
    const barberIds = choicesResult.data.barbers.map((b) => b.id);
    expect(barberIds).toContain(alexBarber.data.id);
    expect(shaveChoice?.barberIds).not.toContain(alexBarber.data.id);

    // Archived barber is not in barbers list
    expect(barberIds).not.toContain(archivedBarberId);

    // Assert slots
    // 1. Shave with assigned barber succeeds with 45-min duration
    const validShaveSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: shave.data.id,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );
    expect(validShaveSlots.success).toBe(true);
    if (validShaveSlots.success) {
      const slot = validShaveSlots.data.slots.find(
        (s) => s.start === "2026-11-02T11:00:00Z",
      );
      expect(slot?.end).toBe("2026-11-02T11:45:00Z");
    }

    // 2. Wrong-shop service fails
    const wrongShopSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: otherShop.serviceId,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );
    expect(wrongShopSlots.success).toBe(false);
    if (!wrongShopSlots.success) {
      expect(wrongShopSlots.error.code).toBe("VALIDATION_ERROR");
    }

    // 3. Hidden different service fails
    const hiddenSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: hiddenService.data.id,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );
    expect(hiddenSlots.success).toBe(false);
    if (!hiddenSlots.success) {
      expect(hiddenSlots.error.code).toBe("VALIDATION_ERROR");
    }

    // 4. Archived different service fails
    const archivedServiceSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: archivedServiceId,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );
    expect(archivedServiceSlots.success).toBe(false);
    if (!archivedServiceSlots.success) {
      expect(archivedServiceSlots.error.code).toBe("VALIDATION_ERROR");
    }

    // 5. Unassigned barber fails
    const unassignedSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: shave.data.id,
        barberId: alexBarber.data.id,
        date: "2026-11-02",
      },
    );
    expect(unassignedSlots.success).toBe(false);
    if (!unassignedSlots.success) {
      expect(unassignedSlots.error.code).toBe("VALIDATION_ERROR");
    }

    // 6. Archived barber fails
    const archivedBarberSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: shave.data.id,
        barberId: archivedBarberId,
        date: "2026-11-02",
      },
    );
    expect(archivedBarberSlots.success).toBe(false);
    if (!archivedBarberSlots.success) {
      expect(archivedBarberSlots.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("4. exclude own occupancy: overlapping alternative start appears if otherwise valid; another booking still blocks it", async () => {
    const ids = await fixture();
    // Booking 1: 10:00 - 10:30
    const booking1 = await createBooking(ids, {
      startAt: "2026-11-02T10:00:00.000Z",
    });

    // Booking 2 (another customer with same barber): 11:00 - 11:30
    const booking2 = await createBooking(ids, {
      startAt: "2026-11-02T11:00:00.000Z",
    });
    expect(booking2.bookingId).not.toBe(booking1.bookingId);

    const slotsResult = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking1.token,
        expectedRevision: 0,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );

    expect(slotsResult.success).toBe(true);
    if (!slotsResult.success) return;

    const slotStarts = slotsResult.data.slots.map((s) => s.start);

    // 10:00 and 10:15 overlap booking1's own original interval (10:00-10:30), but appear because own occupancy is excluded
    expect(slotStarts).toContain("2026-11-02T10:00:00Z");
    expect(slotStarts).toContain("2026-11-02T10:15:00Z");

    // 11:00 is occupied by booking2 and must be blocked
    expect(slotStarts).not.toContain("2026-11-02T11:00:00Z");
    // 10:45 would end at 11:15, overlapping booking2, so it must also be blocked
    expect(slotStarts).not.toContain("2026-11-02T10:45:00Z");
  });

  it("5. unpublish shop: authorized choices/starts remain available", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);

    // Unpublish the shop
    const unpublishResult = await setOwnShopPublication(ids.context, {
      published: false,
      expectedPublished: true,
    });
    expect(unpublishResult.success).toBe(true);

    // Authorized choices remain available
    const choicesResult = await getCustomerReplacementChoices(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(choicesResult.success).toBe(true);
    if (!choicesResult.success) return;

    expect(choicesResult.data.services.length).toBeGreaterThan(0);

    // Authorized slots remain available
    const slotsResult = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );
    expect(slotsResult.success).toBe(true);
    if (!slotsResult.success) return;

    expect(slotsResult.data.slots.length).toBeGreaterThan(0);
  });
  it("6. invalid/revoked/expired/wrong-shop capability: generic unavailable, no linked details", async () => {
    const ids = await fixture();
    const otherShop = await fixture();
    const booking = await createBooking(ids);

    const malformedSlotsFields = {
      expectedRevision: -1,
      serviceId: "",
      barberId: "",
      date: "not-a-date",
    };

    // 1. Invalid token
    const invalidChoices = await getCustomerReplacementChoices(
      { shopId: ids.shopId },
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    expect(invalidChoices).toEqual({
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    });

    const invalidSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        expectedRevision: 0,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );
    expect(invalidSlots).toEqual({
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    });

    const invalidSlotsMalformed = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        ...malformedSlotsFields,
      },
    );
    expect(invalidSlotsMalformed).toEqual({
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    });

    // 2. Wrong-shop context
    const wrongShopChoices = await getCustomerReplacementChoices(
      { shopId: otherShop.shopId },
      booking.token,
    );
    expect(wrongShopChoices).toEqual({
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    });

    const wrongShopSlots = await getCustomerReplacementSlots(
      { shopId: otherShop.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );
    expect(wrongShopSlots).toEqual({
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    });

    const wrongShopSlotsMalformed = await getCustomerReplacementSlots(
      { shopId: otherShop.shopId },
      {
        token: booking.token,
        ...malformedSlotsFields,
      },
    );
    expect(wrongShopSlotsMalformed).toEqual({
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    });

    // 3. Revoked capability
    await database.pool.query(
      "UPDATE bookings SET capability_revoked_at = NOW() WHERE id = $1",
      [booking.bookingId],
    );

    const revokedChoices = await getCustomerReplacementChoices(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(revokedChoices).toEqual({
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    });

    const revokedSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );
    expect(revokedSlots).toEqual({
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    });

    const revokedSlotsMalformed = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        ...malformedSlotsFields,
      },
    );
    expect(revokedSlotsMalformed).toEqual({
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    });

    // Reset revoked to test expired
    await database.pool.query(
      "UPDATE bookings SET capability_revoked_at = NULL WHERE id = $1",
      [booking.bookingId],
    );

    // 4. Expired capability (endAt + 168h + 1ms)
    // booking.startAt is 2026-11-02T10:00:00Z, service duration 30 min -> endAt 2026-11-02T10:30:00Z.
    // 168 hours = 7 days -> 2026-11-09T10:30:00Z.
    const expiredTime = new Date("2026-11-09T10:30:01Z");
    vi.setSystemTime(expiredTime);

    const expiredChoices = await getCustomerReplacementChoices(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(expiredChoices).toEqual({
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    });

    const expiredSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );
    expect(expiredSlots).toEqual({
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    });

    const expiredSlotsMalformed = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        ...malformedSlotsFields,
      },
    );
    expect(expiredSlotsMalformed).toEqual({
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    });

    // 5. Missing or empty token with malformed fields
    const missingTokenSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        ...malformedSlotsFields,
      },
    );
    expect(missingTokenSlots).toEqual({
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    });

    const emptyTokenSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: "",
        ...malformedSlotsFields,
      },
    );
    expect(emptyTokenSlots).toEqual({
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    });
  });
  it("7. cancelled, cutoff or stale revision cannot produce actionable replacement results", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);

    // (c) Stale expectedRevision for slots query
    const staleSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 999,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );
    expect(staleSlots.success).toBe(false);
    if (!staleSlots.success) {
      expect(staleSlots.error.code).toBe("STALE_BOOKING");
    }

    // (b) Inside 12-hour cutoff
    // booking.startAt is 2026-11-02T10:00:00Z. Cutoff is 12h before (2026-11-01T22:00:00Z).
    // Set time to 2026-11-01T22:00:01Z (11h 59m 59s before startAt).
    vi.setSystemTime(new Date("2026-11-01T22:00:01Z"));

    const cutoffChoices = await getCustomerReplacementChoices(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(cutoffChoices.success).toBe(false);
    if (!cutoffChoices.success) {
      expect(cutoffChoices.error.code).toBe("CUTOFF_PASSED");
    }

    const cutoffSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );
    expect(cutoffSlots.success).toBe(false);
    if (!cutoffSlots.success) {
      expect(cutoffSlots.error.code).toBe("CUTOFF_PASSED");
    }

    // Reset time back to NOW
    vi.setSystemTime(new Date(NOW));

    // (a) Cancelled booking
    await database.pool.query(
      "UPDATE bookings SET status = 'cancelled' WHERE id = $1",
      [booking.bookingId],
    );

    const cancelledChoices = await getCustomerReplacementChoices(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(cancelledChoices.success).toBe(false);
    if (!cancelledChoices.success) {
      expect(cancelledChoices.error.code).toBe("INVALID_STATE");
    }

    const cancelledSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );
    expect(cancelledSlots.success).toBe(false);
    if (!cancelledSlots.success) {
      expect(cancelledSlots.error.code).toBe("INVALID_STATE");
    }
  });

  function replacementInput(
    token: string,
    ids: { serviceId: string; barberId: string },
    changes: Record<string, unknown> = {},
  ) {
    return {
      token,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      confirmed: true as const,
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T11:00:00.000Z",
      reviewedOffer: {
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: "30",
      },
      ...changes,
    };
  }

  it("Slice 3 Case 1: Move original 10:00 to 11:00 on November 2: same token; revision +1; saved $25/30-minute snapshot; updated occupancy; customer-attributed move event", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    const beforeBooking = (
      await database.pool.query(
        "SELECT capability_hash, capability_ciphertext, capability_key_id, occupancy_id FROM bookings WHERE id = $1",
        [booking.bookingId],
      )
    ).rows[0];

    const operationKey = randomBytes(32).toString("base64url");
    const input = replacementInput(booking.token, ids, {
      operationKey,
      startAt: "2026-11-02T11:00:00.000Z",
    });

    const receipt = await replaceCustomerBooking({ shopId: ids.shopId }, input);

    expect(receipt.success).toBe(true);
    if (!receipt.success) return;

    expect(receipt.data.bookingId).toBe(booking.bookingId);
    expect(receipt.data.operation.revision).toBe(1);
    expect(receipt.data.operation.snapshot).toMatchObject({
      status: "confirmed",
      serviceId: ids.serviceId,
      serviceName: "Cut",
      servicePriceUsd: "25.00",
      serviceDurationMinutes: 30,
      barberId: ids.barberId,
      barberName: "Sam",
      startAt: "2026-11-02T11:00:00.000Z",
      endAt: "2026-11-02T11:30:00.000Z",
    });

    // Check bookings row: same token, revision +1, updated times
    const afterBooking = (
      await database.pool.query(
        "SELECT status, revision, start_at, end_at, service_name, service_price_usd, service_duration_minutes, barber_name, capability_hash, capability_ciphertext, capability_key_id, occupancy_id FROM bookings WHERE id = $1",
        [booking.bookingId],
      )
    ).rows[0];

    expect(afterBooking).toMatchObject({
      status: "confirmed",
      revision: 1,
      start_at: new Date("2026-11-02T11:00:00.000Z"),
      end_at: new Date("2026-11-02T11:30:00.000Z"),
      service_name: "Cut",
      service_price_usd: "25.00",
      service_duration_minutes: 30,
      barber_name: "Sam",
      capability_hash: beforeBooking.capability_hash,
      capability_ciphertext: beforeBooking.capability_ciphertext,
      capability_key_id: beforeBooking.capability_key_id,
    });
    expect(afterBooking.occupancy_id).toBe(beforeBooking.occupancy_id);

    // Check occupied_intervals: updated occupancy
    const occupancy = (
      await database.pool.query(
        "SELECT barber_id, start_at, end_at FROM occupied_intervals WHERE id = $1",
        [afterBooking.occupancy_id],
      )
    ).rows[0];
    expect(occupancy).toMatchObject({
      barber_id: ids.barberId,
      start_at: new Date("2026-11-02T11:00:00.000Z"),
      end_at: new Date("2026-11-02T11:30:00.000Z"),
    });

    // Old interval must not be occupied
    const oldOccupancy = (
      await database.pool.query(
        "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = '2026-11-02T10:00:00.000Z'",
        [ids.shopId, ids.barberId],
      )
    ).rows[0];
    expect(oldOccupancy.count).toBe(0);

    // Check booking_changes: customer-attributed move event
    const events = (
      await database.pool.query(
        "SELECT id, actor_id, actor_type, kind, applied_revision, committed_at, operation_key_hash, before_snapshot, after_snapshot FROM booking_changes WHERE booking_id = $1",
        [booking.bookingId],
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: receipt.data.operation.id,
      actor_id: null,
      actor_type: "customer",
      kind: "move",
      applied_revision: 1,
      committed_at: new Date(NOW),
      operation_key_hash: hashSecret(operationKey),
      before_snapshot: {
        status: "confirmed",
        serviceId: ids.serviceId,
        serviceName: "Cut",
        servicePriceUsd: "25.00",
        serviceDurationMinutes: 30,
        barberId: ids.barberId,
        barberName: "Sam",
        startAt: "2026-11-02T10:00:00.000Z",
        endAt: "2026-11-02T10:30:00.000Z",
      },
      after_snapshot: {
        status: "confirmed",
        serviceId: ids.serviceId,
        serviceName: "Cut",
        servicePriceUsd: "25.00",
        serviceDurationMinutes: 30,
        barberId: ids.barberId,
        barberName: "Sam",
        startAt: "2026-11-02T11:00:00.000Z",
        endAt: "2026-11-02T11:30:00.000Z",
      },
    });

    // Verify same token still reads managed booking with new details
    const managed = await getManagedBooking(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(managed).toMatchObject({
      success: true,
      data: {
        status: "confirmed",
        revision: 1,
        startAt: "2026-11-02T11:00:00.000Z",
        endAt: "2026-11-02T11:30:00.000Z",
      },
    });
  });

  it("Slice 3 Case 2: Change barber alone to another active assigned barber", async () => {
    const ids = await fixture();
    // Add second active barber assigned to the same service
    const secondBarber = await saveBarber(ids.context, {
      name: "Alex",
      serviceIds: [ids.serviceId],
    });
    expect(secondBarber.success).toBe(true);
    if (!secondBarber.success) return;

    // Original booking is with barber Sam at 10:00
    const booking = await createBooking(ids);

    const input = replacementInput(booking.token, ids, {
      barberId: secondBarber.data.id,
      startAt: START_AT, // unchanged start time: 10:00
    });

    const receipt = await replaceCustomerBooking({ shopId: ids.shopId }, input);

    expect(receipt.success).toBe(true);
    if (!receipt.success) return;

    expect(receipt.data.bookingId).toBe(booking.bookingId);
    expect(receipt.data.operation.revision).toBe(1);
    expect(receipt.data.operation.snapshot).toMatchObject({
      status: "confirmed",
      serviceId: ids.serviceId,
      serviceName: "Cut",
      servicePriceUsd: "25.00",
      serviceDurationMinutes: 30,
      barberId: secondBarber.data.id,
      barberName: "Alex",
      startAt: START_AT,
      endAt: "2026-11-02T10:30:00.000Z",
    });

    // Check bookings row
    const afterBooking = (
      await database.pool.query(
        "SELECT status, revision, barber_id, barber_name, start_at, end_at, occupancy_id FROM bookings WHERE id = $1",
        [booking.bookingId],
      )
    ).rows[0];

    expect(afterBooking).toMatchObject({
      status: "confirmed",
      revision: 1,
      barber_id: secondBarber.data.id,
      barber_name: "Alex",
      start_at: new Date(START_AT),
      end_at: new Date("2026-11-02T10:30:00.000Z"),
    });

    // Check occupied_intervals: barber_id is updated to Alex
    const occupancy = (
      await database.pool.query(
        "SELECT barber_id, start_at, end_at FROM occupied_intervals WHERE id = $1",
        [afterBooking.occupancy_id],
      )
    ).rows[0];
    expect(occupancy).toMatchObject({
      barber_id: secondBarber.data.id,
      start_at: new Date(START_AT),
      end_at: new Date("2026-11-02T10:30:00.000Z"),
    });

    // Old barber (Sam) has no occupancy at 10:00
    const oldOccupancy = (
      await database.pool.query(
        "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = $3",
        [ids.shopId, ids.barberId, START_AT],
      )
    ).rows[0];
    expect(oldOccupancy.count).toBe(0);

    // Check booking_changes: customer move event reflects barber change
    const events = (
      await database.pool.query(
        "SELECT actor_id, actor_type, kind, applied_revision, before_snapshot, after_snapshot FROM booking_changes WHERE booking_id = $1",
        [booking.bookingId],
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor_id: null,
      actor_type: "customer",
      kind: "move",
      applied_revision: 1,
      before_snapshot: {
        barberId: ids.barberId,
        barberName: "Sam",
        startAt: START_AT,
      },
      after_snapshot: {
        barberId: secondBarber.data.id,
        barberName: "Alex",
        startAt: START_AT,
      },
    });
  });

  it("Slice 3 Case 3: Hidden retained service remains usable; inactive/unassigned barber rejects", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);

    // Hide the retained service Cut and change catalog details
    const hideResult = await saveService(ids.context, {
      id: ids.serviceId,
      name: "Cut",
      priceUsd: "50",
      durationMinutes: "60",
      offered: false,
      barberIds: [ids.barberId],
    });
    expect(hideResult.success).toBe(true);

    // 1. Hidden retained service remains usable at new time 11:00 with saved offer details
    const validHiddenInput = replacementInput(booking.token, ids, {
      startAt: "2026-11-02T11:00:00.000Z",
    });
    const receipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      validHiddenInput,
    );
    expect(receipt.success).toBe(true);
    if (!receipt.success) return;
    expect(receipt.data.operation.snapshot).toMatchObject({
      serviceId: ids.serviceId,
      serviceName: "Cut",
      servicePriceUsd: "25.00",
      serviceDurationMinutes: 30,
    });

    // 2. Unassigned barber rejects
    const unassignedBarber = await saveBarber(ids.context, {
      name: "Unassigned Dave",
      serviceIds: [], // not assigned to Cut
    });
    expect(unassignedBarber.success).toBe(true);
    if (!unassignedBarber.success) return;

    const unassignedInput = replacementInput(booking.token, ids, {
      expectedRevision: 1,
      barberId: unassignedBarber.data.id,
      startAt: "2026-11-02T12:00:00.000Z",
    });
    const unassignedResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      unassignedInput,
    );
    expect(unassignedResult.success).toBe(false);
    if (!unassignedResult.success) {
      expect(unassignedResult.error.code).toBe("UNAVAILABLE_INTERVAL");
    }

    // 3. Archived (inactive) barber rejects
    const archivedBarberId = randomUUID();
    await database.pool.query(
      `INSERT INTO barbers (id, shop_id, name, archived) VALUES ($1, $2, 'Archived Bob', true)`,
      [archivedBarberId, ids.shopId],
    );
    await database.pool.query(
      `INSERT INTO barber_services (shop_id, barber_id, service_id) VALUES ($1, $2, $3)`,
      [ids.shopId, archivedBarberId, ids.serviceId],
    );

    const archivedInput = replacementInput(booking.token, ids, {
      expectedRevision: 1,
      barberId: archivedBarberId,
      startAt: "2026-11-02T12:00:00.000Z",
    });
    const archivedResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      archivedInput,
    );
    expect(archivedResult.success).toBe(false);
    if (!archivedResult.success) {
      expect(archivedResult.error.code).toBe("UNAVAILABLE_INTERVAL");
    }
  });

  it("Slice 3 Case 4: Occupied destination rejects; original details/occupancy remain unchanged", async () => {
    const ids = await fixture();
    // Booking 1: 10:00 - 10:30
    const booking1 = await createBooking(ids, {
      startAt: "2026-11-02T10:00:00.000Z",
    });
    // Booking 2: 11:00 - 11:30 with same barber
    const booking2 = await createBooking(ids, {
      startAt: "2026-11-02T11:00:00.000Z",
    });

    const booking1Before = (
      await database.pool.query(
        "SELECT status, revision, start_at, end_at, service_id, barber_id, occupancy_id FROM bookings WHERE id = $1",
        [booking1.bookingId],
      )
    ).rows[0];

    const occupancy1Before = (
      await database.pool.query(
        "SELECT barber_id, start_at, end_at FROM occupied_intervals WHERE id = $1",
        [booking1Before.occupancy_id],
      )
    ).rows[0];

    // Attempt to move booking 1 to 11:00 (which is occupied by booking 2)
    const conflictInput = replacementInput(booking1.token, ids, {
      startAt: "2026-11-02T11:00:00.000Z",
    });

    const result = await replaceCustomerBooking(
      { shopId: ids.shopId },
      conflictInput,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNAVAILABLE_INTERVAL");
    }

    // Original booking 1 details remain unchanged
    const booking1After = (
      await database.pool.query(
        "SELECT status, revision, start_at, end_at, service_id, barber_id, occupancy_id FROM bookings WHERE id = $1",
        [booking1.bookingId],
      )
    ).rows[0];
    expect(booking1After).toEqual(booking1Before);

    // Original occupancy remains unchanged
    const occupancy1After = (
      await database.pool.query(
        "SELECT barber_id, start_at, end_at FROM occupied_intervals WHERE id = $1",
        [booking1Before.occupancy_id],
      )
    ).rows[0];
    expect(occupancy1After).toEqual(occupancy1Before);

    // No booking changes recorded for booking 1
    const changesCount = (
      await database.pool.query(
        "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id = $1",
        [booking1.bookingId],
      )
    ).rows[0];
    expect(changesCount.count).toBe(0);

    // Booking 2 remains confirmed and unchanged
    const booking2After = (
      await database.pool.query(
        "SELECT status, revision, start_at, end_at FROM bookings WHERE id = $1",
        [booking2.bookingId],
      )
    ).rows[0];
    expect(booking2After).toMatchObject({
      status: "confirmed",
      revision: 0,
      start_at: new Date("2026-11-02T11:00:00.000Z"),
      end_at: new Date("2026-11-02T11:30:00.000Z"),
    });
  });

  it("Slice 3 Case 5: Partially overlapping self-move succeeds without other conflicts", async () => {
    const ids = await fixture();
    // Original booking at 10:00 - 10:30
    const booking = await createBooking(ids, {
      startAt: "2026-11-02T10:00:00.000Z",
    });

    // Move to 10:15 (10:15 - 10:45), partially overlapping 10:00 - 10:30
    const overlapInput = replacementInput(booking.token, ids, {
      startAt: "2026-11-02T10:15:00.000Z",
    });

    const receipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      overlapInput,
    );

    expect(receipt.success).toBe(true);
    if (!receipt.success) return;

    expect(receipt.data.bookingId).toBe(booking.bookingId);
    expect(receipt.data.operation.revision).toBe(1);
    expect(receipt.data.operation.snapshot).toMatchObject({
      startAt: "2026-11-02T10:15:00.000Z",
      endAt: "2026-11-02T10:45:00.000Z",
    });

    // Verify bookings row
    const afterBooking = (
      await database.pool.query(
        "SELECT status, revision, start_at, end_at, occupancy_id FROM bookings WHERE id = $1",
        [booking.bookingId],
      )
    ).rows[0];
    expect(afterBooking).toMatchObject({
      status: "confirmed",
      revision: 1,
      start_at: new Date("2026-11-02T10:15:00.000Z"),
      end_at: new Date("2026-11-02T10:45:00.000Z"),
    });

    // Verify occupancy row updated
    const occupancy = (
      await database.pool.query(
        "SELECT barber_id, start_at, end_at FROM occupied_intervals WHERE id = $1",
        [afterBooking.occupancy_id],
      )
    ).rows[0];
    expect(occupancy).toMatchObject({
      barber_id: ids.barberId,
      start_at: new Date("2026-11-02T10:15:00.000Z"),
      end_at: new Date("2026-11-02T10:45:00.000Z"),
    });
  });

  it("Slice 3 Case 6: Exact no-change returns NO_CHANGE, no event/work", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids, {
      startAt: "2026-11-02T10:00:00.000Z",
    });

    const bookingBefore = (
      await database.pool.query(
        "SELECT status, revision, start_at, end_at FROM bookings WHERE id = $1",
        [booking.bookingId],
      )
    ).rows[0];

    // Submit replacement with identical service, barber, and start time
    const noChangeInput = replacementInput(booking.token, ids, {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T10:00:00.000Z",
    });

    const result = await replaceCustomerBooking(
      { shopId: ids.shopId },
      noChangeInput,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NO_CHANGE");
    }

    // Verify booking row unchanged
    const bookingAfter = (
      await database.pool.query(
        "SELECT status, revision, start_at, end_at FROM bookings WHERE id = $1",
        [booking.bookingId],
      )
    ).rows[0];
    expect(bookingAfter).toEqual(bookingBefore);

    // Verify no booking_changes event was recorded
    const changes = (
      await database.pool.query(
        "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id = $1",
        [booking.bookingId],
      )
    ).rows[0];
    expect(changes.count).toBe(0);

    // Verify no notification_work was added for revision > 0
    const work = (
      await database.pool.query(
        "SELECT count(*)::int AS count FROM notification_work WHERE booking_id = $1 AND booking_revision > 0",
        [booking.bookingId],
      )
    ).rows[0];
    expect(work.count).toBe(0);
  });

  it("Slice 3 Case 7: Force persistence failure using the existing transaction-test approach: occupancy, booking, event and work roll back together", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids, {
      startAt: "2026-11-02T10:00:00.000Z",
    });

    const before = (
      await database.pool.query(
        `SELECT b.status, b.revision, b.occupancy_id, b.start_at, b.end_at,
          (SELECT count(*)::int FROM notification_work w WHERE w.booking_id = b.id) AS work
         FROM bookings b WHERE b.id = $1`,
        [booking.bookingId],
      )
    ).rows[0];

    const suffix = randomUUID().replaceAll("-", "");
    const fn = `reject_customer_replace_work_${suffix}`;
    const trigger = `reject_customer_replace_work_trigger_${suffix}`;

    // Force failure during notification work insertion
    await database.pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.booking_id = '${booking.bookingId}'::uuid AND NEW.kind = 'customer_move' THEN
           RAISE EXCEPTION 'forced replace work failure';
         END IF;
         RETURN NEW;
       END $$`,
    );
    await database.pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON notification_work FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );

    try {
      const input = replacementInput(booking.token, ids, {
        startAt: "2026-11-02T11:00:00.000Z",
      });

      const receipt = await replaceCustomerBooking(
        { shopId: ids.shopId },
        input,
      );

      expect(receipt).toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE" },
      });

      // Verify all changes rolled back together: occupancy, booking, event and work
      const after = (
        await database.pool.query(
          `SELECT b.status, b.revision, b.occupancy_id, b.start_at, b.end_at,
            (SELECT count(*)::int FROM booking_changes c WHERE c.booking_id = b.id) AS changes,
            (SELECT count(*)::int FROM notification_work w WHERE w.booking_id = b.id) AS work,
            (SELECT count(*)::int FROM occupied_intervals i WHERE i.id = b.occupancy_id AND i.start_at = '2026-11-02T10:00:00Z' AND i.end_at = '2026-11-02T10:30:00Z') AS original_occupancy,
            (SELECT count(*)::int FROM occupied_intervals i WHERE i.shop_id = b.shop_id AND i.start_at = '2026-11-02T11:00:00Z') AS destination_occupancy
           FROM bookings b WHERE b.id = $1`,
          [booking.bookingId],
        )
      ).rows[0];

      expect(after).toMatchObject({
        status: "confirmed",
        revision: 0,
        occupancy_id: before.occupancy_id,
        start_at: new Date("2026-11-02T10:00:00.000Z"),
        end_at: new Date("2026-11-02T10:30:00.000Z"),
        changes: 0,
        work: before.work,
        original_occupancy: 1,
        destination_occupancy: 0,
      });

      // Verify managed booking still reads original confirmed state
      const managed = await getManagedBooking(
        { shopId: ids.shopId },
        booking.token,
      );
      expect(managed).toMatchObject({
        success: true,
        data: {
          status: "confirmed",
          revision: 0,
          startAt: "2026-11-02T10:00:00.000Z",
          endAt: "2026-11-02T10:30:00.000Z",
        },
      });
    } finally {
      await database.pool.query(
        `DROP TRIGGER IF EXISTS ${trigger} ON notification_work`,
      );
      await database.pool.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
  });

  it("Slice 4 Case 1: Offered different service $40/45 minutes commits reviewed values and 45-minute occupancy", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);

    const deluxe = await saveService(ids.context, {
      name: "Deluxe Cut",
      priceUsd: "40",
      durationMinutes: "45",
      offered: true,
      barberIds: [ids.barberId],
    });
    expect(deluxe.success).toBe(true);
    if (!deluxe.success) return;

    const input = replacementInput(booking.token, ids, {
      serviceId: deluxe.data.id,
      reviewedOffer: {
        name: "Deluxe Cut",
        priceUsd: "40.00",
        durationMinutes: "45",
      },
      startAt: "2026-11-02T11:00:00.000Z",
    });

    const receipt = await replaceCustomerBooking({ shopId: ids.shopId }, input);

    expect(receipt.success).toBe(true);
    if (!receipt.success) return;

    expect(receipt.data.bookingId).toBe(booking.bookingId);
    expect(receipt.data.operation.revision).toBe(1);
    expect(receipt.data.operation.snapshot).toMatchObject({
      status: "confirmed",
      serviceId: deluxe.data.id,
      serviceName: "Deluxe Cut",
      servicePriceUsd: "40.00",
      serviceDurationMinutes: 45,
      barberId: ids.barberId,
      barberName: "Sam",
      startAt: "2026-11-02T11:00:00.000Z",
      endAt: "2026-11-02T11:45:00.000Z",
    });

    const afterBooking = (
      await database.pool.query(
        "SELECT status, revision, service_id, service_name, service_price_usd, service_duration_minutes, start_at, end_at, occupancy_id FROM bookings WHERE id = $1",
        [booking.bookingId],
      )
    ).rows[0];

    expect(afterBooking).toMatchObject({
      status: "confirmed",
      revision: 1,
      service_id: deluxe.data.id,
      service_name: "Deluxe Cut",
      service_price_usd: "40.00",
      service_duration_minutes: 45,
      start_at: new Date("2026-11-02T11:00:00.000Z"),
      end_at: new Date("2026-11-02T11:45:00.000Z"),
    });

    const occupancy = (
      await database.pool.query(
        "SELECT barber_id, start_at, end_at FROM occupied_intervals WHERE id = $1",
        [afterBooking.occupancy_id],
      )
    ).rows[0];

    expect(occupancy).toMatchObject({
      barber_id: ids.barberId,
      start_at: new Date("2026-11-02T11:00:00.000Z"),
      end_at: new Date("2026-11-02T11:45:00.000Z"),
    });

    const events = (
      await database.pool.query(
        "SELECT actor_id, actor_type, kind, applied_revision, before_snapshot, after_snapshot FROM booking_changes WHERE booking_id = $1",
        [booking.bookingId],
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor_id: null,
      actor_type: "customer",
      kind: "move",
      applied_revision: 1,
      before_snapshot: {
        serviceId: ids.serviceId,
        serviceName: "Cut",
        servicePriceUsd: "25.00",
        serviceDurationMinutes: 30,
        startAt: "2026-11-02T10:00:00.000Z",
        endAt: "2026-11-02T10:30:00.000Z",
      },
      after_snapshot: {
        serviceId: deluxe.data.id,
        serviceName: "Deluxe Cut",
        servicePriceUsd: "40.00",
        serviceDurationMinutes: 45,
        startAt: "2026-11-02T11:00:00.000Z",
        endAt: "2026-11-02T11:45:00.000Z",
      },
    });
  });

  it("Slice 4 Case 2: Independently alter name, price and duration after review: STALE_OFFER, intact original; refreshed explicit review succeeds", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);

    const shave = await saveService(ids.context, {
      name: "Shave",
      priceUsd: "30",
      durationMinutes: "30",
      offered: true,
      barberIds: [ids.barberId],
    });
    expect(shave.success).toBe(true);
    if (!shave.success) return;

    const initialReviewedOffer = {
      name: "Shave",
      priceUsd: "30.00",
      durationMinutes: "30",
    };

    const bookingBefore = (
      await database.pool.query(
        "SELECT status, revision, service_id, service_name, service_price_usd, service_duration_minutes, start_at, end_at, occupancy_id FROM bookings WHERE id = $1",
        [booking.bookingId],
      )
    ).rows[0];

    // 1. Alter name independently
    await saveService(ids.context, {
      id: shave.data.id,
      name: "Deluxe Shave",
      priceUsd: "30",
      durationMinutes: "30",
      offered: true,
      barberIds: [ids.barberId],
    });

    const staleNameInput = replacementInput(booking.token, ids, {
      serviceId: shave.data.id,
      reviewedOffer: initialReviewedOffer,
      startAt: "2026-11-02T11:00:00.000Z",
    });
    const staleNameResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      staleNameInput,
    );
    expect(staleNameResult).toMatchObject({
      success: false,
      error: { code: "STALE_OFFER" },
    });

    // 2. Alter price independently
    await saveService(ids.context, {
      id: shave.data.id,
      name: "Shave",
      priceUsd: "35",
      durationMinutes: "30",
      offered: true,
      barberIds: [ids.barberId],
    });

    const stalePriceInput = replacementInput(booking.token, ids, {
      serviceId: shave.data.id,
      reviewedOffer: initialReviewedOffer,
      startAt: "2026-11-02T11:00:00.000Z",
    });
    const stalePriceResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      stalePriceInput,
    );
    expect(stalePriceResult).toMatchObject({
      success: false,
      error: { code: "STALE_OFFER" },
    });

    // 3. Alter duration independently
    await saveService(ids.context, {
      id: shave.data.id,
      name: "Shave",
      priceUsd: "30",
      durationMinutes: "45",
      offered: true,
      barberIds: [ids.barberId],
    });

    const staleDurationInput = replacementInput(booking.token, ids, {
      serviceId: shave.data.id,
      reviewedOffer: initialReviewedOffer,
      startAt: "2026-11-02T11:00:00.000Z",
    });
    const staleDurationResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      staleDurationInput,
    );
    expect(staleDurationResult).toMatchObject({
      success: false,
      error: { code: "STALE_OFFER" },
    });

    // Verify original booking is completely intact
    const bookingAfterStale = (
      await database.pool.query(
        "SELECT status, revision, service_id, service_name, service_price_usd, service_duration_minutes, start_at, end_at, occupancy_id FROM bookings WHERE id = $1",
        [booking.bookingId],
      )
    ).rows[0];
    expect(bookingAfterStale).toEqual(bookingBefore);

    const changesCount = (
      await database.pool.query(
        "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id = $1",
        [booking.bookingId],
      )
    ).rows[0];
    expect(changesCount.count).toBe(0);

    // 4. Update catalog to Deluxe Shave $35/45m, and refreshed explicit review succeeds
    await saveService(ids.context, {
      id: shave.data.id,
      name: "Deluxe Shave",
      priceUsd: "35",
      durationMinutes: "45",
      offered: true,
      barberIds: [ids.barberId],
    });

    const refreshedInput = replacementInput(booking.token, ids, {
      serviceId: shave.data.id,
      reviewedOffer: {
        name: "Deluxe Shave",
        priceUsd: "35.00",
        durationMinutes: "45",
      },
      startAt: "2026-11-02T11:00:00.000Z",
    });
    const refreshedReceipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      refreshedInput,
    );
    expect(refreshedReceipt.success).toBe(true);
    if (!refreshedReceipt.success) return;

    expect(refreshedReceipt.data.bookingId).toBe(booking.bookingId);
    expect(refreshedReceipt.data.operation.revision).toBe(1);
    expect(refreshedReceipt.data.operation.snapshot).toMatchObject({
      serviceId: shave.data.id,
      serviceName: "Deluxe Shave",
      servicePriceUsd: "35.00",
      serviceDurationMinutes: 45,
      startAt: "2026-11-02T11:00:00.000Z",
      endAt: "2026-11-02T11:45:00.000Z",
    });
  });

  it("Slice 4 Case 3: Hide/archive/unassign after preview: reject intact", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);

    const shave = await saveService(ids.context, {
      name: "Shave",
      priceUsd: "35",
      durationMinutes: "45",
      offered: true,
      barberIds: [ids.barberId],
    });
    expect(shave.success).toBe(true);
    if (!shave.success) return;

    const bookingBefore = (
      await database.pool.query(
        "SELECT status, revision, service_id, service_name, service_price_usd, service_duration_minutes, barber_id, barber_name, start_at, end_at, occupancy_id FROM bookings WHERE id = $1",
        [booking.bookingId],
      )
    ).rows[0];

    const makeInput = () =>
      replacementInput(booking.token, ids, {
        serviceId: shave.data.id,
        reviewedOffer: {
          name: "Shave",
          priceUsd: "35.00",
          durationMinutes: "45",
        },
        startAt: "2026-11-02T11:00:00.000Z",
      });

    // 1. Hide different service after preview
    await database.pool.query(
      "UPDATE services SET offered = false WHERE id = $1",
      [shave.data.id],
    );
    const hiddenResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      makeInput(),
    );
    expect(hiddenResult).toMatchObject({
      success: false,
      error: { code: "STALE_OFFER" },
    });

    // Restore offered = true
    await database.pool.query(
      "UPDATE services SET offered = true WHERE id = $1",
      [shave.data.id],
    );

    // 2. Archive different service after preview
    await database.pool.query(
      "UPDATE services SET archived = true WHERE id = $1",
      [shave.data.id],
    );
    const archivedServiceResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      makeInput(),
    );
    expect(archivedServiceResult).toMatchObject({
      success: false,
      error: { code: "STALE_OFFER" },
    });

    // Restore archived = false
    await database.pool.query(
      "UPDATE services SET archived = false WHERE id = $1",
      [shave.data.id],
    );

    // 3. Unassign barber after preview
    await database.pool.query(
      "DELETE FROM barber_services WHERE barber_id = $1 AND service_id = $2",
      [ids.barberId, shave.data.id],
    );
    const unassignedResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      makeInput(),
    );
    expect(unassignedResult).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });

    // Restore assignment
    await database.pool.query(
      "INSERT INTO barber_services (shop_id, barber_id, service_id) VALUES ($1, $2, $3)",
      [ids.shopId, ids.barberId, shave.data.id],
    );

    // 4. Archive barber after preview
    await database.pool.query(
      "UPDATE barbers SET archived = true WHERE id = $1",
      [ids.barberId],
    );
    const archivedBarberResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      makeInput(),
    );
    expect(archivedBarberResult).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });

    // Restore barber
    await database.pool.query(
      "UPDATE barbers SET archived = false WHERE id = $1",
      [ids.barberId],
    );

    // Verify original booking is completely intact
    const bookingAfter = (
      await database.pool.query(
        "SELECT status, revision, service_id, service_name, service_price_usd, service_duration_minutes, barber_id, barber_name, start_at, end_at, occupancy_id FROM bookings WHERE id = $1",
        [booking.bookingId],
      )
    ).rows[0];
    expect(bookingAfter).toEqual(bookingBefore);

    const changesCount = (
      await database.pool.query(
        "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id = $1",
        [booking.bookingId],
      )
    ).rows[0];
    expect(changesCount.count).toBe(0);
  });

  it("Slice 4 Case 4: A→B→A follows D2; hidden A prevents returning to A", async () => {
    const ids = await fixture();
    // Booking starts with service A (ids.serviceId = Cut)
    const booking = await createBooking(ids);

    // Create service B (Shave)
    const serviceB = await saveService(ids.context, {
      name: "Shave",
      priceUsd: "35",
      durationMinutes: "45",
      offered: true,
      barberIds: [ids.barberId],
    });
    expect(serviceB.success).toBe(true);
    if (!serviceB.success) return;

    // 1. Move A -> B
    const aToBInput = replacementInput(booking.token, ids, {
      serviceId: serviceB.data.id,
      reviewedOffer: {
        name: "Shave",
        priceUsd: "35.00",
        durationMinutes: "45",
      },
      startAt: "2026-11-02T11:00:00.000Z",
    });
    const aToBReceipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      aToBInput,
    );
    expect(aToBReceipt.success).toBe(true);
    if (!aToBReceipt.success) return;

    expect(aToBReceipt.data.operation.revision).toBe(1);
    expect(aToBReceipt.data.operation.snapshot).toMatchObject({
      serviceId: serviceB.data.id,
      serviceName: "Shave",
    });

    // 2. Hide Service A
    await database.pool.query(
      "UPDATE services SET offered = false WHERE id = $1",
      [ids.serviceId],
    );

    // 3. Attempt B -> A: hidden A must prevent returning to A
    const bToAInput = replacementInput(booking.token, ids, {
      expectedRevision: 1,
      serviceId: ids.serviceId,
      reviewedOffer: {
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: "30",
      },
      startAt: "2026-11-02T12:00:00.000Z",
    });
    const bToAResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      bToAInput,
    );
    expect(bToAResult).toMatchObject({
      success: false,
      error: { code: "STALE_OFFER" },
    });

    // Booking remains Service B
    const bookingAfterReject = (
      await database.pool.query(
        "SELECT status, revision, service_id, service_name FROM bookings WHERE id = $1",
        [booking.bookingId],
      )
    ).rows[0];
    expect(bookingAfterReject).toMatchObject({
      status: "confirmed",
      revision: 1,
      service_id: serviceB.data.id,
      service_name: "Shave",
    });

    // 4. Also verify choices after A->B reflects B as retained service, and hidden A is excluded
    const choicesAfterAToB = await getCustomerReplacementChoices(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(choicesAfterAToB.success).toBe(true);
    if (!choicesAfterAToB.success) return;

    expect(choicesAfterAToB.data.retainedService.id).toBe(serviceB.data.id);
    const availableServiceIds = choicesAfterAToB.data.services.map((s) => s.id);
    expect(availableServiceIds).toContain(serviceB.data.id);
    expect(availableServiceIds).not.toContain(ids.serviceId);

    // 5. Hide service B: retaining B still preserves B (same-service retention)
    await database.pool.query(
      "UPDATE services SET offered = false WHERE id = $1",
      [serviceB.data.id],
    );

    const retainBInput = replacementInput(booking.token, ids, {
      expectedRevision: 1,
      serviceId: serviceB.data.id,
      reviewedOffer: {
        name: "Shave",
        priceUsd: "35.00",
        durationMinutes: "45",
      },
      startAt: "2026-11-02T12:00:00.000Z",
    });
    const retainBReceipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      retainBInput,
    );
    expect(retainBReceipt.success).toBe(true);
    if (!retainBReceipt.success) return;

    expect(retainBReceipt.data.operation.revision).toBe(2);
    expect(retainBReceipt.data.operation.snapshot).toMatchObject({
      serviceId: serviceB.data.id,
      serviceName: "Shave",
      startAt: "2026-11-02T12:00:00.000Z",
      endAt: "2026-11-02T12:45:00.000Z",
    });

    // 6. Edit service A in catalog (offered: true with updated name, price and duration)
    const updateServiceAResult = await saveService(ids.context, {
      id: ids.serviceId,
      name: "Deluxe Cut",
      priceUsd: "40",
      durationMinutes: "40",
      offered: true,
      barberIds: [ids.barberId],
    });
    expect(updateServiceAResult.success).toBe(true);

    // Verify choices after catalog edit offers service A with current values
    const choicesAfterEditA = await getCustomerReplacementChoices(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(choicesAfterEditA.success).toBe(true);
    if (!choicesAfterEditA.success) return;
    const choiceA = choicesAfterEditA.data.services.find(
      (s) => s.id === ids.serviceId,
    );
    expect(choiceA).toEqual({
      id: ids.serviceId,
      name: "Deluxe Cut",
      priceUsd: "40.00",
      durationMinutes: 40,
      barberIds: [ids.barberId],
      hidden: false,
    });

    // 7. Successful B -> A replacement (completing A -> B -> A) using A's current offered values
    const successfulBToAInput = replacementInput(booking.token, ids, {
      expectedRevision: 2,
      serviceId: ids.serviceId,
      reviewedOffer: {
        name: "Deluxe Cut",
        priceUsd: "40.00",
        durationMinutes: "40",
      },
      startAt: "2026-11-02T14:00:00.000Z",
    });
    const bToAReceipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      successfulBToAInput,
    );
    expect(bToAReceipt.success).toBe(true);
    if (!bToAReceipt.success) return;

    expect(bToAReceipt.data.bookingId).toBe(booking.bookingId);
    expect(bToAReceipt.data.operation.revision).toBe(3);
    expect(bToAReceipt.data.operation.snapshot).toMatchObject({
      status: "confirmed",
      serviceId: ids.serviceId,
      serviceName: "Deluxe Cut",
      servicePriceUsd: "40.00",
      serviceDurationMinutes: 40,
      barberId: ids.barberId,
      barberName: "Sam",
      startAt: "2026-11-02T14:00:00.000Z",
      endAt: "2026-11-02T14:40:00.000Z",
    });

    // Assert current snapshot in bookings row
    const bookingAfterBToA = (
      await database.pool.query(
        "SELECT status, revision, service_id, service_name, service_price_usd, service_duration_minutes, start_at, end_at, occupancy_id FROM bookings WHERE id = $1",
        [booking.bookingId],
      )
    ).rows[0];
    expect(bookingAfterBToA).toMatchObject({
      status: "confirmed",
      revision: 3,
      service_id: ids.serviceId,
      service_name: "Deluxe Cut",
      service_price_usd: "40.00",
      service_duration_minutes: 40,
      start_at: new Date("2026-11-02T14:00:00.000Z"),
      end_at: new Date("2026-11-02T14:40:00.000Z"),
    });

    // Assert current occupancy in occupied_intervals
    const currentOccupancy = (
      await database.pool.query(
        "SELECT barber_id, start_at, end_at FROM occupied_intervals WHERE id = $1",
        [bookingAfterBToA.occupancy_id],
      )
    ).rows[0];
    expect(currentOccupancy).toMatchObject({
      barber_id: ids.barberId,
      start_at: new Date("2026-11-02T14:00:00.000Z"),
      end_at: new Date("2026-11-02T14:40:00.000Z"),
    });

    // Assert old occupancy (at 12:00) is cleared
    const oldOccupancy = (
      await database.pool.query(
        "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = '2026-11-02T12:00:00.000Z'",
        [ids.shopId, ids.barberId],
      )
    ).rows[0];
    expect(oldOccupancy.count).toBe(0);
  });

  it("Slice 4 Case 5: Existing start exactly twelve hours away qualifies; one millisecond below fails", async () => {
    const ids = await fixture();
    // Original booking at 2026-11-02T10:00:00.000Z
    const booking = await createBooking(ids, {
      startAt: "2026-11-02T10:00:00.000Z",
    });

    // 1. Exactly 12 hours away: 2026-11-01T22:00:00.000Z
    vi.setSystemTime(new Date("2026-11-01T22:00:00.000Z"));

    const choicesAtCutoff = await getCustomerReplacementChoices(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(choicesAtCutoff.success).toBe(true);

    const slotsAtCutoff = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );
    expect(slotsAtCutoff.success).toBe(true);

    const replaceAtCutoff = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(booking.token, ids, {
        startAt: "2026-11-02T11:00:00.000Z",
      }),
    );
    expect(replaceAtCutoff.success).toBe(true);
    if (!replaceAtCutoff.success) return;
    expect(replaceAtCutoff.data.operation.revision).toBe(1);

    // 2. One millisecond below 12 hours
    // Create new booking at 2026-11-02T10:00:00.000Z with another barber
    const barber2 = await saveBarber(ids.context, {
      name: "Barber Two",
      serviceIds: [ids.serviceId],
    });
    expect(barber2.success).toBe(true);
    if (!barber2.success) return;

    vi.setSystemTime(new Date(NOW));
    const booking2 = await createBooking(ids, {
      barberId: barber2.data.id,
      startAt: "2026-11-02T10:00:00.000Z",
    });

    // Set time to 1ms after 22:00:00: 2026-11-01T22:00:00.001Z (11h 59m 59.999s before startAt)
    vi.setSystemTime(new Date("2026-11-01T22:00:00.001Z"));

    const choicesBelowCutoff = await getCustomerReplacementChoices(
      { shopId: ids.shopId },
      booking2.token,
    );
    expect(choicesBelowCutoff).toMatchObject({
      success: false,
      error: { code: "CUTOFF_PASSED" },
    });

    const slotsBelowCutoff = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking2.token,
        expectedRevision: 0,
        serviceId: ids.serviceId,
        barberId: barber2.data.id,
        date: "2026-11-02",
      },
    );
    expect(slotsBelowCutoff).toMatchObject({
      success: false,
      error: { code: "CUTOFF_PASSED" },
    });

    const replaceBelowCutoff = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(
        booking2.token,
        {
          serviceId: ids.serviceId,
          barberId: barber2.data.id,
        },
        {
          startAt: "2026-11-02T11:00:00.000Z",
        },
      ),
    );
    expect(replaceBelowCutoff).toMatchObject({
      success: false,
      error: { code: "CUTOFF_PASSED" },
    });

    // Verify booking2 remains intact
    const booking2After = (
      await database.pool.query(
        "SELECT status, revision, start_at FROM bookings WHERE id = $1",
        [booking2.bookingId],
      )
    ).rows[0];
    expect(booking2After).toMatchObject({
      status: "confirmed",
      revision: 0,
      start_at: new Date("2026-11-02T10:00:00.000Z"),
    });
  });

  it("Slice 4 Case 6: Replacement +2 hours succeeds; +1 hour equality succeeds; below +1 hour fails", async () => {
    const ids = await fixture();
    // NOW is 2026-11-01T08:00:00Z.
    // Original booking is 2026-11-02T10:00:00Z (> 12h away).
    const booking = await createBooking(ids);

    // 1. Replacement +2 hours from NOW (2026-11-01T10:00:00Z) succeeds
    // (Proves no 12-hour cutoff is erroneously enforced against the new replacement time)
    const twoHoursInput = replacementInput(booking.token, ids, {
      startAt: "2026-11-01T10:00:00.000Z",
    });
    const twoHoursReceipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      twoHoursInput,
    );
    expect(twoHoursReceipt.success).toBe(true);
    if (!twoHoursReceipt.success) return;

    expect(twoHoursReceipt.data.operation.revision).toBe(1);
    expect(twoHoursReceipt.data.operation.snapshot).toMatchObject({
      startAt: "2026-11-01T10:00:00.000Z",
      endAt: "2026-11-01T10:30:00.000Z",
    });

    // 2. Test below +1 hour fails on a booking with startAt > 12h away
    const booking2 = await createBooking(ids, {
      startAt: "2026-11-02T10:00:00.000Z",
    });

    // Below +1 hour fails: try 2026-11-01T08:45:00Z (45 min from NOW = 08:00:00Z)
    const belowOneHourInput = replacementInput(booking2.token, ids, {
      startAt: "2026-11-01T08:45:00.000Z",
    });
    const belowOneHourResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      belowOneHourInput,
    );
    expect(belowOneHourResult).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });

    // Also test 1 millisecond past the hour (08:00:00.001Z) so 09:00:00Z is below +1 hour
    vi.setSystemTime(new Date("2026-11-01T08:00:00.001Z"));
    const belowOneHourBy1msInput = replacementInput(booking2.token, ids, {
      startAt: "2026-11-01T09:00:00.000Z",
    });
    const belowOneHourBy1msResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      belowOneHourBy1msInput,
    );
    expect(belowOneHourBy1msResult).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });

    // 3. +1 hour equality succeeds: reset time back to exact 08:00:00Z, so 09:00:00Z is exactly +1h
    vi.setSystemTime(new Date("2026-11-01T08:00:00.000Z"));
    const exactOneHourInput = replacementInput(booking2.token, ids, {
      startAt: "2026-11-01T09:00:00.000Z",
    });
    const exactOneHourReceipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      exactOneHourInput,
    );
    expect(exactOneHourReceipt.success).toBe(true);
    if (!exactOneHourReceipt.success) return;

    expect(exactOneHourReceipt.data.operation.revision).toBe(1);
    expect(exactOneHourReceipt.data.operation.snapshot).toMatchObject({
      startAt: "2026-11-01T09:00:00.000Z",
      endAt: "2026-11-01T09:30:00.000Z",
    });
  });

  it("Slice 4 Case 7: Local date +30 qualifies for its whole valid date; +31 fails. Reject off-grid, break/closure, insufficient duration and overnight crossing", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);

    // 1. Local date +30 (2026-12-01) qualifies for its whole valid date
    const slotsPlus30 = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-12-01",
      },
    );
    expect(slotsPlus30.success).toBe(true);
    if (!slotsPlus30.success) return;
    expect(slotsPlus30.data.slots.length).toBeGreaterThan(0);
    // Last slot of day (16:30 - 17:00) is present
    expect(
      slotsPlus30.data.slots.some((s) => s.start === "2026-12-01T16:30:00Z"),
    ).toBe(true);

    const replacePlus30 = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(booking.token, ids, {
        startAt: "2026-12-01T16:30:00.000Z",
      }),
    );
    expect(replacePlus30.success).toBe(true);
    if (!replacePlus30.success) return;
    expect(replacePlus30.data.operation.revision).toBe(1);

    const getBookingState = async () =>
      (
        await database.pool.query(
          "SELECT status, revision, service_id, barber_id, start_at, end_at, occupancy_id FROM bookings WHERE id = $1",
          [booking.bookingId],
        )
      ).rows[0];

    const getOccupancyState = async (occupancyId: string) =>
      (
        await database.pool.query(
          "SELECT barber_id, start_at, end_at FROM occupied_intervals WHERE id = $1",
          [occupancyId],
        )
      ).rows[0];

    const getChangesCount = async () =>
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id = $1",
          [booking.bookingId],
        )
      ).rows[0].count;

    const bookingBefore = await getBookingState();
    const occupancyBefore = await getOccupancyState(bookingBefore.occupancy_id);
    const changesBefore = await getChangesCount();

    // 2. Local date +31 (2026-12-02) fails
    const slotsPlus31 = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 1,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-12-02",
      },
    );
    expect(slotsPlus31.success).toBe(true);
    if (slotsPlus31.success) {
      expect(slotsPlus31.data.slots).toEqual([]);
    }

    const replacePlus31 = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(booking.token, ids, {
        expectedRevision: 1,
        startAt: "2026-12-02T10:00:00.000Z",
      }),
    );
    expect(replacePlus31).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    expect(await getBookingState()).toEqual(bookingBefore);
    expect(await getOccupancyState(bookingBefore.occupancy_id)).toEqual(
      occupancyBefore,
    );
    expect(await getChangesCount()).toBe(changesBefore);

    // 3. Reject off-grid (e.g. 11:07:00Z)
    const offGrid = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(booking.token, ids, {
        expectedRevision: 1,
        startAt: "2026-11-02T11:07:00.000Z",
      }),
    );
    expect(offGrid).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    expect(await getBookingState()).toEqual(bookingBefore);
    expect(await getOccupancyState(bookingBefore.occupancy_id)).toEqual(
      occupancyBefore,
    );
    expect(await getChangesCount()).toBe(changesBefore);

    // 4. Reject break: update schedule to include a break 12:00-13:00 (720-780)
    const weekWithBreak = Array.from({ length: 7 }, () => ({
      working: [{ start: 540, end: 1020 }],
      breaks: [{ start: 720, end: 780 }],
    }));
    const saveBreakResult = await saveShopSchedule(ids.context, {
      week: weekWithBreak,
      revision: 1,
    });
    expect(saveBreakResult.success).toBe(true);

    const breakInput = replacementInput(booking.token, ids, {
      expectedRevision: 1,
      startAt: "2026-11-02T12:00:00.000Z",
    });
    const breakResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      breakInput,
    );
    expect(breakResult).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    expect(await getBookingState()).toEqual(bookingBefore);
    expect(await getOccupancyState(bookingBefore.occupancy_id)).toEqual(
      occupancyBefore,
    );
    expect(await getChangesCount()).toBe(changesBefore);

    // 5. Reject closure: save a dated shop closure on 2026-11-10
    const closureResult = await saveShopDateSchedule(ids.context, {
      date: "2026-11-10",
      timeZone: "UTC",
      override: null,
      closed: true,
      revision: 0,
    });
    expect(closureResult.success).toBe(true);

    const closedSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 1,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-11-10",
      },
    );
    expect(closedSlots.success).toBe(true);
    if (closedSlots.success) {
      expect(closedSlots.data.slots).toEqual([]);
    }

    const closureInput = replacementInput(booking.token, ids, {
      expectedRevision: 1,
      startAt: "2026-11-10T11:00:00.000Z",
    });
    const closureResultReject = await replaceCustomerBooking(
      { shopId: ids.shopId },
      closureInput,
    );
    expect(closureResultReject).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    expect(await getBookingState()).toEqual(bookingBefore);
    expect(await getOccupancyState(bookingBefore.occupancy_id)).toEqual(
      occupancyBefore,
    );
    expect(await getChangesCount()).toBe(changesBefore);

    // 6. Insufficient duration: 16:45 start for 30 min service when closing is 17:00
    const overrunInput = replacementInput(booking.token, ids, {
      expectedRevision: 1,
      startAt: "2026-11-02T16:45:00.000Z",
    });
    const overrunResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      overrunInput,
    );
    expect(overrunResult).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    expect(await getBookingState()).toEqual(bookingBefore);
    expect(await getOccupancyState(bookingBefore.occupancy_id)).toEqual(
      occupancyBefore,
    );
    expect(await getChangesCount()).toBe(changesBefore);

    // 7. Overnight crossing: configure schedule open through midnight (09:00 - 24:00, 540-1440)
    const lateWeek = Array.from({ length: 7 }, () => ({
      working: [{ start: 540, end: 1440 }],
      breaks: [],
    }));
    const lateShopResult = await saveShopSchedule(ids.context, {
      week: lateWeek,
      revision: 2,
    });
    expect(lateShopResult.success).toBe(true);

    const lateBarberResult = await saveBarberSchedule(ids.context, {
      barberId: ids.barberId,
      week: lateWeek,
      revision: 1,
    });
    expect(lateBarberResult.success).toBe(true);

    // Slots preview allows exact midnight completion (23:30 - 24:00) but excludes 23:45 crossing midnight
    const midnightSlots = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 1,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-11-02",
      },
    );
    expect(midnightSlots.success).toBe(true);
    if (!midnightSlots.success) return;
    const slotStarts = midnightSlots.data.slots.map((s) => s.start);
    expect(slotStarts).toContain("2026-11-02T23:30:00Z");
    expect(slotStarts).not.toContain("2026-11-02T23:45:00Z");

    // Attempt start at 23:45 (inside working hours [540, 1440), but 30m duration crosses midnight to 00:15)
    const overnightInput = replacementInput(booking.token, ids, {
      expectedRevision: 1,
      startAt: "2026-11-02T23:45:00.000Z",
    });
    const overnightResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      overnightInput,
    );
    expect(overnightResult).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    expect(await getBookingState()).toEqual(bookingBefore);
    expect(await getOccupancyState(bookingBefore.occupancy_id)).toEqual(
      occupancyBefore,
    );
    expect(await getChangesCount()).toBe(changesBefore);

    // Exact midnight completion (23:30 - 24:00) on the same schedule succeeds
    const exactMidnightInput = replacementInput(booking.token, ids, {
      expectedRevision: 1,
      startAt: "2026-11-02T23:30:00.000Z",
    });
    const exactMidnightReceipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      exactMidnightInput,
    );
    expect(exactMidnightReceipt.success).toBe(true);
    if (!exactMidnightReceipt.success) return;
    expect(exactMidnightReceipt.data.operation.revision).toBe(2);
    expect(exactMidnightReceipt.data.operation.snapshot).toMatchObject({
      startAt: "2026-11-02T23:30:00.000Z",
      endAt: "2026-11-03T00:00:00.000Z",
    });
  });

  it("Slice 4 Case 8: Use existing independently specified DST gap/fold fixtures; preview and commit agree on real instants and offsets", async () => {
    // 1. America/New_York shop fixture with full-day schedule
    const ids = await fixture({ timeZone: "America/New_York" });
    const fullWeek = Array.from({ length: 7 }, () => ({
      working: [{ start: 0, end: 1440 }],
      breaks: [],
    }));
    await saveShopSchedule(ids.context, { week: fullWeek, revision: 1 });
    await saveBarberSchedule(ids.context, {
      barberId: ids.barberId,
      week: fullWeek,
      revision: 1,
    });

    // 2. Fall fold test: clocks fall back on 2026-11-01
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
    const booking = await createBooking(ids, {
      startAt: "2026-11-02T15:00:00.000Z",
    });

    // Preview slots on 2026-11-01
    const fallSlotsResult = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: booking.token,
        expectedRevision: 0,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-11-01",
      },
    );
    expect(fallSlotsResult.success).toBe(true);
    if (!fallSlotsResult.success) return;

    // Both fold instants for 01:30 exist with different UTC instants and offsets
    const foldSlots = fallSlotsResult.data.slots.filter(
      (s) => s.localStart === "01:30",
    );
    expect(foldSlots).toEqual([
      {
        start: "2026-11-01T05:30:00Z",
        end: "2026-11-01T06:00:00Z",
        localStart: "01:30",
        offset: "-04:00",
      },
      {
        start: "2026-11-01T06:30:00Z",
        end: "2026-11-01T07:00:00Z",
        localStart: "01:30",
        offset: "-05:00",
      },
    ]);

    // Commit to first fold instant (05:30:00Z, -04:00) agrees with preview
    const firstFoldReceipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(booking.token, ids, {
        startAt: "2026-11-01T05:30:00.000Z",
      }),
    );
    expect(firstFoldReceipt.success).toBe(true);
    if (!firstFoldReceipt.success) return;
    expect(firstFoldReceipt.data.operation.snapshot).toMatchObject({
      startAt: "2026-11-01T05:30:00.000Z",
      endAt: "2026-11-01T06:00:00.000Z",
    });

    // Commit to second fold instant (06:30:00Z, -05:00) agrees with preview
    const secondFoldReceipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(booking.token, ids, {
        expectedRevision: 1,
        startAt: "2026-11-01T06:30:00.000Z",
      }),
    );
    expect(secondFoldReceipt.success).toBe(true);
    if (!secondFoldReceipt.success) return;
    expect(secondFoldReceipt.data.operation.snapshot).toMatchObject({
      startAt: "2026-11-01T06:30:00.000Z",
      endAt: "2026-11-01T07:00:00.000Z",
    });

    // 3. Spring gap test: clocks skip 02:00 -> 03:00 on 2026-03-08
    vi.setSystemTime(new Date("2026-03-07T12:00:00Z"));
    const springBooking = await createBooking(ids, {
      startAt: "2026-03-09T15:00:00.000Z",
    });

    const springSlotsResult = await getCustomerReplacementSlots(
      { shopId: ids.shopId },
      {
        token: springBooking.token,
        expectedRevision: 0,
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        date: "2026-03-08",
      },
    );
    expect(springSlotsResult.success).toBe(true);
    if (!springSlotsResult.success) return;

    // 02:30 does not exist during spring gap
    expect(
      springSlotsResult.data.slots.some((s) => s.localStart === "02:30"),
    ).toBe(false);

    // 01:30 exists, starting at 06:30:00Z with -05:00 offset, ending across the jump at 07:00:00Z
    const slot0130 = springSlotsResult.data.slots.find(
      (s) => s.localStart === "01:30",
    );
    expect(slot0130).toEqual({
      start: "2026-03-08T06:30:00Z",
      end: "2026-03-08T07:00:00Z",
      localStart: "01:30",
      offset: "-05:00",
    });

    // 03:00 exists immediately following the jump with -04:00 offset
    const slot0300 = springSlotsResult.data.slots.find(
      (s) => s.localStart === "03:00",
    );
    expect(slot0300).toEqual({
      start: "2026-03-08T07:00:00Z",
      end: "2026-03-08T07:30:00Z",
      localStart: "03:00",
      offset: "-04:00",
    });

    // Commit agrees with preview instant 06:30:00Z
    const springCommitResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(springBooking.token, ids, {
        startAt: "2026-03-08T06:30:00.000Z",
      }),
    );
    expect(springCommitResult.success).toBe(true);
    if (!springCommitResult.success) return;
    expect(springCommitResult.data.operation.snapshot).toMatchObject({
      startAt: "2026-03-08T06:30:00.000Z",
      endAt: "2026-03-08T07:00:00.000Z",
    });
  });

  it("Slice 4 Case 9: Same link reads new details; valid immediately before new end +168 elapsed hours; unavailable at equality. Old end does not determine expiry", async () => {
    const ids = await fixture();
    // Original booking: 2026-11-02T10:00:00Z -> 2026-11-02T10:30:00Z (old end + 168h = 2026-11-09T10:30:00Z)
    const booking = await createBooking(ids, {
      startAt: "2026-11-02T10:00:00.000Z",
    });

    // Replace booking to a new date: 2026-11-05T10:00:00Z -> 2026-11-05T10:30:00Z (new end)
    // New end + 168 hours = 2026-11-12T10:30:00.000Z
    const replaceResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(booking.token, ids, {
        startAt: "2026-11-05T10:00:00.000Z",
      }),
    );
    expect(replaceResult.success).toBe(true);
    if (!replaceResult.success) return;

    // 1. Same link reads new details
    const managedAfterMove = await getManagedBooking(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(managedAfterMove).toMatchObject({
      success: true,
      data: {
        status: "confirmed",
        revision: 1,
        startAt: "2026-11-05T10:00:00.000Z",
        endAt: "2026-11-05T10:30:00.000Z",
      },
    });

    // 2. Old end + 168h was 2026-11-09T10:30:00Z.
    // Set time to 2026-11-10T08:00:00Z (past old expiry).
    // Old end does NOT determine expiry: link is still valid.
    vi.setSystemTime(new Date("2026-11-10T08:00:00.000Z"));

    const managedPastOldExpiry = await getManagedBooking(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(managedPastOldExpiry.success).toBe(true);
    if (managedPastOldExpiry.success) {
      expect(managedPastOldExpiry.data.startAt).toBe(
        "2026-11-05T10:00:00.000Z",
      );
    }

    // 3. Valid immediately before new end + 168 elapsed hours (2026-11-12T10:29:59.999Z)
    vi.setSystemTime(new Date("2026-11-12T10:29:59.999Z"));

    const managedImmediatelyBeforeNewExpiry = await getManagedBooking(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(managedImmediatelyBeforeNewExpiry.success).toBe(true);

    // 4. Unavailable at equality: exactly new end + 168 hours (2026-11-12T10:30:00.000Z)
    vi.setSystemTime(new Date("2026-11-12T10:30:00.000Z"));

    const managedAtEquality = await getManagedBooking(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(managedAtEquality).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE" },
    });
  });

  it("Slice 4 Case 10: Owner-created bookings still follow customer public replacement rules", async () => {
    const ids = await fixture();
    // 1. Owner creates a booking directly
    const created = await createOwnerBooking(ids.context, {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T10:00:00.000Z",
      reviewedOffer: {
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: "30",
      },
      contact: {
        name: "Guest Client",
        whatsappOptIn: false,
      },
      recoveryKey: randomBytes(32).toString("base64url"),
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const stored = (
      await database.pool.query(
        "SELECT capability_ciphertext, capability_key_id FROM bookings WHERE id = $1",
        [created.data.bookingId],
      )
    ).rows[0];
    const token = decryptCapability(
      stored.capability_ciphertext,
      stored.capability_key_id,
      `${ids.shopId}:${created.data.bookingId}`,
    );

    // 2. Customer successfully moves owner-created booking within valid rules
    const validMove = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(token, ids, {
        startAt: "2026-11-02T11:00:00.000Z",
      }),
    );
    expect(validMove.success).toBe(true);
    if (!validMove.success) return;

    expect(validMove.data.operation.revision).toBe(1);
    expect(validMove.data.operation.snapshot).toMatchObject({
      startAt: "2026-11-02T11:00:00.000Z",
      endAt: "2026-11-02T11:30:00.000Z",
    });

    const event = (
      await database.pool.query(
        "SELECT actor_type, kind FROM booking_changes WHERE booking_id = $1",
        [created.data.bookingId],
      )
    ).rows[0];
    expect(event).toMatchObject({
      actor_type: "customer",
      kind: "move",
    });

    // 3. Customer move rules still apply to owner-created booking:
    // (a) Below +1 hour public notice fails
    const belowOneHour = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(token, ids, {
        expectedRevision: 1,
        startAt: "2026-11-01T08:45:00.000Z",
      }),
    );
    expect(belowOneHour).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });

    // (b) Date +31 fails
    const plus31 = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(token, ids, {
        expectedRevision: 1,
        startAt: "2026-12-02T10:00:00.000Z",
      }),
    );
    expect(plus31).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });

    // (c) Hidden different service fails
    const hiddenService = await saveService(ids.context, {
      name: "Hidden Different",
      priceUsd: "40",
      durationMinutes: "30",
      offered: false,
      barberIds: [ids.barberId],
    });
    expect(hiddenService.success).toBe(true);
    if (!hiddenService.success) return;

    const hiddenResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(token, ids, {
        expectedRevision: 1,
        serviceId: hiddenService.data.id,
        reviewedOffer: {
          name: "Hidden Different",
          priceUsd: "40.00",
          durationMinutes: "30",
        },
        startAt: "2026-11-02T12:00:00.000Z",
      }),
    );
    expect(hiddenResult).toMatchObject({
      success: false,
      error: { code: "STALE_OFFER" },
    });

    // (d) Inside 12-hour cutoff fails
    // Current booking startAt is 2026-11-02T11:00:00Z.
    // Cutoff is 2026-11-01T23:00:00Z. Set time to 2026-11-01T23:00:01Z (11h 59m 59s before startAt).
    vi.setSystemTime(new Date("2026-11-01T23:00:01.000Z"));

    const cutoffResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(token, ids, {
        expectedRevision: 1,
        startAt: "2026-11-02T14:00:00.000Z",
      }),
    );
    expect(cutoffResult).toMatchObject({
      success: false,
      error: { code: "CUTOFF_PASSED" },
    });
  });

  it("Slice 5 Case 1: Identical successful retry returns same event/revision; no additional work/event/rate attempt", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    const initialBookingState = await bookingState(booking.bookingId, null);
    expect(await rateEventCount(ids.shopId, booking.token)).toBe(0);

    const operationKey = randomBytes(32).toString("base64url");
    const input = replacementInput(booking.token, ids, {
      operationKey,
      startAt: "2026-11-02T11:00:00.000Z",
    });

    const receipt = await replaceCustomerBooking({ shopId: ids.shopId }, input);
    expect(receipt.success).toBe(true);
    if (!receipt.success) return;

    expect(receipt.data.bookingId).toBe(booking.bookingId);
    expect(receipt.data.operation.revision).toBe(1);

    const stateAfterCommit = await bookingState(
      booking.bookingId,
      initialBookingState.occupancy_id,
    );
    expect(stateAfterCommit).toMatchObject({
      status: "confirmed",
      revision: 1,
      changes: initialBookingState.changes + 1,
      work: initialBookingState.work + 2,
    });
    expect(await rateEventCount(ids.shopId, booking.token)).toBe(1);

    // Submit identical retry with the same operation key and payload
    const retryReceipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      input,
    );

    // 1. Returns same event/revision
    expect(retryReceipt).toEqual(receipt);

    // 2. No additional work, event, or rate attempt
    const stateAfterRetry = await bookingState(
      booking.bookingId,
      initialBookingState.occupancy_id,
    );
    expect(stateAfterRetry).toEqual(stateAfterCommit);
    expect(await rateEventCount(ids.shopId, booking.token)).toBe(1);

    // 3. Authorized view reflects the committed change
    const managed = await getManagedBooking(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(managed).toMatchObject({
      success: true,
      data: {
        status: "confirmed",
        revision: 1,
        startAt: "2026-11-02T11:00:00.000Z",
        endAt: "2026-11-02T11:30:00.000Z",
      },
    });
  });

  it("Slice 5 Case 2: Same key with changed destination, offer, revision or operation kind rejects", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);

    const operationKey = randomBytes(32).toString("base64url");
    const originalInput = replacementInput(booking.token, ids, {
      operationKey,
      expectedRevision: 0,
      startAt: "2026-11-02T11:00:00.000Z",
      reviewedOffer: {
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: "30",
      },
    });

    const receipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      originalInput,
    );
    expect(receipt.success).toBe(true);
    if (!receipt.success) return;

    const stateAfterCommit = await bookingState(booking.bookingId, null);
    const rateBefore = await rateEventCount(ids.shopId, booking.token);

    // 1. Same key with changed destination (different startAt)
    const changedDestinationInput = {
      ...originalInput,
      startAt: "2026-11-02T12:00:00.000Z",
    };
    const changedDestResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      changedDestinationInput,
    );
    expect(changedDestResult).toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });

    // 2. Same key with changed offer (different price)
    const changedOfferInput = {
      ...originalInput,
      reviewedOffer: {
        name: "Cut",
        priceUsd: "30.00",
        durationMinutes: "30",
      },
    };
    const changedOfferResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      changedOfferInput,
    );
    expect(changedOfferResult).toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });

    // 3. Same key with changed revision
    const changedRevisionInput = {
      ...originalInput,
      expectedRevision: 1,
    };
    const changedRevResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      changedRevisionInput,
    );
    expect(changedRevResult).toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });

    // 4. Same key with changed operation kind: pass move operationKey to cancelCustomerBooking
    const cancelWithMoveKey = await cancelCustomerBooking(
      { shopId: ids.shopId },
      cancellationInput(booking.token, {
        operationKey,
        expectedRevision: 0,
      }),
    );
    expect(cancelWithMoveKey).toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });

    // 5. Pass cancellation operationKey to replaceCustomerBooking
    const booking2 = await createBooking(ids, {
      startAt: "2026-11-02T14:00:00.000Z",
    });
    const cancelKey = randomBytes(32).toString("base64url");
    const cancelResult = await cancelCustomerBooking(
      { shopId: ids.shopId },
      cancellationInput(booking2.token, {
        operationKey: cancelKey,
      }),
    );
    expect(cancelResult.success).toBe(true);

    const moveWithCancelKey = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(booking2.token, ids, {
        operationKey: cancelKey,
        startAt: "2026-11-02T15:00:00.000Z",
      }),
    );
    expect(moveWithCancelKey).toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });

    // All mismatch attempts were counted against the rate limit
    const rateAfter = await rateEventCount(ids.shopId, booking.token);
    expect(rateAfter).toBe(rateBefore + 4);

    // Original booking state was preserved through all mismatches
    const finalState = await bookingState(booking.bookingId, null);
    expect(finalState).toEqual(stateAfterCommit);

    const managed = await getManagedBooking(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(managed).toMatchObject({
      success: true,
      data: {
        status: "confirmed",
        revision: 1,
        startAt: "2026-11-02T11:00:00.000Z",
      },
    });
  });

  it("Slice 5 Case 3: Retry after cutoff/end succeeds while capability valid; revoked/expired authority denies recovery", async () => {
    const ids = await fixture();
    // Booking at 10:00 - 10:30 on 2026-11-02
    const booking = await createBooking(ids);

    const operationKey = randomBytes(32).toString("base64url");
    const input = replacementInput(booking.token, ids, {
      operationKey,
      startAt: "2026-11-02T11:00:00.000Z",
    });

    // Replace booking to 11:00 - 11:30 (new endAt: 2026-11-02T11:30:00Z)
    const receipt = await replaceCustomerBooking({ shopId: ids.shopId }, input);
    expect(receipt.success).toBe(true);
    if (!receipt.success) return;

    expect(receipt.data.operation.revision).toBe(1);
    const rateBefore = await rateEventCount(ids.shopId, booking.token);

    // 1. Advance time past the 12-hour cutoff (start is 11:00:00Z -> cutoff is 2026-11-01T23:00:00Z)
    // Set time to 2026-11-02T00:00:00Z (11h before start, inside cutoff window)
    vi.setSystemTime(new Date("2026-11-02T00:00:00.000Z"));

    const replayAfterCutoff = await replaceCustomerBooking(
      { shopId: ids.shopId },
      input,
    );
    expect(replayAfterCutoff).toEqual(receipt);
    expect(await rateEventCount(ids.shopId, booking.token)).toBe(rateBefore);

    // 2. Advance time past the appointment end (end is 2026-11-02T11:30:00Z)
    // Set time to 2026-11-02T12:00:00Z (past end)
    vi.setSystemTime(new Date("2026-11-02T12:00:00.000Z"));

    const replayAfterEnd = await replaceCustomerBooking(
      { shopId: ids.shopId },
      input,
    );
    expect(replayAfterEnd).toEqual(receipt);
    expect(await rateEventCount(ids.shopId, booking.token)).toBe(rateBefore);

    // 3. Immediately before capability expiry (new endAt 2026-11-02T11:30:00Z + 168h = 2026-11-09T11:30:00Z)
    vi.setSystemTime(new Date("2026-11-09T11:29:59.999Z"));
    const replayBeforeExpiry = await replaceCustomerBooking(
      { shopId: ids.shopId },
      input,
    );
    expect(replayBeforeExpiry).toEqual(receipt);
    expect(await rateEventCount(ids.shopId, booking.token)).toBe(rateBefore);

    // 4. Capability expired at equality (2026-11-09T11:30:00.000Z)
    vi.setSystemTime(new Date("2026-11-09T11:30:00.000Z"));
    const replayAtExpiry = await replaceCustomerBooking(
      { shopId: ids.shopId },
      input,
    );
    expect(replayAtExpiry).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE" },
    });
    // Expired authority does not count against rate limit
    expect(await rateEventCount(ids.shopId, booking.token)).toBe(rateBefore);

    // 5. Capability revoked
    // Reset time back to active window
    vi.setSystemTime(new Date("2026-11-02T12:00:00.000Z"));
    await database.pool.query(
      "UPDATE bookings SET capability_revoked_at = NOW() WHERE id = $1",
      [booking.bookingId],
    );

    const replayWhenRevoked = await replaceCustomerBooking(
      { shopId: ids.shopId },
      input,
    );
    expect(replayWhenRevoked).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE" },
    });
    // Revoked authority does not count against rate limit
    expect(await rateEventCount(ids.shopId, booking.token)).toBe(rateBefore);
  });

  it("Slice 5 Case 4: Replay after later owner change does not overwrite it: earlier operation receipt, current state from fresh read", async () => {
    const ids = await fixture();
    // Booking at 10:00 - 10:30 on 2026-11-02
    const booking = await createBooking(ids);

    const operationKey = randomBytes(32).toString("base64url");
    const customerInput = replacementInput(booking.token, ids, {
      operationKey,
      expectedRevision: 0,
      startAt: "2026-11-02T11:00:00.000Z",
    });

    // 1. Customer replaces booking from 10:00 to 11:00 (commits revision 1)
    const customerReceipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      customerInput,
    );
    expect(customerReceipt.success).toBe(true);
    if (!customerReceipt.success) return;

    expect(customerReceipt.data.operation.revision).toBe(1);
    expect(customerReceipt.data.operation.snapshot).toMatchObject({
      startAt: "2026-11-02T11:00:00.000Z",
      endAt: "2026-11-02T11:30:00.000Z",
    });

    // 2. Later, owner moves booking to 14:00 (commits revision 2)
    const ownerMoveReceipt = await moveOwnerBooking(ids.context, {
      bookingId: booking.bookingId,
      expectedRevision: 1,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T14:00:00.000Z",
      reviewedOffer: {
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: "30",
      },
    });
    expect(ownerMoveReceipt.success).toBe(true);
    if (!ownerMoveReceipt.success) return;

    // Database is now at revision 2
    const dbStateBeforeReplay = (
      await database.pool.query(
        "SELECT status, revision, start_at, end_at, occupancy_id FROM bookings WHERE id = $1",
        [booking.bookingId],
      )
    ).rows[0];
    expect(dbStateBeforeReplay).toMatchObject({
      status: "confirmed",
      revision: 2,
      start_at: new Date("2026-11-02T14:00:00.000Z"),
      end_at: new Date("2026-11-02T14:30:00.000Z"),
    });

    // 3. Customer replays their earlier request (operationKey, expectedRevision 0, 11:00)
    const replayReceipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      customerInput,
    );

    // Replay returns earlier operation receipt
    expect(replayReceipt).toEqual(customerReceipt);

    // Replay did NOT overwrite current state in database
    const dbStateAfterReplay = (
      await database.pool.query(
        "SELECT status, revision, start_at, end_at, occupancy_id FROM bookings WHERE id = $1",
        [booking.bookingId],
      )
    ).rows[0];
    expect(dbStateAfterReplay).toEqual(dbStateBeforeReplay);

    // Occupancy interval remains at 14:00 - 14:30, not 11:00
    const currentOccupancy = (
      await database.pool.query(
        "SELECT barber_id, start_at, end_at FROM occupied_intervals WHERE id = $1",
        [dbStateAfterReplay.occupancy_id],
      )
    ).rows[0];
    expect(currentOccupancy).toMatchObject({
      barber_id: ids.barberId,
      start_at: new Date("2026-11-02T14:00:00.000Z"),
      end_at: new Date("2026-11-02T14:30:00.000Z"),
    });

    // Changes count remains exactly 2 (customer move at rev 1, owner move at rev 2)
    const changes = (
      await database.pool.query(
        "SELECT applied_revision, actor_type, kind FROM booking_changes WHERE booking_id = $1 ORDER BY applied_revision ASC",
        [booking.bookingId],
      )
    ).rows;
    expect(changes).toEqual([
      { applied_revision: 1, actor_type: "customer", kind: "move" },
      { applied_revision: 2, actor_type: "owner", kind: "move" },
    ]);

    // 4. Fresh read from managed view returns current state (revision 2, startAt 14:00)
    const freshView = await getManagedBooking(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(freshView).toMatchObject({
      success: true,
      data: {
        status: "confirmed",
        revision: 2,
        startAt: "2026-11-02T14:00:00.000Z",
        endAt: "2026-11-02T14:30:00.000Z",
      },
    });
  });

  it("Slice 5 Case 5: Fresh stale revision rejects and counts", async () => {
    const ids = await fixture();
    // Booking at 10:00 - 10:30 on 2026-11-02
    const booking = await createBooking(ids);

    // 1. Move booking to revision 1 (11:00 - 11:30)
    const firstMove = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(booking.token, ids, {
        expectedRevision: 0,
        startAt: "2026-11-02T11:00:00.000Z",
      }),
    );
    expect(firstMove.success).toBe(true);
    if (!firstMove.success) return;

    expect(firstMove.data.operation.revision).toBe(1);

    const stateBeforeStale = await bookingState(booking.bookingId, null);
    expect(stateBeforeStale.revision).toBe(1);
    const rateBefore = await rateEventCount(ids.shopId, booking.token);

    // 2. Submit fresh replacement request with a new operation key but stale expectedRevision = 0
    const freshOperationKey = randomBytes(32).toString("base64url");
    const staleResult = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(booking.token, ids, {
        operationKey: freshOperationKey,
        expectedRevision: 0,
        startAt: "2026-11-02T12:00:00.000Z",
      }),
    );

    // 3. Rejects with STALE_BOOKING
    expect(staleResult).toMatchObject({
      success: false,
      error: { code: "STALE_BOOKING" },
    });

    // 4. Counts as a rate attempt against this customer change link
    const rateAfter = await rateEventCount(ids.shopId, booking.token);
    expect(rateAfter).toBe(rateBefore + 1);

    // 5. Booking state, occupancy, and changes count remain unchanged
    const stateAfterStale = await bookingState(booking.bookingId, null);
    expect(stateAfterStale).toEqual(stateBeforeStale);

    // 6. Managed booking view remains unchanged at revision 1
    const managed = await getManagedBooking(
      { shopId: ids.shopId },
      booking.token,
    );
    expect(managed).toMatchObject({
      success: true,
      data: {
        status: "confirmed",
        revision: 1,
        startAt: "2026-11-02T11:00:00.000Z",
        endAt: "2026-11-02T11:30:00.000Z",
      },
    });
  });

  it("Slice 5 Case 6: Cancellation/replacement share ten-attempt rolling window; eleventh fresh submission denies; exact window expiry permits again", async () => {
    const ids = await fixture();
    const otherShop = await fixture();
    const booking = await createBooking(ids);

    // Initial state
    const stateBefore = await bookingState(booking.bookingId, null);
    expect(await rateEventCount(ids.shopId, booking.token)).toBe(0);

    // 1. Submit 5 stale cancellation attempts
    for (let i = 0; i < 5; i++) {
      const cancelResult = await cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(booking.token, { expectedRevision: 1 }),
      );
      expect(cancelResult).toMatchObject({
        success: false,
        error: { code: "STALE_BOOKING" },
      });
    }

    // 2. Submit 5 stale replacement attempts
    for (let i = 0; i < 5; i++) {
      const replaceResult = await replaceCustomerBooking(
        { shopId: ids.shopId },
        replacementInput(booking.token, ids, {
          expectedRevision: 1,
          startAt: "2026-11-02T12:00:00.000Z",
        }),
      );
      expect(replaceResult).toMatchObject({
        success: false,
        error: { code: "STALE_BOOKING" },
      });
    }

    // Now exactly 10 attempts have been counted
    expect(await rateEventCount(ids.shopId, booking.token)).toBe(10);

    // 3. 11th fresh submission (replacement) is denied with RATE_LIMITED
    const eleventhReplace = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(booking.token, ids, {
        expectedRevision: 0,
        startAt: "2026-11-02T11:00:00.000Z",
      }),
    );
    expect(eleventhReplace).toMatchObject({
      success: false,
      error: { code: "RATE_LIMITED" },
    });

    // 4. 12th fresh submission (cancellation) is also denied with RATE_LIMITED
    const twelfthCancel = await cancelCustomerBooking(
      { shopId: ids.shopId },
      cancellationInput(booking.token, { expectedRevision: 0 }),
    );
    expect(twelfthCancel).toMatchObject({
      success: false,
      error: { code: "RATE_LIMITED" },
    });

    // 5. Invalid authority (wrong shop) returns generic UNAVAILABLE without incrementing
    const wrongShopAttempt = await replaceCustomerBooking(
      { shopId: otherShop.shopId },
      replacementInput(booking.token, ids, {
        expectedRevision: 0,
        startAt: "2026-11-02T11:00:00.000Z",
      }),
    );
    expect(wrongShopAttempt).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE" },
    });

    // Booking remains completely untouched
    const stateDuringRateLimit = await bookingState(booking.bookingId, null);
    expect(stateDuringRateLimit).toEqual(stateBefore);

    // 6. Test rolling window:
    // Window started at 2026-11-01T08:00:00.000Z.
    // At 2026-11-01T08:59:59.999Z (1ms before 60-minute window expires), still rate limited.
    vi.setSystemTime(new Date("2026-11-01T08:59:59.999Z"));
    const beforeExpiryAttempt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(booking.token, ids, {
        expectedRevision: 0,
        startAt: "2026-11-02T11:00:00.000Z",
      }),
    );
    expect(beforeExpiryAttempt).toMatchObject({
      success: false,
      error: { code: "RATE_LIMITED" },
    });

    // At 2026-11-01T09:00:00.000Z (exact equality +60 minutes), window has expired for earlier events.
    vi.setSystemTime(new Date("2026-11-01T09:00:00.000Z"));
    const allowedReceipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(booking.token, ids, {
        expectedRevision: 0,
        startAt: "2026-11-02T11:00:00.000Z",
      }),
    );
    expect(allowedReceipt.success).toBe(true);
    if (!allowedReceipt.success) return;

    expect(allowedReceipt.data.operation.revision).toBe(1);
    expect(allowedReceipt.data.operation.snapshot).toMatchObject({
      status: "confirmed",
      startAt: "2026-11-02T11:00:00.000Z",
      endAt: "2026-11-02T11:30:00.000Z",
    });

    const stateAfterExpiry = await bookingState(booking.bookingId, null);
    expect(stateAfterExpiry).toMatchObject({
      status: "confirmed",
      revision: 1,
      changes: 1,
    });
  });

  it("Slice 5 Case 7: Two replacement requests on same revision: exactly one commits; other stale", async () => {
    const ids = await fixture();
    // Booking at 10:00 - 10:30 on 2026-11-02
    const booking = await createBooking(ids);
    const occId = (
      await database.pool.query(
        "SELECT occupancy_id FROM bookings WHERE id=$1",
        [booking.bookingId],
      )
    ).rows[0].occupancy_id as string;
    const stateBefore = await bookingState(booking.bookingId, occId);

    const input1 = replacementInput(booking.token, ids, {
      operationKey: randomBytes(32).toString("base64url"),
      expectedRevision: 0,
      startAt: "2026-11-02T11:00:00.000Z",
    });

    const input2 = replacementInput(booking.token, ids, {
      operationKey: randomBytes(32).toString("base64url"),
      expectedRevision: 0,
      startAt: "2026-11-02T12:00:00.000Z",
    });

    const barrier = await database.pool.connect();
    let barrierOpen = true;
    let req1: ReturnType<typeof replaceCustomerBooking> | undefined;
    let req2: ReturnType<typeof replaceCustomerBooking> | undefined;

    try {
      await barrier.query("BEGIN");
      await barrier.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
        ids.shopId,
      ]);

      req1 = replaceCustomerBooking({ shopId: ids.shopId }, input1);
      await waitForLockWaiters(barrier, 1, ["replace"]);

      req2 = replaceCustomerBooking({ shopId: ids.shopId }, input2);
      await waitForLockWaiters(barrier, 2, ["replace", "replace"]);

      await barrier.query("COMMIT");
      barrierOpen = false;
      await waitForLockCleanup(barrier);

      const [res1, res2] = await Promise.all([req1, req2]);

      // Exactly one succeeds and one fails with STALE_BOOKING
      const results = [res1, res2];
      const successResults = results.filter((r) => r.success);
      const staleResults = results.filter(
        (r) => !r.success && r.error.code === "STALE_BOOKING",
      );

      expect(successResults).toHaveLength(1);
      expect(staleResults).toHaveLength(1);

      const winner = successResults[0] as Extract<
        typeof res1,
        { success: true }
      >;
      expect(winner.data.operation.revision).toBe(1);

      // Verify database state: revision 1, 1 booking change event, work staged, occupancy updated
      const state = await bookingState(booking.bookingId, occId);
      expect(state).toMatchObject({
        status: "confirmed",
        revision: 1,
        changes: 1,
        work: stateBefore.work + 2,
        original_occupancy: 1,
      });

      // Destination occupancy matches winner
      const winnerStart = winner.data.operation.snapshot.startAt as string;
      const winnerEnd = winner.data.operation.snapshot.endAt as string;
      const destOccupancy = (
        await database.pool.query(
          "SELECT barber_id, start_at, end_at FROM occupied_intervals WHERE id = $1",
          [state.occupancy_id],
        )
      ).rows[0];
      expect(destOccupancy).toMatchObject({
        barber_id: ids.barberId,
        start_at: new Date(winnerStart),
        end_at: new Date(winnerEnd),
      });

      // Old 10:00 interval is vacated
      const oldOccupancy = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = $3",
          [ids.shopId, ids.barberId, START_AT],
        )
      ).rows[0];
      expect(oldOccupancy.count).toBe(0);

      // Loser destination is not occupied
      const loserStart =
        winnerStart === "2026-11-02T11:00:00.000Z"
          ? "2026-11-02T12:00:00.000Z"
          : "2026-11-02T11:00:00.000Z";
      const loserOccupancy = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = $3",
          [ids.shopId, ids.barberId, loserStart],
        )
      ).rows[0];
      expect(loserOccupancy.count).toBe(0);

      // Managed view reflects winner
      const managed = await getManagedBooking(
        { shopId: ids.shopId },
        booking.token,
      );
      expect(managed).toMatchObject({
        success: true,
        data: {
          status: "confirmed",
          revision: 1,
          startAt: winnerStart,
          endAt: winnerEnd,
        },
      });
    } finally {
      if (barrierOpen) {
        await barrier.query("ROLLBACK").catch(() => undefined);
      }
      await Promise.allSettled([req1, req2]);
      await waitForLockCleanup(barrier).catch(() => undefined);
      barrier.release();
    }
  });

  it("Slice 5 Case 8: Replacement versus cancellation/owner move: one commits; other cannot overwrite", async () => {
    // ---------------------------------------------------------
    // Subcase 1: Replacement queued first, then Cancellation
    // ---------------------------------------------------------
    const ids1 = await fixture();
    const booking1 = await createBooking(ids1);
    const occId1 = (
      await database.pool.query(
        "SELECT occupancy_id FROM bookings WHERE id=$1",
        [booking1.bookingId],
      )
    ).rows[0].occupancy_id as string;
    const state1Before = await bookingState(booking1.bookingId, occId1);
    const barrier1 = await database.pool.connect();
    let barrier1Open = true;
    let reqReplace1: ReturnType<typeof replaceCustomerBooking> | undefined;
    let reqCancel1: ReturnType<typeof cancelCustomerBooking> | undefined;

    try {
      await barrier1.query("BEGIN");
      await barrier1.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
        ids1.shopId,
      ]);

      reqReplace1 = replaceCustomerBooking(
        { shopId: ids1.shopId },
        replacementInput(booking1.token, ids1, {
          expectedRevision: 0,
          startAt: "2026-11-02T11:00:00.000Z",
        }),
      );
      await waitForLockWaiters(barrier1, 1, ["replace"]);

      reqCancel1 = cancelCustomerBooking(
        { shopId: ids1.shopId },
        cancellationInput(booking1.token, { expectedRevision: 0 }),
      );
      await waitForLockWaiters(barrier1, 2, ["replace", "cancel"]);

      await barrier1.query("COMMIT");
      barrier1Open = false;
      await waitForLockCleanup(barrier1);

      const [resReplace, resCancel] = await Promise.all([
        reqReplace1,
        reqCancel1,
      ]);

      // Replacement commits, cancellation rejected as stale
      expect(resReplace.success).toBe(true);
      expect(resCancel).toMatchObject({
        success: false,
        error: { code: "STALE_BOOKING" },
      });

      // Booking remains confirmed at replacement destination (NOT cancelled!)
      const state1 = await bookingState(booking1.bookingId, occId1);
      expect(state1).toMatchObject({
        status: "confirmed",
        revision: 1,
        changes: 1,
        work: state1Before.work + 2,
        original_occupancy: 1,
      });

      // Destination occupancy matches replacement
      const destOcc1 = (
        await database.pool.query(
          "SELECT barber_id, start_at, end_at FROM occupied_intervals WHERE id = $1",
          [state1.occupancy_id],
        )
      ).rows[0];
      expect(destOcc1).toMatchObject({
        barber_id: ids1.barberId,
        start_at: new Date("2026-11-02T11:00:00.000Z"),
        end_at: new Date("2026-11-02T11:30:00.000Z"),
      });

      // Old 10:00 occupancy vacated
      const oldOcc1 = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = $3",
          [ids1.shopId, ids1.barberId, START_AT],
        )
      ).rows[0];
      expect(oldOcc1.count).toBe(0);

      const managed1 = await getManagedBooking(
        { shopId: ids1.shopId },
        booking1.token,
      );
      expect(managed1).toMatchObject({
        success: true,
        data: {
          status: "confirmed",
          revision: 1,
          startAt: "2026-11-02T11:00:00.000Z",
        },
      });
    } finally {
      if (barrier1Open) {
        await barrier1.query("ROLLBACK").catch(() => undefined);
      }
      await Promise.allSettled([reqReplace1, reqCancel1]);
      await waitForLockCleanup(barrier1).catch(() => undefined);
      barrier1.release();
    }

    // ---------------------------------------------------------
    // Subcase 2: Cancellation queued first, then Replacement
    // ---------------------------------------------------------
    const ids2 = await fixture();
    const booking2 = await createBooking(ids2);
    const occId2 = (
      await database.pool.query(
        "SELECT occupancy_id FROM bookings WHERE id=$1",
        [booking2.bookingId],
      )
    ).rows[0].occupancy_id as string;
    const state2Before = await bookingState(booking2.bookingId, occId2);
    const barrier2 = await database.pool.connect();
    let barrier2Open = true;
    let reqCancel2: ReturnType<typeof cancelCustomerBooking> | undefined;
    let reqReplace2: ReturnType<typeof replaceCustomerBooking> | undefined;

    try {
      await barrier2.query("BEGIN");
      await barrier2.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
        ids2.shopId,
      ]);

      reqCancel2 = cancelCustomerBooking(
        { shopId: ids2.shopId },
        cancellationInput(booking2.token, { expectedRevision: 0 }),
      );
      await waitForLockWaiters(barrier2, 1, ["cancel"]);

      reqReplace2 = replaceCustomerBooking(
        { shopId: ids2.shopId },
        replacementInput(booking2.token, ids2, {
          expectedRevision: 0,
          startAt: "2026-11-02T11:00:00.000Z",
        }),
      );
      await waitForLockWaiters(barrier2, 2, ["cancel", "replace"]);

      await barrier2.query("COMMIT");
      barrier2Open = false;
      await waitForLockCleanup(barrier2);

      const [resCancel2, resReplace2] = await Promise.all([
        reqCancel2,
        reqReplace2,
      ]);

      // Cancellation commits, replacement rejected as stale
      expect(resCancel2.success).toBe(true);
      expect(resReplace2).toMatchObject({
        success: false,
        error: { code: "STALE_BOOKING" },
      });

      // Booking remains cancelled, occupancy released
      const state2 = await bookingState(booking2.bookingId, occId2);
      expect(state2).toMatchObject({
        status: "cancelled",
        revision: 1,
        occupancy_id: null,
        changes: 1,
        work: state2Before.work + 2,
        original_occupancy: 0,
      });

      // Neither old 10:00 nor attempted 11:00 are occupied
      const oldOcc2 = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = $3",
          [ids2.shopId, ids2.barberId, START_AT],
        )
      ).rows[0];
      expect(oldOcc2.count).toBe(0);

      const destOcc2 = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = '2026-11-02T11:00:00.000Z'",
          [ids2.shopId, ids2.barberId],
        )
      ).rows[0];
      expect(destOcc2.count).toBe(0);

      const managed2 = await getManagedBooking(
        { shopId: ids2.shopId },
        booking2.token,
      );
      expect(managed2).toMatchObject({
        success: true,
        data: {
          status: "cancelled",
          revision: 1,
        },
      });
    } finally {
      if (barrier2Open) {
        await barrier2.query("ROLLBACK").catch(() => undefined);
      }
      await Promise.allSettled([reqCancel2, reqReplace2]);
      await waitForLockCleanup(barrier2).catch(() => undefined);
      barrier2.release();
    }

    // ---------------------------------------------------------
    // Subcase 3: Replacement queued first, then Owner Move
    // ---------------------------------------------------------
    const ids3 = await fixture();
    const booking3 = await createBooking(ids3);
    const occId3 = (
      await database.pool.query(
        "SELECT occupancy_id FROM bookings WHERE id=$1",
        [booking3.bookingId],
      )
    ).rows[0].occupancy_id as string;
    const state3Before = await bookingState(booking3.bookingId, occId3);
    const barrier3 = await database.pool.connect();
    let barrier3Open = true;
    let reqReplace3: ReturnType<typeof replaceCustomerBooking> | undefined;
    let reqOwnerMove3: ReturnType<typeof moveOwnerBooking> | undefined;

    try {
      await barrier3.query("BEGIN");
      await barrier3.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
        ids3.shopId,
      ]);

      reqReplace3 = replaceCustomerBooking(
        { shopId: ids3.shopId },
        replacementInput(booking3.token, ids3, {
          expectedRevision: 0,
          startAt: "2026-11-02T11:00:00.000Z",
        }),
      );
      await waitForLockWaiters(barrier3, 1, ["replace"]);

      reqOwnerMove3 = moveOwnerBooking(ids3.context, {
        bookingId: booking3.bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
        serviceId: ids3.serviceId,
        barberId: ids3.barberId,
        startAt: "2026-11-02T12:00:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
      });
      await waitForLockWaiters(barrier3, 2, ["replace", "owner_move"]);

      await barrier3.query("COMMIT");
      barrier3Open = false;
      await waitForLockCleanup(barrier3);

      const [resReplace3, resOwnerMove3] = await Promise.all([
        reqReplace3,
        reqOwnerMove3,
      ]);

      // Replacement commits, owner move rejected as stale
      expect(resReplace3.success).toBe(true);
      expect(resOwnerMove3).toMatchObject({
        success: false,
        error: { code: "STALE_BOOKING" },
      });

      // Booking remains at customer's destination 11:00 (NOT owner's 12:00!)
      const state3 = await bookingState(booking3.bookingId, occId3);
      expect(state3).toMatchObject({
        status: "confirmed",
        revision: 1,
        start_at: new Date("2026-11-02T11:00:00.000Z"),
        changes: 1,
        work: state3Before.work + 2,
        original_occupancy: 1,
      });

      // Destination 11:00 is occupied
      const destOcc3 = (
        await database.pool.query(
          "SELECT barber_id, start_at, end_at FROM occupied_intervals WHERE id = $1",
          [state3.occupancy_id],
        )
      ).rows[0];
      expect(destOcc3).toMatchObject({
        barber_id: ids3.barberId,
        start_at: new Date("2026-11-02T11:00:00.000Z"),
        end_at: new Date("2026-11-02T11:30:00.000Z"),
      });

      // Owner attempted destination 12:00 is not occupied
      const ownerDestOcc3 = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = '2026-11-02T12:00:00.000Z'",
          [ids3.shopId, ids3.barberId],
        )
      ).rows[0];
      expect(ownerDestOcc3.count).toBe(0);

      // Old 10:00 is vacated
      const oldOcc3 = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = $3",
          [ids3.shopId, ids3.barberId, START_AT],
        )
      ).rows[0];
      expect(oldOcc3.count).toBe(0);

      const managed3 = await getManagedBooking(
        { shopId: ids3.shopId },
        booking3.token,
      );
      expect(managed3).toMatchObject({
        success: true,
        data: {
          status: "confirmed",
          revision: 1,
          startAt: "2026-11-02T11:00:00.000Z",
        },
      });
    } finally {
      if (barrier3Open) {
        await barrier3.query("ROLLBACK").catch(() => undefined);
      }
      await Promise.allSettled([reqReplace3, reqOwnerMove3]);
      await waitForLockCleanup(barrier3).catch(() => undefined);
      barrier3.release();
    }

    // ---------------------------------------------------------
    // Subcase 4: Owner Move queued first, then Replacement
    // ---------------------------------------------------------
    const ids4 = await fixture();
    const booking4 = await createBooking(ids4);
    const occId4 = (
      await database.pool.query(
        "SELECT occupancy_id FROM bookings WHERE id=$1",
        [booking4.bookingId],
      )
    ).rows[0].occupancy_id as string;
    const state4Before = await bookingState(booking4.bookingId, occId4);
    const barrier4 = await database.pool.connect();
    let barrier4Open = true;
    let reqOwnerMove4: ReturnType<typeof moveOwnerBooking> | undefined;
    let reqReplace4: ReturnType<typeof replaceCustomerBooking> | undefined;

    try {
      await barrier4.query("BEGIN");
      await barrier4.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
        ids4.shopId,
      ]);

      reqOwnerMove4 = moveOwnerBooking(ids4.context, {
        bookingId: booking4.bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
        serviceId: ids4.serviceId,
        barberId: ids4.barberId,
        startAt: "2026-11-02T12:00:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
      });
      await waitForLockWaiters(barrier4, 1, ["owner_move"]);

      reqReplace4 = replaceCustomerBooking(
        { shopId: ids4.shopId },
        replacementInput(booking4.token, ids4, {
          expectedRevision: 0,
          startAt: "2026-11-02T11:00:00.000Z",
        }),
      );
      await waitForLockWaiters(barrier4, 2, ["owner_move", "replace"]);

      await barrier4.query("COMMIT");
      barrier4Open = false;
      await waitForLockCleanup(barrier4);

      const [resOwnerMove4, resReplace4] = await Promise.all([
        reqOwnerMove4,
        reqReplace4,
      ]);

      // Owner move commits, replacement rejected as stale
      expect(resOwnerMove4.success).toBe(true);
      expect(resReplace4).toMatchObject({
        success: false,
        error: { code: "STALE_BOOKING" },
      });

      // Booking remains at owner's destination 12:00 (NOT customer's 11:00!)
      const state4 = await bookingState(booking4.bookingId, occId4);
      expect(state4).toMatchObject({
        status: "confirmed",
        revision: 1,
        start_at: new Date("2026-11-02T12:00:00.000Z"),
        changes: 1,
        work: state4Before.work + 1,
        original_occupancy: 1,
      });

      // Owner destination 12:00 is occupied
      const destOcc4 = (
        await database.pool.query(
          "SELECT barber_id, start_at, end_at FROM occupied_intervals WHERE id = $1",
          [state4.occupancy_id],
        )
      ).rows[0];
      expect(destOcc4).toMatchObject({
        barber_id: ids4.barberId,
        start_at: new Date("2026-11-02T12:00:00.000Z"),
        end_at: new Date("2026-11-02T12:30:00.000Z"),
      });

      // Customer attempted destination 11:00 is not occupied
      const custDestOcc4 = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = '2026-11-02T11:00:00.000Z'",
          [ids4.shopId, ids4.barberId],
        )
      ).rows[0];
      expect(custDestOcc4.count).toBe(0);

      // Old 10:00 is vacated
      const oldOcc4 = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = $3",
          [ids4.shopId, ids4.barberId, START_AT],
        )
      ).rows[0];
      expect(oldOcc4.count).toBe(0);

      const managed4 = await getManagedBooking(
        { shopId: ids4.shopId },
        booking4.token,
      );
      expect(managed4).toMatchObject({
        success: true,
        data: {
          status: "confirmed",
          revision: 1,
          startAt: "2026-11-02T12:00:00.000Z",
        },
      });
    } finally {
      if (barrier4Open) {
        await barrier4.query("ROLLBACK").catch(() => undefined);
      }
      await Promise.allSettled([reqOwnerMove4, reqReplace4]);
      await waitForLockCleanup(barrier4).catch(() => undefined);
      barrier4.release();
    }
  });

  it("Slice 5 Case 9: Replacement versus public reservation: exactly one owns destination; failed replacement retains original", async () => {
    // -----------------------------------------------------------------------------------
    // Order 1: Public reservation queued first, then Customer Replacement
    // -----------------------------------------------------------------------------------
    const ids1 = await fixture();
    // Booking 1: 10:00 - 10:30 on 2026-11-02
    const booking1 = await createBooking(ids1, {
      startAt: "2026-11-02T10:00:00.000Z",
    });
    const occId1 = (
      await database.pool.query(
        "SELECT occupancy_id FROM bookings WHERE id=$1",
        [booking1.bookingId],
      )
    ).rows[0].occupancy_id as string;
    const state1Before = await bookingState(booking1.bookingId, occId1);

    const barrier1 = await database.pool.connect();
    let barrier1Open = true;
    let reqPublic1: ReturnType<typeof createPublicBooking> | undefined;
    let reqReplace1: ReturnType<typeof replaceCustomerBooking> | undefined;

    try {
      await barrier1.query("BEGIN");
      await barrier1.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
        ids1.shopId,
      ]);

      // Public booking targeting 11:00 - 11:30
      reqPublic1 = createPublicBooking(
        { shopId: ids1.shopId },
        bookingInput(ids1, {
          startAt: "2026-11-02T11:00:00.000Z",
          contact: {
            name: "Other Customer",
            email: "other@example.test",
            whatsappOptIn: false,
          },
        }),
      );
      await waitForLockWaiters(barrier1, 1, ["public_booking"]);

      // Customer replacement targeting the same 11:00 - 11:30
      reqReplace1 = replaceCustomerBooking(
        { shopId: ids1.shopId },
        replacementInput(booking1.token, ids1, {
          expectedRevision: 0,
          startAt: "2026-11-02T11:00:00.000Z",
        }),
      );
      await waitForLockWaiters(barrier1, 2, ["public_booking", "replace"]);

      await barrier1.query("COMMIT");
      barrier1Open = false;
      await waitForLockCleanup(barrier1);

      const [resPublic1, resReplace1] = await Promise.all([
        reqPublic1,
        reqReplace1,
      ]);

      // Public booking succeeds and owns 11:00 - 11:30
      expect(resPublic1.success).toBe(true);
      if (!resPublic1.success) return;

      // Replacement fails with UNAVAILABLE_INTERVAL
      expect(resReplace1).toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE_INTERVAL" },
      });

      // Failed replacement retains original booking and occupancy intact
      const state1After = await bookingState(
        booking1.bookingId,
        state1Before.occupancy_id,
      );
      expect(state1After).toEqual(state1Before);

      // Public booking owns destination occupancy
      const destOcc = (
        await database.pool.query(
          "SELECT barber_id, start_at, end_at FROM occupied_intervals WHERE shop_id=$1 AND start_at='2026-11-02T11:00:00.000Z'",
          [ids1.shopId],
        )
      ).rows[0];
      expect(destOcc).toMatchObject({
        barber_id: ids1.barberId,
        start_at: new Date("2026-11-02T11:00:00.000Z"),
        end_at: new Date("2026-11-02T11:30:00.000Z"),
      });

      // Original 10:00 occupancy remains intact
      const origOcc1 = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id=$1 AND barber_id=$2 AND start_at=$3",
          [ids1.shopId, ids1.barberId, START_AT],
        )
      ).rows[0];
      expect(origOcc1.count).toBe(1);

      // Managed view for booking 1 still reads original 10:00 - 10:30
      const managed1 = await getManagedBooking(
        { shopId: ids1.shopId },
        booking1.token,
      );
      expect(managed1).toMatchObject({
        success: true,
        data: {
          status: "confirmed",
          revision: 0,
          startAt: "2026-11-02T10:00:00.000Z",
          endAt: "2026-11-02T10:30:00.000Z",
        },
      });
    } finally {
      if (barrier1Open) {
        await barrier1.query("ROLLBACK").catch(() => undefined);
      }
      await Promise.allSettled([reqPublic1, reqReplace1]);
      await waitForLockCleanup(barrier1).catch(() => undefined);
      barrier1.release();
    }

    // -----------------------------------------------------------------------------------
    // Order 2: Customer Replacement queued first, then Public reservation
    // -----------------------------------------------------------------------------------
    const ids2 = await fixture();
    // Booking 2: 10:00 - 10:30 on 2026-11-02
    const booking2 = await createBooking(ids2, {
      startAt: "2026-11-02T10:00:00.000Z",
    });
    const occId2 = (
      await database.pool.query(
        "SELECT occupancy_id FROM bookings WHERE id=$1",
        [booking2.bookingId],
      )
    ).rows[0].occupancy_id as string;
    const state2Before = await bookingState(booking2.bookingId, occId2);

    const barrier2 = await database.pool.connect();
    let barrier2Open = true;
    let reqReplace2: ReturnType<typeof replaceCustomerBooking> | undefined;
    let reqPublic2: ReturnType<typeof createPublicBooking> | undefined;

    try {
      await barrier2.query("BEGIN");
      await barrier2.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
        ids2.shopId,
      ]);

      // Customer replacement targeting 11:00 - 11:30
      reqReplace2 = replaceCustomerBooking(
        { shopId: ids2.shopId },
        replacementInput(booking2.token, ids2, {
          expectedRevision: 0,
          startAt: "2026-11-02T11:00:00.000Z",
        }),
      );
      await waitForLockWaiters(barrier2, 1, ["replace"]);

      // Public booking targeting the same 11:00 - 11:30
      reqPublic2 = createPublicBooking(
        { shopId: ids2.shopId },
        bookingInput(ids2, {
          startAt: "2026-11-02T11:00:00.000Z",
          contact: {
            name: "Other Customer 2",
            email: "other2@example.test",
            whatsappOptIn: false,
          },
        }),
      );
      await waitForLockWaiters(barrier2, 2, ["replace", "public_booking"]);

      await barrier2.query("COMMIT");
      barrier2Open = false;
      await waitForLockCleanup(barrier2);

      const [resReplace2, resPublic2] = await Promise.all([
        reqReplace2,
        reqPublic2,
      ]);

      // Replacement succeeds and owns destination 11:00 - 11:30
      expect(resReplace2.success).toBe(true);
      if (!resReplace2.success) return;
      expect(resReplace2.data.operation.revision).toBe(1);

      // Public booking fails with UNAVAILABLE_INTERVAL
      expect(resPublic2).toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE_INTERVAL" },
      });

      // Replacement owns destination occupancy
      const state2After = await bookingState(booking2.bookingId, occId2);
      expect(state2After).toMatchObject({
        status: "confirmed",
        revision: 1,
        changes: 1,
        work: state2Before.work + 2,
        original_occupancy: 1,
      });

      const destOcc2 = (
        await database.pool.query(
          "SELECT barber_id, start_at, end_at FROM occupied_intervals WHERE id=$1",
          [state2After.occupancy_id],
        )
      ).rows[0];
      expect(destOcc2).toMatchObject({
        barber_id: ids2.barberId,
        start_at: new Date("2026-11-02T11:00:00.000Z"),
        end_at: new Date("2026-11-02T11:30:00.000Z"),
      });

      // Old 10:00 is vacated
      const oldOcc2 = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = $3",
          [ids2.shopId, ids2.barberId, START_AT],
        )
      ).rows[0];
      expect(oldOcc2.count).toBe(0);

      // Managed view reads new destination 11:00 - 11:30
      const managed2 = await getManagedBooking(
        { shopId: ids2.shopId },
        booking2.token,
      );
      expect(managed2).toMatchObject({
        success: true,
        data: {
          status: "confirmed",
          revision: 1,
          startAt: "2026-11-02T11:00:00.000Z",
          endAt: "2026-11-02T11:30:00.000Z",
        },
      });
    } finally {
      if (barrier2Open) {
        await barrier2.query("ROLLBACK").catch(() => undefined);
      }
      await Promise.allSettled([reqReplace2, reqPublic2]);
      await waitForLockCleanup(barrier2).catch(() => undefined);
      barrier2.release();
    }
  });

  it("Slice 5 Case 10: Catalog/schedule mutation and capability revocation ordered before lock acquisition prevent invalid commit", async () => {
    // -----------------------------------------------------------------------------------
    // 1. Catalog mutation ordered before lock acquisition: hide different offered service
    // -----------------------------------------------------------------------------------
    const ids1 = await fixture();
    const booking1 = await createBooking(ids1);
    const occId1 = (
      await database.pool.query(
        "SELECT occupancy_id FROM bookings WHERE id=$1",
        [booking1.bookingId],
      )
    ).rows[0].occupancy_id as string;
    const state1Before = await bookingState(booking1.bookingId, occId1);
    const shave = await saveService(ids1.context, {
      name: "Shave",
      priceUsd: "35",
      durationMinutes: "45",
      offered: true,
      barberIds: [ids1.barberId],
    });
    expect(shave.success).toBe(true);
    if (!shave.success) return;

    const barrier1 = await database.pool.connect();
    let barrier1Open = true;
    let reqCatalog: ReturnType<typeof replaceCustomerBooking> | undefined;

    try {
      await barrier1.query("BEGIN");
      await barrier1.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
        ids1.shopId,
      ]);

      reqCatalog = replaceCustomerBooking(
        { shopId: ids1.shopId },
        replacementInput(booking1.token, ids1, {
          serviceId: shave.data.id,
          reviewedOffer: {
            name: "Shave",
            priceUsd: "35.00",
            durationMinutes: "45",
          },
          startAt: "2026-11-02T11:00:00.000Z",
        }),
      );
      await waitForLockWaiters(barrier1, 1, ["replace"]);

      // Mutate catalog before releasing the shop lock: un-offer Shave
      await barrier1.query(
        "UPDATE services SET offered = false WHERE id = $1",
        [shave.data.id],
      );

      await barrier1.query("COMMIT");
      barrier1Open = false;
      await waitForLockCleanup(barrier1);

      const resCatalog = await reqCatalog;
      expect(resCatalog).toMatchObject({
        success: false,
        error: { code: "STALE_OFFER" },
      });

      // Original booking and occupancy are completely intact
      const state1 = await bookingState(
        booking1.bookingId,
        state1Before.occupancy_id,
      );
      expect(state1).toEqual(state1Before);

      // Destination 11:00 not occupied
      const destOcc1 = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = '2026-11-02T11:00:00.000Z'",
          [ids1.shopId, ids1.barberId],
        )
      ).rows[0];
      expect(destOcc1.count).toBe(0);

      // Original 10:00 occupancy remains intact
      const origOcc1 = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = $3",
          [ids1.shopId, ids1.barberId, START_AT],
        )
      ).rows[0];
      expect(origOcc1.count).toBe(1);

      const managed1 = await getManagedBooking(
        { shopId: ids1.shopId },
        booking1.token,
      );
      expect(managed1).toMatchObject({
        success: true,
        data: {
          status: "confirmed",
          revision: 0,
          startAt: "2026-11-02T10:00:00.000Z",
          endAt: "2026-11-02T10:30:00.000Z",
        },
      });
    } finally {
      if (barrier1Open) {
        await barrier1.query("ROLLBACK").catch(() => undefined);
      }
      await reqCatalog?.catch(() => undefined);
      await waitForLockCleanup(barrier1).catch(() => undefined);
      barrier1.release();
    }

    // -----------------------------------------------------------------------------------
    // 2. Schedule mutation ordered before lock acquisition: shop closed on booking date
    // -----------------------------------------------------------------------------------
    const ids2 = await fixture();
    const booking2 = await createBooking(ids2);
    const occId2 = (
      await database.pool.query(
        "SELECT occupancy_id FROM bookings WHERE id=$1",
        [booking2.bookingId],
      )
    ).rows[0].occupancy_id as string;
    const state2Before = await bookingState(booking2.bookingId, occId2);

    const barrier2 = await database.pool.connect();
    let barrier2Open = true;
    let reqSchedule: ReturnType<typeof replaceCustomerBooking> | undefined;

    try {
      await barrier2.query("BEGIN");
      await barrier2.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
        ids2.shopId,
      ]);

      reqSchedule = replaceCustomerBooking(
        { shopId: ids2.shopId },
        replacementInput(booking2.token, ids2, {
          startAt: "2026-11-02T11:00:00.000Z",
        }),
      );
      await waitForLockWaiters(barrier2, 1, ["replace"]);

      // Mutate schedule before releasing the lock: close shop on 2026-11-02
      await barrier2.query(
        `INSERT INTO shop_date_schedules (shop_id, date, closed, revision)
         VALUES ($1, '2026-11-02', true, 1)`,
        [ids2.shopId],
      );

      await barrier2.query("COMMIT");
      barrier2Open = false;
      await waitForLockCleanup(barrier2);

      const resSchedule = await reqSchedule;
      expect(resSchedule).toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE_INTERVAL" },
      });

      // Original booking and occupancy remain intact
      const state2 = await bookingState(
        booking2.bookingId,
        state2Before.occupancy_id,
      );
      expect(state2).toEqual(state2Before);

      // Destination 11:00 not occupied
      const destOcc2 = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = '2026-11-02T11:00:00.000Z'",
          [ids2.shopId, ids2.barberId],
        )
      ).rows[0];
      expect(destOcc2.count).toBe(0);

      // Original 10:00 occupancy remains intact
      const origOcc2 = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = $3",
          [ids2.shopId, ids2.barberId, START_AT],
        )
      ).rows[0];
      expect(origOcc2.count).toBe(1);

      const managed2 = await getManagedBooking(
        { shopId: ids2.shopId },
        booking2.token,
      );
      expect(managed2).toMatchObject({
        success: true,
        data: {
          status: "confirmed",
          revision: 0,
          startAt: "2026-11-02T10:00:00.000Z",
          endAt: "2026-11-02T10:30:00.000Z",
        },
      });
    } finally {
      if (barrier2Open) {
        await barrier2.query("ROLLBACK").catch(() => undefined);
      }
      await reqSchedule?.catch(() => undefined);
      await waitForLockCleanup(barrier2).catch(() => undefined);
      barrier2.release();
    }

    // -----------------------------------------------------------------------------------
    // 3. Capability revocation ordered before lock acquisition
    // -----------------------------------------------------------------------------------
    const ids3 = await fixture();
    const booking3 = await createBooking(ids3);
    const occId3 = (
      await database.pool.query(
        "SELECT occupancy_id FROM bookings WHERE id=$1",
        [booking3.bookingId],
      )
    ).rows[0].occupancy_id as string;
    const state3Before = await bookingState(booking3.bookingId, occId3);

    const barrier3 = await database.pool.connect();
    let barrier3Open = true;
    let reqRevocation: ReturnType<typeof replaceCustomerBooking> | undefined;

    try {
      await barrier3.query("BEGIN");
      await barrier3.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
        ids3.shopId,
      ]);

      reqRevocation = replaceCustomerBooking(
        { shopId: ids3.shopId },
        replacementInput(booking3.token, ids3, {
          startAt: "2026-11-02T11:00:00.000Z",
        }),
      );
      await waitForLockWaiters(barrier3, 1, ["replace"]);

      // Revoke capability before releasing the shop lock
      await barrier3.query(
        "UPDATE bookings SET capability_revoked_at = NOW() WHERE id = $1",
        [booking3.bookingId],
      );

      await barrier3.query("COMMIT");
      barrier3Open = false;
      await waitForLockCleanup(barrier3);

      const resRevocation = await reqRevocation;
      expect(resRevocation).toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE" },
      });

      // Original booking details and occupancy remain at 10:00 - 10:30 (with capability revoked)
      const state3 = await bookingState(
        booking3.bookingId,
        state3Before.occupancy_id,
      );
      expect(state3).toMatchObject({
        status: "confirmed",
        revision: 0,
        start_at: new Date("2026-11-02T10:00:00.000Z"),
        changes: 0,
        work: state3Before.work,
        original_occupancy: 1,
      });

      // Destination 11:00 not occupied
      const destOcc3 = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = '2026-11-02T11:00:00.000Z'",
          [ids3.shopId, ids3.barberId],
        )
      ).rows[0];
      expect(destOcc3.count).toBe(0);

      // Original 10:00 occupancy remains intact
      const origOcc3 = (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2 AND start_at = $3",
          [ids3.shopId, ids3.barberId, START_AT],
        )
      ).rows[0];
      expect(origOcc3.count).toBe(1);

      const managed3 = await getManagedBooking(
        { shopId: ids3.shopId },
        booking3.token,
      );
      expect(managed3).toEqual({
        success: false,
        error: {
          code: "UNAVAILABLE",
          message: "This booking link is unavailable.",
        },
      });
    } finally {
      if (barrier3Open) {
        await barrier3.query("ROLLBACK").catch(() => undefined);
      }
      await reqRevocation?.catch(() => undefined);
      await waitForLockCleanup(barrier3).catch(() => undefined);
      barrier3.release();
    }
  });

  it("Slice 6 Case 4: stages unavailable WhatsApp work item only under opt-in with customer phone", async () => {
    const ids = await fixture();
    const withWhatsapp = await createBooking(ids, {
      contact: {
        name: "Ada Lovelace",
        email: "ada@example.test",
        phone: "+15551234567",
        whatsappOptIn: true,
      },
    });

    const receipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(withWhatsapp.token, ids, {
        startAt: "2026-11-02T11:00:00.000Z",
      }),
    );
    expect(receipt.success).toBe(true);
    if (!receipt.success) return;

    const workWithWhatsapp = (
      await database.pool.query(
        "SELECT kind, channel, status, recipient, reason, booking_revision FROM notification_work WHERE booking_id = $1 AND booking_revision = 1 ORDER BY channel",
        [withWhatsapp.bookingId],
      )
    ).rows;

    expect(workWithWhatsapp).toEqual([
      {
        kind: "customer_move",
        channel: "email",
        status: "unavailable",
        recipient: "ada@example.test",
        reason: "disabled",
        booking_revision: 1,
      },
      {
        kind: "owner_move",
        channel: "email",
        status: "unavailable",
        recipient: expect.stringMatching(/replace-.*@example\.test/),
        reason: "disabled",
        booking_revision: 1,
      },
      {
        kind: "customer_move",
        channel: "whatsapp",
        status: "unavailable",
        recipient: "+15551234567",
        reason: "channel_unavailable",
        booking_revision: 1,
      },
    ]);

    // Booking without whatsapp opt-in stages no whatsapp work
    const withoutWhatsapp = await createBooking(ids, {
      contact: {
        name: "Ada Lovelace",
        email: "ada@example.test",
        whatsappOptIn: false,
      },
    });
    const receipt2 = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(withoutWhatsapp.token, ids, {
        startAt: "2026-11-02T12:00:00.000Z",
      }),
    );
    expect(receipt2.success).toBe(true);

    const workWithoutWhatsapp = (
      await database.pool.query(
        "SELECT kind, channel, status FROM notification_work WHERE booking_id = $1 AND booking_revision = 1 AND channel = 'whatsapp'",
        [withoutWhatsapp.bookingId],
      )
    ).rows;
    expect(workWithoutWhatsapp).toHaveLength(0);
  });

  it("Slice 6 Case 5: truthful missing-recipient handling stages skipped customer work and valid owner move work", async () => {
    const ids = await fixture();
    const created = await createOwnerBooking(ids.context, {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: START_AT,
      reviewedOffer: {
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: "30",
      },
      contact: { name: "Walk-in Wanda", whatsappOptIn: false },
      recoveryKey: randomBytes(32).toString("base64url"),
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const stored = (
      await database.pool.query(
        "SELECT capability_ciphertext, capability_key_id FROM bookings WHERE id = $1",
        [created.data.bookingId],
      )
    ).rows[0];
    const token = decryptCapability(
      stored.capability_ciphertext,
      stored.capability_key_id,
      `${ids.shopId}:${created.data.bookingId}`,
    );

    const receipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(token, ids, {
        startAt: "2026-11-02T11:00:00.000Z",
      }),
    );
    expect(receipt.success).toBe(true);
    if (!receipt.success) return;

    const ownerEmail = (
      await database.pool.query('SELECT email FROM "user" WHERE id = $1', [
        ids.ownerId,
      ])
    ).rows[0].email;

    const work = (
      await database.pool.query(
        "SELECT kind, channel, status, recipient, reason, booking_revision FROM notification_work WHERE booking_id = $1 AND booking_revision = 1 ORDER BY kind",
        [created.data.bookingId],
      )
    ).rows;

    expect(work).toEqual([
      {
        kind: "customer_move",
        channel: "email",
        status: "skipped",
        recipient: null,
        reason: "recipient_missing",
        booking_revision: 1,
      },
      {
        kind: "owner_move",
        channel: "email",
        status: "unavailable",
        recipient: ownerEmail,
        reason: "disabled",
        booking_revision: 1,
      },
    ]);
  });

  it("Slice 6 Case 6: obsolete not_attempted work suppressed while completed attempt evidence retained", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);

    // Simulate revision 0 having 1 captured work item (with attempt) and 1 not_attempted work item
    const workItems = (
      await database.pool.query(
        "SELECT id, kind FROM notification_work WHERE booking_id = $1 AND booking_revision = 0",
        [booking.bookingId],
      )
    ).rows;

    const confirmationWork = workItems.find(
      (w) => w.kind === "customer_confirmation",
    )!;
    const alertWork = workItems.find((w) => w.kind === "owner_alert")!;

    const budgetInsert = await database.pool.query(
      `INSERT INTO outbound_budget (day, allocation_count)
       SELECT candidate.day::date, 1 FROM generate_series('2100-01-01'::date, '2109-12-31'::date, '1 day') AS candidate(day)
       WHERE NOT EXISTS (SELECT 1 FROM outbound_budget WHERE outbound_budget.day = candidate.day::date)
       LIMIT 1 ON CONFLICT (day) DO NOTHING RETURNING day::text`,
    );
    const budgetDay = budgetInsert.rows[0]?.day as string | undefined;
    if (!budgetDay) throw new Error("Could not claim an isolated budget day.");
    ownedBudgetDays.add(budgetDay);
    const attemptId = randomUUID();
    await database.pool.query(
      "INSERT INTO notification_attempts (id, work_id, budget_day, outcome, capture_id) VALUES ($1, $2, $3, 'captured', 'capture-rev0')",
      [attemptId, confirmationWork.id, budgetDay],
    );
    await database.pool.query(
      "UPDATE notification_work SET status = 'captured', reason = NULL WHERE id = $1",
      [confirmationWork.id],
    );
    await database.pool.query(
      "UPDATE notification_work SET status = 'not_attempted' WHERE id = $1",
      [alertWork.id],
    );

    const receipt = await replaceCustomerBooking(
      { shopId: ids.shopId },
      replacementInput(booking.token, ids, {
        startAt: "2026-11-02T11:00:00.000Z",
      }),
    );
    expect(receipt.success).toBe(true);

    const rev0Work = (
      await database.pool.query(
        "SELECT id, kind, status, reason FROM notification_work WHERE booking_id = $1 AND booking_revision = 0 ORDER BY kind",
        [booking.bookingId],
      )
    ).rows;

    // Completed work retained its captured status; unattempted work was suppressed
    expect(rev0Work).toEqual([
      {
        id: confirmationWork.id,
        kind: "customer_confirmation",
        status: "captured",
        reason: null,
      },
      {
        id: alertWork.id,
        kind: "owner_alert",
        status: "suppressed",
        reason: "superseded",
      },
    ]);

    const attempts = (
      await database.pool.query(
        "SELECT id, outcome, capture_id FROM notification_attempts WHERE work_id = $1",
        [confirmationWork.id],
      )
    ).rows;
    expect(attempts).toEqual([
      {
        id: attemptId,
        outcome: "captured",
        capture_id: "capture-rev0",
      },
    ]);
  });

  it("Slice 6 Case 8: replay adds no additional notification work", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    const opKey = randomBytes(32).toString("base64url");
    const input = replacementInput(booking.token, ids, {
      operationKey: opKey,
      startAt: "2026-11-02T11:00:00.000Z",
    });

    const first = await replaceCustomerBooking({ shopId: ids.shopId }, input);
    expect(first.success).toBe(true);

    const workCountBefore = (
      await database.pool.query(
        "SELECT count(*)::int AS count FROM notification_work WHERE booking_id = $1",
        [booking.bookingId],
      )
    ).rows[0].count;

    const replay = await replaceCustomerBooking({ shopId: ids.shopId }, input);
    expect(replay.success).toBe(true);
    if (!replay.success || !first.success) return;

    expect(replay.data.operation.id).toBe(first.data.operation.id);
    expect(replay.data.operation.revision).toBe(1);

    const workCountAfter = (
      await database.pool.query(
        "SELECT count(*)::int AS count FROM notification_work WHERE booking_id = $1",
        [booking.bookingId],
      )
    ).rows[0].count;

    expect(workCountAfter).toBe(workCountBefore);
  });
});
