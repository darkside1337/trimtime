import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDatabase } from "@/tests/support/database";
import { shopInput } from "@/tests/support/shops";

describe("catalog operations", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let applicationPool: Pool;
  let closeApplicationPool: (() => Promise<void>) | undefined;
  let testAuth: typeof import("@/tests/support/auth").testAuth;
  let readOwnerContext: typeof import("@/server/owner-context").readOwnerContext;
  let createShop: typeof import("@/features/shops/mutations").createShop;
  let saveService: typeof import("../mutations").saveService;
  let getOwnServices: typeof import("../queries").getOwnServices;
  let saveBarber: typeof import("@/features/barbers/mutations").saveBarber;
  let getOwnBarbers: typeof import("@/features/barbers/queries").getOwnBarbers;
  let setServiceOffered: typeof import("../mutations").setServiceOffered;
  let archiveService: typeof import("../mutations").archiveService;
  let getOwnOfferingChoices: typeof import("../queries").getOwnOfferingChoices;
  let archiveBarber: typeof import("@/features/barbers/mutations").archiveBarber;
  const userIds: string[] = [];

  beforeAll(async () => {
    database = await openTestDatabase();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.BETTER_AUTH_URL = "http://app.localhost:3100";
    process.env.BETTER_AUTH_SECRET =
      "test-secret-that-is-long-enough-for-better-auth";
    process.env.GOOGLE_CLIENT_ID = "test-google-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
    ({ testAuth } = await import("@/tests/support/auth"));
    ({ readOwnerContext } = await import("@/server/owner-context"));
    ({ createShop } = await import("@/features/shops/mutations"));
    ({ saveService } = await import("../mutations"));
    ({ getOwnServices } = await import("../queries"));
    ({ saveBarber } = await import("@/features/barbers/mutations"));
    ({ getOwnBarbers } = await import("@/features/barbers/queries"));
    ({ setServiceOffered, archiveService } = await import("../mutations"));
    ({ getOwnOfferingChoices } = await import("../queries"));
    ({ archiveBarber } = await import("@/features/barbers/mutations"));
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
  });

  it("persists a service across a fresh read", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `catalog-${randomUUID()}@example.test`,
        name: "Catalog Owner",
      }),
    );
    userIds.push(user.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: user.id })).headers,
    );
    await createShop(
      context,
      shopInput({ subdomain: `catalog-${randomUUID().slice(0, 8)}` }),
    );

    const saved = await saveService(context, {
      name: "Community cut",
      priceUsd: "0",
      durationMinutes: "35",
      offered: true,
      barberIds: [],
    });

    expect(saved).toMatchObject({
      success: true,
      data: { name: "Community cut" },
    });
    if (!saved.success) return;
    await expect(getOwnServices(context)).resolves.toContainEqual({
      id: saved.data.id,
      name: "Community cut",
      priceUsd: "0.00",
      durationMinutes: "35",
      offered: true,
      archived: false,
      barberIds: [],
    });
    const shop = await database.pool.query(
      "SELECT id FROM shops WHERE owner_id = $1",
      [context!.userId],
    );
    for (const [price, duration] of [
      ["-0.01", "30"],
      ["1.001", "30"],
      ["NaN", "30"],
      ["12", "29"],
      ["12", "30.5"],
    ]) {
      await expect(
        database.pool.query(
          "INSERT INTO services (id, shop_id, name, price_usd, duration_minutes) VALUES ($1, $2, 'Invalid', $3, $4)",
          [randomUUID(), shop.rows[0].id, price, duration],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
    const [firstEdit, secondEdit] = await Promise.all([
      saveService(context, {
        id: saved.data.id,
        name: "Race A",
        priceUsd: "1",
        durationMinutes: "30",
        offered: true,
        barberIds: [],
      }),
      saveService(context, {
        id: saved.data.id,
        name: "Race B",
        priceUsd: "2",
        durationMinutes: "35",
        offered: false,
        barberIds: [],
      }),
    ]);
    expect(firstEdit.success && secondEdit.success).toBe(true);
    const final = (await getOwnServices(context))?.find(
      ({ id }) => id === saved.data.id,
    );
    expect([
      {
        name: "Race A",
        priceUsd: "1.00",
        durationMinutes: "30",
        offered: true,
      },
      {
        name: "Race B",
        priceUsd: "2.00",
        durationMinutes: "35",
        offered: false,
      },
    ]).toContainEqual({
      name: final?.name,
      priceUsd: final?.priceUsd,
      durationMinutes: final?.durationMinutes,
      offered: final?.offered,
    });
  });

  it("persists an unassigned barber and reads an explicit service assignment", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `barber-${randomUUID()}@example.test`,
        name: "Barber Owner",
      }),
    );
    userIds.push(user.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: user.id })).headers,
    );
    await createShop(
      context,
      shopInput({ subdomain: `barber-${randomUUID().slice(0, 8)}` }),
    );
    const service = await saveService(context, {
      name: "Cut",
      priceUsd: "12.50",
      durationMinutes: "35",
      offered: true,
      barberIds: [],
    });
    expect(service.success).toBe(true);
    if (!service.success) return;
    const barber = await saveBarber(context, {
      name: " Sam ",
      serviceIds: [service.data.id, service.data.id],
    });
    expect(barber).toMatchObject({
      success: true,
      data: { name: "Sam", serviceIds: [service.data.id] },
    });
    if (!barber.success) return;
    await expect(getOwnBarbers(context)).resolves.toContainEqual({
      id: barber.data.id,
      name: "Sam",
      archived: false,
      serviceIds: [service.data.id],
    });
    await expect(getOwnServices(context)).resolves.toContainEqual({
      id: service.data.id,
      name: "Cut",
      priceUsd: "12.50",
      durationMinutes: "35",
      offered: true,
      archived: false,
      barberIds: [barber.data.id],
    });
  });

  it("retains hidden and archived records while excluding them from offering choices", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `life-${randomUUID()}@example.test`,
        name: "Lifecycle Owner",
      }),
    );
    userIds.push(user.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: user.id })).headers,
    );
    await createShop(
      context,
      shopInput({ subdomain: `life-${randomUUID().slice(0, 8)}` }),
    );
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
      name: "Sam",
      serviceIds: [service.data.id],
    });
    expect(barber.success).toBe(true);
    if (!barber.success) return;
    await expect(getOwnOfferingChoices(context)).resolves.toHaveLength(1);
    await expect(
      setServiceOffered(context, { id: service.data.id, offered: false }),
    ).resolves.toMatchObject({
      success: true,
      data: { offered: false, barberIds: [barber.data.id] },
    });
    await expect(getOwnOfferingChoices(context)).resolves.toEqual([]);
    await expect(
      setServiceOffered(context, { id: service.data.id, offered: true }),
    ).resolves.toMatchObject({ success: true, data: { offered: true } });
    await expect(archiveBarber(context, barber.data.id)).resolves.toMatchObject(
      { success: true, data: { archived: true } },
    );
    await expect(getOwnOfferingChoices(context)).resolves.toEqual([]);
    await expect(
      saveService(context, {
        id: service.data.id,
        name: "Cut",
        priceUsd: "12",
        durationMinutes: "35",
        offered: true,
        barberIds: [],
      }),
    ).resolves.toMatchObject({ success: true, data: { barberIds: [] } });
    const retainedLinks = await database.pool.query(
      "SELECT count(*)::int AS count FROM barber_services WHERE barber_id = $1 AND service_id = $2",
      [barber.data.id, service.data.id],
    );
    expect(retainedLinks.rows[0].count).toBe(1);
    await expect(
      archiveService(context, service.data.id),
    ).resolves.toMatchObject({ success: true, data: { archived: true } });
    await expect(
      archiveService(context, service.data.id),
    ).resolves.toMatchObject({ success: true, data: { archived: true } });
    await expect(getOwnServices(context)).resolves.toContainEqual(
      expect.objectContaining({
        id: service.data.id,
        archived: true,
        barberIds: [],
      }),
    );
    await expect(getOwnBarbers(context)).resolves.toContainEqual(
      expect.objectContaining({
        id: barber.data.id,
        archived: true,
        serviceIds: [],
      }),
    );
    await expect(
      saveBarber(context, {
        id: barber.data.id,
        name: "Changed",
        serviceIds: [],
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "RESOURCE_ARCHIVED" },
    });
  });

  it("denies foreign targets and mixed-shop assignment without changing catalog state", async () => {
    const helpers = (await testAuth.$context).test;
    const users = await Promise.all(
      ["scope-a", "scope-b"].map((name) =>
        helpers.saveUser(
          helpers.createUser({
            email: `${name}-${randomUUID()}@example.test`,
            name,
          }),
        ),
      ),
    );
    userIds.push(...users.map(({ id }) => id));
    const contexts = await Promise.all(
      users.map(async (user) =>
        readOwnerContext((await helpers.login({ userId: user.id })).headers),
      ),
    );
    await createShop(
      contexts[0],
      shopInput({ subdomain: `scope-a-${randomUUID().slice(0, 8)}` }),
    );
    await createShop(
      contexts[1],
      shopInput({ subdomain: `scope-b-${randomUUID().slice(0, 8)}` }),
    );
    const serviceA = await saveService(contexts[0], {
      name: "Private cut",
      priceUsd: "12.50",
      durationMinutes: "35",
      offered: true,
      barberIds: [],
    });
    const barberB = await saveBarber(contexts[1], {
      name: "Private barber",
      serviceIds: [],
    });
    expect(serviceA.success && barberB.success).toBe(true);
    if (!serviceA.success || !barberB.success) return;
    await expect(
      saveService(contexts[1], {
        id: serviceA.data.id,
        name: "Probe",
        priceUsd: "0",
        durationMinutes: "30",
        offered: true,
        barberIds: [],
      }),
    ).resolves.toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    await expect(
      saveService(contexts[1], {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Probe",
        priceUsd: "0",
        durationMinutes: "30",
        offered: true,
        barberIds: [],
      }),
    ).resolves.toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    const invalid = await saveService(contexts[0], {
      name: "Partial mutation",
      priceUsd: "0",
      durationMinutes: "30",
      offered: true,
      barberIds: [barberB.data.id],
    });
    expect(invalid).toMatchObject({
      success: false,
      error: { code: "INVALID_ASSIGNMENT" },
    });
    await expect(getOwnServices(contexts[0])).resolves.toContainEqual(
      expect.objectContaining({
        id: serviceA.data.id,
        name: "Private cut",
        priceUsd: "12.50",
        barberIds: [],
      }),
    );
    const shops = (
      await database.pool.query(
        "SELECT id, owner_id FROM shops WHERE owner_id = ANY($1::text[])",
        [[users[0].id, users[1].id]],
      )
    ).rows;
    const shopA = shops.find(({ owner_id }) => owner_id === users[0].id).id;
    const shopB = shops.find(({ owner_id }) => owner_id === users[1].id).id;
    await expect(
      database.pool.query(
        "INSERT INTO barber_services (shop_id, barber_id, service_id) VALUES ($1, $2, $3)",
        [shopA, barberB.data.id, serviceA.data.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    expect(shopA).not.toBe(shopB);
  });

  it("distinguishes signed-out and missing-shop writes without exposing rows", async () => {
    const input = {
      name: "New",
      priceUsd: "0",
      durationMinutes: "30",
      offered: true,
      barberIds: [],
    };
    await expect(saveService(null, input)).resolves.toMatchObject({
      success: false,
      error: { code: "UNAUTHENTICATED" },
    });
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `no-shop-${randomUUID()}@example.test`,
        name: "No Shop",
      }),
    );
    userIds.push(user.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: user.id })).headers,
    );
    await expect(saveService(context, input)).resolves.toMatchObject({
      success: false,
      error: { code: "SHOP_REQUIRED" },
    });
    await expect(getOwnServices(context)).resolves.toBeNull();
  });
});
