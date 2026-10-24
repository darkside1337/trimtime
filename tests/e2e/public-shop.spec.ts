import { randomUUID } from "node:crypto";
import { test, expect, ownerOrigin, captureState } from "./fixtures";
import { addReadyCatalog } from "./publication-fixtures";

test("public shop shows only the current catalog and eligible availability", async ({
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
  await page.goto(
    `http://${owner.subdomain}.localhost:3100/?serviceId=${serviceId}&barberId=${barberId}&date=2026-11-02`,
  );
  await expect(
    page.getByRole("heading", { name: "Juniper Barber", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cut", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Eligible starts" }),
  ).toContainText("09:00 -05:00");
  await expect(
    page.getByRole("list", { name: "Eligible starts" }),
  ).toContainText("09:15 -05:00");
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if ([390, 768, 1440].includes(width))
      await captureState(page, `public-preview-populated-${width}`, info);
  }
  await database.pool.query(
    "UPDATE barbers SET archived = true WHERE id = $1",
    [barberId],
  );
  await page.reload();
  await expect(
    page.getByText("No services are currently offered."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cut", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "That selection is no longer available. Choose the service and barber again.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /book/i })).toHaveCount(0);
  await expect(page.getByText(/Private Owner|@example\.test/)).toHaveCount(0);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if ([390, 768, 1440].includes(width))
      await captureState(page, `public-preview-empty-${width}`, info);
  }
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

test("changing service immediately selects its eligible barber before the first preview", async ({
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
  await page.goto(
    `http://${owner.subdomain}.localhost:3100/?date=2026-11-02&serviceId=${alphaId}&barberId=${aliceId}`,
  );
  const service = page.locator('select[name="serviceId"]');
  const barber = page.getByLabel("Barber");
  await service.selectOption(betaId);
  await expect(barber.locator("option")).toHaveText(["Bob"]);
  await expect(barber).toHaveValue(bobId);
  await page.getByRole("button", { name: "Preview starts" }).click();
  await expect(page).toHaveURL(new RegExp(`serviceId=${betaId}`));
  await expect(page).toHaveURL(new RegExp(`barberId=${bobId}`));
  await expect(
    page.getByRole("list", { name: "Eligible starts" }),
  ).toContainText("09:00 -05:00");
});
