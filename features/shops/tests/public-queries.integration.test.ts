import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openTestDatabase } from "@/tests/support/database";
import { shopInput } from "@/tests/support/shops";
import type { WeeklySchedule } from "@/features/availability/types";

describe("public shop reads", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let closeApplicationPool: (() => Promise<void>) | undefined;
  let testAuth: typeof import("@/tests/support/auth").testAuth;
  let readOwnerContext: typeof import("@/server/owner-context").readOwnerContext;
  let createShop: typeof import("../mutations").createShop;
  let setOwnShopPublication: typeof import("../mutations").setOwnShopPublication;
  let saveBarber: typeof import("@/features/barbers/mutations").saveBarber;
  let saveService: typeof import("@/features/catalog/mutations").saveService;
  let saveShopSchedule: typeof import("@/features/availability/mutations").saveShopSchedule;
  let getPublicShop: typeof import("../public-queries").getPublicShop;
  let previewPublicSlots: typeof import("../public-queries").previewPublicSlots;
  let publicShopExists: typeof import("../public-queries").publicShopExists;
  const userIds: string[] = [];

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
    database = await openTestDatabase();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.MARKETING_ORIGIN = "http://localhost:3100";
    process.env.BETTER_AUTH_URL = "http://app.localhost:3100";
    process.env.BETTER_AUTH_SECRET =
      "test-secret-that-is-long-enough-for-better-auth";
    process.env.GOOGLE_CLIENT_ID = "test-google-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
    ({ testAuth } = await import("@/tests/support/auth"));
    ({ readOwnerContext } = await import("@/server/owner-context"));
    ({ createShop, setOwnShopPublication } = await import("../mutations"));
    ({ saveBarber } = await import("@/features/barbers/mutations"));
    ({ saveService } = await import("@/features/catalog/mutations"));
    ({ saveShopSchedule } = await import("@/features/availability/mutations"));
    ({ getPublicShop, previewPublicSlots, publicShopExists } =
      await import("../public-queries"));
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
    vi.useRealTimers();
  });

  it("serves only the published shop's safe catalog and current eligible starts", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `public-${randomUUID()}@example.test`,
        name: "Private Owner Marker",
      }),
    );
    userIds.push(user.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: user.id })).headers,
    );
    const subdomain = `public-${randomUUID().slice(0, 8)}`;
    expect(
      (await createShop(context, shopInput({ subdomain, timeZone: "UTC" })))
        .success,
    ).toBe(true);
    const week: WeeklySchedule = Array.from({ length: 7 }, (_, day) => ({
      working: day === 0 ? [{ start: 540, end: 600 }] : [],
      breaks: [],
    }));
    expect(
      (await saveShopSchedule(context, { week, revision: 0 })).success,
    ).toBe(true);
    const barber = await saveBarber(context, {
      name: "Public Barber",
      serviceIds: [],
    });
    expect(barber.success).toBe(true);
    if (!barber.success) return;
    const service = await saveService(context, {
      name: "Public Cut",
      priceUsd: "35.00",
      durationMinutes: "35",
      offered: true,
      barberIds: [barber.data.id],
    });
    expect(service.success).toBe(true);
    if (!service.success) return;
    expect(
      (
        await setOwnShopPublication(context, {
          published: true,
          expectedPublished: false,
        })
      ).success,
    ).toBe(true);

    const headers = new Headers({ host: `${subdomain}.localhost:3100` });
    const shop = await getPublicShop(headers);
    expect(shop).toMatchObject({
      status: "published",
      name: "Juniper Barber",
      timeZone: "UTC",
      services: [
        {
          id: service.data.id,
          name: "Public Cut",
          barbers: [{ id: barber.data.id, name: "Public Barber" }],
        },
      ],
    });
    if (!shop || shop.status !== "published") return;
    expect(JSON.stringify(shop)).not.toContain(user.id);

    const otherUser = await helpers.saveUser(
      helpers.createUser({
        email: `public-${randomUUID()}@example.test`,
        name: "Other Private Owner Marker",
      }),
    );
    userIds.push(otherUser.id);
    const otherContext = await readOwnerContext(
      (await helpers.login({ userId: otherUser.id })).headers,
    );
    const otherSubdomain = `public-${randomUUID().slice(0, 8)}`;
    expect(
      (
        await createShop(
          otherContext,
          shopInput({ subdomain: otherSubdomain, timeZone: "UTC" }),
        )
      ).success,
    ).toBe(true);
    expect(
      (await saveShopSchedule(otherContext, { week, revision: 0 })).success,
    ).toBe(true);
    const otherBarber = await saveBarber(otherContext, {
      name: "Other Barber",
      serviceIds: [],
    });
    expect(otherBarber.success).toBe(true);
    if (!otherBarber.success) return;
    const otherService = await saveService(otherContext, {
      name: "Other Cut",
      priceUsd: "40.00",
      durationMinutes: "35",
      offered: true,
      barberIds: [otherBarber.data.id],
    });
    expect(otherService.success).toBe(true);
    if (!otherService.success) return;
    expect(
      (
        await setOwnShopPublication(otherContext, {
          published: true,
          expectedPublished: false,
        })
      ).success,
    ).toBe(true);
    expect(shop?.services.map(({ id }) => id)).toEqual([service.data.id]);
    const otherShop = await getPublicShop(
      new Headers({ host: `${otherSubdomain}.localhost:3100` }),
    );
    expect(otherShop?.status).toBe("published");
    if (!otherShop || otherShop.status !== "published") return;
    expect(otherShop.services.map(({ id }) => id)).toEqual([
      otherService.data.id,
    ]);
    expect(
      await previewPublicSlots(headers, {
        serviceId: otherService.data.id,
        barberId: otherBarber.data.id,
        date: "2026-11-02",
      }),
    ).toBeNull();

    const preview = await previewPublicSlots(headers, {
      serviceId: service.data.id,
      barberId: barber.data.id,
      date: "2026-11-02",
    });
    expect(
      preview?.slots.map(({ localStart, end }) => [localStart, end]),
    ).toEqual([
      ["09:00", "2026-11-02T09:35:00Z"],
      ["09:15", "2026-11-02T09:50:00Z"],
    ]);

    const unassignedServiceId = randomUUID();
    const [{ id: shopId }] = (
      await database.pool.query("SELECT id FROM shops WHERE subdomain = $1", [
        subdomain,
      ])
    ).rows;
    await database.pool.query(
      "INSERT INTO services (id, shop_id, name, price_usd, duration_minutes) VALUES ($1, $2, 'Unassigned', 35, 35)",
      [unassignedServiceId, shopId],
    );
    const withUnassigned = await getPublicShop(headers);
    expect(withUnassigned?.status).toBe("published");
    if (withUnassigned?.status !== "published") return;
    expect(withUnassigned.services.map(({ name }) => name)).toEqual([
      "Public Cut",
    ]);
    await database.pool.query(
      "UPDATE barbers SET archived = true WHERE id = $1",
      [barber.data.id],
    );
    const archivedBarberShop = await getPublicShop(headers);
    expect(archivedBarberShop?.status).toBe("published");
    if (archivedBarberShop?.status !== "published") return;
    expect(archivedBarberShop.services).toEqual([]);
    await database.pool.query(
      "UPDATE barbers SET archived = false WHERE id = $1",
      [barber.data.id],
    );
    await database.pool.query(
      "DELETE FROM barber_services WHERE barber_id = $1 AND service_id = $2",
      [barber.data.id, service.data.id],
    );
    const unassignedShop = await getPublicShop(headers);
    expect(unassignedShop?.status).toBe("published");
    if (unassignedShop?.status !== "published") return;
    expect(unassignedShop.services).toEqual([]);
    await database.pool.query("DELETE FROM services WHERE id = $1", [
      unassignedServiceId,
    ]);
    await database.pool.query(
      "INSERT INTO barber_services (shop_id, barber_id, service_id) VALUES ($1, $2, $3)",
      [shopId, barber.data.id, service.data.id],
    );
    await database.pool.query(
      "UPDATE services SET duration_minutes = $1 WHERE id = $2",
      ["9".repeat(310), service.data.id],
    );
    await expect(
      previewPublicSlots(headers, {
        serviceId: service.data.id,
        barberId: barber.data.id,
        date: "2026-11-02",
      }),
    ).resolves.toMatchObject({ slots: [] });
    await database.pool.query(
      "UPDATE services SET duration_minutes = 35 WHERE id = $1",
      [service.data.id],
    );

    const fallBackWeek: WeeklySchedule = Array.from(
      { length: 7 },
      (_, day) => ({
        working: day === 6 ? [{ start: 0, end: 1440 }] : [],
        breaks: [],
      }),
    );
    await database.pool.query(
      "UPDATE shops SET time_zone = 'America/New_York' WHERE id = $1",
      [shopId],
    );
    await database.pool.query(
      "UPDATE shop_schedules SET week = $2::jsonb WHERE shop_id = $1",
      [shopId, JSON.stringify(fallBackWeek)],
    );
    await database.pool.query(
      "UPDATE barber_schedules SET week = $3::jsonb WHERE shop_id = $1 AND barber_id = $2",
      [shopId, barber.data.id, JSON.stringify(fallBackWeek)],
    );
    await database.pool.query(
      "UPDATE services SET duration_minutes = 1500 WHERE id = $1",
      [service.data.id],
    );
    await expect(
      previewPublicSlots(headers, {
        serviceId: service.data.id,
        barberId: barber.data.id,
        date: "2026-11-01",
      }),
    ).resolves.toMatchObject({
      slots: [
        {
          localStart: "00:00",
          end: "2026-11-02T05:00:00Z",
        },
      ],
    });
    await database.pool.query(
      "UPDATE services SET duration_minutes = 35 WHERE id = $1",
      [service.data.id],
    );
    await database.pool.query(
      "UPDATE shops SET time_zone = 'UTC' WHERE id = $1",
      [shopId],
    );
    await database.pool.query(
      "UPDATE shop_schedules SET week = $2::jsonb WHERE shop_id = $1",
      [shopId, JSON.stringify(week)],
    );
    await database.pool.query(
      "UPDATE barber_schedules SET week = $3::jsonb WHERE shop_id = $1 AND barber_id = $2",
      [shopId, barber.data.id, JSON.stringify(week)],
    );

    expect(
      (
        await setOwnShopPublication(context, {
          published: false,
          expectedPublished: true,
        })
      ).success,
    ).toBe(true);
    expect(await getPublicShop(headers)).toEqual({
      status: "paused",
      name: "Juniper Barber",
      publicContact: "Call 202-555-0142",
      timeZone: "UTC",
    });
    expect(
      await previewPublicSlots(headers, {
        serviceId: service.data.id,
        barberId: barber.data.id,
        date: "2026-11-02",
      }),
    ).toBeNull();
    expect(await publicShopExists(`missing-${randomUUID().slice(0, 8)}`)).toBe(
      false,
    );
  });
});
