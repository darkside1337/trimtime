import { randomUUID } from "node:crypto";
import { expect, ownerOrigin, test } from "./fixtures";
import { createOwnerAppointment } from "./owner-booking-fixtures";

async function seedAppointmentSetup(
  owner: { shopId: string; barberId?: string; serviceId?: string },
  database: { pool: import("pg").Pool },
) {
  const barberId = randomUUID();
  const serviceId = randomUUID();
  const week = JSON.stringify(
    Array.from({ length: 7 }, () => ({
      working: [{ start: 0, end: 1440 }],
      breaks: [],
    })),
  );
  await database.pool.query(
    "INSERT INTO barbers (id,shop_id,name) VALUES ($1,$2,'Manual Barber')",
    [barberId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO services (id,shop_id,name,price_usd,duration_minutes) VALUES ($1,$2,'Walk-in Cut',25,35)",
    [serviceId, owner.shopId],
  );
  await database.pool.query(
    "INSERT INTO barber_services (shop_id,barber_id,service_id) VALUES ($1,$2,$3)",
    [owner.shopId, barberId, serviceId],
  );
  await database.pool.query(
    "INSERT INTO shop_schedules (shop_id,week,revision) VALUES ($1,$2::jsonb,1)",
    [owner.shopId, week],
  );
  await database.pool.query(
    "INSERT INTO barber_schedules (shop_id,barber_id,week,revision) VALUES ($1,$2,$3::jsonb,1)",
    [owner.shopId, barberId, week],
  );
  Object.assign(owner, { barberId, serviceId });
}

test("service eligibility conflict opens details and retries the preserved draft", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  await seedAppointmentSetup(owner, database);
  const bookingId = await createOwnerAppointment(owner);
  await createOwnerAppointment(owner, "2027-01-19T15:07:00.000Z");
  await page.goto(`${ownerOrigin}/services`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const assignment = page.getByRole("checkbox", { name: "Manual Barber" });
  await expect(assignment).toBeChecked();
  await assignment.uncheck();
  await page.getByRole("button", { name: "Save service" }).click();

  const conflict = page.getByRole("region", {
    name: "Appointments to resolve",
  });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText("Move Journey Guest");
  await expect(conflict).toContainText("Walk-in Cut with Manual Barber");
  await expect(conflict.locator("li")).toHaveCount(2);

  const cancelConflict = async (row: import("@playwright/test").Locator) => {
    const detailsPagePromise = page.waitForEvent("popup");
    await row.getByRole("link", { name: /opens in a new tab/ }).click();
    const detailsPage = await detailsPagePromise;
    await expect(
      detailsPage.getByRole("heading", { name: "Appointment details" }),
    ).toBeVisible();
    await detailsPage
      .getByRole("button", { name: "Cancel appointment" })
      .click();
    await detailsPage
      .getByRole("button", { name: "Confirm cancellation" })
      .click();
    await expect(
      detailsPage.getByText("Cancelled", { exact: true }),
    ).toBeVisible();
    await detailsPage.close();
  };
  await cancelConflict(conflict.locator("li").first());
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(conflict.locator("li")).toHaveCount(1);
  await expect(conflict.locator("li").first()).toContainText("15:07:00");
  await cancelConflict(conflict.locator("li").first());

  await expect(assignment).not.toBeChecked();
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByRole("dialog", { name: "Edit service" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("status")).toHaveText(
    "Service details saved. The sample description was not saved.",
  );
  expect(
    (
      await database.pool.query(
        "SELECT kind FROM booking_changes WHERE booking_id=$1",
        [bookingId],
      )
    ).rows,
  ).toEqual([{ kind: "cancel" }]);
  expect(
    (
      await database.pool.query(
        "SELECT barber_id FROM barber_services WHERE shop_id=$1 AND service_id=$2",
        [owner.shopId, owner.serviceId],
      )
    ).rows,
  ).toEqual([]);
});

test("barber archive reports all affected appointments in chronological order", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  await seedAppointmentSetup(owner, database);
  await createOwnerAppointment(owner);
  await createOwnerAppointment(owner, "2027-01-19T15:07:00.000Z");
  await page.goto(`${ownerOrigin}/barbers`);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Archive barber?" })
    .getByRole("button", { name: "Archive barber" })
    .click();

  const conflict = page.getByRole("region", {
    name: "Appointments to resolve",
  });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText("Move Journey Guest");
  await expect(conflict.locator("li")).toHaveCount(2);
  await expect(conflict.locator("li").nth(0)).toContainText("13:07:00");
  await expect(conflict.locator("li").nth(1)).toContainText("15:07:00");
});

test("availability conflict draft rejects a retry after configuration revision changes", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  await seedAppointmentSetup(owner, database);
  await createOwnerAppointment(owner, "2027-01-18T13:07:00.000Z");
  await page.goto(`${ownerOrigin}/availability`);
  await page.getByLabel("Opens").first().fill("14:00");
  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(
    page.getByRole("region", { name: "Appointments to resolve" }),
  ).toBeVisible();

  const { saveShopSchedule } =
    await import("../../features/availability/mutations");
  const week = Array.from({ length: 7 }, () => ({
    working: [{ start: 0, end: 1440 }],
    breaks: [],
  }));
  await expect(
    saveShopSchedule({ userId: owner.id }, { week, revision: 1 }),
  ).resolves.toMatchObject({ success: true });

  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Shop hours changed in another session. Reload before saving.",
  );
  await expect(
    page.getByRole("button", { name: "Reload saved hours" }),
  ).toBeVisible();
  await expect(page.getByLabel("Opens").first()).toHaveValue("14:00");
});
