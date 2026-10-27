import { createHash, randomUUID } from "node:crypto";
import { expect, ownerOrigin, test } from "./fixtures";

test("unknown manage links stay private and uniformly unavailable", async ({
  page,
  context,
  owners,
  request,
}) => {
  const owner = await owners(context, { shop: true });
  const url = `http://${owner.subdomain}.localhost:3100/manage/${randomUUID()}`;
  const response = await page.goto(url);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Booking link unavailable" }),
  ).toBeVisible();
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  expect(await page.evaluate(() => document.referrer)).toBe("");
  const head = await request.head(url);
  expect(head.status()).toBe(200);
  expect(head.headers()["cache-control"]).toBe("private, no-store");

  const rejectedWrite = await request.post(url);
  expect(rejectedWrite.status()).toBe(404);
  expect(rejectedWrite.headers()["cache-control"]).toBe("private, no-store");
  expect(rejectedWrite.headers()["referrer-policy"]).toBe("no-referrer");
  expect(rejectedWrite.headers()["x-robots-tag"]).toContain("noindex");
});

test("audited button links navigate as anchors without Base UI diagnostics", async ({
  page,
  context,
  owners,
}) => {
  test.skip(
    process.env.TRIMTIME_E2E_SERVER !== "dev",
    "Base UI emits this diagnostic only in development mode.",
  );
  const baseUiErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().startsWith("Base UI:"))
      baseUiErrors.push(message.text());
  });
  const owner = await owners(context, { shop: true, appointment: true });
  const calendarUrl = `${ownerOrigin}/?date=2026-11-02&view=day`;

  await page.goto(calendarUrl);
  await expect(
    page.getByRole("heading", { name: "Calendar", level: 1 }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(baseUiErrors).toEqual([]);
  const newAppointment = page.getByRole("link", { name: "New appointment" });
  await expect(newAppointment).toHaveAttribute("href", /\/appointments\/new/);
  expect(await newAppointment.evaluate((element) => element.tagName)).toBe("A");
  await newAppointment.focus();
  await expect(newAppointment).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/appointments\/new/);
  await expect(
    page.getByRole("dialog", { name: "New appointment" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(baseUiErrors).toEqual([]);

  await page.goto(calendarUrl);
  const appointmentCard = page.getByRole("link", {
    name: /Appointment: Fictional Guest, Saved Cut, Saved Barber/,
  });
  await expect(appointmentCard).toBeVisible();
  await appointmentCard.click();
  const appointmentDialog = page.getByRole("dialog", {
    name: "Appointment details",
  });
  await expect(appointmentDialog).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(baseUiErrors).toEqual([]);
  const dialogBackLink = appointmentDialog.getByRole("link", {
    name: "Back to calendar",
  });
  expect(await dialogBackLink.evaluate((element) => element.tagName)).toBe("A");
  await dialogBackLink.click();
  await expect(page).toHaveURL(/\/\?date=2026-11-02&view=day/);

  await page.goto(`${ownerOrigin}/barbers`);
  await page.waitForLoadState("networkidle");
  expect(baseUiErrors).toEqual([]);
  const editHours = page.getByRole("link", { name: "Edit hours" }).first();
  await expect(editHours).toHaveAttribute("href", "/availability");
  expect(await editHours.evaluate((element) => element.tagName)).toBe("A");
  await editHours.click();
  await expect(page).toHaveURL(`${ownerOrigin}/availability`);
  await page.waitForLoadState("networkidle");
  expect(baseUiErrors).toEqual([]);

  await page.goto(
    `${ownerOrigin}/appointments/${owner.appointmentId}?date=2026-11-02&view=day`,
  );
  await expect(
    page.getByRole("heading", { name: "Appointment details", level: 1 }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(baseUiErrors).toEqual([]);
  const standaloneBackLink = page.getByRole("link", {
    name: "Back to calendar",
  });
  await expect(standaloneBackLink).toHaveAttribute(
    "href",
    /\/\?date=2026-11-02&view=day/,
  );
  expect(await standaloneBackLink.evaluate((element) => element.tagName)).toBe(
    "A",
  );
  await standaloneBackLink.click();
  await expect(page).toHaveURL(/\/\?date=2026-11-02&view=day/);

  const manageUrl = `http://${owner.subdomain}.localhost:3100/manage/${randomUUID()}`;
  await page.goto(manageUrl);
  await expect(
    page.getByRole("heading", { name: "Booking link unavailable" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(baseUiErrors).toEqual([]);
  const shopLink = page
    .getByRole("heading", { name: "Booking link unavailable" })
    .locator("xpath=..")
    .getByRole("link", { name: "Back to the shop" });
  await expect(shopLink).toHaveAttribute("href", "/");
  expect(await shopLink.evaluate((element) => element.tagName)).toBe("A");
  await Promise.all([
    page.waitForURL(new URL("/", manageUrl).href),
    shopLink.click(),
  ]);
});

test("contactless owner capability reads state that no email was provided", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const token = randomUUID();
  const bookingId = randomUUID();
  await database.pool.query(
    `INSERT INTO bookings (
      id,shop_id,service_id,barber_id,status,start_at,end_at,service_name,service_price_usd,
      service_duration_minutes,barber_name,customer_name,customer_email,customer_phone,
      whatsapp_opt_in,creation_source,capability_hash,capability_ciphertext,capability_key_id,
      recovery_key_hash,recovery_payload_digest
    ) VALUES ($1,$2,$3,$4,'confirmed','2026-11-03T13:07Z','2026-11-03T13:42Z',
      'Walk-in Cut',25,35,'Manual Barber','Fictional Walk-in',NULL,NULL,false,'owner',$5,
      'test-ciphertext','e2e-v1',$6,$7)`,
    [
      bookingId,
      owner.shopId,
      owner.serviceId,
      owner.barberId,
      createHash("sha256").update(token).digest("hex"),
      `recovery-${bookingId}`,
      `digest-${bookingId}`,
    ],
  );
  await page.goto(`http://${owner.subdomain}.localhost:3100/manage/${token}`);
  await expect(
    page.getByText("No email provided", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("null", { exact: true })).toHaveCount(0);
});
