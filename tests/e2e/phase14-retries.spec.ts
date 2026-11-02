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

const endpoint = `${ownerOrigin}/api/jobs/notifications/retry`;
const jobSecret = process.env.NOTIFICATION_JOB_SECRET;

test.describe.configure({ mode: "serial" });

test("Activity shows ordered retry evidence once, stays owner-scoped, and remains usable on mobile", async ({
  page,
  context,
  browser,
  database,
}) => {
  const helpers = (await database.auth.$context).test;
  const suffix = randomUUID();
  const user = await helpers.saveUser(
    helpers.createUser({
      email: `phase14-activity-${suffix}@example.test`,
      name: "Fictional Phase 14 Owner",
    }),
  );
  const budgetDay = "2099-12-31";
  let budgetCreated = false;
  let otherUserId: string | null = null;
  try {
    const login = await helpers.login({ userId: user.id });
    await context.addCookies(login.cookies);
    const owner: Owner = {
      id: user.id,
      subdomain: `phase14-${suffix}`,
      shopId: randomUUID(),
      cookie: login.headers.get("cookie")!,
    };
    await database.pool.query(
      `INSERT INTO shops (id, owner_id, name, subdomain, time_zone, public_contact, address)
     VALUES ($1, $2, 'Phase 14 Activity Shop', $3, 'UTC', 'Call 202-555-0100', '1 Example Street')`,
      [owner.shopId, owner.id, owner.subdomain],
    );
    const appointment = await seedOwnerAppointment(database.pool, owner);
    Object.assign(owner, appointment);
    const workId = randomUUID();
    const now = new Date(process.env.TRIMTIME_E2E_NOW!);
    const budget = await database.pool.query(
      "INSERT INTO outbound_budget (day, allocation_count) VALUES ($1, 2) ON CONFLICT DO NOTHING RETURNING day",
      [budgetDay],
    );
    if (budget.rowCount !== 1)
      throw new Error(
        "The Phase 14 Activity budget fixture day is not available.",
      );
    budgetCreated = true;
    await database.pool.query(
      `INSERT INTO notification_work
     (id, booking_id, booking_revision, kind, channel, status, recipient, content_identity, created_at, updated_at)
     VALUES ($1, $2, 0, 'customer_confirmation', 'email', 'accepted', 'history@example.test', $3, $4, $4)`,
      [workId, owner.appointmentId, "a".repeat(64), now],
    );
    await database.pool.query(
      `INSERT INTO notification_attempts
     (id, work_id, budget_day, attempt_number, reserved_at, invoked_at, outcome, reason, finished_at)
     VALUES
       ($1, $3, $4, 1, $5::timestamptz - INTERVAL '11 minutes', $5::timestamptz - INTERVAL '10 minutes', 'failed', 'transient_rejection', $5::timestamptz - INTERVAL '9 minutes'),
       ($2, $3, $4, 2, $5::timestamptz - INTERVAL '1 minute', $5::timestamptz - INTERVAL '59 seconds', 'accepted', NULL, NULL)`,
      [randomUUID(), randomUUID(), workId, budgetDay, now],
    );

    await page.goto(`${ownerOrigin}/activity`);
    const workRow = page.locator("article").filter({ hasText: workId });
    await expect(workRow).toHaveCount(1);
    await expect(
      page.getByText("Confirmed transport invocations").locator(".."),
    ).toContainText("2");

    const otherContext = await browser.newContext();
    try {
      const otherUser = await helpers.saveUser(
        helpers.createUser({
          email: `phase14-other-${suffix}@example.test`,
          name: "Other Phase 14 Owner",
        }),
      );
      otherUserId = otherUser.id;
      const otherLogin = await helpers.login({ userId: otherUser.id });
      await otherContext.addCookies(otherLogin.cookies);
      await database.pool.query(
        `INSERT INTO shops (id, owner_id, name, subdomain, time_zone, public_contact, address)
         VALUES ($1, $2, 'Other Phase 14 Shop', $3, 'UTC', 'Call 202-555-0100', '2 Example Street')`,
        [randomUUID(), otherUser.id, `other-${suffix}`],
      );
      const otherPage = await otherContext.newPage();
      await otherPage.goto(`${ownerOrigin}/activity`);
      await expect(otherPage.getByText(workId)).toHaveCount(0);
      await expect(
        otherPage.getByText("No notification records yet for this shop."),
      ).toBeVisible();
    } finally {
      await otherContext.close();
      await database.pool.query("DELETE FROM shops WHERE owner_id=$1", [
        otherUserId,
      ]);
      if (otherUserId) await helpers.deleteUser(otherUserId);
    }

    await page.reload();
    await expect(
      page.locator("article").filter({ hasText: workId }),
    ).toHaveCount(1);
    const trigger = workRow.getByRole("button", { name: "Event details" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Message details" });
    await expect(dialog).toContainText("Attempt history");
    await expect(dialog).toContainText("Attempt 1 · failed");
    await expect(dialog).toContainText("Attempt 2 · accepted");
    await expect(dialog.locator("[data-attempt-label]")).toHaveText([
      /^Attempt 1 · failed/,
      /^Attempt 2 · accepted/,
    ]);

    await page.setViewportSize({ width: 320, height: 800 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
    const history = dialog.locator("[data-attempt-history]");
    await expect(history).toBeVisible();
    await expect(history).toHaveAttribute("tabindex", "0");
    await history.focus();
    await page.keyboard.press("ArrowDown");
    await expect(history).toBeFocused();
    expect(
      await history.evaluate(
        (element) => getComputedStyle(element).outlineStyle,
      ),
    ).not.toBe("none");
    await expect
      .poll(() => history.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  } finally {
    await database.pool.query("DELETE FROM shops WHERE owner_id=$1", [user.id]);
    await helpers.deleteUser(user.id);
    if (budgetCreated)
      await database.pool.query(
        "DELETE FROM outbound_budget WHERE day=$1 AND allocation_count=2 AND NOT EXISTS (SELECT 1 FROM notification_attempts WHERE budget_day=$1)",
        [budgetDay],
      );
  }
});

type RetryFixture = {
  userId: string;
  shopId: string;
  bookingId: string;
  workId: string;
  budgetDay: string;
  budgetCreated: boolean;
  budgetBaselineAllocations: number;
};

async function seedRetryFixture(
  pool: import("pg").Pool,
): Promise<RetryFixture> {
  const now = new Date(process.env.TRIMTIME_E2E_NOW!);
  const budgetDay = now.toISOString().slice(0, 10);
  const suffix = randomUUID();
  const fixture: RetryFixture = {
    userId: `phase14-${suffix}`,
    shopId: `phase14-${suffix}`,
    bookingId: randomUUID(),
    workId: randomUUID(),
    budgetDay,
    budgetCreated: false,
    budgetBaselineAllocations: 0,
  };
  const serviceId = `phase14-service-${suffix}`;
  const barberId = `phase14-barber-${suffix}`;
  const recipient = `success-phase14-${suffix}@example.test`;
  const startAt = new Date(now.getTime() + 60 * 60_000);
  const endAt = new Date(startAt.getTime() + 35 * 60_000);
  const booking = {
    id: fixture.bookingId,
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
  const capabilityToken = randomUUID();
  const capabilityIv = randomBytes(12);
  const capabilityCipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.BOOKING_CAPABILITY_ENCRYPTION_KEY!, "base64"),
    capabilityIv,
  );
  capabilityCipher.setAAD(
    Buffer.from(`${fixture.shopId}:${fixture.bookingId}`),
  );
  const capabilityEncrypted = Buffer.concat([
    capabilityCipher.update(capabilityToken, "utf8"),
    capabilityCipher.final(),
  ]);
  const capabilityCiphertext = Buffer.concat([
    capabilityIv,
    capabilityCipher.getAuthTag(),
    capabilityEncrypted,
  ]).toString("base64url");
  const capabilityHash = createHash("sha256")
    .update(capabilityToken)
    .digest("hex");
  const contentIdentity = createHash("sha256")
    .update(
      JSON.stringify({
        ...booking,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      }),
    )
    .digest("hex");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const insertedDay = await client.query(
      "INSERT INTO outbound_budget (day,allocation_count) VALUES ($1,0) ON CONFLICT DO NOTHING RETURNING day",
      [budgetDay],
    );
    fixture.budgetCreated = insertedDay.rowCount === 1;
    const budget = await client.query(
      "SELECT allocation_count FROM outbound_budget WHERE day=$1 FOR UPDATE",
      [budgetDay],
    );
    const existingAllocations = budget.rows[0].allocation_count;
    fixture.budgetBaselineAllocations = existingAllocations;
    if (existingAllocations > 98) {
      throw new Error(
        `Phase 14 E2E budget day ${budgetDay} has ${existingAllocations} existing allocations; two fixture slots are required and shared budget data was left unchanged.`,
      );
    }
    await client.query(
      "UPDATE outbound_budget SET allocation_count=allocation_count+1 WHERE day=$1",
      [budgetDay],
    );
    await client.query(
      `INSERT INTO "user" (id,name,email,email_verified)
       VALUES ($1,'Fictional Phase 14 Owner',$2,true)`,
      [fixture.userId, `${fixture.userId}@example.test`],
    );
    await client.query(
      `INSERT INTO shops (id,owner_id,name,subdomain,time_zone,public_contact,address)
       VALUES ($1,$2,'Fictional Phase 14 Shop',$3,'UTC','+1 202-555-0100','1 Example Street')`,
      [fixture.shopId, fixture.userId, `p14-${suffix.slice(0, 20)}`],
    );
    await client.query(
      `INSERT INTO services (id,shop_id,name,price_usd,duration_minutes)
       VALUES ($1,$2,'Fictional Cut',25,35)`,
      [serviceId, fixture.shopId],
    );
    await client.query(
      "INSERT INTO barbers (id,shop_id,name) VALUES ($1,$2,'Fictional Barber')",
      [barberId, fixture.shopId],
    );
    await client.query(
      `INSERT INTO bookings
       (id,shop_id,service_id,barber_id,status,start_at,end_at,service_name,service_price_usd,
        service_duration_minutes,barber_name,customer_name,customer_email,whatsapp_opt_in,
        capability_hash,capability_ciphertext,capability_key_id,recovery_key_hash,recovery_payload_digest)
       VALUES ($1,$2,$3,$4,'confirmed',$5,$6,$7,$8,$9,$10,$11,$12,false,$13,$14,'e2e-v1',$15,$16)`,
      [
        fixture.bookingId,
        fixture.shopId,
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
    await client.query(
      `INSERT INTO notification_work
       (id,booking_id,booking_revision,kind,channel,status,recipient,content_identity,reason,created_at,next_attempt_at)
       VALUES ($1,$2,0,'customer_confirmation','email','failed',$3,$4,'transient_rejection','2000-01-01Z','2000-01-01Z')`,
      [fixture.workId, fixture.bookingId, recipient, contentIdentity],
    );
    await client.query(
      `INSERT INTO notification_attempts
       (id,work_id,budget_day,attempt_number,invoked_at,outcome,reason,finished_at)
       VALUES ($1,$2,$3,1,$4,'failed','transient_rejection',$4)`,
      [randomUUID(), fixture.workId, budgetDay, now],
    );
    await client.query("COMMIT");
    return fixture;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function retryState(pool: import("pg").Pool, fixture: RetryFixture) {
  const { rows } = await pool.query(
    `SELECT row_to_json(w) AS work,
       coalesce((SELECT json_agg(row_to_json(a) ORDER BY a.attempt_number)
         FROM notification_attempts a WHERE a.work_id=w.id),'[]'::json) AS attempts,
       (SELECT allocation_count FROM outbound_budget WHERE day=$2) AS allocations
     FROM notification_work w WHERE w.id=$1`,
    [fixture.workId, fixture.budgetDay],
  );
  return rows[0];
}

async function cleanupRetryFixture(
  pool: import("pg").Pool,
  fixture: RetryFixture,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT day FROM outbound_budget WHERE day=$1 FOR UPDATE",
      [fixture.budgetDay],
    );
    const ownedAttempts = await client.query(
      "SELECT count(*)::int AS count FROM notification_attempts WHERE work_id=$1",
      [fixture.workId],
    );
    await client.query('DELETE FROM "user" WHERE id=$1', [fixture.userId]);
    const decremented = await client.query(
      `UPDATE outbound_budget
       SET allocation_count=allocation_count-$2
       WHERE day=$1 AND allocation_count >= $2
       RETURNING allocation_count`,
      [fixture.budgetDay, ownedAttempts.rows[0].count],
    );
    if (decremented.rowCount !== 1)
      throw new Error("Could not release Phase 14 fixture-owned allocations.");
    if (
      decremented.rows[0].allocation_count < fixture.budgetBaselineAllocations
    )
      throw new Error("Phase 14 cleanup would reduce preexisting budget.");
    if (fixture.budgetCreated) {
      await client.query(
        `DELETE FROM outbound_budget b WHERE b.day=$1 AND b.allocation_count=0
         AND NOT EXISTS (SELECT 1 FROM notification_attempts a WHERE a.budget_day=b.day)`,
        [fixture.budgetDay],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test("invalid HTTP requests leave the same eligible candidate unchanged", async ({
  request,
  database,
}) => {
  const fixture = await seedRetryFixture(database.pool);
  try {
    const before = await retryState(database.pool, fixture);
    const missing = await request.post(endpoint);
    const wrong = await request.post(endpoint, {
      headers: { "x-trimtime-job-secret": "incorrect-test-credential" },
    });
    const headers = { "x-trimtime-job-secret": jobSecret! };
    const wrongHost = await request.post(
      `${marketingOrigin}/api/jobs/notifications/retry`,
      { headers },
    );
    const get = await request.get(endpoint, { headers });
    const head = await request.head(endpoint, { headers });
    const query = await request.post(`${endpoint}?limit=1`, { headers });
    const body = await request.post(endpoint, { headers, data: {} });
    const after = await retryState(database.pool, fixture);

    expect([missing.status(), wrong.status()]).toEqual([401, 401]);
    expect([wrongHost.status(), get.status(), head.status()]).toEqual([
      404, 405, 405,
    ]);
    expect([query.status(), body.status()]).toEqual([400, 400]);
    expect(after).toEqual(before);
  } finally {
    await cleanupRetryFixture(database.pool, fixture);
  }
});

test("authorized HTTP processing returns aggregate counts only", async ({
  request,
  database,
}) => {
  const fixture = await seedRetryFixture(database.pool);
  try {
    const before = await retryState(database.pool, fixture);
    const response = await request.post(endpoint, {
      headers: { "x-trimtime-job-secret": jobSecret! },
    });
    const body = await response.json();
    const after = await retryState(database.pool, fixture);

    expect(response.status()).toBe(200);
    expect(Object.keys(body).sort()).toEqual([
      "attempted",
      "processed",
      "reconciled",
      "recoveredUnknown",
      "suppressed",
    ]);
    expect(Object.values(body).every(Number.isInteger)).toBe(true);
    expect(body.processed).toBeGreaterThan(0);
    expect(body.processed).toBeLessThanOrEqual(5);
    expect(after.work.id).toBe(fixture.workId);
    expect(after.attempts[0]).toEqual(before.attempts[0]);
    if (process.env.TRIMTIME_E2E_EMAIL_MODE === "mailpit-double") {
      expect(body.attempted).toBe(1);
      expect(after.work.status).toBe("captured");
      expect(after.attempts).toHaveLength(2);
      expect(after.attempts[1].attempt_number).toBe(2);
      expect(after.attempts[1].outcome).toBe("captured");
      expect(after.allocations).toBe(before.allocations + 1);
    } else {
      expect(body.attempted).toBe(0);
      expect(after.work.status).toBe("unavailable");
      expect(after.work.reason).toBe("disabled");
      expect(after.attempts).toEqual(before.attempts);
      expect(after.allocations).toBe(before.allocations);
    }
    expect(response.headers()["cache-control"]).toBe("no-store");
  } finally {
    await cleanupRetryFixture(database.pool, fixture);
  }
});
