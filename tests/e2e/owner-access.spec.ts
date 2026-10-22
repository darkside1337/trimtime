import { test, expect, ownerOrigin, marketingOrigin, captureState } from "./fixtures";

test("signed-out owner pages require Google sign-in and marketing denies auth endpoints", async ({ page, request, context }, info) => {
  await page.goto(marketingOrigin);
  await expect(page.getByRole("link", { name: "Owner sign in" })).toHaveAttribute("href", `${ownerOrigin}/sign-in`);
  await captureState(page, "marketing", info);
  for (const path of ["/", "/setup", "/settings"]) {
    await page.goto(`${ownerOrigin}${path}`);
    await expect(page).toHaveURL(`${ownerOrigin}/sign-in`);
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
  }
  await context.addCookies([{ name: "better-auth.session_token", value: "forged", url: ownerOrigin }]);
  await page.goto(`${ownerOrigin}/settings`);
  await expect(page).toHaveURL(`${ownerOrigin}/sign-in`);
  await captureState(page, "sign-in", info);
  expect((await request.get(`${marketingOrigin}/api/auth/get-session`)).status()).toBe(404);
  expect((await request.post(`${marketingOrigin}/api/auth/sign-in/social`, { data: { provider: "google" } })).status()).toBe(404);
});

test("captured settings actions reject visitors, forged ownership, foreign origins and marketing writes", async ({ page, context, browser, owners, request, database }) => {
  const first = await owners(context, { shop: true, name: "Private A Shop" });
  const otherContext = await browser.newContext();
  const demoContext = await browser.newContext();
  try {
    const other = await owners(otherContext, { shop: true, name: "Private B Shop" });
    const demo = await owners(demoContext, { shop: true, name: "Protected Shared Demo" });
    await page.goto(`${ownerOrigin}/settings`);
    await page.getByLabel("Shop name").fill("Private A Updated");
    const capture = page.waitForRequest((entry) => entry.method() === "POST" && Boolean(entry.headers()["next-action"]));
    await page.getByRole("button", { name: "Save settings" }).click();
    const action = await capture;
    await expect(page.getByRole("status")).toHaveText("Settings saved.");
    const body = action.postDataBuffer()!;
    const headers = {
      "content-type": action.headers()["content-type"],
      "next-action": action.headers()["next-action"],
      origin: ownerOrigin,
    };
    const before = (await database.pool.query("SELECT * FROM shops WHERE owner_id = ANY($1::text[]) ORDER BY id", [[first.id, other.id, demo.id]])).rows;

    const signedOut = await request.post(action.url(), { headers, data: body });
    expect(await signedOut.text()).toContain("UNAUTHENTICATED");
    const boundary = headers["content-type"].split("boundary=")[1];
    const encoded = body.toString();
    const prefix = /name="([^"]*)publicContact"/.exec(encoded)![1];
    for (const [attacker, target] of [[other, first], [other, demo], [demo, first]]) {
      const injected = [["ownerId", target.id], ["shopId", target.shopId], ["published", "true"]]
        .map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${prefix}${key}"\r\n\r\n${value}\r\n`).join("");
      // Put fields before the Flight reference so React decodes them into the FormData.
      const forged = injected + encoded;
      const response = await request.post(action.url(), { headers: { ...headers, cookie: attacker.cookie }, data: Buffer.from(forged) });
      const text = await response.text();
      expect(text).toContain("VALIDATION_ERROR");
      expect(text).not.toContain(target === first ? "Private A Updated" : "Protected Shared Demo");
    }
    for (const origin of ["https://attacker.example", null]) {
      const replayHeaders: Record<string, string> = { ...headers, cookie: first.cookie };
      if (origin) replayHeaders.origin = origin;
      else delete replayHeaders.origin;
      const response = await request.post(action.url(), { headers: replayHeaders, data: body });
      const text = await response.text();
      expect(response.status() >= 400 || text.includes("UNAUTHENTICATED")).toBe(true);
      if (!origin) expect(text).toContain("UNAUTHENTICATED");
    }
    const marketing = await request.post(`${marketingOrigin}/settings`, {
      headers: { ...headers, origin: marketingOrigin, cookie: first.cookie }, data: body,
    });
    expect(marketing.status()).toBe(404);
    const otherPage = await request.get(`${ownerOrigin}/settings?shopId=${first.shopId}&ownerId=${first.id}`, { headers: { cookie: other.cookie } });
    const html = await otherPage.text();
    expect(html).toContain("Private B Shop");
    expect(html).not.toContain("Private A Updated");
    expect((await database.pool.query("SELECT * FROM shops WHERE owner_id = ANY($1::text[]) ORDER BY id", [[first.id, other.id, demo.id]])).rows).toEqual(before);
  } finally {
    await otherContext.close();
    await demoContext.close();
  }
});

test("existing owners skip setup and sign-out revokes a replayed session", async ({ page, context, owners, request }) => {
  const owner = await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/setup`);
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  expect((await context.cookies(marketingOrigin)).some((cookie) => cookie.name.includes("session_token"))).toBe(false);
  expect((await context.cookies("http://sibling.localhost:3100")).some((cookie) => cookie.name.includes("session_token"))).toBe(false);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  const replay = await request.get(`${ownerOrigin}/api/auth/get-session`, { headers: { cookie: owner.cookie } });
  expect(await replay.json()).toBeNull();
  await context.addCookies([{ name: owner.cookie.split("=")[0], value: owner.cookie.slice(owner.cookie.indexOf("=") + 1), url: ownerOrigin }]);
  await page.goto(`${ownerOrigin}/settings`);
  await expect(page).toHaveURL(`${ownerOrigin}/sign-in`);
  await expect(page.getByLabel("Shop name")).toHaveCount(0);
});
