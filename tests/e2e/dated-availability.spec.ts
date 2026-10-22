import { randomUUID } from "node:crypto";
import { captureState, test, expect, ownerOrigin } from "./fixtures";

test("a dated shop override changes only its date after reload", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const barberId = randomUUID();
  const serviceId = randomUUID();
  const week = Array.from({ length: 7 }, (_, day) => ({
    working: [{ start: day === 1 ? 600 : 540, end: 720 }],
    breaks: [],
  }));
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Dated barber')",
    [barberId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO services (id, shop_id, name, price_usd, duration_minutes) VALUES ($1, $2, 'Dated service', '12.00', 35)",
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
  const dateLoad = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      Boolean(response.request().headers()["next-action"]),
  );
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: "Load date" }).click();
  await dateLoad;
  await expect(page.getByLabel("Schedule day")).toBeEnabled();
  await page.getByLabel("Replace recurring hours and breaks").check();
  await expect(
    page.getByLabel("Replace recurring hours and breaks"),
  ).toBeChecked();
  await expect(page.getByLabel("Hours start", { exact: true })).toHaveValue(
    "09:00",
  );
  await page.getByLabel("Hours start").fill("10:00");
  await page.getByLabel("Hours end (24:00 allowed)").fill("11:00");
  await page.getByRole("button", { name: "Save date settings" }).click();
  await expect(
    page
      .getByRole("region", { name: "Overrides & blocks" })
      .getByText("Saved."),
  ).toBeVisible();
  await page.reload();
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: "Load date" }).click();
  await expect(page.getByLabel("Hours start")).toHaveValue("10:00");

  await page.getByLabel("Service").selectOption(serviceId);
  await page.getByLabel("Eligible barber").selectOption(barberId);
  await page.getByLabel("Date", { exact: true }).fill("2026-11-02");
  await page.getByRole("button", { name: "Preview times" }).click();
  await expect(page.getByText("10:00 · UTC-05:00")).toBeVisible();
  await expect(page.getByText("10:15 · UTC-05:00")).toBeVisible();
  await page.getByLabel("Date", { exact: true }).fill("2026-11-03");
  await page.getByRole("button", { name: "Preview times" }).click();
  await expect(page.getByText("10:00 · UTC-05:00")).toBeVisible();
  await expect(page.getByText("10:15 · UTC-05:00")).toBeVisible();
  expect(
    (
      await database.pool.query(
        "SELECT revision, override FROM shop_date_schedules WHERE shop_id = $1 AND date = '2026-11-02'",
        [owner.shopId],
      )
    ).rows[0]?.revision,
  ).toBe(1);
});

test("changing the exception date requires loading that date before saving", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const overrides = [
    { date: "2026-11-02", start: 600, end: 660 },
    { date: "2026-11-03", start: 720, end: 780 },
  ];
  for (const { date, start, end } of overrides) {
    await database.pool.query(
      "INSERT INTO shop_date_schedules (shop_id, date, override, closed, revision) VALUES ($1, $2, $3::jsonb, false, 1)",
      [
        owner.shopId,
        date,
        JSON.stringify({ working: [{ start, end }], breaks: [] }),
      ],
    );
  }
  await page.goto(`${ownerOrigin}/availability`);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: "Load date" }).click();
  await expect(page.getByLabel("Hours start")).toHaveValue("10:00");
  await page.getByLabel("Schedule day").fill("2026-11-03");
  await expect(page.getByLabel("Hours start")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save date settings" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Load date" }).click();
  await expect(page.getByLabel("Hours start")).toHaveValue("12:00");
});

test("editing a dated replacement preserves every working and break range", async ({
  page,
  context,
  owners,
  database,
}, testInfo) => {
  const owner = await owners(context, { shop: true });
  const override = {
    working: [
      { start: 540, end: 660 },
      { start: 780, end: 900 },
    ],
    breaks: [
      { start: 600, end: 615 },
      { start: 840, end: 855 },
    ],
  };
  await database.pool.query(
    "INSERT INTO shop_date_schedules (shop_id, date, override, closed, revision) VALUES ($1, '2026-11-02', $2::jsonb, false, 1)",
    [owner.shopId, JSON.stringify(override)],
  );
  await page.goto(`${ownerOrigin}/availability`);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: "Load date" }).click();
  await expect(page.getByLabel("Hours start 2")).toHaveValue("13:00");
  await expect(page.getByLabel("Break start 2")).toHaveValue("14:00");
  await captureState(page, "dated-availability-exception-editor", testInfo);
  await page.getByLabel("Hours start", { exact: true }).fill("09:15");
  await page.getByRole("button", { name: "Save date settings" }).click();
  await expect(
    page.getByText("Saved. Preview again to see the updated availability."),
  ).toBeVisible();
  const saved = await database.pool.query(
    "SELECT override FROM shop_date_schedules WHERE shop_id = $1 AND date = '2026-11-02'",
    [owner.shopId],
  );
  expect(saved.rows[0]?.override).toEqual({
    working: [
      { start: 555, end: 660 },
      { start: 780, end: 900 },
    ],
    breaks: override.breaks,
  });
});

test("changing a block boundary clears a resolved DST choice", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);
  await page.getByLabel("Schedule day").fill("2026-11-01");
  await page.getByRole("button", { name: "Load date" }).click();
  await page.getByLabel("Start (shop local time)").fill("01:30");
  await page.getByRole("button", { name: "Resolve start" }).click();
  await expect(page.getByLabel("Start UTC offset")).toBeVisible();
  await page.getByLabel("Start (shop local time)").fill("01:45");
  await expect(page.getByLabel("Start UTC offset")).toHaveCount(0);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: "Load date" }).click();
  await expect(page.getByLabel("Start (shop local time)")).toHaveValue("");
  await expect(page.getByLabel("Start UTC offset")).toHaveCount(0);
});

test("a rejected dated save keeps the draft and offers reload recovery", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: "Load date" }).click();
  await page.getByLabel("Replace recurring hours and breaks").check();
  await page.getByRole("button", { name: "Add hours range" }).click();
  await page.getByLabel("Hours start").fill("10:00");
  await page.getByLabel("Hours end (24:00 allowed)").fill("11:00");
  await page.route("**/*", async (route) => {
    if (route.request().headers()["next-action"]) await route.abort();
    else await route.continue();
  });
  await page.getByRole("button", { name: "Save date settings" }).click();
  await expect(
    page.getByText(
      "Save status is uncertain. Reload saved state before retrying.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Hours start")).toHaveValue("10:00");
  await expect(
    page.getByRole("button", { name: "Reload saved state" }),
  ).toBeEnabled();
  await page.unrouteAll();
  await page.getByRole("button", { name: "Reload saved state" }).click();
  await expect(
    page.getByLabel("Replace recurring hours and breaks"),
  ).not.toBeChecked();
});

test("a rejected block removal restores the controls and offers reload", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Block recovery barber')",
    [randomUUID(), owner.shopId],
  );
  await page.goto(`${ownerOrigin}/availability`);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: "Load date" }).click();
  await page.getByLabel("Start (shop local time)").fill("10:00");
  await page.getByRole("button", { name: "Resolve start" }).click();
  await page.getByLabel("End (shop local time, 24:00 allowed)").fill("10:30");
  await page.getByRole("button", { name: "Resolve end" }).click();
  await page.getByRole("button", { name: "Save time block" }).click();
  await expect(
    page.getByText(
      "Block saved. Preview again to see the updated availability.",
    ),
  ).toBeVisible();

  await page.getByLabel("Start (shop local time)").fill("10:00");
  await page.getByRole("button", { name: "Resolve start" }).click();
  await page.getByLabel("End (shop local time, 24:00 allowed)").fill("10:30");
  await page.getByRole("button", { name: "Resolve end" }).click();
  await page.getByRole("button", { name: "Save time block" }).click();
  await expect(
    page.getByText("This barber already has a block during that time."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(1);

  await page.route("**/*", async (route) => {
    if (route.request().headers()["next-action"]) await route.abort();
    else await route.continue();
  });
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(
    page.getByText(
      "Removal status is uncertain. Reload saved state before retrying.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reload saved state" }),
  ).toBeEnabled();
  await page.unrouteAll();
  await page.getByRole("button", { name: "Reload saved state" }).click();
  await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
});

test("a stale date revision keeps the saved restriction and offers reload", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: "Load date" }).click();
  await expect(page.getByLabel("Close the shop for this date")).toBeVisible();
  await database.pool.query(
    "INSERT INTO shop_date_schedules (shop_id, date, override, closed, revision) VALUES ($1, '2026-11-02', NULL, false, 1)",
    [owner.shopId],
  );
  await page.getByLabel("Close the shop for this date").check();
  await expect(
    page.getByRole("button", { name: "Save date settings" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Save date settings" }).click();
  await expect(
    page.getByText(
      "Dated availability changed elsewhere. Reload before saving.",
    ),
  ).toBeVisible();
  const saved = await database.pool.query(
    "SELECT closed, revision FROM shop_date_schedules WHERE shop_id = $1 AND date = '2026-11-02'",
    [owner.shopId],
  );
  expect(saved.rows[0]).toEqual({ closed: false, revision: 1 });
});

test("dated barber actions reject signed-out and foreign-owner replay", async ({
  page,
  context,
  owners,
  request,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const otherContext = await context.browser()?.newContext();
  expect(otherContext).toBeTruthy();
  try {
    const foreign = await owners(otherContext!, { shop: true });
    const barberId = randomUUID();
    await database.pool.query(
      "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Private barber')",
      [barberId, owner.shopId],
    );
    await page.goto(`${ownerOrigin}/availability`);
    await page.getByLabel("Schedule day").fill("2026-11-02");
    await page.getByLabel("Apply to").selectOption(barberId);
    await page.getByRole("button", { name: "Load date" }).click();
    await page.getByLabel("Mark this barber off for this date").check();
    const captured = page.waitForRequest(
      (entry) =>
        entry.method() === "POST" && Boolean(entry.headers()["next-action"]),
    );
    await page.getByRole("button", { name: "Save date settings" }).click();
    const action = await captured;
    await expect(
      page.getByText("Saved. Preview again to see the updated availability."),
    ).toBeVisible();
    const headers = {
      "content-type": action.headers()["content-type"],
      "next-action": action.headers()["next-action"],
      origin: ownerOrigin,
      "next-router-state-tree": action.headers()["next-router-state-tree"],
    };
    const replay = {
      headers: { ...headers, cookie: foreign.cookie },
      data: action.postDataBuffer()!,
    };
    const foreignResponse = await request.post(action.url(), replay);
    expect(await foreignResponse.text()).toContain("Active barber not found.");
    const signedOutResponse = await request.post(action.url(), {
      headers,
      data: action.postDataBuffer()!,
    });
    expect(await signedOutResponse.text()).toContain("UNAUTHENTICATED");
    const foreignRow = await database.pool.query(
      "SELECT 1 FROM barber_date_schedules WHERE shop_id = $1 AND barber_id = $2",
      [foreign.shopId, barberId],
    );
    expect(foreignRow.rowCount).toBe(0);
  } finally {
    await otherContext?.close();
  }
});

test("shop closure affects both barbers and reopening preserves one barber's day off", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const barberIds = [randomUUID(), randomUUID()];
  const serviceId = randomUUID();
  const week = Array.from({ length: 7 }, () => ({
    working: [{ start: 540, end: 720 }],
    breaks: [],
  }));
  for (const [index, barberId] of barberIds.entries()) {
    await database.pool.query(
      "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, $3)",
      [barberId, owner.shopId, `Day-off barber ${index + 1}`],
    );
  }
  await database.pool.query(
    "INSERT INTO services (id, shop_id, name, price_usd, duration_minutes) VALUES ($1, $2, 'Day-off cut', '12.00', 35)",
    [serviceId, owner.shopId],
  );
  for (const barberId of barberIds) {
    await database.pool.query(
      "INSERT INTO barber_services (shop_id, barber_id, service_id) VALUES ($1, $2, $3)",
      [owner.shopId, barberId, serviceId],
    );
    await database.pool.query(
      "INSERT INTO barber_schedules (shop_id, barber_id, week, revision) VALUES ($1, $2, $3::jsonb, 1)",
      [owner.shopId, barberId, JSON.stringify(week)],
    );
  }
  await database.pool.query(
    "INSERT INTO shop_schedules (shop_id, week, revision) VALUES ($1, $2::jsonb, 1)",
    [owner.shopId, JSON.stringify(week)],
  );

  await page.goto(`${ownerOrigin}/availability`);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: "Load date" }).click();
  await page.getByLabel("Close the shop for this date").check();
  await page.getByRole("button", { name: "Save date settings" }).click();
  await expect(
    page.getByText("Saved. Preview again to see the updated availability."),
  ).toBeVisible();

  for (const barberId of barberIds) {
    await page.getByLabel("Service").selectOption(serviceId);
    await page.getByLabel("Eligible barber").selectOption(barberId);
    await page.getByLabel("Date", { exact: true }).fill("2026-11-02");
    await page.getByRole("button", { name: "Preview times" }).click();
    await expect(page.getByText(/No available starts match/)).toBeVisible();
  }

  const newBarberId = randomUUID();
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'After-closure barber')",
    [newBarberId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO barber_services (shop_id, barber_id, service_id) VALUES ($1, $2, $3)",
    [owner.shopId, newBarberId, serviceId],
  );
  await database.pool.query(
    "INSERT INTO barber_schedules (shop_id, barber_id, week, revision) VALUES ($1, $2, $3::jsonb, 1)",
    [owner.shopId, newBarberId, JSON.stringify(week)],
  );
  await page.reload();
  await page.getByLabel("Service").selectOption(serviceId);
  await page.getByLabel("Eligible barber").selectOption(newBarberId);
  await page.getByLabel("Date", { exact: true }).fill("2026-11-02");
  await page.getByRole("button", { name: "Preview times" }).click();
  await expect(page.getByText(/No available starts match/)).toBeVisible();

  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByLabel("Apply to").selectOption(barberIds[0]!);
  await page.getByRole("button", { name: "Load date" }).click();
  await page.getByLabel("Mark this barber off for this date").check();
  await page.getByRole("button", { name: "Save date settings" }).click();
  await expect(
    page.getByText("Saved. Preview again to see the updated availability."),
  ).toBeVisible();

  await page.getByLabel("Apply to").selectOption("shop");
  await page.getByRole("button", { name: "Load date" }).click();
  await page.getByLabel("Close the shop for this date").uncheck();
  await page.getByRole("button", { name: "Save date settings" }).click();
  await expect(
    page.getByText("Saved. Preview again to see the updated availability."),
  ).toBeVisible();

  for (const [index, barberId] of barberIds.entries()) {
    await page.getByLabel("Eligible barber").selectOption(barberId);
    await page.getByLabel("Date", { exact: true }).fill("2026-11-02");
    await page.getByRole("button", { name: "Preview times" }).click();
    if (index === 0) {
      await expect(page.getByText(/No available starts match/)).toBeVisible();
    } else {
      await expect(page.getByText("09:00 · UTC-05:00")).toBeVisible();
    }
  }
});
