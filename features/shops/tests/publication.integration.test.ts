import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate.mts";
import { openTestDatabase } from "@/tests/support/database";
import { shopInput } from "@/tests/support/shops";
import type { WeeklySchedule } from "@/features/availability/types";

describe("shop publication", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let closeApplicationPool: (() => Promise<void>) | undefined;
  let testAuth: typeof import("@/tests/support/auth").testAuth;
  let readOwnerContext: typeof import("@/server/owner-context").readOwnerContext;
  let createShop: typeof import("../mutations").createShop;
  let setOwnShopPublication: typeof import("../mutations").setOwnShopPublication;
  let getOwnShop: typeof import("../queries").getOwnShop;
  let getOwnPublicationReadiness: typeof import("../queries").getOwnPublicationReadiness;
  let saveBarber: typeof import("@/features/barbers/mutations").saveBarber;
  let saveService: typeof import("@/features/catalog/mutations").saveService;
  let saveShopSchedule: typeof import("@/features/availability/mutations").saveShopSchedule;
  let saveBarberSchedule: typeof import("@/features/availability/mutations").saveBarberSchedule;
  const userIds: string[] = [];

  beforeAll(async () => {
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
    ({ createShop, setOwnShopPublication } = await import("../mutations"));
    ({ getOwnShop, getOwnPublicationReadiness } = await import("../queries"));
    ({ saveBarber } = await import("@/features/barbers/mutations"));
    ({ saveService } = await import("@/features/catalog/mutations"));
    ({ saveShopSchedule, saveBarberSchedule } =
      await import("@/features/availability/mutations"));
    const { pool } = await import("@/db");
    pool.options.max = 5;
    closeApplicationPool = () => pool.end();
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
  });

  async function owner() {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `publication-${randomUUID()}@example.test`,
        name: "Publication Owner",
      }),
    );
    userIds.push(user.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: user.id })).headers,
    );
    const created = await createShop(
      context,
      shopInput({ subdomain: `publish-${randomUUID().slice(0, 8)}` }),
    );
    expect(created.success).toBe(true);
    return context!;
  }

  async function makeReady(
    context: NonNullable<Awaited<ReturnType<typeof owner>>>,
  ) {
    const week: WeeklySchedule = Array.from({ length: 7 }, (_, day) => ({
      working: day === 0 ? [{ start: 540, end: 600 }] : [],
      breaks: [],
    }));
    expect(
      (await saveShopSchedule(context, { week, revision: 0 })).success,
    ).toBe(true);
    const barber = await saveBarber(context, {
      name: "Lock Test Barber",
      serviceIds: [],
    });
    expect(barber.success).toBe(true);
    if (!barber.success) throw new Error("Barber fixture failed.");
    const service = await saveService(context, {
      name: "Lock Test Cut",
      priceUsd: "30",
      durationMinutes: "35",
      offered: true,
      barberIds: [barber.data.id],
    });
    expect(service.success).toBe(true);
    if (!service.success) throw new Error("Service fixture failed.");
    return context;
  }

  it("requires actionable structural readiness, then publishes and unpublishes only the owner's shop", async () => {
    const context = await owner();
    expect(await getOwnPublicationReadiness(context)).toEqual({
      ready: false,
      missing: [
        "an offered service",
        "an active barber assigned to a service",
        "shared recurring hours with a complete 15-minute-grid start",
      ],
    });
    expect(
      await setOwnShopPublication(context, {
        published: true,
        expectedPublished: false,
      }),
    ).toMatchObject({ success: false, error: { code: "NOT_READY" } });
    expect(await getOwnShop(context)).toMatchObject({ published: false });

    const week: WeeklySchedule = Array.from({ length: 7 }, (_, day) => ({
      working: day === 0 ? [{ start: 540, end: 600 }] : [],
      breaks: [],
    }));
    expect(
      (await saveShopSchedule(context, { week, revision: 0 })).success,
    ).toBe(true);
    const barber = await saveBarber(context, { name: "Sam", serviceIds: [] });
    expect(barber.success).toBe(true);
    if (!barber.success) return;
    const service = await saveService(context, {
      name: "Cut",
      priceUsd: "30",
      durationMinutes: "35",
      offered: true,
      barberIds: [barber.data.id],
    });
    expect(service.success).toBe(true);
    expect(await getOwnPublicationReadiness(context)).toEqual({
      ready: true,
      missing: [],
    });
    expect(
      await setOwnShopPublication(context, {
        published: true,
        expectedPublished: false,
      }),
    ).toMatchObject({ success: true, data: { published: true } });
    expect(
      await setOwnShopPublication(context, {
        published: true,
        expectedPublished: false,
      }),
    ).toMatchObject({ success: true, data: { published: true } });
    expect(
      await setOwnShopPublication(context, {
        published: false,
        expectedPublished: false,
      }),
    ).toMatchObject({ success: false, error: { code: "STALE_PUBLICATION" } });
    expect(
      await setOwnShopPublication(context, {
        published: false,
        expectedPublished: true,
      }),
    ).toMatchObject({ success: true, data: { published: false } });
    expect(await getOwnShop(context)).toMatchObject({ published: false });
  });

  it("denies unsigned callers and rejects authority fields", async () => {
    expect(
      await setOwnShopPublication(null, {
        published: true,
        expectedPublished: false,
      }),
    ).toMatchObject({ success: false, error: { code: "UNAUTHENTICATED" } });
    const context = await owner();
    expect(
      await setOwnShopPublication(context, {
        published: true,
        expectedPublished: false,
        shopId: randomUUID(),
        ownerId: "attacker",
      }),
    ).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("checks shared recurring hours structurally and still permits unpublication after readiness is lost", async () => {
    const context = await owner();
    const fullWeek: WeeklySchedule = Array.from({ length: 7 }, (_, day) => ({
      working: day === 0 ? [{ start: 540, end: 600 }] : [],
      breaks: [],
    }));
    expect(
      (await saveShopSchedule(context, { week: fullWeek, revision: 0 }))
        .success,
    ).toBe(true);
    const barber = await saveBarber(context, { name: "Sam", serviceIds: [] });
    expect(barber.success).toBe(true);
    if (!barber.success) return;
    const service = await saveService(context, {
      name: "Cut",
      priceUsd: "30",
      durationMinutes: "35",
      offered: true,
      barberIds: [barber.data.id],
    });
    expect(service.success).toBe(true);
    if (!service.success) return;
    const tooShort: WeeklySchedule = fullWeek.map((day, index) => ({
      ...day,
      working: index === 0 ? [{ start: 540, end: 570 }] : [],
    }));
    expect(
      (
        await saveBarberSchedule(context, {
          barberId: barber.data.id,
          revision: 1,
          week: tooShort,
        })
      ).success,
    ).toBe(true);
    expect(await getOwnPublicationReadiness(context)).toMatchObject({
      ready: false,
      missing: ["shared recurring hours with a complete 15-minute-grid start"],
    });
    expect(
      await setOwnShopPublication(context, {
        published: true,
        expectedPublished: false,
      }),
    ).toMatchObject({ success: false, error: { code: "NOT_READY" } });

    expect(
      (
        await saveBarberSchedule(context, {
          barberId: barber.data.id,
          revision: 2,
          week: fullWeek,
        })
      ).success,
    ).toBe(true);
    const shop = await getOwnShop(context);
    await database.pool.query(
      "INSERT INTO shop_date_schedules (shop_id, date, override, closed, revision) VALUES ($1, '2026-11-02', NULL, true, 1)",
      [shop!.id],
    );
    expect(await getOwnPublicationReadiness(context)).toEqual({
      ready: true,
      missing: [],
    });
    expect(
      (
        await setOwnShopPublication(context, {
          published: true,
          expectedPublished: false,
        })
      ).success,
    ).toBe(true);
    expect(
      (
        await saveBarberSchedule(context, {
          barberId: barber.data.id,
          revision: 3,
          week: tooShort,
        })
      ).success,
    ).toBe(true);
    expect(
      await setOwnShopPublication(context, {
        published: false,
        expectedPublished: true,
      }),
    ).toMatchObject({ success: true, data: { published: false } });
  });

  it("waits for a committed readiness-changing configuration transaction before publishing", async () => {
    const context = await makeReady(await owner());
    const lock = await database.pool.connect();
    let transactionOpen = true;
    let publication: ReturnType<typeof setOwnShopPublication> | undefined;
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT id FROM shops WHERE owner_id = $1 FOR UPDATE", [
        context.userId,
      ]);
      await lock.query(
        "UPDATE services SET offered = false WHERE shop_id = (SELECT id FROM shops WHERE owner_id = $1)",
        [context.userId],
      );
      publication = setOwnShopPublication(context, {
        published: true,
        expectedPublished: false,
      });
      const deadline = Date.now() + 5_000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        const state = await database.pool.query(
          `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity
             WHERE datname = current_database()
               AND state = 'active'
               AND wait_event_type = 'Lock'
               AND lower(query) LIKE '%for update%'
           ) AS waiting`,
        );
        waiting = state.rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await lock.query("COMMIT");
      transactionOpen = false;
      await expect(publication).resolves.toMatchObject({
        success: false,
        error: { code: "NOT_READY" },
      });
      expect(await getOwnShop(context)).toMatchObject({ published: false });
    } finally {
      if (transactionOpen) await lock.query("ROLLBACK");
      await publication?.catch(() => undefined);
      lock.release();
    }
  }, 15_000);

  it("serializes competing desired publication commands into complete states", async () => {
    const context = await makeReady(await owner());
    expect(
      await setOwnShopPublication(context, {
        published: true,
        expectedPublished: false,
      }),
    ).toMatchObject({ success: true, data: { published: true } });
    const results = await Promise.all([
      setOwnShopPublication(context, {
        published: false,
        expectedPublished: true,
      }),
      setOwnShopPublication(context, {
        published: true,
        expectedPublished: false,
      }),
    ]);
    expect(results.every((result) => result.success)).toBe(true);
    expect([true, false]).toContain((await getOwnShop(context))?.published);
  });
});
