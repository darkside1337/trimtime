import { describe, expect, it } from "vitest";
import {
  cancelOwnerBookingSchema,
  createOwnerBookingSchema,
  moveOwnerBookingSchema,
} from "../schemas";

describe("manual appointment input", () => {
  it("owner lifecycle cancellation schema rejects malformed and client authority fields", () => {
    const valid = {
      bookingId: "123e4567-e89b-42d3-a456-426614174000",
      expectedRevision: 0,
      operationKey: "a".repeat(43),
    };
    for (const invalid of [
      { ...valid, bookingId: "not-a-uuid" },
      { ...valid, expectedRevision: -1 },
      { ...valid, expectedRevision: 0.5 },
      { ...valid, operationKey: "a".repeat(42) },
      { ...valid, operationKey: "!".repeat(43) },
      { ...valid, shopId: "foreign-shop" },
      { ...valid, actorId: "foreign-owner" },
    ])
      expect(cancelOwnerBookingSchema.safeParse(invalid).success).toBe(false);
    expect(cancelOwnerBookingSchema.safeParse(valid).success).toBe(true);
  });

  it("owner move accepts exact minutes and rejects seconds or submillisecond starts", () => {
    const valid = {
      bookingId: "123e4567-e89b-42d3-a456-426614174000",
      expectedRevision: 0,
      operationKey: "a".repeat(43),
      serviceId: "service-a",
      barberId: "barber-a",
      startAt: "2026-11-02T11:07:00.000Z",
      reviewedOffer: {
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: "30",
      },
    };
    expect(moveOwnerBookingSchema.safeParse(valid).success).toBe(true);
    for (const startAt of [
      "2026-11-02T11:07:01.000Z",
      "2026-11-02T11:07:00.000001Z",
    ])
      expect(
        moveOwnerBookingSchema.safeParse({ ...valid, startAt }).success,
      ).toBe(false);
  });

  it("owner move schema safely rejects impossible ISO calendar dates", () => {
    const impossible = {
      bookingId: "123e4567-e89b-42d3-a456-426614174000",
      expectedRevision: 0,
      operationKey: "a".repeat(43),
      serviceId: "service-a",
      barberId: "barber-a",
      startAt: "2026-02-30T11:07:00.000Z",
      reviewedOffer: {
        name: "Cut",
        priceUsd: "25.00",
        durationMinutes: "30",
      },
    };
    expect(() => moveOwnerBookingSchema.safeParse(impossible)).not.toThrow();
    expect(moveOwnerBookingSchema.safeParse(impossible).success).toBe(false);
  });

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
