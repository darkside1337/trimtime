import { randomUUID } from "node:crypto";
import { test as base, expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import * as schema from "../../db/schema/auth";
import { ownerAuthOptions } from "../../server/auth-options";
import { verifyOwnedTestDatabase } from "../../db/test-database.mts";

export const ownerOrigin = "http://app.localhost:3100";
export const marketingOrigin = "http://localhost:3100";

export async function captureState(page: Page, state: string, info: TestInfo) {
  await expect(page.getByRole("main")).toContainText(/\S/);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await page.screenshot({ path: info.outputPath(`${state}.png`), fullPage: true });
}

function createFixtureAuth(pool: Pool) {
  return betterAuth({
    ...ownerAuthOptions,
    database: drizzleAdapter(drizzle(pool), { provider: "pg", schema }),
    plugins: [testUtils()],
  });
}

type Database = { pool: Pool; auth: ReturnType<typeof createFixtureAuth> };
export type Owner = { id: string; subdomain: string; shopId: string; cookie: string };
type Owners = (context: BrowserContext, options?: { shop?: boolean; name?: string }) => Promise<Owner>;

export const test = base.extend<{ owners: Owners }, { database: Database }>({
  database: [async ({}, run) => {
    const url = verifyOwnedTestDatabase();
    if (process.env.DATABASE_URL !== url || process.env.APP_ORIGIN !== ownerOrigin) {
      throw new Error("Use pnpm test:e2e so fixtures and app share the isolated test configuration.");
    }
    const pool = new Pool({ connectionString: url, max: 2 });
    try {
      await run({ pool, auth: createFixtureAuth(pool) });
    } finally {
      await pool.end();
    }
  }, { scope: "worker" }],
  owners: async ({ database }, run) => {
    const ids: string[] = [];
    const helpers = (await database.auth.$context).test;
    try {
      await run(async (context, options = {}) => {
        const suffix = randomUUID();
        const user = await helpers.saveUser(helpers.createUser({
          email: `phase01-${suffix}@example.test`, name: "Fictional Owner",
        }));
        ids.push(user.id);
        const login = await helpers.login({ userId: user.id });
        await context.addCookies(login.cookies);
        const owner = { id: user.id, subdomain: `shop-${suffix}`, shopId: randomUUID(), cookie: login.headers.get("cookie")! };
        if (options.shop) {
          await database.pool.query(
            `INSERT INTO shops (id, owner_id, name, subdomain, time_zone, public_contact, address)
             VALUES ($1, $2, $3, $4, 'America/New_York', 'Call 202-555-0142', '123 Example Street')`,
            [owner.shopId, owner.id, options.name ?? "Juniper Barber", owner.subdomain],
          );
        }
        return owner;
      });
    } finally {
      await database.pool.query('DELETE FROM shops WHERE owner_id = ANY($1::text[])', [ids]);
      for (const id of ids) await helpers.deleteUser(id);
    }
  },
});

export { expect };
