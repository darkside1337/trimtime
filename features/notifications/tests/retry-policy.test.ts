import { describe, expect, it } from "vitest";
import { getNextRetryAt } from "../retry-policy";

describe("automatic email retry timing", () => {
  it("schedules attempt two ten minutes after transient failure", () => {
    const next = getNextRetryAt({
      attemptNumber: 1,
      reason: "transient_rejection",
      finishedAt: new Date("2026-11-02T08:00:00.000Z"),
    });

    expect(next?.toISOString()).toBe("2026-11-02T08:10:00.000Z");
  });

  it("schedules attempt three twenty minutes after transient failure", () => {
    const next = getNextRetryAt({
      attemptNumber: 2,
      reason: "transient_rejection",
      finishedAt: new Date("2026-11-02T08:10:00.000Z"),
    });

    expect(next?.toISOString()).toBe("2026-11-02T08:30:00.000Z");
  });

  it("does not schedule another retry after attempt three", () => {
    const next = getNextRetryAt({
      attemptNumber: 3,
      reason: "transient_rejection",
      finishedAt: new Date("2026-11-02T08:30:00.000Z"),
    });

    expect(next).toBeNull();
  });

  it.each(["permanent_rejection", "unknown"])(
    "does not retry %s failures",
    (reason) => {
      const next = getNextRetryAt({
        attemptNumber: 1,
        reason,
        finishedAt: new Date("2026-11-02T08:00:00.000Z"),
      });

      expect(next).toBeNull();
    },
  );
});
