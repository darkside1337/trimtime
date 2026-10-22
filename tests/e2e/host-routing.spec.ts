import { test, expect, ownerOrigin, marketingOrigin } from "./fixtures";

test("invalid hosts and direct internal destinations return HTTP 404", async ({ request }) => {
  for (const origin of [marketingOrigin, ownerOrigin]) {
    for (const path of ["/owner", "/owner/settings", "/owner/settings.png"]) {
      expect((await request.get(`${origin}${path}`)).status()).toBe(404);
      expect((await request.post(`${origin}${path}`, { data: "ignored" })).status()).toBe(404);
    }
  }
  for (const path of ["/sign-in", "/setup", "/settings", "/icon.png-extra", "/faviconXico", "/_next-example"]) {
    expect((await request.get(`${marketingOrigin}${path}`)).status()).toBe(404);
  }
  expect((await request.get(marketingOrigin, {
    headers: { host: "unknown.localhost:3100", "x-forwarded-host": "unknown.localhost:3100" },
  })).status()).toBe(404);
  expect((await request.get(ownerOrigin, {
    headers: { "x-forwarded-host": "localhost:3100" },
  })).status()).toBe(404);
});

test("shared resources and callback queries survive host routing", async ({ request, page }) => {
  for (const origin of [marketingOrigin, ownerOrigin]) {
    for (const path of ["/design-system", "/brand/soft-welcome/horizontal-primary.svg", "/favicon.ico", "/icon.png", "/apple-icon.png"]) {
      expect((await request.get(`${origin}${path}`)).status()).toBe(200);
    }
  }
  await page.goto(`${ownerOrigin}/sign-in?error=access_denied`);
  await expect(page).toHaveURL(`${ownerOrigin}/sign-in?error=access_denied`);
  await expect(page.getByRole("alert").filter({ hasText: "Google sign-in was cancelled" })).toBeVisible();
});

test("rewritten navigation keeps canonical URLs and isolates owner responses", async ({ page, context, browser, owners }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await owners(context, { shop: true, name: "Routing Private A" });
  const otherContext = await browser.newContext();
  try {
    await owners(otherContext, { shop: true, name: "Routing Private B" });
    const otherPage = await otherContext.newPage();
    await page.goto(ownerOrigin);
    await expect(page.getByText("Routing Private A", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(`${ownerOrigin}/settings`);
    await expect(page.getByLabel("Shop name")).toHaveValue("Routing Private A");
    await page.goBack();
    await expect(page).toHaveURL(`${ownerOrigin}/`);
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(`${ownerOrigin}/settings`);
    await page.reload();
    await expect(page.getByLabel("Shop name")).toHaveValue("Routing Private A");
    await otherPage.goto(`${ownerOrigin}/settings`);
    await expect(otherPage.getByLabel("Shop name")).toHaveValue("Routing Private B");
    await page.goto(marketingOrigin);
    await expect(page.getByText("A friendlier way to book a barber appointment.")).toBeVisible();
    await expect(page.getByText("Routing Private A", { exact: true })).toHaveCount(0);
    await page.goto(`${ownerOrigin}/settings`);
    await expect(page.getByLabel("Shop name")).toHaveValue("Routing Private A");
    expect(errors).toEqual([]);
  } finally {
    await otherContext.close();
  }
});
