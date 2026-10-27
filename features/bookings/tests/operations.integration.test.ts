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
  let saveBarberSchedule: typeof import("@/features/availability/mutations").saveBarberSchedule;
  let saveShopDateSchedule: typeof import("@/features/availability/mutations").saveShopDateSchedule;
  let createTimeBlock: typeof import("@/features/availability/mutations").createTimeBlock;
  let setOwnShopPublication: typeof import("@/features/shops/mutations").setOwnShopPublication;
  let updateOwnShop: typeof import("@/features/shops/mutations").updateOwnShop;
  let createPublicBooking: typeof import("../mutations").createPublicBooking;
  let createOwnerBooking: typeof import("../mutations").createOwnerBooking;
  let getOwnCalendar: typeof import("../queries").getOwnCalendar;
  let getOwnAppointment: typeof import("../queries").getOwnAppointment;
  let getOwnNotificationActivity: typeof import("@/features/notifications/queries").getOwnNotificationActivity;
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
    ({
      saveShopSchedule,
      saveBarberSchedule,
      saveShopDateSchedule,
      createTimeBlock,
    } = await import("@/features/availability/mutations"));
    ({ createPublicBooking } = await import("../mutations"));
    ({ createOwnerBooking } = await import("../mutations"));
    ({ getOwnCalendar, getOwnAppointment } = await import("../queries"));
    ({ getOwnNotificationActivity } =
      await import("@/features/notifications/queries"));
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
      await vi.waitFor(
        async () => {
          const blocked = await database.pool
            .query(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE OF s%'`);
          expect(blocked.rows[0].count).toBeGreaterThan(0);
        },
        { timeout: 5000, interval: 50 },
      );
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
        await vi.waitFor(
          async () => {
            const waiting = await database.pool
              .query(`SELECT count(*)::int AS count
            FROM pg_stat_activity WHERE datname=current_database()
              AND wait_event_type='Lock' AND pid <> pg_backend_pid()
              AND query LIKE '%FOR UPDATE%'`);
            expect(waiting.rows[0].count).toBeGreaterThanOrEqual(2);
          },
          { timeout: 5000, interval: 50 },
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
