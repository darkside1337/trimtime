import { test, expect, ownerOrigin, captureState } from "./fixtures";

test("setup and settings are reachable by keyboard with reduced motion", async ({ page, context, owners }, info) => {
  const owner = await owners(context);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${ownerOrigin}/setup`);
  await expect(page.getByLabel("Shop name")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "TrimTime", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeFocused();
  for (const [label, value] of [
    ["Shop name", "Fictional Keyboard Shop"],
    ["Address", "123 Example Street"],
    ["Public contact", "Call 202-555-0142"],
    ["Time zone", "UTC"],
    ["Subdomain", owner.subdomain],
  ]) {
    await page.keyboard.press("Tab");
    const field = page.getByLabel(label, { exact: true });
    await expect(field).toBeFocused();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(value);
    const focus = await field.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(parseFloat(focus.width)).toBeGreaterThan(0);
    expect(focus.style).not.toBe("none");
  }
  await page.keyboard.press("Tab");
  const create = page.getByRole("button", { name: "Create draft shop" });
  await expect(create).toBeFocused();
  expect(await create.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.001);
  await captureState(page, "setup-keyboard", info);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();

  await page.goto(`${ownerOrigin}/settings`);
  await expect(page.getByLabel("Shop name")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "TrimTime", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Back to Today", exact: true })).toBeFocused();
  for (const label of ["Shop name", "Public contact", "Time zone", "Subdomain", "Address"]) {
    await page.keyboard.press("Tab");
    await expect(page.getByLabel(label, { exact: true })).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Save settings" })).toBeFocused();
  await captureState(page, "settings-keyboard", info);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Settings saved.");
});
