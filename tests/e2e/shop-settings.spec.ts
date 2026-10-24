import { test, expect, ownerOrigin, captureState } from "./fixtures";

test("settings save announces success and survives reload", async ({ page, context, owners }, info) => {
  const owner = await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/settings`);
  await page.getByLabel("Shop name").fill("Updated Fictional Juniper");
  await page.getByLabel("Public contact").fill("Email juniper@example.test");
  await page.getByLabel("Time zone", { exact: true }).fill("UTC");
  await page.getByLabel("Time zone", { exact: true }).press("Enter");
  await expect(page.getByRole("status")).toHaveText("Settings saved.");
  await captureState(page, "settings-success", info);
  await expect(page.getByLabel("Shop name")).toHaveValue("Updated Fictional Juniper");
  await page.reload();
  await expect(page.getByLabel("Shop name")).toHaveValue("Updated Fictional Juniper");
  await expect(page.getByLabel("Public contact")).toHaveValue("Email juniper@example.test");
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue("UTC");
  await expect(page.getByLabel("Subdomain", { exact: true })).toHaveValue(owner.subdomain);
  await expect(page.getByLabel("Subdomain", { exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Address", { exact: true })).toHaveAttribute("readonly", "");
});

test("settings show a complete long read-only address on a phone", async ({ page, context, owners, database }, info) => {
  const owner = await owners(context, { shop: true });
  const address = "123 Fictional Example Street, Second Floor, Brooklyn, New York 11206, United States";
  await database.pool.query("UPDATE shops SET address = $1 WHERE owner_id = $2", [address, owner.id]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${ownerOrigin}/settings`);
  const field = page.getByLabel("Address", { exact: true });
  await expect(field).toHaveValue(address);
  await expect(field).toHaveAccessibleDescription("Read-only. Address editing is not available here.");
  expect(await field.evaluate((element) => element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth)).toBe(true);
  await captureState(page, "settings-long-address", info);
});

test("a real save failure preserves input and committed values, then permits retry", async ({ page, context, owners, database }, info) => {
  const owner = await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/settings`);
  const blocker = await database.pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM shops WHERE owner_id = $1 FOR UPDATE", [owner.id]);
    await page.getByLabel("Shop name").fill("Retry Fictional Juniper");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect(page.getByText("Unable to save your settings.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Shop name")).toHaveValue("Retry Fictional Juniper");
    await captureState(page, "settings-failure", info);
    expect((await database.pool.query("SELECT name FROM shops WHERE owner_id = $1", [owner.id])).rows).toEqual([{ name: "Juniper Barber" }]);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Settings saved.");
  await page.reload();
  await expect(page.getByLabel("Shop name")).toHaveValue("Retry Fictional Juniper");
});

test("invalid settings preserve entered and committed values until corrected", async ({ page, context, owners, database }) => {
  const owner = await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/settings`);
  await page.getByLabel("Shop name").fill("Fictional Invalid Retry");
  await page.getByLabel("Time zone", { exact: true }).fill("not-a-zone");
  await page.getByRole("button", { name: "Save settings" }).click();
  const zone = page.getByLabel("Time zone", { exact: true });
  await expect(zone).toBeFocused();
  await expect(zone).toHaveAccessibleDescription("Enter a valid IANA time zone, such as America/New_York or UTC.");
  await expect(zone).toHaveValue("not-a-zone");
  await expect(page.getByLabel("Shop name")).toHaveValue("Fictional Invalid Retry");
  expect((await database.pool.query("SELECT name, time_zone FROM shops WHERE owner_id = $1", [owner.id])).rows)
    .toEqual([{ name: "Juniper Barber", time_zone: "America/New_York" }]);
  await zone.fill("UTC");
  await zone.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Settings saved.");
  await page.reload();
  await expect(page.getByLabel("Shop name")).toHaveValue("Fictional Invalid Retry");
  await expect(zone).toHaveValue("UTC");
});
