import { expect, test } from "@playwright/test";

test("home page renders the existing TrimTime entry point", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page).toHaveTitle(/TrimTime/);
  await expect(page.getByRole("img", { name: "TrimTime" })).toBeVisible();
  await expect(page.getByText("A friendlier way to book a barber appointment.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("design system renders its specimens and dialog interaction", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/design-system");
  await expect(page.getByRole("heading", { level: 1, name: /A little more human/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scheduling calendar" })).toBeVisible();

  const lastSectionLink = page
    .getByRole("navigation", { name: "Page sections" })
    .getByRole("link")
    .last();
  const lastLinkTextRight = await lastSectionLink.evaluate((link) => {
    const range = document.createRange();
    range.selectNodeContents(link);
    return range.getBoundingClientRect().right;
  });
  expect(lastLinkTextRight).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );

  const detailsTab = page.getByRole("tab", { name: "Details" });
  await detailsTab.click();
  await expect(detailsTab).toHaveAttribute("aria-selected", "true");

  const trigger = page.getByRole("button", { name: "Open dialog" });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});
