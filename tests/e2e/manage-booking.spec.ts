import { randomUUID } from "node:crypto";
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
});
