import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  expect,
  test,
  ownerOrigin,
  marketingOrigin,
  type Owner,
} from "./fixtures";
import { seedOwnerAppointment } from "./owner-booking-fixtures";

test.describe.configure({ mode: "serial" });

test("Activity presents reminder timing and outcomes without changing confirmation status", async ({
  page,
  context,
  browser,
  database,
}) => {
  const helpers = (await database.auth.$context).test;
  const suffix = randomUUID();
  const user = await helpers.saveUser(
    helpers.createUser({
      email: `phase15-activity-${suffix}@example.test`,
      name: "Fictional Phase 15 Owner",
    }),
  );
  let otherUserId: string | null = null;
  const budgetDay = "2099-12-31";
  let budgetCreated = false;
  try {
    const login = await helpers.login({ userId: user.id });
    await context.addCookies(login.cookies);
    const owner: Owner = {
      id: user.id,
      subdomain: `phase15-${suffix}`,
      shopId: randomUUID(),
      cookie: login.headers.get("cookie")!,
    };
    await database.pool.query(
      `INSERT INTO shops (id, owner_id, name, subdomain, time_zone, public_contact, address)
       VALUES ($1, $2, 'Phase 15 Activity Shop', $3, 'America/New_York', 'Call 202-555-0100', '1 Example Street')`,
      [owner.shopId, owner.id, owner.subdomain],
    );
    const now = new Date(process.env.TRIMTIME_E2E_NOW!);
    const startAt = new Date("2026-11-04T12:00:00.000Z");
    const dueAt = new Date("2026-11-03T12:00:00.000Z");
    const appointmentIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const appointment = await seedOwnerAppointment(database.pool, owner);
      appointmentIds.push(appointment.appointmentId);
      await database.pool.query(
        "UPDATE bookings SET start_at=$2,end_at=$3,customer_email=$4 WHERE id=$1 AND shop_id=$5",
        [
          appointment.appointmentId,
          startAt,
          new Date(startAt.getTime() + 35 * 60_000),
          `guest-${suffix}@example.test`,
          owner.shopId,
        ],
      );
      if (index === 0) Object.assign(owner, appointment);
    }

    const workIds = {
      scheduled: randomUUID(),
      captured: randomUUID(),
      suppressed: randomUUID(),
      confirmation: randomUUID(),
    };
    const budget = await database.pool.query(
      "INSERT INTO outbound_budget (day, allocation_count) VALUES ($1, 1) ON CONFLICT DO NOTHING RETURNING day",
      [budgetDay],
    );
    if (budget.rowCount !== 1)
      throw new Error(
        "The Phase 15 Activity budget fixture day is unavailable.",
      );
    budgetCreated = true;
    for (const [index, id, status] of [
      [0, workIds.scheduled, "not_attempted"],
      [1, workIds.captured, "captured"],
      [2, workIds.suppressed, "suppressed"],
    ] as const) {
      await database.pool.query(
        `INSERT INTO notification_work
         (id, booking_id, booking_revision, kind, channel, status, recipient, content_identity, due_at, created_at, updated_at)
         VALUES ($1,$2,0,'customer_reminder','email',$3,$4,$5,$6,$7,$7)`,
        [
          id,
          appointmentIds[index],
          status,
          `guest-${suffix}@example.test`,
          "a".repeat(64),
          dueAt,
          now,
        ],
      );
    }
    await database.pool.query(
      `INSERT INTO notification_work
       (id, booking_id, booking_revision, kind, channel, status, recipient, content_identity, created_at, updated_at)
       VALUES ($1,$2,0,'customer_confirmation','email','captured',$3,$4,$5,$5)`,
      [
        workIds.confirmation,
        appointmentIds[0],
        `guest-${suffix}@example.test`,
        "b".repeat(64),
        now,
      ],
    );
    await database.pool.query(
      `INSERT INTO notification_attempts
       (id,work_id,budget_day,attempt_number,reserved_at,invoked_at,outcome,capture_id,finished_at)
       VALUES ($1,$2,$3,1,$4,$4,'captured',$5,$4)`,
      [randomUUID(), workIds.captured, budgetDay, now, `capture-${suffix}`],
    );

    await page.goto(`${ownerOrigin}/activity`);
    const scheduled = page
      .locator("article")
      .filter({ hasText: workIds.scheduled });
    await expect(scheduled).toContainText("Customer reminder");
    await expect(scheduled).toContainText("Scheduled reminder");
    await expect(scheduled).toContainText("Due Nov 3, 2026, 7:00 AM");
    await expect(
      page.locator("article").filter({ hasText: workIds.captured }),
    ).toContainText("Captured locally · inbox delivery is not enabled");
    await expect(
      page.locator("article").filter({ hasText: workIds.suppressed }),
    ).toContainText("suppressed");

    const otherContext = await browser.newContext();
    try {
      const otherUser = await helpers.saveUser(
        helpers.createUser({
          email: `phase15-other-${suffix}@example.test`,
          name: "Other Owner",
        }),
      );
      otherUserId = otherUser.id;
      const otherLogin = await helpers.login({ userId: otherUser.id });
      await otherContext.addCookies(otherLogin.cookies);
      await database.pool.query(
        `INSERT INTO shops (id, owner_id, name, subdomain, time_zone, public_contact, address)
         VALUES ($1, $2, 'Other Shop', $3, 'UTC', 'Call 202-555-0100', '2 Example Street')`,
        [randomUUID(), otherUser.id, `other-${suffix}`],
      );
      const otherPage = await otherContext.newPage();
      await otherPage.goto(`${ownerOrigin}/activity`);
      await expect(otherPage.getByText(workIds.scheduled)).toHaveCount(0);
    } finally {
      await otherContext.close();
      if (otherUserId) {
        await database.pool.query("DELETE FROM shops WHERE owner_id=$1", [
          otherUserId,
        ]);
        await helpers.deleteUser(otherUserId);
      }
    }

    const trigger = scheduled.getByRole("button", { name: "Event details" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Message details" });
    await expect(dialog).toContainText("Reminder due");
    await expect(dialog).toContainText("Nov 3, 2026, 7:00 AM");
    const history = dialog.locator("[data-attempt-history]");
    await history.focus();
    await expect(history).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.setViewportSize({ width: 320, height: 800 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
    await page.goto(`${ownerOrigin}/appointments/${owner.appointmentId}`);
    await expect(
      page.getByRole("heading", { name: "Customer email status" }),
    ).toBeVisible();
    await expect(
      page.getByText("Captured locally; inbox delivery is not enabled."),
    ).toBeVisible();
  } finally {
    await database.pool.query("DELETE FROM shops WHERE owner_id=$1", [user.id]);
    await helpers.deleteUser(user.id);
    if (budgetCreated)
      await database.pool.query(
        "DELETE FROM outbound_budget WHERE day=$1 AND allocation_count=1 AND NOT EXISTS (SELECT 1 FROM notification_attempts WHERE budget_day=$1)",
        [budgetDay],
      );
  }
});

test("protected reminder HTTP processing rejects guarded requests and processes authorized due work", async ({
  request,
  database,
}) => {
  const helpers = (await database.auth.$context).test;
  const suffix = randomUUID();
  const user = await helpers.saveUser(
    helpers.createUser({
      email: `phase15-http-${suffix}@example.test`,
      name: "Fictional Phase 15 HTTP Owner",
    }),
  );
  const budgetDay = new Date(process.env.TRIMTIME_E2E_NOW!)
    .toISOString()
    .slice(0, 10);
  const bookingId = randomUUID();
  const workId = randomUUID();
  const shopId = randomUUID();
  let budgetCreated = false;
  try {
    const appointment = await database.pool.query(
      `INSERT INTO shops (id, owner_id, name, subdomain, time_zone, public_contact, address)
       VALUES ($1, $2, 'Phase 15 HTTP Shop', $3, 'UTC', 'Call 202-555-0100', '1 Example Street')
       RETURNING id`,
      [shopId, user.id, `phase15-http-${suffix}`],
    );
    expect(appointment.rowCount).toBe(1);
    const barberId = `phase15-http-barber-${suffix}`;
    const serviceId = `phase15-http-service-${suffix}`;
    const now = new Date(process.env.TRIMTIME_E2E_NOW!);
    const startAt = new Date(now.getTime() + 60 * 60_000);
    const endAt = new Date(startAt.getTime() + 35 * 60_000);
    const recipient = `guest-${suffix}@example.test`;
    const booking = {
      id: bookingId,
      startAt,
      endAt,
      serviceName: "Fictional Cut",
      servicePriceUsd: "25.00",
      serviceDurationMinutes: 35,
      barberName: "Fictional Barber",
      customerName: "Fictional Guest",
      customerEmail: recipient,
      customerPhone: null,
    };
    const contentIdentity = createHash("sha256")
      .update(
        JSON.stringify({
          id: bookingId,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          serviceName: booking.serviceName,
          servicePriceUsd: booking.servicePriceUsd,
          serviceDurationMinutes: booking.serviceDurationMinutes,
          barberName: booking.barberName,
          customerName: booking.customerName,
          customerEmail: booking.customerEmail,
          customerPhone: booking.customerPhone,
        }),
      )
      .digest("hex");
    const capabilityToken = randomUUID();
    const capabilityIv = randomBytes(12);
    const capabilityCipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(process.env.BOOKING_CAPABILITY_ENCRYPTION_KEY!, "base64"),
      capabilityIv,
    );
    capabilityCipher.setAAD(Buffer.from(`${shopId}:${bookingId}`));
    const encryptedCapability = Buffer.concat([
      capabilityCipher.update(capabilityToken, "utf8"),
      capabilityCipher.final(),
    ]);
    const capabilityCiphertext = Buffer.concat([
      capabilityIv,
      capabilityCipher.getAuthTag(),
      encryptedCapability,
    ]).toString("base64url");
    const capabilityHash = createHash("sha256")
      .update(capabilityToken)
      .digest("hex");
    await database.pool.query(
      `INSERT INTO barbers (id,shop_id,name) VALUES ($1,$2,'Fictional Barber')`,
      [barberId, shopId],
    );
    await database.pool.query(
      `INSERT INTO services (id,shop_id,name,price_usd,duration_minutes) VALUES ($1,$2,'Fictional Cut',25,35)`,
      [serviceId, shopId],
    );
    await database.pool.query(
      `INSERT INTO bookings
       (id,shop_id,service_id,barber_id,status,start_at,end_at,service_name,service_price_usd,
        service_duration_minutes,barber_name,customer_name,customer_email,whatsapp_opt_in,
        capability_hash,capability_ciphertext,capability_key_id,recovery_key_hash,recovery_payload_digest)
       VALUES ($1,$2,$3,$4,'confirmed',$5,$6,$7,$8,$9,$10,$11,$12,false,$13,$14,'e2e-v1',$15,$16)`,
      [
        bookingId,
        shopId,
        serviceId,
        barberId,
        startAt,
        endAt,
        booking.serviceName,
        booking.servicePriceUsd,
        booking.serviceDurationMinutes,
        booking.barberName,
        booking.customerName,
        recipient,
        capabilityHash,
        capabilityCiphertext,
        `recovery-${suffix}`,
        `digest-${suffix}`,
      ],
    );
    const insertedBudget = await database.pool.query(
      "INSERT INTO outbound_budget (day,allocation_count) VALUES ($1,0) ON CONFLICT DO NOTHING RETURNING day",
      [budgetDay],
    );
    budgetCreated = insertedBudget.rowCount === 1;
    await database.pool.query(
      `INSERT INTO notification_work
       (id,booking_id,booking_revision,kind,channel,status,recipient,content_identity,due_at,created_at,updated_at)
       VALUES ($1,$2,0,'customer_reminder','email','not_attempted',$3,$4,$5,$6,$6)`,
      [
        workId,
        bookingId,
        recipient,
        contentIdentity,
        new Date(now.getTime() - 60_000),
        now,
      ],
    );

    const state = async () => {
      const result = await database.pool.query(
        `SELECT w.status, w.reason,
           (SELECT count(*)::int FROM notification_attempts a WHERE a.work_id=w.id) AS attempts,
           (SELECT allocation_count FROM outbound_budget WHERE day=$2) AS allocations
         FROM notification_work w WHERE w.id=$1`,
        [workId, budgetDay],
      );
      return result.rows[0];
    };
    const before = await state();
    const missing = await request.post(
      `${ownerOrigin}/api/jobs/notifications/retry`,
    );
    const afterMissing = await state();
    const invalid = await request.post(
      `${ownerOrigin}/api/jobs/notifications/retry`,
      {
        headers: { "x-trimtime-job-secret": "invalid-test-secret" },
      },
    );
    const afterInvalid = await state();
    const configuredSecret = process.env.NOTIFICATION_JOB_SECRET!;
    const wrongHost = await request.post(
      `${marketingOrigin}/api/jobs/notifications/retry`,
      {
        headers: { "x-trimtime-job-secret": configuredSecret },
      },
    );
    const afterWrongHost = await state();
    expect([missing.status(), invalid.status(), wrongHost.status()]).toEqual([
      401, 401, 404,
    ]);
    expect(afterMissing).toEqual(before);
    expect(afterInvalid).toEqual(before);
    expect(afterWrongHost).toEqual(before);

    const authorized = await request.post(
      `${ownerOrigin}/api/jobs/notifications/retry`,
      {
        headers: { "x-trimtime-job-secret": configuredSecret },
      },
    );
    const summary = await authorized.json();
    const afterAuthorized = await state();
    expect(authorized.status()).toBe(200);
    expect(afterAuthorized.status).toBe(
      process.env.TRIMTIME_E2E_EMAIL_MODE === "mailpit-double"
        ? "captured"
        : "unavailable",
    );
    if (process.env.TRIMTIME_E2E_EMAIL_MODE === "mailpit-double") {
      expect(summary.attempted).toBe(1);
      expect(afterAuthorized.attempts).toBe(before.attempts + 1);
      expect(afterAuthorized.allocations).toBe((before.allocations ?? 0) + 1);
    } else {
      expect(summary.attempted).toBe(0);
      expect(afterAuthorized.reason).toBe("disabled");
      expect(afterAuthorized.attempts).toBe(before.attempts);
      expect(afterAuthorized.allocations).toBe(before.allocations);
    }
  } finally {
    const owned = await database.pool.query(
      "SELECT count(*)::int AS attempts FROM notification_attempts WHERE work_id=$1",
      [workId],
    );
    const allocated = owned.rows[0].attempts;
    await database.pool.query("DELETE FROM shops WHERE owner_id=$1", [user.id]);
    if (allocated > 0)
      await database.pool.query(
        "UPDATE outbound_budget SET allocation_count=allocation_count-$2 WHERE day=$1 AND allocation_count >= $2",
        [budgetDay, allocated],
      );
    if (budgetCreated)
      await database.pool.query(
        "DELETE FROM outbound_budget b WHERE b.day=$1 AND b.allocation_count=0 AND NOT EXISTS (SELECT 1 FROM notification_attempts a WHERE a.budget_day=b.day)",
        [budgetDay],
      );
    await helpers.deleteUser(user.id);
  }
});
