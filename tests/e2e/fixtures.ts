import { randomUUID } from "node:crypto";
import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import * as schema from "../../db/schema/auth";
import { ownerAuthOptions } from "../../server/auth-options";
import { verifyOwnedTestDatabase } from "../../db/test-database.mts";
import { withE2eBudget } from "../support/e2e-budget";

export const ownerOrigin = "http://app.localhost:3100";
export const marketingOrigin = "http://localhost:3100";

export async function cancelBlockedRequest(pool: Pool, blocker: PoolClient) {
  const { rows } = await blocker.query("SELECT pg_backend_pid() AS pid");
  await expect
    .poll(async () => {
      const blocked = await pool.query(
        "SELECT pg_cancel_backend(pid) AS cancelled FROM pg_stat_activity WHERE datname=current_database() AND $1 = ANY(pg_blocking_pids(pid))",
        [rows[0].pid],
      );
      return blocked.rows.some((row) => row.cancelled);
    })
    .toBe(true);
}

export async function captureState(page: Page, state: string, info: TestInfo) {
  await expect(page.locator("main").first()).toContainText(/\S/);
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await page.screenshot({
    path: info.outputPath(`${state}.png`),
    fullPage: true,
  });
}

export async function openOwnerNavigation(page: Page) {
  if (page.viewportSize()!.width <= 900)
    await page.getByRole("button", { name: "Open navigation" }).click();
}

function createFixtureAuth(pool: Pool) {
  return betterAuth({
    ...ownerAuthOptions,
    database: drizzleAdapter(drizzle(pool), { provider: "pg", schema }),
    plugins: [testUtils()],
  });
}

type Database = { pool: Pool; auth: ReturnType<typeof createFixtureAuth> };
export type Owner = {
  id: string;
  subdomain: string;
  shopId: string;
  cookie: string;
  appointmentId?: string;
  barberId?: string;
  serviceId?: string;
};
type Owners = (
  context: BrowserContext,
  options?: {
    shop?: boolean;
    name?: string;
    appointment?: boolean;
    published?: boolean;
    createSetup?: boolean;
  },
) => Promise<Owner>;

export const test = base.extend<{ owners: Owners }, { database: Database }>({
  page: async ({ page }, run) => {
    if (process.env.TRIMTIME_E2E_NOW)
      await page.clock.install({
        time: new Date(process.env.TRIMTIME_E2E_NOW),
      });
    await run(page);
  },
  database: [
    async ({}, run) => {
      const url = verifyOwnedTestDatabase();
      if (
        process.env.DATABASE_URL !== url ||
        process.env.APP_ORIGIN !== ownerOrigin
      ) {
        throw new Error(
          "Use pnpm test:e2e so fixtures and app share the isolated test configuration.",
        );
      }
      const pool = new Pool({ connectionString: url, max: 2 });
      try {
        await run({ pool, auth: createFixtureAuth(pool) });
      } finally {
        await pool.end();
      }
    },
    { scope: "worker" },
  ],
  owners: async ({ database }, run) => {
    const ids: string[] = [];
    const helpers = (await database.auth.$context).test;
    const runOwners = async () => {
      try {
        await run(async (context, options = {}) => {
          const suffix = randomUUID();
          const user = await helpers.saveUser(
            helpers.createUser({
              email: `phase01-${suffix}@example.test`,
              name: "Fictional Owner",
            }),
          );
          ids.push(user.id);
          const login = await helpers.login({ userId: user.id });
          await context.addCookies(login.cookies);
          const owner = {
            id: user.id,
            subdomain: `shop-${suffix}`,
            shopId: randomUUID(),
            cookie: login.headers.get("cookie")!,
          };
          if (options.shop) {
            await database.pool.query(
              `INSERT INTO shops (id, owner_id, name, subdomain, time_zone, public_contact, address)
             VALUES ($1, $2, $3, $4, 'America/New_York', 'Call 202-555-0142', '123 Example Street')`,
              [
                owner.shopId,
                owner.id,
                options.name ?? "Juniper Barber",
                owner.subdomain,
              ],
            );
            if (options.published)
              await database.pool.query(
                "UPDATE shops SET published=true WHERE id=$1",
                [owner.shopId],
              );
            if (options.appointment) {
              const { seedOwnerAppointment } =
                await import("./owner-booking-fixtures");
              const seeded = await seedOwnerAppointment(database.pool, owner);
              Object.assign(owner, seeded);
            }
            if (options.createSetup) {
              const barberId = `barber-${randomUUID()}`;
              const serviceId = `service-${randomUUID()}`;
              await database.pool.query(
                "INSERT INTO barbers (id,shop_id,name) VALUES ($1,$2,'Manual Barber')",
                [barberId, owner.shopId],
              );
              await database.pool.query(
                "INSERT INTO services (id,shop_id,name,price_usd,duration_minutes,offered) VALUES ($1,$2,'Walk-in Cut',25,35,true)",
                [serviceId, owner.shopId],
              );
              await database.pool.query(
                "INSERT INTO barber_services (shop_id,barber_id,service_id) VALUES ($1,$2,$3)",
                [owner.shopId, barberId, serviceId],
              );
              const week = JSON.stringify(
                Array.from({ length: 7 }, () => ({
                  working: [{ start: 0, end: 1440 }],
                  breaks: [],
                })),
              );
              await database.pool.query(
                "INSERT INTO shop_schedules (shop_id,week,revision) VALUES ($1,$2::jsonb,1)",
                [owner.shopId, week],
              );
              await database.pool.query(
                "INSERT INTO barber_schedules (shop_id,barber_id,week,revision) VALUES ($1,$2,$3::jsonb,1)",
                [owner.shopId, barberId, week],
              );
              Object.assign(owner, { barberId, serviceId });
            }
          }
          return owner;
        });
      } finally {
        await database.pool.query(
          "DELETE FROM shops WHERE owner_id = ANY($1::text[])",
          [ids],
        );
        for (const id of ids) await helpers.deleteUser(id);
      }
    };
    if (
      ["mailpit-double", "mailpit-real", "mailpit-outage"].includes(
        process.env.TRIMTIME_E2E_EMAIL_MODE ?? "",
      )
    ) {
      const day = new Date(
        process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z",
      )
        .toISOString()
        .slice(0, 10);
      await withE2eBudget(database.pool, day, runOwners);
    } else {
      await runOwners();
    }
  },
});

export { expect };
