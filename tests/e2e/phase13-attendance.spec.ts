import { randomBytes } from "node:crypto";
import { test, expect, ownerOrigin } from "./fixtures";
import {
  createOwnerAppointment,
  createPastOwnerAppointment,
  getOwnerManageToken,
  poisonOwnerAppointmentRead,
  restoreOwnerAppointmentRead,
  setFixtureAppointmentEnd,
} from "./owner-booking-fixtures";

test("past unmarked appointment exposes owner attendance controls", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);

  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);

  await expect(page.getByText("Past, unmarked", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Attendance" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save attendance" }),
  ).toBeVisible();
});

test("attendance: owner can complete a past appointment and see it in Activity", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);

  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  await page.getByLabel("Attendance").selectOption("completed");
  await page.getByRole("button", { name: "Save attendance" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Completed" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: "Completed" }),
  ).toBeVisible();

  await page.goto(
    `${ownerOrigin}/?date=${now.toISOString().slice(0, 10)}&view=day&barber=${owner.barberId}`,
  );
  const appointment = page.getByRole("link", {
    name: "Appointment: Move Journey Guest, Walk-in Cut, Manual Barber",
  });
  await expect(appointment).toContainText("Completed");
  await page.goto(`${ownerOrigin}/activity`);
  await expect(page.getByRole("main")).toContainText("Completed");
});

test("attendance: owner can correct both classifications and Activity keeps each transition", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);
  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);

  await page.getByLabel("Attendance").selectOption("completed");
  await page.getByRole("button", { name: "Save attendance" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Completed" }),
  ).toBeVisible();

  await page.getByLabel("Attendance").selectOption("no_show");
  await page.getByRole("button", { name: "Save attendance" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "No-show" }),
  ).toBeVisible();

  await page.getByLabel("Attendance").selectOption("completed");
  await page.getByRole("button", { name: "Save attendance" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Completed" }),
  ).toBeVisible();

  await page.goto(`${ownerOrigin}/activity`);
  await expect(page.getByText("Attendance: Completed → No-show")).toBeVisible();
  await expect(page.getByText("Attendance: No-show → Completed")).toBeVisible();
});

test("attendance draft: declining dismissal keeps the intercepted selection and URL", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);
  const calendarUrl = `${ownerOrigin}/?date=${now.toISOString().slice(0, 10)}&view=day&barber=${owner.barberId}`;
  await page.goto(calendarUrl);
  await page
    .getByRole("link", {
      name: "Appointment: Move Journey Guest, Walk-in Cut, Manual Barber",
    })
    .click();
  await page.getByLabel("Attendance").selectOption("no_show");
  await page.getByRole("button", { name: "Close appointment details" }).click();

  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();

  await expect(page).toHaveURL(new RegExp(`/appointments/${bookingId}`));
  await expect(page.getByLabel("Attendance")).toHaveValue("no_show");
});

test("attendance draft: Escape asks before discarding the intercepted selection", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);
  await page.goto(
    `${ownerOrigin}/?date=${now.toISOString().slice(0, 10)}&view=day&barber=${owner.barberId}`,
  );
  await page
    .getByRole("link", {
      name: "Appointment: Move Journey Guest, Walk-in Cut, Manual Barber",
    })
    .click();
  await page.getByLabel("Attendance").selectOption("no_show");
  await page.keyboard.press("Escape");

  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(new RegExp(`/appointments/${bookingId}`));
  await expect(page.getByLabel("Attendance")).toHaveValue("no_show");
});

test("attendance draft: outside click asks before discarding the intercepted selection", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);
  await page.goto(
    `${ownerOrigin}/?date=${now.toISOString().slice(0, 10)}&view=day&barber=${owner.barberId}`,
  );
  await page
    .getByRole("link", {
      name: "Appointment: Move Journey Guest, Walk-in Cut, Manual Barber",
    })
    .click();
  await page.getByLabel("Attendance").selectOption("no_show");
  await page.mouse.click(8, 8);

  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(new RegExp(`/appointments/${bookingId}`));
  await expect(page.getByLabel("Attendance")).toHaveValue("no_show");
});

test("attendance draft: browser Back asks before discarding the intercepted selection", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);
  await page.goto(
    `${ownerOrigin}/?date=${now.toISOString().slice(0, 10)}&view=day&barber=${owner.barberId}`,
  );
  await page
    .getByRole("link", {
      name: "Appointment: Move Journey Guest, Walk-in Cut, Manual Barber",
    })
    .click();
  await page.getByLabel("Attendance").selectOption("no_show");
  await page.goBack();

  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(new RegExp(`/appointments/${bookingId}`));
  await expect(page.getByLabel("Attendance")).toHaveValue("no_show");
});

test("attendance draft: standalone Back to calendar keeps the dirty selection", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);
  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  await page.getByLabel("Attendance").selectOption("no_show");
  await page.getByRole("link", { name: "Back to calendar" }).click();

  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(new RegExp(`/appointments/${bookingId}`));
  await expect(page.getByLabel("Attendance")).toHaveValue("no_show");
});

test("attendance stale conflict: preserve target and require refreshed review", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);
  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);

  const { setOwnerAttendance } = await import("@/features/bookings/mutations");
  const concurrent = await setOwnerAttendance(
    { userId: owner.id },
    {
      bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
      status: "completed",
    },
  );
  expect(concurrent.success).toBe(true);

  await page.getByLabel("Attendance").selectOption("no_show");
  await page.getByRole("button", { name: "Save attendance" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Appointment changed" }),
  ).toBeVisible();
  await expect(page.getByLabel("Attendance")).toHaveValue("no_show");
  await expect(
    page.getByRole("status").filter({ hasText: "Past, unmarked" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh and review" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Refresh and review" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Completed" }),
  ).toBeVisible();
  await expect(page.getByLabel("Attendance")).toHaveValue("no_show");
  await page.getByRole("button", { name: "Save attendance" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "No-show" }),
  ).toBeVisible();
});

test("attendance server rejection: preserve the selected target and saved details", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);
  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);

  await database.pool.query(
    "UPDATE bookings SET status='cancelled' WHERE id=$1 AND shop_id=$2",
    [bookingId, owner.shopId],
  );
  await page.getByLabel("Attendance").selectOption("no_show");
  await page.getByRole("button", { name: "Save attendance" }).click();

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "This appointment can no longer be marked." }),
  ).toBeVisible();
  await expect(page.getByLabel("Attendance")).toHaveValue("no_show");
  await expect(
    page.getByRole("status").filter({ hasText: "Past, unmarked" }),
  ).toBeVisible();
  await expect(page.getByText("Move Journey Guest")).toBeVisible();
  await expect(page.getByText("Walk-in Cut · 35 min · $25 USD")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save attendance" }),
  ).toBeVisible();

  const persisted = await database.pool.query(
    "SELECT status, revision FROM bookings WHERE id=$1",
    [bookingId],
  );
  expect(persisted.rows).toEqual([{ status: "cancelled", revision: 0 }]);
  const events = await database.pool.query(
    "SELECT id FROM booking_changes WHERE booking_id=$1 AND kind='attendance'",
    [bookingId],
  );
  expect(events.rows).toHaveLength(0);
});

test("attendance recovery: retry lost response after a details remount", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);
  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);

  let actionId: string | undefined;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return route.continue();
    actionId = request.headers()["next-action"];
    await route.fetch();
    await route.abort();
  });
  await page.getByLabel("Attendance").selectOption("no_show");
  await page.getByRole("button", { name: "Save attendance" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "response was interrupted" }),
  ).toBeVisible();
  expect(actionId).toBeTruthy();
  await page.unrouteAll({ behavior: "wait" });

  await page.getByRole("button", { name: "Refresh saved details" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "No-show" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry same operation" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "No-show" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry same operation" }),
  ).toHaveCount(0);

  await page.goto(`${ownerOrigin}/activity`);
  await expect(
    page.getByRole("heading", { name: /Booking activity/ }),
  ).toBeVisible();

  const events = await database.pool.query(
    "SELECT id FROM booking_changes WHERE booking_id=$1 AND kind='attendance'",
    [bookingId],
  );
  expect(events.rows).toHaveLength(1);
});

test("attendance recovery: committed save with a failed details read stays recoverable", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);
  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);

  await poisonOwnerAppointmentRead(database.pool, bookingId);
  await page.getByLabel("Attendance").selectOption("no_show");
  await page.getByRole("button", { name: "Save attendance" }).click();

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Appointment could not be loaded." }),
  ).toBeVisible();
  await expect(page.getByLabel("Attendance")).toHaveValue("no_show");
  await expect(
    page.getByRole("button", { name: "Retry same operation" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Save attendance" }),
  ).toHaveCount(0);

  const committed = await database.pool.query(
    "SELECT status, revision FROM bookings WHERE id=$1",
    [bookingId],
  );
  expect(committed.rows).toEqual([{ status: "no_show", revision: 1 }]);
  const committedEvents = await database.pool.query(
    "SELECT id FROM booking_changes WHERE booking_id=$1 AND kind='attendance'",
    [bookingId],
  );
  expect(committedEvents.rows).toHaveLength(1);

  await restoreOwnerAppointmentRead(database.pool, bookingId);
  await page.getByRole("button", { name: "Retry same operation" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "No-show" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry same operation" }),
  ).toHaveCount(0);

  const recovered = await database.pool.query(
    "SELECT status, revision FROM bookings WHERE id=$1",
    [bookingId],
  );
  expect(recovered.rows).toEqual([{ status: "no_show", revision: 1 }]);
  const recoveredEvents = await database.pool.query(
    "SELECT id FROM booking_changes WHERE booking_id=$1 AND kind='attendance'",
    [bookingId],
  );
  expect(recoveredEvents.rows).toHaveLength(1);
});

test("attendance pending: block duplicate save and intercepted dismissal", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  await createPastOwnerAppointment(database.pool, owner, now);
  await page.goto(
    `${ownerOrigin}/?date=${now.toISOString().slice(0, 10)}&view=day&barber=${owner.barberId}`,
  );
  await page
    .getByRole("link", {
      name: "Appointment: Move Journey Guest, Walk-in Cut, Manual Barber",
    })
    .click();

  let releaseAction!: () => void;
  let markActionHeld!: () => void;
  const actionGate = new Promise<void>((resolve) => {
    releaseAction = resolve;
  });
  const actionHeld = new Promise<void>((resolve) => {
    markActionHeld = resolve;
  });
  let actionCount = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return route.continue();
    actionCount += 1;
    markActionHeld();
    await actionGate;
    await route.continue();
  });

  await page.getByLabel("Attendance").selectOption("no_show");
  const saving = page.getByRole("button", { name: "Save attendance" }).click();
  await actionHeld;
  await expect(
    page.getByRole("button", { name: "Saving attendance…" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close appointment details" }).click();
  await expect(
    page.getByRole("dialog", { name: "Appointment details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toHaveCount(0);
  expect(actionCount).toBe(1);

  releaseAction();
  await saving;
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page.getByRole("status").filter({ hasText: "No-show" }),
  ).toBeVisible();
});

test("attendance pending: Escape is blocked while the save is in flight", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);
  await page.goto(
    `${ownerOrigin}/?date=${now.toISOString().slice(0, 10)}&view=day&barber=${owner.barberId}`,
  );
  await page
    .getByRole("link", {
      name: "Appointment: Move Journey Guest, Walk-in Cut, Manual Barber",
    })
    .click();

  let releaseAction!: () => void;
  let markActionHeld!: () => void;
  const actionGate = new Promise<void>((resolve) => {
    releaseAction = resolve;
  });
  const actionHeld = new Promise<void>((resolve) => {
    markActionHeld = resolve;
  });
  let actionCount = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return route.continue();
    actionCount += 1;
    markActionHeld();
    await actionGate;
    await route.continue();
  });

  await page.getByLabel("Attendance").selectOption("no_show");
  const saving = page.getByRole("button", { name: "Save attendance" }).click();
  await actionHeld;
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Appointment details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/appointments/${bookingId}`));
  expect(actionCount).toBe(1);

  releaseAction();
  await saving;
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page.getByRole("status").filter({ hasText: "No-show" }),
  ).toBeVisible();
});

test("attendance pending: outside click is blocked while the save is in flight", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);
  await page.goto(
    `${ownerOrigin}/?date=${now.toISOString().slice(0, 10)}&view=day&barber=${owner.barberId}`,
  );
  await page
    .getByRole("link", {
      name: "Appointment: Move Journey Guest, Walk-in Cut, Manual Barber",
    })
    .click();

  let releaseAction!: () => void;
  let markActionHeld!: () => void;
  const actionGate = new Promise<void>((resolve) => {
    releaseAction = resolve;
  });
  const actionHeld = new Promise<void>((resolve) => {
    markActionHeld = resolve;
  });
  let actionCount = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return route.continue();
    actionCount += 1;
    markActionHeld();
    await actionGate;
    await route.continue();
  });

  await page.getByLabel("Attendance").selectOption("no_show");
  const saving = page.getByRole("button", { name: "Save attendance" }).click();
  await actionHeld;
  await page.mouse.click(8, 8);
  await expect(
    page.getByRole("dialog", { name: "Appointment details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/appointments/${bookingId}`));
  expect(actionCount).toBe(1);

  releaseAction();
  await saving;
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page.getByRole("status").filter({ hasText: "No-show" }),
  ).toBeVisible();
});

test("attendance pending: browser Back is blocked while the save is in flight", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);
  await page.goto(
    `${ownerOrigin}/?date=${now.toISOString().slice(0, 10)}&view=day&barber=${owner.barberId}`,
  );
  await page
    .getByRole("link", {
      name: "Appointment: Move Journey Guest, Walk-in Cut, Manual Barber",
    })
    .click();

  let releaseAction!: () => void;
  let markActionHeld!: () => void;
  const actionGate = new Promise<void>((resolve) => {
    releaseAction = resolve;
  });
  const actionHeld = new Promise<void>((resolve) => {
    markActionHeld = resolve;
  });
  let actionCount = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return route.continue();
    actionCount += 1;
    markActionHeld();
    await actionGate;
    await route.continue();
  });

  await page.getByLabel("Attendance").selectOption("no_show");
  const saving = page.getByRole("button", { name: "Save attendance" }).click();
  await actionHeld;
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/appointments/${bookingId}`));
  await expect(
    page.getByRole("dialog", { name: "Appointment details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Saving attendance…" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Retry same operation" }),
  ).toHaveCount(0);
  expect(actionCount).toBe(1);

  releaseAction();
  await saving;
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page.getByRole("status").filter({ hasText: "No-show" }),
  ).toBeVisible();
});

test("attendance boundary: equality stays unmarked and forged action is too early", async ({
  page,
  context,
  owners,
  request,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const eligibleId = await createOwnerAppointment(
    owner,
    new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
  );
  const equalityId = await createOwnerAppointment(
    owner,
    new Date(now.getTime() + 4 * 60 * 60_000).toISOString(),
  );
  await setFixtureAppointmentEnd(
    database.pool,
    owner,
    eligibleId,
    new Date(now.getTime() - 1),
  );
  await setFixtureAppointmentEnd(database.pool, owner, equalityId, now);
  await page.goto(`${ownerOrigin}/appointments/${eligibleId}`);

  let actionUrl = "";
  let body: Buffer | undefined;
  let contentType = "";
  let actionId = "";
  await page.route("**/*", async (route) => {
    const actionRequest = route.request();
    if (
      actionRequest.method() === "POST" &&
      actionRequest.headers()["next-action"]
    ) {
      body = actionRequest.postDataBuffer()!;
      actionUrl = actionRequest.url();
      contentType = actionRequest.headers()["content-type"] ?? "";
      actionId = actionRequest.headers()["next-action"] ?? "";
      await route.abort();
    } else await route.continue();
  });
  await page.getByLabel("Attendance").selectOption("no_show");
  await page.getByRole("button", { name: "Save attendance" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "response was interrupted" }),
  ).toBeVisible();
  expect(body).toBeDefined();
  expect(actionId).toBeTruthy();
  await page.unrouteAll({ behavior: "wait" });

  const forgedBody = Buffer.from(
    body!.toString().replace(eligibleId, equalityId),
  );
  const early = await request.post(actionUrl, {
    headers: {
      "content-type": contentType,
      "next-action": actionId,
      origin: ownerOrigin,
      cookie: owner.cookie,
    },
    data: forgedBody,
  });
  expect(await early.text()).toContain("TOO_EARLY");

  await page.goto(`${ownerOrigin}/appointments/${equalityId}`);
  await expect(
    page.getByRole("status").filter({ hasText: "Past, unmarked" }),
  ).toBeVisible();
  await expect(page.getByLabel("Attendance")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save attendance" }),
  ).toHaveCount(0);
  const unchanged = await database.pool.query(
    "SELECT status, revision FROM bookings WHERE id=$1",
    [equalityId],
  );
  expect(unchanged.rows).toEqual([{ status: "confirmed", revision: 0 }]);
});

test("attendance boundary: one millisecond before end hides attendance controls", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createOwnerAppointment(
    owner,
    new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
  );
  await setFixtureAppointmentEnd(
    database.pool,
    owner,
    bookingId,
    new Date(now.getTime() + 1),
  );

  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  await expect(
    page.getByRole("status").filter({ hasText: "Confirmed" }),
  ).toBeVisible();
  await expect(page.getByLabel("Attendance")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save attendance" }),
  ).toHaveCount(0);
});

test("attendance manage view: completed and no-show stay view-only with the real capability", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createPastOwnerAppointment(database.pool, owner, now);
  const token = await getOwnerManageToken(database.pool, owner, bookingId);
  const manageUrl = `http://${owner.subdomain}.localhost:3100/manage/${token}`;
  const before = await database.pool.query(
    "SELECT capability_hash, capability_ciphertext, capability_key_id, occupancy_id FROM bookings WHERE id=$1",
    [bookingId],
  );

  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  await page.getByLabel("Attendance").selectOption("completed");
  await page.getByRole("button", { name: "Save attendance" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Completed" }),
  ).toBeVisible();
  await page.goto(manageUrl);
  await expect(
    page.getByRole("status").filter({ hasText: "Completed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel appointment" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open change preview" }),
  ).toHaveCount(0);

  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  await page.getByLabel("Attendance").selectOption("no_show");
  await page.getByRole("button", { name: "Save attendance" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "No-show" }),
  ).toBeVisible();
  await page.goto(manageUrl);
  await expect(
    page.getByRole("status").filter({ hasText: "No-show" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel appointment" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open change preview" }),
  ).toHaveCount(0);

  const after = await database.pool.query(
    "SELECT capability_hash, capability_ciphertext, capability_key_id, occupancy_id FROM bookings WHERE id=$1",
    [bookingId],
  );
  expect(after.rows).toEqual(before.rows);
});

test("attendance action guards: reject missing, foreign, wrong-host, and wrong-origin requests", async ({
  page,
  context,
  browser,
  owners,
  request,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const foreignContext = await browser.newContext();
  const noShopContext = await browser.newContext();
  try {
    const foreign = await owners(foreignContext, {
      shop: true,
      createSetup: true,
    });
    const noShop = await owners(noShopContext);
    const now = new Date(
      process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z",
    );
    const bookingId = await createPastOwnerAppointment(
      database.pool,
      owner,
      now,
    );
    await page.goto(`${ownerOrigin}/appointments/${bookingId}`);

    let actionUrl = "";
    let body: Buffer | undefined;
    let contentType = "";
    let actionId = "";
    await page.route("**/*", async (route) => {
      const actionRequest = route.request();
      if (
        actionRequest.method() === "POST" &&
        actionRequest.headers()["next-action"]
      ) {
        body = actionRequest.postDataBuffer()!;
        actionUrl = actionRequest.url();
        contentType = actionRequest.headers()["content-type"] ?? "";
        actionId = actionRequest.headers()["next-action"] ?? "";
        await route.abort();
      } else await route.continue();
    });
    await page.getByLabel("Attendance").selectOption("no_show");
    await page.getByRole("button", { name: "Save attendance" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "response was interrupted" }),
    ).toBeVisible();
    expect(body).toBeDefined();
    expect(actionId).toBeTruthy();
    await page.unrouteAll({ behavior: "wait" });

    const headers = {
      "content-type": contentType,
      "next-action": actionId,
      origin: ownerOrigin,
    };
    const signedOut = await request.post(actionUrl, {
      headers,
      data: body!,
    });
    expect(await signedOut.text()).toContain("UNAUTHENTICATED");

    const foreignRequest = await request.post(actionUrl, {
      headers: { ...headers, cookie: foreign.cookie },
      data: body!,
    });
    const foreignBody = await foreignRequest.text();
    expect(foreignBody).toContain("NOT_FOUND");
    expect(foreignBody).not.toContain("Move Journey Guest");

    const missingShop = await request.post(actionUrl, {
      headers: { ...headers, cookie: noShop.cookie },
      data: body!,
    });
    expect(await missingShop.text()).toContain("SHOP_REQUIRED");

    const wrongOrigin = await request.post(actionUrl, {
      headers: {
        ...headers,
        cookie: owner.cookie,
        origin: "https://attacker.example",
      },
      data: body!,
    });
    expect(
      wrongOrigin.status() >= 400 ||
        (await wrongOrigin.text()).includes("UNAVAILABLE"),
    ).toBe(true);

    const wrongHost = await request.post(actionUrl, {
      headers: {
        ...headers,
        cookie: owner.cookie,
        host: `${owner.subdomain}.localhost:3100`,
        "x-forwarded-host": `${owner.subdomain}.localhost:3100`,
      },
      data: body!,
    });
    expect(
      wrongHost.status() >= 400 ||
        (await wrongHost.text()).includes("UNAVAILABLE"),
    ).toBe(true);

    const unchanged = await database.pool.query(
      "SELECT status, revision FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(unchanged.rows).toEqual([{ status: "confirmed", revision: 0 }]);
    const events = await database.pool.query(
      "SELECT id FROM booking_changes WHERE booking_id=$1 AND kind='attendance'",
      [bookingId],
    );
    expect(events.rows).toHaveLength(0);
  } finally {
    await Promise.all([foreignContext.close(), noShopContext.close()]);
  }
});

test("upcoming Activity booking opens its existing appointment details", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const bookingId = await createOwnerAppointment(
    owner,
    new Date(now.getTime() + 3 * 60 * 60_000).toISOString(),
  );

  await page.goto(`${ownerOrigin}/activity`);
  const booking = page
    .getByRole("article")
    .filter({ hasText: "Move Journey Guest" });
  await expect(booking).toBeVisible();
  await booking.getByRole("link", { name: "Appointment details" }).click();

  await expect(page).toHaveURL(`${ownerOrigin}/appointments/${bookingId}`);
  await expect(
    page.getByRole("heading", { name: "Appointment details", level: 1 }),
  ).toBeVisible();
});
