import { expect, ownerOrigin, test } from "./fixtures";

test("barber archiving uses the owner confirmation dialog", async ({
  page,
  context,
  owners,
}) => {
  const nativeDialogs: string[] = [];
  page.on("dialog", (dialog) => {
    nativeDialogs.push(dialog.type());
    void dialog.dismiss();
  });
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/barbers`);
  await page.getByRole("button", { name: "Add barber" }).click();
  await page.getByLabel("Barber name").fill("Sam Example");
  await page.getByRole("button", { name: "Save barber" }).click();
  await expect(page.getByText("Sam Example", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Archive", exact: true }).click();
  const archiveDialog = page.getByRole("dialog", { name: "Archive barber?" });
  await expect(archiveDialog).toBeVisible();
  await expect(archiveDialog).toContainText("Sam Example");
  await archiveDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(archiveDialog).toHaveCount(0);
  await expect(
    page.locator("article").getByText("Active", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(archiveDialog).toBeVisible();
  await archiveDialog.getByRole("button", { name: "Archive barber" }).click();
  await expect(archiveDialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Barber archived.");
  expect(nativeDialogs).toEqual([]);
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(
    page.locator("article").getByText("Archived", { exact: true }),
  ).toBeVisible();
});

test("eligibility edits from the barber surface reload on the service surface", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/services`);
  await page.getByRole("button", { name: "Add service" }).click();
  await page.getByLabel("Service name").fill("Shared trim");
  await page.getByLabel("Price (USD)").fill("12.5");
  await page.getByLabel("Duration in minutes").fill("35");
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByText("Shared trim", { exact: true })).toBeVisible();
  await page.goto(`${ownerOrigin}/barbers`);
  await page.getByRole("button", { name: "Add barber" }).click();
  await page.getByLabel("Barber name").fill("Sam Example");
  await page.getByRole("checkbox", { name: /Shared trim/ }).check();
  await page.getByRole("button", { name: "Save barber" }).click();
  await expect(page.getByText("Sam Example", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add barber" }).click();
  await page.getByLabel("Barber name").fill("Lee Example");
  await page.getByRole("checkbox", { name: /Shared trim/ }).check();
  await page.getByRole("button", { name: "Save barber" }).click();
  await expect(page.getByText("Lee Example", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Sam Example", { exact: true })).toBeVisible();
  await page.goto(`${ownerOrigin}/services`);
  await expect(page.getByText(/2 eligible barbers/)).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Sam Example" }),
  ).toBeChecked();
  await page.getByLabel("Price (USD)").fill("15.00");
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.locator("article")).toContainText("$15.00");
  await expect(page.locator("article")).toContainText("35 min");
  await page.goto(`${ownerOrigin}/barbers`);
  await page
    .locator("article")
    .filter({ hasText: "Sam Example" })
    .getByRole("button", { name: "Edit" })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /Shared trim · \$15\.00 · 35 min/ }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Save barber" }).click();
  await page
    .locator("article")
    .filter({ hasText: "Lee Example" })
    .getByRole("button", { name: "Edit" })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /Shared trim · \$15\.00 · 35 min/ }),
  ).toBeChecked();
});
