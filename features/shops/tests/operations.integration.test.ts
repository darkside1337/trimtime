import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate.mts";
import { openTestDatabase } from "@/tests/support/database";
import { shopInput } from "@/tests/support/shops";

describe("shop operations", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let closeApplicationPool: (() => Promise<void>) | undefined;
  let applicationPool: Pool;
  let testAuth: typeof import("@/tests/support/auth").testAuth;
  let readOwnerContext: typeof import("@/server/owner-context").readOwnerContext;
  let createShop: typeof import("../mutations").createShop;
  let updateOwnShop: typeof import("../mutations").updateOwnShop;
  let checkSubdomainAvailability: typeof import("../mutations").checkSubdomainAvailability;
  let getOwnShop: typeof import("../queries").getOwnShop;
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
    ({ createShop, updateOwnShop, checkSubdomainAvailability } =
      await import("../mutations"));
    ({ getOwnShop } = await import("../queries"));
    const { pool } = await import("@/db");
    applicationPool = pool;
    pool.options.max = 1;
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

  it("creates an unpublished shop", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `shop-owner-${randomUUID()}@example.test`,
        name: "Shop Owner",
      }),
    );
    userIds.push(user.id);
    const login = await helpers.login({ userId: user.id });
    const context = await readOwnerContext(login.headers);

    const created = await createShop(context, shopInput());
    expect(created).toMatchObject({
      success: true,
      data: { published: false },
    });
    await expect(getOwnShop(context)).resolves.toMatchObject({
      name: "Juniper Barber",
      subdomain: "juniper",
      timeZone: "America/New_York",
      publicContact: "Call 202-555-0142",
      address: "123 Example Street",
      published: false,
    });
    const { getOwnSettingsDetails } = await import("../queries");
    await expect(getOwnSettingsDetails(context)).resolves.toEqual({
      name: user.name,
      email: user.email,
      timeZoneLockedAt: null,
    });
    await database.pool.query(
      "UPDATE shops SET time_zone_locked_at = '2026-10-23T12:00:00Z' WHERE owner_id = $1",
      [user.id],
    );
    await expect(getOwnSettingsDetails(context)).resolves.toMatchObject({
      timeZoneLockedAt: new Date("2026-10-23T12:00:00Z"),
    });
    await database.pool.query(
      "UPDATE shops SET time_zone_locked_at = NULL WHERE owner_id = $1",
      [user.id],
    );
  });

  it("denies signed-out reads and creates", async () => {
    await expect(createShop(null, shopInput())).resolves.toMatchObject({
      success: false,
      error: { code: "UNAUTHENTICATED" },
    });
    await expect(getOwnShop(null)).rejects.toMatchObject({
      message: "Sign in to access your shop.",
    });
    const { getOwnSettingsDetails } = await import("../queries");
    await expect(getOwnSettingsDetails(null)).rejects.toMatchObject({
      message: "Sign in to access your shop.",
    });
  });

  it("returns null for an owner without a shop", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `shop-empty-${randomUUID()}@example.test`,
        name: "Empty Shop Owner",
      }),
    );
    userIds.push(user.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: user.id })).headers,
    );

    await expect(getOwnShop(context)).resolves.toBeNull();
  });

  it("rejects invalid input without creating a shop", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `shop-invalid-${randomUUID()}@example.test`,
        name: "Invalid Shop Owner",
      }),
    );
    userIds.push(user.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: user.id })).headers,
    );

    await expect(
      createShop(context, shopInput({ name: " " })),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    await expect(getOwnShop(context)).resolves.toBeNull();
  });

  it("preserves a saved shop through a migration rerun", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `shop-rerun-${randomUUID()}@example.test`,
        name: "Migration Shop Owner",
      }),
    );
    userIds.push(user.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: user.id })).headers,
    );
    const created = await createShop(
      context,
      shopInput({ subdomain: `rerun-${randomUUID().slice(0, 8)}` }),
    );
    expect(created.success).toBe(true);

    await applyMigrations(database.pool, "db/migrations");
    await expect(getOwnShop(context)).resolves.toMatchObject({
      id: created.success && created.data.id,
    });
  });

  it("maps duplicate namespaces and second shops without partial rows", async () => {
    const helpers = (await testAuth.$context).test;
    const first = await helpers.saveUser(
      helpers.createUser({
        email: `shop-first-${randomUUID()}@example.test`,
        name: "First Owner",
      }),
    );
    const second = await helpers.saveUser(
      helpers.createUser({
        email: `shop-second-${randomUUID()}@example.test`,
        name: "Second Owner",
      }),
    );
    userIds.push(first.id, second.id);
    const [firstContext, secondContext] = await Promise.all([
      readOwnerContext((await helpers.login({ userId: first.id })).headers),
      readOwnerContext((await helpers.login({ userId: second.id })).headers),
    ]);
    const subdomain = `shared-${randomUUID().slice(0, 8)}`;
    expect(
      (await createShop(firstContext, shopInput({ subdomain }))).success,
    ).toBe(true);

    await expect(
      createShop(secondContext, shopInput({ subdomain })),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "SUBDOMAIN_UNAVAILABLE" },
    });
    await expect(getOwnShop(secondContext)).resolves.toBeNull();
    await expect(
      createShop(
        firstContext,
        shopInput({ subdomain: `second-${randomUUID().slice(0, 8)}` }),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "SHOP_EXISTS" },
    });
  });

  it("returns only advisory availability and rejects a stale claim at creation", async () => {
    const helpers = (await testAuth.$context).test;
    const users = await Promise.all(
      ["availability-a", "availability-b"].map((name) =>
        helpers.saveUser(
          helpers.createUser({
            email: `${name}-${randomUUID()}@example.test`,
            name,
          }),
        ),
      ),
    );
    userIds.push(...users.map((user) => user.id));
    const contexts = await Promise.all(
      users.map(async (user) =>
        readOwnerContext((await helpers.login({ userId: user.id })).headers),
      ),
    );
    const subdomain = `available-${randomUUID().slice(0, 8)}`;
    await expect(
      checkSubdomainAvailability(null, { subdomain }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNAUTHENTICATED" },
    });
    for (const input of [
      { subdomain: " APP " },
      { subdomain, ownerId: users[0].id },
    ]) {
      await expect(
        checkSubdomainAvailability(contexts[0], input),
      ).resolves.toMatchObject({
        success: false,
        error: { code: "VALIDATION_ERROR" },
      });
    }
    await expect(
      checkSubdomainAvailability(contexts[1], {
        subdomain: ` ${subdomain.toUpperCase()} `,
      }),
    ).resolves.toEqual({
      success: true,
      data: { available: true },
    });
    expect(
      (await createShop(contexts[0], shopInput({ subdomain }))).success,
    ).toBe(true);
    await expect(
      checkSubdomainAvailability(contexts[1], { subdomain }),
    ).resolves.toEqual({
      success: true,
      data: { available: false },
    });
    await expect(
      createShop(contexts[1], shopInput({ subdomain })),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "SUBDOMAIN_UNAVAILABLE" },
    });
    await expect(getOwnShop(contexts[1])).resolves.toBeNull();
    expect(
      (
        await createShop(
          contexts[1],
          shopInput({ subdomain: `retry-${randomUUID().slice(0, 8)}` }),
        )
      ).success,
    ).toBe(true);
  });

  it("allows exactly one winner for competing creates", async () => {
    const helpers = (await testAuth.$context).test;
    const users = await Promise.all(
      ["race-a", "race-b", "race-c"].map((label) =>
        helpers.saveUser(
          helpers.createUser({
            email: `${label}-${randomUUID()}@example.test`,
            name: label,
          }),
        ),
      ),
    );
    userIds.push(...users.map((user) => user.id));
    const contexts = await Promise.all(
      users.map(async (user) =>
        readOwnerContext((await helpers.login({ userId: user.id })).headers),
      ),
    );
    const shared = `race-${randomUUID().slice(0, 8)}`;
    const competing = await Promise.all([
      createShop(contexts[0], shopInput({ subdomain: shared })),
      createShop(contexts[1], shopInput({ subdomain: shared })),
    ]);
    expect(competing.filter((result) => result.success)).toHaveLength(1);
    expect(competing.filter((result) => !result.success)[0]).toMatchObject({
      error: { code: "SUBDOMAIN_UNAVAILABLE" },
    });

    const sameOwner = await Promise.all([
      createShop(
        contexts[2],
        shopInput({ subdomain: `race-one-${randomUUID().slice(0, 8)}` }),
      ),
      createShop(
        contexts[2],
        shopInput({ subdomain: `race-two-${randomUUID().slice(0, 8)}` }),
      ),
    ]);
    expect(sameOwner.filter((result) => result.success)).toHaveLength(1);
    expect(sameOwner.filter((result) => !result.success)[0]).toMatchObject({
      error: { code: "SHOP_EXISTS" },
    });
  });

  it("keeps each owner scoped to their own shop", async () => {
    const helpers = (await testAuth.$context).test;
    const users = await Promise.all(
      ["isolation-a", "isolation-b", "shared-demo"].map((label) =>
        helpers.saveUser(
          helpers.createUser({
            email: `${label}-${randomUUID()}@example.test`,
            name: label,
          }),
        ),
      ),
    );
    userIds.push(...users.map((user) => user.id));
    const contexts = await Promise.all(
      users.map(async (user) =>
        readOwnerContext((await helpers.login({ userId: user.id })).headers),
      ),
    );
    const results = await Promise.all(
      contexts.map((context, index) =>
        createShop(
          context,
          shopInput({
            name: `Shop ${index}`,
            subdomain: `isolated-${index}-${randomUUID().slice(0, 6)}`,
          }),
        ),
      ),
    );
    expect(results.every((result) => result.success)).toBe(true);
    const views = await Promise.all(
      contexts.map((context) => getOwnShop(context)),
    );
    expect(new Set(views.map((view) => view?.id)).size).toBe(3);

    await expect(
      createShop(
        contexts[1],
        shopInput({ ownerId: users[0].id, published: true }),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("persists valid settings across a fresh read", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `shop-settings-${randomUUID()}@example.test`,
        name: "Settings Owner",
      }),
    );
    userIds.push(user.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: user.id })).headers,
    );
    expect(
      (
        await createShop(
          context,
          shopInput({ subdomain: `settings-${randomUUID().slice(0, 8)}` }),
        )
      ).success,
    ).toBe(true);

    await expect(
      updateOwnShop(context, {
        name: "Updated Juniper",
        publicContact: "Email hello@example.test",
        timeZone: "UTC",
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(getOwnShop(context)).resolves.toMatchObject({
      name: "Updated Juniper",
      publicContact: "Email hello@example.test",
      timeZone: "UTC",
    });
  });

  it("preserves committed settings on a real write failure and permits retry", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `save-failure-${randomUUID()}@example.test`,
        name: "Failure Owner",
      }),
    );
    userIds.push(user.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: user.id })).headers,
    );
    expect(
      (
        await createShop(
          context,
          shopInput({ subdomain: `failure-${randomUUID()}` }),
        )
      ).success,
    ).toBe(true);
    const before = await getOwnShop(context);
    const input = {
      name: "Retry Juniper",
      publicContact: "Call 202-555-0143",
      timeZone: "UTC",
    };

    // This suite owns its single-connection application pool; other connections stay writable.
    await applicationPool.query("SET default_transaction_read_only = on");
    try {
      await expect(updateOwnShop(context, input)).resolves.toMatchObject({
        success: false,
        error: {
          code: "SAVE_FAILED",
          message: "Unable to save your settings.",
        },
      });
      await expect(getOwnShop(context)).resolves.toEqual(before);
    } finally {
      await applicationPool.query("SET default_transaction_read_only = off");
    }
    await expect(updateOwnShop(context, input)).resolves.toMatchObject({
      success: true,
      data: input,
    });
    await expect(getOwnShop(context)).resolves.toMatchObject(input);
  });

  it("preserves fields on invalid updates and honors the durable time-zone lock", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `shop-locked-${randomUUID()}@example.test`,
        name: "Locked Owner",
      }),
    );
    userIds.push(user.id);
    const context = await readOwnerContext(
      (await helpers.login({ userId: user.id })).headers,
    );
    const created = await createShop(
      context,
      shopInput({ subdomain: `locked-${randomUUID().slice(0, 8)}` }),
    );
    expect(created.success).toBe(true);
    const before = await getOwnShop(context);

    await expect(
      updateOwnShop(context, {
        name: " ",
        publicContact: "Call",
        timeZone: "UTC",
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    await expect(
      updateOwnShop(context, {
        name: "Changed",
        publicContact: "Call",
        timeZone: "UTC",
        subdomain: "attacker",
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    await expect(getOwnShop(context)).resolves.toMatchObject(before ?? {});

    await database.pool.query(
      'UPDATE "shops" SET time_zone_locked_at = now() WHERE owner_id = $1',
      [user.id],
    );
    await expect(
      updateOwnShop(context, {
        name: "Changed",
        publicContact: "New contact",
        timeZone: "UTC",
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "TIME_ZONE_LOCKED" },
    });
    await expect(
      updateOwnShop(context, {
        name: "Changed",
        publicContact: "New contact",
        timeZone: before?.timeZone,
      }),
    ).resolves.toMatchObject({
      success: true,
      data: { name: "Changed", publicContact: "New contact" },
    });
  });
});
