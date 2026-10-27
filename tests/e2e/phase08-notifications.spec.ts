import { randomUUID } from "node:crypto";
import { expect, ownerOrigin, test } from "./fixtures";

const budgetDay = new Date(
  process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z",
)
  .toISOString()
  .slice(0, 10);
let ownsBudgetDay = false;

test.beforeAll(async ({ database }) => {
  if (process.env.TRIMTIME_E2E_EMAIL_MODE !== "mailpit-double") return;
  const { rows } = await database.pool.query(
    "INSERT INTO outbound_budget (day, allocation_count) VALUES ($1, 0) ON CONFLICT DO NOTHING RETURNING day",
    [budgetDay],
  );
  if (!rows.length)
    throw new Error(
      "Phase 08 test budget day is already owned by another suite.",
    );
  ownsBudgetDay = true;
});

test.afterAll(async ({ database }) => {
  if (!ownsBudgetDay) return;
  const { rows } = await database.pool.query(
    "SELECT count(*)::int AS n FROM notification_attempts WHERE budget_day=$1",
    [budgetDay],
  );
  if (rows[0].n)
    throw new Error(
      "Phase 08 fixtures left attempts on the shared test budget.",
    );
  await database.pool.query("DELETE FROM outbound_budget WHERE day=$1", [
    budgetDay,
  ]);
});

test("manual appointment captures only the customer's initial confirmation", async ({
  page,
  context,
  owners,
  database,
}) => {
  test.skip(
    process.env.TRIMTIME_E2E_EMAIL_MODE !== "mailpit-double" &&
      process.env.TRIMTIME_E2E_EMAIL_MODE !== "mailpit-real",
    "requires the Mailpit HTTP double or an explicitly configured real local Mailpit",
  );
  const owner = await owners(context, { shop: true, createSetup: true });
  const recipient = `manual-${randomUUID()}@example.test`;
  await page.goto(`${ownerOrigin}/?date=2026-11-02&view=day`);
  await page.getByRole("link", { name: "New appointment" }).click();
  await page.getByLabel("Customer name").fill("Fictional Walk-in");
  await page.getByLabel("Customer email (optional)").fill(recipient);
  await page
    .getByLabel(/^Service/)
    .selectOption({ label: "Walk-in Cut · $25" });
  await page
    .getByRole("dialog")
    .locator("form select")
    .nth(1)
    .selectOption({ label: "Manual Barber" });
  await page.getByLabel("Start time").fill("13:07");
  await page.getByRole("button", { name: "Create appointment" }).click();
  await expect(page).toHaveURL(/created=[0-9a-f-]{36}/);

  const bookingId = new URL(page.url()).searchParams.get("created");
  expect(bookingId).toMatch(/^[0-9a-f-]{36}$/);
  await expect
    .poll(async () => {
      const { rows } = await database.pool.query(
        `SELECT w.kind, w.channel, w.status, w.recipient, a.outcome, a.capture_id
         FROM notification_work w
         JOIN bookings b ON b.id=w.booking_id
         LEFT JOIN notification_attempts a ON a.work_id=w.id
         WHERE b.shop_id=$1 AND b.id=$2
         ORDER BY w.kind, w.channel`,
        [owner.shopId, bookingId],
      );
      return rows;
    })
    .toEqual([
      expect.objectContaining({
        kind: "customer_confirmation",
        channel: "email",
        status: "captured",
        recipient,
        outcome: "captured",
      }),
    ]);

  if (process.env.TRIMTIME_E2E_EMAIL_MODE === "mailpit-real") {
    const { rows: attempts } = await database.pool.query(
      `SELECT a.id, a.capture_id FROM notification_attempts a
       JOIN notification_work w ON w.id=a.work_id
       WHERE w.booking_id=$1 AND w.channel='email'`,
      [bookingId],
    );
    expect(attempts).toHaveLength(1);
    const response = await fetch(
      `${process.env.TRIMTIME_E2E_MAILPIT_ORIGIN}/api/v1/message/${attempts[0].capture_id}`,
    );
    expect(response.ok).toBe(true);
    const captured = (await response.json()) as {
      ID?: string;
      To?: Array<{ Address?: string }>;
      Text?: string;
    };
    expect(captured.ID).toBe(attempts[0].capture_id);
    expect(
      captured.To?.some(
        (address) => address.Address?.toLowerCase() === recipient.toLowerCase(),
      ),
    ).toBe(true);
    expect(captured.Text).toContain("Fictional Walk-in");
    const headersResponse = await fetch(
      `${process.env.TRIMTIME_E2E_MAILPIT_ORIGIN}/api/v1/message/${attempts[0].capture_id}/headers`,
    );
    expect(headersResponse.ok).toBe(true);
    const receivedHeaders = (await headersResponse.json()) as Record<
      string,
      string[]
    >;
    const attemptHeader = Object.entries(receivedHeaders).find(
      ([name]) => name.toLowerCase() === "x-trimtime-attempt-id",
    )?.[1];
    expect(attemptHeader).toEqual([attempts[0].id]);
    const canonicalLink = captured.Text?.match(
      /Manage your booking: (\S+)/,
    )?.[1];
    expect(canonicalLink).toBeTruthy();
    const parsedLink = new URL(canonicalLink!);
    expect(parsedLink.hostname).toBe(`${owner.subdomain}.localhost`);
    expect(parsedLink.port).toBe("3100");
    expect(parsedLink.pathname).toMatch(/^\/manage\//);
  }

  await page.goto(`${ownerOrigin}/activity`);
  await expect(
    page.getByRole("heading", { name: "Booking activity & message status" }),
  ).toBeVisible();
  await expect(
    page.getByText("Manual appointment", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("article").filter({ hasText: recipient }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Event details" })).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "Event details" }).click();
  const details = page.getByRole("dialog", { name: "Message details" });
  await expect(details).toContainText("Customer confirmation");
  await expect(details).toContainText(bookingId!);
  await expect(details).toContainText(
    "Captured locally; inbox delivery is not enabled.",
  );
});

test("manual appointment survives an unavailable local Mailpit without scheduling a replay", async ({
  page,
  context,
  owners,
  database,
}) => {
  test.skip(
    process.env.TRIMTIME_E2E_EMAIL_MODE !== "mailpit-outage",
    "requires the owned local Mailpit service to be stopped for the walkthrough",
  );
  const owner = await owners(context, { shop: true, createSetup: true });
  const recipient = `outage-${randomUUID()}@example.test`;
  await page.goto(`${ownerOrigin}/?date=2026-11-02&view=day`);
  await page.getByRole("link", { name: "New appointment" }).click();
  await page.getByLabel("Customer name").fill("Fictional Outage Walk-in");
  await page.getByLabel("Customer email (optional)").fill(recipient);
  await page
    .getByLabel(/^Service/)
    .selectOption({ label: "Walk-in Cut · $25" });
  await page
    .getByRole("dialog")
    .locator("form select")
    .nth(1)
    .selectOption({ label: "Manual Barber" });
  await page.getByLabel("Start time").fill("13:07");
  await page.getByRole("button", { name: "Create appointment" }).click();
  await expect(page).toHaveURL(/created=[0-9a-f-]{36}/);
  const bookingId = new URL(page.url()).searchParams.get("created");
  expect(bookingId).toMatch(/^[0-9a-f-]{36}$/);
  await expect
    .poll(async () => {
      const { rows } = await database.pool.query(
        `SELECT w.status, a.outcome FROM notification_work w
       JOIN bookings b ON b.id=w.booking_id
       JOIN notification_attempts a ON a.work_id=w.id
       WHERE b.shop_id=$1 AND b.id=$2 AND w.kind='customer_confirmation' AND w.channel='email'`,
        [owner.shopId, bookingId],
      );
      return rows[0];
    })
    .toEqual(
      expect.objectContaining({ status: "unknown", outcome: "unknown" }),
    );
  const { rows: attempts } = await database.pool.query(
    `SELECT count(*)::int AS count FROM notification_attempts a
     JOIN notification_work w ON w.id=a.work_id WHERE w.booking_id=$1`,
    [bookingId],
  );
  expect(attempts[0].count).toBe(1);
  await expect(
    page.getByRole("link", { name: /Appointment: Fictional Outage Walk-in/ }),
  ).toBeVisible();
});
