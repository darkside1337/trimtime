import {
  captureState,
  expect,
  openOwnerNavigation,
  ownerOrigin,
  test,
} from "./fixtures";

test("shared owner navigation follows each implemented destination", async ({
  page,
  context,
  owners,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/`);
  const mobile = page.viewportSize()!.width <= 900;
  for (const [label, path] of [
    ["Calendar", "/"],
    ["Services", "/services"],
    ["Barbers", "/barbers"],
    ["Availability", "/availability"],
    ["Activity", "/activity"],
    ["Settings", "/settings"],
  ]) {
    await openOwnerNavigation(page);
    await page
      .getByRole("navigation", { name: "Owner navigation" })
      .getByRole("link", { name: label, exact: true })
      .click();
    await expect(page).toHaveURL(`${ownerOrigin}${path}`);
    await expect(
      page.getByRole("heading", {
        name:
          label === "Settings"
            ? "Shop settings & public link"
            : label === "Activity"
              ? "Booking activity & message status"
              : label === "Services"
                ? "Services management"
                : label === "Barbers"
                  ? "Barber profiles and service assignments"
                  : label === "Availability"
                    ? "Shop and barber availability"
                    : label,
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeHidden();
    await captureState(page, `owner-${label.toLowerCase()}-closed`, info);
    await openOwnerNavigation(page);
    await expect(
      page.getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    if (mobile) {
      const drawer = page.getByRole("dialog", { name: "Navigation" });
      await expect(
        drawer.getByText("Juniper Barber", { exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(page.viewportSize()!.width);
      await page.screenshot({
        path: info.outputPath(`owner-${label.toLowerCase()}-open.png`),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Close navigation" }).click();
    }
  }
  expect(errors).toEqual([]);
});

test("mobile drawer traps focus, dismisses, restores scrolling and closes on resize", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/availability`);
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.getByRole("button", { name: "Open navigation" });
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  const close = page.getByRole("button", { name: "Close navigation" });
  await expect(trigger).toHaveCSS("width", "44px");
  await expect(trigger).toHaveCSS("height", "44px");
  await trigger.click();
  await expect(close).toBeFocused();
  await expect(close).toHaveCSS("width", "44px");
  await expect(close).toHaveCSS("height", "44px");
  await expect(
    page.getByRole("button", { name: "Open navigation", includeHidden: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("button", { name: "Sign out" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.mouse.move(10, 400);
  await page.mouse.wheel(0, 500);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page.mouse.click(10, 400);
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 900]) {
    await page.setViewportSize({ width, height: 568 });
    await trigger.click();
    await expect(drawer).toBeVisible();
    const bounds = await drawer.boundingBox();
    expect(bounds!.width).toBe(Math.min(340, width - 32));
    expect(bounds!.height).toBe(568);
    expect(
      parseFloat(
        await drawer.evaluate((el) => getComputedStyle(el).transitionDuration),
      ),
    ).toBeLessThanOrEqual(0.001);
    await close.click();
    await expect(drawer).toBeHidden();
  }
  await trigger.click();
  await page.setViewportSize({ width: 901, height: 844 });
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeHidden();
  await expect(
    page.getByRole("link", { name: "Availability", exact: true }),
  ).toBeVisible();
  await page.mouse.move(450, 700);
  await page.mouse.wheel(0, 500);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(trigger).toBeVisible();
  await expect(drawer).toBeHidden();
});
