import { test, expect, ownerOrigin, captureState } from "./fixtures";
import { addReadyCatalog } from "./publication-fixtures";
import { chooseBookingOptions } from "./booking-flow-helpers";

test("readiness blocks an incomplete draft and explains the next setup steps", async ({
  page,
  context,
  owners,
}, info) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/settings`);
  await expect(
    page.getByText("Complete these items before publishing:"),
  ).toBeVisible();
  await expect(
    page.getByText("an offered service", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publish shop" }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("navigation", { name: "Complete shop setup" })
      .getByRole("link", { name: "Availability" }),
  ).toHaveAttribute("href", "/availability");
  await captureState(page, "publication-incomplete", info);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if ([390, 768, 1440].includes(width))
      await captureState(page, `publication-incomplete-${width}`, info);
  }
});

test("publishes a ready shop, completes public booking, and confirms unpublication", async ({
  page,
  context,
  owners,
  database,
}, info) => {
  const owner = await owners(context, { shop: true });
  const { serviceId, barberId } = await addReadyCatalog(database.pool, owner);
  await page.goto(`${ownerOrigin}/settings`);
  await expect(
    page.getByText("Your shop meets the minimum setup for publication."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish shop" }).click();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();
  await captureState(page, "publication-published", info);
  await page.reload();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();

  await page.goto(`http://${owner.subdomain}.localhost:3100/`);
  await expect(
    page.getByRole("link", { name: "Juniper Barber" }),
  ).toBeVisible();
  await captureState(page, "publication-booking-initial", info);
  await chooseBookingOptions(page, { serviceId, barberId, date: "2026-11-02" });
  await page.getByRole("button", { name: /Date & time/ }).click();
  await captureState(page, "publication-available-slots", info);
  await page.getByRole("button", { name: "Your details", exact: true }).click();
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill("ada@example.test");
  await page.getByRole("button", { name: /Confirm booking/ }).click();
  await expect(
    page.getByRole("heading", { name: "Your chair is reserved." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open booking details" }),
  ).toBeVisible();
  await expect(
    page.getByText("ada@example.test", { exact: true }),
  ).toBeVisible();
  await captureState(page, "publication-booking-receipt", info);
  expect(
    (
      await database.pool.query(
        "SELECT count(*)::int AS n FROM bookings WHERE shop_id=$1",
        [owner.shopId],
      )
    ).rows[0].n,
  ).toBe(1);

  await page.goto(`${ownerOrigin}/settings`);
  await page.getByRole("button", { name: "Unpublish shop" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(
    "public page will show that the shop is paused",
  );
  await captureState(page, "publication-unpublish-dialog", info);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unpublish shop" }).click();
  await page.getByRole("button", { name: "Unpublish", exact: true }).click();
  await expect(
    page.getByText("Unpublished draft · Public page is paused"),
  ).toBeVisible();
  await page.goto(`http://${owner.subdomain}.localhost:3100/`);
  await expect(
    page.getByText(
      "Online booking is paused. Existing appointments and their private links are still available.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Cut", { exact: true })).toHaveCount(0);
  await captureState(page, "publication-paused", info);
});

test("publication failure keeps the draft and allows retry", async ({
  page,
  context,
  owners,
  database,
}, info) => {
  const owner = await owners(context, { shop: true });
  await addReadyCatalog(database.pool, owner);
  await page.goto(`${ownerOrigin}/settings`);
  const blocker = await database.pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM shops WHERE owner_id = $1 FOR UPDATE", [
      owner.id,
    ]);
    await page.getByRole("button", { name: "Publish shop" }).click();
    await expect(
      page.getByRole("button", { name: "Publishing…" }),
    ).toBeDisabled();
    await expect(
      page.getByText("Unable to update publication. Try again.", {
        exact: true,
      }),
    ).toBeVisible();
    await captureState(page, "publication-failure", info);
    expect(
      (
        await database.pool.query(
          "SELECT published FROM shops WHERE owner_id = $1",
          [owner.id],
        )
      ).rows,
    ).toEqual([{ published: false }]);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
  await page.getByRole("button", { name: "Publish shop" }).click();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();
});

test("publication errors stay in the unpublish dialog and keep retry and focus usable", async ({
  page,
  context,
  owners,
  database,
}, info) => {
  const owner = await owners(context, { shop: true });
  await addReadyCatalog(database.pool, owner);
  await page.goto(`${ownerOrigin}/settings`);
  await page.getByRole("button", { name: "Publish shop" }).click();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();

  const blocker = await database.pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM shops WHERE id = $1 FOR UPDATE", [
      owner.shopId,
    ]);
    await page.getByRole("button", { name: "Unpublish shop" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "Unpublish", exact: true })
      .click();
    const alert = dialog.getByRole("alert");
    await expect(alert).toHaveText("Unable to update publication. Try again.");
    await expect(
      dialog.getByRole("button", { name: "Unpublish", exact: true }),
    ).toBeEnabled();
    await captureState(page, "publication-unpublish-failure", info);
    await dialog.getByRole("button", { name: "Keep published" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Unpublish shop" }),
    ).toBeFocused();
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
  await page.getByRole("button", { name: "Unpublish shop" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Unpublish", exact: true })
    .click();
  await expect(
    page.getByText("Unpublished draft · Public page is paused"),
  ).toBeVisible();
});

test("a committed publication with a lost response is reconciled for publish and unpublish", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true });
  await addReadyCatalog(database.pool, owner);
  await page.route(`${ownerOrigin}/settings`, async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().headers()["next-action"]
    ) {
      await route.fetch();
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
  await page.goto(`${ownerOrigin}/settings`);

  await page.getByRole("button", { name: "Publish shop" }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText(
    "Connection lost. Refresh publication status to check whether the change saved.",
  );
  expect(
    (
      await database.pool.query("SELECT published FROM shops WHERE id = $1", [
        owner.shopId,
      ])
    ).rows,
  ).toEqual([{ published: true }]);
  await page
    .getByRole("button", { name: "Refresh publication status" })
    .click();
  await expect(
    page.getByText("Published · Public preview available"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Unpublish shop" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Unpublish", exact: true }).click();
  await expect(dialog.locator('p[role="alert"]')).toHaveText(
    "Connection lost. Refresh publication status to check whether the change saved.",
  );
  expect(
    (
      await database.pool.query("SELECT published FROM shops WHERE id = $1", [
        owner.shopId,
      ])
    ).rows,
  ).toEqual([{ published: false }]);
  await dialog
    .getByRole("button", { name: "Refresh publication status" })
    .click();
  await expect(
    page.getByText("Unpublished draft · Public page is paused"),
  ).toBeVisible();
  await page.unroute(`${ownerOrigin}/settings`);
});

test("captured publication actions reject untrusted origins, hosts, and injected ownership", async ({
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
    const other = await owners(otherContext, { shop: true });
    await addReadyCatalog(database.pool, first);
    await addReadyCatalog(database.pool, other);
    await page.route(`${ownerOrigin}/settings`, async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().headers()["next-action"]
      ) {
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });
    await page.goto(`${ownerOrigin}/settings`);
    const capturedAction = page.waitForRequest(
      (entry) =>
        entry.method() === "POST" && Boolean(entry.headers()["next-action"]),
    );
    await page.getByRole("button", { name: "Publish shop" }).click();
    await expect(page.locator('p[role="alert"]')).toBeVisible();
    const action = await capturedAction;
    const body = action.postDataBuffer()!;
    const headers: Record<string, string> = {
      "content-type": action.headers()["content-type"],
      "next-action": action.headers()["next-action"],
      origin: ownerOrigin,
    };
    const signedOut = await request.post(action.url(), { headers, data: body });
    expect(await signedOut.text()).toContain("UNAUTHENTICATED");

    for (const origin of ["https://attacker.example", undefined]) {
      const replayHeaders: Record<string, string> = {
        ...headers,
        cookie: first.cookie,
      };
      if (origin) replayHeaders.origin = origin;
      else delete replayHeaders.origin;
      const response = await request.post(action.url(), {
        headers: replayHeaders,
        data: body,
      });
      const text = await response.text();
      expect(response.status() >= 400 || text.includes("UNAUTHENTICATED")).toBe(
        true,
      );
    }

    const shopHost = await request.post(
      `http://${first.subdomain}.localhost:3100/`,
      {
        headers: {
          ...headers,
          cookie: first.cookie,
        },
        data: body,
      },
    );
    expect(shopHost.status()).toBe(404);

    const validForeignSession = await request.post(action.url(), {
      headers: { ...headers, cookie: other.cookie },
      data: body,
    });
    expect(validForeignSession.status()).toBe(200);
    expect(
      (
        await database.pool.query(
          "SELECT id, published FROM shops WHERE id = ANY($1::text[]) ORDER BY id",
          [[first.shopId, other.shopId]],
        )
      ).rows,
    ).toEqual(
      [first.shopId, other.shopId]
        .sort()
        .map((id) => ({ id, published: id === other.shopId })),
    );

    const encoded = body.toString();
    const injected = encoded.replace(
      '"expectedPublished":false',
      `"expectedPublished":false,"shopId":"${first.shopId}","ownerId":"${first.id}"`,
    );
    expect(injected).not.toBe(encoded);
    const forgedOwner = await request.post(action.url(), {
      headers: { ...headers, cookie: first.cookie },
      data: Buffer.from(injected),
    });
    expect(await forgedOwner.text()).toContain("VALIDATION_ERROR");
    expect(
      (
        await database.pool.query(
          "SELECT id, published FROM shops WHERE id = ANY($1::text[]) ORDER BY id",
          [[first.shopId, other.shopId]],
        )
      ).rows,
    ).toEqual(
      [first.shopId, other.shopId]
        .sort()
        .map((id) => ({ id, published: id === other.shopId })),
    );
    await page.unroute(`${ownerOrigin}/settings`);
  } finally {
    await otherContext.close();
  }
});
