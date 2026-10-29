import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { Pool } from "pg";
import { expect, ownerOrigin, test } from "./fixtures";
import { addReadyCatalog } from "./publication-fixtures";
import type { Owner } from "./fixtures";

const SHOP_SUFFIX = "localhost:3100";
const ELIGIBLE_START = "2026-11-01T00:00:00Z";
const ELIGIBLE_LOCAL_DATE = "2026-10-31";
const mailpitCompose = [
  "compose",
  "--project-name",
  "trimtime-dev",
  "--profile",
  "email",
  "-f",
  "compose.dev.yml",
];

function setMailpit(action: "stop" | "up") {
  execFileSync(
    "docker",
    [
      ...mailpitCompose,
      action,
      ...(action === "up" ? ["--detach"] : []),
      "mailpit",
    ],
    { stdio: "inherit" },
  );
}

type MailpitMessage = {
  ID?: string;
  To?: Array<{ Address?: string }>;
  Subject?: string;
  Text?: string;
};

async function fetchMessage(origin: string, captureId: string) {
  const response = await fetch(
    `${origin}/api/v1/message/${encodeURIComponent(captureId)}`,
  );
  expect(response.ok).toBe(true);
  return (await response.json()) as MailpitMessage;
}

async function fetchHeaders(origin: string, captureId: string) {
  const response = await fetch(
    `${origin}/api/v1/message/${encodeURIComponent(captureId)}/headers`,
  );
  expect(response.ok).toBe(true);
  return (await response.json()) as Record<string, string[]>;
}

function attemptHeader(headers: Record<string, string[]>) {
  return Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "x-trimtime-attempt-id",
  )?.[1];
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

async function createEligibleBooking(
  page: import("@playwright/test").Page,
  owner: Owner,
  serviceId: string,
  barberId: string,
  email: string,
) {
  await page.goto(`http://${owner.subdomain}.${SHOP_SUFFIX}/`);
  await page.locator(`input[name="serviceId"][value="${serviceId}"]`).check();
  await page.getByRole("button", { name: "Choose your barber" }).click();
  await page.locator(`input[name="barberId"][value="${barberId}"]`).check();
  await page.getByRole("button", { name: "Choose date and time" }).click();
  await page.getByLabel("Date", { exact: true }).fill(ELIGIBLE_LOCAL_DATE);
  const start = page.locator(
    `input[name="startAt"][value="${ELIGIBLE_START}"]`,
  );
  await expect(start).toHaveCount(1);
  await start.check();
  await page.getByRole("button", { name: "Your details", exact: true }).click();
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  const link = page.getByRole("link", { name: "Open booking details" });
  await expect(link).toBeVisible();
  return new URL((await link.getAttribute("href"))!, page.url());
}

async function waitForInitialDispatch(
  pool: Pool,
  bookingId: string,
  expected: number,
) {
  await expect
    .poll(async () => {
      const { rows } = await pool.query(
        "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1 AND booking_revision=0 AND channel='email' AND status IN ('not_attempted','sending')",
        [bookingId],
      );
      return rows[0].count;
    })
    .toBe(0);
  const { rows } = await pool.query(
    "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1 AND booking_revision=0 AND channel='email'",
    [bookingId],
  );
  expect(rows[0].count).toBe(expected);
}

async function ownerEmail(pool: Pool, ownerId: string) {
  const { rows } = await pool.query('SELECT email FROM "user" WHERE id=$1', [
    ownerId,
  ]);
  return rows[0].email as string;
}

test("customer cancellation captures a customer update and an owner alert with customer attribution", async ({
  page,
  context,
  owners,
  database,
}) => {
  test.skip(
    process.env.TRIMTIME_E2E_EMAIL_MODE !== "mailpit-double",
    "requires the isolated Mailpit HTTP double",
  );
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);
  const recipient = `cancel-${randomUUID()}@example.test`;
  const manageUrl = await createEligibleBooking(
    page,
    owner,
    serviceId,
    barberId,
    recipient,
  );

  const { rows: bookings } = await database.pool.query(
    "SELECT id, shop_id FROM bookings WHERE shop_id=$1",
    [owner.shopId],
  );
  expect(bookings).toHaveLength(1);
  const bookingId = bookings[0].id as string;
  const token = manageUrl.pathname.split("/").at(-1)!;

  await waitForInitialDispatch(database.pool, bookingId, 2);

  await page.goto(manageUrl.toString());
  await page.getByRole("button", { name: "Cancel appointment" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Yes, cancel appointment" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(async () => {
      const { rows } = await database.pool.query(
        "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1 AND booking_revision=1 AND channel='email' AND status IN ('not_attempted','sending')",
        [bookingId],
      );
      return rows[0].count;
    })
    .toBe(0);

  const { rows: work } = await database.pool.query(
    `SELECT w.kind,w.status,w.recipient,a.outcome,a.capture_id,a.id AS attempt_id
     FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
     WHERE w.booking_id=$1 AND w.booking_revision=1 AND w.channel='email'
     ORDER BY w.kind`,
    [bookingId],
  );
  expect(work).toEqual([
    expect.objectContaining({
      kind: "customer_cancellation",
      status: "captured",
      outcome: "captured",
      recipient,
    }),
    expect.objectContaining({
      kind: "owner_cancellation",
      status: "captured",
      outcome: "captured",
    }),
  ]);
  expect(work[1].recipient).toBe(await ownerEmail(database.pool, owner.id));

  const mailpitOrigin = "http://127.0.0.1:8027";
  for (const row of work) {
    const captured = await fetchMessage(mailpitOrigin, row.capture_id);
    expect(captured.To?.[0]?.Address?.toLowerCase()).toBe(
      row.recipient.toLowerCase(),
    );
    const headers = await fetchHeaders(mailpitOrigin, row.capture_id);
    expect(attemptHeader(headers)).toEqual([row.attempt_id]);
  }

  await page.goto(`${ownerOrigin}/activity`);
  await expect(
    page.getByRole("heading", { name: "Booking activity & message status" }),
  ).toBeVisible();
  const change = page
    .locator("article")
    .filter({ hasText: "Appointment cancelled" });
  await expect(change).toHaveCount(1);
  await expect(change).toContainText("Customer-initiated");
  await expect(change).toContainText("Cut");
  await expect(change).toContainText("Sam");
  const customerMessage = page
    .locator("article")
    .filter({ hasText: "Cancellation update" });
  await expect(customerMessage).toHaveCount(1);
  await expect(customerMessage).toContainText(recipient);
  await expect(customerMessage).toContainText("Captured locally");
  const ownerMessage = page
    .locator("article")
    .filter({ hasText: "Owner cancellation alert" });
  await expect(ownerMessage).toHaveCount(1);
  await expect(ownerMessage).toContainText(
    await ownerEmail(database.pool, owner.id),
  );
  await expect(ownerMessage).toContainText("Captured locally");

  await page.getByRole("button", { name: /Owner cancellation alert/ }).click();
  await expect(
    page.locator("article").filter({ hasText: "Owner cancellation alert" }),
  ).toHaveCount(1);
  await expect(
    page.locator("article").filter({ hasText: "Cancellation update" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Event details" }).first().click();
  const details = page.getByRole("dialog", { name: "Message details" });
  await expect(details).toContainText("Captured locally");
  await expect(details).toContainText("Inbox delivery");
  await expect(details).toContainText("inbox delivery is not enabled");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  expect(token).toHaveLength(43);
});

test("real Mailpit captures the customer cancellation update and token-free owner alert", async ({
  context,
  owners,
  database,
}) => {
  test.skip(
    process.env.TRIMTIME_E2E_EMAIL_MODE !== "mailpit-real",
    "requires an explicitly configured local Mailpit service",
  );
  const mailpitOrigin = process.env.TRIMTIME_E2E_MAILPIT_ORIGIN;
  if (!mailpitOrigin)
    throw new Error("Mailpit origin is required for this test.");
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);
  const recipient = `cancel-${randomUUID()}@example.test`;
  try {
    const { createPublicBooking } =
      await import("../../features/bookings/public-mutations");
    const { cancelCustomerBooking } =
      await import("../../features/bookings/customer-mutations");
    const { dispatchInitialBookingNotifications } =
      await import("../../features/notifications/dispatch");
    const created = await createPublicBooking(
      { shopId: owner.shopId },
      {
        serviceId,
        barberId,
        startAt: ELIGIBLE_START,
        reviewedOffer: {
          name: "Cut",
          priceUsd: "35.00",
          durationMinutes: "35",
        },
        contact: {
          name: "Ada Lovelace",
          email: recipient,
          whatsappOptIn: false,
        },
        recoveryKey: randomBytes(32).toString("base64url"),
      },
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const bookingId = created.data.bookingId;
    const token = new URL(created.data.manageUrl).pathname.split("/").at(-1)!;
    await dispatchInitialBookingNotifications(bookingId);

    const cancelled = await cancelCustomerBooking(
      { shopId: owner.shopId },
      {
        token,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
        confirmed: true,
      },
    );
    expect(cancelled.success).toBe(true);
    await dispatchInitialBookingNotifications(bookingId);

    const { rows: work } = await database.pool.query(
      `SELECT w.kind,w.status,w.recipient,a.outcome,a.capture_id,a.id AS attempt_id
       FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.booking_id=$1 AND w.booking_revision=1 AND w.channel='email'
       ORDER BY w.kind`,
      [bookingId],
    );
    expect(work).toHaveLength(2);
    const customer = work.find((row) => row.kind === "customer_cancellation")!;
    const ownerWork = work.find((row) => row.kind === "owner_cancellation")!;
    expect(customer).toMatchObject({
      status: "captured",
      outcome: "captured",
      recipient,
    });
    expect(ownerWork).toMatchObject({
      status: "captured",
      outcome: "captured",
    });

    const customerMessage = await fetchMessage(
      mailpitOrigin,
      customer.capture_id,
    );
    expect(customerMessage.To?.[0]?.Address?.toLowerCase()).toBe(
      recipient.toLowerCase(),
    );
    expect(customerMessage.Subject).toBe("Booking cancelled — Juniper Barber");
    expect(customerMessage.Text).toContain(
      "You have cancelled your booking. The saved appointment details are retained:",
    );
    expect(customerMessage.Text).not.toContain(
      "The shop has cancelled your booking.",
    );
    expect(customerMessage.Text).toContain(
      "Service: Cut — $35.00 USD (35 minutes)",
    );
    expect(customerMessage.Text).toContain(
      "Start: Oct 31, 2026, 8:00 PM America/New_York (UTC-04:00)",
    );
    expect(customerMessage.Text).toContain(
      `Manage your booking: http://${owner.subdomain}.${SHOP_SUFFIX}/manage/${token}`,
    );
    const customerHeaders = await fetchHeaders(
      mailpitOrigin,
      customer.capture_id,
    );
    expect(attemptHeader(customerHeaders)).toEqual([customer.attempt_id]);

    const ownerMessage = await fetchMessage(
      mailpitOrigin,
      ownerWork.capture_id,
    );
    expect(ownerMessage.To?.[0]?.Address?.toLowerCase()).toBe(
      (await ownerEmail(database.pool, owner.id)).toLowerCase(),
    );
    expect(ownerMessage.Subject).toBe("Customer cancelled — Juniper Barber");
    expect(ownerMessage.Text).toContain(
      "The customer has cancelled this appointment. The saved details are retained:",
    );
    expect(ownerMessage.Text).toContain(
      `Customer: Ada Lovelace <${recipient}>`,
    );
    expect(ownerMessage.Text).toContain(
      "Service: Cut — $35.00 USD (35 minutes)",
    );
    expect(ownerMessage.Text).toContain(
      "Owner activity: http://app.localhost:3100/activity",
    );
    expect(ownerMessage.Text).not.toContain("/manage/");
    expect(ownerMessage.Text).not.toContain(token);
    const ownerHeaders = await fetchHeaders(
      mailpitOrigin,
      ownerWork.capture_id,
    );
    expect(attemptHeader(ownerHeaders)).toEqual([ownerWork.attempt_id]);
  } finally {
    await database.pool.query("DELETE FROM shops WHERE id=$1", [owner.shopId]);
  }
});

test("a Mailpit outage leaves the committed cancellation unknown and does not replay", async ({
  context,
  owners,
  database,
}) => {
  test.skip(
    process.env.TRIMTIME_E2E_EMAIL_MODE !== "mailpit-outage",
    "requires the owned local Mailpit service to be stopped for the walkthrough",
  );
  const mailpitOrigin = process.env.TRIMTIME_E2E_MAILPIT_ORIGIN;
  if (!mailpitOrigin)
    throw new Error("Mailpit origin is required for this test.");
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);
  const recipient = `outage-${randomUUID()}@example.test`;
  try {
    const { createPublicBooking } =
      await import("../../features/bookings/public-mutations");
    const { cancelCustomerBooking } =
      await import("../../features/bookings/customer-mutations");
    const { dispatchInitialBookingNotifications } =
      await import("../../features/notifications/dispatch");
    const created = await createPublicBooking(
      { shopId: owner.shopId },
      {
        serviceId,
        barberId,
        startAt: ELIGIBLE_START,
        reviewedOffer: {
          name: "Cut",
          priceUsd: "35.00",
          durationMinutes: "35",
        },
        contact: {
          name: "Ada Lovelace",
          email: recipient,
          whatsappOptIn: false,
        },
        recoveryKey: randomBytes(32).toString("base64url"),
      },
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const bookingId = created.data.bookingId;
    const token = new URL(created.data.manageUrl).pathname.split("/").at(-1)!;
    await dispatchInitialBookingNotifications(bookingId);

    setMailpit("stop");
    const cancelled = await cancelCustomerBooking(
      { shopId: owner.shopId },
      {
        token,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
        confirmed: true,
      },
    );
    expect(cancelled.success).toBe(true);
    await dispatchInitialBookingNotifications(bookingId);

    setMailpit("up");
    await expect
      .poll(async () => {
        try {
          return (await fetch(`${mailpitOrigin}/api/v1/messages`)).ok;
        } catch {
          return false;
        }
      })
      .toBe(true);
    await dispatchInitialBookingNotifications(bookingId);

    const { rows: work } = await database.pool.query(
      `SELECT w.kind,w.status,w.reason,count(a.id)::int AS attempts,
        max(a.invoked_at) AS invoked_at,max(a.outcome) AS outcome
       FROM notification_work w
       LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.booking_id=$1 AND w.booking_revision=1 AND w.channel='email'
       GROUP BY w.kind,w.status,w.reason
       ORDER BY w.kind`,
      [bookingId],
    );
    expect(work).toEqual([
      {
        kind: "customer_cancellation",
        status: "unknown",
        reason: "transport_interrupted",
        attempts: 1,
        invoked_at: expect.any(Date),
        outcome: "unknown",
      },
      {
        kind: "owner_cancellation",
        status: "unknown",
        reason: "transport_interrupted",
        attempts: 1,
        invoked_at: expect.any(Date),
        outcome: "unknown",
      },
    ]);
    const booking = await database.pool.query(
      "SELECT status,revision FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(booking.rows[0]).toEqual({ status: "cancelled", revision: 1 });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1",
          [bookingId],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1 AND booking_revision=1",
          [bookingId],
        )
      ).rows[0].count,
    ).toBe(2);
  } finally {
    setMailpit("up");
    await database.pool.query("DELETE FROM shops WHERE id=$1", [owner.shopId]);
  }
});
