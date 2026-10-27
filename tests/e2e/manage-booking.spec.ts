import { createHash, randomUUID } from "node:crypto";
import { test, expect } from "./fixtures";

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
