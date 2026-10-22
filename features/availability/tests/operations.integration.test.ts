import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "@/db/migrate.mts";
import { openTestDatabase } from "@/tests/support/database";
import { shopInput } from "@/tests/support/shops";
import type { WeeklySchedule } from "../types";

const week = (
  monday: { start: number; end: number },
  sunday = { start: 0, end: 0 },
): WeeklySchedule =>
  Array.from({ length: 7 }, (_, index) => ({
    working:
      index === 0
        ? [monday]
        : index === 6 && sunday.end > sunday.start
          ? [sunday]
          : [],
    breaks:
      index === 0 && monday.start <= 600 && monday.end >= 615
        ? [{ start: 600, end: 615 }]
        : [],
  }));

describe("availability operations", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let applicationPool: Pool;
  let closeApplicationPool: (() => Promise<void>) | undefined;
  let testAuth: typeof import("@/tests/support/auth").testAuth;
  let readOwnerContext: typeof import("@/server/owner-context").readOwnerContext;
  let createShop: typeof import("@/features/shops/mutations").createShop;
  let saveBarber: typeof import("@/features/barbers/mutations").saveBarber;
  let archiveBarber: typeof import("@/features/barbers/mutations").archiveBarber;
  let saveService: typeof import("@/features/catalog/mutations").saveService;
  let setServiceOffered: typeof import("@/features/catalog/mutations").setServiceOffered;
  let saveShopSchedule: typeof import("../mutations").saveShopSchedule;
  let saveBarberSchedule: typeof import("../mutations").saveBarberSchedule;
  let getOwnSchedules: typeof import("../queries").getOwnSchedules;
  let previewOwnSlots: typeof import("../queries").previewOwnSlots;
  const userIds: string[] = [];

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
    database = await openTestDatabase();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.BETTER_AUTH_URL = "http://app.localhost:3100";
    process.env.BETTER_AUTH_SECRET =
      "test-secret-that-is-long-enough-for-better-auth";
    process.env.GOOGLE_CLIENT_ID = "test-google-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
    await applyMigrations(database.pool, "db/migrations");
    ({ testAuth } = await import("@/tests/support/auth"));
    ({ readOwnerContext } = await import("@/server/owner-context"));
    ({ createShop } = await import("@/features/shops/mutations"));
    ({ saveBarber, archiveBarber } =
      await import("@/features/barbers/mutations"));
    ({ saveService, setServiceOffered } =
      await import("@/features/catalog/mutations"));
    ({ saveShopSchedule, saveBarberSchedule } = await import("../mutations"));
    ({ getOwnSchedules, previewOwnSlots } = await import("../queries"));
    ({ pool: applicationPool } = await import("@/db"));
    applicationPool.options.max = 5;
    closeApplicationPool = () => applicationPool.end();
  });

  afterAll(async () => {
    await database?.pool.query(
      'DELETE FROM "shops" WHERE owner_id = ANY($1::text[])',
      [userIds],
    );
    await Promise.all(
      userIds.map((id) =>
        testAuth.$context.then(({ test }) => test.deleteUser(id)),
      ),
    );
    await closeApplicationPool?.();
    await database?.pool.end();
    vi.useRealTimers();
  });

  async function owner() {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `availability-${randomUUID()}@example.test`,
        name: "Availability Owner",
      }),
    );
    userIds.push(user.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: user.id })).headers,
    );
    await createShop(
      context,
      shopInput({ subdomain: `availability-${randomUUID().slice(0, 8)}` }),
    );
    return context!;
  }

  it("copies the first saved shop week to active barbers, then preserves independent revisions and rejects stale saves", async () => {
    const context = await owner();
    const first = await saveBarber(context, { name: "Sam", serviceIds: [] });
    const second = await saveBarber(context, { name: "Lee", serviceIds: [] });
    expect(first.success && second.success).toBe(true);
    if (!first.success || !second.success) return;
    expect(
      (await getOwnSchedules(context))?.barbers.map(
        ({ schedule }) => schedule.revision,
      ),
    ).toEqual([0, 0]);
    expect(
      await saveBarberSchedule(context, {
        barberId: first.data.id,
        revision: 0,
        week: week({ start: 550, end: 660 }),
      }),
    ).toMatchObject({
      success: false,
      error: { code: "SHOP_SCHEDULE_REQUIRED" },
    });
    const saved = await saveShopSchedule(context, {
      week: week({ start: 550, end: 660 }),
      revision: 0,
    });
    expect(saved).toMatchObject({ success: true, data: { revision: 1 } });
    const schedules = await getOwnSchedules(context);
    expect(schedules?.barbers.map(({ schedule }) => schedule)).toEqual([
      { week: week({ start: 550, end: 660 }), revision: 1 },
      { week: week({ start: 550, end: 660 }), revision: 1 },
    ]);
    if (!first.success || !saved.success) return;

    const independent = await saveBarberSchedule(context, {
      barberId: first.data.id,
      revision: 1,
      week: week({ start: 615, end: 660 }),
    });
    expect(independent).toMatchObject({ success: true, data: { revision: 2 } });
    const shopEdit = await saveShopSchedule(context, {
      week: week({ start: 540, end: 720 }),
      revision: 1,
    });
    expect(shopEdit).toMatchObject({ success: true, data: { revision: 2 } });
    const laterBarber = await saveBarber(context, {
      name: "New barber",
      serviceIds: [],
    });
    expect(laterBarber.success).toBe(true);
    if (laterBarber.success)
      expect(
        (await getOwnSchedules(context))?.barbers.find(
          ({ id }) => id === laterBarber.data.id,
        )?.schedule,
      ).toEqual({ week: week({ start: 540, end: 720 }), revision: 1 });
    expect(
      await saveBarberSchedule(context, {
        barberId: first.data.id,
        revision: 1,
        week: week({ start: 600, end: 660 }),
      }),
    ).toMatchObject({ success: false, error: { code: "STALE_SCHEDULE" } });
    const latest = await getOwnSchedules(context);
    expect(
      latest?.barbers.find(({ id }) => id === first.data.id)?.schedule,
    ).toEqual(independent.success && independent.data);
    if (second.success) {
      expect(
        latest?.barbers.find(({ id }) => id === second.data.id)?.schedule.week,
      ).toEqual(week({ start: 550, end: 660 }));
    }

    const concurrent = await Promise.all([
      saveShopSchedule(context, {
        week: week({ start: 540, end: 660 }),
        revision: 2,
      }),
      saveShopSchedule(context, {
        week: week({ start: 600, end: 720 }),
        revision: 2,
      }),
    ]);
    expect(concurrent.filter((result) => result.success)).toHaveLength(1);
    expect(
      concurrent.filter(
        (result) => !result.success && result.error.code === "STALE_SCHEDULE",
      ),
    ).toHaveLength(1);
  });

  it("creates exactly one initial barber snapshot when shop setup races barber creation", async () => {
    const context = await owner();
    const shopWeek = week({ start: 555, end: 690 });
    const [created, configured] = await Promise.all([
      saveBarber(context, { name: "Race barber", serviceIds: [] }),
      saveShopSchedule(context, { week: shopWeek, revision: 0 }),
    ]);
    expect(created.success && configured.success).toBe(true);
    if (!created.success || !configured.success) return;
    expect(
      (await getOwnSchedules(context))?.barbers.find(
        ({ id }) => id === created.data.id,
      )?.schedule,
    ).toEqual({ week: shopWeek, revision: 1 });
  });

  it("rolls barber creation back when its schedule snapshot fails", async () => {
    const context = await owner();
    await saveShopSchedule(context, {
      week: week({ start: 540, end: 660 }),
      revision: 0,
    });
    const { rows } = await database.pool.query<{ id: string }>(
      'SELECT id FROM "shops" WHERE owner_id = $1',
      [context.userId],
    );
    const shopId = rows[0]!.id;
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `availability_copy_fail_${suffix}`;
    const triggerName = `availability_copy_fail_${suffix}`;
    await database.pool.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture-scoped schedule copy failure'; END $$
    `);
    await database.pool.query(`
      CREATE TRIGGER ${triggerName} BEFORE INSERT ON barber_schedules
      FOR EACH ROW WHEN (NEW.shop_id = '${shopId}')
      EXECUTE FUNCTION ${functionName}()
    `);
    try {
      const created = await saveBarber(context, {
        name: "Must roll back",
        serviceIds: [],
      });
      expect(created.success).toBe(false);
      expect(
        await database.pool.query(
          "SELECT id FROM barbers WHERE shop_id = $1 AND name = 'Must roll back'",
          [shopId],
        ),
      ).toMatchObject({ rowCount: 0 });
    } finally {
      await database.pool.query(
        `DROP TRIGGER IF EXISTS ${triggerName} ON barber_schedules`,
      );
      await database.pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }
  });

  it("denies malformed and signed-out saves and previews only eligible same-shop pairs", async () => {
    expect(
      await saveShopSchedule(null, {
        week: week({ start: 540, end: 660 }),
        revision: 0,
      }),
    ).toMatchObject({ success: false, error: { code: "UNAUTHENTICATED" } });
    const context = await owner();
    expect(
      await saveShopSchedule(context, { week: [], revision: 0 }),
    ).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
    const service = await saveService(context, {
      name: "Cut",
      priceUsd: "12",
      durationMinutes: "35",
      offered: true,
      barberIds: [],
    });
    expect(service.success).toBe(true);
    if (!service.success) return;
    const barber = await saveBarber(context, {
      name: "Preview barber",
      serviceIds: [service.data.id],
    });
    expect(barber.success).toBe(true);
    if (!barber.success) return;
    const sunday = Array.from({ length: 7 }, (_, index) => ({
      working: index === 6 ? [{ start: 0, end: 240 }] : [],
      breaks: [],
    }));
    expect(
      await saveShopSchedule(context, { week: sunday, revision: 0 }),
    ).toMatchObject({ success: true });
    const preview = await previewOwnSlots(context, {
      serviceId: service.data.id,
      barberId: barber.data.id,
      date: "2026-11-01",
    });
    expect(preview).toMatchObject({
      success: true,
      data: { timeZone: "America/New_York", date: "2026-11-01" },
    });
    if (preview.success)
      expect(
        preview.data.slots
          .filter(({ localStart }) => localStart === "01:30")
          .map(({ start, offset }) => [start, offset]),
      ).toEqual([
        ["2026-11-01T05:30:00Z", "-04:00"],
        ["2026-11-01T06:30:00Z", "-05:00"],
      ]);
    expect(
      await previewOwnSlots(context, {
        serviceId: service.data.id,
        barberId: randomUUID(),
        date: "2026-11-01",
      }),
    ).toMatchObject({ success: false, error: { code: "INVALID_PAIRING" } });
  });

  it("previews the saved shop and barber intersection for the exact current service duration", async () => {
    const context = await owner();
    const service = await saveService(context, {
      name: "Boundary cut",
      priceUsd: "12",
      durationMinutes: "35",
      offered: true,
      barberIds: [],
    });
    expect(service.success).toBe(true);
    if (!service.success) return;
    const barber = await saveBarber(context, {
      name: "Boundary barber",
      serviceIds: [service.data.id],
    });
    expect(barber.success).toBe(true);
    if (!barber.success) return;

    const shopWeek = Array.from({ length: 7 }, (_, index) => ({
      working: index === 0 ? [{ start: 540, end: 660 }] : [],
      breaks: [],
    }));
    const barberWeek = shopWeek.map((day, index) => ({
      ...day,
      working: index === 0 ? [{ start: 555, end: 630 }] : [],
      breaks: index === 0 ? [{ start: 600, end: 615 }] : [],
    }));
    await saveShopSchedule(context, { week: shopWeek, revision: 0 });
    await saveBarberSchedule(context, {
      barberId: barber.data.id,
      revision: 1,
      week: barberWeek,
    });

    const preview = (date: string) =>
      previewOwnSlots(context, {
        serviceId: service.data.id,
        barberId: barber.data.id,
        date,
      });
    const slots = await preview("2026-11-02");
    expect(slots).toMatchObject({
      success: true,
      data: { slots: [{ localStart: "09:15", end: "2026-11-02T14:50:00Z" }] },
    });

    await database.pool.query(
      "UPDATE services SET duration_minutes = 50 WHERE id = $1",
      [service.data.id],
    );
    expect(await preview("2026-11-02")).toMatchObject({
      success: true,
      data: { slots: [] },
    });
  });

  it("requires a shop and keeps foreign, hidden, and archived pairings private", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `availability-no-shop-${randomUUID()}@example.test`,
        name: "No Shop Owner",
      }),
    );
    userIds.push(user.id);
    const noShop = await readOwnerContext(
      (await helpers.login({ userId: user.id })).headers,
    );
    expect(
      await saveShopSchedule(noShop, {
        week: week({ start: 540, end: 660 }),
        revision: 0,
      }),
    ).toMatchObject({ success: false, error: { code: "SHOP_REQUIRED" } });

    const own = await owner();
    const foreign = await owner();
    const ownService = await saveService(own, {
      name: "Private cut",
      priceUsd: "12",
      durationMinutes: "35",
      offered: true,
      barberIds: [],
    });
    const foreignService = await saveService(foreign, {
      name: "Foreign cut",
      priceUsd: "13",
      durationMinutes: "40",
      offered: true,
      barberIds: [],
    });
    expect(ownService.success && foreignService.success).toBe(true);
    if (!ownService.success || !foreignService.success) return;
    const ownBarber = await saveBarber(own, {
      name: "Private barber",
      serviceIds: [ownService.data.id],
    });
    const foreignBarber = await saveBarber(foreign, {
      name: "Foreign barber",
      serviceIds: [foreignService.data.id],
    });
    expect(ownBarber.success && foreignBarber.success).toBe(true);
    if (!ownBarber.success || !foreignBarber.success) return;
    await saveShopSchedule(own, {
      week: week({ start: 540, end: 660 }),
      revision: 0,
    });

    expect(
      await saveBarberSchedule(own, {
        barberId: foreignBarber.data.id,
        revision: 1,
        week: week({ start: 540, end: 660 }),
      }),
    ).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    const preview = (serviceId: string, barberId: string) =>
      previewOwnSlots(own, { serviceId, barberId, date: "2026-11-01" });
    expect(
      await preview(foreignService.data.id, ownBarber.data.id),
    ).toMatchObject({
      success: false,
      error: { code: "INVALID_PAIRING" },
    });
    expect(
      await preview(ownService.data.id, foreignBarber.data.id),
    ).toMatchObject({
      success: false,
      error: { code: "INVALID_PAIRING" },
    });
    expect(
      await setServiceOffered(own, { id: ownService.data.id, offered: false }),
    ).toMatchObject({ success: true });
    expect(await preview(ownService.data.id, ownBarber.data.id)).toMatchObject({
      success: false,
      error: { code: "INVALID_PAIRING" },
    });
    expect(
      await setServiceOffered(own, { id: ownService.data.id, offered: true }),
    ).toMatchObject({ success: true });
    expect(await archiveBarber(own, ownBarber.data.id)).toMatchObject({
      success: true,
    });
    expect(await preview(ownService.data.id, ownBarber.data.id)).toMatchObject({
      success: false,
      error: { code: "INVALID_PAIRING" },
    });
  });
});
