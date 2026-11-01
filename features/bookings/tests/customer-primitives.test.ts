import { describe, expect, it } from "vitest";
import {
  isCustomerChangeCutoffPassed,
  isCustomerManageLinkValid,
} from "../customer-primitives";

const HOUR_MS = 60 * 60_000;

describe("customer booking time predicates", () => {
  it("denies manage-link access at exact 168-hour expiry and when revoked", () => {
    const endAt = new Date("2026-11-01T05:30:00.000Z");
    const expiry = new Date(endAt.getTime() + 168 * HOUR_MS);

    expect(
      isCustomerManageLinkValid(endAt, null, new Date(expiry.getTime() - 1)),
    ).toBe(true);
    expect(isCustomerManageLinkValid(endAt, null, expiry)).toBe(false);
    expect(
      isCustomerManageLinkValid(
        endAt,
        new Date("2026-10-31T00:00:00.000Z"),
        new Date("2026-11-02T00:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("permits the exact 12-hour cutoff and denies one millisecond inside it", () => {
    const now = new Date("2026-11-01T12:00:00.000Z");

    expect(
      isCustomerChangeCutoffPassed(new Date(now.getTime() + 12 * HOUR_MS), now),
    ).toBe(false);
    expect(
      isCustomerChangeCutoffPassed(
        new Date(now.getTime() + 12 * HOUR_MS - 1),
        now,
      ),
    ).toBe(true);
  });

  it("measures expiry as 168 elapsed hours across a daylight-saving transition", () => {
    // America/New_York moves from UTC-5 to UTC-4 during this interval.
    const endAt = new Date("2026-03-01T07:30:00.000Z");
    const elapsedExpiry = new Date("2026-03-08T07:30:00.000Z");

    expect(
      isCustomerManageLinkValid(
        endAt,
        null,
        new Date(elapsedExpiry.getTime() - 1),
      ),
    ).toBe(true);
    expect(isCustomerManageLinkValid(endAt, null, elapsedExpiry)).toBe(false);
  });

  it("measures the 12-hour cutoff as elapsed time across a daylight-saving transition", () => {
    // 01:30 EST to 14:30 EDT spans exactly 12 elapsed hours.
    const now = new Date("2026-03-08T06:30:00.000Z");
    const startAt = new Date("2026-03-08T18:30:00.000Z");

    expect(isCustomerChangeCutoffPassed(startAt, now)).toBe(false);
    expect(
      isCustomerChangeCutoffPassed(new Date(startAt.getTime() - 1), now),
    ).toBe(true);
  });
});
