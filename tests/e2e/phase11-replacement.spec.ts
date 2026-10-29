import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { expect, test } from "./fixtures";
import { addReadyCatalog } from "./publication-fixtures";
import type { Owner } from "./fixtures";

const SHOP_SUFFIX = "localhost:3100";
const ELIGIBLE_START = "2026-11-01T00:00:00Z";
const ELIGIBLE_LOCAL_DATE = "2026-10-31";

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

async function createEligibleBooking(
  page: import("@playwright/test").Page,
  owner: Owner,
  serviceId: string,
  barberId: string,
  startAt = ELIGIBLE_START,
) {
  await page.goto(`http://${owner.subdomain}.${SHOP_SUFFIX}/`);
  await page.locator(`input[name="serviceId"][value="${serviceId}"]`).check();
  await page.getByRole("button", { name: "Choose your barber" }).click();
  await page.locator(`input[name="barberId"][value="${barberId}"]`).check();
  await page.getByRole("button", { name: "Choose date and time" }).click();
  await page.getByLabel("Date", { exact: true }).fill(ELIGIBLE_LOCAL_DATE);
  const start = page.locator(`input[name="startAt"][value="${startAt}"]`);
  await expect(start).toHaveCount(1);
  await start.check();
  await page.getByRole("button", { name: "Your details", exact: true }).click();
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill(`ada-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  const link = page.getByRole("link", { name: "Open booking details" });
  await expect(link).toBeVisible();
  return new URL((await link.getAttribute("href"))!, page.url());
}

async function snapshot(pool: Pool, bookingId: string, token: string) {
  const booking = await pool.query(
    "SELECT shop_id, status, revision, start_at, end_at, occupancy_id FROM bookings WHERE id=$1",
    [bookingId],
  );
  const keyHash = createHash("sha256")
    .update(`${booking.rows[0]?.shop_id ?? ""}:${token}`)
    .digest("hex");
  const events = await pool.query(
    "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1",
    [bookingId],
  );
  const work = await pool.query(
    "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1",
    [bookingId],
  );
  const attempts = await pool.query(
    "SELECT count(*)::int AS count FROM public_rate_events WHERE scope='customer_change_link' AND key_hash=$1",
    [keyHash],
  );
  return {
    booking: booking.rows,
    events: events.rows[0].count,
    work: work.rows[0].count,
    attempts: attempts.rows[0].count,
  };
}

test("Case 1: open, edit, back, discard, and reload never mutates and actual choices replace samples", async ({
  page,
  context,
  owners,
  database,
  request,
}) => {
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);
  const manageUrl = await createEligibleBooking(
    page,
    owner,
    serviceId,
    barberId,
  );
  const token = manageUrl.pathname.split("/").at(-1)!;
  const { rows } = await database.pool.query(
    "SELECT id, shop_id FROM bookings WHERE shop_id=$1",
    [owner.shopId],
  );
  expect(rows).toHaveLength(1);
  const bookingId = rows[0].id as string;
  const shopId = rows[0].shop_id as string;
  const rateKey = createHash("sha256")
    .update(`${shopId}:${token}`)
    .digest("hex");

  try {
    const before = await snapshot(database.pool, bookingId, token);

    // Initial GET/HEAD never mutates
    expect((await request.get(manageUrl.toString())).status()).toBe(200);
    expect((await request.head(manageUrl.toString())).status()).toBe(200);

    await page.goto(manageUrl.toString());
    const storageBefore = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));

    await expect(
      page.getByRole("button", { name: "Open change preview" }),
    ).toBeVisible();

    const writes: string[] = [];
    page.on("request", (req) => {
      if (!["GET", "HEAD"].includes(req.method())) {
        // Next.js server actions are POST
        writes.push(`${req.method()}:${req.url()}`);
      }
    });

    // Open change preview
    await page.getByRole("button", { name: "Open change preview" }).click();
    await expect(
      page.getByRole("heading", { name: "A fresh time. Your call." }),
    ).toBeVisible();

    // Verify actual choices replace samples
    await expect(page.getByText("Classic cut")).toHaveCount(0);
    await expect(page.getByText("Amal")).toHaveCount(0);
    await expect(
      page.getByText("Sample options demonstrate the future screen"),
    ).toHaveCount(0);
    await expect(
      page.getByText("Preview only · choices stay in this browser view"),
    ).toHaveCount(0);

    // Actual catalog service "Cut" and barber "Sam" must be available
    await expect(page.getByRole("radio", { name: /Cut/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Sam/ })).toBeVisible();

    // Select date and start time
    await page.getByLabel("Choose a date").fill(ELIGIBLE_LOCAL_DATE);
    const slotRadio = page.getByRole("radio", { name: "09:00" });
    await expect(slotRadio).toHaveCount(1);
    await slotRadio.check({ force: true });
    await expect(slotRadio).toBeChecked();

    // Proceed to review
    await page.getByRole("button", { name: "Review change" }).click();
    await expect(
      page.getByRole("heading", { name: "A quick look before we change it." }),
    ).toBeVisible();

    // Review must show actual choices, not sample values
    await expect(page.getByText("Sample preview values")).toHaveCount(0);
    await expect(page.getByText("Sample only · pay at the shop")).toHaveCount(
      0,
    );

    // Back to choices
    await page.getByRole("button", { name: "Back to choices" }).click();
    await expect(
      page.getByRole("heading", { name: "A fresh time. Your call." }),
    ).toBeVisible();

    // Discard preview choices
    await page.getByRole("button", { name: "Back to your booking" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Discard preview choices" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Open change preview" }),
    ).toBeVisible();

    // Reload page
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Open change preview" }),
    ).toBeVisible();

    // Verify storage has no capability or payload
    const storageAfter = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));
    expect(storageAfter).toEqual(storageBefore);

    // Verify no mutation occurred
    const after = await snapshot(database.pool, bookingId, token);
    expect(after).toEqual(before);
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("Case 2: review displays saved same-service and current different-service values and final explicit confirmation alone commits", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);

  // Add a second service to the catalog (duration >= 30 min)
  const secondServiceId = randomUUID();
  await database.pool.query(
    "INSERT INTO services (id, shop_id, name, price_usd, duration_minutes) VALUES ($1, $2, 'Beard', 40, 45)",
    [secondServiceId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO barber_services (shop_id, barber_id, service_id) VALUES ($1, $2, $3)",
    [owner.shopId, barberId, secondServiceId],
  );

  await openAllWeek(database.pool, owner, barberId);

  // Create booking with original Cut ($35 / 35 minutes)
  const manageUrl = await createEligibleBooking(
    page,
    owner,
    serviceId,
    barberId,
  );
  const token = manageUrl.pathname.split("/").at(-1)!;
  const { rows } = await database.pool.query(
    "SELECT id, shop_id FROM bookings WHERE shop_id=$1",
    [owner.shopId],
  );
  const bookingId = rows[0].id as string;
  const rateKey = createHash("sha256")
    .update(`${rows[0].shop_id}:${token}`)
    .digest("hex");

  // Modify the catalog for Cut: rename to "Luxury Cut", price $60, 50 minutes
  await database.pool.query(
    "UPDATE services SET name='Luxury Cut', price_usd=60, duration_minutes=50 WHERE id=$1",
    [serviceId],
  );

  try {
    await page.goto(manageUrl.toString());
    await page.getByRole("button", { name: "Open change preview" }).click();

    // 1. Same-service option must display saved snapshot values: "Cut", 35 minutes, $35.00
    const cutOption = page.locator("label").filter({ hasText: "Cut" });
    await expect(cutOption).toContainText("35 minutes");
    await expect(cutOption).toContainText("$35.00");
    await expect(page.getByText("Luxury Cut")).toHaveCount(0);

    // 2. Different-service option must display current values: "Beard", 45 minutes, $40.00
    const beardOption = page.locator("label").filter({ hasText: "Beard" });
    await expect(beardOption).toContainText("45 minutes");
    await expect(beardOption).toContainText("$40.00");

    // Select Beard service
    await beardOption.getByRole("radio").check();

    // Select date and start time (> 12 hours out)
    await page.getByLabel("Choose a date").fill("2026-11-02");
    const slotRadio = page.getByRole("radio", { name: "10:00" });
    await expect(slotRadio).toHaveCount(1);
    await slotRadio.check({ force: true });

    // Click "Review change"
    await page.getByRole("button", { name: "Review change" }).click();
    await expect(
      page.getByRole("heading", { name: "A quick look before we change it." }),
    ).toBeVisible();

    // Review displays:
    // "Currently booked": Cut, 35 minutes, $35.00
    const currentlyBooked = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Currently booked" }),
      })
      .last();
    await expect(currentlyBooked).toContainText("Cut");
    await expect(currentlyBooked).toContainText("35 minutes");
    await expect(currentlyBooked).toContainText("$35.00");

    // "Your new appointment": Beard, 45 minutes, $40.00
    const newAppointment = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Your new appointment" }),
      })
      .last();
    await expect(newAppointment).toContainText("Beard");
    await expect(newAppointment).toContainText("45 minutes");
    await expect(newAppointment).toContainText("$40.00");

    // Reaching review does NOT mutate the booking
    const beforeConfirm = await database.pool.query(
      "SELECT revision, status, service_name FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(beforeConfirm.rows[0]).toEqual({
      revision: 0,
      status: "confirmed",
      service_name: "Cut",
    });

    // Final explicit confirmation alone commits
    await page
      .getByRole("button", { name: "Confirm appointment change" })
      .click();

    // Verify UI updates
    await expect(
      page.getByText("Appointment updated. Your new time is reserved."),
    ).toBeAttached();
    await expect(
      page.getByRole("button", { name: "Open change preview" }),
    ).toBeVisible();
    await expect(page.getByText("Beard", { exact: true })).toBeVisible();

    // Verify DB was mutated accurately
    const afterConfirm = await database.pool.query(
      "SELECT revision, status, service_name, service_price_usd, service_duration_minutes FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(afterConfirm.rows[0]).toEqual({
      revision: 1,
      status: "confirmed",
      service_name: "Beard",
      service_price_usd: "40.00",
      service_duration_minutes: 45,
    });

    const changes = await database.pool.query(
      "SELECT kind, actor_type, applied_revision FROM booking_changes WHERE booking_id=$1",
      [bookingId],
    );
    expect(changes.rows).toHaveLength(1);
    expect(changes.rows[0]).toEqual({
      kind: "move",
      actor_type: "customer",
      applied_revision: 1,
    });

    const work = await database.pool.query(
      "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1 AND booking_revision=1",
      [bookingId],
    );
    expect(work.rows[0].count).toBeGreaterThanOrEqual(1);
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("Case 3: two-hour replacement displays cutoff notice before confirmation and cutoff guidance on reopen", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);

  // Initial booking is at ELIGIBLE_START (2026-11-01T00:00:00Z = 8:00 PM EDT, 12 hours from 12:00:00Z)
  const manageUrl = await createEligibleBooking(
    page,
    owner,
    serviceId,
    barberId,
  );
  const token = manageUrl.pathname.split("/").at(-1)!;
  const { rows } = await database.pool.query(
    "SELECT id, shop_id FROM bookings WHERE shop_id=$1",
    [owner.shopId],
  );
  const bookingId = rows[0].id as string;
  const rateKey = createHash("sha256")
    .update(`${rows[0].shop_id}:${token}`)
    .digest("hex");

  try {
    await page.goto(manageUrl.toString());
    await page.getByRole("button", { name: "Open change preview" }).click();

    // Select date 2026-10-31 and time 10:00 AM EDT (14:00:00Z, which is +2 hours from NOW=12:00:00Z)
    await page.getByLabel("Choose a date").fill(ELIGIBLE_LOCAL_DATE);
    const twoHourSlot = page.getByRole("radio", { name: "10:00" });
    await expect(twoHourSlot).toHaveCount(1);
    await twoHourSlot.check({ force: true });

    // Proceed to review
    await page.getByRole("button", { name: "Review change" }).click();
    await expect(
      page.getByRole("heading", { name: "A quick look before we change it." }),
    ).toBeVisible();

    // Verify cutoff notice is displayed on the review screen
    const cutoffNotice = page.getByText(
      "This appointment will be within 12 hours. Further online changes or cancellation will be unavailable; contact the shop.",
    );
    await expect(cutoffNotice).toBeVisible();

    // Explicitly confirm the replacement
    await page
      .getByRole("button", { name: "Confirm appointment change" })
      .click();
    await expect(
      page.getByText("Appointment updated. Your new time is reserved."),
    ).toBeAttached();

    // Reopen same manage link and verify cutoff guidance
    await page.goto(manageUrl.toString());

    // Cutoff guidance: buttons to change or cancel must be absent
    await expect(
      page.getByRole("button", { name: "Cancel appointment" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Open change preview" }),
    ).toHaveCount(0);

    // Guidance text referencing 12 hours and contact info must be visible
    await expect(
      page.getByText(
        "Online changes are not available within 12 hours of your start. Contact Call 202-555-0142.",
      ),
    ).toBeVisible();

    const dbBooking = await database.pool.query(
      "SELECT revision, status, start_at FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(dbBooking.rows[0].status).toBe("confirmed");
    expect(dbBooking.rows[0].revision).toBe(1);
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("Case 4: conflict preserves service, barber, date, refreshes starts and never claims success", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);

  const manageUrl = await createEligibleBooking(
    page,
    owner,
    serviceId,
    barberId,
  );
  const token = manageUrl.pathname.split("/").at(-1)!;
  const { rows } = await database.pool.query(
    "SELECT id, shop_id, start_at FROM bookings WHERE shop_id=$1",
    [owner.shopId],
  );
  const bookingId = rows[0].id as string;
  const originalStartAt = rows[0].start_at as Date;
  const rateKey = createHash("sha256")
    .update(`${rows[0].shop_id}:${token}`)
    .digest("hex");

  try {
    await page.goto(manageUrl.toString());
    await page.getByRole("button", { name: "Open change preview" }).click();

    // Select date 2026-11-02 and 10:00 (14:00:00Z)
    await page.getByLabel("Choose a date").fill("2026-11-02");
    const slotRadio = page.getByRole("radio", { name: "10:00" });
    await expect(slotRadio).toHaveCount(1);
    await slotRadio.check({ force: true });

    // Advance to review
    await page.getByRole("button", { name: "Review change" }).click();
    await expect(
      page.getByRole("heading", { name: "A quick look before we change it." }),
    ).toBeVisible();

    // Concurrently create an occupying booking/interval for 10:00 AM EST (15:00:00Z to 15:35:00Z)
    const conflictOccupancyId = randomUUID();
    await database.pool.query(
      `INSERT INTO occupied_intervals (id, shop_id, barber_id, start_at, end_at)
       VALUES ($1, $2, $3, '2026-11-02T15:00:00Z', '2026-11-02T15:35:00Z')`,
      [conflictOccupancyId, owner.shopId, barberId],
    );

    // Click confirm - conflict occurs!
    await page
      .getByRole("button", { name: "Confirm appointment change" })
      .click();

    // Verify error is shown and never claims success
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "The selected time is no longer available." }),
    ).toBeVisible();
    await expect(
      page.getByText("Appointment updated. Your new time is reserved."),
    ).toHaveCount(0);

    // Screen is returned to edit choices
    await expect(
      page.getByRole("heading", { name: "A fresh time. Your call." }),
    ).toBeVisible();

    // Service, barber, and date are preserved!
    await expect(page.getByRole("radio", { name: /Cut/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: /Sam/ })).toBeChecked();
    await expect(page.getByLabel("Choose a date")).toHaveValue("2026-11-02");

    // The conflicted 10:00 slot is no longer available
    await expect(page.getByRole("radio", { name: "10:00" })).toHaveCount(0);

    // Original booking in DB is completely intact
    const midBooking = await database.pool.query(
      "SELECT revision, status, start_at FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(midBooking.rows[0].status).toBe("confirmed");
    expect(midBooking.rows[0].revision).toBe(0);
    expect(new Date(midBooking.rows[0].start_at).getTime()).toBe(
      originalStartAt.getTime(),
    );

    // Pick an alternative available slot, e.g. 11:00
    const altSlot = page.getByRole("radio", { name: "11:00" });
    await expect(altSlot).toHaveCount(1);
    await altSlot.check({ force: true });

    // Review and confirm again
    await page.getByRole("button", { name: "Review change" }).click();
    await expect(
      page.getByRole("heading", { name: "A quick look before we change it." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Confirm appointment change" })
      .click();

    // Now success is confirmed
    await expect(
      page.getByText("Appointment updated. Your new time is reserved."),
    ).toBeAttached();
    await expect(
      page.getByRole("button", { name: "Open change preview" }),
    ).toBeVisible();

    const finalBooking = await database.pool.query(
      "SELECT revision, status, start_at FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(finalBooking.rows[0].status).toBe("confirmed");
    expect(finalBooking.rows[0].revision).toBe(1);
    expect(new Date(finalBooking.rows[0].start_at).toISOString()).toBe(
      "2026-11-02T16:00:00.000Z",
    );
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("Case 5: stale offer requires refreshed review and stale booking requires reload", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);

  // Add Beard service
  const beardId = randomUUID();
  await database.pool.query(
    "INSERT INTO services (id, shop_id, name, price_usd, duration_minutes) VALUES ($1, $2, 'Beard', 40, 45)",
    [beardId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO barber_services (shop_id, barber_id, service_id) VALUES ($1, $2, $3)",
    [owner.shopId, barberId, beardId],
  );

  await openAllWeek(database.pool, owner, barberId);

  const manageUrl = await createEligibleBooking(
    page,
    owner,
    serviceId,
    barberId,
  );
  const token = manageUrl.pathname.split("/").at(-1)!;
  const { rows } = await database.pool.query(
    "SELECT id, shop_id FROM bookings WHERE shop_id=$1",
    [owner.shopId],
  );
  const bookingId = rows[0].id as string;
  const rateKey = createHash("sha256")
    .update(`${rows[0].shop_id}:${token}`)
    .digest("hex");

  try {
    // --- Part A: Stale Offer ---
    await page.goto(manageUrl.toString());
    await page.getByRole("button", { name: "Open change preview" }).click();

    // Select Beard service ($40.00)
    const beardOption = page.locator("label").filter({ hasText: "Beard" });
    await beardOption.getByRole("radio").check();

    // Select date and slot
    await page.getByLabel("Choose a date").fill("2026-11-02");
    const slotRadio = page.getByRole("radio", { name: "10:00" });
    await expect(slotRadio).toHaveCount(1);
    await slotRadio.check({ force: true });

    // Advance to review
    await page.getByRole("button", { name: "Review change" }).click();
    await expect(
      page.getByRole("heading", { name: "A quick look before we change it." }),
    ).toBeVisible();

    // In background, owner changes Beard price from $40 to $45 in the catalog
    await database.pool.query("UPDATE services SET price_usd=45 WHERE id=$1", [
      beardId,
    ]);

    // Customer confirms without knowing offer changed -> fails STALE_OFFER
    await page
      .getByRole("button", { name: "Confirm appointment change" })
      .click();

    // Verify STALE_OFFER alert is displayed
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Service details have changed." }),
    ).toBeVisible();

    // Screen is returned to edit mode
    await expect(
      page.getByRole("heading", { name: "A fresh time. Your call." }),
    ).toBeVisible();

    // Choices are refreshed: Beard now shows $45.00
    const refreshedBeard = page.locator("label").filter({ hasText: "Beard" });
    await expect(refreshedBeard).toContainText("$45.00");

    // Booking in DB is intact
    const intactBooking = await database.pool.query(
      "SELECT revision, status FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(intactBooking.rows[0]).toEqual({ revision: 0, status: "confirmed" });

    // Review the updated offer explicitly
    await page.getByLabel("Choose a date").fill("2026-11-02");
    const newSlotRadio = page.getByRole("radio", { name: "10:00" });
    await expect(newSlotRadio).toHaveCount(1);
    await newSlotRadio.check({ force: true });

    await page.getByRole("button", { name: "Review change" }).click();
    await expect(
      page.getByRole("heading", { name: "A quick look before we change it." }),
    ).toBeVisible();

    const newAppointmentSection = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Your new appointment" }),
      })
      .last();
    await expect(newAppointmentSection).toContainText("$45.00");

    // --- Part B: Stale Booking ---
    // While review is open, owner modifies the booking in the background (revision 0 -> 1)
    await database.pool.query("UPDATE bookings SET revision=1 WHERE id=$1", [
      bookingId,
    ]);

    // Customer confirms with stale expectedRevision 0 -> fails STALE_BOOKING
    await page
      .getByRole("button", { name: "Confirm appointment change" })
      .click();

    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Appointment changed. Reload and try again." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reload booking details" }),
    ).toBeVisible();

    // Click "Reload booking details" reloads the page
    await page.getByRole("button", { name: "Reload booking details" }).click();
    await expect(
      page.getByRole("button", { name: "Open change preview" }),
    ).toBeVisible();
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("Case 6: late slot response cannot replace newer service, barber, or date selection", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);

  const manageUrl = await createEligibleBooking(
    page,
    owner,
    serviceId,
    barberId,
  );
  const token = manageUrl.pathname.split("/").at(-1)!;
  const { rows } = await database.pool.query(
    "SELECT id, shop_id FROM bookings WHERE shop_id=$1",
    [owner.shopId],
  );
  const rateKey = createHash("sha256")
    .update(`${rows[0].shop_id}:${token}`)
    .digest("hex");

  try {
    await page.goto(manageUrl.toString());
    await page.getByRole("button", { name: "Open change preview" }).click();

    // Wait for initial slots to be visible
    await expect(page.getByRole("radio", { name: "10:00" })).toBeVisible();

    // Intercept 2026-11-03 action request and delay it by 300ms so subsequent selections occur while 2026-11-03 is pending
    await page.route("**/*", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && Boolean(req.headers()["next-action"])) {
        const postData = req.postData() ?? "";
        if (postData.includes("2026-11-03")) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      await route.continue();
    });

    // Selecting an empty date while a slots request is in flight:
    await page.getByLabel("Choose a date").fill("2026-11-03");
    // Immediately clear date while 2026-11-03 request is in flight
    await page.getByLabel("Choose a date").fill("");

    // Verify slots are cleared synchronously and empty date prompt is visible
    await expect(
      page.getByText("Choose a date to view available times."),
    ).toBeVisible();
    await expect(page.locator('input[name="replacement-start"]')).toHaveCount(
      0,
    );

    // Wait 350ms for delayed 2026-11-03 response to arrive
    await page.waitForTimeout(350);

    // Verify delayed response did NOT repopulate slots after input was cleared
    await expect(
      page.getByText("Choose a date to view available times."),
    ).toBeVisible();
    await expect(page.locator('input[name="replacement-start"]')).toHaveCount(
      0,
    );

    // Now test selecting a newer date before older response finishes:
    await page.getByLabel("Choose a date").fill("2026-11-03");
    // Immediately select date 2026-11-04 before request finishes
    await page.getByLabel("Choose a date").fill("2026-11-04");

    // Wait for 2026-11-04 slots to appear and select 10:00
    const slotRadio = page.getByRole("radio", { name: "10:00" });
    await expect(slotRadio).toHaveCount(1);
    await slotRadio.check({ force: true });

    // Verify 2026-11-04 selection remains intact and is not overwritten by the older request
    await expect(page.getByLabel("Choose a date")).toHaveValue("2026-11-04");
    await expect(page.getByRole("radio", { name: "10:00" })).toBeChecked();

    // Advance to review
    await page.getByRole("button", { name: "Review change" }).click();
    await expect(
      page.getByRole("heading", { name: "A quick look before we change it." }),
    ).toBeVisible();

    const newAppointmentSection = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Your new appointment" }),
      })
      .last();
    // Review must reflect Wednesday, November 4
    await expect(newAppointmentSection).toContainText("Wednesday, November 4");
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("Case 7: lost committed response retries identical key/payload, editing requires reconciliation first, and storage remains clean", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);

  const manageUrl = await createEligibleBooking(
    page,
    owner,
    serviceId,
    barberId,
  );
  const token = manageUrl.pathname.split("/").at(-1)!;
  const { rows } = await database.pool.query(
    "SELECT id, shop_id FROM bookings WHERE shop_id=$1",
    [owner.shopId],
  );
  const bookingId = rows[0].id as string;
  const rateKey = createHash("sha256")
    .update(`${rows[0].shop_id}:${token}`)
    .digest("hex");

  try {
    await page.goto(manageUrl.toString());
    await page.getByRole("button", { name: "Open change preview" }).click();

    // Select date and slot
    await page.getByLabel("Choose a date").fill("2026-11-02");
    const slotRadio = page.getByRole("radio", { name: "10:00" });
    await expect(slotRadio).toHaveCount(1);
    await slotRadio.check({ force: true });

    // Review change
    await page.getByRole("button", { name: "Review change" }).click();
    await expect(
      page.getByRole("heading", { name: "A quick look before we change it." }),
    ).toBeVisible();

    // Intercept replacement action to abort first response after server execution
    const bodies: Buffer[] = [];
    await page.route("**/*", async (route) => {
      const actionRequest = route.request();
      if (
        actionRequest.method() === "POST" &&
        Boolean(actionRequest.headers()["next-action"])
      ) {
        const postData = actionRequest.postData() ?? "";
        // Match the replace action payload which contains confirmed: true
        if (postData.includes('"confirmed":true')) {
          bodies.push(actionRequest.postDataBuffer()!);
          if (bodies.length === 1) {
            const response = await route.fetch();
            expect(response.status()).toBeLessThan(500);
            await route.abort();
            return;
          }
        }
      }
      await route.continue();
    });

    // Confirm change (first attempt aborted after server commits)
    await page
      .getByRole("button", { name: "Confirm appointment change" })
      .click();

    // Verify unknown response warning
    await expect(
      page.getByRole("alert").filter({
        hasText:
          "The change result is unknown. Retry or reload your booking details.",
      }),
    ).toBeVisible();

    // Editing requires reconciliation first: "Back to choices" must not be available
    await expect(
      page.getByRole("button", { name: "Back to choices" }),
    ).not.toBeVisible();

    // Retry and reload buttons are available
    await expect(
      page.getByRole("button", { name: "Retry change" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reload booking details" }),
    ).toBeVisible();

    // Verify no capability or payload in localStorage or sessionStorage
    const storageCount = await page.evaluate(
      () => localStorage.length + sessionStorage.length,
    );
    expect(storageCount).toBe(0);

    // Click "Retry change"
    await page.getByRole("button", { name: "Retry change" }).click();

    // Verify success receipt
    await expect(
      page.getByText("Appointment updated. Your new time is reserved."),
    ).toBeAttached();

    // Verify two submissions were captured with identical payloads
    expect(bodies.length).toBe(2);
    expect(bodies[0].toString()).toBe(bodies[1].toString());

    // Verify booking in DB is updated to confirmed revision 1
    const updated = await database.pool.query(
      "SELECT revision, status, start_at FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(updated.rows[0].status).toBe("confirmed");
    expect(updated.rows[0].revision).toBe(1);
    expect(new Date(updated.rows[0].start_at).toISOString()).toBe(
      "2026-11-02T15:00:00.000Z",
    );
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("Case 9: pending state prevents duplicate submission/dismissal; errors and focus remain accessible", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);

  const manageUrl = await createEligibleBooking(
    page,
    owner,
    serviceId,
    barberId,
  );
  const token = manageUrl.pathname.split("/").at(-1)!;
  const { rows } = await database.pool.query(
    "SELECT id, shop_id FROM bookings WHERE shop_id=$1",
    [owner.shopId],
  );
  const bookingId = rows[0].id as string;
  const rateKey = createHash("sha256")
    .update(`${rows[0].shop_id}:${token}`)
    .digest("hex");

  try {
    await page.goto(manageUrl.toString());
    await page.getByRole("button", { name: "Open change preview" }).click();

    // Verify initial heading has focus for screen reader navigation
    await expect(
      page.getByRole("heading", { name: "A fresh time. Your call." }),
    ).toBeFocused();

    // Select date and slot
    await page.getByLabel("Choose a date").fill("2026-11-02");
    const slotRadio = page.getByRole("radio", { name: "10:00" });
    await expect(slotRadio).toHaveCount(1);
    await slotRadio.check({ force: true });

    // Review change
    await page.getByRole("button", { name: "Review change" }).click();

    // Verify review heading has focus
    await expect(
      page.getByRole("heading", { name: "A quick look before we change it." }),
    ).toBeFocused();

    // Intercept action to hold it in pending state
    let releaseAction!: () => void;
    const holdActionPromise = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });

    let submitCount = 0;
    await page.route("**/*", async (route) => {
      const actionRequest = route.request();
      if (
        actionRequest.method() === "POST" &&
        Boolean(actionRequest.headers()["next-action"])
      ) {
        const postData = actionRequest.postData() ?? "";
        if (postData.includes('"confirmed":true')) {
          submitCount++;
          const response = await route.fetch();
          await holdActionPromise;
          await route.fulfill({ response });
          return;
        }
      }
      await route.continue();
    });

    // Click confirm to begin submission
    const confirmButton = page.getByRole("button", {
      name: "Confirm appointment change",
    });
    await confirmButton.click();

    // In pending state:
    // 1. Status indicator is visible and accessible
    const statusMsg = page
      .getByRole("status")
      .filter({ hasText: "Updating appointment…" });
    await expect(statusMsg).toBeVisible();
    await expect(statusMsg).toHaveAttribute("aria-live", "polite");

    // 2. Confirm and dismiss buttons are disabled
    await expect(confirmButton).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Back to your booking" }),
    ).toBeDisabled();

    // 3. Attempting another click while pending does not submit another request
    await confirmButton.click({ force: true }).catch(() => {});
    expect(submitCount).toBe(1);

    // Release the action
    releaseAction();

    // Success screen arrives
    await expect(
      page.getByText("Appointment updated. Your new time is reserved."),
    ).toBeAttached();

    const updated = await database.pool.query(
      "SELECT revision, status FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(updated.rows[0].status).toBe("confirmed");
    expect(updated.rows[0].revision).toBe(1);
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("Case 10: renders offsets for ambiguous repeated local times in slot choices and review, agreeing on preview and commit", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await database.pool.query(
    "UPDATE services SET duration_minutes=30 WHERE id=$1",
    [serviceId],
  );
  await openAllWeek(database.pool, owner, barberId);

  const manageUrl = await createEligibleBooking(
    page,
    owner,
    serviceId,
    barberId,
  );
  const token = manageUrl.pathname.split("/").at(-1)!;
  const { rows } = await database.pool.query(
    "SELECT id, shop_id FROM bookings WHERE shop_id=$1",
    [owner.shopId],
  );
  const bookingId = rows[0].id as string;
  const rateKey = createHash("sha256")
    .update(`${rows[0].shop_id}:${token}`)
    .digest("hex");

  try {
    await page.goto(manageUrl.toString());
    await page.getByRole("button", { name: "Open change preview" }).click();

    // Fill date for DST fall-back Sunday 2026-11-01
    await page.getByLabel("Choose a date").fill("2026-11-01");

    // Both ambiguous repeated instants for 01:30 must be rendered with their UTC offsets
    const slotEdt = page.getByRole("radio", { name: "01:30 · UTC-04:00" });
    const slotEst = page.getByRole("radio", { name: "01:30 · UTC-05:00" });
    await expect(slotEdt).toHaveCount(1);
    await expect(slotEst).toHaveCount(1);

    // Select the first fold instant (EDT / UTC-04:00)
    await slotEdt.check({ force: true });
    await expect(slotEdt).toBeChecked();

    // Advance to review
    await page.getByRole("button", { name: "Review change" }).click();
    await expect(
      page.getByRole("heading", { name: "A quick look before we change it." }),
    ).toBeVisible();

    // Review displays date, range, and UTC-04:00 offset to distinguish the instant
    const newAppointmentSection = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Your new appointment" }),
      })
      .last();
    await expect(newAppointmentSection).toContainText("Sunday, November 1");
    await expect(newAppointmentSection).toContainText("UTC-04:00");

    // Explicitly confirm appointment change
    await page
      .getByRole("button", { name: "Confirm appointment change" })
      .click();

    await expect(
      page.getByText("Appointment updated. Your new time is reserved."),
    ).toBeAttached();

    // Verify DB committed the exact UTC instant for EDT (05:30:00Z)
    const committed = await database.pool.query(
      "SELECT revision, status, start_at FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(committed.rows[0].status).toBe("confirmed");
    expect(committed.rows[0].revision).toBe(1);
    expect(new Date(committed.rows[0].start_at).toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("Case 11: cutoff disclosure uses authoritative server time and cannot misleadingly omit required notice under client clock skew", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);

  const manageUrl = await createEligibleBooking(
    page,
    owner,
    serviceId,
    barberId,
  );
  const token = manageUrl.pathname.split("/").at(-1)!;
  const { rows } = await database.pool.query(
    "SELECT id, shop_id FROM bookings WHERE shop_id=$1",
    [owner.shopId],
  );
  const rateKey = createHash("sha256")
    .update(`${rows[0].shop_id}:${token}`)
    .digest("hex");

  try {
    await page.goto(manageUrl.toString());
    await page.getByRole("button", { name: "Open change preview" }).click();

    // Simulate client clock skew where browser Date.now() is 4 hours in the past
    // Server fixed time is 2026-10-31T12:00:00Z.
    // Client Date.now() will report 2026-10-31T08:00:00Z.
    await page.evaluate(() => {
      const skewMs = 4 * 60 * 60_000;
      const originalNow = Date.now.bind(Date);
      Date.now = () => originalNow() - skewMs;
    });

    // Select date 2026-10-31 and time 17:00 (5:00 PM EDT = 21:00:00Z)
    // Relative to authoritative server time (12:00:00Z), 21:00:00Z is +9 hours (within 12 hours!).
    // Relative to skewed client clock (08:00:00Z), 21:00:00Z is +13 hours (would be outside 12 hours if using Date.now()!).
    await page.getByLabel("Choose a date").fill(ELIGIBLE_LOCAL_DATE);
    const slotRadio = page.getByRole("radio", { name: "17:00" });
    await expect(slotRadio).toHaveCount(1);
    await slotRadio.check({ force: true });

    // Advance to review
    await page.getByRole("button", { name: "Review change" }).click();
    await expect(
      page.getByRole("heading", { name: "A quick look before we change it." }),
    ).toBeVisible();

    // The cutoff notice MUST be visible because authoritative server time indicates < 12 hours,
    // ensuring client clock skew cannot misleadingly omit the notice!
    const cutoffNotice = page.getByText(
      "This appointment will be within 12 hours. Further online changes or cancellation will be unavailable; contact the shop.",
    );
    await expect(cutoffNotice).toBeVisible();
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("Case 12: cutoff disclosure is dynamically updated across boundary while review is open, and accounts for network delay", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);

  const manageUrl = await createEligibleBooking(
    page,
    owner,
    serviceId,
    barberId,
  );
  const token = manageUrl.pathname.split("/").at(-1)!;
  const { rows } = await database.pool.query(
    "SELECT id, shop_id FROM bookings WHERE shop_id=$1",
    [owner.shopId],
  );
  const rateKey = createHash("sha256")
    .update(`${rows[0].shop_id}:${token}`)
    .digest("hex");

  try {
    await page.goto(manageUrl.toString());
    await page.getByRole("button", { name: "Open change preview" }).click();

    // Select date 2026-10-31 and time 21:00 (9:00 PM EDT = 2026-11-01T01:00:00Z)
    // Relative to authoritative server time (12:00:00Z), 01:00:00Z is +13 hours (outside 12 hours!).
    await page.getByLabel("Choose a date").fill(ELIGIBLE_LOCAL_DATE);
    const slotRadio = page.getByRole("radio", { name: "21:00" });
    await expect(slotRadio).toHaveCount(1);
    await slotRadio.check({ force: true });

    // Advance to review
    await page.getByRole("button", { name: "Review change" }).click();
    await expect(
      page.getByRole("heading", { name: "A quick look before we change it." }),
    ).toBeVisible();

    const cutoffNotice = page.getByText(
      "This appointment will be within 12 hours. Further online changes or cancellation will be unavailable; contact the shop.",
    );
    // At +13 hours, cutoff notice is initially absent
    await expect(cutoffNotice).toHaveCount(0);

    // Simulate crossing the 12-hour boundary while review is left open:
    // Advance monotonic and clock time by 1 hour + 5 seconds (now within 12 hours!)
    await page.evaluate(() => {
      const advanceMs = 60 * 60_000 + 5_000;
      const originalPerfNow = performance.now.bind(performance);
      performance.now = () => originalPerfNow() + advanceMs;
      const originalNow = Date.now.bind(Date);
      Date.now = () => originalNow() + advanceMs;
    });

    // The ticker on review screen fires every second and re-evaluates cutoff dynamically.
    // Notice must now become visible dynamically without reloading or re-opening review!
    await expect(cutoffNotice).toBeVisible();
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});
