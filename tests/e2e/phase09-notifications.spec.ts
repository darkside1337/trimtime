import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, ownerOrigin, test } from "./fixtures";

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

test("owner Activity shows scoped before and after appointment change details", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, appointment: true });
  const before = {
    status: "confirmed",
    serviceId: owner.serviceId!,
    serviceName: "Saved Cut",
    servicePriceUsd: "25.00",
    serviceDurationMinutes: 35,
    barberId: owner.barberId!,
    barberName: "Saved Barber",
    startAt: "2026-11-02T10:07:00.000Z",
    endAt: "2026-11-02T10:42:00.000Z",
  };
  const after = {
    ...before,
    startAt: "2026-11-02T11:07:00.000Z",
    endAt: "2026-11-02T11:42:00.000Z",
  };
  const changeId = randomUUID();
  await database.pool.query(
    `UPDATE bookings SET revision=1,start_at=$2,end_at=$3 WHERE id=$1`,
    [owner.appointmentId, after.startAt, after.endAt],
  );
  await database.pool.query(
    `INSERT INTO booking_changes
      (id,shop_id,booking_id,actor_id,kind,applied_revision,operation_key_hash,payload_digest,before_snapshot,after_snapshot)
     VALUES ($1,$2,$3,$4,'move',1,$5,$6,$7::jsonb,$8::jsonb)`,
    [
      changeId,
      owner.shopId,
      owner.appointmentId,
      owner.id,
      `key-${randomUUID()}`,
      `digest-${randomUUID()}`,
      JSON.stringify(before),
      JSON.stringify(after),
    ],
  );
  await database.pool.query(
    `INSERT INTO notification_work
      (id,booking_id,booking_revision,change_id,kind,channel,status,recipient,reason)
     VALUES ($1,$2,1,$3,'customer_move','email','unavailable',NULL,'recipient_missing')`,
    [randomUUID(), owner.appointmentId, changeId],
  );

  await page.goto(`${ownerOrigin}/activity`);
  await expect(
    page.getByRole("heading", { name: "Recent appointment changes" }),
  ).toBeVisible();
  const change = page
    .locator("article")
    .filter({ hasText: "Appointment rescheduled" });
  await expect(change).toContainText("Appointment rescheduled");
  await expect(change).toContainText("Saved Cut");
  await expect(change).toContainText("Saved Barber");
  await expect(change).toContainText("Nov 2, 2026, 6:07 AM");
  await expect(
    page.getByRole("heading", { name: "Notification records" }),
  ).toBeVisible();
  await expect(page.getByText("Reschedule update")).toBeVisible();
});

test("real Mailpit captures the current customer move update", async ({
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
  const budgetDay = new Date(
    process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z",
  )
    .toISOString()
    .slice(0, 10);
  const budget = await database.pool.query(
    "INSERT INTO outbound_budget (day,allocation_count) VALUES ($1,0) ON CONFLICT DO NOTHING RETURNING day",
    [budgetDay],
  );
  expect(budget.rowCount).toBe(1);
  const owner = await owners(context, { shop: true, createSetup: true });
  try {
    const { createOwnerBooking, moveOwnerBooking } =
      await import("../../features/bookings/mutations");
    const { dispatchInitialBookingNotifications } =
      await import("../../features/notifications/dispatch");
    const recipient = `move-${randomUUID()}@example.test`;
    const reviewedOffer = {
      name: "Walk-in Cut",
      priceUsd: "25.00",
      durationMinutes: "35",
    };
    const created = await createOwnerBooking(
      { userId: owner.id },
      {
        serviceId: owner.serviceId!,
        barberId: owner.barberId!,
        startAt: "2027-01-19T13:07:00.000Z",
        reviewedOffer,
        contact: {
          name: "Fictional Move Guest",
          email: recipient,
          whatsappOptIn: false,
        },
        recoveryKey: randomBytes(32).toString("base64url"),
      },
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const bookingId = created.data.bookingId;
    const moved = await moveOwnerBooking(
      { userId: owner.id },
      {
        bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
        serviceId: owner.serviceId!,
        barberId: owner.barberId!,
        startAt: "2027-01-19T14:07:00.000Z",
        reviewedOffer,
      },
    );
    expect(moved.success).toBe(true);
    await dispatchInitialBookingNotifications(bookingId);

    const { rows } = await database.pool.query(
      `SELECT w.status,w.reason,a.outcome,a.capture_id,a.id AS attempt_id
       FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.booking_id=$1 AND w.kind='customer_move' AND w.booking_revision=1`,
      [bookingId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "captured", outcome: "captured" });
    const response = await fetch(
      `${mailpitOrigin}/api/v1/message/${rows[0].capture_id}`,
    );
    expect(response.ok).toBe(true);
    const captured = (await response.json()) as {
      ID?: string;
      To?: Array<{ Address?: string }>;
      Subject?: string;
      Text?: string;
    };
    expect(captured.ID).toBe(rows[0].capture_id);
    expect(captured.To?.[0]?.Address?.toLowerCase()).toBe(
      recipient.toLowerCase(),
    );
    expect(captured.Subject).toBe("Booking updated — Juniper Barber");
    expect(captured.Text).toContain(
      "Customer changes require at least 12 hours' notice.",
    );
    expect(captured.Text).toContain(
      "For changes with less than 12 hours remaining, contact the shop.",
    );
    expect(captured.Text).toContain("The shop has rescheduled your booking.");
    expect(captured.Text).toContain(
      "Service: Walk-in Cut — $25.00 USD (35 minutes)",
    );
    expect(captured.Text).toContain(
      "Start: Jan 19, 2027, 9:07 AM America/New_York (UTC-05:00)",
    );
    expect(captured.Text).toContain("Manage your booking: http://shop-");
    expect(captured.Text).not.toContain(
      "does not confirm a cancellation or reschedule",
    );
    const headerResponse = await fetch(
      `${mailpitOrigin}/api/v1/message/${rows[0].capture_id}/headers`,
    );
    expect(headerResponse.ok).toBe(true);
    const headers = (await headerResponse.json()) as Record<string, string[]>;
    expect(
      Object.entries(headers).find(
        ([name]) => name.toLowerCase() === "x-trimtime-attempt-id",
      )?.[1],
    ).toEqual([rows[0].attempt_id]);
  } finally {
    await database.pool.query("DELETE FROM shops WHERE id=$1", [owner.shopId]);
  }
});

test("real Mailpit captures the customer cancellation update", async ({
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
  const budgetDay = new Date(
    process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z",
  )
    .toISOString()
    .slice(0, 10);
  const budget = await database.pool.query(
    "INSERT INTO outbound_budget (day,allocation_count) VALUES ($1,0) ON CONFLICT DO NOTHING RETURNING day",
    [budgetDay],
  );
  expect(budget.rowCount).toBe(1);
  const owner = await owners(context, { shop: true, createSetup: true });
  try {
    const { createOwnerBooking, cancelOwnerBooking } =
      await import("../../features/bookings/mutations");
    const { dispatchInitialBookingNotifications } =
      await import("../../features/notifications/dispatch");
    const recipient = `cancel-${randomUUID()}@example.test`;
    const reviewedOffer = {
      name: "Walk-in Cut",
      priceUsd: "25.00",
      durationMinutes: "35",
    };
    const created = await createOwnerBooking(
      { userId: owner.id },
      {
        serviceId: owner.serviceId!,
        barberId: owner.barberId!,
        startAt: "2027-01-21T13:07:00.000Z",
        reviewedOffer,
        contact: {
          name: "Fictional Cancellation Guest",
          email: recipient,
          whatsappOptIn: false,
        },
        recoveryKey: randomBytes(32).toString("base64url"),
      },
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const bookingId = created.data.bookingId;
    const cancelled = await cancelOwnerBooking(
      { userId: owner.id },
      {
        bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
      },
    );
    expect(cancelled.success).toBe(true);
    await dispatchInitialBookingNotifications(bookingId);

    const { rows } = await database.pool.query(
      `SELECT w.status,w.reason,a.outcome,a.capture_id,a.id AS attempt_id
       FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.booking_id=$1 AND w.kind='customer_cancellation' AND w.booking_revision=1`,
      [bookingId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "captured", outcome: "captured" });
    const response = await fetch(
      `${mailpitOrigin}/api/v1/message/${rows[0].capture_id}`,
    );
    expect(response.ok).toBe(true);
    const captured = (await response.json()) as {
      ID?: string;
      To?: Array<{ Address?: string }>;
      Subject?: string;
      Text?: string;
    };
    expect(captured.ID).toBe(rows[0].capture_id);
    expect(captured.To?.[0]?.Address?.toLowerCase()).toBe(
      recipient.toLowerCase(),
    );
    expect(captured.Subject).toBe("Booking cancelled — Juniper Barber");
    expect(captured.Text).toContain("The shop has cancelled your booking.");
    expect(captured.Text).toContain(
      "Your manage link is now read-only because this booking was cancelled.",
    );
    expect(captured.Text).toContain(
      "Service: Walk-in Cut — $25.00 USD (35 minutes)",
    );
    expect(captured.Text).toContain(
      "Start: Jan 21, 2027, 8:07 AM America/New_York (UTC-05:00)",
    );
    expect(captured.Text).toContain("Manage your booking: http://shop-");
    const headerResponse = await fetch(
      `${mailpitOrigin}/api/v1/message/${rows[0].capture_id}/headers`,
    );
    expect(headerResponse.ok).toBe(true);
    const headers = (await headerResponse.json()) as Record<string, string[]>;
    expect(
      Object.entries(headers).find(
        ([name]) => name.toLowerCase() === "x-trimtime-attempt-id",
      )?.[1],
    ).toEqual([rows[0].attempt_id]);
  } finally {
    await database.pool.query("DELETE FROM shops WHERE id=$1", [owner.shopId]);
  }
});

test("a real Mailpit outage leaves the committed cancellation unknown and does not replay", async ({
  context,
  owners,
  database,
}) => {
  test.skip(
    process.env.TRIMTIME_E2E_EMAIL_MODE !== "mailpit-outage",
    "requires the owned local Mailpit service to be stopped for the walkthrough",
  );
  const budgetDay = new Date(
    process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z",
  )
    .toISOString()
    .slice(0, 10);
  const budget = await database.pool.query(
    "INSERT INTO outbound_budget (day,allocation_count) VALUES ($1,0) ON CONFLICT DO NOTHING RETURNING day",
    [budgetDay],
  );
  expect(budget.rowCount).toBe(1);
  const owner = await owners(context, { shop: true, createSetup: true });
  try {
    const { createOwnerBooking, cancelOwnerBooking } =
      await import("../../features/bookings/mutations");
    const { dispatchInitialBookingNotifications } =
      await import("../../features/notifications/dispatch");
    const reviewedOffer = {
      name: "Walk-in Cut",
      priceUsd: "25.00",
      durationMinutes: "35",
    };
    const created = await createOwnerBooking(
      { userId: owner.id },
      {
        serviceId: owner.serviceId!,
        barberId: owner.barberId!,
        startAt: "2027-01-20T13:07:00.000Z",
        reviewedOffer,
        contact: {
          name: "Fictional Outage Guest",
          email: `outage-${randomUUID()}@example.test`,
          whatsappOptIn: false,
        },
        recoveryKey: randomBytes(32).toString("base64url"),
      },
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const bookingId = created.data.bookingId;
    const cancelled = await cancelOwnerBooking(
      { userId: owner.id },
      {
        bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
      },
    );
    expect(cancelled.success).toBe(true);
    setMailpit("stop");
    await dispatchInitialBookingNotifications(bookingId);
    setMailpit("up");
    await expect
      .poll(async () => {
        try {
          return (
            await fetch(
              `${process.env.TRIMTIME_E2E_MAILPIT_ORIGIN}/api/v1/messages`,
            )
          ).ok;
        } catch {
          return false;
        }
      })
      .toBe(true);
    await dispatchInitialBookingNotifications(bookingId);
    const state = await database.pool.query(
      `SELECT b.status,b.revision,w.status AS work_status,w.reason,
        count(a.id)::int AS attempts,max(a.invoked_at) AS invoked_at,
        max(a.outcome) AS outcome
       FROM bookings b JOIN notification_work w ON w.booking_id=b.id
       LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE b.id=$1 AND w.kind='customer_cancellation' AND w.booking_revision=1
       GROUP BY b.status,b.revision,w.status,w.reason`,
      [bookingId],
    );
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({
      status: "cancelled",
      revision: 1,
      work_status: "unknown",
      reason: "transport_interrupted",
      attempts: 1,
      outcome: "unknown",
    });
    expect(state.rows[0].invoked_at).toBeTruthy();
    expect(
      (
        await database.pool.query(
          "SELECT allocation_count FROM outbound_budget WHERE day=$1",
          [budgetDay],
        )
      ).rows[0].allocation_count,
    ).toBe(1);
  } finally {
    setMailpit("up");
    await database.pool.query("DELETE FROM shops WHERE id=$1", [owner.shopId]);
  }
});
