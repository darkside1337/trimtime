import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { expect, ownerOrigin, test, type Owner } from "./fixtures";
import { addReadyCatalog } from "./publication-fixtures";
import { createOwnerAppointment } from "./owner-booking-fixtures";

test("cancelled future appointment restores through calendar details and keeps retained values", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  const calendarUrl = `${ownerOrigin}/?date=2027-01-19&view=day&barber=${owner.barberId}`;

  await page.goto(calendarUrl);
  await page
    .getByRole("link", { name: /Appointment: Move Journey Guest/ })
    .click();
  const details = page.getByRole("dialog", { name: "Appointment details" });
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: "Cancel appointment" }).click();
  await page
    .getByRole("dialog", { name: "Cancel appointment?" })
    .getByRole("button", { name: "Confirm cancellation" })
    .click();
  await expect(details.getByText("Cancelled", { exact: true })).toBeVisible();

  const restoreTrigger = details.getByRole("button", {
    name: "Restore appointment",
  });
  await expect(restoreTrigger).toBeVisible();
  await restoreTrigger.click();

  const confirmation = page.getByRole("dialog", {
    name: "Restore appointment?",
  });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(/recheck availability/i);
  await expect(confirmation).toContainText("Walk-in Cut");
  await expect(confirmation).toContainText("Manual Barber");
  await expect(confirmation).toContainText(/08:07/);
  await expect(confirmation).toContainText(/08:42/);
  await expect(confirmation.locator("input, select, textarea")).toHaveCount(0);

  await confirmation
    .getByRole("button", { name: "Restore appointment" })
    .click();
  await expect(confirmation).toHaveCount(0);
  await expect(details.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(details).toContainText("Walk-in Cut");
  await expect(details).toContainText("Manual Barber");
  await expect(
    details.getByRole("button", { name: "Restore appointment" }),
  ).toHaveCount(0);

  await details
    .getByRole("button", { name: "Close appointment details" })
    .click();
  await expect(page).toHaveURL(calendarUrl);
  const calendarLink = page.getByRole("link", {
    name: /Appointment: Move Journey Guest/,
  });
  await expect(calendarLink).toContainText("08:07–08:42");
  await expect(calendarLink).not.toContainText("Cancelled");

  await page.goto(
    `${ownerOrigin}/appointments/${bookingId}?date=2027-01-19&view=day&barber=${owner.barberId}`,
  );
  await expect(
    page.getByRole("main").getByText("Confirmed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Walk-in Cut");
  await expect(page.getByRole("main")).toContainText("Manual Barber");
  await expect(
    page.getByRole("main").getByRole("button", { name: "Restore appointment" }),
  ).toHaveCount(0);

  const booking = await database.pool.query(
    "SELECT status, revision, occupancy_id, service_name, service_price_usd, service_duration_minutes, barber_name, customer_name, start_at, end_at FROM bookings WHERE id=$1",
    [bookingId],
  );
  expect(booking.rows).toHaveLength(1);
  expect(booking.rows[0]).toMatchObject({
    status: "confirmed",
    revision: 2,
    service_name: "Walk-in Cut",
    service_price_usd: "25",
    service_duration_minutes: 35,
    barber_name: "Manual Barber",
    customer_name: "Move Journey Guest",
  });
  expect(booking.rows[0].occupancy_id).toEqual(expect.any(String));
  expect(new Date(booking.rows[0].start_at).toISOString()).toBe(
    "2027-01-19T13:07:00.000Z",
  );
  expect(new Date(booking.rows[0].end_at).toISOString()).toBe(
    "2027-01-19T13:42:00.000Z",
  );

  const occupancy = await database.pool.query(
    "SELECT shop_id, barber_id, start_at, end_at FROM occupied_intervals WHERE id=$1",
    [booking.rows[0].occupancy_id],
  );
  expect(occupancy.rows).toEqual([
    {
      shop_id: owner.shopId,
      barber_id: owner.barberId,
      start_at: new Date("2027-01-19T13:07:00.000Z"),
      end_at: new Date("2027-01-19T13:42:00.000Z"),
    },
  ]);

  const changes = await database.pool.query(
    "SELECT kind, applied_revision FROM booking_changes WHERE booking_id=$1 ORDER BY applied_revision",
    [bookingId],
  );
  expect(changes.rows).toEqual([
    { kind: "cancel", applied_revision: 1 },
    { kind: "restore", applied_revision: 2 },
  ]);
});

test("standalone details restores and a denied restore keeps the cancelled appointment", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const restoreId = await createOwnerAppointment(owner);
  const deniedId = await createOwnerAppointment(
    owner,
    "2027-01-19T14:07:00.000Z",
  );
  const { cancelOwnerBooking } =
    await import("../../features/bookings/mutations");
  for (const bookingId of [restoreId, deniedId]) {
    const cancelled = await cancelOwnerBooking(
      { userId: owner.id },
      {
        bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
      },
    );
    expect(cancelled.success).toBe(true);
  }

  await page.goto(`${ownerOrigin}/appointments/${restoreId}`);
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore appointment" }).click();
  await page
    .getByRole("dialog", { name: "Restore appointment?" })
    .getByRole("button", { name: "Restore appointment" })
    .click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore appointment" }),
  ).toHaveCount(0);

  await database.pool.query("UPDATE barbers SET archived=true WHERE id=$1", [
    owner.barberId,
  ]);
  await page.goto(`${ownerOrigin}/appointments/${deniedId}`);
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore appointment" }).click();
  const deniedDialog = page.getByRole("dialog", {
    name: "Restore appointment?",
  });
  await deniedDialog
    .getByRole("button", { name: "Restore appointment" })
    .click();
  await expect(deniedDialog.getByRole("alert")).toContainText(
    "That barber is not available for this appointment.",
  );
  await expect(deniedDialog).toBeVisible();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await deniedDialog.getByRole("button", { name: "Keep cancelled" }).click();
  await expect(deniedDialog).toHaveCount(0);
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(
    page
      .getByLabel("Appointment actions")
      .getByRole("button", { name: "Restore appointment" }),
  ).toBeVisible();

  const denied = await database.pool.query(
    "SELECT status, revision, occupancy_id FROM bookings WHERE id=$1",
    [deniedId],
  );
  expect(denied.rows).toEqual([
    { status: "cancelled", revision: 1, occupancy_id: null },
  ]);
  expect(
    (
      await database.pool.query(
        "SELECT kind, applied_revision FROM booking_changes WHERE booking_id=$1 ORDER BY applied_revision",
        [deniedId],
      )
    ).rows,
  ).toEqual([{ kind: "cancel", applied_revision: 1 }]);
  expect(
    (
      await database.pool.query(
        "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id=$1 AND barber_id=$2 AND start_at='2027-01-19T14:07:00Z'",
        [owner.shopId, owner.barberId],
      )
    ).rows[0].count,
  ).toBe(0);
});

test("restore denies a slot rebooked through the public booking flow without displacing it", async ({
  page,
  context,
  browser,
  owners,
  database,
}) => {
  const owner = await owners(context, {
    shop: true,
    published: true,
  });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);
  const bookingId = await createOwnerAppointmentForCatalog(
    owner,
    serviceId,
    barberId,
    "2026-11-10T15:00:00.000Z",
  );
  const { cancelOwnerBooking } =
    await import("../../features/bookings/mutations");
  const cancelled = await cancelOwnerBooking(
    { userId: owner.id },
    {
      bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    },
  );
  expect(cancelled.success).toBe(true);

  const publicContext = await browser.newContext();
  try {
    const publicPage = await publicContext.newPage();
    if (process.env.TRIMTIME_E2E_NOW)
      await publicPage.clock.install({
        time: new Date(process.env.TRIMTIME_E2E_NOW),
      });
    await publicPage.goto(`http://${owner.subdomain}.localhost:3100/`);
    await publicPage
      .locator(`input[name="serviceId"][value="${serviceId}"]`)
      .check();
    await publicPage
      .getByRole("button", { name: "Choose your barber" })
      .click();
    await publicPage
      .locator(`input[name="barberId"][value="${barberId}"]`)
      .check();
    await publicPage
      .getByRole("button", { name: "Choose date and time" })
      .click();
    await publicPage.getByLabel("Date", { exact: true }).fill("2026-11-10");
    const start = publicPage.locator(
      'input[name="startAt"][value^="2026-11-10T15:00:00"]',
    );
    await expect(start).toHaveCount(1);
    await start.check();
    await publicPage
      .getByRole("button", { name: "Your details", exact: true })
      .click();
    await publicPage.getByLabel("Name").fill("Replacement Guest");
    await publicPage
      .getByLabel("Email")
      .fill(`replacement-${randomBytes(6).toString("hex")}@example.test`);
    await publicPage.getByRole("button", { name: "Confirm booking" }).click();
    const manageLink = publicPage.getByRole("link", {
      name: "Open booking details",
    });
    await expect(manageLink).toBeVisible();
    const manageUrl = new URL(
      (await manageLink.getAttribute("href"))!,
      publicPage.url(),
    );

    await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Restore appointment" }).click();
    const dialog = page.getByRole("dialog", { name: "Restore appointment?" });
    await dialog.getByRole("button", { name: "Restore appointment" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "This time is already booked or blocked. Free this time before restoring the appointment.",
    );
    await expect(dialog).toBeVisible();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Keep cancelled" }).click();
    await expect(dialog).toHaveCount(0);

    await publicPage.goto(manageUrl.toString());
    await expect(publicPage.getByText("Replacement Guest")).toBeVisible();
    await expect(publicPage.getByText(/10:00|10:35/).first()).toBeVisible();

    const rows = await database.pool.query(
      "SELECT id, status, revision, occupancy_id, customer_name, start_at, end_at FROM bookings WHERE shop_id=$1 ORDER BY start_at",
      [owner.shopId],
    );
    expect(rows.rows).toHaveLength(2);
    const original = rows.rows.find((row) => row.id === bookingId)!;
    const replacement = rows.rows.find((row) => row.id !== bookingId)!;
    expect(original).toMatchObject({
      status: "cancelled",
      revision: 1,
      occupancy_id: null,
      customer_name: "Move Journey Guest",
    });
    expect(replacement).toMatchObject({
      status: "confirmed",
      revision: 0,
      customer_name: "Replacement Guest",
    });
    expect(replacement.occupancy_id).toEqual(expect.any(String));
    expect(new Date(replacement.start_at).toISOString()).toBe(
      "2026-11-10T15:00:00.000Z",
    );
    expect(new Date(replacement.end_at).toISOString()).toBe(
      "2026-11-10T15:35:00.000Z",
    );
    expect(
      (
        await database.pool.query(
          "SELECT kind, applied_revision FROM booking_changes WHERE booking_id=$1 ORDER BY applied_revision",
          [bookingId],
        )
      ).rows,
    ).toEqual([{ kind: "cancel", applied_revision: 1 }]);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM occupied_intervals WHERE shop_id=$1 AND start_at='2026-11-10T15:00:00Z'",
          [owner.shopId],
        )
      ).rows[0].count,
    ).toBe(1);
  } finally {
    await publicContext.close();
  }
});

async function poisonNextRestorationRead(pool: Pool, bookingId: string) {
  const name = `poison_restore_read_${randomUUID().replaceAll("-", "")}`;
  await pool.query(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = 'infinity'; RETURN NEW; END $$`,
  );
  await pool.query(
    `CREATE TRIGGER ${name} BEFORE INSERT ON notification_work FOR EACH ROW WHEN (NEW.booking_id = '${bookingId}'::uuid AND NEW.kind = 'customer_restoration') EXECUTE FUNCTION ${name}()`,
  );
  let cleaned = false;
  return async () => {
    if (cleaned) return;
    cleaned = true;
    await pool.query(`DROP TRIGGER IF EXISTS ${name} ON notification_work`);
    await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
    await pool.query(
      "UPDATE notification_work SET updated_at=now() WHERE booking_id=$1 AND kind='customer_restoration'",
      [bookingId],
    );
  };
}

async function openAllWeek(pool: Pool, owner: Owner, barberId: string) {
  const week = Array.from({ length: 7 }, () => ({
    working: [{ start: 0, end: 1440 }],
    breaks: [],
  }));
  await pool.query(
    "UPDATE shop_schedules SET week=$2::jsonb WHERE shop_id=$1",
    [owner.shopId, JSON.stringify(week)],
  );
  await pool.query(
    "UPDATE barber_schedules SET week=$3::jsonb WHERE shop_id=$1 AND barber_id=$2",
    [owner.shopId, barberId, JSON.stringify(week)],
  );
}

async function createOwnerAppointmentForCatalog(
  owner: Owner,
  serviceId: string,
  barberId: string,
  startAt: string,
) {
  const { createOwnerBooking } =
    await import("../../features/bookings/mutations");
  const result = await createOwnerBooking(
    { userId: owner.id },
    {
      serviceId,
      barberId,
      startAt,
      reviewedOffer: {
        name: "Cut",
        priceUsd: "35.00",
        durationMinutes: "35",
      },
      contact: {
        name: "Move Journey Guest",
        email: `move-${randomBytes(6).toString("hex")}@example.test`,
        whatsappOptIn: false,
      },
      recoveryKey: randomBytes(32).toString("base64url"),
    },
  );
  if (!result.success) throw new Error("Owner appointment fixture failed.");
  return result.data.bookingId;
}

test("stale restore denies across tabs and an interrupted success retries one identical recovery after remount", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const staleId = await createOwnerAppointment(owner);
  const { cancelOwnerBooking } =
    await import("../../features/bookings/mutations");
  const cancel = async (bookingId: string) => {
    const result = await cancelOwnerBooking(
      { userId: owner.id },
      {
        bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
      },
    );
    expect(result.success).toBe(true);
  };
  await cancel(staleId);

  await page.goto(`${ownerOrigin}/appointments/${staleId}`);
  await page.getByRole("button", { name: "Restore appointment" }).click();
  const staleDialog = page.getByRole("dialog", {
    name: "Restore appointment?",
  });
  await expect(staleDialog).toBeVisible();

  const secondPage = await context.newPage();
  try {
    if (process.env.TRIMTIME_E2E_NOW)
      await secondPage.clock.install({
        time: new Date(process.env.TRIMTIME_E2E_NOW),
      });
    await secondPage.goto(`${ownerOrigin}/appointments/${staleId}`);
    await secondPage
      .getByRole("button", { name: "Restore appointment" })
      .click();
    await secondPage
      .getByRole("dialog", { name: "Restore appointment?" })
      .getByRole("button", { name: "Restore appointment" })
      .click();
    await expect(
      secondPage.getByText("Confirmed", { exact: true }),
    ).toBeVisible();

    await staleDialog
      .getByRole("button", { name: "Restore appointment" })
      .click();
    await expect(staleDialog.getByRole("alert")).toContainText(
      "Appointment changed. Reload and try again.",
    );
    await expect(staleDialog).toBeVisible();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await staleDialog.getByRole("button", { name: "Keep cancelled" }).click();
    await expect(staleDialog).toHaveCount(0);

    const staleBooking = await database.pool.query(
      "SELECT status, revision FROM bookings WHERE id=$1",
      [staleId],
    );
    expect(staleBooking.rows).toEqual([{ status: "confirmed", revision: 2 }]);
    expect(
      (
        await database.pool.query(
          "SELECT kind, applied_revision FROM booking_changes WHERE booking_id=$1 ORDER BY applied_revision",
          [staleId],
        )
      ).rows,
    ).toEqual([
      { kind: "cancel", applied_revision: 1 },
      { kind: "restore", applied_revision: 2 },
    ]);
  } finally {
    await secondPage.close();
  }

  const recoveryId = await createOwnerAppointment(
    owner,
    "2027-01-19T15:07:00.000Z",
  );
  await cancel(recoveryId);
  const calendarUrl = `${ownerOrigin}/?date=2027-01-19&view=day&barber=${owner.barberId}`;
  await page.goto(calendarUrl);
  await page
    .getByRole("link", { name: /Appointment: Move Journey Guest/ })
    .filter({ hasText: "10:07–10:42" })
    .click();
  const details = page.getByRole("dialog", { name: "Appointment details" });
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: "Restore appointment" }).click();
  const recoveryDialog = page.getByRole("dialog", {
    name: "Restore appointment?",
  });
  const bodies: Buffer[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return route.continue();
    bodies.push(request.postDataBuffer()!);
    if (bodies.length === 1) {
      await route.fetch();
      await route.abort();
      return;
    }
    await route.continue();
  });
  await recoveryDialog
    .getByRole("button", { name: "Restore appointment" })
    .click();
  await expect(recoveryDialog.getByRole("alert")).toContainText(
    "response was interrupted",
  );
  expect(bodies).toHaveLength(1);

  await page.keyboard.press("Escape");
  await page.goBack();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  const remounted = page.getByRole("dialog", { name: "Appointment details" });
  await expect(remounted).toBeVisible();
  const committed = await database.pool.query(
    "SELECT status, revision FROM bookings WHERE id=$1",
    [recoveryId],
  );
  expect(committed.rows).toEqual([{ status: "confirmed", revision: 2 }]);
  await page.getByRole("button", { name: "Recover pending operation" }).click();
  const retry = page
    .getByRole("dialog", { name: "Restore appointment?" })
    .getByRole("button", { name: "Retry same operation" });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(
    page.getByRole("dialog", { name: "Restore appointment?" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("dialog", { name: "Appointment details" })
      .getByText("Confirmed", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "Appointment details" })
      .getByRole("button", { name: "Restore appointment" }),
  ).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
  const restoreBodies = bodies.filter((body) =>
    body.toString().includes('"bookingId"'),
  );
  expect(restoreBodies).toHaveLength(2);
  expect(restoreBodies[1]).toEqual(restoreBodies[0]);

  const recovered = await database.pool.query(
    "SELECT status, revision, occupancy_id FROM bookings WHERE id=$1",
    [recoveryId],
  );
  expect(recovered.rows[0]).toMatchObject({
    status: "confirmed",
    revision: 2,
  });
  expect(recovered.rows[0].occupancy_id).toEqual(expect.any(String));
  expect(
    (
      await database.pool.query(
        "SELECT kind, applied_revision FROM booking_changes WHERE booking_id=$1 ORDER BY applied_revision",
        [recoveryId],
      )
    ).rows,
  ).toEqual([
    { kind: "cancel", applied_revision: 1 },
    { kind: "restore", applied_revision: 2 },
  ]);
});

test("interrupted restoration refreshes the confirmed revision before an identical recovery", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(
    owner,
    "2030-01-19T15:07:00.000Z",
  );
  const { cancelOwnerBooking } =
    await import("../../features/bookings/mutations");
  const cancelled = await cancelOwnerBooking(
    { userId: owner.id },
    {
      bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    },
  );
  expect(cancelled.success).toBe(true);

  const bodies: Buffer[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"])
      bodies.push(request.postDataBuffer()!);
  });
  const serverPayloads: string[] = [];
  page.on("response", (response) => {
    if (!response.url().includes(`/appointments/${bookingId}`)) return;
    if (
      !(response.headers()["content-type"] ?? "").includes("text/x-component")
    )
      return;
    response
      .text()
      .then((text) => serverPayloads.push(text))
      .catch(() => {});
  });

  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  const details = page.getByRole("main");
  await expect(details.getByText("Cancelled", { exact: true })).toBeVisible();
  await details.getByRole("button", { name: "Restore appointment" }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Restore appointment?",
  });
  await expect(confirmation).toBeVisible();

  let dropped = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (
      dropped ||
      request.method() !== "POST" ||
      !request.headers()["next-action"]
    )
      return route.continue();
    dropped = true;
    await route.fetch();
    await route.abort();
  });
  await confirmation
    .getByRole("button", { name: "Restore appointment" })
    .click();
  expect(bodies).toHaveLength(1);
  await expect(confirmation.getByRole("alert")).toContainText(
    "response was interrupted",
  );
  await page.unrouteAll({ behavior: "wait" });

  await confirmation.getByRole("button", { name: "Close" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect
    .poll(
      () => serverPayloads.some((payload) => payload.includes('"revision":2')),
      { timeout: 10_000 },
    )
    .toBe(true);
  expect(
    serverPayloads.some(
      (payload) =>
        payload.includes('"revision":2') &&
        payload.includes('"status":"confirmed"'),
    ),
    "the remount must render the server's confirmed revision 2",
  ).toBe(true);
  await expect(details.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(
    details.getByRole("button", { name: "Restore appointment" }),
  ).toHaveCount(0);

  const recover = page.getByRole("button", {
    name: "Recover pending operation",
  });
  await expect(recover).toBeVisible();
  await recover.click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]')),
      ),
    )
    .toBe(true);
  await expect(
    page
      .getByRole("dialog", { name: "Restore appointment?" })
      .getByRole("button", { name: "Retry same operation" }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Restore appointment?" })
    .getByRole("button", { name: "Retry same operation" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Restore appointment?" }),
  ).toHaveCount(0);
  await expect(details.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(
    details.getByRole("button", { name: "Restore appointment" }),
  ).toHaveCount(0);

  const restoreBodies = bodies.filter((body) =>
    body.toString().includes('"bookingId"'),
  );
  expect(restoreBodies).toHaveLength(2);
  expect(restoreBodies[1]).toEqual(restoreBodies[0]);

  const booking = await database.pool.query(
    "SELECT status, revision, occupancy_id FROM bookings WHERE id=$1",
    [bookingId],
  );
  expect(booking.rows[0]).toMatchObject({
    status: "confirmed",
    revision: 2,
  });
  expect(booking.rows[0].occupancy_id).toEqual(expect.any(String));
  expect(
    (
      await database.pool.query(
        "SELECT kind, applied_revision FROM booking_changes WHERE booking_id=$1 ORDER BY applied_revision",
        [bookingId],
      )
    ).rows,
  ).toEqual([
    { kind: "cancel", applied_revision: 1 },
    { kind: "restore", applied_revision: 2 },
  ]);
  expect(
    (
      await database.pool.query(
        "SELECT kind, booking_revision FROM notification_work WHERE booking_id=$1 AND booking_revision>0 ORDER BY booking_revision",
        [bookingId],
      )
    ).rows,
  ).toEqual([
    { kind: "customer_cancellation", booking_revision: 1 },
    { kind: "customer_restoration", booking_revision: 2 },
  ]);
});

test("committed restoration with a failed projection keeps one identical recovery", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  const { cancelOwnerBooking } =
    await import("../../features/bookings/mutations");
  const cancelled = await cancelOwnerBooking(
    { userId: owner.id },
    {
      bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    },
  );
  expect(cancelled.success).toBe(true);

  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore appointment" }).click();
  const dialog = page.getByRole("dialog", { name: "Restore appointment?" });
  await expect(dialog).toBeVisible();

  const bodies: Buffer[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return route.continue();
    if (!request.postData()?.includes(bookingId)) return route.continue();
    bodies.push(request.postDataBuffer()!);
    await route.continue();
  });

  const clearPoison = await poisonNextRestorationRead(database.pool, bookingId);
  try {
    await dialog.getByRole("button", { name: "Restore appointment" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Appointment could not be loaded.",
    );
    await expect(dialog.getByRole("alert")).toContainText("may have completed");
    await expect(
      dialog.getByRole("button", { name: "Retry same operation" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Restore appointment" }),
    ).toHaveCount(0);

    const committed = await database.pool.query(
      "SELECT status, revision, occupancy_id FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(committed.rows[0]).toMatchObject({
      status: "confirmed",
      revision: 2,
    });
    expect(committed.rows[0].occupancy_id).toEqual(expect.any(String));
    expect(
      (
        await database.pool.query(
          "SELECT kind, applied_revision FROM booking_changes WHERE booking_id=$1 ORDER BY applied_revision",
          [bookingId],
        )
      ).rows,
    ).toEqual([
      { kind: "cancel", applied_revision: 1 },
      { kind: "restore", applied_revision: 2 },
    ]);

    await clearPoison();
    await dialog.getByRole("button", { name: "Retry same operation" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Restore appointment" }),
    ).toHaveCount(0);

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    const recovered = await database.pool.query(
      "SELECT status, revision, occupancy_id FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(recovered.rows[0]).toMatchObject({
      status: "confirmed",
      revision: 2,
    });
    expect(recovered.rows[0].occupancy_id).toEqual(expect.any(String));
    expect(
      (
        await database.pool.query(
          "SELECT kind, applied_revision FROM booking_changes WHERE booking_id=$1 ORDER BY applied_revision",
          [bookingId],
        )
      ).rows,
    ).toEqual([
      { kind: "cancel", applied_revision: 1 },
      { kind: "restore", applied_revision: 2 },
    ]);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1 AND kind='customer_restoration'",
          [bookingId],
        )
      ).rows[0].count,
    ).toBe(1);
  } finally {
    await clearPoison();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("restoration mismatch keeps the saved request until an authoritative refresh", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  const otherBookingId = await createOwnerAppointment(
    owner,
    "2027-01-19T15:07:00.000Z",
  );
  const { cancelOwnerBooking } =
    await import("../../features/bookings/mutations");
  for (const id of [bookingId, otherBookingId]) {
    const result = await cancelOwnerBooking(
      { userId: owner.id },
      {
        bookingId: id,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
      },
    );
    expect(result.success).toBe(true);
  }

  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore appointment" }).click();
  const dialog = page.getByRole("dialog", { name: "Restore appointment?" });
  await expect(dialog).toBeVisible();

  let rewritten = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (
      rewritten ||
      request.method() !== "POST" ||
      !request.headers()["next-action"]
    )
      return route.continue();
    const body = request.postData();
    if (!body?.includes(bookingId)) return route.continue();
    rewritten = true;
    await route.fetch({ postData: body.replace(bookingId, otherBookingId) });
    await route.abort();
  });

  await dialog.getByRole("button", { name: "Restore appointment" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "response was interrupted",
  );
  expect(rewritten).toBe(true);
  await page.unrouteAll({ behavior: "wait" });
  await dialog.getByRole("button", { name: "Retry same operation" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    /cannot confirm whether that earlier attempt completed/i,
  );
  await expect(
    dialog.getByRole("button", { name: "Retry same operation" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Refresh appointment" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Keep pending operation" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Restore appointment" }),
  ).toHaveCount(0);

  const beforeRefresh = await database.pool.query(
    "SELECT id, status, revision FROM bookings WHERE id = ANY($1::uuid[]) ORDER BY id",
    [[bookingId, otherBookingId]],
  );
  expect(beforeRefresh.rows.find((row) => row.id === bookingId)).toMatchObject({
    status: "cancelled",
    revision: 1,
  });
  expect(
    beforeRefresh.rows.find((row) => row.id === otherBookingId),
  ).toMatchObject({ status: "confirmed", revision: 2 });
  expect(
    (
      await database.pool.query(
        "SELECT kind FROM booking_changes WHERE booking_id=$1",
        [bookingId],
      )
    ).rows,
  ).toEqual([{ kind: "cancel" }]);

  await dialog.getByRole("button", { name: "Keep pending operation" }).click();
  await expect(
    page.getByRole("button", { name: "Recover pending operation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Recover pending operation" }).click();
  await page.getByRole("button", { name: "Refresh appointment" }).click();
  await expect(
    page.getByRole("button", { name: "Recover pending operation" }),
  ).toHaveCount(0);
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore appointment" }),
  ).toBeVisible();
  expect(
    (
      await database.pool.query(
        "SELECT kind FROM booking_changes WHERE booking_id=$1",
        [bookingId],
      )
    ).rows,
  ).toEqual([{ kind: "cancel" }]);
});

test("stale restoration offers an authoritative refresh without a second restore", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  const { cancelOwnerBooking, restoreOwnerBooking } =
    await import("../../features/bookings/mutations");
  const cancelled = await cancelOwnerBooking(
    { userId: owner.id },
    {
      bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    },
  );
  expect(cancelled.success).toBe(true);

  await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
  await page.getByRole("button", { name: "Restore appointment" }).click();
  const dialog = page.getByRole("dialog", { name: "Restore appointment?" });
  await expect(dialog).toBeVisible();

  const concurrent = await restoreOwnerBooking(
    { userId: owner.id },
    {
      bookingId,
      expectedRevision: 1,
      operationKey: randomBytes(32).toString("base64url"),
    },
  );
  expect(concurrent.success).toBe(true);

  await dialog.getByRole("button", { name: "Restore appointment" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Appointment changed");
  await expect(
    dialog.getByRole("button", { name: "Retry same operation" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Restore appointment" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Refresh appointment" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore appointment" }),
  ).toHaveCount(0);
  expect(
    (
      await database.pool.query(
        "SELECT kind, applied_revision FROM booking_changes WHERE booking_id=$1 ORDER BY applied_revision",
        [bookingId],
      )
    ).rows,
  ).toEqual([
    { kind: "cancel", applied_revision: 1 },
    { kind: "restore", applied_revision: 2 },
  ]);
});

test("restore confirmation keeps keyboard focus, pending dismissal, narrow layout, reduced motion, and calendar history @device", async ({
  page,
  context,
  owners,
  database,
}, testInfo) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const bookingId = await createOwnerAppointment(owner);
  const { cancelOwnerBooking } =
    await import("../../features/bookings/mutations");
  const cancelled = await cancelOwnerBooking(
    { userId: owner.id },
    {
      bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    },
  );
  expect(cancelled.success).toBe(true);
  const calendarUrl = `${ownerOrigin}/?date=2027-01-19&view=day&barber=${owner.barberId}`;

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(calendarUrl);
  await page
    .getByRole("link", { name: /Appointment: Move Journey Guest/ })
    .click();
  const details = page.getByRole("dialog", { name: "Appointment details" });
  await expect(details).toBeVisible();

  const trigger = details.getByRole("button", {
    name: "Restore appointment",
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const confirmation = page.getByRole("dialog", {
    name: "Restore appointment?",
  });
  await expect(confirmation).toBeVisible();
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"]')),
    ),
  ).toBe(true);
  expect(
    await confirmation.evaluate(
      (element) => getComputedStyle(element).animationName,
    ),
  ).toBe("none");

  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(confirmation).toBeVisible();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const dialogBox = await confirmation.boundingBox();
    const closeBox = await confirmation
      .getByRole("button", { name: "Close" })
      .boundingBox();
    const title = confirmation.getByRole("heading", {
      name: "Restore appointment?",
    });
    const titleRects = await title.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return Array.from(range.getClientRects(), ({ right }) => right);
    });
    const buttons = await Promise.all(
      ["Keep cancelled", "Restore appointment"].map((name) =>
        confirmation.getByRole("button", { name }).boundingBox(),
      ),
    );
    const savedDetails = confirmation.locator("dl").first();
    expect(dialogBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect(titleRects.length).toBeGreaterThan(0);
    expect(titleRects.every((right) => right <= closeBox!.x)).toBe(true);
    expect(
      buttons.every(
        (box) => box!.x + box!.width <= dialogBox!.x + dialogBox!.width - 16,
      ),
    ).toBe(true);
    expect(
      await savedDetails.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect(
      await confirmation.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`restore-confirmation-${width}.png`),
    });
  }

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const actionRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return route.continue();
    actionRequests.push(request.url());
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await confirmation
    .getByRole("button", { name: "Restore appointment" })
    .dispatchEvent("click");
  await expect(
    confirmation.getByRole("button", { name: "Restoring…" }),
  ).toBeDisabled();
  await expect(
    confirmation.getByRole("button", { name: "Keep cancelled" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(confirmation).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.activeElement === document.body ||
        Boolean(document.activeElement?.closest('[role="dialog"]')),
    ),
  ).toBe(true);

  release();
  await expect(confirmation).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
  expect(actionRequests).toHaveLength(1);
  await expect(details.getByText("Confirmed", { exact: true })).toBeVisible();

  await details
    .getByRole("button", { name: "Close appointment details" })
    .click();
  await expect(page).toHaveURL(calendarUrl);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/appointments/${bookingId}`));
  await page.goBack();
  await expect(page).toHaveURL(calendarUrl);
  await expect(
    page.getByRole("link", { name: /Appointment: Move Journey Guest/ }),
  ).toContainText("Confirmed");

  const booking = await database.pool.query(
    "SELECT status, revision FROM bookings WHERE id=$1",
    [bookingId],
  );
  expect(booking.rows).toEqual([{ status: "confirmed", revision: 2 }]);
});
