import { randomUUID } from "node:crypto";
import { captureState, test, expect, ownerOrigin } from "./fixtures";

test("shop hours save, initialize existing barber schedules, and survive reload", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const barberIds = [randomUUID(), randomUUID()];
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $3, 'Sam'), ($2, $3, 'Lee')",
    [barberIds[0], barberIds[1], owner.shopId],
  );
  await page.goto(`${ownerOrigin}/availability`);
  await page.getByRole("button", { name: "Add hours" }).first().click();
  await page.getByLabel("Opens").first().fill("09:10");
  await page.getByLabel("Closes").first().fill("11:00");
  await page.getByRole("button", { name: "Add break" }).first().click();
  await page.getByLabel("Break starts").fill("10:00");
  await page.getByLabel("Break ends").fill("10:15");
  await page
    .getByRole("button", { name: "Add break", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByRole("status")).toHaveText("Availability saved.");

  await page.getByRole("tab", { name: "Barber schedules" }).click();
  await expect(page.getByLabel("Opens").first()).toHaveValue("09:10");
  await expect(page.getByText("Break · 10:00–10:15").first()).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Barber schedules" }).click();
  await expect(page.getByLabel("Opens").first()).toHaveValue("09:10");
  await expect(page.getByText("Break · 10:00–10:15").first()).toBeVisible();
  const saved = await database.pool.query(
    "SELECT barber_id, week, revision FROM barber_schedules WHERE shop_id = $1 ORDER BY barber_id",
    [owner.shopId],
  );
  expect(saved.rows).toHaveLength(2);
  expect(saved.rows.every(({ revision }) => revision === 1)).toBe(true);
});

test("discarding a shop draft switches the save target to the selected barber", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const barberId = randomUUID();
  const shopWeek = Array.from({ length: 7 }, (_, index) => ({
    working: index === 0 ? [{ start: 540, end: 1020 }] : [],
    breaks: [],
  }));
  const barberWeek = Array.from({ length: 7 }, (_, index) => ({
    working: index === 0 ? [{ start: 600, end: 1080 }] : [],
    breaks: [],
  }));
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Target regression barber')",
    [barberId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO shop_schedules (shop_id, week, revision) VALUES ($1, $2::jsonb, 1)",
    [owner.shopId, JSON.stringify(shopWeek)],
  );
  await database.pool.query(
    "INSERT INTO barber_schedules (shop_id, barber_id, week, revision) VALUES ($1, $2, $3::jsonb, 1)",
    [owner.shopId, barberId, JSON.stringify(barberWeek)],
  );

  await page.goto(`${ownerOrigin}/availability`);
  await page.getByLabel("Opens").first().fill("09:30");
  await page.getByRole("tab", { name: "Barber schedules" }).click();
  const discard = page.getByRole("dialog", {
    name: "Discard unsaved changes?",
  });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Discard changes" }).click();
  const barberButton = page.getByRole("button", {
    name: "Target regression barber",
  });
  await expect(barberButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Opens").first()).toHaveValue("10:00");
  await page.getByLabel("Opens").first().fill("11:00");
  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByRole("status")).toHaveText("Availability saved.");

  const persisted = await database.pool.query(
    "SELECT (SELECT week FROM shop_schedules WHERE shop_id = $1) AS shop_week, (SELECT week FROM barber_schedules WHERE shop_id = $1 AND barber_id = $2) AS barber_week",
    [owner.shopId, barberId],
  );
  expect(persisted.rows[0]?.shop_week).toEqual(shopWeek);
  expect(persisted.rows[0]?.barber_week[0]?.working).toEqual([
    { start: 660, end: 1080 },
  ]);
});

test("preview labels both repeated DST starts with their offsets", async ({
  page,
  context,
  owners,
  database,
}) => {
  test.skip(
    !process.env.TRIMTIME_E2E_NOW,
    "Run with TRIMTIME_E2E_NOW for deterministic DST preview.",
  );
  const owner = await owners(context, { shop: true });
  const barberId = randomUUID();
  const serviceId = randomUUID();
  const week = Array.from({ length: 7 }, (_, index) => ({
    working: index === 6 ? [{ start: 0, end: 240 }] : [],
    breaks: [],
  }));
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Fold barber')",
    [barberId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO services (id, shop_id, name, price_usd, duration_minutes) VALUES ($1, $2, 'Long cut', '20.00', 35)",
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
  await page.getByLabel("Service").selectOption(serviceId);
  await page.getByLabel("Eligible barber").selectOption(barberId);
  await page.getByLabel("Date", { exact: true }).fill("2026-11-01");
  await page.getByRole("button", { name: "Preview times" }).click();
  await expect(page.getByText("01:30 · UTC-04:00")).toBeVisible();
  await expect(page.getByText("01:30 · UTC-05:00")).toBeVisible();
  await expect(page.getByText(/does not reserve a time/)).toBeVisible();
});

test("preview uses saved schedules and the latest persisted service duration", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const barberId = randomUUID();
  const serviceId = randomUUID();
  const shopWeek = Array.from({ length: 7 }, (_, index) => ({
    working: index === 0 ? [{ start: 540, end: 660 }] : [],
    breaks: [],
  }));
  const barberWeek = shopWeek.map((day, index) => ({
    ...day,
    working: index === 0 ? [{ start: 555, end: 630 }] : [],
    breaks: index === 0 ? [{ start: 600, end: 615 }] : [],
  }));
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Current Barber')",
    [barberId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO services (id, shop_id, name, price_usd, duration_minutes) VALUES ($1, $2, 'Exact cut', '20.00', 35)",
    [serviceId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO barber_services (shop_id, barber_id, service_id) VALUES ($1, $2, $3)",
    [owner.shopId, barberId, serviceId],
  );
  await database.pool.query(
    "INSERT INTO shop_schedules (shop_id, week, revision) VALUES ($1, $2::jsonb, 1)",
    [owner.shopId, JSON.stringify(shopWeek)],
  );
  await database.pool.query(
    "INSERT INTO barber_schedules (shop_id, barber_id, week, revision) VALUES ($1, $2, $3::jsonb, 1)",
    [owner.shopId, barberId, JSON.stringify(barberWeek)],
  );
  await page.goto(`${ownerOrigin}/availability`);
  await page.getByLabel("Service").selectOption(serviceId);
  await page.getByLabel("Eligible barber").selectOption(barberId);
  await page.getByLabel("Date", { exact: true }).fill("2026-11-02");

  await page.getByLabel("Opens").first().fill("09:45");
  await page.getByRole("button", { name: "Preview times" }).click();
  await expect(page.getByText("09:15 · UTC-05:00")).toBeVisible();
  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByRole("status")).toHaveText("Availability saved.");
  await page.getByRole("button", { name: "Preview times" }).click();
  await expect(page.getByText("No available starts match")).toBeVisible();

  await database.pool.query(
    "UPDATE shop_schedules SET week = $2::jsonb WHERE shop_id = $1",
    [owner.shopId, JSON.stringify(shopWeek)],
  );
  await database.pool.query(
    "UPDATE services SET duration_minutes = 50 WHERE id = $1 AND shop_id = $2",
    [serviceId, owner.shopId],
  );
  await page.getByRole("button", { name: "Preview times" }).click();
  await expect(page.getByText("No available starts match")).toBeVisible();
  const persisted = await database.pool.query(
    "SELECT week FROM shop_schedules WHERE shop_id = $1",
    [owner.shopId],
  );
  expect(persisted.rows[0]?.week).toEqual(shopWeek);
});

test("availability fits reference frames and its schedule tabs work by keyboard @device", async ({
  page,
  context,
  owners,
  database,
}, info) => {
  const owner = await owners(context, { shop: true });
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Keyboard barber')",
    [randomUUID(), owner.shopId],
  );
  const viewport = info.project.name.startsWith("desktop")
    ? { width: 1440, height: 1750 }
    : info.project.name.startsWith("tablet")
      ? { width: 768, height: 2700 }
      : { width: 390, height: 3300 };
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${ownerOrigin}/availability`);
  await captureState(page, `availability-${viewport.width}`, info);
  const shop = page.getByRole("tab", { name: "Shop hours" });
  const barber = page.getByRole("tab", { name: "Barber schedules" });
  for (const tab of [shop, barber]) {
    const panelId = await tab.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    await expect(page.locator(`[id="${panelId}"]`)).toHaveAttribute(
      "role",
      "tabpanel",
    );
  }
  await shop.focus();
  await shop.press("ArrowRight");
  await barber.press("Enter");
  await expect(barber).toHaveAttribute("aria-selected", "true");
  await expect(barber).toBeFocused();
  await expect(
    barber.evaluate((tab) => {
      const style = getComputedStyle(tab);
      return { outline: style.outlineWidth, color: style.outlineColor };
    }),
  ).resolves.toMatchObject({
    outline: expect.stringMatching(/^[1-9][0-9]*(?:\.[0-9]+)?px$/),
  });
  await barber.press("ArrowLeft");
  await shop.press("Enter");
  await expect(shop).toHaveAttribute("aria-selected", "true");
  await expect(shop).toBeFocused();
  for (const width of [320, 1024]) {
    await page.setViewportSize({ width, height: viewport.height });
    await expect(
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).resolves.toBe(true);
  }
  await page.setViewportSize(viewport);
  await expect(
    page
      .getByRole("button", { name: "Save hours" })
      .evaluate((button) =>
        parseFloat(getComputedStyle(button).transitionDuration),
      ),
  ).resolves.toBeLessThanOrEqual(0.001);
  await page.getByRole("button", { name: "Add hours" }).first().click();
  await page.getByLabel("Opens").first().fill("10:00");
  await page.getByLabel("Closes").first().fill("12:00");
  await barber.click();
  await expect(page.locator("#availability-tab-shop")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const discard = page.getByRole("dialog", {
    name: "Discard unsaved changes?",
  });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Opens").first()).toHaveValue("10:00");
  await page.getByRole("button", { name: "Add break" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a recurring break" });
  await expect(dialog).toBeVisible();
  const breakStart = page.getByLabel("Break starts").last();
  await expect(breakStart).toBeFocused();
  await expect(
    breakStart.evaluate((input) => {
      const style = getComputedStyle(input);
      return { outline: style.outlineWidth, color: style.outlineColor };
    }),
  ).resolves.toMatchObject({
    outline: expect.stringMatching(/^[1-9][0-9]*(?:\.[0-9]+)?px$/),
  });
  await page.screenshot({
    path: info.outputPath("availability-break-dialog.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add break" }).first(),
  ).toBeFocused();
});

test("populated recurring rows and break chips render at approved viewports @device", async ({
  page,
  context,
  owners,
  database,
}, info) => {
  const owner = await owners(context, { shop: true });
  const barberId = randomUUID();
  const serviceId = randomUUID();
  const week = Array.from({ length: 7 }, (_, index) => ({
    working:
      index < 5
        ? [{ start: index === 0 ? 550 : 540, end: index === 4 ? 1020 : 1080 }]
        : index === 5
          ? [{ start: 600, end: 900 }]
          : [],
    breaks: index < 5 ? [{ start: 720, end: 780 }] : [],
  }));
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Populated barber')",
    [barberId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO services (id, shop_id, name, price_usd, duration_minutes) VALUES ($1, $2, 'Classic cut', '20.00', 35)",
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

  const viewport = info.project.name.startsWith("desktop")
    ? { width: 1440, height: 1750 }
    : info.project.name.startsWith("tablet")
      ? { width: 768, height: 2700 }
      : { width: 390, height: 3300 };
  await page.setViewportSize(viewport);
  await page.goto(`${ownerOrigin}/availability`);
  await expect(
    page.getByRole("button", { name: /Edit Monday break/ }),
  ).toBeVisible();
  await expect(page.getByLabel("Opens").first()).toHaveValue("09:10");
  await page.screenshot({
    path: info.outputPath(`availability-populated-${viewport.width}.png`),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Barber schedules" }).click();
  await expect(
    page.getByRole("button", { name: /Edit Monday break/ }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath(
      `availability-populated-barber-${viewport.width}.png`,
    ),
    fullPage: true,
  });
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).resolves.toBe(true);
});

test("invalid schedule input stays editable and can be corrected", async ({
  page,
  context,
  owners,
}, info) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);
  await page.getByRole("button", { name: "Add hours" }).first().click();
  await page.getByLabel("Opens").first().fill("11:00");
  await page.getByLabel("Closes").first().fill("10:00");
  await page.getByRole("button", { name: "Add hours" }).first().click();
  await page.getByLabel("Opens").nth(1).fill("14:00");
  await page.getByLabel("Closes").nth(1).fill("13:00");
  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(
    page
      .getByRole("alert")
      .getByText("End must be after start.", { exact: true }),
  ).toHaveCount(2);
  await expect(page.getByLabel("Closes").nth(0)).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByLabel("Closes").nth(1)).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByLabel("Closes").nth(0)).toBeFocused();
  await page.screenshot({
    path: info.outputPath("availability-invalid-range.png"),
    fullPage: true,
  });
  await expect(page.getByLabel("Opens").first()).toHaveValue("11:00");
  await page.getByLabel("Closes").nth(0).fill("12:00");
  await page.getByLabel("Closes").nth(1).fill("16:00");
  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByRole("status")).toHaveText("Availability saved.");
});

test("a delayed barber save cannot replace the selected barber or shop schedule", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const barberIds = [randomUUID(), randomUUID()];
  const shopWeek = Array.from({ length: 7 }, (_, index) => ({
    working: index === 0 ? [{ start: 600, end: 1080 }] : [],
    breaks: [],
  }));
  const barberAWeek = structuredClone(shopWeek);
  const barberBWeek = structuredClone(shopWeek);
  barberAWeek[0]!.working = [{ start: 540, end: 1020 }];
  barberBWeek[0]!.working = [{ start: 660, end: 1140 }];
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $3, 'Save A'), ($2, $3, 'Save B')",
    [barberIds[0], barberIds[1], owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO shop_schedules (shop_id, week, revision) VALUES ($1, $2::jsonb, 1)",
    [owner.shopId, JSON.stringify(shopWeek)],
  );
  await database.pool.query(
    "INSERT INTO barber_schedules (shop_id, barber_id, week, revision) VALUES ($1, $2, $3::jsonb, 1), ($1, $4, $5::jsonb, 1)",
    [
      owner.shopId,
      barberIds[0],
      JSON.stringify(barberAWeek),
      barberIds[1],
      JSON.stringify(barberBWeek),
    ],
  );

  await page.goto(`${ownerOrigin}/availability`);
  await page.getByRole("tab", { name: "Barber schedules" }).click();
  await page.getByRole("button", { name: "Save A" }).click();
  await page.getByLabel("Opens").first().fill("10:15");

  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let reachedServer!: () => void;
  const requestStarted = new Promise<void>(
    (resolve) => (reachedServer = resolve),
  );
  await page.route("**/availability", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    reachedServer();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Save hours" }).click();
  await requestStarted;

  try {
    expect(
      await page.getByRole("button", { name: "Save A" }).isDisabled(),
    ).toBe(true);
    expect(
      await page.getByRole("tab", { name: "Shop hours" }).isDisabled(),
    ).toBe(true);
    expect(
      await page
        .getByRole("tab", { name: "Barber schedules" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    await expect(page.getByRole("button", { name: "Save A" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  } finally {
    release();
  }
  await expect(page.getByRole("status")).toHaveText("Availability saved.");
  await page.unroute("**/availability");
  await page.getByRole("button", { name: "Save B" }).click();
  await expect(page.getByLabel("Opens").first()).toHaveValue("11:00");
  const saved = await database.pool.query(
    "SELECT barber_id, week FROM barber_schedules WHERE shop_id = $1 ORDER BY barber_id",
    [owner.shopId],
  );
  const barberWeeks = new Map(
    saved.rows.map((row) => [row.barber_id, row.week]),
  );
  expect(barberWeeks.get(barberIds[0]!)).toMatchObject({
    0: { working: [{ start: 615, end: 1020 }] },
  });
  expect(barberWeeks.get(barberIds[1]!)).toEqual(barberBWeek);
  const persistedShop = await database.pool.query(
    "SELECT week FROM shop_schedules WHERE shop_id = $1",
    [owner.shopId],
  );
  expect(persistedShop.rows[0]?.week).toEqual(shopWeek);
});

test("an uncertain network save preserves the draft and supports retry", async ({
  page,
  context,
  owners,
}, info) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);
  await page.getByRole("button", { name: "Add hours" }).first().click();
  await page.getByLabel("Opens").first().fill("09:10");
  await page.getByLabel("Closes").first().fill("11:00");
  await page.route("**/availability", (route) =>
    route.request().method() === "POST"
      ? route.abort("failed")
      : route.continue(),
  );
  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByRole("status")).toContainText(
    "save could not be confirmed",
  );
  await page.screenshot({
    path: info.outputPath("availability-save-uncertain.png"),
    fullPage: true,
  });
  await expect(page.getByLabel("Opens").first()).toHaveValue("09:10");
  await page.unroute("**/availability");
  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByRole("status")).toHaveText("Availability saved.");
});

test("stale browser saves preserve the draft until an explicit reload", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  const secondPage = await context.newPage();
  await page.goto(`${ownerOrigin}/availability`);
  await secondPage.goto(`${ownerOrigin}/availability`);
  for (const target of [page, secondPage]) {
    await target.getByRole("button", { name: "Add hours" }).first().click();
    await target.getByLabel("Opens").first().fill("09:10");
    await target.getByLabel("Closes").first().fill("11:00");
  }
  await secondPage.getByLabel("Closes").first().fill("12:00");
  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByRole("status")).toHaveText("Availability saved.");
  await secondPage.getByRole("button", { name: "Save hours" }).click();
  await expect(secondPage.getByRole("status")).toContainText(
    "changed in another session",
  );
  await expect(secondPage.getByLabel("Opens").first()).toHaveValue("09:10");
  await expect(secondPage.getByLabel("Closes").first()).toHaveValue("12:00");
  await secondPage.getByRole("button", { name: "Reload saved hours" }).click();
  await expect(secondPage.getByRole("status")).toHaveText(
    "Saved availability reloaded.",
  );
  await expect(secondPage.getByLabel("Opens").first()).toHaveValue("09:10");
  await expect(secondPage.getByLabel("Closes").first()).toHaveValue("11:00");
  await expect(
    secondPage.getByRole("region", { name: "Weekly open hours", exact: true }),
  ).toContainText("1h 50m");
  await secondPage.getByLabel("Closes").first().fill("12:00");
  await secondPage.getByRole("button", { name: "Save hours" }).click();
  await expect(secondPage.getByRole("status")).toHaveText(
    "Availability saved.",
  );
  await secondPage.close();
});

test("discarding weekly edits opens the requested date dialog and clears the draft", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);
  await page.getByRole("button", { name: "Add hours" }).first().click();
  await page.getByLabel("Opens").first().fill("10:00");
  await page
    .getByRole("button", { name: "Add date override or block" })
    .click();
  const discard = page.getByRole("dialog", {
    name: "Discard unsaved changes?",
  });
  await discard.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Opens").first()).toHaveValue("10:00");
  await page
    .getByRole("button", { name: "Add date override or block" })
    .click();
  await discard.getByRole("button", { name: "Discard changes" }).click();
  const dateDialog = page.getByRole("dialog", {
    name: "Add a date override or block",
  });
  await expect(dateDialog).toBeVisible();
  await dateDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("tab", { name: "Shop hours" }).click();
  await expect(page.getByRole("tab", { name: "Shop hours" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByLabel("Opens")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save hours" })).toBeDisabled();
});
