import { randomBytes } from "node:crypto";
import { expect, ownerOrigin, test } from "./fixtures";
import { createOwnerAppointment } from "./owner-booking-fixtures";

test("owner move rejects foreign service and barber with fresh current-revision keys", async ({
  context,
  browser,
  owners,
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
    const before = await database.pool.query(
      "SELECT status, service_id, barber_id, revision, occupancy_id FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(before.rows).toHaveLength(1);
    expect(Number(before.rows[0].revision)).toBe(0);
    const occupancyBefore = await database.pool.query(
      "SELECT id, shop_id, barber_id, start_at, end_at FROM occupied_intervals WHERE id=$1",
      [before.rows[0].occupancy_id],
    );
    const { moveOwnerBooking } =
      await import("../../features/bookings/mutations");
    const common = {
      bookingId,
      expectedRevision: Number(before.rows[0].revision),
      startAt: "2027-01-19T14:07:00.000Z",
      reviewedOffer: {
        name: "Walk-in Cut",
        priceUsd: "25.00",
        durationMinutes: "35",
      },
    };
    const foreignService = await moveOwnerBooking(
      { userId: owner.id },
      {
        ...common,
        operationKey: randomBytes(32).toString("base64url"),
        serviceId: foreignOwner.serviceId!,
        barberId: owner.barberId!,
      },
    );
    expect(foreignService.success).toBe(false);
    if (!foreignService.success)
      expect(foreignService.error.code).toBe("STALE_OFFER");

    const foreignBarber = await moveOwnerBooking(
      { userId: owner.id },
      {
        ...common,
        operationKey: randomBytes(32).toString("base64url"),
        serviceId: owner.serviceId!,
        barberId: foreignOwner.barberId!,
      },
    );
    expect(foreignBarber.success).toBe(false);
    if (!foreignBarber.success)
      expect(foreignBarber.error.code).toBe("UNAVAILABLE_INTERVAL");

    const after = await database.pool.query(
      "SELECT status, service_id, barber_id, revision, occupancy_id FROM bookings WHERE id=$1",
      [bookingId],
    );
    expect(after.rows).toEqual(before.rows);
    expect(
      (
        await database.pool.query(
          "SELECT id, shop_id, barber_id, start_at, end_at FROM occupied_intervals WHERE id=$1",
          [before.rows[0].occupancy_id],
        )
      ).rows,
    ).toEqual(occupancyBefore.rows);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1",
          [bookingId],
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    await foreignContext.close();
  }
});

test("move Server Action rejects signed-out, foreign-owner, host, origin, and malformed requests", async ({
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
    const before = await database.pool.query(
      "SELECT status, service_id, barber_id, revision, occupancy_id FROM bookings WHERE id=$1",
      [bookingId],
    );
    const occupancyBefore = await database.pool.query(
      "SELECT id, shop_id, barber_id, start_at, end_at FROM occupied_intervals WHERE id=$1",
      [before.rows[0].occupancy_id],
    );

    await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
    await page.getByRole("button", { name: "Move appointment" }).click();
    await page.getByLabel("Start time").fill("10:07");
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
    await page.getByRole("button", { name: "Save move" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "response was interrupted",
    );
    expect(body).toBeDefined();
    await page.unrouteAll({ behavior: "wait" });
    const headers = {
      "content-type": contentType,
      "next-action": actionId,
      origin: ownerOrigin,
    };
    const signedOut = await request.post(actionUrl, { headers, data: body! });
    expect(await signedOut.text()).toContain("UNAUTHENTICATED");
    const foreignOwnerResponse = await request.post(actionUrl, {
      headers: { ...headers, cookie: foreignOwner.cookie },
      data: body!,
    });
    expect(await foreignOwnerResponse.text()).toMatch(
      /NOT_FOUND|SHOP_REQUIRED/,
    );
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
    const malformed = await request.post(actionUrl, {
      headers: { ...headers, cookie: owner.cookie },
      data: Buffer.from("not a serialized server action"),
    });
    expect(malformed.status()).toBeGreaterThanOrEqual(400);

    expect(
      (
        await database.pool.query(
          "SELECT status, service_id, barber_id, revision, occupancy_id FROM bookings WHERE id=$1",
          [bookingId],
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await database.pool.query(
          "SELECT id, shop_id, barber_id, start_at, end_at FROM occupied_intervals WHERE id=$1",
          [before.rows[0].occupancy_id],
        )
      ).rows,
    ).toEqual(occupancyBefore.rows);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1",
          [bookingId],
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    await foreignContext.close();
  }
});

test("cancellation Server Action rejects signed-out, foreign-owner, wrong-host, and wrong-origin requests", async ({
  page,
  context,
  browser,
  owners,
  request,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const foreignContext = await browser.newContext();
  try {
    const foreignOwner = await owners(foreignContext, {
      shop: true,
      createSetup: true,
    });
    const bookingId = await createOwnerAppointment(owner);
    await page.goto(`${ownerOrigin}/appointments/${bookingId}`);
    await page.getByRole("button", { name: "Cancel appointment" }).click();
    const capturedPromise = page.waitForRequest(
      (entry) =>
        entry.method() === "POST" && Boolean(entry.headers()["next-action"]),
    );
    await page.getByRole("button", { name: "Confirm cancellation" }).click();
    const action = await capturedPromise;
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    const body = action.postDataBuffer()!;
    const headers = {
      "content-type": action.headers()["content-type"],
      "next-action": action.headers()["next-action"],
      origin: ownerOrigin,
    };

    const signedOut = await request.post(action.url(), { headers, data: body });
    expect(await signedOut.text()).toContain("UNAUTHENTICATED");
    const foreignOwnerReplay = await request.post(action.url(), {
      headers: { ...headers, cookie: foreignOwner.cookie },
      data: body,
    });
    const foreignText = await foreignOwnerReplay.text();
    expect(foreignText).toMatch(/NOT_FOUND|SHOP_REQUIRED/);
    expect(foreignText).not.toContain("Move Journey Guest");

    const wrongOrigin = await request.post(action.url(), {
      headers: {
        ...headers,
        cookie: owner.cookie,
        origin: "https://attacker.example",
      },
      data: body,
    });
    expect(
      wrongOrigin.status() >= 400 ||
        (await wrongOrigin.text()).includes("UNAVAILABLE"),
    ).toBe(true);
    const wrongHost = await request.post(action.url(), {
      headers: {
        ...headers,
        cookie: owner.cookie,
        host: `${owner.subdomain}.localhost:3100`,
        "x-forwarded-host": `${owner.subdomain}.localhost:3100`,
      },
      data: body,
    });
    expect(
      wrongHost.status() >= 400 ||
        (await wrongHost.text()).includes("UNAVAILABLE"),
    ).toBe(true);
  } finally {
    await foreignContext.close();
  }
});

test("direct owner cancellation rejects ended and already-cancelled appointments", async ({
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const { cancelOwnerBooking } =
    await import("../../features/bookings/mutations");
  const cancelledId = await createOwnerAppointment(owner);
  const cancelled = await cancelOwnerBooking(
    { userId: owner.id },
    {
      bookingId: cancelledId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    },
  );
  expect(cancelled.success).toBe(true);
  const afterCancel = await cancelOwnerBooking(
    { userId: owner.id },
    {
      bookingId: cancelledId,
      expectedRevision: 1,
      operationKey: randomBytes(32).toString("base64url"),
    },
  );
  expect(afterCancel.success).toBe(false);
  if (!afterCancel.success)
    expect(afterCancel.error.code).toBe("INVALID_STATE");

  const endedId = await createOwnerAppointment(
    owner,
    "2027-01-19T15:07:00.000Z",
  );
  await database.pool.query(
    "UPDATE bookings SET start_at='2026-10-26T10:07:00Z', end_at='2026-10-26T10:42:00Z' WHERE id=$1",
    [endedId],
  );
  const ended = await cancelOwnerBooking(
    { userId: owner.id },
    {
      bookingId: endedId,
      expectedRevision: 0,
      operationKey: randomBytes(32).toString("base64url"),
    },
  );
  expect(ended.success).toBe(false);
  if (!ended.success) expect(ended.error.code).toBe("INVALID_STATE");

  const states = await database.pool.query(
    "SELECT id, status, revision, occupancy_id FROM bookings WHERE id=ANY($1::uuid[]) ORDER BY id",
    [[cancelledId, endedId]],
  );
  expect(states.rows).toHaveLength(2);
  expect(states.rows.find((row) => row.id === cancelledId)).toMatchObject({
    status: "cancelled",
    revision: 1,
    occupancy_id: null,
  });
  expect(states.rows.find((row) => row.id === endedId)).toMatchObject({
    status: "confirmed",
    revision: 0,
  });
  expect(
    (
      await database.pool.query(
        "SELECT kind FROM booking_changes WHERE booking_id=$1",
        [cancelledId],
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await database.pool.query(
        "SELECT count(*)::int AS count FROM booking_changes WHERE booking_id=$1",
        [endedId],
      )
    ).rows[0].count,
  ).toBe(0);
});
