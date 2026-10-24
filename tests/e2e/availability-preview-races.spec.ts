import { randomUUID } from "node:crypto";
import { expect, ownerOrigin, test } from "./fixtures";

test("editing a weekly draft invalidates an in-flight preview without blocking save", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const barberId = randomUUID();
  const serviceId = randomUUID();
  const week = Array.from({ length: 7 }, () => ({
    working: [{ start: 540, end: 660 }],
    breaks: [],
  }));
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Preview barber')",
    [barberId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO services (id, shop_id, name, price_usd, duration_minutes) VALUES ($1, $2, 'Preview cut', '20.00', 30)",
    [serviceId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO barber_services (shop_id, barber_id, service_id) VALUES ($1, $2, $3)",
    [owner.shopId, barberId, serviceId],
  );
  await database.pool.query(
    "INSERT INTO shop_schedules (shop_id, week, revision) VALUES ($1, $2::jsonb, 1)",
    [owner.shopId, JSON.stringify(week)],
  );
  await database.pool.query(
    "INSERT INTO barber_schedules (shop_id, barber_id, week, revision) VALUES ($1, $2, $3::jsonb, 1)",
    [owner.shopId, barberId, JSON.stringify(week)],
  );
  await page.goto(`${ownerOrigin}/availability`);
  await page.getByLabel("Service", { exact: true }).selectOption(serviceId);
  await page.getByLabel("Eligible barber").selectOption(barberId);
  await page.getByLabel("Date", { exact: true }).fill("2026-11-02");
  await page.getByLabel("Opens").first().fill("09:15");

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: () => void;
  const responseReady = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route("**/availability", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Preview times" }).click();
  try {
    await responseReady;
    await expect(
      page.getByRole("button", { name: "Save hours" }),
    ).toBeEnabled();
    await page.getByLabel("Opens").first().fill("09:30");
  } finally {
    release();
  }
  await expect(
    page.getByRole("button", { name: "Preview times" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Available starts", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/Showing saved availability for/)).toHaveCount(0);
  await expect(page.getByLabel("Service", { exact: true })).toHaveValue(
    serviceId,
  );
  await expect(page.getByLabel("Eligible barber")).toHaveValue(barberId);
  await page.unrouteAll({ behavior: "wait" });
  await page.getByRole("button", { name: "Preview times" }).click();
  await expect(
    page.getByRole("heading", { name: "Available starts", exact: true }),
  ).toBeVisible();
});
