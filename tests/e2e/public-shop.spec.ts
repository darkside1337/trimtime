import { randomUUID } from "node:crypto";
import { test, expect, ownerOrigin, captureState } from "./fixtures";
import { addReadyCatalog } from "./publication-fixtures";
import { chooseBookingOptions } from "./booking-flow-helpers";

test("guest booking advances one verified choice at a time @device", async ({
  page,
  context,
  owners,
  database,
}, info) => {
  const owner = await owners(context, { shop: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await database.pool.query(
    "UPDATE shops SET time_zone = 'Pacific/Kiritimati' WHERE id = $1",
    [owner.shopId],
  );
  await page.goto(`${ownerOrigin}/settings`);
  await page.getByRole("button", { name: "Publish shop" }).click();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();
  const response = await page.goto(`http://${owner.subdomain}.localhost:3100/`);
  expect(response?.status()).toBe(200);

  await page.locator(`input[name="serviceId"][value="${serviceId}"]`).check();
  await page.getByRole("button", { name: "Choose your barber" }).click();
  await expect(
    page.getByRole("heading", { name: "Pick your barber" }),
  ).toBeFocused();
  await page.locator(`input[name="barberId"][value="${barberId}"]`).check();
  await page.getByRole("button", { name: "Choose date and time" }).click();
  await expect(
    page.getByRole("heading", { name: "Let’s find your time." }),
  ).toBeFocused();
  const timeZone = (
    await database.pool.query("SELECT time_zone FROM shops WHERE id = $1", [
      owner.shopId,
    ])
  ).rows[0].time_zone as string;
  const dateInput = page.getByLabel("Date", { exact: true });
  const maxDate = await dateInput.getAttribute("max");
  expect(maxDate).not.toBeNull();
  const expectedMax = await page.evaluate((zone) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const part = (type: string) =>
      parts.find((item) => item.type === type)?.value;
    const date = new Date(
      `${part("year")}-${part("month")}-${part("day")}T00:00:00Z`,
    );
    date.setUTCDate(date.getUTCDate() + 30);
    return date.toISOString().slice(0, 10);
  }, timeZone);
  expect(maxDate).toBe(expectedMax);
  const maxDateLabel = await page.evaluate(
    (date) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        dateStyle: "full",
      }).format(new Date(`${date}T00:00:00Z`)),
    maxDate!,
  );
  for (let index = 0; index < 4; index += 1)
    await page.getByRole("button", { name: "Next dates" }).click();
  await page.getByRole("button", { name: maxDateLabel }).click();
  await expect(dateInput).toHaveValue(maxDate!);
  const summaryDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${maxDate}T00:00:00Z`));
  if (page.viewportSize()!.width <= 767)
    await page.locator("details").first().locator("summary").click();
  await expect(
    page
      .locator('aside[aria-label="Booking summary"]:visible')
      .getByText(summaryDate, { exact: true }),
  ).toBeVisible();
  await captureState(page, "customer-booking-date-time", info);
});

test("public booking requires explicit choices and creates a private manage link @device", async ({
  page,
  context,
  owners,
  database,
  request,
}, info) => {
  const owner = await owners(context, { shop: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await page.goto(`${ownerOrigin}/settings`);
  await page.getByRole("button", { name: "Publish shop" }).click();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();
  await page.goto(`http://${owner.subdomain}.localhost:3100/`);
  await expect(
    page.getByRole("link", { name: "Juniper Barber" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Make time for a fresh start." }),
  ).toBeVisible();
  await expect(
    page.locator(`input[name="serviceId"][value="${serviceId}"]`),
  ).not.toBeChecked();
  await chooseBookingOptions(page, {
    serviceId,
    barberId,
    date: "2026-11-02",
  });
  await captureState(page, "customer-booking-details", info);
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill(`ada-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(
    page.getByRole("heading", { name: "Your chair is reserved." }),
  ).toBeVisible();
  await captureState(page, "customer-booking-receipt", info);
  const manageLink = page.getByRole("link", {
    name: "Open booking details",
  });
  const manageUrl = await manageLink.getAttribute("href");
  expect(manageUrl).toContain("/manage/");
  await page.getByRole("button", { name: "Book another appointment" }).click();
  await expect(
    page.getByRole("heading", { name: "What are we doing today?" }),
  ).toBeFocused();
  await expect(
    page.locator(`input[name="serviceId"][value="${serviceId}"]`),
  ).not.toBeChecked();
  await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("trimtime:pending-booking-recovery"),
    ),
  ).toBeNull();
  await page.locator(`input[name="serviceId"][value="${serviceId}"]`).check();
  await page.getByRole("button", { name: "Choose your barber" }).click();
  expect(
    (
      await database.pool.query(
        "SELECT count(*)::int AS n FROM bookings WHERE shop_id=$1",
        [owner.shopId],
      )
    ).rows[0].n,
  ).toBe(1);
  await page.goto(
    new URL(manageUrl!, `http://${owner.subdomain}.localhost:3100`).toString(),
  );
  await expect(
    page.getByRole("heading", { name: "Your chair. Your plans." }),
  ).toBeVisible();
  await expect(page.getByText("Cut", { exact: true })).toBeVisible();
  await expect(page.getByText("$35.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your chair. Your plans." }),
  ).toBeVisible();
  await page.goto(`http://${owner.subdomain}.localhost:3100/`);

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if ([390, 768, 1440].includes(width))
      await captureState(page, `public-booking-flow-${width}`, info);
  }
  await database.pool.query(
    "UPDATE barbers SET archived = true WHERE id = $1",
    [barberId],
  );
  await page.reload();
  await expect(page.getByText("No bookable services right now.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Confirm booking/ }),
  ).toHaveCount(0);
  await expect(page.getByText(/Private Owner|@example\.test/)).toHaveCount(0);
  for (const path of [
    "/settings",
    "/api/auth/get-session",
    "/design-system",
    "/owner/settings",
  ]) {
    expect(
      (
        await request.get(`http://${owner.subdomain}.localhost:3100${path}`)
      ).status(),
    ).toBe(404);
  }
  expect(
    (
      await request.post(`http://${owner.subdomain}.localhost:3100/`, {
        data: "ignored",
      })
    ).status(),
  ).toBe(404);
});

test("changing a service clears the barber and downstream date/start choices", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const { barberId: aliceId, serviceId: alphaId } = await addReadyCatalog(
    database.pool,
    owner,
  );
  const bobId = randomUUID();
  const betaId = randomUUID();
  const week = Array.from({ length: 7 }, (_, day) => ({
    working: day === 0 ? [{ start: 540, end: 600 }] : [],
    breaks: [],
  }));
  await database.pool.query("UPDATE barbers SET name = 'Alice' WHERE id = $1", [
    aliceId,
  ]);
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Bob')",
    [bobId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO barber_schedules (shop_id, barber_id, week, revision) VALUES ($1, $2, $3::jsonb, 1)",
    [owner.shopId, bobId, JSON.stringify(week)],
  );
  await database.pool.query(
    "INSERT INTO services (id, shop_id, name, price_usd, duration_minutes) VALUES ($1, $2, 'Beta', 35, 35)",
    [betaId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO barber_services (shop_id, barber_id, service_id) VALUES ($1, $2, $3)",
    [owner.shopId, bobId, betaId],
  );
  await page.goto(`${ownerOrigin}/settings`);
  await page.getByRole("button", { name: "Publish shop" }).click();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();
  await page.goto(`http://${owner.subdomain}.localhost:3100/`);
  await page.locator(`input[name="serviceId"][value="${alphaId}"]`).check();
  await page.getByRole("button", { name: "Choose your barber" }).click();
  await page.locator(`input[name="barberId"][value="${aliceId}"]`).check();
  await page.getByRole("button", { name: "Choose date and time" }).click();
  const date = page.getByLabel("Date", { exact: true });
  await date.fill("2026-11-02");
  await expect(page.locator('input[name="startAt"]').first()).toBeVisible();
  await page.locator('input[name="startAt"]').first().check();
  await page.getByRole("button", { name: "Your details", exact: true }).click();
  await page.getByRole("button", { name: "Back to time" }).click();
  await page.getByRole("button", { name: "Back to barbers" }).click();
  await page.getByRole("button", { name: "Back to services" }).click();
  await page.locator(`input[name="serviceId"][value="${betaId}"]`).check();
  await expect(page.locator('input[name="barberId"]')).toHaveCount(0);
  await expect(page.locator('input[name="startAt"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Choose your barber" }).click();
  await page.locator(`input[name="barberId"][value="${bobId}"]`).check();
  await page.getByRole("button", { name: "Choose date and time" }).click();
  await expect(date).toHaveValue("");
  await date.fill("2026-11-02");
  await expect(page.locator('input[name="startAt"]').first()).toBeVisible();
});
