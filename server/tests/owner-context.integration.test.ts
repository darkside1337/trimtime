import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate.mts";
import { openTestDatabase } from "@/tests/support/database";

describe("owner context", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let closeApplicationPool: (() => Promise<void>) | undefined;
  let testAuth: typeof import("@/tests/support/auth").testAuth;
  let readOwnerContext: typeof import("@/server/owner-context").readOwnerContext;
  let signOut: typeof import("@/server/auth").auth.api.signOut;
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
    const [{ pool }, { auth }] = await Promise.all([
      import("@/db"),
      import("@/server/auth"),
    ]);
    closeApplicationPool = () => pool.end();
    signOut = auth.api.signOut;
  });

  afterAll(async () => {
    await Promise.all(
      userIds.map((id) =>
        testAuth.$context.then(({ test }) => test.deleteUser(id)),
      ),
    );
    await closeApplicationPool?.();
    await database?.pool.end();
  });

  it("reads a real persisted session for its owner", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `owner-context-${randomUUID()}@example.test`,
        name: "Owner Context",
      }),
    );
    userIds.push(user.id);
    const login = await helpers.login({ userId: user.id });

    await expect(readOwnerContext(login.headers)).resolves.toEqual({
      userId: user.id,
    });
  });

  it("denies missing and forged cookies", async () => {
    await expect(readOwnerContext(new Headers())).resolves.toBeNull();
    await expect(
      readOwnerContext(
        new Headers({ cookie: "better-auth.session_token=forged" }),
      ),
    ).resolves.toBeNull();
  });

  it("does not trust submitted owner or role headers", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `owner-header-${randomUUID()}@example.test`,
        name: "Owner Header",
      }),
    );
    userIds.push(user.id);
    const login = await helpers.login({ userId: user.id });
    const headers = new Headers(login.headers);
    headers.set("ownerId", "attacker");
    headers.set("role", "admin");
    headers.set("shopId", "attacker-shop");

    await expect(readOwnerContext(headers)).resolves.toEqual({
      userId: user.id,
    });
  });

  it("denies a session expired in persistent storage", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `owner-expired-${randomUUID()}@example.test`,
        name: "Owner Expired",
      }),
    );
    userIds.push(user.id);
    const login = await helpers.login({ userId: user.id });
    await database.pool.query(
      "UPDATE \"session\" SET expires_at = now() - interval '1 second' WHERE id = $1",
      [login.session.id],
    );

    await expect(readOwnerContext(login.headers)).resolves.toBeNull();
  });

  it("denies a replayed cookie after server-side sign-out", async () => {
    const helpers = (await testAuth.$context).test;
    const user = await helpers.saveUser(
      helpers.createUser({
        email: `owner-signout-${randomUUID()}@example.test`,
        name: "Owner Signout",
      }),
    );
    userIds.push(user.id);
    const login = await helpers.login({ userId: user.id });

    await signOut({ headers: login.headers });
    await expect(readOwnerContext(login.headers)).resolves.toBeNull();
  });
});
import { randomUUID } from "node:crypto";
