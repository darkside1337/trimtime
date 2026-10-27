import { describe, expect, it } from "vitest";
import { createOwnerBookingSchema } from "../schemas";

describe("manual appointment input", () => {
  it("accepts a named contactless appointment at an exact minute", () => {
    const result = createOwnerBookingSchema.safeParse({
      serviceId: "service-a",
      barberId: "barber-a",
      startAt: "2026-11-02T10:07:00.000Z",
      reviewedOffer: {
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: "35",
      },
      contact: { name: "Walk-in Guest", whatsappOptIn: false },
      recoveryKey: "a".repeat(43),
    });

    expect(result.success).toBe(true);
  });

  it("normalizes optional contacts and rejects invalid supplied details", () => {
    const contact = createOwnerBookingSchema.parse({
      serviceId: "service-a",
      barberId: "barber-a",
      startAt: "2026-11-02T10:07:00.000Z",
      reviewedOffer: {
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: "35",
      },
      contact: {
        name: " Walk-in Guest ",
        email: " ADA@EXAMPLE.TEST ",
        phone: " +1 555 0100 ",
        whatsappOptIn: true,
      },
      recoveryKey: "a".repeat(43),
    }).contact;

    expect(contact).toEqual({
      name: "Walk-in Guest",
      email: "ada@example.test",
      phone: "+1 555 0100",
      whatsappOptIn: true,
    });
    for (const invalid of [
      { name: " ", whatsappOptIn: false },
      { name: "Ada", email: "bad", whatsappOptIn: false },
      { name: "Ada", whatsappOptIn: true },
    ]) {
      expect(
        createOwnerBookingSchema.safeParse({
          serviceId: "service-a",
          barberId: "barber-a",
          startAt: "2026-11-02T10:07:00.000Z",
          reviewedOffer: {
            name: "Cut",
            priceUsd: "25.00",
            durationMinutes: "35",
          },
          contact: invalid,
          recoveryKey: "a".repeat(43),
        }).success,
      ).toBe(false);
    }
  });

  it("rejects client supplied authority and non-minute starts", () => {
    const valid = {
      serviceId: "service-a",
      barberId: "barber-a",
      startAt: "2026-11-02T10:07:00.000Z",
      reviewedOffer: {
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: "35",
      },
      contact: { name: "Walk-in Guest", whatsappOptIn: false },
      recoveryKey: "a".repeat(43),
    };

    expect(
      createOwnerBookingSchema.safeParse({ ...valid, shopId: "foreign" })
        .success,
    ).toBe(false);
    expect(
      createOwnerBookingSchema.safeParse({ ...valid, endAt: valid.startAt })
        .success,
    ).toBe(false);
    expect(
      createOwnerBookingSchema.safeParse({
        ...valid,
        startAt: "2026-11-02T10:07:01.000Z",
      }).success,
    ).toBe(false);
    expect(
      createOwnerBookingSchema.safeParse({
        ...valid,
        startAt: "2026-11-02T10:07:00.000001Z",
      }).success,
    ).toBe(false);
  });
});
