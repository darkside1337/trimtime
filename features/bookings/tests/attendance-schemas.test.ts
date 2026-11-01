import { describe, expect, it } from "vitest";
import { setOwnerAttendanceSchema } from "../schemas";

describe("owner attendance submissions", () => {
  const valid = {
    bookingId: "00000000-0000-4000-8000-000000000001",
    expectedRevision: 0,
    operationKey: "a".repeat(43),
  };

  it("rejects confirmed as an attendance target", () => {
    const result = setOwnerAttendanceSchema.safeParse({
      ...valid,
      status: "confirmed",
    });

    expect(result.success).toBe(false);
  });

  it.each(["completed", "no_show"] as const)(
    "accepts %s as an attendance target",
    (status) => {
      expect(
        setOwnerAttendanceSchema.safeParse({ ...valid, status }).success,
      ).toBe(true);
    },
  );

  it.each(["cancelled", "unknown"])(
    "rejects %s as an attendance target",
    (status) => {
      expect(
        setOwnerAttendanceSchema.safeParse({ ...valid, status }).success,
      ).toBe(false);
    },
  );

  it.each([-1, 0.5])(
    "rejects invalid expected revision %s",
    (expectedRevision) => {
      expect(
        setOwnerAttendanceSchema.safeParse({
          ...valid,
          expectedRevision,
          status: "completed",
        }).success,
      ).toBe(false);
    },
  );

  it("rejects malformed booking IDs and operation keys", () => {
    for (const input of [
      { ...valid, bookingId: "not-a-uuid" },
      { ...valid, operationKey: "a".repeat(42) },
      { ...valid, operationKey: "!".repeat(43) },
    ])
      expect(
        setOwnerAttendanceSchema.safeParse({ ...input, status: "completed" })
          .success,
      ).toBe(false);
  });

  it("rejects extra fields and non-object input", () => {
    expect(
      setOwnerAttendanceSchema.safeParse({
        ...valid,
        status: "completed",
        shopId: "client-authority",
      }).success,
    ).toBe(false);
    expect(setOwnerAttendanceSchema.safeParse(null).success).toBe(false);
  });
});
