import { test, expect, marketingOrigin, ownerOrigin } from "./fixtures";

test("marketing preview covers the owner entry and static customer sample", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(marketingOrigin);

  await expect(
    page.getByRole("heading", { name: "Keep the whole shop on schedule." }),
  ).toBeVisible();
  for (const heading of [
    "Handle the changes that make up a day.",
    "Let customers choose. Keep the schedule in view.",
    "Before you set up shop.",
    "Give every appointment a place in the day.",
  ])
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await expect(
    page.getByText("Design preview · fictional sample data"),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Illustrative calendar for a fictional barber shop",
    }),
  ).toBeVisible();
  await expect(page.getByText("30 min · $15", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Static customer booking preview" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("menuitem", { name: "FAQs" }).click();
  await expect(page).toHaveURL(`${marketingOrigin}/#faq`);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("menuitem", { name: "Try booking" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Preview Customer Booking" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Preview Customer Booking" }),
  ).toHaveCount(0);
  await page
    .getByRole("region", { name: /Keep the whole shop/ })
    .getByRole("button", { name: "Try booking" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Preview Customer Booking" }),
  ).toBeVisible();
  await expect(
    page.getByText(/creates no appointment and sends no real messages/),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Preview Customer Booking" }),
  ).toHaveCount(0);
  await page
    .getByRole("region", { name: /Keep the whole shop/ })
    .getByRole("button", { name: "Try booking" })
    .click();
  await page.getByRole("link", { name: "View booking preview" }).click();
  await expect(page).toHaveURL(`${marketingOrigin}/#customer-booking`);

  await page.getByRole("link", { name: "Create a shop" }).first().click();
  await expect(page).toHaveURL(`${ownerOrigin}/sign-in`);
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
});
