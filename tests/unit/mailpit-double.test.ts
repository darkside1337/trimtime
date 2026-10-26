import { afterEach, describe, expect, it } from "vitest";
import { createMailpitDouble } from "../support/mailpit-double.mjs";

describe("Mailpit test double", () => {
  let server: ReturnType<typeof createMailpitDouble> | undefined;

  afterEach(async () => {
    if (!server?.listening) return;
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
  });

  it("accepts a send and exposes the recipient and attempt header for verification", async () => {
    server = createMailpitDouble();
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No TCP address");
    const origin = `http://127.0.0.1:${address.port}`;
    const sent = await fetch(`${origin}/api/v1/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        From: { Email: "noreply@trimtime.test", Name: "TrimTime Demo" },
        To: [{ Email: "success-booking-1@trimtime.test" }],
        Subject: "Booking confirmed",
        Text: "Captured locally",
        Headers: { "X-TrimTime-Attempt-ID": "attempt-1" },
      }),
    });
    expect(sent.status).toBe(200);
    const { ID } = (await sent.json()) as { ID: string };
    expect(ID).toBeTruthy();
    const message = await fetch(`${origin}/api/v1/message/${ID}`);
    expect(await message.json()).toMatchObject({
      To: [{ Address: "success-booking-1@trimtime.test" }],
    });
    const headers = await fetch(`${origin}/api/v1/message/${ID}/headers`);
    expect(await headers.json()).toMatchObject({
      "X-TrimTime-Attempt-ID": ["attempt-1"],
    });
  });

  it("routes explicit transient and permanent rejection prefixes", async () => {
    server = createMailpitDouble();
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No TCP address");
    const origin = `http://127.0.0.1:${address.port}`;

    for (const [prefix, status] of [
      ["reject-429-case", 429],
      ["reject-5xx-case", 503],
      ["reject-4xx-case", 400],
    ] as const) {
      const response = await fetch(`${origin}/api/v1/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ To: [{ Email: `${prefix}@trimtime.test` }] }),
      });
      expect(response.status).toBe(status);
    }

    const ownerAlert = await fetch(`${origin}/api/v1/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        To: [{ Email: "e2e-owner-alert@example.test" }],
      }),
    });
    expect(ownerAlert.status).toBe(200);
  });

  it("delays success and can return mismatched capture evidence", async () => {
    server = createMailpitDouble();
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No TCP address");
    const origin = `http://127.0.0.1:${address.port}`;
    const started = Date.now();
    const sent = await fetch(`${origin}/api/v1/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        To: [{ Email: "delay-case@trimtime.test" }],
        Headers: { "X-TrimTime-Attempt-ID": "attempt-delay" },
      }),
    });
    expect(sent.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2_000);

    for (const [recipient, expected] of [
      [
        "mismatch-recipient-case@trimtime.test",
        "wrong-mismatch-recipient-case@trimtime.test",
      ],
      ["mismatch-header-case@trimtime.test", "wrong-attempt-mismatch"],
    ] as const) {
      const response = await fetch(`${origin}/api/v1/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          To: [{ Email: recipient }],
          Headers: { "X-TrimTime-Attempt-ID": "attempt-mismatch" },
        }),
      });
      const { ID } = (await response.json()) as { ID: string };
      const evidence = await fetch(
        `${origin}/api/v1/message/${ID}${recipient.startsWith("mismatch-header") ? "/headers" : ""}`,
      );
      const json = await evidence.json();
      if (recipient.startsWith("mismatch-header")) {
        expect(json).toMatchObject({ "X-TrimTime-Attempt-ID": [expected] });
      } else {
        expect(json).toMatchObject({ To: [{ Address: expected }] });
      }
    }
  });

  it("keeps the timeout route pending beyond the transport's three-second deadline", async () => {
    server = createMailpitDouble();
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No TCP address");
    const started = Date.now();
    await expect(
      fetch(`http://127.0.0.1:${address.port}/api/v1/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ To: [{ Email: "timeout-case@trimtime.test" }] }),
        signal: AbortSignal.timeout(3000),
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
  });
});
