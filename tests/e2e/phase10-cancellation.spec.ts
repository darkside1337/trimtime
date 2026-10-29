import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { expect, ownerOrigin, test } from "./fixtures";
import { addReadyCatalog } from "./publication-fixtures";
import type { Owner } from "./fixtures";

const SHOP_SUFFIX = "localhost:3100";
const ELIGIBLE_START = "2026-11-01T00:00:00Z";
const ELIGIBLE_LOCAL_DATE = "2026-10-31";
const SECOND_ELIGIBLE_START = "2026-11-01T01:00:00Z";

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
  const shopId = (booking.rows[0]?.shop_id as string | undefined) ?? "";
  const occupancy = await pool.query(
    "SELECT id, barber_id, start_at, end_at FROM occupied_intervals WHERE shop_id=$1 ORDER BY id",
    [shopId],
  );
  const keyHash = createHash("sha256")
    .update(`${shopId}:${token}`)
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
    occupancy: occupancy.rows,
    events: events.rows[0].count,
    work: work.rows[0].count,
    attempts: attempts.rows[0].count,
  };
}

test("reading and dismissing cancellation confirmation never mutates the booking", async ({
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

    expect((await request.get(manageUrl.toString())).status()).toBe(200);
    expect((await request.head(manageUrl.toString())).status()).toBe(200);

    await page.goto(manageUrl.toString());
    await expect(
      page.getByRole("button", { name: "Cancel appointment" }),
    ).toBeVisible();
    const writes: string[] = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD"].includes(request.method()))
        writes.push(request.method());
    });

    await page.reload();
    await expect(
      page.getByRole("button", { name: "Cancel appointment" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel appointment" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Cancel appointment" }).click();
    await page.getByRole("button", { name: "Keep appointment" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Cancel appointment" }).click();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Cancel appointment" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    expect(writes).toEqual([]);
    expect(await snapshot(database.pool, bookingId, token)).toEqual(before);
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("confirmation names the explicit choice and retains saved booking details", async ({
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

  await page.goto(manageUrl.toString());
  await page.getByRole("button", { name: "Cancel appointment" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Let this chair go?" }),
  ).toBeVisible();
  await expect(dialog).toContainText("Cut");
  await expect(dialog).toContainText("Sam");
  await expect(dialog).toContainText("Saturday, October 31");
  await expect(dialog).toContainText(/8:00\sPM/);
  await expect(
    dialog.getByRole("button", { name: "Keep appointment" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Yes, cancel appointment" }),
  ).toBeVisible();
  await expect(dialog).not.toContainText("Preview only");
  await expect(dialog).not.toContainText("will not be cancelled");
});

test("only explicit confirmation submits and pending state blocks repeats and dismissal", async ({
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
    await page.getByRole("button", { name: "Cancel appointment" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const actionRequests: string[] = [];
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        request.method() === "POST" &&
        Boolean(request.headers()["next-action"])
      ) {
        actionRequests.push(request.url());
        const response = await route.fetch();
        await gate;
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    });

    await dialog
      .getByRole("button", { name: "Yes, cancel appointment" })
      .dispatchEvent("click");
    await expect(dialog.getByRole("status")).toContainText(
      "Cancelling appointment",
    );
    await expect(
      dialog.getByRole("button", { name: "Yes, cancel appointment" }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Keep appointment" }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(dialog).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.activeElement === document.body ||
          Boolean(document.activeElement?.closest('[role="dialog"]')),
      ),
    ).toBe(true);

    release();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Cancelled" }).first(),
    ).toBeVisible();
    expect(actionRequests).toHaveLength(1);
    const after = await database.pool.query(
      "SELECT revision, status FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(after.rows[0]).toEqual({ revision: 1, status: "cancelled" });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1",
          [bookingId],
        )
      ).rows[0].count,
    ).toBe(1);
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("confirmed cancellation refreshes saved state and releases public capacity", async ({
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
    await page.getByRole("button", { name: "Cancel appointment" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Yes, cancel appointment" })
      .click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByText("Appointment cancelled. The time has been released."),
    ).toBeAttached();
    await expect(
      page.getByRole("status").filter({ hasText: "Cancelled" }).first(),
    ).toBeVisible();
    await expect(page).toHaveURL(manageUrl.toString());
    await expect(
      page.getByRole("button", { name: "Cancel appointment" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Open change preview" }),
    ).toHaveCount(0);
    await expect(page.getByText("Cut", { exact: true })).toBeVisible();
    await expect(page.getByText("Sam", { exact: true })).toBeVisible();

    const after = await database.pool.query(
      "SELECT revision, status FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(after.rows[0]).toEqual({ revision: 1, status: "cancelled" });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1 AND kind='cancel'",
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
    ).toBeGreaterThanOrEqual(1);

    await page.goto(`http://${owner.subdomain}.${SHOP_SUFFIX}/`);
    await page.locator(`input[name="serviceId"][value="${serviceId}"]`).check();
    await page.getByRole("button", { name: "Choose your barber" }).click();
    await page.locator(`input[name="barberId"][value="${barberId}"]`).check();
    await page.getByRole("button", { name: "Choose date and time" }).click();
    await page.getByLabel("Date", { exact: true }).fill(ELIGIBLE_LOCAL_DATE);
    const released = page.locator(
      `input[name="startAt"][value="${ELIGIBLE_START}"]`,
    );
    await expect(released).toHaveCount(1);
    await expect(released).toBeEnabled();
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("cutoff guidance hides cancellation and a captured POST still denies", async ({
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
  const bookingId = rows[0].id as string;
  const rateKey = createHash("sha256")
    .update(`${rows[0].shop_id}:${token}`)
    .digest("hex");

  try {
    await page.goto(manageUrl.toString());
    await page.getByRole("button", { name: "Cancel appointment" }).click();
    const dialog = page.getByRole("dialog");
    let captured: import("@playwright/test").Request | undefined;
    await page.route("**/*", async (route) => {
      const actionRequest = route.request();
      if (
        actionRequest.method() === "POST" &&
        Boolean(actionRequest.headers()["next-action"])
      ) {
        captured = actionRequest;
        await route.abort();
        return;
      }
      await route.continue();
    });
    await dialog
      .getByRole("button", { name: "Yes, cancel appointment" })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "cancellation result is unknown",
    );
    expect(captured).toBeDefined();
    await page.unrouteAll({ behavior: "wait" });

    const now = Date.parse(
      process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z",
    );
    const start = new Date(now + 11 * 60 * 60_000);
    const end = new Date(start.getTime() + 35 * 60_000);
    await database.pool.query(
      "UPDATE bookings SET start_at=$2, end_at=$3 WHERE id=$1",
      [bookingId, start, end],
    );
    await database.pool.query(
      "UPDATE shops SET public_contact='Call 202-555-0199' WHERE id=$1",
      [owner.shopId],
    );

    await page.goto(manageUrl.toString());
    await expect(
      page.getByRole("button", { name: "Cancel appointment" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Open change preview" }),
    ).toHaveCount(0);
    await expect(page.getByText("Online changes are closed.")).toBeVisible();
    await expect(page.getByText(/within 12 hours of your start/)).toContainText(
      "Call 202-555-0199",
    );

    const action = captured!;
    const response = await request.post(action.url(), {
      headers: {
        "content-type": action.headers()["content-type"],
        "next-action": action.headers()["next-action"],
        origin: `http://${owner.subdomain}.${SHOP_SUFFIX}`,
      },
      data: action.postDataBuffer()!,
    });
    expect(response.status()).toBeLessThan(500);
    expect(await response.text()).toContain("CUTOFF_PASSED");

    const after = await database.pool.query(
      "SELECT status, revision FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(after.rows[0]).toEqual({ status: "confirmed", revision: 0 });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1",
          [bookingId],
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("an owner move while confirmation is open makes the customer request stale", async ({
  page,
  context,
  owners,
  database,
}) => {
  test.setTimeout(60_000);
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
    await page.getByRole("button", { name: "Cancel appointment" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const ownerPage = await context.newPage();
    await ownerPage.goto(`${ownerOrigin}/appointments/${bookingId}`);
    await ownerPage.getByRole("button", { name: "Move appointment" }).click();
    await ownerPage.getByLabel("Start time").fill("21:07");
    await ownerPage.getByRole("button", { name: "Save move" }).click();
    await expect(ownerPage.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await database.pool.query(
              "SELECT revision FROM bookings WHERE id=$1",
              [bookingId],
            )
          ).rows[0].revision,
      )
      .toBe(1);
    await ownerPage.close();

    await dialog
      .getByRole("button", { name: "Yes, cancel appointment" })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("changed");
    await expect(
      dialog.getByRole("button", { name: "Reload booking details" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Yes, cancel appointment" }),
    ).toHaveCount(0);
    const stale = await database.pool.query(
      "SELECT status, revision FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(stale.rows[0]).toEqual({ status: "confirmed", revision: 1 });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1 AND kind='cancel'",
          [bookingId],
        )
      ).rows[0].count,
    ).toBe(0);

    await Promise.all([
      page.waitForURL(manageUrl.toString()),
      dialog.getByRole("button", { name: "Reload booking details" }).click(),
    ]);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(/9:07\sPM/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel appointment" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Yes, cancel appointment" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const after = await database.pool.query(
      "SELECT status, revision FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(after.rows[0]).toEqual({ status: "cancelled", revision: 2 });
    expect(
      (
        await database.pool.query(
          "SELECT kind FROM booking_changes WHERE booking_id=$1 ORDER BY applied_revision",
          [bookingId],
        )
      ).rows.map((row) => row.kind),
    ).toEqual(["move", "cancel"]);
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("uncertain responses never claim success and retry recovers the original operation", async ({
  page,
  context,
  owners,
  database,
}) => {
  test.setTimeout(60_000);
  const owner = await owners(context, { shop: true, published: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await openAllWeek(database.pool, owner, barberId);
  const firstUrl = await createEligibleBooking(
    page,
    owner,
    serviceId,
    barberId,
  );
  const secondUrl = await createEligibleBooking(
    page,
    owner,
    serviceId,
    barberId,
    SECOND_ELIGIBLE_START,
  );
  const firstToken = firstUrl.pathname.split("/").at(-1)!;
  const secondToken = secondUrl.pathname.split("/").at(-1)!;
  const { rows } = await database.pool.query(
    "SELECT id, start_at, shop_id FROM bookings WHERE shop_id=$1 ORDER BY start_at",
    [owner.shopId],
  );
  expect(rows).toHaveLength(2);
  const firstId = rows[0].id as string;
  const secondId = rows[1].id as string;
  const keys = [firstToken, secondToken].map((token) =>
    createHash("sha256").update(`${rows[0].shop_id}:${token}`).digest("hex"),
  );

  try {
    await page.goto(firstUrl.toString());
    await page.getByRole("button", { name: "Cancel appointment" }).click();
    await page.route("**/*", async (route) => {
      const actionRequest = route.request();
      if (
        actionRequest.method() === "POST" &&
        Boolean(actionRequest.headers()["next-action"])
      ) {
        await route.abort();
        return;
      }
      await route.continue();
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Yes, cancel appointment" })
      .click();
    const firstDialog = page.getByRole("dialog");
    await expect(firstDialog.getByRole("alert")).toHaveText(
      "The cancellation result is unknown. Retry or reload your booking details.",
    );
    expect(
      (
        await database.pool.query(
          "SELECT status, revision FROM bookings WHERE id=$1",
          [firstId],
        )
      ).rows[0],
    ).toEqual({ status: "confirmed", revision: 0 });
    await page.unrouteAll({ behavior: "wait" });
    await firstDialog
      .getByRole("button", { name: "Reload booking details" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Confirmed" }),
    ).toBeVisible();

    await page.goto(secondUrl.toString());
    await page.getByRole("button", { name: "Cancel appointment" }).click();
    const bodies: Buffer[] = [];
    await page.route("**/*", async (route) => {
      const actionRequest = route.request();
      if (
        actionRequest.method() === "POST" &&
        Boolean(actionRequest.headers()["next-action"])
      ) {
        bodies.push(actionRequest.postDataBuffer()!);
        if (bodies.length === 1) {
          const response = await route.fetch();
          expect(response.status()).toBeLessThan(500);
          await route.abort();
          return;
        }
      }
      await route.continue();
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Yes, cancel appointment" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("alert")).toHaveText(
      "The cancellation result is unknown. Retry or reload your booking details.",
    );
    await expect(dialog).not.toContainText("remains reserved");
    await expect
      .poll(
        async () =>
          (
            await database.pool.query(
              "SELECT status FROM bookings WHERE id=$1",
              [secondId],
            )
          ).rows[0].status,
      )
      .toBe("cancelled");

    await dialog.getByRole("button", { name: "Retry cancellation" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Cancelled" }).first(),
    ).toBeVisible();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(
      (
        await database.pool.query(
          "SELECT status, revision FROM bookings WHERE id=$1",
          [secondId],
        )
      ).rows[0],
    ).toEqual({ status: "cancelled", revision: 1 });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1",
          [secondId],
        )
      ).rows[0].count,
    ).toBe(1);
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash = ANY($1::text[])",
      [keys],
    );
  }
});

test("full reload after an uncertain response reads persisted cancellation without storage", async ({
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
    const storageBefore = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));
    await page.getByRole("button", { name: "Cancel appointment" }).click();
    await page.route("**/*", async (route) => {
      const actionRequest = route.request();
      if (
        actionRequest.method() === "POST" &&
        Boolean(actionRequest.headers()["next-action"])
      ) {
        await route.fetch();
        await route.abort();
        return;
      }
      await route.continue();
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Yes, cancel appointment" })
      .click();
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
      "The cancellation result is unknown. Retry or reload your booking details.",
    );
    await expect
      .poll(
        async () =>
          (
            await database.pool.query(
              "SELECT status FROM bookings WHERE id=$1",
              [bookingId],
            )
          ).rows[0].status,
      )
      .toBe("cancelled");

    await page.reload();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Cancelled" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cancel appointment" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Open change preview" }),
    ).toHaveCount(0);
    await expect(page.getByText("Cut", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Appointment cancelled. The time has been released."),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        local: { ...localStorage },
        session: { ...sessionStorage },
      })),
    ).toEqual(storageBefore);
    expect(
      await page.evaluate(() => ({
        local: { ...localStorage },
        session: { ...sessionStorage },
      })),
    ).toEqual({ local: {}, session: {} });
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});

test("replacement edit, review, and discard previews remain non-mutating", async ({
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
    const before = await snapshot(database.pool, bookingId, token);
    await page.goto(manageUrl.toString());
    const mutationRequests: Array<{
      method: string;
      url: string;
      postData: string | null;
    }> = [];
    const readActionRequests: Array<{ url: string; postData: string | null }> =
      [];
    page.on("request", (req) => {
      if (!["GET", "HEAD"].includes(req.method())) {
        const postData = req.postData() ?? "";
        const isReadAction =
          req.method() === "POST" &&
          Boolean(req.headers()["next-action"]) &&
          !postData.includes('"confirmed":true');
        if (isReadAction) {
          readActionRequests.push({ url: req.url(), postData });
        } else {
          mutationRequests.push({
            method: req.method(),
            url: req.url(),
            postData,
          });
        }
      }
    });
    const storageBefore = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));
    await page.getByRole("button", { name: "Open change preview" }).click();
    await expect(
      page.getByRole("heading", { name: "A fresh time. Your call." }),
    ).toBeVisible();
    const start = page.getByRole("radio", { name: "09:15", exact: true });
    await expect(start).toBeVisible();
    await start.focus();
    await start.press("Space");
    await expect(start).toBeChecked();
    await page.getByRole("button", { name: "Review change" }).click();
    await expect(
      page.getByRole("heading", { name: "A quick look before we change it." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Confirm appointment change",
        exact: true,
      }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Back to your booking" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Discard preview choices" }).click();
    await expect(
      page.getByRole("button", { name: "Open change preview" }),
    ).toBeVisible();
    expect(mutationRequests).toEqual([]);
    expect(readActionRequests.length).toBeGreaterThan(0);
    expect(
      await page.evaluate(() => ({
        local: { ...localStorage },
        session: { ...sessionStorage },
      })),
    ).toEqual(storageBefore);
    expect(await snapshot(database.pool, bookingId, token)).toEqual(before);
    expect(
      (
        await database.pool.query(
          "SELECT status, revision FROM bookings WHERE id=$1",
          [bookingId],
        )
      ).rows[0],
    ).toEqual({ status: "confirmed", revision: 0 });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1",
          [bookingId],
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    await database.pool.query(
      "DELETE FROM public_rate_keys WHERE scope='customer_change_link' AND key_hash=$1",
      [rateKey],
    );
  }
});
