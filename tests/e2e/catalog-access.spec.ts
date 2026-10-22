import { expect, ownerOrigin, test } from "./fixtures";

test("captured catalog edits reject signed-out and foreign-owner replay without disclosure", async ({
  page,
  context,
  browser,
  owners,
  request,
  database,
}) => {
  const first = await owners(context, { shop: true });
  const otherContext = await browser.newContext();
  try {
    const second = await owners(otherContext, { shop: true });
    await page.goto(`${ownerOrigin}/services`);
    await page.getByRole("button", { name: "Add service" }).click();
    await page.getByLabel("Service name").fill("Private service");
    await page.getByLabel("Price (USD)").fill("12");
    await page.getByLabel("Duration in minutes").fill("35");
    await page.getByRole("button", { name: "Save service" }).click();
    await expect(
      page.getByText("Private service", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Service name").fill("Changed private service");
    const captured = page.waitForRequest(
      (entry) =>
        entry.method() === "POST" && Boolean(entry.headers()["next-action"]),
    );
    await page.getByRole("button", { name: "Save service" }).click();
    const action = await captured;
    await expect(
      page.getByText("Changed private service", { exact: true }),
    ).toBeVisible();
    const body = action.postDataBuffer()!;
    const headers = {
      "content-type": action.headers()["content-type"],
      "next-action": action.headers()["next-action"],
      origin: ownerOrigin,
    };
    const signedOut = await request.post(action.url(), { headers, data: body });
    expect(await signedOut.text()).toContain("UNAUTHENTICATED");
    const badOrigin = await request.post(action.url(), {
      headers: {
        ...headers,
        origin: "https://attacker.example",
        cookie: first.cookie,
      },
      data: body,
    });
    expect(badOrigin.status()).toBeGreaterThanOrEqual(400);
    const foreign = await request.post(action.url(), {
      headers: { ...headers, cookie: second.cookie },
      data: body,
    });
    const responseText = await foreign.text();
    expect(responseText).toContain("NOT_FOUND");
    expect(responseText).not.toContain("Changed private service");
    const rows = await database.pool.query(
      "SELECT name FROM services WHERE shop_id = (SELECT id FROM shops WHERE owner_id = $1)",
      [first.id],
    );
    expect(rows.rows).toEqual([{ name: "Changed private service" }]);
  } finally {
    await otherContext.close();
  }
});
