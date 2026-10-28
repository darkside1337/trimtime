import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, ownerOrigin } from "./fixtures";
import { createOwnerAppointment } from "./owner-booking-fixtures";

test("owner can move a booking from calendar details @device", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  await page.goto(
    `${ownerOrigin}/?date=2027-01-19&view=day&barber=${owner.barberId}`,
  );
  await page
    .getByRole("link", { name: /Move Journey Guest, Walk-in Cut/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Appointment details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Move appointment" }),
  ).toBeVisible();
  expect(page.url()).toContain(`/appointments/${bookingId}`);
  await page.getByRole("button", { name: "Move appointment" }).click();
  await page.getByLabel("Start time").fill("10:07");
  await page.getByRole("button", { name: "Save move" }).click();
  await expect(
    page.getByRole("definition").filter({ hasText: "10:07–10:42" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close appointment details" }).click();
  await expect(page).toHaveURL(
    `${ownerOrigin}/?date=2027-01-19&view=day&barber=${owner.barberId}`,
  );
  await expect(
    page.getByRole("link", { name: /Appointment: Move Journey Guest/ }),
  ).toContainText("10:07–10:42");
});

test("owner can move a booking from standalone details", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  await page.goto(
    `${ownerOrigin}/appointments/${bookingId}?date=2027-01-19&view=week&barber=${owner.barberId}`,
  );
  await page.getByRole("button", { name: "Move appointment" }).click();
  await expect(page.getByLabel("Service")).toHaveValue(owner.serviceId!);
  await expect(page.getByLabel("Barber")).toHaveValue(owner.barberId!);
  await expect(page.getByLabel("Date")).toHaveValue("2027-01-19");
  await expect(page.getByLabel("Start time")).toHaveValue("08:07");
  await page.getByLabel("Start time").fill("11:07");
  await page.getByRole("button", { name: "Save move" }).click();
  await expect(
    page.getByRole("definition").filter({ hasText: "11:07–11:42" }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    `${ownerOrigin}/appointments/${bookingId}?date=2027-01-19&view=week&barber=${owner.barberId}`,
  );
});

test("owner cancellation requires confirmation and retains the cancelled booking @device", async ({
  page,
  context,
  owners,
  database,
}, testInfo) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(
    `${ownerOrigin}/?date=2027-01-19&view=day&barber=${owner.barberId}`,
  );
  await page
    .getByRole("link", { name: /Appointment: Move Journey Guest/ })
    .click();
  await page.getByRole("button", { name: "Cancel appointment" }).click();
  await expect(
    page.getByRole("dialog", { name: "Cancel appointment?" }),
  ).toBeVisible();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const dialog = page.getByRole("dialog", { name: "Cancel appointment?" });
    const dialogBox = await dialog.boundingBox();
    const title = dialog.getByRole("heading", {
      name: "Cancel appointment?",
    });
    const titleText = await title.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return Array.from(range.getClientRects(), ({ right }) => right);
    });
    const closeBox = await dialog
      .getByRole("button", { name: "Close" })
      .boundingBox();
    const description = await dialog
      .getByText(/This releases the scheduled time/)
      .boundingBox();
    const buttons = await Promise.all(
      ["Keep appointment", "Confirm cancellation"].map((name) =>
        dialog.getByRole("button", { name }).boundingBox(),
      ),
    );

    expect(dialogBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect(description).not.toBeNull();
    expect(buttons.every((box) => box !== null)).toBe(true);
    expect(titleText.length).toBeGreaterThan(0);
    expect(titleText.every((right) => right <= closeBox!.x)).toBe(true);
    expect(description!.x + description!.width).toBeLessThanOrEqual(
      dialogBox!.x + dialogBox!.width - 16,
    );
    expect(
      buttons.every(
        (box) => box!.x + box!.width <= dialogBox!.x + dialogBox!.width - 16,
      ),
    ).toBe(true);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`cancel-confirmation-${width}.png`),
    });
  }
  await page.getByRole("button", { name: "Keep appointment" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Appointment details" })
      .getByText("Confirmed", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancel appointment" }).click();
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return route.continue();
    await route.fetch();
    await route.abort();
  });
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "response was interrupted",
  );
  await page.unrouteAll({ behavior: "wait" });
  await page.getByRole("button", { name: "Retry same operation" }).click();
  await expect(
    page.getByRole("main").getByText("Cancelled", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "Appointment details" })
      .getByText("Move Journey Guest", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Move appointment" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close appointment details" }).click();
  await expect(
    page.getByRole("link", { name: /Appointment: Move Journey Guest/ }),
  ).toContainText("Cancelled");
  const changes = await database.pool.query(
    "SELECT kind FROM booking_changes WHERE booking_id=$1",
    [bookingId],
  );
  expect(changes.rows).toEqual([{ kind: "cancel" }]);
  expect(page.url()).toContain("date=2027-01-19&view=day");
  expect(page.url()).toContain(`barber=${owner.barberId}`);
  expect(page.url()).not.toContain(bookingId);
});

test("owner move failure preserves the target draft and original booking", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  await createOwnerAppointment(owner, "2027-01-19T15:07:00.000Z");
  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  await page.getByRole("button", { name: "Move appointment" }).click();
  await page.getByLabel("Start time").fill("10:07");
  await page.getByRole("button", { name: "Save move" }).click();
  await expect(page.getByRole("alert")).toContainText("just taken");
  await expect(page.getByLabel("Start time")).toHaveValue("10:07");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("main").getByRole("definition").filter({
      hasText: "08:07–08:42",
    }),
  ).toBeVisible();
});

test("owner move makes a changed service offer explicit before retry", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  const replacementId = randomUUID();
  await database.pool.query(
    "INSERT INTO services (id,shop_id,name,price_usd,duration_minutes,offered) VALUES ($1,$2,'Fade',30,45,true)",
    [replacementId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO barber_services (shop_id,barber_id,service_id) VALUES ($1,$2,$3)",
    [owner.shopId, owner.barberId, replacementId],
  );
  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  await page.getByRole("button", { name: "Move appointment" }).click();
  await page.getByLabel("Service").selectOption(replacementId);
  await page.getByLabel("Start time").fill("10:07");
  await database.pool.query("UPDATE services SET price_usd=35 WHERE id=$1", [
    replacementId,
  ]);
  await page.getByRole("button", { name: "Save move" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Review the current service",
  );
  await expect(
    page.getByRole("button", { name: "Reload saved appointment and review" }),
  ).toBeVisible();
  await expect(page.getByLabel("Start time")).toHaveValue("10:07");
  await page
    .getByRole("button", { name: "Reload saved appointment and review" })
    .click();
  await page.getByRole("button", { name: "Move appointment" }).click();
  await expect(page.getByLabel("Service")).toContainText("Fade · $35");
  await page.getByRole("button", { name: "Save move" }).click();
  await expect(
    page.getByRole("main").getByRole("definition").filter({
      hasText: "10:07–10:52",
    }),
  ).toBeVisible();
});

test("owner move preserves its draft when the booking revision becomes stale", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  await page.getByRole("button", { name: "Move appointment" }).click();
  await page.getByLabel("Start time").fill("10:07");
  const { moveOwnerBooking } =
    await import("../../features/bookings/mutations");
  const concurrent = await moveOwnerBooking(
    { userId: owner.id },
    {
      bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: owner.serviceId!,
      barberId: owner.barberId!,
      startAt: "2027-01-19T14:07:00.000Z",
      reviewedOffer: {
        name: "Walk-in Cut",
        priceUsd: "25.00",
        durationMinutes: "35",
      },
    },
  );
  expect(concurrent.success).toBe(true);
  await page.getByRole("button", { name: "Save move" }).click();
  await expect(page.getByRole("alert")).toContainText("changed");
  await expect(page.getByLabel("Start time")).toHaveValue("10:07");
  await expect(
    page.getByRole("button", { name: "Reload saved appointment and review" }),
  ).toBeVisible();
});

test("owner move recovers a lost response and shows the latest saved details", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(
    owner,
    "2026-11-03T14:07:00.000Z",
  );
  await page.goto(
    `${ownerOrigin}/appointments/${bookingId}?date=2026-11-03&view=day&barber=${owner.barberId}`,
  );
  await page.getByRole("button", { name: "Move appointment" }).click();
  await page.getByLabel("Start time").fill("10:07");
  let dropped = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return route.continue();
    await route.fetch();
    dropped = true;
    await route.abort();
  });
  await page.getByRole("button", { name: "Save move" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "response was interrupted",
  );
  expect(dropped).toBe(true);
  await page.unrouteAll({ behavior: "wait" });

  const { moveOwnerBooking } =
    await import("../../features/bookings/mutations");
  const laterChange = await moveOwnerBooking(
    { userId: owner.id },
    {
      bookingId,
      expectedRevision: 1,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: owner.serviceId!,
      barberId: owner.barberId!,
      startAt: "2026-11-03T17:07:00.000Z",
      reviewedOffer: {
        name: "Walk-in Cut",
        priceUsd: "25.00",
        durationMinutes: "35",
      },
    },
  );
  expect(laterChange.success).toBe(true);

  // Owner navigation must not discard an unresolved operation.
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Recover pending operation" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "TrimTime" }).click();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(bookingId));
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(
    page.getByRole("button", { name: "Recover pending operation" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Recover pending operation" }).click();
  await page.getByRole("button", { name: "Retry same operation" }).click();
  await expect(
    page.getByRole("main").getByRole("definition").filter({
      hasText: "12:07–12:42",
    }),
  ).toBeVisible();
  const changes = await database.pool.query(
    "SELECT kind, applied_revision, after_snapshot FROM booking_changes WHERE booking_id=$1 ORDER BY applied_revision",
    [bookingId],
  );
  expect(changes.rows).toHaveLength(2);
  expect(changes.rows.map((row) => row.applied_revision)).toEqual([1, 2]);
  expect(changes.rows[0].kind).toBe("move");
  expect(changes.rows[0].after_snapshot.startAt).toBe(
    "2026-11-03T15:07:00.000Z",
  );
  expect(changes.rows[1].after_snapshot.startAt).toBe(
    "2026-11-03T17:07:00.000Z",
  );
  const work = await database.pool.query(
    "SELECT booking_revision, kind FROM notification_work WHERE booking_id=$1 AND booking_revision > 0 ORDER BY booking_revision",
    [bookingId],
  );
  expect(work.rows).toHaveLength(2);
  expect(work.rows.map((row) => row.booking_revision)).toEqual([1, 2]);
});

test("owner keeps the uncertain operation payload fixed until recovery", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  await page.getByRole("button", { name: "Move appointment" }).click();
  await page.getByLabel("Start time").fill("10:07");
  const bodies: Buffer[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return route.continue();
    bodies.push(request.postDataBuffer()!);
    if (bodies.length === 1) {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Save move" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "response was interrupted",
  );
  await expect(page.getByLabel("Start time")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Retry same operation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry same operation" }).click();
  await expect(
    page.getByRole("main").getByRole("definition").filter({
      hasText: "10:07–10:42",
    }),
  ).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
});

test("dirty move drafts survive keep and discard decisions on dismissal @device", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  await page.goto(`${ownerOrigin}/?date=2027-01-19&view=day`);
  await page
    .getByRole("link", { name: /Appointment: Move Journey Guest/ })
    .click();
  await page.getByRole("button", { name: "Move appointment" }).click();
  await page.getByLabel("Start time").fill("10:07");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.getByRole("button", { name: "Move appointment" }).click();
  await expect(page.getByLabel("Start time")).toHaveValue("10:07");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Close appointment details" }).click();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(`${ownerOrigin}/?date=2027-01-19&view=day`);
  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  await page.getByRole("button", { name: "Move appointment" }).click();
  await page.getByLabel("Start time").fill("09:07");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Back to calendar" }).click();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.getByRole("button", { name: "Move appointment" }).click();
  await expect(page.getByLabel("Start time")).toHaveValue("09:07");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Back to calendar" }).click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(`${ownerOrigin}/`);
  for (let index = 0; index < 2; index += 1) {
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/appointments/${bookingId}`));
    await page.goForward();
    await expect(page).toHaveURL(`${ownerOrigin}/`);
  }
});

test("intercepted appointment draft survives repeated Back and Forward", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  const calendarUrl = `${ownerOrigin}/?date=2027-01-19&view=day`;
  await page.goto(calendarUrl);
  await page
    .getByRole("link", { name: /Appointment: Move Journey Guest/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Appointment details" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Move appointment" }).click();
  await page.getByLabel("Start time").fill("10:07");
  await page.keyboard.press("Escape");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/appointments/${bookingId}`));
    await expect(
      page.getByRole("dialog", { name: "Discard unsaved changes?" }),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/appointments/${bookingId}`));
    await expect(
      page.getByRole("dialog", { name: "Discard unsaved changes?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(page).toHaveURL(new RegExp(`/appointments/${bookingId}`));
    await expect(
      page.getByRole("dialog", { name: "Appointment details" }),
    ).toBeVisible();
    if (attempt === 0) {
      await page.goBack();
      await expect(
        page.getByRole("dialog", { name: "Discard unsaved changes?" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Keep editing" }).click();
    }
  }

  await page.getByRole("button", { name: "Move appointment" }).click();
  await expect(page.getByLabel("Start time")).toHaveValue("10:07");
  await page.keyboard.press("Escape");
  await page.goBack();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(calendarUrl);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/appointments/${bookingId}`));
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toHaveCount(0);
});

test("stale booking reload asks before discarding the move draft", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  await page.getByRole("button", { name: "Move appointment" }).click();
  await page.getByLabel("Start time").fill("10:07");
  const { moveOwnerBooking } =
    await import("../../features/bookings/mutations");
  const concurrent = await moveOwnerBooking(
    { userId: owner.id },
    {
      bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      serviceId: owner.serviceId!,
      barberId: owner.barberId!,
      startAt: "2027-01-19T14:07:00.000Z",
      reviewedOffer: {
        name: "Walk-in Cut",
        priceUsd: "25.00",
        durationMinutes: "35",
      },
    },
  );
  expect(concurrent.success).toBe(true);
  await page.getByRole("button", { name: "Save move" }).click();
  await expect(page.getByRole("alert")).toContainText("Appointment changed");
  await page
    .getByRole("button", { name: "Reload saved appointment and review" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Start time")).toHaveValue("10:07");
  await page
    .getByRole("button", { name: "Reload saved appointment and review" })
    .click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(
    page.getByRole("main").getByRole("definition").filter({
      hasText: "09:07–09:42",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Move appointment" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Move appointment" }).click();
  await expect(page.getByLabel("Start time")).toHaveValue("09:07");
});

test("uncertain cancellation survives close and standalone Back until recovery", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  await page.getByRole("button", { name: "Cancel appointment" }).click();
  let dropped = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return route.continue();
    await route.fetch();
    dropped = true;
    await route.abort();
  });
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "response was interrupted",
  );
  expect(dropped).toBe(true);
  await page.unrouteAll({ behavior: "wait" });
  await page.mouse.click(1, 1);
  await expect(
    page.getByRole("button", { name: "Recover pending operation" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to calendar" }).click();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.getByRole("button", { name: "Recover pending operation" }).click();
  await expect(
    page.getByRole("button", { name: "Retry same operation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry same operation" }).click();
  await expect(
    page.getByRole("main").getByText("Cancelled", { exact: true }),
  ).toBeVisible();
  const changes = await database.pool.query(
    "SELECT kind FROM booking_changes WHERE booking_id=$1",
    [bookingId],
  );
  expect(changes.rows).toHaveLength(1);
  expect(changes.rows[0].kind).toBe("cancel");
});

test("nested appointment confirmation restores focus to its operation trigger", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  const trigger = page.getByRole("button", { name: "Cancel appointment" });
  await trigger.click();
  await page.getByRole("button", { name: "Keep appointment" }).click();
  await expect(trigger).toBeFocused();
});

test("outside click closes nested cancellation confirmation and keeps appointment details open", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  await createOwnerAppointment(owner);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${ownerOrigin}/?date=2027-01-19&view=day`);
  await page
    .getByRole("link", { name: /Appointment: Move Journey Guest/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Appointment details" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel appointment" }).click();

  const confirmation = page.getByRole("dialog", {
    name: "Cancel appointment?",
  });
  await expect(confirmation).toBeVisible();
  await page.mouse.click(1, 1);

  await expect(confirmation).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Appointment details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel appointment" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel appointment" }),
  ).toBeFocused();
});

test("outside dismissal of a dirty move keeps the draft until discard is confirmed", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  await createOwnerAppointment(owner);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${ownerOrigin}/?date=2027-01-19&view=day`);
  await page
    .getByRole("link", { name: /Appointment: Move Journey Guest/ })
    .click();
  await page.getByRole("button", { name: "Move appointment" }).click();
  await page.getByLabel("Start time").fill("10:07");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Move appointment" }),
  ).toHaveCount(0);
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(1);
  await expect(
    page.getByRole("dialog", { name: "Appointment details" }),
  ).toBeVisible();

  await page.mouse.click(1, 1);
  const discard = page.getByRole("dialog", {
    name: "Discard unsaved changes?",
  });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Keep editing" }).click();
  await page.getByRole("button", { name: "Move appointment" }).click();
  await expect(page.getByLabel("Start time")).toHaveValue("10:07");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Close appointment details" }).click();

  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(`${ownerOrigin}/?date=2027-01-19&view=day`);
});

test("ended and cancelled appointments do not offer unavailable operations", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, appointment: true });
  await database.pool.query(
    "UPDATE bookings SET start_at='2026-10-26T10:07:00Z',end_at='2026-10-26T10:42:00Z' WHERE id=$1",
    [owner.appointmentId],
  );
  await page.goto(`${ownerOrigin}/appointments/${owner.appointmentId}`);
  await expect(page.getByText("Past, unmarked", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Move appointment" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cancel appointment" }),
  ).toHaveCount(0);
});

test("appointment details and move action expose loading and saving states", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  await page.goto(`${ownerOrigin}/?date=2027-01-19&view=day`);
  let releaseRead!: () => void;
  let markReadHeld!: () => void;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const readHeld = new Promise<void>((resolve) => {
    markReadHeld = resolve;
  });
  await page.route(`**/appointments/${bookingId}**`, async (route) => {
    const request = route.request();
    if (request.method() !== "GET" || request.headers()["next-router-prefetch"])
      return route.continue();
    markReadHeld();
    await readGate;
    await route.continue();
  });
  const opening = page
    .getByRole("link", { name: /Appointment: Move Journey Guest/ })
    .click();
  await readHeld;
  await expect(
    page.getByRole("link", { name: /Appointment: Move Journey Guest/ }),
  ).toBeVisible();
  releaseRead();
  await opening;
  await page.unrouteAll({ behavior: "wait" });
  await page.getByRole("button", { name: "Move appointment" }).click();
  await page.getByLabel("Start time").fill("10:07");

  let releaseAction!: () => void;
  let markActionHeld!: () => void;
  const actionGate = new Promise<void>((resolve) => {
    releaseAction = resolve;
  });
  const actionHeld = new Promise<void>((resolve) => {
    markActionHeld = resolve;
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return route.continue();
    markActionHeld();
    await actionGate;
    await route.continue();
  });
  const saving = page.getByRole("button", { name: "Save move" }).click();
  await actionHeld;
  await expect(page.getByRole("button", { name: "Saving…" })).toBeVisible();
  releaseAction();
  await saving;
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page
      .getByRole("dialog", { name: "Appointment details" })
      .getByRole("definition")
      .filter({ hasText: "10:07–10:42" }),
  ).toBeVisible();
});
