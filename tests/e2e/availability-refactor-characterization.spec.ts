import { randomUUID } from "node:crypto";
import { expect, ownerOrigin, test } from "./fixtures";

const nextAction = (request: import("@playwright/test").Request) =>
  request.method() === "POST" && Boolean(request.headers()["next-action"]);

async function loadShopDate(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: "Add date override or block" })
    .click();
  await page.getByLabel("Schedule day").fill("2026-11-02");
  const request = page.waitForRequest(nextAction);
  await page.getByRole("button", { name: "Load date" }).click();
  await request;
}

async function resolveBoundary(
  page: import("@playwright/test").Page,
  label: string,
) {
  const response = page.waitForResponse((response) =>
    nextAction(response.request()),
  );
  await page.getByRole("button", { name: label }).click();
  await response;
}

test("a dirty weekly draft prompts before opening the dates tab and survives Keep editing", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);
  for (const [tabId, panelId] of [
    ["availability-tab-shop", "availability-panel-weekly"],
    ["availability-tab-barber", "availability-panel-weekly"],
    ["availability-tab-dates", "availability-panel-dates"],
  ]) {
    await expect(page.locator(`#${tabId}`)).toHaveAttribute(
      "aria-controls",
      panelId,
    );
  }
  await expect(page.locator("#availability-panel-weekly")).toHaveAttribute(
    "aria-labelledby",
    "availability-tab-shop",
  );
  await page.getByRole("button", { name: "Add hours" }).first().click();
  await page.getByLabel("Opens").first().fill("10:00");

  const datesTab = page.getByRole("tab", { name: /Date overrides & blocks/ });
  await datesTab.click();
  const discard = page.getByRole("dialog", {
    name: "Discard unsaved changes?",
  });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Keep editing" }).click();

  await expect(page.getByLabel("Opens").first()).toHaveValue("10:00");
  await expect(datesTab).toHaveAttribute("aria-selected", "false");
  await datesTab.click();
  await page
    .getByRole("dialog", { name: "Discard unsaved changes?" })
    .getByRole("button", { name: "Discard changes" })
    .click();

  await expect(datesTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#availability-panel-dates")).toBeVisible();
  await expect(page.locator("#availability-panel-dates")).toHaveAttribute(
    "aria-labelledby",
    "availability-tab-dates",
  );
});

test("dated schedule edits keep time-block actions disabled while the block view is open", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  const barberId = randomUUID();
  await database.pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Dirty draft barber')",
    [barberId, owner.shopId],
  );

  await page.goto(`${ownerOrigin}/availability`);
  await loadShopDate(page);
  await page.getByLabel("Exception type").selectOption("block");
  await page.getByLabel("Barber for this time block").selectOption(barberId);
  await page.getByLabel("Start (shop local time)").fill("10:00");
  await resolveBoundary(page, "Resolve start");
  await page.getByLabel("End (shop local time, 24:00 allowed)").fill("10:30");
  await resolveBoundary(page, "Resolve end");
  await page.getByRole("button", { name: "Save time block" }).click();
  await expect(
    page.getByText(
      "Block saved. Preview again to see the updated availability.",
    ),
  ).toBeVisible();

  await page.getByLabel("Exception type").selectOption("date");
  await page
    .getByRole("checkbox", {
      name: "Close the shop for this date",
      exact: true,
    })
    .check();
  await page.getByLabel("Exception type").selectOption("block");

  await expect(
    page.getByRole("button", { name: "Resolve start" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save time block" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Remove", exact: true }),
  ).toBeDisabled();
});
