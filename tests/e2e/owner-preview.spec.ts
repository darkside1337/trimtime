import {
  expect,
  captureState,
  marketingOrigin,
  openOwnerNavigation,
  ownerOrigin,
  test,
} from "./fixtures";

test("owner Activity shows a real empty state for a shop without notification records", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true, name: "Preview Test Shop" });
  await page.goto(`${ownerOrigin}/activity`);
  await expect(
    page.getByRole("heading", { name: "Booking activity & message status" }),
  ).toBeVisible();
  await expect(
    page.getByText("Live notification records", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No notification records yet for this shop."),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText("Preview Test Shop", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText("America/New_York", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("96.4% accepted", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Sample · accepted", { exact: true }),
  ).toHaveCount(0);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await captureState(page, `phase07-activity-empty-${width}`, test.info());
  }
});

test("calendar and Activity contain only persisted owner data", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/`);
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await expect(page.getByText("No appointments in this range.")).toBeVisible();
  await expect(page.getByText(/Sample appointments/i)).toHaveCount(0);
  await page.getByRole("link", { name: "Next date" }).click();
  await expect(page).toHaveURL(/date=/);
  await page.getByRole("link", { name: "Week", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Weekly schedule" }),
  ).toBeVisible();
  await openOwnerNavigation(page);
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Booking activity & message status" }),
  ).toBeVisible();
  await expect(
    page.getByText("No notification records yet for this shop."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resend unavailable" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Export unavailable" }),
  ).toBeDisabled();
  await page.getByLabel("Search activity").fill("no matches");
  await expect(
    page.getByText("No notification records yet for this shop."),
  ).toBeVisible();
});

test("Activity requires an owner", async ({ page }) => {
  await page.goto(`${ownerOrigin}/activity`);
  await expect(page).toHaveURL(`${ownerOrigin}/sign-in`);
});

test("Activity requires a shop for a signed-in owner", async ({
  page,
  context,
  owners,
}) => {
  await owners(context);
  await page.goto(`${ownerOrigin}/activity`);
  await expect(page).toHaveURL(`${ownerOrigin}/setup`);
});

test("design-system section navigation fits a 390px viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${marketingOrigin}/design-system`);
  const nav = page.getByRole("navigation", { name: "Page sections" });
  await expect(nav.getByRole("link", { name: "Components" })).toBeVisible();
  expect(
    await nav.evaluate((element) => element.scrollWidth),
  ).toBeLessThanOrEqual(await nav.evaluate((element) => element.clientWidth));
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
