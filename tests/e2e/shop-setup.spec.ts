import {
  test,
  expect,
  openOwnerNavigation,
  ownerOrigin,
  captureState,
} from "./fixtures";

test("new owner creates a draft shop and reaches Calendar", async ({
  page,
  context,
  owners,
  database,
}, info) => {
  const owner = await owners(context);
  await page.goto(ownerOrigin);
  await expect(page).toHaveURL(`${ownerOrigin}/setup`);
  await expect(page.getByLabel("Shop address", { exact: true })).toBeVisible();
  expect(
    await page
      .getByLabel("Shop address", { exact: true })
      .evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(92);
  await captureState(page, "setup", info);
  await page.getByLabel("Shop name").fill("Fictional Juniper");
  await page
    .getByLabel("Booking URL name", { exact: true })
    .fill(owner.subdomain);
  await page.getByLabel("Public contact").fill("Call 202-555-0142");
  await page
    .getByLabel("Shop address", { exact: true })
    .fill("123 Example Street");
  await page.getByRole("button", { name: "Preview draft shop" }).click();
  await expect(
    page.getByRole("heading", { name: "Your shop details" }),
  ).toBeFocused();
  await expect(page.getByText("Review your unsaved details.")).toBeVisible();
  expect(
    (
      await database.pool.query("SELECT id FROM shops WHERE owner_id = $1", [
        owner.id,
      ])
    ).rowCount,
  ).toBe(0);
  const createAction = page.waitForRequest(
    (request) =>
      request.method() === "POST" && Boolean(request.headers()["next-action"]),
  );
  await page.getByRole("button", { name: "Create shop", exact: true }).click();
  const actionRequest = await createAction;
  await expect(
    page.getByRole("heading", { name: "Calendar", exact: true }),
  ).toBeVisible();
  expect(
    (
      await database.pool.query(
        "SELECT name, subdomain, time_zone, public_contact, address FROM shops WHERE owner_id = $1",
        [owner.id],
      )
    ).rows,
  ).toEqual([
    {
      name: "Fictional Juniper",
      subdomain: owner.subdomain,
      time_zone: "America/New_York",
      public_contact: "Call 202-555-0142",
      address: "123 Example Street",
    },
  ]);
  expect(actionRequest.method()).toBe("POST");
  await captureState(page, "today", info);
  await openOwnerNavigation(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(`${ownerOrigin}/settings`);
  await expect(page.getByLabel("Shop name")).toHaveValue("Fictional Juniper");
  await page.reload();
  await expect(page.getByLabel("Shop name")).toHaveValue("Fictional Juniper");
  await expect(page.getByLabel("Subdomain", { exact: true })).toHaveValue(
    owner.subdomain,
  );
});

test("reserved subdomain preserves input and focuses its associated error", async ({
  page,
  context,
  owners,
}, info) => {
  await owners(context);
  await page.goto(`${ownerOrigin}/setup`);
  await page.getByLabel("Shop name").fill("Keep my fictional name");
  await page.getByLabel("Booking URL name", { exact: true }).fill("APP");
  await expect(
    page.getByText("http://your-shop.localhost:3100/", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Example booking URL · enter a valid name to preview your address",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await page.getByLabel("Public contact").fill("Call 202-555-0142");
  await page
    .getByLabel("Shop address", { exact: true })
    .fill("123 Example Street");
  await page.getByRole("button", { name: "Preview draft shop" }).click();
  await expect(
    page.getByText("This subdomain is reserved.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Shop name")).toHaveValue(
    "Keep my fictional name",
  );
  const subdomain = page.getByLabel("Booking URL name", { exact: true });
  await expect(subdomain).toHaveValue("APP");
  await expect(subdomain).toBeFocused();
  await expect(subdomain).toHaveAccessibleDescription(
    /This subdomain is reserved/,
  );
  await captureState(page, "setup-error", info);
});

test("required setup errors retain values and allow a keyboard retry", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context);
  await page.goto(`${ownerOrigin}/setup`);
  for (const label of [
    "Shop name",
    "Shop address",
    "Public contact",
    "Shop time zone",
    "Booking URL name",
  ]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute(
      "required",
      "",
    );
  }
  await page
    .getByLabel("Booking URL name", { exact: true })
    .fill(owner.subdomain);
  await page.getByLabel("Public contact").fill("Call 202-555-0142");
  await page
    .getByLabel("Shop address", { exact: true })
    .fill("123 Example Street");
  await expect(
    page.getByText(
      "Your shop subdomain is permanent in v1. It cannot be renamed after creation.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview draft shop" }).click();
  const name = page.getByLabel("Shop name");
  await expect(name).toBeFocused();
  await expect(name).toHaveAccessibleDescription("This field is required.");
  await expect(
    page.getByLabel("Booking URL name", { exact: true }),
  ).toHaveValue(owner.subdomain);
  await name.fill("Fictional Required Retry");
  await name.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Your shop details" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Create shop", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Calendar", exact: true }),
  ).toBeVisible();
});

test("duplicate subdomain retains details and permits a new name", async ({
  page,
  context,
  browser,
  owners,
}) => {
  const otherContext = await browser.newContext();
  try {
    const existing = await owners(otherContext, { shop: true });
    const owner = await owners(context);
    await page.goto(`${ownerOrigin}/setup`);
    await page.getByLabel("Shop name").fill("Fictional Duplicate Retry");
    await page
      .getByLabel("Booking URL name", { exact: true })
      .fill(existing.subdomain);
    await page.getByLabel("Public contact").fill("Call 202-555-0142");
    await page
      .getByLabel("Shop address", { exact: true })
      .fill("123 Example Street");
    await page.getByRole("button", { name: "Preview draft shop" }).click();
    await page
      .getByRole("button", { name: "Create shop", exact: true })
      .click();
    const conflict = page
      .getByRole("alert")
      .filter({ hasText: "That subdomain is unavailable." });
    await expect(conflict).toBeVisible();
    await expect(conflict).toBeFocused();
    await expect(page.getByLabel("Shop name")).toHaveValue(
      "Fictional Duplicate Retry",
    );
    await expect(
      page.getByLabel("Booking URL name", { exact: true }),
    ).toHaveValue(existing.subdomain);
    await page
      .getByLabel("Booking URL name", { exact: true })
      .fill(owner.subdomain);
    await page.getByLabel("Booking URL name", { exact: true }).press("Enter");
    await expect(
      page.getByRole("heading", { name: "Your shop details" }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Create shop", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Calendar", exact: true }),
    ).toBeVisible();
  } finally {
    await otherContext.close();
  }
});
