import { expect, type Page } from "@playwright/test";

export async function chooseBookingOptions(
  page: Page,
  {
    serviceId,
    barberId,
    date,
    startIndex = 0,
  }: { serviceId: string; barberId: string; date: string; startIndex?: number },
) {
  await page.locator(`input[name="serviceId"][value="${serviceId}"]`).check();
  await page.getByRole("button", { name: "Choose your barber" }).click();
  await page.locator(`input[name="barberId"][value="${barberId}"]`).check();
  await page.getByRole("button", { name: "Choose date and time" }).click();
  await page.getByLabel("Date", { exact: true }).fill(date);
  const starts = page.locator('input[name="startAt"]');
  await expect(starts.first()).toBeVisible();
  await starts.nth(startIndex).check();
  await page.getByRole("button", { name: "Your details", exact: true }).click();
}
