import { describe, expect, it } from "vitest";
import {
  customerEmailStatusCopy,
  customerEmailSummary,
  ownerEmailStatusCopy,
} from "@/features/notifications/customer-summary";

describe("customer notification summary", () => {
  it("presents stale sends as unknown with a safe reason and copy", () => {
    const summary = customerEmailSummary(
      {
        status: "sending",
        reason: null,
        claimedAt: "2026-11-02T07:59:29.999Z",
        updatedAt: "2026-11-02T07:59:29.999Z",
      },
      new Date("2026-11-02T08:00:00Z"),
    );

    expect(summary).toEqual({
      status: "unknown",
      reason: "capture_result_unknown",
      updatedAt: "2026-11-02T07:59:29.999Z",
    });
    expect(customerEmailStatusCopy(summary)).toContain("result is unknown");
  });

  it("keeps a send pending at exactly thirty seconds", () => {
    expect(
      customerEmailSummary(
        {
          status: "sending",
          reason: null,
          claimedAt: "2026-11-02T07:59:30.000Z",
          updatedAt: null,
        },
        new Date("2026-11-02T08:00:00Z"),
      ).status,
    ).toBe("sending");
  });

  it.each([
    ["not_attempted", "pending local capture"],
    ["sending", "pending local capture"],
    ["accepted", "Capture verification is unavailable"],
    ["captured", "Captured locally. Inbox delivery is not enabled."],
    ["failed", "could not be captured"],
    ["skipped", "was skipped"],
    ["suppressed", "was not sent"],
    ["unknown", "result is unknown"],
    ["unavailable", "unavailable in this demo"],
  ] as const)("uses truthful %s copy", (status, expected) => {
    const copy = customerEmailStatusCopy({
      status,
      reason: null,
      updatedAt: null,
    });
    expect(copy).toContain(expected);
    expect(copy).not.toMatch(/delivered/i);
  });

  it("maps private failure details to customer-safe reasons", () => {
    expect(
      customerEmailSummary(
        {
          status: "failed",
          reason: "transient_rejection",
          claimedAt: null,
          updatedAt: null,
        },
        new Date("2026-11-02T08:00:00Z"),
      ),
    ).toEqual({
      status: "failed",
      reason: "message_rejected",
      updatedAt: null,
    });
  });

  it("uses owner appointment copy without claiming a customer link", () => {
    const copy = ownerEmailStatusCopy({
      status: "skipped",
      reason: "recipient_unavailable",
      updatedAt: null,
    });
    expect(copy).toContain("no recipient was provided");
    expect(copy).not.toMatch(/private link|manage link/i);
  });
});
