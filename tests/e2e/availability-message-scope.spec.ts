import { randomUUID } from "node:crypto";
import { expect, ownerOrigin, test } from "./fixtures";

test("recurring feedback is hidden when the dates panel is selected", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);

  const message = "Monday copied into the weekday draft. Save to apply.";
  await page.getByRole("button", { name: "Copy Mon to weekdays" }).click();
  await expect(page.getByRole("status")).toHaveText(message);

  await page.getByRole("tab", { name: /Date overrides & blocks/ }).click();
  await expect(page.locator("#availability-panel-dates")).toBeVisible();
  await expect(page.getByText(message)).toBeHidden();
  await expect(page.locator("#availability-panel-dates")).not.toContainText(
    message,
  );
});

test("recurring field errors remain in the weekly panel", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);
  await page.getByRole("button", { name: "Add hours" }).first().click();
  await page.getByLabel("Opens").first().fill("");
  await page.getByRole("button", { name: "Save hours" }).click();

  const weeklyPanel = page.locator("#availability-panel-weekly");
  await expect(
    weeklyPanel
      .getByRole("alert")
      .getByText("Enter a valid 24-hour time.", { exact: true }),
  ).toBeVisible();
});

test("reselecting the active barber preserves a dirty weekly draft", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const barberId = randomUUID();
  const shopWeek = Array.from({ length: 7 }, (_, index) => ({
    working: index === 0 ? [{ start: 540, end: 1020 }] : [],
    breaks: [],
  }));
  const barberWeek = structuredClone(shopWeek);
  barberWeek[0]!.working = [{ start: 600, end: 1080 }];
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Same target barber')",
    [barberId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO shop_schedules (shop_id, week, revision) VALUES ($1, $2::jsonb, 1)",
    [owner.shopId, JSON.stringify(shopWeek)],
  );
  await database.pool.query(
    "INSERT INTO barber_schedules (shop_id, barber_id, week, revision) VALUES ($1, $2, $3::jsonb, 1)",
    [owner.shopId, barberId, JSON.stringify(barberWeek)],
  );

  await page.goto(`${ownerOrigin}/availability`);
  await page.getByRole("tab", { name: "Barber schedules" }).click();
  const barberButton = page.getByRole("button", { name: "Same target barber" });
  await expect(barberButton).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Opens").first().fill("10:15");
  await barberButton.click();

  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Opens").first()).toHaveValue("10:15");
});
