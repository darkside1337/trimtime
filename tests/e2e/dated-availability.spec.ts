import { randomUUID } from "node:crypto";
import { captureState, test, expect, ownerOrigin } from "./fixtures";

async function openDateEditor(page: import("@playwright/test").Page) {
  if (!(await page.getByLabel("Schedule day").isVisible()))
    await page
      .getByRole("button", { name: "Add date override or block", exact: true })
      .click();
}
async function openBlockView(page: import("@playwright/test").Page) {
  await page.getByLabel("Exception type").selectOption("block");
}
async function openPreview(page: import("@playwright/test").Page) {
  if (await page.getByLabel("Schedule day").isVisible()) {
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.getByRole("tab", { name: "Shop hours", exact: true }).click();
}
async function resolveBoundary(
  page: import("@playwright/test").Page,
  label: string,
) {
  const response = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "POST" && Boolean(request.headers()["next-action"])
    );
  });
  await page.getByRole("button", { name: label }).click();
  await response;
}

test("the dated editor can be loaded and toggled by keyboard with visible focus", async ({
  page,
  context,
  owners,
}, testInfo) => {
  await owners(context, { shop: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${ownerOrigin}/availability`);
  await page
    .getByRole("button", { name: "Add date override or block" })
    .click();
  const date = page.getByLabel("Schedule day");
  await date.fill("2026-11-02");
  await page.getByLabel("Apply to").focus();
  await page.keyboard.press("Tab");
  const load = page.getByRole("button", { name: /^(Load|Reload) date$/ });
  await expect(load).toBeFocused();
  const focus = await load.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
    };
  });
  expect(parseFloat(focus.outlineWidth)).toBeGreaterThan(0);
  expect(focus.outlineStyle).not.toBe("none");
  await page.keyboard.press("Enter");
  const replace = page.getByRole("checkbox", {
    name: "Replace recurring hours and breaks",
    exact: true,
  });
  await expect(replace).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Exception type")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(replace).toBeFocused();
  await page.keyboard.press("Space");
  await expect(replace).toBeChecked();
  expect(
    await replace.evaluate((element) =>
      parseFloat(getComputedStyle(element).transitionDuration),
    ),
  ).toBeLessThanOrEqual(0.001);
  for (const width of [320, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await captureState(page, `dated-editor-${width}`, testInfo);
  }
});

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
  await page
    .getByRole("button", { name: "Add date override or block" })
    .click();
  const dateLoad = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      Boolean(response.request().headers()["next-action"]),
  );
  await openDateEditor(page);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
  await dateLoad;
  await expect(page.getByLabel("Schedule day")).toBeEnabled();
  await page
    .getByRole("checkbox", {
      name: "Replace recurring hours and breaks",
      exact: true,
    })
    .check();
  await expect(
    page.getByRole("checkbox", {
      name: "Replace recurring hours and breaks",
      exact: true,
    }),
  ).toBeChecked();
  await expect(page.getByLabel("Hours start", { exact: true })).toHaveValue(
    "09:00",
  );
  await page.getByLabel("Hours start").fill("10:00");
  await page.getByLabel("Hours end (24:00 allowed)").fill("11:00");
  await page.getByRole("button", { name: "Save date settings" }).click();
  await expect(page.getByRole("dialog").getByText("Saved.")).toBeVisible();
  await page.reload();
  await openDateEditor(page);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
  await expect(page.getByLabel("Hours start")).toHaveValue("10:00");

  await openPreview(page);
  await page.getByLabel("Service").selectOption(serviceId);
  await openPreview(page);
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
  await page
    .getByRole("button", { name: "Add date override or block" })
    .click();
  await openDateEditor(page);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
  await expect(page.getByLabel("Hours start")).toHaveValue("10:00");
  await openDateEditor(page);
  await page.getByLabel("Schedule day").fill("2026-11-03");
  await expect(page.getByLabel("Hours start")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save date settings" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
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
  await page
    .getByRole("button", { name: "Add date override or block" })
    .click();
  await openDateEditor(page);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
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
  await page
    .getByRole("button", { name: "Add date override or block" })
    .click();
  await openDateEditor(page);
  await page.getByLabel("Schedule day").fill("2026-11-01");
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
  await openBlockView(page);
  await page.getByLabel("Start (shop local time)").fill("01:30");
  await resolveBoundary(page, "Resolve start");
  await expect(page.getByLabel("Start UTC offset")).toBeVisible();
  await page.getByLabel("Start (shop local time)").fill("01:45");
  await expect(page.getByLabel("Start UTC offset")).toHaveCount(0);
  await openDateEditor(page);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page
    .getByRole("dialog", { name: "Discard unsaved changes?" })
    .getByRole("button", { name: "Discard changes" })
    .click();
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
  await expect(page.getByLabel("Start (shop local time)")).toHaveValue("");
  await expect(page.getByLabel("Start UTC offset")).toHaveCount(0);
});

test("a rejected dated save keeps the draft and offers reload recovery", async ({
  page,
  context,
  owners,
}, testInfo) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);
  await page
    .getByRole("button", { name: "Add date override or block" })
    .click();
  await openDateEditor(page);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
  await page
    .getByRole("checkbox", {
      name: "Replace recurring hours and breaks",
      exact: true,
    })
    .check();
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
  await captureState(page, "dated-schedule-save-uncertain", testInfo);
  await page.unrouteAll();
  await page.getByRole("button", { name: "Reload saved state" }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "Replace recurring hours and breaks",
      exact: true,
    }),
  ).not.toBeChecked();
});

test("archived barber blocks remain reachable and removal offers reload", async ({
  page,
  context,
  owners,
  database,
}, testInfo) => {
  const owner = await owners(context, { shop: true });
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Block recovery barber')",
    [randomUUID(), owner.shopId],
  );
  await page.goto(`${ownerOrigin}/availability`);
  await page
    .getByRole("button", { name: "Add date override or block" })
    .click();
  await openDateEditor(page);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
  await openBlockView(page);
  await page
    .getByLabel("Barber for this time block")
    .selectOption({ label: "Block recovery barber" });
  await page.getByLabel("Start (shop local time)").fill("10:00");
  await resolveBoundary(page, "Resolve start");
  await page.getByLabel("End (shop local time, 24:00 allowed)").fill("10:30");
  await resolveBoundary(page, "Resolve end");
  await page.getByRole("button", { name: "Save time block" }).click();
  await expect(
    page.getByText(
      "Block saved. Preview again to see the updated availability.",
    ),
  ).toBeVisible();

  const barber = await database.pool.query(
    "SELECT id FROM barbers WHERE shop_id = $1 AND name = 'Block recovery barber'",
    [owner.shopId],
  );
  const barberId = String(barber.rows[0]?.id);
  const savedBlock = await database.pool.query(
    "SELECT id FROM occupied_intervals WHERE shop_id = $1 AND barber_id = $2",
    [owner.shopId, barberId],
  );
  expect(savedBlock.rows).toHaveLength(1);
  const blockId = String(savedBlock.rows[0]?.id);
  await page.getByLabel("Start (shop local time)").fill("11:00");
  await page.evaluate(
    ({ date, target }) =>
      window.dispatchEvent(
        new CustomEvent("trimtime:availability-edit", {
          detail: { date, target, view: "block" },
        }),
      ),
    { date: "2026-11-02", target: barberId },
  );
  const reloadDiscard = page.getByRole("dialog", {
    name: "Discard unsaved changes?",
  });
  await reloadDiscard.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByLabel("Exception type")).toHaveValue("block");
  await expect(page.getByLabel("Apply to")).toHaveValue(barberId);
  await expect(page.getByLabel("Start (shop local time)")).toHaveValue("");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await database.pool.query(
    "UPDATE barbers SET archived = true WHERE id = $1 AND shop_id = $2",
    [barberId, owner.shopId],
  );
  await page.reload();
  await page.getByRole("tab", { name: /Date overrides.*blocks/ }).click();
  await page.getByRole("button", { name: "View block", exact: true }).click();
  await expect(page.getByLabel("Exception type")).toHaveValue("block");
  await expect(page.getByLabel("Apply to")).toHaveValue(barberId);
  await expect(
    page.getByText(
      "New blocks require an active barber. Existing blocks for this archived barber remain available to remove below.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save time block" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(1);
  await captureState(page, "archived-block-removal", testInfo);

  await page.route("**/*", async (route) => {
    if (route.request().headers()["next-action"]) await route.abort();
    else await route.continue();
  });
  await page.getByRole("button", { name: "Remove" }).click();
  const removeDialog = page.getByRole("dialog", {
    name: "Remove this barber time block?",
  });
  await removeDialog.getByRole("button", { name: "Remove block" }).click();
  await expect(
    removeDialog
      .getByRole("alert")
      .getByText(
        "Removal status is uncertain. Reload saved state before retrying.",
      ),
  ).toBeVisible();
  await captureState(page, "dated-block-removal-uncertain", testInfo);
  await removeDialog.getByRole("button", { name: "Keep block" }).click();
  await expect(
    page.getByRole("button", { name: "Remove", exact: true }),
  ).toBeFocused();
  await expect(
    page
      .locator('p[aria-live="polite"]')
      .getByText(
        "Removal status is uncertain. Reload saved state before retrying.",
        { exact: true },
      ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reload saved state" }),
  ).toBeEnabled();
  await page.unrouteAll();
  await page.getByRole("button", { name: "Reload saved state" }).click();
  await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();
  const finalRemoveDialog = page.getByRole("dialog", {
    name: "Remove this barber time block?",
  });
  await finalRemoveDialog.getByRole("button", { name: "Remove block" }).click();
  await expect(finalRemoveDialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await expect(
    page.getByText(
      "Block removed. Preview again to see the updated availability.",
      { exact: true },
    ),
  ).toHaveCount(0);
  const remainingBlockRows = await database.pool.query(
    "SELECT (SELECT count(*)::int FROM occupied_intervals WHERE id = $1) AS occupied_count, (SELECT count(*)::int FROM time_blocks WHERE id = $1) AS block_count",
    [blockId],
  );
  expect(remainingBlockRows.rows[0]).toEqual({
    occupied_count: 0,
    block_count: 0,
  });
});

test("a stale date revision keeps the saved restriction and offers reload", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);
  await page
    .getByRole("button", { name: "Add date override or block" })
    .click();
  await openDateEditor(page);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "Close the shop for this date",
      exact: true,
    }),
  ).toBeVisible();
  await database.pool.query(
    "INSERT INTO shop_date_schedules (shop_id, date, override, closed, revision) VALUES ($1, '2026-11-02', NULL, false, 1)",
    [owner.shopId],
  );
  await page
    .getByRole("checkbox", {
      name: "Close the shop for this date",
      exact: true,
    })
    .check();
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
    await page
      .getByRole("button", { name: "Add date override or block" })
      .click();
    await openDateEditor(page);
    await page.getByLabel("Schedule day").fill("2026-11-02");
    await page.getByLabel("Apply to").selectOption(barberId);
    await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
    await page
      .getByRole("checkbox", {
        name: "Mark this barber off for this date",
        exact: true,
      })
      .check();
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
  await page
    .getByRole("button", { name: "Add date override or block" })
    .click();
  await openDateEditor(page);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
  await page
    .getByRole("checkbox", {
      name: "Close the shop for this date",
      exact: true,
    })
    .check();
  await page.getByRole("button", { name: "Save date settings" }).click();
  await expect(
    page.getByText("Saved. Preview again to see the updated availability."),
  ).toBeVisible();

  for (const barberId of barberIds) {
    await openPreview(page);
    await page.getByLabel("Service").selectOption(serviceId);
    await openPreview(page);
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
  await openPreview(page);
  await page.getByLabel("Service").selectOption(serviceId);
  await openPreview(page);
  await page.getByLabel("Eligible barber").selectOption(newBarberId);
  await page.getByLabel("Date", { exact: true }).fill("2026-11-02");
  await page.getByRole("button", { name: "Preview times" }).click();
  await expect(page.getByText(/No available starts match/)).toBeVisible();

  await openDateEditor(page);
  await page.getByLabel("Schedule day").fill("2026-11-02");
  await page.getByLabel("Apply to").selectOption(barberIds[0]!);
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
  await page
    .getByRole("checkbox", {
      name: "Mark this barber off for this date",
      exact: true,
    })
    .check();
  await page.getByRole("button", { name: "Save date settings" }).click();
  await expect(
    page.getByText("Saved. Preview again to see the updated availability."),
  ).toBeVisible();

  await page.getByLabel("Apply to").selectOption("shop");
  await page.getByRole("button", { name: /^(Load|Reload) date$/ }).click();
  await page
    .getByRole("checkbox", {
      name: "Close the shop for this date",
      exact: true,
    })
    .uncheck();
  await page.getByRole("button", { name: "Save date settings" }).click();
  await expect(
    page.getByText("Saved. Preview again to see the updated availability."),
  ).toBeVisible();

  for (const [index, barberId] of barberIds.entries()) {
    await openPreview(page);
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
