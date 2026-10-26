import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMailpitMessage } from "../mailpit";
import type { OutboundMessage } from "../messages";

const message: OutboundMessage = {
  to: "ari@example.test",
  from: { email: "noreply@trimtime.test", name: "TrimTime Demo" },
  subject: "Booking confirmed — Northside Barber",
  text: "Booking details",
};

function response(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), { status });
}

function capturedResponses(
  recipient = message.to,
  attemptId = "attempt-1",
  correlation = [attemptId],
) {
  return [
    response({ ID: "capture-1" }),
    response({ To: [{ Address: recipient }] }),
    response({ "X-TrimTime-Attempt-ID": correlation }),
  ];
}

function queuedFetch(responses: Response[]) {
  return vi.fn<typeof fetch>(async () => responses.shift()!);
}

describe("Mailpit transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requires POST acceptance and matching recipient and attempt header evidence", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = queuedFetch(capturedResponses());
    vi.stubGlobal("fetch", fetchMock);
    const onInvoked = vi.fn(async () => {});

    const result = await sendMailpitMessage({
      origin: "http://127.0.0.1:8025",
      message,
      attemptId: "attempt-1",
      onInvoked,
    });

    expect(result).toEqual({
      status: "captured",
      reason: null,
      captureId: "capture-1",
      invoked: true,
    });
    expect(onInvoked).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(timeout.mock.calls).toEqual([[3000], [3000], [3000]]);
    const [postUrl, postInit] = fetchMock.mock.calls[0]!;
    expect(postUrl).toBe("http://127.0.0.1:8025/api/v1/send");
    expect(postInit?.redirect).toBe("error");
    expect(postInit?.signal).toBeInstanceOf(AbortSignal);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(JSON.parse(String(postInit?.body))).toMatchObject({
      From: { Email: "noreply@trimtime.test", Name: "TrimTime Demo" },
      To: [{ Email: "ari@example.test" }],
      Headers: { "X-TrimTime-Attempt-ID": "attempt-1" },
    });
  });

  it.each([
    [429, "transient_rejection"],
    [503, "transient_rejection"],
    [400, "permanent_rejection"],
    [422, "permanent_rejection"],
  ] as const)("classifies HTTP %s rejection", async (status, reason) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({}, status)),
    );

    const result = await sendMailpitMessage({
      origin: "http://127.0.0.1:8025",
      message,
      attemptId: "attempt-1",
      onInvoked: async () => {},
    });

    expect(result).toEqual({
      status: "failed",
      reason,
      captureId: null,
      invoked: true,
    });
  });

  it("keeps known POST acceptance when verification fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (vi.mocked(fetch).mock.calls.length === 1)
          return response({ ID: "capture-1" });
        throw new Error("verification unavailable");
      }),
    );

    const result = await sendMailpitMessage({
      origin: "http://127.0.0.1:8025",
      message,
      attemptId: "attempt-1",
      onInvoked: async () => {},
    });

    expect(result).toEqual({
      status: "accepted",
      reason: "capture_verification_unavailable",
      captureId: "capture-1",
      invoked: true,
    });
  });

  it.each([
    [
      "recipient",
      "other@example.test",
      "attempt-1",
      "capture_recipient_mismatch",
    ],
    ["correlation", message.to, "attempt-2", "capture_attempt_mismatch"],
  ] as const)(
    "retains accepted status for mismatched %s evidence",
    async (_kind, recipient, attemptId, reason) => {
      vi.stubGlobal(
        "fetch",
        queuedFetch(capturedResponses(recipient, attemptId)),
      );

      const result = await sendMailpitMessage({
        origin: "http://127.0.0.1:8025",
        message,
        attemptId: "attempt-1",
        onInvoked: async () => {},
      });

      expect(result).toEqual({
        status: "accepted",
        reason,
        captureId: "capture-1",
        invoked: true,
      });
    },
  );

  it("rejects ambiguous correlation headers", async () => {
    vi.stubGlobal(
      "fetch",
      queuedFetch(
        capturedResponses(message.to, "attempt-1", ["attempt-1", "other"]),
      ),
    );

    const result = await sendMailpitMessage({
      origin: "http://127.0.0.1:8025",
      message,
      attemptId: "attempt-1",
      onInvoked: async () => {},
    });

    expect(result.status).toBe("accepted");
    expect(result.reason).toBe("capture_attempt_mismatch");
  });

  it.each(["interrupted request", "malformed success response"])(
    "returns unknown for %s",
    async (failure) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (failure === "interrupted request")
            throw new Error("connection reset");
          return new Response("{}", { status: 200 });
        }),
      );

      const result = await sendMailpitMessage({
        origin: "http://127.0.0.1:8025",
        message,
        attemptId: "attempt-1",
        onInvoked: async () => {},
      });

      expect(result).toEqual({
        status: "unknown",
        reason:
          failure === "malformed success response"
            ? "malformed_success_response"
            : "transport_interrupted",
        captureId: null,
        invoked: true,
      });
    },
  );

  it("records invocation only after POST has been started", async () => {
    const order: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        order.push("fetch");
        return Promise.resolve(response({}, 503));
      }),
    );

    await sendMailpitMessage({
      origin: "http://127.0.0.1:8025",
      message,
      attemptId: "attempt-1",
      onInvoked: async () => {
        order.push("invoked");
      },
    });

    expect(order).toEqual(["fetch", "invoked"]);
  });

  it("returns unknown when invocation evidence persistence fails after POST starts", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.reject(new Error("connection lost")),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMailpitMessage({
      origin: "http://127.0.0.1:8025",
      message,
      attemptId: "attempt-1",
      onInvoked: async () => {
        throw new Error("database unavailable");
      },
    });

    expect(result).toEqual({
      status: "unknown",
      reason: "invocation_evidence_failed",
      captureId: null,
      invoked: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects redirects and does not follow them", async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      expect(init?.redirect).toBe("error");
      throw new TypeError("redirect mode error");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMailpitMessage({
      origin: "http://127.0.0.1:8025",
      message,
      attemptId: "attempt-1",
      onInvoked: async () => {},
    });

    expect(result.status).toBe("unknown");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
