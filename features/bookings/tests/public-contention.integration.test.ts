import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openTestDatabase } from "@/tests/support/database";
import {
  resolveBarrierPid,
  waitForLockWaiters,
} from "@/tests/support/database-locks";
import {
  createRateKeyTracker,
  trackCreateEmailRateKey,
} from "@/tests/support/rate-keys";
import { shopInput } from "@/tests/support/shops";

describe("public booking and owner operation contention", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let appPool: Pool;
  let closeAppPool: (() => Promise<void>) | undefined;
  let testAuth: typeof import("@/tests/support/auth").testAuth;
  let createShop: typeof import("@/features/shops/mutations").createShop;
  let readOwnerContext: typeof import("@/server/owner-context").readOwnerContext;
  let saveBarber: typeof import("@/features/barbers/mutations").saveBarber;
  let saveService: typeof import("@/features/catalog/mutations").saveService;
  let saveShopSchedule: typeof import("@/features/availability/mutations").saveShopSchedule;
  let setOwnShopPublication: typeof import("@/features/shops/mutations").setOwnShopPublication;
  let createPublicBooking: typeof import("@/features/bookings/mutations").createPublicBooking;
  let updateOwnShop: typeof import("@/features/shops/mutations").updateOwnShop;
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
    ({ saveService } = await import("@/features/catalog/mutations"));
    ({ saveShopSchedule } = await import("@/features/availability/mutations"));
    const bookings = await import("@/features/bookings/mutations");
    createPublicBooking = (context, input) => {
      trackCreateEmailRateKey(rateKeys, context, input);
      return bookings.createPublicBooking(context, input);
    };
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

  it("queues owner edits behind a waiting public creation and completes both after release", async () => {
    const helpers = (await testAuth.$context).test;
    const owner = await helpers.saveUser(
      helpers.createUser({
        email: `contention-${randomUUID()}@example.test`,
        name: "Contention Owner",
      }),
    );
    ownerIds.push(owner.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: owner.id })).headers,
    );
    const shop = await createShop(
      context,
      shopInput({
        subdomain: `contention-${randomUUID().slice(0, 8)}`,
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
    const schedule = await saveShopSchedule(context, { week, revision: 0 });
    if (!schedule.success) throw new Error("Schedule fixture failed.");
    const publication = await setOwnShopPublication(context, {
      published: true,
      expectedPublished: false,
    });
    if (!publication.success) throw new Error("Publication fixture failed.");

    const rateKey = rateKeys.add("create_shop", shop.data.id);
    await database.pool.query(
      `INSERT INTO public_rate_keys (scope, key_hash)
       VALUES ('create_shop', $1) ON CONFLICT DO NOTHING`,
      [rateKey],
    );
    const rateLocker = await database.pool.connect();
    await rateLocker.query("BEGIN");
    await rateLocker.query(
      `SELECT scope FROM public_rate_keys
       WHERE scope = 'create_shop' AND key_hash = $1 FOR UPDATE`,
      [rateKey],
    );
    let publicRequest: ReturnType<typeof createPublicBooking> | undefined;
    let ownerRequest: ReturnType<typeof updateOwnShop> | undefined;
    let lockReleased = false;
    try {
      const publicInput = {
        serviceId: service.data.id,
        barberId: barber.data.id,
        startAt: "2026-11-02T10:00:00.000Z",
        reviewedOffer: {
          name: "Cut",
          priceUsd: "25.00",
          durationMinutes: "30",
        },
        contact: {
          name: "Ada Lovelace",
          email: `customer-${randomUUID()}@example.test`,
          whatsappOptIn: false,
        },
        recoveryKey: randomBytes(32).toString("base64url"),
      };
      trackCreateEmailRateKey(rateKeys, { shopId: shop.data.id }, publicInput);
      publicRequest = createPublicBooking(
        { shopId: shop.data.id },
        publicInput,
      );
      await waitForLockWaiters(
        database.pool,
        rateLocker,
        1,
        [/public_rate_keys[\s\S]*FOR UPDATE/i],
        {
          description: "public booking blocked on shop rate key",
        },
      );

      ownerRequest = updateOwnShop(context, {
        name: "Updated Contention Shop",
        publicContact: shop.data.publicContact,
        timeZone: shop.data.timeZone,
      });
      const waiters = await waitForLockWaiters(
        database.pool,
        rateLocker,
        2,
        [/public_rate_keys[\s\S]*FOR UPDATE/i, "shop_edit"],
        { description: "owner edit blocked by public booking" },
      );
      const publicWaiter = waiters.find((waiter) =>
        /public_rate_keys[\s\S]*FOR UPDATE/i.test(waiter.query),
      );
      const ownerWaiter = waiters.find((waiter) =>
        /shops WHERE owner_id[\s\S]*FOR UPDATE/i.test(waiter.query),
      );
      expect(publicWaiter).toBeDefined();
      expect(ownerWaiter).toBeDefined();
      expect(ownerWaiter?.blockers).toContain(publicWaiter?.pid);
      expect(publicWaiter?.blockers).toContain(
        await resolveBarrierPid(rateLocker),
      );

      await rateLocker.query("COMMIT");
      lockReleased = true;
      const publicResult = await publicRequest;
      expect(publicResult, JSON.stringify(publicResult)).toMatchObject({
        success: true,
      });
      const ownerResult = await ownerRequest;
      expect(ownerResult, JSON.stringify(ownerResult)).toMatchObject({
        success: true,
      });
    } finally {
      if (!lockReleased)
        await rateLocker.query("ROLLBACK").catch(() => undefined);
      rateLocker.release();
      await Promise.allSettled([publicRequest, ownerRequest].filter(Boolean));
    }
  });
});
