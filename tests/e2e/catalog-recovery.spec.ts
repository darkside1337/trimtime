import { randomUUID } from "node:crypto";
import { expect, ownerOrigin, test } from "./fixtures";

test("offered switch toggles persist and every save announces what is saved", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${ownerOrigin}/services`);
  await page.getByRole("button", { name: "Add service" }).click();
  await page.getByLabel("Service name").fill("Toggle trim");
  await page.getByLabel("Price (USD)").fill("12");
  await page.getByRole("switch", { name: "Offered to customers" }).uncheck();
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Service details saved. The sample description was not saved.",
  );
  await expect(
    page.getByRole("button", { name: "Offer service" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Offered to customers" }),
  ).not.toBeChecked();
  await page.getByRole("switch", { name: "Offered to customers" }).check();
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Service details saved. The sample description was not saved.",
  );
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("status", { includeHidden: true })).toBeEmpty();
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Service details saved. The sample description was not saved.",
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Hide service" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("sample service and barber copy stays out of the persisted action payload", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/services`);
  await page.getByRole("button", { name: "Add service" }).click();
  await page.getByLabel("Service name").fill("Preview payload service");
  await page.getByLabel("Price (USD)").fill("20");
  await page
    .getByLabel("Description (sample preview)")
    .fill("SAMPLE_SERVICE_MUST_NOT_PERSIST");
  const serviceRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" && Boolean(request.headers()["next-action"]),
  );
  await page.getByRole("button", { name: "Save service" }).click();
  expect((await serviceRequest).postData() ?? "").not.toContain(
    "SAMPLE_SERVICE_MUST_NOT_PERSIST",
  );
  await expect(page.getByRole("status")).toHaveText(
    "Service details saved. The sample description was not saved.",
  );

  await page.goto(`${ownerOrigin}/barbers`);
  await page.getByRole("button", { name: "Add barber" }).click();
  await page.getByLabel("Barber name").fill("Preview payload barber");
  await page
    .getByLabel("Specialty (sample preview)")
    .fill("SAMPLE_SPECIALTY_MUST_NOT_PERSIST");
  await page
    .getByRole("switch", { name: "Active status sample preview" })
    .uncheck();
  const barberRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" && Boolean(request.headers()["next-action"]),
  );
  await page.getByRole("button", { name: "Save barber" }).click();
  expect((await barberRequest).postData() ?? "").not.toContain(
    "SAMPLE_SPECIALTY_MUST_NOT_PERSIST",
  );
  await expect(page.getByRole("status")).toHaveText(
    "Barber name and service assignments saved. Sample specialty and active status were not saved.",
  );
  const persistedBarber = await database.pool.query(
    "SELECT archived FROM barbers WHERE shop_id = $1 AND name = $2",
    [owner.shopId, "Preview payload barber"],
  );
  expect(persistedBarber.rows[0]?.archived).toBe(false);
  await page.reload();
  await page
    .locator("article")
    .filter({ hasText: "Preview payload barber" })
    .getByRole("button", { name: "Edit" })
    .click();
  await expect(page.getByLabel("Specialty (sample preview)")).not.toHaveValue(
    "SAMPLE_SPECIALTY_MUST_NOT_PERSIST",
  );
});

for (const resource of ["service", "barber"] as const) {
  const route = `${resource}s`;
  test(`${resource} network save failure keeps fields and assignments for retry`, async ({
    page,
    context,
    owners,
    database,
  }) => {
    const owner = await owners(context, { shop: true });
    const counterpartId = randomUUID();
    if (resource === "service") {
      await database.pool.query(
        "INSERT INTO barbers (id, shop_id, name) VALUES ($1,$2,'Assigned barber')",
        [counterpartId, owner.shopId],
      );
    } else {
      await database.pool.query(
        "INSERT INTO services (id,shop_id,name,price_usd,duration_minutes) VALUES ($1,$2,'Assigned service',12.50,35)",
        [counterpartId, owner.shopId],
      );
    }
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${ownerOrigin}/${route}`);
    await page.getByRole("button", { name: `Add ${resource}` }).click();
    await page
      .getByLabel(resource === "service" ? "Service name" : "Barber name")
      .fill("Network draft");
    if (resource === "service") {
      await page.getByLabel("Price (USD)").fill("18.50");
      await page.getByLabel("Duration in minutes").fill("35");
      await page
        .getByRole("switch", { name: "Offered to customers" })
        .uncheck();
    }
    const assignment = page.getByRole("checkbox", { name: /Assigned/ });
    await assignment.check();
    await page.route(`**/${route}`, (route) =>
      route.request().method() === "POST"
        ? route.abort("failed")
        : route.continue(),
    );
    await page.getByRole("button", { name: `Save ${resource}` }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Could not confirm the save. Your input is still here.",
    );
    await expect(
      page.getByLabel(resource === "service" ? "Service name" : "Barber name"),
    ).toHaveValue("Network draft");
    await expect(assignment).toBeChecked();
    if (resource === "service") {
      await expect(page.getByLabel("Price (USD)")).toHaveValue("18.50");
      await expect(page.getByLabel("Duration in minutes")).toHaveValue("35");
      await expect(
        page.getByRole("switch", { name: "Offered to customers" }),
      ).not.toBeChecked();
    }
    await page.unroute(`**/${route}`);
    await page.getByRole("button", { name: `Save ${resource}` }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText(
      resource === "service"
        ? "Service details saved. The sample description was not saved."
        : "Barber name and service assignments saved. Sample specialty and active status were not saved.",
    );
    await page.reload();
    await expect(page.locator("article")).toContainText("Network draft");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: /Assigned/ }),
    ).toBeChecked();
    expect(errors).toEqual([]);
  });

  test(`${resource} archive network failure stays in the confirmation and retries`, async ({
    page,
    context,
    owners,
    database,
  }) => {
    const owner = await owners(context, { shop: true });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (resource === "service") {
      await database.pool.query(
        "INSERT INTO services (id,shop_id,name,price_usd,duration_minutes) VALUES ($1,$2,'Archive probe',12,35)",
        [randomUUID(), owner.shopId],
      );
    } else {
      await database.pool.query(
        "INSERT INTO barbers (id,shop_id,name) VALUES ($1,$2,'Archive probe')",
        [randomUUID(), owner.shopId],
      );
    }
    await page.goto(`${ownerOrigin}/${route}`);
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Archive ${resource}?` });
    await page.route(`**/${route}`, (route) =>
      route.request().method() === "POST"
        ? route.abort("failed")
        : route.continue(),
    );
    await dialog
      .getByRole("button", { name: `Archive ${resource}`, exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Could not confirm the archive.",
    );
    await expect(
      dialog.getByRole("button", { name: `Archive ${resource}`, exact: true }),
    ).toBeEnabled();
    await page.unroute(`**/${route}`);
    await dialog
      .getByRole("button", { name: `Archive ${resource}`, exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("article")).toContainText("Archived");
    expect(errors).toEqual([]);
  });
}

test("hide network failure reports the error and can be retried", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  await database.pool.query(
    "INSERT INTO services (id,shop_id,name,price_usd,duration_minutes) VALUES ($1,$2,'Hide probe',12,35)",
    [randomUUID(), owner.shopId],
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${ownerOrigin}/services`);
  await page.route("**/services", (route) =>
    route.request().method() === "POST"
      ? route.abort("failed")
      : route.continue(),
  );
  await page.getByRole("button", { name: "Hide service" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Could not confirm the update.",
  );
  await expect(
    page.getByRole("button", { name: "Hide service" }),
  ).toBeEnabled();
  await page.unroute("**/services");
  await page.getByRole("button", { name: "Hide service" }).click();
  await expect(page.getByRole("status")).toHaveText("Service hidden.");
  expect(errors).toEqual([]);
});
