import { test, expect, ownerOrigin, captureState } from "./fixtures";

test("new owner creates a draft shop and reaches Today", async ({ page, context, owners }, info) => {
  const owner = await owners(context);
  await page.goto(ownerOrigin);
  await expect(page).toHaveURL(`${ownerOrigin}/setup`);
  await expect(page.getByLabel("Address", { exact: true })).toBeVisible();
  expect(await page.getByLabel("Address", { exact: true }).evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(92);
  await captureState(page, "setup", info);
  await page.getByLabel("Shop name").fill("Fictional Juniper");
  await page.getByLabel("Subdomain", { exact: true }).fill(owner.subdomain);
  await page.getByLabel("Public contact").fill("Call 202-555-0142");
  await page.getByLabel("Address", { exact: true }).fill("123 Example Street");
  await page.getByRole("button", { name: "Create draft shop" }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByText("Draft shop", { exact: true })).toBeVisible();
  await captureState(page, "today", info);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(`${ownerOrigin}/settings`);
  await expect(page.getByLabel("Shop name")).toHaveValue("Fictional Juniper");
  await page.reload();
  await expect(page.getByLabel("Shop name")).toHaveValue("Fictional Juniper");
  await expect(page.getByLabel("Subdomain", { exact: true })).toHaveValue(owner.subdomain);
});

test("reserved subdomain preserves input and focuses its associated error", async ({ page, context, owners }, info) => {
  await owners(context);
  await page.goto(`${ownerOrigin}/setup`);
  await page.getByLabel("Shop name").fill("Keep my fictional name");
  await page.getByLabel("Subdomain", { exact: true }).fill("APP");
  await expect(page.getByText("app.trimtime.com", { exact: true })).toBeVisible();
  await expect(page.getByText("Illustrative booking address · not live", { exact: true })).toBeVisible();
  await page.getByLabel("Public contact").fill("Call 202-555-0142");
  await page.getByLabel("Address", { exact: true }).fill("123 Example Street");
  await page.getByRole("button", { name: "Create draft shop" }).click();
  await expect(page.getByText("This subdomain is reserved.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Shop name")).toHaveValue("Keep my fictional name");
  const subdomain = page.getByLabel("Subdomain", { exact: true });
  await expect(subdomain).toHaveValue("APP");
  await expect(subdomain).toBeFocused();
  await expect(subdomain).toHaveAccessibleDescription(/This subdomain is reserved/);
  await captureState(page, "setup-error", info);
});

test("required setup errors retain values and allow a keyboard retry", async ({ page, context, owners }) => {
  const owner = await owners(context);
  await page.goto(`${ownerOrigin}/setup`);
  for (const label of ["Shop name", "Address", "Public contact", "Time zone", "Subdomain"]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute("required", "");
  }
  await page.getByLabel("Subdomain", { exact: true }).fill(owner.subdomain);
  await page.getByLabel("Public contact").fill("Call 202-555-0142");
  await page.getByLabel("Address", { exact: true }).fill("123 Example Street");
  await expect(page.getByText("This permanent address cannot be changed later.")).toBeVisible();
  await page.getByRole("button", { name: "Create draft shop" }).click();
  const name = page.getByLabel("Shop name");
  await expect(name).toBeFocused();
  await expect(name).toHaveAccessibleDescription("This field is required.");
  await expect(page.getByLabel("Subdomain", { exact: true })).toHaveValue(owner.subdomain);
  await name.fill("Fictional Required Retry");
  await name.press("Enter");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
});

test("duplicate subdomain retains details and permits a new name", async ({ page, context, browser, owners }) => {
  const otherContext = await browser.newContext();
  try {
    const existing = await owners(otherContext, { shop: true });
    const owner = await owners(context);
    await page.goto(`${ownerOrigin}/setup`);
    await page.getByLabel("Shop name").fill("Fictional Duplicate Retry");
    await page.getByLabel("Subdomain", { exact: true }).fill(existing.subdomain);
    await page.getByLabel("Public contact").fill("Call 202-555-0142");
    await page.getByLabel("Address", { exact: true }).fill("123 Example Street");
    await page.getByRole("button", { name: "Create draft shop" }).click();
    const conflict = page.getByRole("alert").filter({ hasText: "That subdomain is unavailable." });
    await expect(conflict).toBeVisible();
    await expect(conflict).toBeFocused();
    await expect(page.getByLabel("Shop name")).toHaveValue("Fictional Duplicate Retry");
    await expect(page.getByLabel("Subdomain", { exact: true })).toHaveValue(existing.subdomain);
    await page.getByLabel("Subdomain", { exact: true }).fill(owner.subdomain);
    await page.getByLabel("Subdomain", { exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  } finally {
    await otherContext.close();
  }
});
