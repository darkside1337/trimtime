import { randomUUID } from "node:crypto";
import { expect, ownerOrigin, test } from "./fixtures";

const nextAction = (request: import("@playwright/test").Request) =>
  request.method() === "POST" && Boolean(request.headers()["next-action"]);

async function loadShopDate(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: "Add date override or block" })
    .click();
  await page.getByLabel("Schedule day").fill("2026-11-02");
  const requestPromise = page.waitForRequest(nextAction);
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
  const request = await requestPromise;
  await request.response();
  return request.headers()["next-action"]!;
}

async function resolveBoundary(
  page: import("@playwright/test").Page,
  label: string,
) {
  const response = page.waitForResponse((response) =>
    nextAction(response.request()),
  );
  await page.getByRole("button", { name: label }).click();
  await response;
}

async function seedBarber(
  database: { pool: import("pg").Pool },
  shopId: string,
) {
  const barberId = randomUUID();
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Race test barber')",
    [barberId, shopId],
  );
  return barberId;
}

test("closing a dated editor asks before discarding its draft", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);
  await loadShopDate(page);
  await page
    .getByRole("checkbox", {
      name: "Replace recurring hours and breaks",
      exact: true,
    })
    .check();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page
    .getByRole("dialog", { name: "Discard unsaved changes?" })
    .getByRole("button", { name: "Discard changes" })
    .click();
  await expect(
    page.getByRole("dialog", { name: /Date availability/ }),
  ).toHaveCount(0);
});

test("a saved date reports when its follow-up reload fails", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);
  const loadAction = await loadShopDate(page);
  await page.route("**/*", (route) =>
    route.request().headers()["next-action"] === loadAction
      ? route.abort()
      : route.continue(),
  );

  await page
    .getByRole("checkbox", {
      name: "Close the shop for this date",
      exact: true,
    })
    .check();
  const saveRequest = page.waitForRequest(
    (request) =>
      nextAction(request) && request.headers()["next-action"] !== loadAction,
  );
  await page.getByRole("button", { name: "Save date settings" }).click();
  await saveRequest;
  await expect(
    page.locator('p[aria-live="polite"]:not([role="status"])'),
  ).toContainText(
    /saved, but.*(could not|failed|unable).*(load|reload|refresh)/i,
  );
  await expect(
    page.getByRole("button", { name: "Reload saved state" }),
  ).toBeEnabled();
  const saved = await database.pool.query(
    "SELECT closed FROM shop_date_schedules WHERE shop_id = $1 AND date = '2026-11-02'",
    [owner.shopId],
  );
  expect(saved.rows[0]).toEqual({ closed: true });
  await page.unrouteAll();
  await page.getByRole("button", { name: "Reload saved state" }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "Close the shop for this date",
      exact: true,
    }),
  ).toBeChecked();
});

test("a saved block reports when its follow-up reload fails", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const barberId = await seedBarber(database, owner.shopId);
  await page.goto(`${ownerOrigin}/availability`);
  const loadAction = await loadShopDate(page);
  await page.getByLabel("Exception type").selectOption("block");
  await page.getByLabel("Barber for this time block").selectOption(barberId);
  await page.getByLabel("Start (shop local time)").fill("10:00");
  await resolveBoundary(page, "Resolve start");
  await page.getByLabel("End (shop local time, 24:00 allowed)").fill("10:30");
  await resolveBoundary(page, "Resolve end");
  await page.getByLabel("Note (optional)").fill("reload recovery marker");
  await page.route("**/*", (route) =>
    route.request().headers()["next-action"] === loadAction
      ? route.abort()
      : route.continue(),
  );

  await page.getByRole("button", { name: "Save time block" }).click();
  await expect(
    page.locator('p[aria-live="polite"]:not([role="status"])'),
  ).toContainText(
    /saved, but.*(could not|failed|unable).*(load|reload|refresh)/i,
  );
  await expect(
    page.getByRole("button", { name: "Reload saved state" }),
  ).toBeEnabled();
  const saved = await database.pool.query(
    "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2",
    [owner.shopId, barberId],
  );
  expect(saved.rows[0]).toEqual({ count: 1 });
  await page.unrouteAll();
  await page.getByRole("button", { name: "Reload saved state" }).click();
  await expect(
    page.getByRole("dialog").getByText("reload recovery marker"),
  ).toBeVisible();
  const recovered = await database.pool.query(
    "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2",
    [owner.shopId, barberId],
  );
  expect(recovered.rows[0]).toEqual({ count: 1 });
});

test("a failed same-date barber load hides the previous shop draft", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const barberId = await seedBarber(database, owner.shopId);
  for (const [targetId, start] of [
    ["shop", 600],
    [barberId, 720],
  ] as const) {
    if (targetId === "shop") {
      await database.pool.query(
        "INSERT INTO shop_date_schedules (shop_id, date, override, closed, revision) VALUES ($1, '2026-11-02', $2::jsonb, false, 1)",
        [
          owner.shopId,
          JSON.stringify({ working: [{ start, end: start + 60 }], breaks: [] }),
        ],
      );
    } else {
      await database.pool.query(
        "INSERT INTO barber_date_schedules (shop_id, barber_id, date, override, closed, revision) VALUES ($1, $2, '2026-11-02', $3::jsonb, false, 1)",
        [
          owner.shopId,
          targetId,
          JSON.stringify({ working: [{ start, end: start + 60 }], breaks: [] }),
        ],
      );
    }
  }
  await page.goto(`${ownerOrigin}/availability`);
  const loadAction = await loadShopDate(page);
  await expect(page.getByLabel("Hours start", { exact: true })).toHaveValue(
    "10:00",
  );
  await page.route("**/*", (route) =>
    route.request().headers()["next-action"] === loadAction
      ? route.abort()
      : route.continue(),
  );
  const failedLoad = page.waitForRequest(
    (request) =>
      nextAction(request) && request.headers()["next-action"] === loadAction,
  );
  await page.getByLabel("Apply to").selectOption(barberId);
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
  await failedLoad;
  await expect(page.getByLabel("Apply to")).toHaveValue(barberId);
  await expect(
    page
      .locator('p[aria-live="polite"]:not([role="status"])')
      .getByText("Unable to load dated availability. Try again."),
  ).toBeVisible();
  await expect(page.getByLabel("Hours start", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save date settings" }),
  ).toHaveCount(0);
  await page.unrouteAll();
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
  await expect(page.getByLabel("Apply to")).toHaveValue(barberId);
  await expect(page.getByLabel("Hours start", { exact: true })).toHaveValue(
    "12:00",
  );
});
