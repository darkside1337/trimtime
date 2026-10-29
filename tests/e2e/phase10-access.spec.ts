import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Owner } from "./fixtures";
import { expect, ownerOrigin, test } from "./fixtures";
import { addReadyCatalog } from "./publication-fixtures";

const SHOP_SUFFIX = "localhost:3100";
const ELIGIBLE_START = "2026-11-01T00:00:00Z";
const ELIGIBLE_LOCAL_DATE = "2026-10-31";

async function openAllWeek(pool: Pool, owner: Owner, barberId: string) {
  const week = Array.from({ length: 7 }, () => ({
    working: [{ start: 0, end: 1440 }],
    breaks: [],
  }));
  await pool.query(
    "UPDATE shop_schedules SET week=$2::jsonb WHERE shop_id=$1",
    [owner.shopId, JSON.stringify(week)],
  );
  await pool.query(
    "UPDATE barber_schedules SET week=$3::jsonb WHERE shop_id=$1 AND barber_id=$2",
    [owner.shopId, barberId, JSON.stringify(week)],
  );
}

async function createEligibleBooking(
  page: import("@playwright/test").Page,
  owner: Owner,
  serviceId: string,
  barberId: string,
) {
  await page.goto(`http://${owner.subdomain}.${SHOP_SUFFIX}/`);
  await page.locator(`input[name="serviceId"][value="${serviceId}"]`).check();
  await page.getByRole("button", { name: "Choose your barber" }).click();
  await page.locator(`input[name="barberId"][value="${barberId}"]`).check();
  await page.getByRole("button", { name: "Choose date and time" }).click();
  await page.getByLabel("Date", { exact: true }).fill(ELIGIBLE_LOCAL_DATE);
  const start = page.locator(
    `input[name="startAt"][value="${ELIGIBLE_START}"]`,
  );
  await expect(start).toHaveCount(1);
  await start.check();
  await page.getByRole("button", { name: "Your details", exact: true }).click();
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill(`ada-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  const link = page.getByRole("link", { name: "Open booking details" });
  await expect(link).toBeVisible();
  return new URL((await link.getAttribute("href"))!, page.url());
}

test("cancellation action rejects forged authority and accepts anonymous direct POST", async ({
  page,
  context,
  browser,
  owners,
  database,
  request,
}) => {
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);
  const foreignContext = await browser.newContext();
  try {
    const foreignOwner = await owners(foreignContext, {
      shop: true,
      published: true,
    });
    const manageUrl = await createEligibleBooking(
      page,
      owner,
      serviceId,
      barberId,
    );
    const token = manageUrl.pathname.split("/").at(-1)!;
    const { rows } = await database.pool.query(
      "SELECT id, shop_id FROM bookings WHERE shop_id=$1",
      [owner.shopId],
    );
    const bookingId = rows[0].id as string;
    const rateKey = createHash("sha256")
      .update(`${rows[0].shop_id}:${token}`)
      .digest("hex");

    try {
      await page.goto(manageUrl.toString());
      await page.getByRole("button", { name: "Cancel appointment" }).click();
      let captured: import("@playwright/test").Request | undefined;
      await page.route("**/*", async (route) => {
        const actionRequest = route.request();
        if (
          actionRequest.method() === "POST" &&
          Boolean(actionRequest.headers()["next-action"])
        ) {
          captured = actionRequest;
          await route.abort();
          return;
        }
        await route.continue();
      });
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Yes, cancel appointment" })
        .click();
      await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
        "cancellation result is unknown",
      );
      expect(captured).toBeDefined();
      await page.unrouteAll({ behavior: "wait" });

      const action = captured!;
      const body = action.postDataBuffer()!;
      const headers = {
        "content-type": action.headers()["content-type"],
        "next-action": action.headers()["next-action"],
        origin: `http://${owner.subdomain}.${SHOP_SUFFIX}`,
      };
      const unchanged = async () => {
        const booking = await database.pool.query(
          "SELECT status, revision FROM bookings WHERE id=$1",
          [bookingId],
        );
        expect(booking.rows[0]).toEqual({ status: "confirmed", revision: 0 });
        expect(
          (
            await database.pool.query(
              "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1",
              [bookingId],
            )
          ).rows[0].count,
        ).toBe(0);
      };

      const wrongOrigin = await request.post(action.url(), {
        headers: { ...headers, origin: "https://attacker.example" },
        data: body,
      });
      expect(
        wrongOrigin.status() >= 400 ||
          (await wrongOrigin.text()).includes("UNAVAILABLE"),
      ).toBe(true);
      await unchanged();

      const ownerHost = await request.post(action.url(), {
        headers: {
          ...headers,
          host: new URL(ownerOrigin).host,
          "x-forwarded-host": new URL(ownerOrigin).host,
          origin: ownerOrigin,
        },
        data: body,
      });
      expect(
        ownerHost.status() >= 400 ||
          (await ownerHost.text()).includes("UNAVAILABLE"),
      ).toBe(true);
      await unchanged();

      const marketingHost = await request.post(action.url(), {
        headers: {
          ...headers,
          host: `localhost:3100`,
          "x-forwarded-host": `localhost:3100`,
          origin: "http://localhost:3100",
        },
        data: body,
      });
      expect(
        marketingHost.status() >= 400 ||
          (await marketingHost.text()).includes("UNAVAILABLE"),
      ).toBe(true);
      await unchanged();

      const wrongShop = await request.post(action.url(), {
        headers: {
          ...headers,
          host: `${foreignOwner.subdomain}.${SHOP_SUFFIX}`,
          "x-forwarded-host": `${foreignOwner.subdomain}.${SHOP_SUFFIX}`,
          origin: `http://${foreignOwner.subdomain}.${SHOP_SUFFIX}`,
        },
        data: body,
      });
      const wrongShopText = await wrongShop.text();
      expect(wrongShop.status() < 500).toBe(true);
      expect(wrongShopText).toContain("UNAVAILABLE");
      expect(wrongShopText).not.toContain("Ada Lovelace");
      await unchanged();

      const malformed = await request.post(action.url(), {
        headers,
        data: Buffer.from("not a serialized server action"),
      });
      expect(malformed.status()).toBeGreaterThanOrEqual(400);
      await unchanged();

      const anonymous = await request.post(action.url(), {
        headers,
        data: body,
      });
      expect(anonymous.status()).toBeLessThan(500);
      expect(await anonymous.text()).toContain("cancelled");
      const cancelled = await database.pool.query(
        "SELECT status, revision FROM bookings WHERE id=$1",
        [bookingId],
      );
      expect(cancelled.rows[0]).toEqual({ status: "cancelled", revision: 1 });
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1 AND kind='cancel'",
            [bookingId],
          )
        ).rows[0].count,
      ).toBe(1);

      await database.pool.query(
        "UPDATE bookings SET capability_revoked_at=now() WHERE id=$1",
        [bookingId],
      );
      const revoked = await request.post(action.url(), { headers, data: body });
      const revokedText = await revoked.text();
      expect(revoked.status() < 500).toBe(true);
      expect(revokedText).toContain("UNAVAILABLE");
      expect(revokedText).not.toContain("Ada Lovelace");
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1",
            [bookingId],
          )
        ).rows[0].count,
      ).toBe(1);

      const expiredEnd = new Date(
        Date.parse("2026-10-31T12:00:00Z") - 169 * 60 * 60_000,
      );
      await database.pool.query(
        "UPDATE bookings SET capability_revoked_at=NULL, start_at=$2, end_at=$3 WHERE id=$1",
        [bookingId, new Date(expiredEnd.getTime() - 35 * 60_000), expiredEnd],
      );
      const expired = await request.post(action.url(), { headers, data: body });
      const expiredText = await expired.text();
      expect(expired.status() < 500).toBe(true);
      expect(expiredText).toContain("UNAVAILABLE");
      expect(expiredText).not.toContain("Ada Lovelace");
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1",
            [bookingId],
          )
        ).rows[0].count,
      ).toBe(1);
    } finally {
      await database.pool.query(
        "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
        [rateKey],
      );
    }
  } finally {
    await foreignContext.close();
  }
});
