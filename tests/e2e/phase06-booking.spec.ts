import { randomUUID } from "node:crypto";
import { test, expect, ownerOrigin, captureState } from "./fixtures";
import { addReadyCatalog } from "./publication-fixtures";
import { chooseBookingOptions } from "./booking-flow-helpers";

test("shows truthful contact and unavailable-message disclosures for a guest booking", async ({
  page,
  context,
  owners,
  database,
}, info) => {
  const owner = await owners(context, { shop: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await page.goto(`${ownerOrigin}/settings`);
  await page.getByRole("button", { name: "Publish shop" }).click();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();
  await page.goto(`http://${owner.subdomain}.localhost:3100/`);

  const bookingDate = (
    process.env.TRIMTIME_E2E_NOW ?? new Date().toISOString()
  ).slice(0, 10);
  const weekday = (new Date(`${bookingDate}T12:00:00Z`).getUTCDay() + 6) % 7;
  const week = Array.from({ length: 7 }, (_, day) => ({
    working: day === weekday ? [{ start: 540, end: 600 }] : [],
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
  await chooseBookingOptions(page, { serviceId, barberId, date: bookingDate });
  await expect(
    page.getByText(
      /A confirmation may be captured locally when configured; inbox delivery is not enabled/i,
    ),
  ).toBeVisible();

  const name = page.getByLabel("Name");
  await name.focus();
  await name.pressSequentially("Ada Lovelace");
  await page.keyboard.press("Tab");
  const email = page.getByLabel("Email");
  const emailAddress = `phase06-${randomUUID()}@example.test`;
  await expect(email).toBeFocused();
  await email.pressSequentially(emailAddress);
  await page.keyboard.press("Tab");
  const optionalPhone = page.getByLabel("Phone number");
  await expect(optionalPhone).toBeFocused();
  await expect(optionalPhone).not.toHaveAttribute("required", "");
  await page.keyboard.press("Tab");
  const consent = page.getByLabel("I’d like WhatsApp booking updates");
  await expect(consent).toBeFocused();
  await page.keyboard.press("Space");
  const phone = page.getByLabel("WhatsApp phone number");
  await page.keyboard.press("Shift+Tab");
  await expect(phone).toBeFocused();
  await expect(phone).toHaveAttribute("required", "");
  await phone.pressSequentially("+12025550142");
  await expect(
    page.getByText(
      "This start is within twelve hours. Online changes won’t be available; contact Call 202-555-0142 if plans change.",
    ),
  ).toBeVisible();
  await captureState(page, "phase06-short-notice-whatsapp", info);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const confirm = page.getByRole("button", { name: /Confirm booking/ });
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Your chair is reserved." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your chair is reserved." }),
  ).toBeFocused();
  await expect(page.getByText(emailAddress, { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Email confirmations are unavailable in this demo/i),
  ).toBeVisible();
});

test("a guest whose selected start was just booked keeps contact details and creates no duplicate", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await page.goto(`${ownerOrigin}/settings`);
  await page.getByRole("button", { name: "Publish shop" }).click();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();
  const secondPage = await context.newPage();
  const url = `http://${owner.subdomain}.localhost:3100/`;
  const firstEmail = `phase06-first-${randomUUID()}@example.test`;
  const secondEmail = `phase06-second-${randomUUID()}@example.test`;

  for (const [bookingPage, email] of [
    [page, firstEmail],
    [secondPage, secondEmail],
  ] as const) {
    await bookingPage.goto(url);
    await chooseBookingOptions(bookingPage, {
      serviceId,
      barberId,
      date: "2026-11-02",
    });
    await bookingPage.getByLabel("Name").fill("Ada Lovelace");
    await bookingPage.getByLabel("Email").fill(email);
  }

  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(
    page.getByRole("heading", { name: "Your chair is reserved." }),
  ).toBeVisible();
  await secondPage.getByRole("button", { name: "Confirm booking" }).click();
  await expect(secondPage.locator("form").getByRole("alert")).toContainText(
    "That time was just taken. No booking was created",
  );
  await expect(secondPage.getByLabel("Name")).toHaveValue("Ada Lovelace");
  await expect(secondPage.getByLabel("Email")).toHaveValue(secondEmail);
  expect(
    (
      await database.pool.query(
        "SELECT count(*)::int AS n FROM bookings WHERE shop_id = $1",
        [owner.shopId],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await database.pool.query(
        "SELECT count(*)::int AS n FROM notification_work w JOIN bookings b ON b.id = w.booking_id WHERE b.shop_id = $1",
        [owner.shopId],
      )
    ).rows[0].n,
  ).toBe(2);
  await secondPage.close();
});

test("rejects a stale service price without creating booking or notification work", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await page.goto(`${ownerOrigin}/settings`);
  await page.getByRole("button", { name: "Publish shop" }).click();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();
  await page.goto(`http://${owner.subdomain}.localhost:3100/`);

  await chooseBookingOptions(page, { serviceId, barberId, date: "2026-11-02" });
  await page.getByLabel("Name").fill("Ada Lovelace");
  const email = `phase06-${randomUUID()}@example.test`;
  await page.getByLabel("Email").fill(email);

  await database.pool.query(
    "UPDATE services SET price_usd = 40 WHERE id = $1",
    [serviceId],
  );
  await page.getByRole("button", { name: /Confirm booking/ }).click();

  await expect(page.locator("form").getByRole("alert")).toContainText(
    "The service details changed.",
  );
  await chooseBookingOptions(page, { serviceId, barberId, date: "2026-11-02" });
  await expect(page.getByLabel("Name")).toHaveValue("Ada Lovelace");
  await expect(page.getByLabel("Email")).toHaveValue(email);
  expect(
    (
      await database.pool.query(
        "SELECT count(*)::int AS n FROM bookings WHERE shop_id = $1",
        [owner.shopId],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await database.pool.query(
        "SELECT count(*)::int AS n FROM notification_work w JOIN bookings b ON b.id = w.booking_id WHERE b.shop_id = $1",
        [owner.shopId],
      )
    ).rows[0].n,
  ).toBe(0);
});

test("rejects invalid guest contact and consent at the server boundary", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await page.goto(`${ownerOrigin}/settings`);
  await page.getByRole("button", { name: "Publish shop" }).click();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();
  await page.goto(`http://${owner.subdomain}.localhost:3100/`);

  await chooseBookingOptions(page, { serviceId, barberId, date: "2026-11-02" });
  await page.locator("form").evaluate((form) => {
    (form as HTMLFormElement).noValidate = true;
  });
  await page.getByLabel("Name").fill("   ");
  await page.getByLabel("Email").fill("not-an-email");
  const consent = page.getByLabel("I’d like WhatsApp booking updates");
  await consent.check();
  const phone = page.getByLabel("WhatsApp phone number");
  await expect(phone).toHaveValue("");
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "Check the booking details and try again.",
  );
  await expect(page.getByLabel("Name")).toHaveValue("   ");
  await expect(page.getByLabel("Email")).toHaveValue("not-an-email");
  await expect(consent).toBeChecked();
  await expect(phone).toHaveValue("");
  expect(
    (
      await database.pool.query(
        "SELECT count(*)::int AS n FROM bookings WHERE shop_id = $1",
        [owner.shopId],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await database.pool.query(
        "SELECT count(*)::int AS n FROM notification_work w JOIN bookings b ON b.id = w.booking_id WHERE b.shop_id = $1",
        [owner.shopId],
      )
    ).rows[0].n,
  ).toBe(0);
});

test("rejects a service identifier belonging to another shop", async ({
  page,
  context,
  browser,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await page.goto(`${ownerOrigin}/settings`);
  await page.getByRole("button", { name: "Publish shop" }).click();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();

  const foreignContext = await browser.newContext();
  try {
    const foreignOwner = await owners(foreignContext, { shop: true });
    const foreign = await addReadyCatalog(database.pool, foreignOwner);
    await page.goto(`http://${owner.subdomain}.localhost:3100/`);
    await chooseBookingOptions(page, {
      serviceId,
      barberId,
      date: "2026-11-02",
    });
    await page.getByLabel("Name").fill("Ada Lovelace");
    await page.getByLabel("Email").fill(`phase06-${randomUUID()}@example.test`);

    let changedRequest = false;
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !request.headers()["next-action"]) {
        await route.continue();
        return;
      }
      const body = request.postData();
      if (!body?.includes(serviceId)) {
        await route.continue();
        return;
      }
      changedRequest = true;
      await route.continue({
        postData: body.replace(serviceId, foreign.serviceId),
      });
    });
    await page.getByRole("button", { name: "Confirm booking" }).click();

    await expect(page.locator("form").getByRole("alert")).toContainText(
      "The service details changed.",
    );
    expect(changedRequest).toBe(true);
    for (const shopId of [owner.shopId, foreignOwner.shopId]) {
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS n FROM bookings WHERE shop_id = $1",
            [shopId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS n FROM notification_work w JOIN bookings b ON b.id = w.booking_id WHERE b.shop_id = $1",
            [shopId],
          )
        ).rows[0].n,
      ).toBe(0);
    }
  } finally {
    await foreignContext.close();
  }
});

test("allows three bookings for the same email and rejects the fourth", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  const week = Array.from({ length: 7 }, () => ({
    working: [{ start: 540, end: 1020 }],
    breaks: [],
  }));
  await database.pool.query(
    "UPDATE shop_schedules SET week = $2::jsonb WHERE shop_id = $1",
    [owner.shopId, JSON.stringify(week)],
  );
  await database.pool.query(
    "UPDATE barber_schedules SET week = $2::jsonb WHERE shop_id = $1",
    [owner.shopId, JSON.stringify(week)],
  );
  await page.goto(`${ownerOrigin}/settings`);
  await page.getByRole("button", { name: "Publish shop" }).click();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();

  const email = `phase06-${randomUUID()}@example.test`;
  for (const [index, date] of [
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
  ].entries()) {
    await page.goto(`http://${owner.subdomain}.localhost:3100/`);
    await chooseBookingOptions(page, { serviceId, barberId, date });
    await page.getByLabel("Name").fill("Ada Lovelace");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Confirm booking" }).click();

    if (index < 3) {
      await expect(
        page.getByRole("heading", { name: "Your chair is reserved." }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByText(
          "Too many booking attempts. Please wait before trying again.",
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Confirm booking/ }),
      ).toBeEnabled();
    }
  }

  expect(
    (
      await database.pool.query(
        "SELECT count(*)::int AS n FROM bookings WHERE shop_id = $1",
        [owner.shopId],
      )
    ).rows[0].n,
  ).toBe(3);
});
