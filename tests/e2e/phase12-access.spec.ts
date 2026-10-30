import { randomBytes } from "node:crypto";
import { expect, ownerOrigin, test } from "./fixtures";
import { createOwnerAppointment } from "./owner-booking-fixtures";

test("restore Server Action rejects signed-out, foreign-owner, wrong-host, and wrong-origin requests without writes", async ({
  page,
  context,
  browser,
  owners,
  request,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const foreignContext = await browser.newContext();
  try {
    const foreignOwner = await owners(foreignContext, {
      shop: true,
      createSetup: true,
    });
    const bookingId = await createOwnerAppointment(owner);
    const { cancelOwnerBooking } = await import(
      "../../features/bookings/mutations"
    );
    const cancelled = await cancelOwnerBooking(
      { userId: owner.id },
      {
        bookingId,
        expectedRevision: 0,
        operationKey: randomBytes(32).toString("base64url"),
      },
    );
    expect(cancelled.success).toBe(true);

    const unchanged = async () => {
      const booking = await database.pool.query(
        "SELECT status, revision, occupancy_id FROM bookings WHERE id=$1",
        [bookingId],
      );
      expect(booking.rows).toEqual([
        { status: "cancelled", revision: 1, occupancy_id: null },
      ]);
      expect(
        (
          await database.pool.query(
            "SELECT kind, applied_revision FROM booking_changes WHERE booking_id=$1 ORDER BY applied_revision",
            [bookingId],
          )
        ).rows,
      ).toEqual([{ kind: "cancel", applied_revision: 1 }]);
    };
    await unchanged();

    await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
    await page.getByRole("button", { name: "Restore appointment" }).click();
    let body: Buffer | undefined;
    let actionUrl = "";
    let contentType = "";
    let actionId = "";
    await page.route("**/*", async (route) => {
      const actionRequest = route.request();
      if (
        actionRequest.method() === "POST" &&
        actionRequest.headers()["next-action"]
      ) {
        body = actionRequest.postDataBuffer()!;
        actionUrl = actionRequest.url();
        contentType = actionRequest.headers()["content-type"] ?? "";
        actionId = actionRequest.headers()["next-action"] ?? "";
        await route.abort();
      } else await route.continue();
    });
    await page
      .getByRole("dialog", { name: "Restore appointment?" })
      .getByRole("button", { name: "Restore appointment" })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "response was interrupted",
    );
    expect(body).toBeDefined();
    await page.unrouteAll({ behavior: "wait" });
    await unchanged();

    const headers = {
      "content-type": contentType,
      "next-action": actionId,
      origin: ownerOrigin,
    };

    const getResponse = await request.get(actionUrl, { headers });
    expect(getResponse.status()).toBeLessThan(500);
    await unchanged();

    const headResponse = await request.head(actionUrl, { headers });
    expect(headResponse.status()).toBeLessThan(500);
    await unchanged();

    const signedOut = await request.post(actionUrl, { headers, data: body! });
    expect(await signedOut.text()).toContain("UNAUTHENTICATED");
    await unchanged();

    const foreignReplay = await request.post(actionUrl, {
      headers: { ...headers, cookie: foreignOwner.cookie },
      data: body!,
    });
    const foreignText = await foreignReplay.text();
    expect(foreignText).toMatch(/NOT_FOUND|SHOP_REQUIRED/);
    expect(foreignText).not.toContain("Move Journey Guest");
    await unchanged();

    const wrongOrigin = await request.post(actionUrl, {
      headers: {
        ...headers,
        cookie: owner.cookie,
        origin: "https://attacker.example",
      },
      data: body!,
    });
    expect(
      wrongOrigin.status() >= 400 ||
        (await wrongOrigin.text()).includes("UNAVAILABLE"),
    ).toBe(true);
    await unchanged();

    const wrongHost = await request.post(actionUrl, {
      headers: {
        ...headers,
        cookie: owner.cookie,
        host: `${owner.subdomain}.localhost:3100`,
        "x-forwarded-host": `${owner.subdomain}.localhost:3100`,
      },
      data: body!,
    });
    expect(
      wrongHost.status() >= 400 ||
        (await wrongHost.text()).includes("UNAVAILABLE"),
    ).toBe(true);
    await unchanged();

    const malformed = await request.post(actionUrl, {
      headers: { ...headers, cookie: owner.cookie },
      data: Buffer.from("not a serialized server action"),
    });
    expect(malformed.status()).toBeGreaterThanOrEqual(400);
    await unchanged();

    const accepted = await request.post(actionUrl, {
      headers: { ...headers, cookie: owner.cookie },
      data: body!,
    });
    expect(accepted.status()).toBeLessThan(500);
    expect(await accepted.text()).toContain('"success":true');

    const restored = await database.pool.query(
      "SELECT status, revision, occupancy_id FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(restored.rows[0]).toMatchObject({
      status: "confirmed",
      revision: 2,
    });
    expect(restored.rows[0].occupancy_id).toEqual(expect.any(String));
    expect(
      (
        await database.pool.query(
          "SELECT kind, applied_revision FROM booking_changes WHERE booking_id=$1 ORDER BY applied_revision",
          [bookingId],
        )
      ).rows,
    ).toEqual([
      { kind: "cancel", applied_revision: 1 },
      { kind: "restore", applied_revision: 2 },
    ]);
  } finally {
    await foreignContext.close();
  }
});
