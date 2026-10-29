import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import { openTestDatabase } from "@/tests/support/database";
import {
  readLockWaiters,
  waitForLockWaiters,
  type RequestIdentity,
} from "@/tests/support/database-locks";
import {
  createRateKeyTracker,
  trackCreateEmailRateKey,
} from "@/tests/support/rate-keys";
import { shopInput } from "@/tests/support/shops";
import { calculateSlots } from "@/features/availability/slots";

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
  let saveBarberSchedule: typeof import("@/features/availability/mutations").saveBarberSchedule;
  let saveShopDateSchedule: typeof import("@/features/availability/mutations").saveShopDateSchedule;
  let saveBarberDateSchedule: typeof import("@/features/availability/mutations").saveBarberDateSchedule;
  let createTimeBlock: typeof import("@/features/availability/mutations").createTimeBlock;
  let setOwnShopPublication: typeof import("@/features/shops/mutations").setOwnShopPublication;
  let updateOwnShop: typeof import("@/features/shops/mutations").updateOwnShop;
  let createPublicBooking: typeof import("../mutations").createPublicBooking;
  let createOwnerBooking: typeof import("../mutations").createOwnerBooking;
  let getOwnCalendar: typeof import("../queries").getOwnCalendar;
  let getOwnAppointment: typeof import("../queries").getOwnAppointment;
  let getOwnNotificationActivity: typeof import("@/features/notifications/queries").getOwnNotificationActivity;
  const ownerIds: string[] = [];
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
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T08:00:00Z"));
    ({ testAuth } = await import("@/tests/support/auth"));
    ({ readOwnerContext } = await import("@/server/owner-context"));
    ({ createShop, setOwnShopPublication, updateOwnShop } =
      await import("@/features/shops/mutations"));
    ({ saveBarber } = await import("@/features/barbers/mutations"));
    ({ archiveBarber } = await import("@/features/barbers/mutations"));
    ({ saveService, archiveService } =
      await import("@/features/catalog/mutations"));
    ({
      saveShopSchedule,
      saveBarberSchedule,
      saveShopDateSchedule,
      saveBarberDateSchedule,
      createTimeBlock,
    } = await import("@/features/availability/mutations"));
    const mutations = await import("../mutations");
    createPublicBooking = (context, input) => {
      trackCreateEmailRateKey(rateKeys, context, input);
      return mutations.createPublicBooking(context, input);
    };
    ({ createOwnerBooking } = mutations);
    ({ getOwnCalendar, getOwnAppointment } = await import("../queries"));
    ({ getOwnNotificationActivity } =
      await import("@/features/notifications/queries"));
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

  async function fixture(published = true, timeZone = "UTC") {
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

  function moveInput(
    ids: Awaited<ReturnType<typeof fixture>>,
    bookingId: string,
    changes: Record<string, unknown> = {},
  ) {
    return {
      bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T11:07:00.000Z",
      reviewedOffer: {
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: "30",
      },
      ...changes,
    };
  }

  async function expectOwnerBookingUnmoved(bookingId: string) {
    const state = await database.pool.query(
      `SELECT b.status,b.revision,b.start_at,b.end_at,
        (SELECT count(*)::int FROM occupied_intervals i WHERE i.id=b.occupancy_id AND i.start_at='2026-11-02T10:00:00Z' AND i.end_at='2026-11-02T10:30:00Z') AS original_occupancy,
        (SELECT count(*)::int FROM booking_changes c WHERE c.booking_id=b.id) AS changes,
        (SELECT count(*)::int FROM notification_work w WHERE w.booking_id=b.id AND w.kind='customer_move') AS update_work
       FROM bookings b WHERE b.id=$1`,
      [bookingId],
    );
    expect(state.rows[0]).toMatchObject({
      status: "confirmed",
      revision: 0,
      start_at: new Date("2026-11-02T10:00:00Z"),
      end_at: new Date("2026-11-02T10:30:00Z"),
      original_occupancy: 1,
      changes: 0,
      update_work: 0,
    });
  }

  async function queueShopOperations<First, Second>(
    shopId: string,
    firstOperation: () => Promise<First>,
    secondOperation: () => Promise<Second>,
    identities?: [RequestIdentity, RequestIdentity],
  ): Promise<[First, Second]> {
    const locker = await database.pool.connect();
    await locker.query("BEGIN");
    await locker.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [shopId]);
    try {
      const first = firstOperation();
      await waitForLockWaiters(
        database.pool,
        locker,
        1,
        identities ? [identities[0]] : undefined,
        { description: "first queued booking operation" },
      );
      const second = secondOperation();
      await waitForLockWaiters(database.pool, locker, 2, identities, {
        description: "second queued booking operation",
      });
      await locker.query("COMMIT");
      return await Promise.all([first, second]);
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined);
      locker.release();
    }
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
        notifications: {
          email: {
            status: "unavailable",
            reason: "email_unavailable",
            updatedAt: expect.any(String),
          },
          whatsapp: "unavailable",
        },
      },
    });
    if (!created.success) return;
    await expect(
      getOwnCalendar(ids.context, { date: "2026-11-02", view: "day" }),
    ).resolves.toMatchObject({
      success: true,
      data: {
        timeZone: "UTC",
        appointments: [
          {
            id: created.data.bookingId,
            service: { name: "Cut", priceUsd: "25.00", durationMinutes: 30 },
            barber: { name: "Sam" },
            customer: { name: "Ada Lovelace" },
          },
        ],
      },
    });
    await expect(
      getOwnAppointment(ids.context, created.data.bookingId),
    ).resolves.toMatchObject({
      success: true,
      data: {
        id: created.data.bookingId,
        customer: { name: "Ada Lovelace", email: "ada@example.test" },
      },
    });
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

  it("keeps the first shop zone lock and source channels across public and owner creation", async () => {
    const ids = await fixture();
    const publicResult = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    expect(publicResult).toMatchObject({ success: true });
    if (!publicResult.success) return;
    const firstLock = (
      await database.pool.query(
        "SELECT time_zone_locked_at FROM shops WHERE id=$1",
        [ids.shopId],
      )
    ).rows[0].time_zone_locked_at as Date;

    vi.setSystemTime(new Date("2026-11-02T09:00:00Z"));
    const ownerResult = await createOwnerBooking(ids.context, {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T11:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: { name: "Walk-in Guest", whatsappOptIn: false },
      recoveryKey: randomBytes(32).toString("base64url"),
    });
    expect(ownerResult).toMatchObject({ success: true });
    if (!ownerResult.success) return;

    const state = await database.pool.query(
      `SELECT
        (SELECT creation_source FROM bookings WHERE id=$1) AS public_source,
        (SELECT creation_source FROM bookings WHERE id=$2) AS owner_source,
        (SELECT time_zone_locked_at FROM shops WHERE id=$3) AS locked,
        (SELECT count(*)::int FROM notification_work WHERE booking_id=$1 AND kind='owner_alert') AS public_owner_alerts,
        (SELECT count(*)::int FROM notification_work WHERE booking_id=$2 AND kind='owner_alert') AS owner_owner_alerts,
        (SELECT count(*)::int FROM notification_work WHERE booking_id=$1) AS public_work,
        (SELECT count(*)::int FROM notification_work WHERE booking_id=$2) AS owner_work`,
      [publicResult.data.bookingId, ownerResult.data.bookingId, ids.shopId],
    );
    expect(state.rows[0]).toEqual({
      public_source: "public",
      owner_source: "owner",
      locked: firstLock,
      public_owner_alerts: 1,
      owner_owner_alerts: 0,
      public_work: 2,
      owner_work: 1,
    });
  });

  it("rolls back public reservation intent and zone lock when work persistence fails", async () => {
    const ids = await fixture();
    const suffix = randomUUID().replaceAll("-", "");
    const fn = `public_creation_reject_${suffix}`;
    const trigger = `public_creation_reject_${suffix}`;
    expect(ids.shopId).toMatch(/^[a-zA-Z0-9-]+$/);
    await database.pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM bookings b WHERE b.id = NEW.booking_id AND b.shop_id = '${ids.shopId}') THEN RAISE EXCEPTION 'public creation failure'; END IF; RETURN NEW; END; $$`,
    );
    await database.pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON notification_work FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    try {
      await expect(
        createPublicBooking({ shopId: ids.shopId }, input(ids)),
      ).resolves.toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE" },
      });
      const state = await database.pool.query(
        `SELECT
        (SELECT count(*)::int FROM bookings WHERE shop_id=$1) AS bookings,
        (SELECT count(*)::int FROM occupied_intervals WHERE shop_id=$1) AS occupancy,
        (SELECT count(*)::int FROM notification_work w JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1) AS work,
        (SELECT time_zone_locked_at FROM shops WHERE id=$1) AS locked`,
        [ids.shopId],
      );
      expect(state.rows[0]).toEqual({
        bookings: 0,
        occupancy: 0,
        work: 0,
        locked: null,
      });
    } finally {
      await database.pool.query(
        `DROP TRIGGER IF EXISTS ${trigger} ON notification_work`,
      );
      await database.pool.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
  });

  it("public creation replays only an identical request and keeps one reservation", async () => {
    const ids = await fixture();
    const payload = input(ids);
    const created = await createPublicBooking({ shopId: ids.shopId }, payload);
    if (!created.success) throw new Error("Booking fixture failed.");

    await expect(
      createPublicBooking(
        { shopId: ids.shopId },
        {
          ...payload,
          contact: { ...payload.contact, name: "Changed Guest" },
        },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });
    await expect(
      createPublicBooking({ shopId: ids.shopId }, payload),
    ).resolves.toEqual(created);

    const counts = await database.pool.query(
      `SELECT
        (SELECT count(*)::int FROM bookings WHERE shop_id=$1) AS bookings,
        (SELECT count(*)::int FROM occupied_intervals WHERE shop_id=$1) AS occupancy,
        (SELECT count(*)::int FROM notification_work w JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1) AS work,
        (SELECT count(*)::int FROM public_rate_events e WHERE e.scope='create_email_shop' AND e.key_hash=$2) AS rate_events`,
      [
        ids.shopId,
        createHash("sha256")
          .update(`${ids.shopId}:ada@example.test`)
          .digest("hex"),
      ],
    );
    expect(counts.rows[0]).toMatchObject({
      bookings: 1,
      occupancy: 1,
      work: 2,
      rate_events: 1,
    });
  });

  it("public creation rejects a revoked replay without creating another booking", async () => {
    const ids = await fixture();
    const payload = input(ids);
    const created = await createPublicBooking({ shopId: ids.shopId }, payload);
    if (!created.success) throw new Error("Booking fixture failed.");
    await database.pool.query(
      "UPDATE bookings SET capability_revoked_at=$2 WHERE id=$1",
      [created.data.bookingId, new Date("2026-11-02T08:00:00Z")],
    );

    await expect(
      createPublicBooking({ shopId: ids.shopId }, payload),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM bookings WHERE shop_id=$1",
          [ids.shopId],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("public creation rejects an expired replay without creating another booking", async () => {
    const ids = await fixture();
    const payload = input(ids);
    const created = await createPublicBooking({ shopId: ids.shopId }, payload);
    if (!created.success) throw new Error("Booking fixture failed.");
    await database.pool.query(
      "UPDATE bookings SET start_at='2026-10-20T10:00:00Z', end_at='2026-10-20T10:30:00Z' WHERE id=$1",
      [created.data.bookingId],
    );

    await expect(
      createPublicBooking({ shopId: ids.shopId }, payload),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM bookings WHERE shop_id=$1",
          [ids.shopId],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it.each(["hidden", "archived", "unassigned", "foreign"] as const)(
    "public creation rejects a %s catalog offer without writing",
    async (state) => {
      const ids = await fixture();
      let candidate = ids;
      if (state === "hidden")
        await database.pool.query(
          "UPDATE services SET offered=false WHERE id=$1",
          [ids.serviceId],
        );
      if (state === "archived")
        await database.pool.query(
          "UPDATE services SET archived=true WHERE id=$1",
          [ids.serviceId],
        );
      if (state === "unassigned")
        await database.pool.query(
          "DELETE FROM barber_services WHERE shop_id=$1 AND barber_id=$2 AND service_id=$3",
          [ids.shopId, ids.barberId, ids.serviceId],
        );
      if (state === "foreign") candidate = await fixture();

      const result = await createPublicBooking(
        { shopId: ids.shopId },
        input(candidate),
      );
      expect(result).toMatchObject({
        success: false,
        error: { code: "STALE_OFFER" },
      });
      if (state === "foreign")
        expect(JSON.stringify(result)).not.toContain(candidate.shopId);
      const counts = await database.pool.query(
        `SELECT
          (SELECT count(*)::int FROM bookings WHERE shop_id=$1) AS bookings,
          (SELECT count(*)::int FROM occupied_intervals WHERE shop_id=$1) AS occupancy,
          (SELECT count(*)::int FROM notification_work w JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1) AS work`,
        [ids.shopId],
      );
      expect(counts.rows[0]).toMatchObject({
        bookings: 0,
        occupancy: 0,
        work: 0,
      });
    },
  );

  it("owner cancellation retains the saved appointment details", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    expect(created.success).toBe(true);
    if (!created.success) throw new Error("Booking fixture failed.");

    const { cancelOwnerBooking } = await import("../mutations");
    const result = await cancelOwnerBooking(ids.context, {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    });

    expect(result).toMatchObject({
      success: true,
      data: { bookingId: created.data.bookingId },
    });
    await expect(
      getOwnAppointment(ids.context, created.data.bookingId),
    ).resolves.toMatchObject({
      success: true,
      data: {
        id: created.data.bookingId,
        status: "cancelled",
        startAt: "2026-11-02T10:00:00.000Z",
        endAt: "2026-11-02T10:30:00.000Z",
        service: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: 30,
        },
        customer: { name: "Ada Lovelace" },
      },
    });
  });

  it("owner cancellation releases the appointment interval", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { cancelOwnerBooking } = await import("../mutations");
    const cancelled = await cancelOwnerBooking(ids.context, {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    });
    expect(cancelled.success).toBe(true);
    const replacement = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    expect(replacement.success).toBe(true);
    await expect(
      getOwnAppointment(ids.context, created.data.bookingId),
    ).resolves.toMatchObject({ success: true, data: { status: "cancelled" } });
  });

  it("the existing manage link reads retained cancelled details", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { cancelOwnerBooking } = await import("../mutations");
    const cancelled = await cancelOwnerBooking(ids.context, {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    });
    expect(cancelled.success).toBe(true);
    const token = new URL(created.data.manageUrl).pathname.split("/").at(-1)!;
    const { getManagedBooking } = await import("../queries");
    await expect(
      getManagedBooking({ shopId: ids.shopId }, token),
    ).resolves.toMatchObject({
      success: true,
      data: {
        status: "cancelled",
        service: { name: "Cut", priceUsd: "25.00", durationMinutes: 30 },
        customer: { name: "Ada Lovelace" },
      },
    });
  });

  it("owner cancellation does not unlock the shop time zone", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { cancelOwnerBooking } = await import("../mutations");
    const cancelled = await cancelOwnerBooking(ids.context, {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    });
    expect(cancelled.success).toBe(true);
    const timezone = await updateOwnShop(ids.context, {
      name: "Juniper Barber",
      publicContact: "Call 202-555-0142",
      timeZone: "Europe/Paris",
    });
    expect(timezone).toMatchObject({
      success: false,
      error: { code: "TIME_ZONE_LOCKED" },
    });
  });

  it("owner cancellation rejects foreign and signed-out callers without side effects", async () => {
    const own = await fixture();
    const foreign = await fixture();
    const created = await createPublicBooking(
      { shopId: own.shopId },
      input(own),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { cancelOwnerBooking } = await import("../mutations");
    const request = {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    };
    const beforeCounts = await database.pool.query(
      "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1",
      [created.data.bookingId],
    );
    expect(await cancelOwnerBooking(foreign.context, request)).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
    });
    expect(
      await cancelOwnerBooking(own.context, {
        ...request,
        bookingId: randomUUID(),
      }),
    ).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    expect(await cancelOwnerBooking(null, request)).toMatchObject({
      success: false,
      error: { code: "UNAUTHENTICATED" },
    });
    await expect(
      getOwnAppointment(own.context, created.data.bookingId),
    ).resolves.toMatchObject({ success: true, data: { status: "confirmed" } });
    const counts = await database.pool.query(
      "SELECT (SELECT count(*)::int FROM booking_changes WHERE booking_id=$1) AS changes, (SELECT count(*)::int FROM notification_work WHERE booking_id=$1) AS work",
      [created.data.bookingId],
    );
    expect(counts.rows[0]).toMatchObject({
      changes: 0,
      work: beforeCounts.rows[0].count,
    });
  });

  it("owner cancellation rolls back when customer work cannot be persisted", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { cancelOwnerBooking } = await import("../mutations");
    const suffix = randomUUID().replaceAll("-", "");
    const fn = `reject_cancel_work_${suffix}`;
    const trigger = `reject_cancel_work_trigger_${suffix}`;
    await database.pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'customer_cancellation' THEN RAISE EXCEPTION 'forced work failure'; END IF; RETURN NEW; END $$`,
    );
    await database.pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON notification_work FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    const workBefore = await database.pool.query(
      "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1",
      [created.data.bookingId],
    );
    try {
      const result = await cancelOwnerBooking(ids.context, {
        bookingId: created.data.bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
      });
      expect(result).toMatchObject({ success: false });
      const state = await database.pool.query(
        "SELECT b.status,b.revision,b.occupancy_id,(SELECT count(*)::int FROM occupied_intervals i WHERE i.id=b.occupancy_id) AS occupied,(SELECT count(*)::int FROM booking_changes c WHERE c.booking_id=b.id) AS changes,(SELECT count(*)::int FROM notification_work w WHERE w.booking_id=b.id) AS work FROM bookings b WHERE b.id=$1",
        [created.data.bookingId],
      );
      expect(state.rows[0]).toMatchObject({
        status: "confirmed",
        revision: 0,
        occupied: 1,
        changes: 0,
      });
      expect(state.rows[0].work).toBe(workBefore.rows[0].count);
    } finally {
      await database.pool.query(`DROP TRIGGER ${trigger} ON notification_work`);
      await database.pool.query(`DROP FUNCTION ${fn}()`);
    }
  });

  it("the existing manage link expires at equality after cancellation", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { cancelOwnerBooking } = await import("../mutations");
    const cancelled = await cancelOwnerBooking(ids.context, {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    });
    expect(cancelled.success).toBe(true);
    const token = new URL(created.data.manageUrl).pathname.split("/").at(-1)!;
    const { getManagedBooking } = await import("../queries");
    vi.setSystemTime(new Date("2026-11-09T10:29:59.999Z"));
    await expect(
      getManagedBooking({ shopId: ids.shopId }, token),
    ).resolves.toMatchObject({ success: true });
    vi.setSystemTime(new Date("2026-11-09T10:30:00Z"));
    await expect(
      getManagedBooking({ shopId: ids.shopId }, token),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE" },
    });
  });

  it("owner lifecycle cancellation allows an ongoing appointment", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    vi.setSystemTime(new Date("2026-11-02T10:07:00Z"));
    const { cancelOwnerBooking } = await import("../mutations");
    const result = await cancelOwnerBooking(ids.context, {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    });
    expect(result).toMatchObject({
      success: true,
      data: { appointment: { status: "cancelled", revision: 1 } },
    });
  });

  it.each([
    ["2026-11-02T10:29:59.999Z", true],
    ["2026-11-02T10:30:00.000Z", false],
    ["2026-11-02T10:30:00.001Z", false],
  ] as const)(
    "owner lifecycle cancellation at %s follows the existing end boundary",
    async (now, allowed) => {
      const ids = await fixture();
      const created = await createPublicBooking(
        { shopId: ids.shopId },
        input(ids),
      );
      if (!created.success) throw new Error("Booking fixture failed.");
      vi.setSystemTime(new Date(now));
      const { cancelOwnerBooking } = await import("../mutations");
      const result = await cancelOwnerBooking(ids.context, {
        bookingId: created.data.bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
      });
      expect(result.success).toBe(allowed);
      if (!allowed)
        expect(result).toMatchObject({
          success: false,
          error: { code: "INVALID_STATE" },
        });
      await expect(
        getOwnAppointment(ids.context, created.data.bookingId),
      ).resolves.toMatchObject({
        success: true,
        data: {
          status: allowed ? "cancelled" : "confirmed",
          revision: allowed ? 1 : 0,
        },
      });
    },
  );

  it("owner lifecycle cancellation samples time after acquiring the shop lock", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { cancelOwnerBooking } = await import("../mutations");
    const locker = await database.pool.connect();
    await locker.query("BEGIN");
    await locker.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
      ids.shopId,
    ]);
    const request = cancelOwnerBooking(ids.context, {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    });
    try {
      await waitForLockWaiters(database.pool, locker, 1, ["owner_cancel"], {
        description: "owner cancellation",
      });
      vi.setSystemTime(new Date("2026-11-02T10:30:00Z"));
      await locker.query("COMMIT");
      await expect(request).resolves.toMatchObject({
        success: false,
        error: { code: "INVALID_STATE" },
      });
      await expect(
        getOwnAppointment(ids.context, created.data.bookingId),
      ).resolves.toMatchObject({
        success: true,
        data: { status: "confirmed", revision: 0 },
      });
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined);
      locker.release();
    }
  });

  it("owner lifecycle rejects a new cancellation for an already cancelled booking", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { cancelOwnerBooking } = await import("../mutations");
    const first = await cancelOwnerBooking(ids.context, {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    });
    expect(first.success).toBe(true);
    const before = await database.pool.query(
      "SELECT revision,(SELECT count(*)::int FROM booking_changes WHERE booking_id=$1) AS changes,(SELECT count(*)::int FROM notification_work WHERE booking_id=$1) AS work FROM bookings WHERE id=$1",
      [created.data.bookingId],
    );
    const second = await cancelOwnerBooking(ids.context, {
      bookingId: created.data.bookingId,
      expectedRevision: 1,
      operationKey: randomBytes(32).toString("base64url"),
    });
    expect(second).toMatchObject({
      success: false,
      error: { code: "INVALID_STATE" },
    });
    const after = await database.pool.query(
      "SELECT revision,(SELECT count(*)::int FROM booking_changes WHERE booking_id=$1) AS changes,(SELECT count(*)::int FROM notification_work WHERE booking_id=$1) AS work FROM bookings WHERE id=$1",
      [created.data.bookingId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("owner lifecycle rejects the stale winner after competing revision-zero cancellations", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { cancelOwnerBooking } = await import("../mutations");
    const [first, second] = await Promise.all(
      [0, 1].map(() =>
        cancelOwnerBooking(ids.context, {
          bookingId: created.data.bookingId,
          expectedRevision: 0,
          operationKey: randomBytes(32).toString("base64url"),
        }),
      ),
    );
    expect([first.success, second.success].filter(Boolean)).toHaveLength(1);
    expect([first, second].filter((result) => !result.success)).toMatchObject([
      { success: false, error: { code: "STALE_BOOKING" } },
    ]);
    const persisted = await database.pool.query(
      "SELECT revision,(SELECT count(*)::int FROM booking_changes WHERE booking_id=$1) AS changes,(SELECT count(*)::int FROM notification_work WHERE booking_id=$1 AND kind='customer_cancellation') AS updates FROM bookings WHERE id=$1",
      [created.data.bookingId],
    );
    expect(persisted.rows[0]).toMatchObject({
      revision: 1,
      changes: 1,
      updates: 1,
    });
  });

  it("owner lifecycle recovers one concurrent and repeated identical cancellation", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { cancelOwnerBooking } = await import("../mutations");
    const request = {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    };
    const [first, second] = await Promise.all([
      cancelOwnerBooking(ids.context, request),
      cancelOwnerBooking(ids.context, request),
    ]);
    expect(first.success).toBe(true);
    expect(second).toMatchObject({ success: true });
    if (!first.success || !second.success)
      throw new Error("Cancellation failed.");
    expect(second.data.operation).toEqual(first.data.operation);
    const repeated = await cancelOwnerBooking(ids.context, request);
    expect(repeated).toMatchObject({ success: true });
    if (!repeated.success) throw new Error("Cancellation recovery failed.");
    expect(repeated.data.operation).toEqual(first.data.operation);
    const persisted = await database.pool.query(
      "SELECT revision,(SELECT count(*)::int FROM booking_changes WHERE booking_id=$1) AS changes,(SELECT count(*)::int FROM notification_work WHERE booking_id=$1 AND kind='customer_cancellation') AS updates FROM bookings WHERE id=$1",
      [created.data.bookingId],
    );
    expect(persisted.rows[0]).toMatchObject({
      revision: 1,
      changes: 1,
      updates: 1,
    });
  });

  it("owner lifecycle rejects a reused key with changed booking or revision", async () => {
    const ids = await fixture();
    const firstBooking = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    const secondBooking = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids, { startAt: "2026-11-02T11:00:00.000Z" }),
    );
    if (!firstBooking.success || !secondBooking.success)
      throw new Error("Booking fixture failed.");
    const { cancelOwnerBooking } = await import("../mutations");
    const request = {
      bookingId: firstBooking.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    };
    expect(await cancelOwnerBooking(ids.context, request)).toMatchObject({
      success: true,
    });
    expect(
      await cancelOwnerBooking(ids.context, {
        ...request,
        bookingId: secondBooking.data.bookingId,
      }),
    ).toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });
    expect(
      await cancelOwnerBooking(ids.context, {
        ...request,
        expectedRevision: 1,
      }),
    ).toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });
    await expect(
      getOwnAppointment(ids.context, secondBooking.data.bookingId),
    ).resolves.toMatchObject({ success: true, data: { status: "confirmed" } });
  });

  it("owner lifecycle does not expose a replay receipt across owners", async () => {
    const owner = await fixture();
    const otherOwner = await fixture();
    const created = await createPublicBooking(
      { shopId: owner.shopId },
      input(owner),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { cancelOwnerBooking } = await import("../mutations");
    const request = {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    };
    expect(await cancelOwnerBooking(owner.context, request)).toMatchObject({
      success: true,
    });
    expect(await cancelOwnerBooking(otherOwner.context, request)).toMatchObject(
      {
        success: false,
        error: { code: "NOT_FOUND" },
      },
    );
    await expect(
      getOwnAppointment(otherOwner.context, created.data.bookingId),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("owner lifecycle recovery keeps its original summary and reads current appointment details", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { cancelOwnerBooking } = await import("../mutations");
    const request = {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    };
    const original = await cancelOwnerBooking(ids.context, request);
    expect(original.success).toBe(true);
    if (!original.success) throw new Error("Cancellation fixture failed.");
    const actorId = ids.context?.userId;
    if (!actorId) throw new Error("Owner fixture failed.");
    const movedOccupancyId = randomUUID();
    await database.pool.query(
      "INSERT INTO occupied_intervals (id,shop_id,barber_id,start_at,end_at) VALUES ($1,$2,$3,'2026-11-02T11:00:00Z','2026-11-02T11:30:00Z')",
      [movedOccupancyId, ids.shopId, ids.barberId],
    );
    await database.pool.query(
      "UPDATE bookings SET status='confirmed',start_at='2026-11-02T11:00:00Z',end_at='2026-11-02T11:30:00Z',occupancy_id=$2,revision=2 WHERE id=$1",
      [created.data.bookingId, movedOccupancyId],
    );
    await database.pool.query(
      `INSERT INTO booking_changes (id,shop_id,booking_id,actor_id,kind,applied_revision,committed_at,operation_key_hash,payload_digest,before_snapshot,after_snapshot)
       VALUES ($1,$2,$3,$4,'move',2,now(),$5,$6,$7::jsonb,$8::jsonb)`,
      [
        randomUUID(),
        ids.shopId,
        created.data.bookingId,
        actorId,
        randomBytes(32).toString("hex"),
        randomBytes(32).toString("hex"),
        JSON.stringify(original.data.operation.snapshot),
        JSON.stringify({
          ...original.data.operation.snapshot,
          status: "confirmed",
          startAt: "2026-11-02T11:00:00.000Z",
          endAt: "2026-11-02T11:30:00.000Z",
        }),
      ],
    );
    const recovered = await cancelOwnerBooking(ids.context, request);
    expect(recovered).toMatchObject({
      success: true,
      data: {
        operation: original.data.operation,
        appointment: {
          status: "confirmed",
          revision: 2,
          startAt: "2026-11-02T11:00:00.000Z",
          endAt: "2026-11-02T11:30:00.000Z",
        },
      },
    });
  });

  it.each(["hidden", "archived", "unassigned", "foreign"] as const)(
    "owner replacement rejects %s services",
    async (kind) => {
      const ids = await fixture();
      let serviceId: string;
      let reviewedOffer: {
        name: string;
        priceUsd: string;
        durationMinutes: string;
      };
      let errorCode: string;
      if (kind === "foreign") {
        const foreign = await fixture();
        serviceId = foreign.serviceId;
        reviewedOffer = {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        };
        errorCode = "STALE_OFFER";
      } else {
        const candidate = await saveService(ids.context, {
          name: kind,
          priceUsd: "31",
          durationMinutes: "30",
          offered: kind !== "hidden",
          barberIds: kind === "unassigned" ? [] : [ids.barberId],
        });
        if (!candidate.success)
          throw new Error("Replacement service fixture failed.");
        serviceId = candidate.data.id;
        reviewedOffer = {
          name: kind,
          priceUsd: "31.00",
          durationMinutes: "30",
        };
        if (kind === "archived")
          expect(await archiveService(ids.context, serviceId)).toMatchObject({
            success: true,
          });
        errorCode =
          kind === "unassigned" ? "UNAVAILABLE_INTERVAL" : "STALE_OFFER";
      }
      const created = await createPublicBooking(
        { shopId: ids.shopId },
        input(ids),
      );
      if (!created.success) throw new Error("Booking fixture failed.");
      const { moveOwnerBooking } = await import("../mutations");
      const result = await moveOwnerBooking(
        ids.context,
        moveInput(ids, created.data.bookingId, {
          serviceId,
          reviewedOffer,
        }),
      );
      expect(result).toMatchObject({
        success: false,
        error: { code: errorCode },
      });
      await expectOwnerBookingUnmoved(created.data.bookingId);
    },
  );

  it("owner replacement choices include the saved hidden service and current offers", async () => {
    const ids = await fixture();
    const offered = await saveService(ids.context, {
      name: "Color",
      priceUsd: "40",
      durationMinutes: "45",
      offered: true,
      barberIds: [ids.barberId],
    });
    if (!offered.success) throw new Error("Service fixture failed.");
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    expect(
      await import("@/features/catalog/mutations").then(
        ({ setServiceOffered }) =>
          setServiceOffered(ids.context, {
            id: ids.serviceId,
            offered: false,
          }),
      ),
    ).toMatchObject({ success: true });
    const { getOwnAppointmentMoveChoices } = await import("../queries");
    const choices = await getOwnAppointmentMoveChoices(
      ids.context,
      created.data.bookingId,
    );
    expect(choices).toMatchObject({
      success: true,
      data: {
        timeZone: "UTC",
        barbers: [{ id: ids.barberId, name: "Sam" }],
        services: [
          {
            id: offered.data.id,
            name: "Color",
            priceUsd: "40.00",
            durationMinutes: 45,
            barberIds: [ids.barberId],
            hidden: false,
          },
          {
            id: ids.serviceId,
            name: "Cut",
            priceUsd: "25.00",
            durationMinutes: 30,
            barberIds: [ids.barberId],
            hidden: true,
          },
        ],
      },
    });
  });

  it("owner replacement choices retain the saved snapshot after catalog edits and hiding", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    expect(
      await saveService(ids.context, {
        id: ids.serviceId,
        name: "Renamed Cut",
        priceUsd: "29",
        durationMinutes: "50",
        offered: true,
        barberIds: [ids.barberId],
      }),
    ).toMatchObject({ success: true });
    expect(
      await import("@/features/catalog/mutations").then(
        ({ setServiceOffered }) =>
          setServiceOffered(ids.context, {
            id: ids.serviceId,
            offered: false,
          }),
      ),
    ).toMatchObject({ success: true });
    const { getOwnAppointmentMoveChoices } = await import("../queries");
    const choices = await getOwnAppointmentMoveChoices(
      ids.context,
      created.data.bookingId,
    );
    if (!choices.success) throw new Error("Move choices failed.");
    const savedService = choices.data.services.find(
      (service) => service.id === ids.serviceId,
    );
    expect(savedService).toMatchObject({
      id: ids.serviceId,
      name: "Cut",
      priceUsd: "25.00",
      durationMinutes: 30,
      barberIds: [ids.barberId],
      hidden: true,
    });
    if (!savedService) throw new Error("Saved service missing from choices.");
    const { moveOwnerBooking } = await import("../mutations");
    const moved = await moveOwnerBooking(
      ids.context,
      moveInput(ids, created.data.bookingId, {
        serviceId: savedService.id,
        reviewedOffer: {
          name: savedService.name,
          priceUsd: savedService.priceUsd,
          durationMinutes: String(savedService.durationMinutes),
        },
      }),
    );
    expect(moved).toMatchObject({
      success: true,
      data: {
        appointment: {
          service: {
            id: ids.serviceId,
            name: "Cut",
            priceUsd: "25.00",
            durationMinutes: 30,
          },
          startAt: "2026-11-02T11:07:00.000Z",
          endAt: "2026-11-02T11:37:00.000Z",
        },
      },
    });
  });

  it("owner replacement A-to-B-to-A uses the current reviewed details for A", async () => {
    const ids = await fixture();
    const replacement = await saveService(ids.context, {
      name: "Color",
      priceUsd: "40",
      durationMinutes: "45",
      offered: true,
      barberIds: [ids.barberId],
    });
    if (!replacement.success) throw new Error("Service fixture failed.");
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { moveOwnerBooking } = await import("../mutations");
    const firstMove = await moveOwnerBooking(
      ids.context,
      moveInput(ids, created.data.bookingId, {
        serviceId: replacement.data.id,
        startAt: "2026-11-02T11:07:00.000Z",
        reviewedOffer: {
          name: "Color",
          priceUsd: "40.00",
          durationMinutes: "45",
        },
      }),
    );
    expect(firstMove.success).toBe(true);
    expect(
      await saveService(ids.context, {
        id: ids.serviceId,
        name: "Cut Plus",
        priceUsd: "29",
        durationMinutes: "50",
        offered: true,
        barberIds: [ids.barberId],
      }),
    ).toMatchObject({ success: true });
    const returned = await moveOwnerBooking(
      ids.context,
      moveInput(ids, created.data.bookingId, {
        expectedRevision: 1,
        serviceId: ids.serviceId,
        startAt: "2026-11-02T12:07:00.000Z",
        reviewedOffer: {
          name: "Cut Plus",
          priceUsd: "29.00",
          durationMinutes: "50",
        },
      }),
    );
    expect(returned).toMatchObject({
      success: true,
      data: {
        appointment: {
          service: {
            id: ids.serviceId,
            name: "Cut Plus",
            priceUsd: "29.00",
            durationMinutes: 50,
          },
          startAt: "2026-11-02T12:07:00.000Z",
          endAt: "2026-11-02T12:57:00.000Z",
        },
      },
    });
  });

  it.each(["name", "price", "duration"] as const)(
    "owner replacement requires a new review when the service %s changes",
    async (field) => {
      const ids = await fixture();
      const initial = {
        name: "Color",
        priceUsd: "40.00",
        durationMinutes: "45",
      };
      const current = { ...initial };
      if (field === "name") current.name = "Color Plus";
      if (field === "price") current.priceUsd = "42.00";
      if (field === "duration") current.durationMinutes = "60";
      const replacement = await saveService(ids.context, {
        name: initial.name,
        priceUsd: initial.priceUsd,
        durationMinutes: initial.durationMinutes,
        offered: true,
        barberIds: [ids.barberId],
      });
      if (!replacement.success) throw new Error("Service fixture failed.");
      const created = await createPublicBooking(
        { shopId: ids.shopId },
        input(ids),
      );
      if (!created.success) throw new Error("Booking fixture failed.");
      expect(
        await saveService(ids.context, {
          id: replacement.data.id,
          name: current.name,
          priceUsd: current.priceUsd.replace(/\.00$/, ""),
          durationMinutes: current.durationMinutes,
          offered: true,
          barberIds: [ids.barberId],
        }),
      ).toMatchObject({ success: true });
      const { moveOwnerBooking } = await import("../mutations");
      const stale = await moveOwnerBooking(
        ids.context,
        moveInput(ids, created.data.bookingId, {
          serviceId: replacement.data.id,
          reviewedOffer: initial,
        }),
      );
      expect(stale).toMatchObject({
        success: false,
        error: { code: "STALE_OFFER" },
      });
      await expectOwnerBookingUnmoved(created.data.bookingId);
      const accepted = await moveOwnerBooking(
        ids.context,
        moveInput(ids, created.data.bookingId, {
          serviceId: replacement.data.id,
          reviewedOffer: current,
        }),
      );
      expect(accepted).toMatchObject({
        success: true,
        data: {
          appointment: {
            service: {
              id: replacement.data.id,
              ...current,
              durationMinutes: Number(current.durationMinutes),
            },
            endAt:
              field === "duration"
                ? "2026-11-02T12:07:00.000Z"
                : "2026-11-02T11:52:00.000Z",
          },
        },
      });
    },
  );

  it("owner replacement allows only one booking to claim the same target interval in either order", async () => {
    async function run(firstIndex: 0 | 1) {
      const ids = await fixture();
      const first = await createPublicBooking(
        { shopId: ids.shopId },
        input(ids),
      );
      const second = await createPublicBooking(
        { shopId: ids.shopId },
        input(ids, { startAt: "2026-11-02T12:00:00.000Z" }),
      );
      if (!first.success || !second.success)
        throw new Error("Booking fixtures failed.");
      const { moveOwnerBooking } = await import("../mutations");
      const bookings = [first, second];
      const move = (index: number) =>
        moveOwnerBooking(
          ids.context,
          moveInput(ids, bookings[index].data.bookingId, {
            operationKey: randomBytes(32).toString("base64url"),
            startAt: "2026-11-02T11:07:00.000Z",
          }),
        );
      const results =
        firstIndex === 0
          ? await queueShopOperations(
              ids.shopId,
              () => move(0),
              () => move(1),
              ["owner_move", "owner_move"],
            )
          : await queueShopOperations(
              ids.shopId,
              () => move(1),
              () => move(0),
              ["owner_move", "owner_move"],
            ).then(([secondResult, firstResult]) => [
              firstResult,
              secondResult,
            ]);
      expect(results[firstIndex]).toMatchObject({ success: true });
      expect(results[1 - firstIndex]).toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE_INTERVAL" },
      });
      for (const [index, created] of bookings.entries()) {
        const current = await getOwnAppointment(
          ids.context,
          created.data.bookingId,
        );
        expect(current).toMatchObject({
          success: true,
          data: { revision: index === firstIndex ? 1 : 0 },
        });
        if (index !== firstIndex)
          expect(current).toMatchObject({
            success: true,
            data: {
              startAt:
                index === 0
                  ? "2026-11-02T10:00:00.000Z"
                  : "2026-11-02T12:00:00.000Z",
            },
          });
      }
      const overlaps = await database.pool.query(
        `SELECT count(*)::int AS count FROM occupied_intervals
         WHERE shop_id=$1 AND barber_id=$2 AND start_at<'2026-11-02T11:37:00Z'
           AND end_at>'2026-11-02T11:07:00Z'`,
        [ids.shopId, ids.barberId],
      );
      expect(overlaps.rows[0].count).toBe(1);
    }

    await run(0);
    await run(1);
  });

  it("owner replacement versus cancellation applies one revision-zero operation in either order", async () => {
    async function run(moveFirst: boolean) {
      const ids = await fixture();
      const created = await createPublicBooking(
        { shopId: ids.shopId },
        input(ids),
      );
      if (!created.success) throw new Error("Booking fixture failed.");
      const { moveOwnerBooking, cancelOwnerBooking } =
        await import("../mutations");
      const move = () =>
        moveOwnerBooking(ids.context, moveInput(ids, created.data.bookingId));
      const cancel = () =>
        cancelOwnerBooking(ids.context, {
          bookingId: created.data.bookingId,
          expectedRevision: 0,
          operationKey: randomBytes(32).toString("base64url"),
        });
      const [moveResult, cancelResult] = moveFirst
        ? await queueShopOperations(ids.shopId, move, cancel, [
            "owner_move",
            "owner_cancel",
          ])
        : await queueShopOperations(ids.shopId, cancel, move, [
            "owner_cancel",
            "owner_move",
          ]).then(([cancelResult, moveResult]) => [moveResult, cancelResult]);
      if (moveFirst) {
        expect(moveResult).toMatchObject({ success: true });
        expect(cancelResult).toMatchObject({
          success: false,
          error: { code: "STALE_BOOKING" },
        });
        await expect(
          getOwnAppointment(ids.context, created.data.bookingId),
        ).resolves.toMatchObject({
          success: true,
          data: {
            revision: 1,
            status: "confirmed",
            startAt: "2026-11-02T11:07:00.000Z",
            endAt: "2026-11-02T11:37:00.000Z",
          },
        });
      } else {
        expect(cancelResult).toMatchObject({ success: true });
        expect(moveResult).toMatchObject({
          success: false,
          error: { code: "STALE_BOOKING" },
        });
        await expect(
          getOwnAppointment(ids.context, created.data.bookingId),
        ).resolves.toMatchObject({
          success: true,
          data: {
            revision: 1,
            status: "cancelled",
            startAt: "2026-11-02T10:00:00.000Z",
            endAt: "2026-11-02T10:30:00.000Z",
          },
        });
      }
      const history = await database.pool.query(
        "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1",
        [created.data.bookingId],
      );
      expect(history.rows[0].count).toBe(1);
    }

    await run(true);
    await run(false);
  });

  it("owner replacement versus time-block insertion preserves one valid order", async () => {
    async function run(moveFirst: boolean) {
      const ids = await fixture();
      const original = await createPublicBooking(
        { shopId: ids.shopId },
        input(ids),
      );
      if (!original.success) throw new Error("Booking fixture failed.");
      const { moveOwnerBooking } = await import("../mutations");
      const move = () =>
        moveOwnerBooking(ids.context, moveInput(ids, original.data.bookingId));
      const block = () =>
        createTimeBlock(ids.context, {
          barberId: ids.barberId,
          date: "2026-11-02",
          timeZone: "UTC",
          start: "2026-11-02T11:07:00Z",
          end: "2026-11-02T11:37:00Z",
          note: "Competing block",
        });
      const [moveResult, blockResult] = moveFirst
        ? await queueShopOperations(ids.shopId, move, block, [
            "owner_move",
            "shop_edit",
          ])
        : await queueShopOperations(ids.shopId, block, move, [
            "shop_edit",
            "owner_move",
          ]).then(([blockResult, moveResult]) => [moveResult, blockResult]);
      expect(moveResult.success).toBe(moveFirst);
      expect(blockResult.success).toBe(!moveFirst);
      const targetOccupancy = await database.pool.query(
        `SELECT count(*)::int AS count FROM occupied_intervals
         WHERE shop_id=$1 AND barber_id=$2 AND start_at='2026-11-02T11:07:00Z'
           AND end_at='2026-11-02T11:37:00Z'`,
        [ids.shopId, ids.barberId],
      );
      expect(targetOccupancy.rows[0].count).toBe(1);
      if (moveFirst) {
        await expect(
          getOwnAppointment(ids.context, original.data.bookingId),
        ).resolves.toMatchObject({
          success: true,
          data: { revision: 1, startAt: "2026-11-02T11:07:00.000Z" },
        });
      } else {
        await expectOwnerBookingUnmoved(original.data.bookingId);
      }
    }

    await run(true);
    await run(false);
  });

  it("owner replacement versus booking creation never commits conflicting occupancy", async () => {
    const ids = await fixture();
    const original = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!original.success) throw new Error("Booking fixture failed.");
    const { moveOwnerBooking } = await import("../mutations");
    const [move, created] = await Promise.all([
      moveOwnerBooking(ids.context, moveInput(ids, original.data.bookingId)),
      createPublicBooking(
        { shopId: ids.shopId },
        input(ids, { startAt: "2026-11-02T11:07:00.000Z" }),
      ),
    ]);
    expect([move, created].filter((result) => result.success)).toHaveLength(1);
    const intervals = await database.pool.query(
      `SELECT count(*)::int AS count FROM occupied_intervals
       WHERE shop_id=$1 AND barber_id=$2 AND start_at<'2026-11-02T11:37:00Z'
         AND end_at>'2026-11-02T11:07:00Z'`,
      [ids.shopId, ids.barberId],
    );
    expect(intervals.rows[0].count).toBe(1);
    if (move.success) {
      expect(created).toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE_INTERVAL" },
      });
      await expect(
        getOwnAppointment(ids.context, original.data.bookingId),
      ).resolves.toMatchObject({
        success: true,
        data: { revision: 1, startAt: "2026-11-02T11:07:00.000Z" },
      });
    } else {
      expect(move).toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE_INTERVAL" },
      });
      await expect(
        getOwnAppointment(ids.context, original.data.bookingId),
      ).resolves.toMatchObject({
        success: true,
        data: { revision: 0, startAt: "2026-11-02T10:00:00.000Z" },
      });
    }
  });

  it("owner replacement accepts one of two simultaneous revision-zero moves in either order", async () => {
    async function run(firstIndex: 0 | 1) {
      const ids = await fixture();
      const created = await createPublicBooking(
        { shopId: ids.shopId },
        input(ids),
      );
      if (!created.success) throw new Error("Booking fixture failed.");
      const { moveOwnerBooking } = await import("../mutations");
      const candidates = [
        moveInput(ids, created.data.bookingId, {
          operationKey: randomBytes(32).toString("base64url"),
          startAt: "2026-11-02T11:07:00.000Z",
        }),
        moveInput(ids, created.data.bookingId, {
          operationKey: randomBytes(32).toString("base64url"),
          startAt: "2026-11-02T12:07:00.000Z",
        }),
      ];
      const move = (index: number) =>
        moveOwnerBooking(ids.context, candidates[index]);
      const results =
        firstIndex === 0
          ? await queueShopOperations(
              ids.shopId,
              () => move(0),
              () => move(1),
              ["owner_move", "owner_move"],
            )
          : await queueShopOperations(
              ids.shopId,
              () => move(1),
              () => move(0),
              ["owner_move", "owner_move"],
            ).then(([secondResult, firstResult]) => [
              firstResult,
              secondResult,
            ]);
      expect(results[firstIndex]).toMatchObject({ success: true });
      expect(results[1 - firstIndex]).toMatchObject({
        success: false,
        error: { code: "STALE_BOOKING" },
      });
      const current = await getOwnAppointment(
        ids.context,
        created.data.bookingId,
      );
      expect(current).toMatchObject({
        success: true,
        data: {
          revision: 1,
          startAt:
            firstIndex === 0
              ? "2026-11-02T11:07:00.000Z"
              : "2026-11-02T12:07:00.000Z",
        },
      });
      const evidence = await database.pool.query(
        "SELECT (SELECT count(*)::int FROM booking_changes WHERE booking_id=$1 AND kind='move' AND applied_revision=1) AS changes,(SELECT count(*)::int FROM notification_work WHERE booking_id=$1 AND kind='customer_move' AND booking_revision=1) AS work",
        [created.data.bookingId],
      );
      expect(evidence.rows[0]).toEqual({ changes: 1, work: 1 });
    }

    await run(0);
    await run(1);
  });

  it("owner replacement lets a waiting archive succeed after moving off the old barber", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const replacement = await saveBarber(ids.context, {
      name: "Lee",
      serviceIds: [ids.serviceId],
    });
    if (!replacement.success) throw new Error("Barber fixture failed.");
    const move = async () => {
      const { moveOwnerBooking } = await import("../mutations");
      return moveOwnerBooking(
        ids.context,
        moveInput(ids, created.data.bookingId, {
          barberId: replacement.data.id,
          startAt: "2026-11-02T11:07:00.000Z",
        }),
      );
    };
    const [moved, archived] = await queueShopOperations(
      ids.shopId,
      move,
      () => archiveBarber(ids.context, ids.barberId),
      ["owner_move", "shop_edit"],
    );
    expect(moved).toMatchObject({
      success: true,
      data: { appointment: { barber: { id: replacement.data.id } } },
    });
    expect(archived).toMatchObject({ success: true, data: { archived: true } });
    await expect(
      getOwnAppointment(ids.context, created.data.bookingId),
    ).resolves.toMatchObject({
      success: true,
      data: {
        revision: 1,
        service: { id: ids.serviceId },
        barber: { id: replacement.data.id },
        startAt: "2026-11-02T11:07:00.000Z",
      },
    });
  });

  it("owner replacement rolls back its reservation when history persistence fails", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const suffix = randomUUID().replaceAll("-", "");
    const fn = `phase09_reject_${suffix}`;
    const trigger = `phase09_reject_${suffix}`;
    await database.pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'phase09 injected history failure'; END; $$`,
    );
    await database.pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON booking_changes FOR EACH ROW WHEN (NEW.booking_id='${created.data.bookingId}') EXECUTE FUNCTION ${fn}()`,
    );
    try {
      const { moveOwnerBooking } = await import("../mutations");
      await expect(
        moveOwnerBooking(ids.context, moveInput(ids, created.data.bookingId)),
      ).resolves.toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE" },
      });
      await expectOwnerBookingUnmoved(created.data.bookingId);
      const persisted = await database.pool.query(
        `SELECT b.service_id,b.barber_id,b.revision,b.start_at,b.end_at,
          i.barber_id AS occupied_barber,i.start_at AS occupied_start,
          i.end_at AS occupied_end,
          (SELECT count(*)::int FROM notification_work w
            WHERE w.booking_id=b.id AND w.kind='customer_move') AS move_work
         FROM bookings b JOIN occupied_intervals i ON i.id=b.occupancy_id
         WHERE b.id=$1`,
        [created.data.bookingId],
      );
      expect(persisted.rows[0]).toMatchObject({
        service_id: ids.serviceId,
        barber_id: ids.barberId,
        revision: 0,
        start_at: new Date("2026-11-02T10:00:00Z"),
        end_at: new Date("2026-11-02T10:30:00Z"),
        occupied_barber: ids.barberId,
        occupied_start: new Date("2026-11-02T10:00:00Z"),
        occupied_end: new Date("2026-11-02T10:30:00Z"),
        move_work: 0,
      });
    } finally {
      await database.pool.query(
        `DROP TRIGGER IF EXISTS ${trigger} ON booking_changes`,
      );
      await database.pool.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
  });

  it("owner replacement replay after later changes returns the current appointment", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { moveOwnerBooking, cancelOwnerBooking } =
      await import("../mutations");
    const firstInput = moveInput(ids, created.data.bookingId, {
      operationKey: randomBytes(32).toString("base64url"),
    });
    expect(await moveOwnerBooking(ids.context, firstInput)).toMatchObject({
      success: true,
      data: { operation: { revision: 1 } },
    });
    expect(
      await moveOwnerBooking(
        ids.context,
        moveInput(ids, created.data.bookingId, {
          expectedRevision: 1,
          operationKey: randomBytes(32).toString("base64url"),
          startAt: "2026-11-02T12:07:00.000Z",
        }),
      ),
    ).toMatchObject({ success: true, data: { operation: { revision: 2 } } });
    expect(await moveOwnerBooking(ids.context, firstInput)).toMatchObject({
      success: true,
      data: {
        operation: {
          revision: 1,
          snapshot: { startAt: "2026-11-02T11:07:00.000Z" },
        },
        appointment: {
          revision: 2,
          startAt: "2026-11-02T12:07:00.000Z",
          endAt: "2026-11-02T12:37:00.000Z",
        },
      },
    });
    expect(
      await cancelOwnerBooking(ids.context, {
        bookingId: created.data.bookingId,
        expectedRevision: 2,
        operationKey: randomBytes(32).toString("base64url"),
      }),
    ).toMatchObject({ success: true, data: { operation: { revision: 3 } } });
    expect(await moveOwnerBooking(ids.context, firstInput)).toMatchObject({
      success: true,
      data: {
        operation: { revision: 1 },
        appointment: {
          revision: 3,
          status: "cancelled",
          startAt: "2026-11-02T12:07:00.000Z",
          endAt: "2026-11-02T12:37:00.000Z",
        },
      },
    });
    const effects = await database.pool.query(
      `SELECT (SELECT count(*)::int FROM booking_changes WHERE booking_id=$1) AS changes,
        (SELECT count(*)::int FROM notification_work WHERE booking_id=$1
          AND kind IN ('customer_move','customer_cancellation')) AS work`,
      [created.data.bookingId],
    );
    expect(effects.rows[0]).toEqual({ changes: 3, work: 3 });
  });

  it.each([
    "recurring hours",
    "barber recurring hours",
    "dated closure",
    "assignment removal",
    "service archival",
    "barber archival",
  ] as const)(
    "owner replacement serializes with %s edits in both orders",
    async (kind) => {
      async function run(editFirst: boolean) {
        const ids = await fixture();
        let serviceId = ids.serviceId;
        let barberId = ids.barberId;
        let offer = { name: "Cut", priceUsd: "25.00", durationMinutes: "30" };
        let startAt = "2026-11-02T11:07:00.000Z";
        const usesDestination = [
          "assignment removal",
          "service archival",
          "barber archival",
        ].includes(kind);
        if (usesDestination) {
          const destination = await saveBarber(ids.context, {
            name: "Lee",
            serviceIds: [],
          });
          if (!destination.success) throw new Error("Barber fixture failed.");
          const service = await saveService(ids.context, {
            name: "Color",
            priceUsd: "40",
            durationMinutes: "45",
            offered: true,
            barberIds: [destination.data.id],
          });
          if (!service.success) throw new Error("Service fixture failed.");
          serviceId = service.data.id;
          barberId = destination.data.id;
          offer = { name: "Color", priceUsd: "40.00", durationMinutes: "45" };
        }
        if (kind === "dated closure") startAt = "2026-11-09T10:00:00.000Z";
        const created = await createPublicBooking(
          { shopId: ids.shopId },
          input(ids),
        );
        if (!created.success) throw new Error("Booking fixture failed.");
        const restricted = Array.from({ length: 7 }, (_, index) => ({
          working: index === 0 ? [{ start: 540, end: 660 }] : [],
          breaks: [],
        }));
        const edit = async () => {
          switch (kind) {
            case "recurring hours":
              return saveShopSchedule(ids.context, {
                week: restricted,
                revision: 1,
              });
            case "barber recurring hours":
              return saveBarberSchedule(ids.context, {
                barberId: ids.barberId,
                week: restricted,
                revision: 1,
              });
            case "dated closure":
              return saveShopDateSchedule(ids.context, {
                date: "2026-11-09",
                timeZone: "UTC",
                override: null,
                closed: true,
                revision: 0,
              });
            case "assignment removal":
              return saveService(ids.context, {
                id: serviceId,
                name: "Color",
                priceUsd: "40",
                durationMinutes: "45",
                offered: true,
                barberIds: [],
              });
            case "service archival":
              return archiveService(ids.context, serviceId);
            case "barber archival":
              return archiveBarber(ids.context, barberId);
          }
        };
        const move = async () => {
          const { moveOwnerBooking } = await import("../mutations");
          return moveOwnerBooking(
            ids.context,
            moveInput(ids, created.data.bookingId, {
              serviceId,
              barberId,
              startAt,
              reviewedOffer: offer,
            }),
          );
        };
        const [editResult, moveResult] = editFirst
          ? await queueShopOperations(ids.shopId, edit, move, [
              "shop_edit",
              "owner_move",
            ])
          : await queueShopOperations(ids.shopId, move, edit, [
              "owner_move",
              "shop_edit",
            ]).then(([moveResult, editResult]) => [editResult, moveResult]);
        if (editFirst) {
          expect(editResult).toMatchObject({ success: true });
          expect(moveResult).toMatchObject({
            success: false,
            error: {
              code:
                kind === "service archival"
                  ? "STALE_OFFER"
                  : "UNAVAILABLE_INTERVAL",
            },
          });
          await expectOwnerBookingUnmoved(created.data.bookingId);
        } else {
          expect(moveResult).toMatchObject({ success: true });
          expect(editResult).toMatchObject({
            success: false,
            error: { code: "BOOKING_CONFLICT" },
          });
          await expect(
            getOwnAppointment(ids.context, created.data.bookingId),
          ).resolves.toMatchObject({
            success: true,
            data: {
              service: { id: serviceId },
              barber: { id: barberId },
              startAt,
            },
          });
        }
      }
      await run(true);
      await run(false);
    },
  );

  it("owner replacement accepts an offered service with its reviewed snapshot and duration", async () => {
    const ids = await fixture();
    const replacement = await saveService(ids.context, {
      name: "Color",
      priceUsd: "40",
      durationMinutes: "45",
      offered: true,
      barberIds: [ids.barberId],
    });
    if (!replacement.success) throw new Error("Service fixture failed.");
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { moveOwnerBooking } = await import("../mutations");
    const result = await moveOwnerBooking(
      ids.context,
      moveInput(ids, created.data.bookingId, {
        serviceId: replacement.data.id,
        startAt: "2026-11-02T11:07:00.000Z",
        reviewedOffer: {
          name: "Color",
          priceUsd: "40.00",
          durationMinutes: "45",
        },
      }),
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        appointment: {
          service: {
            id: replacement.data.id,
            name: "Color",
            priceUsd: "40.00",
            durationMinutes: 45,
          },
          startAt: "2026-11-02T11:07:00.000Z",
          endAt: "2026-11-02T11:52:00.000Z",
        },
        operation: {
          kind: "move",
          revision: 1,
          snapshot: {
            serviceId: replacement.data.id,
            serviceName: "Color",
            servicePriceUsd: "40.00",
            serviceDurationMinutes: 45,
            endAt: "2026-11-02T11:52:00.000Z",
          },
        },
      },
    });
  });

  it("owner replacement accepts a service-only change at the same barber and start", async () => {
    const ids = await fixture();
    const replacement = await saveService(ids.context, {
      name: "Color",
      priceUsd: "40",
      durationMinutes: "45",
      offered: true,
      barberIds: [ids.barberId],
    });
    if (!replacement.success) throw new Error("Service fixture failed.");
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { moveOwnerBooking } = await import("../mutations");
    const result = await moveOwnerBooking(
      ids.context,
      moveInput(ids, created.data.bookingId, {
        serviceId: replacement.data.id,
        startAt: "2026-11-02T10:00:00.000Z",
        reviewedOffer: {
          name: "Color",
          priceUsd: "40.00",
          durationMinutes: "45",
        },
      }),
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        appointment: {
          service: {
            id: replacement.data.id,
            name: "Color",
            priceUsd: "40.00",
            durationMinutes: 45,
          },
          barber: { id: ids.barberId },
          startAt: "2026-11-02T10:00:00.000Z",
          endAt: "2026-11-02T10:45:00.000Z",
        },
        operation: { kind: "move", revision: 1 },
      },
    });
  });

  it("owner move changes the interval, refreshes the calendar, and releases the old slot", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { moveOwnerBooking } = await import("../mutations");
    const moved = await moveOwnerBooking(ids.context, {
      bookingId: created.data.bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T11:07:00.000Z",
      reviewedOffer: {
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: "30",
      },
    });
    expect(moved).toMatchObject({
      success: true,
      data: {
        operation: { kind: "move", revision: 1 },
        appointment: {
          startAt: "2026-11-02T11:07:00.000Z",
          endAt: "2026-11-02T11:37:00.000Z",
        },
      },
    });
    await expect(
      getOwnCalendar(ids.context, { date: "2026-11-02", view: "day" }),
    ).resolves.toMatchObject({
      success: true,
      data: {
        appointments: [
          {
            id: created.data.bookingId,
            startAt: "2026-11-02T11:07:00.000Z",
            endAt: "2026-11-02T11:37:00.000Z",
          },
        ],
      },
    });
    const history = await database.pool.query(
      "SELECT b.revision,(SELECT count(*)::int FROM booking_changes c WHERE c.booking_id=b.id AND c.kind='move' AND c.applied_revision=1) AS changes,(SELECT count(*)::int FROM notification_work w WHERE w.booking_id=b.id AND w.kind='customer_move' AND w.booking_revision=1 AND w.change_id IS NOT NULL) AS move_work,(SELECT count(*)::int FROM notification_work w WHERE w.booking_id=b.id AND w.kind='owner_alert' AND w.booking_revision=1) AS move_owner_alerts FROM bookings b WHERE b.id=$1",
      [created.data.bookingId],
    );
    expect(history.rows[0]).toEqual({
      revision: 1,
      changes: 1,
      move_work: 1,
      move_owner_alerts: 0,
    });
    const oldSlot = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    expect(oldSlot.success).toBe(true);
  });

  it("owner move preserves the original booking when the target is occupied", async () => {
    const ids = await fixture();
    const original = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    const competitor = await createOwnerBooking(ids.context, {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T11:07:00.000Z",
      reviewedOffer: {
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: "30",
      },
      contact: { name: "Walk-in Guest", whatsappOptIn: false },
      recoveryKey: randomBytes(32).toString("base64url"),
    });
    if (!original.success || !competitor.success)
      throw new Error("Booking fixture failed.");
    const { moveOwnerBooking } = await import("../mutations");
    const result = await moveOwnerBooking(
      ids.context,
      moveInput(ids, original.data.bookingId),
    );
    expect(result).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    await expect(
      getOwnAppointment(ids.context, original.data.bookingId),
    ).resolves.toMatchObject({
      success: true,
      data: {
        status: "confirmed",
        revision: 0,
        startAt: "2026-11-02T10:00:00.000Z",
        endAt: "2026-11-02T10:30:00.000Z",
        service: { name: "Cut", priceUsd: "25.00", durationMinutes: 30 },
      },
    });
    const persisted = await database.pool.query(
      "SELECT (SELECT count(*)::int FROM booking_changes WHERE booking_id=$1) AS changes,(SELECT count(*)::int FROM occupied_intervals WHERE id=b.occupancy_id AND start_at='2026-11-02T10:00:00Z') AS original_occupancy FROM bookings b WHERE b.id=$1",
      [original.data.bookingId],
    );
    expect(persisted.rows[0]).toEqual({ changes: 0, original_occupancy: 1 });
  });

  it("owner move accepts an eligible second barber and same-barber adjacency", async () => {
    const ids = await fixture();
    const second = await saveBarber(ids.context, {
      name: "Taylor",
      serviceIds: [ids.serviceId],
    });
    if (!second.success) throw new Error("Barber fixture failed.");
    const createAt = (startAt: string) =>
      createOwnerBooking(ids.context, {
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        startAt,
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
        contact: { name: "Walk-in Guest", whatsappOptIn: false },
        recoveryKey: randomBytes(32).toString("base64url"),
      });
    const simultaneous = await createAt("2026-11-02T10:00:00.000Z");
    if (!simultaneous.success) throw new Error("Booking fixture failed.");
    const { moveOwnerBooking } = await import("../mutations");
    const movedBarber = await moveOwnerBooking(
      ids.context,
      moveInput(ids, simultaneous.data.bookingId, {
        barberId: second.data.id,
        startAt: "2026-11-02T10:00:00.000Z",
      }),
    );
    expect(movedBarber).toMatchObject({
      success: true,
      data: { appointment: { barber: { id: second.data.id } } },
    });

    const anchor = await createAt("2026-11-02T10:00:00.000Z");
    const adjacent = await createAt("2026-11-02T11:00:00.000Z");
    if (!anchor.success || !adjacent.success)
      throw new Error("Adjacency booking fixture failed.");
    const movedAdjacent = await moveOwnerBooking(
      ids.context,
      moveInput(ids, adjacent.data.bookingId, {
        startAt: "2026-11-02T10:30:00.000Z",
      }),
    );
    expect(movedAdjacent).toMatchObject({
      success: true,
      data: { appointment: { startAt: "2026-11-02T10:30:00.000Z" } },
    });
  });

  it("owner move works inside public notice, past the public horizon, and while unpublished", async () => {
    const ids = await fixture();
    const createPublicAt = (startAt: string, name: string) =>
      createPublicBooking(
        { shopId: ids.shopId },
        input(ids, {
          startAt,
          contact: {
            name,
            email: `${name.toLowerCase().replaceAll(" ", "-")}@example.test`,
            whatsappOptIn: false,
          },
        }),
      );
    const inside = await createPublicAt(
      "2026-11-02T10:00:00.000Z",
      "Inside Notice",
    );
    const beyond = await createPublicAt(
      "2026-11-02T12:00:00.000Z",
      "Beyond Horizon",
    );
    const unpublished = await createPublicAt(
      "2026-11-02T13:00:00.000Z",
      "Unpublished Shop",
    );
    if (!inside.success || !beyond.success || !unpublished.success)
      throw new Error("Booking fixture failed.");
    const { moveOwnerBooking } = await import("../mutations");
    vi.setSystemTime(new Date("2026-11-02T10:00:00Z"));
    const insideMove = await moveOwnerBooking(
      ids.context,
      moveInput(ids, inside.data.bookingId, {
        startAt: "2026-11-02T11:00:00.000Z",
      }),
    );
    expect(insideMove.success).toBe(true);
    vi.setSystemTime(new Date("2026-11-02T08:00:00Z"));
    const horizonMove = await moveOwnerBooking(
      ids.context,
      moveInput(ids, beyond.data.bookingId, {
        startAt: "2026-12-14T11:00:00.000Z",
      }),
    );
    expect(horizonMove.success).toBe(true);
    const unpublishedShop = await setOwnShopPublication(ids.context, {
      published: false,
      expectedPublished: true,
    });
    expect(unpublishedShop.success).toBe(true);
    const unpublishedMove = await moveOwnerBooking(
      ids.context,
      moveInput(ids, unpublished.data.bookingId, {
        startAt: "2026-11-02T14:00:00.000Z",
      }),
    );
    expect(unpublishedMove.success).toBe(true);
  });

  it("owner move allows a target ending after the current time for an ongoing appointment", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    vi.setSystemTime(new Date("2026-11-02T10:07:00Z"));
    const { moveOwnerBooking } = await import("../mutations");
    const result = await moveOwnerBooking(
      ids.context,
      moveInput(ids, created.data.bookingId, {
        startAt: "2026-11-02T10:07:00.000Z",
      }),
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        appointment: {
          status: "confirmed",
          startAt: "2026-11-02T10:07:00.000Z",
          endAt: "2026-11-02T10:37:00.000Z",
        },
      },
    });
  });

  it.each(["2026-11-02T09:37:00.000Z", "2026-11-02T09:36:00.000Z"] as const)(
    "owner move rejects a target ending %s current time",
    async (startAt) => {
      const ids = await fixture();
      const created = await createPublicBooking(
        { shopId: ids.shopId },
        input(ids),
      );
      if (!created.success) throw new Error("Booking fixture failed.");
      vi.setSystemTime(new Date("2026-11-02T10:07:00Z"));
      const { moveOwnerBooking } = await import("../mutations");
      const result = await moveOwnerBooking(
        ids.context,
        moveInput(ids, created.data.bookingId, { startAt }),
      );
      expect(result).toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE_INTERVAL" },
      });
      await expect(
        getOwnAppointment(ids.context, created.data.bookingId),
      ).resolves.toMatchObject({
        success: true,
        data: { status: "confirmed", revision: 0 },
      });
      await expectOwnerBookingUnmoved(created.data.bookingId);
    },
  );

  it("owner move honors New York DST gaps and explicit fold instants", async () => {
    const openDay = { working: [{ start: 0, end: 1440 }], breaks: [] };
    const springSlots = calculateSlots({
      date: "2026-03-08",
      timeZone: "America/New_York",
      now: "2026-03-07T00:00:00Z",
      durationMinutes: 30,
      shopDay: openDay,
      barberDay: openDay,
    });
    expect(springSlots.some((slot) => slot.localStart === "02:30")).toBe(false);
    const fallSlots = calculateSlots({
      date: "2026-11-01",
      timeZone: "America/New_York",
      now: "2026-10-30T00:00:00Z",
      durationMinutes: 30,
      shopDay: openDay,
      barberDay: openDay,
    });
    expect(
      fallSlots
        .filter((slot) => slot.localStart === "01:30")
        .map((slot) => slot.offset),
    ).toEqual(["-04:00", "-05:00"]);

    const ids = await fixture(false, "America/New_York");
    const allWeek = Array.from({ length: 7 }, () => openDay);
    expect(
      await saveShopSchedule(ids.context, { week: allWeek, revision: 1 }),
    ).toMatchObject({ success: true });
    expect(
      await saveBarberSchedule(ids.context, {
        barberId: ids.barberId,
        week: allWeek,
        revision: 1,
      }),
    ).toMatchObject({ success: true });
    vi.setSystemTime(new Date("2026-11-01T04:00:00Z"));
    const original = await createOwnerBooking(ids.context, {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-01T05:00:00.000Z",
      reviewedOffer: {
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: "30",
      },
      contact: { name: "Walk-in Guest", whatsappOptIn: false },
      recoveryKey: randomBytes(32).toString("base64url"),
    });
    if (!original.success) throw new Error("Booking fixture failed.");
    const { moveOwnerBooking } = await import("../mutations");
    const moved = await moveOwnerBooking(
      ids.context,
      moveInput(ids, original.data.bookingId, {
        startAt: "2026-11-01T05:45:00.000Z",
      }),
    );
    expect(moved).toMatchObject({
      success: true,
      data: {
        appointment: {
          startAt: "2026-11-01T05:45:00.000Z",
          endAt: "2026-11-01T06:15:00.000Z",
        },
      },
    });
  });

  it("owner move permits exact local-midnight completion and rejects crossing midnight", async () => {
    const ids = await fixture();
    const allDay = Array.from({ length: 7 }, (_, index) => ({
      working: index === 0 ? [{ start: 0, end: 1440 }] : [],
      breaks: [],
    }));
    expect(
      await saveShopSchedule(ids.context, { week: allDay, revision: 1 }),
    ).toMatchObject({ success: true });
    expect(
      await saveBarberSchedule(ids.context, {
        barberId: ids.barberId,
        week: allDay,
        revision: 1,
      }),
    ).toMatchObject({ success: true });
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { moveOwnerBooking } = await import("../mutations");
    const crossing = await moveOwnerBooking(
      ids.context,
      moveInput(ids, created.data.bookingId, {
        startAt: "2026-11-02T23:31:00.000Z",
      }),
    );
    expect(crossing).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    const midnight = await moveOwnerBooking(
      ids.context,
      moveInput(ids, created.data.bookingId, {
        startAt: "2026-11-02T23:30:00.000Z",
      }),
    );
    expect(midnight).toMatchObject({
      success: true,
      data: {
        appointment: {
          startAt: "2026-11-02T23:30:00.000Z",
          endAt: "2026-11-03T00:00:00.000Z",
        },
      },
    });
  });

  it("owner move preserves the saved same-service snapshot after catalog edits and hiding", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    expect(
      await saveService(ids.context, {
        id: ids.serviceId,
        name: "Renamed Cut",
        priceUsd: "30",
        durationMinutes: "45",
        offered: true,
        barberIds: [ids.barberId],
      }),
    ).toMatchObject({ success: true });
    const { moveOwnerBooking } = await import("../mutations");
    const firstMove = await moveOwnerBooking(
      ids.context,
      moveInput(ids, created.data.bookingId),
    );
    expect(firstMove).toMatchObject({
      success: true,
      data: {
        appointment: {
          service: { name: "Cut", priceUsd: "25.00", durationMinutes: 30 },
          endAt: "2026-11-02T11:37:00.000Z",
        },
      },
    });
    const { setServiceOffered } = await import("@/features/catalog/mutations");
    expect(
      await setServiceOffered(ids.context, {
        id: ids.serviceId,
        offered: false,
      }),
    ).toMatchObject({ success: true });
    const secondMove = await moveOwnerBooking(
      ids.context,
      moveInput(ids, created.data.bookingId, {
        expectedRevision: 1,
        startAt: "2026-11-02T12:07:00.000Z",
      }),
    );
    expect(secondMove).toMatchObject({
      success: true,
      data: {
        appointment: {
          service: { name: "Cut", priceUsd: "25.00", durationMinutes: 30 },
          startAt: "2026-11-02T12:07:00.000Z",
          endAt: "2026-11-02T12:37:00.000Z",
        },
      },
    });
  });

  it("owner move returns NO_CHANGE without writing an event or customer work", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const before = await database.pool.query(
      "SELECT b.revision,(SELECT count(*)::int FROM booking_changes c WHERE c.booking_id=b.id) AS changes,(SELECT count(*)::int FROM notification_work w WHERE w.booking_id=b.id) AS work FROM bookings b WHERE b.id=$1",
      [created.data.bookingId],
    );
    const { moveOwnerBooking } = await import("../mutations");
    const result = await moveOwnerBooking(
      ids.context,
      moveInput(ids, created.data.bookingId, {
        startAt: "2026-11-02T10:00:00.000Z",
      }),
    );
    expect(result).toMatchObject({
      success: false,
      error: { code: "NO_CHANGE" },
    });
    const after = await database.pool.query(
      "SELECT b.revision,(SELECT count(*)::int FROM booking_changes c WHERE c.booking_id=b.id) AS changes,(SELECT count(*)::int FROM notification_work w WHERE w.booking_id=b.id) AS work FROM bookings b WHERE b.id=$1",
      [created.data.bookingId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("owner move preserves the manage capability and bases expiry on the new end", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const token = new URL(created.data.manageUrl).pathname.split("/").at(-1)!;
    const before = await database.pool.query(
      "SELECT capability_hash,capability_ciphertext,capability_key_id FROM bookings WHERE id=$1",
      [created.data.bookingId],
    );
    const { moveOwnerBooking } = await import("../mutations");
    const moved = await moveOwnerBooking(
      ids.context,
      moveInput(ids, created.data.bookingId),
    );
    expect(moved.success).toBe(true);
    const after = await database.pool.query(
      "SELECT capability_hash,capability_ciphertext,capability_key_id FROM bookings WHERE id=$1",
      [created.data.bookingId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    const { getManagedBooking } = await import("../queries");
    await expect(
      getManagedBooking({ shopId: ids.shopId }, token),
    ).resolves.toMatchObject({
      success: true,
      data: {
        startAt: "2026-11-02T11:07:00.000Z",
        endAt: "2026-11-02T11:37:00.000Z",
      },
    });
    vi.setSystemTime(new Date("2026-11-09T11:07:00Z"));
    await expect(
      getManagedBooking({ shopId: ids.shopId }, token),
    ).resolves.toMatchObject({ success: true });
    vi.setSystemTime(new Date("2026-11-09T11:37:00Z"));
    await expect(
      getManagedBooking({ shopId: ids.shopId }, token),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE" },
    });
  });

  it("owner move rejects a target outside recurring shop hours", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { moveOwnerBooking } = await import("../mutations");
    const result = await moveOwnerBooking(
      ids.context,
      moveInput(ids, created.data.bookingId, {
        startAt: "2026-11-02T17:00:00.000Z",
      }),
    );
    expect(result).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    await expectOwnerBookingUnmoved(created.data.bookingId);
  });

  it("owner move returns VALIDATION_ERROR for an impossible ISO date", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { moveOwnerBooking } = await import("../mutations");
    const result = await moveOwnerBooking(
      ids.context,
      moveInput(ids, created.data.bookingId, {
        startAt: "2026-02-30T11:07:00.000Z",
      }),
    );
    expect(result).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    await expectOwnerBookingUnmoved(created.data.bookingId);
  });

  it("owner move rejects a target inside a recurring shop break", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const withBreak = week.map((day, index) => ({
      ...day,
      breaks: index === 0 ? [{ start: 660, end: 690 }] : [],
    }));
    expect(
      await saveShopSchedule(ids.context, { week: withBreak, revision: 1 }),
    ).toMatchObject({ success: true });
    const { moveOwnerBooking } = await import("../mutations");
    expect(
      await moveOwnerBooking(
        ids.context,
        moveInput(ids, created.data.bookingId),
      ),
    ).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    await expectOwnerBookingUnmoved(created.data.bookingId);
  });

  it("owner move rejects a target inside a recurring barber break", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const withBreak = week.map((day, index) => ({
      ...day,
      breaks: index === 0 ? [{ start: 660, end: 690 }] : [],
    }));
    expect(
      await saveBarberSchedule(ids.context, {
        barberId: ids.barberId,
        week: withBreak,
        revision: 1,
      }),
    ).toMatchObject({ success: true });
    const { moveOwnerBooking } = await import("../mutations");
    expect(
      await moveOwnerBooking(
        ids.context,
        moveInput(ids, created.data.bookingId),
      ),
    ).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    await expectOwnerBookingUnmoved(created.data.bookingId);
  });

  it("owner move rejects a target on a shop closed date", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    expect(
      await saveShopDateSchedule(ids.context, {
        date: "2026-11-09",
        timeZone: "UTC",
        override: null,
        closed: true,
        revision: 0,
      }),
    ).toMatchObject({ success: true });
    const { moveOwnerBooking } = await import("../mutations");
    expect(
      await moveOwnerBooking(
        ids.context,
        moveInput(ids, created.data.bookingId, {
          startAt: "2026-11-09T10:00:00.000Z",
        }),
      ),
    ).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    await expectOwnerBookingUnmoved(created.data.bookingId);
  });

  it("owner move rejects a target on a barber day off", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    expect(
      await saveBarberDateSchedule(ids.context, {
        barberId: ids.barberId,
        date: "2026-11-09",
        timeZone: "UTC",
        override: null,
        closed: true,
        revision: 0,
      }),
    ).toMatchObject({ success: true });
    const { moveOwnerBooking } = await import("../mutations");
    expect(
      await moveOwnerBooking(
        ids.context,
        moveInput(ids, created.data.bookingId, {
          startAt: "2026-11-09T10:00:00.000Z",
        }),
      ),
    ).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    await expectOwnerBookingUnmoved(created.data.bookingId);
  });

  it("owner move honors a dated shop-hours override", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    expect(
      await saveShopDateSchedule(ids.context, {
        date: "2026-11-09",
        timeZone: "UTC",
        override: {
          working: [{ start: 720, end: 780 }],
          breaks: [],
        },
        closed: false,
        revision: 0,
      }),
    ).toMatchObject({ success: true });
    const { moveOwnerBooking } = await import("../mutations");
    expect(
      await moveOwnerBooking(
        ids.context,
        moveInput(ids, created.data.bookingId, {
          startAt: "2026-11-09T10:00:00.000Z",
        }),
      ),
    ).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    await expectOwnerBookingUnmoved(created.data.bookingId);
  });

  it("owner move rejects a target covered by a time block", async () => {
    const ids = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    expect(
      await createTimeBlock(ids.context, {
        barberId: ids.barberId,
        date: "2026-11-02",
        timeZone: "UTC",
        start: "2026-11-02T11:00:00Z",
        end: "2026-11-02T11:30:00Z",
        note: "Reserved",
      }),
    ).toMatchObject({ success: true });
    const { moveOwnerBooking } = await import("../mutations");
    expect(
      await moveOwnerBooking(
        ids.context,
        moveInput(ids, created.data.bookingId),
      ),
    ).toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    await expectOwnerBookingUnmoved(created.data.bookingId);
  });

  it.each(["ineligible", "archived", "foreign"] as const)(
    "owner move rejects a %s barber",
    async (kind) => {
      const ids = await fixture();
      const created = await createPublicBooking(
        { shopId: ids.shopId },
        input(ids),
      );
      if (!created.success) throw new Error("Booking fixture failed.");
      let barberId: string;
      if (kind === "foreign") {
        barberId = (await fixture()).barberId;
      } else {
        const barber = await saveBarber(ids.context, {
          name: "Unassigned",
          serviceIds: [],
        });
        if (!barber.success) throw new Error("Barber fixture failed.");
        barberId = barber.data.id;
        if (kind === "archived")
          expect(await archiveBarber(ids.context, barberId)).toMatchObject({
            success: true,
          });
      }
      const { moveOwnerBooking } = await import("../mutations");
      expect(
        await moveOwnerBooking(
          ids.context,
          moveInput(ids, created.data.bookingId, { barberId }),
        ),
      ).toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE_INTERVAL" },
      });
      await expectOwnerBookingUnmoved(created.data.bookingId);
    },
  );

  it("returns literal shop-zone DST day and Monday-week ranges and denies foreign filters", async () => {
    const ids = await fixture(false, "America/New_York");
    await expect(
      getOwnCalendar(ids.context, { date: "2026-03-08", view: "day" }),
    ).resolves.toMatchObject({
      success: true,
      data: {
        range: {
          startAt: "2026-03-08T05:00:00Z",
          endAt: "2026-03-09T04:00:00Z",
        },
      },
    });
    await expect(
      getOwnCalendar(ids.context, { date: "2026-11-01", view: "day" }),
    ).resolves.toMatchObject({
      success: true,
      data: {
        range: {
          startAt: "2026-11-01T04:00:00Z",
          endAt: "2026-11-02T05:00:00Z",
        },
      },
    });
    await expect(
      getOwnCalendar(ids.context, { date: "2026-11-04", view: "week" }),
    ).resolves.toMatchObject({
      success: true,
      data: {
        range: {
          startAt: "2026-11-02T05:00:00Z",
          endAt: "2026-11-09T05:00:00Z",
        },
      },
    });
    await expect(
      getOwnCalendar(ids.context, { date: "not-a-date", view: "day" }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    await expect(
      getOwnCalendar(null, { date: "2026-11-02", view: "day" }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNAUTHENTICATED" },
    });
    await expect(
      getOwnCalendar(
        { userId: randomUUID() },
        { date: "2026-11-02", view: "day" },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "SHOP_REQUIRED" },
    });
  });

  it("filters interval overlaps, own barber choices, and saved history independently of renamed records", async () => {
    const ids = await fixture(false);
    const secondBarber = await saveBarber(ids.context, {
      name: "Leila",
      serviceIds: [ids.serviceId],
    });
    if (!secondBarber.success) throw new Error("Second barber fixture failed.");
    const insert = async (input: {
      barberId: string;
      startAt: string;
      endAt: string;
      savedName: string;
    }) => {
      const id = randomUUID();
      await database.pool.query(
        `INSERT INTO bookings (
        id,shop_id,service_id,barber_id,start_at,end_at,service_name,service_price_usd,service_duration_minutes,
        barber_name,customer_name,customer_email,whatsapp_opt_in,capability_hash,capability_ciphertext,
        capability_key_id,recovery_key_hash,recovery_payload_digest
      ) VALUES ($1,$2,$3,$4,$5,$6,'Saved Cut',25.00,30,'Saved Barber',$7,'history@example.test',false,$8,'ciphertext','test-v1',$9,'digest')`,
        [
          id,
          ids.shopId,
          ids.serviceId,
          input.barberId,
          input.startAt,
          input.endAt,
          input.savedName,
          randomUUID(),
          randomUUID(),
        ],
      );
      return id;
    };
    await insert({
      barberId: ids.barberId,
      startAt: "2026-11-01T23:30:00Z",
      endAt: "2026-11-02T00:00:00Z",
      savedName: "Ends at range start",
    });
    await insert({
      barberId: ids.barberId,
      startAt: "2026-11-03T00:00:00Z",
      endAt: "2026-11-03T00:30:00Z",
      savedName: "Starts at range end",
    });
    const savedId = await insert({
      barberId: ids.barberId,
      startAt: "2026-11-02T23:45:00Z",
      endAt: "2026-11-03T00:15:00Z",
      savedName: "Snapshot Guest",
    });
    await insert({
      barberId: secondBarber.data.id,
      startAt: "2026-11-02T10:00:00Z",
      endAt: "2026-11-02T10:30:00Z",
      savedName: "Other Barber Guest",
    });
    const all = await getOwnCalendar(ids.context, {
      date: "2026-11-02",
      view: "day",
    });
    expect(all).toMatchObject({
      success: true,
      data: {
        appointments: expect.arrayContaining([
          expect.objectContaining({ id: savedId }),
        ]),
      },
    });
    if (all.success) {
      expect(
        all.data.appointments.some(
          (item) =>
            item.customer.name === "Ends at range start" ||
            item.customer.name === "Starts at range end",
        ),
      ).toBe(false);
    }
    const filtered = await getOwnCalendar(ids.context, {
      date: "2026-11-02",
      view: "day",
      barberId: ids.barberId,
    });
    if (!filtered.success) throw new Error("Own barber filter failed.");
    expect(
      filtered.data.appointments.some(
        (item) => item.customer.name === "Other Barber Guest",
      ),
    ).toBe(false);
    await expect(
      getOwnCalendar(ids.context, {
        date: "2026-11-02",
        view: "day",
        barberId: randomUUID(),
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    await database.pool.query(
      "UPDATE services SET name='Current Cut',price_usd=30,duration_minutes=45 WHERE id=$1",
      [ids.serviceId],
    );
    await database.pool.query(
      "UPDATE barbers SET name='Current Barber',archived=true WHERE id=$1",
      [ids.barberId],
    );
    await expect(
      getOwnAppointment(ids.context, savedId),
    ).resolves.toMatchObject({
      success: true,
      data: {
        service: { name: "Saved Cut", priceUsd: "25.00", durationMinutes: 30 },
        barber: { name: "Saved Barber", archived: true },
        customer: { name: "Snapshot Guest" },
      },
    });
    const choices = await import("../queries").then(
      ({ getOwnAppointmentChoices }) => getOwnAppointmentChoices(ids.context),
    );
    if (choices.success)
      expect(
        choices.data.barbers.some((barber) => barber.id === ids.barberId),
      ).toBe(false);
    const foreign = await fixture(false);
    const foreignId = randomUUID();
    await database.pool.query(
      `INSERT INTO bookings (
      id,shop_id,service_id,barber_id,start_at,end_at,service_name,service_price_usd,service_duration_minutes,
      barber_name,customer_name,customer_email,whatsapp_opt_in,capability_hash,capability_ciphertext,
      capability_key_id,recovery_key_hash,recovery_payload_digest
    ) VALUES ($1,$2,$3,$4,'2026-11-02T10:00Z','2026-11-02T10:30Z','Foreign Cut',25,30,'Foreign Barber','Private Guest','private@example.test',false,$5,'ciphertext','test-v1',$6,'digest')`,
      [
        foreignId,
        foreign.shopId,
        foreign.serviceId,
        foreign.barberId,
        randomUUID(),
        randomUUID(),
      ],
    );
    const foreignRead = await getOwnAppointment(ids.context, foreignId);
    const unknownRead = await getOwnAppointment(ids.context, randomUUID());
    const malformedRead = await getOwnAppointment(ids.context, "not-an-id");
    expect(foreignRead).toEqual(unknownRead);
    expect(malformedRead).toEqual(unknownRead);
    expect(JSON.stringify(foreignRead)).not.toContain("Private Guest");
  });

  it("creates an exact-minute ongoing owner appointment for an unpublished shop without contacts", async () => {
    const ids = await fixture(false);
    vi.setSystemTime(new Date("2026-11-02T10:12:30Z"));
    const result = await createOwnerBooking(ids.context, {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T10:07:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: { name: "Walk-in Guest", whatsappOptIn: false },
      recoveryKey: randomBytes(32).toString("base64url"),
    });
    expect(result).toMatchObject({ success: true });
    if (!result.success) return;
    await expect(
      getOwnAppointment(ids.context, result.data.bookingId),
    ).resolves.toMatchObject({
      success: true,
      data: {
        status: "confirmed",
        startAt: "2026-11-02T10:07:00.000Z",
        endAt: "2026-11-02T10:37:00.000Z",
        customer: { name: "Walk-in Guest", email: null },
      },
    });
    const persisted = await database.pool.query(
      "SELECT b.creation_source,b.customer_email,b.occupancy_id,s.time_zone_locked_at FROM bookings b JOIN shops s ON s.id=b.shop_id WHERE b.id=$1",
      [result.data.bookingId],
    );
    expect(persisted.rows[0]).toMatchObject({
      creation_source: "owner",
      customer_email: null,
    });
    expect(persisted.rows[0].occupancy_id).toBeTruthy();
    expect(persisted.rows[0].time_zone_locked_at).toBeTruthy();
    expect(
      (
        await database.pool.query(
          "SELECT kind,channel,status,reason,recipient FROM notification_work WHERE booking_id=$1",
          [result.data.bookingId],
        )
      ).rows,
    ).toEqual([
      expect.objectContaining({
        kind: "customer_confirmation",
        channel: "email",
        status: "skipped",
        reason: "recipient_missing",
        recipient: null,
      }),
    ]);
    await expect(
      getOwnNotificationActivity(ids.context),
    ).resolves.toMatchObject({
      success: true,
      data: {
        rows: [
          expect.objectContaining({
            bookingId: result.data.bookingId,
            creationSource: "owner",
            kind: "customer_confirmation",
            status: "skipped",
            reason: "recipient_missing",
            recipient: null,
            attempt: null,
          }),
        ],
      },
    });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1 AND kind='owner_alert'",
          [result.data.bookingId],
        )
      ).rows[0].count,
    ).toBe(0);
  });

  it("creates only requested customer channels and never an owner self-alert", async () => {
    const ids = await fixture(false);
    const emailResult = await createOwnerBooking(ids.context, {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T10:07:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: {
        name: "Phone Guest",
        email: "guest@example.test",
        phone: "+1 555 0100",
        whatsappOptIn: false,
      },
      recoveryKey: randomBytes(32).toString("base64url"),
    });
    expect(emailResult).toMatchObject({
      success: true,
      data: {
        appointment: {
          customer: {
            email: "guest@example.test",
            phone: "+1 555 0100",
            whatsappOptIn: false,
          },
        },
      },
    });
    if (!emailResult.success) return;
    const emailWork = (
      await database.pool.query(
        "SELECT kind,channel,status,recipient FROM notification_work WHERE booking_id=$1",
        [emailResult.data.bookingId],
      )
    ).rows;
    expect(emailWork).toHaveLength(1);
    expect(emailWork[0]).toMatchObject({
      kind: "customer_confirmation",
      channel: "email",
      recipient: "guest@example.test",
    });

    const consented = await createOwnerBooking(ids.context, {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T11:07:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: {
        name: "WhatsApp Guest",
        phone: "+1 555 0101",
        whatsappOptIn: true,
      },
      recoveryKey: randomBytes(32).toString("base64url"),
    });
    expect(consented).toMatchObject({
      success: true,
      data: {
        notifications: { whatsapp: "unavailable" },
        appointment: { customer: { email: null, whatsappOptIn: true } },
      },
    });
    if (!consented.success) return;
    const work = (
      await database.pool.query(
        "SELECT kind,channel,status,reason,recipient FROM notification_work WHERE booking_id=$1 ORDER BY channel",
        [consented.data.bookingId],
      )
    ).rows;
    expect(work).toEqual([
      expect.objectContaining({
        kind: "customer_confirmation",
        channel: "email",
        status: "skipped",
        reason: "recipient_missing",
        recipient: null,
      }),
      expect.objectContaining({
        kind: "customer_confirmation",
        channel: "whatsapp",
        status: "unavailable",
        reason: "channel_unavailable",
        recipient: "+1 555 0101",
      }),
    ]);
  });

  it("samples authoritative time after validation and rejects an end equal to now", async () => {
    const ids = await fixture(false);
    const payload = {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T10:07:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: { name: "Walk-in Guest", whatsappOptIn: false },
      recoveryKey: randomBytes(32).toString("base64url"),
    };
    vi.setSystemTime(new Date("2026-11-02T10:37:00.000Z"));
    await expect(
      createOwnerBooking(ids.context, payload),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    vi.setSystemTime(new Date("2026-11-02T10:36:59.999Z"));
    await expect(
      createOwnerBooking(ids.context, payload),
    ).resolves.toMatchObject({ success: true });
  });

  it("allows an exact future start outside the public horizon while public creation remains limited", async () => {
    const ids = await fixture(true);
    const payload = {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-12-14T10:07:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: {
        name: "Phone Guest",
        phone: "+1 555 0100",
        whatsappOptIn: false,
      },
      recoveryKey: randomBytes(32).toString("base64url"),
    };
    await expect(
      createOwnerBooking(ids.context, payload),
    ).resolves.toMatchObject({ success: true });
    await expect(
      createPublicBooking(
        { shopId: ids.shopId },
        {
          ...payload,
          contact: {
            name: "Phone Guest",
            email: "phone@example.test",
            phone: "+1 555 0100",
            whatsappOptIn: false,
          },
          recoveryKey: randomBytes(32).toString("base64url"),
        },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
  });

  it("serializes same-barber overlaps and permits independent barber capacity", async () => {
    const ids = await fixture(false);
    const secondBarber = await saveBarber(ids.context, {
      name: "Leila",
      serviceIds: [ids.serviceId],
    });
    if (!secondBarber.success) throw new Error("Second barber fixture failed.");
    const payload = {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T10:07:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: { name: "Walk-in Guest", whatsappOptIn: false },
    };
    const [first, second, independent] = await Promise.all([
      createOwnerBooking(ids.context, {
        ...payload,
        recoveryKey: randomBytes(32).toString("base64url"),
      }),
      createOwnerBooking(ids.context, {
        ...payload,
        recoveryKey: randomBytes(32).toString("base64url"),
      }),
      createOwnerBooking(ids.context, {
        ...payload,
        barberId: secondBarber.data.id,
        recoveryKey: randomBytes(32).toString("base64url"),
      }),
    ]);
    expect([first, second].filter((result) => result.success)).toHaveLength(1);
    expect([first, second].filter((result) => !result.success)).toHaveLength(1);
    expect(independent.success).toBe(true);
    const winners = [first, second, independent].filter(
      (result) => result.success,
    );
    expect(winners).toHaveLength(2);
    expect(
      new Set(winners.map((result) => result.data.appointment.barber.id)),
    ).toEqual(new Set([ids.barberId, secondBarber.data.id]));
  });

  it("recovers an identical owner request and rejects changed content under the same key", async () => {
    const ids = await fixture(false);
    const payload = {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T10:07:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: { name: "Walk-in Guest", whatsappOptIn: false },
      recoveryKey: randomBytes(32).toString("base64url"),
    };
    const [first, concurrentRetry] = await Promise.all([
      createOwnerBooking(ids.context, payload),
      createOwnerBooking(ids.context, payload),
    ]);
    expect(first.success).toBe(true);
    expect(concurrentRetry).toEqual(first);
    await expect(
      createOwnerBooking(ids.context, {
        ...payload,
        contact: { ...payload.contact, name: "Changed" },
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });
    if (first.success) {
      const counts = await database.pool.query(
        "SELECT count(*)::int AS bookings FROM bookings WHERE id=$1",
        [first.data.bookingId],
      );
      expect(counts.rows[0].bookings).toBe(1);
    }
  });

  it("keeps public and owner recovery namespaces separate", async () => {
    const ids = await fixture(true);
    const recoveryKey = randomBytes(32).toString("base64url");
    const publicResult = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids, { recoveryKey }),
    );
    expect(publicResult.success).toBe(true);
    const ownerResult = await createOwnerBooking(ids.context, {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T11:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: { name: "Walk-in Guest", whatsappOptIn: false },
      recoveryKey,
    });
    expect(ownerResult).toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });

    const ownerKey = randomBytes(32).toString("base64url");
    const firstOwner = await createOwnerBooking(ids.context, {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T12:00:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: { name: "Another Guest", whatsappOptIn: false },
      recoveryKey: ownerKey,
    });
    expect(firstOwner.success).toBe(true);
    const publicRetry = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids, { recoveryKey: ownerKey }),
    );
    expect(publicRetry).toMatchObject({
      success: false,
      error: { code: "RECOVERY_MISMATCH" },
    });
    if (firstOwner.success && publicRetry.success)
      expect(publicRetry.data.bookingId).not.toBe(firstOwner.data.bookingId);
  });

  const staleOfferChanges: [
    string,
    { name?: string; priceUsd?: string; durationMinutes?: string },
  ][] = [
    ["name", { name: "New Cut" }],
    ["price", { priceUsd: "30" }],
    ["duration", { durationMinutes: "45" }],
  ];
  it.each(staleOfferChanges)(
    "requires renewed review after service %s changes",
    async (_field, change) => {
      const ids = await fixture(false);
      await saveService(ids.context, {
        id: ids.serviceId,
        name: change.name ?? "Cut",
        priceUsd: change.priceUsd ?? "25",
        durationMinutes: change.durationMinutes ?? "30",
        offered: true,
        barberIds: [ids.barberId],
      });
      const result = await createOwnerBooking(ids.context, {
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        startAt: "2026-11-02T10:07:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
        contact: { name: "Walk-in Guest", whatsappOptIn: false },
        recoveryKey: randomBytes(32).toString("base64url"),
      });
      expect(result).toMatchObject({
        success: false,
        error: { code: "STALE_OFFER" },
      });
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS count FROM bookings WHERE shop_id=$1",
            [ids.shopId],
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id=$1",
            [ids.shopId],
          )
        ).rows[0].count,
      ).toBe(0);
    },
  );

  it.each(["hidden", "archived", "unassigned"] as const)(
    "rejects an owner creation when the service is %s",
    async (state) => {
      const ids = await fixture(false);
      if (state === "hidden")
        await database.pool.query(
          "UPDATE services SET offered=false WHERE id=$1",
          [ids.serviceId],
        );
      if (state === "archived")
        await database.pool.query(
          "UPDATE services SET archived=true WHERE id=$1",
          [ids.serviceId],
        );
      if (state === "unassigned")
        await database.pool.query(
          "DELETE FROM barber_services WHERE shop_id=$1 AND barber_id=$2 AND service_id=$3",
          [ids.shopId, ids.barberId, ids.serviceId],
        );
      const result = await createOwnerBooking(ids.context, {
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        startAt: "2026-11-02T10:07:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
        contact: { name: "Walk-in Guest", whatsappOptIn: false },
        recoveryKey: randomBytes(32).toString("base64url"),
      });
      expect(result).toMatchObject({
        success: false,
        error: { code: "STALE_OFFER" },
      });
      expect(JSON.stringify(result)).not.toMatch(/foreign|service-a|barber-a/i);
    },
  );

  it("rejects unauthenticated creation and accepts a start exactly at server time", async () => {
    await expect(createOwnerBooking(null, {})).resolves.toMatchObject({
      success: false,
      error: { code: "UNAUTHENTICATED" },
    });
    const ids = await fixture(false);
    vi.setSystemTime(new Date("2026-11-02T10:07:00.000Z"));
    await expect(
      createOwnerBooking(ids.context, {
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        startAt: "2026-11-02T10:07:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
        contact: { name: "Walk-in Guest", whatsappOptIn: false },
        recoveryKey: randomBytes(32).toString("base64url"),
      }),
    ).resolves.toMatchObject({ success: true });
  });

  it("rejects service and barber identifiers from another owner's shop without disclosing it", async () => {
    const own = await fixture(false);
    const foreign = await fixture(false);
    for (const refs of [
      { serviceId: foreign.serviceId, barberId: own.barberId },
      { serviceId: own.serviceId, barberId: foreign.barberId },
    ]) {
      const result = await createOwnerBooking(own.context, {
        ...refs,
        startAt: "2026-11-02T10:07:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
        contact: { name: "Walk-in Guest", whatsappOptIn: false },
        recoveryKey: randomBytes(32).toString("base64url"),
      });
      expect(result).toMatchObject({
        success: false,
        error: { code: "STALE_OFFER" },
      });
      expect(JSON.stringify(result)).not.toContain(foreign.shopId);
    }
  });

  it("respects shop breaks and allows exact midnight completion without overnight work", async () => {
    const ids = await fixture(false);
    const split = Array.from({ length: 7 }, (_, index) => ({
      working: index === 0 ? [{ start: 540, end: 1020 }] : [],
      breaks: index === 0 ? [{ start: 720, end: 780 }] : [],
    }));
    const splitSaved = await saveShopSchedule(ids.context, {
      week: split,
      revision: 1,
    });
    expect(splitSaved.success).toBe(true);
    expect(
      (
        await database.pool.query(
          "SELECT week->0 AS monday FROM shop_schedules WHERE shop_id=$1",
          [ids.shopId],
        )
      ).rows[0].monday,
    ).toMatchObject({ breaks: [{ start: 720, end: 780 }] });
    const make = (startAt: string) =>
      createOwnerBooking(ids.context, {
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        startAt,
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
        contact: { name: "Walk-in Guest", whatsappOptIn: false },
        recoveryKey: randomBytes(32).toString("base64url"),
      });
    await expect(make("2026-11-02T12:15:00.000Z")).resolves.toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });

    const midnight = await fixture(false);
    const allDay = Array.from({ length: 7 }, (_, index) => ({
      working: index === 0 ? [{ start: 0, end: 1440 }] : [],
      breaks: [],
    }));
    await saveShopSchedule(midnight.context, { week: allDay, revision: 1 });
    await saveBarberSchedule(midnight.context, {
      barberId: midnight.barberId,
      week: allDay,
      revision: 1,
    });
    const crossing = (startAt: string) =>
      createOwnerBooking(midnight.context, {
        serviceId: midnight.serviceId,
        barberId: midnight.barberId,
        startAt,
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
        contact: { name: "Walk-in Guest", whatsappOptIn: false },
        recoveryKey: randomBytes(32).toString("base64url"),
      });
    await expect(crossing("2026-11-02T23:31:00.000Z")).resolves.toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    await expect(crossing("2026-11-02T23:30:00.000Z")).resolves.toMatchObject({
      success: true,
    });
  });

  it("rejects a closed shop date and an explicit barber time block", async () => {
    const closed = await fixture(false);
    await saveShopDateSchedule(closed.context, {
      date: "2026-11-02",
      timeZone: "UTC",
      override: null,
      closed: true,
      revision: 0,
    });
    await expect(
      createOwnerBooking(closed.context, {
        serviceId: closed.serviceId,
        barberId: closed.barberId,
        startAt: "2026-11-02T10:07:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
        contact: { name: "Walk-in Guest", whatsappOptIn: false },
        recoveryKey: randomBytes(32).toString("base64url"),
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
    const blocked = await fixture(false);
    await createTimeBlock(blocked.context, {
      barberId: blocked.barberId,
      date: "2026-11-02",
      timeZone: "UTC",
      start: "2026-11-02T10:00:00Z",
      end: "2026-11-02T10:30:00Z",
      note: "Private block",
    });
    await expect(
      createOwnerBooking(blocked.context, {
        serviceId: blocked.serviceId,
        barberId: blocked.barberId,
        startAt: "2026-11-02T10:07:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
        contact: { name: "Walk-in Guest", whatsappOptIn: false },
        recoveryKey: randomBytes(32).toString("base64url"),
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE_INTERVAL" },
    });
  });

  it("rolls back reservation intent and zone lock when booking persistence fails", async () => {
    const ids = await fixture(false);
    const suffix = randomUUID().replaceAll("-", "");
    const fn = `phase08_reject_${suffix}`;
    const trigger = `phase08_reject_${suffix}`;
    expect(ids.shopId).toMatch(/^[a-zA-Z0-9-]+$/);
    await database.pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'phase08 injected failure'; END; $$`,
    );
    await database.pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON bookings FOR EACH ROW WHEN (NEW.shop_id='${ids.shopId}') EXECUTE FUNCTION ${fn}()`,
    );
    try {
      await expect(
        createOwnerBooking(ids.context, {
          serviceId: ids.serviceId,
          barberId: ids.barberId,
          startAt: "2026-11-02T10:07:00.000Z",
          reviewedOffer: {
            name: "Cut",
            priceUsd: "25.00",
            durationMinutes: "30",
          },
          contact: { name: "Walk-in Guest", whatsappOptIn: false },
          recoveryKey: randomBytes(32).toString("base64url"),
        }),
      ).resolves.toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE" },
      });
      const state = await database.pool.query(
        `SELECT
        (SELECT count(*)::int FROM bookings WHERE shop_id=$1) AS bookings,
        (SELECT count(*)::int FROM occupied_intervals WHERE shop_id=$1) AS occupancy,
        (SELECT count(*)::int FROM notification_work w JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1) AS work,
        (SELECT time_zone_locked_at FROM shops WHERE id=$1) AS locked`,
        [ids.shopId],
      );
      expect(state.rows[0]).toEqual({
        bookings: 0,
        occupancy: 0,
        work: 0,
        locked: null,
      });
    } finally {
      await database.pool.query(
        `DROP TRIGGER IF EXISTS ${trigger} ON bookings`,
      );
      await database.pool.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
  });

  it("rechecks end time after waiting for the authoritative shop lock", async () => {
    const ids = await fixture(false);
    vi.setSystemTime(new Date("2026-11-02T08:00:00Z"));
    const locker = await database.pool.connect();
    await locker.query("BEGIN");
    await locker.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
      ids.shopId,
    ]);
    const request = createOwnerBooking(ids.context, {
      serviceId: ids.serviceId,
      barberId: ids.barberId,
      startAt: "2026-11-02T10:07:00.000Z",
      reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
      contact: { name: "Walk-in Guest", whatsappOptIn: false },
      recoveryKey: randomBytes(32).toString("base64url"),
    });
    try {
      await waitForLockWaiters(database.pool, locker, 1, ["owner_create"], {
        description: "owner booking creation",
      });
      vi.setSystemTime(new Date("2026-11-02T10:37:00Z"));
      await locker.query("COMMIT");
      await expect(request).resolves.toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE_INTERVAL" },
      });
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined);
      locker.release();
    }
  });

  it("keeps an unrelated lock wait from satisfying the shop barrier", async () => {
    const ids = await fixture();
    const unrelated = await fixture();
    const created = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    if (!created.success) throw new Error("Booking fixture failed.");
    const { moveOwnerBooking } = await import("../mutations");

    const barrier = await database.pool.connect();
    const unrelatedLocker = await database.pool.connect();
    const unrelatedWaiter = await database.pool.connect();
    let barrierOpen = true;
    let unrelatedLockerOpen = true;
    let request: ReturnType<typeof moveOwnerBooking> | undefined;
    let unrelatedWait: Promise<unknown> | undefined;
    try {
      await barrier.query("BEGIN");
      await barrier.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
        ids.shopId,
      ]);
      await unrelatedLocker.query("BEGIN");
      await unrelatedLocker.query(
        "SELECT id FROM shops WHERE id=$1 FOR UPDATE",
        [unrelated.shopId],
      );
      // Same statement shape as the queued booking requests, but blocked by a
      // different lock owner, so it must never count for this barrier.
      unrelatedWait = unrelatedWaiter.query(
        "SELECT id FROM shops WHERE id=$1 FOR UPDATE",
        [unrelated.shopId],
      );
      const [unrelatedBlocked] = await waitForLockWaiters(
        database.pool,
        unrelatedLocker,
        1,
        ["shop_edit"],
        { description: "unrelated shop edit" },
      );

      const legacyGlobal = await database.pool.query(
        `SELECT count(*)::int AS count FROM pg_stat_activity
         WHERE datname=current_database() AND wait_event_type='Lock'
           AND pid<>pg_backend_pid() AND query ILIKE '%shops%'
           AND query ILIKE '%for update%'`,
      );
      expect(legacyGlobal.rows[0].count).toBeGreaterThanOrEqual(1);
      await expect(readLockWaiters(database.pool, barrier)).resolves.toEqual(
        [],
      );
      await expect(
        waitForLockWaiters(database.pool, barrier, 0),
      ).resolves.toEqual([]);

      request = moveOwnerBooking(
        ids.context,
        moveInput(ids, created.data.bookingId),
      );
      const [queued] = await waitForLockWaiters(
        database.pool,
        barrier,
        1,
        ["owner_move"],
        { description: "owner move behind the shop barrier" },
      );
      expect(queued.pid).not.toBe(unrelatedBlocked.pid);

      const mismatched = await waitForLockWaiters(
        database.pool,
        barrier,
        1,
        ["replace"],
        {
          description: "mismatched request identity",
          timeoutMs: 100,
          intervalMs: 10,
        },
      ).then(
        () => undefined,
        (error: unknown) => error as Error,
      );
      expect(mismatched).toBeInstanceOf(Error);
      expect(mismatched?.message).toMatch(/Timed out after 100ms/);
      expect(mismatched?.message).toContain("Barrier PID:");
      expect(mismatched?.message).toContain("Expected identities: replace");
      expect(mismatched?.message).toContain("Observed barrier waiters");

      const legacyDuring = await database.pool.query(
        `SELECT count(*)::int AS count FROM pg_stat_activity
         WHERE datname=current_database() AND wait_event_type='Lock'
           AND pid<>pg_backend_pid() AND query ILIKE '%shops%'
           AND query ILIKE '%for update%'`,
      );
      expect(legacyDuring.rows[0].count).toBeGreaterThanOrEqual(2);

      await unrelatedLocker.query("COMMIT");
      unrelatedLockerOpen = false;
      await unrelatedWait;
      await barrier.query("COMMIT");
      barrierOpen = false;
      await expect(request).resolves.toMatchObject({
        success: true,
        data: {
          appointment: {
            revision: 1,
            startAt: "2026-11-02T11:07:00.000Z",
          },
        },
      });
    } finally {
      if (barrierOpen) await barrier.query("ROLLBACK").catch(() => undefined);
      if (unrelatedLockerOpen)
        await unrelatedLocker.query("ROLLBACK").catch(() => undefined);
      await request?.catch(() => undefined);
      await unrelatedWait?.catch(() => undefined);
      unrelatedWaiter.release();
      unrelatedLocker.release();
      barrier.release();
    }
  });

  it.each(["block", "hide", "archive", "assignment", "time-zone"] as const)(
    "serializes owner creation against a competing %s edit",
    async (edit) => {
      const ids = await fixture(false);
      const locker = await database.pool.connect();
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM shops WHERE id=$1 FOR UPDATE", [
        ids.shopId,
      ]);
      const createdPromise = createOwnerBooking(ids.context, {
        serviceId: ids.serviceId,
        barberId: ids.barberId,
        startAt: "2026-11-02T10:07:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
        contact: { name: "Walk-in Guest", whatsappOptIn: false },
        recoveryKey: randomBytes(32).toString("base64url"),
      });
      const editPromise = (async () => {
        switch (edit) {
          case "block":
            return createTimeBlock(ids.context, {
              barberId: ids.barberId,
              date: "2026-11-02",
              timeZone: "UTC",
              start: "2026-11-02T10:00:00Z",
              end: "2026-11-02T10:30:00Z",
              note: "Competing block",
            });
          case "hide":
            return (
              await import("@/features/catalog/mutations")
            ).setServiceOffered(ids.context, {
              id: ids.serviceId,
              offered: false,
            });
          case "archive":
            return archiveService(ids.context, ids.serviceId);
          case "assignment":
            return saveService(ids.context, {
              id: ids.serviceId,
              name: "Cut",
              priceUsd: "25",
              durationMinutes: "30",
              offered: true,
              barberIds: [],
            });
          case "time-zone": {
            const shop = (
              await database.pool.query(
                "SELECT name, public_contact FROM shops WHERE id=$1",
                [ids.shopId],
              )
            ).rows[0];
            return updateOwnShop(ids.context, {
              name: shop.name,
              publicContact: shop.public_contact,
              timeZone: "America/Chicago",
            });
          }
        }
      })();

      try {
        await waitForLockWaiters(
          database.pool,
          locker,
          2,
          ["owner_create", "shop_edit"],
          { description: `owner creation versus ${edit} edit` },
        );
        await locker.query("COMMIT");
        const [created, changed] = await Promise.all([
          createdPromise,
          editPromise,
        ]);
        if (edit === "hide") {
          expect(changed.success).toBe(true);
          if (!created.success)
            expect(created).toMatchObject({
              success: false,
              error: { code: "STALE_OFFER" },
            });
        } else {
          expect(created.success && changed.success).toBe(false);
        }

        const state = await database.pool.query(
          `SELECT
          (SELECT count(*)::int FROM bookings WHERE shop_id=$1) AS bookings,
          (SELECT count(*)::int FROM occupied_intervals WHERE shop_id=$1) AS occupancy,
          (SELECT count(*)::int FROM notification_work w JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1) AS work,
          (SELECT count(*)::int FROM time_blocks b JOIN occupied_intervals o ON o.id=b.id WHERE o.shop_id=$1) AS blocks,
          (SELECT offered FROM services WHERE id=$2) AS offered,
          (SELECT archived FROM services WHERE id=$2) AS archived,
          (SELECT count(*)::int FROM barber_services WHERE service_id=$2 AND barber_id=$3) AS assignment,
          (SELECT time_zone FROM shops WHERE id=$1) AS time_zone,
          (SELECT service_name FROM bookings WHERE shop_id=$1 LIMIT 1) AS saved_service`,
          [ids.shopId, ids.serviceId, ids.barberId],
        );
        const final = state.rows[0];
        if (final.bookings) {
          expect(final).toMatchObject({
            bookings: 1,
            work: 1,
            archived: false,
            assignment: 1,
            time_zone: "UTC",
            saved_service: "Cut",
          });
          expect(final.occupancy).toBe(1);
          if (edit === "block") expect(final.blocks).toBe(0);
          if (edit === "hide") expect(final.offered).toBe(false);
          else expect(final.offered).toBe(true);
        } else {
          expect(final).toMatchObject({ bookings: 0, work: 0 });
          expect(final.occupancy).toBe(edit === "block" ? 1 : 0);
          if (edit === "block") expect(final.blocks).toBe(1);
          if (edit === "hide") expect(final.offered).toBe(false);
          if (edit === "archive") expect(final.archived).toBe(true);
          if (edit === "assignment") expect(final.assignment).toBe(0);
          if (edit === "time-zone")
            expect(final.time_zone).toBe("America/Chicago");
        }
      } finally {
        await locker.query("ROLLBACK").catch(() => undefined);
        locker.release();
      }
    },
  );

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

  it("owner conflict resolution names every protected booking affected by barber archival", async () => {
    const ids = await fixture();
    const first = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids, {
        contact: {
          name: "Ada Lovelace",
          email: "ada@example.test",
          whatsappOptIn: false,
        },
      }),
    );
    const second = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids, {
        startAt: "2026-11-02T11:00:00.000Z",
        contact: {
          name: "Grace Hopper",
          email: "grace@example.test",
          whatsappOptIn: false,
        },
      }),
    );
    expect(first.success && second.success).toBe(true);
    if (!first.success || !second.success)
      throw new Error("Booking fixture failed.");

    await expect(
      archiveBarber(ids.context, ids.barberId),
    ).resolves.toMatchObject({
      success: false,
      error: {
        code: "BOOKING_CONFLICT",
        bookingConflicts: [
          {
            bookingId: first.data.bookingId,
            customerName: "Ada Lovelace",
            serviceName: "Cut",
            barberName: "Sam",
            startAt: "2026-11-02T10:00:00.000Z",
            endAt: "2026-11-02T10:30:00.000Z",
          },
          {
            bookingId: second.data.bookingId,
            customerName: "Grace Hopper",
            serviceName: "Cut",
            barberName: "Sam",
            startAt: "2026-11-02T11:00:00.000Z",
            endAt: "2026-11-02T11:30:00.000Z",
          },
        ],
      },
    });
  });

  it("owner conflict resolution excludes foreign, cancelled, and ended bookings", async () => {
    const ids = await fixture();
    const other = await fixture();
    const createAt = async (
      owner: Awaited<ReturnType<typeof fixture>>,
      startAt: string,
      name: string,
    ) => {
      const result = await createPublicBooking(
        { shopId: owner.shopId },
        input(owner, {
          startAt,
          contact: {
            name,
            email: `${name.replaceAll(" ", "")}@example.test`,
            whatsappOptIn: false,
          },
        }),
      );
      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Booking fixture failed.");
      return result.data.bookingId;
    };
    await createAt(ids, "2026-11-02T09:00:00.000Z", "Ended");
    const protectedId = await createAt(
      ids,
      "2026-11-02T10:00:00.000Z",
      "Protected",
    );
    const cancelledId = await createAt(
      ids,
      "2026-11-02T11:00:00.000Z",
      "Cancelled",
    );
    await createAt(other, "2026-11-02T10:00:00.000Z", "Foreign");
    const { cancelOwnerBooking } = await import("../mutations");
    expect(
      await cancelOwnerBooking(ids.context, {
        bookingId: cancelledId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
      }),
    ).toMatchObject({ success: true });
    vi.setSystemTime(new Date("2026-11-02T09:30:00.000Z"));

    const result = await archiveBarber(ids.context, ids.barberId);
    expect(result).toMatchObject({
      success: false,
      error: { code: "BOOKING_CONFLICT" },
    });
    if (result.success)
      throw new Error("Protected booking should block archival.");
    expect(result.error.bookingConflicts).toEqual([
      {
        bookingId: protectedId,
        customerName: "Protected",
        serviceName: "Cut",
        barberName: "Sam",
        startAt: "2026-11-02T10:00:00.000Z",
        endAt: "2026-11-02T10:30:00.000Z",
      },
    ]);
  });

  it("owner conflict resolution does not expose another shop's booking", async () => {
    const ids = await fixture();
    const other = await fixture();
    const booking = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    expect(booking.success).toBe(true);
    if (!booking.success) throw new Error("Booking fixture failed.");

    await expect(
      archiveBarber(other.context, ids.barberId),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("owner conflict resolution reports only bookings for a removed service assignment", async () => {
    const ids = await fixture();
    const secondBarber = await saveBarber(ids.context, {
      name: "Lee",
      serviceIds: [],
    });
    expect(secondBarber.success).toBe(true);
    if (!secondBarber.success) throw new Error("Barber fixture failed.");
    const booked = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    expect(booked.success).toBe(true);
    if (!booked.success) throw new Error("Booking fixture failed.");

    await expect(
      saveService(ids.context, {
        id: ids.serviceId,
        name: "Cut",
        priceUsd: "25",
        durationMinutes: "30",
        offered: true,
        barberIds: [secondBarber.data.id],
      }),
    ).resolves.toMatchObject({
      success: false,
      error: {
        code: "BOOKING_CONFLICT",
        bookingConflicts: [
          {
            bookingId: booked.data.bookingId,
            customerName: "Ada Lovelace",
            serviceName: "Cut",
            barberName: "Sam",
          },
        ],
      },
    });
  });

  it("owner conflict resolution reports bookings for a removed barber assignment", async () => {
    const ids = await fixture();
    const booking = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    expect(booking.success).toBe(true);
    if (!booking.success) throw new Error("Booking fixture failed.");

    await expect(
      saveBarber(ids.context, {
        id: ids.barberId,
        name: "Sam",
        serviceIds: [],
      }),
    ).resolves.toMatchObject({
      success: false,
      error: {
        code: "BOOKING_CONFLICT",
        bookingConflicts: [{ bookingId: booking.data.bookingId }],
      },
    });
  });

  it("owner conflict resolution blocks service archival while allowing it to be hidden", async () => {
    const ids = await fixture();
    const booking = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    expect(booking.success).toBe(true);
    if (!booking.success) throw new Error("Booking fixture failed.");
    const { setServiceOffered } = await import("@/features/catalog/mutations");

    await expect(
      setServiceOffered(ids.context, { id: ids.serviceId, offered: false }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      archiveService(ids.context, ids.serviceId),
    ).resolves.toMatchObject({
      success: false,
      error: {
        code: "BOOKING_CONFLICT",
        bookingConflicts: [{ bookingId: booking.data.bookingId }],
      },
    });
  });

  it("owner conflict resolution names every booking excluded by changed shop hours", async () => {
    const ids = await fixture();
    const bookings = [];
    for (const [index, startAt] of [
      "2026-11-02T10:00:00.000Z",
      "2026-11-02T10:30:00.000Z",
    ].entries()) {
      const result = await createPublicBooking(
        { shopId: ids.shopId },
        input(ids, {
          startAt,
          contact: {
            name: `Customer ${index}`,
            email: `customer${index}@example.test`,
            whatsappOptIn: false,
          },
        }),
      );
      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Booking fixture failed.");
      bookings.push(result.data.bookingId);
    }

    await expect(
      saveShopSchedule(ids.context, {
        week: Array.from({ length: 7 }, (_, index) => ({
          working: index === 0 ? [{ start: 660, end: 1020 }] : [],
          breaks: [],
        })),
        revision: 1,
      }),
    ).resolves.toMatchObject({
      success: false,
      error: {
        code: "BOOKING_CONFLICT",
        bookingConflicts: [
          { bookingId: bookings[0] },
          { bookingId: bookings[1] },
        ],
      },
    });
  });

  it.each([
    "barber recurring hours",
    "shop recurring break",
    "barber recurring break",
    "shop dated replacement",
    "shop dated break",
    "shop closure",
    "barber dated replacement",
    "barber dated break",
    "barber day off",
  ] as const)(
    "owner conflict resolution names bookings excluded by %s",
    async (kind) => {
      const ids = await fixture();
      const booking = await createPublicBooking(
        { shopId: ids.shopId },
        input(ids),
      );
      expect(booking.success).toBe(true);
      if (!booking.success) throw new Error("Booking fixture failed.");
      const replacement = { working: [{ start: 660, end: 1020 }], breaks: [] };
      const replacementWeek = Array.from({ length: 7 }, (_, index) => ({
        working: index === 0 ? replacement.working : [],
        breaks: [],
      }));
      const recurringBreakWeek = Array.from({ length: 7 }, (_, index) => ({
        working: index === 0 ? [{ start: 540, end: 1020 }] : [],
        breaks: index === 0 ? [{ start: 600, end: 630 }] : [],
      }));
      const replacementWithBreak = {
        working: [{ start: 540, end: 1020 }],
        breaks: [{ start: 600, end: 630 }],
      };
      let result;
      switch (kind) {
        case "barber recurring hours":
          result = await saveBarberSchedule(ids.context, {
            barberId: ids.barberId,
            week: replacementWeek,
            revision: 1,
          });
          break;
        case "shop recurring break":
          result = await saveShopSchedule(ids.context, {
            week: recurringBreakWeek,
            revision: 1,
          });
          break;
        case "barber recurring break":
          result = await saveBarberSchedule(ids.context, {
            barberId: ids.barberId,
            week: recurringBreakWeek,
            revision: 1,
          });
          break;
        case "shop dated replacement":
          result = await saveShopDateSchedule(ids.context, {
            date: "2026-11-02",
            timeZone: "UTC",
            override: replacement,
            closed: false,
            revision: 0,
          });
          break;
        case "shop dated break":
          result = await saveShopDateSchedule(ids.context, {
            date: "2026-11-02",
            timeZone: "UTC",
            override: replacementWithBreak,
            closed: false,
            revision: 0,
          });
          break;
        case "shop closure":
          result = await saveShopDateSchedule(ids.context, {
            date: "2026-11-02",
            timeZone: "UTC",
            override: null,
            closed: true,
            revision: 0,
          });
          break;
        case "barber dated replacement":
          result = await saveBarberDateSchedule(ids.context, {
            barberId: ids.barberId,
            date: "2026-11-02",
            timeZone: "UTC",
            override: replacement,
            closed: false,
            revision: 0,
          });
          break;
        case "barber dated break":
          result = await saveBarberDateSchedule(ids.context, {
            barberId: ids.barberId,
            date: "2026-11-02",
            timeZone: "UTC",
            override: replacementWithBreak,
            closed: false,
            revision: 0,
          });
          break;
        case "barber day off":
          result = await saveBarberDateSchedule(ids.context, {
            barberId: ids.barberId,
            date: "2026-11-02",
            timeZone: "UTC",
            override: null,
            closed: true,
            revision: 0,
          });
          break;
      }
      expect(result).toMatchObject({
        success: false,
        error: {
          code: "BOOKING_CONFLICT",
          bookingConflicts: [{ bookingId: booking.data.bookingId }],
        },
      });
    },
  );

  it("owner conflict resolution names the booking blocked by a time block", async () => {
    const ids = await fixture();
    const booking = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    expect(booking.success).toBe(true);
    if (!booking.success) throw new Error("Booking fixture failed.");

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
      error: {
        code: "BOOKING_CONFLICT",
        bookingConflicts: [
          {
            bookingId: booking.data.bookingId,
            customerName: "Ada Lovelace",
            serviceName: "Cut",
            barberName: "Sam",
          },
        ],
      },
    });
  });

  it("owner conflict resolution keeps stale configuration retries on the existing revision guard", async () => {
    const ids = await fixture();
    const booking = await createPublicBooking(
      { shopId: ids.shopId },
      input(ids),
    );
    expect(booking.success).toBe(true);
    if (!booking.success) throw new Error("Booking fixture failed.");
    const rejectedDraft = Array.from({ length: 7 }, (_, index) => ({
      working: index === 0 ? [{ start: 660, end: 1020 }] : [],
      breaks: [],
    }));
    await expect(
      saveShopSchedule(ids.context, { week: rejectedDraft, revision: 1 }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "BOOKING_CONFLICT" },
    });

    const { cancelOwnerBooking } = await import("../mutations");
    expect(
      await cancelOwnerBooking(ids.context, {
        bookingId: booking.data.bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
      }),
    ).toMatchObject({ success: true });
    await expect(
      saveShopSchedule(ids.context, { week, revision: 1 }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      saveShopSchedule(ids.context, { week: rejectedDraft, revision: 1 }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "STALE_SCHEDULE" },
    });
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
