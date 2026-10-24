import { test, expect, ownerOrigin, captureState } from "./fixtures";

test("owner workspace keeps the Doop sections and desktop sidebar across responsive widths", async ({
  page,
  context,
  owners,
}, info) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/settings`);
  await expect(
    page.getByRole("heading", {
      name: "Shop settings & public link",
      exact: true,
    }),
  ).toBeVisible();
  for (const heading of [
    "Shop profile & address",
    "Shop identifiers and time zone",
    "Publication & booking readiness",
    "Shop booking link",
    "Scannable shop QR code",
    "Owner identity",
  ]) {
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }
  await expect(
    page.getByText("Fictional Owner", { exact: true }),
  ).toBeVisible();
  for (const width of [320, 390, 768, 900, 901, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const nav = page.getByRole("navigation", { name: "Owner navigation" });
    if (width > 900) {
      await expect(nav).toBeVisible();
      await expect(
        nav.getByRole("link", { name: "Settings", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      const bounds = await page.locator("aside").boundingBox();
      expect(bounds?.width).toBe(208);
      expect(bounds?.x).toBe(0);
      await page
        .getByRole("button", { name: "Open navigation" })
        .waitFor({ state: "hidden" });
    } else {
      await expect(
        page.getByRole("button", { name: "Open navigation" }),
      ).toBeVisible();
    }
    if ([390, 768, 1440].includes(width))
      await captureState(page, `settings-fidelity-${width}`, info);
  }
  await page
    .getByRole("button", { name: "Save settings" })
    .scrollIntoViewIfNeeded();
  expect((await page.locator("aside").boundingBox())?.y).toBe(0);
});

test("discard confirms and restores the most recently saved settings", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/settings`);
  await expect(
    page.getByRole("button", { name: "Discard", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Shop name", { exact: true }).fill("Saved shop");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Settings saved.");
  await expect(page.locator("aside strong")).toHaveText("Saved shop");
  await expect(
    page
      .locator(".owner-settings-card")
      .filter({
        has: page.getByRole("heading", {
          name: "Scannable shop QR code",
          exact: true,
        }),
      })
      .getByText("Saved shop", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Shop name", { exact: true }).fill("Unsaved shop");
  await page.getByLabel("Time zone", { exact: true }).fill("not-a-zone");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.locator('form p[role="alert"]')).toContainText(
    "Check the highlighted fields.",
  );
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("Shop name", { exact: true })).toHaveValue(
    "Unsaved shop",
  );
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page.getByLabel("Shop name", { exact: true })).toHaveValue(
    "Saved shop",
  );
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue(
    "America/New_York",
  );
  await expect(page.locator('form p[role="alert"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Discard", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel("Shop name", { exact: true })).toHaveValue(
    "Saved shop",
  );
});

test("permanent time-zone lock is visible without exposing an editable control", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  await database.pool.query(
    "UPDATE shops SET time_zone_locked_at = '2026-10-23T12:00:00Z' WHERE owner_id = $1",
    [owner.id],
  );
  await page.goto(`${ownerOrigin}/settings`);
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(
    page.getByText("Permanently locked", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Shop name", { exact: true }).fill("Locked zone shop");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Settings saved.");
  await page.reload();
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue(
    "America/New_York",
  );
});
