import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  ownerOrigin,
  captureState,
  type Owner,
} from "./fixtures";
import { addReadyCatalog } from "./publication-fixtures";
import { chooseBookingOptions } from "./booking-flow-helpers";

const budgetDay = new Date(
  process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z",
)
  .toISOString()
  .slice(0, 10);

test.skip(
  process.env.TRIMTIME_E2E_EMAIL_MODE !== "mailpit-double",
  "requires the isolated Mailpit HTTP double",
);

test("owner Activity shows the two persisted notification rows for a booking", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const catalog = await prepareShop(page, owner, database);
  const manageUrl = await makeBooking(
    page,
    owner,
    catalog,
    `activity-${randomUUID()}@example.test`,
  );
  await expectShopDispatchToFinish(database, owner.shopId);
  const { rows } = await database.pool.query(
    "SELECT w.id, w.booking_id FROM notification_work w JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1 ORDER BY w.kind",
    [owner.shopId],
  );
  expect(rows).toHaveLength(2);

  await page.goto(`${ownerOrigin}/activity`);
  await expect(page.getByText("Sample activity", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.locator("article").filter({ hasText: String(rows[0].booking_id) }),
  ).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Event details" })).toHaveCount(
    2,
  );
  await expect(
    page.getByText("Captured locally", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search activity").fill("customer confirmation");
  await expect(
    page.locator("article").filter({ hasText: "Customer confirmation" }),
  ).toHaveCount(1);
  await page.getByLabel("Search activity").fill("owner alert");
  await expect(
    page.locator("article").filter({ hasText: "Owner alert" }),
  ).toHaveCount(1);
  await page.getByLabel("Search activity").clear();
  await page.getByLabel("Search activity").fill("no-real-match");
  await expect(
    page.getByText("No messages match these filters."),
  ).toBeVisible();
  await page.getByLabel("Search activity").clear();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await captureState(page, `phase07-activity-results-${width}`, test.info());
    expect(
      await page
        .getByRole("group", { name: "Activity type" })
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.every((button) => button.scrollWidth <= button.clientWidth),
        ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Event details" }).first().click();
  const details = page.getByRole("dialog", { name: "Message details" });
  await expect(details).toContainText("Budget reservation");
  await expect(details).toContainText("Transport invocation");
  await expect(details).toContainText("Attempt outcome");
  await expect(details).toContainText("Capture ID");
  await expect(details).toContainText("inbox delivery is not enabled");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await captureState(page, `phase07-activity-details-${width}`, test.info());
  }
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Event details" }).first(),
  ).toBeFocused();
  expect(manageUrl.pathname).toContain("/manage/");
});

test("Activity stays scoped to its owner and rejects fabricated evidence posts", async ({
  page,
  context,
  browser,
  owners,
  database,
}) => {
  const ownerA = await owners(context, { shop: true });
  const catalog = await prepareShop(page, ownerA, database);
  await makeBooking(
    page,
    ownerA,
    catalog,
    `scope-${randomUUID()}@example.test`,
  );
  await expectShopDispatchToFinish(database, ownerA.shopId);
  const { rows } = await database.pool.query(
    "SELECT w.id, w.status FROM notification_work w JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1",
    [ownerA.shopId],
  );

  const ownerBContext = await browser.newContext();
  try {
    await owners(ownerBContext, {
      shop: true,
      name: "Other Shop",
    });
    const ownerBPage = await ownerBContext.newPage();
    await ownerBPage.goto(`${ownerOrigin}/activity`);
    await expect(
      ownerBPage.getByText("No notification records yet for this shop."),
    ).toBeVisible();
    await expect(ownerBPage.getByText(String(rows[0].id))).toHaveCount(0);
    const activityPost = await page.request.post(`${ownerOrigin}/activity`, {
      data: { id: rows[0].id, status: "delivered", captureId: "forged" },
    });
    const evidencePost = await page.request.post(
      `${ownerOrigin}/activity/evidence`,
      {
        data: { id: rows[0].id, status: "captured", captureId: "forged" },
      },
    );
    expect([404, 405]).toContain(activityPost.status());
    expect([404, 405]).toContain(evidencePost.status());
    const after = await database.pool.query(
      "SELECT w.id, w.status FROM notification_work w JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1 ORDER BY w.id",
      [ownerA.shopId],
    );
    expect(after.rows.map((item) => [item.id, item.status]).sort()).toEqual(
      rows.map((item) => [item.id, item.status]).sort(),
    );
    await page.goto(`${ownerOrigin}/activity`);
    await expect(
      page.getByRole("button", { name: "Event details" }),
    ).toHaveCount(2);
  } finally {
    await ownerBContext.close();
  }
});

test("Activity treats a reservation-only stale claim as unknown without mutation", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const catalog = await prepareShop(page, owner, database);
  await makeBooking(
    page,
    owner,
    catalog,
    `reservation-${randomUUID()}@example.test`,
  );
  await expectShopDispatchToFinish(database, owner.shopId);
  await database.pool.query(
    `UPDATE notification_attempts a SET invoked_at=NULL, outcome=NULL, capture_id=NULL
     FROM notification_work w, bookings b
     WHERE a.work_id=w.id AND w.booking_id=b.id AND b.shop_id=$1`,
    [owner.shopId],
  );
  await database.pool.query(
    `UPDATE notification_work w SET status='sending', claimed_at=now()-INTERVAL '1 minute',
      claim_id=a.id, reason=NULL
     FROM notification_attempts a, bookings b
     WHERE a.work_id=w.id AND w.booking_id=b.id AND b.shop_id=$1`,
    [owner.shopId],
  );
  const before = await database.pool.query(
    "SELECT w.id, w.status, a.invoked_at, a.outcome, a.capture_id FROM notification_work w JOIN bookings b ON b.id=w.booking_id JOIN notification_attempts a ON a.work_id=w.id WHERE b.shop_id=$1 ORDER BY w.id",
    [owner.shopId],
  );

  await page.goto(`${ownerOrigin}/activity`);
  await expect(
    page.getByText("Unknown · invocation/result uncertain").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Event details" }).first().click();
  const details = page.getByRole("dialog", { name: "Message details" });
  await expect(details).toContainText("dispatch_interrupted");
  await expect(
    details.getByText("Not confirmed", { exact: true }),
  ).toBeVisible();
  await expect(details.getByText("unknown", { exact: true })).toBeVisible();
  await expect(details.getByText("None", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const after = await database.pool.query(
    "SELECT w.id, w.status, a.invoked_at, a.outcome, a.capture_id FROM notification_work w JOIN bookings b ON b.id=w.booking_id JOIN notification_attempts a ON a.work_id=w.id WHERE b.shop_id=$1 ORDER BY w.id",
    [owner.shopId],
  );
  expect(after.rows).toEqual(before.rows);
});

async function prepareShop(
  page: import("@playwright/test").Page,
  owner: Owner,
  database: { pool: import("pg").Pool },
) {
  const catalog = await addReadyCatalog(database.pool, owner);
  await page.goto(`${ownerOrigin}/settings`);
  await page.getByRole("button", { name: "Publish shop" }).click();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();
  return catalog;
}

async function makeBooking(
  page: import("@playwright/test").Page,
  owner: Owner,
  catalog: { serviceId: string; barberId: string },
  email: string,
) {
  await page.goto(`http://${owner.subdomain}.localhost:3100/`);
  await chooseBookingOptions(page, {
    ...catalog,
    date: "2026-11-02",
  });
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(
    page.getByRole("heading", { name: "Your chair is reserved." }),
  ).toBeVisible();
  const link = page.getByRole("link", { name: "Open booking details" });
  await expect(link).toBeVisible();
  return new URL((await link.getAttribute("href"))!, page.url());
}

async function expectShopDispatchToFinish(
  database: { pool: import("pg").Pool },
  shopId: string,
) {
  await expect
    .poll(async () => {
      const { rows } = await database.pool.query(
        "SELECT count(*)::int AS pending FROM notification_work w JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1 AND w.channel='email' AND w.status IN ('not_attempted','sending')",
        [shopId],
      );
      return rows[0].pending;
    })
    .toBe(0);
}

test("receipt and manage link stay immediate while local capture is pending", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const catalog = await prepareShop(page, owner, database);
  const email = `delay-${randomUUID()}@example.test`;
  const manageUrl = await makeBooking(page, owner, catalog, email);
  await expect(page.getByText(/pending local capture/i)).toBeVisible();

  await expect
    .poll(async () => {
      const { rows } = await database.pool.query(
        "SELECT w.status FROM notification_work w JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1 AND w.kind='customer_confirmation' AND w.channel='email'",
        [owner.shopId],
      );
      return rows[0]?.status;
    })
    .toBe("sending");

  const managePage = await context.newPage();
  await managePage.goto(manageUrl.href);
  await expect(managePage.getByText(/pending local capture/i)).toBeVisible();
  const refreshMethods: string[] = [];
  const recordRefresh = (request: import("@playwright/test").Request) => {
    if (new URL(request.url()).pathname === manageUrl.pathname)
      refreshMethods.push(request.method());
  };
  managePage.on("request", recordRefresh);

  await expect
    .poll(async () => {
      const { rows } = await database.pool.query(
        "SELECT w.status FROM notification_work w JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1 AND w.kind='customer_confirmation' AND w.channel='email'",
        [owner.shopId],
      );
      return rows[0]?.status;
    })
    .toBe("captured");
  await expectShopDispatchToFinish(database, owner.shopId);
  const beforeRefresh = await database.pool.query(
    "SELECT w.status, w.reason, w.updated_at, count(a.id)::int AS attempts, max(a.invoked_at) AS last_invoked_at FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1 AND w.kind='customer_confirmation' AND w.channel='email' GROUP BY w.id",
    [owner.shopId],
  );
  const refresh = managePage.getByRole("button", {
    name: "Refresh message status",
  });
  await refresh.focus();
  await managePage.keyboard.press("Enter");
  await expect(managePage.getByText(/Captured locally/i)).toBeVisible();
  await expect(refresh).toBeFocused();
  managePage.off("request", recordRefresh);
  expect(refreshMethods).toContain("GET");
  expect(refreshMethods).not.toContain("POST");
  const afterRefresh = await database.pool.query(
    "SELECT w.status, w.reason, w.updated_at, count(a.id)::int AS attempts, max(a.invoked_at) AS last_invoked_at FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1 AND w.kind='customer_confirmation' AND w.channel='email' GROUP BY w.id",
    [owner.shopId],
  );
  expect(afterRefresh.rows).toEqual(beforeRefresh.rows);
  await expect(managePage.getByText("Cut", { exact: true })).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await managePage.setViewportSize({ width, height: 900 });
    await captureState(
      managePage,
      `phase07-manage-captured-${width}`,
      test.info(),
    );
  }
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await captureState(page, `phase07-receipt-${width}`, test.info());
  }
  await managePage.close();
});

test("rejected and unknown captures leave booking details and link usable", async ({
  page,
  context,
  owners,
  database,
}) => {
  for (const [prefix, outcome, copy] of [
    ["reject-4xx-", "failed", "capture service rejected"],
    ["timeout-", "unknown", "result is unknown"],
  ] as const) {
    const owner = await owners(context, { shop: true });
    const catalog = await prepareShop(page, owner, database);
    const manageUrl = await makeBooking(
      page,
      owner,
      catalog,
      `${prefix}${randomUUID()}@example.test`,
    );
    await expect
      .poll(async () => {
        const { rows } = await database.pool.query(
          "SELECT w.status FROM notification_work w JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1 AND w.kind='customer_confirmation' AND w.channel='email'",
          [owner.shopId],
        );
        return rows[0]?.status;
      })
      .toBe(outcome);
    await expectShopDispatchToFinish(database, owner.shopId);
    await page.goto(manageUrl.href);
    await expect(
      page.getByRole("complementary").getByText("Juniper Barber", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(new RegExp(copy, "i"))).toBeVisible();
    await expect(page.getByText("Cut", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh message status" }),
    ).toBeEnabled();
    await page.goto(`${ownerOrigin}/activity`);
    await page.getByRole("button", { name: /Customer confirmation/ }).click();
    if (outcome === "failed") {
      await expect(
        page.getByText("failed", { exact: true }).first(),
      ).toBeVisible();
      await page.getByRole("button", { name: "Event details" }).first().click();
      await expect(page.getByRole("dialog")).toContainText(
        "permanent_rejection",
      );
      await page.keyboard.press("Escape");
    } else {
      await expect(
        page.getByText("Unknown · invocation/result uncertain").first(),
      ).toBeVisible();
      await page.getByRole("button", { name: "Event details" }).first().click();
      await expect(page.getByRole("dialog")).toContainText(
        "transport_interrupted",
      );
      await page.keyboard.press("Escape");
    }
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await captureState(
        page,
        `phase07-activity-${outcome}-${width}`,
        test.info(),
      );
    }
  }
});

test("successful recovery ignores forged delivery fields and does not resend", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const catalog = await prepareShop(page, owner, database);
  const capturedAction: {
    current?: {
      url: string;
      action: string;
      routerStateTree: string;
      body: Record<string, unknown>;
    };
  } = {};
  const captureAction = (request: import("@playwright/test").Request) => {
    const headers = request.headers();
    const postData = request.postData();
    if (request.method() !== "POST" || !headers["next-action"] || !postData)
      return;
    const [body] = JSON.parse(postData) as [Record<string, unknown>];
    if (typeof body.recoveryKey !== "string") return;
    capturedAction.current = {
      url: request.url(),
      action: headers["next-action"],
      routerStateTree: headers["next-router-state-tree"],
      body,
    };
  };
  page.on("request", captureAction);
  await makeBooking(
    page,
    owner,
    catalog,
    `success-${randomUUID()}@example.test`,
  );
  page.off("request", captureAction);
  await expectShopDispatchToFinish(database, owner.shopId);
  expect(capturedAction.current).toBeDefined();
  const action = capturedAction.current;
  if (!action) return;

  const before = await database.pool.query(
    "SELECT w.kind, w.recipient, w.status, w.reason, count(a.id)::int AS attempts FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1 AND w.channel='email' GROUP BY w.id ORDER BY w.kind",
    [owner.shopId],
  );
  const forgedBody = { ...action.body };
  const contact = { ...(forgedBody.contact as Record<string, unknown>) };
  delete contact.phone;
  forgedBody.contact = contact;
  forgedBody.recipient = `forged-${randomUUID()}@example.test`;
  forgedBody.status = "delivered";
  forgedBody.delivered = true;

  const response = await context.request.post(action.url, {
    data: JSON.stringify([forgedBody]),
    headers: {
      accept: "text/x-component",
      "content-type": "text/plain;charset=UTF-8",
      origin: new URL(action.url).origin,
      referer: action.url,
      "next-action": action.action,
      "next-router-state-tree": action.routerStateTree,
    },
  });
  expect(response.ok()).toBe(true);
  await expectShopDispatchToFinish(database, owner.shopId);
  const after = await database.pool.query(
    "SELECT w.kind, w.recipient, w.status, w.reason, count(a.id)::int AS attempts FROM notification_work w LEFT JOIN notification_attempts a ON a.work_id=w.id JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1 AND w.channel='email' GROUP BY w.id ORDER BY w.kind",
    [owner.shopId],
  );
  expect(after.rows).toEqual(before.rows);
  expect(after.rows.some((row) => row.recipient?.startsWith("forged-"))).toBe(
    false,
  );
  expect(after.rows.every((row) => row.status !== "delivered")).toBe(true);
});

test("an exhausted local budget still leaves the customer link readable", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const catalog = await prepareShop(page, owner, database);
  await database.pool.query(
    "INSERT INTO outbound_budget (day, allocation_count) VALUES ($1, 100) ON CONFLICT (day) DO UPDATE SET allocation_count=100",
    [budgetDay],
  );
  const manageUrl = await makeBooking(
    page,
    owner,
    catalog,
    `success-${randomUUID()}@example.test`,
  );
  await expect
    .poll(async () => {
      const { rows } = await database.pool.query(
        "SELECT w.status FROM notification_work w JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1 AND w.kind='customer_confirmation' AND w.channel='email'",
        [owner.shopId],
      );
      return rows[0]?.status;
    })
    .toBe("skipped");
  await expectShopDispatchToFinish(database, owner.shopId);
  await page.goto(manageUrl.href);
  await expect(
    page.getByText("Today's local message allowance is full"),
  ).toBeVisible();
  await expect(page.getByText("Cut", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh message status" }),
  ).toBeVisible();
  await page.goto(`${ownerOrigin}/activity`);
  await expect(
    page.getByText("skipped", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Event details" }).first().click();
  await expect(page.getByRole("dialog")).toContainText(
    "daily_budget_exhausted",
  );
});
