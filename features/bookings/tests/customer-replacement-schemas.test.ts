import { describe, expect, it } from "vitest";
import { replaceCustomerBookingSchema } from "../schemas";

describe("customer replacement input", () => {
  const valid = {
    token: "t".repeat(43),
    expectedRevision: 0,
    operationKey: "k".repeat(43),
    confirmed: true as const,
    serviceId: "service-1",
    barberId: "barber-1",
    startAt: "2026-11-02T11:00:00Z",
    reviewedOffer: {
      name: "Cut",
      priceUsd: "25.00",
      durationMinutes: "30",
    },
  };

  it("rejects replacement without explicit confirmation", () => {
    const result = replaceCustomerBookingSchema.safeParse({
      ...valid,
      confirmed: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
        "confirmed",
      ]);
    }
  });

  it("accepts valid replacement input with revision zero, fresh operation key, and reviewed offer", () => {
    expect(replaceCustomerBookingSchema.parse(valid)).toEqual(valid);
  });

  it("preserves a whitespace-padded capability token byte for byte", () => {
    const padded = `  ${valid.token}\t`;

    expect(
      replaceCustomerBookingSchema.parse({ ...valid, token: padded }).token,
    ).toBe(padded);
  });

  it("rejects missing and non-literal confirmation values", () => {
    const withoutConfirmation = {
      token: valid.token,
      expectedRevision: valid.expectedRevision,
      operationKey: valid.operationKey,
      serviceId: valid.serviceId,
      barberId: valid.barberId,
      startAt: valid.startAt,
      reviewedOffer: valid.reviewedOffer,
    };
    const missingResult =
      replaceCustomerBookingSchema.safeParse(withoutConfirmation);
    expect(missingResult.success).toBe(false);
    if (!missingResult.success) {
      expect(missingResult.error.issues.map((i) => i.path)).toContainEqual([
        "confirmed",
      ]);
    }

    const nonLiteralResult = replaceCustomerBookingSchema.safeParse({
      ...valid,
      confirmed: "true",
    });
    expect(nonLiteralResult.success).toBe(false);
    if (!nonLiteralResult.success) {
      expect(nonLiteralResult.error.issues.map((i) => i.path)).toContainEqual([
        "confirmed",
      ]);
    }
  });

  it("rejects negative and fractional revision numbers", () => {
    for (const invalidRevision of [-1, -42, 0.5, 1.2]) {
      const result = replaceCustomerBookingSchema.safeParse({
        ...valid,
        expectedRevision: invalidRevision,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.path)).toContainEqual([
          "expectedRevision",
        ]);
      }
    }
  });

  it("rejects malformed operation keys", () => {
    for (const invalidKey of [
      "",
      "k".repeat(42),
      "k".repeat(44),
      "!".repeat(43),
      "k".repeat(42) + " ",
      "k".repeat(42) + "@",
    ]) {
      const result = replaceCustomerBookingSchema.safeParse({
        ...valid,
        operationKey: invalidKey,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.path)).toContainEqual([
          "operationKey",
        ]);
      }
    }
  });

  it("rejects non-minute instants and malformed startAt values", () => {
    for (const invalidStart of [
      "2026-11-02T11:00:30Z",
      "2026-11-02T11:00:00.500Z",
      "2026-11-02T11:00:00.001Z",
      "2026-11-02T11:00:00",
      "not-an-instant",
      "",
    ]) {
      const result = replaceCustomerBookingSchema.safeParse({
        ...valid,
        startAt: invalidStart,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.path)).toContainEqual([
          "startAt",
        ]);
      }
    }
  });

  it("rejects malformed reviewed offer values and extra offer fields", () => {
    for (const invalidOffer of [
      { name: "", priceUsd: "25.00", durationMinutes: "30" },
      { name: "   ", priceUsd: "25.00", durationMinutes: "30" },
      { name: "Cut", priceUsd: "25", durationMinutes: "30" },
      { name: "Cut", priceUsd: "25.0", durationMinutes: "30" },
      { name: "Cut", priceUsd: "25.000", durationMinutes: "30" },
      { name: "Cut", priceUsd: "-25.00", durationMinutes: "30" },
      { name: "Cut", priceUsd: "$25.00", durationMinutes: "30" },
      { name: "Cut", priceUsd: "25.00", durationMinutes: "30.5" },
      { name: "Cut", priceUsd: "25.00", durationMinutes: "-30" },
      { name: "Cut", priceUsd: "25.00", durationMinutes: "" },
      { name: "Cut", priceUsd: "25.00", durationMinutes: "30", extra: true },
      null,
      "not-an-object",
    ]) {
      const result = replaceCustomerBookingSchema.safeParse({
        ...valid,
        reviewedOffer: invalidOffer,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.path[0])).toContainEqual(
          "reviewedOffer",
        );
      }
    }
  });

  it("rejects empty token and non-object input", () => {
    for (const invalid of [
      { ...valid, token: "" },
      null,
      "not-an-object",
      42,
      [],
    ]) {
      expect(replaceCustomerBookingSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });

  it("rejects caller-supplied contact, shop, booking, and extra fields", () => {
    for (const extra of [
      {
        contact: {
          name: "New Name",
          email: "new@example.test",
          whatsappOptIn: false,
        },
      },
      { name: "New Name" },
      { email: "new@example.test" },
      { phone: "+1 555 0100" },
      { shopId: "foreign-shop" },
      { bookingId: "123e4567-e89b-42d3-a456-426614174000" },
      { actorId: "foreign-owner" },
      { actorType: "customer" },
    ]) {
      const result = replaceCustomerBookingSchema.safeParse({
        ...valid,
        ...extra,
      });
      expect(result.success).toBe(false);
    }
  });
});
