import { randomUUID } from "node:crypto";
import { test, expect, ownerOrigin } from "./fixtures";

test("availability uses the owner sign-in and setup redirects", async ({
  page,
  context,
  owners,
}) => {
  await page.goto(`${ownerOrigin}/availability`);
  await expect(page).toHaveURL(/\/sign-in$/);
  await owners(context);
  await page.goto(`${ownerOrigin}/availability`);
  await expect(page).toHaveURL(/\/setup$/);
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);
  await expect(page).toHaveURL(/\/availability$/);
  await expect(
    page.getByRole("heading", { name: "Shop and barber availability" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Shop hours" })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /Date overrides.*blocks/ }),
  ).toBeVisible();
});

test("captured availability saves reject an untrusted origin", async ({
  page,
  context,
  owners,
  request,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);
  await page.getByRole("button", { name: "Add hours" }).first().click();
  await page.getByLabel("Opens").first().fill("09:00");
  await page.getByLabel("Closes").first().fill("12:00");
  const captured = page.waitForRequest(
    (entry) =>
      entry.method() === "POST" && Boolean(entry.headers()["next-action"]),
  );
  await page.getByRole("button", { name: "Save hours" }).click();
  const saveAction = await captured;
  await expect(page.getByRole("status")).toContainText("Availability saved.");
  const response = await request.post(saveAction.url(), {
    headers: {
      "content-type": saveAction.headers()["content-type"],
      "next-action": saveAction.headers()["next-action"],
      origin: "https://attacker.example",
      cookie: owner.cookie,
    },
    data: saveAction.postDataBuffer()!,
  });
  expect(response.status()).toBeGreaterThanOrEqual(400);

  const barberId = randomUUID();
  const serviceId = randomUUID();
  const week = JSON.stringify(
    Array.from({ length: 7 }, () => ({ working: [], breaks: [] })),
  );
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Preview barber')",
    [barberId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO services (id, shop_id, name, price_usd, duration_minutes) VALUES ($1, $2, 'Preview service', '12.00', 35)",
    [serviceId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO barber_services (shop_id, barber_id, service_id) VALUES ($1, $2, $3)",
    [owner.shopId, barberId, serviceId],
  );
  await database.pool.query(
    "INSERT INTO shop_schedules (shop_id, week, revision) VALUES ($1, $2::jsonb, 1) ON CONFLICT (shop_id) DO UPDATE SET week = EXCLUDED.week, revision = EXCLUDED.revision",
    [owner.shopId, week],
  );
  await database.pool.query(
    "INSERT INTO barber_schedules (shop_id, barber_id, week, revision) VALUES ($1, $2, $3::jsonb, 1)",
    [owner.shopId, barberId, week],
  );
  await page.reload();
  await page.getByLabel("Service").selectOption(serviceId);
  await page.getByLabel("Eligible barber").selectOption(barberId);
  await page.getByLabel("Date", { exact: true }).fill("2026-11-01");
  const previewAction = page.waitForRequest(
    (entry) =>
      entry.method() === "POST" && Boolean(entry.headers()["next-action"]),
  );
  await page.getByRole("button", { name: "Preview times" }).click();
  const previewRequest = await previewAction;
  const previewResponse = await request.post(previewRequest.url(), {
    headers: {
      "content-type": previewRequest.headers()["content-type"],
      "next-action": previewRequest.headers()["next-action"],
      origin: "https://attacker.example",
      cookie: owner.cookie,
    },
    data: previewRequest.postDataBuffer()!,
  });
  expect(previewResponse.status()).toBeGreaterThanOrEqual(400);
});
