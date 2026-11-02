import { beforeEach, describe, expect, it, vi } from "vitest";

const { processRetries } = vi.hoisted(() => ({
  processRetries: vi.fn(),
}));

vi.mock("../retry-worker", () => ({
  processNotificationRetries: processRetries,
}));

let POST: (request: Request) => Promise<Response>;
let GET: (request: Request) => Promise<Response>;
let HEAD: (request: Request) => Promise<Response>;
let PUT: (request: Request) => Promise<Response>;

const validSecret = "test-only-notification-job-secret-at-least-32";

function request(
  options: {
    secret?: string;
    host?: string;
    method?: string;
    url?: string;
    body?: string;
  } = {},
) {
  const headers = new Headers({ host: options.host ?? "app.localhost:3000" });
  if (options.secret !== undefined)
    headers.set("x-trimtime-job-secret", options.secret);
  return new Request(
    options.url ?? "http://app.localhost:3000/api/jobs/notifications/retry",
    {
      method: options.method ?? "POST",
      headers,
      body: options.body,
    },
  );
}

describe("protected notification retry route", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    process.env.APP_ORIGIN = "http://app.localhost:3000";
    process.env.MARKETING_ORIGIN = "http://localhost:3000";
    process.env.NOTIFICATION_JOB_SECRET = validSecret;
    processRetries.mockResolvedValue({
      processed: 0,
      attempted: 0,
      reconciled: 0,
      recoveredUnknown: 0,
      suppressed: 0,
    });
    vi.resetModules();
    ({ POST, GET, HEAD, PUT } =
      await import("@/app/api/jobs/notifications/retry/route"));
  });

  it("rejects a missing job secret without processing retries", async () => {
    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(processRetries).not.toHaveBeenCalled();
  });

  it("rejects a wrong job secret without processing retries", async () => {
    const response = await POST(request({ secret: "wrong" }));

    expect(response.status).toBe(401);
    expect(processRetries).not.toHaveBeenCalled();
  });

  it("reports invalid job-secret configuration without processing retries", async () => {
    process.env.NOTIFICATION_JOB_SECRET = "short";
    const shortSecret = await POST(request({ secret: "short" }));
    delete process.env.NOTIFICATION_JOB_SECRET;
    const missingSecret = await POST(request({ secret: validSecret }));

    expect([shortSecret.status, missingSecret.status]).toEqual([503, 503]);
    expect(processRetries).not.toHaveBeenCalled();
  });

  it("rejects requests on non-owner hosts without processing retries", async () => {
    const response = await POST(
      request({ secret: validSecret, host: "localhost:3000" }),
    );

    expect(response.status).toBe(404);
    expect(processRetries).not.toHaveBeenCalled();
  });

  it("rejects GET, HEAD, and unsupported methods without processing retries", async () => {
    const getResponse = await GET(
      request({ secret: validSecret, method: "GET" }),
    );
    const headResponse = await HEAD(
      request({ secret: validSecret, method: "HEAD" }),
    );
    const putResponse = await PUT(
      request({ secret: validSecret, method: "PUT" }),
    );

    expect([
      getResponse.status,
      headResponse.status,
      putResponse.status,
    ]).toEqual([405, 405, 405]);
    expect(processRetries).not.toHaveBeenCalled();

    const wrongHostResponse = await GET(
      request({ secret: validSecret, method: "GET", host: "localhost:3000" }),
    );
    expect(wrongHostResponse.status).toBe(404);
  });

  it("rejects query parameters and request bodies without processing retries", async () => {
    const queryResponse = await POST(
      request({
        secret: validSecret,
        url: "http://app.localhost:3000/api/jobs/notifications/retry?limit=1",
      }),
    );
    const bodyResponse = await POST(
      request({ secret: validSecret, body: "{}" }),
    );

    expect([queryResponse.status, bodyResponse.status]).toEqual([400, 400]);
    expect(processRetries).not.toHaveBeenCalled();
  });

  it("runs authorized empty POST requests and returns the worker aggregate", async () => {
    const expected = {
      processed: 2,
      attempted: 1,
      reconciled: 0,
      recoveredUnknown: 1,
      suppressed: 0,
    };
    processRetries.mockResolvedValue(expected);

    const response = await POST(request({ secret: validSecret }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
    expect(processRetries).toHaveBeenCalledOnce();
  });

  it("returns a generic response when processing throws", async () => {
    processRetries.mockRejectedValue(
      new Error("private recipient and provider response"),
    );

    const response = await POST(request({ secret: validSecret }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Notification processing failed.",
    });
    expect(processRetries).toHaveBeenCalledOnce();
  });

  it("returns only aggregate counts from the worker", async () => {
    processRetries.mockResolvedValue({
      processed: 1,
      attempted: 1,
      reconciled: 0,
      recoveredUnknown: 0,
      suppressed: 0,
      recipient: "private@example.test",
      bookingId: "booking-private",
      providerPayload: { token: "never-return" },
    });

    const response = await POST(request({ secret: validSecret }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      processed: 1,
      attempted: 1,
      reconciled: 0,
      recoveredUnknown: 0,
      suppressed: 0,
    });
  });
});
