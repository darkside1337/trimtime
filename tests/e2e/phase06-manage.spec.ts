import { randomUUID } from "node:crypto";
import { test, expect, ownerOrigin, captureState } from "./fixtures";
import { addReadyCatalog } from "./publication-fixtures";
import { chooseBookingOptions } from "./booking-flow-helpers";

async function createBooking(
  page: import("@playwright/test").Page,
  owner: { subdomain: string },
  serviceId: string,
  barberId: string,
  date = "2026-11-02",
) {
  await page.goto(`${ownerOrigin}/settings`);
  await page.getByRole("button", { name: "Publish shop" }).click();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();

  await page.goto(`http://${owner.subdomain}.localhost:3100/`);
  await chooseBookingOptions(page, { serviceId, barberId, date });
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill(`ada-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  const link = page.getByRole("link", { name: "Open booking details" });
  await expect(link).toBeVisible();
  return new URL((await link.getAttribute("href"))!, page.url());
}

test("saved booking details survive catalog edits and unpublication without read mutation", async ({
  page,
  browser,
  context,
  owners,
  database,
  request,
}, info) => {
  const owner = await owners(context, { shop: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  const week = Array.from({ length: 7 }, (_, day) => ({
    working: day === 0 ? [{ start: 540, end: 660 }] : [],
    breaks: [],
  }));
  await database.pool.query(
    "UPDATE shop_schedules SET week = $2::jsonb WHERE shop_id = $1",
    [owner.shopId, JSON.stringify(week)],
  );
  await database.pool.query(
    "UPDATE barber_schedules SET week = $3::jsonb WHERE shop_id = $1 AND barber_id = $2",
    [owner.shopId, barberId, JSON.stringify(week)],
  );
  const manageUrl = await createBooking(
    page,
    owner,
    serviceId,
    barberId,
    "2026-11-09",
  );
  const stalePage = await context.newPage();
  await stalePage.goto(`http://${owner.subdomain}.localhost:3100/`);
  await chooseBookingOptions(stalePage, {
    serviceId,
    barberId,
    date: "2026-11-09",
    startIndex: -1,
  });
  await stalePage.getByLabel("Name").fill("Grace Hopper");
  await stalePage
    .getByLabel("Email")
    .fill(`grace-${randomUUID()}@example.test`);
  await expect(
    stalePage.getByRole("button", { name: "Confirm booking" }),
  ).toBeEnabled();

  await page.goto(`${ownerOrigin}/services`);
  const service = page.locator("article").filter({ hasText: "Cut" });
  await service.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Service name").fill("Fresh Cut");
  await page.getByLabel("Price (USD)").fill("45");
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByText("Fresh Cut", { exact: true })).toBeVisible();
  await service.getByRole("button", { name: "Hide service" }).click();
  await expect(page.getByRole("status")).toContainText("Service hidden.");

  await service.getByRole("button", { name: "Archive" }).click();
  const archiveDialog = page.getByRole("dialog");
  await archiveDialog.getByRole("button", { name: "Archive service" }).click();
  await expect(archiveDialog.getByRole("alert")).toContainText(
    "confirmed booking",
  );
  await archiveDialog.getByRole("button", { name: "Cancel" }).click();

  await page.goto(`${ownerOrigin}/settings`);
  await page.getByLabel("Shop name").fill("Current Juniper Shop");
  await page.getByLabel("Public contact").fill("Call 202-555-0199");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await page.getByRole("button", { name: "Unpublish shop" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Unpublish", exact: true })
    .click();

  const before = await database.pool.query(
    `SELECT b.status, b.start_at, b.end_at, b.service_name, b.service_price_usd,
            b.customer_name, b.customer_email,
            (SELECT count(*)::int FROM notification_work w WHERE w.booking_id = b.id) AS work_count
       FROM bookings b WHERE b.shop_id = $1`,
    [owner.shopId],
  );
  expect(before.rows).toHaveLength(1);

  const response = await request.get(manageUrl.toString());
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(manageUrl.toString());
  await expect(
    page.getByRole("heading", { name: "Your chair. Your plans." }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("complementary")
      .getByText("Current Juniper Shop", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Cut", { exact: true })).toBeVisible();
  await expect(page.getByText("$35.00", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("complementary")
      .getByText("123 Example Street", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Email confirmations are unavailable in this demo/i),
  ).toBeVisible();
  for (const viewport of [
    { width: 1440, height: 1000, label: "desktop" },
    { width: 768, height: 1024, label: "tablet" },
    { width: 390, height: 844, label: "phone" },
    { width: 320, height: 800, label: "phone-320" },
  ]) {
    await page.setViewportSize(viewport);
    await captureState(page, `manage-details-${viewport.label}`, info);
  }
  await page.setViewportSize({ width: 1024, height: 900 });
  const previewRequests: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method()))
      previewRequests.push(request.method());
  });
  const storageBefore = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  await page.getByRole("button", { name: "Open change preview" }).click();
  await expect(
    page.getByRole("heading", { name: "A fresh time. Your call." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "A fresh time. Your call." }),
  ).toBeFocused();
  await captureState(page, "manage-edit-desktop", info);
  await page.setViewportSize({ width: 390, height: 844 });
  await captureState(page, "manage-edit-phone", info);
  await page.setViewportSize({ width: 320, height: 800 });
  await captureState(page, "manage-edit-phone-320", info);
  await page.setViewportSize({ width: 1024, height: 900 });
  const previewTime = page.getByRole("radio", { name: "9:15 AM", exact: true });
  await previewTime.focus();
  await previewTime.press("Space");
  await expect(previewTime).toBeChecked();
  await page
    .getByRole("button", { name: "Review change · Preview only" })
    .click();
  await expect(
    page.getByRole("heading", { name: "A quick look before we change it." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "A quick look before we change it." }),
  ).toBeFocused();
  await captureState(page, "manage-review-desktop", info);
  await page.setViewportSize({ width: 390, height: 844 });
  await captureState(page, "manage-review-phone", info);
  await page.setViewportSize({ width: 320, height: 800 });
  await captureState(page, "manage-review-phone-320", info);
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(
    page.getByRole("button", {
      name: "Confirm appointment change · Unavailable",
    }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Back to your booking" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await captureState(page, "manage-discard-dialog-desktop", info);
  await page.setViewportSize({ width: 390, height: 844 });
  await captureState(page, "manage-discard-dialog-phone", info);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.getByRole("button", { name: "Discard preview choices" }).click();
  await page.getByRole("button", { name: "Preview cancellation" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "This appointment will not be cancelled.",
  );
  await expect(
    page.getByRole("button", { name: "Yes, cancel appointment · Unavailable" }),
  ).toBeDisabled();
  await captureState(page, "manage-cancel-dialog-desktop", info);
  await page.setViewportSize({ width: 390, height: 844 });
  await captureState(page, "manage-cancel-dialog-phone", info);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.getByRole("button", { name: "Keep appointment" }).click();
  expect(previewRequests).toEqual([]);
  expect(
    await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    })),
  ).toEqual(storageBefore);
  await expect(page.getByText("Fresh Cut", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await expect(
    page
      .getByRole("complementary")
      .getByText("Call 202-555-0199", { exact: true }),
  ).toBeVisible();
  await captureState(page, "phase06-manage-current-details", info);
  await page.reload();
  await expect(page.getByText("$35.00", { exact: true })).toBeVisible();
  expect((await request.head(manageUrl.toString())).status()).toBe(200);

  const guest = await browser.newContext();
  try {
    const guestPage = await guest.newPage();
    await guestPage.goto(manageUrl.toString());
    await expect(
      guestPage.getByRole("heading", { name: "Your chair. Your plans." }),
    ).toBeVisible();
    await expect(guestPage.getByText("Ada Lovelace")).toBeVisible();
  } finally {
    await guest.close();
  }

  await stalePage.getByRole("button", { name: /Confirm booking/ }).click();
  await expect(stalePage.locator("form").getByRole("alert")).toContainText(
    "This shop is not accepting bookings right now.",
  );
  await stalePage.close();

  await page.goto(`http://${owner.subdomain}.localhost:3100/`);
  await expect(
    page.getByText(
      "Online booking is paused. Existing appointments and their private links are still available.",
    ),
  ).toBeVisible();
  expect(
    (
      await database.pool.query(
        `SELECT b.status, b.start_at, b.end_at, b.service_name, b.service_price_usd,
                b.customer_name, b.customer_email,
                (SELECT count(*)::int FROM notification_work w WHERE w.booking_id = b.id) AS work_count
           FROM bookings b WHERE b.shop_id = $1`,
        [owner.shopId],
      )
    ).rows,
  ).toEqual(before.rows);
});

test("wrong-shop, expired, revoked, and unknown links share the unavailable view", async ({
  page,
  browser,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const otherContext = await browser.newContext();
  const otherShop = await owners(otherContext, { shop: true });
  await otherContext.close();
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  const manageUrl = await createBooking(page, owner, serviceId, barberId);
  const token = manageUrl.pathname.split("/").at(-1)!;
  const unknownUrl = new URL(
    `/manage/${randomUUID()}`,
    `http://${owner.subdomain}.localhost:3100`,
  );
  const otherShopUrl = new URL(
    `/manage/${token}`,
    `http://${otherShop.subdomain}.localhost:3100`,
  );
  const booking = (
    await database.pool.query(
      "SELECT id, start_at, end_at FROM bookings WHERE shop_id = $1",
      [owner.shopId],
    )
  ).rows[0];
  const bookingId = booking.id as string;

  await page.setViewportSize({ width: 1024, height: 900 });
  const unavailableViews: string[] = [];
  for (const url of [unknownUrl, otherShopUrl]) {
    const response = await page.goto(url.toString());
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Booking link unavailable" }),
    ).toBeVisible();
    unavailableViews.push(await page.locator("main").innerText());
  }
  await page.setViewportSize({ width: 1024, height: 900 });
  await captureState(page, "manage-unavailable-desktop", test.info());
  await page.setViewportSize({ width: 390, height: 844 });
  await captureState(page, "manage-unavailable-phone", test.info());
  await page.setViewportSize({ width: 320, height: 800 });
  await captureState(page, "manage-unavailable-phone-320", test.info());
  await page.setViewportSize({ width: 1024, height: 900 });

  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? Date.now()).getTime();
  const end = new Date(now - 169 * 60 * 60_000);
  const start = new Date(end.getTime() - 35 * 60_000);
  await database.pool.query(
    "UPDATE bookings SET end_at = $2, start_at = $3 WHERE id = $1",
    [bookingId, end, start],
  );
  const expired = await page.goto(manageUrl.toString());
  expect(expired?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Booking link unavailable" }),
  ).toBeVisible();
  unavailableViews.push(await page.locator("main").innerText());

  await database.pool.query(
    "UPDATE bookings SET start_at = $2, end_at = $3, capability_revoked_at = now() WHERE id = $1",
    [bookingId, booking.start_at, booking.end_at],
  );
  const revoked = await page.goto(manageUrl.toString());
  expect(revoked?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Booking link unavailable" }),
  ).toBeVisible();
  unavailableViews.push(await page.locator("main").innerText());
  await expect(page.getByText("Ada Lovelace")).toHaveCount(0);
  await expect(page.getByText("Cut", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh message status" }),
  ).toHaveCount(0);
  expect(new Set(unavailableViews).size).toBe(1);
});

test("cutoff, cancelled, and past appointments show live view-only guidance", async ({
  page,
  context,
  owners,
  database,
}, info) => {
  const owner = await owners(context, { shop: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  const manageUrl = await createBooking(page, owner, serviceId, barberId);
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? Date.now()).getTime();
  const start = new Date(now + 11 * 60 * 60_000);
  const end = new Date(start.getTime() + 35 * 60_000);
  await database.pool.query(
    "UPDATE bookings SET start_at=$2, end_at=$3 WHERE shop_id=$1",
    [owner.shopId, start, end],
  );
  await page.goto(manageUrl.toString());
  await expect(
    page.getByText("Online changes are closed.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open change preview" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Preview cancellation" }),
  ).toHaveCount(0);
  await captureState(page, "manage-cutoff", info);

  await database.pool.query(
    "UPDATE bookings SET status='cancelled' WHERE shop_id=$1",
    [owner.shopId],
  );
  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: "Cancelled" }),
  ).toBeVisible();
  await captureState(page, "manage-cancelled", info);

  await database.pool.query(
    "UPDATE bookings SET status='confirmed', start_at=$2, end_at=$3 WHERE shop_id=$1",
    [
      owner.shopId,
      new Date(now - 2 * 60 * 60_000),
      new Date(now - 60 * 60_000),
    ],
  );
  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: "Past, unmarked" }),
  ).toBeVisible();
  await expect(page.getByText("Completed", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open change preview" }),
  ).toHaveCount(0);
  await captureState(page, "manage-past-unmarked", info);
});
