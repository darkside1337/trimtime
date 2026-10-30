import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { Pool } from "pg";
import { expect, ownerOrigin, test, type Owner } from "./fixtures";
import { addReadyCatalog } from "./publication-fixtures";

const SHOP_SUFFIX = "localhost:3100";
const ELIGIBLE_START = "2026-11-02T15:00:00.000Z";
const OWNED_MAILPIT_NAME = "trimtime-phase12-mailpit";
const OWNED_MAILPIT_LABEL_KEY = "trimtime.owner";
const OWNED_MAILPIT_LABEL_VAL = "phase12-task";

function getValidatedOwnedMailpit(expectedOrigin: string): {
  id: string;
  name: string;
} {
  const originUrl = new URL(expectedOrigin);
  if (
    originUrl.hostname !== "127.0.0.1" &&
    originUrl.hostname !== "localhost"
  ) {
    throw new Error(
      `Refusing to interact with non-loopback Mailpit origin: ${expectedOrigin}`,
    );
  }
  const expectedPort = originUrl.port || "8025";

  let inspectOutput: string;
  try {
    inspectOutput = execFileSync("docker", ["inspect", OWNED_MAILPIT_NAME], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new Error(
      `Safe Mailpit isolation blocker: could not inspect container '${OWNED_MAILPIT_NAME}'. Refusing to touch unowned or dev service: ${err}`,
    );
  }

  const parsed = JSON.parse(inspectOutput);
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error(
      `Safe Mailpit isolation blocker: unexpected docker inspect output for '${OWNED_MAILPIT_NAME}'.`,
    );
  }
  const container = parsed[0];
  const containerId: string = container.Id;
  const containerName: string = container.Name;
  const labels: Record<string, string> = container.Config?.Labels ?? {};

  if (
    containerName !== `/${OWNED_MAILPIT_NAME}` ||
    containerName.includes("trimtime-dev")
  ) {
    throw new Error(
      `Safe Mailpit isolation blocker: container name '${containerName}' does not match owned name '/${OWNED_MAILPIT_NAME}' or targets dev service.`,
    );
  }

  if (labels[OWNED_MAILPIT_LABEL_KEY] !== OWNED_MAILPIT_LABEL_VAL) {
    throw new Error(
      `Safe Mailpit isolation blocker: container '${containerName}' missing required label ${OWNED_MAILPIT_LABEL_KEY}=${OWNED_MAILPIT_LABEL_VAL}. Found labels: ${JSON.stringify(labels)}.`,
    );
  }

  const portBindings = container.HostConfig?.PortBindings?.["8025/tcp"];
  if (!Array.isArray(portBindings) || portBindings.length === 0) {
    throw new Error(
      `Safe Mailpit isolation blocker: container '${containerName}' has no port binding for 8025/tcp.`,
    );
  }
  const loopbackBinding = portBindings.find(
    (binding: { HostIp: string; HostPort: string }) =>
      (binding.HostIp === "127.0.0.1" || binding.HostIp === "localhost") &&
      binding.HostPort === expectedPort,
  );
  if (!loopbackBinding) {
    throw new Error(
      `Safe Mailpit isolation blocker: container '${containerName}' port bindings ${JSON.stringify(portBindings)} do not match loopback port ${expectedPort} of origin ${expectedOrigin}.`,
    );
  }

  return { id: containerId, name: containerName };
}

function setOwnedMailpit(action: "stop" | "start", expectedOrigin: string) {
  const container = getValidatedOwnedMailpit(expectedOrigin);
  execFileSync("docker", [action, container.id], { stdio: "inherit" });
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

async function restoreJourney(
  pool: Pool,
  owner: Owner,
  ownerId: string,
  serviceId: string,
  barberId: string,
) {
  const recipient = `restore-${randomUUID()}@example.test`;
  const phone = `+1202555${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
  const { createPublicBooking } = await import(
    "../../features/bookings/public-mutations"
  );
  const { cancelOwnerBooking, restoreOwnerBooking } = await import(
    "../../features/bookings/mutations"
  );
  const { dispatchInitialBookingNotifications } = await import(
    "../../features/notifications/dispatch"
  );

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
        phone,
        whatsappOptIn: true,
      },
      recoveryKey: randomBytes(32).toString("base64url"),
    },
  );
  expect(created.success).toBe(true);
  if (!created.success) throw new Error("Public booking fixture failed.");
  const bookingId = created.data.bookingId;
  const token = new URL(created.data.manageUrl).pathname.split("/").at(-1)!;

  const cancelled = await cancelOwnerBooking(
    { userId: ownerId },
    {
      bookingId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    },
  );
  expect(cancelled.success).toBe(true);

  const restored = await restoreOwnerBooking(
    { userId: ownerId },
    {
      bookingId,
      expectedRevision: 1,
      operationKey: randomBytes(32).toString("base64url"),
    },
  );
  expect(restored.success).toBe(true);
  if (!restored.success) throw new Error("Restoration fixture failed.");
  expect(restored.data.operation).toMatchObject({
    kind: "restore",
    revision: 2,
  });

  await dispatchInitialBookingNotifications(bookingId);

  const { rows: work } = await pool.query(
    `SELECT w.kind,w.channel,w.status,w.reason,w.recipient,
       a.outcome,a.capture_id,a.id AS attempt_id
     FROM notification_work w
     LEFT JOIN notification_attempts a ON a.work_id=w.id
     WHERE w.booking_id=$1 AND w.booking_revision=2
     ORDER BY w.channel,w.kind`,
    [bookingId],
  );
  expect(work).toHaveLength(2);
  const emailWork = work.find((row) => row.channel === "email")!;
  const whatsappWork = work.find((row) => row.channel === "whatsapp")!;
  expect(emailWork).toMatchObject({
    kind: "customer_restoration",
    status: "captured",
    outcome: "captured",
    recipient,
  });
  expect(whatsappWork).toMatchObject({
    kind: "customer_restoration",
    status: "unavailable",
    reason: "channel_unavailable",
    recipient: phone,
    outcome: null,
  });

  const obsolete = await pool.query(
    `SELECT w.booking_revision, w.channel, w.status,
       (SELECT count(*)::int FROM notification_attempts a WHERE a.work_id=w.id) AS attempts
     FROM notification_work w
     WHERE w.booking_id=$1 AND w.booking_revision < 2
     ORDER BY w.booking_revision, w.channel`,
    [bookingId],
  );
  expect(obsolete.rows.length).toBeGreaterThan(0);
  expect(obsolete.rows.every((row) => Number(row.attempts) === 0)).toBe(true);
  const obsoleteEmail = obsolete.rows.filter((row) => row.channel === "email");
  expect(obsoleteEmail.length).toBeGreaterThan(0);
  expect(obsoleteEmail.every((row) => row.status === "suppressed")).toBe(true);
  expect(
    obsolete.rows.every(
      (row) =>
        !["captured", "accepted", "sending", "unknown"].includes(row.status),
    ),
  ).toBe(true);

  return { bookingId, recipient, token, emailWork, whatsappWork };
}

function restoreEmailExpectations(
  owner: Owner,
  recipient: string,
  token: string,
) {
  return {
    recipient,
    subject: "Booking restored — Juniper Barber",
    text: [
      "The shop has restored your booking. These saved details are retained:",
      "Service: Cut — $35.00 USD (35 minutes)",
      "Barber: Sam",
      "Nov 2, 2026, 10:00 AM America/New_York (UTC-05:00)",
      `Manage your booking: http://${owner.subdomain}.${SHOP_SUFFIX}/manage/${token}`,
      "Online changes are not available within 12 hours of your start. Contact the shop for help.",
    ],
  };
}

test("restoration capture mode sends one customer update and marks Activity truthfully", async ({
  context,
  owners,
  database,
  page,
}) => {
  test.skip(
    process.env.TRIMTIME_E2E_EMAIL_MODE !== "mailpit-double",
    "requires the isolated Mailpit HTTP double",
  );
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);
  const mailpitOrigin = "http://127.0.0.1:8027";
  const journey = await restoreJourney(
    database.pool,
    owner,
    owner.id,
    serviceId,
    barberId,
  );
  const expectations = restoreEmailExpectations(
    owner,
    journey.recipient,
    journey.token,
  );

  const message = await fetchMessage(
    mailpitOrigin,
    journey.emailWork.capture_id,
  );
  expect(message.To?.[0]?.Address?.toLowerCase()).toBe(
    expectations.recipient.toLowerCase(),
  );
  expect(message.Subject).toBe(expectations.subject);
  for (const line of expectations.text) expect(message.Text).toContain(line);
  const headers = await fetchHeaders(
    mailpitOrigin,
    journey.emailWork.capture_id,
  );
  expect(attemptHeader(headers)).toEqual([journey.emailWork.attempt_id]);

  await page.goto(`${ownerOrigin}/activity`);
  await expect(
    page.getByRole("heading", { name: "Booking activity & message status" }),
  ).toBeVisible();
  const change = page
    .locator("article")
    .filter({ hasText: "Appointment restored" });
  await expect(change).toHaveCount(1);
  await expect(change).toContainText("Shop-initiated");
  await expect(change).toContainText("Cut");
  await expect(change).toContainText("Sam");
  const update = page
    .locator("article")
    .filter({ hasText: "Restoration update" })
    .filter({ hasText: journey.recipient });
  await expect(update).toHaveCount(1);
  await expect(update).toContainText(journey.recipient);
  await expect(update).toContainText("Captured locally");
});

test("real owned Mailpit captures the restoration update and attempt correlation", async ({
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
  getValidatedOwnedMailpit(mailpitOrigin);
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);
  const journey = await restoreJourney(
    database.pool,
    owner,
    owner.id,
    serviceId,
    barberId,
  );
  const expectations = restoreEmailExpectations(
    owner,
    journey.recipient,
    journey.token,
  );

  const message = await fetchMessage(
    mailpitOrigin,
    journey.emailWork.capture_id,
  );
  expect(message.To?.[0]?.Address?.toLowerCase()).toBe(
    expectations.recipient.toLowerCase(),
  );
  expect(message.Subject).toBe(expectations.subject);
  for (const line of expectations.text) expect(message.Text).toContain(line);
  expect(message.Text).not.toContain("Owner activity:");
  const headers = await fetchHeaders(
    mailpitOrigin,
    journey.emailWork.capture_id,
  );
  expect(attemptHeader(headers)).toEqual([journey.emailWork.attempt_id]);
});

test("Mailpit outage leaves the committed restoration unknown without automatic replay", async ({
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
  getValidatedOwnedMailpit(mailpitOrigin);
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);
  const recipient = `outage-${randomUUID()}@example.test`;
  try {
    const { createPublicBooking } = await import(
      "../../features/bookings/public-mutations"
    );
    const { cancelOwnerBooking, restoreOwnerBooking } = await import(
      "../../features/bookings/mutations"
    );
    const { dispatchInitialBookingNotifications } = await import(
      "../../features/notifications/dispatch"
    );
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

    const cancelled = await cancelOwnerBooking(
      { userId: owner.id },
      {
        bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
      },
    );
    expect(cancelled.success).toBe(true);

    setOwnedMailpit("stop", mailpitOrigin);
    const restored = await restoreOwnerBooking(
      { userId: owner.id },
      {
        bookingId,
        expectedRevision: 1,
        operationKey: randomBytes(32).toString("base64url"),
      },
    );
    expect(restored.success).toBe(true);
    await dispatchInitialBookingNotifications(bookingId);

    setOwnedMailpit("start", mailpitOrigin);
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
      `SELECT w.kind,w.channel,w.status,w.reason,count(a.id)::int AS attempts,
        max(a.invoked_at) AS invoked_at,max(a.outcome) AS outcome
       FROM notification_work w
       LEFT JOIN notification_attempts a ON a.work_id=w.id
       WHERE w.booking_id=$1 AND w.booking_revision=2 AND w.channel='email'
       GROUP BY w.kind,w.channel,w.status,w.reason
       ORDER BY w.kind`,
      [bookingId],
    );
    expect(work).toEqual([
      {
        kind: "customer_restoration",
        channel: "email",
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
    expect(booking.rows[0]).toEqual({ status: "confirmed", revision: 2 });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1 AND kind='restore'",
          [bookingId],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM notification_work WHERE booking_id=$1 AND booking_revision=2",
          [bookingId],
        )
      ).rows[0].count,
    ).toBe(1);
  } finally {
    try {
      setOwnedMailpit("start", mailpitOrigin);
    } catch {
      // restore best effort, container might not have been stopped
    }
    await database.pool.query("DELETE FROM shops WHERE id=$1", [owner.shopId]);
  }
});
