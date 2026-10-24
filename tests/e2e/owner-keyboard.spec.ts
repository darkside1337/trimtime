import { test, expect, ownerOrigin, captureState } from "./fixtures";

test("setup and settings are reachable by keyboard with reduced motion", async ({
  page,
  context,
  owners,
}, info) => {
  const owner = await owners(context);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${ownerOrigin}/setup`);
  await expect(page.getByLabel("Shop name")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "TrimTime", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeFocused();
  for (const [label, value] of [
    ["Shop name", "Fictional Keyboard Shop"],
    ["Shop address", "123 Example Street"],
    ["Public contact", "Call 202-555-0142"],
    ["Shop time zone", "UTC"],
    ["Booking URL name", owner.subdomain],
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
  const review = page.getByRole("button", { name: "Preview draft shop" });
  await expect(review).toBeFocused();
  expect(
    await review.evaluate((element) =>
      parseFloat(getComputedStyle(element).transitionDuration),
    ),
  ).toBeLessThanOrEqual(0.001);
  await captureState(page, "setup-keyboard", info);
  await page.keyboard.press("Enter");
  const reviewHeading = page.getByRole("heading", {
    name: "Your shop details",
  });
  await expect(reviewHeading).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Edit details" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Create shop" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Calendar", exact: true }),
  ).toBeVisible();

  await page.goto(`${ownerOrigin}/settings`);
  await expect(page.getByLabel("Shop name")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "TrimTime", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const mobile = page.viewportSize()!.width <= 900;
  if (mobile) {
    await expect(
      page.getByRole("button", { name: "Open navigation" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Close navigation" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
  }
  for (const [index, label] of [
    "Calendar",
    "Services",
    "Barbers",
    "Availability",
    "Activity",
    "Settings",
  ].entries()) {
    if (index > 0) await page.keyboard.press("Tab");
    await expect(
      page
        .getByRole("navigation", { name: "Owner navigation" })
        .getByRole("link", { name: label, exact: true }),
    ).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeFocused();
  if (mobile) {
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Open navigation" }),
    ).toBeFocused();
  }
  for (const label of [
    "Shop name",
    "Public contact",
    "Address",
    "Subdomain",
    "Time zone",
  ]) {
    await page.keyboard.press("Tab");
    await expect(page.getByLabel(label, { exact: true })).toBeFocused();
  }
  const saveSettings = page.getByRole("button", { name: "Save settings" });
  for (let steps = 0; steps < 16; steps++) {
    if (
      await saveSettings.evaluate(
        (element) => element === document.activeElement,
      )
    )
      break;
    await page.keyboard.press("Tab");
  }
  await expect(
    page.getByRole("button", { name: "Save settings" }),
  ).toBeFocused();
  await captureState(page, "settings-keyboard", info);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Settings saved.");
});
