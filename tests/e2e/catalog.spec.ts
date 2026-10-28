import {
  cancelBlockedRequest,
  captureState,
  expect,
  ownerOrigin,
  test,
} from "./fixtures";

test("owners create, validate, assign, and reload shared service details", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/services`);
  await expect(
    page.getByRole("heading", { name: "Services management", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add service" }).click();
  await page.getByLabel("Service name").fill("Community cut");
  await page.getByLabel("Price (USD)").fill("1.001");
  await page.getByLabel("Duration in minutes").fill("35");
  await page.getByRole("button", { name: "Save service" }).click();
  const price = page.getByLabel("Price (USD)");
  await expect(price).toBeFocused();
  await expect(price).toHaveAccessibleDescription(
    "Enter a USD amount with up to two decimal places.",
  );
  await expect(price).toHaveValue("1.001");
  await price.fill("0");
  const duration = page.getByLabel("Duration in minutes");
  await duration.fill("29");
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(duration).toBeFocused();
  await expect(duration).toHaveAccessibleDescription(
    "Duration must be at least 30 minutes.",
  );
  await expect(duration).toHaveValue("29");
  await duration.fill("35");
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByText("Community cut", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Community cut", { exact: true })).toBeVisible();
  await expect(page.locator("article")).toContainText("$0.00");
  await expect(page.locator("article")).toContainText("35 min");
});

test("service form confirms discard and fits the desktop, tablet, and phone widths @device", async ({
  page,
  context,
  owners,
}, info) => {
  await owners(context, { shop: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${ownerOrigin}/services`);
    await page.getByRole("button", { name: "Add service" }).click();
    await page.getByLabel("Service name").fill("Unsaved draft");
    await page.keyboard.press("Escape");
    const discard = page.getByRole("dialog", {
      name: "Discard unsaved changes?",
    });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Keep editing" }).click();
    await expect(
      page.getByRole("dialog", { name: "Add service" }),
    ).toBeVisible();
    await expect(page.getByLabel("Service name")).toHaveValue("Unsaved draft");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Discard changes" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add service" }),
    ).toBeFocused();
    await captureState(page, `services-${width}`, info);
  }
});

test("hiding and archiving keep a retained record and update filters", async ({
  page,
  context,
  owners,
}, info) => {
  const nativeDialogs: string[] = [];
  page.on("dialog", (dialog) => {
    nativeDialogs.push(dialog.type());
    void dialog.dismiss();
  });
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/services`);
  await page.getByRole("button", { name: "Add service" }).click();
  await page.getByLabel("Service name").fill("Lifecycle trim");
  await page.getByLabel("Price (USD)").fill("12");
  await page.getByLabel("Duration in minutes").fill("30");
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByText("Lifecycle trim", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hide service" }).click();
  await page.getByRole("button", { name: /Hidden \(/ }).click();
  await expect(
    page.locator("article").getByText("Hidden", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  const archiveDialog = page.getByRole("dialog", { name: "Archive service?" });
  await expect(archiveDialog).toBeVisible();
  await expect(archiveDialog).toContainText("Lifecycle trim");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await page.screenshot({
    path: info.outputPath("service-archive-dialog.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(archiveDialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Archive", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(archiveDialog).toBeVisible();
  await archiveDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(archiveDialog).toHaveCount(0);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(archiveDialog).toBeVisible();
  await archiveDialog.getByRole("button", { name: "Archive service" }).click();
  await expect(archiveDialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Service archived.");
  expect(nativeDialogs).toEqual([]);
  await page.getByRole("button", { name: /Archived \(/ }).click();
  await expect(
    page.locator("article").getByText("Archived", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
});

test("service save failure preserves input and allows a real retry", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/services`);
  await page.getByRole("button", { name: "Add service" }).click();
  await page.getByLabel("Service name").fill("Retry service");
  await page.getByLabel("Price (USD)").fill("18.50");
  await page.getByLabel("Duration in minutes").fill("35");
  const blocker = await database.pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM shops WHERE owner_id = $1 FOR UPDATE", [
      owner.id,
    ]);
    await page.getByRole("button", { name: "Save service" }).click();
    await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await cancelBlockedRequest(database.pool, blocker);
    await expect(page.getByRole("alert")).toHaveText(
      "Unable to save your service.",
    );
    await expect(page.getByLabel("Service name")).toHaveValue("Retry service");
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM services WHERE shop_id = $1",
          [owner.shopId],
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByText("Retry service", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Retry service", { exact: true })).toBeVisible();
});
