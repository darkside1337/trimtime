import { randomUUID } from "node:crypto";
import { test, expect, ownerOrigin } from "./fixtures";

test("owner appointment action replay rejects changed authority without writes", async ({
  page,
  context,
  browser,
  owners,
  request,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const otherContext = await browser.newContext();
  try {
    const other = await owners(otherContext, {
      shop: true,
      createSetup: true,
    });
    await page.goto(`${ownerOrigin}/?date=2026-11-02&view=day`);
    await page.getByRole("link", { name: "New appointment" }).click();
    await page.getByLabel("Customer name").fill("Action Replay Guest");
    await page.getByLabel(/^Service/).selectOption({ value: owner.serviceId! });
    await page
      .getByRole("dialog")
      .locator("form select")
      .nth(1)
      .selectOption({ value: owner.barberId! });
    await page.getByRole("textbox", { name: /^Date/ }).fill("2026-11-03");
    await page.getByLabel("Start time").fill("13:07");

    const capture = page.waitForRequest(
      (entry) =>
        entry.method() === "POST" && Boolean(entry.headers()["next-action"]),
    );
    await page.getByRole("button", { name: "Create appointment" }).click();
    const action = await capture;
    await expect(page).toHaveURL(/created=[0-9a-f-]{36}/);

    const body = action.postDataBuffer()!;
    const encoded = body.toString();
    const headers = {
      "content-type": action.headers()["content-type"],
      "next-action": action.headers()["next-action"],
      origin: ownerOrigin,
    };
    const baseline = await database.pool.query(
      "SELECT id, service_id, barber_id FROM bookings WHERE shop_id = ANY($1::text[]) ORDER BY id",
      [[owner.shopId, other.shopId]],
    );
    expect(baseline.rows).toHaveLength(1);
    const baselineRows = baseline.rows;
    const protectedContent = await database.pool.query(
      "SELECT customer_name, customer_email, customer_phone, capability_ciphertext, recovery_key_hash FROM bookings WHERE id = $1",
      [baselineRows[0].id],
    );
    expect(protectedContent.rows[0].customer_name).toBe("Action Replay Guest");

    const signedOut = await request.post(action.url(), { headers, data: body });
    expect(await signedOut.text()).toContain("UNAUTHENTICATED");

    const invalidContact = await request.post(action.url(), {
      headers: { ...headers, cookie: owner.cookie },
      data: Buffer.from(encoded.replace("Action Replay Guest", "")),
    });
    const invalidContactBody = await invalidContact.text();
    expect(invalidContactBody).toContain("VALIDATION_ERROR");
    expect(invalidContactBody).toContain("customerName");

    const changedSession = await request.post(action.url(), {
      headers: { ...headers, cookie: other.cookie },
      data: body,
    });
    expect(await changedSession.text()).toMatch(
      /SHOP_REQUIRED|VALIDATION_ERROR|STALE_OFFER|UNAVAILABLE/,
    );

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

    for (const [foreignServiceId, foreignBarberId] of [
      [other.serviceId!, owner.barberId!],
      [owner.serviceId!, other.barberId!],
    ]) {
      const crossOwnerBody = Buffer.from(
        encoded
          .replaceAll(owner.serviceId!, foreignServiceId)
          .replaceAll(owner.barberId!, foreignBarberId),
      );
      expect(crossOwnerBody.toString()).toContain(foreignServiceId);
      expect(crossOwnerBody.toString()).toContain(foreignBarberId);
      const response = await request.post(action.url(), {
        headers: { ...headers, cookie: owner.cookie },
        data: crossOwnerBody,
      });
      const text = await response.text();
      expect(text).toMatch(/VALIDATION_ERROR|UNAVAILABLE|RECOVERY_MISMATCH/);
      expect(text).not.toContain(other.id);
      expect(text).not.toContain("Manual Barber");
    }

    expect(
      (
        await database.pool.query(
          "SELECT id, service_id, barber_id FROM bookings WHERE shop_id = ANY($1::text[]) ORDER BY id",
          [[owner.shopId, other.shopId]],
        )
      ).rows,
    ).toEqual(baselineRows);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM notification_work WHERE booking_id = $1",
          [baselineRows[0].id],
        )
      ).rows[0].count,
    ).toBe(1);
    const foreignRead = await request.get(
      `${ownerOrigin}/appointments/${baselineRows[0].id}`,
      { headers: { cookie: other.cookie } },
    );
    const foreignHtml = await foreignRead.text();
    expect([200, 404]).toContain(foreignRead.status());
    expect(foreignHtml).toMatch(/not found|could not be found/i);
    expect(foreignHtml).not.toContain("Action Replay Guest");
    for (const [column, value] of Object.entries(protectedContent.rows[0])) {
      if (column !== "customer_name" && value !== null)
        expect(foreignHtml).not.toContain(String(value));
    }
  } finally {
    await otherContext.close();
  }
});

test("appointment details authorize saved rows and hide signed-out, foreign, and invalid records", async ({
  page,
  context,
  browser,
  owners,
  request,
  database,
}) => {
  const owner = await owners(context, { shop: true, appointment: true });
  const otherContext = await browser.newContext();
  try {
    const other = await owners(otherContext, { shop: true });
    const own = await request.get(
      `${ownerOrigin}/appointments/${owner.appointmentId}`,
      { headers: { cookie: owner.cookie } },
    );
    expect(own.status()).toBe(200);
    expect(await own.text()).toContain("Fictional Guest");

    const signedOut = await request.get(
      `${ownerOrigin}/appointments/${owner.appointmentId}`,
      { maxRedirects: 0 },
    );
    expect([200, 307]).toContain(signedOut.status());
    if (signedOut.status() === 307)
      expect(signedOut.headers().location).toContain("/sign-in");
    const signedOutHtml = await signedOut.text();
    expect(signedOutHtml).toMatch(/sign-in|Continue with Google/i);
    expect(signedOutHtml).not.toContain("Fictional Guest");

    const savedSecrets = await database.pool.query(
      "SELECT customer_name, customer_email, customer_phone, service_name, barber_name, service_id, barber_id, capability_ciphertext, recovery_key_hash FROM bookings WHERE id = $1",
      [owner.appointmentId],
    );
    for (const id of [owner.appointmentId!, randomUUID()]) {
      const readAttempts: { headers: Record<string, string>; rsc: boolean }[] =
        [
          { headers: { cookie: other.cookie }, rsc: false },
          {
            headers: {
              cookie: owner.cookie,
              RSC: "1",
              Accept: "text/x-component",
            },
            rsc: true,
          },
        ];
      for (const entry of readAttempts) {
        const response = await request.get(
          `${ownerOrigin}/appointments/${id}`,
          {
            headers: entry.headers,
          },
        );
        const body = await response.text();
        expect([200, 404]).toContain(response.status());
        expect(body).not.toContain("Fictional Guest");
        expect(body).not.toContain("Saved Cut");
        expect(body).not.toContain("Saved Barber");
        for (const value of Object.values(savedSecrets.rows[0]))
          if (value !== null) expect(body).not.toContain(String(value));
        expect(body).toMatch(/not found|could not be found/i);
        if (entry.rsc)
          expect(response.headers()["content-type"]).toContain(
            "text/x-component",
          );
      }
    }

    const visibleRows = await database.pool.query(
      "SELECT id FROM bookings WHERE shop_id = $1",
      [owner.shopId],
    );
    expect(visibleRows.rows.map((row) => row.id)).toEqual([
      owner.appointmentId,
    ]);
    await page.goto(`${ownerOrigin}/appointments/${owner.appointmentId}`);
    await expect(
      page.getByRole("heading", { name: "Appointment details" }),
    ).toBeVisible();
    await expect(page.getByText("Fictional Guest")).toBeVisible();
  } finally {
    await otherContext.close();
  }
});
