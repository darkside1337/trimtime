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
  waitForBlockedRequest,
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
const END_AT = "2026-11-02T10:30:00.000Z";

describe("customer cancellation", () => {
  afterEach(() => vi.setSystemTime(new Date(NOW)));
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let appPool: Pool;
  let closeAppPool: (() => Promise<void>) | undefined;
  let testAuth: typeof import("@/tests/support/auth").testAuth;
  let createShop: typeof import("@/features/shops/mutations").createShop;
  let readOwnerContext: typeof import("@/server/owner-context").readOwnerContext;
  let saveBarber: typeof import("@/features/barbers/mutations").saveBarber;
  let saveService: typeof import("@/features/catalog/mutations").saveService;
  let setServiceOffered: typeof import("@/features/catalog/mutations").setServiceOffered;
  let saveShopSchedule: typeof import("@/features/availability/mutations").saveShopSchedule;
  let setOwnShopPublication: typeof import("@/features/shops/mutations").setOwnShopPublication;
  let createPublicBooking: typeof import("../mutations").createPublicBooking;
  let createOwnerBooking: typeof import("../mutations").createOwnerBooking;
  let cancelOwnerBooking: typeof import("../mutations").cancelOwnerBooking;
  let moveOwnerBooking: typeof import("../mutations").moveOwnerBooking;
  let cancelCustomerBooking: typeof import("../mutations").cancelCustomerBooking;
  let getManagedBooking: typeof import("../queries").getManagedBooking;
  let previewPublishedShopSlots: typeof import("@/features/availability/queries").previewPublishedShopSlots;
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
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    await applyMigrations(database.pool, "db/migrations");
    ({ testAuth } = await import("@/tests/support/auth"));
    ({ readOwnerContext } = await import("@/server/owner-context"));
    ({ createShop, setOwnShopPublication } =
      await import("@/features/shops/mutations"));
    ({ saveBarber } = await import("@/features/barbers/mutations"));
    ({ saveService, setServiceOffered } =
      await import("@/features/catalog/mutations"));
    ({ saveShopSchedule } = await import("@/features/availability/mutations"));
    const mutations = await import("../mutations");
    createPublicBooking = (context, input) => {
      trackCreateEmailRateKey(rateKeys, context, input);
      return mutations.createPublicBooking(context, input);
    };
    cancelCustomerBooking = (context, input) => {
      trackCustomerChangeRateKey(rateKeys, context, input);
      return mutations.cancelCustomerBooking(context, input);
    };
    ({ createOwnerBooking, cancelOwnerBooking, moveOwnerBooking } = mutations);
    ({ getManagedBooking } = await import("../queries"));
    ({ previewPublishedShopSlots } =
      await import("@/features/availability/queries"));
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
        email: `cancel-${randomUUID()}@example.test`,
        name: "Cancel Owner",
      }),
    );
    ownerIds.push(owner.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: owner.id })).headers,
    );
    const shop = await createShop(
      context,
      shopInput({
        subdomain: `cancel-${randomUUID().slice(0, 8)}`,
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

  async function waitForLockWaiters(
    lock: PoolClient,
    expected: number,
    identities?: RequestIdentity[],
  ) {
    return waitForSharedLockWaiters(database.pool, lock, expected, identities, {
      description: "customer cancellation queue",
    });
  }

  async function waitForBlockedCancellation(lock: PoolClient) {
    return waitForBlockedRequest(database.pool, lock, "cancel", {
      description: "customer cancellation",
    });
  }

  it("cancels an eligible booking", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    await expect(
      getManagedBooking({ shopId: ids.shopId }, booking.token),
    ).resolves.toMatchObject({
      success: true,
      data: { revision: 0, status: "confirmed", startAt: START_AT },
    });

    const receipt = await cancelCustomerBooking(
      { shopId: ids.shopId },
      cancellationInput(booking.token),
    );
    expect(receipt).toMatchObject({
      success: true,
      data: {
        bookingId: booking.bookingId,
        status: "cancelled",
        operation: {
          id: expect.any(String),
          revision: 1,
          committedAt: "2026-11-01T08:00:00.000Z",
        },
      },
    });
    if (!receipt.success) return;
    expect(receipt.data.operation.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    await expect(
      getManagedBooking({ shopId: ids.shopId }, booking.token),
    ).resolves.toMatchObject({
      success: true,
      data: {
        status: "cancelled",
        revision: 1,
        startAt: START_AT,
        endAt: END_AT,
      },
    });
  });

  it("recovers an identical successful cancellation without duplicate work", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    const operationKey = randomBytes(32).toString("base64url");
    const input = cancellationInput(booking.token, { operationKey });
    const first = await cancelCustomerBooking({ shopId: ids.shopId }, input);
    expect(first).toMatchObject({
      success: true,
      data: { status: "cancelled", operation: { revision: 1 } },
    });
    const committed = await bookingState(booking.bookingId, null);

    await expect(
      cancelCustomerBooking({ shopId: ids.shopId }, input),
    ).resolves.toEqual(first);

    const recovered = await bookingState(booking.bookingId, null);
    expect(recovered).toEqual(committed);
    expect(recovered).toMatchObject({
      status: "cancelled",
      revision: 1,
      occupancy_id: null,
      original_occupancy: 0,
      changes: 1,
      work: committed.work,
    });
  });

  it("rejects recovery with changed content or a key bound to another operation", async () => {
    const ids = await fixture();
    const first = await createBooking(ids);
    const second = await createBooking(ids, {
      startAt: "2026-11-02T12:00:00.000Z",
    });
    const ownerBooking = await createBooking(ids, {
      startAt: "2026-11-02T13:00:00.000Z",
    });
    const operationKey = randomBytes(32).toString("base64url");
    const firstReceipt = await cancelCustomerBooking(
      { shopId: ids.shopId },
      cancellationInput(first.token, { operationKey }),
    );
    expect(firstReceipt).toMatchObject({ success: true });

    await expect(
      cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(first.token, { operationKey, expectedRevision: 1 }),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });

    await expect(
      cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(second.token, { operationKey }),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });

    const ownerKey = randomBytes(32).toString("base64url");
    await expect(
      cancelOwnerBooking(ids.context, {
        bookingId: ownerBooking.bookingId,
        expectedRevision: 0,
        operationKey: ownerKey,
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(ownerBooking.token, { operationKey: ownerKey }),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });

    const states = await Promise.all(
      [first, second, ownerBooking].map((booking) =>
        bookingState(booking.bookingId, null),
      ),
    );
    expect(
      states.map(({ status, revision, changes }) => ({
        status,
        revision,
        changes,
      })),
    ).toEqual([
      { status: "cancelled", revision: 1, changes: 1 },
      { status: "confirmed", revision: 0, changes: 0 },
      { status: "cancelled", revision: 1, changes: 1 },
    ]);
  });

  it("rejects a fresh key with a stale revision and retains the reviewed details", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    await expect(
      moveOwnerBooking(ids.context, {
        bookingId: booking.bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        startAt: "2026-11-02T12:00:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
      }),
    ).resolves.toMatchObject({ success: true });

    await expect(
      cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(booking.token),
      ),
    ).resolves.toEqual({
      success: false,
      error: {
        code: "STALE_BOOKING",
        message: "Appointment changed. Reload and try again.",
      },
    });
    await expect(
      getManagedBooking({ shopId: ids.shopId }, booking.token),
    ).resolves.toMatchObject({
      success: true,
      data: {
        status: "confirmed",
        revision: 1,
        startAt: "2026-11-02T12:00:00.000Z",
        service: { name: "Cut", priceUsd: "25.00", durationMinutes: 30 },
      },
    });
  });

  it("recovers a committed cancellation after its end until the link is revoked or expires", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    const expiringIds = await fixture();
    const expiringBooking = await createBooking(expiringIds);
    const operationKey = randomBytes(32).toString("base64url");
    const expiringKey = randomBytes(32).toString("base64url");
    const first = await cancelCustomerBooking(
      { shopId: ids.shopId },
      cancellationInput(booking.token, { operationKey }),
    );
    expect(first).toMatchObject({ success: true });
    const expiringFirst = await cancelCustomerBooking(
      { shopId: expiringIds.shopId },
      cancellationInput(expiringBooking.token, { operationKey: expiringKey }),
    );
    expect(expiringFirst).toMatchObject({ success: true });

    vi.setSystemTime(new Date("2026-11-02T11:00:00.000Z"));
    await expect(
      cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(booking.token, { operationKey }),
      ),
    ).resolves.toEqual(first);

    await database.pool.query(
      "UPDATE bookings SET capability_revoked_at='2026-11-02T11:00:00Z' WHERE id=$1",
      [booking.bookingId],
    );
    const unavailable = {
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    };
    await expect(
      cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(booking.token, { operationKey }),
      ),
    ).resolves.toEqual(unavailable);

    vi.setSystemTime(new Date("2026-11-09T10:30:00.000Z"));
    await expect(
      cancelCustomerBooking(
        { shopId: expiringIds.shopId },
        cancellationInput(expiringBooking.token, { operationKey: expiringKey }),
      ),
    ).resolves.toEqual(unavailable);
  });

  it("limits counted customer change attempts while excluding invalid authority and successful replay", async () => {
    const limitIds = await fixture();
    const otherShop = await fixture();
    const limited = await createBooking(limitIds);
    const limitedBefore = await bookingState(limited.bookingId, null);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        cancelCustomerBooking(
          { shopId: limitIds.shopId },
          cancellationInput(limited.token, { expectedRevision: 1 }),
        ),
      ).resolves.toMatchObject({
        success: false,
        error: { code: "STALE_BOOKING" },
      });
    }
    await expect(
      cancelCustomerBooking(
        { shopId: limitIds.shopId },
        cancellationInput(limited.token, { expectedRevision: 1 }),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "RATE_LIMITED" },
    });
    await expect(
      cancelCustomerBooking(
        { shopId: otherShop.shopId },
        cancellationInput(limited.token, { expectedRevision: 1 }),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE" },
    });
    await expect(
      bookingState(limited.bookingId, limitedBefore.occupancy_id),
    ).resolves.toMatchObject({
      status: "confirmed",
      revision: 0,
      occupancy_id: limitedBefore.occupancy_id,
      original_occupancy: 1,
      changes: 0,
      work: limitedBefore.work,
    });

    const replayIds = await fixture();
    const replayBooking = await createBooking(replayIds);
    const operationKey = randomBytes(32).toString("base64url");
    const cancelled = await cancelCustomerBooking(
      { shopId: replayIds.shopId },
      cancellationInput(replayBooking.token, { operationKey }),
    );
    expect(cancelled).toMatchObject({ success: true });
    const cancelledState = await bookingState(replayBooking.bookingId, null);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(
        cancelCustomerBooking(
          { shopId: replayIds.shopId },
          cancellationInput(replayBooking.token, { expectedRevision: 0 }),
        ),
      ).resolves.toMatchObject({
        success: false,
        error: { code: "STALE_BOOKING" },
      });
    }
    await expect(
      cancelCustomerBooking(
        { shopId: limitIds.shopId },
        cancellationInput(replayBooking.token, { expectedRevision: 0 }),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE" },
    });
    await expect(
      cancelCustomerBooking(
        { shopId: replayIds.shopId },
        cancellationInput(replayBooking.token, { operationKey }),
      ),
    ).resolves.toEqual(cancelled);
    await expect(
      cancelCustomerBooking(
        { shopId: replayIds.shopId },
        cancellationInput(replayBooking.token, { expectedRevision: 0 }),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "STALE_BOOKING" },
    });
    await expect(
      cancelCustomerBooking(
        { shopId: replayIds.shopId },
        cancellationInput(replayBooking.token, { expectedRevision: 0 }),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "RATE_LIMITED" },
    });
    await expect(bookingState(replayBooking.bookingId, null)).resolves.toEqual(
      cancelledState,
    );
  });

  it("restores an allowance exactly sixty minutes after the counted events", async () => {
    const boundaryIds = await fixture();
    const boundaryBooking = await createBooking(boundaryIds);
    const beforeIds = await fixture();
    const beforeBooking = await createBooking(beforeIds);
    for (const [ids, booking] of [
      [boundaryIds, boundaryBooking],
      [beforeIds, beforeBooking],
    ] as const) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await expect(
          cancelCustomerBooking(
            { shopId: ids.shopId },
            cancellationInput(booking.token, { expectedRevision: 1 }),
          ),
        ).resolves.toMatchObject({
          success: false,
          error: { code: "STALE_BOOKING" },
        });
      }
    }

    vi.setSystemTime(new Date("2026-11-01T08:59:59.999Z"));
    await expect(
      getManagedBooking({ shopId: boundaryIds.shopId }, boundaryBooking.token),
    ).resolves.toMatchObject({
      success: true,
      data: { status: "confirmed", revision: 0 },
    });
    await expect(
      cancelCustomerBooking(
        { shopId: beforeIds.shopId },
        cancellationInput(beforeBooking.token, { expectedRevision: 1 }),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "RATE_LIMITED" },
    });

    vi.setSystemTime(new Date("2026-11-01T09:00:00.000Z"));
    await expect(
      cancelCustomerBooking(
        { shopId: boundaryIds.shopId },
        cancellationInput(boundaryBooking.token),
      ),
    ).resolves.toMatchObject({
      success: true,
      data: { status: "cancelled", operation: { revision: 1 } },
    });
  });

  it("admits exactly one of two racing attempts at the last permitted slot", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await expect(
        cancelCustomerBooking(
          { shopId: ids.shopId },
          cancellationInput(booking.token, { expectedRevision: 1 }),
        ),
      ).resolves.toMatchObject({
        success: false,
        error: { code: "STALE_BOOKING" },
      });
    }

    const results = await Promise.all([
      cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(booking.token, { expectedRevision: 1 }),
      ),
      cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(booking.token, { expectedRevision: 1 }),
      ),
    ]);
    expect(
      results.map((result) => (result.success ? "success" : result.error.code)),
    ).toEqual(expect.arrayContaining(["STALE_BOOKING", "RATE_LIMITED"]));
    expect(
      results.filter(
        (result) => !result.success && result.error.code === "STALE_BOOKING",
      ),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) => !result.success && result.error.code === "RATE_LIMITED",
      ),
    ).toHaveLength(1);
    await expect(bookingState(booking.bookingId, null)).resolves.toMatchObject({
      status: "confirmed",
      revision: 0,
      changes: 0,
    });
    const counted = await database.pool.query(
      `SELECT count(*)::int AS count FROM public_rate_events WHERE scope='customer_change_link' AND key_hash=$1`,
      [hashSecret(`${ids.shopId}:${booking.token}`)],
    );
    expect(counted.rows[0].count).toBe(11);
  });

  it("keeps the allowance independent for another manage link in the same shop", async () => {
    const ids = await fixture();
    const throttled = await createBooking(ids);
    const independent = await createBooking(ids, {
      startAt: "2026-11-02T12:00:00.000Z",
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        cancelCustomerBooking(
          { shopId: ids.shopId },
          cancellationInput(throttled.token, { expectedRevision: 1 }),
        ),
      ).resolves.toMatchObject({
        success: false,
        error: { code: "STALE_BOOKING" },
      });
    }
    await expect(
      cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(throttled.token, { expectedRevision: 1 }),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "RATE_LIMITED" },
    });

    await expect(
      cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(independent.token),
      ),
    ).resolves.toMatchObject({
      success: true,
      data: { status: "cancelled", operation: { revision: 1 } },
    });
  });

  it("serializes concurrent identical and competing cancellation submissions", async () => {
    const identicalIds = await fixture();
    const identicalBooking = await createBooking(identicalIds);
    const identicalBefore = await bookingState(
      identicalBooking.bookingId,
      null,
    );
    const operationKey = randomBytes(32).toString("base64url");
    const identicalInput = cancellationInput(identicalBooking.token, {
      operationKey,
    });
    const identicalResults = await Promise.all([
      cancelCustomerBooking({ shopId: identicalIds.shopId }, identicalInput),
      cancelCustomerBooking({ shopId: identicalIds.shopId }, identicalInput),
    ]);
    expect(identicalResults[0]).toMatchObject({ success: true });
    expect(identicalResults[1]).toEqual(identicalResults[0]);
    const identicalState = await bookingState(identicalBooking.bookingId, null);
    expect(identicalState).toMatchObject({
      status: "cancelled",
      revision: 1,
      occupancy_id: null,
      original_occupancy: 0,
      changes: 1,
      work: identicalBefore.work + 2,
    });

    const competingIds = await fixture();
    const competingBooking = await createBooking(competingIds);
    const competingResults = await Promise.all([
      cancelCustomerBooking(
        { shopId: competingIds.shopId },
        cancellationInput(competingBooking.token),
      ),
      cancelCustomerBooking(
        { shopId: competingIds.shopId },
        cancellationInput(competingBooking.token),
      ),
    ]);
    expect(competingResults.filter((result) => result.success)).toHaveLength(1);
    expect(
      competingResults.filter(
        (result) => !result.success && result.error.code === "STALE_BOOKING",
      ),
    ).toHaveLength(1);
    await expect(
      bookingState(competingBooking.bookingId, null),
    ).resolves.toMatchObject({
      status: "cancelled",
      revision: 1,
      occupancy_id: null,
      original_occupancy: 0,
      changes: 1,
    });
  });

  it("serializes an owner move and customer cancellation in both queue orders", async () => {
    const moveFirstIds = await fixture();
    const moveFirst = await createBooking(moveFirstIds);
    const moveFirstLock = await database.pool.connect();
    let moveFirstOpen = true;
    let moveRequest: ReturnType<typeof moveOwnerBooking> | undefined;
    let moveFirstCancel: ReturnType<typeof cancelCustomerBooking> | undefined;
    try {
      await moveFirstLock.query("BEGIN");
      await moveFirstLock.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
        moveFirstIds.shopId,
      ]);
      moveRequest = moveOwnerBooking(moveFirstIds.context, {
        bookingId: moveFirst.bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
        serviceId: moveFirstIds.serviceId,
        barberId: moveFirstIds.barberId,
        startAt: "2026-11-02T12:00:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
      });
      await waitForLockWaiters(moveFirstLock, 1, ["owner_move"]);
      moveFirstCancel = cancelCustomerBooking(
        { shopId: moveFirstIds.shopId },
        cancellationInput(moveFirst.token),
      );
      await waitForLockWaiters(moveFirstLock, 2, ["owner_move", "cancel"]);
      await moveFirstLock.query("COMMIT");
      moveFirstOpen = false;
      await expect(moveRequest).resolves.toMatchObject({ success: true });
      await expect(moveFirstCancel).resolves.toMatchObject({
        success: false,
        error: { code: "STALE_BOOKING" },
      });
    } finally {
      if (moveFirstOpen) await moveFirstLock.query("ROLLBACK");
      await moveRequest?.catch(() => undefined);
      await moveFirstCancel?.catch(() => undefined);
      moveFirstLock.release();
    }
    await expect(
      getManagedBooking({ shopId: moveFirstIds.shopId }, moveFirst.token),
    ).resolves.toMatchObject({
      success: true,
      data: {
        status: "confirmed",
        revision: 1,
        startAt: "2026-11-02T12:00:00.000Z",
      },
    });

    const cancelFirstIds = await fixture();
    const cancelFirst = await createBooking(cancelFirstIds);
    const cancelFirstLock = await database.pool.connect();
    let cancelFirstOpen = true;
    let cancelRequest: ReturnType<typeof cancelCustomerBooking> | undefined;
    let laterMove: ReturnType<typeof moveOwnerBooking> | undefined;
    try {
      await cancelFirstLock.query("BEGIN");
      await cancelFirstLock.query(
        "SELECT id FROM shops WHERE id=$1 FOR UPDATE",
        [cancelFirstIds.shopId],
      );
      cancelRequest = cancelCustomerBooking(
        { shopId: cancelFirstIds.shopId },
        cancellationInput(cancelFirst.token),
      );
      await waitForLockWaiters(cancelFirstLock, 1, ["cancel"]);
      laterMove = moveOwnerBooking(cancelFirstIds.context, {
        bookingId: cancelFirst.bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
        serviceId: cancelFirstIds.serviceId,
        barberId: cancelFirstIds.barberId,
        startAt: "2026-11-02T12:00:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
      });
      await waitForLockWaiters(cancelFirstLock, 2, ["cancel", "owner_move"]);
      await cancelFirstLock.query("COMMIT");
      cancelFirstOpen = false;
      await expect(cancelRequest).resolves.toMatchObject({ success: true });
      await expect(laterMove).resolves.toMatchObject({
        success: false,
        error: { code: "STALE_BOOKING" },
      });
    } finally {
      if (cancelFirstOpen) await cancelFirstLock.query("ROLLBACK");
      await cancelRequest?.catch(() => undefined);
      await laterMove?.catch(() => undefined);
      cancelFirstLock.release();
    }
    await expect(
      bookingState(cancelFirst.bookingId, null),
    ).resolves.toMatchObject({
      status: "cancelled",
      revision: 1,
      occupancy_id: null,
      original_occupancy: 0,
      changes: 1,
    });
  });

  it("retains the saved appointment, releases the slot, and records customer and owner cancellation work", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    const before = (
      await database.pool.query(
        `SELECT occupancy_id,capability_hash,capability_ciphertext,capability_key_id FROM bookings WHERE id=$1`,
        [booking.bookingId],
      )
    ).rows[0];
    const availability = (start: string) => ({
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      date: start.slice(0, 10),
    });
    const offered = async (start: string) => {
      const slots = await previewPublishedShopSlots(
        ids.shopId,
        availability(start),
      );
      return (
        slots?.slots.some(
          (slot) => Date.parse(slot.start) === Date.parse(start),
        ) ?? false
      );
    };
    await expect(offered(START_AT)).resolves.toBe(false);

    const operationKey = randomBytes(32).toString("base64url");
    const receipt = await cancelCustomerBooking(
      { shopId: ids.shopId },
      cancellationInput(booking.token, { operationKey }),
    );
    expect(receipt).toMatchObject({ success: true });
    if (!receipt.success) return;
    await expect(offered(START_AT)).resolves.toBe(true);

    const state = (
      await database.pool.query(
        `SELECT b.status,b.revision,b.occupancy_id,b.start_at,b.end_at,b.service_name,b.barber_name,b.customer_email,b.capability_hash,b.capability_ciphertext,b.capability_key_id,
          (SELECT count(*)::int FROM occupied_intervals i WHERE i.id=$2) AS original_occupancy,
          (SELECT count(*)::int FROM booking_changes c WHERE c.booking_id=b.id) AS changes,
          (SELECT count(*)::int FROM bookings o WHERE o.id=b.id) AS booking_count
        FROM bookings b WHERE b.id=$1`,
        [booking.bookingId, before.occupancy_id],
      )
    ).rows[0];
    expect(state).toMatchObject({
      status: "cancelled",
      revision: 1,
      occupancy_id: null,
      start_at: new Date(START_AT),
      end_at: new Date(END_AT),
      service_name: "Cut",
      barber_name: "Sam",
      customer_email: "ada@example.test",
      capability_hash: before.capability_hash,
      capability_ciphertext: before.capability_ciphertext,
      capability_key_id: before.capability_key_id,
      original_occupancy: 0,
      changes: 1,
      booking_count: 1,
    });

    const events = (
      await database.pool.query(
        `SELECT id,actor_id,actor_type,kind,applied_revision,committed_at,operation_key_hash,before_snapshot,after_snapshot FROM booking_changes WHERE booking_id=$1`,
        [booking.bookingId],
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor_id: null,
      actor_type: "customer",
      kind: "cancel",
      applied_revision: 1,
      committed_at: new Date("2026-11-01T08:00:00Z"),
      operation_key_hash: hashSecret(operationKey),
      before_snapshot: {
        status: "confirmed",
        serviceName: "Cut",
        servicePriceUsd: "25.00",
        serviceDurationMinutes: 30,
        barberName: "Sam",
        startAt: START_AT,
        endAt: END_AT,
      },
      after_snapshot: {
        status: "cancelled",
        serviceName: "Cut",
        servicePriceUsd: "25.00",
        serviceDurationMinutes: 30,
        barberName: "Sam",
        startAt: START_AT,
        endAt: END_AT,
      },
    });
    expect(events[0].id).toBe(receipt.data.operation.id);
    expect(receipt.data.operation.revision).toBe(1);

    const ownerEmail = (
      await database.pool.query('SELECT email FROM "user" WHERE id=$1', [
        ids.ownerId,
      ])
    ).rows[0].email;
    const work = (
      await database.pool.query(
        `SELECT kind,channel,status,recipient,booking_revision,change_id,reason FROM notification_work WHERE booking_id=$1 AND booking_revision=1 ORDER BY kind`,
        [booking.bookingId],
      )
    ).rows;
    expect(work).toEqual([
      {
        kind: "customer_cancellation",
        channel: "email",
        status: "unavailable",
        recipient: "ada@example.test",
        booking_revision: 1,
        change_id: receipt.data.operation.id,
        reason: "disabled",
      },
      {
        kind: "owner_cancellation",
        channel: "email",
        status: "unavailable",
        recipient: ownerEmail,
        booking_revision: 1,
        change_id: receipt.data.operation.id,
        reason: "disabled",
      },
    ]);
    await expect(
      getManagedBooking({ shopId: ids.shopId }, booking.token),
    ).resolves.toMatchObject({
      success: true,
      data: {
        status: "cancelled",
        revision: 1,
        startAt: START_AT,
        endAt: END_AT,
        service: { name: "Cut", priceUsd: "25.00", durationMinutes: 30 },
        barber: { name: "Sam" },
        customer: { name: "Ada Lovelace", email: "ada@example.test" },
      },
    });
  });

  it("cancels an owner-created contactless booking through the saved link", async () => {
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
    expect(created).toMatchObject({
      success: true,
      data: { appointment: { status: "confirmed", revision: 0 } },
    });
    if (!created.success) return;
    const stored = (
      await database.pool.query(
        "SELECT capability_ciphertext,capability_key_id FROM bookings WHERE id=$1",
        [created.data.bookingId],
      )
    ).rows[0];
    const token = decryptCapability(
      stored.capability_ciphertext,
      stored.capability_key_id,
      `${ids.shopId}:${created.data.bookingId}`,
    );
    const receipt = await cancelCustomerBooking(
      { shopId: ids.shopId },
      cancellationInput(token),
    );
    expect(receipt).toMatchObject({
      success: true,
      data: {
        bookingId: created.data.bookingId,
        status: "cancelled",
        operation: { revision: 1 },
      },
    });
    if (!receipt.success) return;
    const ownerEmail = (
      await database.pool.query('SELECT email FROM "user" WHERE id=$1', [
        ids.ownerId,
      ])
    ).rows[0].email;
    const work = (
      await database.pool.query(
        `SELECT kind,status,recipient,reason,change_id,booking_revision FROM notification_work WHERE booking_id=$1 AND booking_revision=1 ORDER BY kind`,
        [created.data.bookingId],
      )
    ).rows;
    expect(work).toEqual([
      {
        kind: "customer_cancellation",
        status: "skipped",
        recipient: null,
        reason: "recipient_missing",
        change_id: receipt.data.operation.id,
        booking_revision: 1,
      },
      {
        kind: "owner_cancellation",
        status: "unavailable",
        recipient: ownerEmail,
        reason: "disabled",
        change_id: receipt.data.operation.id,
        booking_revision: 1,
      },
    ]);
    await expect(
      getManagedBooking({ shopId: ids.shopId }, token),
    ).resolves.toMatchObject({
      success: true,
      data: {
        status: "cancelled",
        revision: 1,
        customer: { name: "Walk-in Wanda", email: null },
        startAt: START_AT,
        endAt: END_AT,
      },
    });
  });

  it("rolls back the cancellation when its notification work cannot be persisted", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    const before = (
      await database.pool.query(
        `SELECT occupancy_id,revision,(SELECT count(*)::int FROM notification_work w WHERE w.booking_id=b.id) AS work FROM bookings b WHERE b.id=$1`,
        [booking.bookingId],
      )
    ).rows[0];
    const suffix = randomUUID().replaceAll("-", "");
    const fn = `reject_customer_cancel_work_${suffix}`;
    const trigger = `reject_customer_cancel_work_trigger_${suffix}`;
    await database.pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.booking_id = '${booking.bookingId}'::uuid AND NEW.kind = 'owner_cancellation' THEN RAISE EXCEPTION 'forced work failure'; END IF; RETURN NEW; END $$`,
    );
    await database.pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON notification_work FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    try {
      const receipt = await cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(booking.token),
      );
      expect(receipt).toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE" },
      });
      const state = (
        await database.pool.query(
          `SELECT b.status,b.revision,b.occupancy_id,b.start_at,b.end_at,
            (SELECT count(*)::int FROM booking_changes c WHERE c.booking_id=b.id) AS changes,
            (SELECT count(*)::int FROM notification_work w WHERE w.booking_id=b.id) AS work,
            (SELECT count(*)::int FROM occupied_intervals i WHERE i.id=b.occupancy_id AND i.start_at='2026-11-02T10:00:00Z' AND i.end_at='2026-11-02T10:30:00Z') AS original_occupancy
          FROM bookings b WHERE b.id=$1`,
          [booking.bookingId],
        )
      ).rows[0];
      expect(state).toMatchObject({
        status: "confirmed",
        revision: 0,
        occupancy_id: before.occupancy_id,
        start_at: new Date(START_AT),
        end_at: new Date(END_AT),
        changes: 0,
        work: before.work,
        original_occupancy: 1,
      });
      await expect(
        getManagedBooking({ shopId: ids.shopId }, booking.token),
      ).resolves.toMatchObject({
        success: true,
        data: { status: "confirmed", revision: 0 },
      });
    } finally {
      await database.pool.query(`DROP TRIGGER ${trigger} ON notification_work`);
      await database.pool.query(`DROP FUNCTION ${fn}()`);
    }
  });

  it("cancels at exact twelve-hour cutoff equality", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    vi.setSystemTime(new Date("2026-11-01T22:00:00.000Z"));
    const receipt = await cancelCustomerBooking(
      { shopId: ids.shopId },
      cancellationInput(booking.token),
    );
    expect(receipt).toMatchObject({
      success: true,
      data: {
        bookingId: booking.bookingId,
        status: "cancelled",
        operation: {
          revision: 1,
          committedAt: "2026-11-01T22:00:00.000Z",
        },
      },
    });
    await expect(
      getManagedBooking({ shopId: ids.shopId }, booking.token),
    ).resolves.toMatchObject({
      success: true,
      data: { status: "cancelled", revision: 1 },
    });
  });

  it("cancels one millisecond before the cutoff boundary closes", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    vi.setSystemTime(new Date("2026-11-01T21:59:59.999Z"));
    const receipt = await cancelCustomerBooking(
      { shopId: ids.shopId },
      cancellationInput(booking.token),
    );
    expect(receipt).toMatchObject({
      success: true,
      data: {
        status: "cancelled",
        operation: { revision: 1 },
      },
    });
  });

  it("rejects one millisecond after the cutoff boundary closes", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    const before = await bookingState(booking.bookingId, null);
    expect(before.occupancy_id).not.toBeNull();
    vi.setSystemTime(new Date("2026-11-01T22:00:00.001Z"));
    const receipt = await cancelCustomerBooking(
      { shopId: ids.shopId },
      cancellationInput(booking.token),
    );
    expect(receipt).toEqual({
      success: false,
      error: {
        code: "CUTOFF_PASSED",
        message:
          "This appointment is inside the change window. Contact the shop.",
      },
    });
    await expect(
      bookingState(booking.bookingId, before.occupancy_id),
    ).resolves.toMatchObject({
      status: "confirmed",
      revision: 0,
      occupancy_id: before.occupancy_id,
      start_at: new Date(START_AT),
      end_at: new Date(END_AT),
      original_occupancy: 1,
      changes: 0,
      work: before.work,
    });
  });

  it("uses elapsed cutoff time across a daylight-saving transition", async () => {
    vi.setSystemTime(new Date("2026-11-01T03:00:00.000Z"));
    const ids = await fixture({ timeZone: "America/New_York" });
    const booking = await createBooking(ids, {
      startAt: "2026-11-01T15:00:00.000Z",
    });
    const receipt = await cancelCustomerBooking(
      { shopId: ids.shopId },
      cancellationInput(booking.token),
    );
    expect(receipt).toMatchObject({
      success: true,
      data: {
        bookingId: booking.bookingId,
        status: "cancelled",
        operation: {
          revision: 1,
          committedAt: "2026-11-01T03:00:00.000Z",
        },
      },
    });
  });

  it("rejects past and already-cancelled appointments without cutoff or authority changes", async () => {
    const pastIds = await fixture();
    const pastBooking = await createBooking(pastIds);
    const pastBefore = await bookingState(pastBooking.bookingId, null);
    vi.setSystemTime(new Date("2026-11-02T11:00:00.000Z"));
    await expect(
      cancelCustomerBooking(
        { shopId: pastIds.shopId },
        cancellationInput(pastBooking.token),
      ),
    ).resolves.toEqual({
      success: false,
      error: {
        code: "CUTOFF_PASSED",
        message:
          "This appointment is inside the change window. Contact the shop.",
      },
    });
    await expect(
      bookingState(pastBooking.bookingId, pastBefore.occupancy_id),
    ).resolves.toMatchObject({
      status: "confirmed",
      revision: 0,
      occupancy_id: pastBefore.occupancy_id,
      original_occupancy: 1,
      changes: 0,
      work: pastBefore.work,
    });

    vi.setSystemTime(new Date(NOW));
    const cancelledIds = await fixture();
    const cancelledBooking = await createBooking(cancelledIds);
    const first = await cancelCustomerBooking(
      { shopId: cancelledIds.shopId },
      cancellationInput(cancelledBooking.token),
    );
    expect(first).toMatchObject({
      success: true,
      data: { status: "cancelled", operation: { revision: 1 } },
    });
    const afterFirst = await bookingState(cancelledBooking.bookingId, null);
    await expect(
      cancelCustomerBooking(
        { shopId: cancelledIds.shopId },
        cancellationInput(cancelledBooking.token, { expectedRevision: 1 }),
      ),
    ).resolves.toEqual({
      success: false,
      error: {
        code: "INVALID_STATE",
        message: "This appointment can no longer be cancelled.",
      },
    });
    await expect(
      bookingState(cancelledBooking.bookingId, null),
    ).resolves.toMatchObject({
      status: "cancelled",
      revision: 1,
      occupancy_id: null,
      original_occupancy: 0,
      changes: 1,
      work: afterFirst.work,
    });
  });

  it("returns generic authority denials for unusable capabilities", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    const otherShop = await fixture();
    const before = await bookingState(booking.bookingId, null);
    const generic = {
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    };
    const deny = (shopId: string | null, token: string) =>
      cancelCustomerBooking(
        shopId ? { shopId } : null,
        cancellationInput(token),
      );

    await expect(deny(null, booking.token)).resolves.toEqual(generic);
    await expect(deny(otherShop.shopId, booking.token)).resolves.toEqual(
      generic,
    );
    await expect(
      deny(ids.shopId, randomBytes(32).toString("base64url")),
    ).resolves.toEqual(generic);

    await database.pool.query(
      "UPDATE bookings SET capability_revoked_at='2026-11-01T08:00:00Z' WHERE id=$1",
      [booking.bookingId],
    );
    await expect(deny(ids.shopId, booking.token)).resolves.toEqual(generic);
    await expect(
      bookingState(booking.bookingId, before.occupancy_id),
    ).resolves.toMatchObject({
      status: "confirmed",
      revision: 0,
      occupancy_id: before.occupancy_id,
      original_occupancy: 1,
      changes: 0,
      work: before.work,
    });

    const expiring = await fixture();
    const expiringBooking = await createBooking(expiring);
    vi.setSystemTime(new Date("2026-11-09T10:30:00.000Z"));
    await expect(deny(expiring.shopId, expiringBooking.token)).resolves.toEqual(
      generic,
    );
    await expect(
      getManagedBooking({ shopId: expiring.shopId }, expiringBooking.token),
    ).resolves.toEqual(generic);

    await database.pool.query("DELETE FROM bookings WHERE id=$1", [
      booking.bookingId,
    ]);
    await expect(deny(ids.shopId, booking.token)).resolves.toEqual(generic);
  });

  it("enforces the retained link expiry authority boundary for management reads", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    const before = await bookingState(booking.bookingId, null);
    const unavailable = {
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    };
    vi.setSystemTime(new Date("2026-11-09T10:29:59.999Z"));
    await expect(
      getManagedBooking({ shopId: ids.shopId }, booking.token),
    ).resolves.toMatchObject({
      success: true,
      data: {
        status: "confirmed",
        revision: 0,
        startAt: START_AT,
        endAt: END_AT,
        past: true,
        changeCutoffPassed: true,
      },
    });

    vi.setSystemTime(new Date("2026-11-09T10:30:00.000Z"));
    await expect(
      getManagedBooking({ shopId: ids.shopId }, booking.token),
    ).resolves.toEqual(unavailable);

    await expect(
      bookingState(booking.bookingId, before.occupancy_id),
    ).resolves.toMatchObject({
      status: "confirmed",
      revision: 0,
      occupancy_id: before.occupancy_id,
      original_occupancy: 1,
      changes: 0,
      work: before.work,
    });
  });

  it("cancels an eligible booking after the shop is unpublished", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    await expect(
      setOwnShopPublication(ids.context, {
        published: false,
        expectedPublished: true,
      }),
    ).resolves.toMatchObject({ success: true, data: { published: false } });
    await expect(
      getManagedBooking({ shopId: ids.shopId }, booking.token),
    ).resolves.toMatchObject({
      success: true,
      data: { status: "confirmed", revision: 0 },
    });

    const receipt = await cancelCustomerBooking(
      { shopId: ids.shopId },
      cancellationInput(booking.token),
    );
    expect(receipt).toMatchObject({
      success: true,
      data: { status: "cancelled", operation: { revision: 1 } },
    });
    await expect(
      getManagedBooking({ shopId: ids.shopId }, booking.token),
    ).resolves.toMatchObject({
      success: true,
      data: {
        status: "cancelled",
        revision: 1,
        startAt: START_AT,
        endAt: END_AT,
      },
    });
  });

  it("cancels an eligible booking after its saved service is unpublished from the catalog", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    await expect(
      setServiceOffered(ids.context, { id: ids.serviceId, offered: false }),
    ).resolves.toMatchObject({ success: true, data: { offered: false } });
    const saved = (
      await database.pool.query(
        "SELECT service_name FROM bookings WHERE id=$1",
        [booking.bookingId],
      )
    ).rows[0];
    expect(saved.service_name).toBe("Cut");

    await expect(
      getManagedBooking({ shopId: ids.shopId }, booking.token),
    ).resolves.toMatchObject({
      success: true,
      data: { status: "confirmed", service: { name: "Cut" } },
    });
    const receipt = await cancelCustomerBooking(
      { shopId: ids.shopId },
      cancellationInput(booking.token),
    );
    expect(receipt).toMatchObject({
      success: true,
      data: { status: "cancelled", operation: { revision: 1 } },
    });
    await expect(
      getManagedBooking({ shopId: ids.shopId }, booking.token),
    ).resolves.toMatchObject({
      success: true,
      data: {
        status: "cancelled",
        revision: 1,
        service: { name: "Cut" },
        startAt: START_AT,
        endAt: END_AT,
      },
    });
  });

  it("samples transaction time after acquiring the shop lock", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    const before = await bookingState(booking.bookingId, null);
    vi.setSystemTime(new Date("2026-11-01T22:00:00.000Z"));

    const lock = await database.pool.connect();
    let transactionOpen = true;
    let request: ReturnType<typeof cancelCustomerBooking> | undefined;
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
        ids.shopId,
      ]);
      request = cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(booking.token),
      );
      await waitForBlockedCancellation(lock);
      vi.setSystemTime(new Date("2026-11-01T22:00:00.001Z"));
      await lock.query("COMMIT");
      transactionOpen = false;
      await expect(request).resolves.toEqual({
        success: false,
        error: {
          code: "CUTOFF_PASSED",
          message:
            "This appointment is inside the change window. Contact the shop.",
        },
      });
    } finally {
      if (transactionOpen) await lock.query("ROLLBACK");
      await request?.catch(() => undefined);
      lock.release();
    }

    await expect(
      bookingState(booking.bookingId, before.occupancy_id),
    ).resolves.toMatchObject({
      status: "confirmed",
      revision: 0,
      occupancy_id: before.occupancy_id,
      original_occupancy: 1,
      changes: 0,
      work: before.work,
    });
  }, 15_000);

  it("denies cancellation when revocation commits while the shop lock is held", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    const before = await bookingState(booking.bookingId, null);
    const unavailable = {
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    };

    const lock = await database.pool.connect();
    let transactionOpen = true;
    let request: ReturnType<typeof cancelCustomerBooking> | undefined;
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
        ids.shopId,
      ]);
      await lock.query(
        "UPDATE bookings SET capability_revoked_at='2026-11-01T08:30:00Z' WHERE id=$1",
        [booking.bookingId],
      );
      request = cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(booking.token),
      );
      await waitForBlockedCancellation(lock);
      await lock.query("COMMIT");
      transactionOpen = false;
      await expect(request).resolves.toEqual(unavailable);
    } finally {
      if (transactionOpen) await lock.query("ROLLBACK");
      await request?.catch(() => undefined);
      lock.release();
    }

    await expect(
      bookingState(booking.bookingId, before.occupancy_id),
    ).resolves.toMatchObject({
      status: "confirmed",
      revision: 0,
      occupancy_id: before.occupancy_id,
      original_occupancy: 1,
      changes: 0,
      work: before.work,
    });
    await expect(
      getManagedBooking({ shopId: ids.shopId }, booking.token),
    ).resolves.toEqual(unavailable);
  }, 15_000);

  it("prevents reads and repeats after revocation of a committed cancellation", async () => {
    const ids = await fixture();
    const booking = await createBooking(ids);
    const before = await bookingState(booking.bookingId, null);
    const operationKey = randomBytes(32).toString("base64url");
    const receipt = await cancelCustomerBooking(
      { shopId: ids.shopId },
      cancellationInput(booking.token, { operationKey }),
    );
    expect(receipt).toMatchObject({
      success: true,
      data: { status: "cancelled", operation: { revision: 1 } },
    });
    const afterFirst = await bookingState(booking.bookingId, null);
    expect(afterFirst).toMatchObject({
      status: "cancelled",
      revision: 1,
      changes: 1,
      original_occupancy: 0,
    });
    expect(afterFirst.work).toBe(before.work + 2);

    await database.pool.query(
      "UPDATE bookings SET capability_revoked_at='2026-11-01T08:30:00Z' WHERE id=$1",
      [booking.bookingId],
    );
    const unavailable = {
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    };
    await expect(
      getManagedBooking({ shopId: ids.shopId }, booking.token),
    ).resolves.toEqual(unavailable);
    await expect(
      cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(booking.token, { operationKey }),
      ),
    ).resolves.toEqual(unavailable);
    await expect(
      cancelCustomerBooking(
        { shopId: ids.shopId },
        cancellationInput(booking.token, { expectedRevision: 1 }),
      ),
    ).resolves.toEqual(unavailable);
    await expect(bookingState(booking.bookingId, null)).resolves.toMatchObject({
      status: "cancelled",
      revision: 1,
      occupancy_id: null,
      original_occupancy: 0,
      changes: 1,
      work: afterFirst.work,
    });
  });
});
